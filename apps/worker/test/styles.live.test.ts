/**
 * P4 tarz kütüphanesi uçtan uca, gerçek Postgres'te (OGRENMEN_LIVE=1): geçici veritabanı (@ogrenmen/llm/testing), sahte
 * LLM (packages/llm/fixtures arsiv-*: sentetik 2 yıl × 5 soru, apps/worker/test/fixtures/styles/archive.json), Storage
 * bellekte (2024 PDF → gerçek pdftoppm; 2025 PNG → sharp), anahtar denetimi gerçek SymPy (py/key_verify.py).
 *   1. eğitmen ingest_exam_source(2024) → style.ingest: OCR → 5 madde (exam-item v2) → 4 taslak tarz (fikstür adları);
 *      tek yıl: plan atlanır; style.coverage.refresh kuyruğa
 *   2. ingest(2025) → 10 madde, 4 tarz (yeni ad yok, maddeler var olan tarzlara), öncelik planı pending_review
 *      (4 satır; skor SQL = TS formülü); yeniden çalıştırma ücretli çağrı yapmaz
 *   3. style.coverage.refresh → öğrencinin Bugün yenilemesi + öncelikli 3 tarz için style.question_gen
 *   4. style.question_gen → 3 soru, anahtar SymPy verified, questions.style_id + approved; yinelenmez
 *   5. eğitmen tarzı etkinleştirir → suggestions.refresh: 'practice' kartı payload.style_id, "Bu tarzı hiç çözmedin";
 *      öğrencinin tarz görünümünde çıkmış soru metni yok
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempDatabase, seedStudents, type TempDatabase } from '@ogrenmen/llm/testing';
import { getJob } from '../src/jobs/registry.js';
import type { StyleIngestResult } from '../src/jobs/style-ingest.js';
import type { StyleQuestionGenResult } from '../src/jobs/style-question-gen.js';
import type { StyleCoverageRefreshResult } from '../src/jobs/style-coverage-refresh.js';
import { styleScore } from '../src/styles/score.js';
import type { StorageLike } from '../src/storage.js';
import { jobCtx } from './support.js';

const live = process.env.OGRENMEN_LIVE === '1';
const INSTRUCTOR = '00000000-0000-4000-8000-0000000000a1';
const ELIF_PROFILE = '00000000-0000-4000-8000-0000000000e1';
const ARCHIVE = JSON.parse(readFileSync(new URL('./fixtures/styles/archive.json', import.meta.url), 'utf8')) as {
  styles: { key: string; code: string; name: string; skill_ids: string[] }[];
  sources: { year: number; items: { no: number; style: string; text: string }[] }[];
};

class MemoryStorage implements StorageLike {
  readonly objects = new Map<string, Buffer>();
  async upload(bucket: string, path: string, body: Uint8Array | Buffer) {
    this.objects.set(`${bucket}/${path}`, Buffer.from(body));
  }
  async download(bucket: string, path: string) {
    const b = this.objects.get(`${bucket}/${path}`);
    if (!b) throw new Error(`yok: ${bucket}/${path}`);
    return b;
  }
  async createSignedUrl(bucket: string, path: string) {
    return `mem://${bucket}/${path}`;
  }
}

function samplePdf(): Buffer {
  return execFileSync('python3', ['-I', '-c', [
    'import io, sys, matplotlib', 'matplotlib.use("Agg")', 'import matplotlib.pyplot as plt',
    'f = plt.figure(figsize=(8.27, 11.69)); f.text(0.1, 0.9, "2024 final"); f.text(0.1, 0.8, "1) 3/4 - 1/2 : 2/3 = ?")',
    'b = io.BytesIO(); f.savefig(b, format="pdf"); sys.stdout.buffer.write(b.getvalue())',
  ].join('\n')], { env: { ...process.env, MPLBACKEND: 'Agg' } });
}

describe.skipIf(!live)('tarz kütüphanesi (gerçek Postgres + sahte LLM + SymPy)', () => {
  let tmp: TempDatabase;
  let course: string;
  let enr: string;
  let elif: string;
  const storage = new MemoryStorage();
  const sources: Record<number, string> = {};
  const payloads: Record<number, Record<string, unknown>> = {};
  const q = (text: string, values?: unknown[]) => tmp.pool.query(text, values);

  /** JWT'li çağrı (eğitmen ya da öğrenci); işlem kalıcıdır. */
  async function asUser<T>(sub: string, sql: string, values: unknown[]): Promise<T> {
    const c = await tmp.pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })]);
      await c.query('set local role authenticated');
      const r = await c.query(sql, values);
      await c.query('commit');
      return r.rows[0]!.r as T;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }

  async function upload(kind: 'pdf' | 'photo', bytes: Buffer, mime: string): Promise<string> {
    const id = randomUUID();
    const path = `${INSTRUCTOR}/${id}.${kind === 'pdf' ? 'pdf' : 'png'}`;
    await storage.upload('uploads', path, bytes);
    await q(`insert into public.uploads (id, owner_id, kind, storage_path, mime, bytes, status) values ($1, $2, $3, $4, $5, $6, 'stored')`, [id, INSTRUCTOR, kind, path, mime, bytes.length]);
    return id;
  }

  async function ingest(year: number, uploadId: string) {
    const r = await asUser<{ source_id: string; job_id: string | null; reused: boolean; upload_ids: string[] }>(
      INSTRUCTOR, 'select public.ingest_exam_source($1::uuid, $2::jsonb, $3::uuid[]) as r', [course, JSON.stringify({ year, term: 'final' }), [uploadId]],
    );
    sources[year] = r.source_id;
    payloads[year] = { source_id: r.source_id, course_id: course, year, term: 'final', upload_ids: r.upload_ids };
    const ctx = jobCtx({ db: tmp.pool, storage: () => storage, now: () => new Date() });
    const res = (await getJob('style.ingest')!.handler!(payloads[year], ctx)) as StyleIngestResult;
    return { res, ctx };
  }

  beforeAll(async () => {
    tmp = await createTempDatabase();
    ({ elif } = await seedStudents(tmp.pool));
    course = String((await q(`insert into public.courses (code, title, kind, curriculum_id, visibility, created_by) values ('TYT-MAT-ARSIV', 'TYT Matematik (arşiv)', 'exam_track', $1, 'shared', $2) returning id`, [tmp.curriculumId, INSTRUCTOR])).rows[0]!.id);
    enr = String((await q(`insert into public.enrollments (student_id, curriculum_id, course_id, period_label, target_exam) values ($1, $2, $3, 'YKS 2027', 'TYT') returning id`, [elif, tmp.curriculumId, course])).rows[0]!.id);
  }, 120_000);

  afterAll(async () => {
    await tmp?.drop();
  });

  it('2024 (PDF): OCR → 5 madde → 4 taslak tarz; tek yıl: plan atlanır', async () => {
    const { res, ctx } = await ingest(2024, await upload('pdf', samplePdf(), 'application/pdf'));
    expect(res).toMatchObject({ status: 'clustered', pages: 1, items: 5, extracted: 5, embedded: false, plan: { status: 'skipped', reason: 'insufficient_years' } });
    expect(res.library).toMatchObject({ items: 5, clusters: 4, method: 'tfidf', created: 4, reused: 0, named_by_model: 4 });
    const routes = ctx.transport.requests.map((r) => r.route);
    expect(routes.filter((r) => r === 'exam_page_items')).toHaveLength(1);
    expect(routes.filter((r) => r === 'exam_item_extract')).toHaveLength(5);
    expect(routes.filter((r) => r === 'style_definition')).toHaveLength(1);
    expect(ctx.enqueued.map((e) => e.name)).toEqual(['style.coverage.refresh']);
    const items = (await q(`select item_no, kind, topic, skill_ids, year, term, ocr_text is not null as has_text from public.exam_items where source_id = $1 order by item_no`, [sources[2024]])).rows;
    expect(items.map((i) => [i.item_no, i.kind, i.year, i.term])).toEqual([1, 2, 3, 4, 5].map((n) => [n, 'calc', 2024, 'final']));
    expect(items[0]!.skill_ids).toEqual(['tyt.mat.temel.rasyonel-sayilar']);
    const styles = (await q(`select code, name, status, source from public.question_styles where course_id = $1 order by code`, [course])).rows;
    expect(styles.map((s) => s.code)).toEqual(ARCHIVE.styles.map((s) => s.code).sort());
    for (const s of styles) expect(s).toMatchObject({ status: 'draft', source: 'extracted' });
    const up = (await q('select status from public.uploads where id = any($1::uuid[])', [payloads[2024]!.upload_ids])).rows;
    expect(up.map((u) => u.status)).toEqual(['ready']);
  });

  it('2025 (fotoğraf): 10 madde, yeni tarz yok, maddeler var olan tarzlara; öncelik planı pending_review; skor SQL = TS', async () => {
    const png = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const { res } = await ingest(2025, await upload('photo', png, 'image/png'));
    expect(res.library).toMatchObject({ items: 10, clusters: 4, created: 0, reused: 4, moved: 5 });
    expect(res.plan).toMatchObject({ status: 'computed', rows: 4, evidence: 10 });
    const by = (await q(
      `select qs.code, qs.years_hit, qs.syllabus_score::float8 as a, qs.priority_score::float8 as score, count(ei.id)::int as n
         from public.question_styles qs left join public.exam_items ei on ei.style_id = qs.id
        where qs.course_id = $1 group by qs.id order by qs.code`,
      [course],
    )).rows;
    const expectN = new Map(ARCHIVE.styles.map((s) => [s.code, ARCHIVE.sources.flatMap((x) => x.items).filter((i) => i.style === s.key).length]));
    for (const s of by) {
      expect(s.n, s.code).toBe(expectN.get(s.code));
      expect(styleScore({ yearsHit: s.years_hit.map(Number), archiveYears: [2024, 2025], alignment: Number(s.a) }).score, s.code).toBeCloseTo(Number(s.score), 4);
    }
    const plan = (await q(`select status, plan from public.exam_priority_plans where course_id = $1 order by created_at desc limit 1`, [course])).rows[0]!;
    expect(plan.status).toBe('pending_review');
    const rows = plan.plan.rows as { topic: string; hits: number; years: number }[];
    expect(rows.map((r) => r.hits)).toEqual([3, 3, 3, 1]);
    expect(rows[3]!.topic).toBe('Tabloda verilen indirim problemi');
    expect(JSON.stringify(plan.plan)).not.toMatch(/tahmin|çıkacak|kesin/iu);
  });

  it('yeniden çalıştırma: OCR ve adlandırma yinelenmez (ücretli çağrı yok)', async () => {
    const ctx = jobCtx({ db: tmp.pool, storage: () => storage, now: () => new Date() });
    const res = (await getJob('style.ingest')!.handler!(payloads[2025]!, ctx)) as StyleIngestResult;
    expect(res.library).toMatchObject({ created: 0, reused: 4, moved: 0 });
    expect(ctx.transport.requests).toHaveLength(0);
  });

  it('style.coverage.refresh: öğrenci yenilemesi + öncelikli 3 tarz için üretim', async () => {
    const ctx = jobCtx({ db: tmp.pool, now: () => new Date() });
    const res = (await getJob('style.coverage.refresh')!.handler!({ course_id: course }, ctx)) as StyleCoverageRefreshResult;
    expect(res).toMatchObject({ enrollments: 1, students_refreshed: 1 });
    expect(res.generation_enqueued).toHaveLength(3);
    expect(ctx.enqueued.filter((e) => e.name === 'suggestions.refresh').map((e) => e.data)).toEqual([{ student_id: elif, reason: 'style.coverage' }]);
    expect(ctx.enqueued.filter((e) => e.name === 'style.question_gen')).toHaveLength(3);
  });

  it('style.question_gen: SymPy doğrulanmış 3 soru style_id ile bankada; ikinci çalıştırma yinelemez', async () => {
    const styleId = String((await q(`select id from public.question_styles where course_id = $1 and code = 'kesir-islem-onceligi'`, [course])).rows[0]!.id);
    const ctx = jobCtx({ db: tmp.pool, storage: () => storage, now: () => new Date() });
    const res = (await getJob('style.question_gen')!.handler!({ style_id: styleId, count: 3, enrollment_id: enr }, ctx)) as StyleQuestionGenResult;
    expect(res).toMatchObject({ status: 'generated', returned: 3, verified: 3, inserted: 3 });
    const req = ctx.transport.requests.find((r) => r.route === 'style_question_gen')!;
    const sent = JSON.stringify(req.body.messages);
    for (const it of ARCHIVE.sources.flatMap((s) => s.items)) expect(sent).not.toContain(it.text.slice(0, 40)); // çıkmış soru metni gönderilmez
    const qs = (await q(
      `select q.status, q.source, q.style_id, q.skill_ids, k.sympy_status from public.questions q join secure.answer_keys k on k.question_id = q.id
        where q.style_id = $1 order by q.created_at`,
      [styleId],
    )).rows;
    expect(qs).toHaveLength(3);
    for (const r of qs) expect(r).toMatchObject({ status: 'approved', source: 'llm', style_id: styleId, sympy_status: 'verified', skill_ids: ['tyt.mat.temel.rasyonel-sayilar'] });
    expect(ctx.enqueued.map((e) => e.name)).toEqual(['suggestions.refresh']);
    const again = (await getJob('style.question_gen')!.handler!({ style_id: styleId, count: 3 }, jobCtx({ db: tmp.pool, now: () => new Date() }))) as StyleQuestionGenResult;
    expect(again).toMatchObject({ inserted: 0, reused: 3 });
    expect(Number((await q('select count(*) from public.questions where style_id = $1', [styleId])).rows[0]!.count)).toBe(3);
  });

  it('Bugün: etkin tarz + bankada soru → "Bu tarzı hiç çözmedin" kartı (payload.style_id); öğrenci görünümünde soru metni yok', async () => {
    await asUser(INSTRUCTOR, 'select public.upsert_question_styles($1::uuid, $2::jsonb) as r', [course, JSON.stringify([{ code: 'kesir-islem-onceligi', status: 'active' }])]);
    const styleId = String((await q(`select id from public.question_styles where course_id = $1 and code = 'kesir-islem-onceligi'`, [course])).rows[0]!.id);
    const ctx = jobCtx({ db: tmp.pool, now: () => new Date() });
    await getJob('suggestions.refresh')!.handler!({ student_id: elif, reason: 'test' }, ctx);
    const card = (await q(`select kind, title, subtitle, payload from public.suggestions where student_id = $1 and payload ->> 'style_id' = $2`, [elif, styleId])).rows[0];
    expect(card).toMatchObject({ kind: 'practice', title: 'Kesirlerle işlem önceliği', subtitle: 'Bu tarzı hiç çözmedin · 8 soru · 12 dk' });
    expect(card!.payload).toMatchObject({ skill_ids: ['tyt.mat.temel.rasyonel-sayilar'], reason: 'style_gap', count: 8 });
    const view = await asUser<Record<string, unknown>>(ELIF_PROFILE, 'select public.style_library_view($1::uuid) as r', [course]);
    expect(view.role).toBe('student');
    const text = JSON.stringify(view);
    for (const it of ARCHIVE.sources.flatMap((s) => s.items)) expect(text).not.toContain(it.text.slice(0, 30));
    expect(text).toContain('Bu tarzı hiç çözmedin');
  });
});
