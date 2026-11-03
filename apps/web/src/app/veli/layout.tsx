import type { ReactNode } from 'react';
import { AppBrand } from '@/components/AppBrand';
import { InstallPrompt } from '@/components/InstallPrompt';
import { RoleShell } from '@/components/RoleShell';
import { SidebarFooter } from '@/components/SidebarFooter';
import { requireRole } from '@/server/auth';

export const dynamic = 'force-dynamic';

export default async function VeliLayout({ children }: { children: ReactNode }) {
  const { role, displayName } = await requireRole('parent', 'admin');
  return (
    <RoleShell variant="parent" brand={<AppBrand size="sm" endorsement={false} />} footer={<SidebarFooter displayName={displayName} role={role} />}>
      <InstallPrompt />
      {children}
    </RoleShell>
  );
}
