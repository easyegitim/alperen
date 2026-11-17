import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface ScreenHeaderProps {
  title: string;
  /** Baş harfi yuvarlakta gösterilen ad (yoksa yuvarlak çizilmez). */
  name?: string | null;
  /** Yuvarlağın açtığı sayfa (öğrenci profili, veli ayarları). */
  accountHref?: string;
  /** 'lg': Bugün (24 px başlık, 40 px yuvarlak); 'sm': Gelişim, Özet (18 px, 32 px). */
  size?: 'lg' | 'sm';
  /** Hesap yuvarlağının solunda küçük bir eylem (veli Özet: bildirim ayarları dişlisi). */
  action?: ReactNode;
}

function initial(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toLocaleUpperCase('tr') : '';
}

/** Sekme ekranlarının başlığı (mockup S02/S08/S10): sayfanın tek h1'i ve sağda hesap yuvarlağı. */
export function ScreenHeader({ title, name, accountHref, size = 'lg', action }: ScreenHeaderProps) {
  const letter = name ? initial(name) : '';
  const circle = cn(
    'inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary no-underline',
    size === 'lg' ? 'size-10 text-body' : 'size-8 text-small',
  );
  return (
    <header className="mb-6 flex items-center justify-between gap-3">
      <h1 className={cn('m-0 min-w-0 text-ink', size === 'lg' ? 'text-title-2' : 'text-title-3')}>{title}</h1>
      <div className="flex shrink-0 items-center gap-1">
      {action}
      {letter ? (
        accountHref ? (
          <Link href={accountHref} aria-label={`Hesabın: ${name}`} className={cn(circle, 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus')}>
            <span aria-hidden="true">{letter}</span>
          </Link>
        ) : (
          <span role="img" aria-label={name ?? ''} className={circle}>
            {letter}
          </span>
        )
      ) : null}
      </div>
    </header>
  );
}
