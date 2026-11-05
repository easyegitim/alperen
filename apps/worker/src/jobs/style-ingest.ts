/**
 * `style.ingest` — çıkmış sınav alımı ve tarz kütüphanesi (docs/PLAN-v2.md §11; P4). `public.ingest_exam_source` (0037)
 * kuyruğa atar: {source_id, course_id, year, term, upload_ids}. Sıra:
 *
 *   1. sayfalar   Storage'dan dosyalar; PDF → pdftoppm sayfaları; sharp normalleştirme; Files API (styles/pages.ts)
 *   2. OCR        exam_page_items (Sonnet; sayfa başına, 4 paralel; arşiv satırı `archivePageUserText`) → sayfalar arası
 *                 birleştirme (exam/merge.ts)
 *   3. madde      exam_item_extract (Sonnet; madde başına, exam-item v2: konu, tür, biçim, tuzak, zorluk, puan, kazanımlar)
 *                 → register_exam_items (kaynak ocr_done). Model maddeyi reddeder ya da şemaya uymazsa madde OCR
 *                 bilgisiyle yazılır (konu/kazanım boş). Gömme: VOYAGE_API_KEY varsa (styles/embed.ts), yoksa atlanır.
 *   4. kümeleme   dersin bütün maddeleri (styles/cluster.ts: gömme ya da tf-idf kosinüs + aynı-kazanım bonusu) → var olan
 *                 tarzlarla eşleme → yeni kümeler style_definition (Sonnet) ile adlandırılır → upsert_question_styles
 *                 (worker taslak yazar; eğitmenin onayladığı tarz korunur; kaynaklar clustered)
 *   5. plan       compute_priority_plan (≥ 2 yıllık arşiv; yoksa atlanır) → pending_review plan (eğitmen onaylar)
 *   6. kapsama    'style.coverage.refresh' {course_id} (dersin öğrencileri: Bugün kartı, tarz bankası ön ısıtma)
 *
 * Yeniden deneme: OCR ve madde çıktıları stash'tedir (styles/stash.ts, audit.events 'style.stash'); maddeler yazıldıysa
 * (kaynak ocr_done/clustered) 1–3 atlanır. Kalıcı hata ya da son deneme: kaynak 'failed' (yalnız henüz maddesi yoksa),
 * dosyalar 'failed'. Ücretli çağrı gerçek taşımada check_spend('style.ingest') ile denetlenir; tavan kapalıysa kaynak
 * düşürülmez, iş 6 saat sonrasına ertelenir (SpendBlockedError).
 * Çıkmış soru metni (ocr_text) yalnız exam_items'ta ve bu işin model çağrılarındadır; öğrenciye giden hiçbir çıktıya girmez.
 */
import { z } from 'zod';
import type { ExamItem } from '@ogrenmen/contracts';
import { classifyError, ParseError, RefusalError, type Gateway } from '@ogrenmen/llm';
import { loadUploads } from '../exam/db.js';
import { mergeBookletPages, type BookletPage, type MergedQuestion } from '../exam/merge.js';
import { mapLimit } from '../exam/util.js';
import type { StorageLike } from '../storage.js';
import { computePlan, loadSource, markSourceFailed, registerExamItems, type ItemPayload, type PlanOutcome } from '../styles/db.js';
import { embedTexts } from '../styles/embed.js';
import { rebuildLibrary, type LibraryResult } from '../styles/library.js';
import { withCourseLibraryLock } from '../styles/lock.js';
import { extractItem, readArchivePage, type StyleCallEnv } from '../styles/llm.js';
import { loadArchivePages, type PdfRasterizer } from '../styles/pages.js';
import { stashed } from '../styles/stash.js';
import { debounced } from './dedupe.js';
import { PermanentJobError } from './errors.js';
import { uuid } from './schemas.js';
import type { JobContext, JobDefinition } from './types.js';

export const OCR_CONCURRENCY = 4;
export const EXTRACT_CONCURRENCY = 6;

const payload = z
  .object({
    source_id: uuid,
    course_id: uuid.optional(),
    year: z.number().int().optional(),
    term: z.string().max(20).optional(),
    upload_ids: z.array(uuid).max(60).optional(),
  })
  .passthrough();
