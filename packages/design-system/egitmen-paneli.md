# Eğitmen paneli

Eğitmenin bir bakışta görmesi gereken dört şey: kim bekliyor, kim sessiz, kimde düşüş var, ne zaman teslim. Panel bunları bu sırayla gösterir; grafik en sona kalır.

## Yerleşim

- En üstte bir `StatTile` satırı, en fazla dört kutu: cevapsız soru, sessiz öğrenci, yaklaşan teslim, ortalama yanıt süresi. Durum taşıyan kutu kelimesini de yazar ("Acil", "Dikkat", "Hedefte").
- Altında `AlertRow` listesi: önce Acil, sonra Dikkat, sonra Bilgi; grup içinde en eski üstte. Her satırda bir eylem düğmesi (`Button` `secondary` `sm`): "Cevapla", "Mesaj gönder".
- Sonra ders raporları. Her rapor `MasteryMeter` listesi, `MisconceptionItem` kartları ve `EvidenceQuote` alıntılarından oluşur; altında "Onayla" (`primary`) ve "Düzelt" (`secondary`). Onaylanmamış rapor `Notice` `warning` ile "Onay bekliyor" taşır ve öğrenci profiline işlenmez.
- Bot cevaplarının denetimi `TutorMessage` `review` satırıyla: model, maliyet, kullanılan hafıza olgusu sayısı ve "İşaretle". İşaretlenen cevaplar haftalık inceleme listesinde toplanır.
- Şekil ve soru onay kuyruğu: `FigureFrame` `pending` kartları, altında "Onayla" / "Yeniden üret" / "Reddet".

## Sayılar ve zaman

- Süreler göreli ve Türkçe: "14 saattir cevapsız", "3 gündür sessiz", "1,4 saat". Mutlak zaman gerekiyorsa "19 Eki 14:32".
- Maliyet yalnızca denetim satırında ve dolar olarak ("0,002 $"); öğrenci arayüzünde maliyet hiç görünmez.
- Büyük tek sayılar orantılı rakamla; hizalanan sütunlarda `tabular-nums`.
- Ustalık değerleri yüzde olarak (`%72`), kanıt sayısıyla birlikte; kanıt eşiğin altındaysa yüzde yazılmaz.

## Grafikler

- Bir sayı anlatıyorsa grafik değil `StatTile`. Grafik yalnızca zaman içindeki değişim için (yanıt süresi, aktif öğrenci sayısı).
- Tek seri: `primary` 2px çizgi, uç nokta 8px ve `surface-raised` halkalı; ızgara `line` ince ve düz, eksen metni `ink-muted`. İkinci bir eksen yok; iki ölçü iki grafik.
- Birden çok seri gerekiyorsa vurgu biçimi: konuşulan seri `primary`, diğerleri `line-strong`; her seri adıyla etiketlenir. Sistemde kategorik grafik paleti tanımlı değildir; üçten fazla seri ayırt edilecekse önce tasarım sistemine doğrulanmış bir palet eklenir.
- Her grafiğin tablo görünümü vardır; bir değer yalnızca tooltip'te kalmaz.

## Roller

- Panel üç rol tanır: koordinatör, branş eğitmeni, gözlemci. Branş eğitmeni yalnızca kendi dersinin öğrencilerini görür; gözlemci düzenleyemez.
- Eğitmen adı panelde tam yazılır; öğrenci listeleri ad ve soyadın ilk harfiyle ("Elif K.") — ekran paylaşımı ve ekran görüntüsü için.
