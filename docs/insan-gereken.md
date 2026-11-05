# İnsan gerektiren işler (tüm fazlar sonrası — 2026-10-13)

Web Faz 0–15 ve mobil M0–M8 `main`'de. Ajan ortamında yapılamayan veya hesap/karar/cihaz gerektiren işler aşağıda; sırayla yapılması önerilir.

## 0. Güvenlik (önce)

- [ ] Sohbette paylaşılan anahtarları **döndür**: Supabase access token (`sbp_…`), veritabanı parolası, Gemini API anahtarı. Yenilerini yalnız Vercel/EAS Secrets ve yerel `.env.local`'a koy.
- [ ] `.env.example` dosyaları artık depoda (önceden `.env*` kuralıyla yanlışlıkla dışlanmıştı); gerçek değer içermediğini bir kez daha kontrol et.

## 1. Supabase (ağ politikası ajanı engelledi)

- [ ] Ağ izni: `api.supabase.com`, `spmplpgeeakucihumnzi.supabase.co` (ajan ortamı) ya da yerelde çalıştır.
- [ ] Migration'lar 0001–0007: `pnpm db:push:api` (Management API) veya `supabase db push --linked`. Ardından `pnpm db:types` ve `tests/rls` (`pnpm test:rls`).
- [ ] `scripts/ci/purge-check.sql` ile RLS'siz tablo olmadığını doğrula; pg_cron temizleme işleri (0004) çalışıyor mu kontrol et.
- [ ] Auth: anonim oturum açık, Turnstile (captcha) anahtarları, e-posta OTP şablonu, Google + Apple sağlayıcıları (`aura://auth/callback` ve web callback).
- [ ] Günlük yedek açık (SPEC 16.4).

## 2. Web / Vercel

- [ ] Vercel projesi: production + preview ortam değişkenleri (`.env.example`), `IYZICO_BASE_URL` canlı yalnız production.
- [ ] iyzico sözleşmesi ve canlı anahtarlar; sandbox'ta uçtan uca ödeme testi (`docs/qa-scenarios.md`).
- [ ] Resend alan adı doğrulaması; Sentry ve PostHog projeleri (EU host).
- [ ] `tests/e2e/privacy.spec.ts`, `security.spec.ts`, `flow.spec.ts` (FULL_FLOW_E2E=1) staging'e karşı; OWASP ZAP + elle IDOR (SPEC 16.4).
- [ ] Yasal metinler avukat onayı (SPEC 16.5); Uzman Ağı sağlık hukuku görüşü (SPEC 12.2) — flag kapalı kalır.

## 3. AI kalite (ücretli çağrı / fotoğraf seti)

- [ ] İzinli kalibrasyon fotoğraf seti (şifreli yerel disk) → `pnpm calibrate`, `pnpm fairness` (`docs/calibration.md`, `docs/fairness.md`) — adalet kapısı ≤ 0,3.
- [ ] `pnpm test:ai` tutarlılık (aynı yüz 5 foto ≤ 0,4), `scripts/compare-tryon.ts` sağlayıcı kararı (SPEC 21.1).

## 4. Mobil (hesaplar + cihaz)

- [ ] Apple Developer, Google Play Console, EAS hesapları; RevenueCat ürünleri/webhook; Sign in with Apple — `docs/store-submission.md` §1.
- [ ] `pnpm --dir mobile setup` → `eas build --profile development` → gerçek cihazda: /tara (< 10 sn, poz işaretleri, segmenter "Üst üçte bir"), sandbox satın alma → webhook → premium, sanal deneme drift ≤ %3, hesap silme/iptal, veri dışa aktarma.
- [ ] Native derleme doğrulaması: `modules/aura-segmenter` (Swift/Kotlin, MediaPipe Tasks 0.10.12/0.10.14) ilk EAS derlemesinde derlenmeli. API adları MediaPipe kaynak koduyla (iOS başlıkları v0.10.11=v0.10.14, Android v0.10.14) doğrulandı; kalan risk yalnız derleme/bağlama.
- [ ] mitmproxy gizlilik koşusu (`mobile/tests/privacy/README.md`).
- [ ] TestFlight + Play kapalı test; App Privacy / Data safety formları (`docs/store-submission.md` §4–5); yaş 17+/18+.

## 5. Ürün kararları (SPEC 21.1 / SPEC-MOBILE M10)

- [ ] Ürün adı, alan adı, bundle id/paket adı (şu an `com.easyegitim.aura`).
- [ ] Teaser modu A/B, skor modeli (flash-lite vs flash), deneme sağlayıcısı, `week_pass`, mağaza fiyat kademeleri, Apple Small Business başvurusu.
- [ ] Web uygulama ekranları lansmanda kapatılacak mı (yalnız pazarlama + yasal)?
