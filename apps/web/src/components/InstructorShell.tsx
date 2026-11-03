'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { INSTRUCTOR_NAV, isNavActive } from '@/lib/nav';
import { NavIcon } from './nav-icons';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-transparent focus-visible:shadow-focus-ring';

/**
 * Eğitmen konsolu kabuğu (PLAN §13): masaüstünde (md ve üstü) 9 maddelik kenar çubuğu. Dar ekranda alt çubuk 9 maddeye
 * sığmadığı için üst çubukta "Menü" düğmesiyle açılan liste kullanılır.
 */
export function InstructorShell({ brand, footer, children }: { brand: ReactNode; footer: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const root = INSTRUCTOR_NAV[0]?.href ?? '/egitmen';

  const list = (onNavigate?: () => void) => (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {INSTRUCTOR_NAV.map((it) => {
        const active = isNavActive(it.href, pathname, root);
        return (
          <li key={it.id} className="contents">
            <Link
              href={it.href}
              aria-current={active ? 'page' : undefined}
              onClick={onNavigate}
              className={cn(
                'text-label flex min-h-11 items-center gap-3 rounded-md px-3 no-underline',
                FOCUS,
                active ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-surface-sunken',
              )}
            >
              <NavIcon name={it.icon} />
              <span>{it.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-surface text-ink md:flex-row">
      <nav aria-label="Eğitmen konsolu" className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-surface-raised p-4 md:flex">
        <div className="px-2 py-1">{brand}</div>
        {list()}
        <div className="mt-auto flex flex-col gap-3">{footer}</div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 items-center justify-between gap-2 border-b border-line bg-surface-raised px-4 md:hidden">
          {brand}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="egitmen-mobil-menu"
            onClick={() => setOpen((v) => !v)}
            className={cn('text-label inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-surface-raised px-3 text-ink', FOCUS)}
          >
            {open ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
            Menü
          </button>
        </header>
        {open ? (
          <nav id="egitmen-mobil-menu" aria-label="Eğitmen konsolu (menü)" className="flex flex-col gap-3 border-b border-line bg-surface-raised p-3 md:hidden">
            {list(() => setOpen(false))}
            <div className="flex flex-col gap-3 border-t border-line pt-3">{footer}</div>
          </nav>
        ) : null}
        <main id="icerik" className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
