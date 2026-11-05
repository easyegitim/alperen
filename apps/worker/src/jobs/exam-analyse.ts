/**
 * `exam.analyse` — yüklenen okul denemesinin analizi (docs/PLAN-v2.md §2 Akış 2a, §8). `submit_exam_upload` RPC'si (ve
 * eski yol `upload.intake` school_exam) kuyruğa atar: {session_id, exam_id, enrollment_id?, student_id?, upload_ids}.
 * Aşamalar ve progress alanları: src/exam/stages.ts. Sıra:
 *
 *   1. alım       Storage'dan sayfa → sharp (EXIF, eğrilik, ≤ 2576 px, JPEG q85); geometri değiştiyse türev yükleme
 *                 (`<sahip>/exam-<oturum>/page-<n>.jpg`, kind photo); Files API (`anthropic_file_id`)
 *   2. classify   page_class (Haiku, ≤ 8 paralel): kitapçık | optik | karalama | anahtar | diğer; 90/180/270 döndürme
 *                 uygulanır; okunamayan sayfa uyarıdır (progress.pages_unreadable), hat sürer. Modelin tek bir sayfadaki
 *                 reddi ya da şemaya uymayan çıktısı (onarım turundan sonra) da o sayfayı okunamaz sayar (stash'e
 *                 {unreadable, error} yazılır; yeniden deneme yeniden ödemez); sınav düşmez
 *   3. ocr        exam_page_items (Sonnet, 6 paralel) → birleştirme (exam/merge.ts) → şekil kırpımı (uploads photo,
 *                 exam_questions.figure_upload_id) → kazanım eşleme (exam/skills.ts) → register_exam_questions
 *   4. key        yüklenen anahtar sayfası (answer_sheet rotası) > yayıncı eşleşmesi (exam/db.ts publisherMatch: aynı
 *                 yayınevi + başlık + soru kökleri; yalnız yayımlanmış sınavın eğitmen/üretilmiş anahtarı ya da öğrencinin
 *                 kendi önceki yüklemesi) > inferred_keys (Opus + code_execution; eksik kalan sorular için de)
 *                 → set_exam_keys (kaynak, güven). Güven < 0,8 → progress.key_low_confidence (UI "anahtar doğrulanmadı";
 *                 SQL set_exam_keys.unverified ile aynı eşik). Çıkarım düşerse sorular anahtarsız kalır (key_missing)
 *   5. grade      answer_sheet (optik; çift işaret boş + not) → record_exam_answers → grade_exam_session (gözlemler,
 *                 ustalık, bölüm netleri; oturum analysing); hattın beklediği netle karşılaştırılır
 *   6. report     exam_report (Sonnet) → doc-render PDF → Storage documents → register_generated_document → done
 *   7. bildirim   Bugün 'upload_result' kartı ("Örnek Deneme 1: 5,5 net. Takıldığın yer: Üslü ifadeler.") + veli
 *                 notifications ("…: 5,5 net. En çok zorlandığı konu: Üslü ifadeler."; gönderim P6) + karalama sayfası varsa yanlış/boşlar için deneme bağlamlı diagnosis.run
 *                 (en çok EXAM_AUTO_DIAGNOSIS_MAX, varsayılan 10); yoksa öğrenci sonuç ekranında "Nereye kadar geldim?"
 *
 * Yeniden deneme: her ücretli adımın çıktısı stash'tedir (exam/stash.ts); sorular kaydedildikten sonra 'plan' stash'i
 * (sayfa türleri + model referansları + sorular) alım/sınıflama/kırpım/kayıt adımlarını atlatır (Batch beklemesi
 * dahil). Oturum analysing ise yalnız rapor ve bildirim: önceki koşunun uyarıları, maliyeti ve karalama referansları
 * stash'ten okunur. Son yazımı (progress.diagnoses_queued) olmayan done oturum da yalnız rapor ve bildirimden sürer
 * (rapor belgesi yeniden üretilmez). Maliyet ve yayıncı eşleşmesi öğrencinin okuduğu progress'e değil stash'e ('run_meta') yazılır.
 * PDF yükleme okul denemesinde kabul edilmez (OGR-EXAM-104 "fotoğraf olarak yükle"; sayfa bölme yok).
 * Okuma hatası (kitapçık/optik form yok ya da okunamadı) → set_exam_progress('failed') + "Fotoğrafı okuyamadım" kartı;
 * başka kalıcı hata ya da son deneme → failed + "Yüklemeni şu an işleyemedim".
 */
import { z } from 'zod';
import type { AnswerSheet, ExamPageItems, InferredKeys, PageClass } from '@ogrenmen/contracts';
import { classifyError, ParseError, RefusalError } from '@ogrenmen/llm';
import type { InferredKeysItem } from '@ogrenmen/prompts';
import {
  enqueueExamDiagnoses,
  ensureDerivedUpload,
  gradeSession,
  loadLeaves,
  loadReportData,
  loadSession,
  loadUploads,
  notifyParents,
  publisherMatch,
  recordAnswers,
  registerQuestions,
  setFileId,
  setKeys,
  setProgress,
  type PageUpload,
  type RegisterItem,
  type SessionRow,
} from '../exam/db.js';
import { answersFromSheets, expectedScore, KEY_LOW_CONFIDENCE, keysFromKeyPage, validateKeys, type AnswerRow, type KeyRow } from '../exam/grading.js';
import { cropBox, normalizePage, rotatePage, type NormalizedPage } from '../exam/images.js';
import { classifyPage, inferKeys, readAnswerSheet, readBookletPage, readKeyPage, submitInferKeysBatch, uploadFile, type ExamCallContext, type PageRef } from '../exam/llm.js';
import { mergeBookletPages, type MergedQuestion } from '../exam/merge.js';
import { produceReport, tryStorage } from '../exam/produce-report.js';
import { examCardLine, examParentLine } from '../exam/report.js';
import { tagQuestions } from '../exam/skills.js';
import { resumePlan, runsStage, WARNING_CODES, warningsText, type WarningCode } from '../exam/stages.js';
import { stashed, stashGet, stashPut } from '../exam/stash.js';
import { mapLimit } from '../exam/util.js';
import { refKey } from '../suggestions/rules.js';
import { UPLOAD_BUCKET, writeUploadCard } from './diagnosis.js';
import { PermanentJobError } from './errors.js';
import { uuid } from './schemas.js';
import type { JobContext, JobDefinition } from './types.js';

