/**
 * `document.generate` — not / deneme / soru seti üretimi (docs/PLAN-v2.md §2 Akış 5, §7; supabase 0034–0035).
 * `request_document` RPC'si kuyruğa atar: {document_id, request_id, kind, student_id} (en az biri: document_id | request_id).
 *
 *   1. Belge + istek → durum `generating`. Kapsam: hedef yapraklar (istek kodları → konu adı → en zayıf yapraklar),
 *      öğrencinin örüntüleri (`student_patterns_for_prompt`), koç sohbetindeki istek cümlesi.
 *   2. Sistem: ürün promptu + ders bloğu + dossier (`buildPromptSystem`; ders geneli belgede yalnız ders bloğu).
 *      Rota `notes_generation` (document-ast) ya da `exam_generation` (exam-generation → belge AST'si). Opus, akış.
 *      Figürler (`figuresMode`): gerçek anahtarla code_execution (varsayılan) → model kodu konteynerde çalıştırır,
 *      `figure_<n>.svg` Files API'den iner (konteyner iş içinde yeniden kullanılır; inmeyen figür yerelde çalışmaz,
 *      blok yeniden istenir). Sahte LLM'de ya da açıkça OGRENMEN_FIGURES=local → araç gönderilmez, worker
 *      `py/figure_render.py` ile OS yalıtımında çizer (documents/sandbox.ts).
 *   3. Durum `verifying` + doğrulama merdiveni (documents/ladder.ts): şema → SymPy → figür → kopya → kişiselleştirme;
 *      hatalı blok tek başına yeniden üretilir (≤ documents_block_regen_max), haklar bitince güvenli geri dönüş.
 *   4. Anahtarlar ayrılır (`splitDocumentKeys`): AST `register_generated_document` ile (anahtarsız); deneme/soru setinde
 *      `mock_exam_from_document` → exams + exam_questions + secure.exam_answer_keys.
 *   5. doc-render HTML + PDF (notta cevap sayfası anahtarlarla; denemede anahtar basılmaz) → Storage `documents`
 *      (`<tür>/<öğrenci|course-<ders>>/<belge>.{html,pdf}`) → register (yollar, maliyet = llm_calls toplamı).
 *   6. `document_set_status('ready', {verification, personalization, review_required})`: incelemeli belge (ders geneli,
 *      spec.review / audience=class) `review`a döner ve eğitmene bildirim gider; değilse yayımlanır: Bugün
 *      `document_ready` kartı ("Rasyonel sayılar notun hazır" · PDF), öğrenci bildirimi (+ push.send). Veli: P6.
 *   Hata: son denemede (ya da kalıcı hatada) belge ve istek `failed` + Türkçe neden; kısmi içerik (AST ve Storage'daki
 *   HTML/PDF) silinir. Blok yeniden üretim hakkı iş çalıştırması başına sayılır (yeniden denemede baştan).
 */
import { z } from 'zod';
import {
  splitDocumentKeys,
  storedDocumentAst,
  type DocumentAst,
  type DocumentBlockRegen,
  type ExamBlockRegen,
  type ExamGeneration,
  type SchemaName,
} from '@ogrenmen/contracts';
import { renderDocumentPdf } from '@ogrenmen/doc-render';
import {
  buildPromptSystem,
  classifyError,
  collectOutputFiles,
  MaxTokensError,
  ParseError,
  RefusalError,
  renderCourseBlock,
  type CallResult,
  type Gateway,
  type RouteName,
  type SystemParts,
} from '@ogrenmen/llm';
import { examGenerationUserText, notesGenerationUserText, notesPersonalized, type PatternInput } from '@ogrenmen/prompts';
import type { Db } from '../db.js';
import {
  examRequest,
  loadDocument,
  loadPatterns,
  loadSkills,
  notesRequest,
  studentRequestText,
  targetLeaves,
  type DocRow,
  type GeneratedKind,
} from '../documents/context.js';
import { buildDraft, mergeExam, mergeNotes, type AstMeta, type Draft } from '../documents/draft.js';
import { downloadedFigures, type FigureRun, type FiguresMode } from '../documents/figures.js';
import { CALLOUT_SLOT, runLadder, type Issue, type LadderResult, type LadderStep, type RegenOutcome } from '../documents/ladder.js';
import { figureTasks } from '../documents/draft.js';
import { pythonKeyVerifier, type KeyVerifier } from '../practice/bank.js';
import { systemPrompt } from '../prompts.js';
import type { StorageLike } from '../storage.js';
import { PermanentJobError } from './errors.js';
import { acceptCamelAliases, uuid } from './schemas.js';
import type { JobContext, JobDefinition } from './types.js';

