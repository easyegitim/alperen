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

Bağımlılıklar sabit sürümlüdür (`httpx`, `jsonschema`, `numpy`; geliştirme için `pytest`, `ruff`) ve
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
├── adapters/postgrest.py   PostgrestDb (messages sütun listesinde text_raw YOK)
├── adapters/storage.py     SupabaseStorage      telegram_notify.py  TelegramNotifier
├── fakes/                  FakeLLM, FakeEmbedding, FakeVision, FakeTranscriber, FakeOCR, FakeScholar, FakeArxiv,
│                           FakeCrossref, FakeUnpaywall, JsonlDb (+ jsonl_rpc.py), LocalDirStorage, FakeNotifier,
│                           rpc-names.json
├── ledger.py               CostLedger        batch.py   BatchRunner
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
  onarım, her deneme bir `llm_calls` satırı. Ders amaçları (`lesson_analysis`, `transcribe`, `diarize`)
  `check_spend`'in ayrı ders bütçesine bağlıdır; sohbet/toplu tavanını doldurmaz ve ondan etkilenmez.
* `student_ref` yalnız `s_…` olabilir; uuid ya da ad verilirse `CostLedger` reddeder (§6 kural 1).
* `rt.ledger.write_estimate(out)` dry-run'da `cost_estimate.json` yazar (`total_usd`, ders hariç
  `chat_batch_usd`, `lesson_usd`, amaç/model/durum kırılımları).

## Runtime kipleri

| Koşul | Sonuç |
| --- | --- |
| `OGRENMEN_FAKES=1`, `dry_run=True` ya da `adapters="fake"` | tamamen sahte, ağ yok; saat `OGRENMEN_NOW` ya da fixture "şimdi"si `2026-10-20T09:00:00Z` |
| gerçek kip, anahtar var | `PostgrestDb`, `SupabaseStorage`, `ProviderRouter` (anahtarı olan sağlayıcılar), `GeminiEmbedding`, OpenAlex/S2/arXiv, Crossref, Unpaywall, `TelegramNotifier`, `GeminiBatchClient` |
| gerçek kip, anahtar eksik | eksik adaptör sahteye düşer, `warnings` + stderr'de Türkçe uyarı (sessiz düşüş yok) |

`cli_base.runtime_from_args`: gerçek çalışma istenip `SUPABASE_BATCH_JWT` yoksa iş `--dry-run` olarak
koşar ve başarılı sayılır; GitHub Actions'ta `::warning::` satırı yazar (§2.9).

## Sahteler

**FakeLLM seçim kuralı (§2.3; Worker `apps/worker/test/fakes/providers.ts` ile birebir):** klasördeki
`*.json` dosyaları ada göre sıralanır, `bad-schema*.json` dışarıda bırakılır,
`i = int(sha256(prompt_text)[:8], 16) mod n` (`prompt_text` = `system + "\n\n" + prompt`, UTF-8).
`fail_with={429: [0], 500: [2], "timeout": [3]}` çağrı sırasına göre hata, `fail_models` modele göre hata,
`bad_output_every` / `bad_output_at` `bad-schema.json` döndürür. `fixture_hint` (ses/PDF adı, ör.
`lesson-01`, `exam-2022`) adı bu parçayı içeren dosyayı seçer; eşleşme yoksa kural uygulanır — bu yalnız
pipelines'a özgü bir kolaylıktır, Worker kuralını değiştirmez. Parite testleri: M01'in başvuru
uygulaması (`fixtures/scripts/select_llm.py`) tüm klasörlerde, TS ikamesi (`tests/stubs/providers-select.ts`,
Web Crypto ile, `bun` altında) `fixtures/llm/chat` üzerinde; M04'ün `apps/worker/test/fakes/providers.ts`'i
varsa onun `selectFixture(fixtures, purpose, promptText)` fonksiyonu `bun` ile çağrılır ve aynı 47 istem için
aynı dosyayı seçtiği doğrulanır (salt okunur; dosya ya da bağımlılıkları yoksa test atlanır).

**JsonlDb** (`batch_worker` görünümünün sahtesi):

* Taban dünya `fixtures/db/dev-seed.json`. `JsonlDb.from_fixtures(<dizin>)` o dizindeki tablo dosyalarını
  okur ve **dizindeki tablo tabandakinin yerine geçer**. Eşleme: `messages-day.json → messages`,
  `bot-responses-week.json → bot_responses`, `llm-calls-month.json → llm_calls`,
  `spend-ledger-month.json → spend_ledger`, `memory-facts.json → memory_facts`,
  `questions-review.json → questions`, `chats.json → tg_chats`, `requests.json → research_requests`,
  `labels.json → lesson_labels`; diğerlerinde ad (`-` → `_`) tablo adıysa o tablo (`exam_sources.json`,
  `generation_requests.json`, `students.json` …); çok tablolu dosyalar (`lesson-morale.json`) anahtar başına;
  sözleşme örnekleri (`facts-day.json`, `ocr-2022.json`) atlanır. Aynı tabloya düşen dosyalar birincil anahtara
  göre birleşir. `base=False` tabanı kapatır.
