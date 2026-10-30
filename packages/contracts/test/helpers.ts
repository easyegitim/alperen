/** Test yardımcıları: fixtures/<ad>/{valid,invalid}/*.json ve expect.json okuma. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = join(ROOT, 'fixtures');
export const SCHEMA_DIR = join(ROOT, 'schemas');

export interface Fixture {
  schema: string;
  kind: 'valid' | 'invalid';
  file: string;
  data: unknown;
  /** invalid için: hatalarda en az biri görünmesi gereken anahtar kelimeler. */
  expect: string[];
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function fixtureSchemas(): string[] {
  return readdirSync(FIXTURES).filter((d) => existsSync(join(FIXTURES, d, 'valid'))).sort();
}

export function fixturesOf(schema: string): Fixture[] {
  const expectPath = join(FIXTURES, schema, 'expect.json');
  const expect = (existsSync(expectPath) ? readJson(expectPath) : {}) as Record<string, string[]>;
  const out: Fixture[] = [];
  for (const kind of ['valid', 'invalid'] as const) {
    const dir = join(FIXTURES, schema, kind);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      out.push({ schema, kind, file, data: readJson(join(dir, file)), expect: expect[file] ?? [] });
    }
  }
  return out;
}

export function allFixtures(): Fixture[] {
  return fixtureSchemas().flatMap(fixturesOf);
}
