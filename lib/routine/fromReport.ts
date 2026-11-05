// SPEC 11.1: rapordan rutin kalemleri (saf; web ve mobil ortak). Katalog kimlikleri dışında kalem üretilmez.
import { EXERCISES } from "@/content/exercises";
import { HABITS } from "@/content/habits";
import { SKIN_STEPS } from "@/content/skin-steps";
import type { CoachReport } from "@/lib/ai/reportSchema";
import type { PlanV2 } from "@/lib/coach/planTypes";

export type RoutineItemInsert = { user_id: string; kind: "step" | "exercise" | "habit"; ref_id: string; slot: "morning" | "evening" | "daily" | "weekly"; title: string; position: number };

export function routineItemsFromReport(report: CoachReport, userId: string, includeExercises: boolean): RoutineItemInsert[] {
  const items: RoutineItemInsert[] = [];
  let pos = 0;
  const stepMap = new Map(SKIN_STEPS.map((s) => [s.id, s]));
  for (const slot of ["morning", "evening", "weekly"] as const) {
    for (const s of report.skincare[slot]) {
      const def = stepMap.get(s.stepType);
      if (def) items.push({ user_id: userId, kind: "step", ref_id: def.id, slot, title: def.nameTr, position: pos++ });
    }
  }
  if (includeExercises) {
    const exMap = new Map(EXERCISES.map((e) => [e.id, e]));
    for (const e of report.exercises) {
      const def = exMap.get(e.id);
      if (def) items.push({ user_id: userId, kind: "exercise", ref_id: def.id, slot: def.slot, title: def.nameTr, position: pos++ });
    }
  }
  const hbMap = new Map(HABITS.map((h) => [h.id, h]));
  for (const h of report.habits) {
    const def = hbMap.get(h.id);
    if (def) items.push({ user_id: userId, kind: "habit", ref_id: def.id, slot: def.slot, title: `${def.nameTr}: ${h.target}`, position: pos++ });
  }
  return items;
}

/**
 * Plan v2 → rutin (SPEC 11.1; Sprint 2 sonrası rutin boş ekranı "Planımdan rutin oluştur" ile plana gönderir).
 * Yalnız katalog kimliği taşıyan adımlar (cilt/bakım adımı, egzersiz, alışkanlık) eklenir; berber/stil önerileri ve doktor
 * katmanı rutine girmez. Egzersiz yalnız plan onu içeriyorsa (plan zaten çene sağlığı kuralıyla kurulur). Öncelik sırası korunur.
 */
export function routineItemsFromPlanV2(plan: PlanV2, userId: string): RoutineItemInsert[] {
  const stepMap = new Map(SKIN_STEPS.map((s) => [s.id, s]));
  const exMap = new Map(EXERCISES.map((e) => [e.id, e]));
  const hbMap = new Map(HABITS.map((h) => [h.id, h]));
  const order = new Map(plan.priorityTable.map((r, i) => [r.stepId, i]));
  const steps = plan.steps.filter((s) => s.tier !== "doctor").sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  const items: RoutineItemInsert[] = [];
  const seen = new Set<string>();
  let pos = 0;
  for (const s of steps) {
    if (seen.has(s.id)) continue;
    const st = stepMap.get(s.id);
    const ex = exMap.get(s.id);
    const hb = hbMap.get(s.id);
    if (st) items.push({ user_id: userId, kind: "step", ref_id: st.id, slot: st.slot, title: st.nameTr, position: pos++ });
    else if (ex && s.area === "exercise") items.push({ user_id: userId, kind: "exercise", ref_id: ex.id, slot: ex.slot, title: ex.nameTr, position: pos++ });
    else if (hb) items.push({ user_id: userId, kind: "habit", ref_id: hb.id, slot: hb.slot, title: `${hb.nameTr}: ${hb.defaultTargetTr}`, position: pos++ });
    else continue;
    seen.add(s.id);
  }
  return items;
}
