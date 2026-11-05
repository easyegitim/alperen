import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { getPremiumStatus } from "@/lib/api/premium";
import { getLatestReport } from "@/lib/coach/reportsStore";

export const runtime = "nodejs";

/** GET /api/reports/[analysisId] → { report } (premium; sahiplik). */
export const GET = withGuard({}, async ({ req, user, supabase }) => {
  const analysisId = new URL(req.url).pathname.split("/").pop() ?? "";
  if (!z.uuid().safeParse(analysisId).success) return Response.json({ error: { code: "NOT_FOUND", message: "Rapor bulunamadı." } }, { status: 404 });
  const { premium } = await getPremiumStatus(supabase, user.id);
  if (!premium) throw new ApiError("PREMIUM_REQUIRED", "Koç raporu premiumda.");
  const r = await getLatestReport(user.id, analysisId);
  if (!r) return Response.json({ error: { code: "NOT_FOUND", message: "Rapor bulunamadı." } }, { status: 404 });
  return Response.json({ reportId: r.id, report: r.report, isFallback: r.isFallback, createdAt: r.createdAt });
});
