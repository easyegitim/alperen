import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as runtime from '../src/index.js';
import * as precompiled from '../src/validators.js';
import * as generated from '../src/generated/validators.js';
import * as generatedKeys from '../src/generated/validators-keys.js';
import * as keys from '../src/answer-key.js';
import { KEY_SCHEMA_NAMES, WORKER_SCHEMA_NAMES } from '../src/names.js';
import { FIXTURES, ROOT, readJson } from './helpers.js';

const plan = readJson(join(FIXTURES, 'exam-priority-plan', 'valid', 'four-years.json'));

describe('önceden derlenmiş doğrulayıcılar (Worker yolu)', () => {
  const exportNameOf = (name: string) => name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

  it('Worker şemalarının her biri validators.js, anahtar şemaları yalnız validators-keys.js içinde', () => {
    expect([...WORKER_SCHEMA_NAMES, ...KEY_SCHEMA_NAMES].sort()).toEqual([...runtime.SCHEMA_NAMES].sort());
    for (const name of WORKER_SCHEMA_NAMES) {
      expect(typeof (generated as Record<string, unknown>)[exportNameOf(name)], name).toBe('function');
      expect((generatedKeys as Record<string, unknown>)[exportNameOf(name)], name).toBeUndefined();
    }
    for (const name of KEY_SCHEMA_NAMES) {
      expect((generated as Record<string, unknown>)[exportNameOf(name)], name).toBeUndefined();
      expect(typeof (generatedKeys as Record<string, unknown>)[exportNameOf(name)], name).toBe('function');
    }
  });

  it('validators.js cevap anahtarı yapısını taşımaz (correct_option dizesi yok)', () => {
    const src = readFileSync(join(ROOT, 'src', 'generated', 'validators.js'), 'utf8');
    expect(src).not.toContain('correct_option');
    expect(src).not.toMatch(/schemas\/(answer-key|diagnostic-keys|question-generation)\.json/);
    const keySrc = readFileSync(join(ROOT, 'src', 'generated', 'validators-keys.js'), 'utf8');
    expect(keySrc).toContain('correct_option');
    // validators-keys.js'i yalnız answer-key.ts içe alır.
    expect(readFileSync(join(ROOT, 'src', 'answer-key.ts'), 'utf8')).toContain("from './generated/validators-keys.js'");
    for (const file of ['validators.ts', 'index.ts', 'validate.ts', 'names.ts', 'schemas.ts']) {
      expect(readFileSync(join(ROOT, 'src', file), 'utf8'), file).not.toMatch(/from '[^']*validators-keys/);
    }
  });

  it('Worker yolu anahtar şemalarını reddeder; answer-key alt yolu doğrular', () => {
    const ak = readJson(join(FIXTURES, 'answer-key', 'valid', 'mcq-key.json'));
    for (const name of KEY_SCHEMA_NAMES) {
      expect(() => precompiled.isValid(name, ak)).toThrow(/OGR-SCHEMA-005/);
      expect(() => precompiled.isValid(`https://ogrenmen.easy/schemas/${name}.json`, ak)).toThrow(/OGR-SCHEMA-005/);
    }
    expect(keys.isValidAnswerKey(ak)).toBe(true);
    expect(keys.validateAnswerKey(ak)).toBe(ak);
    expect(keys.answerKeyErrors({ ...(ak as object), correct_option: 'E' }).map((i) => i.keyword)).toContain('enum');
    expect(() => keys.isValidKey('question-item', ak)).toThrow(/OGR-SCHEMA-001/);
  });

  it('validators.js çalışma anında hiçbir modül yüklemez ve Ajv derlemez', () => {
    const src = readFileSync(join(ROOT, 'src', 'generated', 'validators.js'), 'utf8');
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/\brequire\s*\(/);
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/new Ajv|new Function|\beval\(/);
    expect(code).toContain('function ogrFindForbiddenWord');
  });

  it('validators.ts yalnız üretilen kodu, hataları ve adları içe alır (ajv yok)', () => {
    const src = readFileSync(join(ROOT, 'src', 'validators.ts'), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.every((p) => p !== 'ajv' && !p?.startsWith('ajv/') && p !== 'ajv-formats')).toBe(true);
    expect(imports).not.toContain('./schemas.js');
    const names = readFileSync(join(ROOT, 'src', 'names.ts'), 'utf8');
    expect(names).not.toMatch(/^import .*\.json'/m);
  });

  it('validate<T> geçerli veriyi aynen döner, geçersizde ContractValidationError fırlatır', () => {
    expect(precompiled.validate('exam-priority-plan', plan)).toBe(plan);
    expect(runtime.validate('exam-priority-plan', plan)).toBe(plan);
    const bad = { ...(plan as object), title: 'Tahminler', extra: 1 };
    for (const v of [precompiled.validate, runtime.validate]) {
      try {
        v('exam-priority-plan', bad);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(runtime.ContractValidationError);
        const err = e as InstanceType<typeof runtime.ContractValidationError>;
        expect(err.schemaId).toBe('https://ogrenmen.easy/schemas/exam-priority-plan.json');
        const kws = err.issues.map((i) => i.keyword);
        expect(kws).toEqual(expect.arrayContaining(['const', 'additionalProperties', 'x-forbidden-words']));
        expect(err.message).toMatch(/^OGR-CONTRACT-001/);
      }
    }
  });

  it('allErrors: tüm hatalar tek seferde raporlanır', () => {
    const tr = readJson(join(FIXTURES, 'tutor-reply', 'valid', 'escalation.json')) as Record<string, unknown>;
    const bad = { ...tr, reply: '', confidence: 2, escalate_reason: 'x' };
    const kws = precompiled.errors('tutor-reply', bad).map((i) => `${i.path}:${i.keyword}`);
    expect(kws).toEqual(expect.arrayContaining(['/reply:minLength', '/confidence:maximum']));
  });

  it('$id ile de çağrılabilir; bilinmeyen şema hata verir', () => {
    expect(precompiled.isValid('https://ogrenmen.easy/schemas/exam-priority-plan.json', plan)).toBe(true);
    expect(() => precompiled.isValid('nope', plan)).toThrow(/OGR-SCHEMA-001/);
  });

  it('minLength kod noktası sayar (Python len ile aynı)', () => {
    const q = { queries: ['a😀b', 'spaced repetition', 'aralıklı tekrar'] };
    expect(precompiled.isValid('query-expand', q)).toBe(true);
    expect(runtime.isValid('query-expand', q)).toBe(true);
    expect(precompiled.isValid('query-expand', { queries: ['😀😀', 'spaced repetition', 'aralıklı tekrar'] })).toBe(false);
  });

  describe('parçalı başvuru (#/$defs/<tanım>)', () => {
    const segment = { t: '00:01:05', speaker: 'ÖĞRENCİ', text: 'Paydaları neden eşitliyoruz?' };
    const skill = readJson(join(FIXTURES, 'curriculum', 'valid', 'active-slice.json')) as { skills: unknown[] };
    const refs = [
      'transcript#/$defs/segment',
      'https://ogrenmen.easy/schemas/transcript.json#/$defs/segment',
      'transcript.json#/$defs/segment',
    ];

    it.each(refs)('%s üç yolda da çalışır', (ref) => {
      for (const v of [precompiled, runtime]) {
        expect(v.isValid(ref, segment)).toBe(true);
        expect(v.errors(ref, { ...segment, speaker: 'VELİ' }).map((i) => i.keyword)).toContain('enum');
        expect(v.isValid(ref, { segments: [segment] })).toBe(false);
      }
    });

    it('curriculum#/$defs/skill tekil kazanımı doğrular; hata $id#parça ile raporlanır', () => {
      const one = skill.skills[0];
      expect(precompiled.isValid('curriculum#/$defs/skill', one)).toBe(true);
      expect(runtime.isValid('curriculum#/$defs/skill', one)).toBe(true);
      expect(precompiled.isValid('curriculum', one)).toBe(false);
      for (const v of [precompiled.validate, runtime.validate]) {
        try {
          v('curriculum#/$defs/skill', { ...(one as object), extra: 1 });
          expect.unreachable();
        } catch (e) {
          expect((e as InstanceType<typeof runtime.ContractValidationError>).schemaId).toBe(
            'https://ogrenmen.easy/schemas/curriculum.json#/$defs/skill',
          );
        }
      }
    });

    it('anahtar şemasının tanımı yalnız answer-key alt yolunda', () => {
      const key = { correct_option: 'B', solution: 'Paydaları 8de eşitle: 6/8 + 1/8 = 7/8.' };
      expect(keys.isValidKey('diagnostic-keys#/$defs/key', key)).toBe(true);
      expect(runtime.isValid('diagnostic-keys#/$defs/key', key)).toBe(true);
      expect(() => precompiled.isValid('diagnostic-keys#/$defs/key', key)).toThrow(/OGR-SCHEMA-005/);
    });

    it('bilinmeyen tanım ve desteklenmeyen parça OGR-SCHEMA-001', () => {
      for (const v of [precompiled, runtime]) {
        expect(() => v.isValid('transcript#/$defs/yok', segment)).toThrow(/OGR-SCHEMA-001/);
        expect(() => v.isValid('transcript#/properties/segments', segment)).toThrow(/OGR-SCHEMA-001/);
      }
      expect(() => runtime.toGeminiSchema('transcript#/$defs/segment')).toThrow(/OGR-SCHEMA-001/);
    });
  });
});
