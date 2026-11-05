import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth';
import { documentRequestView } from '@/server/documents/request';
import { studentDb } from '@/server/practice/client';
import { isUuid } from '@/server/practice/rpc';
import { phaseOf, statusWord } from '@/server/documents/status';

// Koç sohbetindeki belge kartının yoklaması: GET /ogrenci/koc/belge-durum?istek=<request_id> →
// {phase, word, documentId, examId}. document_request_view RPC'si kullanıcının JWT'siyle (RLS); önbelleğe girmez.
export const dynamic = 'force-dynamic';
const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ phase: 'missing' }, { status: 401, headers: NO_STORE });
  const id = req.nextUrl.searchParams.get('istek');
  if (!isUuid(id)) return NextResponse.json({ phase: 'missing' }, { status: 400, headers: NO_STORE });
  const res = await documentRequestView(await studentDb(), id);
  if (!res.ok) return NextResponse.json({ phase: 'missing' }, { status: res.code === 'OGR-AUTH-001' ? 403 : 502, headers: NO_STORE });
  const v = res.data;
  const phase = phaseOf(v.status);
  return NextResponse.json(
    { phase, word: statusWord(v.status), kind: v.kind, documentId: phase === 'ready' ? (v.document?.id ?? null) : null, examId: v.exam_id ?? null },
    { headers: NO_STORE },
  );
}
