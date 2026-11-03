import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/ds';
import { requireRole } from '@/server/auth';
import { listCourses } from '@/server/queries';

export const metadata: Metadata = { title: 'Dersler' };

const KIND_LABELS: Record<string, string> = { exam_track: 'Sınav parkuru', school: 'Okul', university: 'Üniversite', other: 'Diğer' };

export default async function EgitmenDersler() {
  await requireRole('instructor', 'admin');
  const courses = await listCourses();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Dersler" description="Görebildiğin dersler. Ders ayrıntıları, kayıtlı öğrenciler ve ders kayıtları sonraki adımda bağlanacak." />
      {courses.length === 0 ? (
        <EmptyState title="Henüz ders yok">{'Ders açıldığında burada müfredatı, kayıtlı öğrencileri ve yüklenen ders kayıtlarını göreceksin.'}</EmptyState>
      ) : (
        <ul aria-label="Dersler" className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-4">
              <span className="text-label text-ink">{c.title}</span>
              <div className="flex items-center gap-2">
                <code className="font-mono text-caption text-ink-muted">{c.code}</code>
                <Badge tone="neutral">{KIND_LABELS[c.kind] ?? c.kind}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
