import { withGuard } from "@/lib/api/guard";
import { getPremiumStatus } from "@/lib/api/premium";
import { isUuid } from "@/lib/billing/returnAnalysis";
import { getAccessV2 } from "@/lib/billing/purchases";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

/**
 * GET /api/billing/status[?analysis=<uuid>] → { premium, plan, periodEnd, cancelAtPeriodEnd, status, analysisEntitled }
 * analysisEntitled: o analiz için hak (abonelik ya da ona bağlı/bağlanmamış ödenmiş tek seferlik rapor); yalnız sunucu satırlarından.
 */
export const GET = withGuard({}, async ({ req, user, supabase }) => {
  const s = await getPremiumStatus(supabase, user.id);
  const { data } = await supabase.from("subscriptions").select("cancel_at_period_end, status").eq("user_id", user.id).maybeSingle();
  const analysis = new URL(req.url).searchParams.get("analysis");
  const analysisEntitled = isUuid(analysis) ? (await getAccessV2(createAdminClient(), user.id, analysis)).entitled : null;
  return Response.json({ premium: s.premium, plan: s.plan, periodEnd: s.periodEnd, cancelAtPeriodEnd: Boolean(data?.cancel_at_period_end), status: data?.status ?? null, analysisEntitled });
});
