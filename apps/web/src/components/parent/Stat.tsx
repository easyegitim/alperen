import { cn } from '@/lib/cn';

/** Özetin üç sayısından biri (mockup S10): büyük sayı, altında birim ve etiket. */
export function Stat({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div className="box-border flex min-w-0 flex-col-reverse gap-1 rounded-lg border border-line bg-surface-raised px-3 py-4">
      <dt className="text-small flex flex-col text-ink-muted">
        <span className="font-medium text-ink">{unit}</span>
        <span>{label}</span>
      </dt>
      <dd className={cn('m-0 text-ink tabular-nums', /^[\d.,]+$/.test(value) ? 'text-title-2' : 'text-body py-1 font-semibold')}>{value}</dd>
    </div>
  );
}
