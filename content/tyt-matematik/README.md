# content/tyt-matematik — TYT Matematik içeriği (M03)

Öğrenmen pilotunun ilk içerik dilimi: müfredat `TYT-MAT@2026.1`, dönem `YKS 2027`. Kazanım ağacı, ön koşul
grafı, 27 yanılgı etiketi, 20 maddelik teşhis testi (+ ayrı cevap anahtarı ve 3 şekil), 6 parametrik soru
şablonu ve bu içeriği veritabanına taşıyan üç betik. Kaynak: `docs/BLUEPRINT.md` §2.7, §3.2, §3.4, §3.11, §10.
LLM çağrısı yoktur; anahtarlar SymPy ile doğrulanır, şekiller matplotlib ile deterministik üretilir.

## Dosyalar

| Yol | İçerik |
| --- | --- |
| `curriculum.json` | `curricula` satırı + `period_label` + `sources` + `diagnostic_exempt` (`problem.yas`, `problem.isci`); `status` zorunlu ve `export-sql.py` onu aynen yazar |
| `skills.json` | 3 düğüm (`temel`, `cebir`, `problem`; `is_leaf=false`, mastery tutmaz) + 18 yaprak; yapraklarda BKT varsayılanları `0.30 / 0.10 / 0.25 / 0.10` |
| `prerequisites.json` | 24 ön koşul kenarı (`strength`, `source='curriculum'`), §10.1 tablosu |
| `misconception-tags.json` | 27 etiket; `genel.soruyu-yarim-okuma` dışında hepsinin `skill_id`'si dolu; eğitmen metni üçüncü tekil (`-yor`), öğrenci metni sen dilinde, ünlemsiz ve emojisiz |
| `diagnostic/items.json` | 20 madde, sabit sıra, A–D şıklar; **doğru şık bilgisi yoktur** |
| `diagnostic/answer-keys.json` | `{kod: {correct_option, canonical_expr, numeric_value, solution}}`; yalnız `seed-keys.py` okur |
| `diagnostic/figures/*.py` + `*.png` | 3 şekil (kesir modeli ↔ madde 10, sayı doğrusu ↔ madde 15, yüzde çubuk grafiği ↔ madde 19); `.py` kendi başına çalışır, `seed=2026`, PNG'yi bayt bayt yeniden üretir |
| `templates/*.py` | 6 şablon (3 şekilli, 3 şekilsiz), ortak kod `templates/_common.py` |
| `versions/<sürüm>.json` | sürümün kazanım kimliği anlık görüntüsü (sürüm farkı raporu için) |
| `scripts/validate.py`, `export-sql.py`, `seed-keys.py` | aşağıda |
| `tests/` | pytest; `tests/stubs/schema.sql` canlı test için asgari şema taslağı |

## Kurulum ve komutlar

```
python -m pip install -e /home/user/alperen/packages/contracts/python sympy matplotlib numpy pglast
python /home/user/alperen/content/tyt-matematik/scripts/validate.py
python /home/user/alperen/content/tyt-matematik/scripts/export-sql.py --out /tmp/seed.sql
python /home/user/alperen/content/tyt-matematik/scripts/export-sql.py --as-version 2027.1 --out /tmp/seed2.sql
python /home/user/alperen/content/tyt-matematik/scripts/seed-keys.py --database-url "$OGRENMEN_DATABASE_URL"
python -m pytest /home/user/alperen/content/tyt-matematik -q
```

Sürüm sabitleri `pyproject.toml`'dadır (`sympy==1.14.0`, `matplotlib==3.11.2`, `numpy==2.5.3`, `pglast==8.7`).
Kurulacak paket yoktur; betikler dosya yolundan çalışır.

### `validate.py`

Hata varsa 1 ile çıkar; uyarılar çıkışı değiştirmez.

- Şemalar: `curriculum` (birleşik paket ve `#/$defs/curriculum`), `misconception-tags`, `diagnostic-test`,
  `diagnostic-keys` (`ogrenmen_contracts.errors`).
