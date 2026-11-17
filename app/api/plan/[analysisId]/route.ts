import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { getAccessV2 } from "@/lib/billing/purchases";
import { getPlanView, loadAnalysisPlanRow } from "@/lib/coach/planStore";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

/** GET /api/plan/[analysisId] → { view: PlanViewV2, hairLossSignal } (saklı plan; yoksa 404). Hak sunucuda. */
export const GET = withGuard({}, async ({ req, user }) => {
  const analysisId = new URL(req.url).pathname.split("/").pop() ?? "";
  if (!z.uuid().safeParse(analysisId).success) return Response.json({ error: { code: "NOT_FOUND", message: "Plan bulunamadı." } }, { status: 404 });
  const admin = createAdminClient();
  const access = await getAccessV2(admin, user.id, analysisId);
  if (!access.entitled) throw new ApiError("PREMIUM_REQUIRED", "Plan, tam sonuçla birlikte açılır.");
  const view = await getPlanView(admin, user.id, analysisId);
  if (!view) return Response.json({ error: { code: "NOT_FOUND", message: "Plan bulunamadı." } }, { status: 404 });
  const row = await loadAnalysisPlanRow(admin, user.id, analysisId);
  return Response.json({ view, hairLossSignal: row?.hairLossSignal ?? null });
});
