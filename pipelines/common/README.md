# pipelines/common — `ogrenmen_common` (M05)

Öğrenmen v2 Python pipeline'larının (`tablet`, `kalem`, `ders`; P3/P5'te `verify`) ortak tabanı: adaptör
sözleşmeleri, deterministik sahteler, `JsonlDb`, `CostLedger`, PII sarmalayıcısı, `Runtime` ve ortak CLI
bayrakları (PLAN-v2 §12). Hiçbir hesap ya da anahtar olmadan çalışır ve sınanır; testler ağa çıkmaz.
Pipeline'lar DB kimliği taşımaz; Claude yalnız `packages/llm`'dedir (worker). Bu paketteki Gemini/Groq-sohbet/
OpenRouter/Cloudflare adaptörleri yalnız eski `tablet`/`kalem` sahte akışları ve testler için durur, `Runtime`
gerçek kipte kurmaz; P3/P5'te kaldırılır.

## Kurulum ve kabul

```
python -m pip install -e /home/user/alperen/packages/contracts/python -e /home/user/alperen/packages/mastery-math/python -e /home/user/alperen/packages/pii/py -e /home/user/alperen/pipelines/common[dev] && ruff check /home/user/alperen/pipelines/common && python -m pytest /home/user/alperen/pipelines/common -q
OGRENMEN_FAKES=1 python -m ogrenmen_common.selftest
python -c "from ogrenmen_common.runtime import Runtime;r=Runtime.from_env(dry_run=True);assert r.llm.__class__.__name__=='FakeLLM'"
```

