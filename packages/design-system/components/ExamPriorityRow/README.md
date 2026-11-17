# ExamPriorityRow

Sınav modellemesinin tek satırı: bir soru şablonunun geçmiş sınavlarda kaç yılın kaçında çıktığı, tahmini puanı ve kanıtı.

**Sen sağlarsın:** `rank`, `topic`, `kind` (ispat / hesap / çoktan seçmeli), `hits` ve `years` ("4/5 yıl"), `points` ("≈20 puan" — yaklaşık işareti, tilde değil; tilde küçük boyutta eksi gibi okunur), `evidence` ("Kanıt: 4 sınav") ve kanıt arşivine `href`.

- Listenin başlığı her zaman **"Sıklık analizine göre öncelikler"**. "Tahmin", "çıkacak", "kesin" kelimeleri hiçbir yerde kullanılmaz.
- Sıklık pipleri tek renk (`primary` / `primary-soft`), yıl sayısı yazıyla da yazılır.
- Kanıt bağlantısı eğitmen arşivine gider; geçmiş soruların metni öğrenciye yeniden yayınlanmaz, yalnızca istatistik ve özgün varyant.
- Satırlar `space-3` aralıkla; en fazla 10 satır, gerisi "Diğer konular" başlığı altında.
