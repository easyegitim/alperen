import type { CoachReport } from "@/lib/ai/reportSchema";
import { routineItemsFromReport } from "@/lib/routine/fromReport";
import { getSupabase } from "@/mobile/src/lib/supabase";

/** SPEC 11.1 "Rutinime ekle" (mobil): mevcut aynı ref_id'ler atlanır; RLS kendi satırları. Döner: eklenen sayısı. */
export async function addReportToRoutine(userId: string, report: CoachReport, includeExercises: boolean): Promise<number> {
  const supabase = getSupabase();
  const { data: existing } = await supabase.from("routine_items").select("ref_id").eq("active", true);
  const have = new Set((existing ?? []).map((r) => String(r.ref_id)));
  const items = routineItemsFromReport(report, userId, includeExercises).filter((i) => !have.has(i.ref_id));
  if (items.length === 0) return 0;
  const { error } = await supabase.from("routine_items").insert(items);
  if (error) throw error;
  return items.length;
}
