# TutorMessage

Yapay zekâ öğretmen ile öğrenci arasındaki sohbet balonu.

**Sen sağlarsın:** `from` (`tutor` varsayılan, `student`), metin `children`, öğretmen için `avatarSrc` (Maskot grubundaki `ogrenmen-maskot.webp` — bileşen yüze kırpar), isteğe bağlı `actions` (en fazla iki `Button`: `secondary` + `quiet`), yanıt beklenirken `typing`. Eğitmen görünümünde `review` (`model`, `cost`, `memory` olgu sayısı, `flagged`, `onFlag`) balonun altına denetim satırı ekler.

- Öğretmen balonu `ai-soft` zemin + `shadow-ai` hologram kenarı; öğrenci balonu `primary` dolgu, `on-primary` metin.
- Öğretmen kısa yazar, soruyla bitirir, cevabı hemen vermez (İpucu modu). `ModeToggle` "Çözümü göster" modundaysa çözümü adım adım verir, yine tek balonda tek adım.
- Ad satırı her zaman "AI öğretmen" etiketini taşır; yapay zekâ olduğu gizlenmez.
- `review` yalnızca eğitmen konsolunda görünür; öğrenci model adı ve maliyet görmez. "İşaretle" cevabı haftalık incelemeye alır; işaretli cevap "✕ İşaretlendi" ile kalır.
