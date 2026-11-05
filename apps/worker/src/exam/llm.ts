/**
 * Deneme rotalarının çağrıları (page_class, exam_page_items, answer_sheet, inferred_keys). Kullanıcı turu metinleri
 * @ogrenmen/prompts kurucularıyla (sahte taşımanın fikstür eşlemesi de onlara dayanır: "sayfa 2/3."). Sistem metni
 * paketten (`systemPrompt`); ders bloğu exam_page_items ve inferred_keys'te (COURSE_ONLY önbellek).
 * inferred_keys bir Batch rotasıdır: varsayılan senkron (`batchRetry`); `EXAM_KEYS_BATCH=1` iken gerçek taşımada Batch
 * gönderilir, kimliği stash'e yazılır ve iş tamamlanana dek yeniden denenir (exam-analyse.ts).
 */
import { createHash } from 'node:crypto';
import { AnthropicTransport, renderCourseBlock, type CallInput, type Gateway, type RouteName, type SystemParts } from '@ogrenmen/llm';
import {
  answerSheetUserText,
  examPageItemsUserText,
  inferredKeysUserText,
  pageClassUserText,
  uploadOrderLine,
  type InferredKeysItem,
} from '@ogrenmen/prompts';
import { PermanentJobError } from '../jobs/errors.js';
import { systemPrompt } from '../prompts.js';
import type { JobContext } from '../jobs/types.js';

export type UserBlocks = Exclude<CallInput['user'], string>;

export interface PageRef {
  /** Modelin gördüğü sayfanın yükleme kimliği (normalleştirilmiş türev ya da orijinal). */
  refId: string;
  order: number;
  total: number;
  mime: string;
  fileId: string;
}

export function pageBlock(p: Pick<PageRef, 'mime' | 'fileId' | 'order'>): UserBlocks[number] {
  if (p.mime === 'application/pdf') return { type: 'document', source: { type: 'file', file_id: p.fileId }, title: `Sayfa ${p.order}` };
  return { type: 'image', source: { type: 'file', file_id: p.fileId } };
}

/** Files API'ye çıkarma: sahte taşımada ağsız deterministik kimlik. */
export async function uploadFile(gateway: Gateway, bytes: Buffer | null, name: string, mime: string, seed: string): Promise<string> {
  if (gateway.transport.kind === 'fake') return `fake-file-${createHash('sha256').update(bytes ?? Buffer.from(seed)).digest('hex').slice(0, 12)}`;
  const t = gateway.transport;
  if (!(t instanceof AnthropicTransport)) throw new PermanentJobError('Files API yalnız Anthropic taşımasında', 'OGR-JOB-140');
  if (!bytes) throw new PermanentJobError('sayfa görüntüsü yok (Storage yapılandırılmadı)', 'OGR-JOB-151');
  const meta = await t.client.files.upload({ file: new File([new Uint8Array(bytes)], name, { type: mime }), expires_in_seconds: 7_776_000 });
  return meta.id;
}

export interface ExamCallContext {
  ctx: JobContext;
  gateway: Gateway;
  sessionId: string;
  studentRef: string;
  courseId: string | null;
  curriculumId: string;
}

const systemCache = new WeakMap<object, Map<string, Promise<{ system: SystemParts; version: string }>>>();

/** Rota sistemi (ürün [+ ders]); iş başına önbellekli. */
async function systemFor(ec: ExamCallContext, route: RouteName, withCourse: boolean): Promise<{ system: SystemParts; version: string }> {
  let m = systemCache.get(ec);
  if (!m) {
    m = new Map();
    systemCache.set(ec, m);
  }
  const k = `${route}:${withCourse}`;
  let v = m.get(k);
  if (!v) {
    v = (async () => {
      const p = await systemPrompt(ec.ctx.db, route);
      if (!withCourse || !ec.courseId) return { system: { product: p.text }, version: p.version };
      const course = await renderCourseBlock(ec.ctx.db, ec.courseId, { curriculumId: ec.curriculumId });
      return { system: { product: p.text, course: course.text }, version: p.version };
    })();
    m.set(k, v);
  }
  return v;
}

async function call<R extends RouteName>(ec: ExamCallContext, route: R, user: UserBlocks, withCourse: boolean, extra: Partial<CallInput> = {}) {
  const { system, version } = await systemFor(ec, route, withCourse);
  return ec.gateway.call(route, {
    system,
    user,
    turn: { now: ec.ctx.now() },
    promptVersion: version,
    studentRef: ec.studentRef,
    ref: { table: 'exam_sessions', id: ec.sessionId },
    purpose: 'exam.analyse',
    signal: ec.ctx.signal,
    ...extra,
  });
}

export async function classifyPage(ec: ExamCallContext, page: PageRef, examTitle: string | null, courseTitle: string | null) {
  const res = await call(ec, 'page_class', [pageBlock(page), { type: 'text', text: pageClassUserText({ order: page.order, total: page.total, examTitle, courseTitle }) }], false);
  return { data: res.data, costUsd: res.costUsd };
}

export async function readBookletPage(ec: ExamCallContext, page: PageRef, sectionHint: string | null) {
  const res = await call(ec, 'exam_page_items', [pageBlock(page), { type: 'text', text: examPageItemsUserText({ order: page.order, total: page.total, sectionHint, previous: null }) }], true);
  return { data: res.data, costUsd: res.costUsd };
}

export async function readAnswerSheet(ec: ExamCallContext, page: PageRef, questionCount: number, sections: { name: string; from: number; to: number }[]) {
  const res = await call(ec, 'answer_sheet', [pageBlock(page), { type: 'text', text: answerSheetUserText({ order: page.order, total: page.total, questionCount, sections }) }], false);
  return { data: res.data, costUsd: res.costUsd };
}

/** Basılı cevap anahtarı sayfası: aynı rota, satırın işareti (ya da basılı harfi) anahtardır. */
export async function readKeyPage(ec: ExamCallContext, page: PageRef, questionCount: number) {
  const text = [
    uploadOrderLine(page),
    'Cevap anahtarı sayfası: optik form değil, yayıncının basılı anahtarı.',
    `Beklenen soru sayısı: ${questionCount}.`,
    'Her soru numarasının yanında basılı ya da işaretli doğru şıkkı marked_option olarak yaz; okunmayan satırı unclear bırak.',
  ].join('\n');
  const res = await call(ec, 'answer_sheet', [pageBlock(page), { type: 'text', text }], false);
  return { data: res.data, costUsd: res.costUsd };
}

export async function inferKeys(ec: ExamCallContext, examTitle: string | null, items: InferredKeysItem[]) {
  const res = await call(ec, 'inferred_keys', [{ type: 'text', text: inferredKeysUserText({ examTitle, items }) }], true, { batchRetry: true });
  return { data: res.data, costUsd: res.costUsd };
}

/** Batch gönderimi (EXAM_KEYS_BATCH=1, gerçek taşıma). */
export async function submitInferKeysBatch(ec: ExamCallContext, examTitle: string | null, items: InferredKeysItem[]) {
  const { system, version } = await systemFor(ec, 'inferred_keys', true);
  return ec.gateway.submitBatch('inferred_keys', [
    {
      customId: `keys-${ec.sessionId}`,
      input: {
        system,
        user: [{ type: 'text', text: inferredKeysUserText({ examTitle, items }) }],
        turn: { now: ec.ctx.now() },
        promptVersion: version,
        studentRef: ec.studentRef,
        ref: { table: 'exam_sessions', id: ec.sessionId },
        purpose: 'exam.analyse',
      },
    },
  ]);
}
