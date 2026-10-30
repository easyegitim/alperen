import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NUMERIC_GUESS,
  P_MAX,
  P_MIN,
  bktStep,
  blendStep,
  clip,
  inferredGuess,
  observationStep,
  type SkillParams,
} from '../src/index.js';

interface Vector {
  id: number;
  method: 'bkt' | 'blend' | 'inferred';
  p: number;
  correct: boolean | null;
  g: number | null;
  s: number | null;
  t: number | null;
  m: number | null;
  c: number | null;
  g_base: number | null;
  w: number | null;
  guess_override: number | null;
  expected: number;
  note: string;
}

const root = join(import.meta.dir, '..');
const doc = JSON.parse(readFileSync(join(root, 'fixtures', 'bkt-vectors.json'), 'utf8')) as {
  tolerance: number;
  vectors: Vector[];
};
const TOL = 1e-9;

function compute(v: Vector): number {
  if (v.method === 'blend') {
    return blendStep(v.p, v.m as number, v.c);
  }
  if (v.method === 'inferred') {
    return bktStep(v.p, false, v.g as number, v.s as number, v.t as number);
  }
  return bktStep(v.p, v.correct as boolean, v.g as number, v.s as number, v.t as number);
}

describe('bkt-vectors.json', () => {
  test('41 vektör, sıralı kimlikler, tolerans 1e-9', () => {
    expect(doc.vectors.length).toBe(41);
    expect(doc.vectors.map((v) => v.id)).toEqual(Array.from({ length: 41 }, (_, i) => i + 1));
    expect(doc.tolerance).toBe(1e-9);
  });

  test('g sütunu her satırda açık; g=0.05 (guess_override) satırı var', () => {
    for (const v of doc.vectors) {
      expect(Object.prototype.hasOwnProperty.call(v, 'g')).toBe(true);
      if (v.method === 'blend') {
        expect(v.g).toBeNull();
      } else {
        expect(typeof v.g).toBe('number');
      }
    }
    const numeric = doc.vectors.filter((v) => v.method === 'bkt' && v.g === NUMERIC_GUESS);
    expect(numeric.length).toBeGreaterThanOrEqual(1);
    for (const v of numeric) {
      expect(v.guess_override).toBe(NUMERIC_GUESS);
    }
  });

  test('ilk dokuz satır BLUEPRINT §3.7 tablosuyla aynı', () => {
    const table: Array<[string, number, number]> = [
      ['bkt', 0.3, 0.6460674157],
      ['bkt', 0.3, 0.8967213115],
      ['bkt', 0.3, 0.1486486486],
      ['bkt', 0.7, 0.9042553191],
      ['bkt', 0.7, 0.313559322],
      ['inferred', 0.3, 0.1923076923],
      ['blend', 0.3, 0.42],
      ['bkt', 0.99, 0.99],
      ['bkt', 0.01, 0.1012104909],
    ];
    table.forEach(([method, p, expected], i) => {
      const v = doc.vectors[i] as Vector;
      expect(v.method).toBe(method as Vector['method']);
      expect(v.p).toBe(p);
      expect(Math.abs(v.expected - expected)).toBeLessThan(1e-10);
    });
    expect((doc.vectors[1] as Vector).g).toBe(0.05);
    expect((doc.vectors[5] as Vector).g).toBe(0.625);
  });

  for (const v of doc.vectors) {
    test(`#${v.id} ${v.method}: ${v.note}`, () => {
      if (v.method === 'inferred') {
        expect(Math.abs(inferredGuess(v.g_base as number, v.w as number) - (v.g as number))).toBeLessThan(TOL);
      }
      const got = compute(v);
      expect(Math.abs(got - v.expected)).toBeLessThan(TOL);
      expect(got).toBeGreaterThanOrEqual(P_MIN);
      expect(got).toBeLessThanOrEqual(P_MAX);
    });
  }
});

