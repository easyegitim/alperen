# Aura — Ajan Kuralları

## Ürün

18+ kullanıcılar için Türkçe mobil web (PWA) AI görünüm analizi ve bakım koçu: selfie → cihazda geometri → sayısal skor (genel + 6 alt + potansiyel) → kişisel plan → 60 stilde saç/sakal denemesi → rutin ve haftalık takip. Tam spesifikasyon: `docs/SPEC.md`. Belirsiz bir konuda önce SPEC'e bak; orada yoksa dur ve sor, tahmin etme. Öncelik: `CLAUDE.md` > `docs/SPEC.md` > kendi varsayımın. Çelişkide değer sırası: kullanıcı güvenliği ve hukuk > veri gizliliği > yetkilendirme > doğru çalışan ürün > test edilebilirlik > performans > görsel kalite > ek özellik.

## Onay gerektiren işlemler

Aşağıdakileri kullanıcının açık onayı olmadan yapma. İşi hazırla, dur, ne yapacağını söyle ve onay iste:

- `git push`, `main`'e birleştirme, PR açma veya kapatma, geçmişi yeniden yazma (force push, rebase -i).
- Production deploy veya Vercel production ortam değişkeni değişikliği.
- Staging veya production Supabase'e migration (`supabase db push --linked`), veri silme, tablo sıfırlama.
- Canlı iyzico anahtarlarıyla herhangi bir istek; gerçek kartla ödeme.
- Ücretli AI çağrısı yapan toplu betikler: `pnpm calibrate`, `pnpm fairness`, `pnpm test:ai`, `scripts/compare-tryon.ts`.
- Yeni harici servis, hesap veya ücretli plan.
- Mevcut kodu, belgeyi veya kullanıcının çalışmasını silme ya da baştan yazma.

## Ortamlar

- **development:** yerel Supabase (Docker), iyzico sandbox veya ödeme kapalı, sahte/izinli test verisi.
- **staging:** ayrı Supabase projesi, iyzico sandbox, Vercel preview, test kullanıcıları, E2E testleri.
- **production:** ayrı Supabase projesi, ayrı gizli anahtarlar, canlı iyzico, izleme ve alarmlar.

Staging ve production aynı veritabanını veya anahtarları paylaşmaz. Production verisi staging'e veya yerele kopyalanmaz. `IYZICO_BASE_URL` canlı adres yalnız production'da; diğer ortamlarda sandbox.

## Değişmez ürün kuralları

- Skor dürüsttür: kalibrasyon herkes için aynı (`lib/score/calibration.ts`). Ödeme durumu, plan, kampanya veya pazarlama için skora müdahale etme. Kullanıcılar arası sıralama, yüzdelik, liderlik tablosu yok.
- Kilitli (ücretsiz kullanıcıya kapalı) değerler sunucudan asla gönderilmez: `null` + `locked:true` (`lib/score/present.ts`). `analyses` ve `coach_reports` tablolarına tarayıcıya okuma politikası verme.
- Fotoğraf, kamera karesi ve 478 noktalık dizi veritabanına, depolamaya, loglara, analitiğe yazılmaz. Görsel yalnız `/api/analyses` ve `/api/tryon` içinde bellekte işlenir, AI sağlayıcısına iletilir, bırakılır.
- Yüz tanıma, kimlik eşleştirme, yüz embedding'i, yaş/etnik köken/din çıkarımı yok. Karede tek yüz zorunlu.
- AI cerrahi/estetik işlem, ilaç, takviye, hormon, steroid, mewing, bonesmashing, aç kalma önermez. Hastalık adı yalnız `seeProfessional` alanında ve "… için bir dermatoloğa göstermek faydalı olabilir" kalıbıyla.
- Rapor katalog tabanlıdır: stil, egzersiz, alışkanlık, cilt adımı yalnız `content/` listelerinden seçilir. Tüm AI metni `lib/ai/safety.ts`'ten geçer.
- Yağ oranı/kalori içeriği yalnız VKİ ≥ 25 iken ve günlük açık ≤ 500 kcal (`lib/coach/bodyRules.ts`). Egzersizler yalnız `jawHealth` "hiçbiri" iken. Başörtüsü varsa saç önerisi yok.
- Sanal denemede kullanıcının yüzü orijinal piksellerle geri yazılır (`lib/tryon/composite.ts`); kontrol başarısızsa sonuç gösterilmez, kota iade edilir. Deneme kemik yapısını değiştiren görsel üretmez.
- 18 yaş altı hiçbir uygulama ekranına giremez. Rıza, 18+, premium ve kota kontrolleri sunucuda (`withGuard`); istemci kontrolü yalnız UX içindir. Tarayıcıdan gelen "ödeme başarılı" bilgisi premium açmaz.
- Uzman Ağı `FEATURE_EXPERT_NETWORK=false` iken tamamen kapalıdır (404). Partner kartında fiyat, kampanya, önce/sonra görseli yok. Kullanıcı fotoğrafı partnerle asla paylaşılmaz.
- Arayüzde aşağılayıcı dil (çirkin, kötü, kusur, zayıf çene…) ve looksmaxxing argosu (PSL, mog, chad, incel) yok.

