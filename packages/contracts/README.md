# @ogrenmen/contracts — sözleşmeler (M00)

TS ve Python'un paylaştığı JSON Schema (draft 2020-12) sözleşmeleri, `models.json` fiyat/limit/zincir
tablosu, fikstürler ve iki dilde aynı kararı veren doğrulayıcılar (BLUEPRINT §2.1, §4).

## İçerik

| Yol | Ne |
| --- | --- |
| `schemas/<ad>.schema.json` | 25 sözleşme; `$id: https://ogrenmen.easy/schemas/<ad>.json`, her nesnede `additionalProperties: false`, `x-version: "1.0"`, Türkçe `description` |
| `schemas/gemini/<ad>.json` | Gemini `responseSchema` düzleştirmesi (`scripts/flatten.py` üretir; commit edilir; `common` hariç) |
| `models.json` | sağlayıcı/model/fiyat/limit/zincir — tek kaynak (`verified_at` zorunlu; kod zincir adı kullanır) |
| `fixtures/<ad>/{valid,invalid}/*.json` | her şema için ≥ 2 geçerli + ≥ 2 geçersiz örnek; `expect.json` her geçersiz dosyanın düşürmesi gereken anahtar kelimeyi yazar (TS ve Python aynı dosyaları okur) |
| `src/index.ts` | `validate<T>(id, data)`, `isValid`, `errors`, `toGeminiSchema`, `Schemas`, `schemaDocuments`, `loadModels`, üretilen tipler — çalışma zamanında Ajv derler (Node testleri, panel, araçlar) |
| `src/validators.ts` | `@ogrenmen/contracts/validators` — aynı imza, **önceden derlenmiş** (Ajv standalone); Worker yalnız bunu içe alır. Cevap anahtarı taşıyan üç sözleşme (`answer-key`, `diagnostic-keys`, `question-generation`) bu yolda yoktur: istenirse `OGR-SCHEMA-005` |
| `src/answer-key.ts` | `@ogrenmen/contracts/answer-key` — anahtar taşıyan üç sözleşmenin önceden derlenmiş doğrulayıcıları (`keyErrors`, `isValidKey`, `validateKey`, `validateAnswerKey`, `validateDiagnosticKeys`, `validateQuestionGeneration`); yalnız pipelines/seed, Worker içe alamaz |
| `src/forbidden-words.ts` | `x-forbidden-words` anahtar kelimesi (Ajv "code" tanımı, standalone koda gömülür) |
| `src/gemini-schema.ts` | `toGeminiSchema` |
| `src/runtime/core.js` | bağımlılıksız çekirdek: Türkçe normalleştirme, yasaklı kelime taraması, biçimler (uuid, date, date-time, uri), kod noktası uzunluğu; `gen` bu dosyanın metnini `validators.js` içine gömer |
| `src/generated/` | `bun run gen` çıktısı (commit edilir): `<ad>.d.ts`, `index.d.ts`, `validators.js` + `.d.ts` (Worker; `correct_option` dizesi içermez, test denetler), `validators-keys.js` + `.d.ts` (yalnız `answer-key.ts` içe alır) |
| `python/ogrenmen_contracts/` | `validate`, `errors`, `is_valid`, `gemini_schema`, `load_models`; `schemas` ve `models.json` paket içinde sembolik bağdır (tek kaynak bu dizin) |

## Komutlar

```
bun install --cwd /home/user/alperen/packages/contracts
bun run --cwd /home/user/alperen/packages/contracts gen         # d.ts + validators.js + schemas/gemini
bun run --cwd /home/user/alperen/packages/contracts typecheck
bun run --cwd /home/user/alperen/packages/contracts test        # vitest
python -m pip install -e /home/user/alperen/packages/contracts/python[dev]
python -m pytest /home/user/alperen/packages/contracts/python -q
```

Şema değiştiren her PR `bun run gen` çalıştırıp `src/generated` ve `schemas/gemini` değişikliklerini de
commit eder; CI `git diff --exit-code packages/contracts/src/generated packages/contracts/schemas/gemini`
ile tazeliği denetler. Üretim deterministiktir (aynı şemalar → bayt bayt aynı dosyalar).

## Kurallar ve kararlar

- **İki doğrulama yolu, tek karar.** Çalışma zamanı (`ajv/dist/2020` + `ajv-formats`) ve önceden derlenmiş
  (standalone) yol aynı `AJV_OPTIONS` ile derlenir: `strict: true`, `allErrors: true`, `allowUnionTypes: true`;
  `strictTypes` ve `strictRequired` bilinçli olarak kapalıdır (`if` dallarında `type` tekrarlanmaz,
  `oneOf: [{required: [...]}]` kalıbı kullanılır). `test/fixtures.test.ts` her fikstürde iki yolun aynı hata
  kümesini ürettiğini denetler.
