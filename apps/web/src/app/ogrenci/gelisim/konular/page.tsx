import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: 'Konular' };

export default function KonularSayfasi() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Konular" description="Hangi konuda ne durumda olduğunu burada görürsün." />
      <EmptyState title="Konu listen henüz boş">
        {'Koçun seni tanıdıkça konular burada zayıf, orta ya da iyi diye görünür. Dokunduğun konunun ayrıntısı açılır.'}
      </EmptyState>
    </div>
  );
}
