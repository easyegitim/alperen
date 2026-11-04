import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PlanV2 } from "@/lib/coach/planTypes";
import type { GlowUpStepLike } from "./combo";

/**
 * Glow-up adım kaynağı (KB §7.2/Ç9, PLAN 5d "istem plana bağlı"): YALNIZ analizin coach_reports.plan_v2 adımları (0013).
 * Plan yoksa (anket/plan henüz açılmadı, sütun yok, başka kullanıcının analizi) null döner; rota "plan_required" ile reddeder.
 * Katalog yedeği yoktur: plan dışı bir kesim/sakal/cilt adımı (sunum, başörtüsü, bütçe süzgecinden geçmemiş) görsele giremez.
 * Görsel/landmark okunmaz.
 */
export async function loadGlowUpSteps(admin: SupabaseClient, userId: string, analysisId: string): Promise<GlowUpStepLike[] | null> {
  const res = await admin.from("coach_reports").select("plan_v2").eq("user_id", userId).eq("analysis_id", analysisId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (res.error) return null;
  const parsed = PlanV2.safeParse(res.data?.plan_v2);
  if (!parsed.success) return null;
  return parsed.data.steps.map((s) => ({ id: s.id, area: s.area, tier: s.tier, tryonPresetId: s.tryonPresetId }));
}
