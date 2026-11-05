# MemoryFileCard

Profil → Hafıza ekranında öğretmenin öğrenci hakkında tuttuğu tek bir dosya (`memory_files`, `/memories/...`).

**Sen sağlarsın:** `path`, `title` (okunur ad), `content`, `updatedAt` (biçimlenmiş), `bytes`, `onRequestCorrection`.

- İçerik öğrencinin okuyabileceği düz metindir; yapay zekâ ürünü olduğu için `ai` rozeti taşır.
- "Düzeltme iste" öğrencinin yanlış bir cümleyi düzeltme isteğini başlatır; dosyayı öğrenci elle düzenlemez.
- Öğrenci görünümünde `path` gösterilmeyebilir; eğitmen görünümünde gösterilir.
