/**
 * Haftalık özet (weekly_summary): `parent_child_summary` (supabase 0043; worker güvenilir çağıran) verisinden
 *   - `/memories/parent_summary.md`: veliye açık kısa özet (≤ 1,5 KB, actor memory-compact; koç bu dosyaya yazamaz).
 *     Deterministiktir: aynı veri aynı metni verir, değişmediyse yeniden yazılmaz. Ad, ham olasılık ve koç sohbeti yoktur.
 *   - bildirim metni: şablon (deterministik) ve `notification_copy` rotası (Haiku 5.5 · low). LLM metni yalnız sınırları
 *     tutarsa kullanılır: ünlem, yüzde ve emoji yok, uzunluk sınırları içinde, girdide olmayan sayı yok; yoksa şablon.
 * `OGRENMEN_NOTIFICATION_COPY=template` LLM'i kapatır (varsayılan llm; sahte kipte fikstür döner).
 */
import { MEMORY_COMPACT_ACTOR, PARENT_SUMMARY_MAX_BYTES, PARENT_SUMMARY_PATH, PgStore, type Gateway } from '@ogrenmen/llm';
import { notificationCopyUserText } from '@ogrenmen/prompts';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import { addDays, trMinutes, trNum } from './rules.js';

export interface WeekStats {
  start: string;
  minutes: number;
  questions: number;
  practice_sets: number;
  exams: number;
  diagnoses: number;
  active_days: number;
}

export interface CourseBand {
  title: string;
  bands: { low: number; mid: number; high: number; insufficient: number };
  trend: 'up' | 'steady' | 'down' | null;
}

