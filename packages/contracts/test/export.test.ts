/** JSON Schema dışa aktarımı: diskteki dosyalar zod kaynağından yeniden üretilenle bayt bayt aynı; artık dosya yok. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_SCHEMA_NAMES } from '../src/legacy-schemas.js';
import { SCHEMA_NAMES, allJsonSchemas, schemaFileName, serializeJsonSchema } from '../src/index.js';
import { SCHEMAS } from './helpers.js';

describe('schemas/*.schema.json', () => {
  const docs = allJsonSchemas();

  it.each(SCHEMA_NAMES)('%s: dosya yeniden üretilenle aynı (bun run export)', (name) => {
    const file = join(SCHEMAS, schemaFileName(name));
    expect(existsSync(file), `${file} yok`).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(serializeJsonSchema(docs[name]));
  });

  it('üretim deterministik: iki çalıştırma aynı metni verir', () => {
    const a = allJsonSchemas();
    const b = allJsonSchemas();
    for (const n of SCHEMA_NAMES) expect(serializeJsonSchema(a[n])).toBe(serializeJsonSchema(b[n]));
  });

  it('dizin = kayıt defteri + legacy; Gemini kopyası ve üretilmiş doğrulayıcı yok', () => {
    const files = readdirSync(SCHEMAS).sort();
    const expected = [...SCHEMA_NAMES, ...LEGACY_SCHEMA_NAMES].map(schemaFileName).sort();
    expect(files).toEqual(expected);
    expect(existsSync(join(SCHEMAS, 'gemini'))).toBe(false);
  });

  it('x-forbidden-words kayıt defteri şemalarında yok', () => {
    for (const n of SCHEMA_NAMES) expect(JSON.stringify(docs[n])).not.toContain('x-forbidden-words');
  });

  it('transcript ve curriculum alt tanımları $defs altında', () => {
    expect(Object.keys((docs.transcript.$defs as object) ?? {})).toEqual(['segment']);
    expect(Object.keys((docs.curriculum.$defs as object) ?? {}).sort()).toEqual(['curriculum', 'prerequisite', 'skill']);
  });
});
