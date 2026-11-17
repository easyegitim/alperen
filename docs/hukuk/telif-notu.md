> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz

```yaml
doc_version: 2026-10-v1
doc_kind: telif_notu
effective_from: 2026-11-01
status: taslak
```

# Telif Notu: Sınav Arşivi, Ders Notları ve Kaynaklar

Bu not Öğrenmen'in başkalarına ait eserleri (ÖSYM soruları, üniversite hocalarının sınav soruları, ders notları, akademik makaleler) hangi sınırlar içinde işlediğini yazar. Temel ilke: geçmiş soruları **analiz edip istatistik çıkarmak** yapılır, soruları **uygulama içinde yayımlamak** yapılmaz. 5846 sayılı Fikir ve Sanat Eserleri Kanunu kapsamındaki değerlendirme hukukçuya aittir.

## 1. ÖSYM soruları

- ÖSYM, yayımladığı soruların izinsiz çoğaltılamayacağını ve yayımlanamayacağını belirtir. Öğrenmen ÖSYM sorularını öğrenciye göstermez, yeniden yazmaz, botta veya panelde metin olarak yayımlamaz.
- Kamuya açık ÖSYM yayınları yalnız istatistik için işlenir: hangi kazanımdan kaç soru çıktığı, hangi yıllarda tekrarlandığı. Bu kayıtların `exam_sources.legal_basis` değeri "kamuya açık ÖSYM yayını — yalnız istatistik" olur.
- Öğrenciye giden pratik soruları ya kurumun parametrik şablonlarından üretilir ya da eğitmen tarafından yazılır ve onaylanır; yapay zekânın ürettiği sorular eğitmen onayından geçmeden öğrenciye gitmez.

## 2. Üniversite ve eğitmen sınavları (Kalem)

- Geçmiş vize ve final soruları yalnız meşru yoldan edinilmiş kopyalardan işlenir. Mevcut ya da yaklaşan bir sınava dair sızıntı hiçbir koşulda yüklenmez ve işlenmez.
- Her yüklenen arşiv için eğitmen bir hukuki dayanak beyan eder (`exam_sources.legal_basis`, zorunlu alan). Kabul edilen değerler:
  - "öğrenci kendi kopyası" — öğrencinin kendisine verilmiş sınav kâğıdı,
  - "kamuya açık ÖSYM yayını — yalnız istatistik",
  - "eğitmenin kendi sınavı" — easy eğitmeninin hazırladığı sınav.
- Soruyu yazan hocanın gerçek adı saklanmaz; arşivde yalnız `hoca-A` biçiminde bir takma ad tutulur.
- Çıktı bir "sıklık analizine göre öncelik" listesidir: konu, soru türü, kaç yılın kaçında çıktığı, yaklaşık puan ve kanıt sayısı. Liste soru metni içermez; sözleşme şemasındaki yasaklı kelime listesi (`x-forbidden-words`, `exam-priority-plan` şeması) kullanılmaz: liste bir sınavda ne geleceğini bildirdiği izlenimi veremez.
- Sık görülen kalıplar için özgün varyant üretilir. Varyant isteği yalnız konu, tür ve puan gibi meta bilgi taşır; ham soru metni soru üretim modeline hiç gönderilmez. Hocanın soruları yeniden yayımlanmaz.

## 3. OCR metninin erişim sınırı

- Sınav sayfalarından çıkarılan metin (`exam_items.ocr_text`) yalnız kümeleme ve eğitmen arşivi içindir.
- Bu metni yalnız eğitmen ve koordinatör, özel bir görünüm (`v_exam_items_full`) üzerinden okur. Öğrenci bu tabloya hiç erişemez; gözlemcinin metin sütununa yetkisi yoktur; bot bu tabloları göremez.
- Öğrenciye giden hiçbir çıktı, öncelik planının hiçbir satırı ve hiçbir soru üretim isteği ham soru metnini içermez; bu kural otomatik testle denetlenir.
- Sınav PDF'leri Supabase Storage'da özel bir kovada (`exams/`) tutulur ve eğitmen silene kadar saklanır.

## 4. Sınav arşivinde kişisel veri

- "öğrenci kendi kopyası" olarak yüklenen kâğıtlarda öğrencinin adı, numarası ve imzası bulunabilir. Bu alanlar yüklemeden önce karartılmalıdır; sayfa görüntüleri OCR için yapay zekâ sağlayıcısının ücretsiz katmanına gider ve bu katmanda veri ürün eğitiminde kullanılabilir.
- Panelin "Arşiv yükle" formunda bu uyarının gösterilmesi önerilir (eğitmen paneli için açık madde); karartılmamış bir kâğıt fark edilirse eğitmen kaydı siler ve karartılmış hâliyle yeniden yükler.

## 5. Ders notları

- Eğitmenlerin kendi ders notları (PDF) bir kütüphaneye alınır ve soru üretiminde kazanıma en yakın birkaç kısa parça "örnek" olarak modele verilir. Parçalar öğrenciye gösterilmez ve yeniden yayımlanmaz.
- Kütüphaneye yalnız easy'nin ya da eğitmenin kendisine ait veya kullanım izni alınmış notlar eklenir; yayınevi kitapları ve üçüncü kişilere ait notlar izinsiz eklenmez.

## 6. Akademik kaynaklar (Kitap; pilotta kapalı)

- Araştırma özellikleri yalnız açık erişimli makale PDF'lerini (Unpaywall aracılığıyla) okur; ücretli erişimli içerik indirilmez.
- Öğrenciye makalenin metni değil, kısa bir sentez ve atıf bilgisi (yazarlar, yayın, yıl, DOI) gösterilir. Her atıf Crossref'te doğrulanır; doğrulanamayan atıf silinir.
- DergiPark ve YÖK Tez gibi kaynakların kullanım koşulları açılıştan önce ayrıca incelenir.

## 7. Üretilen içerik

- Parametrik şablonlardan ve yapay zekâdan üretilen sorular, şekiller ve açıklamalar easy'nin özgün içeriği olarak kabul edilir [hukukçu doğrular]. Yapay zekâ ile üretilen içerik arayüzde bunu belirten bir işaret taşır.
- Şekiller kodla çizilir; başka eserlerden görüntü kopyalanmaz.
