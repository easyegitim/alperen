/**
 * `bun run export` — zod sözleşmelerinden `schemas/<ad>.schema.json` (JSON Schema 2020-12) üretir.
 *   --check   dosyalar diskteki ile aynı mı denetler (farklıysa çıkış 1, yazmaz)
 * Yalnız kayıt defterindeki adlara dokunur; `src/legacy-schemas.ts` listesindeki v1 dosyaları elle bakımlıdır
 * ve değiştirilmez. Kayıt defterinde de legacy listesinde de olmayan `*.schema.json` bir artıktır: hata.
 * Çıktı deterministiktir (aynı kaynak → bayt bayt aynı dosyalar).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_SCHEMA_NAMES } from '../src/legacy-schemas.ts';
import { allJsonSchemas, schemaFileName, serializeJsonSchema } from '../src/json-schema.ts';
import { SCHEMA_NAMES } from '../src/registry.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(ROOT, 'schemas');
const check = process.argv.includes('--check');

const docs = allJsonSchemas();
const problems: string[] = [];
mkdirSync(SCHEMA_DIR, { recursive: true });

for (const name of SCHEMA_NAMES) {
  const file = join(SCHEMA_DIR, schemaFileName(name));
  const text = serializeJsonSchema(docs[name]);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (current === text) continue;
  if (check) problems.push(`${schemaFileName(name)} ${current === null ? 'eksik' : 'eski'} (bun run export)`);
  else writeFileSync(file, text, 'utf8');
}

const known = new Set<string>([...SCHEMA_NAMES, ...LEGACY_SCHEMA_NAMES]);
for (const f of readdirSync(SCHEMA_DIR).filter((x) => x.endsWith('.schema.json'))) {
  const name = f.slice(0, -'.schema.json'.length);
  if (!known.has(name)) problems.push(`${f}: kayıt defterinde de legacy listesinde de yok (artık dosya)`);
}
for (const name of LEGACY_SCHEMA_NAMES) {
  if (!existsSync(join(SCHEMA_DIR, schemaFileName(name)))) problems.push(`${schemaFileName(name)}: legacy listesinde ama dosya yok`);
}

if (problems.length > 0) {
  console.error(`HATA: JSON Schema dışa aktarımı tutarsız:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(check ? `JSON Schema dışa aktarımı güncel (${SCHEMA_NAMES.length} şema)` : `${SCHEMA_NAMES.length} şema yazıldı: ${SCHEMA_DIR}`);
