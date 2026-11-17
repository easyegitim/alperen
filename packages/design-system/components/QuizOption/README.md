# QuizOption

Çoktan seçmeli sorunun tek şıkkı.

**Sen sağlarsın:** `letter` (A–E), şık metni, `state` (`idle`, `selected`, `correct`, `incorrect`), cevaptan sonra isteğe bağlı `feedback`. Şıkları `space-3` aralıkla alt alta diz; üstte `title-3` ile soru metni.

- `correct` ve `incorrect` durumları kilitlenir ve her zaman "✓ Doğru" / "✕ Tekrar dene" yazısını taşır — renk tek başına anlam taşımaz.
- Geri bildirim neden doğru/yanlış olduğunu tek cümleyle açıklar; suçlamaz.
