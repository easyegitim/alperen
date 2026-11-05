// Orijinal dosyanın SHA-256'sı (CONTRACTS_V2 §2.3 set önbelleği, KB Ç11). Saf; WebCrypto (tarayıcı ve Node 20).
// Hash kişisel veri sayılır ve aydınlatma metninde geçer; dosyanın kendisi hiçbir yere gitmez.

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  // Kopya: SharedArrayBuffer destekli görünümler BufferSource'a doğrudan verilemez (TS 5.7 tipleri).
  const buf = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data)).slice().buffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * sourceHashes yalnız bütün görseller orijinal dosyadan (galeri) geldiyse gönderilir: kamera çekimi yeni dosya üretir,
 * hash'i hiçbir sete eşleşmez (KB sınırı). Sıra images[] ile aynıdır.
 */
export function sourceHashesFor(hashes: readonly (string | null)[]): string[] | null {
  if (hashes.length === 0 || hashes.some((h) => h === null || !SHA256_HEX_RE.test(h))) return null;
  return hashes as string[];
}
