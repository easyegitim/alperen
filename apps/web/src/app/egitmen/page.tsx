import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Avatar } from '@/ds';
import { GRADE_LABELS, GRADES } from '@/lib/validation';
import { requireRole } from '@/server/auth';
import { listInstructorStudents } from '@/server/queries';

export const metadata: Metadata = { title: 'Öğrenciler' };

export default async function EgitmenOgrenciler() {
  const { user } = await requireRole('instructor', 'admin');
  const students = await listInstructorStudents(user.id);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Öğrenciler" description="Sana bağlı öğrenciler. Satıra girince öğrencinin dossier'i açılacak." />
      {students.length === 0 ? (
        <EmptyState title="Sana bağlı öğrenci yok">
          {'Bir öğrenci seni eğitmeni olarak eklediğinde ya da easy ekibi bağlantı kurduğunda burada listelenir.'}
        </EmptyState>
      ) : (
        <ul aria-label="Öğrenciler" className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
          {students.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface-raised p-4">
              <Avatar name={s.name} variant="photo" size="md" />
              <div className="flex min-w-0 flex-col">
                <span className="text-label truncate text-ink">{s.name}</span>
                <span className="text-small text-ink-muted">{s.grade && (GRADES as readonly string[]).includes(s.grade) ? GRADE_LABELS[s.grade as (typeof GRADES)[number]] : 'Sınıf belirtilmedi'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