- **Worker CPU bütçesi.** `validators.js` hiçbir `require`/`import` taşımaz, şema derlemez; biçimler ve
  `x-forbidden-words` çekirdekten gömülüdür. Ajv'nin `ucs2length` yardımcısı için ürettiği
  `require("ajv/dist/runtime/ucs2length").default` ifadesi üretim sonrası metin değişimiyle gömülü
  `ogrUcs2length`'e çevrilir (Ajv iç modülüne yama yok). Dosya ~860 KB (paylaşılan `$ref` fonksiyonları,
  `inlineRefs: false`, her `$defs` tanımı ayrıca dışa aktarılır); wrangler küçültür.
- **Parçalı başvuru.** Üç yol da (`validate.ts`, `validators.ts`, Python) `<ad>#/$defs/<tanım>` kabul eder:
  `transcript#/$defs/segment` (`transcripts/<id>.jsonl` satırı), `curriculum#/$defs/skill`,
  `misconception-tags#/$defs/tag`, `common#/$defs/studentRef` … Önceden derlenmiş dışa aktarım adı
  `<şemaCamel><TanımPascal>`'dır (`transcriptSegment`, `curriculumSkill`). Parçada yalnız o tanım uygulanır
  (kökteki `x-forbidden-words` dahil değildir); `#/$defs/<tanım>` dışındaki parça ve bilinmeyen tanım
  `OGR-SCHEMA-001`. Hata `ContractValidationError.schemaId` = `…/<ad>.json#/$defs/<tanım>`.
- **`x-forbidden-words`.** Şemanın kökündeki listeden bir kelime, verideki herhangi bir metin değerinde
  (anahtarlar hariç) **geçerse** doğrulama düşer (BLUEPRINT §4): normalize edilmiş metinde düz alt dize
  araması, büyük/küçük harf duyarsız, Türkçe `İ/I/ı/i` katlanır ("TAHMİN", "tahminen", "öntahmin",
  "GARANTİLİ", "kesintisiz" yakalanır; "Kesir", "kesişim" yakalanmaz). "k" ile biten kelimede ünsüz
  yumuşaması da aranır: "çıkacak" → "çıkacağ" ("çıkacağı", "çıkacağını"). Vakalar
  `test/cases/forbidden-words.json` (TS ve Python aynı dosya).
- **Biçimler ve desenler Python'da da aynı.** `jsonschema`'nın varsayılan `date-time`/`uri` denetimi ek paket
  ister ve yoksa sessizce geçer; bu yüzden Python biçimleri `_core.py`'de ajv-formats "full" kipinin birebir
  eşleniğidir (`test/cases/formats.json`); şemalarda `_core.FORMATS` dışında bir `format` kullanılırsa Python
  doğrulayıcısı `OGR-SCHEMA-006` hatasıyla kurulmaz (Ajv strict de derlemede düşer). `pattern`, `patternProperties`
  ve ona bağlı `additionalProperties` ECMAScript anlamıyla aranır (`$` yalnız metnin sonunda, `\d` yalnız
  ASCII); `propertyNames` `pattern` üzerinden aynı kuralı alır. Vakalar `test/cases/patterns.json`.
- **Şık kuralı.** `question-item.options` tam dört şıktır, anahtarlar **sırayla A, B, C, D**'dir (bir `allOf`
  dalında `prefixItems` + `const`; üst düzey `items` her şıkka uygulanmaya devam eder) ve en az iki şık
  `misconception_tag: null` taşır (`contains` + `minContains: 2`; doğru şık etiket dizisinden çıkarılamaz).
  `diagnostic-test` aynı kuralı `$ref` ile alır. "3 çeldiricinin ≥ 2'si etiketli" kuralı içerik doğrulamasında
  (`content/…/validate.py`) ve `app.questions_approve_guard`'dadır.
- **Şablon parametreleri.** `question-item.template.params` değerleri `template-params#/$defs/value` ile aynı
  kurala uyar: sayı, metin, mantıksal, `null`, bunların düz dizisi (≤ 12) ya da **bir düzey** düz nesne
  (ör. `{"kesir1": {"pay": 1, "payda": 2}}`); iki düzey iç içe nesne ve nesne dizisi düşer. Böylece her nesne
  düğümünde `additionalProperties` tanımlıdır (`test/catalog.test.ts`).
- **`telegram-update` yalnız sahteler içindir.** Şema `fixtures/telegram` ve Worker testlerindeki sahte
  güncellemeleri doğrular; gerçek Bot API güncellemeleri burada tanımsız alanlar taşır (`link_preview_options`,
  `sticker`, `quote`, `external_reply`, `chat.photo` …). Worker canlı webhook güncellemesini bu şemayla
  reddetmez, yalnız kullandığı alanları okur.