export interface ChildSummary {
  week: WeekStats;
  prev_week: WeekStats;
  last_exam: { title: string; finished_at: string | null; net: number | null; total: number | null } | null;
  courses: CourseBand[];
  open_misconceptions: number;
  last_activity_at: string | null;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function week(v: unknown): WeekStats {
  const w = obj(v);
  return {
    start: String(w.start ?? ''),
    minutes: num(w.minutes),
    questions: num(w.questions),
    practice_sets: num(w.practice_sets),
    exams: num(w.exams),
    diagnoses: num(w.diagnoses),
    active_days: num(w.active_days),
  };
}

/** `parent_child_summary` JSON'unu tipler (eksik alan 0/null). */
export function parseChildSummary(raw: unknown): ChildSummary {
  const r = obj(raw);
  const le = r.last_exam ? obj(r.last_exam) : null;
  return {
    week: week(r.week),
    prev_week: week(r.prev_week),
    last_exam: le
      ? { title: String(le.title ?? 'Deneme'), finished_at: le.finished_at ? String(le.finished_at) : null, net: le.net === null || le.net === undefined ? null : num(le.net), total: le.total === null || le.total === undefined ? null : num(le.total) }
      : null,
    courses: (Array.isArray(r.courses) ? r.courses : []).map((c) => {
      const x = obj(c);
      const b = obj(x.bands);
      const trend = x.trend === 'up' || x.trend === 'steady' || x.trend === 'down' ? x.trend : null;
      return { title: String(x.title ?? 'Ders'), bands: { low: num(b.low), mid: num(b.mid), high: num(b.high), insufficient: num(b.insufficient) }, trend };
    }),
    open_misconceptions: num(r.open_misconceptions),
    last_activity_at: r.last_activity_at ? String(r.last_activity_at) : null,
  };
}

export async function loadChildSummary(db: Db, studentId: string): Promise<ChildSummary> {
  const r = await db.query('select public.parent_child_summary($1::uuid) as s', [studentId]);
  return parseChildSummary(r.rows[0]?.s);
}

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** "2026-11-02" → "2 Kas". */
export function trShortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''}`.trim();
}

/** Haftanın aralığı: "2–8 Kas". */
export function weekRange(start: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return 'bu hafta';
  const end = addDays(start, 6);
  const [s, e] = [trShortDate(start), trShortDate(end)];
  return s.split(' ')[1] === e.split(' ')[1] ? `${s.split(' ')[0]}–${e}` : `${s} – ${e}`;
}

const TREND: Record<string, string> = { up: 'yükseliyor', steady: 'yatay', down: 'bu hafta biraz geriledi' };

function bandLine(c: CourseBand): string {
  const b = c.bands;
  const parts = [b.high > 0 ? `${b.high} kazanım yüksek` : null, b.mid > 0 ? `${b.mid} orta` : null, b.low > 0 ? `${b.low} düşük` : null].filter(Boolean);
  const head = parts.length > 0 ? parts.join(', ') : 'henüz bant için yeterli veri yok';
  const more = b.insufficient > 0 && parts.length > 0 ? `; ${b.insufficient} kazanımda veri az` : '';
  return `${c.title}: ${head}${more}${c.trend ? `; yön: ${TREND[c.trend]}` : ''}`;
}

/** Veliye açık özet dosyası (Markdown, ≤ 1,5 KB, deterministik). */
export function parentSummaryMarkdown(s: ChildSummary): string {
  const lines = [`# Haftalık özet · ${weekRange(s.week.start)}`, ''];
  if (s.week.minutes <= 0 && s.week.questions <= 0) lines.push('- Bu hafta kayıtlı çalışma yok.');
  else lines.push(`- Tahmini çalışma: ${trMinutes(s.week.minutes)} · ${s.week.questions} soru · ${s.week.active_days} etkin gün`);
  if (s.prev_week.minutes > 0 || s.prev_week.questions > 0) lines.push(`- Geçen hafta: ${trMinutes(s.prev_week.minutes)} · ${s.prev_week.questions} soru`);
  if (s.last_exam && s.last_exam.net !== null) {
    const when = s.last_exam.finished_at ? ` (${trShortDate(s.last_exam.finished_at.slice(0, 10))})` : '';
    lines.push(`- Son deneme: ${s.last_exam.title.slice(0, 80)} · ${trNum(s.last_exam.net)} net${when}`);
  }
  for (const c of s.courses.slice(0, 4)) lines.push(`- ${bandLine(c)}`);
  if (s.open_misconceptions > 0) lines.push(`- Üzerinde çalışılan yanılgı: ${s.open_misconceptions}`);
  lines.push('', 'Bantlar kanıt sayısına dayanır; süreler tahminidir.');
  let text = lines.join('\n');
  while (Buffer.byteLength(text, 'utf8') > PARENT_SUMMARY_MAX_BYTES && lines.length > 4) {
    lines.splice(lines.length - 3, 1);
    text = lines.join('\n');
  }
  return text;
}

/** parent_summary.md'yi yazar (içerik değişmediyse yazmaz). Döner: yazıldı mı. */
export async function refreshParentSummary(db: Db, studentId: string, s: ChildSummary): Promise<boolean> {
  const store = new PgStore(db);
  const text = parentSummaryMarkdown(s);
  const cur = await store.read(studentId, PARENT_SUMMARY_PATH);
  if (cur === text) return false;
  await store.write(studentId, PARENT_SUMMARY_PATH, text, cur === null ? 'create' : 'compact', MEMORY_COMPACT_ACTOR);
  return true;
}

export interface Copy {
  title: string;
  body: string;
  source: 'template' | 'llm' | 'fallback';
}

