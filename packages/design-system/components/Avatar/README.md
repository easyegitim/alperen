# Avatar

Yuvarlak yüz: AI öğretmenin maskot kırpımı, kullanıcı fotoğrafı ya da baş harfler.

**Sen sağlarsın:** `name` (zorunlu; erişilebilir ad ve baş harfler), `src`, `variant` (`mascot` yüze kırpar, `photo` kapla), `size` (`sm` 32 · `md` 40 · `lg` 56 · `xl` 80px), `ai` (hologram halkası).

- Maskot kırpımı `ogrenmen-maskot.webp` görselini yüz ve kulaklık görünecek biçimde (`280%` boyut, `55% 4%` konum) kırpar; görsel `src` ile verilir.
- `ai` yalnızca yapay zekâ kimliğini işaretler; anlam taşıyan bilgi halka rengine bırakılmaz, ad her zaman yazılır.
- Baş harfler Türkçe büyük harf kuralıyla üretilir (`initialsOf`).
