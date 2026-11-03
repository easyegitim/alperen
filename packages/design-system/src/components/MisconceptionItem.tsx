import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Badge } from './Badge';
import { EvidenceQuote, type EvidenceKind } from './EvidenceQuote';

export interface EvidenceRef {
  quote: ReactNode;
  kind?: EvidenceKind;
  source?: string;
  href?: string;
}

export interface MisconceptionItemProps extends Omit<ComponentPropsWithRef<'article'>, 'children'> {
  /** Yanılgı, tek cümle; öğrenciyi değil hatayı anlatır. */
  text: string;
  skill?: string;
  /** En az bir kanıt; kanıtsız yanılgı gösterilmez. */
  evidence?: EvidenceRef[];
  firstSeen?: string;
  resolved?: boolean;
  resolvedAt?: string;
  children?: ReactNode;
}

/** Kavram yanılgısı kartı: çözülene kadar "Açık"; "✓ Çözüldü" yalnızca yeni kanıt ve eğitmen onayıyla. */
export function MisconceptionItem({
  text,
  skill,
  evidence = [],
  firstSeen,
  resolved,
  resolvedAt,
  className,
  children,
  ...rest
}: MisconceptionItemProps) {
  if (evidence.length === 0) return null;
  return (
    <article
      {...rest}
      className={cn('box-border flex max-w-140 flex-col gap-2 rounded-lg border border-line bg-surface-raised p-4', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-ink-muted">{skill}</span>
        {resolved ? <Badge tone="success">✓ Çözüldü</Badge> : <Badge tone="warning">Açık</Badge>}
      </div>
      <p className={cn('text-body m-0', resolved ? 'font-medium text-ink-muted' : 'font-semibold text-ink')}>{text}</p>
      <div className="flex flex-col gap-2">
        {evidence.map((e, i) => (
          <EvidenceQuote key={i} kind={e.kind} source={e.source} href={e.href}>
            {e.quote}
          </EvidenceQuote>
        ))}
      </div>
      {firstSeen || resolvedAt ? (
        <span className="text-caption text-ink-muted">
          {firstSeen ? `İlk görülme: ${firstSeen}` : ''}
          {firstSeen && resolvedAt ? ' · ' : ''}
          {resolvedAt ? `Çözüldü: ${resolvedAt}` : ''}
        </span>
      ) : null}
      {children}
    </article>
  );
}
