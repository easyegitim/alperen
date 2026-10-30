/**
 * toGeminiSchema — JSON Schema (2020-12) sözleşmesini Gemini `responseSchema` alt kümesine
 * düzleştirir (BLUEPRINT §4). Python eşleniği `python/ogrenmen_contracts/gemini.py`
 * (`scripts/flatten.py` onu çağırır ve `schemas/gemini/*.json` dosyalarını yazar);
 * `test/gemini-parity.test.ts` iki çıktının birebir aynı olduğunu denetler.
 *
 * Kurallar (iki dilde aynı sırayla uygulanır):
 *  - `$ref` çözülür ve yerine konur (dosyalar arası dahil); döngü → hata.
 *  - `$id`, `$schema`, `$defs`, `examples`, `x-*`, `additionalProperties`, koşullu ve
 *    birleştirici kısıtlar (`allOf`, `if/then/else`, `not`, `contains`…) atılır — bu kurallar
 *    dönen JSON Ajv/jsonschema ile doğrulanırken zaten uygulanır.
 *  - `format` yalnız `enum` ve `date-time` ise korunur.
 *  - `const` → tek elemanlı `enum`; `oneOf` → `anyOf`; `null` dalı/türü → `nullable: true`.
 *  - Yalnız kısıt taşıyan dallar (ör. `oneOf: [{required: [...]}, …]`) atılır.
 *  - `properties` olan her nesneye `propertyOrdering` (alanların tanım sırası) eklenir.
 */
import { parseSchemaRef } from './names.js';
import { schemaDocuments, type SchemaName } from './schemas.js';

export type GeminiSchema = { [key: string]: unknown };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const COPY_KEYS = new Set([
  'type',
  'title',
  'description',
  'enum',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  'pattern',
  'required',
]);
const KEPT_FORMATS = new Set(['enum', 'date-time']);
/** Bir dalı "şekil" taşıyan (yalnız kısıt olmayan) dal yapan anahtarlar. */
const SHAPE_KEYS = ['type', 'enum', 'properties', 'items', 'anyOf', 'nullable'];

