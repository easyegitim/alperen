# PdfViewer

Üretilen belgeleri (ders notu, deneme, rapor) uygulama içinde sayfa sayfa gösterir. Belgeler Chromium ile PDF üretilir; görseller, şekiller, şemalar ve formüller her cihazda aynı görünür. Tek eylem **İndir / Paylaş**'tır.

**Sen sağlarsın:** `src` (PDF adresi), `title`, isteğe bağlı `onShare` (Web Share API gibi; verilmezse düğme `src`'yi indiren bir bağlantıdır), `workerSrc` (pdf.js işçi adresi; varsayılan paketin kendi işçisi), `scale`, `headingLevel` (varsayılan 1).

- `pdfjs-dist` ilk açılışta tembel yüklenir (sunucuda çalışmaz; istemci bileşenidir). Her sayfa bir `<canvas role="img">`dir ve "<başlık>, sayfa 2 / 5" adını taşır.
- Yüklenirken `role="status"` ("Belge açılıyor"), hatada `role="alert"` ("Belge açılamadı. Yine de indirebilirsin.") gösterilir; indirme her durumda vardır.
- Bilinen boşluk: metin seçimi ve belge içi arama yok (yalnız çizim); sayfalar sırayla çizilir, çok uzun belgelerde tembel çizim yoktur.
- Bundler `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` kalıbını desteklemeli (Vite ve Next destekler); desteklemiyorsa `workerSrc` verilir.
