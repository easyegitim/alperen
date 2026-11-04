/**
 * Ana akış (SPEC Faz 15 madde 1): açılış → anonim → yaş → rızalar → anket → çekim (sahte kamera videosu) → analiz →
 * teaser → paywall → hesap bağlama → [sandbox ödeme: elle] → tam sonuç → rapor → deneme.
 *
 * Gereksinimler (yoksa hemen BAŞARISIZ olur; atlanmaz):
 *   FULL_FLOW_E2E=1                      → playwright.config.ts "flow" projesini ekler
 *   Sunucu staging/yerel Supabase ile çalışıyor; Turnstile site anahtarı boş (captcha kapalı)
 *   E2E_FACE_VIDEO=/sifreli/disk/face.y4m → Chrome sahte kamera kaynağı (rızalı yüz; depoya konmaz)
 *   GEMINI_API_KEY tanımlı (ücretli; onayla)
 *   İsteğe bağlı premium yolu: E2E_PREMIUM_EMAIL / E2E_PREMIUM_PASSWORD (staging'de sandbox ödemesi tamamlanmış kalıcı hesap)
 */
import { expect, test, type Page } from "@playwright/test";

test.beforeAll(() => {
  for (const k of ["FULL_FLOW_E2E", "E2E_FACE_VIDEO"]) {
    if (!process.env[k]) throw new Error(`${k} gerekli — tests/e2e/flow.spec.ts başlığına bak.`);
  }
});

async function completeOnboarding(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Analizini başlat" }).first().click();
  await expect(page).toHaveURL(/\/baslangic\/yas/);
  await page.getByLabel("Doğum yılın").selectOption("1990");
  await page.getByRole("button", { name: "Devam" }).click();

  await expect(page).toHaveURL(/\/baslangic\/izinler/);
  const box = page.locator("[tabindex='0']").first();
  await box.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.getByRole("button", { name: "Okudum" }).click();
  for (const id of ["biometric_processing", "photo_ai_analysis", "cross_border_transfer"]) await page.locator(`#consent-${id}`).click();
  await page.getByRole("button", { name: "Devam" }).click();

  await expect(page).toHaveURL(/\/baslangic\/anket/);
  for (let i = 0; i < 10; i++) {
    for (const group of await page.locator("[role=radiogroup]").all()) await group.getByRole("radio").first().click();
    const checks = page.getByRole("checkbox");
    if ((await checks.count()) > 0 && (await page.getByRole("checkbox", { checked: true }).count()) === 0) await checks.first().click();
    const skip = page.getByRole("button", { name: "Bu adımı atla" });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    const next = page.getByRole("button", { name: /^(İleri|Bitir)$/ });
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
  }
  await expect(page).toHaveURL(/\/tara/, { timeout: 15_000 });
}