export const MAX_EXAM_PAGES = 40;
export const CLASSIFY_CONCURRENCY = 8;
export const OCR_CONCURRENCY = 6;
export const INTAKE_CONCURRENCY = 4;
/** Sınıflama güveni bunun altındaysa sayfa "bilinmiyor" sayılır. */
export const PAGE_MIN_CONFIDENCE = 0.4;

const payload = z.object({
  session_id: uuid,
  exam_id: uuid,
  enrollment_id: uuid.optional(),
  student_id: uuid.optional(),
  upload_ids: z.array(uuid).min(1).max(MAX_EXAM_PAGES),
});
export type ExamAnalysePayload = z.infer<typeof payload>;

export interface ExamAnalyseResult {
  sessionId: string;
  status: string;
  skipped?: string;
  questions?: number;
  keySource?: string | null;
  net?: number;
  documentId?: string | null;
  reportFallback?: boolean;
  diagnosesQueued?: number;
  warnings: string[];
}

/** Okuma hatası (öğrencinin yeniden çekmesi gerekir): kitapçık/optik form yok ya da okunamadı. */
export class ExamReadError extends PermanentJobError {
  constructor(message: string, code: string, readonly userLine: string) {
    super(message, code);
  }
}

/** Kartı ve failed durumu yazılmış hata (dış yakalayıcı ikinci kez yazmaz). */
class FailedExamError extends PermanentJobError {}

interface Page {
  upload: PageUpload;
  order: number;
  total: number;
  /** Normalleştirilmiş görüntü (Storage yoksa null; PDF'te null). */
  image: NormalizedPage | null;
  ref: PageRef;
}

interface Run {
  ctx: JobContext;
  s: SessionRow;
  ec: ExamCallContext;
  warnings: Set<WarningCode>;
  details: string[];
  costUsd: number;
}

function warn(run: Run, code: WarningCode, detail?: string): void {
  run.warnings.add(code);
  if (detail) run.details.push(detail);
}

/** Onarım turundan sonra da şemaya uymayan çıktı ya da ret: sayfa okunamaz sayılır (yeniden denemek işe yaramaz). */
export function badModelOutput(err: unknown): 'refusal' | 'bad_output' | null {
  if (err instanceof RefusalError) return 'refusal';
  if (err instanceof ParseError) return 'bad_output';
  return null;
}

/** Sayfa başına ücretli çağrı: model düşerse `unreadable` değeri (hata etiketiyle) döner ve stash'e öyle yazılır. */
async function pageCall<T extends object>(run: Run, label: string, make: () => Promise<{ data: T; costUsd: number }>, unreadable: T): Promise<T> {
  try {
    const r = await make();
    run.costUsd += r.costUsd;
    return r.data;
  } catch (err) {
    const why = badModelOutput(err);
    if (!why) throw err;
    run.ctx.log.warn('model sayfayı okuyamadı; sayfa okunamaz sayıldı', { session: run.s.id, page: label, error: (err as Error).message });
    return { ...unreadable, unreadable: true, error: why };
  }
}

const UNREADABLE_CLASS: PageClass = {
  page_class: 'other',
  confidence: 0,
  rotation_degrees: 0,
  question_numbers_seen: [],
  has_figures: false,
  section_hint: null,
  printed_page_number: null,
  unreadable: true,
};
const UNREADABLE_ITEMS: ExamPageItems = { items: [], page_notes: null, unreadable: true };
const UNREADABLE_SHEET: AnswerSheet = { booklet_type: 'unknown', answers: [], unreadable: true };

/**
 * Önce ilk çağrı tek başına, sonra kalanı sınırlı paralel. Aynı önek (sistem metni) eşzamanlı isteklerde önbelleğe
 * yazılmaz: ilk çağrı yazar, kalanı okur (claude-api prompt-caching, eşzamanlı istekler önbelleği paylaşmaz).
 */
async function warmMap<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (items.length <= 1) return mapLimit(items, limit, fn);
  const head = await fn(items[0]!, 0);
  const tail = await mapLimit(items.slice(1), limit, (item, i) => fn(item, i + 1));
  return [head, ...tail];
}

function sessionDir(s: SessionRow): string {
  return `exam-${s.id}`;
}

/** 1. alım: indir → normalleştir → (geometri değiştiyse) türev yükleme → Files API. */
async function preparePages(run: Run, uploads: PageUpload[]): Promise<Page[]> {
  const { ctx, ec } = run;
  const storage = tryStorage(ctx);
  if (!storage && ec.gateway.transport.kind !== 'fake') throw new PermanentJobError('Storage yapılandırılmadı: sayfalar okunamaz', 'OGR-JOB-151');
  const total = uploads.length;
  return mapLimit(uploads, INTAKE_CONCURRENCY, async (u, i) => {
    const order = i + 1;
    const isPdf = u.mime === 'application/pdf' || u.kind === 'pdf';
    let image: NormalizedPage | null = null;
    let refId = u.id;
    let bytes: Buffer | null = null;
    if (storage) {
      const raw = await storage.download(UPLOAD_BUCKET, u.storage_path);
      bytes = raw;
      if (!isPdf) {
        image = await normalizePage(raw);
        bytes = image.bytes;
        if (image.geometryChanged) refId = await storeDerived(run, u, `page-${order}.jpg`, image);
      }
    }
    const mime = isPdf ? 'application/pdf' : 'image/jpeg';
    const fileId = await fileIdFor(run, refId, u, bytes, mime, refId === u.id && !image?.resized);
    return { upload: u, order, total, image, ref: { refId, order, total, mime, fileId } };
  });
}

async function storeDerived(run: Run, u: PageUpload, name: string, img: { bytes: Buffer; width: number; height: number }, mime = 'image/jpeg'): Promise<string> {
  const storage = tryStorage(run.ctx)!;
  const path = `${u.owner_id}/${sessionDir(run.s)}/${name}`;
  await storage.upload(UPLOAD_BUCKET, path, img.bytes, mime);
  return ensureDerivedUpload(run.ctx.db, { owner_id: u.owner_id, student_id: u.student_id, storage_path: path, mime, bytes: img.bytes.length, width: img.width, height: img.height });
}

