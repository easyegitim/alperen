/**
 * P6 kural motoru, gönderim ve rapor (sahte veritabanı + sahte LLM): saf kurallar (saat dilimi, haftalık özet zamanı,
 * sessizlik, ilerleme), parent_summary.md ve bildirim metni (Haiku → kurala uymazsa şablon), tekilleştirme (SQL null +
 * geçmiş anahtar), e-posta kanalı, push/e-posta kuru çalışma, rapor temizliği ve deterministik rapor.
 */
import { describe, expect, it } from 'vitest';
import { contractRegistry, type Contract } from '@ogrenmen/contracts';
import { FakeTransport } from '@ogrenmen/llm';
import { getJob } from '../src/jobs/registry.js';
import { createEmailSendJob } from '../src/jobs/email-send.js';
import { evaluateNotifications, resolvedPhrase, topicsPhrase } from '../src/notifications/engine.js';
import { buildEmail, maskEmail, ResendSender, type EmailSender } from '../src/notifications/email.js';
import { deliveryStatus } from '../src/notifications/delivery.js';
import { dueInactivity, dueWeeklySummary, improvementEvents, localParts, trMinutes, type Target } from '../src/notifications/rules.js';
import {
  acceptableNotificationCopy,
  parentSummaryMarkdown,
  parseChildSummary,
  weeklyCopyData,
  weeklyTemplate,
  writeNotificationCopy,
} from '../src/notifications/summary.js';
import { fallbackParentReport, sanitizeReport } from '../src/reports/produce.js';
import type { ReportData } from '../src/reports/data.js';
import { silentLogger } from '../src/log.js';
import { jobCtx, routedDb, type Route } from './support.js';

const PARENT = '00000000-0000-4000-8000-0000000000b1';
const STUDENT = '11111111-1111-4111-8111-111111111111';
// Pazar 8 Kasım 2026, 19:05 Europe/Istanbul (UTC+3)
const SUNDAY_1905 = new Date('2026-11-08T16:05:00Z');

function target(over: Partial<Target> = {}): Target {
  return {
    recipient_id: PARENT,
    student_id: STUDENT,
    student_name: 'Elif',
    tz: 'Europe/Istanbul',
    params: { channels: ['in_app', 'push'], weekday: 0, hour: 19, days: 5, leaf_p: 0.8, min_evidence: 5, weekly_net_delta: 4 },
    last_activity_at: '2026-11-08T10:00:00Z',
    last_sent_at: null,
    ...over,
  };
}

const SUMMARY = parseChildSummary({
  student: { id: STUDENT, name: 'Elif', grade: 11 },
  week: { start: '2026-11-02', minutes: 270, hours: 4.5, questions: 38, practice_sets: 4, exams: 1, diagnoses: 2, active_days: 4 },
  prev_week: { start: '2026-10-26', minutes: 120, questions: 20, active_days: 2 },
  last_exam: { session_id: 'x', title: 'TYT Deneme 3', finished_at: '2026-11-05T15:00:00Z', net: 21.75, total: 40 },
  courses: [{ title: 'TYT Matematik', bands: { low: 2, mid: 5, high: 3, insufficient: 12 }, trend: 'up' }],
  open_misconceptions: 2,
  summary_md: null,
});

