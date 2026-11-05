/**
 * Kural motoru (worker yarısı; docs/PLAN-v2.md §10). `notifications.evaluate` (saatlik + olaylar) ve `weekly.summary`
 * (Pazar 19:00) bunu çağırır. Hedefler `notification_targets(tür)` (kuralı açık veliler × aktif çocuklar; supabase 0042),
 * zamanlama `rules.ts`, yazım `emit_notification` (kural kapalıysa / 24 saat içinde aynı anahtar varsa null; push kanalı
 * ve abonelik varsa SQL aynı işlemde `push.send` atar). E-posta kanalı varsa worker `email.send` atar.
 *
 * Tekilleştirme iki katlıdır: SQL 24 saat içinde aynı (alıcı, tür, anahtar) satırını yazmaz; bir kez olması gereken
 * olaylar (ilerleme, çözülen yanılgı) için motor ayrıca geçmişte aynı anahtarlı bildirim var mı diye bakar.
 */
import type { Db } from '../db.js';
import type { JobContext } from '../jobs/types.js';
import { systemPrompt } from '../prompts.js';
import { dueInactivity, dueWeeklySummary, improvementEvents, inDaytime, localParts, trNum, type LeafCrossing, type NetJump, type Target } from './rules.js';
import {
  loadChildSummary,
  notificationCopyMode,
  refreshParentSummary,
  weeklyCopyData,
  weeklyTemplate,
  writeNotificationCopy,
  type ChildSummary,
  type Copy,
  type NotificationCopyMode,
} from './summary.js';

