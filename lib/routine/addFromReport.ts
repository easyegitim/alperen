"use client";

// SPEC 11.1: rapordaki "Rutinime ekle" → routine_items (kind: step | exercise | habit, ref_id katalog id'si). RLS: kendi satırları.
import type { CoachReport } from "@/lib/ai/reportSchema";
import { createClient } from "@/lib/db/browser";
import type { PlanV2 } from "@/lib/coach/planTypes";
import { routineItemsFromPlanV2, routineItemsFromReport, type RoutineItemInsert } from "./fromReport";

export { routineItemsFromPlanV2, routineItemsFromReport, type RoutineItemInsert } from "./fromReport";

/** Mevcut aynı ref_id'ler atlanır. Döner: eklenen sayısı. */
export async function addReportToRoutine(report: CoachReport, includeExercises: boolean): Promise<number> {
  return insertNew((userId) => routineItemsFromReport(report, userId, includeExercises));
}

/** Plan v2 adımlarından (katalog kimlikli olanlar) rutin; mevcut aynı ref_id'ler atlanır. Döner: eklenen sayısı. */
export async function addPlanV2ToRoutine(plan: PlanV2): Promise<number> {
  return insertNew((userId) => routineItemsFromPlanV2(plan, userId));
}

async function insertNew(build: (userId: string) => RoutineItemInsert[]): Promise<number> {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("no_session");
  const { data: existing } = await supabase.from("routine_items").select("ref_id").eq("active", true);
  const have = new Set((existing ?? []).map((r) => String(r.ref_id)));
  const items = build(userId).filter((i) => !have.has(i.ref_id));
  if (items.length === 0) return 0;
  const { error } = await supabase.from("routine_items").insert(items);
  if (error) throw error;
  return items.length;
}
