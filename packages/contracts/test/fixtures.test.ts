/**
 * Her sözleşme için fikstür klasörü: `fixtures/<ad>/{valid,invalid}/*.json` (Python testleri aynı dosyaları okur).
 * `refine-` önekli geçersiz dosyalar yalnız çapraz alan kuralıyla (zod `refine`) düşer; JSON Schema ifade edemez,
 * Python bunları atlar. Diğer geçersiz dosyalar iki tarafta da düşer.
 */
import { describe, expect, it } from 'vitest';
import { contractRegistry, SCHEMA_NAMES } from '../src/index.js';
import { fixtureFiles } from './helpers.js';

describe.each(SCHEMA_NAMES)('%s', (name) => {
  const contract = contractRegistry[name];
  const valid = fixtureFiles(name, 'valid');
  const invalid = fixtureFiles(name, 'invalid');

  it('en az bir geçerli ve bir geçersiz örneği var', () => {
    expect(valid.length).toBeGreaterThanOrEqual(1);
    expect(invalid.length).toBeGreaterThanOrEqual(1);
  });

  it.each(valid.map((f) => [f.name, f.data] as const))('geçerli: %s', (_n, data) => {
    const loose = contract.loose.safeParse(data);
    expect(loose.success, loose.success ? '' : JSON.stringify(loose.error.issues.slice(0, 3))).toBe(true);
    // Varsayılanlarla doldurulmuş çıktı strict şemadan da geçmeli (strict ⊆ loose biçimi).
    if (loose.success) {
      const strict = contract.strict.safeParse(loose.data);
      expect(strict.success, strict.success ? '' : JSON.stringify(strict.error.issues.slice(0, 3))).toBe(true);
    }
  });

  it.each(invalid.map((f) => [f.name, f.data] as const))('geçersiz: %s', (fileName, data) => {
    const loose = contract.loose.safeParse(data);
    expect(loose.success).toBe(false);
    if (!loose.success && fileName.startsWith('refine-')) {
      const nonCustom = loose.error.issues.filter((i) => i.code !== 'custom');
      expect(nonCustom, 'refine- dosyası yalnız çapraz alan kuralıyla düşmeli').toEqual([]);
    }
  });
});

describe('fikstür klasörleri', () => {
  it('kayıt defteri dışındaki klasörler legacy listesinde', async () => {
    const { readdirSync } = await import('node:fs');
    const { FIXTURES } = await import('./helpers.js');
    const { LEGACY_SCHEMA_NAMES } = await import('../src/legacy-schemas.js');
    const known = new Set<string>([...SCHEMA_NAMES, ...LEGACY_SCHEMA_NAMES]);
    const stray = readdirSync(FIXTURES).filter((d) => !known.has(d));
    expect(stray).toEqual([]);
  });
});
