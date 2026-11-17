# UploadSheet

"+ Yükle" alt sayfası. İki seçenek vardır: **Kendi çalışmam** ve **Okul denemesi**. Seçimden sonra `CameraSheet` gövdesi açılır (çek ya da PDF seç, döndür, kırp) ve **Gönder**. Gerisini (sayfa sınıflama, OCR, anahtar, teşhis) koç arka planda yapar; sonuç Bugün'de bir kartla (`upload_result`) bildirilir.

**Sen sağlarsın:** `onSubmit({ kind: 'own_work' | 'school_exam', items })` (`items` = `CapturedItem[]`), isteğe bağlı `onCancel`, `busy`, `maxFiles`, `maxBytes`, `accept`, `title`.

- Seçenekler gerçek radyo girdileridir; kaynak seçilmeden Gönder görünmez. "Çözümüm de var" bu akışta yoktur.
- Modal/çekmece kabuğunu uygulama sağlar. Dosya yükleme ve depolama bileşenin dışındadır.
