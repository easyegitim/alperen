// Tarz kütüphanesi saf kuralları (S13 + Gelişim satırı): yanıt ayrıştırma, sunum metinleri, sıralama/süzgeç, girdi doğrulama.
import { describe, expect, it } from 'vitest';
import { metaLine } from '@/server/suggestions/arrange';
import {
  arrangeStyles,
  archiveLine,
  coverageText,
  correctText,
  frequencyText,
  newStyleCode,
  parseIngest,
  parseLibrary,
  priorityLines,
  recencyText,
  scoreText,
  studentStyleLine,
  type LibraryStyle,
} from '@/server/styles/shared';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function style(n: number, over: Partial<LibraryStyle> = {}): LibraryStyle {
  return {
    id: U(n),
    code: `T-${n}`,
    name: `Tarz ${n}`,
    description: 'Tanım',
    format: 'çoktan seçmeli',
    trick: null,
    difficulty_band: 'mid',
    status: 'active',
    source: 'instructor',
    reviewed_at: '2025-10-01T00:00:00Z',
    skills: [{ id: 'a.b', name: 'Eşitsizlikler' }],
    years_hit: [2025, 2024, 2023, 2021],
    years_total: 8,
    last_year: 2025,
    frequency: 0.5,
    recency: 1,
    alignment: 0.8,
    score: 0.7,
    appearances: [],
    coverage: { students_total: 12, students_solved: 7, solved: 24, correct: 17, unsolved: [] },
    ...over,
  } as LibraryStyle;
}

const VIEW = {
  role: 'staff',
  can_manage: true,
  course: { id: U(1), code: 'TYT-MAT', title: 'TYT Matematik' },
  archive: { years_from: 2018, years_to: 2025, years_total: '8', sources: 8, items: 320, styled_items: 300, pending_sources: 0, last_clustered_at: '2025-10-31T09:00:00Z' },
  plan: null,
  styles: [style(1)],
};

describe('parseLibrary / archiveLine', () => {
  it('sayıları sayıya çevirir ve fazladan alanları tutar', () => {
    const v = parseLibrary({ ...VIEW, styles: [{ ...style(1), score: '0.91', extra: 1 }] });
    expect(v.archive.years_total).toBe(8);
    expect(v.styles[0]!.score).toBeCloseTo(0.91);
  });
  it('öğrenci dalını (role student) reddeder', () => {
    expect(() => parseLibrary({ ...VIEW, role: 'student' })).toThrow();
  });
  it('özet satırı: yıllar, sınav yılı, soru, tarz, son kümeleme', () => {
    expect(archiveLine(parseLibrary(VIEW))).toBe('2018–2025 · 8 sınav yılı · 320 çıkmış soru · 1 tarz · Son kümeleme 31 Eki');
    expect(archiveLine(parseLibrary({ ...VIEW, archive: { ...VIEW.archive, sources: 0 } }))).toBe('Henüz çıkmış sınav yüklenmedi.');
  });
});

describe('sunum metinleri (yüzde yok)', () => {
  it('sıklık, güncellik, kapsama, doğru', () => {
    const s = style(1);
    expect(frequencyText(s)).toBe('4/8 yıl');
    expect(recencyText(s)).toBe('son 2025 · 3 yıl üst üste');
    expect(recencyText(style(2, { years_hit: [2024, 2021], last_year: 2024 }))).toBe('son 2024');
    expect(recencyText(style(2, { years_hit: [], last_year: null }))).toBe('Henüz çıkmadı');
    expect(coverageText(s.coverage)).toBe('12 öğrenciden 7 kişi çözdü');
    expect(coverageText({ ...s.coverage, students_total: 0 })).toBe('Henüz kayıtlı öğrenci yok');
    expect(correctText(s.coverage)).toBe('24 denemede 17 doğru');
    expect(correctText({ ...s.coverage, solved: 0 })).toBeNull();
    expect(scoreText(0.912)).toBe('0,91');
    for (const t of [frequencyText(s), recencyText(s), coverageText(s.coverage)]) expect(t).not.toMatch(/%/);
  });
});

describe('coverageText (ek yok)', () => {
  const cov = (students_total: number, students_solved: number) => ({ students_total, students_solved, solved: 0, correct: 0, unsolved: [] });
  it('0, 1, 3 ve 7 çözende de aynı kalıp; sayıya bağlı ek yok', () => {
    expect(coverageText(cov(12, 0))).toBe('12 öğrenciden 0 kişi çözdü');
    expect(coverageText(cov(12, 1))).toBe('12 öğrenciden 1 kişi çözdü');
    expect(coverageText(cov(12, 3))).toBe('12 öğrenciden 3 kişi çözdü');
    expect(coverageText(cov(12, 7))).toBe('12 öğrenciden 7 kişi çözdü');
  });
  it('kayıtlı öğrenci yoksa tek cümle', () => {
    expect(coverageText(cov(0, 0))).toBe('Henüz kayıtlı öğrenci yok');
  });
});

