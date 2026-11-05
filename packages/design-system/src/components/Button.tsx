import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn, FOCUS_RING } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'reward';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-strong',
  secondary: 'bg-surface-raised text-primary border-line-strong hover:bg-primary-soft',
  quiet: 'bg-transparent text-primary hover:bg-primary-soft',
  reward: 'bg-gold text-on-gold border-gold-deep',
};

// Dokunma hedefi en az 44px: sm yalnızca ince işaretçide (fare) 36px olur.
const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 text-small pointer-fine:min-h-9 pointer-fine:px-2',
  md: 'min-h-11 px-4 text-label',
  lg: 'min-h-12 px-6 text-body font-medium',
};

/** Bağlantıyı düğme gibi göstermek için (ör. Next Link): className={buttonClasses({ variant: 'primary' })}. */
export function buttonClasses({ variant = 'secondary', size = 'md', block }: ButtonStyleOptions = {}): string {
  return cn(
    'og-motion inline-flex items-center justify-center gap-2 rounded-md border border-transparent no-underline',
    'cursor-pointer transition-colors duration-150',
    'disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-sunken disabled:text-ink-muted disabled:hover:bg-surface-sunken',
    FOCUS_RING,
    VARIANTS[variant],
    SIZES[size],
    block && 'flex w-full',
  );
}

export interface ButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'>, ButtonStyleOptions {
  /** Dekoratif ikon; anlamı her zaman metin taşır. */
  icon?: ReactNode;
  children?: ReactNode;
}

/** Tek düğme bileşeni. `primary` bir ekranda en fazla bir kez kullanılır. */
export function Button({ variant, size, block, icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} {...rest} className={cn(buttonClasses({ variant, size, block }), className)}>
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
