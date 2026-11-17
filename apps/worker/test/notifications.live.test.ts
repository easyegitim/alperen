/**
 * P6 veli hattı uçtan uca (OGRENMEN_LIVE=1): geçici veritabanı (göçler + seed: Elif ve aktif velisi) + gerçek pg-boss
 * (createApp) + sahte LLM (packages/llm/fixtures: notification_copy, report) + bellek içi Storage + gerçek doc-render PDF.
 *
 *   1. haftalık özet: weekly.summary (Pazar 19:05 İstanbul) → parent_summary.md + weekly_summary bildirimi (velinin
 *      kuralı: push + e-posta) → SQL push.send'i, worker email.send'i atar → anahtar yok: ikisi de kuru çalışır
 *      (payload.delivery push/email = dry, sent_at boş); ikinci çalıştırma yeni bildirim yazmaz (tekilleştirme)
 *   2. ilerleme: son deneme bir öncekinden 4,5 net yukarıda → improvement (bir kez)
 *   3. rapor: velinin JWT'siyle parent_request_report → report.generate → report rotası → PDF Storage'da →
 *      generated_documents rendered → parent_reports hazır → report_ready bildirimi
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeBrowser } from '@ogrenmen/doc-render';
import { FakeTransport, Gateway, PgLedger } from '@ogrenmen/llm';
import { createTempDatabase, seedStudents, type TempDatabase } from '@ogrenmen/llm/testing';
import { createApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { getJob } from '../src/jobs/registry.js';
import { silentLogger } from '../src/log.js';
import { localParts } from '../src/notifications/rules.js';
import type { StorageLike } from '../src/storage.js';
import { jobCtx } from './support.js';

const live = process.env.OGRENMEN_LIVE === '1';
const PARENT = '00000000-0000-4000-8000-0000000000b1';
const MIGRATION_ROLE = 'ogrenmen_owner';

class MemoryStorage implements StorageLike {
  readonly objects = new Map<string, { body: Buffer; type: string }>();
  async upload(bucket: string, path: string, body: Uint8Array | Buffer, contentType: string): Promise<void> {
    this.objects.set(`${bucket}/${path}`, { body: Buffer.from(body), type: contentType });
  }
  async download(bucket: string, path: string): Promise<Buffer> {
    const o = this.objects.get(`${bucket}/${path}`);
    if (!o) throw new Error(`nesne yok: ${bucket}/${path}`);
    return o.body;
  }
  async createSignedUrl(bucket: string, path: string): Promise<string> {
    return `memory://${bucket}/${path}`;
  }
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 60_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('beklenen durum oluşmadı');
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Gerçek tarihin haftasının Pazar 19:05'i (İstanbul): SQL now() ile aynı hafta. */
function sundayOfThisWeek(): Date {
  const local = localParts(new Date(), 'Europe/Istanbul');
  const monday = new Date(`${local.weekStart}T00:00:00Z`);
  return new Date(monday.getTime() + 6 * 86_400_000 + 16 * 3600_000 + 5 * 60_000); // 19:05 TRT = 16:05 UTC
}

