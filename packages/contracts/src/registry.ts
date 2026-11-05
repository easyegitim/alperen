/**
 * Sözleşme kayıt defteri: ad → sözleşme. `schemaRegistry` ad → loose zod (istemci doğrulaması),
 * `strictSchemaRegistry` ad → strict zod (yapılandırılmış çıktı). Dışa aktarım betiği ve testler buradan okur.
 */
import type { Contract } from './zod/kit.js';
import { answerKey } from './zod/answer-key.js';
import { answerSheet } from './zod/answer-sheet.js';
import { documentBlockRegen, examBlockRegen } from './zod/block-regen.js';
import { conversationSummary } from './zod/conversation-summary.js';
import { curriculum } from './zod/curriculum.js';
import { curriculumDraft } from './zod/curriculum-draft.js';
import { documentAst } from './zod/document-ast.js';
import { evalVerdict } from './zod/eval-verdict.js';
import { examGeneration } from './zod/exam-generation.js';
import { examItem } from './zod/exam-item.js';
import { examPageItems } from './zod/exam-page-items.js';
import { examPriorityPlan } from './zod/exam-priority-plan.js';
import { examReport, reportAst } from './zod/exam-report.js';
import { figureRenderReport } from './zod/figure-render-report.js';
import { inferredKeys } from './zod/inferred-keys.js';
import { lessonAnalysis } from './zod/lesson-analysis.js';
import { memoryCompaction } from './zod/memory-compaction.js';
import { memoryDelta } from './zod/memory-delta.js';
import { memoryFact } from './zod/memory-fact.js';
import { notificationCopy } from './zod/notification-copy.js';
import { pageClass } from './zod/page-class.js';
import { personalizationCheck } from './zod/personalization-check.js';
import { proposalReview } from './zod/proposal-review.js';
import { questionItem } from './zod/question-item.js';
import { solutionDiagnosis } from './zod/solution-diagnosis.js';
import { styleDefinition } from './zod/style-definition.js';
import { styleQuestionGeneration } from './zod/question-generation.js';
import { transcript } from './zod/transcript.js';
import { weeklySummary } from './zod/weekly-summary.js';

/** Ad → sözleşme (alfabetik). Anahtar = `contract.name` = `schemas/<ad>.schema.json`. */
export const contractRegistry = {
  'answer-key': answerKey,
  'answer-sheet': answerSheet,
  'conversation-summary': conversationSummary,
  'curriculum': curriculum,
  'curriculum-draft': curriculumDraft,
  'document-ast': documentAst,
  'document-block-regen': documentBlockRegen,
  'eval-verdict': evalVerdict,
  'exam-block-regen': examBlockRegen,
  'exam-generation': examGeneration,
  'exam-item': examItem,
  'exam-page-items': examPageItems,
  'exam-priority-plan': examPriorityPlan,
  'exam-report': examReport,
  'figure-render-report': figureRenderReport,
  'inferred-keys': inferredKeys,
  'lesson-analysis': lessonAnalysis,
  'memory-compaction': memoryCompaction,
  'memory-delta': memoryDelta,
  'memory-fact': memoryFact,
  'notification-copy': notificationCopy,
  'page-class': pageClass,
  'personalization-check': personalizationCheck,
  'proposal-review': proposalReview,
  'question-item': questionItem,
  'report-ast': reportAst,
  'solution-diagnosis': solutionDiagnosis,
  'style-definition': styleDefinition,
  'style-question-generation': styleQuestionGeneration,
  'transcript': transcript,
  'weekly-summary': weeklySummary,
} as const;

export type SchemaName = keyof typeof contractRegistry;

export const SCHEMA_NAMES = Object.keys(contractRegistry) as SchemaName[];

type LooseOf<K extends SchemaName> = (typeof contractRegistry)[K]['loose'];
type StrictOf<K extends SchemaName> = (typeof contractRegistry)[K]['strict'];

/** Ad → loose zod şeması (kısıtlar + çapraz kurallar). */
export const schemaRegistry = Object.fromEntries(SCHEMA_NAMES.map((n) => [n, contractRegistry[n].loose])) as {
  [K in SchemaName]: LooseOf<K>;
};

/** Ad → strict zod şeması (`zodOutputFormat(...)` için). */
export const strictSchemaRegistry = Object.fromEntries(SCHEMA_NAMES.map((n) => [n, contractRegistry[n].strict])) as {
  [K in SchemaName]: StrictOf<K>;
};

/** Model çıktısı olarak kullanılan (strict kısıt testleri koşan) sözleşmeler. */
export const LLM_OUTPUT_SCHEMA_NAMES = SCHEMA_NAMES.filter((n) => (contractRegistry[n] as Contract).llmOutput);

export function isSchemaName(name: string): name is SchemaName {
  return Object.hasOwn(contractRegistry, name);
}

/** `$id` taban adresi; `schemas/<ad>.schema.json` içindeki `$id` = `SCHEMA_BASE + ad + '.json'`. */
export const SCHEMA_BASE = 'https://ogrenmen.easy/schemas/';

export const schemaId = (name: SchemaName): string => `${SCHEMA_BASE}${name}.json`;
