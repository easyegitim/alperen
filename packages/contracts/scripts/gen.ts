/**
 * `bun run gen` — üretilen dosyalar (commit edilir; CI `git diff --exit-code` ile tazeliği denetler):
 *   1. src/generated/<ad>.d.ts + index.d.ts  (json-schema-to-typescript)
 *   2. src/generated/validators.js + validators.d.ts  (Ajv standalone; x-forbidden-words ve
 *      biçimler gömülü, hiçbir require/import yok — Worker yalnız bunu yükler; cevap anahtarı
 *      taşıyan sözleşmeler hariç) ve validators-keys.js + .d.ts (yalnız answer-key alt yolu)
 *   3. schemas/gemini/<ad>.json  (python3 scripts/flatten.py; TS toGeminiSchema ile aynı çıktı)
 * Çıktı deterministiktir: aynı şemalar → bayt bayt aynı dosyalar.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Module from 'ajv/dist/2020.js';
import standaloneModule from 'ajv/dist/standalone/index.js';
import { _ } from 'ajv/dist/2020.js';
import { compile } from 'json-schema-to-typescript';
import { AJV_OPTIONS, ANNOTATION_KEYWORDS } from '../src/ajv-options.ts';
import { forbiddenWordsKeyword } from '../src/forbidden-words.ts';
import { ogrFormats } from '../src/runtime/core.js';
import {
  KEY_SCHEMA_NAMES,
  SCHEMA_NAMES,
  WORKER_SCHEMA_NAMES,
  schemaRefId,
  standaloneExportName,
  type SchemaName,
  type SchemaRef,
} from '../src/names.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(ROOT, 'schemas');
const OUT_DIR = join(ROOT, 'src', 'generated');

const Ajv2020 = ((Ajv2020Module as unknown as { default?: typeof Ajv2020Module }).default ?? Ajv2020Module) as typeof Ajv2020Module;
type StandaloneFn = typeof standaloneModule;
const standaloneCode = ((standaloneModule as unknown as { default?: StandaloneFn }).default ?? standaloneModule) as StandaloneFn;

/** Tip üretiminde anlamı olmayan koşullu/kısıt anahtar kelimeleri. */
const TYPE_IRRELEVANT = new Set(['if', 'then', 'else', 'not', 'contains', 'minContains', 'maxContains']);
/** Bir dalın tip taşıdığını gösteren anahtarlar. */
const SHAPE_KEYS = ['type', 'properties', '$ref', 'enum', 'const', 'items', 'oneOf', 'anyOf', 'allOf'];

const HEADER ='Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen).';

