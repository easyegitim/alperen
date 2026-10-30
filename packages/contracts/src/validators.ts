/**
 * `@ogrenmen/contracts/validators` — önceden derlenmiş (Ajv standalone) doğrulayıcılar.
 * Worker YALNIZ bunu içe alır: şema derleme yok, Ajv çalışma zamanı yok (Cloudflare ücretsiz
 * planında istek başına 10 ms CPU). İmza `validate.ts` ile aynıdır; `test/fixtures.test.ts`
 * iki yolun her fixture'da aynı kararı verdiğini denetler.
 *
 * Cevap anahtarı taşıyan sözleşmeler (`answer-key`, `diagnostic-keys`, `question-generation`)
 * bu yolda YOKTUR: üretilen `validators.js` onları içermez ve burada istenirlerse
 * `OGR-SCHEMA-005` fırlatılır (BLUEPRINT §4: Worker answer-key şemasını içe alamaz). Pipelines
 * ve seed araçları `@ogrenmen/contracts/answer-key` kullanır.
 *
 * Başvuru kısa ad, `$id` ya da `<ad>#/$defs/<tanım>` olabilir (ör. `transcript#/$defs/segment`).
 */
import * as compiled from './generated/validators.js';
import type { StandaloneValidate } from './generated/validators.js';
import { ContractValidationError, toIssues, type ContractIssue } from './errors.js';
import { isKeySchema, parseSchemaRef, schemaRefId, standaloneExportName, type SchemaName } from './names.js';

export { ContractValidationError, type ContractIssue } from './errors.js';
export {
  SCHEMA_NAMES,
  Schemas,
  WORKER_SCHEMA_NAMES,
  parseSchemaRef,
  schemaNameOf,
  type SchemaName,
  type WorkerSchemaName,
} from './names.js';

const table = compiled as unknown as Record<string, StandaloneValidate | undefined>;

function lookup(nameOrRef: string): { id: string; fn: StandaloneValidate } {
  const ref = parseSchemaRef(nameOrRef);
  if (isKeySchema(ref.name)) {
    throw new Error(
      `OGR-SCHEMA-005 ${ref.name} cevap anahtarı taşır; Worker yolunda yok (@ogrenmen/contracts/answer-key)`,
    );
  }
  const fn = table[standaloneExportName(ref)];
  if (typeof fn !== 'function') {
    throw new Error(`OGR-SCHEMA-001 önceden derlenmiş doğrulayıcı yok: ${nameOrRef} (bun run gen)`);
  }
  return { id: schemaRefId(ref), fn };
}

function run(schemaId: string, data: unknown): { id: string; ok: boolean; issues: ContractIssue[] } {
  const { id, fn } = lookup(schemaId);
  const ok = fn(data);
  return { id, ok, issues: ok ? [] : toIssues(fn.errors) };
}

/** Hata listesi (geçerliyse boş dizi). */
export function errors(schemaId: SchemaName | string, data: unknown): ContractIssue[] {
  return run(schemaId, data).issues;
}

/** Veri sözleşmeye uyuyor mu. */
export function isValid(schemaId: SchemaName | string, data: unknown): boolean {
  return run(schemaId, data).ok;
}

/** Doğrular ve veriyi `T` olarak döner; uymazsa `ContractValidationError` fırlatır. */
export function validate<T>(schemaId: SchemaName | string, data: unknown): T {
  const { id, ok, issues } = run(schemaId, data);
  if (!ok) throw new ContractValidationError(id, issues);
  return data as T;
}
