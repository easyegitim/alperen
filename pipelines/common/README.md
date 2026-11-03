# pipelines/common — `ogrenmen_common` (M05)

Öğrenmen'in Python toplu işlerinin (Tablet, Kulaklık, Ders, Kalem, Kitap) ortak tabanı: adaptör
sözleşmeleri, gerçek adaptörler, deterministik sahteler, `JsonlDb`, `CostLedger`, Gemini Batch
sarmalayıcısı, PII sarmalayıcısı, `Runtime` ve ortak CLI bayrakları (BLUEPRINT §2.8, §6). Hiçbir
hesap ya da anahtar olmadan çalışır ve sınanır; testler ağa çıkmaz.

## Kurulum ve kabul

```
python -m pip install -e /home/user/alperen/packages/contracts/python -e /home/user/alperen/packages/mastery-math/python -e /home/user/alperen/packages/pii/py -e /home/user/alperen/pipelines/common[dev] && ruff check /home/user/alperen/pipelines/common && python -m pytest /home/user/alperen/pipelines/common -q
OGRENMEN_FAKES=1 python -m ogrenmen_common.selftest
python -c "from ogrenmen_common.runtime import Runtime;r=Runtime.from_env(dry_run=True);assert r.llm.__class__.__name__=='FakeLLM'"
```

Bağımlılıklar sabit sürümlüdür (§6 ağacındaki `httpx`, `jsonschema`, `numpy`, `typer`, `rich`; arXiv Atom
yanıtını güvenli ayrıştırmak için `defusedxml`; geliştirme için `pytest`, `ruff`) ve
yerel paketler (`ogrenmen-contracts`, `ogrenmen-mastery`, `ogrenmen-pii`) aynı `pip` komutunda `-e` ile
kurulur. `psycopg` yoktur: veritabanına PostgREST üzerinden `batch_worker` JWT'siyle bağlanılır.

## Ağaç

```
src/ogrenmen_common/
├── adapters/base.py        Protocol'ler: LLM, Embedding, Vision, Transcriber, OCR, Scholar, DOIResolver, OAResolver, DB, Storage, Notifier
├── adapters/gemini.py      GeminiLLM (metin/görüntü/ses), GeminiEmbedding (768), GeminiBatchClient
├── adapters/groq.py        GroqLLM (sohbet + Whisper /audio/transcriptions)   openrouter.py  cfai.py  anthropic.py
├── adapters/openai_compat.py  json_schema → json_object düşüşlü OpenAI uyumlu istemci
├── adapters/router.py      ProviderRouter: models.json sağlayıcısına göre yönlendirme, available(model)
├── adapters/media.py       LLMVision, LLMOCR, LLMTranscriber (CostLedger üzerinden; Whisper → diarize pencereleri)
├── adapters/openalex.py  semanticscholar.py  arxiv.py  crossref.py  unpaywall.py
├── adapters/postgrest.py   PostgrestDb (messages sütun listesinde text_raw YOK; insert/update returning=minimal|representation)
├── adapters/storage.py     SupabaseStorage      notify.py  LogNotifier, format_notice
├── fakes/                  FakeLLM, FakeEmbedding, FakeVision, FakeTranscriber, FakeOCR, FakeScholar, FakeArxiv,
│                           FakeCrossref, FakeUnpaywall, JsonlDb (+ jsonl_rpc.py), LocalDirStorage, FakeNotifier,
│                           rpc-names.json
├── ledger.py               CostLedger, LedgeredEmbedding        batch.py   BatchRunner
├── grants.py               supabase/tests/grants_matrix.json okuyucusu (çalışma anında; JsonlDb sütun yetkileri)
├── ids.py                  STUDENT_REF (s_… biçimi; tek kaynak)   clock.py  saat, ISO, hms_seconds
├── pii.py                  scrub_for_llm, label_transcript, name_leaks
├── runtime.py              Runtime.from_env(dry_run)
├── cli_base.py             --dry-run --fixtures --out --limit --since --student-ref --adapters fake|real
├── purposes.py             fixtures/llm klasörü → sözleşme eşlemesi
└── selftest.py             python -m ogrenmen_common.selftest
tests/                      sözleşme, sahte, RPC, ledger, batch, gerçek adaptör (httpx.MockTransport) testleri
tests/stubs/providers-select.ts   Worker sahte sağlayıcı seçim kuralının TS ikamesi (parite testi)
```

## Pipelines bunu nasıl kullanır

