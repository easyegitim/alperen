import type { Metadata } from 'next';
import { FileText, Network, UserRound } from 'lucide-react';
import { LinkButton } from '@/components/LinkButton';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: 'Gelişim' };

export default function GelisimSayfasi() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader title="Gelişim" description="Çözdüğün sorular, netlerin ve hedefine kalan süre ilk veriler geldiğinde burada görünür." />
      <nav aria-label="Gelişim bölümleri" className="flex flex-col gap-3">
        <LinkButton href="/ogrenci/gelisim/konular" variant="secondary" size="lg" block icon={<Network size={20} />}>
          Konular
        </LinkButton>
        <LinkButton href="/ogrenci/gelisim/belgeler" variant="secondary" size="lg" block icon={<FileText size={20} />}>
          Belgelerim
        </LinkButton>
      </nav>
      <div className="border-t border-line pt-4">
        <LinkButton href="/ogrenci/profil" variant="quiet" icon={<UserRound size={18} />}>
          Profil ve ayarlar
        </LinkButton>
      </div>
    </div>
  );
}
