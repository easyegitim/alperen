import { describe, expect, it } from 'vitest';
import { causeWord, diagnosisLines, examLines, formatDay, masterySummary, misconceptionLines, type MasteryInput } from '@/server/student-detail/present';

const m = (skill_id: string, p: number | null, band: MasteryInput['band'], evidence_count = 6): MasteryInput => ({ skill_id, skill_name: `K ${skill_id}`, p, band, evidence_count });

describe('eğitmen dossier: ustalık özeti', () => {
  it('en zayıf 8 (iyi hariç), en güçlü 5 (zayıf ve zayıf listesi hariç); az veri ayrı sayılır; yüzde yok', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => m(`L${i}`, 0.1 + i * 0.02, 'low')),
      m('M1', 0.6, 'mid'),
      m('H1', 0.95, 'high'),
      m('H2', 0.85, 'high', 9),
      m('H3', 0.85, 'high', 12),
      m('T1', null, null, 3),
      m('Z0', null, null, 0),
    ];
    const s = masterySummary(rows);
    expect(s.weakest.map((x) => x.skillId)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']);
    expect(s.weakest[0]).toEqual({ skillId: 'L0', name: 'K L0', band: 'low', word: 'zayıf', evidence: 6 });
    expect(s.strongest.map((x) => x.skillId)).toEqual(['H1', 'H3', 'H2', 'M1']);
    expect(s.strongest.map((x) => x.word)).toEqual(['iyi', 'iyi', 'iyi', 'orta']);
    expect(s.thin).toBe(1);
  });

  it('az yaprakta bir kazanım iki listede birden görünmez', () => {
    const s = masterySummary([m('A', 0.6, 'mid'), m('B', 0.7, 'mid')]);
    expect(s.weakest.map((x) => x.skillId)).toEqual(['A', 'B']);
    expect(s.strongest).toEqual([]);
  });
});

describe('eğitmen dossier: listeler', () => {
  it('yanılgılar kanıta göre, en çok 8; etiketsiz serbest metin', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, tag: i === 0 ? null : `t.${i}`, text_instructor: `metin ${i}`, evidence_count: i, last_seen: '2026-11-01T00:00:00Z' }));
    const out = misconceptionLines(rows);
    expect(out).toHaveLength(8);
    expect(out[0]).toEqual({ id: 'm9', tag: 't.9', text: 'metin 9', evidence: 9 });
    expect(misconceptionLines([rows[0]!])[0]!.tag).toBe('etiketsiz');
  });

  it('teşhis: kazanım adı, tek cümle, neden kelimesi', () => {
    const [d] = diagnosisLines(
      [{ id: 'a', created_at: '2026-11-17T09:00:00Z', verdict: 'wrong', failing_step_no: 2, error_cause: 'procedure', skill_ids: ['s1'], analysis: {} }],
      new Map([['s1', 'Kesirler']]),
    );
    expect(d).toEqual({ id: 'a', date: formatDay('2026-11-17T09:00:00Z'), skill: 'Kesirler', sentence: 'Çözümünü inceledim: 2. adımda işlem kuralı.', cause: 'işlem' });
    expect(causeWord(null, 'correct')).toBe('doğru');
  });

  it('deneme: net varsa net, yoksa doğru/yanlış, o da yoksa durum', () => {
    const base = { exam_id: 'e', started_at: '2026-11-10T08:00:00Z', finished_at: null };
    const out = examLines(
      [
        { ...base, id: '1', status: 'done', score: { net: 27.5 } },
        { ...base, id: '2', status: 'done', score: { correct: 12, wrong: 3 } },
        { ...base, id: '3', status: 'grading', score: null },
      ],
      new Map([['e', 'TYT Deneme 3']]),
    );
    expect(out.map((e) => e.result)).toEqual(['net 27,5', '12 doğru · 3 yanlış', 'puanlanıyor']);
    expect(out[0]!.title).toBe('TYT Deneme 3');
    expect(formatDay('2026-06-20')).toMatch(/20/);
  });
});
