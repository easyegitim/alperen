import type { StudentLessonItem } from '@/server/lessons/read';
import { formatHeld } from '@/server/lessons/shared';

/**
 * Gelişim › Dersler (S08, P5): eğitmenin öğrenciye görünür yaptığı derslerin tarihi ve tek cümlesi. Transkript, alıntı ve
 * güven yok; görünür ders yoksa bölüm hiç çizilmez. Katlıdır (Konular ve Belgelerim gibi).
 */
export function LessonsFold({ items, total }: { items: StudentLessonItem[]; total: number }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Dersler" data-testid="dersler-listesi" className="m-0 flex list-none flex-col p-0">
      {items.map(({ row, sentence }) => (
        <li key={row.id} className="flex flex-col gap-0.5 border-t border-line py-3" data-testid="ders-ozeti">
          <span className="text-small font-medium text-ink">{formatHeld(row.held_at, false) || 'Ders'}</span>
          <span className="text-small text-ink-muted">{sentence}</span>
        </li>
      ))}
      {total > items.length ? <li className="text-small border-t border-line py-3 text-ink-muted">Daha eski {total - items.length} ders var.</li> : null}
    </ul>
  );
}
