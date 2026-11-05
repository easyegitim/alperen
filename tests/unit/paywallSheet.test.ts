import { describe, expect, it } from "vitest";
import tr from "@/messages/tr.json";
import { paywallContext, productViews } from "@/components/paywall/PaywallSheet";
import { illustrationVariant } from "@/components/paywall/IllustrativeBeforeAfter";
import type { OfferResponse } from "@/lib/billing/offer";
import { PAYWALL_TRIGGERS } from "@/lib/config/paywall";
import { SUB_KEYS_V2 } from "@/lib/config/teaser";

const PRICE = /₺|TL/;

describe("paywallContext (UI spec §4.1)", () => {
  it("her tetikleyici bir bağlam satırına eşlenir (kaşlar dahil)", () => {
    expect(paywallContext("score_main")).toEqual({ key: "score" });
    expect(paywallContext("score_potential")).toEqual({ key: "potential" });
    expect(paywallContext("improve_first")).toEqual({ key: "improve" });
    expect(paywallContext("measurements")).toEqual({ key: "measurements" });
    expect(paywallContext("plan")).toEqual({ key: "plan" });
    expect(paywallContext("plan_page")).toEqual({ key: "plan" });
    for (const k of SUB_KEYS_V2) expect(paywallContext(`sub_${k}`)).toEqual({ key: "sub", sub: k });
    for (const tr0 of PAYWALL_TRIGGERS) expect(tr.paywall.context[paywallContext(tr0).key]).toBeTruthy();
  });
});

describe("sayfa 1 tek fiyat satırı (flow.spec: dialog içinde tek ₺|TL öğesi) ve KB §3.4 dili", () => {
  it("anchor dışındaki sayfa 1 metinlerinde fiyat yok; 'ücretsiz/bedava' ve garanti yok", () => {
    const p = tr.paywall.v2;
    const page1 = [p.title, p.lead, p.eyebrow, p.benefitsTitle, p.benefitsAria, p.illustrativeLabel, p.offerTitle, p.offerEnded, p.offerRemaining, p.offerUnavailable, p.seeProducts, p.paidNote, p.pricePending, tr.common.close, tr.paywall.methodLink, ...Object.values(p.benefits), ...Object.values(p.beforeAfter), ...Object.values(tr.paywall.context), ...Object.values(tr.analysis.sub)];
    for (const s of page1) expect(s).not.toMatch(PRICE);
    expect(p.anchor).toContain("{oneTime}");
    expect(p.anchor).toContain("{weekly}");
    const all = JSON.stringify(p).toLocaleLowerCase("tr-TR");
    expect(all).not.toMatch(/ücretsiz|bedava|garanti/);
  });
  it("ürünler: tek seferlik rapor + haftalık + aylık (+ yıllık bayrakla); fayda listesi 4 madde", () => {
    expect(Object.keys(tr.paywall.v2.products)).toEqual(["one_time_report", "weekly", "monthly", "yearly"]);
    expect(Object.keys(tr.paywall.v2.benefits)).toEqual(["b1", "b2", "b3", "b4"]);
  });
});

describe("productViews: teklif + fiyat görünümü", () => {
  const offer: OfferResponse = {
    active: true,
    startedAt: "2026-11-04T10:00:00Z",
    expiresAt: "2026-11-05T10:00:00Z",
    serverNow: "2026-11-04T11:00:00Z",
    remainingMs: 23 * 3_600_000,
    promoProduct: "one_time_report",
    regularProduct: "one_time_report",
    currentProduct: "one_time_report",
    prices: { one_time_report: { regularTry: 199, promoTry: 149, placeholder: false }, weekly: { regularTry: 250, promoTry: null, placeholder: true }, monthly: { regularTry: 750, promoTry: null, placeholder: true } },
  };
  it("teklif yokken yer tutucu fiyatlar, yıllık listelenmez, tek seferlik 'fiyat belirlenecek' (null)", () => {
    const v = productViews(null, false);
    expect(v.map((x) => x.id)).toEqual(["one_time_report", "weekly", "monthly"]);
    expect(v[0]).toEqual({ id: "one_time_report", priceTry: null, struckTry: null, promo: false });
    expect(v[1].priceTry).toBe(250);
  });
  it("aktif teklifte tanıtım ürünü tanıtım fiyatı + üstü çizili normal; bitince normal fiyat", () => {
    const active = productViews(offer, true);
    expect(active[0]).toEqual({ id: "one_time_report", priceTry: 149, struckTry: 199, promo: true });
    expect(active[1]).toEqual({ id: "weekly", priceTry: 250, struckTry: null, promo: false });
    const ended = productViews(offer, false);
    expect(ended[0]).toEqual({ id: "one_time_report", priceTry: 199, struckTry: null, promo: false });
  });
  it("sunucunun fiyat listesi ürün sırasını ve yıllık bayrağını belirler", () => {
    const withYearly = productViews({ ...offer, prices: { ...offer.prices, yearly: { regularTry: 8750, promoTry: null, placeholder: true } } }, true);
    expect(withYearly.map((x) => x.id)).toEqual(["one_time_report", "weekly", "monthly", "yearly"]);
  });
});

describe("illüstratif önce/sonra (KB P#17, Ç14)", () => {
  it("figür cinsiyete göre; bilinmeyen → nötr; 18 altı yetişkin genç görünüm", () => {
    expect(illustrationVariant("male", "25_34")).toEqual({ figure: "male", adultYoung: false });
    expect(illustrationVariant("female", "18_24")).toEqual({ figure: "female", adultYoung: true });
    expect(illustrationVariant("unspecified", "under_18")).toEqual({ figure: "unspecified", adultYoung: true });
    expect(illustrationVariant(null, null).figure).toBe("unspecified");
  });
});
