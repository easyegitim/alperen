// SPEC 15.4 / SPEC-MOBILE M6: RevenueCat (App Store / Play) aboneliğini subscriptions satırına çevirir. Saf; birim testli.
// Kural: istemciden gelen hiçbir bilgi premium açmaz; yalnız RevenueCat webhook'u ve sunucunun RevenueCat'ten çektiği durum.
import type { SubscriptionRow } from "./sync";

export const REVENUECAT_ENTITLEMENT = "premium";

/** Mağaza ürün kimlikleri → plan (SPEC-MOBILE M6). Ürün kimliği içinde "weekly" vb. geçmesi yeterlidir. */
export function planFromProductId(productId: string | null | undefined): SubscriptionRow["plan"] | null {
  if (!productId) return null;
  const id = productId.toLowerCase();
  if (id.includes("week_pass") || id.includes("weekpass")) return "week_pass";
  if (id.includes("year")) return "yearly";
  if (id.includes("month")) return "monthly";
  if (id.includes("week")) return "weekly";
  return null;
}

/** RevenueCat REST v1 GET /v1/subscribers/{app_user_id} → subscriber alanları (yalnız kullanılanlar). */
export type RcSubscriber = {
  entitlements?: Record<string, { expires_date: string | null; product_identifier: string; purchase_date: string }>;
  subscriptions?: Record<string, { expires_date: string | null; purchase_date: string; unsubscribe_detected_at?: string | null; billing_issues_detected_at?: string | null; store?: string; period_type?: string }>;
  non_subscriptions?: Record<string, { purchase_date: string; store?: string }[]>;
};

export type RcMapped = { row: SubscriptionRow; productId: string } | null;

/**
 * Abone bilgisinden satır: "premium" yetkisi varsa onun ürünü esas alınır.
 * - süresi gelecekte ve iptal algılanmamış → active
 * - süresi gelecekte ve iptal algılanmış → active + cancel_at_period_end (dönem sonuna kadar erişim)
 * - fatura sorunu ve süre geçmiş → past_due (RevenueCat ek süresi kendi tarafında; biz süreye bakarız)
 * - süresi geçmiş → expired
 * Yetki hiç yoksa null (satır değişmez).
 */
export function mapSubscriber(sub: RcSubscriber, now: Date = new Date()): RcMapped {
  const ent = sub.entitlements?.[REVENUECAT_ENTITLEMENT];
  if (!ent) return null;
  const productId = ent.product_identifier;
  const plan = planFromProductId(productId);
  if (!plan) return null;
  const s = sub.subscriptions?.[productId];
  const expires = ent.expires_date ? new Date(ent.expires_date) : null;
  const start = s?.purchase_date ?? ent.purchase_date;
  const unsubscribed = Boolean(s?.unsubscribe_detected_at);
  const billingIssue = Boolean(s?.billing_issues_detected_at);
  const future = expires ? expires > now : plan === "week_pass" ? false : true;

  let status: SubscriptionRow["status"];
  if (future) status = "active";
  else if (billingIssue) status = "past_due";
  else status = "expired";

  return {
    productId,
    row: {
      plan,
      status,
      current_period_start: start ? new Date(start).toISOString() : null,
      current_period_end: expires ? expires.toISOString() : null,
      cancel_at_period_end: unsubscribed,
    },
  };
}

// ── Tek seferlik ürün (CONTRACTS_V2 S3.3.7; KB P#21): mağaza ürün kimliği → one_time_report ─────────────────────────
// Ürün kimlikleri AÇIK (kurucu; S3.7): env REVENUECAT_PRODUCT_ONE_TIME_REPORT_ID ve …_PROMO_ID. Env yoksa sezgisel eşleme
// ("one_time" / "report" / "rapor" geçen kimlik). Abonelik kimlikleri planFromProductId ile aynı kalır.
export type OneTimeProductId = "one_time_report";

export function productFromStoreId(productId: string | null | undefined, env: Record<string, string | undefined> = process.env): OneTimeProductId | null {
  if (!productId) return null;
  const configured = [env.REVENUECAT_PRODUCT_ONE_TIME_REPORT_ID, env.REVENUECAT_PRODUCT_ONE_TIME_REPORT_PROMO_ID].filter((v): v is string => Boolean(v?.trim()));
  if (configured.some((id) => id.trim() === productId)) return "one_time_report";
  if (configured.length > 0) return null;
  const id = productId.toLowerCase();
  return id.includes("one_time") || id.includes("onetime") || id.includes("report") || id.includes("rapor") ? "one_time_report" : null;
}

/** Webhook gövdesi (RevenueCat v1 webhook): yalnız kullanılan alanlar. */
export type RcWebhook = {
  api_version?: string;
  event?: { id?: string; type?: string; app_user_id?: string; original_app_user_id?: string; environment?: string; product_id?: string; store?: string };
};

export type OneTimePurchaseInsert = { user_id: string; product: OneTimeProductId; provider: "revenuecat"; status: "paid"; analysis_id: null };

/**
 * NON_RENEWING_PURCHASE olayı tek seferlik rapor ürünüyse purchases satırı (analysis_id null: /api/analyses/[id]/run
 * promoteAndStart bağlar). Tekrar koruması payment_events.event_key'dedir (webhook rotası önce onu yazar). İstemci
 * sonucu hiçbir şey açmaz; yalnız bu webhook/sunucu doğrulaması yazar.
 */
export function oneTimePurchaseFromWebhook(body: RcWebhook, env: Record<string, string | undefined> = process.env): OneTimePurchaseInsert | null {
  const e = body.event;
  if (!e || e.type !== "NON_RENEWING_PURCHASE") return null;
  const userId = webhookAppUserId(body);
  const product = productFromStoreId(e.product_id, env);
  if (!userId || !product) return null;
  return { user_id: userId, product, provider: "revenuecat", status: "paid", analysis_id: null };
}

export function webhookAppUserId(body: RcWebhook): string | null {
  const e = body.event;
  const id = e?.app_user_id || e?.original_app_user_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** payment_events.event_key (tekrar koruması). event.id yoksa tür+kullanıcı+zaman. */
export function webhookEventKey(body: RcWebhook): string {
  const e = body.event ?? {};
  return `revenuecat:${e.id ?? `${e.type ?? "unknown"}:${e.app_user_id ?? ""}:${Date.now()}`}`;
}

/** Sabit zamanlı karşılaştırma yerine uzunluk + içerik; gizli değer header'da düz metin (RevenueCat panelinde tanımlanır). */
export function isAuthorizedWebhook(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const value = header.replace(/^Bearer\s+/i, "");
  if (value.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < value.length; i++) diff |= value.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}