const payload = acceptCamelAliases(
  { documentId: 'document_id', requestId: 'request_id', studentId: 'student_id' },
  z
    .object({
      document_id: uuid.optional(),
      request_id: uuid.optional(),
      kind: z.string().min(1).max(40).optional(),
      student_id: uuid.nullish(),
    })
    .passthrough()
    .refine((p) => p.document_id !== undefined || p.request_id !== undefined, { message: 'document_id ya da request_id gerekli' }),
);
export type DocumentGeneratePayload = z.infer<typeof payload>;

/** Testler anahtar doğrulayıcısını, figür çalıştırıcısını ve görsel denetimi değiştirir. */
export interface DocumentHooks {
  keyVerifier?: KeyVerifier;
  figureRun?: FigureRun;
  visionCheck?: boolean;
  /** Figür kipini zorlar (testler: sahte taşımayla code_execution yolu). */
  figuresMode?: FiguresMode;
}
export const documentHooks: DocumentHooks = {};

/** Yeniden üretim turu üst sınırı (blok başına sınır ayrıca DB'de: documents_block_regen_max). */
export const REGEN_MAX_ROUNDS = 2;
/** Doğrulanamayan anahtar payı bu eşiği aşarsa deneme/soru seti eğitmen incelemesine gider. */
export const INFERRED_REVIEW_SHARE = 0.3;
/** Yeniden üretim çıktısı yalnız sorunlu blokları taşır: tam belgenin üst sınırı (64000) gerekmez. */
export const REGEN_MAX_TOKENS = 8000;

export interface DocumentGenerateResult {
  document_id: string;
  request_id: string | null;
  status: 'ready' | 'review' | 'failed' | 'skipped';
  reason?: string;
  exam_id?: string | null;
  pdf_path?: string | null;
  verification?: LadderResult['verification'];
  regen_rounds?: number;
  figures?: FiguresMode;
  cost_usd?: number;
  ms?: number;
}

const ROUTE: Record<GeneratedKind, RouteName> = { notes: 'notes_generation', mock_exam: 'exam_generation', question_set: 'exam_generation' };
const DIR: Record<GeneratedKind, string> = { notes: 'notes', mock_exam: 'exams', question_set: 'question-sets' };

/** Öğrenciye/istek satırına yazılan Türkçe neden (ham hata gösterilmez). */
export class DocumentFailure extends PermanentJobError {
  constructor(readonly reason: string, detail: string, readonly verification?: Partial<Record<LadderStep, Record<string, unknown>>>) {
    super(detail.slice(0, 300), 'OGR-JOB-160');
  }
}

export function istanbulDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

async function setStatus(db: Db, docId: string, status: string, patch: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const r = await db.query('select public.document_set_status($1::uuid, $2, $3::jsonb) as r', [docId, status, JSON.stringify(patch)]);
  return (r.rows[0]?.r ?? {}) as Record<string, unknown>;
}

async function spendAllowed(db: Db, studentRef: string | null): Promise<boolean> {
  const r = await db.query(`select paid_allowed from public.check_spend('document.generate', $1)`, [studentRef]);
  return (r.rows[0] as { paid_allowed?: boolean } | undefined)?.paid_allowed !== false;
}

