import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { SorYakalama } from './sor-yakalama';

export const metadata: Metadata = { title: 'Sor' };

export default function SorSayfasi() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Sor" description="Sorunun fotoğrafını çek. İstersen kendi çözümünü de ekle; öğretmen hatanın nerede başladığını bulur." />
      <SorYakalama />
    </div>
  );
}
