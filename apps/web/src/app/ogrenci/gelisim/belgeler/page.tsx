import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { requireRole } from '@/server/auth';
import { listDocuments, progressClient } from '@/server/progress/read';
import { studentContext } from '@/server/suggestions/student';
import { DocumentList } from '../parcalar';

export const metadata: Metadata = { title: 'Belgelerim' };

// Gelişim › Belgelerim: generated_documents'tan PDF'i hazır belgeler (not, deneme, rapor); satır PDF görüntüleyiciyi açar.
export default async function BelgelerimSayfasi() {
  const { user } = await requireRole('student', 'admin');
  const ctx = await studentContext(user.id);
  const documents = ctx ? await listDocuments(await progressClient(), ctx.studentId) : [];
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <PageHeader title="Belgelerim" description="Notların, denemelerin ve raporların tek listede." />
      {documents.length === 0 ? (
        <EmptyState title="Henüz belgen yok">
          {'Koçtan bir not istediğinde ya da bir denemeyi yüklediğinde belgen burada PDF olarak durur; sayfa sayfa açar, indirir ya da paylaşırsın.'}
        </EmptyState>
      ) : (
        <div className="rounded-lg border border-line bg-surface-raised px-5 pb-1 [&_li:first-child]:border-t-0">
          <DocumentList documents={documents} />
        </div>
      )}
    </div>
  );
}