/** Files API kimliği: türev/orijinal satırında saklıysa yeniden kullanılır (orijinal yalnız içerik aynıysa). */
async function fileIdFor(run: Run, refId: string, u: PageUpload, bytes: Buffer | null, mime: string, reuseOriginal: boolean): Promise<string> {
  if (refId === u.id && reuseOriginal && u.anthropic_file_id) return u.anthropic_file_id;
  if (refId !== u.id) {
    const r = await run.ctx.db.query('select anthropic_file_id from public.uploads where id = $1::uuid', [refId]);
    const prev = r.rows[0]?.anthropic_file_id;
    if (prev) return String(prev);
  }
  const fileId = await uploadFile(run.ec.gateway, bytes, `${refId}${mime === 'application/pdf' ? '.pdf' : '.jpg'}`, mime, refId);
  if (run.ec.gateway.transport.kind !== 'fake') await setFileId(run.ctx.db, refId, fileId);
  return fileId;
}

/** 2. classify */
async function classify(run: Run, pages: Page[]): Promise<Map<string, PageClass>> {
  const { ctx, s, ec } = run;
  let done = 0;
  const out = new Map<string, PageClass>();
  await setProgress(ctx.db, s.id, 'classify', { pages_total: pages.length, pages_done: 0 });
  await warmMap(pages, CLASSIFY_CONCURRENCY, async (p) => {
    const { value } = await stashed(ctx.db, s.id, `class:${p.upload.id}`, () =>
      pageCall(run, `sınıflama ${p.order}`, () => classifyPage(ec, p.ref, s.exam_title, s.course_title), UNREADABLE_CLASS),
    );
    out.set(p.upload.id, value);
    done += 1;
    await setProgress(ctx.db, s.id, 'classify', { pages_done: done });
  });
  return out;
}

/** Sınıflamanın döndürmesini uygular (görüntü varsa): yeni türev + Files API. */
async function applyRotation(run: Run, p: Page, cls: PageClass): Promise<Page> {
  if (cls.rotation_degrees === 0 || !p.image) return p;
  const img = await rotatePage(p.image, cls.rotation_degrees);
  const refId = await storeDerived(run, p.upload, `page-${p.order}-r${cls.rotation_degrees}.jpg`, img);
  const fileId = await fileIdFor(run, refId, p.upload, img.bytes, 'image/jpeg', false);
  return { ...p, image: img, ref: { ...p.ref, refId, fileId } };
}

/** 3. ocr + birleştirme + kırpım + kazanım + register_exam_questions */
async function readBooklet(run: Run, booklets: { page: Page; cls: PageClass }[]): Promise<MergedQuestion[]> {
  const { ctx, s, ec } = run;
  let done = 0;
  await setProgress(ctx.db, s.id, 'ocr', { booklet_total: booklets.length, booklet_done: 0 });
  const read = await warmMap(booklets, OCR_CONCURRENCY, async ({ page, cls }) => {
    const { value } = await stashed<ExamPageItems>(ctx.db, s.id, `items:${page.upload.id}`, () =>
      pageCall(run, `kitapçık ${page.order}`, () => readBookletPage(ec, page.ref, cls.section_hint), UNREADABLE_ITEMS),
    );
    done += 1;
    await setProgress(ctx.db, s.id, 'ocr', { booklet_done: done });
    return { page, cls, items: value };
  });
  const usable = read.filter((r) => {
    if (r.items.unreadable) warn(run, 'page_unreadable', `kitapçık sayfası ${r.page.order} okunamadı`);
    return !r.items.unreadable && r.items.items.length > 0;
  });
  const merged = mergeBookletPages(
    usable.map((r) => ({ uploadId: r.page.ref.refId, order: r.page.order, printedPage: r.cls.printed_page_number, sectionHint: r.cls.section_hint, items: r.items.items })),
  );
  for (const w of merged.warnings) {
    if (/iki kez/.test(w)) warn(run, 'question_duplicate', w);
    else if (/eksik soru/.test(w)) warn(run, 'question_gap', w);
    else warn(run, 'question_partial', w);
  }
  return merged.questions;
}

/** Şekil kırpımları (ilk şekil soruya bağlanır). */
async function cropFigures(run: Run, questions: MergedQuestion[], pagesByRef: Map<string, Page>): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!tryStorage(run.ctx)) return out;
  for (const q of questions) {
    const f = q.figures[0];
    const page = f ? pagesByRef.get(f.uploadId) : undefined;
    if (!f || !page?.image) continue;
    try {
      const crop = await cropBox(page.image.bytes, f.bbox);
      out.set(q.no, await storeDerived(run, page.upload, `q${q.no}-fig1.png`, crop, 'image/png'));
    } catch (err) {
      run.ctx.log.warn('şekil kırpılamadı', { session: run.s.id, no: q.no, error: (err as Error).message });
    }
  }
  return out;
}

async function registerAll(run: Run, questions: MergedQuestion[], figures: Map<number, string>, previousSkills: Map<number, string[]>): Promise<RegisterItem[]> {
  const leaves = await loadLeaves(run.ctx.db, run.s.curriculum_id);
  const tags = tagQuestions(questions, leaves, previousSkills);
  const untagged = [...tags.source].filter(([, v]) => v === 'none').map(([no]) => no);
  if (untagged.length) warn(run, 'skill_untagged', `kazanımı bulunamayan sorular: ${untagged.join(', ')}`);
  const items: RegisterItem[] = questions.map((q) => ({
    no: q.no,
    section: q.section,
    kind: q.kind,
    stem_text: q.stem_text || null,
    options: q.kind === 'mcq' && q.options.length > 0 ? q.options : null,
    skill_ids: tags.skills.get(q.no) ?? [],
    page_upload_id: q.pageUploadId,
    figure_upload_id: figures.get(q.no) ?? null,
    bbox: q.bbox,
  }));
  await registerQuestions(run.ctx.db, run.s.exam_id, items);
  await setProgress(run.ctx.db, run.s.id, 'ocr', {
    questions: items.length,
    skills_tagged: items.length - untagged.length,
    skills_lexical: [...tags.source.values()].filter((v) => v === 'lexical').length,
  });
  return items;
}

