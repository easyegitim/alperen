import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { getPremiumStatus } from "@/lib/api/premium";
import { createReport } from "@/lib/coach/reportsStore";

export const runtime = "nodejs";
// engine spec §9.6: COACH.deadlineMs 110 s + pay. Vercel planının 120 s izin verdiği doğrulanmalı (onay maddesi).
export const maxDuration = 120;

const Input = z.object({ analysisId: z.uuid(), regenerate: z.boolean().optional() });

/** SPEC 14: POST /api/reports { analysisId, regenerate? } → { reportId, report }. Premium; mevcut rapor varsa onu döner. */
export const POST = withGuard({ schema: Input, requireAdult: true }, async ({ user, supabase, input }) => {
  const { premium } = await getPremiumStatus(supabase, user.id);
  if (!premium) throw new ApiError("PREMIUM_REQUIRED", "Koç raporu premiumda.");
  const r = await createReport(user.id, input.analysisId, Boolean(input.regenerate));
  return Response.json({ reportId: r.id, report: r.report, isFallback: r.isFallback, createdAt: r.createdAt });
});
