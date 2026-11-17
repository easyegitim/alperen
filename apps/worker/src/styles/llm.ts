/**
 * Tarz kütüphanesi rotalarının çağrıları. Sistem metni paketten (`systemPrompt`, veritabanı sürüm sabitlemesiyle), ders
 * bloğu (`renderCourseBlock`: kazanım ağacı, yanılgı etiketleri, etkin tarzlar) system[1]'de 1 saat önbellekli.
 *
 *   exam_page_items     (Sonnet, senkron)  sayfa → sorular; kullanıcı metni `archivePageUserText`
 *   exam_item_extract   (Sonnet, Batch rotası) madde → exam-item v2; varsayılan senkron `batchRetry` (öğrenci beklemez ama
 *                       eğitmen kütüphaneyi bekler; Batch gönderimi sonraki iş: README "Bilinen boşluklar")
 *   style_definition    (Sonnet, Batch rotası) kümeler → tarz adı/tanımı; senkron `batchRetry`
 *   style_question_gen  (Opus, senkron)    tarz → özgün sorular + ayrı anahtar; yerel figür kipinde code_execution kapalı
 */
import type { ExamItem, ExamPageItems, StyleDefinition, StyleQuestionGeneration } from '@ogrenmen/contracts';
import { renderCourseBlock, type CallInput, type Gateway, type RouteName, type SystemParts } from '@ogrenmen/llm';
import {
  archivePageUserText,
  examItemExtractUserText,
  styleDefinitionUserText,
  styleQuestionGenUserText,
  type ExamItemExtractInput,
  type StyleDefinitionInput,
  type StyleRequestInput,
} from '@ogrenmen/prompts';
import type { Db } from '../db.js';
import { pageBlock } from '../exam/llm.js';
import { systemPrompt } from '../prompts.js';
import type { ArchivePage } from './pages.js';

export interface StyleCallEnv {
  db: Db;
  gateway: Gateway;
  courseId: string;
  curriculumId: string | null;
  ref: { table: string; id: string };
  studentRef: string | null;
  purpose: string;
  now: () => Date;
  signal?: AbortSignal;
}

const systems = new WeakMap<StyleCallEnv, Map<string, Promise<{ system: SystemParts; version: string }>>>();

async function systemFor(env: StyleCallEnv, route: RouteName): Promise<{ system: SystemParts; version: string }> {
  let m = systems.get(env);
  if (!m) {
    m = new Map();
    systems.set(env, m);
  }
  let v = m.get(route);
  if (!v) {
    v = (async () => {
      const p = await systemPrompt(env.db, route);
      const course = await renderCourseBlock(env.db, env.courseId, env.curriculumId ? { curriculumId: env.curriculumId } : {}).catch(() => null);
      return { system: course ? { product: p.text, course: course.text } : { product: p.text }, version: p.version };
    })();
    m.set(route, v);
  }
  return v;
}

async function call<R extends RouteName>(env: StyleCallEnv, route: R, user: CallInput['user'], extra: Partial<CallInput> = {}) {
  const { system, version } = await systemFor(env, route);
  return env.gateway.call(route, {
    system,
    user,
    turn: { now: env.now() },
    promptVersion: version,
    studentRef: env.studentRef,
    ref: env.ref,
    purpose: env.purpose,
    ...(env.signal ? { signal: env.signal } : {}),
    ...extra,
  });
}

export async function readArchivePage(env: StyleCallEnv, page: ArchivePage, tag: { year: number; term: string | null }) {
  const res = await call(env, 'exam_page_items', [
    pageBlock({ mime: page.mime, fileId: page.fileId, order: page.order }),
    { type: 'text', text: archivePageUserText({ order: page.order, total: page.total, year: tag.year, term: tag.term }) },
  ]);
  return { data: res.data as ExamPageItems, costUsd: res.costUsd };
}

export async function extractItem(env: StyleCallEnv, input: ExamItemExtractInput) {
  const res = await call(env, 'exam_item_extract', examItemExtractUserText(input), { batchRetry: true });
  return { data: res.data as ExamItem, costUsd: res.costUsd };
}

export async function defineStyles(env: StyleCallEnv, input: StyleDefinitionInput) {
  const res = await call(env, 'style_definition', styleDefinitionUserText(input), { batchRetry: true });
  return { data: res.data as StyleDefinition, costUsd: res.costUsd };
}

export async function generateStyleQuestions(env: StyleCallEnv, input: StyleRequestInput, opts: { localFigures: boolean }) {
  const res = await call(env, 'style_question_gen', styleQuestionGenUserText(input), opts.localFigures ? { disableTools: ['code_execution'] } : {});
  return { data: res.data as StyleQuestionGeneration, costUsd: res.costUsd, model: res.model, transcript: res.transcript };
}