export type StyleIngestPayload = z.infer<typeof payload>;

/** Testler PDF bölücüyü ve gömmeyi değiştirebilir. */
export interface StyleIngestHooks {
  rasterize?: PdfRasterizer;
  embed?: typeof embedTexts;
}
export const styleIngestHooks: StyleIngestHooks = {};

export interface StyleIngestResult {
  source_id: string;
  course_id: string;
  status: string;
  pages?: number;
  items?: number;
  extracted?: number;
  embedded?: boolean;
  library?: LibraryResult;
  plan?: PlanOutcome;
  warnings: string[];
  cost_usd: number;
}

function safeStorage(ctx: JobContext): StorageLike | null {
  try {
    return ctx.storage();
  } catch {
    return null;
  }
}

/**
 * Harcama tavanı ücretli çağrıyı kapattı. Kalıcı hata değildir: kaynak ve dosyaları düşürülmez ('uploaded' kalır),
 * iş SPEND_RETRY_AFTER_SEC sonra yeniden kuyruğa girer (eğitmenin yüklemesi kaybolmaz).
 */
export class SpendBlockedError extends Error {
  constructor(readonly state: string) {
    super(`ücretli LLM çağrısı kapalı (${state})`);
    this.name = 'SpendBlockedError';
  }
}
export const SPEND_RETRY_AFTER_SEC = 6 * 3600;

async function paidGateway(ctx: JobContext): Promise<Gateway> {
  const gateway = await ctx.gateway();
  if (gateway.transport.kind !== 'fake') {
    const r = await ctx.db.query(`select paid_allowed, state from public.check_spend('style.ingest')`).catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const row = r.rows[0] as { paid_allowed?: boolean; state?: string } | undefined;
    if (row && row.paid_allowed === false) throw new SpendBlockedError(row.state ?? 'tavan');
  }
  return gateway;
}

const KIND_FROM_OCR: Record<string, ItemPayload['kind']> = { mcq: 'mc', numeric: 'calc', open: 'other' };

/** Madde metni: kök + şıklar (her biri yeni satırda harfiyle). */
export function itemText(q: Pick<MergedQuestion, 'stem_text' | 'options'>): string {
  return [q.stem_text.trim(), ...q.options.map((o) => `${o.key}) ${o.text}`)].join('\n').trim();
}

/** Model çıktısı + OCR → register_exam_items maddesi (kaynak kimliği, numara, yıl ve metin OCR'dan; model yalnız sınıflar). */
export function toItemPayload(q: MergedQuestion, year: number, x: ExamItem | null): ItemPayload {
  const skills = x ? [...new Set([...(x.skill_id ? [x.skill_id] : []), ...(x.skill_ids ?? [])])].slice(0, 5) : [];
  return {
    item_no: q.no,
    topic: x?.topic?.trim() ? x.topic.trim().slice(0, 120) : null,
    kind: x?.kind ?? KIND_FROM_OCR[q.kind] ?? 'other',
    format: x?.format ?? (q.figures.length > 0 ? 'other' : null),
    trick: x?.trick?.trim() ? x.trick.trim().slice(0, 200) : null,
    difficulty: typeof x?.difficulty === 'number' ? Math.min(1, Math.max(0, x.difficulty)) : null,
    points: typeof x?.points === 'number' ? x.points : null,
    year,
    skill_ids: skills,
    ocr_text: itemText(q).slice(0, 20000),
  };
}

