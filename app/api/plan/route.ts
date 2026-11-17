import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { getAccessV2 } from "@/lib/billing/purchases";
import { generatePlanV2 } from "@/lib/coach/generatePlan";
import { loadAnalysisPlanRow } from "@/lib/coach/planStore";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

const Input = z.object({ analysisId: z.uuid(), regenerate: z.boolean().optional() });

/**
 * POST /api/plan { analysisId, regenerate? } → { view: PlanViewV2, created, fallback, hairLossSignal } (PLAN 4d).
 * Hak: bu analiz için AccessV2.entitled (tek seferlik rapor bağlı ya da abonelik). Kilitli kullanıcıya plan gitmez.
 */
export const POST = withGuard({ schema: Input, requireAdult: true }, async ({ user, input }) => {
  const admin = createAdminClient();
  const access = await getAccessV2(admin, user.id, input.analysisId);
  if (!access.entitled) throw new ApiError("PREMIUM_REQUIRED", "Plan, tam sonuçla birlikte açılır.");
  const r = await generatePlanV2({ admin, userId: user.id, analysisId: input.analysisId, regenerate: Boolean(input.regenerate) });
  const row = await loadAnalysisPlanRow(admin, user.id, input.analysisId);
  return Response.json({ view: r.view, created: r.created, fallback: r.fallback, hairLossSignal: row?.hairLossSignal ?? null });
});
