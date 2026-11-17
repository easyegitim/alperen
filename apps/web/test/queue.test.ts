import { describe, expect, it } from 'vitest';
import { countByKind, groupQueue, parseQueue, QUEUE_KIND_LABELS } from '../src/lib/queue';

const RAW = [
  { kind: 'review_document', id: 'd1', created_at: '2026-11-10T10:00:00Z', title: 'Not', href: '/egitmen/icerik' },
  { kind: 'coach_note', id: 'n1', created_at: '2026-11-12T10:00:00Z', title: 'Koç', detail: 'türev', student_name: 'Elif' },
  { kind: 'coach_note', id: 'n2', created_at: '2026-11-11T10:00:00Z', title: 'Koç 2' },
  { kind: 'bilinmeyen', id: 'x', created_at: '2026-11-13T10:00:00Z', title: 'atlanır' },
  { kind: 'spend_cap', created_at: '2026-11-13T10:00:00Z', title: 'kimliksiz atlanır' },
  { kind: 'curriculum_proposal', id: 'p1', created_at: '2026-11-09T10:00:00Z', title: '', href: '//kotu.example' },
];

describe('QUEUE_KIND_LABELS', () => {
  it('türlerin Türkçe adları', () => {
    expect(QUEUE_KIND_LABELS.coach_note).toBe('Koç notları');
    expect(QUEUE_KIND_LABELS.spend_cap).toBe('Harcama tavanında duran üretim');
    expect(QUEUE_KIND_LABELS.review_document).toBe('İnceleme bekleyen belgeler');
    expect(QUEUE_KIND_LABELS.lesson_claims).toBe('Düşük güvenli ders iddiaları');
    expect(QUEUE_KIND_LABELS.curriculum_proposal).toBe('Müfredat önerileri');
  });
});

describe('parseQueue', () => {
  it('bilinmeyen tür ve kimliksiz satır atlanır, en yeni önce, dış bağlantı düşer', () => {
    const items = parseQueue(RAW);
    expect(items.map((i) => i.id)).toEqual(['n1', 'n2', 'd1', 'p1']);
    expect(items[0]).toMatchObject({ studentName: 'Elif', detail: 'türev', href: null });
    expect(items[3]).toMatchObject({ title: 'Müfredat önerileri', href: null });
    expect(parseQueue(null)).toEqual([]);
  });
});

describe('groupQueue / countByKind', () => {
  it('sabit tür sırası, boş grup yok, sayılar sıfır dahil', () => {
    const items = parseQueue(RAW);
    expect(groupQueue(items).map((g) => [g.kind, g.items.length])).toEqual([
      ['coach_note', 2],
      ['review_document', 1],
      ['curriculum_proposal', 1],
    ]);
    expect(countByKind(items)).toEqual({ coach_note: 2, spend_cap: 0, review_document: 1, lesson_claims: 0, curriculum_proposal: 1 });
    expect(groupQueue([])).toEqual([]);
  });
});
