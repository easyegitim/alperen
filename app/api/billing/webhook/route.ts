import { syncSubscriptionFromIyzico } from "@/lib/billing/store";
import { webhookEventKey } from "@/lib/billing/sync";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

/**
 * SPEC 15.2 adım 7: bildirim payment_events'e yazılır; aynı event_key ikinci kez işlenmez; durum iyzico'dan yeniden çekilir.
 * Gövdeye tek başına güvenilmez. Her zaman 200 döner (iyzico tekrarlarını önlemek için); hatalar satıra işlenir.
 */
export async function POST(req: Request) {
  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return Response.json({ ok: false }, { status: 200 });
  const admin = createAdminClient();
  const key = webhookEventKey(payload);
  const { error } = await admin.from("payment_events").insert({ provider: "iyzico", event_key: key, payload });
  if (error) return Response.json({ ok: true, duplicate: true }); // unique ihlali = tekrar

  const ref = typeof payload.subscriptionReferenceCode === "string" ? payload.subscriptionReferenceCode : null;
  if (ref) {
    try {
      await syncSubscriptionFromIyzico(ref);
      await admin.from("payment_events").update({ processed_at: new Date().toISOString() }).eq("event_key", key);
    } catch {
      // işlenmemiş kalır; cron güvenlik ağı ve bir sonraki bildirim düzeltir
    }
  }
  return Response.json({ ok: true });
}
