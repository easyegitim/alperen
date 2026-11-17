# SuggestionCard

Bugün ekranındaki öneri kutusu. Koç her gece ve her etkinlikten sonra önerileri yeniden hesaplar (`suggestions` tablosu); her öneri bu kartla çizilir. Bugün'de en fazla 3 öneri kutusu durur.

**Sen sağlarsın:** `kind` (`suggestions.kind` ile aynı: `practice` · `weekly_homework` · `lesson_review` · `gap_analysis` · `mini_exam` · `document_ready` · `upload_result`), `title` (tek cümle), `subtitle`, `durationText` ("12 dk"), `onStart` ya da `href`, isteğe bağlı `actionLabel`, `headingLevel` (varsayılan 3).

- Tür etiketi kelimeyle yazılır (Alıştırma, Haftalık ödev, Ders tekrarı, Eksik analizi, Mini deneme, Belge hazır, Yükleme sonucu); ikon yalnız süstür.
- Eylem metni test başlatan türlerde "Başla", `document_ready` ve `upload_result` türlerinde "Aç". Erişilebilir ad "Başla: <başlık>" biçimindedir; aynı ekranda birden çok kart ayırt edilir.
- `href` verilirse düğme yerine bağlantı çizilir (`buttonClasses`). Kart ikincil düğme taşır; ekrandaki tek birincil düğme `BigStart` içindeki "Başla"dır.
- Kart metni tek cümledir; kendiliğinden kaybolmaz, tüketilince (`consumed_at`) uygulama listeden çıkarır.
