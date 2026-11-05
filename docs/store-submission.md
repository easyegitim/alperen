# Mağaza gönderimi (SPEC-MOBILE M8)

Ajan derleme/typecheck/test/export ve yapılandırmayı hazırlar; aşağıdaki adımlar hesap ve cihaz gerektirdiğinden insan tarafından yapılır. Metinlerde "sağlık iddiası yok" ve nötr dil kuralları (CLAUDE.md) aynen geçerlidir.

## 1. Hesaplar ve anahtarlar (insan)

- Apple Developer Program (Organization), App Store Connect uygulaması: bundle id `com.easyegitim.aura` (ürün adı kesinleşince `app.config.ts` ile birlikte değiştirilir).
- Google Play Console uygulaması: paket adı `com.easyegitim.aura`; Play App Signing açık.
- EAS: `npx eas-cli@latest login` → `eas init` → `EAS_PROJECT_ID` (`mobile/.env` veya EAS Secrets). Build sırları (EAS Secrets): `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`; `EXPO_PUBLIC_*` değerleri profil başına `eas.json` → `env` (gizli değer koyma).
- RevenueCat: iOS/Android uygulamaları, ürünler (`monthly`, `yearly`, isteğe bağlı `week_pass`), Offering "default", webhook → `https://<api>/api/billing/revenuecat` + `REVENUECAT_WEBHOOK_SECRET` (SPEC-MOBILE M6).
- Sign in with Apple: Apple Developer'da Service ID + key; Supabase Auth → Apple sağlayıcısı (Google varsa Apple zorunlu, Apple 4.8).
- Google Play: `google-play-service-account.json` (depoya girmez; `.gitignore`'da) ve Play Console'da API erişimi.

## 2. Derleme ve dağıtım

```bash
cd mobile
pnpm setup                                  # MediaPipe modelleri (face_landmarker.task, selfie_multiclass_256x256.tflite)
npx eas-cli@latest build --profile development --platform all   # dev client (cihaz testi)
npx eas-cli@latest build --profile preview --platform all       # TestFlight dışı iç dağıtım / APK
npx eas-cli@latest build --profile production --platform all    # mağaza paketi (autoIncrement)
npx eas-cli@latest submit --profile production --platform ios   # TestFlight → App Store
npx eas-cli@latest submit --profile production --platform android   # Play "internal" (draft)
```

Kapalı test: iOS TestFlight (dahili → harici test grubu), Android "Kapalı test" (en az 12 test kullanıcısı, 14 gün; Play'in kişisel hesap kuralı). Prod'a yalnız SPEC 20.3 "bitti" listesi ve `docs/launch-checklist.md` tamamlandığında geçilir.

## 3. Yaş derecelendirmesi

- App Store: 17+ (Infrequent/Mild Mature/Suggestive Themes: hayır; "Unrestricted Web Access": hayır). Uygulama içi yaş kapısı (18+) açılışta korunur; mağaza derecelendirmesi bunun yerine geçmez.
- Google Play: IARC anketi → 18+ hedef; "Kullanıcı tarafından oluşturulan içerik": hayır (paylaşım kartı yalnız kullanıcının kendi cihazında üretilir).

## 4. App Store "App Privacy" (Apple) — `app.config.ts` `privacyManifests` ile aynı

| Veri | Toplanıyor mu | Kimliğe bağlı | Takip | Amaç |
| --- | --- | --- | --- | --- |
| Fotoğraf (selfie) | Hayır (istek süresince geçici işlenir, saklanmaz) | – | – | – |
| Yüz geometrisi (`GeometryResult`) | Evet, "Other User Content" | Evet | Hayır | Uygulama işlevi |
| E-posta (hesap bağlama, isteğe bağlı) | Evet | Evet | Hayır | Uygulama işlevi |
| Kullanıcı kimliği | Evet | Evet | Hayır | Uygulama işlevi |
| Satın alma geçmişi (RevenueCat) | Evet | Evet | Hayır | Uygulama işlevi |
| Ürün etkileşimi (PostHog, yalnız izinle) | Evet | Hayır | Hayır | Analitik |
| Çökme / performans (Sentry) | Evet | Hayır | Hayır | Uygulama işlevi |

Yüz tanıma, yüz embedding'i, biyometrik kimlik yok (SPEC 16; "Face ID" verisi toplanmaz). ATT istenmez; `NSPrivacyTracking=false`, takip alanı yok.

## 5. Google Play "Data safety"

- Fotoğraflar: toplanır (geçici işleme), **saklanmaz**, paylaşılır: evet (AI sağlayıcısı, işleme amaçlı), şifreli aktarım, kullanıcı silme talebi: evet (uygulama içi hesap silme).
- Kişisel bilgi: e-posta (isteğe bağlı), kullanıcı kimliği. Finans: satın alma geçmişi. Uygulama etkinliği: etkileşim (isteğe bağlı, izinle). Çökme günlükleri, tanılama.
- Sağlık ve fitness: toplanmaz (anket cevapları sağlık verisi değildir; VKİ yalnız kullanıcı beyanıdır ve rapor üretiminde kullanılır — avukat görüşüne göre "sağlık bilgisi" olarak işaretlenebilir, SPEC 16.1).
- Güvenlik uygulamaları: aktarım şifreli, veri silme uygulama içinden, bağımsız güvenlik incelemesi: hayır.
- Hesap silme URL'si (Play zorunluluğu): `https://<web>/silme` (giriş gerekli) ve uygulama içi Hesap → Hesabımı sil.

## 6. Mağaza metinleri ve inceleme notları

- Başlık/alt başlık: "Aura — görünüm analizi ve bakım koçu". Sağlık, tedavi, estetik işlem, "en iyi", "garanti" ifadeleri yok; "AI tahmini" ve "tıbbi tavsiye değildir" cümlesi açıklamada.
- Ekran görüntüleri: yalnız izinli model/sentetik yüz; gerçek kullanıcı selfie'si yok; önce/sonra karşılaştırması yok.
- İnceleme notları (App Review / Play): test hesabı (premium açık, staging), "uygulama 18+ yaş kapısı içerir", "yüz tanıma yapılmaz; sadece geometri", "fotoğraf saklanmaz", Uzman Ağı kapalı (`FEATURE_EXPERT_NETWORK=false`).
- Abonelik (Apple 3.1.2): fiyat, süre, otomatik yenileme ve iptal metni paywall'da (`app/premium.tsx`), Kullanım Koşulları ve Gizlilik bağlantıları.
- Hesap silme (Apple 5.1.1(v), Play): uygulama içinde (`app/hesap.tsx` → `app/silme.tsx`).

## 7. Cihaz doğrulaması (yayın öncesi, insan)

1. Dev client ile `/tara`: analiz < 10 sn; inceleme ekranında yaw/pitch/roll işaretleri web ile aynı; "Üst üçte bir" değeri doluysa segmenter çalışıyor (M8).
2. Sandbox satın alma (iOS Sandbox / Play lisanslı test) → webhook → premium; uygulamayı yeniden açınca durum sunucudan gelir.
3. mitmproxy ile `mobile/tests/privacy` kuralları: görsel yalnız `/api/analyses` ve `/api/tryon`'a; PostHog/Sentry gövdelerinde görsel/landmark/skor yok.
4. Hesap silme → 7 gün → iptal akışı; veri dışa aktarma dosyası paylaşım sayfasında açılıyor.
5. Koyu/açık tema, VoiceOver/TalkBack etiketleri, 360 px genişlik.
