import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import mascot from '@ogrenmen/design-system/assets/Maskot/ogrenmen-maskot.webp';
import { requireRole } from '@/server/auth';
import { isUuid } from '@/server/practice/rpc';
import { draftDone } from '@/server/progress/present';
import { curriculumDraftState } from '@/server/progress/read';
import { Hazirlik } from './hazirlik';

export const metadata: Metadata = { title: 'Hazırlıyorum' };

type Search = Promise<Record<string, string | string[] | undefined>>;

// Onboarding sonrası (PLAN-v2 §13): müfredat ağacı arka planda kurulurken yalnız "Hazırlıyorum…". curricula satırı
// (draft_status/draft_progress, 0025) Realtime ile izlenir; Realtime yoksa yoklanır; bitince Bugün açılır.
export default async function HazirlikSayfasi({ searchParams }: { searchParams: Search }) {
  await requireRole('student', 'admin');
  const sp = await searchParams;
  const id = Array.isArray(sp.mufredat) ? sp.mufredat[0] : sp.mufredat;
  if (!isUuid(id)) redirect('/ogrenci');
  const state = await curriculumDraftState(id);
  if (draftDone(state)) redirect('/ogrenci');
  return (
    <div className="mx-auto flex min-h-[80dvh] w-full max-w-md flex-col items-center justify-center gap-6 text-center">
      <Image src={mascot} alt="" width={102} height={128} sizes="102px" className="h-32 w-auto" priority />
      <div className="flex flex-col gap-2">
        <h1 className="text-title-1 m-0 text-ink">Hazırlıyorum…</h1>
        <p className="text-body m-0 text-ink-muted">İlk testin birkaç saniyeye hazır.</p>
      </div>
      <Hazirlik curriculumId={id} initialProgress={state?.draft_progress ?? 0} />
    </div>
  );
}
