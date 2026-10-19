# MasteryMeter

Bir kazanımdaki ustalık olasılığını (`mastery.p`, 0–1) ve dayandığı gözlem sayısını gösterir.

**Sen sağlarsın:** `skill` (kazanım adı), `p`, `evidence` (gözlem sayısı), isteğe bağlı `minEvidence` (varsayılan 5), `delta` (son dönemdeki değişim, 0–1) ve `deltaLabel` ("bu hafta"), `period` (dönem: "LGS 2026", "AYT 2027" — ustalık döneme bağlıdır, LGS puanı AYT puanı sayılmaz).

- `evidence < minEvidence` ise bileşen **yüzde göstermez**: dolgu yok, değer yerine "Henüz yeterli kanıt yok". `p` değeri ne olursa olsun. Kesin teşhis kanıtla gelir.
- Dolgu `primary`, ray `primary-soft` — aynı mavinin açık adımı; kanıt azken ray `surface-sunken`.
- Değişim işaretle yazılır (+%8 / −%3); renk (`success`/`danger`) yalnızca işaretin yanındadır.
- Birden çok kazanım alt alta `space-3` aralıkla; ön koşul ağacında alt kazanım bir kademe içeriden.
