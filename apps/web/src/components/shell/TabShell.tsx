'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { LayoutGrid, MessageCircle, Sun, TrendingUp, type LucideIcon } from 'lucide-react';
import { cn } from '@/ds';
import { isNavActive, PARENT_NAV, STUDENT_NAV, type NavItemDef } from '@/lib/nav';

export type ShellVariant = 'student' | 'parent';

/** Mockup S02/S08/S10 alt çubuğunun simgeleri (Lucide): Bugün güneş, Koç/Sohbet konuşma balonu, Gelişim yükselen çizgi. */
const TAB_ICONS: Record<string, LucideIcon> = { bugun: Sun, koc: MessageCircle, gelisim: TrendingUp, ozet: LayoutGrid, sohbet: MessageCircle };

/**
 * Odak ekranları (mockup S01, S04–S07, S09): alt çubuk ve kenar çubuğu yok; ekranın kendi "Kapat" bağlantısı vardır.
 * Önek eşleşmesi; diğer ekranlar bu listeye eklenebilir.
 */
export const FOCUS_PREFIXES: readonly string[] = ['/ogrenci/test', '/ogrenci/sinav', '/ogrenci/onboarding', '/ogrenci/sonuc', '/ogrenci/teshis', '/ogrenci/yukle', '/ogrenci/deneme', '/ogrenci/belge/', '/ogrenci/gelisim/belgeler/'];

export function isFocusPath(pathname: string): boolean {
  return FOCUS_PREFIXES.some((p) => (p.endsWith('/') ? pathname.startsWith(p) && pathname.length > p.length : pathname === p || pathname.startsWith(`${p}/`)));
}

export function shellTabs(variant: ShellVariant, pathname: string): Array<NavItemDef & { active: boolean }> {
  const defs = variant === 'student' ? STUDENT_NAV : PARENT_NAV;
  const root = defs[0]?.href ?? '/';
  return defs.map((d) => ({ ...d, active: isNavActive(d.href, pathname, root, d.alsoActive) }));
}

export interface TabShellProps {
  variant: ShellVariant;
  /** Masaüstü kenar çubuğu marka alanı (sunucuda çizilir). */
  brand: ReactNode;
  /** Masaüstü kenar çubuğu altı: kullanıcı, tema, çıkış (sunucuda çizilir). */
  footer: ReactNode;
  /** Odak olmayan ekranların üstünde görünen şerit (ör. uygulamayı yükle önerisi); odak ekranlarında çizilmez. */
  banner?: ReactNode;
  children: ReactNode;
}

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * Öğrenci (Bugün · Koç · Gelişim) ve veli (Özet · Sohbet) kabuğu, mockup S02/S08/S10 ile: mobilde yalnız 64 px alt
 * çubuk (üst marka çubuğu yok; her ekran kendi başlığını çizer), masaüstünde kenar çubuğu. Odak ekranlarında gezinme
 * çizilmez. Kamera/yükleme: Bugün'deki "+ yükle" bağlantısı ve Koç'taki ek düğmesi.
 */
export function TabShell({ variant, brand, footer, banner, children }: TabShellProps) {
  const pathname = usePathname() ?? '/';
  const focus = isFocusPath(pathname);
  const tabs = shellTabs(variant, pathname);
  const navLabel = 'Ana gezinme';

  if (focus) {
    return (
      <div className="flex min-h-dvh flex-col bg-surface text-ink" data-shell="focus">
        <main id="icerik" className="mx-auto flex w-full max-w-xl min-w-0 flex-1 flex-col px-6 pt-4 pb-8">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface text-ink md:flex-row" data-shell={variant}>
      <nav aria-label={navLabel} className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-4 border-r border-line bg-surface-raised p-4 md:flex">
        <div className="px-2 py-1">{brand}</div>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {tabs.map((t) => {
            const Icon = TAB_ICONS[t.id] ?? Sun;
            return (
              <li key={`side-${t.id}`} className="contents">
                <Link
                  href={t.href}
                  aria-current={t.active ? 'page' : undefined}
                  className={cn('text-label flex min-h-11 items-center gap-3 rounded-md px-3 no-underline', t.active ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-surface-sunken', FOCUS_RING)}
                >
                  <Icon aria-hidden="true" size={22} strokeWidth={1.75} />
                  <span>{t.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto">{footer}</div>
      </nav>

      <main id="icerik" className="mx-auto w-full max-w-3xl min-w-0 flex-1 px-6 pt-6 pb-[calc(96px+env(safe-area-inset-bottom))] md:px-8 md:pb-8">
        {banner}
        {children}
      </main>

      <nav aria-label={`${navLabel} (alt çubuk)`} className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface-raised pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className={cn('m-0 grid h-16 list-none p-0', variant === 'student' ? 'grid-cols-3 px-6' : 'grid-cols-2 px-12')}>
          {tabs.map((t) => {
            const Icon = TAB_ICONS[t.id] ?? Sun;
            return (
              <li key={`bot-${t.id}`} className="flex">
                <Link
                  href={t.href}
                  aria-current={t.active ? 'page' : undefined}
                  className={cn(
                    'flex flex-1 flex-col items-center justify-center gap-1 rounded-md text-[11px] leading-[14px] no-underline',
                    t.active ? 'font-semibold text-primary' : 'font-medium text-ink-muted',
                    FOCUS_RING,
                  )}
                >
                  <Icon aria-hidden="true" size={24} strokeWidth={1.75} />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
