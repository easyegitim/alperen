import "server-only";

import { createAdminClient } from "@/lib/db/admin";
import { applyRemoteStatus, type SubscriptionRow } from "./sync";
import { parseRemoteSubscription, retrieveSubscription } from "./subscriptions";

/** iyzico'dan durumu yeniden çekip subscriptions satırını günceller (callback ve webhook ortak yolu). */
export async function syncSubscriptionFromIyzico(subscriptionRef: string): Promise<SubscriptionRow | null> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("subscriptions")
    .select("user_id, plan, status, current_period_start, current_period_end, cancel_at_period_end")
    .eq("provider_subscription_ref", subscriptionRef)
    .maybeSingle();
  if (!row) return null;

  const remote = parseRemoteSubscription((await retrieveSubscription(subscriptionRef)).data);
  if (!remote.status) return null;
  const current: SubscriptionRow = {
    plan: row.plan as SubscriptionRow["plan"],
    status: row.status as SubscriptionRow["status"],
    current_period_start: row.current_period_start ?? null,
    current_period_end: row.current_period_end ?? null,
    cancel_at_period_end: Boolean(row.cancel_at_period_end),
  };
  const next = applyRemoteStatus(current, { status: remote.status, periodStart: remote.periodStart, periodEnd: remote.periodEnd });
  const { error } = await admin
    .from("subscriptions")
    .update({
      status: next.status,
      current_period_start: next.current_period_start,
      current_period_end: next.current_period_end,
      provider_customer_ref: remote.customerRef ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", row.user_id);
  if (error) throw new Error("subscription update failed");
  return next;
}
