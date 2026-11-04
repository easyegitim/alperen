// Affedici seri görünümü (PLAN Faz 6 [ÖNERİ]; CONTRACTS_V2 S3.3.2/S3.6): son 7 günün durumu, computeForgivingStreak ile
// AYNI yürüyüşle etiketlenir; dondurma satırı hata eşlemesi (PostgREST/PG → FreezeCheck nedeni). Saf; birim testli.
// Web lib/routine/calendar.ts (W6) ile aynı semantik; birleştirme sonrası o modüle geçilebilir.
import { ROUTINE_FORGIVING, type RoutineForgivingConfig } from "@/lib/config/routine";
import { isoWeekKey, type DayStatus, type FreezeRecord } from "@/lib/routine/forgiving";
import { STREAK_THRESHOLD, addDays, type DayLog } from "@/lib/routine/streak";

export type CalendarDay = { date: string; status: DayStatus };
/** Dondurma kayıtları tablosu (migration 0015; yoksa dondurma gizlenir, seri yine affedici hesaplanır). */
export const FREEZE_TABLE = "routine_freezes";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function doneSet(logs: readonly DayLog[], activeItemCount: number): Set<string> {
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
 * Bugünden geriye `days` gün (en eski önce). Bugün tamamlanmadıysa "pending". Zincir kırıldıktan sonraki eksik günler
 * "missed"; zincir içinde haftalık dinlenme hakkıyla affedilenler "rest"; dondurulanlar "frozen".
 */
export function recentDays(input: { logs: readonly DayLog[]; activeItemCount: number; today: string; freezes?: readonly FreezeRecord[]; config?: RoutineForgivingConfig; days?: number }): CalendarDay[] {
  const days = Math.max(1, Math.min(31, input.days ?? 7));
  const config = input.config ?? ROUTINE_FORGIVING;
  if (!YMD.test(input.today)) return [];
  const active = input.activeItemCount > 0;
  const done = active ? doneSet(input.logs, input.activeItemCount) : new Set<string>();
  const frozen = new Set((input.freezes ?? []).map((f) => f.date));
  const out: CalendarDay[] = [];
  const restUsed = new Map<string, number>();
  let chain = active;
  let day = input.today;
  for (let i = 0; i < days; i++, day = addDays(day, -1)) {
    let status: DayStatus;
    if (done.has(day)) status = "done";
    else if (frozen.has(day)) status = "frozen";
    else if (day === input.today) status = "pending";
    else if (chain) {
      const wk = isoWeekKey(day);
      const used = restUsed.get(wk) ?? 0;
      if (used < config.restDaysPerWeek) {
        restUsed.set(wk, used + 1);
        status = "rest";
      } else {
        chain = false;
        status = "missed";
      }
    } else status = "missed";
    out.push({ date: day, status });
  }
  return out.reverse();
}

export type FreezeStoreError = "limit_reached" | "already_frozen" | "future_date" | "unavailable" | "unknown";

/** Supabase ekleme hatası → neden. Trigger mesajı "routine_freeze_limit: <neden>" (0015), 23505 = aynı gün, 42P01/PGRST205 = tablo yok. */
export function freezeStoreError(error: { code?: string | null; message?: string | null } | null | undefined): FreezeStoreError {
  if (!error) return "unknown";
  const msg = error.message ?? "";
  if (msg.includes("routine_freeze_limit: limit_reached")) return "limit_reached";
  if (msg.includes("routine_freeze_limit: future_date")) return "future_date";
  if (error.code === "23505") return "already_frozen";
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST204") return "unavailable";
  return "unknown";
}

/** Satırlar → FreezeRecord (tarih dizgesi doğrulanır; bozuk satır atılır). */
export function freezesFromRows(rows: readonly { freeze_date?: unknown }[] | null | undefined): FreezeRecord[] {
  return (rows ?? []).flatMap((r) => (typeof r.freeze_date === "string" && YMD.test(r.freeze_date.slice(0, 10)) ? [{ date: r.freeze_date.slice(0, 10) }] : []));
}
