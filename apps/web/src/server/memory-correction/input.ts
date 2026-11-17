// Hafıza düzeltme isteği girdisi (saf; tarayıcıdan gelen her şey güvenilmez). RPC (0023 request_memory_correction)
// metni 1–1000 karakterle sınırlar; ekran daha kısa tutar.

export const CORRECTION_MAX_CHARS = 500;
/** Varsayılan dosya: koç tüm düzenlenebilir dosyaları görür, yol yalnız ipucudur. */
export const CORRECTION_DEFAULT_PATH = '/memories/profile.md';
const PATH_RE = /^\/memories\/(profile\.md|goals\.md|patterns\.md|coach_notes\.md|courses\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.md)$/;

export type CorrectionInput = { path: string; text: string };
export type CorrectionParse = { ok: true; value: CorrectionInput } | { ok: false; error: string };

export function parseCorrectionInput(raw: unknown): CorrectionParse {
  const r = raw && typeof raw === 'object' ? (raw as { text?: unknown; path?: unknown }) : {};
  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (text === '') return { ok: false, error: 'Neyin yanlış ya da eksik olduğunu kısaca yaz.' };
  if (text.length > CORRECTION_MAX_CHARS) return { ok: false, error: `En çok ${CORRECTION_MAX_CHARS} karakter yazabilirsin.` };
  const path = typeof r.path === 'string' && PATH_RE.test(r.path) ? r.path : CORRECTION_DEFAULT_PATH;
  return { ok: true, value: { path, text } };
}

/** RPC hata kodu → öğrenciye görünen sakin metin. */
export function correctionError(code: string | null): string {
  if (code === 'OGR-MEM-009') return 'Bekleyen isteklerin çok; önce onlar işlensin, sonra yeniden dene.';
  if (code === 'OGR-AUTH-001') return 'Düzeltmeyi yalnız öğrencinin kendisi isteyebilir.';
  return 'İsteğin gönderilemedi. Biraz sonra yeniden dene.';
}

export const CORRECTION_STATUS_LABEL = { open: 'Bekliyor', applied: 'Güncellendi', rejected: 'Değişmedi' } as const;
