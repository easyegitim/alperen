import { NextResponse } from 'next/server';
import { getCurrentProfile } from '@/server/auth';
import { loadLessons } from '@/server/lessons/read';
import { isWorking } from '@/server/lessons/shared';

export const dynamic = 'force-dynamic';

/** Liste ilerlemesinin yoklaması (`useLive`): dersler işlenirken aşama değişimini bildirir; `done` hepsi bitince true. */
export async function GET() {
  const current = await getCurrentProfile();
  const role = current?.profile?.role;
  if (!current || (role !== 'instructor' && role !== 'admin')) return NextResponse.json({ error: 'yetki yok' }, { status: 401 });
  const r = await loadLessons();
  if (!r.ok) return NextResponse.json({ error: 'okunamadı' }, { status: 502 });
  const rows = r.rows.map((l) => ({ id: l.id, status: l.status, stage: l.stage, error: l.error ?? null, transcript_ready: l.transcript_ready, working: isWorking(l.status, l.stage) }));
  return NextResponse.json({ rows, done: !rows.some((x) => x.working) }, { headers: { 'cache-control': 'no-store' } });
}
