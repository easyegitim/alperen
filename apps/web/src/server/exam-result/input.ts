// Sunucu eylemi girdi doğrulaması (saf; tarayıcıdan gelen her şey güvenilmez).
import { isUuid, parseSubmitInput, type SubmittedFile, type ParseResult } from '@/server/uploads/shared';

export const EXAM_MAX_PAGES = 40;
export const HOW_FAR_MAX_PHOTOS = 4;
export const HOW_FAR_MAX_CHARS = 2000;

/** Okul denemesi gönderimi: Yükle ile aynı dosya kuralları (yol sahibin klasöründe, tür/bayt sınırı), kind okul denemesi. */
export function parseExamSubmit(raw: unknown, ownerId: string): ParseResult<{ files: SubmittedFile[] }> {
  const files = raw && typeof raw === 'object' ? (raw as { files?: unknown }).files : null;
  const parsed = parseSubmitInput({ kind: 'school_exam', files }, ownerId);
  return parsed.ok ? { ok: true, value: { files: parsed.value.files } } : parsed;
}

export interface HowFarInput {
  sessionId: string;
  responseId: string;
  text: string | null;
  files: SubmittedFile[];
}

/** Nereye kadar geldim: yazı (≤ 2000) ve/veya ≤ 4 fotoğraf (PDF değil). */
export function parseHowFarInput(raw: unknown, ownerId: string): ParseResult<HowFarInput> {
  const bad = (error: string): ParseResult<HowFarInput> => ({ ok: false, error });
  if (!raw || typeof raw !== 'object') return bad('Gönderim okunamadı.');
  const r = raw as { sessionId?: unknown; responseId?: unknown; text?: unknown; files?: unknown };
  if (!isUuid(r.sessionId) || !isUuid(r.responseId)) return bad('Soru bulunamadı.');
  const text = typeof r.text === 'string' && r.text.trim() !== '' ? r.text.trim() : null;
  if (text && text.length > HOW_FAR_MAX_CHARS) return bad(`En çok ${HOW_FAR_MAX_CHARS} karakter yazabilirsin.`);
  const list = Array.isArray(r.files) ? r.files : [];
  if (list.length > HOW_FAR_MAX_PHOTOS) return bad(`En çok ${HOW_FAR_MAX_PHOTOS} fotoğraf gönderebilirsin.`);
  let files: SubmittedFile[] = [];
  if (list.length > 0) {
    const parsed = parseSubmitInput({ kind: 'own_work', files: list }, ownerId);
    if (!parsed.ok) return parsed;
    if (parsed.value.files.some((f) => f.mime !== 'image/jpeg')) return bad('Yalnız fotoğraf gönderebilirsin.');
    files = parsed.value.files;
  }
  if (!text && files.length === 0) return bad('Bir şeyler yaz ya da fotoğraf ekle.');
  return { ok: true, value: { sessionId: r.sessionId, responseId: r.responseId, text, files } };
}

