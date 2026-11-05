# Notice

Akışın içinde duran kısa bildirim: bilgi, uyarı, yasal bildirim ya da sorunun insana yönlendirildiği notu.

**Sen sağlarsın:** `tone`, `title` (tek satır; `handoff` için varsayılan "Hocana yönlendirildi"), metin (en fazla iki cümle) ve isteğe bağlı `action` (`Button` `secondary` `sm`).

- `info` (`primary-soft`): kota durumu, mod değişikliği, bilgi.
- `warning` (`warning-soft`; varsayılan `role="note"`, sayfa açıldıktan sonra eklenen uyarı için `live` verilirse `role="alert"`): onay bekleyen rapor, geçersiz durum. Suçlamaz, ne olacağını söyler.
- `legal` (`surface-sunken`, `line-strong` kenar): KVKK aydınlatması gibi yasal bilgi notu. Saklama süresi gerçek süreyle aynı yazılır.
- `handoff` (`primary` kenar): bot emin olmadığında ya da not/devamsızlık/puan sorulduğunda. Kime iletildiği ve cevabın nerede görüneceği yazılır.
- Bildirim kendiliğinden kaybolmaz; kapatma düğmesi yalnızca `info` tonunda.
