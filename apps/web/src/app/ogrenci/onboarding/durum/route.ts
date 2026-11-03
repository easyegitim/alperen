import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth';
import { isUuid } from '@/server/practice/rpc';
import { draftDone } from '@/server/progress/present';
import { curriculumDraftState } from '@/server/progress/read';

export const dynamic = 'force-dynamic';

/** "Hazırlıyorum…" yoklaması: {done, progress}. Kullanıcının JWT'siyle (RLS: kendi kaydının müfredatı). */
export async function GET(req: Request): Promise<NextResponse> {
  if (!(await getCurrentUser())) return NextResponse.json({ error: 'oturum yok' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('mufredat');
  if (!isUuid(id)) return NextResponse.json({ error: 'mufredat geçersiz' }, { status: 400 });
  const s = await curriculumDraftState(id);
  return NextResponse.json({ done: draftDone(s), progress: s?.draft_progress ?? 100 }, { headers: { 'cache-control': 'no-store' } });
}