describe('formüller', () => {
  test('kırpma [0.01, 0.99]', () => {
    expect(clip(-1)).toBe(0.01);
    expect(clip(2)).toBe(0.99);
    expect(clip(0.5)).toBe(0.5);
  });

  test('doğru cevap p artırır, yanlış cevap azaltır (t=0)', () => {
    expect(bktStep(0.4, true, 0.25, 0.1, 0)).toBeGreaterThan(0.4);
    expect(bktStep(0.4, false, 0.25, 0.1, 0)).toBeLessThan(0.4);
  });

  test('numeric sorudaki doğru cevap mcq doğru cevabından daha güçlü kanıttır', () => {
    expect(bktStep(0.3, true, NUMERIC_GUESS, 0.1, 0.1)).toBeGreaterThan(bktStep(0.3, true, 0.25, 0.1, 0.1));
  });

  test('blend: c boşsa 0.8; m=p ise değişmez', () => {
    expect(blendStep(0.3, 0.8, null)).toBeCloseTo(0.42, 12);
    expect(blendStep(0.3, 0.8)).toBeCloseTo(0.42, 12);
    expect(blendStep(0.55, 0.55, 0.4)).toBeCloseTo(0.55, 12);
  });

  test('inferred g: w=0.5 → 0.625; w=1 → g', () => {
    expect(inferredGuess(0.25, 0.5)).toBeCloseTo(0.625, 12);
    expect(inferredGuess(0.25, 1)).toBeCloseTo(0.25, 12);
  });

  test('sıfır payda ve sonsuz değer açıkça reddedilir', () => {
    expect(() => bktStep(0, true, 0, 0.1, 0.1)).toThrow(/OGR-MAST-003/);
    expect(() => bktStep(Number.NaN, true, 0.25, 0.1, 0.1)).toThrow(/OGR-MAST-003/);
    expect(() => blendStep(0.3, Number.POSITIVE_INFINITY, 0.8)).toThrow(/OGR-MAST-003/);
  });
});

describe('observationStep (apply_observation dallanması)', () => {
  const skill: SkillParams = { p_guess: 0.25, p_slip: 0.1, p_learn: 0.1 };

  test('mcq teşhis doğru: g = skills.p_guess, evidence +1', () => {
    const r = observationStep(0.3, { kind: 'diagnostic', value: 1 }, skill);
    expect(r.method).toBe('bkt');
    expect(r.evidenceIncrement).toBe(1);
    expect(r.p).toBeCloseTo(0.6460674157, 9);
    expect(r.params.g).toBe(0.25);
    expect(r.params.guess_override).toBeNull();
  });

  test('numeric pratik doğru: g = guess_override 0.05', () => {
    const r = observationStep(0.3, { kind: 'practice', value: 1, guess_override: 0.05 }, skill);
    expect(r.p).toBeCloseTo(0.8967213115, 9);
    expect(r.params.g).toBe(0.05);
  });

  test('ilk deneme dışı (counts_for_mastery=false) p günceller, sayaç artmaz', () => {
    const r = observationStep(0.3, { kind: 'practice', value: 0, counts_for_mastery: false }, skill);
    expect(r.evidenceIncrement).toBe(0);
    expect(r.p).toBeCloseTo(0.1486486486, 9);
  });

  test('sohbet gözlemleri p ve evidence_count değiştirmez', () => {
    for (const kind of ['chat_question', 'chat_misconception'] as const) {
      const r = observationStep(0.3, { kind, value: null }, skill);
      expect(r).toEqual({ p: 0.3, evidenceIncrement: 0, method: null, params: {} });
    }
  });

  test('ders/eğitmen blend: evidence +1, w=0.30·c', () => {
    const r = observationStep(0.3, { kind: 'lesson', value: 0.8, confidence: 0.8 }, skill);
    expect(r.method).toBe('blend');
    expect(r.evidenceIncrement).toBe(1);
    expect(r.p).toBeCloseTo(0.42, 12);
    expect(r.params.w).toBeCloseTo(0.24, 12);
    expect(() => observationStep(0.3, { kind: 'instructor', value: null }, skill)).toThrow(/OGR-MAST-003/);
  });

  test('inferred: yumuşatılmış g, evidence artmaz', () => {
    const r = observationStep(0.3, { kind: 'inferred', value: 0, weight: 0.5 }, skill);
    expect(r.method).toBe('inferred');
    expect(r.evidenceIncrement).toBe(0);
    expect(r.params.g_eff).toBeCloseTo(0.625, 12);
    expect(r.p).toBeCloseTo(0.1923076923, 9);
  });

  test('bilinmeyen tür OGR-MAST-001', () => {
    expect(() => observationStep(0.3, { kind: 'weird' as never, value: 1 }, skill)).toThrow(/OGR-MAST-001/);
  });
});

describe('sql/bkt.sql', () => {
  const sql = readFileSync(join(root, 'sql', 'bkt.sql'), 'utf8');

  test('üç fonksiyonu tanımlar', () => {
    expect(sql).toContain('create or replace function app.bkt_step(');
    expect(sql).toContain('create or replace function app.blend_step(');
    expect(sql).toContain('create or replace function app.inferred_guess(');
  });

  test('kopya işaretlerini içermez (sed aralığını bozmasın)', () => {
    expect(sql).not.toMatch(/-- begin bkt|-- end bkt/);
  });
});