describe('arrangeStyles', () => {
  const list = [style(1, { name: 'B', score: 0.5, frequency: 0.9 }), style(2, { name: 'A', score: 0.9, frequency: 0.2 }), style(3, { name: 'C', status: 'retired' }), style(4, { name: 'D', status: 'draft', reviewed_at: null, score: 0.1 })];
  it('emekliler listede yok; öncelik skoruna göre sıralar', () => {
    expect(arrangeStyles(list, 'priority', 'all').map((s) => s.name)).toEqual(['A', 'B', 'D']);
  });
  it('sıklık ve kapsama (az çözülen önce)', () => {
    expect(arrangeStyles(list, 'frequency', 'all')[0]!.name).toBe('B');
    const cov = [style(1, { name: 'x', coverage: { students_total: 10, students_solved: 9, solved: 1, correct: 1, unsolved: [] } }), style(2, { name: 'y', coverage: { students_total: 10, students_solved: 2, solved: 1, correct: 1, unsolved: [] } })];
    expect(arrangeStyles(cov, 'coverage', 'all').map((s) => s.name)).toEqual(['y', 'x']);
  });
  it('Adlandırma bekliyor süzgeci: yalnız onaysız taslaklar', () => {
    expect(arrangeStyles(list, 'priority', 'unnamed').map((s) => s.name)).toEqual(['D']);
  });
});

describe('priorityLines', () => {
  it('plan satırlarını tarz skoruyla ve "Kanıt" metniyle eşler', () => {
    const v = parseLibrary({
      ...VIEW,
      styles: [style(1, { score: 0.91 })],
      plan: {
        id: U(9),
        status: 'pending_review',
        period: '2022–2025',
        created_at: '2025-11-01T00:00:00Z',
        approved_at: null,
        plan: { rows: [{ rank: 1, topic: 'Tarz 1', kind: 'çoktan seçmeli', hits: 4, years: 8, points_text: '≈20 puan', evidence_count: 7, style_ids: [U(1)] }], others: [] },
      },
    });
    const [l] = priorityLines(v.plan, v.styles);
    expect(l).toMatchObject({ rank: 1, topic: 'Tarz 1', hits: 4, years: 8, points: '≈20 puan', evidence: 'Kanıt: 7 soru · son 2025', score: 0.91 });
    expect(priorityLines(null, v.styles)).toEqual([]);
  });

  it('"≈0 puan" (puansız madde) satırda puan olarak gösterilmez', () => {
    const v = parseLibrary({
      ...VIEW,
      styles: [style(1)],
      plan: {
        id: U(9),
        status: 'pending_review',
        period: null,
        created_at: '2025-11-01T00:00:00Z',
        approved_at: null,
        plan: { rows: [{ rank: 1, topic: 'Tarz 1', kind: 'diğer', hits: 2, years: 2, points_text: '≈0 puan', style_ids: [U(1)] }], others: [] },
      },
    });
    const [l] = priorityLines(v.plan, v.styles);
    expect(l?.points).toBeUndefined();
  });
});

describe('parseIngest', () => {
  const owner = U(50);
  const file = (n: number, mime = 'application/pdf') => ({ id: U(n), path: `${owner}/${U(n)}.${mime === 'application/pdf' ? 'pdf' : 'jpg'}`, mime, bytes: 1000, sha256: null, width: null, height: null });
  const ok = { courseId: U(1), year: 2024, term: 'osym', files: [file(2), file(3, 'image/jpeg')] };
  it('geçerli gönderim', () => {
    expect(parseIngest(ok, owner, 2025)).toMatchObject({ ok: true });
  });
  it('yıl, tür, dosya sayısı, tekrar ve yol denetimi', () => {
    expect(parseIngest({ ...ok, year: 1900 }, owner, 2025)).toMatchObject({ ok: false });
    expect(parseIngest({ ...ok, year: 2027 }, owner, 2025)).toMatchObject({ ok: false });
    expect(parseIngest({ ...ok, term: 'x' }, owner, 2025)).toMatchObject({ ok: false });
    expect(parseIngest({ ...ok, files: [] }, owner, 2025)).toMatchObject({ ok: false });
    expect(parseIngest({ ...ok, files: Array.from({ length: 61 }, (_, i) => file(100 + i)) }, owner, 2025)).toMatchObject({ ok: false });
    expect(parseIngest({ ...ok, files: [file(2), file(2)] }, owner, 2025)).toMatchObject({ ok: false });
    expect(parseIngest({ ...ok, files: [{ ...file(2), path: `${U(99)}/${U(2)}.pdf` }] }, owner, 2025)).toMatchObject({ ok: false });
    expect(parseIngest({ ...ok, courseId: 'x' }, owner, 2025)).toMatchObject({ ok: false });
  });
});

describe('öğrenci satırı ve Bugün kartı', () => {
  it('"Tarz: 2/5 çözdün"; tarz yoksa satır yok', () => {
    expect(studentStyleLine({ styles: 5, never_solved: 3 })).toBe('Tarz: 2/5 çözdün');
    expect(studentStyleLine({ styles: 0, never_solved: 0 })).toBeNull();
    expect(studentStyleLine(null)).toBeNull();
  });
  it('tarz önerisi kartı worker\'ın alt satırını aynen gösterir', () => {
    const s = { id: 'x', kind: 'practice', title: 'Karışım problemi', subtitle: 'Bu tarzı hiç çözmedin · 8 soru · 12 dk', payload: { style_id: U(1), reason: 'style_gap', count: 8, minutes: 12 } } as never;
    expect(metaLine(s)).toBe('Bu tarzı hiç çözmedin · 8 soru · 12 dk');
  });
  it('yeni tarz kodu uyumlu ve her seferinde farklı', () => {
    const a = newStyleCode(1_700_000_000_000, 0.1);
    expect(a).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{1,59}$/);
    expect(newStyleCode(1_700_000_000_000, 0.9)).not.toBe(a);
  });
});
