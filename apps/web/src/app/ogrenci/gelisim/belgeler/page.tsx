import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: 'Belgelerim' };

export default function BelgelerimSayfasi() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Belgelerim" description="Notların, denemelerin ve raporların tek listede." />
      <EmptyState title="Henüz belgen yok">
        {'Koçtan bir not istediğinde ya da bir denemeyi yüklediğinde belgen burada PDF olarak durur; sayfa sayfa açar, indirir ya da paylaşırsın.'}
      </EmptyState>
    </div>
  );
}
