# pipelines/tablet — `ogrenmen_tablet` (M06)

Tablet modülü (BLUEPRINT §6.1, §10.4): soru bankasını iki yoldan doldurur ve denetler.

* **Sıfır LLM şablon yolu** (`template`): parametrik şablonlardan (`content/tyt-matematik/templates/*.py`, M03)
  varyant, şekil PNG'si ve onaylı stok — **yalnız** `register_template_question` RPC'siyle. Pilotta öğrenciye giden
  pratik sorularının tek kaynağı budur (#53).
* **LLM yolu** (`generate`, `render`, `vision`, `verify`): `question_gen` zinciriyle soru + anahtar zarfı, şekil
  kodu için sandbox render, SymPy anahtar doğrulaması, vision denetimi; her LLM sorusu `pending_review` olarak
  eğitmen kuyruğuna düşer, anahtar yalnız `register_answer_key` RPC'siyle yazılır.
* **Yardımcılar**: `pdf` (LaTeX `exam` + tectonic deneme PDF'i), `review-queue` (onay kuyruğu özeti/bildirimi),
  `notes ingest` (ders notu PDF'i → `library_documents/library_chunks`; `generate` istemine en yakın 3 parça).

## Kurulum ve kabul

```
python -m pip install -e /home/user/alperen/pipelines/tablet[dev] && ruff check /home/user/alperen/pipelines/tablet && python -m pytest /home/user/alperen/pipelines/tablet -q
python -m ogrenmen_tablet generate --skill tyt.mat.temel.rasyonel-sayilar --count 2 --dry-run --fixtures /home/user/alperen/fixtures/tablet --out /tmp/tablet-out && test -f /tmp/tablet-out/cost_estimate.json && ! grep -q correct_option /tmp/tablet-out/questions.jsonl
python -m ogrenmen_tablet template --id kesir-modeli-toplama --count 5 --seed 7 --out /tmp/tablet-out2 && ls /tmp/tablet-out2/figures/*.png
python -m ogrenmen_tablet template --fill --min-stock 30 --dry-run --fixtures /home/user/alperen/fixtures/tablet --out /tmp/tablet-fill && grep -q register_template_question /tmp/tablet-fill/rpc_calls.jsonl && ! grep -q '"source": "llm"' /tmp/tablet-fill/questions.jsonl
OGRENMEN_DATABASE_URL=postgresql://ogrenmen:ogrenmen@127.0.0.1:5432/ogrenmen python -m pytest /home/user/alperen/pipelines/tablet -q -k live
```

Yerel yol bağımlılıkları (`ogrenmen-common`, `ogrenmen-contracts`, `ogrenmen-pii`) §2 gereği önceden
`pip install -e <yol>` ile kurulmuş olmalıdır (bkz. `pipelines/common/README.md`). `sympy`, `matplotlib`, `numpy`
sürümleri `content/tyt-matematik` ile aynı sabitlenmiştir; `jinja2` (PDF şablonu), `pypdf` (ders notu),
`fonttools` + `brotli` (Lexend woff2 → ttf), `defusedxml` (SVG ayrıştırma) sabit sürümlüdür. SVG → PNG için isteğe
bağlı `[svg]` eki (`cairosvg`, sistemde libcairo ister); yoksa `rsvg-convert`, o da yoksa `.svg` saklanır ve PNG
`SKIP` olur. `tectonic`, `dot` (graphviz), `rdkit`, `vl-convert` kurulu değilse ilgili motor `SKIP`
(`render_status='failed'`, `vision='skipped'`; §12 #41); testler matplotlib + svg ile geçer. İçerik dizini paket
olarak kurulmaz: şablon kaydı (`<depo>/content/tyt-matematik/templates/__init__.py`) dosya yolundan yüklenir.

Canlı veritabanı testleri (`-k live`) yalnız `OGRENMEN_DATABASE_URL` tanımlıysa koşar, bağlanılan veritabanına
dokunmaz: geçici bir veritabanı (`ogrenmen_tablet_live_<pid>`) açıp sonunda siler.

## Komutlar (özet)

```
python -m ogrenmen_tablet template --id <şablon> [--count 50] [--seed 7] [--auto-approve | --dump-keys] --out <dizin>
python -m ogrenmen_tablet template --fill [--min-stock 30] [--seed 7] [--id <şablon>] [--dry-run --fixtures <dizin>] --out <dizin>
python -m ogrenmen_tablet generate [--skill <id>] [--count 10] [--band easy|mid|hard] [--batch] [--dump-keys] [--dry-run --fixtures <dizin>] --out <dizin>
python -m ogrenmen_tablet render --queue [--limit N] --out <dizin>      |  render --fixtures <dizin> --out <dizin>
python -m ogrenmen_tablet vision --queue [--limit N] --out <dizin>
python -m ogrenmen_tablet verify --question <uuid|zarf.json> [--key <anahtar.json>] --out <dizin>
python -m ogrenmen_tablet pdf --test <uuid|test.json> --out deneme.pdf [--with-keys] [--require-pdf]
python -m ogrenmen_tablet review-queue [--push] --out <dizin>
python -m ogrenmen_tablet notes ingest --pdf <yol> --curriculum TYT-MAT [--title …] --out <dizin>
```

Ortak bayraklar `ogrenmen_common.cli_base`'ten gelir (`--dry-run --fixtures --out --limit --since --student-ref
--adapters`). `--dry-run` (ya da `SUPABASE_URL`/`SUPABASE_BATCH_JWT` yokken, uyarıyla) tamamen sahte `Runtime`'dır:
`JsonlDb` (taban `fixtures/db/dev-seed.json` + `--fixtures` dizini), yerel depo (`out/storage/`), `FakeLLM`
(`fixtures/llm/<amaç>`), çıkışta `out/<tablo>.jsonl` + `out/cost_estimate.json`. Gerçek kipte model çağıran komutlar
(`generate`, `vision`, `notes ingest`) tam `Runtime` kurar (`CostLedger` + `check_spend`; model anahtarı zorunlu);
`render`, `verify`, `pdf`, `review-queue` yalnız `PostgrestDb` + `SupabaseStorage` (+ bildirim) kurar, model
anahtarı istemez. Çıkış kodu: argüman hatası 2, `OGR-*` hatası 1, aksi 0.

## `template` (sıfır LLM)

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

## `generate` (LLM soru üretimi, zincir `question_gen`)

**Hedef listesi.** `--skill` verilirse yalnız o yaprak, `--count` kadar (varsayılan 10; elle/test). Şablonlu yaprakta
`--skill` açık istek sayılır ve uyarı yazılır. `--skill` yoksa (gece, `nightly.yml`):

1. `generation_requests where needs_generation and served_question_id is null` satırları okunur, `generation-request`
   şemasıyla doğrulanır (uymayan uyarıyla atlanır), `(skill_id, difficulty_band, question_kind)` ile gruplanır ve
   istek sayısına göre azalan (eşitlikte en eski) sırada alınır. `exam_variant` satırının `topic`/`points` değeri
   istemde **yalnız meta** olarak geçer; `regenerate` satırı için aynı kazanımda, isteyen eğitmenin `retired` yaptığı
   en yeni sorunun `review_note`'u eklenir. Ham sınav metni (`exam_items.ocr_text`) hiçbir yoldan okunmaz.
2. Ardından `approved` stoku `< 30` olan ve `question_templates.enabled` şablonu **olmayan** yapraklar en düşük
   stoktan başlayarak (eşitlikte `order_no`) eklenir; şablonlu yapraklar LLM'e gitmez (`template --fill` doldurur).
3. Toplam `runtime_flags.tablet_nightly_count` (10) ile kesilir; `--count` verilirse onu da aşmaz.

`approved` stoku ≥ 30 olan hedef üretilmez (`pool_sufficient`, LLM ve `check_spend` çağrısı yok).

**Akış (hedef başına, en çok 2 deneme).** Başta bir kez `check_spend('question_gen')` (izin yoksa ya da `degraded`
ise tüm hedefler `cap_blocked`, model çağrısı yok). İstem (`prompts.py`, `scrub_for_llm`'den geçer): kazanım
kimliği/adı/açıklaması, zorluk bandı, soru türü, kazanımın yanılgı etiketleri, istek metası, en yakın 3
`library_chunks` (≤ 600 token; yoksa adım atlanır) ve 1 onaylı `content_pool.explanation`, kazanımdaki son 5 soru
kökü (tekrar etmesin), ikinci denemede düşen kuralın açıklaması ("Önceki deneme reddedildi, düzelt: …"; vision
uyuşmazlığında "kodu düzelt"). Her çağrı `CostLedger.call` (`llm_calls.ref_table='library_chunks'`, `ref_id`
virgüllü parça kimlikleri; parça yoksa `generation_requests`/`skills`). `--batch` ile tur Gemini Batch'e gider;
süre dolarsa hedefler `deferred` olur ve istekler açık kalır (eş zamanlı çağrıya düşülmez).

Denetim sırası: zarf şeması (`question-generation`), `source='llm'`, müfredat kodu, hedef kazanım ve istenen tür,
şık kuralı (4 şık, A–D, en az iki etiketsiz), maddede anahtar alanı yok, `content_hash` çakışması yok → SymPy →
şekil varsa sandbox render + boyut denetimi → vision. Şema/kazanım/tür/şık/tekrar kuralında düşen deneme **atılır**.
SymPy, render ya da vision'da düşen deneme **incelenebilir aday** olarak tutulur.

* Başarı → `questions` satırı `status='draft'` ile eklenir (yalnız `batch_worker`'ın INSERT yetkisindeki sütunlar),
  şekil varsa önce PNG `figures/<id>.png` kovasına, sonra `figures` satırı (`review_status` varsayılan `pending`);
  ardından `register_answer_key(p_question, p_key)` → soru `pending_review` (pilotta her LLM sorusu eğitmen
  onayından geçer). İlgili `generation_requests` satırları `served_question_id`, `served_at` ile kapanır.
* 2 başarısız deneme → son incelenebilir aday `status='pending_review'` ile eklenir; neden
  `questions.verification.review_note`'a yazılır ("2 başarısız deneme; son neden: …"), şekil `review_status='pending'`
  kalır. SymPy'de düşen anahtar **yazılmaz** (başarısız anahtar DB'de kalmaz; eğitmen panelden `set_answer_key` ile
  anahtar verir). Yalnız atılan denemeler olduysa hedef `failed`, istek açık kalır ve ertesi gece yeniden denenir.
* `register_answer_key` düşerse (ağ, `OGR-KEY-*`) soru anahtarsız `draft` kalır, `verification.review_note`'a
  "Anahtar kaydı … başarısız" notu düşülür, hedef `error` olur ve istek açık kalır. Sonraki çalışmada bu taslakların
  `content_hash`'i tekrar sayılmaz; aynı soru yeniden üretilirse satır (kimlik içerik adresli) güncellenir ve anahtar
  yeniden kaydedilir (`batch_worker` `status` yazamadığı için taslak başka yoldan kuyruğa alınamaz).
* `approved` stoku ≥ 30 olan kazanımın istekleri (`pool_sufficient`) üretimsiz ve **açık** kalır:
  `served_question_id` yalnız üretilen soruyla dolar (§6.1) ve `batch_worker` `needs_generation`'ı yazamaz. Bu
  satırlar raporda `requests_left_open` altında listelenir; o kazanımın soruları onaylı havuzdan sunulur.
* Kimlikler içerik adreslidir: `questions.id = uuid5(NS, "llm-question:<content_hash>")`,
  `figures.id = uuid5(NS, "llm-figure:<sha256(code)>")`.

**Anahtar yalıtımı.** Anahtar yalnız `register_answer_key` RPC'sine gider; `out/questions.jsonl` ve
`out/generate_report.json` anahtar alanı taşımaz (`rpc_calls.jsonl`'de `p_key` gizlidir). SymPy'nin bulduğu değer ve
şık harfi ("SymPy doğru şıkkı A buldu…") yalnız bellekte, ikinci denemenin isteminde ve `secure` şemasına giden
`sympy_report`'ta kalır; `verification.review_note`, `errors` ve rapor değersiz notu taşır ("SymPy sonucu
anahtardaki şıkla eşleşmedi", "canonical_expr ile numeric_value eşit değil"). `out/keys.jsonl` yalnız
dry-run'da `--dump-keys` ile (test); gerçek veritabanıyla `--dump-keys` → `OGR-GEN-003`.

| Çıktı | İçerik |
| --- | --- |
| `out/generate_report.json` | Kip, müfredat, `check_spend` durumu, toplamlar, `requests_left_open` (`pool_sufficient` istekleri) ve hedef başına `status` (`generated`, `review`, `failed`, `pool_sufficient`, `cap_blocked`, `deferred`, `error`), `attempts`, `sympy/render/vision`, `errors`, `request_ids`, `library_chunk_ids`, maliyet. |
| `out/questions.jsonl`, `figures.jsonl`, `generation_requests.jsonl`, `llm_calls.jsonl`, `rpc_calls.jsonl` | Dry-run'da `JsonlDb`'nin bu çalışmada yazdıkları; gerçek kipte `questions.jsonl` kaydedilen soruların anahtarsız satırlarıdır. |
| `out/storage/figures/<id>.png` | Dry-run'ın yerel depo kopyası. |
| `out/cost_estimate.json` | `CostLedger.write_estimate` (amaç/model/durum kırılımları). |

## Render sandbox'ı (`sandbox.py`) ve `render`

* **AST ön denetimi (danışma katmanı):** yalnız `matplotlib`, `numpy`, `math`, `sympy` (+ kuruluysa `schemdraw`,
  `graphviz`, `rdkit`) içe alınır; `os`, `sys`, `subprocess`, `socket`, `pathlib`, `ctypes`… ve `open`, `eval`,
  `exec`, `compile`, `__import__`, `getattr` gibi adlar, aynı modül adlarına öznitelik zinciri (`matplotlib.os`,
  `np.os.execv`, `np.ctypeslib`, `….sys`, `….builtins`), `_` ile başlayan öznitelikler, dosya/ağ işlevleri
  (`loadtxt`, `fromfile`, `save`, `imread`, `urlopen` …), mutlak yol/URL/`..` içeren dize sabitleri reddedilir.
  Reddedilen kod çalıştırılmaz (`status='rejected'`). Çalışma anında kurulan yollar (`chr(47) + …`) bu katmanda
  görünmez; onları süreç katmanı durdurur.
* **Süreç (asıl engel):** `subprocess.run([sys.executable, "-I", "-S", runner], timeout=20, cwd=<geçici dizin>,
  env=<asgari>)`; `unshare -n` çalışıyorsa (yoksa `-r -n`) boş ağ ad alanı. Runner: `setrlimit` CPU 10 sn, adres alanı
  512 MB, dosya 5 MB, core 0; `sys.addaudithook` kancası (değerleri kapanışta bağlı: şekil kodu runner'ın genel
  adlarını — `_WORK`, `_READ` — değiştirse de kanca değişmez) soket/alt süreç/`os.system`/`exec`/`fork`/`ctypes`/
  `tempfile` olaylarını, **`os.rename`/`os.replace`'i tümden**, `os.open` ile ve dosya tanımlayıcısından yazmayı,
  `dir_fd`'li dosya işlemlerini, çalışma dizinindeki `figure.png`/`figure.svg` dışına yazmayı ve izinli kökler
  (standart kütüphane, site dizinleri, matplotlib verisi ve önbelleği, yazı tipleri, çalışma dizini; `/usr` bütünüyle
  **değil**) dışından okuma/dizin listelemeyi reddeder; `socket`, `ssl`, `subprocess` modülleri `sys.modules`'tan
  kaldırılır. `sys.path` yalnız standart kütüphane ve site dizinleridir (depo kaynakları yok).
* **Motorlar:** matplotlib (`Agg`; Lexend `packages/design-system/fonts` → `fontTools` ile ttf, önbellek
  `~/.cache/ogrenmen-tablet/fonts`; olmazsa DejaVu Sans; zemin `#f6f8fc`, çizgi `#051c60`, vurgu `#0030a2`, eksen
  yazısı 11–12 pt ≥ 14 px), svg (defusedxml; `script`/`foreignObject`/dış `href`/`on*`/stilde `@import`/`url()`
  reddi; kök `width`/`height`/`viewBox` dönüştürmeden **önce** okunur, sınır dışı ya da belirsiz boyut (yüzde, em)
  `size_mismatch` — 20000×20000 SVG bitmap'e hiç çevrilmez; `cairosvg` aynı runner sürecinde rlimit + 20 sn + ağsız +
  denetim kancasıyla, yoksa `rsvg-convert` rlimit + zaman sınırıyla, ikisi de yoksa SKIP), tikz/latex (`tectonic --untrusted`, `-Z shell-escape` yok, `\write18`/`\input` reddi),
  vega-lite (`vl-convert`, `url` reddi), graphviz (`dot`). Kurulu olmayan motor `skipped`.
* **Boyut denetimi:** 200 ≤ w ≤ 1600, 150 ≤ h ≤ 1600 px (maddenin `expected_px` aralığıyla kesişim), 5 KB ≤ bayt ≤
  2 MB, boş görüntü (kanal başına piksel std < 0,01) reddi → `size_mismatch` / `blank`.
* `render --queue`: `figures.render_status='pending'` satırları çizilir, PNG `figures/<id>.png`'ye yüklenir,
  `render_status/png_path/svg_path/boyut/render_log/attempts` ve `vision_status` (`pending` ya da `skipped`)
  güncellenir → `out/render_queue.json`. `render --fixtures <dizin>`: dizindeki (ya da `figures/` alt dizinindeki)
  `.py/.svg/.tex/.dot/.vl.json` kaynakları çizilir, rapor `out/render_report.json`, geçen PNG'ler `out/render/`.

## `vision --queue`

`render_status='rendered'`, `vision_status='pending'` LLM şekilleri: PNG depodan indirilir, zincir `vision_check`
(`Runtime.vision` → `CostLedger`) kök + `stem_values` + alt metinle `figure-render-report` döner. `match` → şekil
`match`, soru `verification.vision='match'`. `mismatch` → `attempts + 1`; 2 denemeden azsa "kodu düzelt" istemiyle
(`question_gen` zinciri) yeni şekil kodu istenir, sandbox'ta çizilip yeniden denetlenir, **yeni** `figures` satırı
yazılır ve `questions.figure_id` ona çevrilir (`batch_worker` `figures.code` sütununu güncelleyemez); güncellemenin
satıra ulaştığı yeniden okunarak doğrulanır (ulaşmazsa `error` + `orphan_figure_id`). Eski şekil `review_status`'u
`pending` kalır (`batch_worker` yazamaz); sonuçta `superseded_figure_id` olarak raporlanır ve hiçbir soruya bağlı
olmadığı için `review-queue` sayımına girmez. 2. uyuşmazlıkta not `verification.review_note`'a yazılır ve şekil
eğitmen kuyruğunda kalır. Yalnız `draft`/`pending_review` soruların şekli düzeltilir: `approved`/`retired`/`rejected`
soruda yalnız `figures.vision_status`/`vision_report` yazılır, düzeltme istenmez (LLM maliyeti yok), soru değişmez.
Tavan engeli → `pending` (sonra denenir). Şablon şekilleri `not_applicable`.

## `verify`

`verify --question <zarf.json>`: `question-generation` zarfının şema/şık/anahtar sızıntısı/SymPy denetimi ve şekil
render'ı → `out/verify_report.json` (doğrulandıysa 0, düştüyse 1). `verify --question <uuid>`: veritabanındaki
sorunun şık kuralı, şekil durumu ve PNG boyut denetimi; `batch_worker` `secure.answer_keys`'i okuyamadığı için SymPy
yalnız `--key <anahtar.json>` (eğitmenin verdiği dosya) ile çalışır, yoksa kayıtlı `verification.sympy` raporlanır.

**SymPy kuralı (`verify.py`).** `canonical_expr` içindeki `stem_values` adları değerleriyle yer değiştirir, ifade
içerik şablonlarının güvenli ayrıştırıcısıyla (`_common.sympify_expr`/`parse_math`: karakter ve ad beyaz listesi,
`eval`'den önce) SymPy'ye çevrilir. `numeric`: `simplify(expr - numeric_value) == 0`. `mcq`: değer şık
metinleriyle eşleştirilir; tam bir şık eşleşmeli, `matched_option == correct_option` olmalı ve doğru şık etiketsiz
olmalı. `canonical_expr` ve `numeric_value` ikisi de yoksa sözel `mcq` → `not_applicable` (anahtar
`written_by='batch_worker:unverified'`; eğitmen `peek_answer_key` ile görmeden onaylanamaz), `numeric` → `failed`.
**`numeric_value` verildiğinde `canonical_expr` zorunludur:** ifadesiz bir sayı SymPy ile hesaplanmadığı için
`failed` olur (aksi hâlde `written_by='batch_worker:tablet'` ile makine doğrulamalı sayılır ve OGR-Q-003 kemeri
atlanırdı). Ondalık virgül (`0,125`) sayı olarak okunur. LLM'in yazdığı `sympy_status`/`sympy_report` kullanılmaz,
yeniden yazılır.

**Güvenilmez ifade sınırları.** `canonical_expr`/`numeric_value` LLM çıktısıdır: önce AST ön denetimi (≤ 2000
karakter; üs yalnız küçük sabit, `|üs| ≤ 1000`, üs içinde üs yok, iç içe üslerin çarpımı ≤ 1000; `^` üs sayılır) —
`10**(10**10)` SymPy'ye hiç gitmez. Sonra denetim ayrı süreçte (`multiprocessing`, `fork`; çok iş parçacıklıysa
`forkserver`) `SYMPY_TIMEOUT_S = 10` sn ve `RLIMIT_AS = mevcut + 512 MB` ile koşar; aşım `failed` ("zaman sınırını
aştı" / "bellek sınırını aştı") döner, `generate` diğer hedeflerle sürer.

## `pdf`

Şablon `pipelines/tablet/templates/exam.tex.j2` (jinja2; LaTeX ile çakışmasın diye ayraçlar `<< >>`, `<% %>`,
`<# #>`). `--test`: `diagnostic_tests.id` ya da JSON (`{"title", "question_ids"}` / `{"title", "items"}` / dizi;
zarf verilirse yalnız `item`). Veritabanından yalnız `approved` sorular basılır; şıklar etiketsiz; şekil PNG'si
depodan, yoksa şekil kodu sandbox'ta yeniden çizilir (`<pdf adı>-sekiller/`). `--out deneme.pdf` dosya adıdır
(`--out <dizin>` verilirse `<dizin>/deneme.pdf`); `.tex` aynı adla yanına yazılır. `tectonic` varsa ağsız ad alanında
`--untrusted` derlenir; yoksa yalnız `.tex` (not satırı "SKIP"), `--require-pdf` ile bu durum `OGR-PDF-003`.
`--with-keys`: cevap anahtarı sayfası ve `\CorrectChoice` **yalnız eğitmen** içindir; anahtarlar her soru için
`peek_answer_key` RPC'siyle (audit'li) eğitmen oturumundan alınır (`SUPABASE_URL` + `OGRENMEN_STAFF_JWT`);
`batch_worker` anahtar okuyamaz, eğitmen JWT'si yoksa `OGR-PDF-002`.

## `review-queue`

`batch_worker` panelin `v_review_queue` görünümünü okuyamaz (yalnız `authenticated`); sayılar temel tablolardan
çıkar: `questions.status='pending_review'` (kaynak, kazanım, üretim notu olanlar, 2 deneme kuralıyla düşenler, en eski
bekleme günü), bekleyen bir soruya bağlı `figures.review_status='pending'` (render/vision dağılımı; düzeltmeyle yerine
yenisi konmuş eski şekil sayılmaz), açık `generation_requests`. "… soru iki denemede doğrulamayı geçemedi" satırı
yalnız `2 başarısız deneme` önekli notları sayar; diğer üretim notları (şekil düzeltme vb.) "… sorunun üretim notu
var" satırına düşer. Özet
`out/review_queue.json`; `--push` tek mesajlık bildirim gönderir (`Notifier`: gerçek kipte `TELEGRAM_OPS_BOT_TOKEN`
+ `ADMIN_CHAT_ID`, yoksa/dry-run'da stdout). Metin Türkçe, en çok 4 satır, emoji ve ünlem yok, öğrenci kimliği yok.

## `notes ingest`

`pypdf` ile sayfa metni → paragraf/cümle sınırından ~800 token'lık (≈ 3.200 karakter) parçalar (başladığı sayfa
numarasıyla) → `scrub_for_llm` (e-posta, telefon, TCKN, URL…) → `Runtime.embedding` (defterden geçer; dry-run'da
`FakeEmbedding` 768) → `library_documents` (`id = uuid5(NS, "library:<curriculum_id>:<sha256(pdf)>")`, `title`,
`pages`, `storage_path`) + `library_chunks` (`page`, `text`, `embedding` halfvec metni). Aynı PDF aynı müfredata
ikinci kez alınmaz (`status='exists'`); varlık parça sayısıyla denetlenir — belge satırı yazılıp parça yazımı
düşmüşse sonraki alım parçaları yeniden yazar (`status='repaired'`). `--curriculum` `TYT-MAT` (aktif sürüm) ya da `TYT-MAT@2026.1`. Arama
(`library.Library.nearest`): aynı `curriculum_id`'li belgelerin parçaları; puan = terim örtüşmesi (5 harflik kök
öneki; `plainto_tsquery('turkish', skills.name)` karşılığı) ve kazanım adının embedding'iyle kosinüs benzerliğinin
ortalaması; ilk 3 parça, toplam ≤ 600 token. Çıktı `out/notes_ingest.json`.

## Sapma notu

* **PNG yolu `figures/<code_hash>.png`, `figures/<id>.png` değil.** §3.4'teki sütun yorumu (`png_path … -- Storage:
  figures/<id>.png`) ve dev seed `<uuid>` biçimini kullanır. Şablon yolunda `figures.id` yalnız
  `register_template_question` içinde doğar ve RPC şekil satırını `on conflict (code_hash)` ile tekilleştirir; PNG ise
  RPC'den **önce** yüklenmelidir. Bu yüzden nesne adı içerik adreslidir: aynı şekil kodu → aynı bayt → tek nesne, tek
  `figures` satırı. `png_path` değeri yine `figures/` önekiyle başlar; panel ve worker yolu `figures.png_path`'ten
  okur, kimlikten türetmez. (M13 ve panel/worker sahipleri için.)
* **Şablon şekli bayt tabanı 2 KB** (§6.1'de 5 KB); gerekçe yukarıda "Şekil denetimi"nde. LLM şekillerinde §6.1'in
  5 KB tabanı aynen uygulanır (`sandbox.MIN_BYTES`).
* **LLM şekli PNG yolu `figures/<id>.png`** (§3.4 sütun yorumu); `id` kod hash'inden türetildiği için yükleme satırdan
  önce yapılabilir.
* **Üretim notu `questions.verification.review_note`'ta.** §6.1 (8) "2 başarısız deneme → `pending_review` +
  `review_note`" der; ama `batch_worker` `questions.review_note` sütununu yazamaz (§3.8 "review sütunları hariç",
  `grants_matrix.json`; yalnız `approve_question` ve `register_answer_key` gövdeleri yazar). Not, question-item
  şemasındaki `verification.review_note` alanına yazılır. Panel kuyruğunda görünmesi için `v_review_queue.reason`
  bu alanı da okumalıdır (aşağıda "Entegrasyon notları").
* **SymPy'de iki kez düşen soru anahtarsız kuyruğa girer (§6.1 (8) esas alındı).** `register_answer_key(…'failed')`
  (§12 #8) soruyu `rejected` yapıp anahtarı siler; §6.1 (8) ise "2 başarısız deneme → `pending_review` + not" der.
  Pilotta her LLM sorusu eğitmenden geçtiği için §6.1 (8) okuması esas alınmıştır. Bu yüzden başarısız anahtar hiç gönderilmez; soru
  `pending_review` + `verification.sympy='failed'` olur, eğitmen panelden `set_answer_key` ile anahtar verir
  (`questions_approve_guard` anahtarsız onayı zaten reddeder).
* **`--skill` şablonlu yaprakta da üretir.** §6.1 (0) "LLM yalnız `generation_requests` satırı açıkça o kazanımı
  isterse"; `--skill` (elle/test) aynı türden açık istek sayılır ve uyarı yazılır. Gece modunda şablonlu yaprak
  yalnız istek satırıyla gelir.
* **`regenerate` isteğinin eski sorusu** tabloda bağlanmaz (`generation_requests`'te soru kimliği sütunu yok); aynı
  kazanımda, isteyen eğitmenin (`reviewed_by = requested_by_staff`) istekten önce `retired` yaptığı en yeni sorunun
  `review_note`'u kullanılır.
* **Ders notu `storage_path` mantıksal yoldur** (`library/<sha256[:16]>/<dosya>`): `0017_storage.sql`'de ders notu
  kovası yoktur ve `batch_worker` `exams` kovasına yazamaz; PDF yüklenmez, metin parçaları veritabanındadır.
* **`render --fixtures <dizin>`**: ortak `--fixtures` bayrağı bu komutta şekil kaynaklarının dizinidir (dizinde
  `figures/` alt dizini varsa o kullanılır); `render --queue` ile `JsonlDb` fixture dizinidir.
* **`pdf --out deneme.pdf`** dosya adıdır (diğer komutlarda `--out` dizindir); `.tex` aynı adla yazılır.
* **PDF şablonu `pipelines/tablet/templates/exam.tex.j2`** paket kaynağının iki üstünden okunur (§2 editable kurulum).

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
| `OGR-GEN-001` | `generate --skill`: bilinmeyen ya da yaprak olmayan kazanım. |
| `OGR-GEN-002` | Aktif müfredat yok. |
| `OGR-GEN-003` | `--dump-keys` gerçek veritabanıyla (anahtar dosyaya yazılmaz). |
| `OGR-GEN-004` | 2 deneme kuralıyla incelemeye alınacak soru, anahtarı kaydedilememiş aynı içerikli bir taslakla çakışıyor (`batch_worker` taslağın durumunu değiştiremez); hedef `error`. |
| `OGR-LLM-001/002` | `CostLedger`: zincirde başarılı sağlayıcı yok / tavan engeli (hedef `failed` ya da `cap_blocked`). |
| `OGR-VER-001/002` | `verify`: zarf okunamadı / soru yok. |
| `OGR-PDF-001` | Test bulunamadı ya da basılacak onaylı soru yok. |
| `OGR-PDF-002` | `--with-keys` eğitmen oturumu olmadan (`OGRENMEN_STAFF_JWT`) ya da anahtar alınamadı. |
| `OGR-PDF-003` | `--require-pdf` ama tectonic yok ya da derleme düştü. |
| `OGR-LIB-001/002` | `notes ingest`: PDF yok/okunamadı / müfredat bulunamadı. |
| `OGR-KEY-*` | `register_answer_key` RPC hataları aynen taşınır. |

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

LLM yolu (`tests/scripted.py`: istemdeki hedef kazanıma göre geçerli zarf kuran senaryolu LLM sahtesi; vision
yanıtı sırayla `match`/`mismatch`; diğer amaçlar `FakeLLM`):

* `tests/test_sandbox.py` — `test_sandbox_blocks_network_and_fs` (`net.py` AST reddi ve hiç çalışmaz; `os`, `open`,
  `__import__`, dunder, `matplotlib.os`/`np.os`/`.subprocess`/`.ctypeslib`/`.sys` zinciri, mutlak yol, `..` reddi;
  AST'den kaçırılmış kod bile süreç düzeyinde ağa çıkamaz, `/etc`'yi okuyamaz, çalışma dizini dışına yazamaz,
  `os.system` çalıştıramaz; AST'yi geçen `chr` ile kurulmuş yol, `os.rename`/`os.replace` ile dışarı taşıma,
  `os.open` + `os.write` + `os.replace`, `dir_fd`'li `os.open` ve `opener`, runner genel adlarını değiştirme
  denemelerinin hepsi düşer ve hedef dosya oluşmaz; `unshare -n` varsa ad alanında soket bağlantısı da düşer),
  `test_svg_size_checked_before_conversion` (20000×20000 SVG dönüştürücüye gitmeden hızla `size_mismatch`; yüzde ve
  `viewBox` boyutları; stilde `@import` reddi; `cairosvg` runner sürecinde), `test_size_sanity` (boyut, `expected_px` kesişimi, bayt alt/üst sınırı, bozuk PNG),
  `test_blank_image_rejected` (`blank.py` → `blank`, `render_status='failed'`, vision `skipped`),
  `test_good_figure_renders_inside_bounds` (deterministik PNG), `test_svg_engine` (`bad.svg` bozuk XML, `script` ve
  dış `href` reddi, dönüştürücü yoksa SKIP), `test_missing_engine_is_skipped`, `test_render_fixtures_report`.
* `tests/test_verify.py` — `test_sympy_rejects_wrong_key` (`llm-question-bad-sympy.json`: SymPy B buluyor, anahtar D
  → `failed`; LLM'in "verified" beyanı ezilir), SymPy kural tablosu (birden çok eşleşen şık, eşleşmeyen değer,
  çözülmemiş değişken, `__import__` enjeksiyonu `eval`'e gitmez, sıfıra bölme, etiketli doğru şık, sözel
  `not_applicable`), `test_numeric_key_requires_canonical_expr`, `test_untrusted_expression_is_bounded`
  (`10**(10**10)` ön denetimde hızla `failed`; ayrı süreç zaman ve bellek sınırı), `test_public_note_hides_key_values`,
  sayısal anahtar, zarf kuralları.
* `tests/test_generate.py` — `test_generate_skips_templated_skills`, `test_generate_reads_requests` (3 açık istek önce;
  `generation_requests.jsonl`'de `served_question_id` dolu; istemde `ocr_text` yok, `exam_variant` konusu ve puanı
  var; sonra < 30 stoklu yapraklar artan stokla; toplam 10), `test_two_retries_then_review_queue` (iki SymPy düşüşü
  → `pending_review`, not `verification.review_note`'ta, `register_answer_key` çağrılmaz; ikinci deneme düzeltirse
  tek soru), `test_figure_mismatch_twice_goes_to_review`, `test_discarded_attempts_keep_request_open`,
  `test_item_json_has_no_key_field` (kabul komutunun aynısı + `--dump-keys` yalnız dry-run),
  `test_pool_sufficient_skips_generation` (≥ 30 onaylı stok → LLM ve `check_spend` çağrısı yok),
  `test_cap_blocked_makes_no_llm_call`, `test_batch_mode_uses_batch_pricing`, `test_library_chunks_enter_prompt`,
  `test_two_sympy_failures_leak_no_key_value` (şık harfi ve değer yalnız istemde; `questions`/rapor notlarında yok),
  `test_key_rpc_failure_leaves_retryable_draft`, `test_pool_sufficient_requests_reported_open`. İstemde sınav
  arşivinin gerçek `exam_items.ocr_text` değerlerinin geçmediği de denetlenir.
* `tests/test_queues.py` — `render --queue`, `vision --queue` ("kodu düzelt" ile yeni şekil satırı ve
  `questions.figure_id`, `superseded_figure_id`), eski şeklin kuyruk sayımına girmemesi, onaylı soruda düzeltme
  istenmemesi (`test_vision_queue_leaves_approved_question_alone`), ikinci uyuşmazlıkta kuyruk notu, bildirimde
  2 deneme notu ile diğer notların ayrımı, `verify` komutu, `review-queue --push` metin kuralları,
  gerçek kipte `render --queue`'nun model anahtarı istemediği (`httpx.MockTransport`).
* `tests/test_pdf.py` — madde JSON'undan `.tex` (şekil dosyası, etiketsiz şıklar, anahtar yok), teşhis testinden 20
  soru ve LaTeX kaçışı, `test_latex_square_root` (`√3` → `\sqrt{3}`, boş kök yok), `--with-keys` eğitmen oturumu olmadan reddi ve `peek_answer_key` taklidiyle anahtar sayfası,
  `test_pdf_requires_tectonic` (tectonic yoksa `--require-pdf` → `OGR-PDF-003` doğrulanır ve test SKIP).
* `tests/test_library.py` — parçalama bütçesi, `notes ingest` (belge + 768 boyutlu parçalar, tek embedding defter
  satırı), PII temizliği, tekrar alım `exists`, parçasız belgenin onarımı (`repaired`), arama.
* `tests/test_live_generate.py` (canlı; `tests/psqldb.py` her deyimi `SET LOCAL ROLE batch_worker` + JWT rol
  iddiasıyla `psql`'den geçirir): gerçek şemada `generate` → soru `pending_review`, `secure.answer_keys`
  `verified`/`batch_worker:tablet`, şekil `rendered/match/pending`, istek `served_question_id`, `llm_calls` ve
  `RPC:register_answer_key` audit satırı; iki SymPy düşüşünde anahtarsız `pending_review`; `batch_worker`'ın
  `review_note` ve doğrulanmış şekil yazamadığı; `notes ingest` ve `halfvec(768)` parçalarla arama.

`tests/test_live_db.py` yalnız `OGRENMEN_DATABASE_URL` tanımlıysa koşar (yoksa SKIP): bağlanılan veritabanına
dokunmadan geçici bir veritabanı (`ogrenmen_tablet_live_<pid>`) açar, `supabase/scripts/db-test.sh`'in hazırlık
adımlarını uygular (`tests/00_local_stub.sql` süper kullanıcıyla; migration'lar, `seed/*.sql` ve
`export-sql.py` müfredat seed'i `ogrenmen_owner` rolüyle), her şablondan 3 varyantın `p_item/p_key/p_figure`
yükünü `psql` ile `batch_worker` rolünde gerçek `register_template_question`'a verir ve `questions.status='approved'`,
`secure.answer_keys.sympy_status='verified'`, şekil `verified` olduğunu doğrular; `batch_worker`'ın `approved`
soruyu, anahtarı ve doğrulanmış şekli doğrudan yazamadığını sınar; sonunda veritabanını siler.

## Entegrasyon notları (M02 / M11 / M13 için)

* **Eksik SQL yok** — LLM yolunun tüm yazımları mevcut yetki matrisiyle çalışır (`tests/test_live_generate.py`):
  `questions`/`figures` INSERT (inceleme sütunları hariç), `figures` render/vision UPDATE, `questions.verification`/
  `figure_id` UPDATE, `generation_requests (served_question_id, served_at)` UPDATE, `library_documents`/
  `library_chunks` INSERT, `llm_calls` INSERT, `check_spend` ve `register_answer_key` RPC'leri.
* **Önerilen SQL değişikliği (M02):** `0013_views.sql` `v_review_queue` soru satırında
  `coalesce(q.review_note, q.verification->>'review_note', 'Soru incelemesi (' || q.source || ')') as reason` —
  Tablet'in "2 başarısız deneme" notu panel kuyruğunda görünsün. Aynı görünümün şekil satırları yalnız bir soruya
  bağlı (`exists (select 1 from questions q where q.figure_id = f.id)`) bekleyen şekilleri saymalı: `vision --queue`
  düzeltmesinden kalan eski şekil `review_status='pending'` ile yetim kalır (M11 de `superseded_figure_id`'yi süzer).
* **İsteğe bağlı (M02):** ders notu PDF'leri için ayrı bir Storage kovası (ör. `library`, yalnız `batch_worker`
  insert) yoksa `storage_path` mantıksal kalır; parça araması büyürse
  `search_library_chunks(p_curriculum uuid, p_query text, p_embedding halfvec(768), p_k int)` RPC'si Python
  sıralamasının yerini alabilir.
* **`scripts/check-all.sh` (M13) Tablet adımları:** yukarıdaki "Kurulum ve kabul" bölümündeki beş komut (sırasıyla
  kurulum + ruff + pytest; `generate --skill … --dry-run` + `cost_estimate.json` + `correct_option` yok; `template --id
  kesir-modeli-toplama`; `template --fill --min-stock 30 --dry-run` + `register_template_question` + `"source": "llm"`
  yok; `OGRENMEN_DATABASE_URL=… pytest -k live`). İsteğe bağlı ek: `python -m ogrenmen_tablet render --fixtures
  /home/user/alperen/fixtures/tablet --out /tmp/tablet-render` (rapor: good=ok, blank=blank, net=rejected,
  bad.svg=failed).
* **Gece akışı (`nightly.yml`):** `tablet template --fill --min-stock 30` → `tablet generate --batch` → `tablet render
  --queue` → `tablet vision --queue`; haftalık/elle `tablet review-queue --push`.

