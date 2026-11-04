# @ogrenmen/contracts — sözleşmeler (v2, zod-önce)

Öğrenmen 2.0'ın yapılandırılmış çıktı ve veri sözleşmeleri. Tek doğrulayıcı **zod 4**'tür; Python tüketicileri için
aynı şemalar JSON Schema 2020-12 olarak dışa aktarılır (`schemas/*.schema.json`). Plan: `docs/PLAN-v2.md`,
adlar ve şekiller: `docs/PLAN-v2-detail.md` §4-5.

## İki şema: strict ve loose

Her sözleşme `src/zod/<ad>.ts` içinde **tek fabrikadan** (`build(c)`) iki kez kurulur:

| | `contract.strict` | `contract.loose` |
| --- | --- | --- |
| Kullanım | model çağrısı (`output_config.format`) | modelden dönen veriyi doğrulama, DB'ye yazmadan önce |
| Kısıtlar | yok: özyineleme, `min/max`, `minLength/maxLength`, `pattern`, `multipleOf` yok; her nesne `additionalProperties:false` | uzunluk, aralık, desen, `uuid/date` biçimi + çapraz alan kuralları (`refine`) |
| TS tipi | aynı (`z.output`) | aynı |

```ts
import { solutionDiagnosis, outputFormat, schemaRegistry } from '@ogrenmen/contracts';

const format = outputFormat(solutionDiagnosis);          // { type:'json_schema', schema } -> output_config.format
const diagnosis = solutionDiagnosis.parse(modelOutput);  // loose: kısıtlar + çapraz kurallar, ZodError fırlatır
const r = solutionDiagnosis.safeParse(modelOutput);      // ya da isValid(...)
schemaRegistry['solution-diagnosis'];                    // ad -> loose zod; strictSchemaRegistry: ad -> strict zod
```

- **`outputFormat(contract)`** strict şemanın JSON Schema'sını `enum`/`const` korunmuş halde verir. `@anthropic-ai/sdk`
  1.4 `zodOutputFormat` dönüşümü `enum` ve `const`'u açıklama metnine taşıyıp dilbilgisel kısıtı düşürüyor; ayrık
  birleşimli şemalarda (document-ast) bunu kullanın, yanıtı yine `contract.parse` ile doğrulayın.
- Anthropic karmaşıklık sınırları (zorunlu olmayan alan <= 24, `anyOf`/tür-dizisi alan <= 16) `test/strict.test.ts`
  ile model çıktısı olan her sözleşmede denetlenir.
- `added(...)`: v2'de eklenen alanlar (`course_insights`, `exam-item.format/trick/difficulty/skill_ids`,
  `exam-priority-plan.rows[].style_ids`) strict kipte zorunlu, loose kipte varsayılanla doldurulur; böylece v1 verisi
  geçerli kalır ve JSON Schema'da zorunlu sayılmaz.
- Metin alanlarında (`uiText`): loose kip ünlem ve emoji reddeder (öğrenci/veliye görünen metinler).

## Sözleşmeler (dışa aktarılan şema adları)

Model çıktısı (`llmOutput`, strict kısıt testli): `solution-diagnosis`, `curriculum-draft`, `page-class`,
`exam-page-items`, `answer-sheet`, `inferred-keys`, `exam-report`, `report-ast`, `document-ast`, `exam-generation`,
`style-definition`, `exam-priority-plan` (sınıflandırma tek yerde: model çıktısı, Opus rotası; veri/DB listesinde değil), `proposal-review`, `style-question-generation`, `memory-delta`, `memory-compaction`, `conversation-summary`, `notification-copy`, `eval-verdict`,
`lesson-analysis` (v2: +`course_insights`), `exam-item` (v2), `memory-fact`, `transcript`, `figure-render-report`.

Veri/DB sözleşmeleri (model çıktısı değil): `question-item`, `answer-key`, `weekly-summary`, `curriculum`.

