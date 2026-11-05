# Fonksiyonel senaryolar (SPEC 20.2) — kapsama matrisi

Durum: ✅ otomatik test var · 🧪 kod var, test gerçek ortam ister (staging/sandbox/anahtar) · 📱 gerçek cihazda elle

| Senaryo | Nerede | Doğrulama | Durum |
| --- | --- | --- | --- |
| Fotoğraf yok → uyarı | `components/camera/CaptureScreen.tsx` | elle | 📱 |
| Yüz yok → tekrar çek | `lib/face/quality.ts` (`no_face`) | `tests/unit/quality.test.ts` | ✅ |
| İki yüz → ret | `lib/face/quality.ts` (`multiple_faces`) | `tests/unit/quality.test.ts` | ✅ |
| Karanlık/bulanık → kalite uyarısı | `lib/face/quality.ts` (parlaklık, Laplacian) | `tests/unit/quality.test.ts` | ✅ |
| MediaPipe yüklenemedi → yükleme alternatifi | `components/camera/SelfieCamera.tsx` (galeri) | elle (iOS Safari) | 📱 |
| Model zaman aşımı → kota iade + tekrar dene | `app/api/analyses/route.ts` (`release_analysis`), `lib/ai/provider.ts` timeout | 🧪 Gemini anahtarı ile | 🧪 |
| Aynı `clientRequestId` iki kez → tek analiz | `reserve_analysis` (0003) `unique (user_id, client_request_id)` | `tests/rls/rls.test.ts` (RLS_TESTS=1) | 🧪 |
| Başka kullanıcının analiz id'si → 404 | `app/api/analyses/[id]/route.ts` (`user_id` filtresi) | `tests/rls/rls.test.ts` + IDOR turu | 🧪 |
| Ücretsiz ikinci analiz → `QUOTA_EXCEEDED` + `retryAt` | `reserve_analysis`, `lib/api/errors.ts` | `tests/e2e/flow.spec.ts` (FULL_FLOW_E2E) | 🧪 |
| Premium 7 gün içinde ikinci analiz → `QUOTA_EXCEEDED` | `reserve_analysis` (haftalık hak) | `tests/rls/rls.test.ts` | 🧪 |
| Ödeme başarısız → premium açılmaz | `lib/billing/sync.ts` `applyRemoteStatus` | `tests/unit/billing.test.ts` | ✅ |
| Sahte callback → reddedilir | `app/api/billing/callback/route.ts` (token iyzico'dan çekilir) | `tests/e2e/billing.spec.ts` (BILLING_E2E) | 🧪 |
| İptal → dönem sonuna kadar erişim | `lib/billing/entitlement.ts` `isPremium` | `tests/unit/billing.test.ts` | ✅ |
| Hesap silme → 7 gün sonra veri yok | `purge_deleted_users` (0004) | `scripts/ci/purge-check.sql` (CI `db` işi) | ✅ |
| Uygunsuz AI çıktısı → filtre/fallback | `lib/ai/safety.ts`, `content/fallback-report.ts` | `tests/unit/safety.test.ts`, `tests/safety/redteam.test.ts` (RUN_AI_TESTS) | ✅ / 🧪 |
| VKİ < 25 → kilo içeriği yok | `lib/coach/bodyRules.ts` | `tests/unit/bodyRules.test.ts` | ✅ |
| `jawHealth` işaretli → egzersiz yok | `lib/coach/eligibility.ts` | `tests/unit/catalog.test.ts` | ✅ |
| Başörtüsü → saç önerisi yok | `lib/coach/eligibility.ts` | `tests/unit/catalog.test.ts` | ✅ |
| Uzman Ağı flag kapalı → 404 | `lib/experts/guard.ts`, `app/(app)/(gated)/uzman/page.tsx` | `tests/e2e/legal.spec.ts` | ✅ |
| 18 altı hiçbir ekrana giremez | `lib/onboarding/gate.ts`, `withGuard requireAdult` | `tests/unit/gate.test.ts`, `tests/unit/age.test.ts`, `flow.spec.ts` | ✅ / 🧪 |
| Kilitli değer sunucudan çıkmaz | `lib/score/present.ts` | `tests/unit/present.test.ts`, `privacy.spec.ts` | ✅ / 🧪 |
| Görsel yalnız `/api/analyses`, `/api/tryon` | istemci akışı | `tests/e2e/privacy.spec.ts` (PRIVACY_E2E) | 🧪 |
| Güvenlik başlıkları ve CSP ihlali yok | `lib/security/headers.ts` | `tests/unit/securityHeaders.test.ts`, `tests/e2e/security.spec.ts` | ✅ |

## Gerçek cihaz turu (SPEC 20.1 — 4 cihaz, elle)

iPhone (Safari), Android (Chrome), düşük segment Android, iPad/Tablet: kamera açılışı ve ayna, kalite uyarıları, analiz süresi (hedef p95 < 10 sn), deneme süresi (hedef p95 < 20 sn), iyzico sandbox 3D Secure iframe, koyu tema, 360 px düzen, PWA kurulumu.
