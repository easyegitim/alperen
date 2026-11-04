/**
 * Gizlilik testi (CLAUDE.md, zorunlu; Faz 7'den itibaren her faz sonunda). Tüm ağ trafiğini izler.
 * v2 (KB §3.1, CONTRACTS_V2 §8): anonim oturum kalktı; test kullanıcısı auth.admin.createUser ile açılır ve sonunda
 * silinir. Ödeme öncesi akışta görsel GÖNDERİLMEZ (device_only); gönderildiği gün yalnız POST /api/analyses alabilir.
 *
 * Gereksinimler (yoksa test hemen BAŞARISIZ olur; atlanmaz):
 *   PRIVACY_E2E=1                       → playwright.config.ts "privacy" projesini ekler
 *   Sunucu gerçek (yerel) Supabase ile çalışıyor (migration 0010–0012 uygulanmış); NEXT_PUBLIC_SUPABASE_URL,
 *   (Ödeme öncesi device_only yol SCORE_ENGINE'den bağımsızdır; POST /api/analyses 200 değilse test yanıtı açıkça raporlar.)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY ve SUPABASE_SERVICE_ROLE_KEY ortamda (test kullanıcısı için)
 *   PRIVACY_FACE_VIDEO=/sifreli/disk/face.y4m → Chrome sahte kamera kaynağı (rızalı yüz; depoya konmaz)
 */
import { expect, test, type Request } from "@playwright/test";
import { createTestUser, env } from "./helpers/testUser";

type LockedJson = { value: unknown; locked: boolean };
/** /api/analyses yanıtındaki ClientAnalysisV2'nin kilitle ilgili alanları (lib/score/present.ts). */
type AnalysisJson = {
  stage?: string;
  overall?: LockedJson;
  potential?: LockedJson;
  improveFirst?: LockedJson;
  report?: LockedJson;
  subscores?: Record<string, LockedJson>;
  explanations?: Record<string, LockedJson>;
  device?: unknown;
};

