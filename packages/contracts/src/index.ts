/**
 * `@ogrenmen/contracts` — TS ve Python'un paylaştığı sözleşmeler (BLUEPRINT §4).
 *
 * Bu giriş çalışma zamanında Ajv derleyen `validate` yolunu sunar (Node testleri, panel,
 * araçlar). Worker bunun yerine `@ogrenmen/contracts/validators` (önceden derlenmiş) kullanır.
 * Cevap anahtarı yardımcıları ayrı alt yoldadır: `@ogrenmen/contracts/answer-key`.
 */
export { compileAll, errors, isValid, validate } from './validate.js';
export { ContractValidationError, type ContractIssue } from './errors.js';
export { SCHEMA_BASE, SCHEMA_NAMES, Schemas, schemaNameOf, type SchemaName } from './names.js';
export { schemaDocuments } from './schemas.js';
export { toGeminiSchema, type GeminiSchema } from './gemini-schema.js';
export {
  FORBIDDEN_WORDS_KEYWORD,
  containsForbiddenWord,
  findForbiddenWord,
  forbiddenWordsKeyword,
  normalizeTr,
} from './forbidden-words.js';
export { loadModels, type ModelsConfig } from './models.js';
export type * from './generated/index.js';
