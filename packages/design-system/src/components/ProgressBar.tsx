import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/cn';
import { formatPercent } from '../lib/format';

export interface ProgressBarProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  value: number;
  max?: number;
  label?: string;
  /** Yüzde yerine özel metin ("5/5 ders"). */
  valueText?: string;
  showValue?: boolean;
  /** primary: süren ilerleme; gold: yalnızca tamamlanmış hedef. */
  tone?: 'primary' | 'gold';
}

/** Ders, ünite ya da haftalık hedef ilerlemesi. Raya metin yazılmaz. */
export function ProgressBar({
  value,
  max = 100,
  label,
  valueText,
  showValue = true,
  tone = 'primary',
  className,
  ...rest
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
  const ratio = max > 0 ? clamped / max : 0;
  const text = valueText ?? formatPercent(ratio);
  return (
    <div {...rest} className={cn('flex min-w-50 flex-col gap-1', className)}>
      {label || showValue ? (
        <div className="text-small flex justify-between">
          <span className="text-ink-muted">{label}</span>
          {showValue ? <span className="font-medium text-ink tabular-nums">{text}</span> : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label ?? 'İlerleme'}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-valuetext={text}
        className="h-2 overflow-hidden rounded-sm bg-surface-sunken ring-1 ring-inset ring-line"
      >
        <div
          className={cn(
            'og-motion h-full rounded-sm transition-[width] duration-300',
            tone === 'gold' ? 'bg-gold ring-1 ring-inset ring-gold-deep' : 'bg-primary',
          )}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}
