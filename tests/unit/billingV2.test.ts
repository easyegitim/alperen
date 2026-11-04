import { describe, expect, it } from "vitest";
import { canConsumePurchaseFor, decideAccess, isEntitledForAnalysis, referralUnlocked, type PurchaseLike } from "@/lib/billing/entitlement";
import { effectivePriceTry, formatRemaining, getOfferProducts, newOfferRow, offerState } from "@/lib/billing/offer";

const paid = (over: Partial<PurchaseLike> = {}): PurchaseLike => ({ id: "p1", product: "one_time_report", analysis_id: null, status: "paid", ...over });
const OFF = { FEATURE_REFERRAL_UNLOCK: "false", FEATURE_PERCENTILE: "false" };

describe("isEntitledForAnalysis (CONTRACTS_V2 §2.3 hak kaynakları)", () => {
  it("aktif abonelik her analizi açar", () => {
    expect(isEntitledForAnalysis({ subscriptionActive: true, purchases: [] }, "a1")).toBe(true);
    expect(isEntitledForAnalysis({ subscriptionActive: true, purchases: [] }, null)).toBe(true);
  });
  it("bu analize bağlı ödenmiş tek seferlik rapor açar; başka analize bağlı olan açmaz", () => {
    expect(isEntitledForAnalysis({ subscriptionActive: false, purchases: [paid({ analysis_id: "a1" })] }, "a1")).toBe(true);
    expect(isEntitledForAnalysis({ subscriptionActive: false, purchases: [paid({ analysis_id: "a9" })] }, "a1")).toBe(false);
  });
  it("bağlanmamış ödenmiş satın alma hiçbir satırı AÇMAZ (yalnız yeni işte bağlanır); pending/failed/refunded de açmaz", () => {
    expect(isEntitledForAnalysis({ subscriptionActive: false, purchases: [paid()] }, "a1")).toBe(false);
    expect(isEntitledForAnalysis({ subscriptionActive: false, purchases: [paid()] }, null)).toBe(false);
    for (const status of ["pending", "failed", "refunded"]) expect(isEntitledForAnalysis({ subscriptionActive: false, purchases: [paid({ status })] }, "a1")).toBe(false);
  });
  it("tüketilmiş (consumed_at dolu) satın alma analiz silinip analysis_id null olsa da yeniden bağlanmaz", () => {
    const consumed = paid({ analysis_id: null, consumed_at: "2026-11-04T10:00:00.000Z" });
    expect(isEntitledForAnalysis({ subscriptionActive: false, purchases: [consumed] }, "a1")).toBe(false);
    expect(decideAccess({ subscriptionActive: false, purchases: [consumed], analysisId: "a1", referralsCompleted: 0, env: OFF }).unconsumedOneTimeId).toBeNull();
    expect(decideAccess({ subscriptionActive: false, purchases: [consumed, paid({ id: "p2" })], analysisId: "a1", referralsCompleted: 0, env: OFF }).unconsumedOneTimeId).toBe("p2");
  });
  it("abonelik ürünü purchases'ta olsa da tek başına açmaz (abonelik durumu subscriptions satırından gelir)", () => {
    expect(isEntitledForAnalysis({ subscriptionActive: false, purchases: [paid({ product: "weekly" })] }, "a1")).toBe(false);
  });
});

describe("decideAccess", () => {
  it("bağlanacak satın alma yalnız abonelik yokken ve analiz bağlı değilken; tek başına hak vermez", () => {
    const d = decideAccess({ subscriptionActive: false, purchases: [paid()], analysisId: "a1", referralsCompleted: 0, env: OFF });
    expect(d).toEqual({ entitled: false, referralUnlock: false, percentile: false, subscriptionActive: false, unconsumedOneTimeId: "p1" });
    expect(decideAccess({ subscriptionActive: true, purchases: [paid()], analysisId: "a1", referralsCompleted: 0, env: OFF }).unconsumedOneTimeId).toBeNull();
    expect(decideAccess({ subscriptionActive: false, purchases: [paid({ analysis_id: "a1" }), paid({ id: "p2" })], analysisId: "a1", referralsCompleted: 0, env: OFF }).unconsumedOneTimeId).toBeNull();
  });
  it("davet kilidi yalnız bayrakla ve 5 davette; hak vermez", () => {
    expect(referralUnlocked(5, { FEATURE_REFERRAL_UNLOCK: "true" })).toBe(true);
    expect(referralUnlocked(4, { FEATURE_REFERRAL_UNLOCK: "true" })).toBe(false);
    expect(referralUnlocked(99, OFF)).toBe(false);
    const d = decideAccess({ subscriptionActive: false, purchases: [], analysisId: "a1", referralsCompleted: 5, env: { FEATURE_REFERRAL_UNLOCK: "true", FEATURE_PERCENTILE: "true" } });
    expect(d.entitled).toBe(false);
    expect(d.referralUnlock).toBe(true);
    expect(d.percentile).toBe(true);
  });
});

