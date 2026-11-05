# ReportChart

Recharts sarmalayıcısı: zaman içindeki değişim (net, ustalık, yanıt süresi) için çizgi ya da sütun grafiği. Bir sayı anlatıyorsa grafik değil `StatTile` kullan.

**Sen sağlarsın:** `kind` (`line` · `bar`), `title`, `data`, `xKey`, `series` (`{ key, name }`, en fazla 8), `highlightKey`, `valueFormat`, `yDomain`, `height`, `defaultView`, `caption`.

- Tek eksen: ikinci y ekseni yoktur; iki ölçü iki grafik. Çizgi 2px, işaretler 8px ve `surface-raised` halkalı; sütun uçları 4px yuvarlak, sütunlar arası 2px boşluk; ızgara `line` ince, eksen metni `ink-muted`.
- Renk: tek seri `primary`; çok seri sabit sırada `--og-viz-1..8` (doğrulanmış kategorik palet, iki temada ayrı basamak). Renk seriye bağlıdır, sıraya değil. `highlightKey` verilirse o seri `primary`, diğerleri `line-strong`.
- Palet doğrulaması: iki temada bitişik çiftlerde CVD ΔE ≥ 8.4 ve normal görüşte ≥ 19. 3., 4. ve 5. yuva açık temada 3:1 altındadır; bu yüzden ≥2 seride lejant her zaman yazılır ve "Tablo görünümü" her zaman vardır (tablo DOM'da kalır, grafik görünümündeyken yalnızca ekran okuyucuya açıktır).
- 9. seri yoktur; fazlası yok sayılır. Çok sayıda seri gerekiyorsa grafiği böl.
