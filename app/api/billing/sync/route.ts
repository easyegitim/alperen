import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { getPremiumStatus } from "@/lib/api/premium";
import { syncSubscriptionFromRevenueCat } from "@/lib/billing/revenuecatStore";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

/**
 * POST /api/billing/sync → { premium, plan, periodEnd }. Mobil satın alma/geri yükleme sonrası çağrılır; webhook gecikmesini kapatır.
 * İstemci sonucu gönderilmez ve okunmaz: sunucu RevenueCat'ten çeker. Kullanıcı başına dakikada 6.
 */
export const POST = withGuard({ allowAnonymous: false }, async ({ user, supabase }) => {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from("payment_events").select("id", { count: "exact", head: true }).eq("provider", "revenuecat-sync").like("event_key", `sync:${user.id}:%`).gte("received_at", since);
  if ((count ?? 0) >= 6) throw new ApiError("RATE_LIMITED", "Çok sık eşitleme; biraz bekle.");
  await admin.from("payment_events").insert({ provider: "revenuecat-sync", event_key: `sync:${user.id}:${Date.now()}`, payload: {} });
  try {
    await syncSubscriptionFromRevenueCat(user.id);
  } catch (e) {
    throw new ApiError("AI_FAILED", `Abonelik durumu alınamadı: ${e instanceof Error ? e.message : "hata"}`);
  }
  return Response.json(await getPremiumStatus(supabase, user.id));
});