function keyedQuestions(items: readonly RegisterItem[]) {
  return items.map((q) => ({ no: q.no, kind: q.kind as 'mcq' | 'numeric' | 'open', optionKeys: (q.options ?? []).map((o) => o.key) }));
}

/** 4. key */
async function resolveKeys(run: Run, items: RegisterItem[], keyPages: Page[], questions: MergedQuestion[], publisher: Awaited<ReturnType<typeof publisherMatch>>): Promise<{ keys: KeyRow[]; source: string | null }> {
  const { ctx, s, ec } = run;
  await setProgress(ctx.db, s.id, 'key', {});
  const kq = keyedQuestions(items);
  const gradable = kq.filter((q) => q.kind !== 'open').map((q) => q.no);
  const groups: { source: string; keys: KeyRow[] }[] = [];
  const have = new Set<number>();
  const add = (source: string, keys: KeyRow[]) => {
    const fresh = keys.filter((k) => !have.has(k.no));
    fresh.forEach((k) => have.add(k.no));
    if (fresh.length) groups.push({ source, keys: fresh });
  };

  // (a) yüklenen anahtar sayfası
  for (const p of keyPages) {
    const { value } = await stashed<AnswerSheet>(ctx.db, s.id, `keypage:${p.upload.id}`, () =>
      pageCall(run, `anahtar ${p.order}`, () => readKeyPage(ec, p.ref, items.length), UNREADABLE_SHEET),
    );
    if (value.unreadable) {
      warn(run, 'page_unreadable', `anahtar sayfası ${p.order} okunamadı`);
      continue;
    }
    const v = validateKeys(keysFromKeyPage(value), kq);
    v.dropped.forEach((d) => run.details.push(`anahtar sayfası: ${d}`));
    add('uploaded', v.keys);
  }
  // (b) yayıncı anahtarı (aynı yayınevi + başlık)
  if (publisher) {
    for (const src of ['uploaded', 'instructor', 'generated']) {
      // yayıncı anahtarı da (a) gibi denetlenir: eşleşen sınavda soru türü bu kitapçıktan farklıysa (mcq ↔ sayısal) düşer
      const v = validateKeys(
        publisher.keys
          .filter((k) => k.source === src && kq.some((q) => q.no === k.no))
          .map((k) => ({ question_no: k.no, correct_option: k.correct_option, numeric_value: k.numeric_value, confidence: k.confidence })),
        kq,
      );
      v.dropped.forEach((d) => run.details.push(`yayıncı: ${d}`));
      add(src, v.keys);
    }
  }
  // (c) çıkarım: eksik kalan notlanabilir sorular
  const missing = gradable.filter((no) => !have.has(no));
  if (missing.length > 0) {
    const byNo = new Map(questions.map((q) => [q.no, q]));
    const req: InferredKeysItem[] = missing.flatMap((no) => {
      const q = byNo.get(no);
      return q && q.stem_text.trim() ? [{ no, section: q.section, kind: q.kind, stem: q.stem_text, options: q.options, figureDescription: q.figures[0]?.description ?? null }] : [];
    });
    if (req.length > 0) {
      const value = await inferredFor(run, req);
      if (value.error) run.details.push(`çıkarım düştü (${value.error}): ${req.length} soru anahtarsız`);
      const v = validateKeys(value.keys, kq.filter((q) => missing.includes(q.no)));
      v.dropped.forEach((d) => run.details.push(`çıkarım: ${d}`));
      add('inferred', v.keys);
    }
  }
  let result: Awaited<ReturnType<typeof setKeys>> | null = null;
  for (const g of groups) result = await setKeys(ctx.db, s.exam_id, g.keys, g.source);
  const all = groups.flatMap((g) => g.keys.map((k) => ({ ...k, source: g.source })));
  const low = all.filter((k) => k.source === 'inferred' && (k.confidence ?? 0) < KEY_LOW_CONFIDENCE).length;
  if (low > 0) warn(run, 'key_low_confidence', `${low} anahtar düşük güvenle çıkarıldı`);
  const keyedCount = result?.keyed ?? 0;
  if (gradable.length > keyedCount) warn(run, 'key_missing', `anahtarı olmayan soru: ${gradable.length - keyedCount}`);
  await setProgress(ctx.db, s.id, 'key', {
    key_source: result?.answer_key_source ?? null,
    keyed: keyedCount,
    key_unverified: result?.unverified ?? 0,
    key_low_confidence: low,
  });
  // eşleşen sınavın kimliği başka bir öğrencinin olabilir: progress (öğrenci okur) yerine stash
  if (publisher) await stashPut(ctx.db, s.id, 'publisher_match', { exam_id: publisher.examId, keys: publisher.keys.length });
  return { keys: all, source: result?.answer_key_source ?? null };
}

/** Batch'teki anahtar çıkarımı henüz bitmedi: iş kendini sonraya erteler (exam.analyse yeniden kuyruğa). */
export class KeysBatchPending extends Error {
  constructor(readonly batchId: string) {
    super(`anahtar Batch'i sürüyor: ${batchId}`);
  }
}

/** Batch beklemesinin üst sınırı: aşılırsa senkron çıkarıma düşülür. */
export const KEYS_BATCH_MAX_WAIT_MS = 6 * 3600_000;
/** Tek koşudaki Batch yoklaması (testler kısaltır). */
export const KEYS_BATCH_POLL = { intervalMs: 5_000, timeoutMs: 20_000 };

function keysBatchEnabled(run: Run): boolean {
  return process.env.EXAM_KEYS_BATCH === '1' && run.ec.gateway.transport.kind !== 'fake';
}

/**
 * inferred_keys: stash > (EXAM_KEYS_BATCH=1, gerçek taşıma) Batch gönder/yokla/topla > senkron (batchRetry). Batch
 * bitmemişse KeysBatchPending; 6 saati aşarsa ya da öğe düşerse senkron yeniden gönderim.
 */
