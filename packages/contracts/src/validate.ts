/**
 * Çalışma zamanı doğrulayıcısı: Ajv 8 (`ajv/dist/2020`, `ajv-formats`) her şemayı ilk
 * kullanımda derler. Yalnız Node testleri, panel ve araçlar içindir; Worker bunu DEĞİL
 * önceden derlenmiş `@ogrenmen/contracts/validators` alt yolunu içe alır (10 ms CPU bütçesi).
 */
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import { AJV_OPTIONS, ANNOTATION_KEYWORDS } from './ajv-options.js';
import { ContractValidationError, toIssues, type ContractIssue } from './errors.js';
import { forbiddenWordsKeyword } from './forbidden-words.js';
import { parseSchemaRef, schemaRefId } from './names.js';
import { SCHEMA_NAMES, schemaDocuments, type SchemaName } from './schemas.js';

// CJS/ESM birlikte çalışması: Node varsayılanı module.exports, paketleyiciler .default verir.
type AjvCtor = typeof Ajv2020Module;
const Ajv2020 = ((Ajv2020Module as unknown as { default?: AjvCtor }).default ?? Ajv2020Module) as AjvCtor;
type AddFormats = typeof addFormatsModule;
const addFormats = ((addFormatsModule as unknown as { default?: AddFormats }).default ?? addFormatsModule) as AddFormats;

let ajvInstance: InstanceType<AjvCtor> | null = null;
const compiled = new Map<string, ValidateFunction>();

function ajv(): InstanceType<AjvCtor> {
  if (ajvInstance) return ajvInstance;
  const instance = new Ajv2020({ ...AJV_OPTIONS });
  addFormats(instance);
  for (const kw of ANNOTATION_KEYWORDS) instance.addKeyword(kw);
  instance.addKeyword(forbiddenWordsKeyword);
  for (const name of SCHEMA_NAMES) instance.addSchema(schemaDocuments[name]);
  ajvInstance = instance;
  return instance;
}

/**
 * Başvuru (kısa ad, `$id` ya da `<ad>#/$defs/<tanım>`) için derlenmiş doğrulayıcı.
 * Parçalı başvuruda yalnız o tanım uygulanır (kökteki `x-forbidden-words` dahil değildir).
 */
function getValidator(nameOrRef: string): { id: string; fn: ValidateFunction } {
  const id = schemaRefId(parseSchemaRef(nameOrRef));
  let fn = compiled.get(id);
  if (!fn) {
    let found: ValidateFunction | undefined;
    try {
      found = ajv().getSchema(id);
    } catch (e) {
      throw new Error(`OGR-SCHEMA-001 çözülemeyen başvuru: ${nameOrRef} (${(e as Error).message})`);
    }
    if (!found) throw new Error(`OGR-SCHEMA-001 çözülemeyen başvuru: ${nameOrRef}`);
    fn = found;
    compiled.set(id, fn);
  }
  return { id, fn };
}

/** Hata listesi (geçerliyse boş dizi). */
export function errors(schemaId: SchemaName | string, data: unknown): ContractIssue[] {
  const { fn } = getValidator(schemaId);
  return fn(data) ? [] : toIssues(fn.errors);
}

/** Veri sözleşmeye uyuyor mu. */
export function isValid(schemaId: SchemaName | string, data: unknown): boolean {
  return getValidator(schemaId).fn(data);
}

/** Doğrular ve veriyi `T` olarak döner; uymazsa `ContractValidationError` fırlatır. */
export function validate<T>(schemaId: SchemaName | string, data: unknown): T {
  const { id, fn } = getValidator(schemaId);
  if (!fn(data)) throw new ContractValidationError(id, toIssues(fn.errors));
  return data as T;
}

/** Tüm şemaları şimdi derler (test ve önbellek ısıtma için). */
export function compileAll(): void {
  for (const name of SCHEMA_NAMES) getValidator(name);
}
