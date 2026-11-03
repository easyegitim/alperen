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
`style-definition`, `memory-delta`, `memory-compaction`, `conversation-summary`, `notification-copy`, `eval-verdict`,
`lesson-analysis` (v2: +`course_insights`), `exam-item` (v2), `memory-fact`, `transcript`, `figure-render-report`.

Veri/DB sözleşmeleri (model çıktısı değil): `question-item`, `answer-key`, `exam-priority-plan` (v2: +`style_ids`),
`weekly-summary`, `curriculum`.

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

`src/legacy-schemas.ts` listesindeki 15 v1 dosyası (`bot-response-log`, `common`, `diagnostic-keys`, `diagnostic-test`,
`generation-request`, `instructor-alert`, `misconception-tags`, `models`, `nightly-facts-output`, `query-expand`,
`question-generation`, `research-output`, `telegram-update`, `template-params`, `tutor-reply`) elle bakımlıdır, zod
karşılığı yoktur ve `export` dokunmaz. Yalnız Python boru hatları, `fixtures/scripts` ve Python paketi okur;
`x-forbidden-words` anahtar kelimesi yalnız bu dosyalarda ve Python doğrulayıcıda yaşar. Tüketicileri budanınca
liste, dosyalar ve ilgili fikstür klasörleri silinir.

## Kaldırılanlar (v1'den)

Gemini düzleştirilmiş kopyaları (`schemas/gemini/`, `src/gemini-schema.ts`, `scripts/flatten.py`), `src/forbidden-words.ts`
ve TS tarafındaki `x-forbidden-words`, Ajv ve Ajv standalone üretilmiş doğrulayıcılar (`src/generated/`, `src/validators.ts`,
`./answer-key` alt yolu), `json-schema-to-typescript` tipleri (tipler artık `z.output`), TS `loadModels` (fiyat tablosu
`packages/llm`'e geçer; `models.json` Python için yerinde).
