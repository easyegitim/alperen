# apps/web — Öğrenmen web uygulaması

Öğrenci, veli ve eğitmenin tek uygulaması: **Next.js 16** (App Router, React 19, TypeScript, Tailwind 4) + **Supabase Auth/RLS** + PWA.
Plan: `docs/PLAN-v2.md` (§13 IA) ve `docs/PLAN-v2-detail.md`. Tasarım: `packages/design-system` (`@ogrenmen/design-system`).

Bu paket **iskelettir**: kimlik doğrulama, rol yönlendirmesi, üç kabuk, her rota için gerçek sayfa iskeleti, PWA ve tema hazırdır.
Ürün verisi (koç sohbeti, teşhis, deneme, rapor, ...) P1'de bağlanır. ANTHROPIC anahtarı bu pakette **yoktur**; LLM çağrıları yalnızca `apps/worker`'da yapılır.

## Çalıştırma

```bash
cd apps/web
cp .env.example .env.local        # Supabase adresi + anon anahtarı (yerel: `supabase start` çıktısı)
bun run dev                       # Turbopack, http://localhost:3000 (servis çalışanı kapalı)
bun run build && bun run start    # üretim: webpack derlemesi (Serwist), servis çalışanı public/sw.js
bash check.sh                     # typecheck + eslint + vitest + next build
OGRENMEN_LIVE=1 bash check.sh     # + Playwright E2E (sahte Supabase; Chromium gerekir)
bun run icons                     # PWA simgelerini maskottan yeniden üretir (sharp)
```

Paket kurulumu her zaman kökten: `cd /home/user/alperen && flock /tmp/ogrenmen-bun.lock bun install`.

