/** Küçük, saf yardımcılar (zaman dilimi, kimlik, hash). Türkiye kalıcı UTC+3'tür (2016'dan beri yaz saati yok). */
import { sha256Hex } from '@ogrenmen/pii';

export const IST_OFFSET_MS = 3 * 3600_000;

/** Europe/Istanbul takvim günü (YYYY-AA-GG). */
export function istanbulDay(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Europe/Istanbul saat (0–23). */
export function istanbulHour(d: Date): number {
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();
}

export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function iso(d: Date): string {
  return d.toISOString();
}

/** `random()` kaynağından RFC 4122 v4 UUID (deterministik sahteler için). */
export function uuidFrom(random: () => number): string {
  const b: number[] = [];
  for (let i = 0; i < 16; i++) b.push(Math.floor(random() * 256) & 0xff);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Loglar için sohbet takma adı: sha256(chat_id)[:8] (§5.10). */
export function chatHash(chatId: number): string {
  return sha256Hex(String(chatId)).slice(0, 8);
}

/** Mulberry32: tohumlu, deterministik [0,1) üreteci (sahteler ve testler). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Kaba token tahmini (sahte sağlayıcı ve bütçe kırpma aynı kuralı kullanır): 4 karakter ≈ 1 token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
