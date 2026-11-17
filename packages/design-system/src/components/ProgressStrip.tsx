import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/cn';

export type StripStatus = 'todo' | 'answered' | 'flagged';

export interface ProgressStripProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Toplam soru sayısı. */
  total: number;
  /** Şu anki soru, 1'den başlar. */
  current: number;
  /** Soru başına durum (uzunluğu total'den kısaysa kalanlar 'todo'). */
  statuses?: StripStatus[];
}

const MAX_DOTS = 60;

/** Test ilerlemesi: noktalar; sayılar kelimeyle ("Soru 3 / 8 · 2 soru cevaplandı") yazılır. */
export function ProgressStrip({ total, current, statuses = [], className, ...rest }: ProgressStripProps) {
  const n = Math.max(0, Math.min(MAX_DOTS, Math.floor(total)));
  const answered = statuses.slice(0, n).filter((s) => s === 'answered').length;
  const text = `Soru ${current} / ${n} · ${answered} soru cevaplandı`;
  return (
    <div role="group" aria-label="İlerleme" {...rest} className={cn('flex flex-col gap-2', className)}>
      <div aria-hidden="true" className="flex flex-wrap items-center gap-1.5">
        {Array.from({ length: n }, (_, i) => {
          const no = i + 1;
          const st = statuses[i] ?? 'todo';
          const here = no === current;
          return (
            <span
              key={no}
              data-status={here ? 'current' : st}
              className={cn(
                'inline-block rounded-full',
                here ? 'size-3.5 bg-primary ring-2 ring-primary-soft' : 'size-2.5',
                !here && st === 'answered' && 'bg-primary',
                !here && st === 'flagged' && 'bg-gold ring-1 ring-gold-deep',
                !here && st === 'todo' && 'bg-surface-sunken ring-1 ring-inset ring-line-strong',
              )}
            />
          );
        })}
      </div>
      <span className="text-small text-ink-muted">{text}</span>
    </div>
  );
}
