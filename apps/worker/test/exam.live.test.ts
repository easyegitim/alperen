/**
 * Deneme analiz hattı uçtan uca (OGRENMEN_LIVE=1): geçici veritabanı (stub + göçler + seed + TYT müfredatı) + gerçek
 * pg-boss (createApp) + sahte Anthropic taşıması (betiksiz: packages/llm/fixtures; sentetik deneme
 * fixtures/exams/synthetic) + bellek içi Storage (sayfa PNG'leri, kırpımlar, rapor PDF'i) + gerçek doc-render PDF.
 *
 *   öğrenci JWT'si → 3 sayfa uploads (RLS) → public.submit_exam_upload → pgboss 'exam.analyse' → worker:
 *   alım (sharp) → page_class → exam_page_items (5. soru iki sayfada) → şekil kırpımı → kazanımlar → çıkarılmış anahtar
 *   → optik form (7 çift işaret) → grade_exam_session (gözlemler, ustalık) → exam_report → PDF → Storage →
 *   register_generated_document → done ≤ 60 sn; Bugün kartı, veli bildirimi; öğrenci exam_session_view'da anahtar görmez.
 *   Ardından "Nereye kadar geldim?" (exam_how_far, metin) → diagnosis.run (deneme bağlamı) → teşhis; uygulama içi aynı
 *   deneme → finish_exam_session → exam.report → rapor. Okunamayan sayfalar: oturum failed + "Fotoğrafı okuyamadım".
 */
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeBrowser } from '@ogrenmen/doc-render';
import { FakeTransport, Gateway, PgLedger, type RequestBody, type TransportContext } from '@ogrenmen/llm';
import { createTempDatabase, seedStudents, type TempDatabase } from '@ogrenmen/llm/testing';
import { createApp, type App } from '../src/app.js';
import { enqueueExamDiagnoses, publisherMatch } from '../src/exam/db.js';
import { KEYS_BATCH_POLL } from '../src/jobs/exam-analyse.js';
import { loadConfig } from '../src/config.js';
import { getJob } from '../src/jobs/registry.js';
import { silentLogger } from '../src/log.js';
import type { StorageLike } from '../src/storage.js';
import { jobCtx } from './support.js';

const live = process.env.OGRENMEN_LIVE === '1';
const ELIF_PROFILE = '00000000-0000-4000-8000-0000000000e1';
const PARENT_PROFILE = '00000000-0000-4000-8000-0000000000b1';
const MIGRATION_ROLE = 'ogrenmen_owner';
const SYN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'exams', 'synthetic');
const EXAM = JSON.parse(readFileSync(join(SYN, 'exam.json'), 'utf8')) as { title: string; questions: { no: number; skill_id: string }[] };

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