## Teknik kurallar

- Next.js App Router, TypeScript `strict`. `any` yalnız SDK sınırında ve açıklama yorumuyla.
- Tüm API girdileri Zod ile doğrulanır; hata gövdesi `lib/api/errors.ts` biçiminde.
- Gizli anahtarlar yalnız sunucuda; service-role istemcisi yalnız `lib/db/admin.ts` (`"server-only"`). `NEXT_PUBLIC_` önekli değişkene gizli değer koyma; gerçek anahtarı `.env.example`'a, koda veya loga yazma.
- Yeni tablo = yeni migration + RLS + `pnpm db:types`. Tablo tiplerini elle yazma.
- Kota ve idempotency yalnız `reserve_analysis` / `reserve_tryon` SQL fonksiyonlarıyla.
- Fiyat, hak, teaser modu, model adı, eşik ve flag'ler `lib/config/*` veya ortam değişkenindedir; koda gömme.
- Arayüz metinleri `messages/tr.json`'da. Mobil önce (360 px), açık/koyu tema, erişilebilir etiketler, kontrast AA.
- Yüz, skor, deneme ve koç kuralları saf fonksiyonlardır ve birim testi vardır.
- Analitik olayları yalnız `lib/analytics.ts` adlarıyla; olaylara fotoğraf, skor, metrik, e-posta eklenmez.
- iyzico, Gemini, MediaPipe, Supabase, fal.ai API'lerinde emin olmadığın alan adını uydurma; güncel dokümana bak.
- Eksik API anahtarı veya servis erişimi varsa entegrasyonu hazırla, engeli raporla. Sahte başarı, mock'u gerçekmiş gibi gösterme veya gerçek ödeme/API sonucu uydurma yok.

## Asla yapma

- RLS'yi, `withGuard`'ı, CSP'yi veya başka bir kontrolü "çalışsın diye" gevşetmek. Engel varsa dur ve açıkla.
- Testi silerek, `skip`/`only` ekleyerek veya beklentiyi gevşeterek CI'ı geçirmek.
- TypeScript hatalarını `any`, `@ts-ignore` veya `as unknown as` ile örtmek.
- Herkese açık storage bucket açmak; selfie'yi debug loguna, test fixture'ına veya depoya koymak. Test fotoğrafları yalnız şifreli yerel diskte durur.
- Eksik veya yarım özelliği "bitti" diye raporlamak.

## Gizlilik testi (zorunlu)

`tests/e2e/privacy.spec.ts` Playwright ile tüm ağ trafiğini izler ve şunları doğrular:

- Görsel içeren gövde (`image/*`, multipart, `/9j/` ile başlayan base64 JPEG) yalnız `POST /api/analyses` ve `POST /api/tryon`'a gider. PostHog, Sentry, Supabase REST/Auth, Resend, Turnstile ve diğer hiçbir yere gitmez.
- `/api/analyses` gövdesinde 478 noktalık dizi yok; yalnız `GeometryResult` var.
- Analitik ve hata olaylarında görsel, landmark, skor, metrik, e-posta yok.
- İlerleme fotoğrafları (IndexedDB) hiçbir isteğe girmez.
- Ücretsiz hesapta API yanıtlarında kilitli değerler yok; Supabase istemcisiyle `analyses`/`coach_reports` okunamıyor.

