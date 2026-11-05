import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn, FOCUS_RING } from '../lib/cn';

export type QuizOptionState = 'idle' | 'selected' | 'correct' | 'incorrect';

const STATES: Record<QuizOptionState, string> = {
  idle: 'border-line-strong bg-surface-raised enabled:hover:bg-primary-soft',
  selected: 'border-primary bg-primary-soft ring-1 ring-inset ring-primary',
  correct: 'border-success bg-success-soft',
  incorrect: 'border-danger bg-danger-soft',
};

const LETTER: Record<QuizOptionState, string> = {
  idle: 'bg-surface-sunken text-ink',
  selected: 'bg-primary text-on-primary',
  correct: 'bg-success text-surface-raised',
  incorrect: 'bg-danger text-surface-raised',
};

export interface QuizOptionProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** A–E. */
  letter?: string;
  state?: QuizOptionState;
  /** Cevaptan sonra; neden doğru/yanlış olduğunu tek cümleyle açıklar. */
  feedback?: ReactNode;
  children?: ReactNode;
}

/**
 * Çoktan seçmeli sorunun tek şıkkı. correct/incorrect kilitlenir ve her zaman "✓ Doğru" / "✕ Tekrar dene"
 * yazısını taşır; renk tek başına anlam taşımaz.
 */
export function QuizOption({ letter, state = 'idle', feedback, className, children, disabled, type = 'button', ...rest }: QuizOptionProps) {
  const locked = state === 'correct' || state === 'incorrect';
  return (
    <button
      type={type}
      aria-pressed={state === 'selected'}
      {...rest}
      disabled={disabled}
      aria-disabled={locked || undefined}
      onClick={locked ? undefined : rest.onClick}
      className={cn(
        'text-body box-border flex min-h-13 w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-ink',
        'og-motion cursor-pointer transition-colors disabled:cursor-default',
        locked && 'cursor-default',
        STATES[state],
        FOCUS_RING,
        className,
      )}
    >
      {letter ? (
        <span
          className={cn('text-small inline-flex size-8 shrink-0 items-center justify-center rounded-sm font-semibold', LETTER[state])}
        >
          {letter}
        </span>
      ) : null}
      <span className="flex flex-1 flex-col">
        <span>{children}</span>
        {feedback ? <span className="text-small text-ink-muted">{feedback}</span> : null}
      </span>
      {state === 'correct' ? <span className="text-small shrink-0 font-semibold text-success">✓ Doğru</span> : null}
      {state === 'incorrect' ? <span className="text-small shrink-0 font-semibold text-danger">✕ Tekrar dene</span> : null}
    </button>
  );
}