/** Haftalık bildirimin şablon metni (veliye; üçüncü kişi, ad yok). */
export function weeklyTemplate(s: ChildSummary): { title: string; body: string } {
  if (s.week.minutes <= 0 && s.week.questions <= 0) {
    return { title: 'Haftalık özet hazır', body: 'Bu hafta kayıtlı bir çalışma görünmüyor. Uygun bir anda nasıl gittiğini sorabilirsiniz.' };
  }
  const exam = s.last_exam && s.last_exam.net !== null && s.week.exams > 0 ? ` Son denemede ${trNum(s.last_exam.net)} net yaptı.` : '';
  return {
    title: 'Haftalık özet hazır',
    body: `Bu hafta ${trMinutes(s.week.minutes)} çalıştı ve ${s.week.questions} soru çözdü.${exam} Ona bu hafta en çok hangi konuyu kolay bulduğunu sorabilirsiniz.`,
  };
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const numbersOf = (s: string) => s.match(/\d+/g) ?? [];

/** LLM bildirim metni kabul edilebilir mi: sınırlar; ünlem, yüzde, emoji yok; girdide olmayan sayı yok. */
export function acceptableNotificationCopy(title: string, body: string, input: unknown): boolean {
  const t = title.trim();
  const b = body.trim();
  if (t.length < 3 || t.length > 60 || b.length < 10 || b.length > 240) return false;
  if (/[!%]/.test(t + b) || PICTOGRAPHIC.test(t + b)) return false;
  const allowed = new Set(numbersOf(JSON.stringify(input)));
  return numbersOf(`${t} ${b}`).every((n) => allowed.has(n));
}

export type NotificationCopyMode = 'template' | 'llm';

export function notificationCopyMode(env: NodeJS.ProcessEnv = process.env): NotificationCopyMode {
  return env.OGRENMEN_NOTIFICATION_COPY === 'template' ? 'template' : 'llm';
}

export interface CopyDeps {
  mode: NotificationCopyMode;
  gateway: () => Promise<Gateway>;
  system: () => Promise<{ text: string; version: string }>;
  log: Logger;
  signal?: AbortSignal;
}

/** notification_copy (Haiku) ile metin; kurala uymazsa ya da çağrı düşerse şablon. */
export async function writeNotificationCopy(
  deps: CopyDeps,
  input: { kind: string; audience: 'parent' | 'student'; data: Record<string, unknown>; template: { title: string; body: string }; studentRef: string | null; studentId: string },
): Promise<Copy> {
  if (deps.mode === 'template') return { ...input.template, source: 'template' };
  try {
    const [gateway, system] = await Promise.all([deps.gateway(), deps.system()]);
    const res = await gateway.call('notification_copy', {
      system: { product: system.text },
      user: notificationCopyUserText({ kind: input.kind, audience: input.audience, data: input.data, template: input.template }),
      promptVersion: system.version,
      studentRef: input.studentRef,
      ref: { table: 'students', id: input.studentId },
      purpose: 'notifications.copy',
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    const d = res.data as { title?: unknown; body?: unknown } | null;
    const title = typeof d?.title === 'string' ? d.title.trim() : '';
    const body = typeof d?.body === 'string' ? d.body.trim() : '';
    if (acceptableNotificationCopy(title, body, { data: input.data, template: input.template })) return { title, body, source: 'llm' };
    deps.log.warn('bildirim metni şablona döndü (LLM çıktısı kurala uymadı)', { kind: input.kind });
  } catch (err) {
    deps.log.warn('bildirim metni şablona döndü (LLM çağrısı düştü)', { kind: input.kind, error: (err as Error).message });
  }
  return { ...input.template, source: 'fallback' };
}

/** Haftalık metnin LLM'e giden verisi (ad yok, p yok; yalnız sayılar ve ders adları). */
export function weeklyCopyData(s: ChildSummary): Record<string, unknown> {
  return {
    week: weekRange(s.week.start),
    minutes: Math.round(s.week.minutes),
    study_time_text: s.week.minutes > 0 ? trMinutes(s.week.minutes) : null,
    questions: s.week.questions,
    active_days: s.week.active_days,
    prev_week_questions: s.prev_week.questions,
    last_exam_net: s.week.exams > 0 && s.last_exam?.net !== null && s.last_exam?.net !== undefined ? trNum(s.last_exam.net) : null,
    courses: s.courses.slice(0, 3).map((c) => ({ title: c.title, trend: c.trend, high: c.bands.high, mid: c.bands.mid, low: c.bands.low })),
  };
}
