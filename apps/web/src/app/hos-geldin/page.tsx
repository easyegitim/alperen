import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { GraduationCap, UserRound, UsersRound } from 'lucide-react';
import { AppBrand } from '@/components/AppBrand';
import { LinkButton } from '@/components/LinkButton';
import { SignOutButton } from '@/components/SignOutButton';
import { Notice } from '@/ds';
import { roleHome } from '@/lib/roles';
import { needsOnboarding } from '@/lib/routing';
import { getCurrentProfile } from '@/server/auth';
import { OgrenciFormu, VeliFormu } from './formlar';

export const metadata: Metadata = { title: 'Hoş geldin' };

type Choice = 'ogrenci' | 'veli' | 'egitmen';

export default async function HosGeldinPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const current = await getCurrentProfile();
  if (!current) redirect('/giris');
  const { user, profile } = current;
  if (profile && !needsOnboarding(profile.role, Boolean(profile.onboarded_at))) redirect(roleHome(profile.role));

  const params = await searchParams;
  const raw = Array.isArray(params.rol) ? params.rol[0] : params.rol;
  // Profil satırı varsa rol zaten belli (ör. davet kabulünden sonra yarım kalan veli kurulumu).
  const existing: Choice | null = profile?.role === 'student' ? 'ogrenci' : profile?.role === 'parent' ? 'veli' : null;
  const choice: Choice | null = existing ?? (raw === 'ogrenci' || raw === 'veli' || raw === 'egitmen' ? raw : null);
  const defaultName = profile?.display_name ?? '';

  return (
    <main id="icerik" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-10">
      <div className="flex flex-col gap-4">
        <AppBrand size="lg" />
        <div>
          <h1 className="text-title-1 m-0 text-ink">Hoş geldin</h1>
          <p className="text-body mt-1 mb-0 text-ink-muted">
            {choice === 'ogrenci' ? 'Seni tanımam için birkaç bilgi yeterli.' : choice === 'veli' ? 'Çocuğunla bağlantı kurmak için davet kodunu gir.' : 'Öğrenmen’i nasıl kullanacaksın?'}
          </p>
          <p className="text-small mt-2 mb-0 text-ink-muted">{user.email}</p>
        </div>
      </div>

      {choice === null ? (
        <nav aria-label="Rol seçimi" className="flex flex-col gap-3">
          <LinkButton href="/hos-geldin?rol=ogrenci" variant="secondary" size="lg" block icon={<GraduationCap size={20} />}>
            Öğrenciyim
          </LinkButton>
          <LinkButton href="/hos-geldin?rol=veli" variant="secondary" size="lg" block icon={<UsersRound size={20} />}>
            Veliyim
          </LinkButton>
          <LinkButton href="/hos-geldin?rol=egitmen" variant="secondary" size="lg" block icon={<UserRound size={20} />}>
            Eğitmenim
          </LinkButton>
        </nav>
      ) : null}

      {choice === 'ogrenci' ? <OgrenciFormu defaultName={defaultName} /> : null}
      {choice === 'veli' ? <VeliFormu defaultName={defaultName} /> : null}
      {choice === 'egitmen' ? (
        <div className="flex flex-col gap-4">
          <Notice tone="info" title="Eğitmen hesapları davetle açılır">
            Eğitmen ve yönetici hesaplarını easy ekibi açar. Davet aldıysan, davetin geldiği e-posta adresiyle giriş yaptığında konsol kendiliğinden açılır. Hesabın hazır değilse easy ile iletişime geç.
          </Notice>
          <LinkButton href="/hos-geldin" variant="quiet">
            Başka bir rol seç
          </LinkButton>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        {choice !== null && existing === null ? (
          <LinkButton href="/hos-geldin" variant="quiet">
            Rolü değiştir
          </LinkButton>
        ) : null}
        <SignOutButton block />
      </div>
    </main>
  );
}
