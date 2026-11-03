import type { ComponentPropsWithRef } from 'react';
import { cn, FOCUS_RING } from '../lib/cn';

export type AnswerStatus = 'blank' | 'answered' | 'flagged';

export interface AnswerGridItem {
  no: number;
  status: AnswerStatus;
}

export interface AnswerGridProps extends Omit<ComponentPropsWithRef<'div'>, 'onSelect'> {
  questions: AnswerGridItem[];
  /** Şu anki soru numarası. */
  current?: number;
  onSelect?: (no: number) => void;
  label?: string;
}

const STATUS_TEXT: Record<AnswerStatus, string> = { blank: 'boş', answered: 'cevaplandı', flagged: 'bayraklı' };

/** Soru ızgarası: boş / cevaplandı / bayraklı; durum metinle (ve işaretle) de belirtilir. */
export function AnswerGrid({ questions, current, onSelect, label = 'Soru ızgarası', className, ...rest }: AnswerGridProps) {
  return (
    <div {...rest} className={cn('flex flex-col gap-2', className)}>
      <div role="group" aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-2">
        {questions.map((q) => (
          <button
            key={q.no}
            type="button"
            onClick={() => onSelect?.(q.no)}
            aria-current={q.no === current ? 'step' : undefined}
            aria-label={`Soru ${q.no}, ${STATUS_TEXT[q.status]}`}
            className={cn(
              'text-label relative inline-flex size-11 cursor-pointer items-center justify-center rounded-md border tabular-nums',
              q.status === 'answered' && 'border-primary bg-primary text-on-primary',
              q.status === 'blank' && 'border-line-strong bg-surface-raised text-ink',
              q.status === 'flagged' && 'border-warning bg-warning-soft text-warning',
              q.no === current && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
              FOCUS_RING,
            )}
          >
            {q.no}
            {q.status === 'flagged' ? (
              <span aria-hidden="true" className="absolute -top-1 -right-1 rounded-full bg-warning px-1 text-[10px] leading-4 text-surface-raised">
                B
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <p className="text-caption m-0 flex flex-wrap gap-x-4 gap-y-1 text-ink-muted">
        <span>Dolu: cevaplandı</span>
        <span>Boş çerçeve: boş</span>
        <span>B: bayraklı</span>
      </p>
    </div>
  );
}
