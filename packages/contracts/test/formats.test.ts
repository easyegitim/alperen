import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import { ogrFormats } from '../src/runtime/core.js';
import { ROOT, readJson } from './helpers.js';

interface Case {
  format: keyof typeof ogrFormats;
  value: string;
  valid: boolean;
}
const { cases } = readJson(join(ROOT, 'test', 'cases', 'formats.json')) as { cases: Case[] };

function ajvFormats(format: string, value: string): boolean {
  const def = (fullFormats as Record<string, unknown>)[format];
  if (def instanceof RegExp) return def.test(value);
  if (typeof def === 'function') return (def as (s: string) => boolean)(value);
  const obj = def as { validate: RegExp | ((s: string) => boolean) };
  return obj.validate instanceof RegExp ? obj.validate.test(value) : obj.validate(value);
}

describe('biçimler: gömülü çekirdek = ajv-formats = beklenen', () => {
  it.each(cases.map((c) => [`${c.format} ${JSON.stringify(c.value)}`, c] as const))('%s', (_n, c) => {
    expect(ogrFormats[c.format](c.value)).toBe(c.valid);
    expect(ajvFormats(c.format, c.value)).toBe(c.valid);
  });
});
