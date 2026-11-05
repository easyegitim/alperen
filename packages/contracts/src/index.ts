/**
 * `@ogrenmen/contracts` — zod-önce sözleşmeler (PLAN-v2; docs/PLAN-v2-detail.md §4-5).
 *
 * Her sözleşme `{name, strict, loose}` taşır:
 *   - `strict`: yapılandırılmış çıktı şeması (`zodOutputFormat(solutionDiagnosis.strict)`); özyineleme,
 *     min/max/minLength/maxLength yok, tüm nesneler `additionalProperties: false`.
 *   - `loose`: aynı biçim + istemci tarafı kısıtlar + çapraz alan kuralları; model çıktısı ayrıştırıldıktan
 *     sonra buradan geçer (`solutionDiagnosis.parse(data)`).
 * `schemaRegistry` ad → loose, `strictSchemaRegistry` ad → strict. JSON Schema dışa aktarımı
 * `schemas/<ad>.schema.json` (Python tüketicileri) `bun run export` ile üretilir.
 */
export * from './registry.js';
export {
  defineContract,
  strictCtx,
  looseCtx,
  byteLength,
  type Contract,
  type ContractSpec,
  type Ctx,
  type Mode,
} from './zod/kit.js';
export { allJsonSchemas, contractJsonSchema, outputFormat, serializeJsonSchema, schemaFileName, type JsonSchemaObject } from './json-schema.js';

export * from './zod/common.js';
export * from './zod/answer-key.js';
export * from './zod/answer-sheet.js';
export * from './zod/conversation-summary.js';
export * from './zod/curriculum.js';
export * from './zod/curriculum-draft.js';
export * from './zod/document-ast.js';
export * from './zod/eval-verdict.js';
export * from './zod/exam-generation.js';
export * from './zod/block-regen.js';
export * from './zod/exam-item.js';
export * from './zod/exam-page-items.js';
export * from './zod/exam-priority-plan.js';
export * from './zod/exam-report.js';
export * from './zod/figure-render-report.js';
export * from './zod/inferred-keys.js';
export * from './zod/lesson-analysis.js';
export * from './zod/memory-compaction.js';
export * from './zod/memory-delta.js';
export * from './zod/memory-fact.js';
export * from './zod/notification-copy.js';
export * from './zod/page-class.js';
export * from './zod/personalization-check.js';
export * from './zod/proposal-review.js';
export * from './zod/question-generation.js';
export * from './zod/question-item.js';
export * from './zod/solution-diagnosis.js';
export * from './zod/style-definition.js';
export * from './zod/transcript.js';
export * from './zod/weekly-summary.js';
