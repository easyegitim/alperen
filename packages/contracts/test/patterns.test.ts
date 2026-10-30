/**
 * Desen anlamı ve parçalı başvuru: ECMAScript `$` yalnız metnin sonunda eşleşir (Python tarafı
 * aynı kararı `pattern`, `patternProperties` ve `propertyNames` için verir). Vakalar
 * `test/cases/patterns.json` (Python `tests/test_patterns.py` aynı dosyayı okur).
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValid as runtimeIsValid } from '../src/index.js';
import * as precompiled from '../src/validators.js';
import * as keys from '../src/answer-key.js';
import { isKeySchema, parseSchemaRef } from '../src/names.js';
import { ROOT, readJson } from './helpers.js';

interface Case {
  name: string;
  ref: string;
  data: unknown;
  valid: boolean;
}
const { cases } = readJson(join(ROOT, 'test', 'cases', 'patterns.json')) as { cases: Case[] };

describe('desen ve parça vakaları', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    expect(runtimeIsValid(c.ref, c.data)).toBe(c.valid);
    const pc = isKeySchema(parseSchemaRef(c.ref).name) ? keys.isValidKey(c.ref, c.data) : precompiled.isValid(c.ref, c.data);
    expect(pc).toBe(c.valid);
  });
});
