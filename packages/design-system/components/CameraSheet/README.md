# CameraSheet

"Sor" akışının yakalama gövdesi: kamera ya da dosyadan çoklu sayfa ekler, önizler, döndürür ve gönderir. Alt çekmece (sheet) içeriği olarak tasarlanmıştır; modal/çekmece kabuğunu uygulama sağlar.

**Sen sağlarsın:** `onSubmit({ items, includesSolution })`, isteğe bağlı `onCancel`, `maxFiles` (varsayılan 8), `maxBytes` (varsayılan 15 MB), `accept`, `busy`, `title`.

- İki giriş vardır: "Fotoğraf çek" (`capture="environment"`, çoklu) ve "Dosyadan ekle" (görsel/PDF, çoklu). İkisi de gerçek `<input type="file">`; düğmeler tetikler.
- Her sayfa önizlenir; "Döndür" 90° adımlarla `rotation` değerini günceller, "Kaldır" sayfayı siler. Önizleme adresleri bileşen kapanınca serbest bırakılır.
- "Çözümüm de var" gerçek bir onay kutusudur; işaretliyse yüklenen sayfalar öğrencinin kendi çözümünü de içerir (`solution_analyses` akışı).
- Sınır aşımı `role="alert"` ile yazılır ("En fazla 8 sayfa ekleyebilirsin.").
- Bilinen boşluk: kırpma yok; istemcide yeniden boyutlandırma (en uzun kenar 2576px) bileşenin dışındadır, `rotation` gönderim sırasında uygulanır.
