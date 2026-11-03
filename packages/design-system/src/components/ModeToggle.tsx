import { useRef, useState } from 'react';
import type { ComponentPropsWithRef, KeyboardEvent } from 'react';
import { cn, FOCUS_RING } from '../lib/cn';
import { TUTOR_MODES, type TutorMode } from '../lib/labels';

export type { TutorMode } from '../lib/labels';

export interface ModeToggleProps extends Omit<ComponentPropsWithRef<'div'>, 'onChange' | 'defaultValue'> {
  /** Kontrollü kullanım. */
  value?: TutorMode;
  /** Kontrolsüz başlangıç; varsayılan "hint" (İpucu). Sistem modu kendiliğinden değiştirmez, öğrenci değiştirir. */
  defaultValue?: TutorMode;
  onChange?: (mode: TutorMode) => void;
  /** Dar alanda alt satırları gizler. */
  compact?: boolean;
  disabled?: boolean;
  /** Erişilebilir grup adı. */
  label?: string;
}

/** Yanıt modu seçici: İpucu (varsayılan) · Açıkla · Çözümü göster. Radyo grubu; ok tuşlarıyla gezilir. */
export function ModeToggle({
  value,
  defaultValue = 'hint',
  onChange,
  compact,
  disabled,
  label = 'Yanıt modu',
  className,
  ...rest
}: ModeToggleProps) {
  const [inner, setInner] = useState<TutorMode>(defaultValue);
  const current = value ?? inner;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (mode: TutorMode) => {
    if (disabled || mode === current) return;
    if (value === undefined) setInner(mode);
    onChange?.(mode);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TUTOR_MODES.length - 1;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next < 0) return;
    e.preventDefault();
    const target = TUTOR_MODES[next];
    if (target) {
      select(target.value);
      refs.current[next]?.focus();
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      {...rest}
      className={cn('inline-flex gap-1 rounded-md bg-surface-sunken p-1 ring-1 ring-inset ring-line', className)}
    >
      {TUTOR_MODES.map((m, i) => {
        const on = m.value === current;
        return (
          <button
            key={m.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onClick={() => select(m.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'text-label og-motion flex min-h-11 cursor-pointer flex-col items-start justify-center rounded-sm px-3 text-left transition-colors',
              on ? 'bg-surface-raised text-primary shadow-sm' : 'bg-transparent text-ink-muted',
              'disabled:cursor-not-allowed',
              FOCUS_RING,
            )}
          >
            {m.label}
            {compact ? null : <span className="text-caption font-normal text-ink-muted">{m.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}
