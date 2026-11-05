import { packagesToPlans, storeManageUrl } from "@/mobile/src/features/billing/plans";

describe("mağaza paketleri → planlar (SPEC-MOBILE M6)", () => {
  const pk = (id: string, product: string, price: string) => ({ identifier: id, product: { identifier: product, priceString: price, title: product } });
  it("plan sırasıyla listeler, bilinmeyen ürünü ve kapalı week_pass'i atlar, tekrarları birleştirir", () => {
    const r = packagesToPlans([pk("$rc_annual", "aura_yearly", "₺8.750,00"), pk("$rc_monthly", "aura_monthly", "₺750,00"), pk("x", "aura_week_pass", "₺250,00"), pk("y", "coins", "₺1"), pk("$rc_weekly", "aura_weekly", "₺250,00"), pk("dup", "aura_weekly_v2", "₺260,00")]);
    expect(r.map((o) => o.plan)).toEqual(["weekly", "monthly", "yearly"]);
    expect(r[0].priceString).toBe("₺250,00");
    expect(packagesToPlans([pk("x", "aura_week_pass", "₺250,00")], true)[0]?.plan).toBe("week_pass");
  });
  it("mağaza yönetim bağlantısı platforma göre", () => {
    expect(storeManageUrl("ios")).toContain("apps.apple.com");
    expect(storeManageUrl("android")).toContain("play.google.com");
  });
});