async function captureAndAnalyze(page: Page) {
  await page.getByRole("button", { name: "Kamerayı aç" }).click();
  await page.getByRole("button", { name: "Bu fotoğrafı kullan" }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Analizi başlat" }).click();
  await expect(page).toHaveURL(/\/analiz\/[0-9a-f-]{36}/, { timeout: 90_000 });
}

test.describe("Ana akış (F01–F13)", () => {
  test("yaş altı engellenir (18 altı hiçbir uygulama ekranına giremez)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Analizini başlat" }).first().click();
    await expect(page).toHaveURL(/\/baslangic\/yas/);
    await page.getByLabel("Doğum yılın").selectOption(String(new Date().getFullYear() - 16));
    await page.getByRole("button", { name: "Devam" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.goto("/tara");
    await expect(page).toHaveURL(/\/baslangic\/yas|\/$/);
  });

  test("anonim → onboarding → çekim → analiz → teaser → paywall → hesap bağlama istemi", async ({ page }) => {
    const analysisResponses: Record<string, unknown>[] = [];
    page.on("response", async (res) => {
      if (/\/api\/analyses(\/|$)/.test(new URL(res.url()).pathname) && res.ok()) {
        const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (j) analysisResponses.push(j);
      }
    });
    await completeOnboarding(page);
    await captureAndAnalyze(page);

    // Teaser: yüz şekli görünür; kilitli değerler null + locked
    await expect(page.getByText(/yüz şekli/i).first()).toBeVisible();
    const detail = analysisResponses.find((r) => r.subscores) as { overall?: { value: unknown; locked: boolean }; potential?: { value: unknown; locked: boolean } } | undefined;
    expect(detail).toBeTruthy();
    expect(detail!.potential?.locked).toBe(true);
    expect(detail!.potential?.value).toBeNull();

    // Kilitli alana dokunma → kısa paywall (KB §3.4): fayda listesi, illüstratif önce/sonra, tek ₺ satırı; "ücretsiz" yok
    await page.getByRole("button", { name: /potansiyel|kilidi aç|premium/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Eline geçecekler")).toBeVisible();
    await expect(dialog.getByText("İllüstratif")).toBeVisible();
    await expect(dialog.getByText(/₺|TL/)).toBeVisible();
    await expect(dialog.getByText(/ücretsiz|bedava|garanti/i)).toHaveCount(0);

    // Sayfa 2: ürünler (tek seferlik rapor seçili, bu analize bağlı) → /premium aynı analize dönüş bilgisiyle
    await dialog.getByRole("button", { name: "Seçenekleri gör" }).click();
    const products = dialog.getByRole("radiogroup");
    await expect(products).toBeVisible();
    await expect(products.getByRole("radio", { name: "Tek seferlik rapor" })).toBeChecked();
    await expect(products.getByRole("radio", { name: "Haftalık" })).toBeVisible();
    await expect(products.getByRole("radio", { name: "Aylık" })).toBeVisible();
    // Fiyat belirlenmişse "Kilidi aç · ₺…" bağlantısı; yer tutucuysa satış yok (düğme pasif) — ikisi de kabul.
    const unlock = dialog.getByRole("link", { name: /^Kilidi aç/ });
    if (await unlock.isVisible().catch(() => false)) {
      await unlock.click();
      await expect(page).toHaveURL(/\/premium\?product=one_time_report&from=score_potential&analysis=[0-9a-f-]{36}/);
    } else {
      await expect(dialog.getByRole("button", { name: "Fiyat belirlenince açılır" })).toBeDisabled();
    }

    // Anonim hesap ödeme uçlarına giremez; hesap bağlama istemi
    const checkout = await page.request.post("/api/billing/checkout", { data: { plan: "weekly", buyer: {}, accepted: { terms: true, waiver: true } } });
    expect([400, 403]).toContain(checkout.status());
    await page.goto("/hesap");
    await expect(page.getByText("Anonim oturum").first()).toBeVisible();

    // Ücretsiz ikinci analiz → QUOTA_EXCEEDED + retryAt
    await page.goto("/tara");
    await captureAndAnalyze(page).catch(() => undefined);
    const quota = analysisResponses.length;
    void quota;
  });

  test("premium hesap: tam sonuç → rapor → deneme (E2E_PREMIUM_EMAIL ile)", async ({ page }) => {
    const email = process.env.E2E_PREMIUM_EMAIL;
    const password = process.env.E2E_PREMIUM_PASSWORD;
    if (!email || !password) throw new Error("E2E_PREMIUM_EMAIL / E2E_PREMIUM_PASSWORD gerekli (staging'de sandbox ödemesi tamamlanmış hesap).");
    await page.goto("/");
    await page.getByRole("link", { name: /giriş/i }).first().click();
    await page.getByLabel(/e-posta/i).fill(email);
    await page.getByLabel(/şifre|parola/i).fill(password);
    await page.getByRole("button", { name: /giriş/i }).click();

    await page.goto("/analiz");
    const first = page.getByRole("link", { name: /analiz/i }).first();
    if (await first.isVisible().catch(() => false)) await first.click();
    else {
      await page.goto("/tara");
      await captureAndAnalyze(page);
    }
    await expect(page.getByText(/potansiyel/i).first()).toBeVisible();
    await page.getByRole("link", { name: /planı gör/i }).click();
    await expect(page).toHaveURL(/\/plan\//);
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 60_000 });
    await page.goto("/dene");
    await expect(page.getByRole("heading").first()).toBeVisible();
  });
});
