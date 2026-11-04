// Affedici seri görünümü (PLAN Faz 6 [ÖNERİ]; CONTRACTS_V2 S3.3.2/S3.6): 7 günlük şerit ve dondurma hata eşlemesi
// web ile ortak saf modülden gelir (lib/routine/calendar.ts, W6); burada yalnız mobil Supabase satır dönüşümü kalır.
import type { FreezeRecord } from "@/lib/routine/forgiving";

export { freezeStoreError, recentDays, type CalendarDay, type FreezeStoreError } from "@/lib/routine/calendar";

/** Dondurma kayıtları tablosu (migration 0015; yoksa dondurma gizlenir, seri yine affedici hesaplanır). */
export const FREEZE_TABLE = "routine_freezes";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Satırlar → FreezeRecord (tarih dizgesi doğrulanır; bozuk satır atılır). */
export function freezesFromRows(rows: readonly { freeze_date?: unknown }[] | null | undefined): FreezeRecord[] {
  return (rows ?? []).flatMap((r) => (typeof r.freeze_date === "string" && YMD.test(r.freeze_date.slice(0, 10)) ? [{ date: r.freeze_date.slice(0, 10) }] : []));
}
