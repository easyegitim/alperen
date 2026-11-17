import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/cn';
import { formatPercent } from '../lib/format';

export interface HeatmapCell {
  /** Doğru oranı 0–1; null: veri yok. */
  value: number | null;
  /** Soru sayısı (erişilebilir ad ve ipucu için). */
  n?: number;
}

export interface HeatmapRow {
  id: string;
  /** Kazanım adı. */
  label: string;
  cells: HeatmapCell[];
}

export interface OutcomeHeatmapProps extends Omit<ComponentPropsWithRef<'figure'>, 'children'> {
  /** Sütun başlıkları (deneme/dönem adları). */
  columns: string[];
  rows: HeatmapRow[];
  caption?: string;
}

// Sıralı mavi rampa (base.css --og-seq-*): 1-3 üzerinde lacivert, 4-7 üzerinde beyaz metin.
const BG = ['bg-[var(--og-seq-1)]', 'bg-[var(--og-seq-2)]', 'bg-[var(--og-seq-3)]', 'bg-[var(--og-seq-4)]', 'bg-[var(--og-seq-5)]', 'bg-[var(--og-seq-6)]', 'bg-[var(--og-seq-7)]'] as const;
const FG = ['text-navy', 'text-navy', 'text-navy', 'text-on-navy', 'text-on-navy', 'text-on-navy', 'text-on-navy'] as const;

/** 0–1 değeri 0..6 rampa basamağına çevirir. */
export function heatStep(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return Math.min(6, Math.floor(v * 7));
}

/**
 * Kazanım ısı haritası. Renk tek başına anlam taşımaz: her hücre yüzdeyi yazar; tablo olarak okunur.
 * Tek mavi sıralı rampa (açık = düşük, koyu = yüksek).
 */
export function OutcomeHeatmap({ columns, rows, caption = 'Kazanım ısı haritası', className, ...rest }: OutcomeHeatmapProps) {
  return (
    <figure {...rest} className={cn('m-0 flex flex-col gap-2', className)}>
      <div className="overflow-x-auto">
        <table className="text-small w-full border-separate border-spacing-1">
          <caption className="text-label pb-2 text-left text-ink">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-caption p-1 text-left font-medium text-ink-muted">
                Kazanım
              </th>
              {columns.map((c) => (
                <th key={c} scope="col" className="text-caption p-1 text-center font-medium text-ink-muted">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row" className="text-small min-w-32 p-1 text-left font-medium text-ink">
                  {r.label}
                </th>
                {columns.map((c, ci) => {
                  const cell = r.cells[ci];
                  if (!cell || cell.value == null) {
                    return (
                      <td key={c} className="min-h-11 min-w-14 rounded-sm bg-surface-sunken p-2 text-center text-ink-muted ring-1 ring-inset ring-line">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">{`${r.label}, ${c}: veri yok`}</span>
                      </td>
                    );
                  }
                  const step = heatStep(cell.value);
                  const text = formatPercent(cell.value);
                  return (
                    <td
                      key={c}
                      data-step={step}
                      title={cell.n != null ? `${cell.n} soru` : undefined}
                      className={cn('min-h-11 min-w-14 rounded-sm p-2 text-center font-semibold tabular-nums', BG[step], FG[step])}
                    >
                      {text}
                      <span className="sr-only">{`${r.label}, ${c}${cell.n != null ? `, ${cell.n} soru` : ''}`}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
