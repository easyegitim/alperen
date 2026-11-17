# Güvenlik kontrol listesi (SPEC 16.4) — Faz 14 durumu

Tarih: 2026-10-12. Her madde: durum, kanıt (dosya/test), kalan iş.

| # | Madde | Durum | Kanıt | Kalan |
| --- | --- | --- | --- | --- |
| 1 | Tüm tablolarda RLS; `pg_tables … not rowsecurity` boş | ✅ | `scripts/check-rls.sql`; migration 0001–0007 yerel Postgres'te uygulandı, sorgu boş döndü | CI adımı olarak ekle (`pnpm db:check-rls`) ve staging'de çalıştır |
| 2 | `analyses`/`coach_reports` tarayıcıdan okunamıyor | ✅ (kod) | 0002_rls.sql'de bu tablolara select politikası yok; `tests/rls/rls.test.ts` (RLS_TESTS=1) | Staging Supabase'de `pnpm test:rls` ve `privacy.spec` ile doğrula |
| 3 | Service-role yalnız sunucuda; `NEXT_PUBLIC_` gizli yok | ✅ | `lib/db/admin.ts` `"server-only"`; `.env.example`'da gizli anahtarlar `NEXT_PUBLIC_` önekli değil | Vercel ortam değişkenlerini kurarken aynı kuralı uygula |
| 4 | HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy: camera=(self)` | ✅ | `lib/security/headers.ts`, `tests/unit/securityHeaders.test.ts`, `tests/e2e/security.spec.ts` | HSTS preload listesine başvuru (alan adı kesinleşince) |
| 5 | CSP: `worker-src 'self' blob:`; `connect-src` Supabase/PostHog/Sentry/Turnstile; `frame-src` iyzico/Turnstile; `img-src 'self' data: blob:` | ✅ | `buildCsp()`; e2e "sayfalar CSP ihlali üretmez" | `script-src` şimdilik `'unsafe-inline'` (Next satır içi betikler + iyzico `checkoutFormContent`); nonce'a geçiş ayrı görev. Gerçek ödeme akışında iyzico alan adlarını (`*.iyzipay.com`, `*.iyzico.com`) sandbox'ta doğrula |
| 6 | Zod tüm uçlarda; görselde boyut sınırı ve JPEG imza baytları | ✅ | `withGuard` (`lib/api/guard.ts`), `lib/api/analysesInput.ts` ve `lib/api/tryonInput.ts` (`FF D8`, ≤ 1,5 MB) | — |
| 7 | Loglarda görsel/e-posta/skor/metrik yok; Sentry `sendDefaultPii:false`, `beforeSend` temizliği, replay kapalı | ✅ | `lib/monitoring/sentry.ts`, `tests/unit/monitoring.test.ts`; `withGuard` yalnız hata adı/mesajı loglar | Vercel runtime loglarını staging'de gözden geçir |
| 8 | IDOR testi: ikinci hesapla her uç ve tablo | ⏳ | Sahiplik kontrolleri kodda (`user_id` filtresi + RLS); `tests/rls/rls.test.ts` iki kullanıcı ile tablo düzeyinde | Faz 15: staging'de uç düzeyinde elle/Playwright IDOR turu |
| 9 | Anonim oturumda Turnstile; IP başına günlük anonim oturum sınırı | ⚠️ | Turnstile `components/marketing/StartAnalysisButton.tsx` (site key varsa) | IP sınırı Supabase Auth rate limit ayarından (panel) yapılacak; kodda yok |
| 10 | Dependabot açık; Supabase günlük yedek açık | ⏳ | `.github/dependabot.yml` bu fazda eklendi | Supabase projesinde yedek (Pro plan) ve PITR ayarı — insan |
| 11 | Veri ihlali planı: Kurul'a 72 saat, kullanıcı e-posta şablonu | ⏳ | `docs/incident-plan.md` taslağı bu fazda | Avukat onayı |
| 12 | Lansman öncesi OWASP ZAP + elle IDOR | ⏳ | — | Faz 15 |

## Ek kontroller (bu fazda yapılanlar)

- `X-Content-Type-Options: nosniff`, `X-DNS-Prefetch-Control: off`, `poweredByHeader: false`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`.
- PostHog yalnız çerez onayı "granted" iken yüklenir; otomatik yakalama, oturum kaydı, anket kapalı; `$current_url` sorgusuz; `sanitizeProps` yasak anahtarları düşürür (`lib/analytics.ts`).
- `GET /api/health` yalnız `{ ok: true }` döner; sürüm/ortam sızdırmaz.
- Admin uçları ve sayfası `ADMIN_EMAILS` dışı herkes için 404 (varlık sızdırmaz).
