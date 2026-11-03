import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Info, TriangleAlert, ShieldCheck, UserRound, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './Button';

export type NoticeTone = 'info' | 'warning' | 'legal' | 'handoff';

const TONES: Record<NoticeTone, string> = {
  info: 'bg-primary-soft border-primary-soft',
  warning: 'bg-warning-soft border-warning-soft',
  legal: 'bg-surface-sunken border-line-strong',
  handoff: 'bg-surface-raised border-primary',
};

const ICONS: Record<NoticeTone, typeof Info> = {
  info: Info,
  warning: TriangleAlert,
  legal: ShieldCheck,
  handoff: UserRound,
};

const ICON_COLOR: Record<NoticeTone, string> = {
  info: 'text-primary',
  warning: 'text-warning',
  legal: 'text-ink-muted',
  handoff: 'text-primary',
};

export interface NoticeProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  tone?: NoticeTone;
  /** handoff için varsayılan "Hocana yönlendirildi". */
  title?: ReactNode;
  /** Button secondary sm. */
  action?: ReactNode;
  /** Yalnızca info tonunda kapatma düğmesi gösterilir. */
  onDismiss?: () => void;
}

/** Akışın içindeki kısa bildirim: bilgi, uyarı, yasal bildirim ya da insana yönlendirme notu. */
export function Notice({ tone = 'info', title, action, onDismiss, className, children, ...rest }: NoticeProps) {
  const Icon = ICONS[tone];
  const heading = title ?? (tone === 'handoff' ? 'Hocana yönlendirildi' : undefined);
  return (
    <div
      role={tone === 'warning' ? 'alert' : tone === 'info' ? 'status' : 'note'}
      {...rest}
      className={cn(
        'text-small box-border flex max-w-160 items-start gap-3 rounded-md border px-4 py-3 text-ink',
        TONES[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" size={20} className={cn('mt-0.5 shrink-0', ICON_COLOR[tone])} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {heading ? <span className="font-semibold">{heading}</span> : null}
        {children ? <span>{children}</span> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
      {tone === 'info' && onDismiss ? (
        <Button variant="quiet" size="sm" icon={<X size={16} />} onClick={onDismiss}>
          Kapat
        </Button>
      ) : null}
    </div>
  );
}
