import { expect, test } from "@playwright/test";

test.describe("Açılış (F01)", () => {
  test("başlık, CTA, planlar ve yasal linkler 360 px'te görünür", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Skorunu öğren");
    const ctas = page.getByRole("button", { name: "Analizini başlat" });
    await expect(ctas.first()).toBeVisible();

    // CTA metninde "ücretsiz" geçmez (SPEC 2 D04).
    for (const text of await ctas.allTextContents()) {
      expect(text.toLocaleLowerCase("tr-TR")).not.toContain("ücretsiz");
    }

    await expect(page.getByText("₺8.750")).toBeVisible();
    await expect(page.getByRole("link", { name: "Aydınlatma Metni" })).toBeVisible();

    // Yatay taşma yok.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("oturumsuz uygulama ekranı açılışa yönlendirir (F02)", async ({ page }) => {
    await page.goto("/analiz");
    await expect(page).toHaveURL(/\/$/);
  });
});
