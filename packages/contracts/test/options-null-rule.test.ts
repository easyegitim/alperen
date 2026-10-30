/**
 * Şık kuralı (BLUEPRINT §4.1, §10.3): tam dört şık; doğru şık null taşır VE en az bir çeldirici
 * de null taşır → en az iki null. Böylece doğru şık etiket dizisinden çıkarılamaz.
 */
import { describe, expect, it } from 'vitest';
import { errors, isValid } from '../src/index.js';
import * as precompiled from '../src/validators.js';
import { FIXTURES, readJson } from './helpers.js';
import { join } from 'node:path';

const base = readJson(join(FIXTURES, 'question-item', 'valid', 'mcq-diagnostic.json')) as {
  options: Array<{ key: string; text: string; misconception_tag: string | null }>;
};
const TAGS = ['rasyonel.pay-payda-ayri-toplama', 'rasyonel.payda-esitlemeden-toplama', 'rasyonel.bolmede-ters-cevirmeme', 'genel.soruyu-yarim-okuma'];

function withNulls(nullCount: number) {
  const item = structuredClone(base);
  item.options.forEach((o, i) => {
    o.misconception_tag = i < nullCount ? null : (TAGS[i] as string);
  });
  return item;
}

describe('şık null kuralı', () => {
  it.each([
    [0, false],
    [1, false],
    [2, true],
    [3, true],
    [4, true],
  ])('%i null şık → geçerli: %s', (n, ok) => {
    expect(isValid('question-item', withNulls(n))).toBe(ok);
    expect(precompiled.isValid('question-item', withNulls(n))).toBe(ok);
    if (!ok) expect(errors('question-item', withNulls(n)).map((e) => e.keyword)).toContain('contains');
  });

  it('dört şıktan az ya da fazla reddedilir', () => {
    const three = structuredClone(base);
    three.options.pop();
    const five = structuredClone(base);
    five.options.push({ key: 'D', text: '1', misconception_tag: null });
    expect(isValid('question-item', three)).toBe(false);
    expect(isValid('question-item', five)).toBe(false);
  });

  it.each([
    ['A,A,C,D', ['A', 'A', 'C', 'D']],
    ['A,B,B,D', ['A', 'B', 'B', 'D']],
    ['B,A,D,C', ['B', 'A', 'D', 'C']],
    ['D,C,B,A', ['D', 'C', 'B', 'A']],
  ])('anahtarlar sırayla A,B,C,D olmalı: %s reddedilir', (_label, order) => {
    const item = structuredClone(base);
    item.options.forEach((o, i) => {
      o.key = order[i] as string;
    });
    expect(isValid('question-item', item)).toBe(false);
    expect(precompiled.isValid('question-item', item)).toBe(false);
    expect(errors('question-item', item).map((e) => e.keyword)).toContain('const');
  });

  it('şık anahtarı yalnız A–D', () => {
    const item = structuredClone(base);
    (item.options[3] as { key: string }).key = 'E';
    expect(errors('question-item', item).map((e) => e.keyword)).toContain('enum');
  });

  it('şıkta doğru işareti alanı (is_correct) tanımsız', () => {
    const item = structuredClone(base) as unknown as { options: Array<Record<string, unknown>> };
    (item.options[1] as Record<string, unknown>).is_correct = true;
    expect(errors('question-item', item).map((e) => e.keyword)).toContain('additionalProperties');
  });
});