describe.skipIf(!live)('Veli hattı: haftalık özet → bildirim (kuru push/e-posta) + rapor PDF (gerçek pg-boss, sahte LLM)', () => {
  let tmp: TempDatabase;
  let app: App;
  let elif = '';
  const storage = new MemoryStorage();
  const sunday = sundayOfThisWeek();

  type Q = (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  async function as<T>(profile: string, fn: (q: Q) => Promise<T>): Promise<T> {
    const c = await tmp.pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: profile, role: 'authenticated' })]);
      await c.query('set local role authenticated');
      const out = await fn((text, values) => c.query(text, values));
      await c.query('commit');
      return out;
    } catch (err) {
      await c.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    tmp = await createTempDatabase();
    ({ elif } = await seedStudents(tmp.pool));
    const q = tmp.pool.query.bind(tmp.pool);
    const course = String(
      (await q(`insert into public.courses (code, title, kind, curriculum_id, visibility) values ('TYT-MAT', 'TYT Matematik', 'exam_track', $1, 'shared') returning id`, [tmp.curriculumId])).rows[0]!.id,
    );
    const enr = String(
      (await q(`insert into public.enrollments (student_id, curriculum_id, course_id, period_label, target_exam) values ($1, $2, $3, 'YKS 2027', 'TYT') returning id`, [elif, tmp.curriculumId, course])).rows[0]!.id,
    );
    // iki deneme (bu hafta): 20,5 → 25 net (+4,5: ilerleme kuralı)
    for (const [title, net, ago] of [['TYT Deneme 1', 20.5, '3 hours'], ['TYT Deneme 2', 25, '1 hour']] as const) {
      const ex = String(
        (await q(`insert into public.exams (course_id, curriculum_id, kind, source, title, question_count, status) values ($1, $2, 'deneme', 'uploaded', $3, 40, 'ready') returning id`, [course, tmp.curriculumId, title])).rows[0]!.id,
      );
      await q(
        `insert into public.exam_sessions (exam_id, enrollment_id, mode, started_at, finished_at, duration_sec, status, score)
         values ($1, $2, 'in_app', now() - $3::interval - interval '40 minutes', now() - $3::interval, 2400, 'done', $4::jsonb)`,
        [ex, enr, ago, JSON.stringify({ total: 40, correct: Math.round(net) + 2, wrong: 8, blank: 0, net, sections: [{ section: 'Matematik', total: 40, correct: Math.round(net) + 2, wrong: 8, blank: 0, net }] })],
      );
    }
    // velinin push aboneliği + e-posta kanalı (kendi JWT'siyle)
    await as(PARENT, async (qq) => {
      await qq(`select public.register_push_subscription($1, $2, $3, 'test')`, ['https://push.example.test/sub/abc123', 'B'.repeat(87), 'a'.repeat(22)]);
      await qq(`select public.set_notification_rule('weekly_summary', null, '{"channels": ["push", "email"]}'::jsonb)`);
    });
    const gateway = new Gateway({ transport: new FakeTransport(), ledger: new PgLedger(tmp.pool) });
    const config = loadConfig({ DATABASE_URL: tmp.url, PGBOSS_SCHEMA: 'pgboss', HEALTH_HOST: '127.0.0.1', HEALTH_PORT: '0', WORKER_SCHEDULES: 'off', PDF_CONCURRENCY: '1' }, ['--process=all']);
    app = createApp(config, { log: silentLogger, db: tmp.pool, gateway: async () => gateway, storage });
    await app.start();
    await tmp.pool.query(`grant usage on schema pgboss to ${MIGRATION_ROLE}; grant select on pgboss.queue to ${MIGRATION_ROLE}; grant select, insert on pgboss.job to ${MIGRATION_ROLE}`);
  }, 120_000);

  afterAll(async () => {
    await app?.stop().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
    await tmp?.drop();
  });

  function ctx() {
    const gateway = new Gateway({ transport: new FakeTransport(), ledger: new PgLedger(tmp.pool) });
    return jobCtx({ db: tmp.pool, now: () => sunday, enqueue: app.enqueue, gateway: async () => gateway, storage: () => storage });
  }

  it('haftalık özet: parent_summary.md, weekly_summary (notification_copy), push + e-posta kuru çalışma, tekilleştirme', async () => {
    const res = await getJob('weekly.summary')!.handler!({}, ctx());
    expect(res).toMatchObject({ deferred: false, students: 1, emitted: { weekly_summary: 1 }, failed: 0 });
    const md = (await tmp.pool.query(`select content from public.memory_files where student_id = $1 and path = '/memories/parent_summary.md'`, [elif])).rows[0]!.content as string;
    expect(md).toContain('# Haftalık özet');
    expect(md).toContain('Son deneme: TYT Deneme 2 · 25 net');
    expect(md).not.toMatch(/Elif|%/);
    const n = await waitFor(async () => {
      const r = await tmp.pool.query(`select id, title, body, channels, payload, sent_at from public.notifications where recipient_id = $1 and kind = 'weekly_summary'`, [PARENT]);
      const row = r.rows[0];
      return row && row.payload?.delivery?.push && row.payload?.delivery?.email ? row : null;
    });
    expect(n.channels).toEqual(['email', 'in_app', 'push']);
    expect(n.payload.delivery.push.status).toBe('dry');
    expect(n.payload.delivery.email.status).toBe('dry');
    expect(n.sent_at).toBeNull();
    expect(n.title).toBe('Haftalık özet hazır · Elif'); // ad başlığa deterministik eklenir (engine.ts)
    expect(String(n.body)).not.toMatch(/[!%]/);
    // veli kendi listesinde görür
    const list = await as(PARENT, async (qq) => (await qq('select public.list_notifications(10) as l')).rows[0]!.l as { unread: number; items: { kind: string }[] });
    expect(list.items.some((i) => i.kind === 'weekly_summary')).toBe(true);
    // ikinci çalıştırma: yeni satır yok
    const again = await getJob('weekly.summary')!.handler!({}, ctx());
    expect(again).toMatchObject({ deferred: false, emitted: {} });
    expect((await tmp.pool.query(`select count(*)::int as c from public.notifications where recipient_id = $1 and kind = 'weekly_summary'`, [PARENT])).rows[0]!.c).toBe(1);
  });

  it('ilerleme: net +4,5 → improvement bir kez; kural kapalıysa yazılmaz', async () => {
    const h = getJob('notifications.evaluate')!.handler!;
    const r1 = await h({ kinds: ['improvement'], student_id: elif }, ctx());
    expect(r1.emitted).toEqual({ improvement: 1 });
    const n = (await tmp.pool.query(`select body, payload from public.notifications where recipient_id = $1 and kind = 'improvement'`, [PARENT])).rows[0]!;
    expect(n.body).toBe('Elif son denemesinde netini 4,5 artırarak 25 nete çıkardı.');
    const r2 = await h({ kinds: ['improvement'], student_id: elif }, ctx());
    expect(r2.emitted).toEqual({});
    await as(PARENT, (qq) => qq(`select public.set_notification_rule('inactivity', false, null)`));
    const r3 = await h({ kinds: ['inactivity'], student_id: elif }, ctx());
    expect(r3.targets.inactivity).toBe(0);
  });

  it('rapor: parent_request_report → report.generate → PDF Storage\'da → rendered → report_ready', async () => {
    const req = await as(PARENT, async (qq) => (await qq(`select public.parent_request_report($1, 'weekly', '{}'::jsonb) as r`, [elif])).rows[0]!.r as { document_id: string; job_id: string | null });
    expect(req.job_id).toBeTruthy();
    const doc = await waitFor(async () => {
      const r = await tmp.pool.query(`select status, pdf_path, content, model from public.generated_documents where id = $1`, [req.document_id]);
      return r.rows[0] && ['rendered', 'failed'].includes(String(r.rows[0].status)) ? r.rows[0] : null;
    }, 90_000);
    expect(doc.status).toBe('rendered');
    expect(doc.pdf_path).toBe(`reports/${elif}/${req.document_id}.pdf`);
    const pdf = storage.objects.get(`documents/${doc.pdf_path}`)!;
    expect(pdf.type).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(doc.content.kind).toBe('report');
    expect(doc.model).toBe('claude-sonnet-5-5'); // model raporu (sahte fikstür) temizlikten geçti; yedek değil
    expect(doc.content.title).toMatch(/^Haftalık rapor · /);
    expect(doc.content.keys).toEqual([]);
    const refs = (doc.content.blocks as { type: string; data_ref?: string }[]).filter((b) => b.type === 'chart').map((b) => b.data_ref);
    for (const r of refs) expect(['daily_time', 'skill_bands', 'weekly_time', 'section_nets', 'exam_nets']).toContain(r);
    const reports = await as(PARENT, async (qq) => (await qq('select public.parent_reports($1) as r', [elif])).rows[0]!.r as { id: string; ready: boolean; pdf_path: string | null }[]);
    expect(reports.find((x) => x.id === req.document_id)).toMatchObject({ ready: true, pdf_path: doc.pdf_path });
    const note = await waitFor(async () => (await tmp.pool.query(`select payload from public.notifications where recipient_id = $1 and kind = 'report_ready'`, [PARENT])).rows[0]);
    expect(note.payload).toMatchObject({ document_id: req.document_id, url: `/veli/rapor/${req.document_id}` });
    // defter: report rotası çağrıldı (sahte LLM), belgeye bağlı
    const calls = (await tmp.pool.query(`select route, ref_table from public.llm_calls where ref_id = $1`, [req.document_id])).rows;
    expect(calls.some((c) => c.route === 'report' && c.ref_table === 'generated_documents')).toBe(true);
  }, 120_000);
});
