import { isImageMime, sniffMime } from '@/server/chat/mime';
import { chatSession, errorResponse } from '@/server/chat/session';
import { ChatError } from '@/server/chat/turn';

// Sohbetteki ek küçük resmi: yalnız öğrencinin kendi yüklemesi (kimlik depoda öğrenciyle kapsanır).
// İçerik türü saklanan `uploads.mime`'dan değil baytlardan çözülür ve yalnız görsel/PDF satır içi sunulur; gerisi
// indirme olarak (octet-stream) gider. CSP sandbox her yanıtta: dosya uygulama kökeninde betik çalıştıramaz.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ChatError('bad_request', 400, 'Geçersiz ek.');
    const { deps, student } = await chatSession();
    const [row] = await deps.store.getUploads(student, [id]);
    const blob = row ? await deps.store.readUpload(student, row) : null;
    if (!row || !blob) throw new ChatError('upload_not_found', 404, 'Ek bulunamadı.');
    const sniffed = sniffMime(blob.data);
    const inline = sniffed !== null && (isImageMime(sniffed) || sniffed === 'application/pdf');
    return new Response(Buffer.from(blob.data), {
      headers: {
        'Content-Type': inline ? sniffed : 'application/octet-stream',
        ...(inline ? {} : { 'Content-Disposition': 'attachment' }),
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