Bağımlılıklar sabit sürümlüdür (§6 ağacındaki `httpx`, `jsonschema`, `numpy`, `typer`, `rich`; geliştirme için `pytest`, `ruff`) ve
yerel paketler (`ogrenmen-contracts`, `ogrenmen-mastery`, `ogrenmen-pii`) aynı `pip` komutunda `-e` ile
kurulur. `psycopg` yoktur: pipeline'lar v2'de veritabanına doğrudan bağlanmaz (`service_role` yalnız `apps/worker`'dadır, PLAN §12); `Runtime` gerçek kipte DB/depolamayı sahte tutar ve `SUPABASE_BATCH_JWT` verilirse `OGR-ADP-001` ile reddeder.

## Ağaç

```
src/ogrenmen_common/
├── adapters/base.py        Protocol'ler: LLM, Embedding, Vision, Transcriber, OCR, DB, Storage, Notifier
├── adapters/gemini.py      GeminiLLM (metin/görüntü/ses), GeminiEmbedding (768), GeminiBatchClient
├── adapters/groq.py        GroqLLM (Whisper /audio/transcriptions; sohbet eski)   openrouter.py  cfai.py (eski)
├── adapters/openai_compat.py  json_schema → json_object düşüşlü OpenAI uyumlu istemci
├── adapters/router.py      ProviderRouter: models.json sağlayıcısına göre yönlendirme, available(model)
├── adapters/media.py       LLMVision, LLMOCR, LLMTranscriber (CostLedger üzerinden; Whisper → diarize pencereleri)
├── adapters/postgrest.py   PostgrestDb (insert/update returning=minimal|representation)
├── adapters/storage.py     SupabaseStorage      notify.py  LogNotifier, format_notice
├── fakes/                  FakeLLM, FakeEmbedding, FakeVision, FakeTranscriber, FakeOCR,
│                           JsonlDb (+ jsonl_rpc.py), LocalDirStorage, FakeNotifier,
│                           grants-v2.json, rpc-names.json, rpc-names-legacy-v1.json
├── ledger.py               CostLedger, LedgeredEmbedding        batch.py   BatchRunner
├── grants.py               fakes/grants-v2.json okuyucusu (tablo + sütun listesi; scripts/gen_grants_v2.py migration'lardan üretir)
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
    rows = rt.db.select("memory_facts", where={"student_id": "..."})
    req = LLMRequest(purpose="nightly_facts", model="", prompt=..., schema_id="nightly-facts-output")
    result = rt.ledger.call("nightly_facts", req, student_ref="s_qk7m2rx4tn5a", ref_table="memory_facts")
    out = rt.batch.run("nightly_facts", items)       # sahte yol anında 'done'; gerçek yol gecikirse 'deferred'
```

* **Her model çağrısı `CostLedger.call`'dan geçer** (§6 kural 2): `check_spend` kapısı (ücretli sağlayıcı
  yalnız `paid_allowed` iken; değilse `cap_blocked`), `models.json` zinciri, 429/5xx/zaman aşımı/yapılandırma
  düşüşü (sağlayıcı bekleme süresi `cooldown_skip`; 401/403'te kurucuya bildirim), şema doğrulaması ve tek
  onarım, her deneme bir `llm_calls` satırı — gövde yalnız v2 `llm_calls` sütunları
  (`LLM_CALLS_INSERT_COLUMNS`; `id`/`created_at` DB varsayılanı; `cooldown_skip` → `rate_limited` + `error_code`),
  `Prefer: return=minimal` ile. v2 `check_spend` yumuşak tavandır (engellemez, `downgrade` der); Gemini zinciri
  `downgrade` iken ücretli modelleri atlar. Ders amaçları `cap_excluded_purposes` listesindedir ve tavana takılmaz.
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
| gerçek kip, `SUPABASE_BATCH_JWT` / `SUPABASE_SERVICE_ROLE_KEY` var | **kurulmaz** — `AdapterError` `OGR-ADP-001 v2: pipelines DB'ye doğrudan yazmaz; worker HTTP servisi üzerinden` |
| gerçek kip, `GROQ_API_KEY` yok | her şey sahte (`mode='mixed'`), `warnings` + stderr'de Türkçe uyarı |
| gerçek kip, `GROQ_API_KEY` var | `ProviderRouter` yalnız Groq (Whisper STT) ile; DB, depolama, embedding sahte (satırlar yerel `out/*.jsonl`) |

`cli_base.runtime_from_args`: gerçek çalışma istenip `SUPABASE_URL` ya da `SUPABASE_BATCH_JWT` yoksa iş
`--dry-run` olarak koşar ve başarılı sayılır; GitHub Actions'ta `::warning::` satırı yazar (§2.9).

Depolama: `out` verilmezse her `Runtime` kendi geçici dizinini (`ogrenmen-storage-*`) kullanır, `close()`
(ya da nesne toplanınca) siler; ardışık sahte çalışmalar birbirinin nesnesini görmez.

## Sahteler

**FakeLLM seçim kuralı (`packages/llm` sahtesinin ilkesiyle aynı, deterministik):** klasördeki
`*.json` dosyaları ada göre sıralanır, `bad-schema*.json` dışarıda bırakılır,
`i = int(sha256(prompt_text)[:8], 16) mod n` (`prompt_text` = `system + "\n\n" + prompt`, sistem boş olsa da; UTF-8).
`fail_with={429: [0], 500: [2], "timeout": [3]}` çağrı sırasına göre hata, `fail_models` modele göre hata,
`bad_output_every` / `bad_output_at` `bad-schema.json` döndürür. `fixture_hint` (ses/PDF adı, ör.
`lesson-01`, `exam-2022`) adı bu parçayı içeren dosyayı seçer; eşleşme yoksa kural uygulanır. Parite testleri:
`fixtures/scripts/select_llm.py` başvuru uygulaması tüm klasörlerde, TS ikamesi (`tests/stubs/providers-select.ts`,
Web Crypto ile, `bun` altında) `fixtures/llm/chat` üzerinde aynı dosyayı seçer.

**JsonlDb** (pipeline'ların `service_role` görünümünün sahtesi; v2):

* Taban dünya `fixtures/db/dev-seed.json`. `JsonlDb.from_fixtures(<dizin>)` o dizindeki tablo dosyalarını
  okur ve **dizindeki tablo tabandakinin yerine geçer**. Eşleme: `llm-calls-month.json → llm_calls`,
  `spend-ledger-month.json → spend_ledger`, `memory-facts.json → memory_facts`, `labels.json → lesson_labels`;
  diğerlerinde ad (`-` → `_`) tablo adıysa o tablo (`exam_sources.json`, `generation_requests.json` …);
  çok tablolu dosyalar anahtar başına; sözleşme örnekleri (`ocr-2022.json`) atlanır. Aynı tabloya düşen dosyalar
  birincil anahtara göre birleşir; birincil anahtarı olmayan satırların hepsi korunur. `base=False` tabanı kapatır.
* **Şema = migration'lar.** `fakes/grants-v2.json` `supabase/migrations`'taki tüm tablo ve sütunları listeler
  (`python pipelines/common/scripts/gen_grants_v2.py` üretir; test dosyanın güncel olduğunu denetler). Doğrudan
  yazımda olmayan tablo/sütun `OGR-DB-002` ile reddedilir; v2'de olmayan v1 tabloları (`LEGACY_V1_TABLES`: Telegram,
  kota, oturum, saklama, bilimsel kaynak, pilot metrikleri) dev-seed'den yüklenirken **atlanır**. v2'de
  uygulama rolü yoktur: `service_role` (ve `postgres`) tam yetkilidir; matriste tanımlı başka rol için
  `grants.require` `OGR-DB-001` verir (eski `batch_worker` adı `service_role`'a eşlenir). Matris çalışma anında
  okunur; yoksa/bozuksa `OGR-DB-004`.
* **Pipeline mirası.** `tablet`, `kalem` ve `ders` hâlâ birkaç v1 tablosu (`LEGACY_PIPELINE_TABLES`: ör.
  `generation_requests`, `exam_clusters`, `staff`) ve v2 tablolarında olmayan sütunlar (`LEGACY_PIPELINE_COLUMNS`) kullanır;
  bunlar sütun denetimi olmadan açıkça izinlidir. P3/P5 servisleri geldikçe listeler küçülür.
* `insert(..., on_conflict="merge")` PostgREST `merge-duplicates` gibidir: çakışan satırda yalnız gönderilen
  sütunlar güncellenir, varsayılanlar yalnız gerçek eklemede uygulanır. `questions.status` doğrudan
  `approved` yazılamaz (`OGR-Q-001/004`).
* **`returning`** (`PostgrestDb` ve `JsonlDb` aynı): `"minimal"` → `Prefer: return=minimal`, `[]` döner;
  `"representation"` → satırlar. Varsayılan: tek satır (`Mapping`) eklemesi `representation`, satır dizisi eklemesi
  ve her `update` `minimal` (toplu yazım). `adapters.base.insert_minimal` / `update_minimal` yardımcıları
  `returning` almayan DB'lerde de minimal yazar.
* Tetikleyiciler: `llm_calls` → `spend_ledger` (Europe/Istanbul günü; önbellek token'ları dahil),
  `questions_check_skills` (`OGR-CURR-001`).
* Çıktı (`flush()` / `Runtime.close()`): yalnız bu çalışmada yazılan satırlar son hâliyle `out/<tablo>.jsonl`;
  RPC çağrıları `out/rpc_calls.jsonl` (`register_answer_key` / `register_template_question` `p_key` değeri
  gizlenir); silmeler `out/deletions.jsonl`; `secure.*` hiçbir dosyaya yazılmaz.
  `db.write_log` her yazımın kaynağını (`direct`, `rpc:<ad>`, `trigger:spend_rollup`) tutar.
* Kimlikler deterministiktir: identity tablolarında `max(id)+1`, uuid'li tablolarda
  `uuid5(NAMESPACE_OGRENMEN, "jsonldb:<tablo>:<sıra>")`.

**RPC eşlenikleri.** v2 kümesi (`fakes/rpc-names.json`; `scripts/check-rpc-parity.py` migration'larla ad ve parametre
adı eşler): `check_spend(p_purpose, p_student_ref)`, `log_llm_call`, `set_runtime_flag`. `fakes/rpc-names-legacy-v1.json`
v2 migration'larında karşılığı olmayan, P3 (doğrulama servisi) ve P5 (ders servisi) gelene dek duran eşlenikleri
listeler: `register_answer_key`, `register_template_question`, `resolve_lesson_labels`, `confirm_video_deleted`,
`profile_for_prompt` (parite tablosunda WARN; canlı DB'de çalışmazlar). `register_lesson` ve `write_lesson_analysis`
P5'te v2'de farklı imzayla doğdu (supabase 0040); v1 eşlenikleri ve pipelines/ders v1 çağrıları kaldırıldı.
Dönüş biçimi PostgREST'inkiyle aynıdır (`check_spend` tek satırlık liste: `paid_allowed, degraded, downgrade, state,
day_usd, month_usd, daily_cap, monthly_cap, student_month_usd, student_cap, alert_level`).

Diğer sahteler: `FakeEmbedding` (sha256 → 768 birim vektör), `FakeVision` (`verdicts` ile zorlanabilir),
`FakeOCR`, `FakeTranscriber`, `LocalDirStorage` (`aliases` ile `exams/<uuid>.pdf` → `fixtures/kalem/exam-2022.pdf`),
`FakeNotifier`. Bilimsel kaynak adaptörleri (OpenAlex, Semantic Scholar, arXiv, Crossref, Unpaywall) `pipelines/kitap`
ile birlikte kaldırıldı.

## Hata kodları

RPC hataları veritabanı mesajını aynen taşır (`OGR-KEY-003 …`); `error.code` ilk parçadır. Bu modüle
özgü kodlar: `OGR-RPC-001` (bilinmeyen RPC/parametre), `OGR-RPC-002` (JsonlDb'de bilerek çalıştırılmayan RPC), `OGR-DB-001` (yetki), `OGR-DB-002` (tablo, sütun,
çakışma), `OGR-DB-003` (PostgREST/ağ), `OGR-LLM-001` (zincirde başarılı sağlayıcı yok), `OGR-LLM-002`
(tavan engeli), `OGR-LLM-003` (bilinmeyen amaç/zincir/model), `OGR-ADP-001` (adaptör yapılandırması),
`OGR-ADP-002` (fixture yok), `OGR-STO-001` (depolama), `OGR-DB-004` (yetki matrisi okunamadı).

Canlı yetki testi: `OGRENMEN_DATABASE_URL` tanımlıysa `tests/test_grants.py` geçici bir veritabanına
(`ogrenmen_m05_grants_*`, sonunda silinir) `00_local_stub.sql` + tüm migration'ları uygular ve `SET ROLE service_role`
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
