import { ChevronDown } from 'lucide-react';
import { MathText } from '@/ds';
import { cn } from '@/lib/cn';
import type { LadderRow } from '@/server/diagnosis/present';

const STATE_TONE: Record<LadderRow['state'], string> = {
  ok: 'text-success',
  failing: 'text-danger',
  error: 'text-danger',
  missing: 'text-warning',
  affected: 'text-ink-muted',
};

/**
 * "Adımları göster" (mockup S06): katlı (<details>, varsayılan kapalı) iki sütunlu merdiven — senin adımın · beklenen.
 * Bozulan adım ✕ ve kelimeyle vurgulanır; renk tek başına anlam taşımaz.
 */
export function AdimMerdiveni({ rows }: { rows: LadderRow[] }) {
  if (rows.length === 0) return null;
  return (
    <details data-testid="adim-merdiveni" className="group rounded-lg border border-line bg-surface-raised">
      <summary className="text-label flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 text-primary focus-visible:shadow-focus-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        Adımları göster
        <ChevronDown aria-hidden="true" size={20} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-1 px-2 pb-2">
        <div aria-hidden="true" className="text-small grid grid-cols-2 gap-3 px-3 py-1 font-medium text-ink-muted">
          <span>Senin adımın</span>
          <span>Beklenen</span>
        </div>
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          {rows.map((r) => (
            <li key={r.no} data-state={r.state} aria-current={r.state === 'failing' ? 'step' : undefined} className={cn('flex flex-col gap-1.5 rounded-md p-3', r.state === 'failing' && 'bg-danger-soft')}>
              <div className="text-small flex justify-between font-medium text-ink-muted">
                <span className={cn(r.state === 'failing' && 'text-ink')}>{r.no}. adım</span>
                <span className={STATE_TONE[r.state]}>{r.label}</span>
              </div>
              <div className={cn('text-small grid grid-cols-2 gap-3 break-words', r.state === 'affected' && 'text-ink-muted')}>
                <span>
                  <span className="sr-only">Senin adımın: </span>
                  <MathText>{r.student}</MathText>
                </span>
                <span>
                  <span className="sr-only">Beklenen: </span>
                  {r.expected ? <MathText>{r.expected}</MathText> : '—'}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
