import type { ReactNode } from 'react';
import { AppBrand } from '@/components/AppBrand';
import { InstallPrompt } from '@/components/InstallPrompt';
import { TabShell } from '@/components/shell';
import { SidebarFooter } from '@/components/SidebarFooter';
import { PARENT_ACCOUNT_LINKS } from '@/lib/nav';
import { requireRole } from '@/server/auth';

export const dynamic = 'force-dynamic';

export default async function VeliLayout({ children }: { children: ReactNode }) {
  const { role, displayName } = await requireRole('parent', 'admin');
  return (
    <TabShell variant="parent" brand={<AppBrand size="sm" endorsement={false} />} footer={<SidebarFooter displayName={displayName} role={role} links={PARENT_ACCOUNT_LINKS} />}>
      <InstallPrompt />
      {children}
    </TabShell>
  );
}
