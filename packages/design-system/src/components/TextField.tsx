'use client';

import { useId } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { cn, FOCUS_RING } from '../lib/cn';

export interface TextFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'className'> {
  label: string;
  /** hint ve error aynı anda değil; error varsa o gösterilir. */
  hint?: string;
  error?: string;
  /** Sayı, kesir ve formül cevaplarında mono yazı tipi. */
  mono?: boolean;
  /** Dış sarmalayıcıya uygulanır. */
  className?: string;
  inputClassName?: string;
}

/** Etiketli tek satırlık giriş. Etiket gerçek <label>, yardım/hata aria-describedby ile bağlıdır. */
export function TextField({ label, hint, error, mono, className, inputClassName, id, ref, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? `og-field-${autoId}`;
  const descId = error || hint ? `${inputId}-desc` : undefined;
  return (
    <div className={cn('flex min-w-60 flex-col gap-1', className)}>
      <label htmlFor={inputId} className="text-label text-ink">
        {label}
      </label>
      <input
        {...rest}
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={descId}
        className={cn(
          'box-border h-11 rounded-sm border bg-surface-raised px-3 text-body text-ink placeholder:text-ink-muted',
          error ? 'border-danger' : 'border-line-strong',
          'focus-visible:border-focus',
          FOCUS_RING,
          mono && 'font-mono text-code',
          inputClassName,
        )}
      />
      {descId ? (
        <span id={descId} className={cn('text-small', error ? 'text-danger' : 'text-ink-muted')}>
          {error ? `✕ ${error}` : hint}
        </span>
      ) : null}
    </div>
  );
}
