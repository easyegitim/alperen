import { z } from "zod";
import { withGuard } from "@/lib/api/guard";
import { getAccessV2 } from "@/lib/billing/purchases";
import { ApiError } from "@/lib/api/errors";
import { getKnowledgeSource } from "@/lib/coach/knowledgeSource";
import { loadProfilePlanRow } from "@/lib/coach/planStore";
import { isFeatureEnabled } from "@/lib/config/flags";
import { userDeliverable } from "@/lib/doctor/queue";
import { doctorLayerState, doctorStepCard } from "@/lib/doctor/rules";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

/**
 * GET /api/doctor?analysisId= → { state, steps, disclosure:true } (KB Ç3; AUP). Yalnız physician_reviewed/delivered satırın
 * physician_items alanı; flag kapalı → off, 18 altı → under_18, tarama yok/risk → kapalı. Taslak hiçbir zaman dönmez.
 */
export const GET = withGuard({}, async ({ req, user }) => {
  const analysisId = new URL(req.url).searchParams.get("analysisId") ?? "";
  if (!z.uuid().safeParse(analysisId).success) throw new ApiError("BAD_INPUT", "analysisId gerekli.");
  const admin = createAdminClient();
  const access = await getAccessV2(admin, user.id, analysisId);
  if (!access.entitled) throw new ApiError("PREMIUM_REQUIRED", "Plan, tam sonuçla birlikte açılır.");
  const profile = await loadProfilePlanRow(admin, user.id);
  const flagEnabled = isFeatureEnabled("doctorLayer");
  const under18 = profile.ageBand === "under_18";
  if (!flagEnabled || under18 || profile.bodyImageScreen !== "ok") {
    return Response.json({ state: doctorLayerState({ flagEnabled, under18, screen: profile.bodyImageScreen, rows: [] }), steps: [], disclosure: true });
  }
  const d = await userDeliverable(admin, user.id, analysisId);
  const knowledge = getKnowledgeSource();
  const steps = await Promise.all(d.items.map(async (it) => doctorStepCard(it, await knowledge.get(it.methodId))));
  const state = doctorLayerState({ flagEnabled, under18, screen: profile.bodyImageScreen, rows: d.rows });
  return Response.json({ state, steps: state === "available" ? steps : [], disclosure: true, reviewedAt: d.reviewedAt });
});