async function inferredFor(run: Run, req: InferredKeysItem[]): Promise<InferredKeys & { error?: string }> {
  const { ctx, s, ec } = run;
  const key = `inferred:${req.map((r) => r.no).join(',')}`;
  const hit = await stashGet<InferredKeys & { error?: string }>(ctx.db, s.id, key);
  if (hit) return hit;
  let value: (InferredKeys & { error?: string }) | null = null;
  if (keysBatchEnabled(run)) {
    type B = { batch_id: string; meta: Parameters<typeof ec.gateway.collectBatch>[2]; submitted_at: string };
    let b = await stashGet<B>(ctx.db, s.id, `${key}:batch`);
    if (!b) {
      const sub = await submitInferKeysBatch(ec, s.exam_title, req);
      b = { batch_id: sub.batch.id, meta: sub.meta, submitted_at: ctx.now().toISOString() };
      await stashPut(ctx.db, s.id, `${key}:batch`, b);
      await setProgress(ctx.db, s.id, 'key', { key_batch: 'pending' });
    }
    const ended = await ec.gateway.pollBatch(b.batch_id, { ...KEYS_BATCH_POLL }).then(() => true, () => false);
    if (!ended) {
      if (ctx.now().getTime() - Date.parse(b.submitted_at) < KEYS_BATCH_MAX_WAIT_MS) throw new KeysBatchPending(b.batch_id);
      ctx.log.warn('anahtar Batch\'i süre sınırında bitmedi; senkron çıkarım', { session: s.id, batch: b.batch_id });
    } else {
      const results = await ec.gateway.collectBatch('inferred_keys', b.batch_id, b.meta);
      const ok = results.find((r) => r.status === 'ok' && r.data);
      if (ok?.data) {
        value = ok.data as InferredKeys;
        run.costUsd += ok.costUsd;
      }
    }
  }
  if (!value) {
    try {
      const r = await inferKeys(ec, s.exam_title, req);
      run.costUsd += r.costUsd;
      value = r.data;
    } catch (err) {
      const why = badModelOutput(err);
      if (!why) throw err;
      // ret ya da onarımdan sonra da bozuk çıktı: bu sorular anahtarsız kalır, notlama ve rapor sürer (key_missing)
      ctx.log.warn('anahtar çıkarımı düştü; sorular anahtarsız', { session: s.id, error: (err as Error).message });
      value = { keys: [], notes: null, error: why };
    }
  }
  await stashPut(ctx.db, s.id, key, value);
  return value;
}

/** 5. grade */
async function gradeFromSheets(run: Run, items: RegisterItem[], sheets: Page[], keys: KeyRow[]): Promise<{ answers: AnswerRow[]; net: number }> {
  const { ctx, s, ec } = run;
  await setProgress(ctx.db, s.id, 'grade', { answer_sheet_pages: sheets.length });
  const sections = sectionRanges(items);
  const read: AnswerSheet[] = [];
  for (const p of sheets) {
    const { value } = await stashed<AnswerSheet>(ctx.db, s.id, `sheet:${p.upload.id}`, () =>
      pageCall(run, `optik ${p.order}`, () => readAnswerSheet(ec, p.ref, items.length, sections), UNREADABLE_SHEET),
    );
    if (value.unreadable) warn(run, 'page_unreadable', `optik form sayfası ${p.order} okunamadı`);
    else read.push(value);
  }
  if (read.length === 0) {
    throw new ExamReadError('optik form okunamadı', 'OGR-EXAM-102', 'Optik formu okuyamadım; daha net bir fotoğrafla yeniden yükleyebilirsin.');
  }
  const { answers, warnings } = answersFromSheets(read, items.map((q) => q.no));
  for (const w of warnings) {
    if (/çift işaret/.test(w)) warn(run, 'answer_double', w);
    else if (/okunamayan/.test(w)) warn(run, 'answer_unclear', w);
    else if (/düşük güven/.test(w)) warn(run, 'answer_low_confidence', w);
    else run.details.push(w);
  }
  await stashPut(ctx.db, s.id, 'answers', answers);
  await recordAnswers(ctx.db, s.id, answers.map((a) => ({ no: a.no, answer: a.answer })));
  const expected = expectedScore(keyedQuestions(items), keys, answers);
  await setProgress(ctx.db, s.id, 'grade', {
    answers_read: answers.filter((a) => a.status !== 'missing').length,
    answers_double: answers.filter((a) => a.status === 'multiple').length,
    answers_unclear: answers.filter((a) => a.status === 'unclear').length,
  });
  const score = await gradeSession(ctx.db, s.id);
  const net = Number(score.net ?? 0);
  if (Math.abs(net - expected.net) > 1e-6) {
    warn(run, 'score_mismatch', `hattın beklediği net ${expected.net}, SQL ${net}`);
    ctx.log.warn('deneme neti beklenenden farklı', { session: s.id, expected: expected.net, graded: net });
  }
  return { answers, net };
}

function sectionRanges(items: readonly RegisterItem[]): { name: string; from: number; to: number }[] {
  const by = new Map<string, { from: number; to: number }>();
  for (const q of items) {
    if (!q.section) continue;
    const r = by.get(q.section);
    if (!r) by.set(q.section, { from: q.no, to: q.no });
    else {
      r.from = Math.min(r.from, q.no);
      r.to = Math.max(r.to, q.no);
    }
  }
  return [...by].map(([name, r]) => ({ name, ...r }));
}

/**
 * Okuma ya da işleme hatası: oturum failed + Bugün kartı (+ öneri motorunun yeniden kurduğu audit satırı). Notlanmış ve
 * raporu hazır bir oturumda (sonuç kartı var) "yeniden dener misin" yerine sonuç kartı kalır: oturum done kalır ve yeniden
 * denemede kalan adımlar tamamlanır (resumePlan).
 */
async function failSession(ctx: JobContext, s: SessionRow, uploadIds: string[], kind: 'reading' | 'processing', code: string, line: string): Promise<void> {
  const first = uploadIds[0]!;
  const cur = (await loadSession(ctx.db, s.id).catch(() => null)) ?? s;
  const cardLine = typeof cur.progress.card_line === 'string' ? cur.progress.card_line : null;
  if (cur.graded && (cur.status === 'analysing' || cur.status === 'done') && cardLine) {
    ctx.log.error('notlanmış deneme sonrası adım düştü; sonuç kartı korunur', { session: s.id, error_code: code });
    await writeUploadCard(
      ctx.db,
      s.student_id,
      { ref: refKey('session', s.id), state: 'result', analysisId: null, sessionId: s.id, examId: s.exam_id, uploadId: first, uploadIds, enrollmentId: s.enrollment_id, verdict: null, oneLine: cardLine, at: ctx.now().toISOString(), net: typeof cur.progress.net === 'number' ? cur.progress.net : null },
      ctx.now(),
    );
    return;
  }
  await setProgress(ctx.db, s.id, 'failed', { error: line, error_code: code }).catch((e: unknown) => ctx.log.error('failed ilerlemesi yazılamadı', { error: (e as Error).message }));
  await ctx.db.query(`select app.audit_event('diagnosis.failed', 'uploads', $1, $2::jsonb)`, [
    first,
    JSON.stringify({ upload_ids: uploadIds, enrollment_id: s.enrollment_id, failure: kind, reason: code, session_id: s.id }),
  ]);
  await writeUploadCard(
    ctx.db,
    s.student_id,
    { ref: refKey('upload', first), state: 'failed', analysisId: null, sessionId: s.id, uploadId: first, uploadIds, enrollmentId: s.enrollment_id, verdict: null, failure: kind, reason: code, at: ctx.now().toISOString(), net: null },
    ctx.now(),
  );
}

