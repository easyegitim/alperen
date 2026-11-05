import { NextResponse } from "next/server";
import { renderContracts } from "@/lib/billing/contracts";
import { syncSubscriptionFromIyzico } from "@/lib/billing/store";
import { markPurchaseFailed, markPurchasePaid } from "@/lib/billing/purchases";
import { parseRemoteSubscription, retrieveOneTimeCheckout, retrieveSubscriptionCheckout } from "@/lib/billing/subscriptions";
import { periodEndFor } from "@/lib/billing/sync";
import { APP_NAME, APP_URL } from "@/lib/config/app";
import { PLANS } from "@/lib/config/plans";
import { pickReturnAnalysis, readCheckoutPayload, type CandidateRow } from "@/lib/billing/returnAnalysis";
import { createAdminClient } from "@/lib/db/admin";
import { sendEmail } from "@/lib/email/resend";

export const runtime = "nodejs";

/**
 * SPEC 14 / 15.2 adım 6: iyzico form POST (token) → sonuç iyzico'dan çekilir → subscriptions güncellenir → 302 /premium/sonuc.
 * Tarayıcıdan gelen hiçbir parametre premium açmaz; yalnız iyzico'dan çekilen durum.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const token = (form?.get("token") as string | null) ?? new URL(req.url).searchParams.get("token");
  if (!token) return redirectResult("failed");

  const admin = createAdminClient();
  const { data: ev } = await admin.from("payment_events").select("payload").eq("event_key", `checkout:${token}`).maybeSingle();
  const payload = readCheckoutPayload(ev?.payload);
  if (!payload.userId || !payload.plan) return redirectResult("failed");
  const userId = payload.userId;
  // Dönüş hedefi yalnız yönlendirme içindir; premium kararını etkilemez (UI spec §4.2).
  const back = async (status: "ok" | "failed" | "pending") => redirectResult(status, await returnAnalysisFor(admin, userId, payload.analysisId));

  try {
    if (payload.plan === "one_time_report") {
      // KB P#21 / CONTRACTS_V2 §2.3/2: hak purchases satırından; paid yalnız iyzico'dan çekilen durumla yazılır.
      if (!payload.purchaseId) return redirectResult("failed", payload.analysisId, "one_time_report");
      const r = await retrieveOneTimeCheckout(token);
      if (r.paymentStatus !== "SUCCESS") {
        await markPurchaseFailed(admin, payload.purchaseId);
        return redirectResult("failed", payload.analysisId, "one_time_report");
      }
      await markPurchasePaid(admin, payload.purchaseId, payload.analysisId ?? null);
      await admin.from("payment_events").update({ processed_at: new Date().toISOString() }).eq("event_key", `checkout:${token}`);
      const { data: u } = await admin.auth.admin.getUserById(userId);
      const email = u.user?.email;
      const priceTry = typeof (ev?.payload as { priceTry?: unknown } | null)?.priceTry === "number" ? ((ev?.payload as { priceTry: number }).priceTry) : undefined;
      if (email) {
        const c = await renderContracts({ plan: "one_time_report", priceTry, buyerName: email, buyerEmail: email, buyerAddress: "" });
        await sendEmail({ to: email, subject: `${APP_NAME} — Mesafeli Satış Sözleşmesi ve Ön Bilgilendirme Formu`, html: c.html }).catch(() => undefined);
      }
      return redirectResult("ok", payload.analysisId, "one_time_report");
    }
    if (payload.plan === "week_pass") {
      const r = await retrieveOneTimeCheckout(token);
      if (r.paymentStatus !== "SUCCESS") return back("failed");
      const start = new Date();
      const end = new Date(start.getTime() + PLANS.week_pass.oneTimeDays * 86_400_000);
      await admin
        .from("subscriptions")
        .update({ status: "active", provider_subscription_ref: `onetime:${r.paymentId ?? token}`, current_period_start: start.toISOString(), current_period_end: end.toISOString(), updated_at: start.toISOString() })
        .eq("user_id", payload.userId);
    } else {
      const r = await retrieveSubscriptionCheckout(token);
      const remote = parseRemoteSubscription(r.data);
      if (!remote.ref) return back("pending");
      await admin.from("subscriptions").update({ provider_subscription_ref: remote.ref, provider_customer_ref: remote.customerRef, updated_at: new Date().toISOString() }).eq("user_id", payload.userId);
      const synced = await syncSubscriptionFromIyzico(remote.ref);
      if (!synced || synced.status !== "active") {
        // Durum henüz ACTIVE değilse dönem plandan hesaplanır ve webhook/cron düzeltir (SPEC 15.2 adım 7).
        if (remote.status === "ACTIVE") {
          const start = new Date();
          await admin
            .from("subscriptions")
            .update({ status: "active", current_period_start: start.toISOString(), current_period_end: periodEndFor(payload.plan as "weekly" | "monthly" | "yearly", start).toISOString() })
            .eq("user_id", payload.userId);
        } else return back("pending");
      }
    }

    await admin.from("payment_events").update({ processed_at: new Date().toISOString() }).eq("event_key", `checkout:${token}`);

    // SPEC 15.3: sözleşme ve ön bilgilendirme e-postası
    const { data: u } = await admin.auth.admin.getUserById(payload.userId);
    const email = u.user?.email;
    if (email) {
      const c = await renderContracts({ plan: payload.plan as "weekly", buyerName: email, buyerEmail: email, buyerAddress: "" });
      await sendEmail({ to: email, subject: `${APP_NAME} — Mesafeli Satış Sözleşmesi ve Ön Bilgilendirme Formu`, html: c.html }).catch(() => undefined);
    }

    return back("ok");
  } catch {
    return back("pending");
  }
}

/** Checkout'taki analiz bu kullanıcıya ait ve tamamlanmışsa o; değilse en son tamamlanan analiz. Hata yönlendirmeyi bozmaz. */
async function returnAnalysisFor(admin: ReturnType<typeof createAdminClient>, userId: string, candidate: string | undefined): Promise<string | undefined> {
  try {
    let candidateRow: CandidateRow = null;
    if (candidate) {
      const { data } = await admin.from("analyses").select("id, user_id, status").eq("id", candidate).eq("user_id", userId).maybeSingle();
      candidateRow = data ? { id: String(data.id), user_id: String(data.user_id), status: String(data.status) } : null;
    }
    if (pickReturnAnalysis(candidate, candidateRow, null, userId)) return candidate;
    const { data: last } = await admin.from("analyses").select("id").eq("user_id", userId).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle();
    return pickReturnAnalysis(candidate, candidateRow, last?.id ? String(last.id) : null, userId);
  } catch {
    return undefined;
  }
}

function redirectResult(status: "ok" | "failed" | "pending", analysisId?: string, product?: "one_time_report") {
  const url = new URL("/premium/sonuc", APP_URL);
  url.searchParams.set("status", status);
  if (analysisId) url.searchParams.set("analysis", analysisId);
  if (product) url.searchParams.set("product", product);
  return NextResponse.redirect(url, 302);
}