- Aynı `code` için tam bir `active` sürüm (`content/*/curriculum.json` taranır; ikinci dilim eklenirken eski
  sürüm `retired` yapılır).
- Ağaç: kimlikler tekil, her `parent_id` var ve kimlik ebeveyn önekiyle başlar, kök kazanım yaprak değil,
  BKT parametreleri aralıkta; ön koşul kenarları yapraklar arasında ve graf döngüsüz (Kahn).
- Etiketler: 27 tane, `skill_id` null yalnız `genel.*`, `prereq_skill_id` `prerequisites.json`'da o kazanımın
  doğrudan ön koşulu, metin kuralları (ünlem/emoji yok, öğrenci metninde "siz" hitabı yok, eğitmen metni `-yor`).
- Teşhis: 20 madde, kodlar `DIAG-<sürüm>-NN` sırayla, aynı kazanımın iki maddesi ardışık değil, her yaprak
  ≥ 1 madde ya da `diagnostic_exempt`, iki maddeli kazanımlarda zorluk `0.5 + 0.3`, tek maddelide `0.5`;
  etiketler katalogda ve maddenin kazanımına ya da onun (geçişli) ön koşullarına ait ya da `genel.*`;
  `items.json` içinde `correct` geçmez; şekil PNG'si var, 200–1600 px, üreten `.py` var.
- Anahtarlar: her madde için tek anahtar; doğru şık etiketsiz; üç çeldiricinin en az 2'si etiketli ve en az
  1'i etiketsiz (§10.3); `canonical_expr` SymPy ile **yalnız** doğru şıkkın değerini verir, `numeric_value` ona eşit.
- `settings.default_period`: `supabase/seed/01_settings.sql` varsa pglast ile okunur ve `period_label` ile
  karşılaştırılır; yoksa bilgi satırıyla atlanır.
- Şablonlar: her biri yüklenir, iki varyant `question-item` ve `answer-key` şemalarından geçer.
- Sürüm farkı: `versions/<sürüm>.json` ile kimlikler aynı olmalı (sürüm içinde kimlik sabittir — fark hata);
  bir önceki sürümün anlık görüntüsüyle (ya da `--previous <dosya>`) eklenen/kaldırılan kazanımlar raporlanır,
  **kaldırılan kazanım uyarıdır**. Yeni sürümün anlık görüntüsü `--write-snapshot` ile yazılır.

### `export-sql.py --out <dosya> [--as-version 2027.1] [--status …]`

DB'ye bağlanmadan tek işlemlik (`begin … commit`) SQL üretir; önce `validate.py` denetimlerini çalıştırır,
çıktıyı pglast ile ayrıştırır ve `answer_keys`/`correct_option` geçerse yazmaz. Kimlikler deterministiktir
(`uuid5(NAMESPACE_OGRENMEN, …)`, `NAMESPACE_OGRENMEN = uuid5(NAMESPACE_DNS, "ogrenmen.easy")`; müfredat
`"<code>@<version>"`, soru `"question:<kod>"`, şekil `"figure:<kod>"`, test `"diagnostic_test:<code@version>"`,
hukuk metni `"legal_text:<kind>:<version>"`) — `fixtures/db/dev-seed.json` ile aynı şema, bu yüzden dev seed'in
üstüne uygulanabilir ve tekrar çalıştırılabilir.

| Tablo | Yazım | Çakışmada |
| --- | --- | --- |
| `curricula` | `status` curriculum.json'dan aynen | `label`, `status` güncellenir |
| `skills`, `skill_prerequisites` | önce düğümler | içerik güncellenir |
| `misconception_tags` | | `do nothing` (etiket küresel anahtar) |
| `question_templates` | `module_path`, `engine`, `params_schema` (JSON Schema), `has_figure` | güncellenir, `enabled` korunur |
| `figures` | 3 teşhis şekli: `code` = `.py` kaynağı, gerçek px/bayt, `review_status='verified'`, `reviewed_by` = ilk etkin koordinatör (yoksa null) | `do nothing` (`code_hash`) |
| `questions` | 20 teşhis maddesi, `source='diagnostic'`, **`status='draft'`**, `figure_id` `code_hash` alt sorgusuyla | içerik sütunları güncellenir; `status` ve inceleme sütunlarına dokunulmaz |
| `diagnostic_tests` | `version = '2026.1'`, `item_ids` sabit sırayla | `item_ids` güncellenir |
| `legal_texts` | `docs/hukuk`'ta `legal_texts_kind` taşıyan 4 belge; `version` = `doc_version`, `effective_from` başlıktan; gövde yaml başlık bloğu çıkarılmış belge | `body_md`, `effective_from` güncellenir |