function isObject(x: unknown): x is JsonObject {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function camel(name: string): string {
  const [first, ...rest] = name.split('-');
  return first + rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function loadSchemas(): Map<string, JsonObject> {
  const map = new Map<string, JsonObject>();
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json')).sort()) {
    map.set(file.slice(0, -'.schema.json'.length), JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')));
  }
  return map;
}

function decodePointer(fragment: string): string[] {
  if (fragment === '') return [];
  return fragment
    .slice(1)
    .split('/')
    .map((p) => decodeURIComponent(p).replace(/~1/g, '/').replace(/~0/g, '~'));
}

function getAt(doc: Json, parts: string[]): Json {
  let node: Json = doc;
  for (const p of parts) {
    if (Array.isArray(node)) node = node[Number(p)] as Json;
    else if (isObject(node)) node = node[p] as Json;
    if (node === undefined) throw new Error(`çözülemeyen işaretçi /${parts.join('/')}`);
  }
  return node;
}

/**
 * json-schema-to-typescript `$id` tabanlı dosyalar arası `$ref` çözmez; dış başvurular
 * kök şemanın `$defs`'ine kopyalanır ve yerel `#/$defs/<anahtar>` başvurusuna çevrilir.
 */
function bundleForTypes(name: string, schemas: Map<string, JsonObject>): JsonObject {
  const byId = new Map<string, JsonObject>();
  for (const doc of schemas.values()) byId.set(String(doc.$id), doc);
  const root = structuredClone(schemas.get(name)) as JsonObject;
  const rootId = String(root.$id);
  const defs: JsonObject = isObject(root.$defs) ? root.$defs : {};
  const keyOf = new Map<string, string>();

  function keyFor(docName: string, parts: string[]): string {
    const last = parts.length === 0 ? docName : (parts[parts.length - 1] as string);
    const candidate = last in defs ? `${docName}-${last}` : last;
    return candidate;
  }

  function walk(node: Json, base: string): Json {
    if (Array.isArray(node)) return node.map((x) => walk(x, base));
    if (!isObject(node)) return node;
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === '$id' || (k === '$schema' && base !== rootId)) continue;
      if (k === '$ref' && typeof v === 'string') {
        const abs = new URL(v, base).toString();
        const hashAt = abs.indexOf('#');
        const docUrl = hashAt === -1 ? abs : abs.slice(0, hashAt);
        const fragment = hashAt === -1 ? '' : abs.slice(hashAt + 1);
        if (docUrl === rootId) {
          out.$ref = `#${fragment}`;
          continue;
        }
        const target = byId.get(docUrl);
        if (!target) throw new Error(`${name}: çözülemeyen $ref ${v}`);
        let key = keyOf.get(abs);
        if (!key) {
          const docName = docUrl.slice(docUrl.lastIndexOf('/') + 1, -'.json'.length);
          const parts = decodePointer(fragment);
          key = keyFor(docName, parts);
          keyOf.set(abs, key);
          defs[key] = {};
          defs[key] = walk(getAt(target, parts), docUrl);
        }
        out.$ref = `#/$defs/${key}`;
        continue;
      }
      if (TYPE_IRRELEVANT.has(k)) continue;
      if ((k === 'allOf' || k === 'oneOf' || k === 'anyOf') && Array.isArray(v)) {
        // Yalnız kısıt taşıyan dallar (if/then, {required: [...]}) tipe katkı vermez ve
        // json-schema-to-typescript'te açık nesne (index imzası) üretir; atılır.
        const kept = v.map((b) => walk(b, base)).filter((b) => isObject(b) && SHAPE_KEYS.some((s) => s in b));
        if (kept.length > 0) out[k] = kept;
        continue;
      }
      out[k] = k === '$defs' && base === rootId ? v : walk(v, base);
    }
    return out;
  }

  // Kökün kendi $defs içerikleri de dış başvuru taşıyabilir.
  for (const [k, v] of Object.entries(defs)) defs[k] = walk(v, rootId);
  const bundled = walk(root, rootId) as JsonObject;
  bundled.$defs = defs;
  if (Object.keys(defs).length === 0) delete bundled.$defs;
  delete bundled.$id;
  return bundled;
}

async function generateTypes(schemas: Map<string, JsonObject>): Promise<void> {
  const exportsLines: string[] = [];
  for (const name of schemas.keys()) {
    const bundled = bundleForTypes(name, schemas);
    const ts = await compile(bundled as never, String(bundled.title ?? camel(name)), {
      bannerComment: `/* ${HEADER} Kaynak: schemas/${name}.schema.json */`,
      additionalProperties: false,
      ignoreMinAndMaxItems: true,
      unreachableDefinitions: name === 'common',
      strictIndexSignatures: true,
      declareExternallyReferenced: true,
      format: true,
      cwd: SCHEMA_DIR,
      $refOptions: { resolve: { http: false, file: false } } as never,
    });
    writeFileSync(join(OUT_DIR, `${name}.d.ts`), ts);
    const rootType = String(bundled.title ?? camel(name)).replace(/[^A-Za-z0-9]/g, '');
    exportsLines.push(`export type { ${rootType} } from './${name}.js';`);
  }
  writeFileSync(join(OUT_DIR, 'index.d.ts'), `/* ${HEADER} */\n${exportsLines.join('\n')}\n`);
}

function coreSourceForEmbedding(): string {
  const src = readFileSync(join(ROOT, 'src', 'runtime', 'core.js'), 'utf8');
  const body = src.replace(/^export (function|const) /gm, '$1 ');
  if (/\bexport\b|\bimport\b|\brequire\(/.test(body.replace(/\/\/.*$/gm, ''))) {
    throw new Error('runtime/core.js gömülemez: export/import/require kalmamalı');
  }
  return body.trimEnd();
}

/** Bir modülün dışa aktaracağı başvurular: her şemanın kökü ve her `$defs` tanımı. */
function refsFor(names: readonly SchemaName[], schemas: Map<string, JsonObject>): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const name of names) {
    const doc = schemas.get(name);
    if (!doc) throw new Error(`gen: şema yok: ${name}`);
    const all: SchemaRef[] = [{ name, def: null }];
    if (isObject(doc.$defs)) for (const def of Object.keys(doc.$defs).sort()) all.push({ name, def });
    for (const ref of all) {
      const exportName = standaloneExportName(ref);
      if (exportName in refs) throw new Error(`gen: dışa aktarım adı çakışıyor: ${exportName}`);
      refs[exportName] = schemaRefId(ref);
    }
  }
  return refs;
}

