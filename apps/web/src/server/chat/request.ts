/** POST /api/chat gövdesi (zod; sınırlar sunucuda yeniden denetlenir). */
import { z } from 'zod';
import { CHAT_UPLOAD_LIMITS } from '@/lib/chat';
import { IMAGE_MIMES, isImageMime, pdfPageCount, sniffMime, type SniffedMime } from './mime';
import { ChatError, MAX_TEXT_CHARS, MAX_UPLOADS } from './turn';
import type { CoachMode } from './types';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const chatRequestSchema = z.object({
  conversation_id: uuid.nullable().optional(),
  text: z.string().max(MAX_TEXT_CHARS).default(''),
  upload_ids: z.array(uuid).max(MAX_UPLOADS).default([]),
  mode: z.enum(['hint', 'explain', 'solve']).nullable().optional(),
  seed: uuid.nullable().optional(),
});

export interface ChatRequestBody {
  conversationId: string | null;
  text: string;
  uploadIds: string[];
  mode: CoachMode | null;
  seedId: string | null;
}

export function parseChatRequest(raw: unknown): ChatRequestBody {
  const r = chatRequestSchema.safeParse(raw);
  if (!r.success) {
    const tooLong = r.error.issues.some((i) => i.path[0] === 'text' && i.code === 'too_big');
    const tooMany = r.error.issues.some((i) => i.path[0] === 'upload_ids' && i.code === 'too_big');
    if (tooLong) throw new ChatError('text_too_long', 400, 'Mesaj çok uzun. Daha kısa yazmayı dene.');
    if (tooMany) throw new ChatError('too_many_uploads', 400, `Bir mesaja en çok ${MAX_UPLOADS} ek konabilir.`);
    throw new ChatError('bad_request', 400, 'İstek anlaşılamadı.');
  }
  const v = r.data;
  return {
    conversationId: v.conversation_id ?? null,
    text: v.text,
    uploadIds: [...new Set(v.upload_ids)],
    mode: v.mode ?? null,
    seedId: v.seed ?? null,
  };
}

/** Yükleme sınırları (istemci de görseli uzun kenar ≤ 2576 px ve bu bayt sınırına sığacak biçimde küçültür). */
export const UPLOAD_LIMITS = {
  photoBytes: CHAT_UPLOAD_LIMITS.photoBytes,
  pdfBytes: CHAT_UPLOAD_LIMITS.pdfBytes,
  pdfPages: CHAT_UPLOAD_LIMITS.pdfPages,
  photoMimes: IMAGE_MIMES,
};

/**
 * Ekin türü baytlardan çözülür (`file.type` güvenilmez) ve sınırlar uygulanır. Dönen `mime` saklanır ve modele
 * `media_type` olarak gider.
 */
export function uploadKindFor(data: Uint8Array): { kind: 'photo' | 'pdf'; mime: SniffedMime } {
  const mime = sniffMime(data);
  if (mime === 'application/pdf') {
    if (data.byteLength > UPLOAD_LIMITS.pdfBytes) throw new ChatError('file_too_large', 413, 'PDF çok büyük (en çok 4 MB ve 100 sayfa).');
    if (pdfPageCount(data) > UPLOAD_LIMITS.pdfPages) throw new ChatError('file_too_large', 413, 'PDF çok uzun (en çok 100 sayfa).');
    return { kind: 'pdf', mime };
  }
  if (mime && isImageMime(mime)) {
    if (data.byteLength > UPLOAD_LIMITS.photoBytes) throw new ChatError('file_too_large', 413, 'Fotoğraf çok büyük. Daha küçük bir fotoğraf dene.');
    return { kind: 'photo', mime };
  }
  throw new ChatError('unsupported_file', 415, 'Yalnız fotoğraf (JPEG, PNG, WebP) ya da PDF ekleyebilirsin.');
}

/** Çok parçalı gövdenin dosya dışı payı (sınır satırları, alan başlıkları, width/height). */
export const UPLOAD_BODY_SLACK = 64 * 1024;
/** Yükleme isteğinin en büyük gövdesi: en büyük ek + pay. Ölçü gövde okunmadan Content-Length'ten alınır. */
export const UPLOAD_BODY_MAX = Math.max(UPLOAD_LIMITS.pdfBytes, UPLOAD_LIMITS.photoBytes) + UPLOAD_BODY_SLACK;
/** POST /api/chat gövdesinin üst sınırı (metin ≤ 4000 karakter + birkaç kimlik; UTF-8 en kötü durum + pay). */
export const CHAT_BODY_MAX = MAX_TEXT_CHARS * 4 + 4 * 1024;

/**
 * Gövde boyu, gövde belleğe alınmadan önce: sınırı aşarsa 413. `required` ise Content-Length'siz (parçalı aktarım)
 * gövde 411 olur. `formData()` gövdenin tamamını belleğe alır; sınır ondan önce uygulanmalı.
 */
export function assertBodySize(request: Request, max: number, tooLarge: string, opts: { required?: boolean } = {}): void {
  const raw = request.headers.get('content-length');
  const chunked = request.headers.get('transfer-encoding')?.toLowerCase().includes('chunked') ?? false;
  if (raw === null || chunked) {
    if (opts.required || chunked) throw new ChatError('length_required', 411, 'İstek anlaşılamadı. Yeniden dene.');
    return;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !/^\d+$/.test(raw.trim())) throw new ChatError('bad_request', 400, 'İstek anlaşılamadı.');
  if (n > max) throw new ChatError('file_too_large', 413, tooLarge);
}

function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * CSRF kapısı (rota işleyicileri sunucu eylemlerinin Origin denetimini almaz): Origin başlığı varsa ya
 * `NEXT_PUBLIC_SITE_URL`'in ya da isteğin kendi kökeninin (Host / X-Forwarded-Host) aynısı olmalı; değilse 403.
 * `Sec-Fetch-Site: cross-site` de reddedilir. Origin'siz istek (tarayıcı dışı) geçer; çerez yine SameSite=Lax'tır.
 */
export function assertSameOrigin(request: Request, env: Record<string, string | undefined> = process.env): void {
  const forbidden = () => new ChatError('forbidden_origin', 403, 'Bu istek kabul edilmedi.');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw forbidden();
  const origin = request.headers.get('origin');
  if (origin === null) return;
  if (origin === 'null') throw forbidden();
  const allowed = new Set<string>();
  const site = originOf(env.NEXT_PUBLIC_SITE_URL);
  if (site) allowed.add(site);
  const self = originOf(request.url);
  if (self) allowed.add(self);
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host');
  if (host) {
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || (self ? new URL(self).protocol.replace(':', '') : 'https');
    const fromHost = originOf(`${proto}://${host}`);
    if (fromHost) allowed.add(fromHost);
  }
  if (!allowed.has(originOf(origin) ?? '')) throw forbidden();
}

/** /api/chat yalnız JSON alır (text/plain gövde basit istek olarak CSRF'e açık kalırdı): değilse 415. */
export function assertJsonBody(request: Request): void {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') throw new ChatError('unsupported_media_type', 415, 'İstek anlaşılamadı.');
}
