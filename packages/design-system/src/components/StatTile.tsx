import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Badge, type BadgeTone } from './Badge';

export type StatStatus = 'neutral' | 'success' | 'warning' | 'danger';

const STATUS_TONE: Record<StatStatus, BadgeTone> = {
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

export interface StatTileProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  label: string;
  /** Biçimlenmiş değer ("1,4", "1.284"). */
  value: ReactNode;
  unit?: string;
  hint?: string;
  status?: StatStatus;
  /** Durum kelimesi ("Acil", "Dikkat", "Hedefte"). Renk tek başına anlam taşımaz; status verilip statusText yoksa gösterilmez. */
  statusText?: string;
}

/** Eğitmen konsolunda tek bir sayı. Bir sayı anlatıyorsa grafik değil StatTile kullanılır. */
export function StatTile({ label, value, unit, hint, status = 'neutral', statusText, className, ...rest }: StatTileProps) {
  return (
    <div
      {...rest}
      className={cn(
        'box-border flex min-w-40 flex-col gap-1 rounded-lg border border-line bg-surface-raised p-4',
        className,
      )}
    >
      <span className="text-small text-ink-muted">{label}</span>
      <span className="text-title-1 text-ink">
        {value}
        {unit ? <span className="text-body ml-1 font-medium tracking-normal text-ink-muted">{unit}</span> : null}
      </span>
      {statusText || hint ? (
        <span className="text-caption flex flex-wrap items-center gap-2 text-ink-muted">
          {statusText ? <Badge tone={STATUS_TONE[status]}>{statusText}</Badge> : null}
          {hint}
        </span>
      ) : null}
    </div>
  );
}