describe('kurallar (saf)', () => {
  it('yerel saat parçaları: İstanbul ve başka saat dilimi; haftanın pazartesisi', () => {
    expect(localParts(SUNDAY_1905, 'Europe/Istanbul')).toEqual({ weekday: 0, hour: 19, date: '2026-11-08', weekStart: '2026-11-02' });
    expect(localParts(SUNDAY_1905, 'America/New_York')).toMatchObject({ weekday: 0, hour: 11, date: '2026-11-08' });
    expect(localParts(SUNDAY_1905, 'Geçersiz/Bölge')).toMatchObject({ hour: 19 }); // geçersiz → İstanbul
  });

  it('haftalık özet: Pazar 19:00 sonrası bir kez; önce değil; kendi gün/saati; hafta içinde ikinci kez yok', () => {
    expect(dueWeeklySummary(target(), SUNDAY_1905)).toEqual({ weekStart: '2026-11-02' });
    expect(dueWeeklySummary(target(), new Date('2026-11-08T15:59:00Z'))).toBeNull(); // 18:59
    expect(dueWeeklySummary(target(), new Date('2026-11-07T16:05:00Z'))).toBeNull(); // cumartesi
    expect(dueWeeklySummary(target({ last_sent_at: '2026-11-08T16:01:00Z' }), SUNDAY_1905)).toBeNull();
    expect(dueWeeklySummary(target({ last_sent_at: '2026-11-01T16:01:00Z' }), SUNDAY_1905)).toEqual({ weekStart: '2026-11-02' });
    const friday9 = target({ params: { weekday: 5, hour: 9 } });
    expect(dueWeeklySummary(friday9, new Date('2026-11-06T06:30:00Z'))).toEqual({ weekStart: '2026-11-02' });
    expect(dueWeeklySummary(friday9, SUNDAY_1905)).toBeNull();
  });

  it('sessizlik: 5 tam gün; sessizlik başına bir kez; hiç etkinlik yoksa yok; eşik alıcıdan', () => {
    const t = target({ last_activity_at: '2026-11-03T10:00:00Z' });
    expect(dueInactivity(t, SUNDAY_1905)).toEqual({ days: 5, since: '2026-11-03' });
    expect(dueInactivity(target({ last_activity_at: '2026-11-04T10:00:00Z' }), SUNDAY_1905)).toBeNull();
    expect(dueInactivity({ ...t, last_sent_at: '2026-11-08T08:00:00Z' }, SUNDAY_1905)).toBeNull();
    // yeni etkinlik → yeni sessizlik: önceki gönderim etkinlikten önceyse yeniden
    expect(dueInactivity({ ...t, last_sent_at: '2026-11-02T08:00:00Z' }, SUNDAY_1905)).not.toBeNull();
    expect(dueInactivity(target({ last_activity_at: null }), SUNDAY_1905)).toBeNull();
    expect(dueInactivity({ ...t, params: { days: 7 } }, SUNDAY_1905)).toBeNull();
    // gece (02:00 İstanbul) gönderilmez; 09:00 İstanbul'da zamanı gelmiş sayılır
    expect(dueInactivity(t, new Date('2026-11-08T23:00:00Z'))).toBeNull();
    expect(dueInactivity(t, new Date('2026-11-09T06:00:00Z'))).toEqual({ days: 5, since: '2026-11-03' });
  });

  it('ilerleme: yaprak 0,8 eşiğini ≥ 5 kanıtla; net + 4', () => {
    const leaves = [
      { skill_id: 'a', skill_name: 'Üslü ifadeler', p: 0.86, evidence_count: 7, crossed_at: '2026-11-06' },
      { skill_id: 'b', skill_name: 'Kümeler', p: 0.9, evidence_count: 3, crossed_at: '2026-11-06' },
      { skill_id: 'c', skill_name: 'Oran', p: 0.79, evidence_count: 9, crossed_at: '2026-11-06' },
    ];
    const jumps = [
      { session_id: 's1', exam_title: 'D3', net: 25.5, prev_net: 21.25, finished_at: '2026-11-06' },
      { session_id: 's2', exam_title: 'D4', net: 23, prev_net: 21, finished_at: '2026-11-07' },
    ];
    const ev = improvementEvents(STUDENT, target().params, leaves, jumps);
    expect(ev.map((e) => e.dedupeKey)).toEqual([`improvement:skill:${STUDENT}:a`, 'improvement:net:s1']);
    expect(ev[1]).toMatchObject({ kind: 'net', delta: 4.25 });
    expect(improvementEvents(STUDENT, { weekly_net_delta: 2 }, [], jumps)).toHaveLength(2);
    expect(trMinutes(270)).toBe('yaklaşık 4,5 saat');
    expect(trMinutes(40)).toBe('40 dakika');
  });
});

