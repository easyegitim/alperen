import { describe, expect, it } from 'vitest';
import Ajv2020Module from 'ajv/dist/2020.js';
import { SCHEMA_NAMES, errors as runtimeErrors, isValid as runtimeIsValid, compileAll } from '../src/index.js';
import * as precompiled from '../src/validators.js';
import * as keys from '../src/answer-key.js';
import { isKeySchema, type SchemaName } from '../src/names.js';
import { allFixtures, fixtureSchemas, fixturesOf, type Fixture } from './helpers.js';
import { schemaDocuments } from '../src/schemas.js';
import { AJV_OPTIONS, ANNOTATION_KEYWORDS } from '../src/ajv-options.js';
import { forbiddenWordsKeyword } from '../src/forbidden-words.js';
import addFormatsModule from 'ajv-formats';

/** common yalnız $defs taşır: fikstürleri {ref, data} biçimindedir ve ilgili tanıma karşı doğrulanır. */
const Ajv2020 = ((Ajv2020Module as unknown as { default?: typeof Ajv2020Module }).default ?? Ajv2020Module) as typeof Ajv2020Module;
const addFormats = ((addFormatsModule as unknown as { default?: typeof addFormatsModule }).default ?? addFormatsModule) as typeof addFormatsModule;
const fragmentAjv = new Ajv2020({ ...AJV_OPTIONS });
addFormats(fragmentAjv);
for (const kw of ANNOTATION_KEYWORDS) fragmentAjv.addKeyword(kw);
fragmentAjv.addKeyword(forbiddenWordsKeyword);
for (const doc of Object.values(schemaDocuments)) fragmentAjv.addSchema(doc);

function fragmentErrors(f: Fixture): string[] {
  const { ref, data } = f.data as { ref: string; data: unknown };
  const fn = fragmentAjv.getSchema(`https://ogrenmen.easy/schemas/common.json${ref}`);
  if (!fn) throw new Error(`tanım yok: ${ref}`);
  return fn(data) ? [] : (fn.errors ?? []).map((e) => e.keyword);
}

describe('fixtures', () => {
  it('her şemanın fikstür klasörü var: ≥ 2 valid, ≥ 2 invalid, her invalid için expect.json kaydı', () => {
    expect(fixtureSchemas()).toEqual([...SCHEMA_NAMES]);
    for (const name of SCHEMA_NAMES) {
      const fx = fixturesOf(name);
      expect(fx.filter((f) => f.kind === 'valid').length, name).toBeGreaterThanOrEqual(2);
      const invalid = fx.filter((f) => f.kind === 'invalid');
      expect(invalid.length, name).toBeGreaterThanOrEqual(2);
      for (const f of invalid) expect(f.expect.length, `${name}/${f.file}`).toBeGreaterThan(0);
    }
  });

  it('tüm şemalar strict modda derlenir', () => {
    expect(() => compileAll()).not.toThrow();
  });

  const cases = allFixtures().map((f) => [`${f.schema}/${f.kind}/${f.file}`, f] as const);

  it.each(cases)('%s klasörüne göre sınıflanır (çalışma zamanı ve önceden derlenmiş)', (_label, f) => {
    if (f.schema === 'common') {
      const kws = fragmentErrors(f);
      expect(kws.length === 0).toBe(f.kind === 'valid');
      if (f.kind === 'invalid') expect(kws.some((k) => f.expect.includes(k)), kws.join(',')).toBe(true);
      return;
    }
    const rt = runtimeErrors(f.schema, f.data);
    // Cevap anahtarı sözleşmeleri ayrı önceden derlenmiş modüldedir (validators-keys.js).
    const keyBearing = isKeySchema(f.schema as SchemaName);
    const pc = keyBearing ? keys.keyErrors(f.schema, f.data) : precompiled.errors(f.schema, f.data);
    const pcValid = keyBearing ? keys.isValidKey(f.schema, f.data) : precompiled.isValid(f.schema, f.data);
    expect(runtimeIsValid(f.schema, f.data)).toBe(f.kind === 'valid');
    expect(pcValid).toBe(f.kind === 'valid');
    // İki yol aynı hata kümesini üretir (aynı Ajv seçenekleri, aynı anahtar kelimeler).
    const key = (i: { path: string; keyword: string }) => `${i.path} ${i.keyword}`;
    expect(pc.map(key).sort()).toEqual(rt.map(key).sort());
    if (f.kind === 'invalid') {
      const kws = rt.map((i) => i.keyword);
      expect(kws.some((k) => f.expect.includes(k)), `${f.file}: ${kws.join(',')} ∌ ${f.expect.join('|')}`).toBe(true);
    } else {
      expect(rt).toEqual([]);
    }
  });
});