describe("süreli teklif (KB P#18): sunucu saati, sıfırlanmaz, bitince normal ürün", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  it("yeni satır: süre env'den, yer tutucu 24 saat; ürünler yer tutucu tek seferlik rapor", () => {
    const r = newOfferRow("u1", now, {});
    expect(r.started_at).toBe(now.toISOString());
    expect(new Date(r.expires_at).getTime() - now.getTime()).toBe(24 * 3_600_000);
    expect(r.promo_product).toBe("one_time_report");
    expect(newOfferRow("u1", now, { OFFER_DURATION_HOURS: "48", OFFER_PROMO_PRODUCT: "weekly", OFFER_REGULAR_PRODUCT: "weekly" }).promo_product).toBe("weekly");
    expect(getOfferProducts({ OFFER_PROMO_PRODUCT: "bogus" }).promo).toBe("one_time_report");
  });
  it("aktif teklif: kalan süre sunucuya göre; bitince currentProduct normal ürün", () => {
    const row = newOfferRow("u1", now, {});
    const active = offerState(row, new Date(now.getTime() + 3_600_000), {});
    expect(active.active).toBe(true);
    expect(active.remainingMs).toBe(23 * 3_600_000);
    expect(active.currentProduct).toBe("one_time_report");
    const ended = offerState(row, new Date(now.getTime() + 25 * 3_600_000), {});
    expect(ended.active).toBe(false);
    expect(ended.remainingMs).toBe(0);
    expect(ended.currentProduct).toBe(ended.regularProduct);
  });
  it("tanıtım fiyatı yalnız aktif teklifte ve tanıtım ürününde; fiyat yoksa satış yok (null)", () => {
    const row = newOfferRow("u1", now, {});
    const env = { PRODUCT_PRICE_ONE_TIME_REPORT_TRY: "199", PRODUCT_PROMO_PRICE_ONE_TIME_REPORT_TRY: "149" };
    expect(effectivePriceTry("one_time_report", offerState(row, now, env), env)).toEqual({ priceTry: 149, promo: true });
    expect(effectivePriceTry("one_time_report", offerState(row, new Date(now.getTime() + 48 * 3_600_000), env), env)).toEqual({ priceTry: 199, promo: false });
    expect(effectivePriceTry("weekly", offerState(row, now, env), env)).toEqual({ priceTry: 250, promo: false });
    expect(effectivePriceTry("one_time_report", null, {})).toEqual({ priceTry: null, promo: false });
  });
  it("geri sayım metni", () => {
    expect(formatRemaining(0)).toBe("00:00:00");
    expect(formatRemaining(61_000)).toBe("00:01:01");
    expect(formatRemaining(23 * 3_600_000 + 59 * 60_000 + 59_000)).toBe("23:59:59");
    expect(formatRemaining(2 * 86_400_000 + 5_000)).toBe("2g 00:00:05");
    expect(formatRemaining(-5)).toBe("00:00:00");
  });
});

describe("canConsumePurchaseFor (bağlanmamış satın alma yalnız başlamamış satıra)", () => {
  it("hak varsa her durum; bağlanacak satın alma yalnız device_only/queued/failed; completed/running satır açılmaz", () => {
    expect(canConsumePurchaseFor({ entitled: true, unconsumedOneTimeId: null }, "completed")).toBe(true);
    for (const st of ["device_only", "queued", "failed"]) expect(canConsumePurchaseFor({ entitled: false, unconsumedOneTimeId: "p1" }, st)).toBe(true);
    for (const st of ["completed", "running", "processing"]) expect(canConsumePurchaseFor({ entitled: false, unconsumedOneTimeId: "p1" }, st)).toBe(false);
    expect(canConsumePurchaseFor({ entitled: false, unconsumedOneTimeId: null }, "device_only")).toBe(false);
  });
});
