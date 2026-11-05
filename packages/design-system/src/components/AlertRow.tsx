import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Badge, type BadgeTone } from './Badge';

export type AlertKind = 'unanswered' | 'silent' | 'morale' | 'deadline' | 'response';
export type AlertSeverity = 'danger' | 'warning' | 'neutral';

const KIND_LABELS: Record<AlertKind, string> = {
  unanswered: 'Cevapsız soru',
  silent: 'Sessiz öğrenci',
  morale: 'Moral göstergesi',
  deadline: 'Yaklaşan teslim',
  response: 'Yanıt süresi',
};

const SEVERITY: Record<AlertSeverity, { tone: BadgeTone; text: string }> = {
  danger: { tone: 'danger', text: 'Acil' },
  warning: { tone: 'warning', text: 'Dikkat' },
  neutral: { tone: 'neutral', text: 'Bilgi' },
};

export interface AlertRowProps extends Omit<ComponentPropsWithRef<'article'>, 'children'> {
  kind: AlertKind | (string & {});
  severity?: AlertSeverity;
  /** "Elif K." biçimi. */
  student: string;
  detail?: string;
  /** "14 saattir cevapsız". */
  since?: string;
  /** Button secondary sm. */
  action?: ReactNode;
}

/** Eğitmen takip satırı: kim, ne, ne zamandır, ne yapmalı. Önem derecesi kelimeyle yazılır. */
export function AlertRow({ kind, severity = 'neutral', student, detail, since, action, className, ...rest }: AlertRowProps) {
  const sev = SEVERITY[severity];
  return (
    <article
      {...rest}
      className={cn('box-border flex max-w-160 items-center gap-3 rounded-md border border-line bg-surface-raised px-4 py-3', className)}
    >
      <Badge tone={sev.tone}>{sev.text}</Badge>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-caption text-ink-muted">{KIND_LABELS[kind as AlertKind] ?? kind}</span>
        <span className="text-label font-semibold text-ink">{student}</span>
        {detail ? <span className="text-small text-ink-muted">{detail}</span> : null}
      </div>
      {since ? <span className="text-caption whitespace-nowrap text-ink-muted">{since}</span> : null}
      {action ? <div className="shrink-0">{action}</div> : null}
    </article>
  );
}
