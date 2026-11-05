import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import { Notice } from '@/ds';
import { requireRole } from '@/server/auth';
import { isUuid } from '@/server/practice/rpc';
import { loadExam, loadOpenSession } from '@/server/exam/load';
import { introLine } from '@/server/exam/present';
import { examErrorMessage } from '@/server/exam/rpc';
import { Baslat } from './baslat';

export const metadata: Metadata = { title: 'Deneme' };

type Search = Promise<Record<string, string | string[] | undefined>>;

// Deneme girişi (mockup S04 sadeliği): başlık, "40 soru · 75 dk" ve tek birincil düğme. Süre "Başla"ya basınca
// sunucuda başlar (start_exam_session); süren oturum varsa düğme "Devam et" olur ve kaldığı oturuma gider.
export default async function SinavGirisi({ params, searchParams }: { params: Promise<{ exam: string }>; searchParams: Search }) {
  await requireRole('student', 'admin');
  const { exam: examId } = await params;
  if (!isUuid(examId)) notFound();
  const sp = await searchParams;
  const rawError = Array.isArray(sp.hata) ? sp.hata[0] : sp.hata;
  const rawSug = Array.isArray(sp.oneri) ? sp.oneri[0] : sp.oneri;
  const exam = await loadExam(examId);
  if (!exam) notFound();
  const ready = exam.status === 'ready' || exam.status === 'published';
  if (!ready) {
    return (
      <EmptyState title="Bu deneme henüz hazır değil" action={<LinkButton href="/ogrenci">Bugün’e dön</LinkButton>}>
        {'Hazır olunca Bugün ekranında görünür.'}
      </EmptyState>
    );
  }
  const open = await loadOpenSession(examId);
  return (
    <section className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col justify-center gap-8" data-testid="sinav-giris">
      <div className="flex flex-col gap-2">
        <p className="text-small m-0 font-medium text-primary">Deneme</p>
        <h1 className="text-title-1 m-0 text-ink">{exam.title}</h1>
        <p className="text-body m-0 text-ink-muted">{introLine(exam.question_count ?? 0, exam.duration_min)}</p>
        <p className="text-body m-0 text-ink-muted">{open ? 'Yarım kalan oturumun var; süre devam ediyor.' : 'Süre Başla’ya basınca başlar. İstediğin soruya dönebilirsin.'}</p>
      </div>
      {rawError ? (
        <Notice tone="warning" live>
          {examErrorMessage(rawError)}
        </Notice>
      ) : null}
      <div className="flex flex-col gap-3">
        <Baslat examId={examId} label={open ? 'Devam et' : 'Başla'} suggestionId={isUuid(rawSug) ? rawSug : undefined} />
        <LinkButton href="/ogrenci" variant="quiet" size="lg">
          Bugün’e dön
        </LinkButton>
      </div>
    </section>
  );
}
