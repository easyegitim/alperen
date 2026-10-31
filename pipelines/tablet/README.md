# pipelines/tablet — `ogrenmen_tablet` (M06, pilot dilimi)

Tablet'in 5 öğrencilik TYT pilotu için gereken parçası: **sıfır LLM** `template` komutu. Parametrik
şablonlardan (`content/tyt-matematik/templates/*.py`, M03) soru varyantları üretir, şekilli şablonların PNG'lerini
çizer, her varyantı `question-item` şemasına karşı doğrular ve onaylı stoku **yalnız**
`register_template_question(p_item, p_key, p_figure)` RPC'si üzerinden doldurur (BLUEPRINT §6.1, §10.4, #53).
Pilotta öğrenciye giden pratik sorularının tek kaynağı bu yoldur.

## Kurulum ve kabul

```
python -m pip install -e /home/user/alperen/pipelines/tablet[dev] && ruff check /home/user/alperen/pipelines/tablet && python -m pytest /home/user/alperen/pipelines/tablet -q
OGRENMEN_DATABASE_URL=postgresql://ogrenmen:ogrenmen@127.0.0.1:5432/ogrenmen python -m pytest /home/user/alperen/pipelines/tablet -q -k live
python -m ogrenmen_tablet template --id kesir-modeli-toplama --count 5 --seed 7 --out /tmp/tablet-out && ls /tmp/tablet-out/figures/*.png && ! grep -q correct_option /tmp/tablet-out/questions.jsonl
python -m ogrenmen_tablet template --fill --min-stock 30 --dry-run --fixtures /home/user/alperen/fixtures/tablet --out /tmp/tablet-fill && grep -q register_template_question /tmp/tablet-fill/rpc_calls.jsonl && ! grep -q '"source": "llm"' /tmp/tablet-fill/questions.jsonl && test -f /tmp/tablet-fill/template_fill.json
```

Yerel yol bağımlılıkları (`ogrenmen-common`, `ogrenmen-contracts`, `ogrenmen-pii`) §2 gereği önceden
`pip install -e <yol>` ile kurulmuş olmalıdır (bkz. `pipelines/common/README.md`). `sympy`, `matplotlib`, `numpy`
sürümleri `content/tyt-matematik` ile aynı sabitlenmiştir. İçerik dizini paket olarak kurulmaz: şablon kaydı
(`<depo>/content/tyt-matematik/templates/__init__.py`) dosya yolundan yüklenir; kod başka bir yoldan yüklenmez.

## Komut

```
python -m ogrenmen_tablet template --id <şablon> [--count 50] [--seed 7] --out <dizin> [--dump-keys]
python -m ogrenmen_tablet template --id <şablon> --auto-approve [--count 50] [--seed 7] [--dry-run --fixtures <dizin>] --out <dizin>
python -m ogrenmen_tablet template --fill [--min-stock 30] [--seed 7] [--id <şablon>] [--dry-run --fixtures <dizin>] --out <dizin>
```

