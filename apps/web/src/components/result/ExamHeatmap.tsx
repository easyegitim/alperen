'use client';

import { cn, heatStep } from '@/ds';
import type { HeatRow } from '@/server/exam-result/present';

// Sıralı mavi rampa (base.css --og-seq-*), OutcomeHeatmap ile aynı: 1-3 üzerinde lacivert, 4-7 üzerinde beyaz metin.
// DS OutcomeHeatmap hücreye yüzde yazar; öğrenci ekranında yüzde yok, bu yüzden hücre "doğru/soru" ve kelime bandı yazar.
const BG = ['bg-[var(--og-seq-1)]', 'bg-[var(--og-seq-2)]', 'bg-[var(--og-seq-3)]', 'bg-[var(--og-seq-4)]', 'bg-[var(--og-seq-5)]', 'bg-[var(--og-seq-6)]', 'bg-[var(--og-seq-7)]'] as const;
const FG = ['text-navy', 'text-navy', 'text-navy', 'text-on-navy', 'text-on-navy', 'text-on-navy', 'text-on-navy'] as const;

/**
 * Kazanım ısı haritası (deneme): satır başına bir kazanım; hücre "3/4" ve "orta". Renk tek başına anlam taşımaz
 * (sayı ve kelime yazılıdır); açık = düşük, koyu = yüksek.
 */
export function ExamHeatmap({ rows }: { rows: HeatRow[] }) {
  if (rows.length === 0) return null;
  return (
    <figure className="m-0 flex flex-col gap-2" data-testid="isi-haritasi">
      <table className="text-small w-full border-separate border-spacing-y-1">
        <caption className="sr-only">Kazanım ısı haritası: her kazanım için doğru sayısı ve düzey</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Kazanım</th>
            <th scope="col">Doğru</th>
            <th scope="col">Düzey</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const step = heatStep(r.value);
            return (
              <tr key={r.id} data-band={r.band}>
                <th scope="row" className="text-small pr-3 text-left font-medium text-ink">
                  {r.label}
                  <span className="sr-only">{`, ${r.sr}`}</span>
                </th>
                <td data-step={step} className={cn('w-28 rounded-sm px-3 py-2 text-center font-semibold tabular-nums', BG[step], FG[step])}>
                  <span aria-hidden="true">
                    {r.ratio} · {r.word}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <figcaption className="text-caption flex items-center gap-2 text-ink-muted">
        <span>Düşük</span>
        <span aria-hidden="true" className="flex">
          {BG.map((b, i) => (
            <span key={i} className={cn('h-2 w-6 first:rounded-l-sm last:rounded-r-sm', b)} />
          ))}
        </span>
        <span>Yüksek</span>
      </figcaption>
    </figure>
  );
}