export const RULE_KINDS = ['weekly_summary', 'inactivity', 'improvement', 'misconception_resolved'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export interface EvaluateOptions {
  kinds: readonly RuleKind[];
  /** Yalnız bu öğrenci (olay tetiklemesi). */
  studentId?: string | null;
  /** Bildirim metni kipi (varsayılan ortamdan). */
  copyMode?: NotificationCopyMode;
}

export interface EvaluateResult {
  targets: Record<string, number>;
  emitted: Record<string, number>;
  skipped: number;
  failed: number;
  summaries: number;
  emails: number;
  copy: Partial<Record<Copy['source'], number>>;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function parseTargets(raw: unknown): Target[] {
  return (Array.isArray(raw) ? raw : []).map((x) => {
    const t = obj(x);
    return {
      recipient_id: String(t.recipient_id),
      student_id: String(t.student_id),
      student_name: String(t.student_name ?? 'Öğrenciniz'),
      tz: String(t.tz ?? 'Europe/Istanbul'),
      params: obj(t.params),
      last_activity_at: t.last_activity_at ? String(t.last_activity_at) : null,
      last_sent_at: t.last_sent_at ? String(t.last_sent_at) : null,
    };
  });
}

export async function loadTargets(db: Db, kind: RuleKind, studentId?: string | null): Promise<Target[]> {
  const r = await db.query('select public.notification_targets($1) as t', [kind]);
  const all = parseTargets(r.rows[0]?.t);
  return studentId ? all.filter((t) => t.student_id === studentId) : all;
}

/** emit_notification; e-posta kanalı varsa `email.send`. Döner: bildirim kimliği (yazılmadıysa null). */
export async function emitNotification(ctx: Pick<JobContext, 'db' | 'enqueue'>, recipient: string, kind: string, payload: Record<string, unknown>): Promise<string | null> {
  const r = await ctx.db.query('select public.emit_notification($1::uuid, $2, $3::jsonb) as id', [recipient, kind, JSON.stringify(payload)]);
  const id = r.rows[0]?.id ? String(r.rows[0].id) : null;
  if (id) await enqueueEmailIfNeeded(ctx, id);
  return id;
}

/** Bildirim e-posta kanalını taşıyorsa `email.send` (bildirim başına tek iş). Döner: atıldı mı. */
export async function enqueueEmailIfNeeded(ctx: Pick<JobContext, 'db' | 'enqueue'>, notificationId: string): Promise<boolean> {
  const r = await ctx.db.query(`select 'email' = any(n.channels) as email from public.notifications n where n.id = $1::uuid`, [notificationId]);
  if (r.rows[0]?.email !== true) return false;
  await ctx.enqueue('email.send', { notification_id: notificationId }, { singletonKey: `email:${notificationId}`, singletonSeconds: 86_400 });
  return true;
}

/**
 * SQL tetikleyicilerinin (exam_analysed, instructor_note_shared …) yazdığı e-posta kanallı bildirimler için süpürme:
 * son 24 saatte yazılmış, e-posta teslim kaydı olmayan satırlar.
 */
export async function sweepEmails(ctx: Pick<JobContext, 'db' | 'enqueue'>, limit = 200): Promise<number> {
  const r = await ctx.db.query(
    `select n.id from public.notifications n
      where 'email' = any(n.channels) and n.created_at > now() - interval '24 hours' and n.payload #> '{delivery,email}' is null
      order by n.created_at limit $1`,
    [limit],
  );
  for (const row of r.rows) {
    await ctx.enqueue('email.send', { notification_id: String(row.id) }, { singletonKey: `email:${String(row.id)}`, singletonSeconds: 86_400 });
  }
  return r.rows.length;
}

/**
 * Geçmişte gönderilmiş olay anahtarları: bildirimin kendi anahtarı ya da günlük toplu bildirimin taşıdığı olay anahtarları
 * (payload.event_keys; ilerleme ve çözülen yanılgı günde bir bildirimde birleşir).
 */
async function alreadySent(db: Db, recipient: string, kind: string, keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const r = await db.query(
    `select distinct x.k from public.notifications n
      cross join lateral (select n.payload ->> 'dedupe_key' as k
                          union all
                          select e.k from jsonb_array_elements_text(case when jsonb_typeof(n.payload -> 'event_keys') = 'array'
                                                                         then n.payload -> 'event_keys' else '[]'::jsonb end) as e (k)) as x
      where n.recipient_id = $1::uuid and n.kind = $2 and x.k = any($3::text[])`,
    [recipient, kind, [...keys]],
  );
  return new Set(r.rows.map((x) => String(x.k)));
}

/** "A konusunda" · "A ve B konularında" · "A, B ve 3 konuda daha" (en çok iki konu adı). */
export function topicsPhrase(topics: readonly string[]): string {
  const [a, b] = topics;
  if (topics.length <= 1) return `${a ?? 'bir'} konusunda`;
  if (topics.length === 2) return `${a} ve ${b} konularında`;
  return `${a}, ${b} ve ${topics.length - 2} konuda daha`;
}

/** Çözülen yanılgılar: "A konusunu" · "A ve B konularını" · "A, B ve 3 konuyu daha". */
export function resolvedPhrase(topics: readonly string[]): string {
  const [a, b] = topics;
  if (topics.length <= 1) return `${a ?? 'bir'} konusunu`;
  if (topics.length === 2) return `${a} ve ${b} konularını`;
  return `${a}, ${b} ve ${topics.length - 2} konuyu daha`;
}

async function leafCrossings(db: Db, studentId: string, leafP: number): Promise<LeafCrossing[]> {
  const r = await db.query(
    `select distinct on (h.enrollment_id, h.skill_id) h.skill_id, s.name as skill_name, m.p::float8 as p, m.evidence_count,
            h.created_at as crossed_at
       from public.mastery_history h
       join public.enrollments e on e.id = h.enrollment_id and e.student_id = $1::uuid and e.status = 'active'
       join public.mastery m on m.enrollment_id = h.enrollment_id and m.skill_id = h.skill_id
       join public.skills s on s.curriculum_id = m.curriculum_id and s.id = m.skill_id and s.is_leaf
      where h.created_at >= now() - interval '8 days' and coalesce(h.p_before, 0) < $2 and h.p_after >= $2
      order by h.enrollment_id, h.skill_id, h.created_at desc`,
    [studentId, leafP],
  );
  return r.rows.map((x) => ({ skill_id: String(x.skill_id), skill_name: String(x.skill_name), p: Number(x.p), evidence_count: Number(x.evidence_count), crossed_at: String(x.crossed_at) }));
}

async function netJumps(db: Db, studentId: string): Promise<NetJump[]> {
  const r = await db.query(
    `with s as (
       select es.id, x.title, (es.score ->> 'net')::numeric as net, es.finished_at,
              lag((es.score ->> 'net')::numeric) over (partition by es.enrollment_id order by es.finished_at, es.id) as prev_net
         from public.exam_sessions es
         join public.enrollments e on e.id = es.enrollment_id and e.student_id = $1::uuid
         join public.exams x on x.id = es.exam_id
        where es.status = 'done' and es.finished_at is not null and jsonb_typeof(es.score -> 'net') = 'number')
     select id, title, net::float8 as net, prev_net::float8 as prev_net, finished_at from s
      where finished_at >= now() - interval '7 days' and prev_net is not null`,
    [studentId],
  );
  return r.rows.map((x) => ({ session_id: String(x.id), exam_title: String(x.title), net: Number(x.net), prev_net: Number(x.prev_net), finished_at: String(x.finished_at) }));
}

async function resolvedMisconceptions(db: Db, studentId: string): Promise<{ id: string; topic: string }[]> {
  const r = await db.query(
    `select mc.id, s.name from public.misconceptions mc
       join public.enrollments e on e.id = mc.enrollment_id and e.student_id = $1::uuid
       join public.skills s on s.curriculum_id = mc.curriculum_id and s.id = mc.skill_id
      where mc.status = 'resolved' and mc.resolved_at >= now() - interval '7 days'
      order by mc.resolved_at`,
    [studentId],
  );
  return r.rows.map((x) => ({ id: String(x.id), topic: String(x.name) }));
}

async function publicRef(db: Db, studentId: string): Promise<string | null> {
  const r = await db.query('select public_ref from public.students where id = $1::uuid', [studentId]);
  return r.rows[0]?.public_ref ? String(r.rows[0].public_ref) : null;
}

/** Kuralları değerlendirir ve zamanı gelen bildirimleri yazar. Bir hedefin hatası diğerlerini durdurmaz. */
export async function evaluateNotifications(ctx: JobContext, opts: EvaluateOptions): Promise<EvaluateResult> {
  const now = ctx.now();
  const res: EvaluateResult = { targets: {}, emitted: {}, skipped: 0, failed: 0, summaries: 0, emails: 0, copy: {} };
  const summaries = new Map<string, Promise<ChildSummary>>();
  const refreshed = new Set<string>();
  const copies = new Map<string, Promise<Copy>>();
  const mode = opts.copyMode ?? notificationCopyMode();
  let prompt: Promise<{ text: string; version: string }> | null = null;
  const system = () => (prompt ??= systemPrompt(ctx.db, 'notification_copy'));
  const summaryOf = (sid: string) => {
    let p = summaries.get(sid);
    if (!p) {
      p = loadChildSummary(ctx.db, sid);
      summaries.set(sid, p);
    }
    return p;
  };
  const bump = (kind: string) => {
    res.emitted[kind] = (res.emitted[kind] ?? 0) + 1;
  };
  const emit = async (t: Target, kind: RuleKind, payload: Record<string, unknown>) => {
    const id = await emitNotification(ctx, t.recipient_id, kind, { student_id: t.student_id, url: '/veli', ...payload });
    if (id) bump(kind);
    else res.skipped++;
    return id;
  };

  for (const kind of opts.kinds) {
    const targets = await loadTargets(ctx.db, kind, opts.studentId);
    res.targets[kind] = targets.length;
    for (const t of targets) {
      try {
        if (kind === 'weekly_summary') {
          const due = dueWeeklySummary(t, now);
          if (!due) continue;
          const s = await summaryOf(t.student_id);
          // parent_summary.md (öğrenci başına bir kez; gece memory.compact'ten sonra çalışır, bu dosyayı o iş yazmaz)
          if (!refreshed.has(t.student_id)) {
            refreshed.add(t.student_id);
            if (await refreshParentSummary(ctx.db, t.student_id, s)) res.summaries++;
          }
          let copy = copies.get(t.student_id);
          if (!copy) {
            const ref = await publicRef(ctx.db, t.student_id);
            copy = writeNotificationCopy(
              { mode, gateway: ctx.gateway, system, log: ctx.log, signal: ctx.signal },
              { kind: 'weekly_summary', audience: 'parent', data: weeklyCopyData(s), template: weeklyTemplate(s), studentRef: ref, studentId: t.student_id },
            );
            copies.set(t.student_id, copy);
          }
          const c = await copy;
          res.copy[c.source] = (res.copy[c.source] ?? 0) + 1;
          // Ad başlıkta deterministik eklenir (metne LLM'e ad gitmez): iki çocuklu velinin iki kartı ayrışır.
          await emit(t, 'weekly_summary', { week_start: due.weekStart, dedupe_key: `week:${t.student_id}:${due.weekStart}`, title: `${c.title} · ${t.student_name}`, body: c.body });
        } else if (kind === 'inactivity') {
          const due = dueInactivity(t, now);
          if (!due) continue;
          await emit(t, 'inactivity', { days: due.days, since: due.since, dedupe_key: `inactivity:${t.student_id}:${due.since}` });
        } else if (kind === 'improvement') {
          // Saatlik süpürme gece göndermez (gündüz penceresi); olay tetiklemesi (studentId) anında yazar.
          if (!opts.studentId && !inDaytime(now, t.tz)) continue;
          // Günde (alıcının saat dilimi) veli × çocuk başına tek bildirim: o gün yeni olan bütün olaylar bir cümlede.
          const leafP = Number(t.params.leaf_p ?? 0.8);
          const events = improvementEvents(t.student_id, t.params, await leafCrossings(ctx.db, t.student_id, Number.isFinite(leafP) ? leafP : 0.8), await netJumps(ctx.db, t.student_id));
          const sent = await alreadySent(ctx.db, t.recipient_id, 'improvement', events.map((e) => e.dedupeKey));
          const fresh = events.filter((e) => !sent.has(e.dedupeKey));
          if (fresh.length === 0) continue;
          const topics = [...new Set(fresh.flatMap((e) => (e.kind === 'leaf' && e.topic ? [e.topic] : [])))];
          const jump = fresh.filter((e) => e.kind === 'net').at(-1);
          const netLine = jump && jump.kind === 'net' ? `son denemesinde netini ${trNum(jump.delta)} artırarak ${trNum(jump.net)} nete çıkardı.` : null;
          const body =
            topics.length === 0
              ? `${t.student_name} ${netLine}`
              : `${t.student_name} ${topicsPhrase(topics)} belirgin ilerleme kaydetti.${netLine ? ` Ayrıca ${netLine}` : ''}`;
          await emit(t, 'improvement', {
            dedupe_key: `improvement:day:${t.student_id}:${localParts(now, t.tz).date}`,
            event_keys: fresh.map((e) => e.dedupeKey),
            skill_ids: fresh.flatMap((e) => (e.kind === 'leaf' ? [e.skill_id] : [])),
            session_ids: fresh.flatMap((e) => (e.kind === 'net' ? [e.session_id] : [])),
            ...(topics[0] ? { topic: topics[0] } : {}),
            body,
          });
        } else {
          if (!opts.studentId && !inDaytime(now, t.tz)) continue;
          const items = await resolvedMisconceptions(ctx.db, t.student_id);
          const sent = await alreadySent(ctx.db, t.recipient_id, 'misconception_resolved', items.map((m) => `misconception:${m.id}`));
          const fresh = items.filter((m) => !sent.has(`misconception:${m.id}`));
          if (fresh.length === 0) continue;
          const topics = [...new Set(fresh.map((m) => m.topic))];
          await emit(t, 'misconception_resolved', {
            dedupe_key: `misconception:day:${t.student_id}:${localParts(now, t.tz).date}`,
            event_keys: fresh.map((m) => `misconception:${m.id}`),
            misconception_ids: fresh.map((m) => m.id),
            topic: topics[0],
            body: `${t.student_name} daha önce zorlandığı ${resolvedPhrase(topics)} artık doğru çözüyor.`,
          });
        }
      } catch (err) {
        res.failed++;
        ctx.log.warn('bildirim kuralı değerlendirilemedi', { kind, error: (err as Error).message });
      }
    }
  }
  return res;
}
