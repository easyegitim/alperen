import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: "Konu haritası" };

export default function Sayfa() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Konu haritası" description="Hangi konuda ne kadar kanıtın olduğunu burada görürsün." />
      <EmptyState title="Konu haritan henüz boş">
        {"Bir ders seçtiğinde müfredat ağacı açılır. Her konunun yanında ustalığın ve dayandığı kanıt sayısı görünür; yeterli kanıt yoksa bunu açıkça yazarız."}
      </EmptyState>
    </div>
  );
}
