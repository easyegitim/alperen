Öğrenmen, easy eğitim şirketinin yapay zekâ destekli öğrenme modelidir: her öğrenciye kendi hızında eşlik eden bir AI öğretmen. Arayüz sakin ve aydınlıktır; dikkat içerikte ve öğretmenle yapılan sohbette kalır. Kimlik, maskotun pelerin mavisi, kitap laciverti ve kemer altınından; kurumsal imza easy'nin morundan gelir. İlk sürüm bir Telegram botudur, web arayüzü sonra gelir; ikisinin kuralları aynı, yüzeyleri ayrı bölümlerdedir (Telegram'da Öğrenmen · Eğitmen paneli · Güven ve şeffaflık).

## İçerik ilkeleri

- **Sen dili, sıcak ama ciddi.** Öğrenciye "sen" diye hitap et. Öğretmen konuşur gibi yaz, reklam gibi değil.
  - Yap: "Harika gidiyorsun. Şimdi paydaları eşitleyelim."
  - Yapma: "Süpersin!!! 🚀 Hadi bakalım!"
- **Sokratik varsayılan.** AI öğretmen bir balonda tek bir şey söyler ve çoğu zaman bir soruyla bitirir; cevabı hemen vermez, ipucu verir. Öğrenci isterse `ModeToggle` ile doğrudan cevap moduna geçer; sistem bu modu kendiliğinden açmaz.
- **Hata utandırmaz.** Yanlışta "Tekrar dene" de ve nedenini tek cümleyle açıkla: "Paylar ve paydalar ayrı ayrı toplanmaz." "Yanlış!" yazma.
- **Kanıt yoksa iddia yok.** Ustalık, kavram yanılgısı ve ders raporu maddeleri kaynağıyla (`EvidenceQuote`) gelir; gözlem sayısı eşiğin altındaysa "Henüz yeterli kanıt yok" yazılır, yüzde yazılmaz.
- **Tahmin değil öncelik.** Sınav modellemesi "sıklık analizine göre öncelik" diye sunulur; "çıkacak", "kesin", "tahmin" kelimeleri kullanılmaz.
- **Ünlem ve emoji yok.** Ödül anında bile. Yıldız (★), onay (✓) ve çarpı (✕) işaretleri metnin yanında işlev görür, süs değildir.
- **Düğmeler fiille başlar, cümle düzeninde:** "Derse başla", "İpucu al", "Rozeti al", "Onaylıyorum".
- **Adı doğru yaz:** "Öğrenmen" (büyük Ö, ğ ile), şirket adı küçük harfle "easy". Büyük harfli etiketlerde Türkçe kuralı geçerlidir: "MATEMATİK", "FEN BİLİMLERİ" — CSS `text-transform` kullanıyorsan sayfaya `lang="tr"` ver.
- **Yapay zekâ gizlenmez.** Öğretmenin adının yanında her zaman "AI öğretmen" etiketi; kişiye özel üretilen içerik `ai` rozetini veya "Öğrenmen sana göre hazırladı" notunu taşır. Bot emin değilse söyler ve hocaya yönlendirir (`Notice` `handoff`).
- Sayılar Türkçe biçimde: `%62`, `3,5 saat`, `12 dk · 8 soru`, `0,002 $`.

## Renk

- Sayfa `surface`, kartlar ve balonlar `surface-raised`, girdi, ray ve kanıt alıntısı `surface-sunken`. Metin `ink`, ikincil metin `ink-muted`; üçü de her iki temada tüm yüzeylerde 4.5:1 üstüdür.
- **`primary` (Öğrenmen mavisi) eylemin rengidir:** birincil düğme, seçili şık, bağlantı, süren ilerleme, ustalık dolgusu. Üzerindeki metin her zaman `on-primary` — koyu temada `primary` açılır ve üzerindeki metin laciverte döner, düz beyaz yazma.
- **`gold` ödülün rengidir:** seri, rozet, tamamlanan hedef, `reward` düğmesi. Yalnızca dolgu; üzerinde `on-gold`. Altın tonlu metin gerekiyorsa `gold-ink`. Uyarı anlamında kullanılmaz.
- **Durum renkleri kelimeyle gelir:** `success` (✓ Doğru, Tamamlandı, Çözüldü, Hedefte), `warning` (Onay bekliyor, Açık, Dikkat), `danger` (✕ Tekrar dene, Acil, kaldırılacak). Hiçbiri tek başına anlam taşımaz; rozet, bildirim ve panel satırı durumu her zaman yazar.
- **`ai-glow` yapay zekânın işaretidir:** öğretmen balonunun ve AI kartının kenar ışığı (`shadow-ai`), kapak ve illüstrasyon. Yalnızca dekoratif — açık temada beyaz üzerinde 2.8:1'de kalır; anlam taşıyan gösterge (yazıyor noktaları, ikon) `primary` ile çizilir.
- **`easy-purple` yalnızca kurumsal imzadır:** alt bilgi, "by easy" bandı, `brand` rozeti, easy logosu. Ürün arayüzünde eylem veya vurgu rengi olarak kullanma; Öğrenmen'in ürün rengi mavidir.
- `navy` koyu kahraman bantları ve pazarlama bloklarıdır; üzerinde `on-navy`. `paper` koddan üretilen şekillerin zeminidir; her iki temada aynı açık ton, üzerinde `navy` çizgi.
- Gradyan yok. Derinlik `shadow-sm`, `shadow-lg` ve AI için `shadow-ai` ile verilir.