function autoDiagnosisMax(): number {
  const v = Number(process.env.EXAM_AUTO_DIAGNOSIS_MAX ?? 10);
  return Number.isFinite(v) && v >= 0 ? Math.min(40, Math.floor(v)) : 10;
}

interface ReportLines {
  documentId: string | null;
  line: string;
  parentLine: string;
  net: number;
  fallback: boolean;
}

/** Rapor zaten kayıtlı (oturum done, belge var, PDF düşmemiş): model ve PDF yeniden koşmaz; cümleler veriden kurulur. */
async function reportedLines(run: Run, s: SessionRow, doubleMarks: ReadonlySet<number>): Promise<ReportLines> {
  const data = await loadReportData(run.ctx.db, s, doubleMarks, run.ctx.now());
  const weakest = data.weakest?.name ?? null;
  return {
    documentId: s.report_document_id,
    line: examCardLine(s.exam_title, data.net, weakest),
    parentLine: examParentLine(s.exam_title, data.net, weakest),
    net: data.net,
    fallback: run.warnings.has('report_fallback'),
  };
}

/** Rapor üretimi (model, PDF, belge kaydı; belge kaydı oturumu done yapar). */
async function renderReport(run: Run, s: SessionRow, doubleMarks: ReadonlySet<number>, last: boolean): Promise<ReportLines> {
  const { ctx } = run;
  // rapor kaydı oturumu done yapar: uyarılar o anda progress'te olsun (son satır finish'te yeniden yazılır)
  await setProgress(ctx.db, s.id, 'report', { warnings: warningsText(run.warnings) });
  const rep = await produceReport(ctx, s, { doubleMarks, lastAttempt: last });
  if (rep.fallback) warn(run, 'report_fallback');
  if (rep.status === 'failed') warn(run, 'report_failed');
  run.costUsd += rep.costUsd;
  return { documentId: rep.documentId, line: rep.line, parentLine: rep.parentLine, net: rep.data.net, fallback: rep.fallback };
}

/**
 * Rapor + kart + veli bildirimi + teşhis dağıtımı (analysing ya da done oturumdan da çağrılır). Son yazım (diagnoses_queued)
 * hattın bittiğini gösterir; ondan önce düşen adım (kart, bildirim, dağıtım) yeniden denemede raporu yeniden üretmeden
 * tamamlanır (resumePlan 'unfinished').
 */
async function finish(run: Run, uploadIds: string[], scratch: string[]): Promise<Pick<ExamAnalyseResult, 'net' | 'documentId' | 'reportFallback' | 'diagnosesQueued'>> {
  const { ctx } = run;
  const s = (await loadSession(ctx.db, run.s.id))!;
  const answers = (await stashGet<AnswerRow[]>(ctx.db, s.id, 'answers')) ?? [];
  const doubleMarks = new Set(answers.filter((a) => a.status === 'multiple').map((a) => a.no));
  const last = ctx.job.retryCount >= examAnalyseJob.retry.retryLimit;
  const rep =
    s.status === 'done' && s.report_document_id && s.progress.report_status !== 'failed'
      ? await reportedLines(run, s, doubleMarks)
      : await renderReport(run, s, doubleMarks, last);
  const first = uploadIds[0]!;
  await writeUploadCard(
    ctx.db,
    s.student_id,
    { ref: refKey('session', s.id), state: 'result', analysisId: null, sessionId: s.id, examId: s.exam_id, uploadId: first, uploadIds, enrollmentId: s.enrollment_id, verdict: null, oneLine: rep.line, at: ctx.now().toISOString(), net: rep.net },
    ctx.now(),
  );
  await notifyParents(ctx, s, rep.parentLine, rep.documentId);
  const queued = scratch.length > 0 ? await enqueueExamDiagnoses(ctx.db, s.id, scratch, autoDiagnosisMax()) : 0;
  if (scratch.length === 0) warn(run, 'no_scratch');
  await setProgress(ctx.db, s.id, 'done', {
    card_line: rep.line,
    net: rep.net,
    diagnoses_queued: queued,
    warnings: warningsText(run.warnings),
  });
  await saveRunMeta(run);
  return { net: rep.net, documentId: rep.documentId, reportFallback: rep.fallback, diagnosesQueued: queued };
}

interface RunMeta {
  /** Bütün koşuların toplam model maliyeti (USD). */
  cost_usd: number;
  /** Bu oturumun ayrıntılı uyarı satırları (en çok 200). */
  details: string[];
  /** Bütün koşuların uyarı kodları (rapor/PDF düşüp analysing'den sürülürse kaybolmasın). */
  warnings: WarningCode[];
}

/** Maliyet ve uyarı ayrıntıları stash'e (progress öğrenciye açıktır; maliyet iç bilgidir). Yeniden denemede birikir. */
async function saveRunMeta(run: Run): Promise<void> {
  const prev = await stashGet<RunMeta>(run.ctx.db, run.s.id, 'run_meta');
  const details = [...new Set([...(prev?.details ?? []), ...run.details])].slice(0, 200);
  const warnings = [...new Set([...(prev?.warnings ?? []), ...run.warnings])].sort();
  await stashPut(run.ctx.db, run.s.id, 'run_meta', { cost_usd: Math.round(((prev?.cost_usd ?? 0) + run.costUsd) * 10_000) / 10_000, details, warnings } satisfies RunMeta);
  run.costUsd = 0;
}