async function readAndRegister(ctx: JobContext, env: StyleCallEnv, src: NonNullable<Awaited<ReturnType<typeof loadSource>>>, out: StyleIngestResult): Promise<void> {
  const uploads = await loadUploads(ctx.db, src.upload_ids);
  if (uploads.length === 0) throw new PermanentJobError('kaynağın dosyası yok', 'OGR-JOB-170');
  const storage = safeStorage(ctx);
  const { pages, warnings } = await loadArchivePages({
    gateway: env.gateway, storage, uploads, sourceId: src.id, signal: ctx.signal,
    ...(styleIngestHooks.rasterize ? { rasterize: styleIngestHooks.rasterize } : {}),
  });
  out.warnings.push(...warnings);
  out.pages = pages.length;
  if (pages.length === 0) throw new PermanentJobError('okunacak sayfa yok', 'OGR-JOB-171');

  const read = await mapLimit(pages, OCR_CONCURRENCY, async (p) =>
    stashed(ctx.db, src.id, `ocr:${p.order}:${p.fileId}`, async () => {
      try {
        const r = await readArchivePage(env, p, { year: src.year, term: src.term });
        out.cost_usd += r.costUsd;
        return { items: r.data.unreadable ? [] : r.data.items, unreadable: r.data.unreadable === true };
      } catch (err) {
        if (err instanceof RefusalError || err instanceof ParseError) return { items: [], unreadable: true };
        throw err;
      }
    }),
  );
  const unreadable = read.filter((r) => r.value.unreadable).length;
  if (unreadable > 0) out.warnings.push(`${unreadable} sayfa okunamadı`);
  const booklet: BookletPage[] = pages.map((p, i) => ({ uploadId: p.uploadId, order: p.order, printedPage: null, sectionHint: null, items: read[i]!.value.items }));
  const merged = mergeBookletPages(booklet);
  out.warnings.push(...merged.warnings.slice(0, 10));
  const questions = merged.questions.filter((q) => q.stem_text.trim().length > 0 || q.options.length > 0);
  if (questions.length === 0) throw new PermanentJobError('sayfalarda soru okunamadı', 'OGR-JOB-172');

  let extracted = 0;
  const items = await mapLimit(questions, EXTRACT_CONCURRENCY, async (q) => {
    const x = await stashed(ctx.db, src.id, `item:${q.no}`, async () => {
      try {
        const r = await extractItem(env, {
          sourceId: src.id, itemNo: q.no, year: src.year, term: src.term === 'meb' ? 'diger' : src.term, section: q.section, kindHint: q.kind,
          text: q.stem_text, options: q.options, figures: q.figures.map((f) => f.description), legibility: q.legibility,
        });
        out.cost_usd += r.costUsd;
        return { item: r.data as ExamItem | null };
      } catch (err) {
        if (err instanceof RefusalError || err instanceof ParseError) return { item: null };
        throw err;
      }
    });
    if (x.value.item) extracted++;
    return toItemPayload(q, src.year, x.value.item);
  });
  out.extracted = extracted;

  const emb = await (styleIngestHooks.embed ?? embedTexts)(items.map((i) => i.ocr_text), process.env, fetch, ctx.signal).catch((err: unknown) => {
    ctx.log.warn('style.ingest: gömme alınamadı; kümeleme tf-idf ile', { source: src.id, error: (err as Error).message });
    return null;
  });
  out.embedded = emb !== null;
  if (emb) items.forEach((it, i) => (it.embedding = emb.vectors[i] ?? null));
  try {
    const reg = await registerExamItems(ctx.db, src.id, items);
    out.items = reg.item_count;
  } catch (err) {
    const msg = (err as Error).message;
    // kazanım müfredatta yoksa (model kodu uydurdu): kazanımsız yeniden yaz, kaynak düşmesin
    if (!/OGR-CURR-001/.test(msg)) throw err;
    out.warnings.push('bilinmeyen kazanım kodları atıldı');
    const reg = await registerExamItems(ctx.db, src.id, items.map((it) => ({ ...it, skill_ids: [] })));
    out.items = reg.item_count;
  }
}