const IMAGE_SINKS = ["/api/analyses", "/api/tryon"];
/** Kilitli v2 yanıtında asla olmaması gerekenler (presentV2.test LEAK ile aynı ruh). */
const LEAK = /"range":\[|"runs"|"set_key"|"signals"|"raw"/;

function hasImagePayload(req: Request): boolean {
  const ct = req.headers()["content-type"] ?? "";
  if (ct.startsWith("image/") || ct.startsWith("multipart/")) return true;
  const body = req.postData() ?? "";
  return body.includes("/9j/") || body.includes("data:image/");
}

test.describe("Gizlilik (tüm ağ trafiği)", () => {
  test.beforeAll(() => {
    for (const k of ["PRIVACY_E2E", "PRIVACY_FACE_VIDEO", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
      if (!process.env[k]) throw new Error(`${k} gerekli — tests/e2e/privacy.spec.ts başlığına bak.`);
    }
  });

  test("ödeme öncesi akış: görsel gönderilmez; gövdede landmark yok; kilitli değerler yanıtta yok; görsel giderse yalnız izinli uçlara", async ({ page, context, baseURL }) => {
    const user = await createTestUser(context, baseURL ?? "http://localhost:3000", "privacy");
    try {
      const requests: Request[] = [];
      page.on("request", (r) => requests.push(r));
      const analysisResponses: unknown[] = [];
      const analysisBodies: string[] = [];
      const analysisFailures: string[] = [];
      page.on("response", async (res) => {
        if (/\/api\/analyses(\/|$)/.test(new URL(res.url()).pathname) && !res.ok()) analysisFailures.push(`${res.status()} ${await res.text().catch(() => "")}`);
        if (/\/api\/analyses(\/|$)/.test(new URL(res.url()).pathname) && res.ok()) {
          const text = await res.text().catch(() => "");
          analysisBodies.push(text);
          try {
            analysisResponses.push(JSON.parse(text));
          } catch {
            analysisResponses.push(null);
          }
        }
      });

      // 1) Yaş bandı → cinsiyet (oturum var: hemen yazılır) → rızalar → fotoğraflar
      await page.goto("/baslangic/yas");
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

      // 2) Çekim: 1/2 ön (otomatik) → 2/2 yan profil (deklanşör) → özet → cihaz analizi
      await expect(page).toHaveURL(/\/tara/, { timeout: 15_000 });
      await page.getByRole("button", { name: "Kamerayı aç" }).click();
      const yes = page.getByRole("button", { name: "Evet" });
      await Promise.race([page.getByRole("button", { name: "Bu fotoğrafı kullan" }).waitFor({ timeout: 60_000 }), yes.waitFor({ timeout: 60_000 })]);
      if (await yes.isVisible().catch(() => false)) await yes.click();
      await page.getByRole("button", { name: "Bu fotoğrafı kullan" }).click();
      await page.getByRole("button", { name: "Kamerayı aç" }).click();
      await page.getByRole("button", { name: "Çek" }).click({ timeout: 30_000 });
      await page.getByRole("button", { name: "Bu fotoğrafı kullan" }).click({ timeout: 60_000 });
      await page.getByRole("button", { name: "Analizi başlat" }).click({ timeout: 30_000 });
      await expect.poll(() => analysisResponses.length + analysisFailures.length, { timeout: 90_000 }).toBeGreaterThan(0);
      expect(analysisFailures, `POST /api/analyses başarısız (ön koşul: sunucu + migration; gövde: ${analysisFailures[0] ?? ""})`).toEqual([]);
      await expect(page).toHaveURL(/\/analiz\/[0-9a-f-]{36}/, { timeout: 90_000 });

      // 3) Ödeme öncesi hiçbir isteğe görsel girmez; girerse yalnız izinli uçlara
      const imageReqs = requests.filter(hasImagePayload);
      for (const r of imageReqs) {
        const path = new URL(r.url()).pathname;
        expect(IMAGE_SINKS.some((s) => path.startsWith(s)), `${path} görsel almamalı`).toBe(true);
      }
      for (const r of requests) {
        const host = new URL(r.url()).host;
        if (/posthog|sentry|supabase|resend|cloudflare|turnstile/.test(host)) expect(hasImagePayload(r), `${host} görsel aldı`).toBe(false);
      }

      // 4) POST /api/analyses: mode device_only, görsel yok, yalnız GeometryResult; 478 nokta yok
      const post = requests.find((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/analyses");
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.postData() ?? "{}") as { mode?: string; geometry?: Record<string, unknown>; image?: string; images?: unknown[]; sourceHashes?: unknown };
      expect(body.mode).toBe("device_only");
      expect(body.image).toBeUndefined();
      expect(body.images ?? []).toEqual([]);
      expect(body.geometry?.version).toBe("geo-v1");
      expect(JSON.stringify(body.geometry)).not.toMatch(/landmarks|"x":/);
      expect(post!.postData() ?? "").not.toMatch(/\/9j\//);

      // 5) Analitik/hata olaylarında görsel, skor, metrik, e-posta yok (PostHog/Sentry istekleri)
      for (const r of requests.filter((q) => /posthog|sentry/.test(new URL(q.url()).host))) {
        const b = r.postData() ?? "";
        expect(b).not.toMatch(/\/9j\/|lengthRatio|overall|@|[0-9a-f]{64}/);
      }

      // 6) Kilitli v2 yanıtı: skor, aralık, alt skor, potansiyel, rapor yok; yalnız cihaz alanları
      expect(analysisResponses.length).toBeGreaterThan(0);
      for (const text of analysisBodies) expect(text).not.toMatch(LEAK);
      for (const res of analysisResponses as AnalysisJson[]) {
        if (!res?.overall) continue;
        expect(res.stage).toBe("device_only");
        expect(res.overall.locked).toBe(true);
        expect(res.overall.value).toBeNull();
        expect(res.potential?.locked).toBe(true);
        expect(res.potential?.value).toBeNull();
        expect(res.improveFirst?.value).toBeNull();
        expect(res.report?.value).toBeNull();
        for (const [k, s] of Object.entries(res.subscores ?? {})) expect(s.value, `subscores.${k}`).toBeNull();
        for (const [k, e] of Object.entries(res.explanations ?? {})) expect(e.value, `explanations.${k}`).toBeNull();
        expect(res.device).toBeTruthy();
      }
      const html = await page.content();
      expect(html).not.toMatch(/"potential":\{"value":\d|"overall":\{"value":\{/);
      expect(html).not.toMatch(/"improveFirst":\{"value":\[/);
      // Hiçbir hosta giden gövdede landmark dizisi yok
      for (const r of requests) expect(r.postData() ?? "", new URL(r.url()).host).not.toMatch(/"landmarks"/);
      // Faz 6 (S3.3.4): hayalet kılavuz çizgisi (GhostOutline: oval/eyes/nose/mouth) yalnız IndexedDB'de; hiçbir gövdede yok.
      for (const r of requests) expect(r.postData() ?? "", `${new URL(r.url()).host} hayalet kılavuz`).not.toMatch(/"oval"|"ghost"|"eyes":\[\[/);
      // Faz 6 (S3.3.1): paylaşım kartı cihazda üretilir; kart görseli (JPEG) hiçbir isteğe girmez — hasImagePayload kuralı
      // (3. adım) izinli uçlar dışındaki her görsel gövdesini zaten reddeder; burada açıkça: izinli uçlara da kart gitmez.
      for (const r of imageReqs) expect(r.postData() ?? "", "paylaşım kartı").not.toMatch(/aura-(score|strongest|barber)-/);
      // Faz 6 (S3.3.5): davet kodu girişi POST /api/referral yalnız { code } taşır (e-posta, cihaz, skor yok).
      for (const r of requests.filter((q) => q.method() === "POST" && new URL(q.url()).pathname === "/api/referral")) {
        const claim = JSON.parse(r.postData() ?? "{}") as Record<string, unknown>;
        expect(Object.keys(claim)).toEqual(["code"]);
        expect(String(claim.code)).toMatch(/^[A-Za-z0-9 -]{8,20}$/);
      }

      // 7) Supabase istemcisiyle (anon key + kullanıcının kendi oturum JWT'si) analyses / coach_reports / analysis_sets
      //    okunamıyor: tarayıcı politikası yok → 401 ya da boş dizi. purchases okunabilir ama skor taşımaz; yine de boş olmalı.
      const supaUrl = env("NEXT_PUBLIC_SUPABASE_URL");
      const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      for (const table of ["analyses", "coach_reports", "analysis_sets", "purchases"]) {
        const res = await page.request.get(`${supaUrl}/rest/v1/${table}?select=*`, { headers: { apikey: anonKey, Authorization: `Bearer ${user.accessToken}` } });
        const bodyText = await res.text();
        expect([401, 200, 404], `${table} durum ${res.status()}`).toContain(res.status());
        if (res.status() === 200) expect(JSON.parse(bodyText), `${table} RLS ile boş dizi dönmeli`).toEqual([]);
        expect(bodyText).not.toMatch(/"overall"|"subscores"|"scores"|"report"/);
      }
    } finally {
      await user.cleanup();
    }
  });
});
