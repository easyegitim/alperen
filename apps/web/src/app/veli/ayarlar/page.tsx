import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { PushToggle } from '@/components/PushToggle';
import { SignOutButton } from '@/components/SignOutButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getPublicEnv } from '@/lib/env';
import { parseInviteToken } from '@/lib/validation';
import { requireRole } from '@/server/auth';
import { DavetFormu } from './davet-formu';

export const metadata: Metadata = { title: 'Ayarlar' };

export default async function VeliAyarlar({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, displayName } = await requireRole('parent', 'admin');
  const vapid = getPublicEnv().vapidPublicKey;
  const params = await searchParams;
  const defaultToken = parseInviteToken(Array.isArray(params.kod) ? params.kod[0] : params.kod) ?? '';
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader title="Ayarlar" description={`${displayName ?? 'Hesabın'}${user.email ? ` · ${user.email}` : ''}`} />

      <section aria-labelledby="cocuk" className="flex flex-col gap-3">
        <h2 id="cocuk" className="text-title-2 m-0 text-ink">
          Çocuk ekle
        </h2>
        <p className="text-body m-0 max-w-prose text-ink-muted">Bir davet kodun daha varsa girerek yeni bir çocuk bağlayabilirsin.</p>
        <DavetFormu defaultToken={defaultToken} />
      </section>

      <section aria-labelledby="bildirim" className="flex flex-col gap-3">
        <h2 id="bildirim" className="text-title-2 m-0 text-ink">
          Bildirimler
        </h2>
        <PushToggle userId={user.id} vapidPublicKey={vapid} />
      </section>

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
