import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import mascot from '@ogrenmen/design-system/assets/Maskot/ogrenmen-maskot.webp';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import { getPublicEnv } from '@/lib/env';
import { requireRole } from '@/server/auth';
import { studentDb } from '@/server/practice/client';
import { playerItems } from '@/server/practice/present';
import { isUuid } from '@/server/practice/rpc';
import { getPracticeSet, isClosed } from '@/server/practice/service';
import { Player } from './oyuncu';
import { waitedTooLong } from '@/server/practice/wait';
import { Yenile } from './yenile';

export const metadata: Metadata = { title: 'Test' };

// Test (mockup S04): get_practice_set → oynatıcı. Set bitmişse sonuç ekranına; soru bankası boşsa
// (needs_generation: start_practice practice.generate işini kuyruğa attı) sade bekleme: maskot + "Soruları
// hazırlıyorum…", 2 sn yoklama; 60 sn'yi geçerse "Biraz uzun sürdü, Koç'a sorabilirsin" ve Bugün'e dön.
export default async function TestSayfasi({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('student', 'admin');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const res = await getPracticeSet(await studentDb(), id);
  if (!res.ok) {
    if (res.code === 'OGR-PRAC-001') notFound();
    return (
      <EmptyState title="Testi açamadım" action={<LinkButton href="/ogrenci">Bugün’e dön</LinkButton>}>
        {'Bağlantını kontrol edip yeniden dene.'}
      </EmptyState>
    );
  }
  const set = res.data;
  // Üretim düştüyse (generation_failed: zaman aşımı ya da kalıcı hata) soru gelmez: sonuç ekranı yerine sade not
  if (set.total === 0 && (set.generation_failed || set.status === 'abandoned')) return <Hazirlaniyor startedAt={set.started_at} failed />;
  if (isClosed(set)) redirect(`/ogrenci/test/${id}/sonuc`);
  if (set.status === 'needs_generation' || set.items.length === 0) return <Hazirlaniyor startedAt={set.started_at} />;
  return <Player setId={set.set_id} items={playerItems(set, getPublicEnv().supabaseUrl)} />;
}

/** Sade bekleme (tek odak): maskot, başlık, kendiliğinden yenileme notu; üretim düştüyse ya da uzun sürdüyse Koç önerisi. */
function Hazirlaniyor({ startedAt, failed = false }: { startedAt: string | null | undefined; failed?: boolean }) {
  const slow = failed || waitedTooLong(startedAt);
  return (
    <section
      aria-live="polite"
      aria-busy={!slow}
      className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col items-center justify-center gap-6 text-center"
      data-testid="soru-hazirlaniyor"
    >
      <Image src={mascot} alt="" width={102} height={128} sizes="102px" className={`h-32 w-auto${slow ? '' : ' motion-safe:animate-pulse'}`} priority />
      <h1 className="text-title-2 m-0 text-ink">{failed ? 'Bu konu için soru hazırlayamadım' : 'Soruları hazırlıyorum…'}</h1>
      {failed ? (
        <>
          <p className="text-body m-0 max-w-prose text-ink-muted" data-testid="hazirlaniyor-not">
            Biraz uzun sürdü, Koç’a sorabilirsin.
          </p>
          <LinkButton href="/ogrenci/koc" variant="secondary" size="lg">
            Koç’a sor
          </LinkButton>
        </>
      ) : (
        <Yenile startedAt={startedAt} slow={slow} />
      )}
      <LinkButton href="/ogrenci" variant="quiet" size="lg">
        Bugün’e dön
      </LinkButton>
    </section>
  );
}
