import "server-only";

// AccessV2 tek kaynak: lib/billing/{entitlement,purchases}.ts (W2 kalıcı sürümü). Bu dosya W3'ün geçici uygulamasının
// yerine yalnız yeniden dışa aktarır; yeni kod doğrudan lib/billing'den içe aktarmalı. Kaynak yalnız sunucu satırlarıdır
// (subscriptions, purchases, referrals); tarayıcıdan gelen "ödeme başarılı" hiçbir şeyi açmaz.
export { decideAccess, type AccessDetail, type PurchaseLike as Purchase } from "@/lib/billing/entitlement";
export { bindOneTimePurchase, getAccessV2 } from "@/lib/billing/purchases";
