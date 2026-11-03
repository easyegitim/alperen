import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { firstName } from '@/lib/format';
import { requireRole } from '@/server/auth';

export const metadata: Metadata = { title: 'Bugün' };

// Bugün (PLAN-v2 §13): tek kahraman kart. Öneri tablosu (suggestions) bağlanana dek koçun hazırlığını anlatan boş durum çizilir.
export default async function BugunSayfasi() {
  const { displayName } = await requireRole('student', 'admin');
  const name = firstName(displayName);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader title={name ? `Merhaba, ${name}` : 'Merhaba'} />
      <EmptyState title="Koçun ilk önerini hazırlıyor">
        {'Hazır olunca burada Başla düğmesi çıkar.'}
      </EmptyState>
    </div>
  );
}
