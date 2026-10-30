/**
 * Sözleşme belgeleri: kısa ad → JSON Schema belgesi (çalışma zamanı Ajv'si, Gemini düzleştirme).
 */
import answerKey from '../schemas/answer-key.schema.json' with { type: 'json' };
import botResponseLog from '../schemas/bot-response-log.schema.json' with { type: 'json' };
import common from '../schemas/common.schema.json' with { type: 'json' };
import curriculum from '../schemas/curriculum.schema.json' with { type: 'json' };
import diagnosticKeys from '../schemas/diagnostic-keys.schema.json' with { type: 'json' };
import diagnosticTest from '../schemas/diagnostic-test.schema.json' with { type: 'json' };
import examItem from '../schemas/exam-item.schema.json' with { type: 'json' };
import examPriorityPlan from '../schemas/exam-priority-plan.schema.json' with { type: 'json' };
import figureRenderReport from '../schemas/figure-render-report.schema.json' with { type: 'json' };
import generationRequest from '../schemas/generation-request.schema.json' with { type: 'json' };
import instructorAlert from '../schemas/instructor-alert.schema.json' with { type: 'json' };
import lessonAnalysis from '../schemas/lesson-analysis.schema.json' with { type: 'json' };
import memoryFact from '../schemas/memory-fact.schema.json' with { type: 'json' };
import misconceptionTags from '../schemas/misconception-tags.schema.json' with { type: 'json' };
import models from '../schemas/models.schema.json' with { type: 'json' };
import nightlyFactsOutput from '../schemas/nightly-facts-output.schema.json' with { type: 'json' };
import queryExpand from '../schemas/query-expand.schema.json' with { type: 'json' };
import questionGeneration from '../schemas/question-generation.schema.json' with { type: 'json' };
import questionItem from '../schemas/question-item.schema.json' with { type: 'json' };
import researchOutput from '../schemas/research-output.schema.json' with { type: 'json' };
import telegramUpdate from '../schemas/telegram-update.schema.json' with { type: 'json' };
import templateParams from '../schemas/template-params.schema.json' with { type: 'json' };
import transcript from '../schemas/transcript.schema.json' with { type: 'json' };
import tutorReply from '../schemas/tutor-reply.schema.json' with { type: 'json' };
import weeklySummary from '../schemas/weekly-summary.schema.json' with { type: 'json' };
import type { SchemaName } from './names.js';

export { SCHEMA_BASE, SCHEMA_NAMES, Schemas, schemaNameOf, type SchemaName } from './names.js';

/** Kısa ad → şema belgesi (salt okunur kabul edilir; değiştirilmez). */
export const schemaDocuments: { readonly [K in SchemaName]: Record<string, unknown> } = {
  'answer-key': answerKey,
  'bot-response-log': botResponseLog,
  'common': common,
  'curriculum': curriculum,
  'diagnostic-keys': diagnosticKeys,
  'diagnostic-test': diagnosticTest,
  'exam-item': examItem,
  'exam-priority-plan': examPriorityPlan,
  'figure-render-report': figureRenderReport,
  'generation-request': generationRequest,
  'instructor-alert': instructorAlert,
  'lesson-analysis': lessonAnalysis,
  'memory-fact': memoryFact,
  'misconception-tags': misconceptionTags,
  'models': models,
  'nightly-facts-output': nightlyFactsOutput,
  'query-expand': queryExpand,
  'question-generation': questionGeneration,
  'question-item': questionItem,
  'research-output': researchOutput,
  'telegram-update': telegramUpdate,
  'template-params': templateParams,
  'transcript': transcript,
  'tutor-reply': tutorReply,
  'weekly-summary': weeklySummary,
};
