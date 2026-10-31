// questions.content_hash (§3.4 `text not null unique` — "stem+options normalize; aynı soru iki kez üretilmez").
// Normalleştirme content/tyt-matematik/templates/_common.py content_hash() ile birebir aynıdır:
//   " ".join(stem.split()).lower() + "|" + "|".join(f"{key}:{" ".join(text.split()).lower()}")
// Şıklar anahtara göre sıralanır (panel formu zaten A–D sırasıyla gönderir; sıra farkı aynı soruyu iki kez yazdırmasın).
// Özet tarayıcıda crypto.subtle SHA-256 ile hesaplanır, 64 karakter küçük harf onaltılık.

function squash(s: string): string {
  return s.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
}

export function contentHashInput(stem: string, options: readonly { key: string; text: string }[]): string {
  const sorted = [...options].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return `${squash(stem)}|${sorted.map((o) => `${o.key}:${squash(o.text)}`).join('|')}`;
}

export async function contentHash(stem: string, options: readonly { key: string; text: string }[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contentHashInput(stem, options)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