```python
from ogrenmen_common import cli_base
from ogrenmen_common.adapters.base import LLMRequest

parser = cli_base.build_parser("ogrenmen_kulaklik", "Kulaklık gece işleri")
sub = parser.add_subparsers(dest="command", required=True)
facts = cli_base.add_command(sub, "facts", "Gece olgu çıkarımı")
facts.add_argument("--day", required=True)
args = parser.parse_args()
with cli_base.open_runtime(args) as rt:              # çıkışta out/*.jsonl + cost_estimate.json yazılır
    rows = rt.db.select("messages", where={"chat_id": 700000001})      # text_raw hiçbir zaman gelmez
    req = LLMRequest(purpose="nightly_facts", model="", prompt=..., schema_id="nightly-facts-output")
    result = rt.ledger.call("nightly_facts", req, student_ref="s_qk7m2rx4tn5a", ref_table="messages")
    out = rt.batch.run("nightly_facts", items)       # sahte yol anında 'done'; gerçek yol gecikirse 'deferred'
```

* **Her model çağrısı `CostLedger.call`'dan geçer** (§6 kural 2): `check_spend` kapısı (ücretli sağlayıcı
  yalnız `paid_allowed` iken; değilse `cap_blocked`), `models.json` zinciri, 429/5xx/zaman aşımı/yapılandırma
  düşüşü (sağlayıcı bekleme süresi `cooldown_skip`; 401/403'te kurucuya bildirim), şema doğrulaması ve tek
  onarım, her deneme bir `llm_calls` satırı — gövde yalnız `batch_worker`'ın INSERT yetkisindeki sütunlar
  (`LLM_CALLS_INSERT_COLUMNS`; `id`/`created_at` DB varsayılanı), `Prefer: return=minimal` ile. Ders amaçları (`lesson_analysis`, `transcribe`, `diarize`)
  `check_spend`'in ayrı ders bütçesine bağlıdır; sohbet/toplu tavanını doldurmaz ve ondan etkilenmez.
* `student_ref` yalnız `s_…` olabilir; uuid ya da ad verilirse `CostLedger` reddeder (§6 kural 1).
* **Degraded kip** (`check_spend` `degraded=true` / `state='degraded'`, yani `degraded_mode=true`; §5.6 "LLM yok",
  kurucunun kill-switch'i): tavanın altında olunsa da **hiçbir** model (ücretli, ücretsiz, ders amaçları dahil —
  istisna yok) çağrılmaz; tek `cap_blocked` denemesi (`error_code='degraded'`) yazılır, `OGR-LLM-002` yükselir.
  `BatchRunner` aynı durumda `status='blocked'` döner ve modele/Batch API'ye gitmez.
* **Embedding de defterden geçer**: `rt.embedding` bir `LedgeredEmbedding`'dir — her `embed` çağrısı önce
  `check_spend('embedding')` (degraded/tavan), sonra bir `llm_calls` satırı (`purpose='embedding'`,
  `models.json` `chains.embedding[0]` modeli ve sağlayıcısı). Model adı ve boyut koda yazılmaz (§4.9);
  `GeminiEmbedding` bunları `Runtime`'dan alır.
* `rt.ledger.write_estimate(out)` dry-run'da `cost_estimate.json` yazar (`total_usd`, ders hariç
  `chat_batch_usd`, `lesson_usd`, amaç/model/durum kırılımları).

## Runtime kipleri

| Koşul | Sonuç |
| --- | --- |
| `OGRENMEN_FAKES=1`, `dry_run=True` ya da `adapters="fake"` | tamamen sahte, ağ yok; saat `OGRENMEN_NOW` ya da fixture "şimdi"si `2026-10-20T09:00:00Z` |
| gerçek kip, veritabanı + model anahtarları var | `PostgrestDb`, `SupabaseStorage`, `ProviderRouter` (anahtarı olan sağlayıcılar), `LedgeredEmbedding(GeminiEmbedding)` (`GEMINI_PAID_KEY`), OpenAlex/S2/arXiv, Crossref, Unpaywall, `LogNotifier` (stderr), `GeminiBatchClient` |
| gerçek kip, ne veritabanı ne model anahtarı | her şey sahte (`mode='mixed'`), `warnings` + stderr'de Türkçe uyarı |
| gerçek veritabanı var, hiçbir model anahtarı yok | **kurulmaz** — `AdapterError` `OGR-ADP-001 gerçek veritabanıyla sahte model kullanılmaz` (fixture çıktıları ve sahte maliyet satırları üretim tablolarına yazılmaz) |
| model anahtarı var, `SUPABASE_URL`/`SUPABASE_BATCH_JWT` yok | **kurulmaz** — `AdapterError` (ücretli çağrı gerçek defter ve `check_spend` tavanı olmadan yapılmaz; ilke 2 ve 3) |
| gerçek veritabanı var, `GEMINI_PAID_KEY` yok | embedding `embed` çağrısında `OGR-ADP-001` ile reddedilir (sahte vektör yazılmaz); `GEMINI_FREE_KEY` embedding için **hiç** kullanılmaz (ücretsiz katman veriyle eğitir, §9.1) |
| diğer eksik anahtarlar (Unpaywall) | o adaptör sahteye düşer, `warnings` + stderr'de Türkçe uyarı (sessiz düşüş yok) |

