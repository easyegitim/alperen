/**
 * `@ogrenmen/contracts/answer-key` — cevap anahtarı taşıyan sözleşmeler (yalnız pipelines/seed
 * araçları; `register_answer_key` RPC'sine giden veri): `answer-key`, `diagnostic-keys`,
 * `question-generation`. Worker bu alt yolu içe ALAMAZ: ESLint `no-restricted-imports` ve
 * `apps/worker/test/answer-key-import.test.ts` bunu yasaklar.
 *
 * Doğrulayıcılar önceden derlenmiştir (`src/generated/validators-keys.js`; Worker'ın yüklediği
 * `validators.js`'ten ayrı dosya). Karar çalışma zamanı yolu (`validate.ts`) ile aynıdır.
 */
import * as compiled from './generated/validators-keys.js';
import type { StandaloneValidate } from './generated/validators-keys.js';
import type { AnswerKey } from './generated/answer-key.js';
import type { DiagnosticKeys } from './generated/diagnostic-keys.js';
import type { QuestionGeneration } from './generated/question-generation.js';
import { ContractValidationError, toIssues, type ContractIssue } from './errors.js';
import {
  Schemas,
  isKeySchema,
  parseSchemaRef,
  schemaRefId,
  standaloneExportName,
  type KeySchemaName,
} from './names.js';

export type { AnswerKey } from './generated/answer-key.js';
export type { DiagnosticKeys } from './generated/diagnostic-keys.js';
export type { QuestionGeneration } from './generated/question-generation.js';
export { KEY_SCHEMA_NAMES, type KeySchemaName } from './names.js';

export const ANSWER_KEY_SCHEMA_ID = Schemas['answer-key'];
export const DIAGNOSTIC_KEYS_SCHEMA_ID = Schemas['diagnostic-keys'];
export const QUESTION_GENERATION_SCHEMA_ID = Schemas['question-generation'];

const table = compiled as unknown as Record<string, StandaloneValidate | undefined>;

function lookup(nameOrRef: string): { id: string; fn: StandaloneValidate } {
  const ref = parseSchemaRef(nameOrRef);
  if (!isKeySchema(ref.name)) {
    throw new Error(`OGR-SCHEMA-001 ${ref.name} cevap anahtarı sözleşmesi değil (@ogrenmen/contracts/validators)`);
  }
  const fn = table[standaloneExportName(ref)];
  if (typeof fn !== 'function') {
    throw new Error(`OGR-SCHEMA-001 önceden derlenmiş doğrulayıcı yok: ${nameOrRef} (bun run gen)`);
  }
  return { id: schemaRefId(ref), fn };
}

/** Anahtar sözleşmesi için hata listesi (geçerliyse boş dizi). */
export function keyErrors(schemaId: KeySchemaName | string, data: unknown): ContractIssue[] {
  const { fn } = lookup(schemaId);
  return fn(data) ? [] : toIssues(fn.errors);
}

/** Anahtar sözleşmesine uyuyor mu. */
export function isValidKey(schemaId: KeySchemaName | string, data: unknown): boolean {
  return lookup(schemaId).fn(data);
}

/** Anahtar sözleşmesine göre doğrular; uymazsa `ContractValidationError`. */
export function validateKey<T>(schemaId: KeySchemaName | string, data: unknown): T {
  const { id, fn } = lookup(schemaId);
  if (!fn(data)) throw new ContractValidationError(id, toIssues(fn.errors));
  return data as T;
}

/** Cevap anahtarını doğrular; `correct_option` ya da `numeric_value`'dan tam biri zorunlu. */
export function validateAnswerKey(data: unknown): AnswerKey {
  return validateKey<AnswerKey>('answer-key', data);
}

export function isValidAnswerKey(data: unknown): boolean {
  return isValidKey('answer-key', data);
}

export function answerKeyErrors(data: unknown): ContractIssue[] {
  return keyErrors('answer-key', data);
}

/** Teşhis anahtar dosyası (`diagnostic/answer-keys.json`; yalnız seed-keys.py ve araçlar). */
export function validateDiagnosticKeys(data: unknown): DiagnosticKeys {
  return validateKey<DiagnosticKeys>('diagnostic-keys', data);
}

/** Tablet'in LLM çıktısı (`{item, key}` zarfı). */
export function validateQuestionGeneration(data: unknown): QuestionGeneration {
  return validateKey<QuestionGeneration>('question-generation', data);
}
