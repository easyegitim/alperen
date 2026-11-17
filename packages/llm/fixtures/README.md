# packages/llm/fixtures

`FakeTransport` (`OGRENMEN_LLM=fake`) için v2 rota fikstürleri. Dizin adı rota adıdır (`src/routes.ts`
`ROUTE_NAMES`): `<rota>.json` ya da `<rota>/*.json`. Dosyalar adlarına göre sıralanır, rotanın sözleşmesine
(`@ogrenmen/contracts`) uyan ilk dosya döner. `bad-*` ve `injection*` adlı dosyalar atlanır. Fikstür yoksa
sözleşmenin `fixtures/<şema>/valid/*.json` örneği, o da yoksa şemadan üretilen en küçük örnek kullanılır.

Sahte taşıma yalnız bu dizini okur; `OGRENMEN_LLM_FIXTURES` başka bir dizine yönlendirir.

## Eşlemeli fikstür (girdiye bağlı yanıt)

Aynı rota bir işte birden çok kez, farklı girdiyle çağrılıyorsa (çok sayfalı deneme) dosya
`{ "fake_match": ["sayfa 2/3."], "output": { … } }` biçiminde yazılır. İstek mesajlarındaki metin blokları birleştirilip
küçük harfe çevrilir (`tr`); listedeki bütün parçalar bu metinde geçiyorsa önce bu dosya seçilir; hiçbir eşlemeli
dosya tutmazsa düz fikstürler ve sözleşme örnekleri eskisi gibi yedektir. Eşleme anahtarlarını `@ogrenmen/prompts`
kurucuları üretir (`uploadOrderLine` / `uploadOrderMatch`, `examContextText` / `examContextMatch`).

### Sentetik deneme (P2)

`fixtures/exams/synthetic/exam.json` (3 yükleme: kitapçık s.1, kitapçık s.2, optik form; 10 soru, TYT Matematik) tek
doğruluk kaynağıdır; görseller `render.mjs` ile üretilir. Bu dizindeki deneme fikstürleri onunla tutarlıdır ve
`test/exam-routes.test.ts` bunu denetler:

| rota | dosya | eşleme | içerik |
|---|---|---|---|
| `page_class` | `01-kitapcik-p1`, `02-kitapcik-p2`, `03-optik` | `sayfa 1/3.` … `sayfa 3/3.` | booklet (1–5, şekilli, s.1), booklet (6–10, s.2), answer_sheet |
| `exam_page_items` | `01-kitapcik-p1`, `02-kitapcik-p2` | `sayfa 1/3.`, `sayfa 2/3.` | 1–5 (3: sayı doğrusu kutusu; 5: `continues_on_next`, şıksız), 5 devam (`continues_from_previous`, şıklar) + 6–10 |
| `answer_sheet` | `01-optik` | — | kitapçık A; 8 işaret, 5 boş, 7 çift işaret (A, C) |
| `inferred_keys` | `01-anahtar` | — | 10 anahtar: C A B D E B A D C E (3: güven 0,9, kodla denetlenmedi) |
| `exam_report` | `01-rapor` | — | 3 bölüm, tek cümle özet, `section_nets` + `skill_map`, yanlış/boş tablosu, 3 sonraki adım |
| `solution_diagnosis` | `10-deneme-soru-4`, `11-deneme-soru-9` | `<exam_context>` + `soru no: 4.` / `9.` | 4: $3^3=9$ (careless, üslü), 9: virgül kaydırma (procedure, ondalık) |

Notlama (TYT, doğru − yanlış/4; çift işaret boş): doğru 1, 2, 3, 6, 8, 10; yanlış 4, 9; boş 5, 7 → net 5,5.

### İçerik stüdyosu (P3)

