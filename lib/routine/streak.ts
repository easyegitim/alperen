// SPEC 11.1: seri = adımların ≥ %80'inin yapıldığı ardışık gün sayısı (Europe/Istanbul günü). Saf fonksiyonlar.
export const STREAK_THRESHOLD = 0.8;

/** Europe/Istanbul'a göre YYYY-MM-DD. */
export function istanbulDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts; // en-CA → YYYY-MM-DD
}

export function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export type DayLog = { log_date: string; item_id: string; done: boolean };

/**
 * @param logs Son N günün kayıtları.
 * @param activeItemCount Günlük/sabah/akşam aktif adım sayısı (haftalık adımlar seriye girmez).
 * @param today Bugün (Istanbul). Bugün henüz tamamlanmadıysa seri dünden geriye sayılır.
 */
export function computeStreak(logs: DayLog[], activeItemCount: number, today: string): number {
  if (activeItemCount <= 0) return 0;
  const doneByDay = new Map<string, Set<string>>();
  for (const l of logs) {
    if (!l.done) continue;
    const set = doneByDay.get(l.log_date) ?? new Set<string>();
    set.add(l.item_id);
    doneByDay.set(l.log_date, set);
  }
  const complete = (day: string) => (doneByDay.get(day)?.size ?? 0) / activeItemCount >= STREAK_THRESHOLD;
  let day = complete(today) ? today : addDays(today, -1);
  let streak = 0;
  while (complete(day)) {
    streak++;
    day = addDays(day, -1);
    if (streak > 3650) break;
  }
  return streak;
}

/** Bugünün tamamlanma oranı. */
export function completionRatio(logs: DayLog[], itemIds: string[], today: string): number {
  if (itemIds.length === 0) return 0;
  const done = new Set(logs.filter((l) => l.done && l.log_date === today && itemIds.includes(l.item_id)).map((l) => l.item_id));
  return done.size / itemIds.length;
}
