/**
 * Yükle zinciri uçtan uca (OGRENMEN_LIVE=1): geçici veritabanı (stub + göçler + seed + TYT müfredatı) + gerçek pg-boss
 * (createApp; pgboss şeması geçici veritabanında) + sahte Anthropic taşıması (betiksiz: packages/llm/fixtures).
 *   öğrenci JWT'si → uploads (RLS) → public.submit_upload → enqueue_job → gerçek pgboss.job ('upload.intake' yükü)
 *   → worker upload.intake → diagnosis.run → apply_diagnosis → solution_analyses + uploads 'ready' + Bugün kartı.
 *   Ardından suggestions.refresh kartı silmez: aynı satır (kimlik), copy_key = analysis:<id>, alt satır one_line.
 *   Yeniden gönderim aynı işi döner; alt küme, tür değişimi ve başka sayfa eklenmiş küme OGR-UPL-003 ile düşer ve
 *   ikinci iş atılmaz (yeni sayfa 'stored' kalır). Okul denemesi: bekleyen kart yenilemeden sonra da durur.
 * Bağlanılan veritabanına dokunmaz; geçici veritabanı sonunda silinir ('ogrenmen' adı asla kullanılmaz).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeTransport, Gateway, PgLedger } from '@ogrenmen/llm';
import { createTempDatabase, seedStudents, type TempDatabase } from '@ogrenmen/llm/testing';
import { createApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/log.js';

const live = process.env.OGRENMEN_LIVE === '1';
const ELIF_PROFILE = '00000000-0000-4000-8000-0000000000e1';
const MIGRATION_ROLE = 'ogrenmen_owner';

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 45_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('beklenen durum oluşmadı');
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe.skipIf(!live)('Yükle zinciri: submit_upload → pgboss.job → upload.intake → diagnosis.run (gerçek pg-boss)', () => {
  let tmp: TempDatabase;
  let app: App;
  let elif = '';
  let enr = '';
  const copyEnv = process.env.OGRENMEN_SUGGESTIONS_COPY;

  type Q = (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  async function asElif<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    const c = await tmp.pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ELIF_PROFILE, role: 'authenticated' })]);
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

  /** Web'in yaptığı gibi: öğrenci kendi klasörüne uploads satırı yazar (Storage nesnesi sahte taşımada okunmaz). */
  async function upload(): Promise<string> {
    const id = randomUUID();
    await asElif((q) =>
      q(
        `insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime, bytes, width, height)
         values ($1, $2, $3, 'photo', $4, 'image/jpeg', 120000, 2000, 1500)`,
        [id, ELIF_PROFILE, elif, `${ELIF_PROFILE}/${id}.jpg`],
      ),
    );
    return id;
  }

  const submit = (ids: string[], kind: 'own_work' | 'school_exam') =>
    asElif(async (q) => (await q('select public.submit_upload($1::uuid[], $2) as r', [ids, kind])).rows[0]!.r as Record<string, unknown>);

  const intakeJobsWith = async (id: string) =>
    (await tmp.pool.query(`select id, data from pgboss.job where name = 'upload.intake' and data -> 'upload_ids' ? $1`, [id])).rows;

  const card = async (uploadId: string) =>
    (await tmp.pool.query(
      `select id, title, subtitle, payload from public.suggestions
        where student_id = $1 and kind = 'upload_result' and consumed_at is null and payload ->> 'upload_id' = $2`,
      [elif, uploadId],
    )).rows;

  async function refresh(): Promise<void> {
    const id = await app.enqueue('suggestions.refresh', { student_id: elif, reason: 'test' });
    await waitFor(async () => {
      const [j] = await app.boss.findJobs<object>('suggestions.refresh', { id: id! });
      return j && ['completed', 'failed'].includes(j.state) ? j : null;
    }).then((j) => expect(j.state, JSON.stringify(j.output)).toBe('completed'));
  }

  beforeAll(async () => {
    process.env.OGRENMEN_SUGGESTIONS_COPY = 'template';
    tmp = await createTempDatabase();
    ({ elif } = await seedStudents(tmp.pool));
    const course = String(
      (await tmp.pool.query(`insert into public.courses (code, title, kind, curriculum_id, visibility) values ('TYT-MAT', 'TYT Matematik', 'exam_track', $1, 'shared') returning id`, [tmp.curriculumId])).rows[0]!.id,
    );
    enr = String(
      (await tmp.pool.query(
        `insert into public.enrollments (student_id, curriculum_id, course_id, period_label, target_exam) values ($1, $2, $3, 'YKS 2027', 'TYT') returning id`,
        [elif, tmp.curriculumId, course],
      )).rows[0]!.id,
    );
    const gateway = new Gateway({ transport: new FakeTransport(), ledger: new PgLedger(tmp.pool) });
    const config = loadConfig({ DATABASE_URL: tmp.url, PGBOSS_SCHEMA: 'pgboss', HEALTH_HOST: '127.0.0.1', HEALTH_PORT: '0', WORKER_SCHEDULES: 'off', PDF_CONCURRENCY: '1' }, ['--process=all']);
    app = createApp(config, { log: silentLogger, db: tmp.pool, gateway: async () => gateway, pdf: { render: async () => ({ pdf: Buffer.from('%PDF-1.4'), pages: 1, bytes: 8 }), close: async () => undefined } });
    await app.start();
    // enqueue_job SECURITY DEFINER sahibi (migration rolü) pgboss'a yazabilmeli (Supabase'de postgres; supabase/scripts/pgboss-check.mjs)
    await tmp.pool.query(`grant usage on schema pgboss to ${MIGRATION_ROLE}; grant select on pgboss.queue to ${MIGRATION_ROLE}; grant select, insert on pgboss.job to ${MIGRATION_ROLE}`);
  }, 120_000);

  afterAll(async () => {
    if (copyEnv === undefined) delete process.env.OGRENMEN_SUGGESTIONS_COPY;
    else process.env.OGRENMEN_SUGGESTIONS_COPY = copyEnv;
    await app?.stop().catch(() => undefined);
    await tmp?.drop();
  });

  it('Kendi çalışmam: öğrenci gönderir, gerçek iş kuyruğu teşhisi yazar; yenileme kartı ve alt satırını korur', async () => {
    const a = await upload();
    const b = await upload();
    const r = await submit([a, b], 'own_work');
    expect(r).toMatchObject({ enrollment_id: enr, kind: 'own_work', reused: false });
    expect(r.job_id).toMatch(/^[0-9a-f-]{36}$/);

    // gerçek pgboss.job satırı: upload.intake yükü
    const [job] = (await tmp.pool.query(`select name, data from pgboss.job where id = $1`, [r.job_id])).rows;
    expect(job).toMatchObject({ name: 'upload.intake', data: { upload_ids: [a, b], kind: 'own_work', student_id: elif, enrollment_id: enr } });

    // worker zinciri: upload.intake → diagnosis.run → apply_diagnosis
    const sa = await waitFor(async () => (await tmp.pool.query(`select id, verdict, analysis ->> 'one_line' as one_line, upload_ids from public.solution_analyses where upload_ids @> array[$1]::uuid[]`, [a])).rows[0]);
    expect(sa.upload_ids).toEqual([a, b]);
    await waitFor(async () => (await tmp.pool.query(`select bool_and(status = 'ready') as ok from public.uploads where id = any($1::uuid[])`, [[a, b]])).rows[0]!.ok);
    const before = await waitFor(async () => {
      const rows = await card(a);
      return rows.length === 1 && rows[0]!.payload.analysis_id === sa.id ? rows : null;
    });
    expect(before[0]).toMatchObject({ title: 'Yüklemenin sonucu hazır', subtitle: sa.one_line, payload: { copy_key: `analysis:${sa.id}` } });

    // öneri motoru (suggestions.refresh) aynı kartı yerinde günceller: satır, başlık ve tek cümle kalır
    await refresh();
    const after = await card(a);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before[0]!.id, title: 'Yüklemenin sonucu hazır', subtitle: sa.one_line, payload: { copy_key: `analysis:${sa.id}`, analysis_id: sa.id } });

    // yeniden gönderim (yanıt kayboldu): aynı iş, yenisi atılmaz; işlenmiş küme sonuca yönlenir
    const again = await submit([b, a], 'own_work');
    expect(again).toMatchObject({ reused: true, job_id: r.job_id });
    // alt küme ve başka sayfa eklenmiş küme: OGR-UPL-003, ikinci iş yok, yeni sayfa stored
    await expect(submit([b], 'own_work')).rejects.toThrow(/OGR-UPL-003/);
    // okul denemesi submit_upload'dan geçmez (0030): tek giriş yolu submit_exam_upload
    await expect(submit([a, b], 'school_exam')).rejects.toThrow(/OGR-UPL-001/);
    const c = await upload();
    await expect(submit([a, c], 'own_work')).rejects.toThrow(/OGR-UPL-003/);
    expect((await intakeJobsWith(b)).map((j) => j.id)).toEqual([r.job_id]);
    expect(await intakeJobsWith(c)).toEqual([]);
    expect((await tmp.pool.query('select status from public.uploads where id = $1', [c])).rows).toEqual([{ status: 'stored' }]);
    expect((await tmp.pool.query('select count(*)::int as n from public.solution_analyses where upload_ids && $1::uuid[]', [[a, b]])).rows[0]!.n).toBe(1);
  });

  it('Okul denemesi: submit_exam_upload → exam.analyse (gerçek kuyruk); kartı hattın vardığı durumu söyler, yenileme kartı korur', async () => {
    const d = await upload();
    const r = await asElif(async (q) => (await q('select public.submit_exam_upload($1::uuid[], $2::jsonb) as r', [[d], '{}'])).rows[0]!.r as Record<string, unknown>);
    expect(r).toMatchObject({ reused: false });
    // submit_exam_upload doğrudan exam.analyse işini kuyruğa atar (oturum, sayfalar)
    const job = await waitFor(async () => (await tmp.pool.query(`select data from pgboss.job where name = 'exam.analyse' and data -> 'upload_ids' ? $1`, [d])).rows[0]);
    const sessionId = String(job.data.session_id);
    // tek fotoğraf (Storage'sız sahte taşıma): hat ya biter ya da okuma hatasıyla düşer; ikisinde de oturum son durumda
    const s = await waitFor(async () => {
      const row = (await tmp.pool.query('select status, progress from public.exam_sessions where id = $1', [sessionId])).rows[0]!;
      return ['done', 'failed'].includes(String(row.status)) ? row : null;
    });
    const expected = s.status === 'done' ? 'Deneme sonucun hazır' : 'Fotoğrafı okuyamadım';
    const before = await waitFor(async () => {
      const rows = await card(d);
      return rows.length === 1 && rows[0]!.title === expected ? rows : null;
    });
    await refresh();
    const after = await card(d);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ title: expected, subtitle: before[0]!.subtitle });
  });
});