describe.skipIf(!live)('Deneme analizi: submit_exam_upload → exam.analyse → rapor PDF (gerçek pg-boss, sahte LLM)', () => {
  let tmp: TempDatabase;
  let app: App;
  let elif = '';
  let enr = '';
  const storage = new MemoryStorage();
  const copyEnv = process.env.OGRENMEN_SUGGESTIONS_COPY;
  let sessionId = '';
  let examId = '';
  let pageIds: string[] = [];

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
  const asElif = <T>(fn: (q: Q) => Promise<T>) => as(ELIF_PROFILE, fn);

  /** Web'in yaptığı gibi: Storage nesnesi + öğrencinin kendi klasöründe uploads satırı. */
  async function page(file: string): Promise<string> {
    const id = randomUUID();
    const path = `${ELIF_PROFILE}/${id}.png`;
    await storage.upload('uploads', path, readFileSync(join(SYN, file)), 'image/png');
    await asElif((q) =>
      q(`insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime, bytes, width, height) values ($1, $2, $3, 'photo', $4, 'image/png', 130000, 1240, 1754)`, [
        id,
        ELIF_PROFILE,
        elif,
        path,
      ]),
    );
    return id;
  }

  beforeAll(async () => {
    process.env.OGRENMEN_SUGGESTIONS_COPY = 'template';
    tmp = await createTempDatabase();
    ({ elif } = await seedStudents(tmp.pool));
    const course = String(
      (await tmp.pool.query(`insert into public.courses (code, title, kind, curriculum_id, visibility) values ('TYT-MAT', 'TYT Matematik', 'exam_track', $1, 'shared') returning id`, [tmp.curriculumId])).rows[0]!.id,
    );
    enr = String(
      (await tmp.pool.query(`insert into public.enrollments (student_id, curriculum_id, course_id, period_label, target_exam) values ($1, $2, $3, 'YKS 2027', 'TYT') returning id`, [elif, tmp.curriculumId, course])).rows[0]!.id,
    );
    const gateway = new Gateway({ transport: new FakeTransport(), ledger: new PgLedger(tmp.pool) });
    const config = loadConfig({ DATABASE_URL: tmp.url, PGBOSS_SCHEMA: 'pgboss', HEALTH_HOST: '127.0.0.1', HEALTH_PORT: '0', WORKER_SCHEDULES: 'off', PDF_CONCURRENCY: '1' }, ['--process=all']);
    app = createApp(config, { log: silentLogger, db: tmp.pool, gateway: async () => gateway, storage, pdf: { render: async () => ({ pdf: Buffer.from('%PDF-1.4'), pages: 1, bytes: 8 }), close: async () => undefined } });
    await app.start();
    await tmp.pool.query(`grant usage on schema pgboss to ${MIGRATION_ROLE}; grant select on pgboss.queue to ${MIGRATION_ROLE}; grant select, insert on pgboss.job to ${MIGRATION_ROLE}`);
  }, 120_000);

  afterAll(async () => {
    if (copyEnv === undefined) delete process.env.OGRENMEN_SUGGESTIONS_COPY;
    else process.env.OGRENMEN_SUGGESTIONS_COPY = copyEnv;
    await app?.stop().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
    await tmp?.drop();
  });

  it('yükle → done ≤ 60 sn: sorular, anahtar, net 5,5, gözlemler, rapor PDF Storage\'da, kart ve veli bildirimi', async () => {
    pageIds = [await page('booklet-p1.png'), await page('booklet-p2.png'), await page('answer-sheet.png')];
    const t0 = Date.now();
    const r = await asElif(async (q) => (await q('select public.submit_exam_upload($1::uuid[], $2::jsonb) as r', [pageIds, JSON.stringify({ title: EXAM.title, duration_min: 20 })])).rows[0]!.r as Record<string, string>);
    expect(r).toMatchObject({ enrollment_id: enr, reused: false });
    sessionId = String(r.session_id);
    examId = String(r.exam_id);
    const [job] = (await tmp.pool.query('select name, data from pgboss.job where id = $1', [r.job_id])).rows;
    expect(job).toMatchObject({ name: 'exam.analyse', data: { session_id: sessionId, exam_id: examId, upload_ids: pageIds } });

    const done = await waitFor(async () => {
      const s = (await tmp.pool.query('select status, progress, score from public.exam_sessions where id = $1', [sessionId])).rows[0]!;
      if (s.status === 'failed') throw new Error(`oturum failed: ${JSON.stringify(s.progress)}`);
      // diagnoses_queued hattın son yazımıdır (kart ve veli bildiriminden sonra)
      return s.status === 'done' && 'diagnoses_queued' in s.progress ? s : null;
    });
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(done.score).toMatchObject({ total: 10, correct: 6, wrong: 2, blank: 2, unfinished: 0, net: 5.5 });
    expect(done.progress).toMatchObject({
      stage: 'done',
      pages_total: 3,
      pages_done: 3,
      booklet_pages: 2,
      answer_sheet_pages: 1,
      scratch_pages: 0,
      questions: 10,
      // sözcüksel eşleme yalnız yüksek güvenle: 2 (denklem = mutlak değer) ve 10 (zayıf) kazanımsız
      skills_tagged: 8,
      key_source: 'inferred',
      keyed: 10,
      key_unverified: 0,
      answers_double: 1,
      report_status: 'rendered',
      net: 5.5,
      card_line: 'Örnek Deneme 1 · TYT Matematik: 5,5 net. Takıldığın yer: Oran–orantı.',
    });
    expect(String(done.progress.warnings)).toContain('answer_double');
    expect(String(done.progress.warnings)).toContain('skill_untagged');
    // iç alanlar öğrencinin okuduğu progress'te yok (maliyet ve yayıncı eşleşmesi stash'te)
    expect(done.progress).not.toHaveProperty('cost_usd');
    expect(done.progress).not.toHaveProperty('key_publisher_exam');
    const meta = (await tmp.pool.query(`select diff -> 'data' as d from audit.events where action = 'exam.stash' and row_id = $1 and diff ->> 'key' = 'run_meta' order by created_at desc, id desc limit 1`, [sessionId])).rows[0]!.d;
    expect(meta).toMatchObject({ cost_usd: expect.any(Number), warnings: expect.arrayContaining(['answer_double', 'skill_untagged']) });

    // sorular: birleşen 5. soru, kazanımlar, şekil kırpımı (uploads photo + Storage PNG), kitapçık sayfası
    const qs = (await tmp.pool.query('select no, stem_text, skill_ids, figure_upload_id, page_upload_id, options from public.exam_questions where exam_id = $1 order by no', [examId])).rows;
    expect(qs.map((q) => q.skill_ids[0] ?? null)).toEqual(EXAM.questions.map((q) => ([2, 10].includes(q.no) ? null : q.skill_id)));
    expect(qs[4]!.stem_text).toMatch(/katılırsa kız öğrencilerin sayısının/);
    expect((qs[4]!.options as unknown[]).length).toBe(5);
    expect(qs.map((q) => q.page_upload_id)).toEqual([...Array(5).fill(pageIds[0]), ...Array(5).fill(pageIds[1])]);
    const fig = (await tmp.pool.query('select kind, storage_path, mime, owner_id from public.uploads where id = $1', [qs[2]!.figure_upload_id])).rows[0]!;
    expect(fig).toMatchObject({ kind: 'photo', mime: 'image/png', owner_id: ELIF_PROFILE });
    expect(storage.objects.get(`uploads/${fig.storage_path}`)?.body.subarray(1, 4).toString()).toBe('PNG');
    expect(qs.filter((q) => q.figure_upload_id).map((q) => q.no)).toEqual([3]);

    // anahtar (çıkarım, güvenle), exams.answer_key_source, sayfalar ready
    const keys = (await tmp.pool.query(`select string_agg(k.correct_option, '' order by q.no) as k, bool_and(k.source = 'inferred') as inf from secure.exam_answer_keys k join public.exam_questions q on q.id = k.exam_question_id where q.exam_id = $1`, [examId])).rows[0]!;
    expect(keys).toEqual({ k: 'CABDEBADCE', inf: true });
    expect((await tmp.pool.query('select status, answer_key_source, is_copyrighted from public.exams where id = $1', [examId])).rows[0]).toEqual({ status: 'ready', answer_key_source: 'inferred', is_copyrighted: true });
    expect((await tmp.pool.query(`select bool_and(status = 'ready') as ok from public.uploads where id = any($1::uuid[])`, [pageIds])).rows[0]!.ok).toBe(true);

    // gözlemler (kind test, kazanımlı 8 soru; 2'si boş/çift işaret, yarım ağırlık) ve ustalık
    const obs = (await tmp.pool.query(`select count(*)::int as n, count(*) filter (where weight = 0.5)::int as half from public.observations where enrollment_id = $1 and kind = 'test' and source_type = 'exam_response'`, [enr])).rows[0]!;
    // kazanımsız sorulara (2, 10) gözlem yazılmaz
    expect(obs).toEqual({ n: 8, half: 2 });
    expect((await tmp.pool.query(`select count(*)::int as n from public.mastery where enrollment_id = $1 and evidence_count > 0`, [enr])).rows[0]!.n).toBe(8);

    // rapor: generated_documents (rendered) + PDF Storage'da
    const doc = (await tmp.pool.query(`select gd.id, gd.kind, gd.status, gd.pdf_path, gd.content ->> 'title' as title, gd.content -> 'keys' as keys from public.generated_documents gd join public.exam_sessions es on es.report_document_id = gd.id where es.id = $1`, [sessionId])).rows[0]!;
    expect(doc).toMatchObject({ kind: 'report', status: 'rendered', pdf_path: `reports/${elif}/${sessionId}.pdf`, title: 'Örnek Deneme 1 analizi', keys: [] });
    const pdf = storage.objects.get(`documents/${doc.pdf_path}`)!;
    expect(pdf.type).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.body.length).toBeGreaterThan(10_000);

    // Bugün kartı (session:<id>) ve veli bildirimi
    const card = (await tmp.pool.query(`select title, subtitle, payload from public.suggestions where student_id = $1 and kind = 'upload_result' and consumed_at is null`, [elif])).rows;
    expect(card).toHaveLength(1);
    expect(card[0]).toMatchObject({ title: 'Deneme sonucun hazır', subtitle: done.progress.card_line, payload: { copy_key: `session:${sessionId}`, session_id: sessionId, upload_id: pageIds[0], net: 5.5 } });
    const note = (await tmp.pool.query(`select kind, body, payload from public.notifications where recipient_id = $1 and kind = 'exam_analysed'`, [PARENT_PROFILE])).rows;
    // veliye üçüncü kişiyle ("Takıldığın yer" değil)
    // tek kart: 0042 tetikleyicisinin genel metni hattın cümlesiyle güncellenir; eski exam_result türü yazılmaz
    expect(note).toEqual([{ kind: 'exam_analysed', body: 'Örnek Deneme 1 · TYT Matematik: 5,5 net. En çok zorlandığı konu: Oran–orantı.', payload: expect.objectContaining({ session_id: sessionId, report_document_id: doc.id, url: `/veli/rapor/${doc.id}`, dedupe_key: `session:${sessionId}` }) }]);
    expect((await tmp.pool.query(`select count(*)::int as n from public.notifications where kind = 'exam_result'`)).rows[0]!.n).toBe(0);

    // llm_calls: sahte çağrılar deftere yazıldı (3 sınıflama + 2 OCR + 1 anahtar + 1 optik + 1 rapor)
    const calls = (await tmp.pool.query(`select route, count(*)::int as n from public.llm_calls where ref_id = $1 group by route order by route`, [sessionId])).rows;
    expect(calls).toEqual([
      { route: 'answer_sheet', n: 1 },
      { route: 'exam_page_items', n: 2 },
      { route: 'exam_report', n: 1 },
      { route: 'inferred_keys', n: 1 },
      { route: 'page_class', n: 3 },
    ]);
  });

  it('öğrenci sonucu görür (anahtar yok); öneri motoru kartı korur; yeniden gönderim ve yeniden çalıştırma yeni iş yapmaz', async () => {
    const view = await asElif(async (q) => (await q('select public.exam_session_view($1) as v', [sessionId])).rows[0]!.v as Record<string, unknown>);
    expect(view).toMatchObject({ status: 'done', pending: false, summary: { net: 5.5, one_line: 'Net 5,5; en çok zorlandığın konu: Oran–orantı, doğru/ters orantı.' } });
    expect((view.items as unknown[]).map((i) => (i as { no: number }).no)).toEqual([4, 5, 7, 9]);
    expect(JSON.stringify(view)).not.toMatch(/correct_option|numeric_value|CABDEBADCE/);
    expect((view.items as { stem_text: unknown; page_upload_id: unknown }[]).every((i) => i.stem_text === null && i.page_upload_id)).toBe(true);
    // öneri motoru aynı kartı yerinde günceller
    await getJob('suggestions.refresh')!.handler!({ student_id: elif, reason: 'test' }, jobCtx({ db: tmp.pool, now: () => new Date() }));
    const card = (await tmp.pool.query(`select title, subtitle from public.suggestions where student_id = $1 and kind = 'upload_result' and consumed_at is null`, [elif])).rows;
    expect(card).toEqual([{ title: 'Deneme sonucun hazır', subtitle: 'Örnek Deneme 1 · TYT Matematik: 5,5 net. Takıldığın yer: Oran–orantı.' }]);
    const again = await asElif(async (q) => (await q('select public.submit_exam_upload($1::uuid[]) as r', [[...pageIds].reverse()])).rows[0]!.r as Record<string, unknown>);
    expect(again).toMatchObject({ session_id: sessionId, reused: true });
    const rerun = await getJob('exam.analyse')!.handler!({ session_id: sessionId, exam_id: examId, upload_ids: pageIds }, jobCtx({ db: tmp.pool, storage: () => storage }));
    expect(rerun).toMatchObject({ status: 'done', skipped: 'finished' });
  });

  it('"Nereye kadar geldim?" (metin) → diagnosis.run deneme bağlamı → teşhis sonuç ekranında', async () => {
    const r4 = (await tmp.pool.query(`select r.id from public.exam_responses r join public.exam_questions q on q.id = r.exam_question_id where r.session_id = $1 and q.no = 4`, [sessionId])).rows[0]!.id as string;
    const res = await asElif(async (q) => (await q('select public.exam_how_far($1, $2) as r', [r4, '2 üssü 5 32, 3 üssü 3 dokuz dedim'])).rows[0]!.r as Record<string, string>);
    const [job] = (await tmp.pool.query('select name, data from pgboss.job where id = $1', [res.job_id])).rows;
    expect(job).toMatchObject({ name: 'diagnosis.run', data: { context: 'exam', exam_response_id: r4, upload_ids: [], question_no: 4 } });
    const sa = await waitFor(async () => (await tmp.pool.query(`select id, verdict, error_cause, skill_ids, analysis -> 'context' as ctx from public.solution_analyses where exam_response_id = $1`, [r4])).rows[0]);
    expect(sa).toMatchObject({ verdict: 'wrong', error_cause: 'careless', skill_ids: ['tyt.mat.temel.uslu'], ctx: { kind: 'exam', question_no: 4 } });
    // telifli deneme: modelin soru transkripsiyonu öğrencinin okuduğu tabloya yazılmaz (audit 'diagnosis.raw'da kalır)
    expect((await tmp.pool.query('select question_text from public.solution_analyses where id = $1', [sa.id])).rows[0]!.question_text).toBeNull();
    expect(await asElif(async (q) => (await q('select question_text from public.solution_analyses where exam_response_id = $1', [r4])).rows)).toEqual([{ question_text: null }]);
    const raw = (await tmp.pool.query(`select diff -> 'data' ->> 'question_text' as t from audit.events where action = 'diagnosis.raw' and row_id = $1`, [r4])).rows[0]!;
    expect(String(raw.t)).not.toBe('');
    const view = await asElif(async (q) => (await q('select public.exam_session_view($1) as v', [sessionId])).rows[0]!.v as { items: { no: number; state: string; diagnosis: { error_cause: string } | null }[]; summary: { top_cause: string } });
    expect(view.items.find((i) => i.no === 4)).toMatchObject({ state: 'diagnosed', diagnosis: { error_cause: 'careless' } });
    expect(view.summary.top_cause).toBe('careless');
    // deneme bağlamı: teşhis ağırlığı 0, Bugün'e ikinci kart yazılmaz
    expect((await tmp.pool.query(`select coalesce(max(weight), 0)::float as w from public.observations where source_type = 'solution_analysis' and source_id = $1`, [sa.id])).rows[0]!.w).toBe(0);
    expect((await tmp.pool.query(`select count(*)::int as n from public.suggestions where student_id = $1 and kind = 'upload_result' and consumed_at is null`, [elif])).rows[0]!.n).toBe(1);
  });

  it('karalama sayfası: yanlış/boşlar için deneme bağlamlı teşhis dağıtımı (kitapçık sayfası + karalama, önce yanlışlar)', async () => {
    const scratch = await page('booklet-p2.png');
    expect(await enqueueExamDiagnoses(tmp.pool, sessionId, [scratch], 1)).toBe(1);
    const r9 = (await tmp.pool.query(`select r.id, r.work_upload_ids from public.exam_responses r join public.exam_questions q on q.id = r.exam_question_id where r.session_id = $1 and q.no = 9`, [sessionId])).rows[0]!;
    expect(r9.work_upload_ids).toEqual([pageIds[1], scratch]);
    const [job] = (await tmp.pool.query(`select data from pgboss.job where name = 'diagnosis.run' and data ->> 'exam_response_id' = $1`, [r9.id])).rows;
    expect(job!.data).toMatchObject({ context: 'exam', question_no: 9, upload_ids: [pageIds[1], scratch], session_id: sessionId });
    const sa = await waitFor(async () => (await tmp.pool.query(`select verdict, error_cause, skill_ids from public.solution_analyses where exam_response_id = $1`, [r9.id])).rows[0]);
    expect(sa).toEqual({ verdict: 'wrong', error_cause: 'procedure', skill_ids: ['tyt.mat.temel.ondalik'] });
    await waitFor(async () => (await tmp.pool.query(`select status = 'ready' as ok from public.uploads where id = $1`, [scratch])).rows[0]!.ok);
    // teşhis edilmiş ya da "nereye kadar" bekleyen soru yeniden dağıtılmaz
    const left = (await tmp.pool.query(`select count(*)::int as n from audit.events where action = 'exam.how_far' and diff ->> 'session_id' = $1`, [sessionId])).rows[0]!.n;
    expect(left).toBe(2);
  });

  it('uygulama içi aynı deneme: finish_exam_session → exam.report → rapor PDF, oturum done', async () => {
    const st = await asElif(async (q) => (await q('select public.start_exam_session($1::uuid) as s', [examId])).rows[0]!.s as { session_id: string });
    const qs = (await tmp.pool.query('select id, no from public.exam_questions where exam_id = $1 order by no', [examId])).rows;
    await asElif(async (q) => {
      for (const x of qs.slice(0, 8)) await q('select public.record_exam_response($1, $2, $3, $4)', [st.session_id, x.id, 'CABDEBAD'[Number(x.no) - 1], 30 + Number(x.no)]);
    });
    await asElif(async (q) => q('select public.finish_exam_session($1)', [st.session_id]));
    const s = await waitFor(async () => {
      const row = (await tmp.pool.query('select status, score, report_document_id, progress from public.exam_sessions where id = $1', [st.session_id])).rows[0]!;
      return row.status === 'done' ? row : null;
    });
    expect(s.score).toMatchObject({ correct: 8, wrong: 0, unfinished: 2, net: 8 });
    const doc = (await tmp.pool.query('select status, pdf_path from public.generated_documents where id = $1', [s.report_document_id])).rows[0]!;
    expect(doc.status).toBe('rendered');
    expect(storage.objects.get(`documents/${doc.pdf_path}`)?.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  const stash = async (se: string, key: string) =>
    (await tmp.pool.query(`select diff -> 'data' as d from audit.events where action = 'exam.stash' and row_id = $1 and diff ->> 'key' = $2 order by created_at desc, id desc limit 1`, [se, key])).rows[0]?.d as Record<string, unknown> | undefined;

  /** İş kuyruğu olmadan oturum (gerçek worker yarışmasın): submit_exam_upload'un yazdığının aynısı, güvenilir bağlantıyla. */
  async function directSession(ids: string[], meta: { title: string; publisher?: string | null }): Promise<{ ex: string; se: string }> {
    const ex = String(
      (await tmp.pool.query(
        `insert into public.exams (course_id, curriculum_id, created_by, kind, source, title, publisher, is_copyrighted, status)
         select course_id, curriculum_id, $2, 'deneme', 'uploaded', $3, $4, true, 'processing' from public.enrollments where id = $1 returning id`,
        [enr, ELIF_PROFILE, meta.title, meta.publisher ?? null],
      )).rows[0]!.id,
    );
    const se = String((await tmp.pool.query(`insert into public.exam_sessions (exam_id, enrollment_id, mode, status, upload_ids, progress) values ($1, $2, 'uploaded', 'grading', $3::uuid[], '{"stage":"classify"}') returning id`, [ex, enr, ids])).rows[0]!.id);
    await tmp.pool.query(`update public.uploads set status = 'processing' where id = any($1::uuid[])`, [ids]);
    return { ex, se };
  }

  /** Varsayılan sahte fikstürlerin kopyası (çıkarım, rapor vb. rotalar dahil); `patch` üzerine yazar. */
  function patchedFixtures(patch: (dir: string) => void): string {
    const dir = mkdtempSync(join(tmpdir(), 'ogr-exam-fx-'));
    cpSync(join(SYN, '..', '..', '..', 'packages', 'llm', 'fixtures'), dir, { recursive: true });
    patch(dir);
    return dir;
  }

  /** 4 sayfalık sahte fikstür dizini; dördüncü sayfa anahtar sayfası ya da karalama (packages/llm/fixtures'tan türetilir). */
  function fourPageFixtures(fourth: 'answer_key' | 'scratch' = 'answer_key'): string {
    const src = join(SYN, '..', '..', '..', 'packages', 'llm', 'fixtures');
    const dir = mkdtempSync(join(tmpdir(), 'ogr-exam-fx-'));
    cpSync(src, dir, { recursive: true });
    const put = (route: string, name: string, body: unknown) => {
      mkdirSync(join(dir, route), { recursive: true });
      writeFileSync(join(dir, route, name), JSON.stringify(body));
    };
    const read = (route: string, name: string) => JSON.parse(readFileSync(join(src, route, name), 'utf8')) as { fake_match?: string[]; output?: unknown };
    for (const [i, f] of ['01-kitapcik-p1.json', '02-kitapcik-p2.json', '03-optik.json'].entries()) put('page_class', f, { fake_match: [`sayfa ${i + 1}/4.`], output: read('page_class', f).output });
    if (fourth === 'scratch') {
      put('page_class', '04-karalama.json', { fake_match: ['sayfa 4/4.'], output: { page_class: 'scratch', confidence: 0.93, rotation_degrees: 0, question_numbers_seen: [], has_figures: false, section_hint: null, printed_page_number: null, unreadable: false } });
    } else {
      put('page_class', '04-anahtar.json', { fake_match: ['sayfa 4/4.'], output: { page_class: 'answer_key', confidence: 0.97, rotation_degrees: 0, question_numbers_seen: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], has_figures: false, section_hint: 'Matematik', printed_page_number: null, unreadable: false } });
    }
    for (const [i, f] of ['01-kitapcik-p1.json', '02-kitapcik-p2.json'].entries()) put('exam_page_items', f, { fake_match: [`sayfa ${i + 1}/4.`], output: read('exam_page_items', f).output });
    put('answer_sheet', '01-optik.json', { fake_match: ['sayfa 3/4.', 'optik form.'], output: read('answer_sheet', '01-optik.json') });
    put('answer_sheet', '02-anahtar.json', {
      fake_match: ['sayfa 4/4.', 'cevap anahtarı'],
      output: { booklet_type: 'A', unreadable: false, answers: [...'CABDEBADCE'].map((k, i) => ({ question_no: i + 1, status: 'marked', marked_option: k, marks_seen: [k], note: null, confidence: 0.99 })) },
    });
    put('exam_report', '01-rapor.json', read('exam_report', '01-rapor.json'));
    return dir;
  }

  /**
   * Bildirim yazımını bir kez düşürür (geçici tablo + tetikleyici; iş bitince hepsi kaldırılır). `disarm` düşürmeyi keser.
   * Tetikleyici security definer: yazım emit_notification'ın (SECURITY DEFINER) sahibi rolüyle olur.
   */
  async function failNotifications<T>(fn: (disarm: () => Promise<void>) => Promise<T>): Promise<T> {
    await tmp.pool.query(
      `create table public.zz_notify_fail (x int);
       insert into public.zz_notify_fail values (1);
       create function public.zz_notify_fail() returns trigger language plpgsql security definer as $$ begin if new.kind = 'exam_analysed' and exists (select 1 from public.zz_notify_fail) then raise exception 'test: bildirim yazılamadı'; end if; return new; end $$;
       create trigger zz_notify_fail before insert on public.notifications for each row execute function public.zz_notify_fail();`,
    );
    try {
      return await fn(async () => {
        await tmp.pool.query('delete from public.zz_notify_fail');
      });
    } finally {
      await tmp.pool.query('drop trigger if exists zz_notify_fail on public.notifications; drop function if exists public.zz_notify_fail(); drop table if exists public.zz_notify_fail;');
    }
  }

  it('yüklenen anahtar sayfası (4. sayfa) anahtardır; aynı yayınevi + başlıklı sonraki deneme o anahtarı ve kazanımları kullanır', async () => {
    const ids = [await page('booklet-p1.png'), await page('booklet-p2.png'), await page('answer-sheet.png'), await page('answer-key.png')];
    const a = await directSession(ids, { title: 'Örnek Deneme 1', publisher: 'Örnek Yayın' });
    const ta = new FakeTransport({ fixturesDir: fourPageFixtures() });
    const ra = await getJob('exam.analyse')!.handler!({ session_id: a.se, exam_id: a.ex, upload_ids: ids }, jobCtx({ db: tmp.pool, transport: ta, storage: () => storage, now: () => new Date() }));
    expect(ra).toMatchObject({ status: 'done', keySource: 'uploaded', net: 5.5, questions: 10 });
    expect(ta.requests.map((r) => r.route)).not.toContain('inferred_keys');
    const keyOf = async (ex: string) =>
      (await tmp.pool.query(`select string_agg(k.correct_option, '' order by q.no) as k, string_agg(distinct k.source, ',') as src from secure.exam_answer_keys k join public.exam_questions q on q.id = k.exam_question_id where q.exam_id = $1`, [ex])).rows[0];
    expect(await keyOf(a.ex)).toEqual({ k: 'CABDEBADCE', src: 'uploaded' });
    expect((await tmp.pool.query('select progress from public.exam_sessions where id = $1', [a.se])).rows[0]!.progress).toMatchObject({ key_pages: 1, key_source: 'uploaded', keyed: 10 });

    const ids2 = [await page('booklet-p1.png'), await page('booklet-p2.png'), await page('answer-sheet.png')];
    const b = await directSession(ids2, { title: 'örnek deneme 1 ', publisher: 'ÖRNEK YAYIN' });
    const tb = new FakeTransport();
    const rb = await getJob('exam.analyse')!.handler!({ session_id: b.se, exam_id: b.ex, upload_ids: ids2 }, jobCtx({ db: tmp.pool, transport: tb, storage: () => storage, now: () => new Date() }));
    expect(rb).toMatchObject({ status: 'done', keySource: 'uploaded', net: 5.5 });
    expect(tb.requests.map((r) => r.route)).not.toContain('inferred_keys');
    // A'nın kazanımları (8 yüksek güvenli) taşınır; eşleşen sınavın kimliği progress'te değil stash'te
    const pb = (await tmp.pool.query('select progress from public.exam_sessions where id = $1', [b.se])).rows[0]!.progress;
    expect(pb).toMatchObject({ skills_lexical: 0, skills_tagged: 8 });
    expect(pb).not.toHaveProperty('key_publisher_exam');
    expect(await stash(b.se, 'publisher_match')).toMatchObject({ exam_id: a.ex, keys: 10 });
    expect(await keyOf(b.ex)).toEqual({ k: 'CABDEBADCE', src: 'uploaded' });

    // eşleşme sınırları: başka birinin yüklemesi (doğrulanmamış anahtar), varsayılan başlık, başka kitapçık
    const qs = (await tmp.pool.query('select no, stem_text from public.exam_questions where exam_id = $1 order by no', [b.ex])).rows.map((q) => ({ no: Number(q.no), stem_text: String(q.stem_text) }));
    const probe = { id: b.ex, publisher: 'Örnek Yayın', title: 'Örnek Deneme 1', curriculum_id: tmp.curriculumId!, created_by: ELIF_PROFILE };
    expect((await publisherMatch(tmp.pool, probe, qs))?.examId).toBe(a.ex);
    expect(await publisherMatch(tmp.pool, { ...probe, created_by: PARENT_PROFILE }, qs)).toBeNull();
    expect(await publisherMatch(tmp.pool, { ...probe, title: 'Okul denemesi · 3 Kas' }, qs)).toBeNull();
    expect(await publisherMatch(tmp.pool, probe, qs.map((q) => (q.no === 6 ? { ...q, stem_text: 'Bir dik üçgende hipotenüs kaç birimdir?' } : q)))).toBeNull();
    // yayımlanmış sınav yalnız eğitmen/üretilmiş anahtarıyla aday olur (yüklenen anahtar sayfası değil)
    await tmp.pool.query(`update public.exams set status = 'published', created_by = $2 where id = $1`, [a.ex, PARENT_PROFILE]);
    try {
      expect(await publisherMatch(tmp.pool, probe, qs)).toBeNull();
    } finally {
      await tmp.pool.query(`update public.exams set status = 'ready', created_by = $2 where id = $1`, [a.ex, ELIF_PROFILE]);
    }
  });

  it('okunamayan sayfalar: oturum failed, sayfalar failed, "Fotoğrafı okuyamadım" kartı (öneri motoru da kurar)', async () => {
    const ids = [await page('booklet-p1.png'), await page('answer-sheet.png')];
    const { ex, se } = await directSession(ids, { title: 'Bulanık deneme' });
    const unreadable = { page_class: 'booklet', confidence: 0.2, rotation_degrees: 0, question_numbers_seen: [], has_figures: false, section_hint: null, printed_page_number: null, unreadable: true };
    const transport = new FakeTransport().enqueue('page_class', { json: unreadable }, { json: unreadable });
    await expect(getJob('exam.analyse')!.handler!({ session_id: se, exam_id: ex, upload_ids: ids }, jobCtx({ db: tmp.pool, transport, storage: () => storage, now: () => new Date() }))).rejects.toMatchObject({ code: 'OGR-EXAM-101' });
    const s = (await tmp.pool.query('select status, progress from public.exam_sessions where id = $1', [se])).rows[0]!;
    expect(s).toMatchObject({ status: 'failed', progress: { stage: 'failed', error_code: 'OGR-EXAM-101', pages_unreadable: 2 } });
    expect((await tmp.pool.query(`select bool_and(status = 'failed') as f from public.uploads where id = any($1::uuid[])`, [ids])).rows[0]!.f).toBe(true);
    const card = async () => (await tmp.pool.query(`select title, payload from public.suggestions where student_id = $1 and kind = 'upload_result' and consumed_at is null and payload ->> 'upload_id' = $2`, [elif, ids[0]])).rows;
    expect(await card()).toEqual([{ title: 'Fotoğrafı okuyamadım', payload: expect.objectContaining({ failed: true, failure: 'reading', session_id: se }) }]);
    await getJob('suggestions.refresh')!.handler!({ student_id: elif, reason: 'test' }, jobCtx({ db: tmp.pool, now: () => new Date() }));
    expect((await card()).map((c) => c.title)).toEqual(['Fotoğrafı okuyamadım']);
  });
  it('tek kitapçık sayfasının bozuk çıktısı (yinelenen soru no) sınavı düşürmez: sayfa okunamaz, hat done', async () => {
    const ids = [await page('booklet-p1.png'), await page('booklet-p2.png'), await page('answer-sheet.png')];
    const { ex, se } = await directSession(ids, { title: 'Bozuk sayfalı deneme' });
    const p2 = JSON.parse(readFileSync(join(SYN, '..', '..', '..', 'packages', 'llm', 'fixtures', 'exam_page_items', '02-kitapcik-p2.json'), 'utf8')).output as { items: { no: number }[] };
    const dup = { ...p2, items: [p2.items[1]!, { ...p2.items[2]!, no: p2.items[1]!.no }] };
    /** 2. sayfanın exam_page_items çağrıları (ilk + onarım turu) şemaya uymayan çıktı alır; diğerleri fikstür. */
    class BadSecondPage extends FakeTransport {
      private bad(body: RequestBody, ctx: TransportContext): void {
        if (ctx.route === 'exam_page_items' && JSON.stringify(body.messages).toLocaleLowerCase('tr').includes('sayfa 2/3.')) this.enqueue('exam_page_items', { json: dup });
      }
      override create(body: RequestBody, ctx: TransportContext) {
        this.bad(body, ctx);
        return super.create(body, ctx);
      }
      override stream(body: RequestBody, ctx: TransportContext) {
        this.bad(body, ctx);
        return super.stream(body, ctx);
      }
    }
    const t = new BadSecondPage();
    const r = await getJob('exam.analyse')!.handler!({ session_id: se, exam_id: ex, upload_ids: ids }, jobCtx({ db: tmp.pool, transport: t, storage: () => storage, now: () => new Date() }));
    expect(r).toMatchObject({ status: 'done' });
    expect(t.requests.filter((x) => x.route === 'exam_page_items')).toHaveLength(3);
    const s = (await tmp.pool.query('select status, progress from public.exam_sessions where id = $1', [se])).rows[0]!;
    expect(s.status).toBe('done');
    expect(String(s.progress.warnings).split(',')).toEqual(expect.arrayContaining(['page_unreadable']));
    expect(s.progress).toMatchObject({ booklet_pages: 2, questions: 5 });
    expect(await stash(se, `items:${ids[1]}`)).toMatchObject({ unreadable: true, error: 'bad_output', items: [] });
  });

  it('anahtar çıkarımının reddi sınavı düşürmez: sorular anahtarsız (key_missing), notlama ve rapor sürer', async () => {
    const ids = [await page('booklet-p1.png'), await page('booklet-p2.png'), await page('answer-sheet.png')];
    const { ex, se } = await directSession(ids, { title: 'Anahtarsız deneme' });
    const t = new FakeTransport().enqueue('inferred_keys', { text: '', stopReason: 'refusal', stopDetails: { category: 'cyber' } as never });
    const r = await getJob('exam.analyse')!.handler!({ session_id: se, exam_id: ex, upload_ids: ids }, jobCtx({ db: tmp.pool, transport: t, storage: () => storage, now: () => new Date() }));
    expect(r).toMatchObject({ status: 'done', questions: 10, keySource: null });
    const s = (await tmp.pool.query('select status, progress, score from public.exam_sessions where id = $1', [se])).rows[0]!;
    expect(s).toMatchObject({ status: 'done', progress: { keyed: 0, report_status: 'rendered' }, score: { correct: 0, wrong: 0 } });
    expect(String(s.progress.warnings).split(',')).toEqual(expect.arrayContaining(['key_missing']));
    expect(await stash(se, 'inferred:1,2,3,4,5,6,7,8,9,10')).toMatchObject({ keys: [], error: 'refusal' });
  });

  it('PDF okul denemesi: model çağrılmadan failed, "fotoğraf olarak yükle" (OGR-EXAM-104)', async () => {
    const id = randomUUID();
    await storage.upload('uploads', `${ELIF_PROFILE}/${id}.pdf`, Buffer.from('%PDF-1.4'), 'application/pdf');
    await asElif((q) => q(`insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime, bytes) values ($1, $2, $3, 'photo', $4, 'application/pdf', 8)`, [id, ELIF_PROFILE, elif, `${ELIF_PROFILE}/${id}.pdf`]));
    const { ex, se } = await directSession([id], { title: 'PDF deneme' });
    const t = new FakeTransport();
    await expect(getJob('exam.analyse')!.handler!({ session_id: se, exam_id: ex, upload_ids: [id] }, jobCtx({ db: tmp.pool, transport: t, storage: () => storage, now: () => new Date() }))).rejects.toMatchObject({ code: 'OGR-EXAM-104' });
    expect(t.requests).toHaveLength(0);
    expect((await tmp.pool.query('select status, progress from public.exam_sessions where id = $1', [se])).rows[0]).toMatchObject({ status: 'failed', progress: { error_code: 'OGR-EXAM-104', error: expect.stringContaining('fotoğraf olarak') } });
  });

  it('EXAM_KEYS_BATCH: Batch bitmedi → iş kendini 120 sn sonraya atar; ikinci koşu kayıtlı sorulardan sürer, 6 saati aşınca senkron', async () => {
    const ids = [await page('booklet-p1.png'), await page('booklet-p2.png'), await page('answer-sheet.png')];
    // gerçek taşıma gibi görünür (Files API'ye gitmesin diye sayfaların dosya kimliği önceden var)
    await tmp.pool.query(`update public.uploads set anthropic_file_id = 'file_' || replace(id::text, '-', '') where id = any($1::uuid[])`, [ids]);
    const { ex, se } = await directSession(ids, { title: 'Batch deneme' });
    const t = new FakeTransport();
    Object.defineProperty(t, 'kind', { value: 'anthropic' });
    const retrieve = t.batches.retrieve;
    t.batches.retrieve = async (id: string) => ({ ...(await retrieve(id)), processing_status: 'in_progress' as const, ended_at: null });
    const env = process.env.EXAM_KEYS_BATCH;
    const poll = { ...KEYS_BATCH_POLL };
    process.env.EXAM_KEYS_BATCH = '1';
    Object.assign(KEYS_BATCH_POLL, { intervalMs: 5, timeoutMs: 30 });
    try {
      const t0 = new Date();
      const c1 = jobCtx({ db: tmp.pool, transport: t, storage: () => storage, now: () => t0 });
      const r1 = await getJob('exam.analyse')!.handler!({ session_id: se, exam_id: ex, upload_ids: ids }, c1);
      expect(r1).toMatchObject({ status: 'grading', skipped: 'keys_batch_pending' });
      expect(c1.enqueued).toEqual([{ name: 'exam.analyse', data: { session_id: se, exam_id: ex, upload_ids: ids }, opts: expect.objectContaining({ startAfter: 120, singletonKey: `exam-keys:${se}` }) }]);
      expect(t.requests.filter((x) => x.kind === 'batch').map((x) => x.route)).toEqual(['inferred_keys']);
      expect((await tmp.pool.query('select progress from public.exam_sessions where id = $1', [se])).rows[0]!.progress).toMatchObject({ stage: 'key', key_batch: 'pending' });
      // bekleme süresi içinde: yine ertelenir, sayfalar yeniden sınıflanmaz/okunmaz
      const before = t.requests.length;
      const c2 = jobCtx({ db: tmp.pool, transport: t, storage: () => storage, now: () => new Date(t0.getTime() + 3600_000) });
      expect(await getJob('exam.analyse')!.handler!({ session_id: se, exam_id: ex, upload_ids: ids }, c2)).toMatchObject({ skipped: 'keys_batch_pending' });
      expect(t.requests.length).toBe(before);
      // 6 saat sonra: senkron çıkarım; alım/sınıflama/OCR/kayıt yok
      const c3 = jobCtx({ db: tmp.pool, transport: t, storage: () => storage, now: () => new Date(t0.getTime() + 7 * 3600_000) });
      const r3 = await getJob('exam.analyse')!.handler!({ session_id: se, exam_id: ex, upload_ids: ids }, c3);
      expect(r3).toMatchObject({ status: 'done', keySource: 'inferred', net: 5.5 });
      expect(t.requests.slice(before).map((x) => `${x.kind}:${x.route}`).sort()).toEqual(['create:answer_sheet', 'create:inferred_keys', 'stream:exam_report'].sort());
      expect(c3.enqueued).toEqual([]);
    } finally {
      if (env === undefined) delete process.env.EXAM_KEYS_BATCH;
      else process.env.EXAM_KEYS_BATCH = env;
      Object.assign(KEYS_BATCH_POLL, poll);
    }
  });
  it('yayıncı anahtarı soru türü uymayan kitapçıkta düşer (mcq ↔ sayısal): hat done, ayrıntı run_meta\'da', async () => {
    const idsA = [await page('booklet-p1.png'), await page('booklet-p2.png'), await page('answer-sheet.png'), await page('answer-key.png')];
    const a = await directSession(idsA, { title: 'Tür uyuşmaz deneme', publisher: 'Tür Yayın' });
    const ra = await getJob('exam.analyse')!.handler!({ session_id: a.se, exam_id: a.ex, upload_ids: idsA }, jobCtx({ db: tmp.pool, transport: new FakeTransport({ fixturesDir: fourPageFixtures() }), storage: () => storage, now: () => new Date() }));
    expect(ra).toMatchObject({ status: 'done', keySource: 'uploaded' });
    // B: aynı kitapçık, ancak 3. soru bu sınavda sayısal okunur (A'da şıklı; yayıncı anahtarı C/B harfi)
    const idsB = [await page('booklet-p1.png'), await page('booklet-p2.png'), await page('answer-sheet.png')];
    const b = await directSession(idsB, { title: 'tür uyuşmaz deneme', publisher: 'TÜR YAYIN' });
    const numericThird = patchedFixtures((dir) => {
      const f = join(dir, 'exam_page_items', '01-kitapcik-p1.json');
      const v = JSON.parse(readFileSync(f, 'utf8')) as { output: { items: Record<string, unknown>[] } };
      v.output.items = v.output.items.map((it) => (it.no === 3 ? { ...it, kind: 'numeric', options: [] } : it));
      writeFileSync(f, JSON.stringify(v));
    });
    const rb = await getJob('exam.analyse')!.handler!({ session_id: b.se, exam_id: b.ex, upload_ids: idsB }, jobCtx({ db: tmp.pool, transport: new FakeTransport({ fixturesDir: numericThird }), storage: () => storage, now: () => new Date() }));
    expect(rb).toMatchObject({ status: 'done' });
    expect(await stash(b.se, 'run_meta')).toMatchObject({ details: expect.arrayContaining(['yayıncı: soru 3: sayısal değer yok']) });
    expect((await tmp.pool.query('select status, progress from public.exam_sessions where id = $1', [b.se])).rows[0]).toMatchObject({ status: 'done', progress: { stage: 'done', diagnoses_queued: 0 } });
  });

  it('bildirim adımı düşerse yeniden koşu raporu yeniden üretmez; bildirim, teşhis dağıtımı ve son yazım tamamlanır', async () => {
    const ids = [await page('booklet-p1.png'), await page('booklet-p2.png'), await page('answer-sheet.png'), await page('booklet-p2.png')];
    const { ex, se } = await directSession(ids, { title: 'Bildirimi düşen deneme' });
    // tek taşıma iki koşuda: istek günlüğü (exam_report yalnız bir kez gitmeli)
    const transport = new FakeTransport({ fixturesDir: fourPageFixtures('scratch') });
    const run = (retryCount = 0) =>
      getJob('exam.analyse')!.handler!(
        { session_id: se, exam_id: ex, upload_ids: ids },
        jobCtx({ db: tmp.pool, transport, storage: () => storage, now: () => new Date(), job: { id: `job-b-${retryCount}`, name: 'exam.analyse', retryCount } }),
      );
    await failNotifications(async (disarm) => {
      await expect(run()).rejects.toThrow('bildirim yazılamadı');
      const mid = (await tmp.pool.query('select status, progress from public.exam_sessions where id = $1', [se])).rows[0]!;
      expect(mid.status).toBe('done');
      expect(mid.progress).not.toHaveProperty('diagnoses_queued');
      await disarm();
      expect(await run()).toMatchObject({ status: 'done', diagnosesQueued: 4 });
    });
    expect((await tmp.pool.query('select progress from public.exam_sessions where id = $1', [se])).rows[0]!.progress).toMatchObject({ stage: 'done', diagnoses_queued: 4 });
    expect((await tmp.pool.query(`select count(*)::int as n from public.notifications where kind = 'exam_analysed' and recipient_id = $2 and payload ->> 'session_id' = $1`, [se, PARENT_PROFILE])).rows[0]!.n).toBe(1);
    // rapor bir kez üretildi: ikinci koşu exam_report çağırmadı, belge tek
    expect(transport.requests.filter((x) => x.route === 'exam_report')).toHaveLength(1);
    expect((await tmp.pool.query(`select count(*)::int as n from public.generated_documents where kind = 'report' and spec ->> 'session_id' = $1`, [se])).rows[0]!.n).toBe(1);
    expect((await tmp.pool.query(`select count(*)::int as n from public.suggestions where student_id = $1 and kind = 'upload_result' and consumed_at is null and payload ->> 'session_id' = $2`, [elif, se])).rows[0]!.n).toBe(1);
  });

  it('son denemede notlanmış oturumda bildirim düşerse sonuç kartı kalır; "yeniden dener misin" kartı yazılmaz', async () => {
    const ids = [await page('booklet-p1.png'), await page('booklet-p2.png'), await page('answer-sheet.png')];
    const { ex, se } = await directSession(ids, { title: 'Son denemede bildirim düşen' });
    await failNotifications(async () => {
      await expect(
        getJob('exam.analyse')!.handler!(
          { session_id: se, exam_id: ex, upload_ids: ids },
          jobCtx({ db: tmp.pool, transport: new FakeTransport(), storage: () => storage, now: () => new Date(), job: { id: 'job-c', name: 'exam.analyse', retryCount: 3 } }),
        ),
      ).rejects.toMatchObject({ code: 'OGR-JOB-153' });
    });
    const s = (await tmp.pool.query('select status, progress from public.exam_sessions where id = $1', [se])).rows[0]!;
    expect(s.status).toBe('done');
    expect(s.progress).toMatchObject({ card_line: expect.any(String) });
    const cards = (await tmp.pool.query(`select title, subtitle, payload ->> 'copy_key' as key from public.suggestions where student_id = $1 and kind = 'upload_result' and consumed_at is null and payload ->> 'session_id' = $2`, [elif, se])).rows;
    expect(cards).toEqual([{ title: 'Deneme sonucun hazır', subtitle: s.progress.card_line, key: `session:${se}` }]);
  });
});
