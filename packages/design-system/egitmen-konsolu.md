# Eğitmen konsolu

Eğitmenin (easy personeli) bir bakışta görmesi gereken dört şey: kim bekliyor, kim sessiz, kimde düşüş var, ne zaman teslim. Konsol bunları bu sırayla gösterir; grafik en sona kalır. Konsol masaüstü içindir (1440px referans); tek uygulamanın parçasıdır ve `AppShell` kenar çubuğuyla gezilir. Öğrenci ve veli yüzeyleriyle aynı bileşenleri ve aynı kanıt kurallarını kullanır.

## Gezinme (kenar çubuğu)

Öğrenciler · Dersler · Müfredatlar · Soru tarzları · İçerik · Sınavlar · Kuyruk · Maliyet · Ayarlar. Etkin sayfa `aria-current="page"` ve `primary-soft` zemin taşır; her öğede ikon ve metin birlikte durur.

## Ekranlar

- **Öğrenciler.** En üstte en fazla dört `StatTile`: cevapsız soru, sessiz öğrenci, yaklaşan teslim, ortalama yanıt süresi. Durum taşıyan kutu kelimesini de yazar ("Acil", "Dikkat", "Hedefte"). Altında `AlertRow` listesi: önce Acil, sonra Dikkat, sonra Bilgi; grup içinde en eski üstte; her satırda bir eylem düğmesi (`Button` `secondary` `sm`): "Cevapla", "Mesaj gönder". Öğrenci ayrıntısı: dossier özeti, `MasteryMeter` listesi, `MisconceptionItem` kartları, `OutcomeHeatmap`, hafıza dosyaları (`MemoryFileCard`, eğitmen görünümünde yol da yazılı).
- **Dersler.** Ders kayıtlarının listesi ve her dersin **iddia incelemesi**: zaman damgalı transkript yanında çıkarılan iddialar (`EvidenceQuote` ile kaynaklı); her iddiada "Onayla", "Düzenle", "Reddet". Üstte otomatik uygulama eşiği kaydırıcısı (varsayılan 0,8). Eşik altı iddia onaylanmadan öğrenci profiline işlenmez; kayıt `Notice` `warning` ile "Onay bekliyor" taşır.
- **Müfredatlar.** Ağaç editörü (`Tree` / `TreeNode`): sürükleyerek yeniden sıralama, yaprak ekleme, ön koşul bağlama; yanında yapay zekâ **öneri kutusu** (`curriculum_proposals`: alt kazanım ekle, yeniden adlandır, birleştir, ön koşul ekle, etiket ekle), her öneri kanıtıyla; "Kabul et" ve "Reddet". Versiyonlar arası fark görünümü: eklenen satır `success`, silinen `danger`, her ikisi de ✓/✕ ve kelimeyle.
- **Soru tarzları.** Tarz kütüphanesi: ad, açıklama, biçim, püf noktası, zorluk bandı, çıktığı yıllar, tazelik ve sıklık skoru, örnek sorular. Başlık sabit: "Sıklık analizine göre öncelikler" (`ExamPriorityList`); her satır kaç yılın kaçında çıktığını ve kanıt sayısını yazar. Tarz düzenlenebilir; "Bu tarzda 5 soru üret" eylemi vardır.
- **İçerik.** Üretilen not, deneme ve raporların belge incelemesi (`DocumentViewer`): `ai` rozeti, doğrulama durumu (SymPy/şekil denetimi), "Yayınla" ve "Yeniden üret". Denetimden geçmeyen şekil (`FigureFrame` `pending` / `failed`) öğrenciye gitmez.
- **Sınavlar.** Yüklenen ve üretilen sınavlar, cevap anahtarları (kaynak: yüklenen / çıkarım / eğitmen; güven değeri), atamalar. Çıkarım anahtarı eğitmen onaylayana kadar "Onay bekliyor" kalır.
- **Kuyruk.** Arka plan işleri ve onay bekleyenler: şekil ve soru onayı ("Onayla" / "Yeniden üret" / "Reddet"), başarısız işler ve yeniden deneme. Bot cevaplarının denetimi `TutorMessage` `review` satırıyla: model, maliyet, kullanılan hafıza olgusu sayısı ve "İşaretle"; işaretlenenler haftalık inceleme listesinde toplanır.
- **Maliyet.** Model ve rota başına harcama, önbellek isabeti, öğrenci başına aylık yumuşak tavan; yalnızca eğitmen ve yönetici görür. Zaman içindeki değişim `ReportChart`, tek sayılar `StatTile`.
- **Ayarlar.** Uyarı eşikleri (sessizlik, cevapsız süre), bildirim kuralları, ders görünürlüğü.

## Sayılar ve zaman

- Süreler göreli ve Türkçe: "14 saattir cevapsız", "3 gündür sessiz", "1,4 saat". Mutlak zaman gerekiyorsa "19 Eki 14:32".
- Maliyet yalnızca eğitmen konsolunda (kuyruk denetim satırı ve Maliyet) ve dolar olarak ("0,002 $"); öğrenci ve veli arayüzünde maliyet hiç görünmez.
- Büyük tek sayılar orantılı rakamla; hizalanan sütunlarda `tabular-nums`.
- Ustalık değerleri yüzde olarak (`%72`), kanıt sayısıyla birlikte; kanıt eşiğin altındaysa yüzde yazılmaz ("Henüz yeterli kanıt yok").

## Grafikler

- Bir sayı anlatıyorsa grafik değil `StatTile`. Grafik yalnızca zaman içindeki değişim için (yanıt süresi, aktif öğrenci sayısı, harcama).
- Tek seri: `primary` 2px çizgi, uç nokta 8px ve `surface-raised` halkalı; ızgara `line` ince ve düz, eksen metni `ink-muted`. İkinci bir eksen yok; iki ölçü iki grafik.
- Birden çok seri: `ReportChart` sabit paleti (`--og-viz-1..8`) kullanır ya da `highlightKey` ile konuşulan seri `primary`, diğerleri `line-strong` olur; her seri adıyla lejantta yazılır. Sekizden fazla seri yoktur.
- Her grafiğin tablo görünümü vardır; bir değer yalnızca tooltip'te kalmaz.

## Roller ve gizlilik

- Roller `profiles.role` ve `instructor_links.role` ile gelir: **admin** (küresel yetki: maliyet, ayarlar, tüm öğrenciler), **eğitmen** `owner` (bağlı öğrenciler ve dersler üzerinde yazma, RPC'lerle onay/karar), **eğitmen** `viewer` (salt okuma; düzenleme ve onay düğmeleri yoktur, durum kelimeyle yazılır).
- Eğitmen yalnızca bağlı olduğu öğrencileri ve derslerini görür. Eğitmen adı konsolda tam yazılır; öğrenci listeleri ad ve soyadın ilk harfiyle ("Elif K.") — ekran paylaşımı ve ekran görüntüsü için.
- Konsol yazımları yalnızca sunucu RPC'leriyle yapılır (`approve_*`, `decide_proposal`, `set_exam_key`); arayüz bunları onay düğmesi olarak gösterir, doğrudan tablo yazımı yoktur.
