/**
 * zod → JSON Schema (2020-12) dışa aktarımı. `schemas/<ad>.schema.json` (loose: kısıtlarla; Python
 * tüketicileri) buradan üretilir; `scripts/export-json-schema.ts` yazar, testler yeniden üretilebilirliği denetler.
 * Çapraz alan kuralları (refine) JSON Schema'ya girmez; yalnızca TS tarafında uygulanır.
 */
import { z } from 'zod';
import { SCHEMA_BASE, SCHEMA_NAMES, contractRegistry, type SchemaName } from './registry.js';
import type { Contract } from './zod/kit.js';

export type JsonSchemaObject = { [key: string]: unknown };

const SAFE_INT = Number.MAX_SAFE_INTEGER;
/** Biçimi zaten söyleyen alanlarda zod'un eklediği uzun desenleri düşür (Python biçim denetleyicisi var). */
const FORMATS_WITH_NOISY_PATTERN = new Set(['uuid', 'date', 'date-time']);

function isObject(x: unknown): x is JsonSchemaObject {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Zod'un gürültü anahtarlarını temizler (güvenli tamsayı sınırları, biçim desenleri, propertyNames:string). */
function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!isObject(node)) return node;
  const out: JsonSchemaObject = {};
  for (const [k, v] of Object.entries(node)) out[k] = clean(v);
  if (out.type === 'integer' || out.type === 'number') {
    if (out.minimum === -SAFE_INT) delete out.minimum;
    if (out.maximum === SAFE_INT) delete out.maximum;
  }
  // Bun RegExp.source ASCII dışını \uXXXX yazar, Node yazmaz: dışa aktarım çalışma zamanından bağımsız kalsın.
  if (typeof out.pattern === 'string') {
    out.pattern = out.pattern.replace(/(?<!\\)\\u([0-9a-fA-F]{4})/g, (m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code >= 0x80 && (code < 0xd800 || code > 0xdfff) ? String.fromCharCode(code) : m;
    });
  }
  if (typeof out.format === 'string' && FORMATS_WITH_NOISY_PATTERN.has(out.format)) delete out.pattern;
  if (isObject(out.propertyNames) && Object.keys(out.propertyNames).length === 1 && out.propertyNames.type === 'string') {
    delete out.propertyNames;
  }
  return out;
}

function getAt(root: JsonSchemaObject, path: string[]): unknown {
  let cur: unknown = root;
  for (const p of path) {
    if (!isObject(cur)) throw new Error(`OGR-SCHEMA-001 çözülemeyen yol: ${path.join('/')}`);
    cur = cur[p];
  }
  return cur;
}

function setAt(root: JsonSchemaObject, path: string[], value: unknown): void {
  const parent = getAt(root, path.slice(0, -1));
  if (!isObject(parent)) throw new Error(`OGR-SCHEMA-001 çözülemeyen yol: ${path.join('/')}`);
  parent[path[path.length - 1] as string] = value;
}

/** Tek sözleşmenin JSON Schema'sı. `mode`: loose (varsayılan, dosyaya yazılan) | strict (LLM çıktısı). */
export function contractJsonSchema(contract: Contract, mode: 'loose' | 'strict' = 'loose'): JsonSchemaObject {
  const raw = z.toJSONSchema(contract[mode], { target: 'draft-2020-12', io: mode === 'loose' ? 'input' : 'output', unrepresentable: 'throw' }) as JsonSchemaObject;
  const body = clean(raw) as JsonSchemaObject;
  const { $schema, ...rest } = body;
  const doc: JsonSchemaObject = {
    $schema: $schema ?? 'https://json-schema.org/draft/2020-12/schema',
    $id: `${SCHEMA_BASE}${contract.name}.json`,
    title: contract.title,
    description: contract.description,
    'x-version': '2.0',
    ...rest,
  };
  if (mode === 'loose') contract.jsonSchemaPatch?.(doc);
  // Alt şemaları $defs'e al (en derin yol önce değil; yollar birbirini içermez ya da önce iç olan alınır).
  const defs: JsonSchemaObject = {};
  const entries = Object.entries(mode === 'loose' ? contract.defs : {}).sort((a, b) => b[1].length - a[1].length);
  for (const [name, path] of entries) {
    defs[name] = getAt(doc, path);
    setAt(doc, path, { $ref: `#/$defs/${name}` });
  }
  if (entries.length > 0) {
    doc.$defs = Object.fromEntries(Object.keys(contract.defs).map((n) => [n, defs[n]]));
  }
  return doc;
}

/** Tüm sözleşmeler: ad → JSON Schema (loose). */
export function allJsonSchemas(): Record<SchemaName, JsonSchemaObject> {
  return Object.fromEntries(SCHEMA_NAMES.map((n) => [n, contractJsonSchema(contractRegistry[n] as Contract)])) as Record<
    SchemaName,
    JsonSchemaObject
  >;
}

/** Dosyaya yazılan kesin metin (kararlı: 2 boşluk girinti, sonda satır sonu). */
export function serializeJsonSchema(doc: JsonSchemaObject): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export const schemaFileName = (name: string): string => `${name}.schema.json`;

/**
 * `output_config.format` değeri (`{type: 'json_schema', schema}`): strict şemanın JSON Schema'sı, `enum`/`const`
 * korunmuş halde. `@anthropic-ai/sdk` 1.4 `zodOutputFormat` dönüşümü `enum` ve `const`'u açıklama metnine taşıyıp
 * dilbilgisel kısıtı düşürüyor; bu yardımcı o dönüşümü atlar. Yanıtı `contract.parse(...)` (loose) ile doğrulayın.
 */
export function outputFormat(contract: Contract): { type: 'json_schema'; schema: JsonSchemaObject } {
  const { $schema: _s, $id: _i, 'x-version': _v, title: _t, ...schema } = contractJsonSchema(contract, 'strict');
  return { type: 'json_schema', schema };
}