Saklama kuralları: `document-ast` anahtarlı model çıktısıdır; saklarken `splitDocumentKeys(doc)` ile `keys` ayrılıp
`secure.exam_answer_keys`'e yazılır, `generated_documents.content` yalnız `storedDocumentAst` (keys boş) olur.
`lesson-analysis.model_notes` model çıktısı değildir (strict şemada yok); boru hattı parse sonrası yazar.
`memory-delta` yalnız `str_replace`/`insert` taşır (`create` hafıza aracı işleyicilerinde ve `memory-compaction`'dadır).
Zorluk bandı `easy|medium|hard` (`DIFFICULTY_BANDS`); `exam_questions.difficulty` (numeric 0..1) bu bandın
`DIFFICULTY_BAND_VALUE` karşılığından yazılır ({easy: 0.3, medium: 0.55, hard: 0.8}; tek kaynak); tarz/soru `format` sunuş biçimidir (`PRESENTATION_FORMATS`).

Anahtar satırı (`keyEntryShape`): `numeric_value` ondalık sayıdır (`secure.exam_answer_keys.numeric_value numeric`;
`grade_exam_session` 1e-6 toleransla karşılaştırır); kesin SymPy biçimi `canonical_expr`'de kalır. `secure.answer_keys`
(v1, text) için `answer-key` sözleşmesi aynen SymPy dizesi taşır.

Rapor kipi (`kinds` yalnız `['report']`: `exam-report`, `report-ast`): veli okur, bu yüzden `question`, `answer_sheet`
ve `answer_key_page` blokları, `figure.source='upload'` (ham `uploads`) ve boş olmayan `keys[]` loose doğrulamada
reddedilir; veliye görünen bütün metin alanlarında ünlem ve emoji yasaktır (`latex` ve `svg` hariç).

Deneme sayfası sözleşmeleri (P2 ekleri, `added`: strict kipte zorunlu, eski veride varsayılan): `page-class`
`printed_page_number` (basılı sayfa no ya da null) ve `unreadable`; `exam-page-items` ve `answer-sheet` sayfa düzeyinde
`unreadable` (true iken `items`/`answers` boş olmalı; refine), `answer-sheet.answers[].confidence`. Çift işaret
`status: multiple` (marked_option null, `marks_seen` ≥ 2, not zorunlu) notlamada boş sayılır.

Deneme raporu şablonu (`exam-report` loose kuralları, `EXAM_REPORT_TEMPLATE`, `EXAM_REPORT_CHARTS`): bölümler 1 genel
görünüm, 2 kazanımlar, 3 sonraki adım; ilk metin bloğu bölüm 1'de tek cümlelik özet paragrafı; `chart.data_ref`
yalnız `section_nets` (score_by_section), `skill_map` (skill_heatmap), `error_causes` (error_cause_histogram),
`time_per_question`, `trend` (mastery_trend) ve türüyle eşleşir (packages/doc-render `ChartDataMap` anahtarları);
özet kutusu en çok 3 madde. `report-ast` bu kurallara bağlı değildir.

Strict kipte `minItems: 1` (loose'ta en az 1 isteyen dizilerde) ile `uuid`/`date`/`date-time` biçimleri korunur; API bunları destekler.

Tarza özel soru üretimi sözleşmesi `style-question-generation` adıyla kayıtlıdır (PLAN-v2 rota tablosundaki
`question-generation`): v1 tablet zarfı (`{item, key}`) aynı adla legacy dosya olarak yaşadığı için ad çakışmasın diye
ayrıldır. `style_id` zorunlu, 1-10 soru, soru/anahtar biçimi `exam-generation` ile ortaktır.

Plan listesine eklenenler (kısa gerekçe):
- `report-ast` (veli/haftalık/konu/trend raporu) ve `memory-compaction` (gece hafıza sıkıştırma): PLAN-v2 rota tablosunda
  adı geçer, §5 listesinde yoktur. `report-ast` = `exam-report` ile aynı yapı (belge AST, `kind: report`).
- `document-ast`: her blokta `id` (hata durumunda yalnız o bloğu yeniden üretmek için) ve rapor belgeleri için `chart`
  bloğu (`data_ref` ile render anında deterministik doldurulur).
- `solution-diagnosis.error_cause` null olabilir (doğru çözümde); `verdict=correct` iken `failing_step_no` da null.

## Komutlar

```
bun run --cwd /home/user/alperen/packages/contracts export          # zod -> schemas/<ad>.schema.json
bun run --cwd /home/user/alperen/packages/contracts export:check    # diskteki dosyalar güncel mi (CI)
bun run --cwd /home/user/alperen/packages/contracts typecheck
bun run --cwd /home/user/alperen/packages/contracts test            # vitest
bash /home/user/alperen/packages/contracts/check.sh                 # hepsi + Python (ruff, pytest)
```

Şemayı değiştiren her değişiklik `bun run export` çalıştırıp `schemas/` farkını da ekler. `export:check` ve
`test/export.test.ts` diskteki dosyaların kaynaktan bayt bayt aynı üretildiğini denetler (Bun ve Node aynı çıktıyı verir).

## Fikstürler

`fixtures/<ad>/{valid,invalid}/*.json` — her sözleşme için en az 1 geçerli ve 1 geçersiz örnek. TS (`test/fixtures.test.ts`)
ve Python (`python/tests/test_fixtures.py`) aynı dosyaları okur. `refine-` önekli geçersiz dosyalar yalnız zod'un çapraz
alan kuralıyla düşer (JSON Schema ifade edemez); Python onları geçerli bulur ve bu da sınanır. `expect.json` (v1'den
kalan) Python'da dosyanın düşürmesi gereken anahtar kelimeyi yazar. Depo kökündeki `fixtures/llm/*` örnekleri
`test/llm-fixtures.test.ts` ile yeni şemalara karşı doğrulanır.

## JSON Schema dışa aktarımı ve Python

`schemas/<ad>.schema.json` loose şemanın yapısal halidir (`$id: https://ogrenmen.easy/schemas/<ad>.json`, `x-version: "2.0"`).
Çapraz alan kuralları yalnız TS'dedir; Python'da gereken birkaç v1 kuralı (`question-item` şık kuralı ve koşulları,
`answer-key` oneOf, `figure-render-report`, `memory-fact`) `jsonSchemaPatch` ile JSON Schema'ya da yazılır
(`diagnostic-test` `question-item.json#/properties/options`'u `$ref` ile alır). `transcript#/$defs/segment` ve
`curriculum#/$defs/{curriculum,skill,prerequisite}` parça başvuruları `defs` ile korunur.

`python/ogrenmen_contracts/` `schemas/*.schema.json` dosyalarını okur (`validate`, `errors`, `is_valid`, `load_models`);
`gemini_schema` yalnız henüz budanmamış `pipelines/common` Gemini bağdaştırıcıları için anında düzleştirme yapar
(committed Gemini kopyası yok).

### Legacy şemalar

`src/legacy-schemas.ts` listesindeki 13 v1 dosyası (`common`, `diagnostic-keys`, `diagnostic-test`,
`generation-request`, `instructor-alert`, `misconception-tags`, `models`, `nightly-facts-output`, `query-expand`,
`question-generation`, `research-output`, `template-params`, `tutor-reply`) elle bakımlıdır, zod
karşılığı yoktur ve `export` dokunmaz. Yalnız Python boru hatları, `fixtures/scripts` ve Python paketi okur;
`x-forbidden-words` anahtar kelimesi yalnız bu dosyalarda ve Python doğrulayıcıda yaşar. Tüketicileri budanınca
liste, dosyalar ve ilgili fikstür klasörleri silinir.

## Plandan bilinçli sapmalar

- PLAN-v2 §2.2 "forbidden-word validators" kalemini düşürür; yine de Python `_core.find_forbidden_word` ve `instructor-alert`
  `x-forbidden-words` yerinde kalır: `pipelines/ders` `analysis.py` ve diğer tüketiciler budanana kadar.
- `gemini_schema` (Python) `pipelines/common` `adapters/structured.py` yüzünden kalır.
- `exam-priority-plan` model çıktısıdır (Opus rotası); veri/DB sözleşmesi değildir.
- Tarza özel üretim sözleşmesi plandaki `question-generation` adıyla değil `style-question-generation` adıyla kayıtlıdır (yukarıya bak).
- `bot-response-log` silindi (`bot_responses` tablosu planda düşer).

## Kaldırılanlar (v1'den)

Gemini düzleştirilmiş kopyaları (`schemas/gemini/`, `src/gemini-schema.ts`, `scripts/flatten.py`), `src/forbidden-words.ts`
ve TS tarafındaki `x-forbidden-words`, Ajv ve Ajv standalone üretilmiş doğrulayıcılar (`src/generated/`, `src/validators.ts`,
`./answer-key` alt yolu), `json-schema-to-typescript` tipleri (tipler artık `z.output`), TS `loadModels` (fiyat tablosu
`packages/llm`'e geçer; `models.json` Python için yerinde).
