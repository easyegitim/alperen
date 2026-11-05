import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { ArchiveUploadPanel } from '@/components/styles/ArchiveUpload';
import { PriorityBlock } from '@/components/styles/PriorityBlock';
import { StyleLibrary } from '@/components/styles/StyleLibrary';
import { LinkButton } from '@/components/LinkButton';
import { requireRole } from '@/server/auth';
import { isUuid } from '@/server/practice/rpc';
import { listCourses, loadLibrary } from '@/server/styles/read';
import { archiveLine, STYLE_ERRORS } from '@/server/styles/shared';
import { addStyle, computePlan, decidePlan, ingestExamSource, mergeStyles, requestStyleQuestions, saveStyle } from './actions';

export const metadata: Metadata = { title: 'Soru tarzları' };

const ACTIONS = { save: saveStyle, add: addStyle, merge: mergeStyles, generate: requestStyleQuestions };

// Soru tarzları (mockup S13; PLAN-v2 §11): çıkmış sınavlar tarzlara ayrılır; eğitmen adlandırır, birleştirir, ekler;
// üstte "Sıklık analizine göre öncelikler". Okuma ve yazma style_library_view / *_styles RPC'leriyle, kullanıcının JWT'siyle.
export default async function Sayfa({ searchParams }: { searchParams: Promise<{ course?: string | string[]; yukle?: string }> }) {
  const { user } = await requireRole('instructor', 'admin');
  const sp = await searchParams;
  const courses = await listCourses();
  const asked = typeof sp.course === 'string' && isUuid(sp.course) ? sp.course : null;
  const course = courses.find((c) => c.id === asked) ?? courses[0] ?? null;
  if (!course) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader title="Soru tarzları" description="Çıkmış sorulardan çıkarılan tarz kütüphanesi." />
        <EmptyState title="Henüz ders yok">{'Bir ders eklendiğinde çıkmış sınavlarını burada yükleyip soru tarzlarına ayırırsın.'}</EmptyState>
      </div>
    );
  }
  const lib = await loadLibrary(course.id);
  const picker =
    courses.length > 1 ? (
      <nav aria-label="Ders" className="flex flex-wrap gap-2">
        {courses.map((c) => (
          <LinkButton key={c.id} href={`/egitmen/soru-tarzlari?course=${c.id}`} aria-current={c.id === course.id ? 'page' : undefined} variant={c.id === course.id ? 'primary' : 'secondary'}>
            {c.title}
          </LinkButton>
        ))}
      </nav>
    ) : null;

  if (!lib.ok) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader title={`Soru tarzları · ${course.title}`} />
        {picker}
        <EmptyState title="Tarz kütüphanesi açılamadı">{(lib.code && STYLE_ERRORS[lib.code]) || 'Biraz sonra yeniden dene.'}</EmptyState>
      </div>
    );
  }
  const v = lib.view;
  const empty = v.archive.sources === 0 && v.styles.length === 0;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6" data-testid="tarzlar">
      <PageHeader title={`Soru tarzları · ${v.course.title}`} description={archiveLine(v)} />
      {picker}
      {v.can_manage ? (
        <ArchiveUploadPanel open={empty || sp.yukle === '1'} courseId={v.course.id} ownerId={user.id} ingest={ingestExamSource} />
      ) : null}
      <PriorityBlock courseId={v.course.id} plan={v.plan} styles={v.styles} canManage={v.can_manage} yearsTotal={v.archive.years_total} compute={computePlan} decide={decidePlan} />
      <StyleLibrary courseId={v.course.id} styles={v.styles} canManage={v.can_manage} pendingSources={v.archive.pending_sources} actions={ACTIONS} />
    </div>
  );
}
