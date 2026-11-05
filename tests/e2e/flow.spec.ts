/**
 * Ana akış v2 (KB §3.1–3.4; SPEC Faz 15 madde 1): yaş bandı → cinsiyet → (oturum: test kullanıcısı) → rızalar → çekim
 * (ön + yan profil, sahte kamera videosu) → cihaz analizi (device_only, görsel gönderilmez) → kilitli sonuç → paywall →
 * ürünler → /premium. Ödeme ve ödeme sonrası yol yalnız E2E_PREMIUM_EMAIL ile (staging'de sandbox ödemesi tamamlanmış hesap).
 *
 * Gereksinimler (yoksa hemen BAŞARISIZ olur; atlanmaz):
 *   FULL_FLOW_E2E=1                      → playwright.config.ts "flow" projesini ekler
 *   Sunucu staging/yerel Supabase ile çalışıyor (migration 0010–0012); NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY ortamda (test kullanıcısı auth.admin.createUser ile açılır ve silinir)
 *   E2E_FACE_VIDEO=/sifreli/disk/face.y4m → Chrome sahte kamera kaynağı (rızalı yüz; depoya konmaz)
 *   İsteğe bağlı premium yolu: E2E_PREMIUM_EMAIL / E2E_PREMIUM_PASSWORD
 */
import { expect, test, type Page } from "@playwright/test";
import { createTestUser } from "./helpers/testUser";

test.beforeAll(() => {
  for (const k of ["FULL_FLOW_E2E", "E2E_FACE_VIDEO", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[k]) throw new Error(`${k} gerekli — tests/e2e/flow.spec.ts başlığına bak.`);
  }
});

/** v2 başlangıç (oturum açık): yaş bandı → cinsiyet → rızalar → /tara. */
async function completeOnboarding(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Analizini başlat" }).first().click();
  await expect(page).toHaveURL(/\/baslangic\/yas/);
  await page.getByRole("radio", { name: "25–34" }).check({ force: true });
  await page.getByRole("button", { name: "Devam" }).click();

  await expect(page).toHaveURL(/\/baslangic\/cinsiyet/);
  await page.getByRole("radio", { name: "Erkek" }).check({ force: true });
  await page.getByRole("button", { name: "Devam" }).click();

  await expect(page).toHaveURL(/\/baslangic\/izinler/);
  const box = page.locator("[tabindex='0']").first();
  await box.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.getByRole("button", { name: "Okudum" }).click();
  for (const id of ["biometric_processing", "photo_ai_analysis", "cross_border_transfer"]) await page.locator(`#consent-${id}`).click();
  await page.getByRole("button", { name: "Devam" }).click();
  await expect(page).toHaveURL(/\/tara/, { timeout: 15_000 });
}

/** Çekim: 1/2 ön (otomatik ya da "Evet" onayı) → 2/2 yan profil (deklanşör) → özet → "Analizi başlat" → /analiz/[id]. */
async function captureAndAnalyze(page: Page) {
  await page.getByRole("button", { name: "Kamerayı aç" }).click();
  const yes = page.getByRole("button", { name: "Evet" });
  await Promise.race([page.getByRole("button", { name: "Bu fotoğrafı kullan" }).waitFor({ timeout: 60_000 }), yes.waitFor({ timeout: 60_000 })]);
  if (await yes.isVisible().catch(() => false)) await yes.click();
  await page.getByRole("button", { name: "Bu fotoğrafı kullan" }).click();
  // Yan profil zorunlu (KB P#4): özet "Analizi başlat"ı profil olmadan açmaz.
  await page.getByRole("button", { name: "Kamerayı aç" }).click();
  await page.getByRole("button", { name: "Çek" }).click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Bu fotoğrafı kullan" }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Analizi başlat" }).click({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/analiz\/[0-9a-f-]{36}/, { timeout: 90_000 });
}

test.describe("Ana akış (F01–F14, v2)", () => {
  test("18 altı bandı 'yakında' ekranında kalır; uygulama ekranlarına giremez", async ({ page, context, baseURL }) => {
    const user = await createTestUser(context, baseURL ?? "http://localhost:3000", "flow");
    try {
      await page.goto("/baslangic/yas");
      await page.getByRole("radio", { name: "18 altı" }).check({ force: true });
      await page.getByRole("button", { name: "Devam" }).click();
      await expect(page.getByText("18 altı için yakında")).toBeVisible();
      await expect(page).toHaveURL(/\/baslangic\/yas/);
      await page.goto("/tara");
      await expect(page).toHaveURL(/\/baslangic\/yas|\/$/);
    } finally {
      await user.cleanup();
    }
  });

  test("onboarding → çekim → cihaz analizi → kilitli sonuç → paywall → ürünler → /premium", async ({ page, context, baseURL }) => {
    const user = await createTestUser(context, baseURL ?? "http://localhost:3000", "flow");
    try {
      const analysisResponses: Record<string, unknown>[] = [];
      page.on("response", async (res) => {
        if (/\/api\/analyses(\/|$)/.test(new URL(res.url()).pathname) && res.ok()) {
          const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
          if (j) analysisResponses.push(j);
        }
      });
      await completeOnboarding(page);
      await captureAndAnalyze(page);

      // Kilitli sonuç (KB §3.3): yüz şekli ön değerlendirmesi görünür; skor/potansiyel null + locked (sunucudan hiç gelmez)
      await expect(page.getByText(/yüz şekli/i).first()).toBeVisible();
      const detail = analysisResponses.find((r) => r.subscores) as { stage?: string; overall?: { value: unknown; locked: boolean }; potential?: { value: unknown; locked: boolean } } | undefined;
      expect(detail).toBeTruthy();
      expect(detail!.stage).toBe("device_only");
      expect(detail!.overall?.locked).toBe(true);
      expect(detail!.overall?.value).toBeNull();
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

      // Oturum açık hesapta checkout girdisi Zod ile doğrulanır (boş alıcı → 400); hak tarayıcıdan açılmaz
      const checkout = await page.request.post("/api/billing/checkout", { data: { plan: "weekly", buyer: {}, accepted: { terms: true, waiver: true } } });
      expect([400, 403]).toContain(checkout.status());
      await page.goto("/hesap");
      await expect(page.getByText(user.email).first()).toBeVisible();

      // Ödeme öncesi ikinci cihaz analizi kota saymaz (device_only); satır yine kilitli
      await page.goto("/tara");
      await captureAndAnalyze(page);
      const second = analysisResponses.filter((r) => r.subscores);
      expect(second.length).toBeGreaterThanOrEqual(2);
      expect((second.at(-1) as { stage?: string }).stage).toBe("device_only");
    } finally {
      await user.cleanup();
    }
  });

  test("premium hesap: tam sonuç → rapor → deneme (E2E_PREMIUM_EMAIL ile)", async ({ page }) => {
    const email = process.env.E2E_PREMIUM_EMAIL;
    const password = process.env.E2E_PREMIUM_PASSWORD;
    if (!email || !password) throw new Error("E2E_PREMIUM_EMAIL / E2E_PREMIUM_PASSWORD gerekli (staging'de sandbox ödemesi tamamlanmış hesap).");
    await page.goto("/baslangic/giris");
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
    // Hak varken set bellekteyken hemen gider; sonuç kart kart açılır (ya da "Fotoğrafları gönder" ile yeniden)
    await expect(page.getByText(/potansiyel|fotoğraf setini gönder/i).first()).toBeVisible({ timeout: 120_000 });
    await page.goto("/dene");
    await expect(page.getByRole("heading").first()).toBeVisible();
  });
});
