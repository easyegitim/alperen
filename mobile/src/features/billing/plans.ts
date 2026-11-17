// Mağaza paketleri → plan eşlemesi ve mağaza yönetim bağlantıları. Saf; birim testli.
import { planFromProductId } from "@/lib/billing/revenuecat";
import { SUBSCRIPTION_PLAN_IDS, type SubscriptionPlanId } from "@/lib/config/plans";

export type StorePackage = { identifier: string; product: { identifier: string; priceString: string; title: string } };
export type PlanOption = { plan: SubscriptionPlanId | "week_pass"; packageId: string; productId: string; priceString: string };

/** Mevcut teklifin paketlerini plan sırasına göre listeler; eşleşmeyen ürünler atlanır. */
export function packagesToPlans(packages: readonly StorePackage[], weekPassEnabled = false): PlanOption[] {
  const out: PlanOption[] = [];
  for (const p of packages) {
    const plan = planFromProductId(p.product.identifier);
    if (!plan) continue;
    if (plan === "week_pass" && !weekPassEnabled) continue;
    if (out.some((o) => o.plan === plan)) continue;
    out.push({ plan, packageId: p.identifier, productId: p.product.identifier, priceString: p.product.priceString });
  }
  const order: string[] = [...SUBSCRIPTION_PLAN_IDS, "week_pass"];
  return out.sort((a, b) => order.indexOf(a.plan) - order.indexOf(b.plan));
}

/** Abonelik yönetimi mağaza sayfası (SPEC 15.4: uygulama içinden web ödemesine değil, mağazaya yönlendirme). */
export function storeManageUrl(platform: "ios" | "android" | string): string {
  return platform === "ios" ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions";
}