/**
 * Figür kipi: sahte taşıma ya da Files istemcisi yoksa `local`; gerçek anahtarla `code_execution` (model kodu worker'da
 * koşmaz), yalnız açıkça OGRENMEN_FIGURES=local verilirse yerel (OS yalıtımında).
 */
export function figuresMode(configured: 'auto' | FiguresMode, gateway: Gateway): FiguresMode {
  if (documentHooks.figuresMode) return documentHooks.figuresMode;
  if (gateway.transport.kind === 'fake' || !gateway.transport.files) return 'local';
  return configured === 'local' ? 'local' : 'code_execution';
}

/**
 * Yeniden üretim turunun kullanıcı metni: yalnız sorunlu bloklar, nedenleriyle. Çıktı daraltılmıştır (`document-block-regen`
 * ya da `exam-block-regen`): yalnız bu blokları / soruları ve anahtarlarını döndürür; öteki bloklar worker'da korunur.
 */
export function regenUserText(kind: GeneratedKind, issues: readonly Issue[]): string {
  const rows = issues.map((i) => ({ block_id: i.block_id, ...(i.no !== undefined ? { question_no: i.no } : {}), step: i.step, reason: i.detail ?? i.reason }));
  const slot = issues.some((i) => i.block_id === CALLOUT_SLOT);
  const json = JSON.stringify(rows, null, 1).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return [
    kind === 'notes' ? 'Önceki notundaki şu bloklar doğrulamadan geçmedi:' : 'Önceki denemendeki şu sorular doğrulamadan geçmedi:',
    `<regen_blocks>${json}</regen_blocks>`,
    kind === 'notes'
      ? 'Yalnız bu blokları düzelt. Yanıtında blocks dizisinde yalnız bu block_id değerli bloklar (kimlik ve section_no aynı kalır) ve keys dizisinde bu blokların anahtarları olsun. Öteki blokları yazma; notun tamamını yeniden yazma.'
      : 'Yalnız bu soruları düzelt. Yanıtında items dizisinde yalnız bu soru numaraları (no ve section aynı kalır) ve keys dizisinde onların anahtarları olsun. Öteki soruları yazma; denemenin tamamını yeniden yazma.',
    ...(slot ? [`"${CALLOUT_SLOT}" bir blok değil, notun eksik parçasıdır: yeni bir common_mistake_callout bloğu ekle.`] : []),
  ].join('\n');
}

function failureReason(err: unknown): string {
  if (err instanceof DocumentFailure) return err.reason;
  if (err instanceof RefusalError) return 'İstek içerik kurallarına takıldı; konuyu biraz farklı anlatıp yeniden isteyebilirsin.';
  if (err instanceof ParseError || err instanceof MaxTokensError) return 'Belge beklenen biçimde üretilemedi; birazdan yeniden isteyebilirsin.';
  return 'Belge hazırlanamadı; birazdan yeniden isteyebilirsin.';
}

interface Generation {
  doc: DocRow;
  gateway: Gateway;
  route: RouteName;
  system: SystemParts;
  userText: string;
  promptVersion: string;
  mode: FiguresMode;
  meta: AstMeta;
  container: string | null;
  costUsd: number;
}

async function callRoute(
  ctx: JobContext,
  g: Generation,
  extra: { history?: { role: 'user' | 'assistant'; content: string }[]; user?: string; schema?: SchemaName; maxTokens?: number } = {},
): Promise<CallResult<unknown>> {
  const res = await g.gateway.call(g.route, {
    system: g.system,
    ...(extra.history ? { history: extra.history } : {}),
    ...(extra.schema ? { schema: extra.schema } : {}),
    ...(extra.maxTokens ? { maxTokens: extra.maxTokens } : {}),
    user: extra.user ?? g.userText,
    turn: { now: ctx.now() },
    promptVersion: g.promptVersion,
    ref: { table: 'generated_documents', id: g.doc.id },
    studentRef: g.doc.student_ref,
    purpose: 'document.generate',
    signal: ctx.signal,
    ...(g.mode === 'local' ? { disableTools: ['code_execution'] as const } : g.container ? { container: g.container } : {}),
  });
  g.costUsd += res.costUsd;
  if (res.container) g.container = res.container;
  return res;
}

