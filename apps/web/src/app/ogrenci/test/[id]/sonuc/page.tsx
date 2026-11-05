import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import { OneLineResult } from '@/components/result';
import { requireRole } from '@/server/auth';
import { studentDb } from '@/server/practice/client';
import { resultView } from '@/server/practice/present';
import { isUuid } from '@/server/practice/rpc';
import { finishPractice, getPracticeSet } from '@/server/practice/service';

export const metadata: Metadata = { title: 'Sonuç' };

// Alıştırma sonucu (mockup S05): skor, noktalar, tek cümle, "Neyi öğrendik"; Detay (katlı) en sık yanılgının
// açıklaması ve konu başına doğru sayısı; Devam et → Bugün. Tüm sorular cevaplandığı hâlde set hâlâ açıksa
// finish_practice burada da çağrılır (oynatıcının bitiş çağrısı yarıda kaldıysa; idempotent); yanıtsız soru varsa teste döner.
export default async function AlistirmaSonucu({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('student', 'admin');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = await studentDb();
  const res = await getPracticeSet(db, id);
  if (!res.ok) {
    if (res.code === 'OGR-PRAC-001') notFound();
    return <EmptyState title="Sonucu açamadım" action={<LinkButton href="/ogrenci">Bugün’e dön</LinkButton>} />;
  }
  let set = res.data;
  if (set.status === 'needs_generation') redirect(`/ogrenci/test/${id}`);
  let summary = set.summary ?? null;
  if (set.status === 'in_progress' || !summary) {
    // GET yan etkisiz: yanıtsız soru kaldıysa set bitirilmez, teste dönülür (bitirme yalnız oynatıcının bitiş eyleminde)
    if (set.answered === 0 || (set.status === 'in_progress' && set.answered < set.total)) redirect(`/ogrenci/test/${id}`);
    const fin = await finishPractice(db, id);
    if (!fin.ok) return <EmptyState title="Sonucu açamadım" action={<LinkButton href="/ogrenci">Bugün’e dön</LinkButton>} />;
    summary = fin.data;
    const again = await getPracticeSet(db, id);
    if (again.ok) set = again.data;
  }
  const v = resultView(summary, set.items);
  const detail =
    v.detail.misconception || v.detail.skills.length > 0 ? (
      <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface-raised px-5 py-4">
        {v.detail.misconception ? (
          <div className="flex flex-col gap-1">
            <p className="text-caption m-0 text-ink-muted">En sık yanılgı</p>
            <p className="text-body m-0 text-ink" data-testid="yanilgi">
              {`Bu sette ${v.detail.misconception.count} soruda bu kurala takıldın.`}
            </p>
          </div>
        ) : null}
        {v.detail.skills.length > 0 ? (
          <ul aria-label="Konular" className="m-0 flex list-none flex-col p-0">
            {v.detail.skills.map((s) => (
              <li key={s.name} className="text-small flex min-h-11 items-center justify-between gap-3 border-t border-line first:border-t-0">
                <span className="text-ink">{s.name}</span>
                <span className="shrink-0 text-ink-muted">{s.line}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    ) : null;
  return (
    <OneLineResult
      score={{ correct: v.correct, total: v.total, label: v.scoreLabel }}
      dots={v.dots}
      sentence={v.sentence}
      learned={v.learned}
      primary={{ href: '/ogrenci', label: 'Devam et' }}
      detail={detail}
      coachHref={`/ogrenci/koc`}
    />
  );
}
