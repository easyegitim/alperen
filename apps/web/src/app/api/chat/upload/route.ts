import { assertBodySize, assertSameOrigin, UPLOAD_BODY_MAX, uploadKindFor } from '@/server/chat/request';
import { chatSession, errorResponse } from '@/server/chat/session';
import { ChatError } from '@/server/chat/turn';

// Koç eki: multipart `file` (+ isteğe bağlı `width`, `height`) → Storage `uploads` kovası + `uploads` satırı (RLS).
// Tür istemcinin bildirdiğinden değil dosyanın ilk baytlarından çözülür; tanınmayan tür 415.
// Gövde boyu `formData()` gövdeyi belleğe almadan önce Content-Length'ten denetlenir (yoksa 411, aşarsa 413);
// sınır proxy'nin gövde sınırının (proxyClientMaxBodySize, 10 MB) altındadır, kesilmiş gövde buraya ulaşmaz.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertBodySize(request, UPLOAD_BODY_MAX, 'Dosya çok büyük (fotoğraf en çok 3,75 MB, PDF en çok 4 MB).', { required: true });
    const { deps, student } = await chatSession();
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') throw new ChatError('no_file', 400, 'Dosya seçilmedi.');
    const data = new Uint8Array(await file.arrayBuffer());
    const { kind, mime } = uploadKindFor(data);
    const num = (k: string) => {
      const v = Number(form?.get(k));
      return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
    };
    const row = await deps.store.saveUpload(student, { mime, kind, data, width: num('width'), height: num('height') });
    return Response.json({ id: row.id, kind: row.kind }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
