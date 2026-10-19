# FigureFrame

Koddan üretilmiş bir soru şekli (Matplotlib, SVG, TikZ, parametrik şablon) ve denetim durumu.

**Sen sağlarsın:** `src` (PNG/SVG), `alt` (zorunlu say: şekli kelimelerle anlatır — "ABC üçgeni: AB 12 cm, BC 8 cm, A'daki açı θ"), `caption` ("Şekil 1"), `source` (üretim aracı; yalnızca öğretmen görünümünde), `status` (`verified` ✓ Şekil denetlendi · `pending` Onay bekliyor · `failed` ✕ Denetimden geçmedi).

- Şekil her iki temada `paper` zemininde durur: çizgiler `navy` (#051c60), vurgu sabit #0030a2 (açık temanın `primary` değeri), zemin şeffaf olarak üretilir. Şekil tema değişkeni kullanmaz ve koyu temada yeniden üretilmez.
- Öğrenciye yalnızca `verified` şekil gösterilir; `pending` ve `failed` öğretmen onay kuyruğundadır. Rozet öğrenci görünümünde gizlenebilir, durum değiştirilemez.
- Üretim boru hattı (kod → render → boyut kontrolü → vision denetimi → SymPy ile cevap anahtarı) arayüzde tek kelimeyle görünür; adımlar `source` içinde değil, kuyruğun ayrıntı panelinde.
- Yazı tipi şekil içinde de Lexend; eksen ve etiket 14px'ten küçük olmaz.
