import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Badge } from './Badge';

export interface CitationCardProps extends Omit<ComponentPropsWithRef<'article'>, 'title'> {
  title: string;
  authors?: string;
  venue?: string;
  year?: string | number;
  doi?: string;
  /** Yalnızca Crossref'in çözdüğü DOI için true. false: öğrenciye gösterilmez, incelemede "kaldırılacak". */
  verified?: boolean;
  /** Tek cümle özet; kaynağın iddiasını aşmaz. */
  tldr?: string;
  pdfUrl?: string;
  actions?: ReactNode;
}

/** Atıf kartı: yazar · yayın · yıl sırası sabittir. */
export function CitationCard({ title, authors, venue, year, doi, verified, tldr, pdfUrl, actions, className, ...rest }: CitationCardProps) {
  const unverified = !!doi && verified === false;
  const meta = [authors, venue, year !== undefined ? String(year) : undefined].filter(Boolean).join(' · ');
  return (
    <article
      {...rest}
      className={cn(
        'box-border flex max-w-140 flex-col gap-2 rounded-lg border bg-surface-raised p-4',
        unverified ? 'border-danger' : 'border-line',
        className,
      )}
    >
      <span className="text-body font-semibold text-ink">{title}</span>
      {meta ? <span className="text-small text-ink-muted">{meta}</span> : null}
      {tldr ? <span className="text-small text-ink">{tldr}</span> : null}
      <div className="font-mono text-small flex flex-wrap items-center gap-2 text-ink-muted">
        {doi ? (
          <>
            <a href={`https://doi.org/${doi}`} className="text-primary underline">
              {doi}
            </a>
            {verified === true ? <Badge tone="success">✓ Crossref doğruladı</Badge> : null}
            {unverified ? <Badge tone="danger">✕ DOI çözümlenmedi · kaldırılacak</Badge> : null}
          </>
        ) : (
          <span>DOI yok</span>
        )}
        {pdfUrl ? (
          <a href={pdfUrl} className="text-primary underline">
            Açık erişim PDF
          </a>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </article>
  );
}
