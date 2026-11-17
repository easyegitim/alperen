import { describe, expect, it } from 'vitest';
import { buildKeyDiff, examKindLabel, optionChoices, parseExamKeys, parseExamList, type ExamKeyQuestion, type KeyFormValue } from '../src/lib/exam-admin';

const q = (over: Partial<ExamKeyQuestion>): ExamKeyQuestion => ({
  no: 1, section: null, kind: 'mcq', skillIds: [], optionKeys: [], correctOption: null, numericValue: null,
  source: null, confidence: null, unverified: false, ...over,
});
const form = (entries: Array<[number, string, boolean?]>) =>
  new Map<number, KeyFormValue>(entries.map(([no, value, confirmed]) => [no, { value, confirmed: confirmed === true }]));

describe('exam-admin', () => {
  it('sınav türünün Türkçe adı', () => {
    expect(examKindLabel('deneme')).toBe('Deneme');
    expect(examKindLabel('diagnostic')).toBe('Teşhis testi');
    expect(examKindLabel('practice')).toBe('Pratik seti');
    expect(examKindLabel('published')).toBe('Yayımlanmış deneme');
    expect(examKindLabel('baska')).toBe('baska');
  });

  it('anahtar farkı: yalnız değişen ve onaylanan doğrulanmamış anahtarlar', () => {
    const qs = [
      q({ no: 1, correctOption: 'A', source: 'uploaded' }),
      q({ no: 2, correctOption: 'B', source: 'inferred', confidence: 0.4, unverified: true }),
      q({ no: 3, correctOption: 'C', source: 'inferred', confidence: 0.5, unverified: true }),
      q({ no: 4 }),
      q({ no: 5, kind: 'numeric', numericValue: 2.5 }),
      q({ no: 6, kind: 'open' }),
      q({ no: 7, kind: 'numeric' }),
    ];
    const r = buildKeyDiff(qs, form([[1, 'A'], [2, 'B', true], [3, 'C'], [4, 'd'], [5, '2,5'], [6, 'A'], [7, '']]));
    expect(r).toEqual({ keys: [{ no: 2, correct_option: 'B' }, { no: 4, correct_option: 'D' }], invalid: [] });
    expect(buildKeyDiff(qs, form([[1, 'E'], [5, '3']])).keys).toEqual([{ no: 1, correct_option: 'E' }, { no: 5, numeric_value: 3 }]);
    expect(buildKeyDiff(qs, form([[1, 'F'], [5, 'x']]))).toEqual({ keys: [], invalid: [1, 5] });
  });

  it('şık seçenekleri ve ayrıştırma', () => {
    expect(optionChoices({ optionKeys: ['a', 'B', 'Z'] })).toEqual(['A', 'B']);
    expect(optionChoices({ optionKeys: [] })).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(parseExamList([{ id: 'x', title: 'T', kind: 'deneme', question_count: '3', unverified_keys: 2, can_edit: true }])[0])
      .toMatchObject({ id: 'x', questionCount: 3, unverifiedKeys: 2, sessionCount: 0, canEdit: true, locked: false });
    expect(() => parseExamList({})).toThrow();
    const k = parseExamKeys({ exam: { id: 'e', title: 'S', kind: 'published', can_edit: true }, questions: [{ no: 1, kind: 'mcq', correct_option: 'B', source: 'inferred', confidence: '0.5', unverified: true, skill_ids: ['t.a'] }] });
    expect(k.exam).toMatchObject({ id: 'e', canEdit: true, locked: false });
    expect(k.questions[0]).toMatchObject({ no: 1, correctOption: 'B', confidence: 0.5, unverified: true, skillIds: ['t.a'] });
    expect(() => parseExamKeys({ questions: [] })).toThrow();
  });
});