/** analysing oturumdan sürerken önceki koşunun uyarı kodları (progress.warnings ve 'plan' stash'i). */
export function previousWarnings(progress: Record<string, unknown>, planned: readonly string[] = []): WarningCode[] {
  const known = new Set<string>(WARNING_CODES);
  const raw = [...String(progress.warnings ?? '').split(','), ...planned].map((w) => w.trim());
  return [...new Set(raw.filter((w): w is WarningCode => known.has(w)))];
}

/** Kayıttan sonraki aşamaların ihtiyacı (yeniden deneme ve Batch beklemesi alım/sınıflama/kırpım/kaydı atlar). */
interface StoredPlan {
  pages: { uploadId: string; kind: 'booklet' | 'answer_sheet' | 'scratch' | 'answer_key'; order: number; total: number; ref: PageRef }[];
  items: RegisterItem[];
  questions: MergedQuestion[];
  warnings: WarningCode[];
  details: string[];
}

function pagesOfPlan(plan: StoredPlan, uploads: readonly PageUpload[]): Record<StoredPlan['pages'][number]['kind'], Page[]> {
  const by = new Map(uploads.map((u) => [u.id, u]));
  const kinds = { booklet: [] as Page[], answer_sheet: [] as Page[], scratch: [] as Page[], answer_key: [] as Page[] };
  for (const p of plan.pages) {
    const upload = by.get(p.uploadId);
    if (upload) kinds[p.kind].push({ upload, order: p.order, total: p.total, image: null, ref: p.ref });
  }
  return kinds;
}

async function analyse(run: Run, uploads: PageUpload[]): Promise<ExamAnalyseResult> {
  const { ctx, s } = run;
  const uploadIds = uploads.map((u) => u.id);
  const first = uploadIds[0]!;
  await writeUploadCard(
    ctx.db,
    s.student_id,
    { ref: refKey('upload', first), state: 'pending', analysisId: null, sessionId: s.id, examId: s.exam_id, uploadId: first, uploadIds, enrollmentId: s.enrollment_id, verdict: null, at: ctx.now().toISOString(), net: null },
    ctx.now(),
  );
  if (uploads.some(isPdfUpload)) {
    throw new ExamReadError('okul denemesinde PDF', 'OGR-EXAM-104', 'Denemeyi fotoğraf olarak yükleyebilirsin; her sayfanın ayrı bir fotoğrafı yeterli.');
  }
  const stored = await stashGet<StoredPlan>(ctx.db, s.id, 'plan');
  if (stored) return afterRegister(run, uploads, stored);

  let pages = await preparePages(run, uploads);
  const classes = await classify(run, pages);
  pages = await Promise.all(pages.map((p) => applyRotation(run, p, classes.get(p.upload.id)!)));

  const kinds = { booklet: [] as Page[], answer_sheet: [] as Page[], scratch: [] as Page[], answer_key: [] as Page[] };
  let unreadable = 0;
  for (const p of pages) {
    const c = classes.get(p.upload.id)!;
    if (c.unreadable) {
      unreadable += 1;
      warn(run, 'page_unreadable', `sayfa ${p.order} okunamadı`);
      continue;
    }
    if (c.confidence < PAGE_MIN_CONFIDENCE || c.page_class === 'other') {
      warn(run, 'page_unknown', `sayfa ${p.order} türü belirsiz (${c.page_class}, ${c.confidence})`);
      if (c.page_class === 'other') continue;
    }
    kinds[c.page_class].push(p);
  }
  await setProgress(ctx.db, s.id, 'classify', {
    pages_unreadable: unreadable,
    booklet_pages: kinds.booklet.length,
    answer_sheet_pages: kinds.answer_sheet.length,
    scratch_pages: kinds.scratch.length,
    key_pages: kinds.answer_key.length,
  });
  if (kinds.booklet.length === 0) throw new ExamReadError('kitapçık sayfası yok', 'OGR-EXAM-101', 'Kitapçık sayfalarını göremedim; soruların olduğu sayfaları da yükleyebilirsin.');
  if (kinds.answer_sheet.length === 0) throw new ExamReadError('optik form yok', 'OGR-EXAM-102', 'Optik formu göremedim; formun fotoğrafını da yükleyebilirsin.');

  const questions = await readBooklet(run, kinds.booklet.map((page) => ({ page, cls: classes.get(page.upload.id)! })));
  if (questions.length === 0) throw new ExamReadError('kitapçıktan soru okunamadı', 'OGR-EXAM-101', 'Kitapçık sayfalarını okuyamadım; daha net bir fotoğrafla yeniden yükleyebilirsin.');
  const pagesByRef = new Map(pages.map((p) => [p.ref.refId, p]));
  const publisher = await publisherMatchFor(run, questions);
  const figures = await cropFigures(run, questions, pagesByRef);
  const items = await registerAll(run, questions, figures, publisher?.skills ?? new Map());
  const plan: StoredPlan = {
    pages: (Object.keys(kinds) as (keyof typeof kinds)[]).flatMap((kind) => kinds[kind].map((p) => ({ uploadId: p.upload.id, kind, order: p.order, total: p.total, ref: p.ref }))),
    items,
    questions,
    warnings: [...run.warnings],
    details: [...run.details],
  };
  await stashPut(ctx.db, s.id, 'plan', plan);
  return afterKeysFrom(run, uploadIds, kinds, items, questions, publisher);
}

function isPdfUpload(u: PageUpload): boolean {
  return u.mime === 'application/pdf' || u.kind === 'pdf';
}

function publisherMatchFor(run: Run, questions: readonly MergedQuestion[]) {
  const { s } = run;
  return publisherMatch(run.ctx.db, { id: s.exam_id, publisher: s.exam_publisher, title: s.exam_title, curriculum_id: s.curriculum_id, created_by: s.exam_created_by }, questions);
}

/** Sorular kayıtlı (stash 'plan'): alım, sınıflama, OCR, kırpım ve kayıt atlanır; anahtardan sürer. */
async function afterRegister(run: Run, uploads: PageUpload[], plan: StoredPlan): Promise<ExamAnalyseResult> {
  for (const w of plan.warnings) run.warnings.add(w);
  run.details.push(...plan.details.filter((d) => !run.details.includes(d)));
  const kinds = pagesOfPlan(plan, uploads);
  const publisher = await publisherMatchFor(run, plan.questions);
  return afterKeysFrom(run, uploads.map((u) => u.id), kinds, plan.items, plan.questions, publisher);
}