function isObject(x: unknown): x is JsonObject {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function docsById(): Map<string, JsonObject> {
  const map = new Map<string, JsonObject>();
  for (const doc of Object.values(schemaDocuments) as unknown as JsonObject[]) {
    map.set(String(doc.$id), doc);
  }
  return map;
}

function decodePointer(fragment: string): string[] {
  if (fragment === '' || fragment === '/') return fragment === '' ? [] : [''];
  if (!fragment.startsWith('/')) throw new Error(`OGR-SCHEMA-002 desteklenmeyen $ref parçası: #${fragment}`);
  return fragment
    .slice(1)
    .split('/')
    .map((p) => decodeURIComponent(p).replace(/~1/g, '/').replace(/~0/g, '~'));
}

function resolveRef(ref: string, base: string, docs: Map<string, JsonObject>): { node: Json; base: string; key: string } {
  const abs = new URL(ref, base).toString();
  const hashAt = abs.indexOf('#');
  const docUrl = hashAt === -1 ? abs : abs.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : abs.slice(hashAt + 1);
  const doc = docs.get(docUrl);
  if (!doc) throw new Error(`OGR-SCHEMA-002 çözülemeyen $ref: ${ref} (taban ${base})`);
  let node: Json = doc;
  for (const part of decodePointer(fragment)) {
    if (Array.isArray(node)) node = node[Number(part)] as Json;
    else if (isObject(node)) node = node[part] as Json;
    else node = undefined as unknown as Json;
    if (node === undefined) throw new Error(`OGR-SCHEMA-002 çözülemeyen $ref: ${ref}`);
  }
  return { node, base: docUrl, key: `${docUrl}#${fragment}` };
}

function inferEnumType(values: Json[]): string | null {
  if (values.length === 0) return null;
  if (values.every((v) => typeof v === 'string')) return 'string';
  if (values.every((v) => typeof v === 'boolean')) return 'boolean';
  if (values.every((v) => typeof v === 'number' && Number.isInteger(v))) return 'integer';
  if (values.every((v) => typeof v === 'number')) return 'number';
  return null;
}

function isShape(node: JsonObject): boolean {
  return SHAPE_KEYS.some((k) => k in node);
}

function clean(node: Json, base: string, stack: string[], docs: Map<string, JsonObject>): Json {
  if (Array.isArray(node)) return node.map((x) => clean(x, base, stack, docs));
  if (!isObject(node)) return node;

  if (typeof node.$ref === 'string') {
    const { node: target, base: targetBase, key } = resolveRef(node.$ref, base, docs);
    if (stack.includes(key)) throw new Error(`OGR-SCHEMA-003 döngüsel $ref: ${[...stack, key].join(' → ')}`);
    const resolved = clean(target, targetBase, [...stack, key], docs);
    const siblings: JsonObject = {};
    for (const [k, v] of Object.entries(node)) if (k !== '$ref') siblings[k] = v;
    const cleanedSiblings = clean(siblings, base, stack, docs) as JsonObject;
    return { ...(resolved as JsonObject), ...cleanedSiblings };
  }

  const out: JsonObject = {};
  let nullable = false;
  let branches: Json[] | null = null;

  for (const [key, value] of Object.entries(node)) {
    if (key === 'const') {
      out.enum = [value];
    } else if (key === 'format') {
      if (typeof value === 'string' && KEPT_FORMATS.has(value)) out.format = value;
    } else if (key === 'properties' && isObject(value)) {
      const props: JsonObject = {};
      for (const [pk, pv] of Object.entries(value)) props[pk] = clean(pv, base, stack, docs);
      out.properties = props;
      out.propertyOrdering = Object.keys(value);
    } else if (key === 'items') {
      out.items = clean(value, base, stack, docs);
    } else if (key === 'oneOf' || key === 'anyOf') {
      branches = [...(branches ?? []), ...(value as Json[]).map((b) => clean(b, base, stack, docs))];
    } else if (COPY_KEYS.has(key)) {
      out[key] = value;
    }
    // Diğer tüm anahtarlar (x-*, $id, $schema, $defs, examples, additionalProperties,
    // allOf, if/then/else, not, contains, exclusiveMinimum, …) bilerek atılır.
  }

  if (Array.isArray(out.type)) {
    const types = (out.type as Json[]).filter((t) => t !== 'null');
    if (types.length !== (out.type as Json[]).length) nullable = true;
    if (types.length === 1) {
      out.type = types[0] as Json;
    } else {
      delete out.type;
      branches = [...types.map((t) => ({ type: t }) as Json), ...(branches ?? [])];
    }
  } else if (out.type === 'null') {
    delete out.type;
    nullable = true;
  }

  if (Array.isArray(out.enum)) {
    const values = (out.enum as Json[]).filter((v) => v !== null);
    if (values.length !== (out.enum as Json[]).length) nullable = true;
    out.enum = values;
    if (!('type' in out)) {
      const t = inferEnumType(values);
      if (t !== null) out.type = t;
    }
  }

  if (branches !== null) {
    const kept: JsonObject[] = [];
    for (const b of branches) {
      if (!isObject(b)) continue;
      if (Object.keys(b).length === 1 && b.nullable === true) {
        nullable = true;
        continue;
      }
      if (!isShape(b)) continue;
      if (b.nullable === true) {
        nullable = true;
        const copy = { ...b };
        delete copy.nullable;
        kept.push(copy);
      } else {
        kept.push(b);
      }
    }
    if (kept.length === 1) {
      const merged: JsonObject = { ...(kept[0] as JsonObject) };
      for (const [k, v] of Object.entries(out)) merged[k] = v;
      for (const k of Object.keys(out)) delete out[k];
      Object.assign(out, merged);
    } else if (kept.length > 1) {
      out.anyOf = kept;
    }
  }

  if (nullable) out.nullable = true;
  return out;
}

/** Bir sözleşmenin Gemini `responseSchema` biçimi. `nameOrId`: kısa ad ya da `$id`. */
export function toGeminiSchema(nameOrId: SchemaName | string): GeminiSchema {
  const ref = parseSchemaRef(nameOrId);
  if (ref.def !== null) throw new Error(`OGR-SCHEMA-001 Gemini şeması yalnız tam sözleşme için üretilir: ${nameOrId}`);
  const name = ref.name;
  const doc = schemaDocuments[name] as unknown as JsonObject;
  if (!('type' in doc)) {
    throw new Error(`OGR-SCHEMA-004 ${name} yalnız ortak tanım taşır; Gemini şeması üretilmez`);
  }
  return clean(doc, String(doc.$id), [], docsById()) as GeminiSchema;
}
