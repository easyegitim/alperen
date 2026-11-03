# OutcomeHeatmap

Deneme sonucunda kazanım × deneme ısı haritası.

**Sen sağlarsın:** `columns` (deneme/dönem adları), `rows` (`{ id, label, cells: [{ value: 0–1 | null, n? }] }`), `caption`.

- Gerçek bir tablodur (`th scope`); tablo görünümü ayrıca gerekmez. Her hücre yüzdeyi yazar, renk tek başına anlam taşımaz; veri olmayan hücre "—" yazar.
- Tek mavi sıralı rampa, 7 basamak (`--og-seq-1..7`): açık düşük, koyu yüksek. 1–3 üzerinde lacivert, 4–7 üzerinde beyaz metin (4.5:1 üstü); rampa iki temada aynıdır.
- Dar ekranda tablo yatay kayar; sayfa taşmaz.
