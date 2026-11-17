# MisconceptionItem

Öğrencinin anlamadığı bir şey (`misconceptions` satırı): metin, kanıtları, ilk görülme ve çözülme tarihi.

**Sen sağlarsın:** `text` (yanılgı, tek cümle, öğrenciyi değil hatayı anlatır), `skill` (kazanım, büyük harf), `evidence` (en az bir `EvidenceQuote` verisi), `firstSeen`; çözülünce `resolved` ve `resolvedAt`.

- Çözülene kadar `warning` rozetiyle "Açık" kalır. "✓ Çözüldü" yalnızca yeni kanıt ve eğitmen onayıyla.
- Kanıtsız yanılgı gösterilmez; kanıt sayısı eşiğin altındaysa eğitmen onay kuyruğunda bekler.
- Öğrenciye gösterilen sürümde metin "sen" diliyle yeniden yazılır: "Payları ve paydaları ayrı ayrı topluyorsun." Eğitmen sürümü üçüncü tekil.
