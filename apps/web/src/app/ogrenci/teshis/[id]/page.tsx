import type { Metadata } from 'next';
import Link from 'next/link';
import { X } from 'lucide-react';
import { LinkButton } from '@/components/LinkButton';
import { EmptyState } from '@/components/EmptyState';
import { MathText } from '@/ds';
import { requireRole } from '@/server/auth';
import { coachHref, ladderRows } from '@/server/diagnosis/present';
import { getDiagnosis } from '@/server/diagnosis/read';
import { uploadClient } from '@/server/uploads/client';
import { AdimMerdiveni } from './adim-merdiveni';

export const metadata: Metadata = { title: 'Detay' };

// Teşhis / Detay (mockup S06): soru, tek cümle (bozulan adım), katlı adım merdiveni, kazanım tek satır (kelime bandı),
// tek birincil düğme "Koça sor". Çipler, etiketler ve meta bilgi gösterilmez (PLAN-v2 §13).
export default async function TeshisSayfasi({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('student', 'admin');
  const { id } = await params;
  const d = await getDiagnosis(await uploadClient(), id);
  if (!d) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <EmptyState title="Bu teşhisi bulamadım" action={<LinkButton href="/ogrenci">Bugün’e dön</LinkButton>}>
          {'Bağlantı eski olabilir. Son sonuçların Bugün’de.'}
        </EmptyState>
      </div>
    );
  }
  const rows = ladderRows(d.analysis.steps, d.analysis.reference_steps, d.failingStepNo);
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-8">
      <header className="flex items-center justify-between">
        <h1 className="text-title-3 m-0 text-ink">Detay</h1>
        <Link href={`/ogrenci/sonuc?analiz=${d.id}`} aria-label="Kapat" className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken hover:text-ink">
          <X aria-hidden="true" size={22} strokeWidth={1.75} />
        </Link>
      </header>

      {d.questionText ? (
        <figure className="m-0 rounded-lg border border-line bg-surface-raised p-4">
          <figcaption className="sr-only">Soru</figcaption>
          <p className="text-body m-0 text-ink">
            <MathText>{d.questionText}</MathText>
          </p>
        </figure>
      ) : null}

      <p data-testid="neden" className="text-title-3 m-0 font-normal text-ink">
        <MathText>{d.analysis.why_tr ?? d.sentence}</MathText>
      </p>

      <AdimMerdiveni rows={rows} />

      {d.skill ? (
        <p data-testid="kazanim" className="text-small m-0 text-ink-muted">
          {d.skill.lowEvidence ? (
            <>Bu kazanım: {d.skill.name} · {d.skill.band}</>
          ) : (
            <>
              Bu kazanım: {d.skill.name} · şu an <span className="font-semibold text-ink">{d.skill.band}</span>
            </>
          )}
        </p>
      ) : null}

      <LinkButton href={coachHref(d.id)} variant="primary" size="lg" block>
        Koça sor
      </LinkButton>
    </div>
  );
}
