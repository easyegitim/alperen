import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import { ExamRunnerLoader } from '@/components/exam/ExamRunnerLoader';
import { requireRole } from '@/server/auth';
import { isUuid } from '@/server/practice/rpc';
import { examDb } from '@/server/exam/client';
import { loadQuestions, loadSession } from '@/server/exam/load';
import { examPlayHref, examResultHref } from '@/server/exam/routes';
import { startExam } from '@/server/exam/rpc';

export const metadata: Metadata = { title: 'Deneme' };

// Sınav oynatıcısı: oturum satırı → durum (bitmişse sonuç ekranına) → start_exam_session (süren oturumu döner; sunucu
// saati ve bitiş sınırı) → sorular (v_exam_questions_student; doğru cevap yok) → ExamRunner.
export default async function SinavOturumu({ params }: { params: Promise<{ exam: string; session: string }> }) {
  const { user } = await requireRole('student', 'admin');
  const { exam: examId, session: sessionId } = await params;
  if (!isUuid(examId) || !isUuid(sessionId)) notFound();
  const session = await loadSession(sessionId);
  if (!session || session.exam_id !== examId) notFound();
  if (session.status !== 'in_progress') redirect(examResultHref(sessionId));

  const res = await startExam(await examDb(), examId);
  if (!res.ok) {
    return (
      <EmptyState title="Sınavı açamadım" action={<LinkButton href="/ogrenci">Bugün’e dön</LinkButton>}>
        {'Bağlantını kontrol edip yeniden dene.'}
      </EmptyState>
    );
  }
  const state = res.data;
  if (state.status !== 'in_progress') redirect(examResultHref(state.session_id));
  if (state.session_id !== sessionId) redirect(examPlayHref(examId, state.session_id));

  const items = await loadQuestions(examId);
  if (items.length === 0) {
    return (
      <EmptyState title="Bu denemenin soruları yok" action={<LinkButton href="/ogrenci">Bugün’e dön</LinkButton>}>
        {'Eğitmenine haber ver.'}
      </EmptyState>
    );
  }
  const byNo = new Map(items.map((i) => [i.no, i.questionId]));
  const answers = state.answers.flatMap((a) => {
    const questionId = byNo.get(a.no) ?? a.exam_question_id;
    return [{ questionId, answer: a.answer ?? null, flagged: a.flagged, hasWork: a.has_work }];
  });
  return (
    <ExamRunnerLoader
      sessionId={sessionId}
      title={state.title}
      ownerId={user.id}
      items={items}
      deadlineAt={state.deadline_at ?? null}
      serverNow={state.server_now}
      expired={state.expired}
      answers={answers}
    />
  );
}
