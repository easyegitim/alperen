import type { OfferResponse } from "@/lib/billing/offer";
import { afterPurchase, defaultProduct, packagesToProducts, productFromStoreId, type StorePackageLike } from "@/mobile/src/features/billing/products";
import { DEFAULT_PRODUCTS, isOfferActive, offerSkewMs, productViews, remainingMinutes, remainingMs } from "@/mobile/src/features/paywall/offer";

const pk = (id: string, product: string, price: string, productCategory: string | null = null): StorePackageLike => ({ identifier: id, product: { identifier: product, priceString: price, title: product, productCategory } });

describe("mağaza ürünleri → v2 ürünler (KB §3.4 P#21; CONTRACTS_V2 §6)", () => {
  it("env tam eşleşme önce; yoksa sözcük tahmini; week_pass v2'de yok", () => {
    const env = { EXPO_PUBLIC_REVENUECAT_PRODUCT_ONE_TIME_REPORT_ID: "aura.rpt.1", EXPO_PUBLIC_REVENUECAT_PRODUCT_ONE_TIME_REPORT_PROMO_ID: "aura.rpt.intro" };
    expect(productFromStoreId("aura.rpt.1", env)).toEqual({ product: "one_time_report", promo: false });
    expect(productFromStoreId("aura.rpt.intro", env)).toEqual({ product: "one_time_report", promo: true });
    expect(productFromStoreId("aura_weekly", {})).toEqual({ product: "weekly", promo: false });
    expect(productFromStoreId("aura_monthly_promo", {})).toEqual({ product: "monthly", promo: true });
    expect(productFromStoreId("aura_yearly", {})).toEqual({ product: "yearly", promo: false });
    expect(productFromStoreId("aura_one_time_report", {})).toEqual({ product: "one_time_report", promo: false });
    expect(productFromStoreId("aura_week_pass", {})).toBeNull();
    expect(productFromStoreId("coins", {})).toBeNull();
    expect(productFromStoreId(null, {})).toBeNull();
  });

  it("paketler PRODUCT_ORDER sırasıyla, listelenenlerle sınırlı, kategori uyumsuzu atlar, tanıtım tercihi", () => {
    const packages = [
      pk("$rc_annual", "aura_yearly", "₺8.750,00", "SUBSCRIPTION"),
      pk("$rc_monthly", "aura_monthly", "₺750,00", "SUBSCRIPTION"),
      pk("rpt", "aura_report", "₺150,00", "NON_SUBSCRIPTION"),
      pk("rpt_promo", "aura_report_promo", "₺99,00", "NON_SUBSCRIPTION"),
      pk("rpt_sub", "aura_report_sub", "₺1,00", "SUBSCRIPTION"),
      pk("$rc_weekly", "aura_weekly", "₺250,00", "SUBSCRIPTION"),
      pk("bad", "aura_weekly_consumable", "₺1,00", "NON_SUBSCRIPTION"),
    ];
    const listed = packagesToProducts(packages, ["one_time_report", "weekly", "monthly"], { env: {} });
    expect(listed.map((o) => o.product)).toEqual(["one_time_report", "weekly", "monthly"]);
    expect(listed[0]).toMatchObject({ packageId: "rpt", promo: false, priceString: "₺150,00" });
    expect(listed[1].packageId).toBe("$rc_weekly");
    const promo = packagesToProducts(packages, ["one_time_report", "weekly"], { promoPreferred: true, env: {} });
    expect(promo[0]).toMatchObject({ packageId: "rpt_promo", promo: true });
    const withYearly = packagesToProducts(packages, ["one_time_report", "weekly", "monthly", "yearly"], { env: {} });
    expect(withYearly.map((o) => o.product)).toContain("yearly");
  });

  it("varsayılan seçim: analiz bağlamında tek seferlik rapor, yoksa haftalık; istek parametresi önce", () => {
    const options = packagesToProducts([pk("r", "aura_report", "₺1", "NON_SUBSCRIPTION"), pk("w", "aura_weekly", "₺2"), pk("m", "aura_monthly", "₺3")], undefined, { env: {} });
    expect(defaultProduct(options, "an1")).toBe("one_time_report");
    expect(defaultProduct(options, null)).toBe("weekly");
    expect(defaultProduct(options, "an1", "monthly")).toBe("monthly");
    expect(defaultProduct(options, "an1", "yearly")).toBe("one_time_report");
    expect(defaultProduct([], null)).toBeNull();
  });

  it("satın alma sonucu istemcide premium AÇMAZ: yalnız sunucu sync/status hak verir", () => {
    expect(afterPurchase("cancelled", null, null, null)).toBe("cancelled");
    expect(afterPurchase("error", null, null, null)).toBe("error");
    // mağaza "purchased" dedi ama sunucu henüz görmedi → pending
    expect(afterPurchase("purchased", null, null, null)).toBe("pending");
    expect(afterPurchase("purchased", { premium: false, plan: null, periodEnd: null }, null, null)).toBe("pending");
    expect(afterPurchase("purchased", { premium: true, plan: "weekly", periodEnd: "2026-12-01" }, null, null)).toBe("entitled");
    // analiz bağlamında yalnız o analizin hakkı sayılır (tek seferlik rapor bağlanmalı)
    const status = { premium: false, plan: null, periodEnd: null, cancelAtPeriodEnd: false, status: null, analysisEntitled: true };
    expect(afterPurchase("purchased", { premium: false, plan: null, periodEnd: null }, status, "an1")).toBe("entitled");
    expect(afterPurchase("purchased", { premium: true, plan: "weekly", periodEnd: null }, { ...status, analysisEntitled: false }, "an1")).toBe("pending");
  });
});

