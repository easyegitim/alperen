import "server-only";

import { PLANS, type SubscriptionPlanId } from "@/lib/config/plans";
import { iyzicoRequest, type IyzicoResponse } from "./iyzico";

// Yollar ve alan adları resmi iyzipay-node SDK'sından (resources/Subscription*.js, requests/*Subscription*.js).

export type Buyer = {
  name: string;
  surname: string;
  email: string;
  gsmNumber: string;
  /** AÇIK (SPEC 15.2 adım 3): iyzico'nun zorunlu tutup tutmadığı teyit edilecek. */
  identityNumber?: string;
  city: string;
  address: string;
  zipCode?: string;
};

function customerBody(b: Buyer) {
  const addr = { contactName: `${b.name} ${b.surname}`, city: b.city, country: "Turkey", address: b.address, zipCode: b.zipCode };
  return {
    name: b.name,
    surname: b.surname,
    identityNumber: b.identityNumber,
    email: b.email,
    gsmNumber: b.gsmNumber,
    billingAddress: addr,
    shippingAddress: addr,
  };
}

export function pricingPlanRef(plan: SubscriptionPlanId): string {
  const ref = process.env[PLANS[plan].envRef];
  if (!ref) throw new Error(`${PLANS[plan].envRef} eksik`);
  return ref;
}

export type CheckoutInit = IyzicoResponse & { checkoutFormContent?: string; token?: string; tokenExpireTime?: number };

/** POST /v2/subscription/checkoutform/initialize — deneme süresi yok; kart bilgisi iyzico formunda girilir. */
export function initializeSubscriptionCheckout(params: { plan: SubscriptionPlanId; buyer: Buyer; conversationId: string; callbackUrl: string }) {
  return iyzicoRequest<CheckoutInit>("POST", "/v2/subscription/checkoutform/initialize", {
    locale: "tr",
    conversationId: params.conversationId,
    callbackUrl: params.callbackUrl,
    pricingPlanReferenceCode: pricingPlanRef(params.plan),
    subscriptionInitialStatus: "ACTIVE",
    customer: customerBody(params.buyer),
  });
}

/** GET /v2/subscription/checkoutform/{token} — formun sonucu (abonelik referansı vb.). Yanıt alanları `data` altında döner. */
export function retrieveSubscriptionCheckout(token: string) {
  return iyzicoRequest<IyzicoResponse & { data?: Record<string, unknown> }>("GET", `/v2/subscription/checkoutform/${encodeURIComponent(token)}`);
}

/** GET /v2/subscription/subscriptions/{ref} — durum yeniden çekilir; webhook gövdesine tek başına güvenilmez. */
export function retrieveSubscription(subscriptionReferenceCode: string) {
  return iyzicoRequest<IyzicoResponse & { data?: Record<string, unknown> }>("GET", `/v2/subscription/subscriptions/${encodeURIComponent(subscriptionReferenceCode)}`);
}

/** POST /v2/subscription/subscriptions/{ref}/cancel */
export function cancelSubscription(subscriptionReferenceCode: string) {
  return iyzicoRequest("POST", `/v2/subscription/subscriptions/${encodeURIComponent(subscriptionReferenceCode)}/cancel`);
}

/**
 * iyzico abonelik yanıtından (data) durum ve dönem alanlarını güvenli okur. Alan adları belgeye göre teyit edilecek (AÇIK);
 * bulunamazsa null döner ve dönem plandan hesaplanır (lib/billing/sync.ts).
 */
export function parseRemoteSubscription(data: Record<string, unknown> | undefined): { ref: string | null; customerRef: string | null; status: string | null; periodStart: string | null; periodEnd: string | null } {
  if (!data) return { ref: null, customerRef: null, status: null, periodStart: null, periodEnd: null };
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : null);
  const ms = (k: string) => (typeof data[k] === "number" ? new Date(data[k] as number).toISOString() : str(k) ? new Date(str(k) as string).toISOString() : null);
  // Sipariş listesi varsa son siparişin dönemi
  const orders = Array.isArray(data.orders) ? (data.orders as Record<string, unknown>[]) : [];
  const last = orders.length ? orders[orders.length - 1] : undefined;
  const periodStart = ms("startDate") ?? (last && typeof last.startPeriod === "number" ? new Date(last.startPeriod).toISOString() : null);
  const periodEnd = ms("endDate") ?? (last && typeof last.endPeriod === "number" ? new Date(last.endPeriod).toISOString() : null);
  return {
    ref: str("referenceCode") ?? str("subscriptionReferenceCode"),
    customerRef: str("customerReferenceCode"),
    status: str("subscriptionStatus") ?? str("status"),
    periodStart,
    periodEnd,
  };
}

// ---- Tek seferlik ödeme: week_pass (AÇIK, FEATURE_WEEK_PASS) ve one_time_report (KB P#21). Standart Checkout Form, otomatik yenilenmez.
export function initializeOneTimeCheckout(params: { buyer: Buyer; userId: string; conversationId: string; callbackUrl: string; priceTry: number; name: string; ip: string; itemId?: string }) {
  const addr = { contactName: `${params.buyer.name} ${params.buyer.surname}`, city: params.buyer.city, country: "Turkey", address: params.buyer.address, zipCode: params.buyer.zipCode };
  const price = params.priceTry.toFixed(1);
  return iyzicoRequest<CheckoutInit>("POST", "/payment/iyzipos/checkoutform/initialize/auth/ecom", {
    locale: "tr",
    conversationId: params.conversationId,
    price,
    paidPrice: price,
    currency: "TRY",
    basketId: params.conversationId,
    paymentGroup: "SUBSCRIPTION",
    callbackUrl: params.callbackUrl,
    buyer: {
      id: params.userId,
      name: params.buyer.name,
      surname: params.buyer.surname,
      identityNumber: params.buyer.identityNumber,
      email: params.buyer.email,
      gsmNumber: params.buyer.gsmNumber,
      registrationAddress: params.buyer.address,
      city: params.buyer.city,
      country: "Turkey",
      zipCode: params.buyer.zipCode,
      ip: params.ip,
    },
    shippingAddress: addr,
    billingAddress: addr,
    basketItems: [{ id: params.itemId ?? "week_pass", name: params.name, category1: "Dijital hizmet", itemType: "VIRTUAL", price }],
  });
}

export function retrieveOneTimeCheckout(token: string) {
  return iyzicoRequest<IyzicoResponse & { paymentStatus?: string; paymentId?: string; basketId?: string }>("POST", "/payment/iyzipos/checkoutform/auth/ecom/detail", { locale: "tr", token });
}
