/**
 * Müfredat kurucu uçtan uca (OGRENMEN_LIVE=1): geçici veritabanı (supabase/tests/00_local_stub.sql + tüm göçler +
 * seed'ler) + gerçek pg-boss (pgboss şeması; SQL enqueue_job oraya yazar) + sahte Anthropic taşıması.
 *   1. onboarding_enroll (0022) yeni ders → curriculum.draft işi kuyruğa SQL'den düşer → worker taslağı kurar:
 *      draft_status ready/100, kazanımlar + BKT varsayılanları, ön koşullar, etiketler, defter; sınav parkuru değil
 *      (otopilot kapalı) → ilk 'practice' önerisi YOK (eğitmenin yayınını bekler); gece öneri yenilemesi
 *      (suggestions.refresh sinyalleri) bu kayda kart üretmez, start_practice OGR-PRAC-008 ile reddeder.
 *   2. İkinci öğrenci aynı derse kaydolur, yeni taslak işi açılmaz.
 *   3. Aynı ders için aktif müfredat varsa taslak üretilmez, kayıt aktif müfredata taşınır.
 *   4. Düşen taslak: failed → curriculum_draft_retry → queued → ready.
 *   5. Gece incelemesi (TYT taslağı: otopilot açık, ilk öneri var): review → Batch → collect → güvenli kabul taslağa.
 *   6. Otopilot yayındaki sürümün ağacını asla değiştirmez: kabuller açık taslak sürüme gider.
 *   7. Yeni sürüm + birleştirme + yayın: ustalık ve soru bankası kazanım koduyla (birleşme eşlemesiyle) yeni sürüme
 *      taşınır; v1'deki onaylı soru v2'de start_practice ile seçilir.
 * Bağlanılan veritabanına dokunmaz; geçici veritabanı sonunda silinir ('ogrenmen' adı asla kullanılmaz).
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { CurriculumDraft } from '@ogrenmen/contracts';
import { FakeTransport, Gateway, PgLedger } from '@ogrenmen/llm';
import { createApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/log.js';
import { planSuggestions } from '../src/suggestions/rules.js';
import { collectSignals } from '../src/suggestions/signals.js';

const live = process.env.OGRENMEN_LIVE === '1';
const baseUrl = process.env.DATABASE_URL ?? process.env.OGRENMEN_DATABASE_URL ?? 'postgresql://ogrenmen:ogrenmen@127.0.0.1:5432/ogrenmen';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SUPA = join(ROOT, 'supabase');
const dbName = `ogr_worker_cur_${randomBytes(3).toString('hex')}`;
const FIXTURE = join(dirname(createRequire(import.meta.url).resolve('@ogrenmen/llm/package.json')), 'fixtures', 'curriculum_draft', '01-tyt-matematik.json');
const MIGRATION_ROLE = 'ogrenmen_owner';

function urlFor(name: string): string {
  const u = new URL(baseUrl);
  u.pathname = `/${name}`;
  return u.toString();
}

function psql(url: string, file: string, role?: string) {
  execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-d', url, '-f', file], {
    env: { ...process.env, PGOPTIONS: role ? `-c role=${role}` : '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('beklenen durum oluşmadı');
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe.skipIf(!live)('müfredat kurucu uçtan uca (geçici veritabanı + pg-boss + sahte LLM)', () => {
  let app: App;
  let db: pg.Pool;
  const transport = new FakeTransport();
  const admin = new pg.Pool({ connectionString: baseUrl, max: 1 });
  let students: string[] = [];
  let ELIF = '';

  async function jobState(name: string, id: string) {
    const [j] = await app.boss.findJobs<object>(name, { id });
    return j;
  }
  async function done(name: string, id: string) {
    return waitFor(async () => {
      const j = await jobState(name, id);
      return j && ['completed', 'failed'].includes(j.state) ? j : null;
    });
  }
  const one = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await db.query(sql, values)).rows[0] as T;

  const copyEnv = process.env.OGRENMEN_SUGGESTIONS_COPY;
  /**
   * LLM kapısı: açıkken işler geçide (ctx.gateway) ulaşamaz. onboarding_enroll aynı anda curriculum.draft ve
   * suggestions.refresh atar; sahte LLM'de taslak anında kurulur ve bayat sinyalle çalışan yenileme taslağın ilk kartını
   * silebilir (gerçek LLM'de taslak dakikalar sürer). Kartı denetleyen test, yenileme bitene dek taslağı bekletir.
   */
  let gate: Promise<void> = Promise.resolve();

  beforeAll(async () => {
    // suggestions.refresh kart metnini şablonla yazar (sahte taşımada LLM metni betiklenmez)
    process.env.OGRENMEN_SUGGESTIONS_COPY = 'template';
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.query(`create database ${dbName}`);
    const url = urlFor(dbName);
    psql(url, join(SUPA, 'tests', '00_local_stub.sql'));
    for (const f of readdirSync(join(SUPA, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) psql(url, join(SUPA, 'migrations', f), MIGRATION_ROLE);
    for (const f of readdirSync(join(SUPA, 'seed')).filter((x) => x.endsWith('.sql')).sort()) psql(url, join(SUPA, 'seed', f), MIGRATION_ROLE);
    db = new pg.Pool({ connectionString: url, max: 4 });
    const gateway = new Gateway({ transport, ledger: new PgLedger(db) });
    const config = loadConfig({ DATABASE_URL: url, PGBOSS_SCHEMA: 'pgboss', HEALTH_HOST: '127.0.0.1', HEALTH_PORT: '0', WORKER_SCHEDULES: 'off', PDF_CONCURRENCY: '1' }, ['--process=all']);
    app = createApp(config, { log: silentLogger, db, gateway: async () => { await gate; return gateway; }, pdf: { render: async () => ({ pdf: Buffer.from('%PDF-1.4'), pages: 1, bytes: 8 }), close: async () => undefined } });
    await app.start();
    // enqueue_job SECURITY DEFINER sahibi (migration rolü) pgboss'a yazabilmeli (Supabase'de postgres; supabase/scripts/pgboss-check.mjs)
    await db.query(`grant usage on schema pgboss to ${MIGRATION_ROLE}; grant select on pgboss.queue to ${MIGRATION_ROLE}; grant select, insert on pgboss.job to ${MIGRATION_ROLE}`);
    students = (await db.query(`select s.id from public.students s join public.profiles p on p.id = s.profile_id where p.role = 'student' order by p.display_name`)).rows.map((r) => r.id as string);
    ELIF = (await db.query(`select s.id from public.students s join public.profiles p on p.id = s.profile_id where p.display_name = 'Elif Kaya'`)).rows[0]?.id as string;
  }, 120_000);

  afterAll(async () => {
    if (copyEnv === undefined) delete process.env.OGRENMEN_SUGGESTIONS_COPY;
    else process.env.OGRENMEN_SUGGESTIONS_COPY = copyEnv;
    await app?.stop();
    await db?.end().catch(() => undefined);
    await admin.query(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
    await admin.end();
  });

  it('onboarding_enroll → SQL curriculum.draft işi → worker taslağı tek işlemde kurar', async () => {
    expect(ELIF).toBeTruthy();
    expect(students).toContain(ELIF);
    const r = await one<{ r: Record<string, unknown> }>(`select public.onboarding_enroll('Kimya Hazırlık', null, $1) as r`, [ELIF]);
    expect(r.r).toMatchObject({ matched: 'created', created: true, curriculum_status: 'draft', curriculum_origin: 'ai_draft' });
    const cur = r.r.curriculum_id as string;
    const jobId = r.r.draft_job_id as string;
    expect(jobId).toBeTruthy();
    const queued = await one<{ draft_status: string }>(`select draft_status from public.curricula where id = $1`, [cur]);
    expect(['queued', 'researching', 'drafting', 'saving', 'ready']).toContain(queued.draft_status);

    const job = await done('curriculum.draft', jobId);
    expect(job.state, JSON.stringify(job.output)).toBe('completed');
    // 'Kimya Hazırlık' sınav parkuru değil: otopilot kapalı → öğrenci onaylanmamış taslakta başlamaz
    expect(job.output).toMatchObject({ status: 'ready', skills: 21, leaves: 12, prerequisites: 4, suggestions: 0, autopilot: false });

    const c = await one(`select status, origin, draft_status, draft_progress, draft_error, draft_meta, source_refs from public.curricula where id = $1`, [cur]);
    expect(c).toMatchObject({ status: 'draft', origin: 'ai_draft', draft_status: 'ready', draft_progress: 100, draft_error: null });
    expect((c.draft_meta as Record<string, unknown>).prompt_versions).toEqual({ curriculum_research: 'v1', curriculum_draft: 'v1' });
    const k = await one(`select count(*)::int as n, count(*) filter (where is_leaf)::int as leaves,
                                count(*) filter (where parent_id is null)::int as roots,
                                count(*) filter (where kind = 'sub_outcome' and is_leaf and p_init = 0.250 and p_learn = 0.150)::int as bkt_sub,
                                count(*) filter (where kind = 'outcome' and p_init = 0.300)::int as bkt_out
                           from public.skills where curriculum_id = $1`, [cur]);
    expect(k).toEqual({ n: 21, leaves: 12, roots: 1, bkt_sub: 12, bkt_out: 6 });
    expect(await one(`select count(*)::int as n from public.skill_prerequisites where curriculum_id = $1 and source = 'ai_draft'`, [cur])).toEqual({ n: 4 });
    expect(await one(`select count(*)::int as n from public.misconception_tags where curriculum_id = $1`, [cur])).toEqual({ n: 3 });
    expect(await one(`select count(*)::int as n from public.suggestions where enrollment_id = $1 and kind = 'practice' and payload ->> 'reason' = 'curriculum_ready'`, [r.r.enrollment_id])).toEqual({ n: 0 });
    const calls = (await db.query(`select route, ref_table, ref_id, purpose, status from public.llm_calls where ref_id = $1 order by id`, [cur])).rows;
    expect(calls.map((x) => x.route)).toEqual(['curriculum_research', 'curriculum_draft']);
    expect(calls.every((x) => x.ref_table === 'curricula' && x.purpose === 'curriculum.draft' && x.status === 'ok')).toBe(true);

    // otopilot kapısı (PLAN §3.5): gece 03:30 suggestions.refresh onaylanmamış taslağın "ilk 2 yaprağına" kart önermez,
    // öğrenci alıştırmayı da açamaz (öneri motoru ve start_practice aynı kuralla)
    const enrKim = r.r.enrollment_id as string;
    const signals = await collectSignals(db, ELIF, new Date());
    expect(signals.enrollments.map((e) => e.enrollmentId)).not.toContain(enrKim);
    expect(planSuggestions(signals).filter((c) => c.enrollment_id === enrKim)).toEqual([]);
    await expect(db.query('select public.start_practice(null, $1)', [enrKim])).rejects.toThrow(/OGR-PRAC-008/);

    // ikinci öğrenci aynı derse (taslak müfredata) kaydolur, yeni taslak işi yok
    const r2 = await one<{ r: Record<string, unknown> }>(`select public.onboarding_enroll('kimya hazirlik', null, $1) as r`, [students.find((x) => x !== ELIF)]);
    expect(r2.r).toMatchObject({ matched: 'course', curriculum_id: cur, draft_job_id: null });

    // aynı iş tekrar gelirse (yeniden deneme) yeniden üretmez
    const again = await app.enqueue('curriculum.draft', { curriculum_id: cur, course_text: 'Kimya Hazırlık' });
    expect((await done('curriculum.draft', again!)).output).toMatchObject({ status: 'already_built', skills: 21 });
  });

  it('aynı ders için aktif müfredat varsa taslak üretilmez, kayıt ona taşınır', async () => {
    const active = await one<{ id: string }>(`insert into public.curricula (code, version, label, status, origin) values ('COGRAFYA', '1', 'Coğrafya', 'active', 'instructor') returning id`);
    await db.query(`insert into public.skills (curriculum_id, id, name, is_leaf) values ($1, 'cog', 'Coğrafya', true)`, [active.id]);
    const draft = await one<{ id: string }>(`insert into public.curricula (code, version, label, status, origin) values ('COGRAFYA-X', '1', 'Coğrafya', 'draft', 'ai_draft') returning id`);
    const course = await one<{ id: string }>(`insert into public.courses (code, title, curriculum_id, visibility) values ('COGRAFYA-X', 'Coğrafya', $1, 'shared') returning id`, [draft.id]);
    const enr = await one<{ id: string }>(`insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values ($1, $2, $3, '2026 Güz') returning id`, [ELIF, draft.id, course.id]);
    const before = transport.requests.length;
    const id = await app.enqueue('curriculum.draft', { curriculum_id: draft.id, course_text: 'Coğrafya' });
    const job = await done('curriculum.draft', id!);
    expect(job.output).toMatchObject({ status: 'skipped', superseded_by: active.id });
    expect(transport.requests.length).toBe(before);
    expect(await one(`select status, draft_status from public.curricula where id = $1`, [draft.id])).toEqual({ status: 'retired', draft_status: 'skipped' });
    expect(await one(`select curriculum_id from public.enrollments where id = $1`, [enr.id])).toEqual({ curriculum_id: active.id });
    expect(await one(`select curriculum_id from public.courses where id = $1`, [course.id])).toEqual({ curriculum_id: active.id });
  });

  it('düşen taslak: failed → curriculum_draft_retry → queued → ready', async () => {
    const bad = JSON.parse(readFileSync(FIXTURE, 'utf8')) as CurriculumDraft;
    bad.prerequisites.push({ skill_code: bad.prerequisites[0]!.prereq_code, prereq_code: bad.prerequisites[0]!.skill_code, strength: 0.5 });
    transport.enqueue('curriculum_draft', { json: bad }, { json: bad });
    const r = await one<{ r: Record<string, unknown> }>(`select public.onboarding_enroll('Biyoloji 101', null, $1) as r`, [ELIF]);
    const cur = r.r.curriculum_id as string;
    expect((await done('curriculum.draft', r.r.draft_job_id as string)).state).toBe('failed');
    const failed = await one<{ draft_status: string; skills: number }>(`select draft_status, (select count(*)::int from public.skills where curriculum_id = $1) as skills from public.curricula where id = $1`, [cur]);
    expect(failed).toEqual({ draft_status: 'failed', skills: 0 });
    const retry = await one<{ r: { draft_status: string; job_id: string } }>(`select public.curriculum_draft_retry($1) as r`, [cur]);
    expect(retry.r.draft_status).toBe('queued');
    expect(await one(`select draft_status, draft_error from public.curricula where id = $1`, [cur])).toMatchObject({ draft_error: null });
    const job = await done('curriculum.draft', retry.r.job_id);
    expect(job.state, JSON.stringify(job.output)).toBe('completed');
    expect(job.output).toMatchObject({ status: 'ready', skills: 21, suggestions: 0 });
    expect(await one(`select draft_status, draft_progress from public.curricula where id = $1`, [cur])).toEqual({ draft_status: 'ready', draft_progress: 100 });
    await expect(db.query(`select public.curriculum_draft_retry($1)`, [cur])).rejects.toThrow(/OGR-CURR-013/);
  });

  it('gece incelemesi: review → Batch → collect → otopilot kabulü (ai_draft + TYT) taslağa', async () => {
    let open: () => void = () => undefined;
    gate = new Promise<void>((res) => (open = res));
    const r = await one<{ r: Record<string, unknown> }>(`select public.onboarding_enroll('TYT Kimya', null, $1) as r`, [ELIF]);
    const cur = r.r.curriculum_id as string;
    // onboarding'in yenilemesi (taslaktan önceki sinyal) bitsin, sonra taslak kurulsun
    await waitFor(async () => {
      const jobs = await app.boss.findJobs<object>('suggestions.refresh', { data: { enrollment_id: r.r.enrollment_id } });
      return jobs.length > 0 && jobs.every((j) => ['completed', 'failed'].includes(j.state));
    }).finally(() => {
      open();
      gate = Promise.resolve();
    });
    // TYT: otopilot açık → öğrenci taslakta başlar (ilk practice önerisi)
    expect((await done('curriculum.draft', r.r.draft_job_id as string)).output).toMatchObject({ status: 'ready', autopilot: true, suggestions: 1 });
    const s = await one(`select kind, title, subtitle, rank, payload from public.suggestions where enrollment_id = $1 and consumed_at is null and kind = 'practice'`, [r.r.enrollment_id]);
    expect(s).toMatchObject({ kind: 'practice', title: 'Sayılar ve işlemler', subtitle: '8 soru · 12 dk', rank: 0 });
    expect((s.payload as { skill_ids: string[] }).skill_ids).toEqual(['tyt.mat.sayilar.rasyonel.dort-islem', 'tyt.mat.sayilar.rasyonel.siralama', 'tyt.mat.sayilar.uslu.kurallar']);
    expect(await one(`select (public.curriculum_autopilot_state($1) ->> 'effective')::boolean as on`, [cur])).toEqual({ on: true });
    // otopilot etkin taslak öneri motorunun sinyaline girer
    expect((await collectSignals(db, ELIF, new Date())).enrollments.map((e) => e.enrollmentId)).toContain(r.r.enrollment_id);
    const parent = 'tyt.mat.sayilar.rasyonel';
    const p1 = await one<{ id: string }>(`insert into public.curriculum_proposals (curriculum_id, kind, payload) values ($1, 'add_subskill', $2) returning id`, [cur, { parent_id: parent, name: 'Ondalık gösterim' }]);
    const p2 = await one<{ id: string }>(`insert into public.curriculum_proposals (curriculum_id, kind, payload) values ($1, 'rename', $2) returning id`, [cur, { skill_id: parent, name: 'Rasyonel sayılar ve işlemler' }]);
    const p3 = await one<{ id: string }>(`insert into public.curriculum_proposals (curriculum_id, kind, payload) values ($1, 'merge', $2) returning id`,
      [cur, { keep_id: 'tyt.mat.sayilar.koklu.sadelestirme', drop_id: 'tyt.mat.sayilar.koklu.eslenik' }]);
    transport.enqueue('proposal_review', {
      json: {
        decisions: [
          { proposal_id: p1.id, action: 'accept', confidence: 0.94, rationale: 'Ağaçta karşılığı yok.' },
          { proposal_id: p2.id, action: 'accept', confidence: 0.6, rationale: 'Ad değişikliği makul, kanıt az.' },
          { proposal_id: p3.id, action: 'accept', confidence: 0.92, rationale: 'İki yaprak aynı beceriyi ölçüyor.' },
        ],
      },
    });
    const id = await app.enqueue('curriculum.proposals.review', { curriculum_id: cur });
    const rev = await done('curriculum.proposals.review', id!);
    expect(rev.output).toMatchObject({ curricula: 1, proposals: 3 });
    const col = await waitFor(async () => {
      const jobs = await app.boss.findJobs<object>('curriculum.proposals.collect', { data: { batch_id: (rev.output as { batch_id: string }).batch_id } });
      return jobs.find((j) => j.state === 'completed') ?? null;
    });
    expect(col.output).toMatchObject({ reviewed: 3, accepted: 2 });
    const rows = (await db.query(`select id, status, payload from public.curriculum_proposals where curriculum_id = $1 order by created_at`, [cur])).rows;
    expect(rows.map((x) => x.status)).toEqual(['accepted', 'open', 'accepted']);
    expect(rows[1].payload.review).toMatchObject({ action: 'accept', confidence: 0.6, autopilot: true });
    expect(await one(`select count(*)::int as n from public.skills where curriculum_id = $1 and parent_id = $2 and name = 'Ondalık gösterim'`, [cur, parent])).toEqual({ n: 1 });
    // birleştirme kabulü curriculum.merge işini SQL'den atar; taslakta kanıt yok → yerinde birleşir
    const merge = await waitFor(async () => {
      const jobs = await app.boss.findJobs<object>('curriculum.merge', { data: { proposal_id: p3.id } });
      return jobs.find((j) => j.state === 'completed') ?? null;
    });
    expect(merge.output).toMatchObject({ curriculum_id: cur, in_place: true, published: false });
    expect(await one(`select count(*)::int as n from public.skills where curriculum_id = $1 and id = 'tyt.mat.sayilar.koklu.eslenik'`, [cur])).toEqual({ n: 0 });
    expect(await one(`select status from public.curricula where id = $1`, [cur])).toEqual({ status: 'draft' });
  });

  it('otopilot yayındaki sürümün ağacını değiştirmez: kabuller açık taslak sürüme gider', async () => {
    const r = await one<{ r: Record<string, unknown> }>(`select public.onboarding_enroll('TYT Biyoloji', null, $1) as r`, [ELIF]);
    const cur = r.r.curriculum_id as string;
    await done('curriculum.draft', r.r.draft_job_id as string);
    await db.query('select public.curriculum_publish($1)', [cur]);
    const tree = async (id: string) => (await db.query(`select id, parent_id, name, is_leaf from public.skills where curriculum_id = $1 order by id`, [id])).rows;
    const before = await tree(cur);
    const parent = 'tyt.mat.sayilar.uslu.kurallar';
    const p1 = await one<{ id: string }>(`insert into public.curriculum_proposals (curriculum_id, kind, payload) values ($1, 'add_subskill', $2) returning id`, [cur, { parent_id: parent, name: 'Negatif üs' }]);
    const p2 = await one<{ id: string }>(`insert into public.curriculum_proposals (curriculum_id, kind, payload) values ($1, 'rename', $2) returning id`, [cur, { skill_id: parent, name: 'Üslü ifadeler' }]);
    transport.enqueue('proposal_review', {
      json: {
        decisions: [
          { proposal_id: p1.id, action: 'accept', confidence: 0.95, rationale: 'Ağaçta karşılığı yok.' },
          { proposal_id: p2.id, action: 'accept', confidence: 0.93, rationale: 'Resmi adlandırmaya yakın.' },
        ],
      },
    });
    const id = await app.enqueue('curriculum.proposals.review', { curriculum_id: cur });
    const rev = await done('curriculum.proposals.review', id!);
    const col = await waitFor(async () => {
      const jobs = await app.boss.findJobs<object>('curriculum.proposals.collect', { data: { batch_id: (rev.output as { batch_id: string }).batch_id } });
      return jobs.find((j) => j.state === 'completed') ?? null;
    });
    expect(col.output).toMatchObject({ reviewed: 2, accepted: 2, to_new_version: 2 });
    // yayındaki ağaç aynen kaldı; değişiklikler tek açık taslak sürümde
    expect(await tree(cur)).toEqual(before);
    expect(await one(`select status from public.curricula where id = $1`, [cur])).toEqual({ status: 'active' });
    const child = await one<{ id: string; status: string }>(`select id, status from public.curricula where previous_id = $1`, [cur]);
    expect(child.status).toBe('draft');
    expect(await one(`select count(*)::int as n from public.curricula where previous_id = $1`, [cur])).toEqual({ n: 1 });
    expect(await one(`select name, is_leaf from public.skills where curriculum_id = $1 and id = $2`, [child.id, parent])).toEqual({ name: 'Üslü ifadeler', is_leaf: false });
    expect(await one(`select kind, p_init::float as p_init, p_learn::float as p_learn from public.skills where curriculum_id = $1 and parent_id = $2 and name = 'Negatif üs'`, [child.id, parent]))
      .toEqual({ kind: 'sub_outcome', p_init: 0.25, p_learn: 0.15 });
    const props = (await db.query(`select status, curriculum_id, payload from public.curriculum_proposals where id = any($1::uuid[]) order by created_at`, [[p1.id, p2.id]])).rows;
    expect(props.map((x) => [x.status, x.curriculum_id, x.payload.origin_curriculum_id, x.payload.result?.curriculum_id])).toEqual([
      ['accepted', child.id, cur, child.id],
      ['accepted', child.id, cur, child.id],
    ]);
  });

  it('yeni sürüm + birleştirme + yayın: ustalık kazanım koduyla yeni sürüme taşınır', async () => {
    const r = await one<{ r: Record<string, unknown> }>(`select public.onboarding_enroll('Fizik Temel', null, $1) as r`, [ELIF]);
    const v1 = r.r.curriculum_id as string;
    const enr = r.r.enrollment_id as string;
    expect((await done('curriculum.draft', r.r.draft_job_id as string)).output).toMatchObject({ suggestions: 0 });
    // otopilot kapalı (sınav parkuru değil): ilk öneri eğitmenin yayınıyla gelir
    expect(await one(`select public.curriculum_publish($1) ->> 'status' as s, (public.curriculum_editor_state($1) ->> 'enrollments')::int as e`, [v1])).toEqual({ s: 'active', e: 1 });
    expect(await one(`select count(*)::int as n from public.suggestions where enrollment_id = $1 and kind = 'practice' and payload ->> 'reason' = 'curriculum_ready'`, [enr])).toEqual({ n: 1 });
    const keep = 'tyt.mat.problemler.oran.dogru-ters';
    const drop = 'tyt.mat.problemler.oran.bolusturme';
    const other = 'tyt.mat.sayilar.uslu.kurallar';
    await db.query(`insert into public.mastery (enrollment_id, skill_id, p, evidence_count) values ($1, $2, 0.8, 6), ($1, $3, 0.4, 2), ($1, $4, 0.55, 3)`, [enr, keep, drop, other]);
    // v1'de onaylı soru (birleştirilecek kazanımda) + şablon: v2 yayınında kodu çevrilerek taşınır
    const q = await one<{ id: string }>(
      `insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, content_hash, status)
       values ($1, array[$2], 'mcq', 'Bir sayı 2 ile 3 oranında bölünür…', '[{"key":"A","text":"1"},{"key":"B","text":"2"}]', 'instructor', $3, 'approved') returning id`,
      [v1, drop, `cur-live-${dbName}`],
    );
    await db.query(`insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by) values ($1, 'B', 'Çözüm.', 'not_applicable', 'seed')`, [q.id]);
    await db.query(`insert into public.question_templates (id, curriculum_id, skill_id, module_path, engine, params_schema) values ($1, $2, $3, 'x.py:generate', 'python', '{}')`, [`tpl-${dbName}`, v1, drop]);
    const v2 = (await one<{ id: string }>(`select public.curriculum_new_version($1) as id`, [v1])).id;
    expect(await one(`select version, status, previous_id from public.curricula where id = $1`, [v2])).toEqual({ version: '2', status: 'draft', previous_id: v1 });
    await db.query(`select public.curriculum_edit($1, 'merge', $2)`, [v2, { keep_id: keep, drop_id: drop }]);
    await db.query(`select public.curriculum_edit($1, 'rename', $2)`, [v2, { skill_id: other, name: 'Üs kuralları ve işlemler' }]);
    const pub = await one<{ r: Record<string, unknown> }>(`select public.curriculum_publish($1) as r`, [v2]);
    expect(pub.r).toMatchObject({ status: 'active', retired: [v1], carried_enrollments: 1 });
    expect(await one(`select curriculum_id from public.enrollments where id = $1`, [enr])).toEqual({ curriculum_id: v2 });
    const m = (await db.query(`select skill_id, curriculum_id, p::float as p from public.mastery where enrollment_id = $1 order by skill_id`, [enr])).rows;
    expect(m).toEqual([
      { skill_id: keep, curriculum_id: v2, p: 0.8 },
      { skill_id: other, curriculum_id: v2, p: 0.55 },
    ]);
    expect(await one(`select status from public.curricula where id = $1`, [v1])).toEqual({ status: 'retired' });
    // soru bankası ve şablon yeni sürümde (birleşme eşlemesiyle); start_practice v1'in onaylı sorusunu seçer
    expect(await one(`select curriculum_id, skill_ids from public.questions where id = $1`, [q.id])).toEqual({ curriculum_id: v2, skill_ids: [keep] });
    expect(await one(`select curriculum_id, skill_id from public.question_templates where id = $1`, [`tpl-${dbName}`])).toEqual({ curriculum_id: v2, skill_id: keep });
    const set = await one<{ r: { status: string; items?: { question_id: string }[] } }>(`select public.start_practice(null, $1, array[$2]) as r`, [enr, keep]);
    expect(set.r.status).toBe('in_progress');
    expect(JSON.stringify(set.r)).toContain(q.id);
    // yayındaki sürüm düzenlenmez
    await expect(db.query(`select public.curriculum_edit($1, 'rename', $2)`, [v2, { skill_id: other, name: 'Yeni ad' }])).rejects.toThrow(/OGR-CURR-020/);
  });
});
