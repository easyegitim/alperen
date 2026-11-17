import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/cn';
import { Button, buttonClasses } from './Button';

export interface BigStartProps extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
  /** Önerinin tek cümlesi: "Rasyonel sayılar". */
  title: string;
  /** Üst satır; varsayılan "Bugün sana önerim". */
  eyebrow?: string;
  /** "8 soru · 12 dk". */
  meta?: string;
  onStart?: () => void;
  href?: string;
  actionLabel?: string;
  headingLevel?: 1 | 2 | 3;
}

/** Bugün ekranının kahraman kartı: tek öneri ve ekrandaki tek birincil "Başla" düğmesi. */
export function BigStart({
  title,
  eyebrow = 'Bugün sana önerim',
  meta,
  onStart,
  href,
  actionLabel = 'Başla',
  headingLevel = 2,
  className,
  ...rest
}: BigStartProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section
      aria-label={eyebrow}
      {...rest}
      className={cn('flex w-full flex-col gap-4 rounded-lg border border-line bg-surface-raised p-6 shadow-ai', className)}
    >
      <div className="flex flex-col gap-1">
        <p className="text-small m-0 font-semibold text-primary">{eyebrow}</p>
        <Heading className="text-title-1 m-0 text-ink">{title}</Heading>
        {meta ? <p className="text-body m-0 text-ink-muted">{meta}</p> : null}
      </div>
      {href ? (
        <a href={href} className={buttonClasses({ variant: 'primary', size: 'lg', block: true })}>
          {actionLabel}
        </a>
      ) : (
        <Button variant="primary" size="lg" block onClick={onStart}>
          {actionLabel}
        </Button>
      )}
    </section>
  );
}
