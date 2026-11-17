# AlertRow

Eğitmen konsolunun takip satırı: kim, ne, ne zamandır, ne yapmalı.

**Sen sağlarsın:** `kind` (`unanswered` cevapsız soru, `silent` sessiz öğrenci, `morale` moral göstergesi, `deadline` yaklaşan teslim, `response` yanıt süresi), `severity` (`danger` Acil, `warning` Dikkat, `neutral` Bilgi), `student`, `detail` (tek cümle; cevapsız soruda sorunun kendisi tırnak içinde), `since` ve bir `action` (`Button` `secondary` `sm`: "Cevapla", "Mesaj gönder").

- Önem derecesi kelimeyle yazılır (Acil / Dikkat / Bilgi); renk eşlik eder, tek başına anlam taşımaz.
- Sıralama: önce Acil, sonra Dikkat, sonra Bilgi; grup içinde en eski üstte.
- Süreler göreli ve Türkçe: "14 saattir cevapsız", "4 gündür sessiz". Eşikler konsol ayarlarından gelir; satır eşiği yazmaz.
- Moral göstergesi tek başına teşhis değildir; satır "göstergesi düştü" der, "depresif" gibi bir yargı yazmaz.
