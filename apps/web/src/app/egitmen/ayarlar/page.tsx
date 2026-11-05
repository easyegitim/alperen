import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { SignOutButton } from '@/components/SignOutButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ROLE_LABELS } from '@/lib/roles';
import { requireRole } from '@/server/auth';

export const metadata: Metadata = { title: 'Ayarlar' };

export default async function EgitmenAyarlar() {
  const { user, role, displayName } = await requireRole('instructor', 'admin');
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader title="Ayarlar" description={`${displayName ?? 'Hesabın'} · ${ROLE_LABELS[role]}${user.email ? ` · ${user.email}` : ''}`} />
      <section aria-labelledby="gorunum" className="flex flex-col gap-3">
        <h2 id="gorunum" className="text-title-2 m-0 text-ink">
          Görünüm
        </h2>
        <ThemeToggle className="self-start" />
      </section>
      <section aria-label="Oturum" className="border-t border-line pt-6">
        <SignOutButton />
      </section>
    </div>
  );
}