**Yer tutucular.** Her `{{RETENTION_*}}` `docs/hukuk/placeholders.json` girdisinin `days_source` alanına göre
çözülür: `retention_policies.days` → `policy_id` satırının `days` değeri
(`supabase/seed/04_retention_policies.sql`, pglast ile); `tg_chats.retention_days` → `tg_chats.retention_days`
sütun varsayılanı (`supabase/migrations/*.sql`, pglast ile). Bu yüzden `RETENTION_MESSAGES_DAYS` 90'a çözülür;
`messages.hard_delete` satırının `days=0` değeri kullanılmaz. Tanımsız yer tutucu, seed'de olmayan
`policy_id` ya da 0'a (veya altına) çözülen değer → hata, çıkış 1, dosya yazılmaz. `expected_days`'ten sapma
yalnız uyarıdır. `<!-- ogrenmen:… -->` işaretleri (çocuk dili, onay özeti, grup kısa/uzun) gövdede korunur.

**`--as-version 2027.1`**: aynı kazanım kimliklerini yeni `curricula` satırı (`uuid5("TYT-MAT@2027.1")`,
`year=2027`, `label` "TYT Matematik 2027", `status` varsayılan `draft` — iki `active` sürüm olmasın diye;
`--status` ile değişir) altında yazar: `curricula`, `skills`, `skill_prerequisites`, `misconception_tags`
(`do nothing`). Teşhis, şablon, şekil ve hukuk metinleri ilk sürümde kalır. `supabase/tests/01_schema.sql`
'iki sürüm aynı skill id' bu dosyayı seed'in üstüne uygular.

Şekil PNG'leri Storage'a ayrıca yüklenir: `diagnostic/figures/<ad>.png` → `figures` kovası, `png_path`
sütunundaki göreli yolla (`figures/<ad>.png`).

### `seed-keys.py [--database-url URL] [--dry-run]`

`answer-keys.json`'u okur, her anahtarı SymPy ile doğrular ve tek işlemde: 20 teşhis sorusu yoksa
`OGR-SEED-001` ile durur; `secure.answer_keys`'e `sympy_status='verified'`, `written_by='seed'`, `sympy_report`
yazar (var olan `seed` anahtarı güncellenir, `staff:<uuid>` anahtarı değişmez); `set_config('ogrenmen.reviewer',
'on', true)` ile soruları `approved` yapar (`reviewed_by` = ilk etkin koordinatör) ve hepsinin onaylandığını
denetler (`OGR-SEED-002`). SQL `psql`'e stdin'den gider; anahtar değerleri komut satırına, çıktıya ya da dosyaya
yazılmaz. `--database-url` verilmezse `$OGRENMEN_DATABASE_URL`; ikisi de yoksa çıkış 2. `answer-keys.json` yoksa
`SKIP: no keys` ve çıkış 0. Bağlantı kurucunun makinesinde `service_role`/`postgres`, `db-test.sh`'te yerel
`postgres` rolüdür; `bot_runtime`/`batch_worker` ile çalışmaz (bu roller `secure` şemasını görmez).

## Şablon arayüzü (M06 için)

`templates/<modül>.py` dosyasının sabitleri: `TEMPLATE_ID`, `SKILL_ID` (`question_templates.skill_id`),
`ENGINE`, `HAS_FIGURE`, `TAGS`, `PARAMS_SCHEMA`; işlevi
`generate(rng: random.Random) -> (QuestionItem, AnswerKey, FigureSpec | None)`.