## Ortam değişkenleri

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | evet | Supabase proje adresi. Derleme sırasında gömülür. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | evet | Herkese açık (anon) anahtar. `service_role` anahtarı bu uygulamada **kullanılmaz** (RLS, kullanıcının JWT'siyle). |
| `NEXT_PUBLIC_SITE_URL` | önerilir | Dışarıdan görünen adres; e-posta bağlantısı ve Google dönüşü bununla kurulur. Boşsa `x-forwarded-*` başlıklarından türetilir. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | isteğe bağlı | Web-push VAPID **herkese açık** anahtarı (base64url). Boşsa "Anlık bildirimleri aç" düğmesi yerine açıklama görünür. Özel anahtar worker'dadır. |

Ayrıca (yalnız E2E): `E2E_WEB_PORT` (3101), `E2E_SUPABASE_PORT` (54399), `E2E_OFFLINE_PORT` (3102).

## Rotalar

| Yol | Rol | İçerik |
|---|---|---|
| `/` | herkes | Oturuma ve role göre yönlendirir |
| `/giris` | herkese açık | E-posta kodu (OTP) + sihirli bağlantı + Google; `?next=` korumalı (yalnız uygulama içi yol) |
| `/auth/callback`, `/auth/confirm` | herkese açık | PKCE `?code=` değişimi; `token_hash` doğrulaması |
| `/hos-geldin` | oturumlu, onboarding bitmemiş | Rol seçimi; öğrenci formu (ad, sınıf, hedef); veli formu (davet kodu → `accept_guardian_invite`); eğitmen: davetle bilgisi |
| `/ogrenci` | öğrenci (+admin) | **Koç**: günün planı boş durumu, `TutorMessage`, `ModeToggle` |
| `/ogrenci/sor` | | **Sor**: `CameraSheet` (kamera FAB'ının hedefi) |
| `/ogrenci/denemeler`, `/notlarim`, `/konu-haritasi` | | Boş durum (maskot) |
| `/ogrenci/profil` | | Hesap, bildirim aboneliği, tema, çıkış |
| `/ogrenci/profil/hafiza` | | `memory_files` listesi (RLS); boşsa açıklama |
| `/veli` | veli (+admin) | **Özet**: bağlı çocuklar (`guardian_links`) |
| `/veli/sohbet`, `/raporlar` | | Boş durum |
| `/veli/bildirimler` | | `notifications` listesi (RLS) |
| `/veli/ayarlar` | | Ek davet kodu kabulü, bildirim aboneliği, tema, çıkış |
| `/egitmen` | eğitmen/admin | **Öğrenciler** (`instructor_links`) |
| `/egitmen/dersler` | | `courses` listesi (RLS) |
| `/egitmen/mufredatlar`, `/soru-tarzlari`, `/icerik`, `/sinavlar`, `/kuyruk`, `/maliyet` | | Boş durum |
| `/egitmen/ayarlar` | | Tema, çıkış |
| `/cevrimdisi` | herkese açık | Servis çalışanının önceden önbelleğe aldığı yedek sayfa |
| `/api/health` | herkese açık | `{status, service, time, supabase}`; önbelleğe alınmaz |
| `/manifest.webmanifest` | herkese açık | PWA bildirimi (`app/manifest.ts`) |

Kök adres, giriş ve alan geçişleri `src/proxy.ts` + `src/lib/routing.ts` (saf `decideRoute`) ile; yetkinin asıl noktası sunucuda `requireRole` (`src/server/auth.ts`).

## Kimlik doğrulama ve rol yönlendirmesi

- **Giriş**: `src/app/giris/actions.ts` (sunucu eylemleri): `signInWithOtp` (e-postaya 6 haneli kod **ve** sihirli bağlantı), `verifyOtp`, `signInWithOAuth('google')`. Şifre yok.
- **Oturum**: `@supabase/ssr` çerezleri. `src/proxy.ts` her sayfa isteğinde oturumu yeniler (`getClaims()`: imza doğrulanır) ve `profiles.role` ile yönlendirir:
  oturumsuz → `/giris?next=`; profil/onboarding eksik → `/hos-geldin`; `/` ve `/giris` → rol ana sayfası (`student→/ogrenci`, `parent→/veli`, `instructor|admin→/egitmen`); başka rolün alanı → kendi ana sayfası. Yönetici üç alanı da görebilir.
- **Onboarding** (`/hos-geldin`): öğrenci → `profiles` (rol `student`; `students` satırını tetikleyici açar) + `students.grade`; hedef sınav ve hedef metni, ders (müfredat) seçilene kadar kullanıcı üst verisinde (`auth.users.raw_user_meta_data`) bekler (kayıt için `enrollments.curriculum_id` gerekir). Veli → `accept_guardian_invite(p_token)` RPC'si (profil yoksa rol `parent` açar; hata kodları `OGR-INV-001/002/003` Türkçeye çevrilir). Eğitmen/yönetici hesabını easy ekibi açar; kendi kendine eğitmen olunamaz (RLS `profiles_insert_self` yalnız student/parent'a izin verir).
- **Supabase tarafı** (`supabase/config.toml`, bu pakette değişmez; kurulumda gerekir):
  - `site_url` ve `additional_redirect_urls` = uygulama adresi + `/auth/callback`.
  - E-posta şablonu (magic link/OTP) hem `{{ .Token }}` (6 haneli kod) hem `{{ .ConfirmationURL }}` içermeli.
  - Google: `[auth.external.google] enabled = true`, `client_id`/`secret` (ortam değişkeninden) ve Google konsolunda yönlendirme adresi `<supabase-url>/auth/v1/callback`.
- **Tipler**: `src/lib/supabase/types.ts` göçlerden elle türetilmiştir; `test/types-drift.test.ts` sütun adlarını `supabase/migrations/*.sql` ile karşılaştırır.

## Kabuklar (PLAN §13)

- Öğrenci: mobil alt gezinme **Koç · Denemeler · Notlarım · [Sor kamera FAB] · Konu haritası · Profil** (DS `AppShell`); masaüstünde kenar çubuğu.
- Veli: **Özet · Sohbet · Raporlar · Bildirimler · Ayarlar**.
- Eğitmen: kenar çubuğu **Öğrenciler · Dersler · Müfredatlar · Soru tarzları · İçerik · Sınavlar · Kuyruk · Maliyet · Ayarlar**. Dokuz madde alt çubuğa sığmadığı için dar ekranda üst çubukta "Menü" düğmesi (`InstructorShell`).
- Her sayfa tek `h1` (`PageHeader`), boş durum `EmptyState` (maskot dekoratif, metin yanında). Metinler Türkçe, sen dili, ünlem/emoji yok.

## PWA

- `app/manifest.ts`: ad "Öğrenmen", `theme_color #0030a2`, `standalone`, simgeler `public/icons` (maskottan `scripts/make-icons.mjs` ile; 192, 512, maskable 512, apple-touch 180, bildirim rozeti 96).
- **Servis çalışanı** (`src/sw/sw.ts` → `public/sw.js`, `@serwist/next`): derleme çıktısı + `/cevrimdisi` önceden önbellekte (çevrimdışı kabuk); `/_next/static` (token CSS'i dahil) ve yazı tipleri CacheFirst; simgeler StaleWhileRevalidate. **Kişisel sayfalar ve `/api` hiçbir zaman önbelleğe alınmaz**; ağ yoksa gezinti isteği `/cevrimdisi`'ye düşer (E2E: sunucu gerçekten kapatılarak sınanır). `push` ve `notificationclick` işleyicileri vardır (`src/lib/push-payload.ts`: `{title, body, url, tag}`).
- **Derleme webpack ile** (`next build --webpack`): Serwist eklentisi Turbopack'te çalışmaz. Geliştirme Turbopack'tir ve servis çalışanı kapalıdır.
- `InstallPrompt`: Chromium'da `beforeinstallprompt` ile yükleme, iOS'ta "Ana Ekrana Ekle" yönergesi; yüklüyse ya da kapatıldıysa görünmez.
- Web-push (`src/lib/push.ts`, `PushToggle`): izin + abonelik → `push_subscriptions` (RLS: kendi satırı). **Gönderim worker'dadır.**

## Tema ve yazı tipleri

`data-theme` açık/koyu; varsayılan "Sistem" (özellik verilmez, `prefers-color-scheme` geçerli). Tercih `localStorage` (`ogrenmen-tema`); boyama öncesi satır içi betik titremeyi önler. `<html lang="tr">`. Lexend ve JetBrains Mono, tasarım sisteminin `tokens.css` dosyasındaki `@font-face` ile paket içinden gelir (`font-display: swap`); harici istek yok.

## Tasarım sistemi sınırı (`src/ds.ts`)

`@ogrenmen/design-system` dosyalarında `'use client'` yönergesi yoktur ve bazıları kanca kullanır; bu yüzden paket sunucu bileşeninden doğrudan içe aktarılamaz (Next derlemesi hata verir). Tüm bileşenler `@/ds` üzerinden alınır (`'use client'` sınırı). Kuralları:

- Sunucu bileşeni `@/ds` bileşenlerini serileştirilebilir özelliklerle çizebilir; **işlev prop'u** (`onClick`, `renderLink`) gereken yerde istemci sarmalayıcı yazılır (`RoleShell`, `LinkButton`, `SorYakalama`, ...).
- Bir `@/ds` işlevini (`buttonClasses`, `formatPercent`, ...) sunucuda **çağırma**; istemci bileşeninde kullan.
- `test/ds-barrel.test.ts` listenin paketin dışa aktarımlarıyla eşleştiğini denetler.

## Testler

- `bun run test` (vitest, jsdom): yönlendirme tablosu, doğrulama, tema, web-push yardımcıları, hafıza başlıkları, gezinme, Supabase tip uyumu, DS giriş noktası.
- `bun run test:e2e` (Playwright, Chromium; `e2e/build.mjs` önce `.next-e2e` üretim derlemesini yapar): **sahte Supabase** (`e2e/fake-supabase.mjs`; Auth + PostgREST alt kümesi, gerçek RLS taklit edilmez — RLS `supabase/tests`'te) üzerinde
  giriş sayfası, e-posta kodu akışı, korumalı sayfa yönlendirmesi, rol yönlendirmesi (sahte oturum çerezi), onboarding, her rotanın açılışı, 3 kabuk × 390/1440 px (yatay taşma yok; ekran görüntüleri `test-results/screens/`, git'te yok), koyu tema, PWA bildirimi/servis çalışanı/gerçek çevrimdışı yedek sayfa.
- Chromium: `PLAYWRIGHT_BROWSERS_PATH` altında hazır olmalı (`@playwright/test` 1.56.1, Chromium 1194).

## Bilinen boşluklar

- Koç sohbeti, teşhis, deneme, not, konu haritası, rapor, kuyruk, maliyet sayfaları **boş durum**dur; veri bağlantısı P1.
- `Sor`: kamera ve çoklu çekim çalışır, gönderim yoktur (fotoğraflar yalnız cihazda hazırlanır; arayüz bunu söyler).
- Öğrenci hedefi (`target_exam`, `goal`) `enrollments`'a değil kullanıcı üst verisine yazılır; ders seçimi (P1) taşır.
- Hafıza "Düzeltme iste" düğmesi bağlanmadı (eylemi yok); yalnız okuma.
- Google girişi uygulama tarafında hazır; Supabase `config.toml`'da sağlayıcı ve yönlendirme adresleri ayarlanmalı.
- `next build` webpack ile; Serwist Turbopack desteği gelince `--webpack` kalkar.
