'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Camera } from 'lucide-react';
import { AppShell, type AppNavItem } from '@/ds';
import { isNavActive, PARENT_NAV, STUDENT_FAB, STUDENT_NAV } from '@/lib/nav';
import { NavIcon } from './nav-icons';

export interface RoleShellProps {
  variant: 'student' | 'parent';
  /** Üst çubuk / kenar çubuğu marka alanı (sunucuda çizilir). */
  brand: ReactNode;
  /** Masaüstü kenar çubuğu altı: kullanıcı, tema, çıkış (sunucuda çizilir). */
  footer: ReactNode;
  children: ReactNode;
}

/**
 * Öğrenci ve veli kabuğu: mobilde alt gezinme (öğrencide ortada "Sor" kamera düğmesi), masaüstünde kenar çubuğu.
 * Etkin sekme yoldan hesaplanır; bağlantılar Next Link ile (istemci gezintisi).
 */
export function RoleShell({ variant, brand, footer, children }: RoleShellProps) {
  const pathname = usePathname();
  const defs = variant === 'student' ? STUDENT_NAV : PARENT_NAV;
  const root = defs[0]?.href ?? '/';
  const items: AppNavItem[] = defs.map((d) => ({
    id: d.id,
    label: d.label,
    href: d.href,
    icon: <NavIcon name={d.icon} />,
    active: isNavActive(d.href, pathname, root),
  }));
  return (
    <AppShell
      brand={brand}
      items={items}
      fab={variant === 'student' ? { label: STUDENT_FAB.label, href: STUDENT_FAB.href, icon: <Camera aria-hidden="true" size={24} /> } : undefined}
      footer={footer}
      navLabel={variant === 'student' ? 'Öğrenci gezinmesi' : 'Veli gezinmesi'}
      renderLink={({ children: linkChildren, ...props }) => <Link {...props}>{linkChildren}</Link>}
    >
      {children}
    </AppShell>
  );
}
