import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth';
import { uploadClient } from '@/server/uploads/client';
import { getUploadState } from '@/server/uploads/status';

// Bekleme ekranının yoklaması: GET /ogrenci/sonuc/durum?yukleme=<upload_id> → {state, analysisId?}. Kullanıcının
// JWT'siyle okunur (RLS); önbelleğe girmez.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ state: 'missing' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  const id = req.nextUrl.searchParams.get('yukleme') ?? '';
  const state = await getUploadState(await uploadClient(), id);
  return NextResponse.json(state, { headers: { 'cache-control': 'no-store' } });
}