Ortak bayraklar `ogrenmen_common.cli_base`'ten gelir (`--dry-run --fixtures --out --limit --since --student-ref
--adapters`); bu komut `--dry-run`, `--fixtures`, `--out`, `--adapters` kullanır. `--count` `--fill` ile, `--min-stock`
`--fill` olmadan verilirse argüman hatası (2) döner; sessizce yok sayılmaz. Şablon kimlikleri:
`sayi-dogrusu-esitsizlik`, `kesir-modeli-toplama`, `yuzde-grafik` (şekilli), `islem-onceligi`,
`uslu-sadelestirme`, `denklem-birinci-derece` (şekilsiz).

### Yalnız üretim (`--auto-approve` / `--fill` yok)

Veritabanına dokunmaz, ağ kullanmaz. `--count` kadar **farklı** varyant (`content_hash`'e göre tekrarsız) üretilir;
aynı `--seed` aynı varyantları ve bayt bayt aynı PNG'leri verir.

| Çıktı | İçerik |
| --- | --- |
| `out/questions.jsonl` | `QuestionItem` satırları (`question-item` şemasına karşı doğrulanmış). Cevap anahtarı alanı (`correct_option`, `canonical_expr`, `solution`, `numeric_value`, `sympy_*`) **yoktur**; şekilli maddelerde `figure.render` (PNG yolu, boyut) dolu, `verification.render='ok'`, `vision='not_applicable'`. |
| `out/figures/<code_hash>.png` | Şablon şekli (aynı şekil kodu → tek dosya). Her PNG §6.1 boyut denetiminden geçer (aşağıda). |
| `out/cost_estimate.json` | Sıfır deneme (şablon yolunda LLM çağrısı yok). |
| `out/keys.jsonl` | **Yalnız `--dump-keys` ile** (test içindir): `answer-key` şemasındaki SymPy anahtarları + `content_hash`. Gerçek veritabanıyla `--dump-keys` reddedilir; `--fill` ile hiç kullanılmaz. |

### Şekil denetimi (§6.1)

Şablon soruları insan ya da vision denetimi olmadan onaylandığı için çizim sonrası otomatik kapı tektir:

* genişlik/yükseklik maddenin `figure.expected_px` aralığında (alan yoksa §6.1: 200 ≤ w ≤ 1600, 150 ≤ h ≤ 1600 px);
* dosya boyutu **2 KB** (`TEMPLATE_FIGURE_MIN_BYTES`) – 2 MB arasında;
* boş görüntü reddi: kanal başına piksel standart sapmasının en büyüğü 0,01'in altındaysa (0–1 ölçeği) görüntü boştur.

Geçmeyen şekilde `verification.render='size_mismatch'` yazılır ve `OGR-TPL-005` ile durulur (yalnız üretimde komut 1
döner; `--fill`'de o şablon `status='error'` olur).

**Şablona özgü bayt tabanı:** §6.1'in 5 KB tabanı LLM'in yazdığı şekil kodunun boş ya da bozuk çıktısını yakalamak
içindir. Şablon şekilleri düz renkli, deterministik çizimlerdir ve PNG olarak çok iyi sıkışır:
`kesir-modeli-toplama` şekilleri ≈ 4,6 KB'tır (5 KB'ın altında, ama dolu ve okunaklı). Bu yüzden şablon yolunda taban
2 KB'tır; boş görüntüyü bayt tabanı değil piksel varyansı denetimi yakalar.

### Kayıt (`--auto-approve`, `--fill`)

* **Veritabanı adaptörü** `ogrenmen_common`'dan: `--dry-run` verilirse ya da `SUPABASE_URL`/`SUPABASE_BATCH_JWT`
  yoksa (uyarı satırıyla dry-run'a düşülür) `JsonlDb` (taban `fixtures/db/dev-seed.json` + `--fixtures` dizini)
  ve yerel depo; aksi hâlde `PostgrestDb` + `SupabaseStorage` (`batch_worker` JWT). Bu komut model çağırmadığı için
  gerçek kipte de LLM adaptörü kurulmaz ve model anahtarı istenmez.
* **Yazım yalnız RPC ile:** `questions`, `figures`, `secure.answer_keys` tablolarına doğrudan yazım yoktur.
  Okunan tablolar: `question_templates` (`enabled`), `questions` (`template_id`, `status`, `content_hash`).
  PNG'ler önce `figures` kovasına `<code_hash>.png` olarak yüklenir, `p_figure.png_path='figures/<code_hash>.png'`
  (bkz. "Sapma notu").
* **Şekil nesneleri içerik adreslidir, en çok bir kez yüklenir:** aynı şekil kodu aynı baytı verir. Çalışma içinde
  görülen adlar önbellekte tutulur, yeni ad için önce `storage.exists` (HEAD; kova herkese açık okunur) sorulur;
  nesne varsa (aynı gece başka bir soru ya da önceki gece) yükleme yapılmaz. `figures` kovasında `batch_worker`'ın
  yalnız INSERT politikası vardır (`0017_storage.sql`), yani var olan nesnenin üstüne yazmak (409/upsert) reddedilir.
  Doğrulanmış şeklin dosyası da yeniden yazılmaz. Özetteki `figures_uploaded` / `figures_reused` bunu sayar.
* **`template.params` cevap taşımaz:** `questions.template_params` herkese açık şemadadır. Adı çözüm olan parametre
  (`cozum`, `cevap`, `sonuc`, `yanit`, `dogru`, `dogru_cevap`) ve değeri anahtarın sayısal değerine
  (`canonical_expr`/`numeric_value`) eşit olan parametre maddeden çıkarılır; değer yalnız `secure.answer_keys`'te
  durur. `content_hash` gövde + şıklardan hesaplandığı için değişmez.
  RPC şekli `verified`/`vision_status='not_applicable'`, anahtarı `sympy_status='verified'`
  (`written_by='batch_worker:template'`), soruyu `approved` yazar; `questions_approve_guard` yine çalışır.
* **Stok:** şablonun `status='approved'` soru sayısı. `--fill` her `enabled` şablon için stok `--min-stock`'un
  altındaysa farkı tamamlar; stok yetiyorsa şablon atlanır (`status='full'`, RPC çağrısı yok).
* **`content_hash` çakışmaları atlanır:** aynı şablonda aynı hash'li soru varsa varyant RPC'ye gitmez; başka
  kaynaktan aynı hash yüzünden RPC `null` dönerse de atlanır. İkisi `skipped_hash_collision`'da sayılır.
* **Determinizm:** şablon başına akış `random.Random(f"{seed}:{şablon}")`. Ertesi gece aynı akış baştan okunur;
  kayıtlı varyantlar hash ile atlanır ve stok kaldığı yerden dolar. Eksik soru başına en çok 25 (en az 100)
  varyant denenir; yeterli farklı varyant çıkmazsa `status='exhausted'` ve uyarı.
* **Kayıt dışı şablon:** `question_templates` satırı içerik kaydında (`TEMPLATE_FILES`) yoksa kod yüklenmez,
  şablon `unknown_template` olarak atlanır; `module_path` beklenenden farklıysa uyarı yazılır.
* **Satır–modül tutarlılığı:** `question_templates.has_figure` modülün `HAS_FIGURE`'ından farklıysa
  (`OGR-TPL-005`) ya da `skill_id` modülün ürettiği kazanımlarda yoksa (`OGR-TPL-004`; RPC soruyu
  `p_item.skill_ids` altına yazar, satır başka kazanım söylerdi) şablon `status='error'` ile atlanır, RPC çağrılmaz.
  `skill_id` modülün ikincil kazanımıysa (§10.4 `sayi-dogrusu-esitsizlik`: `cebir.esitsizlik / mutlak-deger`) yalnız
  uyarı yazılır. Not: dev seed (`fixtures/db/dev-seed.json`, `supabase/seed/dev/01_reference.sql`) bu şablonu
  `cebir.mutlak-deger` altında tutar, müfredat seed'i (`export-sql.py`) ve modül `cebir.esitsizlik` der; dry-run
  özetinde bu uyarı görünür.

| Çıktı | İçerik |
| --- | --- |
| `out/template_fill.json` (`--fill`) / `out/template_auto_approve.json` (`--auto-approve`) | Özet: `llm_calls: 0`, `generated_at`, `totals` (templates, filled, partial, full, exhausted, unknown_template, errors, registered, skipped_hash_collision, figures_uploaded, figures_reused) ve şablon başına `stock_before`, `deficit`, `registered`, `attempts`, `stock_after`, `status`, `question_ids`, `figures`, `figures_uploaded`, `figures_reused`, `warnings`, `error`. Çalışma yarıda kesilse de (ör. `question_templates` okunamadı) özet yazılır; `--fill` özetinde o durumda `aborted` hata mesajını taşır. |
| `out/questions.jsonl`, `out/figures.jsonl`, `out/rpc_calls.jsonl`, `out/audit.events.jsonl` | Dry-run'da `JsonlDb`'nin bu çalışmada yazdığı satırlar (yalnız RPC içinden); `rpc_calls.jsonl`'de `p_key` gizlidir (`{"redacted": true, "sympy_status": …}`). Gerçek kipte `questions.jsonl` kaydedilen maddeleri (`id` ile, anahtarsız) taşır. |
| `out/figures/*.png`, `out/storage/figures/*.png` | Çizilen PNG'ler; ikincisi dry-run'ın yerel depo kopyasıdır. |
| `out/cost_estimate.json` | Sıfır deneme. |

Çıkış kodu: hatalı şablon varsa 1 (RPC reddi, şablon/şema/şekil denetimi, satır–modül uyuşmazlığı, depolama ağ
hatası `OGR-STO-001`, stok okuma hatası `OGR-DB-003`; özete `status='error'` ile yazılır, diğer şablonlar sürer);
şablon listesi okunamazsa 1 (özet yine yazılır); argüman hatası 2; aksi 0.

Zaman damgası (`generated_at`, `cost_estimate.json`): dry-run'da `Runtime`'ın sabit saati (`OGRENMEN_NOW` ya da
fixture 'şimdi'si; JsonlDb ve audit satırlarıyla aynı an), yalnız üretimde `--dry-run` ya da `OGRENMEN_NOW` varsa aynı
sabit saat, gerçek kipte sistem saati. Aynı girdi bayt bayt aynı özeti verir.

Gece akışında (`nightly.yml`, M13) `tablet template --fill --min-stock 30` adımı kullanılır.

## Sapma notu

* **PNG yolu `figures/<code_hash>.png`, `figures/<id>.png` değil.** §3.4'teki sütun yorumu (`png_path … -- Storage:
  figures/<id>.png`) ve dev seed `<uuid>` biçimini kullanır. Şablon yolunda `figures.id` yalnız
  `register_template_question` içinde doğar ve RPC şekil satırını `on conflict (code_hash)` ile tekilleştirir; PNG ise
  RPC'den **önce** yüklenmelidir. Bu yüzden nesne adı içerik adreslidir: aynı şekil kodu → aynı bayt → tek nesne, tek
  `figures` satırı. `png_path` değeri yine `figures/` önekiyle başlar; panel ve worker yolu `figures.png_path`'ten
  okur, kimlikten türetmez. (M13 ve panel/worker sahipleri için.)
* **Şablon şekli bayt tabanı 2 KB** (§6.1'de 5 KB); gerekçe yukarıda "Şekil denetimi"nde.

## İçerik sahibine (M03) notlar

* `denklem-birinci-derece` `template.params.cozum` içinde `x`'in değerini taşır. Bu modül onu maddeden çıkarır,
  ama kaynağında kaldırılması ya da yeniden adlandırılması daha temizdir.
* `yuzde-grafik` şekil kodu (`figures.code`, herkese açık şema) son çubuğun değerini (ör. `175`) taşır ve şekil bu
  değeri çizer. Şekil kodu içerik adresinin parçası olduğu için burada değiştirilmez; soru tasarımı gözden
  geçirilmelidir.

## Hata kodları

| Kod | Anlam |
| --- | --- |
| `OGR-TPL-001…005` | RPC ile aynı anlam (source, şablon yok/kapalı, SymPy doğrulanmamış anahtar, müfredat/kazanım uyuşmazlığı, şekil: beklenti ya da §6.1 boyut denetimi); yerel denetimler de aynı kodu kullanır. |
| `OGR-STO-001` | Şekil deposuna ulaşılamadı ya da yükleme reddedildi (o şablon `error`). |
| `OGR-DB-003` | PostgREST okuma hatası (ör. stok okunamadı; o şablon `error`). |
| `OGR-TPL-006` | Bu modüle özgü: geçersiz sayı (`--count`/`--min-stock`), yeterli farklı varyant üretilemedi, `--dump-keys` yasak kipte. |
| `OGR-CONTRACT-001` | Madde/anahtar şemaya uymuyor, maddede cevap anahtarı alanı var ya da `template.params` cevap değeri taşıyor. |
| `OGR-Q-002` | Şık kuralı (4 şık, en az 2 etiketsiz). |

## Testler

`tests/test_template.py` ve `tests/test_fill.py` ağa çıkmaz. Başlıcaları: `test_template_zero_llm_calls` (üç kipte
`FakeLLM.complete` hiç çağrılmaz, `CostLedger.call` çağrılmaz, `cost_estimate.json` sıfır),
`test_template_fill_uses_rpc_only` (kabul komutunun aynısı; `questions`/`figures`/`secure.answer_keys` yazımlarının
hepsi `rpc:register_template_question` içinden, stok 30'a tamamlanır), `test_item_json_has_no_key_field`,
`test_variants_deterministic_by_seed`, `test_fill_skips_full_stock`, `test_hash_collision_skipped` (ön denetim ve
RPC `null` yolları), `test_fill_uses_postgrest_when_configured` (`httpx.MockTransport` ile PostgREST + Storage
taklidi: yalnız RPC ve kova yüklemesi yazılır). Taklit depo gerçek kova politikası gibi davranır (var olan nesneye
ikinci POST 409): `test_figure_uploaded_once_per_code_hash` (30'a dolumda paylaşılan şekiller bir kez yüklenir, önceki
geceden kalan nesne hiç yüklenmez), `test_storage_network_error_is_isolated_per_template` (`httpx.ConnectError` →
o şablon `OGR-STO-001`, diğeri dolar, çıkış 1, özet var), `test_stock_read_error_is_isolated_per_template`,
`test_template_list_error_still_writes_summary`, `test_template_row_mismatch_is_skipped` (`skill_id`/`has_figure`
uyuşmazlığı), `test_render_rejects_out_of_range_size` ve `test_check_figure_render_bounds_and_blank` (§6.1 kapısı),
`test_denklem_params_do_not_carry_the_answer`, `test_param_equal_to_answer_is_dropped`, `test_fill_is_deterministic`
(özet dosyaları bayt bayt aynı).

`tests/test_live_db.py` yalnız `OGRENMEN_DATABASE_URL` tanımlıysa koşar (yoksa SKIP): bağlanılan veritabanına
dokunmadan geçici bir veritabanı (`ogrenmen_tablet_live_<pid>`) açar, `supabase/scripts/db-test.sh`'in hazırlık
adımlarını uygular (`tests/00_local_stub.sql` süper kullanıcıyla; migration'lar, `seed/*.sql` ve
`export-sql.py` müfredat seed'i `ogrenmen_owner` rolüyle), her şablondan 3 varyantın `p_item/p_key/p_figure`
yükünü `psql` ile `batch_worker` rolünde gerçek `register_template_question`'a verir ve `questions.status='approved'`,
`secure.answer_keys.sympy_status='verified'`, şekil `verified` olduğunu doğrular; `batch_worker`'ın `approved`
soruyu, anahtarı ve doğrulanmış şekli doğrudan yazamadığını sınar; sonunda veritabanını siler.

## Ertelenen alt komutlar (pilot kapsamı)

Kurucunun kabul ettiği değerlendirme pilotu daralttı: 5 öğrencilik TYT pilotunda öğrenciye yalnız teşhis, eğitmen ve
onaylı **şablon** soruları gider (#53; `next_practice_items` `source in ('template','instructor')` filtreler), LLM
soruları zaten eğitmen kuyruğunda bekler. Bu yüzden §6.1'in şu parçaları bu dilimde **yoktur** (CLI'da kayıtlı
değildir; çağrılırsa argparse "invalid choice" ile 2 döner):

| Alt komut | Neden ertelendi |
| --- | --- |
| `generate` (LLM soru üretimi, `generation_requests`) | Pilotta LLM sorusu öğrenciye gitmez; şablonlu altı yaprak stoku `template --fill` ile dolar, diğer yapraklara eğitmen `source='instructor'` soru ekler. |
| `render --queue` / `render --fixtures` (sandbox) | Yalnız LLM'in yazdığı şekil kodu için gerekir; şablon şekilleri deterministik koddur ve burada doğrudan çizilir. |
| `vision --queue` | Şablon şekillerinde `vision='not_applicable'`; vision denetimi LLM şekilleri gelince. |
| `verify --question` | SymPy doğrulaması şablonun içinde (`assemble`) yapılır; tek soru doğrulama komutu LLM yoluyla gelir. |
| `pdf --test` (LaTeX `exam` + Tectonic) | Pilot Telegram'da soru soruya ilerler; deneme PDF'i pilot sonrası. |
| `review-queue --push` | Onay kuyruğu panelden (`v_review_queue`) okunur; şablon soruları kuyruğa düşmez. |
| `notes ingest` (`library_documents/library_chunks`) | Tüketicisi `generate`'in (3). adımıdır; `generate` ile birlikte gelir. |

Bu parçalar geldiğinde aynı paket içinde (`src/ogrenmen_tablet/`) alt komut olarak eklenir; `template` komutunun
sözleşmesi (RPC, çıktı dosyaları) değişmez.