| rota | dosya | içerik |
|---|---|---|
| `notes_generation` | `01-rasyonel` | kişisel not (kind notes, personalized): 8 içerik bloğu (başlık, hedefler kutusu, tanım, matplotlib figür kodu `save_figure(fig, 1)`, çözümlü örnek, `patterns.md:2` / 19 Ekim'e başvuran hata kutusu, "Kendini sına" başlığı, cevap sayfası) + 3 soru, anahtarlar B A C (`canonical_expr` 7/8, 7/6, 7/30) |
| `exam_generation` | `01-tyt10` | TYT 10 soru; blueprint Sayılar 5 · Problemler 3 · Cebir 2, kolay 3 · orta 5 · zor 2; 2 figür (8: matplotlib sütun grafiği, 9: elle SVG sayı doğrusu); anahtar B D A E C B D A C E |
| `personalization_check` | `01-ok` | `{ok: true}` |
| `figure_check` | `01-match` | `matches_stem: true` |

Figür kodları `@ogrenmen/prompts` `FIGURE_PREAMBLE` ile yerel matplotlib'de çalışır ve bayt bayt aynı SVG üretir
(`packages/prompts/test/content-input.test.ts`); anahtarlar SymPy ile tek doğru şıkka eşittir.

### Tarz kütüphanesi (P4)

`apps/worker/test/fixtures/styles/archive.json` (2 yıl × 5 soru, TYT yaprakları, 4 tarz) tek doğruluk kaynağıdır;
`python3 -I apps/worker/test/fixtures/styles/build.py .` yazar. `arsiv-` önekli dosyalar deneme tutarlılık testinin
(`test/exam-routes.test.ts`) dışındadır.

| rota | dosya | eşleme | içerik |
|---|---|---|---|
| `exam_page_items` | `arsiv-2024`, `arsiv-2025` | `arşivi: <yıl>` + `sayfa 1/1.` | sayfadaki 5 açık uçlu soru |
| `exam_item_extract` | `arsiv-<yıl>-<no>` (10) | `arşivi: <yıl>` + `madde no: <no>.` | exam-item v2 (konu, calc, biçim, tuzak, zorluk, puan, kazanım) |
| `style_definition` | `arsiv` | — (düz) | k1…k4 → kesir-islem-onceligi, sayi-denklem-kurma, uslu-ifade-sadelestirme, tablolu-indirim-problemi |
| `style_question_gen` | `arsiv-tarz` | `tarza özel soru isteği` | 3 soru (2 mcq, 1 numeric), anahtarlar SymPy ile doğrulanır |

### Ders hattı (P5)

`fixtures/ders/lesson-01.transcript.json` (10 bölüm, 20 sn, "Elif" adı geçer) tek doğruluk kaynağıdır; ders servisi
`OGRENMEN_STT=fake` iken bu bölümleri konuşmacısız döner, worker adı `[ÖĞRENCİ]` yapar.

| rota | dosya | eşleme | içerik |
|---|---|---|---|
| `speaker_label` | `01-ders-01` | `<lesson_transcript_window>` | 10 bölüm EĞİTMEN/ÖĞRENCİ dönüşümlü; metin ilk üç sözcük (temizlenmiş) |
| `lesson_analysis` | `02-ders-v2` | `<lesson_request>` | v2 (course_insights: izlence konusu + ödev); rasyonel 0,8 (eşikte, uygulanır), denklem 0,6 (incelemede), 2 yanılgı (güvensiz → incelemede), soru, 2 tereddüt, ödev, konuşma, sonraki adım; alıntılar temizlenmiş transkriptte aynen geçer |

`01-analysis-01` v1 boru hattının örneğidir (`model_notes` taşır, `course_insights` yok); eşlemesiz yedek olarak kalır.

### Veli hattı (P6)

| rota | dosya | eşleme | içerik |
|---|---|---|---|
| `report` | `01-haftalik` | — (düz) | report-ast: 3 bölüm (Genel görünüm, Ayrıntı, Bu hafta yapılabilecekler), tek cümle özet, `daily_time` + `skill_bands` grafikleri, 2 maddelik adım kutusu; anahtar yok. Worker grafikleri izinli listeye göre süzer, başlığı ve meta'yı kendisi yazar |
| `notification_copy` | `01-haftalik`, `02-genel` | `<notification>` + `weekly_summary` / — | haftalık özet metni (sayısız; worker'ın sayı denetiminden geçer), diğer türler için genel metin |