Faz 7'den itibaren her faz sonunda çalışır. Geçmezse faz bitmiş sayılmaz.

## Çalışma biçimi

- Oturum veya faz başında: `git status` ile depo durumunu kontrol et, SPEC'in ilgili bölümünü oku, eksik veya çelişkili gereklilikleri listele.
- Her görev bir özellik kimliği taşır (örn. F07). Yalnız o özelliğin dosyalarına dokun. Commit: `"F07: …"`. Her faz ayrı dalda yapılır.
- Kod yazmadan önce kısa plan: değişecek dosyalar ve adımlar. Sonra uygula.
- Bitirmeden önce `pnpm typecheck && pnpm lint && pnpm test` geçmeli; geçmiyorsa düzelt, "bitti" deme.
- Küçük, gözden geçirilebilir değişiklikler; büyük dosyaları baştan yazma. Yeni paket için gerekçe söyle; basit ve güvenilir çözümü önce dene, gereksiz servis veya paket ekleme.
- Bir sonraki faza yalnız önceki fazın çıkış kriteri (SPEC Bölüm 19) sağlandığında geç.

## Görev sonu raporu

Küçük görevlerde: ne değişti, nasıl test edilir (telefonda dahil), bilinen eksikler (en fazla 3 madde). Faz sonunda şu biçim kullanılır:

```text
FAZ:                 [numara ve ad, özellik kimlikleri]
DURUM:               Tamamlandı | Kısmi | Engellendi
YAPILANLAR:          - …
DEĞİŞEN DOSYALAR:    - …
VERİTABANI:          - migration'lar, RLS değişiklikleri (yoksa "yok")
TESTLER:             - çalıştırılan komutlar ve sonuçları (privacy.spec dahil)
GÜVENLİK KONTROLÜ:   - SPEC 16.4'ten bu fazı ilgilendiren maddeler
ÇIKIŞ KRİTERİ:       - SPEC Bölüm 19'daki kriter ve ölçülen değer
BİLİNEN EKSİKLER:    - en fazla 3 madde
ELLE DOĞRULAMA:      1. … (gerçek telefonda adımlar dahil)
ONAY BEKLEYENLER:    - push, merge, migration, deploy vb. (yoksa "yok")
SONRAKİ ADIM:        …
```

## Mobil uygulama (mobile/ — docs/SPEC-MOBILE.md)

- Ürün lansmanı iOS + Android (Expo). Next.js kod tabanı API, pazarlama, yasal ve admin olarak kalır; `app/(app)/*` web ekranları dondurulur, silinmez.
- `mobile/` yalnız saf paylaşılan modülleri içe aktarır (SPEC-MOBILE M1 listesi). `"server-only"`, `next/*`, DOM API içeren modül mobilden içe aktarılmaz.
- Mağaza satın alma sonucu (RevenueCat/StoreKit/Play) istemcide premium açmaz; yetki yalnız webhook/sunucu doğrulamasıyla `subscriptions` üzerinden gelir.
- Fotoğraf ve landmark kuralları aynen: görsel yalnız `/api/analyses` ve `/api/tryon`'a gider; cihazda yalnız geçici dosya; ilerleme fotoğrafları uygulama sanal alanında, ağa çıkmaz.
- Native paket eklerken sürüm uyumunu (Expo SDK, vision-camera, worklets) doğrula; emin olmadığın native API adını uydurma.
- Ajan cihazda/simülatörde çalıştıramaz: her mobil faz `pnpm --filter mobile typecheck && lint && test` ve `expo export` ile doğrulanır; cihaz testi "ELLE DOĞRULAMA"ya yazılır.
- Görev kimlikleri M0–M8; commit: `"M3: …"`.
