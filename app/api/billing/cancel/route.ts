import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { track } from "@/lib/analytics";
import { IyzicoError } from "@/lib/billing/iyzico";
import { cancelSubscription } from "@/lib/billing/subscriptions";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

/** SPEC 15.2 adım 9: tek tık iptal → iyzico cancel → cancel_at_period_end = true; erişim dönem sonuna kadar. */
export const POST = withGuard({}, async ({ user, supabase }) => {
  const { data } = await supabase.from("subscriptions").select("plan, status, provider, provider_subscription_ref, cancel_at_period_end").eq("user_id", user.id).maybeSingle();
  if (!data || !["active", "past_due"].includes(String(data.status))) throw new ApiError("BAD_INPUT", "Aktif abonelik yok.");
  // SPEC 15.4: mağaza abonelikleri mağazadan iptal edilir; sunucu RevenueCat olayıyla güncellenir.
  if (String(data.provider) === "revenuecat") throw new ApiError("BAD_INPUT", "Mağaza aboneliği; iptal App Store / Google Play abonelik ayarlarından yapılır.");
  if (data.cancel_at_period_end) return Response.json({ cancelAtPeriodEnd: true });
  const ref = data.provider_subscription_ref ? String(data.provider_subscription_ref) : null;
  if (ref && !ref.startsWith("onetime:")) {
    try {
      await cancelSubscription(ref);
    } catch (e) {
      if (e instanceof IyzicoError) throw new ApiError("AI_FAILED", `İptal iletilemedi: ${e.message}`);
      throw e;
    }
  }
  const admin = createAdminClient();
  await admin.from("subscriptions").update({ cancel_at_period_end: true, updated_at: new Date().toISOString() }).eq("user_id", user.id);
  track("subscription_canceled", { plan: String(data.plan) });
  return Response.json({ cancelAtPeriodEnd: true });
});
