/**
 * Belge üretimi uçtan uca (OGRENMEN_LIVE=1): geçici veritabanı (göçler + seed + TYT müfredatı) + gerçek pg-boss
 * (createApp) + sahte Anthropic taşıması (packages/llm/fixtures: notes_generation 01-rasyonel, exam_generation 01-tyt10)
 * + yerel matplotlib figürleri + gerçek doc-render PDF + bellek içi Storage.
 *
 *   öğrenci JWT'si → public.request_document('notes') → pgboss 'document.generate' → worker: dossier + örüntüler →
 *   notes_generation → merdiven (SymPy, figür, kopya, kişiselleştirme) → PDF/HTML Storage → register → ready ≤ 60 sn;
 *   Bugün 'document_ready' kartı ("… notun hazır"), bildirim, maliyet llm_calls'tan.
 *   Deneme: request_document('mock_exam') → exams (practice, generated) + 10 soru (2 SVG şekil) + anahtarlar
 *   secure.exam_answer_keys'te; öğrenci görünümünde anahtar yok.
 *   Eğitmen isteği (review) → 'review' + eğitmen bildirimi → review_document(approve) → yayın.
 *   Bozuk anahtarlı soru seti: 2 yeniden üretim turu (verification.regen) → sorusuz kaldı → failed + Türkçe neden, AST silinir.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeBrowser } from '@ogrenmen/doc-render';
import { FakeTransport, Gateway, PgLedger } from '@ogrenmen/llm';
import { createTempDatabase, seedStudents, type TempDatabase } from '@ogrenmen/llm/testing';
import { readFileSync } from 'node:fs';
import { createApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/log.js';
import type { StorageLike } from '../src/storage.js';

const live = process.env.OGRENMEN_LIVE === '1';
/** Satır içerikleri (jsonb) testte serbest gezilir. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const ELIF_PROFILE = '00000000-0000-4000-8000-0000000000e1';
const TEACHER_PROFILE = '00000000-0000-4000-8000-0000000000a1';
const MIGRATION_ROLE = 'ogrenmen_owner';
const EXAM_FIXTURE = JSON.parse(readFileSync(new URL('../../../packages/llm/fixtures/exam_generation/01-tyt10.json', import.meta.url), 'utf8')) as {
  title: string;
  blueprint: unknown;
  items: { no: number; options: { key: string; text: string }[] }[];
  keys: { question_no: number; correct_option: string | null; canonical_expr: string | null }[];
};

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

describe.skipIf(!live)('Belge üretimi: request_document → document.generate → doğrulama merdiveni → PDF (gerçek pg-boss, sahte LLM)', () => {
  let tmp: TempDatabase;
  let app: App;
  let elif = '';
  let enr = '';
  const storage = new MemoryStorage();
  const transport = new FakeTransport();

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

  async function request(profile: string, kind: string, spec: Record<string, unknown>): Promise<{ request_id: string; document_id: string }> {
    const r = await as(profile, async (q) => (await q(`select public.request_document($1, $2::jsonb, $3) as r`, [kind, JSON.stringify(spec), profile === ELIF_PROFILE ? 'chat' : 'instructor'])).rows[0]!.r as Record<string, unknown>);
    const reqId = String(r.request_id ?? r.id);
    const doc = await tmp.pool.query('select generated_document_id from public.document_requests where id = $1', [reqId]);
    return { request_id: reqId, document_id: String(doc.rows[0]!.generated_document_id) };
  }

  async function finished(reqId: string, want: string[] = ['ready', 'review', 'failed']): Promise<{ status: string; error: string | null }> {
    return waitFor(async () => {
      const r = await tmp.pool.query('select status, error from public.document_requests where id = $1', [reqId]);
      const row = r.rows[0] as { status: string; error: string | null } | undefined;
      return row && want.includes(row.status) ? row : null;
    });
  }

  beforeAll(async () => {
    tmp = await createTempDatabase();
    ({ elif } = await seedStudents(tmp.pool));
    const course = String(
      (await tmp.pool.query(`insert into public.courses (code, title, kind, curriculum_id, visibility) values ('TYT-MAT', 'TYT Matematik', 'exam_track', $1, 'shared') returning id`, [tmp.curriculumId])).rows[0]!.id,
    );
    enr = String(
      (await tmp.pool.query(`insert into public.enrollments (student_id, curriculum_id, course_id, period_label, target_exam) values ($1, $2, $3, 'YKS 2027', 'TYT') returning id`, [elif, tmp.curriculumId, course])).rows[0]!.id,
    );
    // Notun "Senin sık yaptığın hata" kutusu: patterns.md 2. satır (12 ve 19 Ekim)
    await tmp.pool.query(
      `insert into public.memory_files (student_id, path, content) values ($1, '/memories/patterns.md', $2)
       on conflict (student_id, path) do update set content = excluded.content`,
      [elif, '# Örüntüler\n- Kesirlerde paydaları da topluyor (12 Eki, 19 Eki): 2/3 + 1/4 için 3/7.\n- Negatif sayının karesinde işareti unutuyor (3 Kas).\n'],
    );
    const gateway = new Gateway({ transport, ledger: new PgLedger(tmp.pool) });
    const config = loadConfig({ DATABASE_URL: tmp.url, PGBOSS_SCHEMA: 'pgboss', HEALTH_HOST: '127.0.0.1', HEALTH_PORT: '0', WORKER_SCHEDULES: 'off', PDF_CONCURRENCY: '1' }, ['--process=all']);
    app = createApp(config, { log: silentLogger, db: tmp.pool, gateway: async () => gateway, storage, pdf: { render: async () => ({ pdf: Buffer.from('%PDF-1.4'), pages: 1, bytes: 8 }), close: async () => undefined } });
    await app.start();
    await tmp.pool.query(`grant usage on schema pgboss to ${MIGRATION_ROLE}; grant select on pgboss.queue to ${MIGRATION_ROLE}; grant select, insert on pgboss.job to ${MIGRATION_ROLE}`);
  }, 120_000);

  afterAll(async () => {
    await app?.stop().catch(() => undefined);
    await closeBrowser().catch(() => undefined);
    await tmp?.drop();
  });

  it('kişisel not: istek → ready ≤ 60 sn; figür SVG, kişisel hata kutusu, PDF + HTML Storage\'da, Bugün kartı ve bildirim', async () => {
    const t0 = Date.now();
    const { request_id, document_id } = await request(ELIF_PROFILE, 'notes', { topic: 'Rasyonel sayılar', skill_ids: ['tyt.mat.temel.rasyonel-sayilar'] });
    const fin = await finished(request_id);
    expect(fin).toEqual({ status: 'ready', error: null });
    expect(Date.now() - t0).toBeLessThan(60_000);

    const d = (await tmp.pool.query('select * from public.generated_documents where id = $1', [document_id])).rows[0] as Record<string, Loose>;
    expect(d.status).toBe('published');
    expect(d.published_at).not.toBeNull();
    expect(d.content.keys).toEqual([]);
    const fig = d.content.blocks.find((b: Loose) => b.type === 'figure');
    expect(fig.svg).toMatch(/^<svg/);
    expect(fig.figure_code).toBeUndefined();
    const callout = d.content.blocks.find((b: Loose) => b.type === 'common_mistake_callout');
    expect(callout.pattern_ref).toEqual({ source: 'patterns.md', id: 'patterns.md:2', date: '2026-10-19' });
    expect(d.content.meta.personalized).toBe(true);
    for (const step of ['schema', 'sympy', 'figures', 'duplicates', 'personalization']) expect(['pass', 'skipped']).toContain(d.verification[step].status);
    expect(d.verification.sympy).toMatchObject({ status: 'pass', checked: 3, verified: 3 });
    expect(d.verification.figures).toMatchObject({ status: 'pass', mode: 'local', count: 1 });
    expect(d.verification.personalization).toMatchObject({ status: 'pass', personalized: true, callouts: 1, model_check: 'ok' });
    expect(d.personalization).toMatchObject({ personalized: true, patterns_offered: 2 });

    const pdf = storage.objects.get(`documents/${d.pdf_path}`);
    expect(d.pdf_path).toBe(`notes/${elif}/${document_id}.pdf`);
    expect(pdf?.type).toBe('application/pdf');
    expect(pdf?.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const html = storage.objects.get(`documents/${d.html_path}`)!.body.toString('utf8');
    expect(html).toContain('Senin sık yaptığın hata');
    expect(html).toContain('<svg');

    const card = (await tmp.pool.query(`select title, subtitle, payload from public.suggestions where student_id = $1 and kind = 'document_ready'`, [elif])).rows;
    expect(card).toHaveLength(1);
    expect(card[0]!.title).toBe('Rasyonel sayılar notun hazır');
    expect(card[0]!.subtitle).toMatch(/^PDF/);
    const note = await tmp.pool.query(`select count(*)::int as n from public.notifications where kind = 'document_ready' and payload ->> 'document_id' = $1`, [document_id]);
    expect(note.rows[0]!.n).toBe(1);

    const calls = (await tmp.pool.query(`select route, count(*)::int as n from public.llm_calls where ref_table = 'generated_documents' and ref_id = $1 group by route order by route`, [document_id])).rows;
    expect(calls.map((c) => c.route)).toEqual(['figure_check', 'notes_generation', 'personalization_check']);
    const nb = transport.requests.find((r) => r.route === 'notes_generation')!;
    expect(nb.body.tools ?? []).toEqual([]);
    const text = JSON.stringify(nb.body.messages);
    expect(text).toContain('patterns.md:2');
    expect(text).toContain('tyt.mat.temel.rasyonel-sayilar');

    // öğrenci Belgelerim'de görür
    const mine = await as(ELIF_PROFILE, async (q) => (await q('select public.list_my_documents() as r')).rows[0]!.r as { documents: { id: string }[] });
    expect(mine.documents.map((x) => x.id)).toContain(document_id);
  });

  it('deneme: istek → exams + 10 soru (2 SVG şekil) + anahtarlar secure\'da; öğrenci anahtar görmez; kart "Denemen hazır"', async () => {
    const { request_id, document_id } = await request(ELIF_PROFILE, 'mock_exam', { question_count: 10, duration_min: 20 });
    expect(await finished(request_id)).toEqual({ status: 'ready', error: null });
    const d = (await tmp.pool.query('select * from public.generated_documents where id = $1', [document_id])).rows[0] as Record<string, Loose>;
    expect(d.status).toBe('published');
    expect(d.pdf_path).toBe(`exams/${elif}/${document_id}.pdf`);
    expect(d.content.blocks.filter((b: Loose) => b.type === 'question')).toHaveLength(10);
    expect(d.verification.figures).toMatchObject({ status: 'pass', count: 2 });

    const ex = (await tmp.pool.query(`select id, kind, source, status, is_copyrighted, question_count, duration_min from public.exams where generated_document_id = $1`, [document_id])).rows[0] as Record<string, Loose>;
    expect(ex).toMatchObject({ kind: 'practice', source: 'generated', status: 'ready', is_copyrighted: false, question_count: 10, duration_min: 20 });
    const qs = (await tmp.pool.query(`select no, kind, figure_svg is not null as fig from public.exam_questions where exam_id = $1 order by no`, [ex.id])).rows;
    expect(qs).toHaveLength(10);
    expect(qs.filter((q) => q.fig).map((q) => q.no)).toEqual([8, 9]);
    const keys = (await tmp.pool.query(`select q.no, k.correct_option, k.source from secure.exam_answer_keys k join public.exam_questions q on q.id = k.exam_question_id where q.exam_id = $1 order by q.no`, [ex.id])).rows;
    expect(keys.every((k) => k.source === 'generated')).toBe(true);
    expect(keys.map((k) => k.correct_option).join('')).toBe(EXAM_FIXTURE.keys.map((k) => k.correct_option).join(''));

    // "Çöz": oturum açılınca öğrenci soruları görür (anahtarsız)
    const seen = await as(ELIF_PROFILE, async (q) => {
      await q('select public.start_exam_session($1::uuid)', [ex.id]);
      return (await q('select * from public.v_exam_questions_student where exam_id = $1 order by no', [ex.id])).rows;
    });
    expect(seen.filter((x) => x.figure_svg).map((x) => x.no)).toEqual([8, 9]);
    expect(seen).toHaveLength(10);
    expect(JSON.stringify(seen)).not.toMatch(/correct_option/);
    // verification öğrenciye açık: anahtar ayrıntısı (doğru şık, canonical_expr) sızmamalı (secure tabloyu atlatmasın)
    const ver = await as(ELIF_PROFILE, async (q) => (await q('select verification::text as v from public.generated_documents where id = $1', [document_id])).rows[0]?.v as string | undefined);
    expect(ver).toBeTruthy();
    expect(ver).not.toMatch(/doğru şık|correct_option|canonical_expr/);
    for (const k of EXAM_FIXTURE.keys) if (k.canonical_expr && /[/*a-z]/.test(k.canonical_expr)) expect(ver).not.toContain(k.canonical_expr);
    expect(JSON.parse(ver!).sympy.details[0]).toEqual({ no: 1, status: expect.any(String) });
    const pdf = storage.objects.get(`documents/${d.pdf_path}`)!.body.toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);

    const card = (await tmp.pool.query(`select title, payload from public.suggestions where student_id = $1 and kind = 'document_ready' and payload ->> 'document_id' = $2`, [elif, document_id])).rows[0]!;
    expect(card.title).toBe('Denemen hazır');
    expect((card.payload as Record<string, string>).exam_id).toBe(ex.id);
  });

  it('eğitmen isteği (inceleme): review + eğitmen bildirimi → onay → yayın', async () => {
    const { request_id, document_id } = await request(TEACHER_PROFILE, 'question_set', { enrollment_id: enr, question_count: 10, review: true, topic: 'Problemler' });
    expect((await finished(request_id)).status).toBe('review');
    const d = (await tmp.pool.query('select status, review_required from public.generated_documents where id = $1', [document_id])).rows[0]!;
    expect(d).toMatchObject({ status: 'review', review_required: true });
    const n = await tmp.pool.query(`select count(*)::int as n from public.notifications where recipient_id = $1 and kind = 'document_review' and payload ->> 'document_id' = $2`, [TEACHER_PROFILE, document_id]);
    expect(n.rows[0]!.n).toBe(1);
    await as(TEACHER_PROFILE, (q) => q(`select public.review_document($1, 'approve', 'Uygun')`, [document_id]));
    expect((await tmp.pool.query('select status from public.generated_documents where id = $1', [document_id])).rows[0]!.status).toBe('published');
    expect((await tmp.pool.query('select status from public.document_requests where id = $1', [request_id])).rows[0]!.status).toBe('ready');
  });

  it('bozuk anahtarlar: yalnız hatalı sorular 2 tur yeniden istenir; düzelmeyince sorusuz kalan set failed + Türkçe neden, AST silinir', async () => {
    const bad = {
      title: 'Bozuk set',
      blueprint: null,
      items: EXAM_FIXTURE.items.slice(0, 2).map((it) => ({ ...it, figure: null, figure_svg: null })),
      keys: EXAM_FIXTURE.keys.slice(0, 2).map((k) => ({ ...k, canonical_expr: '1234567', solution: 'Bilerek yanlış anahtar: denetim yakalamalı.' })),
    };
    // ilk tur tam set; yeniden üretim turları daraltılmış biçim (exam-block-regen: yalnız items + keys)
    const regenBad = { items: bad.items, keys: bad.keys };
    transport.enqueue('exam_generation', { json: bad }, { json: regenBad }, { json: regenBad });
    const before = transport.requests.filter((r) => r.route === 'exam_generation').length;
    const { request_id, document_id } = await request(ELIF_PROFILE, 'question_set', { question_count: 2, topic: 'Sayılar' });
    const fin = await finished(request_id);
    expect(fin.status).toBe('failed');
    expect(fin.error).toBe('Sorular doğrulamadan geçmedi; belge hazırlanamadı.');
    expect(transport.requests.filter((r) => r.route === 'exam_generation').length - before).toBe(3);
    const regenMsg = JSON.stringify(transport.requests.filter((r) => r.route === 'exam_generation').at(-1)!.body.messages);
    expect(regenMsg).toContain('regen_blocks');
    const d = (await tmp.pool.query('select status, content, verification from public.generated_documents where id = $1', [document_id])).rows[0] as Record<string, Loose>;
    expect(d.status).toBe('failed');
    expect(d.content).toBeNull();
    expect(d.verification.regen.length).toBe(4);
    expect(d.verification.sympy.status).toBe('fail');
    expect((await tmp.pool.query('select count(*)::int as n from public.exams where generated_document_id = $1', [document_id])).rows[0]!.n).toBe(0);
  });
});