async function afterKeysFrom(
  run: Run,
  uploadIds: string[],
  kinds: Record<'booklet' | 'answer_sheet' | 'scratch' | 'answer_key', Page[]>,
  items: RegisterItem[],
  questions: MergedQuestion[],
  publisher: Awaited<ReturnType<typeof publisherMatch>>,
): Promise<ExamAnalyseResult> {
  const { keys, source } = await resolveKeys(run, items, kinds.answer_key, questions, publisher);
  await gradeFromSheets(run, items, kinds.answer_sheet, keys);
  const fin = await finish(run, uploadIds, kinds.scratch.map((p) => p.ref.refId));
  return { sessionId: run.s.id, status: 'done', questions: items.length, keySource: source, ...fin, warnings: [...run.warnings] };
}

export const examAnalyseJob: JobDefinition<ExamAnalysePayload, ExamAnalyseResult> = {
  name: 'exam.analyse',
  description: 'Okul denemesi analizi: alım → page_class → exam_page_items → anahtar → optik → grade_exam_session → rapor PDF → kart/bildirim/teşhis.',
  process: 'worker',
  payload,
  concurrency: 2,
  retry: { retryLimit: 3, retryDelay: 30, retryBackoff: true, retryDelayMax: 600, expireInSeconds: 1800, deleteAfterSeconds: 604_800 },
  handler: async (p, ctx) => {
    const s = await loadSession(ctx.db, p.session_id);
    if (!s || s.exam_id !== p.exam_id) throw new PermanentJobError(`deneme oturumu bulunamadı: ${p.session_id}`, 'OGR-JOB-150');
    if (p.student_id && p.student_id !== s.student_id) throw new PermanentJobError('oturum bu öğrencinin değil', 'OGR-JOB-150');
    const plan = resumePlan(s);
    if (plan.from === null) return { sessionId: s.id, status: s.status, skipped: plan.reason, warnings: [] };
    const ids = s.upload_ids.length > 0 ? s.upload_ids : p.upload_ids;
    const uploads = await loadUploads(ctx.db, ids);
    if (uploads.length !== ids.length || uploads.some((u) => u.student_id !== s.student_id)) {
      throw new PermanentJobError('sayfalar bulunamadı ya da bu öğrencinin değil', 'OGR-JOB-142');
    }

    const run: Run = {
      ctx,
      s,
      ec: null as unknown as ExamCallContext,
      warnings: new Set(),
      details: [],
      costUsd: 0,
    };
    try {
      if (runsStage(plan, 'classify')) {
        const gateway = await ctx.gateway();
        if (gateway.transport.kind !== 'fake') {
          const sp = await ctx.db.query(`select paid_allowed from public.check_spend('exam.analyse', $1)`, [s.public_ref]);
          if (sp.rows[0] && sp.rows[0].paid_allowed === false) throw new PermanentJobError('harcama sınırı: deneme analizi şu an yapılamıyor', 'OGR-JOB-152');
        }
        run.ec = { ctx, gateway, sessionId: s.id, studentRef: s.public_ref, courseId: s.course_id, curriculumId: s.curriculum_id };
        return await analyse(run, uploads);
      }
      const stored = await stashGet<StoredPlan>(ctx.db, s.id, 'plan');
      const meta = await stashGet<RunMeta>(ctx.db, s.id, 'run_meta');
      for (const w of previousWarnings(s.progress, [...(stored?.warnings ?? []), ...(meta?.warnings ?? [])])) run.warnings.add(w);
      const scratch = stored ? stored.pages.filter((x) => x.kind === 'scratch').map((x) => x.ref.refId) : await scratchRefs(ctx, s);
      const fin = await finish(run, ids, scratch);
      return { sessionId: s.id, status: 'done', ...fin, warnings: [...run.warnings] };
    } catch (err) {
      if (err instanceof FailedExamError) throw err;
      if (err instanceof KeysBatchPending) {
        await saveRunMeta(run).catch(() => undefined);
        await ctx.enqueue('exam.analyse', p, { startAfter: 120, singletonKey: `exam-keys:${s.id}`, singletonSeconds: 60 });
        return { sessionId: s.id, status: s.status, skipped: 'keys_batch_pending', warnings: [...run.warnings] };
      }
      if (err instanceof ExamReadError) {
        await failSession(ctx, s, ids, 'reading', err.code, err.userLine);
        throw new FailedExamError(err.message, err.code);
      }
      await saveRunMeta(run).catch(() => undefined);
      // okuma hatası yalnız ExamReadError'dır (yukarıda); tek sayfanın bozuk çıktısı sayfada yakalanır. Buraya ulaşan
      // ret/şema hatası beklenmedik bir çağrıdandır: işleme hatası, yeniden denemek işe yaramaz.
      const c = classifyError(err);
      const permanent = err instanceof PermanentJobError || badModelOutput(err) !== null || (!c.retryable && c.code !== 'unknown');
      const last = ctx.job.retryCount >= examAnalyseJob.retry.retryLimit;
      if (!permanent && !last) throw err;
      ctx.log.error('deneme analizi düştü', { session: s.id, error: (err as Error).message, code: c.code });
      const code = err instanceof PermanentJobError ? err.code : 'OGR-JOB-153';
      await failSession(ctx, s, ids, 'processing', code, 'Denemeni şu an işleyemedim; yeniden dener misin?').catch(
        (e: unknown) => ctx.log.error('düşen denemenin kartı yazılamadı', { error: (e as Error).message }),
      );
      throw new FailedExamError(`deneme analizi düştü: ${(err as Error).message}`, code);
    }
  },
};

/** analysing oturumdan sürerken karalama sayfaları ('plan' stash'i olmayan eski oturum: sınıflamadan, orijinal kimlikler). */
async function scratchRefs(ctx: JobContext, s: SessionRow): Promise<string[]> {
  const out: string[] = [];
  for (const id of s.upload_ids) {
    const c = await stashGet<PageClass>(ctx.db, s.id, `class:${id}`);
    if (c && !c.unreadable && c.page_class === 'scratch') out.push(id);
  }
  return out;
}
