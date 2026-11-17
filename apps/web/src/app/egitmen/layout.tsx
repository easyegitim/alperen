import type { ReactNode } from 'react';
import { AppBrand } from '@/components/AppBrand';
import { InstructorShell } from '@/components/InstructorShell';
import { SidebarFooter } from '@/components/SidebarFooter';
import { requireRole } from '@/server/auth';

export const dynamic = 'force-dynamic';

export default async function EgitmenLayout({ children }: { children: ReactNode }) {
  const { role, displayName } = await requireRole('instructor', 'admin');
  return (
    <InstructorShell brand={<AppBrand size="sm" endorsement={false} />} footer={<SidebarFooter displayName={displayName} role={role} />}>
      {children}
    </InstructorShell>
  );
}
