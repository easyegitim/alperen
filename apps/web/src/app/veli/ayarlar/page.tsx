import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { LinkButton } from '@/components/LinkButton';
import { SignOutButton } from '@/components/SignOutButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { parseInviteToken } from '@/lib/validation';
import { requireRole } from '@/server/auth';
import { DavetFormu } from './davet-formu';

export const metadata: Metadata = { title: 'Ayarlar' };

export default async function VeliAyarlar({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, displayName } = await requireRole('parent', 'admin');
  const params = await searchParams;
  const defaultToken = parseInviteToken(Array.isArray(params.kod) ? params.kod[0] : params.kod) ?? '';
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader title="Ayarlar" description={`${displayName ?? 'Hesabınız'}${user.email ? ` · ${user.email}` : ''}`} />

      <section aria-labelledby="cocuk" className="flex flex-col gap-3">
        <h2 id="cocuk" className="text-title-2 m-0 text-ink">
          Çocuk ekle
        </h2>
        <p className="text-body m-0 max-w-prose text-ink-muted">Başka bir davet kodunuz varsa girerek yeni bir çocuk bağlayabilirsiniz.</p>
        <DavetFormu defaultToken={defaultToken} />
      </section>

      <section aria-labelledby="bildirim" className="flex flex-col gap-3">
        <h2 id="bildirim" className="text-title-2 m-0 text-ink">
          Bildirimler
        </h2>
        <LinkButton href="/veli/bildirimler" variant="secondary" className="self-start">
          Bildirim ayarları
        </LinkButton>
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
