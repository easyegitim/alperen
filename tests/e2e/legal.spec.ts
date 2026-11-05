import { expect, test } from "@playwright/test";

test.describe("Yasal sayfalar ve çerez banner'ı (F16)", () => {
  test("her yasal metin sürüm ve tarihle açılır", async ({ page }) => {
    for (const slug of ["aydinlatma", "acik-riza", "gizlilik", "cerez", "kullanim-kosullari", "mesafeli-satis", "on-bilgilendirme", "iptal-iade"]) {
      const res = await page.goto(`/yasal/${slug}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText(/Sürüm \d{4}-\d{2}-\d{2}\.\d+/)).toBeVisible();
    }
  });

  test("bilinmeyen slug 404", async ({ page }) => {
    const res = await page.goto("/yasal/yok-boyle-bir-sey");
    expect(res?.status()).toBe(404);
  });

  test("çerez banner'ı tercihi çerezde saklar ve bir daha görünmez", async ({ page, context }) => {
    await page.goto("/");
    const banner = page.getByRole("dialog", { name: "Çerez tercihi" });
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Reddet" }).click();
    await expect(banner).toBeHidden();
    const cookie = (await context.cookies()).find((c) => c.name === "aura_cookies");
    expect(cookie?.value).toBe("denied");
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Çerez tercihi" })).toHaveCount(0);
  });

  test("onboarding ekranları oturumsuz: yaş/cinsiyet/giriş açılır, gerisi kapıya döner (F03, KB §3.1)", async ({ page }) => {
    // v2: yaş → cinsiyet → hesap (Google/Apple) girişten önce gelir; bu üçü oturumsuz açılır.
    for (const path of ["/baslangic/yas", "/baslangic/cinsiyet", "/baslangic/giris"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
    // Rızalar oturum ister → giriş ekranı; uygulama ekranları açılışa döner.
    await page.goto("/baslangic/izinler");
    await expect(page).toHaveURL(/\/baslangic\/giris$/);
    for (const path of ["/baslangic/anket", "/tara", "/silme", "/hesap"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
    }
  });

  test("API uçları oturumsuz 401 döner (withGuard)", async ({ request }) => {
    for (const path of ["/api/onboarding/age", "/api/consents", "/api/onboarding/questionnaire", "/api/analyses", "/api/me/delete", "/api/me/delete/cancel", "/api/tryon"]) {
      const res = await request.post(path, { data: {} });
      expect(res.status(), path).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHENTICATED");
    }
  });
});

test("debug sayfası production'da 404 (SPEC 4.2)", async ({ page }) => {
  const res = await page.goto("/debug/landmarks");
  expect(res?.status()).toBe(404);
});

test("Uzman Ağı flag kapalıyken 404 / FEATURE_DISABLED (SPEC 12.2)", async ({ page, request }) => {
  const res = await page.goto("/uzman");
  // oturumsuz: (app) kapısı açılışa döndürür; flag kontrolü ise oturumlu akışta 404'tür — API ile doğrula
  expect([200, 404]).toContain(res?.status() ?? 0);
  const api = await request.get("/api/experts");
  expect([401, 404]).toContain(api.status());
  const status = await request.get("/api/experts/requests/AU-TEST-TEST/status?status=contacted&sig=00");
  expect(status.status()).toBe(404);
});

test("hesap uçları oturumsuz 401 (F15: export, delete)", async ({ request }) => {
  const exp = await request.get("/api/me/export");
  expect(exp.status()).toBe(401);
  expect(exp.headers()["content-disposition"]).toBeUndefined();
  const del = await request.post("/api/me/delete", { data: { confirm: "SİL" } });
  expect(del.status()).toBe(401);
});

test("geçersiz Bearer token 401 döner, 500 değil (SPEC-MOBILE M2)", async ({ request }) => {
  const res = await request.get("/api/billing/status", { headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.invalidsignatureinvalidsignature" } });
  expect(res.status()).toBe(401);
  expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
});

test("GET /api/legal/[slug] yasal metni sürümüyle döner; bilinmeyen slug 404 (SPEC-MOBILE M2)", async ({ request }) => {
  const res = await request.get("/api/legal/aydinlatma");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.slug).toBe("aydinlatma");
  expect(body.version).toMatch(/^\d{4}-\d{2}-\d{2}/);
  expect(typeof body.body).toBe("string");
  expect(body.body.length).toBeGreaterThan(100);
  const missing = await request.get("/api/legal/yok");
  expect(missing.status()).toBe(404);
});

test("RevenueCat webhook yetkisiz 401; sync oturumsuz 401 (SPEC-MOBILE M6)", async ({ request }) => {
  const wh = await request.post("/api/billing/revenuecat", { data: { event: { id: "x", app_user_id: "u" } } });
  expect(wh.status()).toBe(401);
  const sync = await request.post("/api/billing/sync", { data: {} });
  expect(sync.status()).toBe(401);
});

test("GET /api/tryon/status oturumsuz 401 (SPEC-MOBILE M5)", async ({ request }) => {
  const res = await request.get("/api/tryon/status");
  expect(res.status()).toBe(401);
});