`cli_base.runtime_from_args`: gerçek çalışma istenip `SUPABASE_URL` ya da `SUPABASE_BATCH_JWT` yoksa iş
`--dry-run` olarak koşar ve başarılı sayılır; GitHub Actions'ta `::warning::` satırı yazar (§2.9).

Depolama: `out` verilmezse her `Runtime` kendi geçici dizinini (`ogrenmen-storage-*`) kullanır, `close()`
(ya da nesne toplanınca) siler; ardışık sahte çalışmalar birbirinin nesnesini görmez.

## Sahteler

**FakeLLM seçim kuralı (§2.3; Worker `apps/worker/test/fakes/providers.ts` ile birebir):** klasördeki
`*.json` dosyaları ada göre sıralanır, `bad-schema*.json` dışarıda bırakılır,
`i = int(sha256(prompt_text)[:8], 16) mod n` (`prompt_text` = `system + "\n\n" + prompt`, sistem boş olsa da —
Worker `promptTextOf` (`${system}\n\n${messages}`) ile aynı kurgu; UTF-8).
`fail_with={429: [0], 500: [2], "timeout": [3]}` çağrı sırasına göre hata, `fail_models` modele göre hata,
`bad_output_every` / `bad_output_at` `bad-schema.json` döndürür. `fixture_hint` (ses/PDF adı, ör.
`lesson-01`, `exam-2022`) adı bu parçayı içeren dosyayı seçer; eşleşme yoksa kural uygulanır — bu yalnız
pipelines'a özgü bir kolaylıktır, Worker kuralını değiştirmez. Parite testleri: M01'in başvuru
uygulaması (`fixtures/scripts/select_llm.py`) tüm klasörlerde, TS ikamesi (`tests/stubs/providers-select.ts`,
Web Crypto ile, `bun` altında) `fixtures/llm/chat` üzerinde; M04'ün `apps/worker/test/fakes/providers.ts`'i
varsa onun `selectFixture(fixtures, purpose, promptText)` ve `promptTextOf` fonksiyonları `bun` ile çağrılır:
aynı 47 metin için aynı dosya, ve aynı (sistem='', istem) çiftini iki taraf kendi kurucusuyla birleştirdiğinde
aynı metin ve aynı dosya (salt okunur). Test yalnız `providers.ts` ya da `bun` yoksa atlanır; ikisi varken
yükleme hatası parite hatası sayılır.

**JsonlDb** (`batch_worker` görünümünün sahtesi):

* Taban dünya `fixtures/db/dev-seed.json`. `JsonlDb.from_fixtures(<dizin>)` o dizindeki tablo dosyalarını
  okur ve **dizindeki tablo tabandakinin yerine geçer**. Eşleme: `messages-day.json → messages`,
  `bot-responses-week.json → bot_responses`, `llm-calls-month.json → llm_calls`,
  `spend-ledger-month.json → spend_ledger`, `memory-facts.json → memory_facts`,
  `questions-review.json → questions`, `chats.json → tg_chats`, `requests.json → research_requests`,
  `labels.json → lesson_labels`; diğerlerinde ad (`-` → `_`) tablo adıysa o tablo (`exam_sources.json`,
  `generation_requests.json`, `students.json` …); çok tablolu dosyalar (`lesson-morale.json`) anahtar başına;
  sözleşme örnekleri (`facts-day.json`, `ocr-2022.json`) atlanır. Aynı tabloya düşen dosyalar birincil anahtara
  göre birleşir; birincil anahtarı olmayan satırların (ör. kimliği DB'nin vereceği `llm_calls`) hepsi korunur.
  `base=False` tabanı kapatır.
* `insert(..., on_conflict="merge")` PostgREST `merge-duplicates` gibidir: çakışan satırda yalnız gönderilen
  sütunlar güncellenir, varsayılanlar yalnız gerçek eklemede uygulanır.
* Yetki taklidi: `secure.*` ve `audit.events` okunamaz; `messages.text_raw` hiçbir zaman dönmez ve `out/`'a
  yazılmaz; yazımlar §3.8 W sütununa uyar (ör. `observations`, `messages` eklemesi, `questions.status`,
  `figures.review_status`, `exam_priority_plans.status` → `DbPermissionError` ya da `OGR-Q-001/004`;
  `exam_items`/`exam_clusters` silinemez; `generation_requests` yalnız `kind='exam_variant'` eklenir ve yalnız
  `served_question_id, served_at` güncellenir). Anahtar RPC'leri (`register_answer_key`,
  `register_template_question`) SQL'deki gibi **yalnız** `batch_worker` rolüyle çalışır (`postgres` da `OGR-KEY-001`).
  Test kurulumunda `db.role = "postgres"` ya da `db.seed(...)` kısıtları atlar.
