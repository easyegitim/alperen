# MasteryMeter

Bir kazanımdaki ustalık olasılığını (`mastery.p`, 0–1) ve dayandığı gözlem sayısını gösterir.

**Sen sağlarsın:** `skill` (kazanım adı), `p`, `evidence` (gözlem sayısı), isteğe bağlı `minEvidence` (varsayılan 5), `delta` (son dönemdeki değişim, 0–1) ve `deltaLabel` ("bu hafta"), `display` (`'band'` varsayılan, `'percent'`), `period` (dönem: "LGS 2026", "AYT 2027" — ustalık döneme bağlıdır, LGS puanı AYT puanı sayılmaz).

- `evidence < minEvidence` ise bileşen **yüzde göstermez**: dolgu yok, değer yerine "Henüz yeterli kanıt yok". `p` değeri ne olursa olsun. Kesin teşhis kanıtla gelir.
- **Bant kipi (varsayılan, öğrenci ve veli):** değer yüzde yerine kelimedir: `masteryBand(p)` → `Zayıf` (p < 0,5), `Orta` (p < 0,8), `İyi` (p ≥ 0,8); eşikler `MASTERY_BAND_THRESHOLDS` sabitindedir. Bu kipte hiçbir yerde `%` yazılmaz; değişim de kelimeyle gelir ("↑ Yükseliyor", "↓ Düşüyor", "Sabit"). `display="percent"` yalnız eğitmen konsolunda kullanılır. Kanıt eşiği kuralı iki kipte de aynıdır. `masteryDisplay({ …, format })` aynı seçeneği alır. `TreeNode` da aynı `display` prop'unu taşır.
- Dolgu `primary`, ray `primary-soft` — aynı mavinin açık adımı; kanıt azken ray `surface-sunken`.
- Yüzde kipinde değişim işaretle yazılır (+%8 / −%3); renk (`success`/`danger`) yalnızca işaretin yanındadır.
- Birden çok kazanım alt alta `space-3` aralıkla; ön koşul ağacında alt kazanım bir kademe içeriden.
