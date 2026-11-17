import { expect, test } from "@playwright/test";

/** SPEC 16.4 / Faz 14 madde 3: başlıklar ve CSP; sayfalarda CSP ihlali yok. */
const PAGES = ["/", "/fiyatlar", "/yasal/aydinlatma", "/yasal/cerez"];

test.describe("güvenlik başlıkları ve CSP (F18)", () => {
  test("her yanıtta güvenlik başlıkları var", async ({ request }) => {
    for (const path of [...PAGES, "/api/health"]) {
      const res = await request.get(path);
      const h = res.headers();
      expect(h["content-security-policy"], path).toContain("default-src 'self'");
      expect(h["content-security-policy"], path).toContain("worker-src 'self' blob:");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(h["permissions-policy"], path).toContain("camera=(self)");
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["x-powered-by"], path).toBeUndefined();
    }
  });

  test("sayfalar CSP ihlali üretmez", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to/.test(m.text())) violations.push(m.text());
    });
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    expect(violations).toEqual([]);
  });

  test("/api/health { ok: true } ve gizli bilgi yok", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("/api/admin/* oturumsuz 401; admin sayfası 404", async ({ request, page }) => {
    const res = await request.get("/api/admin/metrics");
    expect(res.status()).toBe(401);
    const p = await page.goto("/admin");
    expect(p?.status()).toBe(404);
  });
});
