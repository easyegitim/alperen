/**
 * Soru hazırlanırken bekleme ekranının zamanlaması (test sayfası sunucu bileşeni ve istemci yoklaması ortak kullanır;
 * istemci modülünden dışa aktarılan değerler sunucuda kullanılamadığı için burada durur).
 */

/** Bu süreden sonra bekleme notu "Biraz uzun sürdü, Koç'a sorabilirsin" olur. */
export const SLOW_AFTER_MS = 60_000;
/** Sunucu bu sürede bitmeyen üretimi kapatır (settings.practice_generation_timeout_s = 600); sonra yoklama durur. */
export const GIVE_UP_AFTER_MS = 600_000;

/** Yoklama aralığı: ilk dakika 2 sn (üretim çoğunlukla saniyeler sürer), sonra 10 sn; 10 dakikadan sonra durur. */
export function pollDelay(elapsedMs: number): number | null {
  if (elapsedMs >= GIVE_UP_AFTER_MS) return null;
  return elapsedMs < SLOW_AFTER_MS ? 2_000 : 10_000;
}

/** Setin açılışından bu yana geçen süre (saat kayması ya da bozuk tarihte 0). */
export function elapsedSince(startedAt: string | null | undefined, now: number): number {
  const t = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isFinite(t) ? Math.max(0, now - t) : 0;
}

/** İstek anında bekleme uzun sürdü mü (sunucu çizimi). */
export function waitedTooLong(startedAt: string | null | undefined): boolean {
  return elapsedSince(startedAt, Date.now()) >= SLOW_AFTER_MS;
}
