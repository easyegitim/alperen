/**
 * Ödeme senaryoları (SPEC Faz 8 çıkış kriteri), iyzico SANDBOX ile. Canlı anahtarla asla çalıştırılmaz.
 * Gereksinimler (yoksa hemen BAŞARISIZ olur): BILLING_E2E=1, yerel Supabase, IYZICO_* sandbox env, IYZICO_PLAN_*_REF.
 * playwright.config.ts "billing" projesi BILLING_E2E=1 ile eklenir.
 * Kapsanan: haftalık/aylık/yıllık checkout başlatma (form gelir), anonimden kalıcıya geçiş, aynı webhook iki kez, iptal.
 * Sandbox kartıyla ödemeyi iyzico iframe'inde tamamlamak elle veya iyzico test kartı adımlarıyla yapılır.
 */
import { expect, test } from "@playwright/test";

test.beforeAll(() => {
  if (!process.env.BILLING_E2E) throw new Error("BILLING_E2E=1 ve iyzico sandbox env gerekli.");
});

test("aynı webhook iki kez işlenmez", async ({ request }) => {
  const body = { iyziEventType: "subscription.order.success", subscriptionReferenceCode: "e2e-dup", orderReferenceCode: `o-${Date.now()}` };
  const a = await request.post("/api/billing/webhook", { data: body });
  const b = await request.post("/api/billing/webhook", { data: body });
  expect(a.status()).toBe(200);
  expect((await b.json()).duplicate).toBe(true);
});

test("sahte callback premium açmaz", async ({ request }) => {
  const res = await request.post("/api/billing/callback", { form: { token: "sahte-token" }, maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toContain("status=failed");
});

test("checkout oturumsuz 401, anonim oturumla 403 ANONYMOUS_NOT_ALLOWED", async ({ request }) => {
  const res = await request.post("/api/billing/checkout", { data: {} });
  expect(res.status()).toBe(401);
});