describe('haftalık özet: parent_summary.md ve bildirim metni', () => {
  it('parent_summary.md: ≤ 1,5 KB, ad yok, yüzde yok, bant ve süre', () => {
    const md = parentSummaryMarkdown(SUMMARY);
    expect(Buffer.byteLength(md, 'utf8')).toBeLessThanOrEqual(1536);
    expect(md).toContain('# Haftalık özet · 2–8 Kas');
    expect(md).toContain('yaklaşık 4,5 saat · 38 soru · 4 etkin gün');
    expect(md).toContain('Son deneme: TYT Deneme 3 · 21,75 net');
    expect(md).toContain('TYT Matematik: 3 kazanım yüksek, 5 orta, 2 düşük; 12 kazanımda veri az; yön: yükseliyor');
    expect(md).not.toMatch(/Elif|%|!/);
    // çalışma yoksa suçlamadan
    const empty = parseChildSummary({ week: { start: '2026-11-02' }, prev_week: {}, courses: [] });
    expect(parentSummaryMarkdown(empty)).toContain('Bu hafta kayıtlı çalışma yok.');
    expect(weeklyTemplate(empty).body).toBe('Bu hafta kayıtlı bir çalışma görünmüyor. Uygun bir anda nasıl gittiğini sorabilirsiniz.');
  });

  it('şablon metin: sayılar, somut adım; ünlem ve yüzde yok', () => {
    const t = weeklyTemplate(SUMMARY);
    expect(t).toEqual({
      title: 'Haftalık özet hazır',
      body: 'Bu hafta yaklaşık 4,5 saat çalıştı ve 38 soru çözdü. Son denemede 21,75 net yaptı. Ona bu hafta en çok hangi konuyu kolay bulduğunu sorabilirsiniz.',
    });
    expect(acceptableNotificationCopy(t.title, t.body, { data: weeklyCopyData(SUMMARY), template: t })).toBe(true);
    expect(acceptableNotificationCopy('Harika bir hafta!', t.body, { template: t })).toBe(false);
    expect(acceptableNotificationCopy('Haftalık özet', 'Bu hafta 52 soru çözdü, çok iyi.', { template: t })).toBe(false); // uydurma sayı
    expect(acceptableNotificationCopy('Haftalık özet', 'Bu hafta %80 başarı.', { template: t })).toBe(false);
  });

  it('notification_copy (Haiku): fikstür kabul edilir; kurala uymayan çıktı ve düşen çağrı şablona döner', async () => {
    const transport = new FakeTransport();
    const ctx = jobCtx({ transport });
    const deps = { mode: 'llm' as const, gateway: ctx.gateway, system: async () => ({ text: 'ürün', version: 'v1' }), log: silentLogger };
    const input = { kind: 'weekly_summary', audience: 'parent' as const, data: weeklyCopyData(SUMMARY), template: weeklyTemplate(SUMMARY), studentRef: 's_qk7m2rx4tn5a', studentId: STUDENT };
    const ok = await writeNotificationCopy(deps, input);
    expect(ok.source).toBe('llm');
    expect(ok.title).toBe('Haftalık özet hazır');
    const req = transport.requests.at(-1)!;
    expect(req.route).toBe('notification_copy');
    expect(req.body.model).toBe('claude-haiku-5-5');
    expect(req.body.thinking).toEqual({ type: 'disabled' });
    expect(JSON.stringify(req.body.messages)).toContain('<notification>');
    expect(JSON.stringify(req.body.messages)).not.toContain('Elif');
    transport.enqueue('notification_copy', { json: { title: 'Süper hafta', body: 'Bu hafta 99 soru çözdü, tebrikler.', action_label: null } });
    expect((await writeNotificationCopy(deps, input)).source).toBe('fallback');
    transport.enqueue('notification_copy', { stopReason: 'refusal', stopDetails: { category: 'general_harms' } });
    const fb = await writeNotificationCopy(deps, input);
    expect(fb).toMatchObject({ source: 'fallback', body: weeklyTemplate(SUMMARY).body });
    expect((await writeNotificationCopy({ ...deps, mode: 'template' }, input)).source).toBe('template');
  });
});