* Yetki taklidi: `secure.*` ve `audit.events` okunamaz; `messages.text_raw` hiçbir zaman dönmez ve `out/`'a
  yazılmaz; yazımlar §3.8 W sütununa uyar (ör. `observations`, `messages` eklemesi, `questions.status`,
  `figures.review_status`, `exam_priority_plans.status` → `DbPermissionError` ya da `OGR-Q-001/004`).
  Test kurulumunda `db.role = "postgres"` ya da `db.seed(...)` kısıtları atlar.
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
`compute_table_sizes`, `confirm_video_deleted`, `cron_idle_sessions`, `profile_for_prompt`,
`recompute_is_minor`, `register_answer_key`, `register_lesson`, `register_template_question`,
`resolve_lesson_labels`, `rollup_spend`, `run_retention`, `set_runtime_flag`, `write_lesson_analysis`.
Hepsi §3.9'da `batch_worker`'a açılan fonksiyonlardır; gövdeler SQL'deki hata kodlarını ve yan etkileri
izler (ör. `register_answer_key` kilitleri `OGR-KEY-001…004`, `not_applicable` → sayısal soruda `failed`;
`register_template_question` `OGR-TPL-001…005` + `OGR-Q-001/002` ve yarım yazım bırakmaz;
`write_lesson_analysis` `observations` yazmaz, tek `talk` iddiası ve tekilleşen "Ders raporu onay bekliyor"
alarmı; `run_retention` dört kip + beş `app.retention_*` işleyicisi; `compute_table_sizes`
`db.size_overrides` ile 450 MB'ı aşınca `storage_pressure` ve `tg_chats.retention_days = 60`).
Dönüş biçimi PostgREST'inkiyle aynıdır (`check_spend` tek satırlık liste).

Diğer sahteler: `FakeEmbedding` (sha256 → 768 birim vektör), `FakeVision` (`verdicts` ile zorlanabilir),
`FakeOCR`, `FakeTranscriber`, `FakeScholar` (OpenAlex/S2) ve `FakeArxiv` (`fixtures/kitap`, gerçek
adaptörlerin normalize fonksiyonlarıyla), `FakeCrossref` (`10.9999/fake` → `None`), `FakeUnpaywall`,
`LocalDirStorage` (`aliases` ile `exams/<uuid>.pdf` → `fixtures/kalem/exam-2022.pdf`), `FakeNotifier`.

## Hata kodları

RPC hataları veritabanı mesajını aynen taşır (`OGR-KEY-003 …`); `error.code` ilk parçadır. Bu modüle
özgü kodlar: `OGR-RPC-001` (bilinmeyen RPC/parametre), `OGR-DB-001` (yetki), `OGR-DB-002` (tablo, sütun,
çakışma), `OGR-DB-003` (PostgREST/ağ), `OGR-LLM-001` (zincirde başarılı sağlayıcı yok), `OGR-LLM-002`
(tavan engeli), `OGR-LLM-003` (bilinmeyen amaç/zincir/model), `OGR-ADP-001` (adaptör yapılandırması),
`OGR-ADP-002` (fixture yok), `OGR-STO-001` (depolama).

## Sapma notları

1. **CLI kütüphanesi.** §6 ağacı bağımlılıklarda `typer` ve `rich` sayar; ortak bayraklar alt komutlarla
   birlikte stdlib `argparse` ile daha sade ve bağımlılıksız kuruldu (`cli_base.add_command`, alt komuttan
   önce ya da sonra yazılan ortak bayrakların ikisi de çalışır). Bayrak adları blueprint'teki gibidir.
2. **`resolve_lesson_labels` ``VELİ`` etiketi.** Blueprint öğrenci ve eğitmen hash'lerini ister; eşlenik
   ayrıca velinin ad tokenlarını `VELİ` olarak döndürür (`ogrenmen_pii` bu rolü destekler), böylece
   transkriptte geçen veli adı da temizlenir.
3. **Whisper yedeği.** Groq Whisper konuşmacı ayırmadığından `GroqLLM` etiketsiz bölümler döndürür;
   `LLMTranscriber` bunları `diarize` zinciriyle 2 dakikalık pencerelerde etiketler (§6.3 açıklaması).
4. **Depo kökü.** Fixture yolları paket konumundan bulunur (düzenlenebilir kurulum); paket depo dışına
   kurulursa `OGRENMEN_REPO_ROOT` verilmelidir.

## Kabul komutu notu

Üç kabul komutu yazıldığı gibi, herhangi bir çalışma dizininden 0 ile çıkar; uyarlama gerekmedi.
