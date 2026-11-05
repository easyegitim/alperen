// RevenueCat SDK sarmalayıcı (SPEC 15.4 / SPEC-MOBILE M6). Satın alma sonucu premium AÇMAZ: sunucu POST /api/billing/sync ile
// RevenueCat'ten durumu çeker ve subscriptions/purchases'a yazar; istemci yalnız GET /api/billing/status okur.
import { Platform } from "react-native";
import Purchases, { LOG_LEVEL, type PurchasesPackage } from "react-native-purchases";
import type { StorePackage } from "./plans";
import type { StorePackageLike } from "./products";

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "";

export function isPurchasesConfigured(): boolean {
  return Boolean(Platform.OS === "ios" ? IOS_KEY : ANDROID_KEY);
}

let configuredFor: string | null = null;

/** Uygulama kullanıcı kimliği = Supabase kullanıcı kimliği (webhook app_user_id). */
export async function ensurePurchases(userId: string): Promise<boolean> {
  const apiKey = Platform.OS === "ios" ? IOS_KEY : ANDROID_KEY;
  if (!apiKey) return false;
  if (configuredFor === null) {
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.WARN : LOG_LEVEL.ERROR);
    Purchases.configure({ apiKey, appUserID: userId });
    configuredFor = userId;
    return true;
  }
  if (configuredFor !== userId) {
    await Purchases.logIn(userId);
    configuredFor = userId;
  }
  return true;
}

/** Mevcut teklifin paketleri: ham SDK paketleri + saf eşleme için sadeleştirilmiş görünüm (ürün kategorisi dahil, v2). */
export async function loadPackages(): Promise<{ packages: PurchasesPackage[]; store: StorePackage[]; storeV2: StorePackageLike[] }> {
  const offerings = await Purchases.getOfferings();
  const packages = offerings.current?.availablePackages ?? [];
  return {
    packages,
    store: packages.map((p) => ({ identifier: p.identifier, product: { identifier: p.product.identifier, priceString: p.product.priceString, title: p.product.title } })),
    storeV2: packages.map((p) => ({ identifier: p.identifier, product: { identifier: p.product.identifier, priceString: p.product.priceString, title: p.product.title, productCategory: p.product.productCategory ?? null } })),
  };
}

export type PurchaseOutcome = "purchased" | "cancelled" | "error";

export async function purchase(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  try {
    await Purchases.purchasePackage(pkg);
    return "purchased";
  } catch (e) {
    const err = e as { userCancelled?: boolean | null };
    return err?.userCancelled ? "cancelled" : "error";
  }
}

export async function restore(): Promise<boolean> {
  try {
    await Purchases.restorePurchases();
    return true;
  } catch {
    return false;
  }
}
