# DocumentViewer

Ders notu, deneme ve rapor için uygulama içi HTML okuma kabı (`generated_documents`). Üretilen belgeler PDF olarak sayfa sayfa gösterilecekse `PdfViewer` kullanılır (tek "İndir / Paylaş" düğmesi); `DocumentViewer` PDF'e dönüşmeyen HTML içerik ve doc-render önizlemesi içindir.

**Sen sağlarsın:** `title`, `html` (güvenilir kaynaktan, `packages/doc-render` çıktısı) **ya da** `children`; `personalized` ("ai" rozeti + "Öğrenmen sana göre hazırladı"), `pdfHref` ("PDF indir"), `actions` ("Çöz", "Soru sor"), `autoRenderMath` (varsayılan açık).

- Okuma sütunu en fazla 640px, metin `body-lg`; tablo, liste, şekil ve kutu stilleri `base.css` içindeki `.og-doc` sınıfındadır. `lang="tr"`.
- `html` içindeki `$…$`, `$$…$$`, `\(…\)`, `\[…\]` ifadeleri KaTeX (`htmlAndMathml`, yani MathML dahil) ile çizilir. Bileşen HTML'i temizlemez: kullanıcı girdisi doğrudan verilmez.
- KaTeX stilleri için uygulama `@ogrenmen/design-system/styles/katex.css` dosyasını bir kez içe aktarır.