* **Sütun yetkileri** (§12 #57): doğrudan yazımlar ayrıca `supabase/tests/grants_matrix.json`'daki rol yetkisine
  uyar — dosya **çalışma anında** okunur (`ogrenmen_common.grants`; yoksa/bozuksa `OGR-DB-004`). Yazılan sütunlar
  INSERT/UPDATE yetkisinde olmalı (ör. `llm_calls.created_at`, `instructor_alerts.id`, `questions.review_note`
  eklenemez); `on_conflict="merge"` ayrıca UPDATE yetkisi ve çakışma sütunlarında SELECT, `where` sütunları SELECT,
  `returning="representation"` (`RETURNING *`) tablo düzeyi SELECT ister (ör. `messages`, `proactive_messages`'ta
  yoktur). İhlal → `DbPermissionError` `OGR-DB-001 permission denied for column … of relation …`. Geçmiş
  `created_at`'li kurulum satırları `as_admin`/`db.role = "postgres"` ya da `db.seed(...)` ile yazılır.
* **`returning`** (`PostgrestDb` ve `JsonlDb` aynı): `"minimal"` → `Prefer: return=minimal`, `[]` döner;
  `"representation"` → satırlar. Varsayılan: tek satır (`Mapping`) eklemesi `representation`, satır dizisi eklemesi
  ve her `update` `minimal` (toplu yazım). `adapters.base.insert_minimal` / `update_minimal` yardımcıları
  `returning` almayan DB'lerde de (testlerin yetki taklitleri) minimal yazar.
* Tetikleyiciler: `llm_calls` → `spend_ledger` (Europe/Istanbul günü), `messages.expires_at`,
  `questions_check_skills` (`OGR-CURR-001`).
* Çıktı (`flush()` / `Runtime.close()`): yalnız bu çalışmada yazılan satırlar son hâliyle `out/<tablo>.jsonl`;
  RPC çağrıları `out/rpc_calls.jsonl` (`register_answer_key` / `register_template_question` `p_key` değeri
  gizlenir — anahtar dosyaya yazılmaz); silmeler `out/deletions.jsonl`; `secure.*` hiçbir dosyaya yazılmaz.
  `db.write_log` her yazımın kaynağını (`direct`, `rpc:<ad>`, `trigger:spend_rollup`) tutar.
* Kimlikler deterministiktir: identity tablolarında `max(id)+1`, uuid'li tablolarda
  `uuid5(NAMESPACE_OGRENMEN, "jsonldb:<tablo>:<sıra>")`.

**RPC eşlenikleri** (`fakes/rpc-names.json`; M13 `scripts/check-rpc-parity.sh` bu listeyi migration'lardaki
`create function` adlarıyla eşler): `anonymize_students`, `cap_memory_facts`, `check_spend`,
`compute_table_sizes`, `confirm_video_deleted`, `cron_idle_sessions`, `cron_open_alerts`, `profile_for_prompt`,
`recompute_is_minor`, `register_answer_key`, `register_lesson`, `register_template_question`,
`resolve_lesson_labels`, `rollup_spend`, `run_retention`, `set_runtime_flag`, `write_lesson_analysis`.
Hepsi §3.9'da `batch_worker`'a açılan fonksiyonlardır; gövdeler SQL'deki hata kodlarını ve yan etkileri
izler (ör. `register_answer_key` kilitleri `OGR-KEY-001…004`, `not_applicable` → sayısal soruda `failed`;
`register_template_question` `OGR-TPL-001…005` + `OGR-Q-001/002` ve yarım yazım bırakmaz;
`write_lesson_analysis` `observations` yazmaz, tek `talk` iddiası ve tekilleşen "Ders raporu onay bekliyor"
alarmı; `run_retention` dört kip + beş `app.retention_*` işleyicisi; `compute_table_sizes`
`db.size_overrides` ile 450 MB'ı aşınca `storage_pressure` ve `tg_chats.retention_days = 60`).
Dönüş biçimi PostgREST'inkiyle aynıdır (`check_spend` tek satırlık liste). `cron_open_alerts` yalnız
parite için kayıtlıdır ve `OGR-RPC-002` fırlatır: dry-run'da `ogrenmen_kulaklik.alerts.open_alerts`
Python eşleniği (`via_rpc=False`) çalışır.

Diğer sahteler: `FakeEmbedding` (sha256 → 768 birim vektör), `FakeVision` (`verdicts` ile zorlanabilir),
`FakeOCR`, `FakeTranscriber`, `FakeScholar` (OpenAlex/S2) ve `FakeArxiv` (`fixtures/kitap`, gerçek
adaptörlerin normalize fonksiyonlarıyla), `FakeCrossref` (`10.9999/fake` → `None`), `FakeUnpaywall`,
`LocalDirStorage` (`aliases` ile `exams/<uuid>.pdf` → `fixtures/kalem/exam-2022.pdf`), `FakeNotifier`.

## Hata kodları

RPC hataları veritabanı mesajını aynen taşır (`OGR-KEY-003 …`); `error.code` ilk parçadır. Bu modüle
özgü kodlar: `OGR-RPC-001` (bilinmeyen RPC/parametre), `OGR-RPC-002` (JsonlDb'de bilerek çalıştırılmayan RPC), `OGR-DB-001` (yetki), `OGR-DB-002` (tablo, sütun,
çakışma), `OGR-DB-003` (PostgREST/ağ), `OGR-LLM-001` (zincirde başarılı sağlayıcı yok), `OGR-LLM-002`
(tavan engeli), `OGR-LLM-003` (bilinmeyen amaç/zincir/model), `OGR-ADP-001` (adaptör yapılandırması),
`OGR-ADP-002` (fixture yok), `OGR-STO-001` (depolama), `OGR-DB-004` (yetki matrisi okunamadı).

Canlı yetki testi: `OGRENMEN_DATABASE_URL` tanımlıysa `tests/test_grants.py` geçici bir veritabanına
(`ogrenmen_m05_grants_*`, sonunda silinir) `00_local_stub.sql` + tüm migration'ları uygular ve `SET ROLE batch_worker`
ile `CostLedger`'ın gövdesini PostgREST'in kurduğu INSERT/UPDATE deyimiyle yazar; yoksa atlanır.

## Sapma notları

1. **CLI kütüphanesi.** §6 ağacındaki `typer` ve `rich` sabit sürümle bağımlılıktır (alt pipeline'lar
   kullanabilir), ama ortak bayraklar `cli_base`'de stdlib `argparse` ile kuruludur (`cli_base.add_command`,
   alt komuttan önce ya da sonra yazılan ortak bayrakların ikisi de çalışır). Bayrak adları blueprint'teki
   gibidir; typer kullanan bir modül aynı bayrakları kendisi tanımlar ve `cli_base.CommonArgs` ile
   `cli_base.runtime_from_args`'a verir.
2. **Whisper yedeği.** Groq Whisper konuşmacı ayırmadığından `GroqLLM` etiketsiz bölümler döndürür;
   `LLMTranscriber` bunları `diarize` zinciriyle 2 dakikalık pencerelerde etiketler (§6.3 açıklaması). Ham
   Whisper metni diarize modeline **gitmeden önce** `resolve_lesson_labels` etiketleri / ad hash'leriyle
   temizlenir (`transcribe(audio, labels=..., name_hashes=...)` ya da kurucuda); ikisi de yoksa metin
   gönderilmez (`OGR-LLM-003`). `Transcriber` Protocol'ü bu iki anahtar sözcüklü parametreyi içerir.
3. **Degraded kipte ders amaçları.** §5.6 "LLM yok" kuralı ders amaçlarına (`lesson_analysis`, `transcribe`,
   `diarize`) da uygulanır; ayrı bütçeleri olsa da kill-switch onları da durdurur (istisna tanımlanmadı).
4. **Depo kökü.** Fixture yolları paket konumundan bulunur (düzenlenebilir kurulum); paket depo dışına
   kurulursa `OGRENMEN_REPO_ROOT` verilmelidir.

## Kabul komutu notu

Üç kabul komutu yazıldığı gibi, herhangi bir çalışma dizininden 0 ile çıkar; uyarlama gerekmedi. İlk komut
`typer`, `rich` ve `defusedxml`'i PyPI'dan kurar (sabit sürüm).
