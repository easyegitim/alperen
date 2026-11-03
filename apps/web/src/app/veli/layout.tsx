import type { ReactNode } from 'react';
import Link from 'next/link';
import { Bell, Settings } from 'lucide-react';
import { AppBrand } from '@/components/AppBrand';
import { InstallPrompt } from '@/components/InstallPrompt';
import { RoleShell } from '@/components/RoleShell';
import { SidebarFooter } from '@/components/SidebarFooter';
import { PARENT_ACCOUNT_LINKS } from '@/lib/nav';
import { requireRole } from '@/server/auth';

const ACCOUNT_ICONS = { bildirimler: Bell, ayarlar: Settings } as const;

export const dynamic = 'force-dynamic';

export default async function VeliLayout({ children }: { children: ReactNode }) {
  const { role, displayName } = await requireRole('parent', 'admin');
  return (
    <RoleShell variant="parent" brand={<AppBrand size="sm" endorsement={false} />} footer={<SidebarFooter displayName={displayName} role={role} />}>
      <InstallPrompt />
      <nav aria-label="Hesap" className="mx-auto mb-4 flex w-full max-w-3xl justify-end gap-2">
        {PARENT_ACCOUNT_LINKS.map((l) => {
          const Icon = ACCOUNT_ICONS[l.id as keyof typeof ACCOUNT_ICONS];
          return (
            <Link key={l.id} href={l.href} className="text-label inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-ink-muted no-underline hover:bg-surface-sunken hover:text-ink">
              <Icon aria-hidden="true" size={18} />
              {l.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </RoleShell>
  );
}