- **Gemini düzleştirme.** `$ref` çözülür; `$id/$schema/$defs/examples/x-*`, `additionalProperties`, koşullu ve
  birleştirici kısıtlar atılır; `format` yalnız `enum`/`date-time` korunur; `const` → `enum`; `oneOf` → `anyOf`;
  `null` → `nullable: true`; her nesneye `propertyOrdering`. Atılan kurallar dönen JSON doğrulanırken uygulanır.
  `scripts/flatten.py [--out DİZİN]` (varsayılan `schemas/gemini`).
- **`common` fikstürleri.** `common` yalnız `$defs` taşıdığı için fikstürleri `{ "ref": "#/$defs/<tanım>", "data": … }`
  biçimindedir ve ilgili tanıma karşı doğrulanır.

## Blueprint sapmaları

Bilinçli farklar; M02, M03, M04, M06, M09 ve M13 bunları bilmelidir.

1. **Şık null kuralı şemada.** §4.1 "en az iki null" kuralının JSON Schema ile ifade edilemediğini söyler;
   `contains: {properties: {misconception_tag: {type: null}}}` + `minContains: 2` ile ifade edilebildiği için
   şemaya eklendi (daha sıkı; `validate.py`, `options-null-rule.test.ts` ve `app.questions_approve_guard` yine
   uygular). `diagnostic-test` `$ref` ile miras alır.
2. **Şık anahtarları sıralı ve tekil.** §4.1 şeması anahtarların farklı olmasını zorlamaz (`[A, A, C, D]`
   geçerdi; `grade_attempt` ve A·B·C·D düğmeleri belirsizleşir). `options.allOf[0].prefixItems` anahtarları
   A, B, C, D sırasına sabitler. Gemini çıktısı değişmez (birleştiriciler atılır).
3. **`template.params` daraltıldı.** §4.1'de `{type: object}`; burada değerler `template-params#/$defs/value`
   (skaler, `null`, düz dizi ya da bir düzey düz nesne). M03 şablonları (§10.4) bu biçimde parametre yazar.
4. **`validators.js` her şemayı içermez.** §2.1 "her şema için" önceden derlenmiş doğrulayıcı der, §4 ise
   "Worker answer-key şemasını içe alamaz" der. İkincisi güvenlik kuralı olduğu için anahtar taşıyan üç
   sözleşme ayrı `validators-keys.js`'e üretilir ve yalnız `./answer-key` alt yolu onu içe alır; Worker
   bundle'ında `correct_option` dizesi geçmez (`test/validators.test.ts`). Toplamda her şema için önceden
   derlenmiş doğrulayıcı vardır.
5. **`x-forbidden-words` ünsüz yumuşaması.** §4 "geçerse" der; düz alt dize araması buna uyar. Ek olarak "k"
   ile biten kelimenin "ğ"li gövdesi de aranır ("çıkacağı"); ilke 10'un amacına uyan genişletme.
6. **`diagnostic-keys` anahtar adı `propertyNames` ile.** `patternProperties` yerine
   `propertyNames.pattern` + `additionalProperties: {$ref: key}`; karar aynı, iki dilde aynı desen anlamı.
7. **`misconception-tags` metinlerinde emoji deseni.** "ünlemsiz, emojisiz" kuralı desenle zorlanır:
   `!`, U+2600–U+27BF, U+2B50–U+2B55, U+FE0F ve U+1F000–U+1FAFF reddedilir.
8. **Blueprint içi çakışma — M09 OCR alarmı.** §4.7 `instructor-alert` "başarısız" kelimesini yasaklar, §6.4
   ise `'Sınav arşivi OCR başarısız: <yıl/dönem>'` alarmını yazdırır; bu metin her zaman düşer. Şema §4.7'yi
   izler; önerilen metin `'Sınav arşivi OCR okunamadı: <yıl/dönem>'` (`fixtures/instructor-alert/valid/ops-ocr-unreadable.json`
   geçerli, `invalid/ops-ocr-basarisiz-wording.json` geçersiz).
9. **BKT SQL'i payda sıfırken NULL döner.** Ayrıntı `packages/mastery-math/README.md` → "Blueprint sapmaları";
   M02 §3.7'deki metni değil `packages/mastery-math/sql/bkt.sql` dosyasını birebir kopyalar.

## Kabul komutu notu

`git -C /home/user/alperen diff --exit-code packages/contracts/src/generated packages/contracts/schemas/gemini`
yalnız izlenen (commit edilmiş) dosyaları karşılaştırır; dizin ilk kez commit edilene kadar komut her zaman
0 döner. Tazelik bu yüzden ayrıca denetlendi: `bun run gen` iki kez çalıştırılıp tüm üretilen dosyaların
sha256 özetleri aynı çıktı. Python tarafında `tests/test_gemini.py` `flatten.py --out <geçici dizin>`'i iki kez
çalıştırıp çıktının kendisiyle ve commit edilen `schemas/gemini` ile bayt bayt aynı olduğunu doğrular; test
çalışma ağacındaki dosyalara yazmaz.
