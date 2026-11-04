import type { Metadata } from 'next';
import { requireRole } from '@/server/auth';
import { DenemeSonucu } from './ekran';

export const metadata: Metadata = { title: 'Deneme sonucu' };

type Search = Promise<Record<string, string | string[] | undefined>>;

// Deneme sonucu (mockup S05): bekleme → büyük net + tek cümle → Detay (katlı) → rapor PDF'i.
export default async function DenemeSonucuSayfasi({ params, searchParams }: { params: Promise<{ session: string }>; searchParams: Search }) {
  await requireRole('student', 'admin');
  const { session } = await params;
  const sp = await searchParams;
  const detail = Array.isArray(sp.detay) ? sp.detay[0] : sp.detay;
  return <DenemeSonucu sessionId={session} detailOpen={detail === '1'} />;
}
