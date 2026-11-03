import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import { getPublicEnv } from '@/lib/env';
import { requireRole } from '@/server/auth';
import { studentDb } from '@/server/practice/client';
import { playerItems } from '@/server/practice/present';
import { isUuid } from '@/server/practice/rpc';
import { getPracticeSet, isClosed } from '@/server/practice/service';
import { Player } from './oyuncu';
import { Yenile } from './yenile';

export const metadata: Metadata = { title: 'Test' };

// Test (mockup S04): get_practice_set → oynatıcı. Set bitmişse sonuç ekranına; soru bankası boşsa
// (needs_generation: start_practice practice.generate işini kuyruğa attı) sade bekleme mesajı ve kendiliğinden yenileme.
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
  if (isClosed(set)) redirect(`/ogrenci/test/${id}/sonuc`);
  if (set.status === 'needs_generation' || set.items.length === 0) {
    return (
      <div className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col items-center justify-center gap-6 text-center" data-testid="soru-hazirlaniyor">
        <h1 className="text-title-2 m-0 text-ink">Bu konu için soruları hazırlıyorum</h1>
        <Yenile everyMs={5000} />
        <LinkButton href="/ogrenci" variant="quiet" size="lg">
          Bugün’e dön
        </LinkButton>
      </div>
    );
  }
  return <Player setId={set.set_id} items={playerItems(set, getPublicEnv().supabaseUrl)} />;
}
