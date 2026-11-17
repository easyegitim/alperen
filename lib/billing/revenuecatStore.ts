import "server-only";

import { createAdminClient } from "@/lib/db/admin";
import { mapSubscriber, type RcSubscriber } from "./revenuecat";
import type { SubscriptionRow } from "./sync";

const RC_API = "https://api.revenuecat.com/v1";

/** RevenueCat REST v1: abone bilgisini sunucu gizli anahtarıyla çeker (istemci bilgisine güvenilmez). */
export async function fetchSubscriber(appUserId: string, fetchImpl: typeof fetch = fetch): Promise<RcSubscriber | null> {
  const key = process.env.REVENUECAT_SECRET_API_KEY;
  if (!key) throw new Error("REVENUECAT_SECRET_API_KEY eksik");
  const res = await fetchImpl(`${RC_API}/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { authorization: `Bearer ${key}`, accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`revenuecat http ${res.status}`);
  const json = (await res.json()) as { subscriber?: RcSubscriber };
  return json.subscriber ?? null;
}

/**
 * RevenueCat durumunu subscriptions satırına yazar (provider='revenuecat'). app_user_id = Supabase kullanıcı kimliği.
 * Yetki yoksa ve mevcut satır revenuecat değilse (ör. web iyzico) dokunulmaz.
 */
export async function syncSubscriptionFromRevenueCat(appUserId: string, fetchImpl: typeof fetch = fetch): Promise<SubscriptionRow | null> {
  const sub = await fetchSubscriber(appUserId, fetchImpl);
  const mapped = sub ? mapSubscriber(sub) : null;
  const admin = createAdminClient();
  if (!mapped) {
    // Yetki yok: yalnız revenuecat satırı varsa expired'a çek
    await admin.from("subscriptions").update({ status: "expired", updated_at: new Date().toISOString() }).eq("user_id", appUserId).eq("provider", "revenuecat").in("status", ["active", "past_due", "pending"]);
    return null;
  }
  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: appUserId,
      provider: "revenuecat",
      plan: mapped.row.plan,
      status: mapped.row.status,
      provider_subscription_ref: `revenuecat:${appUserId}`,
      provider_customer_ref: appUserId,
      current_period_start: mapped.row.current_period_start,
      current_period_end: mapped.row.current_period_end,
      cancel_at_period_end: mapped.row.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error("subscription upsert failed");
  return mapped.row;
}
