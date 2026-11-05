import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN_ID, ENTITLEMENTS, PLANS, SUBSCRIPTION_PLAN_IDS, formatTry, weeklyEquivalentTry } from "@/lib/config/plans";

describe("PLANS (SPEC 5.1, KARAR)", () => {
  it("x = 250; aylık 3x, yıllık 35x", () => {
    expect(PLANS.weekly.priceTry).toBe(250);
    expect(PLANS.monthly.priceTry).toBe(250 * 3);
    expect(PLANS.yearly.priceTry).toBe(250 * 35);
    expect(PLANS.week_pass.priceTry).toBe(250);
    expect(PLANS.week_pass.oneTimeDays).toBe(7);
  });

  it("iyzico periyotları ve env referansları", () => {
    expect(PLANS.weekly.iyzicoInterval).toBe("WEEKLY");
    expect(PLANS.monthly.iyzicoInterval).toBe("MONTHLY");
    expect(PLANS.yearly.iyzicoInterval).toBe("YEARLY");
    expect(PLANS.week_pass.featureFlag).toBe("FEATURE_WEEK_PASS");
  });

  it("haftalık eşdeğerler SPEC tablosuyla uyumlu (250 / ~173 / ~168)", () => {
    expect(weeklyEquivalentTry("weekly")).toBe(250);
    expect(weeklyEquivalentTry("monthly")).toBe(173);
    expect(weeklyEquivalentTry("yearly")).toBe(168);
  });

  it("yıllık plan önceden seçili, üç abonelik planı sıralı", () => {
    expect(DEFAULT_PLAN_ID).toBe("yearly");
    expect(SUBSCRIPTION_PLAN_IDS).toEqual(["weekly", "monthly", "yearly"]);
  });

  it("TL biçimlendirme Türkçe binlik ayracı kullanır", () => {
    expect(formatTry(8750)).toMatch(/8\.750/);
    expect(formatTry(250)).toMatch(/250/);
  });
});

describe("ENTITLEMENTS (SPEC 5.2)", () => {
  it("ücretsiz: toplam 1 analiz, deneme yok", () => {
    expect(ENTITLEMENTS.free).toEqual({ analysesLifetime: 1, tryonsPerWindow: 0, reportRegens: 0 });
  });
  it("premium: 7 günlük pencerede 1 analiz, 10 deneme, 2 yeniden üretim", () => {
    expect(ENTITLEMENTS.premium).toEqual({ analysesPerWindow: 1, tryonsPerWindow: 10, reportRegens: 2, windowDays: 7 });
  });
});

// ─── v2 ürünler (CONTRACTS_V2 §6) ───────────────────────────────────────────────────────────────────────────────────
import { ENTITLEMENTS_V2, OFFER, getOfferDurationHours, PRODUCTS, PRODUCT_IDS, PRODUCT_ORDER, PRODUCT_PRICE_PLACEHOLDERS, getProductPrice, listedProducts } from "@/lib/config/plans";

describe("PRODUCTS v2 (KB P#21, §11.1 AÇIK)", () => {
  it("dört ürün; tek seferlik rapor = 1 analiz + 1 rapor, yeniden üretim 0 (Ç10); yıllık bayrakla", () => {
    expect(PRODUCT_IDS).toEqual(["one_time_report", "weekly", "monthly", "yearly"]);
    expect(PRODUCTS.one_time_report).toMatchObject({ kind: "one_time", periodDays: null, grants: { analysesTotal: 1, reports: 1, reportRegens: 0 } });
    expect(PRODUCTS.yearly.featureFlag).toBe("FEATURE_YEARLY_PLAN");
    for (const id of PRODUCT_IDS) {
      expect(PRODUCTS[id].id).toBe(id);
      expect(PRODUCTS[id].grants.reportRegens).toBe(0);
      expect(PRODUCTS[id].providerRefEnv.regular).not.toBe(PRODUCTS[id].providerRefEnv.promo);
    }
    expect(PRODUCTS.weekly.providerRefEnv.regular).toBe(PLANS.weekly.envRef);
  });

  it("fiyatlar yer tutucu: tek seferlik ve tanıtım null; abonelikler SPEC 5.1 değerleri; env geçersiz kılar", () => {
    expect(PRODUCT_PRICE_PLACEHOLDERS.one_time_report).toEqual({ regularTry: null, promoTry: null, placeholder: true });
    expect(PRODUCT_PRICE_PLACEHOLDERS.weekly.regularTry).toBe(PLANS.weekly.priceTry);
    expect(getProductPrice("one_time_report", {})).toEqual({ regularTry: null, promoTry: null, placeholder: true });
    expect(getProductPrice("one_time_report", { PRODUCT_PRICE_ONE_TIME_REPORT_TRY: "149", PRODUCT_PROMO_PRICE_ONE_TIME_REPORT_TRY: "99" })).toEqual({ regularTry: 149, promoTry: 99, placeholder: false });
    expect(getProductPrice("weekly", { PRODUCT_PROMO_PRICE_WEEKLY_TRY: "199" })).toEqual({ regularTry: 250, promoTry: 199, placeholder: true });
    expect(getProductPrice("weekly", { PRODUCT_PRICE_WEEKLY_TRY: "abc" })).toEqual(PRODUCT_PRICE_PLACEHOLDERS.weekly);
    expect(getProductPrice("weekly", { PRODUCT_PRICE_WEEKLY_TRY: "-5" })).toEqual(PRODUCT_PRICE_PLACEHOLDERS.weekly);
  });

  it("listelenen ürünler: yıllık yalnız bayrakla; sıra tek seferlik → haftalık → aylık → yıllık", () => {
    expect(listedProducts({})).toEqual(["one_time_report", "weekly", "monthly"]);
    expect(listedProducts({ FEATURE_YEARLY_PLAN: "true" })).toEqual([...PRODUCT_ORDER]);
  });

  it("cihaz analizi sınırsız ve kotaya sayılmaz; davet kilidi 5 davet = yalnız genel skor; teklif süreli", () => {
    expect(ENTITLEMENTS_V2.deviceOnly).toEqual({ analyses: "unlimited", quotaCounted: false });
    expect(ENTITLEMENTS_V2.referral).toEqual({ invitesRequired: 5, unlocks: "overall_only" });
    expect(OFFER).toEqual({ durationHours: 24, placeholder: true });
    expect(getOfferDurationHours({})).toBe(24);
    expect(getOfferDurationHours({ OFFER_DURATION_HOURS: "48" })).toBe(48);
    expect(getOfferDurationHours({ OFFER_DURATION_HOURS: "0" })).toBe(24);
  });
});