describe("sunucu süreli teklif (KB P#18): sayaç sunucu saatine göre", () => {
  const offer: OfferResponse = {
    active: true,
    startedAt: "2026-11-04T10:00:00Z",
    expiresAt: "2026-11-05T10:00:00Z",
    serverNow: "2026-11-04T12:00:00Z",
    remainingMs: 22 * 3_600_000,
    promoProduct: "one_time_report",
    regularProduct: "one_time_report",
    currentProduct: "one_time_report",
    prices: {
      one_time_report: { regularTry: 199, promoTry: 149, placeholder: false },
      weekly: { regularTry: 250, promoTry: null, placeholder: true },
      monthly: { regularTry: 750, promoTry: null, placeholder: true },
    },
  };

  it("cihaz saati 1 saat geri olsa da kalan süre sunucuya göre 22 saat; bitince 0 ve pasif", () => {
    const deviceNow = new Date("2026-11-04T11:00:00Z").getTime();
    const skew = offerSkewMs(offer, deviceNow);
    expect(skew).toBe(3_600_000);
    expect(remainingMs(offer, skew, deviceNow)).toBe(22 * 3_600_000);
    expect(remainingMinutes(remainingMs(offer, skew, deviceNow))).toBe(22 * 60);
    expect(isOfferActive(offer, skew, deviceNow)).toBe(true);
    const later = deviceNow + 22 * 3_600_000 + 1;
    expect(remainingMs(offer, skew, later)).toBe(0);
    expect(isOfferActive(offer, skew, later)).toBe(false);
    expect(isOfferActive({ ...offer, active: false }, skew, deviceNow)).toBe(false);
  });

  it("ürün görünümleri: tanıtım yalnız aktifken ve tanıtım ürününde; bitince normal fiyat; teklif yoksa yer tutucu", () => {
    const active = productViews(offer, true);
    expect(active.map((v) => v.id)).toEqual(["one_time_report", "weekly", "monthly"]);
    expect(active[0]).toEqual({ id: "one_time_report", priceTry: 149, struckTry: 199, promo: true, placeholder: false });
    expect(active[1]).toMatchObject({ priceTry: 250, struckTry: null, promo: false, placeholder: true });
    const ended = productViews(offer, false);
    expect(ended[0]).toMatchObject({ priceTry: 199, struckTry: null, promo: false });
    const none = productViews(null, false);
    expect(none.map((v) => v.id)).toEqual(DEFAULT_PRODUCTS);
    expect(none[0]).toMatchObject({ priceTry: null, placeholder: true });
  });
});
