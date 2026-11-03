import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/cn';

export type BadgeTone = 'neutral' | 'primary' | 'gold' | 'success' | 'warning' | 'danger' | 'ai' | 'brand';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted',
  primary: 'bg-primary-soft text-primary',
  gold: 'bg-gold text-on-gold',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  ai: 'bg-ai-soft text-ink ring-1 ring-inset ring-ai-glow',
  brand: 'bg-easy-purple text-on-navy',
};

export interface BadgeProps extends ComponentPropsWithRef<'span'> {
  tone?: BadgeTone;
}

/** Bir iki kelimelik durum etiketi. Tıklanabilir değildir; eylem için Button kullan. Durum her zaman kelimeyle yazılır. */
export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={cn(
        'text-caption inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-2',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