async function remoteFiguresOf(g: Generation, res: CallResult<unknown>, draft: Draft, into: Map<string, string>): Promise<void> {
  if (g.mode !== 'code_execution') return;
  const refs = collectOutputFiles(res.transcript);
  for (const [k, v] of await downloadedFigures(g.gateway, refs, figureTasks(draft.ast))) into.set(k, v);
}

function storageOf(ctx: JobContext): StorageLike {
  try {
    return ctx.storage();
  } catch (e) {
    throw new DocumentFailure('Belge kaydedilemedi; birazdan yeniden isteyebilirsin.', `Storage yapılandırılmadı: ${(e as Error).message}`);
  }
}

async function documentCost(db: Db, docId: string, inProcess: number): Promise<number> {
  try {
    const r = await db.query(`select coalesce(sum(c.cost_usd), 0)::float8 as s from public.llm_calls c where c.ref_table = 'generated_documents' and c.ref_id = $1`, [docId]);
    return Math.max(Number(r.rows[0]?.s ?? 0), inProcess);
  } catch {
    return inProcess;
  }
}

export async function runDocumentGenerate(p: DocumentGeneratePayload, ctx: JobContext): Promise<DocumentGenerateResult> {
  const t0 = Date.now();
  const doc = await loadDocument(ctx.db, { document_id: p.document_id, request_id: p.request_id });
  if (!doc) throw new PermanentJobError(`belge bulunamadı: ${p.document_id ?? p.request_id}`, 'OGR-JOB-161');
  if (!['notes', 'mock_exam', 'question_set'].includes(doc.kind)) throw new PermanentJobError(`üretilemeyen belge türü: ${doc.kind}`, 'OGR-JOB-161');
  const base = { document_id: doc.id, request_id: doc.request_id };
  if (['ready', 'review'].includes(doc.request_status ?? '') || ['published', 'review'].includes(doc.status)) return { ...base, status: 'skipped', reason: 'already_done' };
  if (doc.request_status === 'failed' || doc.status === 'failed') return { ...base, status: 'skipped', reason: 'failed_before' };
  if (!doc.curriculum_id) throw new DocumentFailure('Bu dersin müfredatı bulunamadı.', 'belgenin müfredatı yok (kayıt ya da ders)');

  await setStatus(ctx.db, doc.id, 'generating');
  const gateway = await ctx.gateway();
  if (gateway.transport.kind !== 'fake' && !(await spendAllowed(ctx.db, doc.student_ref))) {
    throw new DocumentFailure('Bugünkü üretim sınırına ulaşıldı; yarın yeniden isteyebilirsin.', 'check_spend: paid_allowed = false');
  }

  // kapsam
  const kind = doc.kind;
  const skills = await loadSkills(ctx.db, doc.curriculum_id);
  const scoped = (doc.spec.skill_ids?.length ?? 0) > 0 || !!doc.spec.topic;
  const leaves = kind === 'notes' ? await targetLeaves(ctx.db, doc, skills, 6) : scoped ? await targetLeaves(ctx.db, doc, skills, 40) : skills.filter((s) => s.is_leaf);
  if (leaves.length === 0) throw new DocumentFailure('Bu konu için kazanım bulunamadı.', 'hedef yaprak yok');
  const wantsMistakes = doc.student_id !== null && (kind === 'notes' ? doc.spec.include_my_mistakes !== false : doc.spec.include_my_mistakes === true);
  const pat = wantsMistakes && doc.student_id ? await loadPatterns(ctx.db, doc.student_id, doc.course_id, leaves.map((l) => l.id)) : { patterns: [] as PatternInput[], known: [] };
  let weak: string[] = [];
  if (kind !== 'notes' && doc.enrollment_id) {
    const r = await ctx.db.query(`select m.skill_id from public.mastery m where m.enrollment_id = $1::uuid and m.skill_id = any($2::text[]) order by m.p asc limit 6`, [doc.enrollment_id, leaves.map((l) => l.id)]);
    weak = r.rows.map((x) => String(x.skill_id));
  }

  const prompt = await systemPrompt(ctx.db, ROUTE[kind]);
  let userText: string;
  let personalized: boolean;
  let durationMin: number | null = null;
  if (kind === 'notes') {
    const req = notesRequest(doc, leaves, pat.patterns, await studentRequestText(ctx.db, doc.message_id));
    personalized = notesPersonalized(req);
    userText = notesGenerationUserText(req);
  } else {
    const req = examRequest(doc, skills, leaves, pat.patterns, weak);
    personalized = req.include_mistakes && (req.patterns?.length ?? 0) > 0;
    durationMin = req.duration_min;
    userText = examGenerationUserText(req);
  }
  let system: SystemParts;
  if (doc.student_id && doc.course_id) system = (await buildPromptSystem(ctx.db, { product: prompt.text, studentId: doc.student_id, courseId: doc.course_id })).system;
  else if (doc.course_id) system = { product: prompt.text, course: (await renderCourseBlock(ctx.db, doc.course_id, { curriculumId: doc.curriculum_id })).text };
  else system = { product: prompt.text };

  const g: Generation = {
    doc, gateway, route: ROUTE[kind], system, userText, promptVersion: prompt.version, mode: figuresMode(ctx.config.figures, gateway),
    meta: { title: doc.title, courseTitle: doc.course_title ?? 'Ders', generatedOn: istanbulDay(ctx.now()), personalized, durationMin },
    container: null, costUsd: 0,
  };

  // üretim
  const res = await callRoute(ctx, g);
  let draft = buildDraft(kind, res.data as DocumentAst | ExamGeneration, g.meta);
  if (kind === 'notes') draft = { ...draft, ast: { ...draft.ast, title: (draft.ast.title || doc.title).slice(0, 200) } };
  const remote = new Map<string, string>();
  await remoteFiguresOf(g, res, draft, remote);
  await setStatus(ctx.db, doc.id, 'verifying', { verification: { schema: { status: 'pass', route: g.route, repaired: res.repaired } } });

  // doğrulama merdiveni
  const [figPrompt, persPrompt] = await Promise.all([systemPrompt(ctx.db, 'figure_check'), kind === 'notes' ? systemPrompt(ctx.db, 'personalization_check') : Promise.resolve(null)]);
  const ref = { table: 'generated_documents', id: doc.id };
  const ladder = await runLadder(
    {
      db: ctx.db, log: ctx.log, gateway, docId: doc.id, curriculumId: doc.curriculum_id, ref, studentRef: doc.student_ref, signal: ctx.signal,
      verifier: documentHooks.keyVerifier ?? pythonKeyVerifier,
      figures: {
        gateway, mode: g.mode, prompt: figPrompt, ref, studentRef: doc.student_ref, signal: ctx.signal,
        ...(documentHooks.figureRun ? { run: documentHooks.figureRun } : {}),
        ...(documentHooks.visionCheck === false ? { visionCheck: false } : {}),
      },
      remoteFigures: remote,
      personalized: kind === 'notes' && personalized,
      known: pat.known,
      patterns: pat.patterns,
      personalizationPrompt: persPrompt,
      maxRounds: REGEN_MAX_ROUNDS,
      // hak bu çalıştırmanın deneme sayısıyla ölçülür (DB toplamı önceki iş denemelerini de sayar); neden saklanabilir
      // metindir (öğrenci verification'ı okur: anahtar/cevap ayrıntısı yalnız modele giden istekte)
      noteRegen: async (issue: Issue, attempt: number) => {
        const r = await ctx.db.query('select public.document_block_regen_note($1::uuid, $2, $3, $4, $5) as r', [doc.id, issue.block_id, issue.step, issue.reason.slice(0, 500), attempt]);
        const x = (r.rows[0]?.r ?? {}) as { max?: number };
        return { allowed: attempt <= Number(x.max ?? REGEN_MAX_ROUNDS) };
      },
      regenerate: async (current: Draft, issues: readonly Issue[]): Promise<RegenOutcome> => {
        // Daraltılmış çıktı: yalnız sorunlu blok/soru ve anahtarları; birleştirme kimlikle yapılır (mergeNotes/mergeExam).
        // Maliyet `callRoute` ile g.costUsd'de zaten sayılır; RegenOutcome.costUsd 0 bildirilir (çift sayım olmaz).
        const out = await callRoute(ctx, g, {
          history: [
            { role: 'user', content: g.userText },
            { role: 'assistant', content: JSON.stringify(current.raw) },
          ],
          user: regenUserText(kind, issues),
          schema: kind === 'notes' ? 'document-block-regen' : 'exam-block-regen',
          maxTokens: REGEN_MAX_TOKENS,
        });
        const ids = new Set(issues.map((i) => i.block_id));
        let next: Draft;
        let replaced: string[];
        if (kind === 'notes') {
          const cur = current.raw as DocumentAst;
          const part = out.data as unknown as DocumentBlockRegen;
          const m = mergeNotes(cur, { ...cur, blocks: part.blocks, keys: part.keys }, ids);
          next = buildDraft(kind, m.doc, g.meta);
          next = { ...next, ast: { ...next.ast, title: current.ast.title } };
          replaced = m.replaced;
        } else {
          const cur = current.raw as ExamGeneration;
          const part = out.data as unknown as ExamBlockRegen;
          const m = mergeExam(cur, { ...cur, items: part.items, keys: part.keys }, ids);
          next = buildDraft(kind, m.exam, g.meta);
          replaced = m.replaced;
        }
        await remoteFiguresOf(g, out, next, remote);
        return { draft: next, replaced, costUsd: 0 };
      },
    },
    draft,
    { route: g.route, repaired: res.repaired },
  );
  if (!ladder.ok) throw new DocumentFailure(ladder.error ?? 'Belge doğrulamadan geçmedi.', `doğrulama merdiveni: ${ladder.error}`, ladder.verification);

  // saklama: anahtarlar ayrı
  const final = ladder.final;
  const { content, keys } = splitDocumentKeys(final);
  const stored = storedDocumentAst.safeParse(content);
  if (!stored.success) {
    throw new DocumentFailure('Belge biçim denetiminden geçmedi.', `saklanan AST geçersiz: ${stored.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  await ctx.db.query('select public.register_generated_document($1::jsonb) as id', [JSON.stringify({ id: doc.id, content, model: res.model })]);
  // Anahtar güveni: SymPy ile doğrulanan anahtar 1.0; doğrulanamayan (çıkarım, zaman aşımı, doğrulayıcı yok) 0,6.
  // Öğrenci denemesinde güveni düşük anahtarlar ayrı işaretlenir; belge sayısı eşiği aşarsa incelemeye gider.
  const sympyDetails = (ladder.verification.sympy.details ?? []) as { no: number; status: string }[];
  const verifiedNos = new Set(sympyDetails.filter((d) => d.status === 'verified').map((d) => d.no));
  const confidenceOf = (no: number) => (verifiedNos.has(no) ? 1 : 0.6);
  const unverifiedShare = keys.length > 0 ? keys.filter((k) => confidenceOf(k.question_no) < 1).length / keys.length : 0;
  const inferredHeavy = kind !== 'notes' && unverifiedShare > INFERRED_REVIEW_SHARE;
  let examId: string | null = null;
  if (kind !== 'notes') {
    const ex = await ctx.db.query('select public.mock_exam_from_document($1::uuid, $2::jsonb) as r', [
      doc.id,
      JSON.stringify(
        keys.map((k) => ({ question_no: k.question_no, correct_option: k.correct_option, numeric_value: k.numeric_value, canonical_expr: k.canonical_expr, confidence: confidenceOf(k.question_no) })),
      ),
    ]);
    examId = String((ex.rows[0]?.r as { exam_id?: string } | undefined)?.exam_id ?? '') || null;
  }

  // çizim + Storage
  const storage = storageOf(ctx);
  const skillLabels = Object.fromEntries(skills.map((s) => [s.id, s.name]));
  let html: string;
  let pdf: Uint8Array;
  try {
    ({ html, pdf } = await renderDocumentPdf(content, { skillLabels, ...(kind === 'notes' ? { answerKeys: keys.map((k) => ({ question_no: k.question_no, correct_option: k.correct_option, numeric_value: k.numeric_value })) } : {}) }));
  } catch (e) {
    throw new DocumentFailure('Belge PDF olarak hazırlanamadı; birazdan yeniden isteyebilirsin.', `PDF: ${(e as Error).message}`);
  }
  const basePath = storageBase(doc);
  await storage.upload(ctx.config.documentsBucket, `${basePath}.html`, Buffer.from(html, 'utf8'), 'text/html');
  await storage.upload(ctx.config.documentsBucket, `${basePath}.pdf`, Buffer.from(pdf), 'application/pdf');
  const total = await documentCost(ctx.db, doc.id, g.costUsd + ladder.costUsd);
  const cur = await ctx.db.query('select cost_usd::float8 as c from public.generated_documents where id = $1::uuid', [doc.id]);
  const delta = Math.max(0, Number((total - Number(cur.rows[0]?.c ?? 0)).toFixed(6)));
  await ctx.db.query('select public.register_generated_document($1::jsonb) as id', [JSON.stringify({ id: doc.id, html_path: `${basePath}.html`, pdf_path: `${basePath}.pdf`, cost_usd: delta })]);

  // yayın ya da inceleme
  const callouts = final.blocks.filter((b) => b.type === 'common_mistake_callout').map((b) => ({ block_id: b.id, ...((b as { pattern_ref?: object | null }).pattern_ref ?? {}) }));
  const personalization = {
    personalized: final.meta.personalized,
    include_my_mistakes: wantsMistakes,
    patterns_offered: pat.patterns.length,
    callouts,
    skills: leaves.slice(0, 12).map((l) => l.id),
    weak_skills: weak,
  };
  const review = doc.review_required || doc.spec.review === true || doc.spec.audience === 'class' || doc.student_id === null || ladder.reviewRequired || inferredHeavy;
  if (ladder.reviewRequired) ctx.log.warn('document.generate: anahtarlar doğrulanamadı; belge incelemeye gidiyor', { document: doc.id });
  if (inferredHeavy) ctx.log.warn('document.generate: anahtarların çoğu SymPy ile denetlenemedi; belge incelemeye gidiyor', { document: doc.id, share: unverifiedShare });
  const out = await setStatus(ctx.db, doc.id, 'ready', {
    verification: ladder.verification,
    personalization,
    ...(review ? { review_required: true } : {}),
  });
  const status = out.status === 'review' ? 'review' : 'ready';
  if (status === 'ready' && doc.student_id) {
    const n = await ctx.db.query(
      `select n.id from public.notifications n where n.kind = 'document_ready' and n.payload ->> 'document_id' = $1 and n.sent_at is null order by n.created_at desc limit 3`,
      [doc.id],
    );
    for (const row of n.rows) await ctx.enqueue('push.send', { notification_id: String(row.id) }).catch(() => null);
  }
  ctx.log.info('document.generate: belge hazır', { document: doc.id, kind, status, rounds: ladder.rounds, figures: g.mode, costUsd: total, ms: Date.now() - t0 });
  return { ...base, status, exam_id: examId, pdf_path: `${basePath}.pdf`, verification: ladder.verification, regen_rounds: ladder.rounds, figures: g.mode, cost_usd: total, ms: Date.now() - t0 };
}

/** Storage taban yolu: `<tür>/<öğrenci|course-<ders>>/<belge>` (.html, .pdf). */
function storageBase(doc: Pick<DocRow, 'id' | 'kind' | 'student_id' | 'course_id'>): string {
  const owner = doc.student_id ?? `course-${doc.course_id ?? 'none'}`;
  return `${DIR[doc.kind as GeneratedKind] ?? 'documents'}/${owner}/${doc.id}`;
}

const RETRY = { retryLimit: 2, retryDelay: 20, retryBackoff: true, retryDelayMax: 300, expireInSeconds: 1800, deleteAfterSeconds: 7 * 86_400, retentionSeconds: 7 * 86_400 };

/**
 * Son denemede belge + istek failed; kısmi içerik (AST ve Storage'daki HTML/PDF) silinir, bağlı taslak sınav failed
 * (document_set_status).
 */
async function markFailed(ctx: JobContext, p: DocumentGeneratePayload, err: unknown): Promise<void> {
  const doc = await loadDocument(ctx.db, { document_id: p.document_id, request_id: p.request_id }).catch(() => null);
  if (!doc || ['published', 'review', 'failed'].includes(doc.status)) return;
  const verification = err instanceof DocumentFailure && err.verification ? Object.fromEntries(Object.entries(err.verification).map(([k, v]) => [k, v])) : undefined;
  try {
    await setStatus(ctx.db, doc.id, 'failed', { error: failureReason(err), ...(verification ? { verification } : {}) });
    await ctx.db.query(`update public.generated_documents set content = null where id = $1::uuid and status = 'failed'`, [doc.id]);
  } catch (e2) {
    ctx.log.error('document.generate: belge failed yapılamadı', { document: doc.id, error: (e2 as Error).message });
  }
  if (!['notes', 'mock_exam', 'question_set'].includes(doc.kind)) return;
  try {
    const storage = ctx.storage();
    if (storage.remove) {
      const base = storageBase(doc);
      await storage.remove(ctx.config.documentsBucket, [`${base}.html`, `${base}.pdf`]);
    }
  } catch (e3) {
    ctx.log.warn('document.generate: kısmi belge dosyaları silinemedi', { document: doc.id, error: (e3 as Error).message });
  }
}

export const documentGenerateJob: JobDefinition<DocumentGeneratePayload, DocumentGenerateResult> = {
  name: 'document.generate',
  description: 'Not / deneme / soru seti üretimi: Opus (notes_generation | exam_generation) → doğrulama merdiveni → PDF → Storage → yayın ya da inceleme.',
  process: 'worker',
  payload,
  concurrency: 2,
  retry: RETRY,
  handler: async (p, ctx) => {
    try {
      return await runDocumentGenerate(p, ctx);
    } catch (err) {
      const c = classifyError(err);
      const permanent =
        err instanceof PermanentJobError || err instanceof RefusalError || (c.code !== 'unknown' && !c.retryable);
      const last = permanent || ctx.job.retryCount >= RETRY.retryLimit;
      if (!last) throw err;
      await markFailed(ctx, p, err);
      ctx.log.error('document.generate: belge üretilemedi', { document: p.document_id ?? p.request_id, error: (err as Error).message });
      if (err instanceof PermanentJobError) throw err;
      throw new PermanentJobError((err as Error).message.slice(0, 300), 'OGR-JOB-162');
    }
  },
};
