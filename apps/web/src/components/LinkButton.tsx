'use client';

import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { buttonClasses, cn, type ButtonStyleOptions } from '@/ds';

export interface LinkButtonProps extends Omit<ComponentProps<typeof Link>, 'className'>, ButtonStyleOptions {
  className?: string;
  /** Dekoratif ikon; anlam her zaman metindedir. */
  icon?: ReactNode;
}

/** Düğme görünümlü Next bağlantısı (gezinme için gerçek <a>). */
export function LinkButton({ variant, size, block, icon, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link {...rest} className={cn(buttonClasses({ variant, size, block }), className)}>
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      {children}
    </Link>
  );
}
