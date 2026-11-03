import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Badge } from './Badge';

export interface ExamPriorityRowProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  rank: number | string;
  topic: string;
  /** ispat / hesap / çoktan seçmeli. */
  kind?: string;
  /** Konunun çıktığı yıl sayısı. */
  hits: number;
  /** Toplam yıl sayısı. */
  years?: number;
  /** "≈20 puan" (yaklaşık işareti, tilde değil). */
  points?: string;
  /** "Kanıt: 4 sınav". */
  evidence?: string;
  /** Kanıt arşivi (eğitmen) bağlantısı. */
  href?: string;
}

/** Sıklık analizine göre öncelik satırı. "Tahmin", "çıkacak", "kesin" kelimeleri kullanılmaz. */
export function ExamPriorityRow({ rank, topic, kind, hits, years, points, evidence, href, className, ...rest }: ExamPriorityRowProps) {
  const total = years && years > 0 ? Math.min(years, 12) : 0;
  return (
    <div
      {...rest}
      className={cn(
        'box-border grid max-w-160 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-line bg-surface-raised px-4 py-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto_auto]',
        className,
      )}
    >
      <span className="text-title-3 text-ink-muted tabular-nums">{rank}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body flex flex-wrap items-center gap-2 font-semibold text-ink">
          {topic}
          {kind ? <Badge tone="primary">{kind}</Badge> : null}
        </span>
        {evidence ? (
          <span className="text-caption text-ink-muted">
            {href ? (
              <a href={href} className="text-primary underline">
                {evidence}
              </a>
            ) : (
              evidence
            )}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        {total > 0 ? (
          <span aria-hidden="true" className="flex gap-0.5">
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={cn('h-2 w-3 rounded-[2px]', i < hits ? 'bg-primary' : 'bg-primary-soft')} />
            ))}
          </span>
        ) : null}
        <span className="text-small whitespace-nowrap text-ink tabular-nums">{years ? `${hits}/${years} yıl` : `${hits} yıl`}</span>
      </div>
      {points ? <span className="text-small hidden whitespace-nowrap font-medium text-ink tabular-nums sm:block">{points}</span> : null}
    </div>
  );
}

export interface ExamPriorityListProps extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
  /** Başlık sabittir; değiştirmek için yalnızca dil/bağlam gerekçesi. */
  title?: string;
  children?: ReactNode;
}

/** Başlığı sabit liste kabı: "Sıklık analizine göre öncelikler". */
export function ExamPriorityList({ title = 'Sıklık analizine göre öncelikler', className, children, ...rest }: ExamPriorityListProps) {
  return (
    <section {...rest} className={cn('flex flex-col gap-3', className)}>
      <h2 className="text-title-3 m-0 text-ink">{title}</h2>
      {children}
    </section>
  );
}