/** Kural motoru için sahte veritabanı: hedefler, özet, emit (null = SQL tekilleştirmesi), kanallar, geçmiş anahtarlar. */
function engineDb(opts: { targets?: Record<string, Target[]>; emitNull?: boolean; channels?: string[]; sentKeys?: string[]; leaves?: Record<string, unknown>[]; jumps?: Record<string, unknown>[] }) {
  const emitted: { recipient: string; kind: string; payload: Record<string, unknown> }[] = [];
  const memory = new Map<string, string>();
  const routes: Route[] = [
    [/notification_targets/, (v) => [{ t: opts.targets?.[String(v?.[0])] ?? [] }]],
    [/parent_child_summary/, () => [{ s: { week: { start: '2026-11-02', minutes: 270, questions: 38, exams: 0, active_days: 4 }, prev_week: {}, courses: [] } }]],
    [/select content from public\.memory_files/, (v) => (memory.has(String(v?.[1])) ? [{ content: memory.get(String(v?.[1])) }] : [])],
    [/upsert_memory_file/, (v) => {
      memory.set(String(v?.[1]), String(v?.[2]));
      return [{ result: {} }];
    }],
    [/select public_ref/, () => [{ public_ref: 's_qk7m2rx4tn5a' }]],
    [/emit_notification/, (v) => {
      emitted.push({ recipient: String(v?.[0]), kind: String(v?.[1]), payload: JSON.parse(String(v?.[2])) });
      return [{ id: opts.emitNull ? null : `n-${emitted.length}` }];
    }],
    [/'email' = any\(n\.channels\) as email/, () => [{ email: (opts.channels ?? ['in_app']).includes('email') }]],
    [/payload ->> 'dedupe_key' as k/, () => (opts.sentKeys ?? []).map((k) => ({ k }))],
    [/mastery_history/, () => opts.leaves ?? []],
    [/lag\(/, () => opts.jumps ?? []],
    [/misconceptions mc/, () => []],
  ];
  return { db: routedDb(routes), emitted, memory };
}

describe('kural motoru (evaluateNotifications)', () => {
  it('haftalık özet: parent_summary.md yazılır, metinli bildirim, e-posta kanalı varsa email.send', async () => {
    const { db, emitted, memory } = engineDb({ targets: { weekly_summary: [target()] }, channels: ['in_app', 'push', 'email'] });
    const ctx = jobCtx({ db, now: () => SUNDAY_1905 });
    const res = await evaluateNotifications(ctx, { kinds: ['weekly_summary'], copyMode: 'template' });
    expect(res).toMatchObject({ emitted: { weekly_summary: 1 }, summaries: 1, failed: 0, copy: { template: 1 } });
    expect(emitted[0]).toMatchObject({
      recipient: PARENT,
      kind: 'weekly_summary',
      payload: { student_id: STUDENT, week_start: '2026-11-02', dedupe_key: `week:${STUDENT}:2026-11-02`, url: '/veli', title: 'Haftalık özet hazır · Elif' },
    });
    expect(String(emitted[0]!.payload.body)).toContain('38 soru');
    expect(memory.get('/memories/parent_summary.md')).toContain('38 soru');
    expect(ctx.enqueued).toEqual([{ name: 'email.send', data: { notification_id: 'n-1' }, opts: { singletonKey: 'email:n-1', singletonSeconds: 86_400 } }]);
    // aynı saat yeniden: SQL tekilleştirmesi null döner → atlanır, e-posta yok
    const again = engineDb({ targets: { weekly_summary: [target()] }, emitNull: true });
    const ctx2 = jobCtx({ db: again.db, now: () => SUNDAY_1905 });
    const res2 = await evaluateNotifications(ctx2, { kinds: ['weekly_summary'], copyMode: 'template' });
    expect(res2).toMatchObject({ emitted: {}, skipped: 1 });
    expect(ctx2.enqueued).toEqual([]);
  });

  it('iki çocuklu veli: haftalık özet kartları adla ayrışır (metinde ad yok, başlıkta var)', async () => {
    const other = target({ student_id: '22222222-2222-4222-8222-222222222222', student_name: 'Can' });
    const { db, emitted } = engineDb({ targets: { weekly_summary: [target(), other] } });
    const res = await evaluateNotifications(jobCtx({ db, now: () => SUNDAY_1905 }), { kinds: ['weekly_summary'], copyMode: 'template' });
    expect(res.emitted).toEqual({ weekly_summary: 2 });
    expect(emitted.map((e) => e.payload.title)).toEqual(['Haftalık özet hazır · Elif', 'Haftalık özet hazır · Can']);
    expect(emitted[0]!.payload.body).toBe(emitted[1]!.payload.body); // metin öğrenciye özgü değil; ayrım başlıkta
  });

  it('gece: saatlik süpürme ilerleme ve yanılgı bildirimi yazmaz; olay tetiklemesi (öğrenci) yazar', async () => {
    const t = target();
    const leaves = [{ skill_id: 'a', skill_name: 'Üslü ifadeler', p: 0.86, evidence_count: 7, crossed_at: '2026-11-07' }];
    const night = new Date('2026-11-08T23:00:00Z'); // 02:00 İstanbul
    const sweep = engineDb({ targets: { improvement: [t] }, leaves });
    const r1 = await evaluateNotifications(jobCtx({ db: sweep.db, now: () => night }), { kinds: ['improvement'], copyMode: 'template' });
    expect(r1.emitted).toEqual({});
    expect(sweep.emitted).toEqual([]);
    const event = engineDb({ targets: { improvement: [t] }, leaves });
    const r2 = await evaluateNotifications(jobCtx({ db: event.db, now: () => night }), { kinds: ['improvement'], studentId: STUDENT, copyMode: 'template' });
    expect(r2.emitted).toEqual({ improvement: 1 });
  });

  it('zamanı gelmeyen kural yazmaz; öğrenci süzgeci', async () => {
    const { db, emitted } = engineDb({ targets: { weekly_summary: [target()], inactivity: [target()] } });
    const ctx = jobCtx({ db, now: () => new Date('2026-11-05T09:00:00Z') });
    await evaluateNotifications(ctx, { kinds: ['weekly_summary', 'inactivity'], copyMode: 'template' });
    expect(emitted).toEqual([]);
    const ctx2 = jobCtx({ db, now: () => SUNDAY_1905 });
    const res = await evaluateNotifications(ctx2, { kinds: ['weekly_summary'], studentId: '22222222-2222-4222-8222-222222222222', copyMode: 'template' });
    expect(res.targets.weekly_summary).toBe(0);
  });

  it('sessizlik ve ilerleme: anahtarlar; daha önce gönderilen ilerleme yinelenmez', async () => {
    const t = target({ last_activity_at: '2026-11-02T10:00:00Z' });
    const { db, emitted } = engineDb({
      targets: { inactivity: [t], improvement: [t] },
      leaves: [{ skill_id: 'a', skill_name: 'Üslü ifadeler', p: 0.86, evidence_count: 7, crossed_at: '2026-11-06' }],
      jumps: [{ id: 's1', title: 'D3', net: 25.5, prev_net: 21.25, finished_at: '2026-11-06' }],
      sentKeys: [`improvement:skill:${STUDENT}:a`],
    });
    const ctx = jobCtx({ db, now: () => SUNDAY_1905 });
    const res = await evaluateNotifications(ctx, { kinds: ['inactivity', 'improvement'], copyMode: 'template' });
    expect(res.emitted).toEqual({ inactivity: 1, improvement: 1 });
    expect(emitted.map((e) => [e.kind, e.payload.dedupe_key])).toEqual([
      ['inactivity', `inactivity:${STUDENT}:2026-11-02`],
      ['improvement', `improvement:day:${STUDENT}:2026-11-08`],
    ]);
    expect(emitted[1]!.payload).toMatchObject({ event_keys: ['improvement:net:s1'], session_ids: ['s1'], skill_ids: [] });
    expect(emitted[1]!.payload.body).toBe('Elif son denemesinde netini 4,25 artırarak 25,5 nete çıkardı.');
  });

  it('ilerleme günde tek bildirim: en çok iki konu adı, olay anahtarları yükte', async () => {
    const t = target();
    const leaf = (id: string, name: string) => ({ skill_id: id, skill_name: name, p: 0.9, evidence_count: 8, crossed_at: '2026-11-07' });
    const { db, emitted } = engineDb({
      targets: { improvement: [t] },
      leaves: [leaf('a', 'Üslü ifadeler'), leaf('b', 'Köklü ifadeler'), leaf('c', 'Oran'), leaf('d', 'Yüzdeler'), leaf('e', 'Kümeler')],
      jumps: [{ id: 's1', title: 'D3', net: 25.5, prev_net: 21.25, finished_at: '2026-11-06' }],
      sentKeys: [`improvement:skill:${STUDENT}:e`],
    });
    const res = await evaluateNotifications(jobCtx({ db, now: () => SUNDAY_1905 }), { kinds: ['improvement'], copyMode: 'template' });
    expect(res.emitted).toEqual({ improvement: 1 });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.payload).toMatchObject({
      dedupe_key: `improvement:day:${STUDENT}:2026-11-08`,
      skill_ids: ['a', 'b', 'c', 'd'],
      event_keys: [...['a', 'b', 'c', 'd'].map((x) => `improvement:skill:${STUDENT}:${x}`), 'improvement:net:s1'],
    });
    expect(emitted[0]!.payload.body).toBe(
      'Elif Üslü ifadeler, Köklü ifadeler ve 2 konuda daha belirgin ilerleme kaydetti. Ayrıca son denemesinde netini 4,25 artırarak 25,5 nete çıkardı.',
    );
    expect(topicsPhrase(['A'])).toBe('A konusunda');
    expect(topicsPhrase(['A', 'B'])).toBe('A ve B konularında');
    expect(resolvedPhrase(['A', 'B', 'C'])).toBe('A, B ve 1 konuyu daha');
  });
});

