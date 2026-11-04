// Affedici seri (PLAN_V2 Faz 6 [ÖNERİ]; CONTRACTS_V2 Sprint 3 S3.3). Saf fonksiyonlar; SPEC 11.1 serisinin üstüne
// iki kural ekler: dinlenme günü (haftada N eksik gün otomatik affedilir) ve dondurma (kullanıcı eylemi, ayda M kez).
// Dinlenme ve dondurulan günler seriyi KÖPRÜLER, saymaz (CLAUDE NOTU: "12 gün seri" yalnız yapılan günleri sayar).
// Saklama bu modülün dışındadır (W6/W7b): FreezeRecord listesi parametredir.
import { ROUTINE_FORGIVING, type RoutineForgivingConfig } from "@/lib/config/routine";
import { STREAK_THRESHOLD, addDays, type DayLog } from "./streak";

/** Kullanıcının dondurduğu gün (Istanbul YYYY-MM-DD). Aynı gün iki kez dondurulamaz. */
export type FreezeRecord = { date: string };

export type DayStatus = "done" | "rest" | "frozen" | "missed" | "pending";

export type ForgivingStreak = {
  /** Yapılan (≥ %80) ardışık gün sayısı; dinlenme ve dondurma günleri sayılmaz ama zinciri koparmaz. */
  streak: number;
  /** Seride köprü olarak kullanılan dinlenme günü sayısı (bilgi). */
  restDaysBridged: number;
  /** Seride köprü olarak kullanılan dondurulmuş gün sayısı (bilgi). */
  freezesBridged: number;
  /** Bugünün durumu: pending = henüz tamamlanmadı (seri dünden geriye sayılır, bugün eksik sayılmaz). */
  today: DayStatus;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** ISO haftası anahtarı (Pazartesi başlangıç): "YYYY-Www". Istanbul tarih dizgesi üzerinden, saat dilimi hesabı yok. */
export function isoWeekKey(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7; // Pzt=1 … Paz=7
  date.setUTCDate(date.getUTCDate() + 4 - dow); // o haftanın perşembesi
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** "YYYY-MM" (dondurma hakkı takvim ayına göre). */
export function monthKey(ymd: string): string {
  return ymd.slice(0, 7);
}

export function freezesUsedInMonth(freezes: readonly FreezeRecord[], month: string): number {
  return freezes.filter((f) => YMD.test(f.date) && monthKey(f.date) === month).length;
}

export type FreezeCheck = { ok: true } | { ok: false; reason: "limit_reached" | "already_frozen" | "future_date" | "bad_date" };

/** Verilen gün dondurulabilir mi: geçmiş/bugün, daha önce dondurulmamış, aylık hak dolmamış. */
export function canUseFreeze(freezes: readonly FreezeRecord[], date: string, today: string, config: RoutineForgivingConfig = ROUTINE_FORGIVING): FreezeCheck {
  if (!YMD.test(date) || !YMD.test(today)) return { ok: false, reason: "bad_date" };
  if (dayNumber(date) > dayNumber(today)) return { ok: false, reason: "future_date" };
  if (freezes.some((f) => f.date === date)) return { ok: false, reason: "already_frozen" };
  if (freezesUsedInMonth(freezes, monthKey(date)) >= config.freezesPerMonth) return { ok: false, reason: "limit_reached" };
  return { ok: true };
}

function doneDays(logs: readonly DayLog[], activeItemCount: number): Set<string> {
  const byDay = new Map<string, Set<string>>();
  for (const l of logs) {
    if (!l.done) continue;
    const set = byDay.get(l.log_date) ?? new Set<string>();
    set.add(l.item_id);
    byDay.set(l.log_date, set);
  }
  const out = new Set<string>();
  for (const [day, set] of byDay) if (set.size / activeItemCount >= STREAK_THRESHOLD) out.add(day);
  return out;
}

/**
 * Affedici seri: bugünden (bugün tamamlanmadıysa dünden) geriye yürür.
 *  - yapılan gün → streak++
 *  - dondurulmuş gün → köprü (dinlenme hakkını harcamaz)
 *  - eksik gün → o ISO haftasında kalan dinlenme hakkı varsa köprü, yoksa seri biter
 * Aktif adım yoksa 0. Üst sınır 3650 gün. Haftalık adımlar seriye girmez (SPEC 11.1 ile aynı).
 */
export function computeForgivingStreak(input: { logs: readonly DayLog[]; activeItemCount: number; today: string; freezes?: readonly FreezeRecord[]; config?: RoutineForgivingConfig }): ForgivingStreak {
  const { logs, activeItemCount, today } = input;
  const config = input.config ?? ROUTINE_FORGIVING;
  const frozen = new Set((input.freezes ?? []).map((f) => f.date));
  if (activeItemCount <= 0 || !YMD.test(today)) return { streak: 0, restDaysBridged: 0, freezesBridged: 0, today: "pending" };
  const done = doneDays(logs, activeItemCount);
  const todayStatus: DayStatus = done.has(today) ? "done" : frozen.has(today) ? "frozen" : "pending";
  let day = todayStatus === "done" ? today : addDays(today, -1);
  let streak = 0, restDaysBridged = 0, freezesBridged = 0, steps = 0;
  // Köprüler yalnız iki yapılan gün ARASINDA sayılır: zincirin başındaki (en eski yapılan günden önceki) köprüler atılır.
  let pendingRest = 0, pendingFreeze = 0;
  const restUsed = new Map<string, number>();
  while (steps++ < 3650) {
    if (done.has(day)) {
      streak++;
      restDaysBridged += pendingRest;
      freezesBridged += pendingFreeze;
      pendingRest = 0;
      pendingFreeze = 0;
    } else if (frozen.has(day)) {
      pendingFreeze++;
    } else {
      const wk = isoWeekKey(day);
      const used = restUsed.get(wk) ?? 0;
      if (used >= config.restDaysPerWeek) break;
      restUsed.set(wk, used + 1);
      pendingRest++;
    }
    day = addDays(day, -1);
  }
  return { streak, restDaysBridged, freezesBridged, today: todayStatus };
}

/** Bu ISO haftasında (bugün dahil, bugün eksik sayılmaz) kalan dinlenme günü; arayüz "Bu hafta kalan dinlenme günü: n". */
export function restDaysLeftThisWeek(input: { logs: readonly DayLog[]; activeItemCount: number; today: string; freezes?: readonly FreezeRecord[]; config?: RoutineForgivingConfig }): number {
  const config = input.config ?? ROUTINE_FORGIVING;
  if (input.activeItemCount <= 0 || !YMD.test(input.today)) return config.restDaysPerWeek;
  const done = doneDays(input.logs, input.activeItemCount);
  const frozen = new Set((input.freezes ?? []).map((f) => f.date));
  const wk = isoWeekKey(input.today);
  let used = 0;
  for (let day = addDays(input.today, -1); isoWeekKey(day) === wk; day = addDays(day, -1)) {
    if (!done.has(day) && !frozen.has(day)) used++;
  }
  return Math.max(0, config.restDaysPerWeek - used);
}

/** Bir günün durumu (takvim görünümü için). */
export function dayStatus(day: string, input: { logs: readonly DayLog[]; activeItemCount: number; today: string; freezes?: readonly FreezeRecord[] }): DayStatus {
  if (input.activeItemCount <= 0) return "pending";
  if (doneDays(input.logs, input.activeItemCount).has(day)) return "done";
  if ((input.freezes ?? []).some((f) => f.date === day)) return "frozen";
  if (day === input.today) return "pending";
  return dayNumber(day) < dayNumber(input.today) ? "missed" : "pending";
}
