import { withGuard } from "@/lib/api/guard";
import { getPremiumStatus } from "@/lib/api/premium";
import { isUuid } from "@/lib/billing/returnAnalysis";
import { canConsumePurchaseFor } from "@/lib/billing/entitlement";
import { getAccessV2 } from "@/lib/billing/purchases";
import { createAdminClient } from "@/lib/db/admin";
import { loadRowById } from "@/app/api/analyses/v2";

export const runtime = "nodejs";

/**
 * GET /api/billing/status[?analysis=<uuid>] → { premium, plan, periodEnd, cancelAtPeriodEnd, status, analysisEntitled }
 * analysisEntitled: o analiz için hak (abonelik ya da ona bağlı ödenmiş tek seferlik rapor) ya da henüz başlamamış satıra
 * bağlanabilecek ödenmiş rapor; yalnız sunucu satırlarından. Değer yalnız UX içindir; kilidi sunucu açar.
 */
export const GET = withGuard({}, async ({ req, user, supabase }) => {
  const s = await getPremiumStatus(supabase, user.id);
  const { data } = await supabase.from("subscriptions").select("cancel_at_period_end, status").eq("user_id", user.id).maybeSingle();
  const analysis = new URL(req.url).searchParams.get("analysis");
  let analysisEntitled: boolean | null = null;
  if (isUuid(analysis)) {
    const admin = createAdminClient();
    const [access, row] = await Promise.all([getAccessV2(admin, user.id, analysis), loadRowById(admin, user.id, analysis)]);
    analysisEntitled = row ? canConsumePurchaseFor(access, row.status) : access.entitled;
  }
  return Response.json({ premium: s.premium, plan: s.plan, periodEnd: s.periodEnd, cancelAtPeriodEnd: Boolean(data?.cancel_at_period_end), status: data?.status ?? null, analysisEntitled });
});
