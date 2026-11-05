import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/cn';

export type EvidenceKind = 'lesson' | 'quiz' | 'chat' | 'instructor';

const KIND_LABELS: Record<EvidenceKind, string> = {
  lesson: 'Ders kaydı',
  quiz: 'Soru',
  chat: 'Sohbet',
  instructor: 'Eğitmen notu',
};

export interface EvidenceQuoteProps extends ComponentPropsWithRef<'figure'> {
  kind?: EvidenceKind;
  /** "Ders 12 · 14:32", "Deneme 3 · Soru 8". Kaynaksız kanıt gösterilmez (bileşen null döndürür). */
  source?: string;
  /** Kaynak mesaj ya da zaman damgası bağlantısı. */
  href?: string;
}

/** Bir iddianın dayandığı kanıt: alıntı ve kaynağı. */
export function EvidenceQuote({ kind = 'lesson', source, href, className, children, ...rest }: EvidenceQuoteProps) {
  if (!source) return null;
  return (
    <figure {...rest} className={cn('m-0 flex flex-col gap-1 rounded-sm bg-surface-sunken px-3 py-2', className)}>
      <blockquote className="text-small m-0 text-ink">{children}</blockquote>
      <figcaption className="text-caption flex flex-wrap items-center gap-2 text-ink-muted">
        <span className="font-medium">{KIND_LABELS[kind]}</span>
        {href ? (
          <a href={href} className="text-primary underline">
            {source}
          </a>
        ) : (
          <span>{source}</span>
        )}
      </figcaption>
    </figure>
  );
}