export async function runStyleIngest(p: StyleIngestPayload, ctx: JobContext): Promise<StyleIngestResult> {
  const src = await loadSource(ctx.db, p.source_id);
  if (!src) throw new PermanentJobError(`kaynak yok: ${p.source_id}`, 'OGR-JOB-173');
  const out: StyleIngestResult = { source_id: src.id, course_id: src.course_id, status: src.status, warnings: [], cost_usd: 0 };
  if (src.status === 'failed') return { ...out, status: 'failed', warnings: ['kaynak düşmüş; yeniden yükleme gerekir'] };
  let gateway: Gateway;
  try {
    gateway = await paidGateway(ctx);
  } catch (err) {
    if (!(err instanceof SpendBlockedError)) throw err;
    // tavan: kaynak olduğu gibi kalır, iş ertelenir (aynı kaynak için tek bekleyen iş)
    const again = await ctx
      .enqueue('style.ingest', { ...p, reason: 'spend_blocked' }, { startAfter: SPEND_RETRY_AFTER_SEC, singletonKey: `style-ingest-spend:${src.id}`, singletonSeconds: SPEND_RETRY_AFTER_SEC })
      .catch((e: unknown) => {
        ctx.log.warn('style.ingest: ertelenen iş kuyruğa atılamadı', { source: src.id, error: (e as Error).message });
        return null;
      });
    ctx.log.warn('style.ingest: harcama tavanı; kaynak bekletildi', { source: src.id, state: err.state, retry_job: again });
    return { ...out, status: src.status, warnings: [`${err.message}; kaynak bekletildi, ${SPEND_RETRY_AFTER_SEC / 3600} saat sonra yeniden denenecek`] };
  }
  const env: StyleCallEnv = {
    db: ctx.db, gateway, courseId: src.course_id, curriculumId: src.curriculum_id, ref: { table: 'exam_sources', id: src.id },
    studentRef: null, purpose: 'style.ingest', now: ctx.now, signal: ctx.signal,
  };
  if (src.status === 'uploaded') await readAndRegister(ctx, env, src, out);

  // aynı dersin iki kütüphane kurulumu sıralanır: ikincisi birincinin yazdığı tarzları ve maddeleri görür (kod çakışmaz)
  const rebuilt = await withCourseLibraryLock(ctx.db, src.course_id, async () => {
    const library = await rebuildLibrary({ env, courseCode: src.course_code, courseTitle: src.course_title, log: ctx.log });
    const plan = await computePlan(ctx.db, src.course_id);
    return { library, plan };
  });
  out.library = rebuilt.library;
  out.cost_usd += out.library.cost_usd;
  out.plan = rebuilt.plan;
  try {
    await ctx.enqueue('style.coverage.refresh', { course_id: src.course_id, reason: 'style.ingest' }, debounced(`style-coverage:${src.course_id}`, 60));
  } catch (err) {
    ctx.log.warn('style.coverage.refresh kuyruğa atılamadı', { course: src.course_id, error: (err as Error).message });
  }
  const st = await ctx.db.query('select status from public.exam_sources where id = $1::uuid', [src.id]);
  out.status = String(st.rows[0]?.status ?? src.status);
  out.cost_usd = Number(out.cost_usd.toFixed(6));
  ctx.log.info('style.ingest: kaynak işlendi', {
    source: src.id, course: src.course_id, pages: out.pages ?? null, items: out.items ?? null, clusters: out.library.clusters,
    created: out.library.created, reused: out.library.reused, method: out.library.method, plan: out.plan.status, costUsd: out.cost_usd,
  });
  return out;
}

const RETRY = { retryLimit: 3, retryDelay: 30, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 1800, deleteAfterSeconds: 7 * 86_400 };

export const styleIngestJob: JobDefinition<StyleIngestPayload, StyleIngestResult> = {
  name: 'style.ingest',
  description: 'Çıkmış sınav alımı: sayfalar → OCR → exam-item v2 → kümeleme → tarz adlandırma → tarzlar → öncelik planı → kapsama yenilemesi.',
  process: 'worker',
  payload,
  concurrency: 2,
  retry: RETRY,
  handler: async (p, ctx) => {
    try {
      return await runStyleIngest(p, ctx);
    } catch (err) {
      const c = classifyError(err);
      const last = err instanceof PermanentJobError || ctx.job.retryCount >= RETRY.retryLimit || (c.code !== 'unknown' && !c.retryable);
      if (last) {
        await markSourceFailed(ctx.db, p.source_id, (err as Error).message).catch((e: unknown) =>
          ctx.log.error('style.ingest: kaynak düşmüş olarak işaretlenemedi', { source: p.source_id, error: (e as Error).message }),
        );
        ctx.log.error('style.ingest: kaynak işlenemedi', { source: p.source_id, error: (err as Error).message });
        if (!(err instanceof PermanentJobError)) throw new PermanentJobError((err as Error).message.slice(0, 300), 'OGR-JOB-174');
      }
      throw err;
    }
  },
};
