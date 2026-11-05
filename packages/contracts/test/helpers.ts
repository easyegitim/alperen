import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = join(ROOT, 'fixtures');
export const SCHEMAS = join(ROOT, 'schemas');

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Yalnız loose kipte bulunan, model çıktısı olmayan alanlar (strict şemada yok; boru hattı yazar). */
export const LOOSE_ONLY_KEYS: Record<string, string[]> = { 'lesson-analysis': ['model_notes'] };

export interface FixtureFile {
  name: string;
  data: unknown;
}

export function fixtureFiles(schema: string, kind: 'valid' | 'invalid'): FixtureFile[] {
  const dir = join(FIXTURES, schema, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((name) => ({ name, data: readJson(join(dir, name)) }));
}
