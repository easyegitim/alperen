import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { LessonProgress } from '@/components/lessons/LessonProgress';
import { ReviewWorkspace } from '@/components/lessons/ReviewWorkspace';
import { requireRole } from '@/server/auth';
import { loadLesson } from '@/server/lessons/read';
import { formatDuration, formatHeld, isStalled, isUuid, lessonName } from '@/server/lessons/shared';
import { applyClaims, retryLesson, reviewClaim, setLessonOptions } from '../actions';

export const metadata: Metadata = { title: 'Ders' };

// Ders iddia incelemesi (P5-C, mockup S14): solda transkript, sağda iddialar; üstte eşik + "Dossier'e uygula" +
// "Öğrenciye görünür". Veriyi lesson_view verir (yetkiyi veritabanı denetler).
export default async function DersSayfasi({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('instructor', 'admin');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const r = await loadLesson(id);
  if (!r.ok) notFound();
  const { lesson } = r.view;
  const meta = [lesson.student?.name, lesson.course_title, formatHeld(lesson.held_at), formatDuration(lesson.duration_sec), lesson.instructor?.name ? `Eğitmen: ${lesson.instructor.name}` : null].filter(Boolean).join(' · ');
  const error = typeof lesson.progress.error === 'string' ? lesson.progress.error : null;
  // takılan ders (işçi son denemede öldü): 2 saattir ilerleme yazılmadıysa retry_lesson kabul eder (0040)
  const stalled = isStalled(lesson.status, lesson.progress);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/egitmen/dersler" className="text-small inline-flex min-h-9 w-fit items-center gap-1 text-primary no-underline">
          <ChevronLeft aria-hidden="true" size={16} /> Dersler
        </Link>
        <h1 className="text-title-2 m-0 text-ink">{lessonName(lesson)}</h1>
        <p className="text-small m-0 text-ink-muted">
          {meta}
          {r.view.transcript?.labeled ? ' · Konuşmacılar otomatik etiketlendi' : ''}
        </p>
      </div>
      <LessonProgress
        lessonId={lesson.id}
        status={lesson.status}
        stage={lesson.stage}
        error={error}
        transcriptReady={Boolean(r.view.transcript)}
        stalled={stalled}
        retry={lesson.can_manage ? retryLesson : undefined}
      />
      <ReviewWorkspace view={r.view} actions={{ review: reviewClaim, apply: applyClaims, options: setLessonOptions }} />
    </div>
  );
}
