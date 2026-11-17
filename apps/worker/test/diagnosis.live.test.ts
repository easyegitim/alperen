/**
 * Yükle → Teşhis işleyicileri gerçek Postgres'te (OGRENMEN_LIVE=1): geçici veritabanı (stub + göçler + seed + TYT
 * müfredatı); işleyiciler doğrudan çağrılır (submit_upload → gerçek pgboss.job zinciri: upload.live.test.ts).
 *   öğrenci JWT'siyle uploads satırı (RLS: yol <profil>/<uuid>.jpg) → upload.intake → diagnosis.run (sahte Opus yanıtı)
 *   → apply_diagnosis → solution_analyses + observations + mastery → Bugün kartı; öğrenci kendi teşhisini okur.
 *   Okul denemesi: exams(deneme, uploaded) + oturum + kart. Doğrulama: bilinmeyen kazanım/etiket RPC'yi düşürmez.
 *   Alt kazanım önerisi: eğitmen müfredatında açık öneri → decide_proposal kabul eder (yayındaki ağaç değişmez: yaprak
 *   açık taslak sürüme eklenir); otopilotu etkin (ai_draft + TYT) taslak müfredatta hemen kabul ve gözlem yeni yaprağa. apply_diagnosis düşerse son denemede yüklemeler 'failed' + kart; saklanan model
 *   çıktısıyla yeniden deneme Opus'u çağırmaz. Betiksiz sahte taşıma (packages/llm/fixtures) TYT kodlarıyla teşhis verir.
 * Bağlanılan veritabanına dokunmaz; geçici veritabanı sonunda silinir.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SolutionDiagnosis } from '@ogrenmen/contracts';
import { FakeTransport } from '@ogrenmen/llm';
import { createTempDatabase, seedStudents, type TempDatabase } from '@ogrenmen/llm/testing';
import { getJob } from '../src/jobs/registry.js';
import { jobCtx } from './support.js';

const live = process.env.OGRENMEN_LIVE === '1';
const ELIF_PROFILE = '00000000-0000-4000-8000-0000000000e1';
const CAN_PROFILE = '00000000-0000-4000-8000-0000000000e2';
const fixture = (): SolutionDiagnosis => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'diagnosis', '01-dagilma-isaret.json'), 'utf8')) as SolutionDiagnosis;

describe.skipIf(!live)('Yükle → Teşhis (gerçek Postgres)', () => {
  let tmp: TempDatabase;
  let elif: string;
  let enr: string;

  /** Öğrenci oturumu (authenticated + JWT talepleri) içinde çalıştırır; işlem geri alınmaz (commit). */
  async function asUser<T>(profile: string, fn: (q: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>, commit = true): Promise<T> {
    const c = await tmp.pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: profile, role: 'authenticated' })]);
      await c.query('set local role authenticated');
      const out = await fn((text, values) => c.query(text, values));
      await c.query(commit ? 'commit' : 'rollback');
      return out;
    } catch (err) {
      await c.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  /** Web'in yaptığı gibi: öğrenci kendi klasörüne uploads satırı yazar. */
  async function studentUpload(kind: 'photo' | 'pdf' = 'photo'): Promise<string> {
    const id = randomUUID();
    const ext = kind === 'pdf' ? 'pdf' : 'jpg';
    await asUser(ELIF_PROFILE, (q) =>
      q(
        `insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime, bytes, width, height)
         values ($1, $2, $3, $4, $5, $6, 120000, 2000, 1500)`,
        [id, ELIF_PROFILE, elif, kind, `${ELIF_PROFILE}/${id}.${ext}`, kind === 'pdf' ? 'application/pdf' : 'image/jpeg'],
      ),
    );
    return id;
  }

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    await tmp?.drop();
  });

  it('RLS: öğrenci yalnız kendi klasörüne (<profil>/…) yükleme satırı yazar', async () => {
    const id = randomUUID();
    await expect(
      asUser(ELIF_PROFILE, (q) =>
        q(`insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime) values ($1, $2, $3, 'photo', $4, 'image/jpeg')`, [
          id,
          ELIF_PROFILE,
          elif,
          `${CAN_PROFILE}/${id}.jpg`,
        ]),
      ),
    ).rejects.toThrow();
    expect(await studentUpload()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('Kendi çalışmam: intake → diagnosis.run → apply_diagnosis → gözlem, ustalık, kart; öğrenci teşhisini okur', async () => {
    const up1 = await studentUpload();
    const up2 = await studentUpload('pdf');
    const intakeCtx = jobCtx({ db: tmp.pool, now: () => new Date() });
    const intake = await getJob('upload.intake')!.handler!({ upload_ids: [up1, up2], kind: 'own_work', student_id: elif, enrollment_id: enr }, intakeCtx);
    expect(intake).toMatchObject({ enqueued: ['diagnosis.run'] });
    const next = intakeCtx.enqueued[0]!;
    expect(next).toMatchObject({ name: 'diagnosis.run', data: { upload_ids: [up1, up2], enrollment_id: enr } });

    const transport = new FakeTransport().enqueue('solution_diagnosis', { json: fixture() });
    const ctx = jobCtx({ db: tmp.pool, transport, now: () => new Date() });
    const res = (await getJob('diagnosis.run')!.handler!(next.data, ctx)) as { analysisId: string; verdict: string; issues: string[] };
    expect(res).toMatchObject({ verdict: 'wrong', issues: [] });

    // istek: ders bloğu ve dossier system'de (3 blok), PDF document bloğu
    const body = transport.requests[0]!.body;
    expect(Array.isArray(body.system) ? body.system.length : 0).toBe(3);
    const blocks = body.messages.find((m) => m.role === 'user')!.content as { type: string }[];
    expect(blocks.map((b) => b.type)).toEqual(['image', 'document', 'text']);

    const sa = (await tmp.pool.query('select * from public.solution_analyses where id = $1', [res.analysisId])).rows[0]!;
    expect(sa).toMatchObject({ verdict: 'wrong', failing_step_no: 3, error_cause: 'procedure', enrollment_id: enr });
    expect(sa.upload_ids).toEqual([up1, up2]);
    expect(sa.skill_ids).toEqual(['tyt.mat.cebir.denklem', 'tyt.mat.temel.sayilar']);
    expect(sa.misconception_tags).toEqual(['sayilar.parantez-eksi-dagitma']);
    expect(sa.analysis).toMatchObject({ one_line: 'Çözümünü inceledim: 3. adımda işlem kuralı.' });
    expect(sa.embedding).toBeNull();

    const obs = (await tmp.pool.query(`select skill_id, kind, value::float as value, weight::float as weight, error_cause, misconception_tag, source_type from public.observations where source_id = $1 order by skill_id`, [res.analysisId])).rows;
    expect(obs).toEqual([
      { skill_id: 'tyt.mat.cebir.denklem', kind: 'practice', value: 0, weight: 1, error_cause: 'procedure', misconception_tag: null, source_type: 'solution_analysis' },
      { skill_id: 'tyt.mat.temel.sayilar', kind: 'practice', value: 0, weight: 1, error_cause: 'procedure', misconception_tag: 'sayilar.parantez-eksi-dagitma', source_type: 'solution_analysis' },
    ]);
    const mastery = (await tmp.pool.query('select skill_id, evidence_count from public.mastery where enrollment_id = $1 order by skill_id', [enr])).rows;
    expect(mastery.map((m) => [m.skill_id, m.evidence_count])).toEqual([['tyt.mat.cebir.denklem', 1], ['tyt.mat.temel.sayilar', 1]]);

    const ups = (await tmp.pool.query('select id, status, anthropic_file_id from public.uploads where id = any($1::uuid[]) order by anthropic_file_id', [[up1, up2]])).rows;
    expect(ups.every((u) => u.status === 'ready' && String(u.anthropic_file_id).startsWith('fake-file-'))).toBe(true);

    const card = (await tmp.pool.query(`select id, title, subtitle, payload, rank from public.suggestions where student_id = $1 and kind = 'upload_result' and consumed_at is null`, [elif])).rows;
    expect(card).toHaveLength(1);
    expect(card[0]).toMatchObject({ title: 'Yüklemenin sonucu hazır', subtitle: 'Çözümünü inceledim: 3. adımda işlem kuralı.', payload: { upload_id: up1, analysis_id: res.analysisId, copy_key: `analysis:${res.analysisId}` } });
    // teşhisten sonra suggestions.refresh (diagnosis.followup → activity.completed) kartı ve tek cümleyi korur
    await getJob('suggestions.refresh')!.handler!({ student_id: elif, reason: 'diagnosis' }, jobCtx({ db: tmp.pool, now: () => new Date() }));
    const kept = (await tmp.pool.query(`select id, title, subtitle from public.suggestions where student_id = $1 and kind = 'upload_result' and consumed_at is null`, [elif])).rows;
    expect(kept).toEqual([{ id: card[0]!.id, title: 'Yüklemenin sonucu hazır', subtitle: 'Çözümünü inceledim: 3. adımda işlem kuralı.' }]);

    // web yoklaması: öğrenci kendi teşhisini yükleme kimliğiyle okur ve Bugün'de kartı görür
    const seen = await asUser(ELIF_PROFILE, async (q) => ({
      sa: (await q(`select id, verdict, analysis ->> 'one_line' as one_line from public.solution_analyses where upload_ids @> array[$1]::uuid[]`, [up1])).rows,
      today: (await q('select kind, title from public.list_today_suggestions()')).rows,
      up: (await q('select status from public.uploads where id = $1', [up1])).rows,
    }), false);
    expect(seen.sa).toEqual([{ id: res.analysisId, verdict: 'wrong', one_line: 'Çözümünü inceledim: 3. adımda işlem kuralı.' }]);
    expect(seen.today).toContainEqual({ kind: 'upload_result', title: 'Yüklemenin sonucu hazır' });
    expect(seen.up).toEqual([{ status: 'ready' }]);
    // başka öğrenci göremez
    const other = await asUser(CAN_PROFILE, (q) => q('select id from public.solution_analyses where id = $1', [res.analysisId]), false);
    expect(other.rows).toEqual([]);

    // yeniden deneme: yeni teşhis yazılmaz
    const again = await getJob('diagnosis.run')!.handler!(next.data, jobCtx({ db: tmp.pool, transport: new FakeTransport() }));
    expect(again).toMatchObject({ analysisId: res.analysisId, reused: true });
    expect((await tmp.pool.query('select count(*)::int as n from public.solution_analyses where enrollment_id = $1', [enr])).rows[0]!.n).toBe(1);
  });

  it('doğrulama: bilinmeyen kazanım ve etiket RPC\'yi düşürmez; dikkatsizlik yarım ağırlık', async () => {
    const up = await studentUpload();
    const transport = new FakeTransport().enqueue('solution_diagnosis', {
      json: { ...fixture(), error_cause: 'careless', skill_ids: ['tyt.mat.temel', 'tyt.mat.uydurma.kod', 'tyt.mat.temel.sayilar'], misconception_tags: ['uydurma.etiket'] },
    });
    const res = (await getJob('diagnosis.run')!.handler!({ upload_ids: [up], enrollment_id: enr }, jobCtx({ db: tmp.pool, transport }))) as { analysisId: string; issues: string[] };
    expect(res.issues).toHaveLength(3);
    const sa = (await tmp.pool.query('select skill_ids, misconception_tags, analysis from public.solution_analyses where id = $1', [res.analysisId])).rows[0]!;
    expect(sa.skill_ids).toEqual(['tyt.mat.temel.sayilar']);
    expect(sa.misconception_tags).toEqual([]);
    expect(sa.analysis.validation.dropped).toEqual({ skill_ids: ['tyt.mat.temel', 'tyt.mat.uydurma.kod'], misconception_tags: ['uydurma.etiket'], proposed_subskill: false });
    const w = (await tmp.pool.query('select weight::float as w from public.observations where source_id = $1', [res.analysisId])).rows;
    expect(w).toEqual([{ w: 0.5 }]);
  });

  it('bilinmeyen yaprak, var olan üst düğüm: curriculum_proposals açılır (parent_id), decide_proposal kabul eder', async () => {
    const up = await studentUpload();
    const transport = new FakeTransport().enqueue('solution_diagnosis', {
      json: { ...fixture(), skill_ids: ['tyt.mat.cebir.denklem-sistemi'], misconception_tags: [] },
    });
    const res = (await getJob('diagnosis.run')!.handler!({ upload_ids: [up], enrollment_id: enr }, jobCtx({ db: tmp.pool, transport }))) as { analysisId: string };
    const prop = (await tmp.pool.query(
      `select cp.id, cp.status, cp.payload from public.curriculum_proposals cp join public.solution_analyses sa on sa.proposal_id = cp.id where sa.id = $1`,
      [res.analysisId],
    )).rows[0]!;
    expect(prop).toMatchObject({ status: 'open', payload: { parent_id: 'tyt.mat.cebir', name: 'Önerilen alt kazanım: Cebir', id: 'tyt.mat.cebir.denklem-sistemi' } });
    const decided = (await tmp.pool.query('select public.decide_proposal($1, true, $2) as r', [prop.id, 'test'])).rows[0]!.r as Record<string, unknown>;
    expect(decided).toMatchObject({ status: 'accepted', applied: true, skill_id: 'tyt.mat.cebir.denklem-sistemi', new_version: true });
    // yayındaki müfredatın ağacı değişmez: yaprak açık taslak sürümde (0025 decide_proposal)
    expect(decided.curriculum_id).not.toBe(tmp.curriculumId);
    const sk = (await tmp.pool.query('select parent_id, name, is_leaf from public.skills where curriculum_id = $1 and id = $2', [decided.curriculum_id, 'tyt.mat.cebir.denklem-sistemi'])).rows[0];
    expect(sk).toEqual({ parent_id: 'tyt.mat.cebir', name: 'Önerilen alt kazanım: Cebir', is_leaf: true });
    expect((await tmp.pool.query('select count(*)::int as n from public.skills where curriculum_id = $1 and id = $2', [tmp.curriculumId, 'tyt.mat.cebir.denklem-sistemi'])).rows[0]).toEqual({ n: 0 });
  });

  it('otopilot (ai_draft + TYT taslak) müfredat: öneri hemen kabul, yeni yaprak ve gözlem yazılır', async () => {
    const cur = String((await tmp.pool.query(
      `insert into public.curricula (code, version, label, status, origin) values ('AI-OTO-TYT', '1', 'TYT Otopilot deneme', 'draft', 'ai_draft') returning id`,
    )).rows[0]!.id);
    await tmp.pool.query(
      `insert into public.skills (curriculum_id, id, parent_id, name, kind, is_leaf, order_no) values
         ($1, 'oto.mat', null, 'Kök', 'unit', false, 1), ($1, 'oto.mat.a', 'oto.mat', 'Toplama', 'outcome', true, 2)`,
      [cur],
    );
    const course = String((await tmp.pool.query(`insert into public.courses (code, title, kind, curriculum_id, visibility) values ('AI-OTO-TYT', 'TYT Otopilot', 'exam_track', $1, 'shared') returning id`, [cur])).rows[0]!.id);
    const oto = String((await tmp.pool.query(
      `insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values ($1, $2, $3, 'YKS 2027') returning id`,
      [elif, cur, course],
    )).rows[0]!.id);
    const up = await studentUpload();
    const transport = new FakeTransport().enqueue('solution_diagnosis', { json: { ...fixture(), skill_ids: ['oto.mat.carpma'], misconception_tags: [] } });
    const res = (await getJob('diagnosis.run')!.handler!({ upload_ids: [up], enrollment_id: oto }, jobCtx({ db: tmp.pool, transport }))) as { analysisId: string; verdict: string };
    expect(res.verdict).toBe('wrong');
    const sa = (await tmp.pool.query(
      `select sa.skill_ids, cp.status from public.solution_analyses sa join public.curriculum_proposals cp on cp.id = sa.proposal_id where sa.id = $1`,
      [res.analysisId],
    )).rows[0]!;
    expect(sa).toEqual({ skill_ids: ['oto.mat.carpma'], status: 'accepted' });
    expect((await tmp.pool.query('select is_leaf, parent_id from public.skills where curriculum_id = $1 and id = $2', [cur, 'oto.mat.carpma'])).rows).toEqual([{ is_leaf: true, parent_id: 'oto.mat' }]);
    const obs = (await tmp.pool.query('select skill_id, value::float as value from public.observations where source_id = $1', [res.analysisId])).rows;
    expect(obs).toEqual([{ skill_id: 'oto.mat.carpma', value: 0 }]);
    const ups = (await tmp.pool.query('select status from public.uploads where id = $1', [up])).rows;
    expect(ups).toEqual([{ status: 'ready' }]);
  });

  it('apply_diagnosis düşerse: son denemede yüklemeler failed + kart; saklanan çıktıyla yeniden deneme Opus\'u çağırmaz', async () => {
    const up = await studentUpload();
    const failing = { query: (text: string, values?: unknown[]) => (/apply_diagnosis/.test(text) ? Promise.reject(new Error('apply düştü')) : tmp.pool.query(text, values)) };
    const transport = new FakeTransport().enqueue('solution_diagnosis', { json: fixture() });
    const job = (retryCount: number) => ({ id: 'job-x', name: 'diagnosis.run', retryCount });
    // ilk deneme: geçici hata, kart yok, yükleme processing
    await expect(getJob('diagnosis.run')!.handler!({ upload_ids: [up], enrollment_id: enr }, jobCtx({ db: failing, transport, job: job(0) }))).rejects.toThrow('apply düştü');
    expect((await tmp.pool.query('select status from public.uploads where id = $1', [up])).rows).toEqual([{ status: 'processing' }]);
    expect((await tmp.pool.query(`select count(*)::int as n from audit.events where action = 'diagnosis.raw' and row_id = $1`, [up])).rows[0]!.n).toBe(1);
    // son deneme: saklanan çıktı (Opus çağrılmaz), yükleme failed + "işleyemedim" kartı
    const t2 = new FakeTransport();
    await expect(getJob('diagnosis.run')!.handler!({ upload_ids: [up], enrollment_id: enr }, jobCtx({ db: failing, transport: t2, job: job(3) }))).rejects.toMatchObject({ code: 'OGR-JOB-145' });
    expect(t2.requests).toHaveLength(0);
    expect((await tmp.pool.query('select status from public.uploads where id = $1', [up])).rows).toEqual([{ status: 'failed' }]);
    const card = (await tmp.pool.query(`select title, payload from public.suggestions where kind = 'upload_result' and payload ->> 'upload_id' = $1 and consumed_at is null`, [up])).rows;
    expect(card).toHaveLength(1);
    expect(card[0]).toMatchObject({ title: 'Yüklemeni şu an işleyemedim', payload: { failed: true, failure: 'processing', copy_key: `upload:${up}` } });
    // kalıcı neden audit'te; öneri motoru kartı silmez, aynı nedenle yeniden kurar
    expect((await tmp.pool.query(`select diff ->> 'failure' as f from audit.events where action = 'diagnosis.failed' and row_id = $1`, [up])).rows).toEqual([{ f: 'processing' }]);
    await getJob('suggestions.refresh')!.handler!({ student_id: elif, reason: 'test' }, jobCtx({ db: tmp.pool, now: () => new Date() }));
    const kept = (await tmp.pool.query(`select title, payload from public.suggestions where kind = 'upload_result' and payload ->> 'upload_id' = $1 and consumed_at is null`, [up])).rows;
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ title: 'Yüklemeni şu an işleyemedim', payload: { failed: true, failure: 'processing' } });
    // yeniden gönderim (veritabanı düzeldi): saklanan çıktıyla teşhis yazılır, Opus yine çağrılmaz
    const t3 = new FakeTransport();
    const ok = (await getJob('diagnosis.run')!.handler!({ upload_ids: [up], enrollment_id: enr }, jobCtx({ db: tmp.pool, transport: t3 }))) as { rawReused: boolean; verdict: string };
    expect(ok).toMatchObject({ rawReused: true, verdict: 'wrong' });
    expect(t3.requests).toHaveLength(0);
  });

  it('betiksiz sahte taşıma (packages/llm/fixtures/solution_diagnosis) TYT kodlarıyla teşhis verir', async () => {
    const up = await studentUpload();
    const res = (await getJob('diagnosis.run')!.handler!({ upload_ids: [up], enrollment_id: enr }, jobCtx({ db: tmp.pool, transport: new FakeTransport() }))) as { analysisId: string; verdict: string; issues: string[] };
    expect(res).toMatchObject({ verdict: 'wrong', issues: [] });
    const n = (await tmp.pool.query('select count(*)::int as n from public.observations where source_id = $1', [res.analysisId])).rows[0]!.n;
    expect(n).toBe(2);
  });

  it('Okul denemesi (eski yol): exams(deneme, uploaded, telifli, processing) + oturum (grading) + exam.analyse + "inceliyorum" kartı; öğrenci kendi denemesini görür', async () => {
    const up = await studentUpload();
    const ctx = jobCtx({ db: tmp.pool, now: () => new Date() });
    const res = (await getJob('upload.intake')!.handler!({ upload_ids: [up], kind: 'school_exam', student_id: elif, enrollment_id: enr }, ctx)) as { examId: string; sessionId: string };
    const ex = (await tmp.pool.query('select kind, source, status, created_by, is_copyrighted from public.exams where id = $1', [res.examId])).rows[0]!;
    expect(ex).toEqual({ kind: 'deneme', source: 'uploaded', status: 'processing', created_by: ELIF_PROFILE, is_copyrighted: true });
    const sess = (await tmp.pool.query(`select mode, status, enrollment_id, upload_ids, progress ->> 'stage' as stage from public.exam_sessions where id = $1`, [res.sessionId])).rows[0]!;
    expect(sess).toEqual({ mode: 'uploaded', status: 'grading', enrollment_id: enr, upload_ids: [up], stage: 'classify' });
    expect(ctx.enqueued).toEqual([expect.objectContaining({ name: 'exam.analyse', data: expect.objectContaining({ session_id: res.sessionId, exam_id: res.examId, upload_ids: [up] }) })]);
    expect((await tmp.pool.query('select status from public.uploads where id = $1', [up])).rows[0]!.status).toBe('processing');
    const link = (await tmp.pool.query(`select diff from audit.events where action = 'exam.upload_intake' and row_id = $1`, [up])).rows[0]!;
    expect(link.diff).toMatchObject({ exam_id: res.examId, upload_ids: [up] });
    const seen = await asUser(ELIF_PROFILE, async (q) => ({
      exam: (await q('select id from public.exams where id = $1', [res.examId])).rows,
      card: (await q(`select title, subtitle from public.list_today_suggestions() where kind = 'upload_result' and payload ->> 'upload_id' = $1`, [up])).rows,
    }), false);
    expect(seen.exam).toHaveLength(1);
    expect(seen.card).toEqual([{ title: 'Denemeni inceliyorum', subtitle: 'Sayfaları aldım; sonuç birkaç dakika içinde burada olacak.' }]);
    // öneri motoru süren denemenin kartını oturumdan yeniden kurar (silmez)
    await getJob('suggestions.refresh')!.handler!({ student_id: elif, reason: 'test' }, jobCtx({ db: tmp.pool, now: () => new Date() }));
    const kept = (await tmp.pool.query(`select title, payload from public.suggestions where kind = 'upload_result' and payload ->> 'upload_id' = $1 and consumed_at is null`, [up])).rows;
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ title: 'Denemeni inceliyorum', payload: { pending: true, session_id: res.sessionId, exam_id: res.examId } });
    // yeniden deneme yeni sınav açmaz
    const again = await getJob('upload.intake')!.handler!({ upload_ids: [up], kind: 'school_exam', student_id: elif, enrollment_id: enr }, jobCtx({ db: tmp.pool }));
    expect(again).toMatchObject({ examId: res.examId, reused: true });
  });
});