/** Ajv'nin `require("ajv/dist/runtime/ucs2length").default` ifadesi gömülü çekirdekteki adla değişir. */
const UCS2_REQUIRE = /require\("ajv\/dist\/runtime\/ucs2length"\)\.default/g;

function writeStandalone(
  file: string,
  title: string,
  names: readonly SchemaName[],
  schemas: Map<string, JsonObject>,
): string[] {
  const ajv = new Ajv2020({
    ...AJV_OPTIONS,
    code: { source: true, esm: true, lines: true, formats: _`ogrFormats` },
    inlineRefs: false,
  });
  for (const [fmt, fn] of Object.entries(ogrFormats)) ajv.addFormat(fmt, fn);
  for (const kw of ANNOTATION_KEYWORDS) ajv.addKeyword(kw);
  ajv.addKeyword(forbiddenWordsKeyword);
  for (const doc of schemas.values()) ajv.addSchema(doc);

  const refs = refsFor(names, schemas);
  let code = standaloneCode(ajv, refs);
  code = code.replace(/^"use strict";\s*/, '').replace(UCS2_REQUIRE, 'ogrUcs2length');
  if (/require\(/.test(code)) throw new Error(`${file}: standalone çıktısında require( kaldı`);
  const out = [
    `// ${HEADER}`,
    `// ${title}`,
    '/* eslint-disable */',
    '"use strict";',
    coreSourceForEmbedding(),
    '',
    code.trimEnd(),
    '',
  ].join('\n');
  writeFileSync(join(OUT_DIR, `${file}.js`), out);

  const dts = [
    `/* ${HEADER} */`,
    'export interface StandaloneError {',
    '  instancePath: string;',
    '  schemaPath: string;',
    '  keyword: string;',
    '  params: Record<string, unknown>;',
    '  message?: string;',
    '}',
    'export interface StandaloneValidate {',
    '  (data: unknown, ctx?: unknown): boolean;',
    '  errors?: StandaloneError[] | null;',
    '}',
    ...Object.entries(refs).map(([n, id]) => `/** ${id} */\nexport declare const ${n}: StandaloneValidate;`),
    '',
  ].join('\n');
  writeFileSync(join(OUT_DIR, `${file}.d.ts`), dts);
  return Object.keys(refs);
}

function generateValidators(schemas: Map<string, JsonObject>): void {
  const known = [...schemas.keys()].sort().join(',');
  if (known !== [...SCHEMA_NAMES].sort().join(',')) {
    throw new Error(`gen: src/names.ts SCHEMA_NAMES schemas/ dizini ile aynı değil: ${known}`);
  }
  writeStandalone(
    'validators',
    'Ajv standalone (önceden derlenmiş) doğrulayıcılar; Worker şemaları çalışma anında derlemez. Cevap anahtarı taşıyan sözleşmeler burada YOK (validators-keys.js).',
    WORKER_SCHEMA_NAMES,
    schemas,
  );
  writeStandalone(
    'validators-keys',
    'Cevap anahtarı taşıyan sözleşmelerin önceden derlenmiş doğrulayıcıları; yalnız src/answer-key.ts içe alır (Worker alamaz).',
    KEY_SCHEMA_NAMES,
    schemas,
  );
}

function runFlatten(): void {
  const res = spawnSync('python3', [join(ROOT, 'scripts', 'flatten.py')], { stdio: 'inherit' });
  if (res.error) throw new Error(`python3 scripts/flatten.py çalıştırılamadı: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`python3 scripts/flatten.py ${res.status} ile çıktı`);
}

async function main(): Promise<void> {
  const schemas = loadSchemas();
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  await generateTypes(schemas);
  generateValidators(schemas);
  runFlatten();
  console.log(`gen: ${schemas.size} şema → src/generated (d.ts + validators.js), schemas/gemini`);
}

await main();
