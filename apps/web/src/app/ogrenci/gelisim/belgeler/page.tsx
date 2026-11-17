import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { requireRole } from '@/server/auth';
import { LibraryList } from '@/components/documents/Library';
import { libraryRows } from '@/server/documents/present';
import { documentDb } from '@/server/documents/read';
import { listMyDocuments } from '@/server/documents/rpc';

export const metadata: Metadata = { title: 'Belgelerim' };

// Gelişim › Belgelerim: list_my_documents (kendi belgelerin + kayıtlı dersin yayımlanmış belgeleri; cevap anahtarı yok).
// Hazırlananlar dahil tümü durum kelimesiyle listelenir; hazır satır belge görüntüleyiciyi açar.
export default async function BelgelerimSayfasi() {
  await requireRole('student', 'admin');
  const res = await listMyDocuments(await documentDb());
  const rows = res.ok ? libraryRows(res.data) : [];
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <PageHeader title="Belgelerim" description="Notların, denemelerin ve raporların tek listede." />
      {rows.length === 0 ? (
        <EmptyState title="Henüz belgen yok">
          {'Koçtan bir not istediğinde ya da bir denemeyi yüklediğinde belgen burada PDF olarak durur; sayfa sayfa açar, indirir ya da paylaşırsın.'}
        </EmptyState>
      ) : (
        <div className="rounded-lg border border-line bg-surface-raised px-5 pb-1 [&_li:first-child]:border-t-0">
          <LibraryList rows={rows} />
        </div>
      )}
    </div>
  );
}
