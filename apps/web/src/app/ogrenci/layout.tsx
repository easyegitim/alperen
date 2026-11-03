import type { ReactNode } from 'react';
import { AppBrand } from '@/components/AppBrand';
import { InstallPrompt } from '@/components/InstallPrompt';
import { RoleShell } from '@/components/RoleShell';
import { SidebarFooter } from '@/components/SidebarFooter';
import { requireRole } from '@/server/auth';

// Kişisel veri: hiçbir zaman statik üretilmez ya da paylaşılan önbelleğe girmez.
export const dynamic = 'force-dynamic';

export default async function OgrenciLayout({ children }: { children: ReactNode }) {
  const { role, displayName } = await requireRole('student', 'admin');
  return (
    <RoleShell variant="student" brand={<AppBrand size="sm" endorsement={false} />} footer={<SidebarFooter displayName={displayName} role={role} />}>
      <InstallPrompt />
      {children}
    </RoleShell>
  );
}
