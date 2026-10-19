# StatTile

Eğitmen panelindeki tek bir sayı: etiket, değer, isteğe bağlı birim, durum kelimesi ve ipucu. Bir sayı anlatıyorsa grafik değil bu kullanılır.

**Sen sağlarsın:** `label` (cümle düzeni, iki nokta yok), `value` (biçimlenmiş metin: "1,4", "1.284"), `unit` ("saat"), `status` + `statusText` ("Acil", "Dikkat", "Hedefte") ve `hint` ("hedef 2 saat").

- Değer `title-1` boyutunda ve orantılı rakamla (`tabular-nums` yok); hizalanması gereken sütunlarda tablo kullan.
- Bir satırda en fazla 4 kutu; panelin üstünde tek satır, altında `AlertRow` listesi.
- Durum yalnızca anlamı varsa: "3 cevapsız soru" `danger` + "Acil"; "5 teslim" durum taşımaz. Renk kelimesiz kullanılmaz.
- Maliyet rakamları öğrenci arayüzünde hiç, eğitmen panelinde yalnızca denetim görünümünde.
