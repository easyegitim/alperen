import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { LessonList } from '@/components/lessons/LessonList';
import { LessonUploadPanel } from '@/components/lessons/LessonUpload';
import { requireRole } from '@/server/auth';
import { listLessonTargets, loadLessons } from '@/server/lessons/read';
import { registerLesson } from './actions';

export const metadata: Metadata = { title: 'Dersler' };

// Dersler (P5-C, mockup S14): yüklenen ders kayıtları (yeni önce) ve "Ders yükle". Video/ses/transkript Storage'a TUS ile
// gider (≤ 5 GB, kaldığı yerden sürer); işlenirken aşama kelimeyle görünür; hazır olunca satır iddia incelemesine açılır.
export default async function EgitmenDersler({ searchParams }: { searchParams: Promise<{ yukle?: string }> }) {
  const { user, role } = await requireRole('instructor', 'admin');
  const sp = await searchParams;
  const [lessons, targets] = await Promise.all([loadLessons(), listLessonTargets(user.id, { admin: role === 'admin' })]);
  const open = sp.yukle === '1' || (lessons.ok && lessons.rows.length === 0);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Dersler" description="Ders kayıtların. Yüklenen kayıt yazıya çevrilir, konuşmacılar ayrılır ve öğrenciye dair çıkarımlar senin onayına gelir." />
      <LessonUploadPanel open={open} targets={targets} ownerId={user.id} register={registerLesson} />
      {!lessons.ok ? (
        <EmptyState title="Dersler şu an okunamadı">{'Biraz sonra yeniden dene.'}</EmptyState>
      ) : lessons.rows.length === 0 ? (
        <EmptyState title="Henüz ders yok">{'Bir ders kaydı yüklediğinde burada işleme durumunu ve iddia incelemesini göreceksin.'}</EmptyState>
      ) : (
        <LessonList rows={lessons.rows} />
      )}
    </div>
  );
}
