/**
 * Alıştırma soru bankası gerçek Postgres'te (OGRENMEN_LIVE=1): geçici veritabanı (@ogrenmen/llm/testing: göçler + seed +
 * TYT müfredatı) + TYT teşhis anahtarları (seed-keys.py), işleyiciler doğrudan çağrılır, LLM sahte, Storage bellekte.
 *   1. Yeni öğrenci (teşhis atanmadı): start_practice teşhis sorularıyla hemen dolar (0027), practice.generate gerekmez.
 *   2. Şablon yolu: teşhis atanmış (oturum açık) → bankası boş şablonlu yaprak → needs_generation → practice.generate
 *      (python3 -I, SymPy) → set in_progress, sorular approved + anahtar verified; şekilli şablonun PNG'si figures
 *      kovasına, figures satırı verified; öğrenci görünümünde anahtar yok. Süre < 10 sn.
 *   3. Fake LLM yolu: şablonsuz, sorusuz yaprak → practice.generate → 8 LLM sorusu, anahtarları SymPy ile denetlenir
 *      (py/key_verify.py; fikstür anahtarları tutar → verification.sympy verified), set dolar, llm_calls defteri. Süre < 5 sn.
 *   4. Kalıcı hata: LLM yok + son deneme → set abandoned, generation_failed.
 *   5. practice.prewarm: yaprak başına 8 kullanılabilir soru; ikinci çalıştırma üretmez (ready).
 * Bağlanılan veritabanına dokunmaz; geçici veritabanı sonunda silinir.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgLedger, FakeTransport, Gateway } from '@ogrenmen/llm';
import { createTempDatabase, REPO_ROOT, seedStudents, type TempDatabase } from '@ogrenmen/llm/testing';
import { getJob } from '../src/jobs/registry.js';
import type { StorageLike } from '../src/storage.js';
import { jobCtx } from './support.js';

const live = process.env.OGRENMEN_LIVE === '1';
const ELIF_PROFILE = '00000000-0000-4000-8000-0000000000e1';

class MemoryStorage implements StorageLike {
  readonly objects = new Map<string, Buffer>();
  async upload(bucket: string, path: string, body: Uint8Array | Buffer) {
    this.objects.set(`${bucket}/${path}`, Buffer.from(body));
  }
  async download(bucket: string, path: string) {
    const b = this.objects.get(`${bucket}/${path}`);
    if (!b) throw new Error('yok');
    return b;
  }
  async createSignedUrl(bucket: string, path: string) {
    return `mem://${bucket}/${path}`;
  }
}

describe.skipIf(!live)('alıştırma soru bankası (gerçek Postgres + şablon + sahte LLM)', () => {
  let tmp: TempDatabase;
  let elif: string;
  let enr: string;
  const storage = new MemoryStorage();
  const q = (text: string, values?: unknown[]) => tmp.pool.query(text, values);

  beforeAll(async () => {
    tmp = await createTempDatabase();
    execFileSync('python3', [join(REPO_ROOT, 'content/tyt-matematik/scripts/seed-keys.py'), '--schema', 'v2', '--database-url', tmp.url], {
      stdio: 'pipe',
      env: { ...process.env, PGOPTIONS: '-c role=ogrenmen_owner' },
    });
    ({ elif } = await seedStudents(tmp.pool));
    const course = String((await q(`insert into public.courses (code, title, kind, curriculum_id, visibility) values ('TYT-MAT', 'TYT Matematik', 'exam_track', $1, 'shared') returning id`, [tmp.curriculumId])).rows[0]!.id);
    enr = String((await q(`insert into public.enrollments (student_id, curriculum_id, course_id, period_label, target_exam) values ($1, $2, $3, 'YKS 2027', 'TYT') returning id`, [elif, tmp.curriculumId, course])).rows[0]!.id);
  }, 120_000);

  afterAll(async () => {
    await tmp?.drop();
  });

  async function start(skills: string[], count: number) {
    return (await q('select public.start_practice(null, $1::uuid, $2::text[], $3) as s', [enr, skills, count])).rows[0]!.s as {
      set_id: string;
      status: string;
      total: number;
      items: { question_id: string; figure: { png_path: string } | null }[];
    };
  }
  async function generateJob(setId: string) {
    const row = (await q(`select data from pgboss.job where name = 'practice.generate' and data ->> 'set_id' = $1`, [setId]).catch(() => ({ rows: [] }))).rows[0];
    const audit = (await q(`select e.diff -> 'data' as data from audit.events e where e.diff ->> 'name' = 'practice.generate' and e.diff -> 'data' ->> 'set_id' = $1`, [setId])).rows[0];
    return (row?.data ?? audit?.data) as Record<string, unknown>;
  }

  it('yeni öğrenci: atanmamış teşhisin soruları ilk Başla\'da banka (üretim gerekmez)', async () => {
    const s = await start(['tyt.mat.temel.sayilar', 'tyt.mat.temel.bolunebilme'], 8);
    expect(s.status).toBe('in_progress');
    expect(s.total).toBe(3);
    await q('select public.finish_practice($1::uuid)', [s.set_id]);
  });

  it('şablon yolu: atanmış teşhis + boş banka → practice.generate şablonla doldurur (< 10 sn)', async () => {
    await q(`insert into public.exam_sessions (exam_id, enrollment_id, mode) select x.id, $1, 'in_app' from public.exams x where x.kind = 'diagnostic'`, [enr]);
    const s = await start(['tyt.mat.temel.sayilar', 'tyt.mat.temel.rasyonel-sayilar'], 6);
    expect(s).toMatchObject({ status: 'needs_generation', total: 0 });
    const payload = await generateJob(s.set_id);
    expect(payload).toMatchObject({ set_id: s.set_id, enrollment_id: enr, count: 6, template_ids: ['islem-onceligi', 'kesir-modeli-toplama'] });
    const ctx = jobCtx({ db: tmp.pool, storage: () => storage, now: () => new Date() });
    const t0 = Date.now();
    const res = await getJob('practice.generate')!.handler!(payload, ctx);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(res).toMatchObject({ set_id: s.set_id, status: 'in_progress', template_items: 6 });
    expect(ctx.transport.requests).toHaveLength(0);
    const rows = (await q(
      `select q.source, q.status, q.template_id, q.figure_id is not null as fig, k.sympy_status, k.written_by, f.review_status, f.png_path
         from public.practice_set_items i join public.questions q on q.id = i.question_id join secure.answer_keys k on k.question_id = q.id
         left join public.figures f on f.id = q.figure_id where i.set_id = $1 order by i.no`,
      [s.set_id],
    )).rows;
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r).toMatchObject({ source: 'template', status: 'approved', sympy_status: 'verified', written_by: 'worker:practice.generate' });
    const figs = rows.filter((r) => r.fig);
    expect(figs.length).toBeGreaterThan(0);
    for (const f of figs) {
      expect(f.review_status).toBe('verified');
      expect(storage.objects.has(String(f.png_path))).toBe(true);
    }
    // öğrenci görünümü: in_progress, şekil yolu var, anahtar yok
    const c = await tmp.pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ELIF_PROFILE, role: 'authenticated' })]);
      await c.query('set local role authenticated');
      const view = (await c.query('select public.get_practice_set($1::uuid) as s', [s.set_id])).rows[0]!.s as Record<string, unknown>;
      expect(view).toMatchObject({ status: 'in_progress', total: 6 });
      expect(JSON.stringify(view)).not.toMatch(/correct_option|misconception_tag|canonical_expr/);
    } finally {
      await c.query('rollback');
      c.release();
    }
    await q('select public.finish_practice($1::uuid)', [s.set_id]);
  });

  it('fake LLM yolu: şablonsuz boş yaprak → 8 soru (anahtar SymPy ile doğrulanır), set dolar (< 5 sn)', async () => {
    const s = await start(['tyt.mat.problem.yas'], 8);
    expect(s.status).toBe('needs_generation');
    const transport = new FakeTransport();
    const ctx = jobCtx({ db: tmp.pool, storage: () => storage, transport, gateway: async () => new Gateway({ transport, ledger: new PgLedger(tmp.pool) }), now: () => new Date() });
    const t0 = Date.now();
    const res = await getJob('practice.generate')!.handler!(await generateJob(s.set_id), ctx);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(res).toMatchObject({ status: 'in_progress', llm_items: 8 });
    const rows = (await q(
      `select q.source, q.status, q.skill_ids, q.verification ->> 'sympy' as sympy, k.sympy_status, k.sympy_report ->> 'status' as rep
         from public.practice_set_items i join public.questions q on q.id = i.question_id join secure.answer_keys k on k.question_id = q.id where i.set_id = $1`,
      [s.set_id],
    )).rows;
    expect(rows).toHaveLength(8);
    for (const r of rows) expect(r).toMatchObject({ source: 'llm', status: 'approved', skill_ids: ['tyt.mat.problem.yas'], sympy: 'verified', sympy_status: 'verified', rep: 'verified' });
    expect((await q(`select count(*)::int as n from public.llm_calls where route = 'question_generation' and purpose = 'practice.generate'`)).rows[0]!.n).toBe(1);
    await q('select public.finish_practice($1::uuid)', [s.set_id]);
  });

  it('kalıcı hata: soru üretilemezse son denemede set generation_failed ile kapanır', async () => {
    const s = await start(['tyt.mat.problem.isci'], 4);
    expect(s.status).toBe('needs_generation');
    const ctx = jobCtx({
      db: tmp.pool,
      storage: () => storage,
      gateway: async () => {
        throw new Error('ANTHROPIC_API_KEY yok');
      },
      job: { id: 'j-last', name: 'practice.generate', retryCount: 2 },
    });
    await expect(getJob('practice.generate')!.handler!(await generateJob(s.set_id), ctx)).rejects.toThrow(/soru üretilemedi/);
    const set = (await q('select status, summary ->> \'reason\' as reason from public.practice_sets where id = $1', [s.set_id])).rows[0];
    expect(set).toEqual({ status: 'abandoned', reason: 'generation_failed' });
    expect(((await q('select public.get_practice_set($1::uuid) as s', [s.set_id])).rows[0]!.s as { generation_failed: boolean }).generation_failed).toBe(true);
  });

  it('practice.prewarm: yaprak başına 8 kullanılabilir soru; ikinci çalıştırma üretmez', async () => {
    const enr2 = String((await q(`insert into public.enrollments (student_id, curriculum_id, period_label) select s.id, $1, 'YKS 2027' from public.students s where s.id <> $2 limit 1 returning id`, [tmp.curriculumId, elif])).rows[0]!.id);
    const skills = ['tyt.mat.temel.uslu', 'tyt.mat.problem.hareket'];
    const ctx = jobCtx({ db: tmp.pool, storage: () => storage, now: () => new Date() });
    const res = await getJob('practice.prewarm')!.handler!({ enrollment_id: enr2, skill_ids: skills, reason: 'test' }, ctx);
    expect(res).toMatchObject({ status: 'warmed' });
    const bank = (await q('select public.practice_bank_status($1::uuid, $2::text[]) as s', [enr2, skills])).rows[0]!.s as { leaves: { skill_id: string; available: number }[] };
    for (const l of bank.leaves) expect(l.available).toBeGreaterThanOrEqual(8);
    const again = await getJob('practice.prewarm')!.handler!({ enrollment_id: enr2, skill_ids: skills }, jobCtx({ db: tmp.pool, storage: () => storage }));
    expect(again).toMatchObject({ status: 'ready', inserted: 0 });
  });
});
