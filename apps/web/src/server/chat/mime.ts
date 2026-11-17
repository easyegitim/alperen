/**
 * Dosya türü baytlardan çözülür (istemcinin bildirdiği `file.type` ya da saklanan `uploads.mime` güvenilmez). Yalnız
 * koçun kabul ettiği türler tanınır; gerisi null. Görsel türleri Anthropic görsel bloğunun kabul ettikleridir.
 */

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];
export type SniffedMime = ImageMime | 'application/pdf';

export function isImageMime(v: unknown): v is ImageMime {
  return typeof v === 'string' && (IMAGE_MIMES as readonly string[]).includes(v);
}

function startsWith(b: Uint8Array, sig: readonly number[], at = 0): boolean {
  if (b.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false;
  return true;
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** İlk baytlara göre tür: FF D8 FF → jpeg, 89 50 4E 47 → png, RIFF…WEBP → webp, GIF8 → gif, %PDF- → pdf. */
export function sniffMime(b: Uint8Array): SniffedMime | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(b, ascii('%PDF-'))) return 'application/pdf';
  return null;
}

/**
 * PDF sayfa sayısı (yaklaşık): `/Type /Page` nesneleri sayılır. Sayfa ağacı sıkıştırılmış nesne akışındaysa 0
 * dönebilir (o zaman sınır bayt üzerinden uygulanır).
 */
export function pdfPageCount(b: Uint8Array): number {
  const text = Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('latin1');
  return (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}
