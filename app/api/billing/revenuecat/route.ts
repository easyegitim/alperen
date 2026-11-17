import { isAuthorizedWebhook, oneTimePurchaseFromWebhook, webhookAppUserId, webhookEventKey, type RcWebhook } from "@/lib/billing/revenuecat";
import { syncSubscriptionFromRevenueCat } from "@/lib/billing/revenuecatStore";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

/**
 * SPEC-MOBILE M6: RevenueCat webhook'u. Authorization başlığı panelde tanımlanan REVENUECAT_WEBHOOK_SECRET ile eşleşmeli.
 * Gövdeye güvenilmez: olay payment_events'e yazılır (tekrar koruması), durum RevenueCat REST'ten yeniden çekilir.
 * Faz 6 (S3.3.7): NON_RENEWING_PURCHASE + tek seferlik rapor ürünü → purchases(one_time_report, paid, analysis_id null);
 * event_key tekrarında yazılmaz. İstemciden gelen hiçbir bilgi hak açmaz.
 */
export async function POST(req: Request) {
  if (!isAuthorizedWebhook(req.headers.get("authorization"), process.env.REVENUECAT_WEBHOOK_SECRET)) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Yetkisiz webhook." } }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as RcWebhook | null;
  if (!body?.event) return Response.json({ ok: false }, { status: 200 });
  const admin = createAdminClient();
  const key = webhookEventKey(body);
  const { error } = await admin.from("payment_events").insert({ provider: "revenuecat", event_key: key, payload: body });
  if (error) return Response.json({ ok: true, duplicate: true });
  const appUserId = webhookAppUserId(body);
  const oneTime = oneTimePurchaseFromWebhook(body);
  if (oneTime) {
    const { error: pErr } = await admin.from("purchases").insert(oneTime);
    if (pErr) return Response.json({ ok: false, error: "purchase_insert_failed" }, { status: 500 });
  }
  if (appUserId) {
    try {
      await syncSubscriptionFromRevenueCat(appUserId);
      await admin.from("payment_events").update({ processed_at: new Date().toISOString() }).eq("event_key", key);
    } catch {
      // işlenmemiş kalır; bir sonraki olay veya istemci sync'i düzeltir
    }
  }
  return Response.json({ ok: true });
}
