import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { ScreenHeader } from '@/components/shell';
import { Notice } from '@/ds';
import { firstName } from '@/lib/format';
import { requireRole } from '@/server/auth';
import { studentDb } from '@/server/practice/client';
import { findResumableSet } from '@/server/practice/resume';
import { practiceErrorMessage } from '@/server/practice/present';
import { curriculumDraftState, draftPracticable } from '@/server/progress/read';
import { draftDone } from '@/server/progress/present';
import { arrangeToday, boxLine, MAX_BOXES, KIND_LABELS, metaLine, noticeLine } from '@/server/suggestions/arrange';
import { listToday } from '@/server/suggestions/service';
import { studentContext } from '@/server/suggestions/student';
import { BoxCard, FirstPracticeCard, HeroCard, NoticeCard, ResumeCard } from './bugun/kartlar';

export const metadata: Metadata = { title: 'Bugün' };

type Search = Promise<Record<string, string | string[] | undefined>>;

// Bugün (mockup S02; PLAN-v2 §13): koçun önerisi tek kahraman kartta (tek birincil "Başla"), altında en çok 3 kutu,
// "+ yükle" bağlantısı ve belge/yükleme sonucu kartları. Öneri yoksa tek "İlk testine başla" ve arka planda yenileme;
// eğitmen onayı bekleyen taslakta düğmesiz tek cümle.
export default async function BugunSayfasi({ searchParams }: { searchParams: Search }) {
  const { user, displayName } = await requireRole('student', 'admin');
  const sp = await searchParams;
  const rawError = Array.isArray(sp.hata) ? sp.hata[0] : sp.hata;
  const name = firstName(displayName);
  const db = await studentDb();
  const res = await listToday(db);
  const arranged = arrangeToday(res.ok ? res.data : []);
  const ctx = await studentContext(user.id);
  // Yarım kalan test varsa kahraman o olur (başlatılan öneri tüketildiği için başka yoldan geri dönülemez); öneriler kutulara iner.
  const resume = ctx?.enrollment ? await findResumableSet(db, ctx.enrollment.id) : null;
  const today = resume ? { hero: null, boxes: [...(arranged.hero ? [arranged.hero] : []), ...arranged.boxes].slice(0, MAX_BOXES), notices: arranged.notices } : arranged;

  // Öneri yokken taslak sürüyorsa "Planın kuruluyor"; öneri yenilemesini onboarding_enroll/finish_practice zaten kuyruğa atar.
  // Taslak bitti ama otopilot kapalıysa (üniversite dersi) öğrenci eğitmen onayını bekler: düğme çizilmez (OGR-PRAC-008).
  let drafting = false;
  let awaitingApproval = false;
  if (!resume && !today.hero && ctx?.enrollment) {
    const state = await curriculumDraftState(ctx.enrollment.curriculum_id);
    drafting = !draftDone(state);
    if (!drafting && state?.status === 'draft') awaitingApproval = !(await draftPracticable(db, ctx.enrollment.curriculum_id));
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <ScreenHeader title={name ? `Merhaba ${name}` : 'Merhaba'} name={displayName} accountHref="/ogrenci/profil" />
      {rawError ? (
        <Notice tone="warning" live>
          {practiceErrorMessage(rawError)}
        </Notice>
      ) : null}

      {resume ? (
        <ResumeCard setId={resume.id} line={resume.preparing ? 'Soruların hazırlanıyor.' : `${resume.total} sorudan ${resume.answered} tanesini çözdün.`} />
      ) : today.hero ? (
        <HeroCard suggestionId={today.hero.id} title={today.hero.title} meta={metaLine(today.hero)} />
      ) : (
        <FirstPracticeCard drafting={drafting} awaitingApproval={awaitingApproval} />
      )}

      {today.boxes.length > 0 ? (
        <nav aria-label="Diğer çalışmalar">
          <ul className="m-0 grid list-none grid-cols-3 gap-3 p-0">
            {today.boxes.map((b) => (
              <BoxCard key={b.id} suggestionId={b.id} kind={b.kind} kindLabel={KIND_LABELS[b.kind]} title={b.title} line={boxLine(b)} />
            ))}
          </ul>
        </nav>
      ) : null}

      <div className="flex flex-col gap-4">
        <Link href="/ogrenci/yukle" className="text-label inline-flex min-h-11 items-center gap-2 self-start rounded-md text-primary no-underline">
          <Plus aria-hidden="true" size={20} strokeWidth={1.75} />
          Kendi çalışmanı veya okul denemeni yükle
        </Link>
        {today.notices.map((n) => (
          <NoticeCard key={n.id} suggestionId={n.id} kind={n.kind} title={n.title} line={noticeLine(n)} />
        ))}
      </div>
    </div>
  );
}
