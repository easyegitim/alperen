import { useId } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';

export interface SelectFieldProps extends Omit<ComponentPropsWithRef<'select'>, 'className'> {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

/** Etiketli açılır liste (tasarım sisteminde henüz yok; TextField ile aynı görünüm ve odak halkası). */
export function SelectField({ label, error, hint, className, options, placeholder, id, ...rest }: SelectFieldProps) {
  const autoId = useId();
  const selectId = id ?? `og-select-${autoId}`;
  const descId = error || hint ? `${selectId}-desc` : undefined;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={selectId} className="text-label text-ink">
        {label}
      </label>
      <select
        {...rest}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={descId}
        className={cn(
          'box-border h-11 rounded-sm border bg-surface-raised px-3 text-body text-ink focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-transparent focus-visible:shadow-focus-ring',
          error ? 'border-danger' : 'border-line-strong',
        )}
      >
        {placeholder ? (
          <option value="" disabled={rest.required}>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {descId ? (
        <span id={descId} className={cn('text-small', error ? 'text-danger' : 'text-ink-muted')}>
          {error ? `✕ ${error}` : hint}
        </span>
      ) : null}
    </div>
  );
}
