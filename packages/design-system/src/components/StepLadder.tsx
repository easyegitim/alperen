import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/cn';
import { ERROR_CAUSE_LABELS, type ErrorCause } from '../lib/labels';
import { MathText } from '../math';
import { Badge } from './Badge';

export interface LadderStep {
  no: number;
  /** Adım metni; `$…$` içindeki formüller KaTeX ile çizilir. */
  text: string;
  note?: string;
}

export interface StepLadderProps extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
  studentSteps: LadderStep[];
  expectedSteps: LadderStep[];
  /** Bozulan adımın numarası (solution_analyses.failing_step_no). Yoksa tüm adımlar doğru sayılır. */
  failingStepNo?: number | null;
  cause?: ErrorCause;
  studentTitle?: string;
  expectedTitle?: string;
}

type StepState = 'ok' | 'failing' | 'after';

function stateOf(no: number, failing: number | null | undefined): StepState {
  if (failing == null) return 'ok';
  if (no < failing) return 'ok';
  return no === failing ? 'failing' : 'after';
}

/** Öğrencinin adımları ile beklenen adımlar yan yana; bozulan adım ✕ + kelimeyle vurgulanır. */
export function StepLadder({
  studentSteps,
  expectedSteps,
  failingStepNo,
  cause,
  studentTitle = 'Senin adımların',
  expectedTitle = 'Beklenen adımlar',
  className,
  ...rest
}: StepLadderProps) {
  return (
    <section aria-label="Adım merdiveni" {...rest} className={cn('flex flex-col gap-3', className)}>
      {failingStepNo != null && cause ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="danger">✕ {failingStepNo}. adımda bozuldu</Badge>
          <Badge tone="neutral">{ERROR_CAUSE_LABELS[cause]}</Badge>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-label m-0 mb-2 text-ink">{studentTitle}</h3>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {studentSteps.map((s) => {
              const st = stateOf(s.no, failingStepNo);
              return (
                <li
                  key={s.no}
                  data-state={st}
                  aria-current={st === 'failing' ? 'step' : undefined}
                  className={cn(
                    'flex items-start gap-3 rounded-md border px-3 py-2',
                    st === 'failing' && 'border-danger bg-danger-soft',
                    st === 'ok' && 'border-line bg-surface-raised',
                    st === 'after' && 'border-line bg-surface-sunken text-ink-muted',
                  )}
                >
                  <span className="text-small w-6 shrink-0 font-semibold tabular-nums">{s.no}.</span>
                  <span className="text-body min-w-0 flex-1">
                    <MathText>{s.text}</MathText>
                    {s.note ? <span className="text-small block text-ink-muted">{s.note}</span> : null}
                  </span>
                  <span className="text-small shrink-0 font-semibold">
                    {st === 'ok' ? <span className="text-success">✓ Doğru</span> : null}
                    {st === 'failing' ? <span className="text-danger">✕ Burada bozuldu</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <div>
          <h3 className="text-label m-0 mb-2 text-ink">{expectedTitle}</h3>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {expectedSteps.map((s) => {
              const here = failingStepNo != null && s.no === failingStepNo;
              return (
                <li
                  key={s.no}
                  data-state={here ? 'expected-here' : 'expected'}
                  className={cn(
                    'flex items-start gap-3 rounded-md border px-3 py-2',
                    here ? 'border-primary bg-primary-soft' : 'border-line bg-surface-raised',
                  )}
                >
                  <span className="text-small w-6 shrink-0 font-semibold tabular-nums">{s.no}.</span>
                  <span className="text-body min-w-0 flex-1">
                    <MathText>{s.text}</MathText>
                    {s.note ? <span className="text-small block text-ink-muted">{s.note}</span> : null}
                  </span>
                  {here ? <span className="text-small shrink-0 font-semibold text-primary">Beklenen</span> : null}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
