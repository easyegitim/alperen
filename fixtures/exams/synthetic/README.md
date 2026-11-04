# Sentetik okul denemesi (P2)

Gerçek yayıncı adı, logosu ya da sorusu yoktur; sorular bu depo için yazıldı. `exam.json` tek doğruluk kaynağıdır:
3 yükleme (kitapçık s.1: sorular 1–5, 3. soruda sayı doğrusu şekli, 5. soru arka sayfada sürer; kitapçık s.2: 5'in
devamı ve 6–10; optik form), 10 soru (TYT Matematik, kazanım kodları `content/tyt-matematik`), anahtar, öğrencinin
optik işaretleri (7. soruda çift işaret, 5. boş) ve beklenen notlama (net 5,5).

```
node fixtures/exams/synthetic/render.mjs     # booklet-p1.png, booklet-p2.png, answer-sheet.png (1240×1754) + layout.json
```

`layout.json` şeklin ölçülen kutusudur (0..1); `exam.json` ve sahte çıktılar bunu kullanır. Bu denemeyle tutarlı sahte
LLM çıktıları `packages/llm/fixtures/{page_class,exam_page_items,answer_sheet,inferred_keys,exam_report,solution_diagnosis}`
altındadır (tablo: `packages/llm/fixtures/README.md`), eval vakaları `packages/prompts/eval/exam_page_items/`.
`exam.json` değişirse görseller yeniden üretilir ve `packages/llm/test/exam-routes.test.ts` tutarsız fikstürü yakalar.

`answer-key.png` (basılı cevap anahtarı sayfası, exam.json anahtarıyla aynı) `render-key.mjs` ile üretilir; apps/worker
`exam.live.test.ts` "yüklenen anahtar sayfası" yolunda dördüncü sayfa olarak kullanır (sahte fikstürler testte türetilir).
