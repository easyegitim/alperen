import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { catalogMethodRecords } from "@/lib/coach/knowledge";
import { PlanV2 } from "@/lib/coach/planTypes";
import { isMissingColumnError } from "@/lib/score/rowColumns";
import type { GlowUpStepLike } from "./combo";

/**
 * Glow-up adım kaynağı (PLAN 5d "istem plana bağlı"): analizin coach_reports.plan_v2 adımları (0013). Plan yoksa ya da
 * sütun henüz yoksa katalog kayıtları (lib/coach/knowledge.ts) kaynak olur: kimlikler yine kodla doğrulanır, doktor
 * katmanı asla girmez (selectGlowUpSteps). Görsel/landmark okunmaz.
 */
export async function loadGlowUpSteps(admin: SupabaseClient, userId: string, analysisId: string): Promise<{ steps: GlowUpStepLike[]; source: "plan" | "catalog" }> {
  const res = await admin.from("coach_reports").select("plan_v2").eq("user_id", userId).eq("analysis_id", analysisId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!res.error || !isMissingColumnError(res.error)) {
    const parsed = PlanV2.safeParse(res.data?.plan_v2);
    if (parsed.success) {
      return { steps: parsed.data.steps.map((s) => ({ id: s.id, area: s.area, tier: s.tier, tryonPresetId: s.tryonPresetId })), source: "plan" };
    }
  }
  return { steps: catalogMethodRecords().map((r) => ({ id: r.id, area: r.area, tier: r.tier, tryonPresetId: r.tryonPresetId })), source: "catalog" };
}