## Tipografi

- Tek aile: **Lexend** (400, 500, 600, 700 — `fonts/` içinde, Türkçe karakterler tam). Lexend okuma akıcılığı için tasarlanmıştır; öğrenme ürünü için bilinçli seçimdir. Kod, formül, sayısal cevaplar ve DOI **JetBrains Mono** (`code`).
- Ekran başlığı `title-1`, bölüm `title-2`, kart başlığı ve soru metni `title-3`. `display` yalnızca karşılama ve pazarlama, sayfada bir kez. Panelde büyük sayı `title-1` boyutunda ve orantılı rakamla; `tabular-nums` yalnızca hizalanan sütunlarda.
- Ders anlatımı ve öğretmenin uzun açıklamaları `body-lg`; arayüz ve sohbet `body`; düğme ve form etiketleri `label`; meta bilgi ve kanıt `small`; rozet ve kaynak satırı `caption`.
- Okuma metnini 68 karakteri geçen satırlara yayma; ders içeriğinde sütun genişliği en fazla 640px.

## Boşluk, köşe, yerleşim

- 4px tabanlı ölçek: denetim içi `space-2`, satırlar arası `space-3`, kart ve balon dolgusu `space-4`, kart grupları arası `space-6`, bölümler arası `space-8`, sayfa üstü `space-12`.
- Köşeler: rozet, girdi ve ray `radius-sm`, düğme, şık, bildirim ve satırlar `radius-md`, kart ve sohbet balonu `radius-lg`, avatar ve hap `radius-full`. Logo keskin açılıdır; arayüz yalnızca hafif yumuşaktır — her şeyi hapa çevirme.
- Kart kenarı `line`, form denetimi kenarı `line-strong` (3:1 üstü). Renkli sol kenar çizgisi yok; durum rozetle söylenir.
- Klavye odağı her zaman `focus-ring`: 2px sayfa rengi boşluk, ardından 2px düz `focus` halka. Hiçbir denetimde odak gizlenmez.
- Hareket kısa ve işlevseldir (150–300ms); `prefers-reduced-motion` açıkken yazıyor animasyonu ve dolgu geçişleri durur.

## Logo ve maskot

- Ürün imzası `BrandLockup`: easy işareti + "Öğrenmen". Açık zeminde `easy-isaret-mor.png`, koyu zeminde ve `navy`/`primary` dolgu üzerinde `easy-isaret-beyaz.png`. Özgün mor zeminli logo (`easy-logo-mor-zemin.png`) kurumsal kullanım içindir.
- İşareti yeniden çizme, renklendirme, eğme; çevresinde işaret yüksekliğinin en az dörtte biri kadar boşluk bırak.
- Maskot (`ogrenmen-maskot.webp`) AI öğretmenin yüzüdür: karşılama ekranı, boş durumlar, ders sonu, `TutorMessage` avatarı ve Telegram bot profili. Üzerine metin yazma, logo yerine kullanma, yüzünü ve kulaklığını kırpma.

## Şekil ve ses

- Soru şekilleri görüntü modeliyle değil koddan üretilir ve `FigureFrame` içinde, `paper` zemininde, `navy` çizgi ve sabit #0030a2 vurguyla (açık temanın `primary` değeri) gösterilir; şekil tema değişkeni kullanmaz, iki temada aynı dosya. Her şeklin alternatif metni şekli kelimelerle anlatır. Denetimden geçmemiş şekil öğrenciye gösterilmez.
- Mikrofon yalnızca öğrenci basılı tutarken açıktır; ses düğmesi basılıyken `primary` dolgu ve "Dinliyor" etiketi taşır. Sesli yanıt varsayılan kapalıdır ve metni her zaman ekranda kalır.

## İkonografi

Sistemde henüz özel bir ikon seti yok. Bileşenler işlevsel karakterler kullanır: ✓ (doğru/tamamlandı/doğrulandı), ✕ (yanlış/hata/kaldırılacak), ★ (seri/ödül), · (meta ayırıcı). Bir ikon seti eklenene kadar emoji kullanma; ikon her zaman bir metin etiketinin yanında durur.

## Bileşenler

`components/bundle.js` sayfaya `window.Ogrenmen` olarak yüklenir ve React 18 bekler; stiller `components/bundle.css` içinde, `og-` önekiyle. Her bileşenin kılavuzu kendi `README.md` dosyasındadır.

- Marka ve temel: `BrandLockup`, `Button`, `Badge`, `TextField`, `ProgressBar`, `Notice`.
- Öğrenci (Kulaklık, Tablet, Kalem): `TutorMessage`, `ModeToggle`, `LessonCard`, `QuizOption`, `FigureFrame`, `ExamPriorityRow`.
- Profil (Gözlük): `MasteryMeter`, `MisconceptionItem`, `EvidenceQuote`.
- Araştırma (Kitap): `CitationCard`.
- Eğitmen paneli: `StatTile`, `AlertRow`; `TutorMessage` `review` satırı.
