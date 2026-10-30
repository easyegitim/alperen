import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { containsForbiddenWord, errors, findForbiddenWord, normalizeTr } from '../src/index.js';
import * as precompiled from '../src/validators.js';
import { FIXTURES, ROOT, readJson } from './helpers.js';

interface Case {
  name: string;
  words: string[];
  data: unknown;
  hit: string | null;
}
const { cases } = readJson(join(ROOT, 'test', 'cases', 'forbidden-words.json')) as { cases: Case[] };

describe('x-forbidden-words', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    expect(findForbiddenWord(c.data, c.words)).toBe(c.hit);
  });

  it('Türkçe normalleştirme: İ/I/ı/i aynı biçime iner', () => {
    expect(normalizeTr('İIıi')).toBe('iiii');
    expect(normalizeTr('ÇIKACAK')).toBe(normalizeTr('çıkacak'));
    expect(containsForbiddenWord('KESİNLİKLE', 'kesin')).toBe(true);
    expect(containsForbiddenWord('dekesin', 'kesin')).toBe(true);
    expect(containsForbiddenWord('Kesir problemleri', 'kesin')).toBe(false);
    expect(containsForbiddenWord('çıkacağı', 'çıkacak')).toBe(true);
  });

  const plan = readJson(join(FIXTURES, 'exam-priority-plan', 'valid', 'two-years.json')) as Record<string, any>;
  it.each(['Tahmini sorular', 'Bu konu kesin çıkacak', 'GARANTİ puan', 'çıkacak sorular'])(
    'öncelik planında "%s" hem çalışma zamanı hem önceden derlenmiş yolda düşer',
    (text) => {
      const bad = structuredClone(plan);
      bad.rows[0].topic = text;
      const rt = errors('exam-priority-plan', bad);
      const pc = precompiled.errors('exam-priority-plan', bad);
      expect(rt.map((e) => e.keyword)).toContain('x-forbidden-words');
      expect(pc.map((e) => e.keyword)).toContain('x-forbidden-words');
      expect(rt.find((e) => e.keyword === 'x-forbidden-words')?.params.word).toBeTypeOf('string');
    },
  );

  it('eğitmen alarmında yargı kelimeleri düşer, nötr ifade geçer', () => {
    const alert = readJson(join(FIXTURES, 'instructor-alert', 'valid', 'morale.json')) as Record<string, any>;
    expect(errors('instructor-alert', alert)).toEqual([]);
    for (const w of ['depresif', 'Tembel', 'BAŞARISIZ', 'umutsuz']) {
      const bad = { ...alert, detail: `Öğrenci ${w} görünüyor.` };
      expect(precompiled.isValid('instructor-alert', bad), w).toBe(false);
    }
  });

  it('yasaklı kelime listesi olmayan şemada aynı metin geçer', () => {
    const tr = readJson(join(FIXTURES, 'tutor-reply', 'valid', 'escalation.json')) as Record<string, any>;
    expect(errors('tutor-reply', { ...tr, reply: 'Bu kesin bir sonuç değil, tahmin de yapmıyoruz.' })).toEqual([]);
  });
});