describe('gönderim: push ve e-posta kuru çalışma', () => {
  const NID = '33333333-3333-4333-8333-333333333333';

  it('push.send: VAPID yok → teslim dry, sent_at boş; abonelik yok → none', async () => {
    const db = routedDb([
      [/from public\.notifications where id/, () => [{ recipient_id: PARENT, kind: 'weekly_summary', title: 'Haftalık özet hazır', body: 'x', channels: ['in_app', 'push'], url: '/veli' }]],
      [/from public\.push_subscriptions/, () => [{ id: 'p1', endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'k', auth: 'a' }]],
    ]);
    const res = await getJob('push.send')!.handler!({ notification_id: NID }, jobCtx({ db }));
    expect(res).toMatchObject({ subscriptions: 1, sent: 0, skipped: 'dry-run' });
    const mark = db.calls.find((c) => /payload \|\| jsonb_build_object\('delivery'/.test(c.text))!;
    expect(mark.values).toEqual([NID, 'push', 'dry', null]);
    expect(mark.text).toMatch(/case when \$3 = 'sent' then/);
    const none = routedDb([[/from public\.notifications where id/, () => [{ recipient_id: PARENT, kind: 'k', title: 't', body: null, channels: ['in_app', 'push'], url: null }]]]);
    await getJob('push.send')!.handler!({ notification_id: NID }, jobCtx({ db: none }));
    expect(none.calls.find((c) => /'delivery'/.test(c.text))?.values?.slice(0, 3)).toEqual([NID, 'push', 'none']);
  });

  function emailDb(row: Record<string, unknown> | null) {
    return routedDb([[/left join auth\.users/, () => (row ? [row] : [])]]);
  }
  const ROW = { recipient_id: PARENT, title: 'Haftalık özet hazır', body: 'Bu hafta 38 soru çözdü.', channels: ['in_app', 'email'], payload: { url: '/veli' }, email: 'veli@ogrenmen.test' };

  it('email.send: anahtar yok → dry (adres maskeli günlükte); kanal yoksa ve teslim kaydı varsa atlar; adres yoksa none', async () => {
    const logs: unknown[] = [];
    const log = { ...silentLogger, info: (msg: string, f?: unknown) => logs.push([msg, f]) };
    const job = createEmailSendJob(() => new ResendSender(null), () => 'https://ogrenmen.app');
    const db = emailDb(ROW);
    expect(await job.handler!({ notification_id: NID }, jobCtx({ db, log }))).toEqual({ status: 'dry' });
    expect(db.calls.at(-1)!.values).toEqual([NID, 'email', 'dry', null]);
    expect(JSON.stringify(logs)).toContain('v***@ogrenmen.test');
    expect(JSON.stringify(logs)).not.toContain('veli@ogrenmen.test');
    expect(JSON.stringify(logs)).toContain('"text_length"'); // içerik değil, uzunluk
    expect(JSON.stringify(logs)).not.toContain('38 soru');
    expect(JSON.stringify(logs)).not.toContain('Haftalık');
    expect(await job.handler!({ notification_id: NID }, jobCtx({ db: emailDb({ ...ROW, channels: ['in_app'] }) }))).toMatchObject({ status: 'skipped' });
    expect(await job.handler!({ notification_id: NID }, jobCtx({ db: emailDb({ ...ROW, payload: { delivery: { email: { status: 'dry' } } } }) }))).toMatchObject({ status: 'skipped' });
    expect(await job.handler!({ notification_id: NID }, jobCtx({ db: emailDb({ ...ROW, email: null }) }))).toEqual({ status: 'none' });
    await expect(job.handler!({ notification_id: NID }, jobCtx({ db: emailDb(null) }))).rejects.toThrow(/bildirim yok/);
  });

  it('email.send: Resend gönderir (Bearer, JSON); 429 yeniden denenir; 422 failed', async () => {
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    let status = 200;
    const sender: EmailSender = new ResendSender({ apiKey: 're_test', from: 'Öğrenmen <bildirim@ogrenmen.app>' }, async (url, init) => {
      calls.push({ url, init });
      return { status, ok: status < 300, text: async () => (status < 300 ? '{"id":"em_1"}' : '{"message":"x"}') };
    });
    const job = createEmailSendJob(() => sender, () => null);
    const db = emailDb(ROW);
    expect(await job.handler!({ notification_id: NID }, jobCtx({ db }))).toEqual({ status: 'sent' });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.init.headers.Authorization).toBe('Bearer re_test');
    expect(JSON.parse(calls[0]!.init.body)).toMatchObject({ to: ['veli@ogrenmen.test'], subject: 'Haftalık özet hazır' });
    expect(db.calls.at(-1)!.values).toEqual([NID, 'email', 'sent', 'em_1']);
    status = 429;
    await expect(job.handler!({ notification_id: NID }, jobCtx({ db: emailDb(ROW) }))).rejects.toThrow(/429/);
    status = 422;
    expect(await job.handler!({ notification_id: NID }, jobCtx({ db: emailDb(ROW) }))).toMatchObject({ status: 'failed' });
  });

  it('e-posta metni: bağlantı yalnız uygulama içi yol; HTML kaçışlı; teslim durumu okunur', () => {
    const m = buildEmail({ title: 'A <b>', body: 'x & y', url: '//kotu.example' }, 'a@b.c', 'https://ogrenmen.app');
    expect(m.text).not.toContain('kotu.example');
    expect(m.html).toContain('A &lt;b&gt;');
    expect(maskEmail('veli@ogrenmen.test')).toBe('v***@ogrenmen.test');
    expect(deliveryStatus({ delivery: { push: { status: 'dry' } } }, 'push')).toBe('dry');
    expect(deliveryStatus({}, 'email')).toBeNull();
  });
});

