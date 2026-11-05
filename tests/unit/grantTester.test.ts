import { describe, expect, it } from "vitest";
import { COMP_PERIOD_END, compSubscriptionRow, parseArgs } from "../../scripts/grant-tester";
import { isPremium } from "@/lib/billing/entitlement";

// Ekip içi test aboneliği (scripts/grant-tester.ts): satır şekli 0001 kısıtlarına uyar, hak isPremium ile açılır,
// geri alındığında kapanır. Ağ yok.

const NOW = new Date("2026-11-05T10:00:00.000Z");

describe("grant-tester", () => {
  it("grant: aktif, süresiz, sağlayıcı comp, mağaza/iyzico referansı yok; isPremium açık", () => {
    const row = compSubscriptionRow("u1", "grant", NOW);
    expect(row).toMatchObject({ user_id: "u1", provider: "comp", plan: "monthly", status: "active", provider_subscription_ref: null, current_period_end: COMP_PERIOD_END, cancel_at_period_end: false });
    expect(["weekly", "monthly", "yearly", "week_pass"]).toContain(row.plan);
    expect(isPremium({ status: row.status, current_period_end: row.current_period_end }, NOW)).toBe(true);
  });

  it("revoke: iptal, dönem şimdi biter; isPremium kapalı", () => {
    const row = compSubscriptionRow("u1", "revoke", NOW);
    expect(row.status).toBe("canceled");
    expect(row.current_period_end).toBe(NOW.toISOString());
    expect(isPremium({ status: row.status, current_period_end: row.current_period_end }, new Date(NOW.getTime() + 1000))).toBe(false);
  });

  it("argümanlar: e-posta zorunlu ve küçük harfe çevrilir; bayraklar okunur", () => {
    expect(parseArgs([])).toBeNull();
    expect(parseArgs(["--create"])).toBeNull();
    expect(parseArgs(["not-an-email"])).toBeNull();
    expect(parseArgs(["Test@Example.com", "--create"])).toEqual({ email: "test@example.com", create: true, revoke: false });
    expect(parseArgs(["a@b.co", "--revoke"])).toEqual({ email: "a@b.co", create: false, revoke: true });
  });
});
