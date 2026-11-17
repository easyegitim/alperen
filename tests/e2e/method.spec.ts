import { expect, test } from "@playwright/test";

// /yontem (F01, UI spec §5.2, §8.3): herkese açık, 360 px'te taşmasız; CI mobile-chrome projesinde çalışır.
test.describe("Yöntem sayfası (F01)", () => {
  test("360 px'te başlık, Aydınlatma Metni bağlantısı, yatay taşma yok", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const res = await page.goto("/yontem?from=footer");
    expect(res?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main").getByRole("link", { name: "Aydınlatma Metni" })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("sayısal eşik veya fiyat göstermez; sağlayıcı adı bayrak kapalıyken nötr", async ({ page }) => {
    await page.goto("/yontem");
    const text = (await page.getByRole("main").textContent()) ?? "";
    expect(text).not.toMatch(/₺|°|\d+\s*(px|kcal)/);
    expect(text).not.toMatch(/Anthropic|Claude|Gemini|fal\.ai/);
  });

  test("altbilgi ve fiyatlar sayfası yönteme bağlanır", async ({ page }) => {
    await page.goto("/fiyatlar");
    await expect(page.getByRole("main").getByRole("link", { name: "Skor nasıl hesaplanır?" })).toHaveAttribute("href", "/yontem?from=pricing");
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Skor nasıl hesaplanır?" })).toHaveAttribute("href", "/yontem?from=footer");
  });
});