describe('veli raporu: temizlik ve deterministik rapor', () => {
  const data: ReportData = {
    kind: 'weekly',
    title: 'Haftalık rapor · 2 Kas',
    period: '2–8 Kas',
    courseTitle: 'TYT Matematik',
    generatedOn: '2026-11-08',
    charts: [
      { data_ref: 'daily_time', chart_kind: 'time_per_question', about: 'günlere göre tahmini çalışma süresi' },
      { data_ref: 'skill_bands', chart_kind: 'style_coverage', about: 'kazanımların bandı (düşük, orta, yüksek)' },
    ],
    chartData: {},
    data: {},
    question: null,
    headline: 'Bu hafta yaklaşık 4,5 saat çalışıp 38 soru çözdü ve 4 gün etkin oldu.',
    details: ['Geçen hafta 2 saat çalışmıştı.'],
    steps: ['Ona bu hafta en çok hangi konuyu kolay bulduğunu sorabilirsiniz.'],
  };
  const contract = contractRegistry['report-ast'] as Contract;

  it('deterministik rapor report-ast sözleşmesine uyar; üç bölüm, tek cümle özet, izinli grafikler', () => {
    const ast = fallbackParentReport(data);
    expect(contract.isValid(ast)).toBe(true);
    expect(ast.sections.map((s) => s.title)).toEqual(['Genel görünüm', 'Ayrıntı', 'Bu hafta yapılabilecekler']);
    expect(ast.blocks.find((b) => b.type === 'paragraph')).toMatchObject({ text: data.headline });
    expect(ast.blocks.filter((b) => b.type === 'chart').map((b) => (b as { data_ref: string }).data_ref)).toEqual(['daily_time', 'skill_bands']);
    expect(ast.keys).toEqual([]);
  });

  it('model raporu: izinsiz grafik atılır, başlık/meta hattın; yüzde ya da anahtar kalıbı → null', () => {
    const model = fallbackParentReport(data);
    model.title = 'Başka başlık';
    model.blocks.push({ type: 'chart', id: 'x1', section_no: 2, chart_kind: 'skill_heatmap', title: 'Uydurma', data_ref: 'exam.secret' } as never);
    const clean = sanitizeReport(model, data)!;
    expect(clean.title).toBe(data.title);
    expect(clean.meta.subtitle).toBe('2–8 Kas');
    expect(clean.blocks.some((b) => b.type === 'chart' && (b as { data_ref: string }).data_ref === 'exam.secret')).toBe(false);
    const pct = fallbackParentReport(data);
    (pct.blocks[1] as { text: string }).text = 'Başarı oranı %80 oldu.';
    expect(sanitizeReport(pct, data)).toBeNull();
    const leak = fallbackParentReport(data);
    (leak.blocks[1] as { text: string }).text = 'Doğru cevap B idi.';
    expect(sanitizeReport(leak, data)).toBeNull();
  });

  it('kayıt defteri: report.generate, email.send, notifications.evaluate işleyicili; yükler', () => {
    const id = '44444444-4444-4444-8444-444444444444';
    for (const n of ['report.generate', 'email.send', 'notifications.evaluate', 'weekly.summary', 'push.send']) {
      expect(getJob(n)?.handler, n).toBeTypeOf('function');
      expect(getJob(n)?.skeleton, n).toBeFalsy();
    }
    expect(getJob('report.generate')!.payload.safeParse({ document_id: id, student_id: id, report_kind: 'weekly', params: { week_start: '2026-11-02' }, requested_by: id }).success).toBe(true);
    expect(getJob('report.generate')!.payload.safeParse({}).success).toBe(false);
    expect(getJob('notifications.evaluate')!.payload.safeParse({ kinds: ['improvement'], student_id: id }).success).toBe(true);
    expect(getJob('notifications.evaluate')!.payload.safeParse({ kinds: ['spam'] }).success).toBe(false);
  });
});