- `QuestionItem` `question-item.schema.json`'a uyar: `source='template'`, `template = {id, params}`,
  `curriculum_code='TYT-MAT@2026.1'`, `verification.sympy='verified'`, `status='draft'`; tam dört şık, en az iki
  etiketsiz şık (doğru şık + bir hesap hatası çeldiricisi), iki etiketli çeldirici.
- `AnswerKey` `answer-key.schema.json`'a uyar: `correct_option`, `canonical_expr`, `solution`,
  `sympy_status='verified'`, `sympy_report{expr, value, matched_option, note}`; `question_id` geçici
  deterministik bir kimliktir (`uuid5("question:template:<content_hash>")`) — `register_template_question`
  kendi kimliğini üretir. mcq anahtarında `numeric_value` yoktur (şema `oneOf`); sayısal değer `note`'tadır.
- `FigureSpec`: `code` (şablon kimliği + kanonik JSON parametreler), `code_hash`, `alt_text`,
  `item_figure()`, `render(path) -> {png_path, width_px, height_px, bytes}` ve
  `rpc_payload(render_info, png_path)` (`register_template_question` `p_figure`'ı). Aynı parametre aynı PNG'yi
  verir; vision gerekmez.
- `content_hash(stem, options)` (`templates/_common.py`) `questions.content_hash` normalleştirmesidir.
- Yükleme: `templates.resolve("content/tyt-matematik/templates/kesir_modeli_toplama.py:generate")` ya da dosya
  yolundan `importlib` (paket kurulumu gerekmez).

| Şablon | Kazanım | Şekil | Çeldirici etiketleri |
| --- | --- | --- | --- |
| `sayi-dogrusu-esitsizlik` | cebir.esitsizlik (mutlak biçimde + cebir.mutlak-deger) | sayı doğrusu: boş/dolu uç, ışın ya da aralık | `esitsizlik.negatifle-carpma-yon` + `denklem.taraf-degistirme-isaret` (doğrusal); `mutlak.tek-durum` + `genel.soruyu-yarim-okuma` (mutlak) |
| `kesir-modeli-toplama` | temel.rasyonel-sayilar | iki bölünmüş dikdörtgen, paydalar {2,3,4,6,8,12} | `rasyonel.pay-payda-ayri-toplama`, `rasyonel.payda-esitlemeden-toplama` |
| `yuzde-grafik` | problem.yuzde | çubuk grafik | `yuzde.ardisik-toplama` ya da `yuzde.kar-satis-uzerinden`, + `genel.soruyu-yarim-okuma` |
| `islem-onceligi` | temel.sayilar | — | `sayilar.islem-onceligi-soldan` + `sayilar.negatif-carpim-isaret` ya da `sayilar.parantez-eksi-dagitma` |
| `uslu-sadelestirme` | temel.uslu | — | `uslu.usleri-carpma`, `uslu.negatif-us-isaret` |
| `denklem-birinci-derece` | cebir.denklem | — | `denklem.taraf-degistirme-isaret` + `denklem.paydayla-carpma-eksik` ya da `genel.soruyu-yarim-okuma` |

Her şablonda üçüncü çeldirici etiketsiz bir hesap hatasıdır.

## Testler

`python -m pytest /home/user/alperen/content/tyt-matematik -q`:

- `test_content.py` — veri §10 ile tutarlı, `validate.py` geçer, şekil `.py`'leri PNG'leri bayt bayt yeniden
  üretir, dev seed ile kimlik/özet uyumu (seed üst üste uygulanınca benzersizlik çakışması olmaz).
- `test_validate_negative.py` — her denetim için içeriğin geçici kopyası bozulur ve beklenen hata görülür
  (döngü, etiket/ön koşul, metin kuralları, eksik madde, ardışık kazanım, şık kuralı, yanlış anahtar, `correct`
  alanı, küçük/eksik şekil, iki active sürüm, sürüm farkı, `default_period`).
- `test_templates.py` — 6 şablon × 50 varyant: şemalar, `PARAMS_SCHEMA`, SymPy ile tek şık eşleşmesi, ≥ 2
  etiketsiz şık, şekilli şablonlarda PNG 200–1600 px ve deterministik; her şablonun matematiği ve etiketli
  çeldiricisi bağımsız olarak yeniden hesaplanır; `module_path` ile yükleme.
- `test_export_sql.py` — satır sayıları, `draft` durumu, anahtar yokluğu, yer tutucu çözümü (days_source, 0 gün
  reddi, tanımsız yer tutucu → çıkış 1), M02 dosyaları varken onların değerlerinin kullanılması, `--as-version`,
  determinizm.
- `test_seed_keys.py` — SQL kurgusu, yanlış anahtar reddi, `--dry-run` anahtar sızdırmaz, `SKIP: no keys`;
  `OGRENMEN_DATABASE_URL` tanımlıysa canlı Postgres'te geçici veritabanı açılır, `tests/stubs/schema.sql`
  (BLUEPRINT DDL'inden asgari tablolar + onay tetikleyicileri) uygulanır, `export-sql.py` çıktısı ve
  `seed-keys.py` çalıştırılır (20 soru onaylı, 20 `seed` anahtarı, tekrar çalıştırma, eğitmen anahtarının
  korunması, ikinci sürüm), sonra veritabanı silinir. Tanımsızsa bu iki vaka `SKIP` olur.

Canlı vakaları çalıştırmak için:
`OGRENMEN_DATABASE_URL=postgresql://ogrenmen:ogrenmen@127.0.0.1:5432/ogrenmen python -m pytest /home/user/alperen/content/tyt-matematik -q`
(rolün `create database` yetkisi olmalı).

## Yeni sürüm ya da dilim ekleme

1. Yeni kazanımları `skills.json`/`prerequisites.json`'a ekle, `curriculum.json`'da `version`/`year`/`label`'ı
   yükselt; eski sürümün `curriculum.json`'u başka bir dizinde duruyorsa `status`'ünü `retired` yap.
2. `validate.py` sürüm farkını raporlar (önceki `versions/*.json` ile); kaldırılan kazanım uyarıdır, eski
   mastery satırlarına dokunulmaz. Geçerliyse `validate.py --write-snapshot`.
3. Teşhis maddeleri değişirse kodlar yeni sürümle (`DIAG-2026.2-NN`) yeniden numaralanır; açık oturumlar eski
   testle biter.

## Kabul komutu notu

- **Saklama süresi kaynağı (M02 henüz yok).** §3.11 zinciri `supabase/seed/04_retention_policies.sql` ve
  `tg_chats` migration'ını ister; bu dalgada `supabase/` dizini yoktur. `export-sql.py` bu dosyalar bulunamazsa
  aynı değerleri `docs/BLUEPRINT.md` §3.10 saklama tablosundan (not sütunundaki `bot_responses.flagged_delete,
  365` dahil) ve §3.5 `tg_chats.retention_days default 90` DDL'inden okur ve stderr'e `UYARI` yazar. Çözülen
  her değer `placeholders.json` `expected_days` ile aynıdır (test). M02 dosyaları geldiğinde öncelik onlardadır;
  `--strict-sources` yedeği kapatır (CI'da M13 bunu açabilir). `--retention-seed`/`--migrations` başka yol verir.
- **Canlı DB testi taslak şemayla.** `supabase/migrations` olmadığı için `test_seed_keys.py` canlı vakaları
  `tests/stubs/schema.sql` taslağını kullanır (yalnız seed'in dokunduğu tablolar, BLUEPRINT sütunlarıyla;
  onay tetikleyicileri sadeleştirilmiş). Gerçek migration'larla uçtan uca deneme M02'nin `db-test.sh`'idir.
  Taslak `halfvec` kullanmaz; yerel pgvector 0.6.0 sınırlaması bu modülü etkilemez.
- Dört kabul komutu yazıldığı gibi çalışır ve 0 ile çıkar; canlı vakalar `OGRENMEN_DATABASE_URL` tanımsızken
  `SKIP` olur (bu ortamda tanımlıyken de geçtiği doğrulandı).
