import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth';
import { documentDb } from '@/server/documents/read';
import { reportPending, reportReady, screenOf } from '@/server/exam-result/present';
import { examSessionView } from '@/server/exam-result/rpc';
import { isUuid } from '@/server/practice/rpc';

// Bekleme ekranının yoklaması: GET /ogrenci/deneme/<oturum>/durum → {screen, progress, report, pendingItems}. Kullanıcının JWT'siyle
// okunur (RLS); önbelleğe girmez. Cevap anahtarı ve soru içeriği taşımaz.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ session: string }> }) {
  const headers = { 'cache-control': 'no-store' };
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ screen: 'missing' }, { status: 401, headers });
  const { session } = await ctx.params;
  if (!isUuid(session)) return NextResponse.json({ screen: 'missing' }, { status: 404, headers });
  const res = await examSessionView(await documentDb(), session);
  if (!res.ok) return NextResponse.json({ screen: 'missing' }, { status: res.code === '42501' ? 403 : 404, headers });
  const v = res.data;
  return NextResponse.json({ screen: screenOf(v), progress: v.progress ?? null, report: reportReady(v) ? 'ready' : reportPending(v) ? 'pending' : 'none', pendingItems: v.items.filter((i) => i.state === 'pending').length }, { headers });
}
