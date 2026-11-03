import type { Metadata } from 'next';
import { ChevronLeft } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import { PageHeader } from '@/components/PageHeader';
import { MemoryFileCard, Notice } from '@/ds';
import { formatDateTimeTr } from '@/lib/format';
import { memorySortKey, memoryTitle } from '@/lib/memory';
import { requireRole } from '@/server/auth';
import { getMyStudent, listMemoryFiles } from '@/server/queries';

export const metadata: Metadata = { title: 'Hafıza' };

export default async function HafizaSayfasi() {
  const { user } = await requireRole('student', 'admin');
  const student = await getMyStudent(user.id);
  const files = student ? await listMemoryFiles(student.id) : [];
  const sorted = [...files].sort((a, b) => memorySortKey(a.path).localeCompare(memorySortKey(b.path)));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <LinkButton href="/ogrenci/profil" variant="quiet" size="sm" icon={<ChevronLeft size={16} />}>
          Profil
        </LinkButton>
      </div>
      <PageHeader title="Hafıza" description="Öğretmenin seni tanımak için tuttuğu notlar. Bunları öğretmen yazar; sen okur, yanlış bulduğunu düzelttirirsin." />
      <Notice tone="legal" title="Bu notlar yapay zekâ tarafından yazılır">
        Her not, derslerde ve sorularda gördüklerinden çıkarılır. Emin olmadığı şeyi yazmaz; yanlış bir şey görürsen eğitmenine söyle.
      </Notice>

      {sorted.length === 0 ? (
        <EmptyState title="Öğretmenin henüz sana dair not tutmadı">
          {'İlk derslerini ve sorularını çözdükçe öğretmen nasıl öğrendiğini, hangi hataları tekrarladığını ve neyin işe yaradığını kısa notlar halinde yazar. Notlar burada dosya kartları olarak listelenir.'}
        </EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-4 p-0" aria-label="Hafıza dosyaları">
          {sorted.map((f) => (
            <li key={f.path}>
              <MemoryFileCard path={f.path} title={memoryTitle(f.path)} content={f.content} bytes={f.bytes} updatedAt={formatDateTimeTr(f.updated_at)} className="max-w-none" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
