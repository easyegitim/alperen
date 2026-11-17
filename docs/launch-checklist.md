# Lansman listesi (SPEC 20.3 / 20.4) — durum

Tarih: 2026-10-12. ✅ tamam · ⏳ insan/üçüncü taraf gerekli · ⚠️ kısmi

## 20.3 "Bitti" tanımı

| Madde | Durum | Not |
| --- | --- | --- |
| `typecheck`, `lint`, `test` geçiyor | ✅ | CI `checks` işi (`.github/workflows/ci.yml`) |
| 360 px ve koyu temada düzgün; yükleme/boş/hata durumları | ⚠️ | Kod düzeyinde var; gerçek cihaz turu (docs/qa-scenarios.md) bekliyor |
| Metinler `messages/tr.json`'da; analitik olayı eklenmiş | ✅ | SPEC 17.1 olayları `lib/analytics.ts` |
| Loglarda ve olaylarda kişisel veri yok | ✅ (kod) | Sentry `beforeSend`, `sanitizeProps`; `privacy.spec` staging'de |
| Faz sonu denetim promptu bulgusuz | ⏳ | Yeni oturumda SPEC 19 "faz sonu denetim" promptu çalıştırılacak |

## 20.4 Lansman

| Madde | Durum | Sorumlu / adım |
| --- | --- | --- |
| Avukat onaylı yasal metinler yayında | ⏳ | `content/legal/*.md` taslak (sürüm 2026-10-09.1); onaydan sonra sürüm artır → kullanıcılar yeniden onaylar |
| Aktarım mekanizmaları; VERBİS | ⏳ | Avukat (SPEC 16.3) |
| Şirket, iyzico canlı üye işyeri, abonelik eklentisi | ⏳ | İnsan; canlı anahtar yalnız production env |
| E-arşiv fatura, ETBİS, satıcı bilgileri | ⏳ | İnsan |
| Kalibrasyon ve adalet raporu güncel | ⏳ | `pnpm calibrate`, `pnpm fairness` (ücretli; onayla) → `docs/calibration.md`, `docs/fairness.md` |
| Gemini faturalı katman + bütçe uyarısı | ⏳ | Google Cloud panel |
| Supabase Pro, yedek; cron çalışıyor | ⏳ | `supabase db push --linked` (onay); pg_cron panelden açık; `0004_cron.sql` işleri |
| Vercel Firewall, Turnstile, alan adı, HTTPS | ⏳ | Alan adı kararı (SPEC 21.1); `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| Sentry uyarıları, PostHog huni panosu | ⏳ | DSN/anahtar env'e; huni olayları hazır |
| Destek ve KVKK başvuru e-postaları | ⏳ | İnsan; 30 gün yanıt süreci |
| 16.4 güvenlik listesi | ⚠️ | `docs/security-check.md` (IDOR turu, ZAP, yedek, IP sınırı açık) |
| Uzman Ağı: hukuki görüş yoksa flag kapalı | ✅ | `FEATURE_EXPERT_NETWORK=false` varsayılan |
| Pazarlama içerikleri 16.6'ya uygun | ⏳ | İnsan |

## Lansman öncesi teknik adımlar (sırayla)

1. Staging Supabase: `supabase link` → `pnpm db:types` (lib/db/types.ts) → migration push (onay) → `pnpm test:rls`.
2. Staging Vercel preview: env (sandbox iyzico, Gemini, Resend, Turnstile, PostHog, Sentry).
3. `PRIVACY_E2E=1`, `BILLING_E2E=1`, `FULL_FLOW_E2E=1` koşuları; `RUN_AI_TESTS=1 pnpm test:ai` (60 red-team).
4. `pnpm calibrate` → `CALIBRATION_V0` güncelle; `pnpm fairness` → kapı.
5. Gerçek cihaz turu (4 cihaz) ve IDOR turu; OWASP ZAP.
6. Kapalı beta (50–100 yetişkin, 2 hafta); geri bildirim `/admin` bildirilen içerikler.
7. Production: ayrı Supabase, canlı iyzico, alarmlar; `main` dalı ve PR (onay).

## Mobil (SPEC-MOBILE M8) — mağaza gönderimi

Ayrıntı: `docs/store-submission.md`.

- [ ] Apple Developer / Google Play Console / EAS hesapları; `EAS_PROJECT_ID`, EAS Secrets (Sentry), `eas.json` env adresleri gerçek alan adıyla.
- [ ] RevenueCat ürünleri + webhook; Sign in with Apple (Supabase Auth).
- [ ] `pnpm --dir mobile setup && eas build --profile development` → gerçek cihazda M3/M6/M8 doğrulaması (segmenter: "Üst üçte bir" dolu).
- [ ] TestFlight + Play kapalı test (12 kullanıcı / 14 gün).
- [ ] App Privacy / Data safety cevapları `docs/store-submission.md` tablolarıyla aynı; yaş derecelendirmesi 17+/18+.
- [ ] Mağaza metinlerinde sağlık iddiası, önce/sonra, gerçek selfie yok; inceleme notlarında test hesabı.
