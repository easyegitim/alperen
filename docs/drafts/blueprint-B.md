# Öğrenmen — Uygulama Planı B ("veri ve güvenlik önce")

Taslak · Mimar B · Kaynak: `docs/plan.md` (tek doğruluk kaynağı) ve `packages/design-system/` (marka kitabı, `guven-ve-seffaflik.md`, `telegram.md`, `egitmen-paneli.md`).

Bu plan, sistemi **veri modelinden dışarıya doğru** kurar. Önce şu dört şeyin kod yoluyla ihlal edilemez olmasını sağlar, sonra üstüne bot, boru hatları ve paneli koyar:

1. **Kanıt zinciri.** Her ustalık değeri ve her kavram yanılgısı, bir `observations` satırına; her gözlem de bir kaynak satırına (`attempts`, `lesson_claims`, `messages`, `instructor_notes`) yabancı anahtarla bağlıdır. Kaynağı olmayan gözlem veritabanına giremez (tetikleyici reddeder). Dolayısıyla `MasteryMeter`/`MisconceptionItem`/`EvidenceQuote` kuralı ("kanıtsız iddia yok") arayüz nezaketi değil, şema kısıtıdır.
2. **Cevap anahtarı yalıtımı.** Anahtarlar `secure` şemasında durur; bu şema PostgREST'e hiç açılmaz, LLM'in çalıştığı rollerin (`bot_worker`, `batch_worker`) üzerinde `USAGE` yetkisi yoktur. Puanlama tek bir `SECURITY DEFINER` fonksiyonundan geçer; `attempts.is_correct` sütununu başka hiçbir yol yazamaz.
3. **Rastgele kimlik + PII temizliği.** Ad, soyad, Telegram kimliği, okul, veli bilgisi yalnızca `secure.person_pii` ve `secure.telegram_identities` tablolarındadır. LLM'e giden her metin, worker'da ve Python'da aynı test vakalarıyla doğrulanan bir temizleyiciden geçer; `bot_responses.prompt_text` ancak temizlenmiş hâlini saklar.
4. **Saklama süreleri tek yerde.** `retention_policies` tablosu hem silme işini hem de kullanıcıya gösterilen "90 gün sonra silinir" cümlesini üretir; metin ve gerçek süre aynı kaynaktan gelir.

Her bölümde yollar gerçektir (`/home/user/alperen/...`), komutlar hesapsız ortamda çalışır (sahte sağlayıcılar, fikstürler), ve hiçbir modül başka bir modülün dosyasına dokunmaz.

---

## 1. Depo ağacı

```
/home/user/alperen
├── README.md                         # M15 entegrasyon — kurulum, komut listesi, mimari özet
├── package.json                      # M15 — bun workspaces: apps/*, packages/* (design-system hariç tutulmaz, build'i yok)
├── bun.lock                          # M15
├── tsconfig.base.json                # M15 — strict, moduleResolution bundler, paths yok (workspaces yeter)
├── .editorconfig, .gitignore, .nvmrc (22)   # M15
├── .github/
│   └── workflows/
│       ├── ci.yml                    # M15 — typecheck + lint + vitest + pytest + sqlfluff + (varsa) pgTAP
│       ├── nightly.yml               # M15 — 02:30 TRT: kulaklik_batch facts → tablet üretimi → ders analizi kuyruğu
│       ├── weekly.yml                # M15 — Pazar 03:00: haftalık özetler, kalem kümeleme, flagged örneklem raporu
│       ├── render.yml                # M15 — figures kuyruğu: render + vision + sympy (workflow_dispatch + nightly çağrısı)
│       ├── keepalive.yml             # M15 — her 2 günde Supabase ping (uyumasın)
│       ├── deploy-worker.yml         # M15 — main'e merge → wrangler deploy
│       └── deploy-panel.yml          # M15 — main'e merge → next build (static export) → Cloudflare Pages
├── docs/
│   ├── plan.md                       # Kurucu — dokunulmaz
│   ├── drafts/blueprint-B.md         # bu dosya
│   └── adr/                          # M15 — kısa karar kayıtları (ADR-0001 roller, ADR-0002 secure şeması, ...)
├── legal/                            # M14 — HUKUKİ İNCELEME GEREKLİ başlıklı taslaklar
│   ├── aydinlatma-metni.md
│   ├── veli-onay-formu.md
│   ├── grup-kayit-bildirimi.md
│   └── saklama-sureleri.md           # retention_policies tablosundan üretilen insan-okur özet
├── content/                          # M12 — müfredat verisi; kod değil veri
│   └── tyt-matematik/
│       ├── curriculum.yaml           # OSYM-TYT-2026 sürüm kaydı
│       ├── skills.yaml               # kazanım ağacı + ön koşul kenarları
│       ├── misconception-tags.yaml   # çeldirici etiket kataloğu
│       ├── diagnostic-v1.yaml        # 18 soruluk teşhis testi (cevap anahtarları AYRI dosyada)
│       ├── diagnostic-v1.keys.yaml   # yalnızca seed aracı okur → secure.answer_keys
│       └── templates/                # parametrik şablon tanımları (params schema + üretici adı)
│           ├── kesir-toplama.yaml
│           ├── ucgen-aci.yaml
│           └── yuzde-problemi.yaml
├── packages/
│   ├── design-system/                # mevcut — dokunulmaz (bundle.js, bundle.css, index.d.ts, README'ler)
│   ├── contracts/                    # M01 — JSON Schema (2020-12) + üretilmiş TS tipleri + Python modelleri
│   │   ├── package.json              # @ogrenmen/contracts
│   │   ├── schemas/*.schema.json
│   │   ├── fixtures/<schema>/{valid,invalid}/*.json
│   │   ├── src/index.ts              # Ajv doğrulayıcılar + tipler (generated.d.ts)
│   │   ├── scripts/gen-ts.ts         # json-schema-to-typescript
│   │   └── python/ogrenmen_contracts/   # jsonschema ile doğrulama; pyproject.toml
│   ├── db/                           # M02 — Supabase/Postgres: migrations, roles, RLS, pgTAP, seed
│   │   ├── package.json              # @ogrenmen/db (script'ler)
│   │   ├── supabase/config.toml
│   │   ├── supabase/migrations/0001_extensions.sql ... 0012_cron.sql
│   │   ├── supabase/seed.sql         # content/ → üretilir (scripts/build-seed.ts)
│   │   ├── tests/pgtap/*.sql         # RLS + grants + evidence chain + grading testleri
│   │   ├── tests/lint/.sqlfluff
│   │   └── scripts/{build-seed.ts, mint-jwt.ts, run-pgtap.sh}
│   ├── pii/                          # M03 — PII temizleyici; TS ve Python aynı vaka dosyasını geçer
│   │   ├── cases.json                # paylaşılan test vakaları
│   │   ├── ts/ (src/scrub.ts, test/scrub.test.ts, package.json @ogrenmen/pii)
│   │   └── py/ (ogrenmen_pii/scrub.py, tests/test_scrub.py, pyproject.toml)
│   └── llm-router/                   # M04 — sağlayıcı adaptörleri, sıralı düşüş, maliyet tablosu, yapılandırılmış çıktı
│       ├── package.json              # @ogrenmen/llm-router
│       ├── src/{router.ts, cost.ts, providers/{gemini.ts,groq.ts,cloudflare.ts,openrouter.ts,fake.ts}, structured.ts}
│       └── test/*.test.ts
├── apps/
│   ├── bot-worker/                   # M05 — Cloudflare Worker (TypeScript, Hono)
│   │   ├── wrangler.toml
│   │   ├── src/{index.ts, telegram/, handlers/, state/, db/, prompts/, cron/}
│   │   ├── test/ (vitest + fake Telegram + fake DB + fake providers)
│   │   └── .dev.vars.example
│   └── egitmen-paneli/               # M13 — Next.js 14 (React 18), static export, Supabase auth (tarayıcı)
│       ├── next.config.mjs
│       ├── app/(panel)/{page.tsx, dersler/[id]/page.tsx, cevaplar/page.tsx, kuyruk/page.tsx, onaylar/page.tsx}
│       ├── lib/{ds.tsx, data/{types.ts, supabase.ts, mock.ts, index.ts}}
│       ├── mocks/*.json
│       └── public/ds/ (bundle.js, bundle.css, fonts → build'de design-system'dan kopyalanır)
├── pipelines/                        # Python 3.13; her boru hattı kendi pyproject'i ile bağımsız kurulur
│   ├── common/                       # M06 — ogrenmen_common: adaptör arayüzleri + sahteler + db/storage istemcisi + CLI tabanı
│   ├── tablet/                       # M07 — soru + şekil üretimi, render, vision denetimi, SymPy, PDF
│   ├── kalem/                        # M08 — çeldirici motoru (SQL tarafında) için analiz araçları + sınav modelleme
│   ├── kitap/                        # M09 — akademik araştırma ajanı
│   ├── ders/                         # M10 — ders videosu analizi
│   └── kulaklik_batch/               # M11 — gece olgu çıkarımı, haftalık özet, panel metrikleri, saklama raporu
└── scripts/                          # M15 — kök yardımcılar: dev-all.sh, check-all.sh, fixtures-refresh.sh
```

Sahiplik ilkesi: her dizin tek bir modül kimliğine (M01…M15) aittir; kök dosyalar ve `.github/` yalnızca M15'e aittir ve M15 en son çalışır. `packages/design-system` ve `docs/plan.md` hiçbir modüle ait değildir, salt okunurdur.

---

## 2. Paketler ve sahiplik

Ortak kurallar:

- TypeScript paketleri `bun` ile kurulur ve test edilir (`bun install`, `bun test` yerine **vitest** — Workers havuzu ve jsdom için tek koşucu). Node 22 hedefi, `"type": "module"`.
- Python paketleri `pip install -e .[dev]` ile kurulur, `pytest` ile test edilir, `ruff` ile lint. Her boru hattı kendi sanal ortamında kurulabilir; `ogrenmen_common` ve `ogrenmen_contracts` yerel yol bağımlılığıdır (`pyproject` içinde `[tool.uv.sources]` değil, düz `pip install -e ../common` — boring).
- **Hesap yok ilkesi:** her dış servis bir arayüzün arkasındadır; `OGRENMEN_ADAPTERS=fake` (Python) ve `ADAPTERS=fake` (Worker `.dev.vars`) ile tüm sistem fikstürlerle çalışır. Sahteler deterministiktir (aynı girdi → aynı çıktı; `seed` parametresi).
- Veritabanı testleri iki kademelidir: (a) her zaman çalışan: `sqlfluff` lint + mantık testleri (BKT, kota, PII) saf TS/Python; (b) `DATABASE_URL` tanımlıysa: migration + pgTAP. CI'da `pgvector/pgvector:pg16` servis konteyneri ile (b) çalışır; yerelde Postgres yoksa (b) **atlanır, başarısız olmaz** (`scripts/run-pgtap.sh` çıkış kodu 0 ve "SKIP" yazar).

### 2.1 `packages/contracts` (M01) — `@ogrenmen/contracts`, `ogrenmen_contracts`

- Amaç: TS ve Python'un paylaştığı tüm JSON şemaları (Bölüm 4), fikstürler ve doğrulayıcılar.
- Giriş noktaları: `src/index.ts` (`validate.questionItem(obj)`, `validate.lessonAnalysis(obj)` … her biri Ajv `ValidateFunction`), `python/ogrenmen_contracts/__init__.py` (`validate("question_item", obj)` → `jsonschema.exceptions.ValidationError` fırlatır).
- Çıktılar: `schemas/*.schema.json`, `src/generated.d.ts` (commit edilir), `fixtures/`.
- Kurulum/test:
  ```
  cd /home/user/alperen/packages/contracts
  bun install && bun run gen && bun run test        # gen: json-schema-to-typescript; test: her fixture valid/invalid klasörüne göre
  pip install -e ./python[dev] && python -m pytest python/tests -q
  ```
- Test mantığı: `fixtures/<schema>/valid/*.json` hepsi geçer, `invalid/*.json` hepsi düşer; TS ve Python aynı fikstürleri okur (dolayısıyla iki dil aynı anlamda doğrular).

### 2.2 `packages/db` (M02) — `@ogrenmen/db`

- Amaç: Supabase Postgres şeması: uzantılar, şemalar (`public`, `secure`, `audit`), roller, tablolar, RLS, fonksiyonlar, saklama işleri, seed.
- Giriş noktaları: `supabase/migrations/*.sql` (sıralı, idempotent değil — supabase CLI sırayla uygular), `scripts/build-seed.ts` (content/ → `supabase/seed.sql`), `scripts/mint-jwt.ts` (bot_worker/batch_worker JWT üretir), `scripts/run-pgtap.sh`.
- Yerel çalıştırma seçenekleri (hesapsız):
  1. Postgres varsa: `DATABASE_URL=postgres://... bash scripts/run-pgtap.sh` → `psql -f` ile migrasyonlar, `pgtap` uzantısı, `pg_prove tests/pgtap/*.sql`.
  2. Postgres yoksa: `bun run lint:sql` (sqlfluff, dialect postgres) ve `bun run test:logic` (BKT formülünün TS referans uygulaması `tests/logic/bkt.test.ts`; aynı sayıları `tests/pgtap/40_bkt.sql` kullanır, böylece SQL ve TS çıktıları birebir).
  3. Docker daemon varsa: `docker run --rm -e POSTGRES_PASSWORD=x -p 54329:5432 pgvector/pgvector:pg16` ve (1).
  Supabase CLI (`npm i -g supabase`) yalnızca gerçek projeye `supabase db push` için; yerel testte gerekmiyor.
- Komutlar:
  ```
  cd /home/user/alperen/packages/db
  bun install
  bun run build:seed            # content/tyt-matematik → supabase/seed.sql (+ secure anahtarlar ayrı dosya: supabase/seed.secure.sql)
  bun run lint:sql              # pip install sqlfluff; sqlfluff lint supabase/migrations --dialect postgres
  bun run test:logic            # vitest: bkt, elo, quota, retention policy parser
  bash scripts/run-pgtap.sh     # DATABASE_URL yoksa SKIP
  ```

### 2.3 `packages/pii` (M03) — `@ogrenmen/pii`, `ogrenmen_pii`

- Amaç: LLM'e gidecek metinden kişisel veriyi silmek. Girdi: metin + bilinen ad listesi (cohort üyelerinin görünen adları, kullanıcı adları) + rol eşlemesi. Çıktı: `{ text, replacements: [{kind, from_hash, to}] }`.
- Kurallar (deterministik, LLM yok): e-posta, telefon (TR biçimleri), T.C. kimlik no (11 hane + mod-10 kontrolü), IBAN, `@kullanici` → `@KULLANICI`, bilinen adlar → rol etiketi (`ÖĞRENCİ`, `EĞİTMEN`, `VELİ`), okul/kurum kalıpları ("… Anadolu Lisesi", "… Koleji", "… Okulu") → `OKUL`, sınıf ("11-C") → `SINIF`, URL → `URL`. Bilinmeyen özel adlar kaldırılmaz (yanlış pozitif matematik terimlerini bozar); bu yüzden ad listesi zorunlu girdidir.
- Test: `cases.json` 60+ vaka; `bun test` (ts/) ve `pytest` (py/) aynı dosyayı okur; CI'da ikisinin çıktısı diff'lenir.
  ```
  cd /home/user/alperen/packages/pii/ts && bun install && bun run test
  cd /home/user/alperen/packages/pii/py && pip install -e .[dev] && python -m pytest -q
  ```

### 2.4 `packages/llm-router` (M04) — `@ogrenmen/llm-router`

- Amaç: Worker'ın tek LLM kapısı. `LlmProvider` arayüzü, sağlayıcı adaptörleri (Gemini, Groq, Cloudflare AI, OpenRouter) + `FakeProvider`, sıralı düşüş (429/5xx/timeout), maliyet tablosu, günlük/aylık tavan kontrolü (dışarıdan verilen `SpendGate` arayüzü), yapılandırılmış çıktı (JSON şema → sağlayıcıya `response_schema`/`response_format`, yanıtı Ajv ile doğrula, 1 tekrar).
- Dış ağ yok: adaptörler `fetch` enjeksiyonu alır; testler `fetch` sahtesi ile 429 → düşüş sırasını doğrular.
  ```
  cd /home/user/alperen/packages/llm-router && bun install && bun run typecheck && bun run test
  ```

### 2.5 `apps/bot-worker` (M05)

- Amaç: Telegram webhook, komutlar, onay kapısı, kota, Sokratik öğretmen, hafıza erişimi, grup/rol/yükseltme, cevap günlüğü, cron'lar. Bölüm 5.
- Çalışma zamanı: Cloudflare Workers, TypeScript, Hono 4.x, `@supabase/supabase-js` (PostgREST üzerinden, `bot_worker` JWT ile). KV: `QUOTA_KV` (günlük sayaç önbelleği), `STATE_KV` (oturum modu, onay akışı adımı); kalıcı doğruluk kaynağı yine Postgres.
- Yerel:
  ```
  cd /home/user/alperen/apps/bot-worker && bun install
  bun run typecheck && bun run test        # vitest + @cloudflare/vitest-pool-workers (miniflare); ADAPTERS=fake
  bun run dev                              # wrangler dev --local; .dev.vars: ADAPTERS=fake, DB=fake
  bun run smoke                            # scripts/smoke.ts: yerel worker'a sahte Telegram update'leri POST eder, cevapları assert eder
  ```
- `DB=fake` modunda `src/db/fake.ts` bellek içi tablo seti (seed.json fikstürü) PostgREST istemcisinin yerine geçer; tüm handler testleri bununla çalışır. `DB=supabase` yalnız gerçek ortamda.

### 2.6 `pipelines/common` (M06) — `ogrenmen_common`

- Amaç: Python boru hatlarının ortak tabanı: `adapters/` (LLM, vision, embedding, transcribe, openalex, semantic_scholar, crossref, unpaywall, storage, db) her biri `Protocol` + `Fake*` + gerçek sınıf; `cli.py` (ortak argümanlar `--dry-run`, `--fixtures DIR`, `--out DIR`, `--adapters fake|real`); `db.py` (`DbClient` → `PostgrestDb` veya `JsonlDb` — satırları `out/<table>.jsonl`'e yazar); `pii` paketini sarar; `cost.py` (harcama defteri yazımı).
- Komut: `cd /home/user/alperen/pipelines/common && pip install -e .[dev] && python -m pytest -q`

### 2.7 `pipelines/tablet` (M07), `pipelines/kalem` (M08), `pipelines/kitap` (M09), `pipelines/ders` (M10), `pipelines/kulaklik_batch` (M11)

Her biri: `pyproject.toml` (`ogrenmen-<ad>`), `src/ogrenmen_<ad>/cli.py` (`python -m ogrenmen_<ad> <komut>`), `fixtures/`, `tests/`. Ayrıntı Bölüm 6. Ortak komut deseni:
```
cd /home/user/alperen/pipelines/<ad> && pip install -e ../common -e ../../packages/contracts/python -e ../../packages/pii/py -e .[dev]
python -m pytest -q
python -m ogrenmen_<ad> <komut> --adapters fake --dry-run --fixtures fixtures/ --out /tmp/out
```

### 2.8 `apps/egitmen-paneli` (M13)

- Next.js 14.2 (React 18.3 — bundle.js React 18 bekler), `output: 'export'` (statik; Cloudflare Pages'a sunucusuz), tarayıcı tarafı Supabase auth (`@supabase/supabase-js` + PKCE). Veri erişimi tamamen RLS altında PostgREST; `NEXT_PUBLIC_DATA_SOURCE=mock` ile `mocks/*.json`.
  ```
  cd /home/user/alperen/apps/egitmen-paneli && bun install
  bun run sync:ds        # packages/design-system/components/{bundle.js,bundle.css} + fonts → public/ds/
  bun run typecheck && bun run test && bun run build   # vitest + @testing-library/react (jsdom), build = static export
  NEXT_PUBLIC_DATA_SOURCE=mock bun run dev
  ```

### 2.9 `content/tyt-matematik` (M12), `legal/` (M14), kök + `.github` + `scripts/` (M15)

- M12 çıktıları YAML; doğrulama `packages/contracts` şemalarıyla (`curriculum.schema.json`, `diagnostic_test.schema.json`): `cd /home/user/alperen/packages/contracts && bun run validate:content` (M15 bunu CI'a bağlar; M12'nin kendi kabul testi `python -c` ile jsonschema çağrısıdır, Bölüm 11).
- M14 yalnızca Markdown; kabul: dosyalar var ve `HUKUKİ İNCELEME GEREKLİ` bandı ile `{{SAKLAMA_GUN}}` gibi yer tutucular `legal/placeholders.json`'da tanımlı.
- M15: `bun install` kökte tüm workspace'leri kurar; `scripts/check-all.sh` tüm modül kabul komutlarını sırayla çalıştırır.

---

## 3. Veri modeli

### 3.0 İlkeler ve şema yerleşimi

- Üç şema: **`public`** (PostgREST'e açık; RLS zorunlu), **`secure`** (PostgREST'e KAPALI; yalnız `SECURITY DEFINER` fonksiyonlar dokunur: cevap anahtarları, kişisel veri, Telegram kimlik eşlemesi, auth bağlantısı), **`audit`** (yalnız ekleme; tetikleyiciler yazar, panel koordinatörü okur).
- Supabase panelinde "Exposed schemas" yalnız `public` kalır; `secure` ve `audit` eklenmez. Bu, PostgREST üzerinden anahtar sızmasını yapılandırma düzeyinde imkânsızlaştırır; RLS ve `GRANT` ikinci ve üçüncü katmandır.
- Roller (Postgres rolleri; PostgREST JWT `role` iddiasına göre `SET ROLE` yapar):
  - `anon` — hiçbir tabloya erişim yok (yalnız `public.legal_text_current()` fonksiyonu).
  - `authenticated` — panel kullanıcıları ve (ileride) web öğrencileri. Hangi satırları gördüğü `memberships` + RLS ile belirlenir. Uygulama rolleri (`student`, `instructor`, `coordinator`, `observer`) Postgres rolü değil, `memberships.role` satırıdır.
  - `bot_worker` — Cloudflare Worker. `secure` üzerinde `USAGE` yok. Yalnız gereken tablolarda SELECT/INSERT, puanlama ve kimlik çözme için RPC.
  - `batch_worker` — Python boru hatları. `secure` yok. Yazdığı tablolar: `items`, `figures`, `memory_facts`, `weekly_summaries`, `lesson_analyses`, `lesson_claims`, `exam_*`, `citations`, `instructor_alerts`, `spend_ledger`. Cevap anahtarını `public.register_answer_key(...)` RPC'si ile yazar (fonksiyon SymPy doğrulama bayrağını zorunlu kılar; bkz 3.4).
  - `service_role` — yalnız migrasyon ve seed; hiçbir uygulama kodu kullanmaz (ADR-0001).
- Rastgele kimlik: tüm birincil anahtarlar `uuid default gen_random_uuid()`. `persons.id` API'lere giden tek kimliktir; ad/soyad `secure.person_pii`'dedir.
- Zaman: `timestamptz`, saat dilimi uygulama katmanında `Europe/Istanbul`.
- Her tabloda `created_at timestamptz not null default now()`; değişenlerde `updated_at` (tetikleyici `set_updated_at`).
- Sayılı sabitler (`min_evidence=5`, kota 25/5/2, saklama günleri) kodda değil `public.settings` tablosundadır; Worker ve pipelines açılışta okur.

### 3.1 Migrasyon sırası (`packages/db/supabase/migrations/`)

| Dosya | İçerik |
| --- | --- |
| `0001_extensions.sql` | `pgcrypto`, `vector`, `pg_cron`, `pgtap` (yalnız test ortamında, `create extension if not exists pgtap` ayrı dosya `tests/pgtap/00_setup.sql`) |
| `0002_schemas_roles.sql` | `secure`, `audit` şemaları; `bot_worker`, `batch_worker` rolleri; `grant bot_worker, batch_worker to authenticator`; `revoke all on schema secure from public, anon, authenticated, bot_worker, batch_worker` |
| `0003_identity.sql` | `persons`, `secure.person_pii`, `secure.auth_links`, `secure.telegram_identities`, `consents`, `legal_texts`, `settings`, `retention_policies` |
| `0004_curriculum.sql` | `curricula`, `skills`, `skill_prerequisites`, `misconception_tags`, `academic_periods` |
| `0005_cohorts.sql` | `cohorts`, `memberships`, `enrollments`, `chat_bindings` |
| `0006_gozluk.sql` | `observations`, `mastery`, `mastery_history`, `misconceptions`, `misconception_evidence`, `student_preferences`, `instructor_notes` |
| `0007_tablet.sql` | `templates`, `figures`, `items`, `secure.answer_keys`, `test_sets`, `test_sessions`, `attempts`, `generation_requests` |
| `0008_kulaklik.sql` | `messages`, `chat_sessions`, `memory_facts`, `weekly_summaries`, `bot_responses`, `escalations`, `instructor_alerts`, `proactive_messages`, `usage_counters`, `quota_policies`, `spend_ledger`, `spend_caps` |
| `0009_ders.sql` | `lessons`, `lesson_analyses`, `lesson_claims` |
| `0010_kalem_kitap.sql` | `courses`, `syllabus_topics`, `exam_sources`, `exam_items`, `exam_clusters`, `priority_plans`, `research_requests`, `research_outputs`, `citations`, `library_documents`, `library_chunks` |
| `0011_functions.sql` | yardımcılar, BKT, `apply_observation`, `submit_answer`, `retrieve_context`, `resolve_telegram`, `approve_lesson_analysis`, `run_retention`, `audit_row` |
| `0012_rls_grants.sql` | tüm `enable row level security`, politikalar, `GRANT` matrisi |
| `0013_cron.sql` | `pg_cron` işleri: saklama (günlük 03:10), uyarı hesaplama (saatlik), olgu süresi (günlük) |

### 3.2 Tablolar (DDL düzeyi)

Gösterim: `kolon tip [kısıt]`. `pk` birincil anahtar, `fk→` yabancı anahtar, `idx` indeks. Tüm `public` tabloları RLS açık; politikalar 3.3'te.

#### Kimlik ve onay

```sql
create table public.persons (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('student','instructor','guardian','staff')),
  is_minor boolean not null default true,              -- doğum yılı secure'da; burada yalnız bayrak
  status text not null default 'active' check (status in ('active','suspended','erased')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table secure.person_pii (
  person_id uuid primary key references public.persons(id) on delete cascade,
  display_name text not null,                          -- "Elif Kaya"; panelde "Elif K." fonksiyonla
  birth_year int,
  guardian_person_id uuid references public.persons(id),
  guardian_contact text,                               -- e-posta/telefon, yalnız onay süreci için
  school text, grade text,
  notes text,
  updated_at timestamptz not null default now()
);

create table secure.auth_links (                      -- Supabase auth kullanıcısı ↔ person
  auth_user_id uuid primary key,                       -- auth.users.id
  person_id uuid not null unique references public.persons(id) on delete cascade
);

create table secure.telegram_identities (
  telegram_user_id bigint primary key,
  person_id uuid not null unique references public.persons(id) on delete cascade,
  username text,                                       -- @kullanici; PII sayılır
  linked_at timestamptz not null default now()
);

create table public.legal_texts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('kvkk_aydinlatma','veli_onayi','grup_kayit','kullanim_kosullari')),
  version text not null,                               -- '2026-10-v1'
  body_md text not null,
  effective_from date not null,
  unique (kind, version)
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  kind text not null check (kind in ('kvkk_aydinlatma','veli_onayi','grup_kayit')),
  legal_text_id uuid not null references public.legal_texts(id),
  granted_by uuid references public.persons(id),       -- veli onayında veli; kendi onayında null
  method text not null check (method in ('telegram','web','paper')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  evidence jsonb not null default '{}'                 -- {telegram_message_id, chat_id} ya da {form_no}
);
create index consents_person_kind_idx on public.consents(person_id, kind) where revoked_at is null;

create table public.settings (                        -- tek satırlı sabitler
  key text primary key,                                -- 'min_evidence','quota.messages','quota.tests','quota.research','retention.messages_days',...
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

create table public.retention_policies (
  id text primary key,                                 -- 'messages.hard_delete'
  table_name text not null, schema_name text not null default 'public',
  ts_column text not null,                             -- hangi zaman sütununa göre
  days int not null check (days > 0),
  mode text not null check (mode in ('delete','null_columns','anonymize')),
  columns text[],                                      -- null_columns için
  user_facing_text text,                               -- "Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve {days} gün sonra silinir."
  enabled boolean not null default true
);
```

#### Müfredat ve dönem

```sql
create table public.curricula (
  id uuid primary key default gen_random_uuid(),
  code text not null,                                  -- 'TYT-MAT'
  authority text not null check (authority in ('MEB','ÖSYM','UNI','OTHER')),
  year int not null,                                   -- kılavuz/program yılı
  version text not null,                               -- '2026.1'
  title text not null,
  status text not null default 'draft' check (status in ('draft','published','retired')),
  published_at timestamptz,
  unique (code, year, version)
);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references public.curricula(id) on delete cascade,
  code text not null,                                  -- 'TYT.MAT.SAYILAR.RASYONEL.TOPLAMA' (sürüm içinde sabit)
  name text not null,
  parent_id uuid references public.skills(id),
  depth int not null default 0,
  description text,
  bkt_p_l0 numeric(5,4) not null default 0.2000,       -- BKT parametreleri kazanım başına
  bkt_p_t  numeric(5,4) not null default 0.1000,
  bkt_p_g  numeric(5,4) not null default 0.2500,
  bkt_p_s  numeric(5,4) not null default 0.1000,
  sort_order int not null default 0,
  unique (curriculum_id, code)
);
create index skills_parent_idx on public.skills(parent_id);

create table public.skill_prerequisites (
  skill_id uuid not null references public.skills(id) on delete cascade,
  prerequisite_id uuid not null references public.skills(id) on delete cascade,
  strength numeric(3,2) not null default 1.00 check (strength between 0 and 1),
  source text not null default 'curriculum' check (source in ('curriculum','instructor','inferred')),
  primary key (skill_id, prerequisite_id),
  check (skill_id <> prerequisite_id)
);

create table public.misconception_tags (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references public.curricula(id) on delete cascade,
  code text not null,                                  -- 'RASYONEL.PAY_PAYDA_AYRI_TOPLAMA'
  skill_id uuid references public.skills(id),          -- yanılgının ait olduğu kazanım
  prerequisite_skill_id uuid references public.skills(id), -- "asıl sorun alt konuda" çıkarımı için
  text_instructor text not null,                       -- üçüncü tekil: "Payları ve paydaları ayrı ayrı topluyor."
  text_student text not null,                          -- sen dili: "Payları ve paydaları ayrı ayrı topluyorsun."
  unique (curriculum_id, code)
);

create table public.academic_periods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                           -- 'YKS-2027'
  exam_family text not null check (exam_family in ('LGS','YKS','UNI','OTHER')),
  curriculum_id uuid not null references public.curricula(id),
  starts_on date not null, ends_on date not null
);
```

#### Kohort, üyelik, kayıt (enrollment)

```sql
create table public.cohorts (
  id uuid primary key default gen_random_uuid(),
  name text not null,                                  -- 'TYT Mat Pilot A'
  period_id uuid not null references public.academic_periods(id),
  subject text,                                        -- 'matematik' (branş filtresi için)
  status text not null default 'active' check (status in ('active','archived'))
);

create table public.memberships (                     -- ROLLER TABLOSU
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  role text not null check (role in ('student','instructor','coordinator','observer')),
  subject text,                                        -- branş eğitmeni için; null = tüm dersler
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (person_id, cohort_id, role)
);
create index memberships_person_idx on public.memberships(person_id) where active;

create table public.enrollments (                     -- kalıcı kimlik + dönemsel akademik kayıt
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.persons(id) on delete cascade,
  period_id uuid not null references public.academic_periods(id),
  cohort_id uuid references public.cohorts(id),
  status text not null default 'active' check (status in ('active','paused','ended')),
  enrolled_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (student_id, period_id)
);
create index enrollments_cohort_idx on public.enrollments(cohort_id) where status='active';

create table public.chat_bindings (                   -- Telegram sohbet ↔ kohort/kişi
  telegram_chat_id bigint primary key,
  kind text not null check (kind in ('private','group','supergroup')),
  cohort_id uuid references public.cohorts(id),
  owner_person_id uuid references public.persons(id), -- private sohbette öğrenci
  title text,
  privacy_mode_off_confirmed_at timestamptz,          -- gruba eklenince bot getChat ile denetler
  recording_notice_message_id bigint,                  -- sabitlenen kayıt bildirimi
  recording_notice_legal_text_id uuid references public.legal_texts(id),
  created_at timestamptz not null default now()
);
```

#### Gözlük — kanıt zinciri

```sql
create type public.observation_kind as enum ('quiz_answer','diagnostic_answer','lesson_evidence','chat_question','instructor_note','misconception_resolution');
create type public.observation_source as enum ('attempt','lesson_claim','message','instructor_note');

create table public.observations (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  skill_id uuid not null references public.skills(id),
  kind public.observation_kind not null,
  value jsonb not null,                                -- {"correct":true} | {"mastery":0.6,"confidence":0.8} | {"asked":true}
  weight numeric(3,2) not null default 1.00 check (weight between 0 and 1),
  source_type public.observation_source not null,
  source_id uuid not null,                             -- attempts.id | lesson_claims.id | messages.id | instructor_notes.id
  source_locator text not null,                        -- insan-okur: "Deneme 3 · Soru 8", "Ders 12 · 14:32", "Sohbet · 19 Eki 21:04"
  quote text,                                          -- EvidenceQuote metni (PII temizlenmiş)
  misconception_tag_id uuid references public.misconception_tags(id),
  observed_at timestamptz not null default now(),
  created_by_role text not null,                       -- 'bot_worker' | 'batch_worker' | 'instructor' | 'grader'
  applied_at timestamptz,                              -- mastery'ye işlendi mi
  created_at timestamptz not null default now()
);
create index observations_enr_skill_idx on public.observations(enrollment_id, skill_id, observed_at desc);
create index observations_source_idx on public.observations(source_type, source_id);
-- Tetikleyici: observations_check_source() — source_type'a göre ilgili tabloda source_id var mı ve o kaynağın
-- enrollment'ı bu enrollment'la aynı mı; değilse raise exception 'OGR-EVID-001 kaynak satır yok'.
-- lesson_claim kaynağı için ek koşul: lesson_claims.status='approved' (onaysız ders raporu profile işlenmez).

create table public.mastery (
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  skill_id uuid not null references public.skills(id),
  p numeric(6,5) not null check (p between 0 and 1),
  evidence_count int not null default 0,
  last_observation_id uuid references public.observations(id),
  updated_at timestamptz not null default now(),
  primary key (enrollment_id, skill_id)
);

create table public.mastery_history (                 -- yalnız ekleme; her p değişimi
  id bigint generated always as identity primary key,
  enrollment_id uuid not null, skill_id uuid not null,
  observation_id uuid not null references public.observations(id),
  p_before numeric(6,5), p_after numeric(6,5) not null,
  method text not null,                                -- 'bkt' | 'blend' | 'instructor_override'
  params jsonb not null,                               -- kullanılan p_t,p_g,p_s,weight
  created_at timestamptz not null default now()
);
create index mastery_history_idx on public.mastery_history(enrollment_id, skill_id, created_at desc);

create table public.misconceptions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  skill_id uuid not null references public.skills(id),
  tag_id uuid references public.misconception_tags(id),
  text_instructor text not null,
  text_student text not null,
  status text not null default 'pending_review' check (status in ('pending_review','open','resolved','rejected')),
  first_seen timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.persons(id),      -- eğitmen onayı zorunlu (check: resolved → resolved_by not null)
  resolution_observation_id uuid references public.observations(id),  -- yeni kanıt zorunlu
  check (status <> 'resolved' or (resolved_by is not null and resolution_observation_id is not null))
);
create index misconceptions_enr_idx on public.misconceptions(enrollment_id, status);

create table public.misconception_evidence (
  misconception_id uuid not null references public.misconceptions(id) on delete cascade,
  observation_id uuid not null references public.observations(id) on delete cascade,
  primary key (misconception_id, observation_id)
);
-- Tetikleyici: misconceptions_status_guard() — status 'open'/'resolved' olabilmesi için en az 1 misconception_evidence satırı;
-- evidence_count < settings.min_evidence iken status 'open' olabilir ama panel "Onay bekliyor" gösterir (kural: eğitmen onayı ile 'open').

create table public.student_preferences (
  person_id uuid primary key references public.persons(id) on delete cascade,
  active_hours int[] not null default '{}',             -- 0-23
  modality text check (modality in ('visual','verbal','mixed')),
  explanation_style text,                               -- serbest, eğitmen/batch yazar
  default_mode text not null default 'socratic' check (default_mode in ('socratic','direct')),
  proactive_opt_in boolean not null default true,
  voice_reply boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.instructor_notes (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  author_id uuid not null references public.persons(id),
  skill_id uuid references public.skills(id),
  body text not null,
  approved_fact boolean not null default false,        -- bot bunu "onaylı olgu" olarak kullanabilir (not/devamsızlık vb.)
  created_at timestamptz not null default now()
);
```

#### Tablet — soru bankası ve cevap anahtarı yalıtımı

```sql
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                           -- 'kesir-toplama'
  curriculum_id uuid not null references public.curricula(id),
  engine text not null check (engine in ('matplotlib','svg','tikz','vegalite','schemdraw','rdkit','graphviz','latex','none')),
  params_schema jsonb not null,                        -- JSON Schema
  generator text not null,                             -- 'ogrenmen_tablet.templates.kesir_toplama:generate'
  skill_ids uuid[] not null,
  enabled boolean not null default true
);

create table public.figures (
  id uuid primary key default gen_random_uuid(),
  engine text not null,
  code text not null,                                  -- LLM/şablonun yazdığı kod
  code_hash text not null,                             -- sha256; aynı kod yeniden render edilmez
  render_status text not null default 'pending' check (render_status in ('pending','rendered','render_failed')),
  storage_path text,                                   -- supabase storage: figures/<id>.png
  width int, height int, bytes int,
  alt_text text not null,                              -- şekli kelimelerle anlatır (zorunlu)
  vision_status text not null default 'pending' check (vision_status in ('pending','passed','failed','skipped')),
  vision_report jsonb,
  attempts int not null default 0,
  review_status text not null default 'pending' check (review_status in ('pending','verified','rejected')),
  reviewed_by uuid references public.persons(id), reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index figures_code_hash_idx on public.figures(code_hash);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references public.curricula(id),
  kind text not null check (kind in ('mcq','numeric','open')),
  stem text not null,
  figure_id uuid references public.figures(id),
  options jsonb,                                       -- [{"letter":"A","text":"...","misconception_tag_id":"uuid|null"}] — DOĞRU ŞIK BURADA YOK
  skill_ids uuid[] not null check (cardinality(skill_ids) >= 1),
  difficulty numeric(3,2) check (difficulty between 0 and 1),
  source text not null check (source in ('llm','template','instructor','diagnostic')),
  template_id uuid references public.templates(id),
  template_params jsonb,
  model text, generation_cost_usd numeric(8,5),
  verification_status text not null default 'draft'
    check (verification_status in ('draft','auto_checked','review_pending','approved','rejected')),
  key_verified boolean not null default false,         -- register_answer_key sympy_verified=true yazdıysa
  reviewed_by uuid references public.persons(id), reviewed_at timestamptz, review_note text,
  content_hash text not null,                          -- stem+options sha256, tekrar üretimi engeller
  created_at timestamptz not null default now()
);
create index items_skills_idx on public.items using gin(skill_ids);
create index items_status_idx on public.items(verification_status);
-- Kural (check constraint): verification_status='approved' → figure_id null OR figure.review_status='verified' (tetikleyici items_approve_guard)

create table secure.answer_keys (                     -- PostgREST'e kapalı, LLM rolleri göremez
  item_id uuid primary key references public.items(id) on delete cascade,
  correct_letter text,                                 -- mcq
  numeric_value numeric, numeric_tolerance numeric default 0,
  canonical_expr text,                                 -- sympy ifadesi
  solution_md text not null,
  sympy_verified boolean not null default false,
  verified_at timestamptz,
  created_by_role text not null,
  created_at timestamptz not null default now()
);

create table public.generation_requests (             -- onaylı havuz yeniden kullanımı
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id),
  difficulty_band text not null check (difficulty_band in ('easy','mid','hard')),
  requested_by uuid references public.enrollments(id),
  served_item_id uuid references public.items(id),     -- havuzdan verildiyse
  needs_generation boolean not null default false,
  created_at timestamptz not null default now()
);
create index generation_requests_skill_idx on public.generation_requests(skill_id, difficulty_band, created_at desc);

create table public.test_sets (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references public.curricula(id),
  kind text not null check (kind in ('diagnostic','practice','exam')),
  code text not null unique,                           -- 'TYT-MAT-DIAG-v1'
  title text not null,
  item_ids uuid[] not null,
  version int not null default 1
);

create table public.test_sessions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  test_set_id uuid not null references public.test_sets(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  surface text not null check (surface in ('telegram','web'))
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  item_id uuid not null references public.items(id),
  test_session_id uuid references public.test_sessions(id),
  chosen jsonb,                                        -- {"letter":"B"} | {"value":"7/8"}
  mode text not null default 'socratic' check (mode in ('socratic','direct')),
  surface text not null default 'telegram',
  -- aşağıdaki üç sütunu YALNIZ public.submit_answer() yazar (tetikleyici attempts_protect_graded)
  is_correct boolean,
  misconception_tag_id uuid references public.misconception_tags(id),
  graded_at timestamptz,
  responded_at timestamptz, latency_ms int,
  created_at timestamptz not null default now()
);
create index attempts_enr_idx on public.attempts(enrollment_id, created_at desc);
create index attempts_item_idx on public.attempts(item_id);
```

#### Kulaklık — mesajlar, hafıza, cevap günlüğü, kota, harcama

```sql
create table public.messages (                        -- Katman 1: ham günlük (saklama: settings.retention.messages_days = 90)
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null references public.chat_bindings(telegram_chat_id),
  telegram_message_id bigint not null,
  sender_person_id uuid references public.persons(id), -- null: bilinmeyen/ bot
  sender_role text not null check (sender_role in ('student','instructor','coordinator','observer','bot','unknown')),
  reply_to_telegram_message_id bigint,
  text_raw text,                                       -- eğitmen görür; LLM'e ASLA gitmez
  text_llm text,                                       -- PII temizlenmiş; LLM'e giden tek sürüm
  attachments jsonb not null default '[]',             -- [{"type":"photo","file_id":"...","storage_path":null}]
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (telegram_chat_id, telegram_message_id)
);
create index messages_chat_time_idx on public.messages(telegram_chat_id, sent_at desc);
create index messages_sender_time_idx on public.messages(sender_person_id, sent_at desc);

create table public.chat_sessions (                   -- oturum durumu (KV önbelleğinin doğruluk kaynağı)
  telegram_chat_id bigint not null references public.chat_bindings(telegram_chat_id),
  person_id uuid not null references public.persons(id),
  mode text not null default 'socratic' check (mode in ('socratic','direct')),
  direct_mode_item_id uuid references public.items(id), -- /cevap yalnız bu soru için
  consent_state text not null default 'unknown' check (consent_state in ('unknown','pending_guardian','granted','refused')),
  onboarding_step text,                                -- 'ask_age','ask_guardian','diagnostic_q7' ...
  active_test_session_id uuid references public.test_sessions(id),
  updated_at timestamptz not null default now(),
  primary key (telegram_chat_id, person_id)
);

create table public.memory_facts (                    -- Katman 2: çıkarılmış olgular
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  enrollment_id uuid references public.enrollments(id),
  kind text not null check (kind in ('promise','deadline','unanswered_question','morale','topic_asked','preference','instructor_statement')),
  text text not null,                                  -- PII temizlenmiş
  valid_from timestamptz not null default now(),
  valid_until timestamptz,                             -- deadline/promise için
  source_message_ids uuid[] not null check (cardinality(source_message_ids) >= 1),  -- KANIT: kaynak mesajlar
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  status text not null default 'active' check (status in ('active','expired','retracted','approved')),
  approved_by uuid references public.persons(id),      -- instructor_statement için zorunlu (not/devamsızlık)
  extractor_model text not null,
  extracted_at timestamptz not null default now(),
  embedding vector(768),
  check (kind <> 'instructor_statement' or status <> 'approved' or approved_by is not null)
);
create index memory_facts_person_idx on public.memory_facts(person_id, status, valid_from desc);
create index memory_facts_embedding_idx on public.memory_facts using hnsw (embedding vector_cosine_ops);

create table public.weekly_summaries (                -- Katman 3
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  week_start date not null,
  text text not null,
  fact_ids uuid[] not null default '{}',
  model text not null, cost_usd numeric(8,5),
  created_at timestamptz not null default now(),
  unique (enrollment_id, week_start)
);

create table public.bot_responses (                   -- her bot cevabı
  id uuid primary key default gen_random_uuid(),
  incoming_message_id uuid references public.messages(id),
  reply_telegram_message_id bigint,
  telegram_chat_id bigint not null,
  person_id uuid references public.persons(id),
  enrollment_id uuid references public.enrollments(id),
  intent text not null,                                -- 'tutor','quiz_feedback','handoff','quota','consent','command','proactive'
  mode text check (mode in ('socratic','direct')),
  prompt_text text,                                    -- TEMİZLENMİŞ tam prompt; 30 gün sonra null'lanır (retention)
  prompt_hash text not null,
  memory_fact_ids uuid[] not null default '{}',
  recent_message_ids uuid[] not null default '{}',
  provider text, model text,
  input_tokens int, output_tokens int, cost_usd numeric(9,6) not null default 0,
  latency_ms int,
  fallback_chain jsonb not null default '[]',          -- [{"provider":"gemini-paid","status":429},{"provider":"groq","status":200}]
  schema_valid boolean,                                -- yapılandırılmış çıktı doğrulandı mı
  flagged boolean not null default false,
  flagged_by uuid references public.persons(id), flagged_at timestamptz, flag_reason text,
  review_week date,                                    -- haftalık örneklem
  created_at timestamptz not null default now()
);
create index bot_responses_chat_idx on public.bot_responses(telegram_chat_id, created_at desc);
create index bot_responses_flag_idx on public.bot_responses(review_week) where flagged;

create table public.escalations (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null,
  message_id uuid references public.messages(id),
  enrollment_id uuid references public.enrollments(id),
  reason text not null check (reason in ('unsure','human_requested','forbidden_topic','quota_exhausted_urgent')),
  assigned_person_id uuid references public.persons(id),
  status text not null default 'open' check (status in ('open','answered','dismissed')),
  opened_at timestamptz not null default now(),
  answered_at timestamptz,
  answered_by uuid references public.persons(id)
);
create index escalations_open_idx on public.escalations(status, opened_at) where status='open';

create table public.instructor_alerts (               -- panel satırları (kulaklik_batch + saatlik cron üretir)
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id),
  enrollment_id uuid references public.enrollments(id),
  kind text not null check (kind in ('unanswered','silent','morale','deadline','response')),
  severity text not null check (severity in ('danger','warning','neutral')),
  detail text not null,                                -- tek cümle
  since timestamptz not null,
  evidence jsonb not null default '{}',                -- {"message_id":"...","fact_id":"..."}
  computed_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (cohort_id, enrollment_id, kind, since)
);

create table public.proactive_messages (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  telegram_chat_id bigint not null,
  scheduled_for timestamptz not null,
  reason text not null,                                -- 'exam_tomorrow','silent_3d','deadline_near'
  fact_id uuid references public.memory_facts(id),
  text text not null,
  sent_at timestamptz, skipped_reason text
);
create index proactive_due_idx on public.proactive_messages(scheduled_for) where sent_at is null;

create table public.quota_policies (
  id text primary key,                                 -- 'default','pilot'
  messages_per_day int not null default 25,
  tests_per_day int not null default 5,
  research_per_week int not null default 2,
  warn_at_remaining int not null default 5
);

create table public.usage_counters (
  person_id uuid not null references public.persons(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('message','test','research','proactive')),
  count int not null default 0,
  primary key (person_id, day, kind)
);

create table public.spend_ledger (                    -- her model çağrısı bir satır
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  day date not null default (now() at time zone 'Europe/Istanbul')::date,
  provider text not null, model text not null,
  purpose text not null,                               -- 'tutor','extract_facts','lesson_analysis','figure_vision','question_gen','embedding','research'
  input_tokens int not null default 0, output_tokens int not null default 0,
  cost_usd numeric(9,6) not null default 0,
  ref_table text, ref_id uuid                          -- bot_responses / lesson_analyses / items ...
);
create index spend_day_idx on public.spend_ledger(day, provider);

create table public.spend_caps (
  scope text primary key check (scope in ('daily','monthly')),
  alert_usd numeric(8,2) not null,                     -- 1.00 / 15.00
  hard_cap_usd numeric(8,2) not null,                  -- 2.00 / 25.00
  notified_on date
);
```

#### Ders videosu

```sql
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  instructor_id uuid not null references public.persons(id),
  held_at timestamptz not null, duration_min int,
  raw_video_path text,                                 -- storage: lessons-raw/<id>.mp4 (30 gün)
  raw_video_deleted_at timestamptz,
  deletion_notified_at timestamptz,                    -- öğrenci ve veliye bildirildi
  transcript_path text,                                -- storage: lessons-transcripts/<id>.jsonl (kalır; etiketli, isimsiz)
  frames_path text,
  status text not null default 'uploaded' check (status in ('uploaded','processing','analyzed','approved','rejected','failed')),
  created_at timestamptz not null default now()
);

create table public.lesson_analyses (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  version int not null default 1,
  model text not null, cost_usd numeric(8,5) not null default 0,
  seed_profile jsonb not null,                         -- analiz promptuna verilen profil anlık görüntüsü (kümülatiflik)
  output jsonb not null,                               -- lesson_analysis.schema.json'a uygun (tetikleyici ile Ajv değil; pg_jsonschema varsa check, yoksa batch doğrular)
  status text not null default 'draft' check (status in ('draft','approved','corrected','rejected')),
  approved_by uuid references public.persons(id), approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lesson_id, version)
);

create table public.lesson_claims (                   -- analizden çıkan her iddia ayrı satır; onaylanınca observation olur
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.lesson_analyses(id) on delete cascade,
  kind text not null check (kind in ('skill_mastery','misconception','question','hesitation','homework','promise','next_step')),
  skill_id uuid references public.skills(id),
  misconception_tag_id uuid references public.misconception_tags(id),
  value jsonb not null,                                -- {"mastery":0.6} | {"text":"..."} | {"due":"2026-10-25"}
  quote text not null,                                 -- transkriptten alıntı (ÖĞRENCİ/EĞİTMEN etiketli)
  t_start_sec int not null, t_end_sec int,
  speaker text not null check (speaker in ('ÖĞRENCİ','EĞİTMEN')),
  status text not null default 'pending' check (status in ('pending','approved','edited','rejected')),
  edited_value jsonb,
  decided_by uuid references public.persons(id), decided_at timestamptz
);
create index lesson_claims_analysis_idx on public.lesson_claims(analysis_id, status);
```

#### Kalem (sınav modelleme) ve Kitap (araştırma)

```sql
create table public.courses (                         -- üniversite dersi / TYT alt alanı
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid references public.cohorts(id),
  curriculum_id uuid references public.curricula(id),
  title text not null,
  instructor_label text                                -- 'Hoca-A' (gerçek ad secure'da değil; hiç saklanmaz)
);

create table public.syllabus_topics (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  week int, title text not null, skill_ids uuid[] not null default '{}'
);

create table public.exam_sources (                    -- geçmiş sınav belgesi; yalnız eğitmen arşivi
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  year int not null, term text not null check (term in ('vize','final','but','deneme','diger')),
  storage_path text not null,                          -- storage: exam-archive/ (yalnız instructor/coordinator imzalı URL)
  provenance text not null,                            -- 'öğrenci paylaşımı, hocanın yayımladığı' — meşru kaynak beyanı
  uploaded_by uuid not null references public.persons(id),
  status text not null default 'uploaded' check (status in ('uploaded','ocr_done','clustered','failed')),
  created_at timestamptz not null default now()
);

create table public.exam_items (                      -- soru metni ÖĞRENCİYE ASLA; RLS yalnız instructor/coordinator
  id uuid primary key default gen_random_uuid(),
  exam_source_id uuid not null references public.exam_sources(id) on delete cascade,
  ordinal int not null,
  topic text not null, kind text not null check (kind in ('proof','calc','mcq','other')),
  points numeric(5,2),
  skill_ids uuid[] not null default '{}',
  ocr_text text not null,                              -- kümeleme için; yeniden yayınlanmaz
  embedding vector(768),
  cluster_id uuid references public.exam_clusters(id)
);
create index exam_items_embedding_idx on public.exam_items using hnsw (embedding vector_cosine_ops);

create table public.exam_clusters (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  label text not null,                                 -- 'kısmi integrasyon'
  kind text,
  years_hit int[] not null default '{}', years_total int not null,
  avg_points numeric(5,2),
  skill_ids uuid[] not null default '{}',
  computed_at timestamptz not null default now()
);

create table public.priority_plans (                  -- öğrenciye gösterilen: yalnız istatistik + özgün varyant item_id'leri
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  rows jsonb not null,                                 -- priority_plan.schema.json
  status text not null default 'draft' check (status in ('draft','approved')),
  approved_by uuid references public.persons(id), approved_at timestamptz,
  generated_at timestamptz not null default now()
);

create table public.research_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  query text not null, expanded_queries text[] not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  cost_usd numeric(8,5) not null default 0,
  created_at timestamptz not null default now()
);

create table public.research_outputs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.research_requests(id) on delete cascade,
  synthesis_md text not null,                          -- her cümle [n] ile citations'a bağlı
  matrix jsonb not null,                               -- literatür matrisi
  bibtex text not null, apa text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table public.citations (
  id uuid primary key default gen_random_uuid(),
  output_id uuid not null references public.research_outputs(id) on delete cascade,
  ordinal int not null,
  doi text, title text not null, authors text, venue text, year int,
  crossref_status text not null default 'pending' check (crossref_status in ('pending','verified','unresolved','no_doi')),
  verified_at timestamptz,
  pdf_url text, tldr text,
  deleted_at timestamptz                               -- unresolved → batch siler (hard delete 7 gün sonra)
);
-- Görünüm: public.citations_student (where crossref_status in ('verified','no_doi') and deleted_at is null) — öğrenci RLS'i bu görünüm üzerinden.

create table public.library_documents (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid references public.cohorts(id),
  title text not null, storage_path text not null, pages int, uploaded_by uuid references public.persons(id)
);
create table public.library_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.library_documents(id) on delete cascade,
  page int, text text not null, embedding vector(768)
);
create index library_chunks_embedding_idx on public.library_chunks using hnsw (embedding vector_cosine_ops);
```

#### Denetim

```sql
create table audit.events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_role text not null,                            -- current_setting('request.jwt.claims')->>'role'
  actor_person_id uuid,
  action text not null,                                -- 'INSERT','UPDATE','DELETE','RPC:submit_answer','RPC:approve_lesson_analysis'
  table_name text not null, row_id text,
  diff jsonb                                           -- {before:{...}, after:{...}} PII sütunları hariç
);
-- audit_row() tetikleyicisi şu tablolarda: consents, memberships, items(verification_status), figures(review_status),
-- misconceptions(status), lesson_analyses(status), lesson_claims(status), bot_responses(flagged), memory_facts(status), spend_caps, settings, retention_policies.
```

### 3.3 RLS politikaları ve GRANT matrisi

Yardımcı fonksiyonlar (`0011_functions.sql`, hepsi `stable`, `security definer`, `set search_path = public, secure, pg_temp`):

```sql
create function public.jwt_role() returns text language sql stable as
$$ select coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', current_user) $$;

create function public.current_person_id() returns uuid language sql stable security definer as
$$ select person_id from secure.auth_links where auth_user_id = auth.uid() $$;

-- Kişinin bir kohortta verilen rollerden birine sahip olup olmadığı
create function public.has_cohort_role(p_cohort uuid, p_roles text[]) returns boolean language sql stable as
$$ select exists (select 1 from public.memberships m
                  where m.person_id = public.current_person_id() and m.cohort_id = p_cohort
                    and m.active and m.role = any(p_roles)) $$;

-- Bir enrollment'ı görebilir mi: öğrencinin kendisi, ya da kohortta instructor(branş uyumlu)/coordinator/observer
create function public.can_view_enrollment(p_enrollment uuid) returns boolean language sql stable as
$$ select exists (
     select 1 from public.enrollments e
     left join public.cohorts c on c.id = e.cohort_id
     where e.id = p_enrollment and (
       e.student_id = public.current_person_id()
       or exists (select 1 from public.memberships m
                  where m.person_id = public.current_person_id() and m.cohort_id = e.cohort_id and m.active
                    and (m.role in ('coordinator','observer')
                         or (m.role = 'instructor' and (m.subject is null or m.subject = c.subject))))
     )) $$;

-- Düzenleyebilir mi: instructor (branş) veya coordinator; observer hayır
create function public.can_edit_enrollment(p_enrollment uuid) returns boolean language sql stable as
$$ select exists (
     select 1 from public.enrollments e join public.cohorts c on c.id = e.cohort_id
     join public.memberships m on m.cohort_id = e.cohort_id and m.active
     where e.id = p_enrollment and m.person_id = public.current_person_id()
       and (m.role = 'coordinator' or (m.role = 'instructor' and (m.subject is null or m.subject = c.subject)))) $$;
```

Politika deseni — her tabloda `enable row level security` + `force row level security` (tablo sahibi bile atlayamaz). `bot_worker` ve `batch_worker` için politikalar `jwt_role()` ile ayrılır; `authenticated` için uygulama rolü `memberships` üzerinden. Aşağıdaki matris implementer için kesin spesifikasyondur (S = `authenticated` öğrenci, I = instructor, C = coordinator, O = observer, B = `bot_worker`, W = `batch_worker`; `—` yok, `R` select, `I` insert, `U` update, `D` delete, `RPC` yalnız fonksiyon üzerinden):

| Tablo | S | I | C | O | B | W |
| --- | --- | --- | --- | --- | --- | --- |
| persons | R kendi | R kohort üyeleri | R kohort üyeleri | R kohort | R | R |
| consents | R kendi | R kohort | R/I/U kohort (revoke) | R | I (telegram onayı) · R | R |
| legal_texts, settings, retention_policies, quota_policies | R | R | R (settings/retention U) | R | R | R |
| curricula, skills, skill_prerequisites, misconception_tags, academic_periods | R | R | R | R | R | R · W: I/U (seed dışı güncelleme yok; sadece yeni sürüm ekler) |
| cohorts | R üye | R üye | R/I/U üye | R üye | R | R |
| memberships | R kendi | R kohort | R/I/U/D kohort | R kohort | R | R |
| enrollments | R kendi | R kohort | R/I/U kohort | R kohort | R · I (onboarding) | R |
| chat_bindings | — | R kohort | R/U kohort | R | R/I/U | R |
| observations | R kendi (quote PII-temiz) | R/I kohort (kind=instructor_note; source_type=instructor_note) | R/I kohort | R kohort | I: yalnız RPC `submit_answer`, `log_chat_question` | I: yalnız RPC `apply_lesson_claims` (onaylı claim) |
| mastery | R kendi | R kohort | R kohort | R kohort | R | R · (U yalnız RPC `apply_observation`) |
| mastery_history | R kendi | R kohort | R kohort | R kohort | — | — |
| misconceptions | R kendi (status in open,resolved) | R/U kohort (status geçişleri) | R/U | R | I (pending_review, tag'li) · R | I (pending_review) · R |
| misconception_evidence | R kendi | R/I kohort | R/I | R | I (RPC içinde) | I |
| student_preferences | R/U kendi | R kohort | R/U kohort | R | R/U | R/U |
| instructor_notes | — | R/I kendi kohort | R/I/U | R | R (approved_fact=true olanlar) | R |
| templates | — | R | R/I/U | R | R | R/I/U |
| figures | R (review_status=verified, item üzerinden) | R/U kohort yok → tüm instructor | R/U | R | R (verified) | R/I/U |
| items | R (verification_status=approved) | R tümü · U (review alanları) | R/U | R | R (approved) · I (RPC `pool_or_request`) | R/I/U (reviewed_* sütunları hariç; tetikleyici) |
| secure.answer_keys | — | RPC `peek_answer_key(item_id)` (yalnız I/C, audit'e yazar) | aynı | — | — | RPC `register_answer_key` |
| generation_requests | — | R | R | R | I/R | R/U |
| test_sets | R | R | R/I/U | R | R | R/I |
| test_sessions | R kendi | R kohort | R kohort | R | I/U/R | R |
| attempts | R kendi (is_correct görür — kendi sonucu) | R kohort | R kohort | R | I (chosen) · U yalnız RPC | R |
| messages | — (Telegram'da zaten görür; panelde gösterilmez) | R kohort (text_raw) | R kohort | R kohort (text_llm) | I/R (B text_raw yazar; LLM'e text_llm gider) | R (text_llm yalnız) |
| chat_sessions | — | — | R | — | R/I/U | — |
| memory_facts | R kendi (kind≠instructor_statement veya approved) | R/U kohort (approve/retract) | R/U | R | R (active/approved) | R/I/U |
| weekly_summaries | R kendi | R kohort | R | R | R | R/I |
| bot_responses | — | R kohort · U (flagged, flag_reason) | R/U | R | I | R/U (review_week) |
| escalations | — | R/U kohort (answer) | R/U | R | I/R | R/U |
| instructor_alerts | — | R kohort · U (resolved_at) | R/U | R | — | I/U/D |
| proactive_messages | — | R kohort | R/U | R | R/U | I |
| usage_counters | R kendi | R kohort | R kohort | R | R/I/U | R |
| spend_ledger | — | — | R | — | I | I |
| spend_caps | — | — | R/U | — | R/U(notified_on) | R |
| lessons | R kendi (status, raw_video_deleted_at; yol sütunları hariç) | R/I/U kohort | R/I/U | R | — | R/U |
| lesson_analyses | — (öğrenci taslak görmez; approved olunca mastery/misconceptions üzerinden görür) | R/U kohort (approve via RPC) | R/U | R | — | I/R |
| lesson_claims | — | R/U kohort (status, edited_value) | R/U | R | — | I/R |
| courses, syllabus_topics | R kohort | R/I/U | R/I/U | R | R | R/I/U |
| exam_sources, exam_items, exam_clusters | — (ASLA) | R/I kohort | R/I/U/D | R | — | R/I/U |
| priority_plans | R (status=approved; rows içinde soru metni yok — şema garanti) | R/U | R/U | R | R (approved) | I/U |
| research_requests | R/I kendi (kota RPC) | R kohort | R | R | I/R | R/U |
| research_outputs | R kendi | R | R | R | R | I |
| citations | R kendi, yalnız görünüm `citations_student` | R (hepsi) | R | R | R görünüm | I/U/D |
| library_documents, library_chunks | R kohort | R/I | R/I/U/D | R | R | R/I |
| audit.events | — | — | R kohort (actor_person_id kohort üyesi) | — | — | — |

Sütun düzeyi korumalar (RLS satır seviyesi olduğu için ek tetikleyiciler):

- `attempts_protect_graded`: `is_correct`, `misconception_tag_id`, `graded_at` yalnız `current_setting('ogrenmen.grader', true) = 'on'` iken değişir; bu ayarı yalnız `submit_answer()` kendi gövdesinde `set_config('ogrenmen.grader','on',true)` ile açar (işlem-yerel).
- `items_protect_review`: `reviewed_by/reviewed_at/verification_status='approved'` yalnız `jwt_role()='authenticated'` ve `has_cohort_role(any,'instructor|coordinator')` ile.
- `lesson_analyses.status='approved'` yalnız `approve_lesson_analysis()` RPC'si ile (tetikleyici `current_setting('ogrenmen.approver')` kontrol eder).
- `messages.text_raw` sütununa `batch_worker` için `revoke select (text_raw) on public.messages from batch_worker` — Python asla ham metni görmez; `bot_worker` ham metni yazar ama LLM'e `text_llm` gönderir (kod kuralı + test).
- `secure` şeması: `revoke usage on schema secure from anon, authenticated, bot_worker, batch_worker`. Dolayısıyla `select * from secure.answer_keys` bu rollerle "permission denied for schema secure" verir; pgTAP testi tam bunu bekler.

Temsili tam politika SQL'i (diğer tablolar aynı kalıpla yazılır; implementer matrisi birebir SQL'e çevirir):

```sql
alter table public.mastery enable row level security;
alter table public.mastery force row level security;
create policy mastery_select_human on public.mastery for select to authenticated
  using (public.can_view_enrollment(enrollment_id));
create policy mastery_select_workers on public.mastery for select to bot_worker, batch_worker using (true);
-- insert/update politikası YOK: yalnız security definer apply_observation() yazar.

alter table public.observations enable row level security;
alter table public.observations force row level security;
create policy obs_select_human on public.observations for select to authenticated
  using (public.can_view_enrollment(enrollment_id));
create policy obs_insert_instructor on public.observations for insert to authenticated
  with check (public.can_edit_enrollment(enrollment_id) and source_type = 'instructor_note' and created_by_role = 'instructor');
create policy obs_select_workers on public.observations for select to bot_worker, batch_worker using (true);
-- bot_worker/batch_worker doğrudan insert edemez; RPC'ler security definer olduğu için fonksiyon sahibinin (postgres) yetkisiyle yazar.

alter table public.attempts enable row level security;
alter table public.attempts force row level security;
create policy attempts_select_human on public.attempts for select to authenticated using (public.can_view_enrollment(enrollment_id));
create policy attempts_bot_insert on public.attempts for insert to bot_worker with check (is_correct is null and graded_at is null);
create policy attempts_bot_select on public.attempts for select to bot_worker using (true);
create policy attempts_batch_select on public.attempts for select to batch_worker using (true);

alter table public.messages enable row level security;
alter table public.messages force row level security;
create policy msg_select_staff on public.messages for select to authenticated
  using (exists (select 1 from public.chat_bindings cb where cb.telegram_chat_id = messages.telegram_chat_id
                 and public.has_cohort_role(cb.cohort_id, array['instructor','coordinator','observer'])));
create policy msg_bot_all on public.messages for all to bot_worker using (true) with check (true);
create policy msg_batch_select on public.messages for select to batch_worker using (true);
revoke select (text_raw) on public.messages from batch_worker;

alter table public.exam_items enable row level security;
alter table public.exam_items force row level security;
create policy exam_items_staff on public.exam_items for select to authenticated
  using (exists (select 1 from public.exam_sources s join public.courses c on c.id = s.course_id
                 where s.id = exam_items.exam_source_id and public.has_cohort_role(c.cohort_id, array['instructor','coordinator','observer'])));
create policy exam_items_batch on public.exam_items for all to batch_worker using (true) with check (true);
-- öğrenci ve bot_worker için politika yok ⇒ sıfır satır.
```

GRANT'ler (`0012_rls_grants.sql` sonu): `grant usage on schema public to anon, authenticated, bot_worker, batch_worker; grant select on <tablo listesi> to ...; grant insert (sütun listesi) ...` — matris satırlarıyla birebir. `grant execute on function public.submit_answer to bot_worker;` gibi RPC yetkileri fonksiyon başına verilir; `revoke execute on all functions in schema public from public` ilk satırdır.

### 3.4 SQL fonksiyonları / RPC

#### Kimlik çözme (Worker giriş noktası)

```sql
-- bot_worker: Telegram kimliğinden person_id + enrollment + onay durumu; PII döndürmez
create function public.resolve_telegram(p_telegram_user_id bigint, p_chat_id bigint)
returns table (person_id uuid, kind text, is_minor boolean, enrollment_id uuid, cohort_id uuid,
               consent_ok boolean, role_in_chat text, display_label text)
language plpgsql security definer set search_path = public, secure, pg_temp as $$
begin
  return query
  select p.id, p.kind, p.is_minor, e.id, cb.cohort_id,
         (not p.is_minor and exists(select 1 from consents c where c.person_id=p.id and c.kind='kvkk_aydinlatma' and c.revoked_at is null))
         or (p.is_minor and exists(select 1 from consents c where c.person_id=p.id and c.kind='veli_onayi' and c.revoked_at is null)),
         coalesce((select m.role from memberships m where m.person_id=p.id and m.cohort_id=cb.cohort_id and m.active limit 1), 'unknown'),
         case when p.kind='instructor' then (select split_part(pi.display_name,' ',1)||' Hoca' from secure.person_pii pi where pi.person_id=p.id)
              else null end  -- grupta öğrencinin adı değil Telegram kullanıcı adı kullanılır (worker update'ten alır)
  from secure.telegram_identities ti
  join persons p on p.id = ti.person_id
  left join chat_bindings cb on cb.telegram_chat_id = p_chat_id
  left join enrollments e on e.student_id = p.id and e.status='active'
       and (cb.cohort_id is null or e.cohort_id = cb.cohort_id)
  where ti.telegram_user_id = p_telegram_user_id;
end $$;
grant execute on function public.resolve_telegram to bot_worker;

-- Yeni kullanıcı: rastgele person oluşturur, Telegram kimliğini secure'a yazar
create function public.register_telegram_person(p_telegram_user_id bigint, p_username text, p_kind text, p_is_minor boolean)
returns uuid language plpgsql security definer set search_path = public, secure, pg_temp as $$ ... $$;
grant execute on function public.register_telegram_person to bot_worker;

-- Onay kaydı (veli onayı Telegram'dan: veli kendi hesabından /onay <kod>)
create function public.record_consent(p_person uuid, p_kind text, p_legal_text uuid, p_granted_by uuid, p_evidence jsonb) returns uuid ...;
grant execute on function public.record_consent to bot_worker;
```

#### Bayesian Knowledge Tracing (seçilen güncelleme kuralı; Elo kullanılmaz — ADR-0003)

```sql
-- Saf matematik, LLM yok. correct=true/false ikili gözlem için standart BKT.
create function public.bkt_update(p_prev numeric, p_correct boolean, p_t numeric, p_g numeric, p_s numeric)
returns numeric language sql immutable as $$
  with cond as (
    select case when p_correct
      then (p_prev * (1 - p_s)) / nullif(p_prev * (1 - p_s) + (1 - p_prev) * p_g, 0)
      else (p_prev * p_s)       / nullif(p_prev * p_s       + (1 - p_prev) * (1 - p_g), 0)
    end as p_cond)
  select round(least(0.99999, greatest(0.00001, p_cond + (1 - p_cond) * p_t))::numeric, 5) from cond
$$;
-- Örnek (p_t=.10, p_g=.25, p_s=.10):  p=.20 doğru → .52632 ; p=.20 yanlış → .12903 ; p=.70 doğru → .90426 ; p=.70 yanlış → .31356
-- Bu dört sayı tests/pgtap/40_bkt.sql ve packages/db/tests/logic/bkt.test.ts içinde sabit beklenen değerlerdir.

-- Sürekli kanıt (ders analizi mastery 0–1, confidence c) için harman: p_new = (1-w)·p_prev + w·m,  w = weight·confidence·0.5
-- (tek ders profili ezmesin; 0.5 üst sınır). Ağırlıksız/yanlı gözlem türleri (chat_question) p'yi DEĞİŞTİRMEZ, yalnız evidence_count'u artırmaz,
-- sadece "sorulan konu" olarak kalır (kind='chat_question' → mastery'ye uygulanmaz, applied_at null kalır).

create function public.apply_observation(p_obs uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare o record; s record; m record; p_new numeric; method text; params jsonb;
begin
  select * into o from observations where id = p_obs for update;
  if o.applied_at is not null then return; end if;
  if o.kind = 'chat_question' then update observations set applied_at = now() where id = p_obs; return; end if;
  select * into s from skills where id = o.skill_id;
  select * into m from mastery where enrollment_id = o.enrollment_id and skill_id = o.skill_id for update;
  if not found then
    insert into mastery(enrollment_id, skill_id, p, evidence_count) values (o.enrollment_id, o.skill_id, s.bkt_p_l0, 0) returning * into m;
  end if;
  if o.kind in ('quiz_answer','diagnostic_answer','misconception_resolution') then
    p_new := bkt_update(m.p, (o.value->>'correct')::boolean, s.bkt_p_t, s.bkt_p_g * o.weight + (1-o.weight)*s.bkt_p_g, s.bkt_p_s);
    method := 'bkt'; params := jsonb_build_object('p_t',s.bkt_p_t,'p_g',s.bkt_p_g,'p_s',s.bkt_p_s,'weight',o.weight);
  elsif o.kind in ('lesson_evidence','instructor_note') then
    declare w numeric := least(0.5, o.weight * coalesce((o.value->>'confidence')::numeric, 0.8));
    begin p_new := round((1-w)*m.p + w*(o.value->>'mastery')::numeric, 5); end;
    method := 'blend'; params := jsonb_build_object('w', least(0.5, o.weight * coalesce((o.value->>'confidence')::numeric,0.8)));
  else raise exception 'OGR-MAST-001 bilinmeyen gözlem türü %', o.kind;
  end if;
  insert into mastery_history(enrollment_id, skill_id, observation_id, p_before, p_after, method, params)
    values (o.enrollment_id, o.skill_id, o.id, m.p, p_new, method, params);
  update mastery set p = p_new, evidence_count = evidence_count + 1, last_observation_id = o.id, updated_at = now()
    where enrollment_id = o.enrollment_id and skill_id = o.skill_id;
  update observations set applied_at = now() where id = p_obs;

  -- Ön koşul çıkarımı: yanlış + yanılgı etiketi ön koşul kazanıma işaret ediyorsa, ön koşula ağırlığı 0.5 olan türetilmiş gözlem
  if o.kind in ('quiz_answer','diagnostic_answer') and (o.value->>'correct')::boolean = false and o.misconception_tag_id is not null then
    insert into observations(enrollment_id, skill_id, kind, value, weight, source_type, source_id, source_locator, quote, misconception_tag_id, created_by_role)
    select o.enrollment_id, t.prerequisite_skill_id, o.kind, o.value, 0.5, o.source_type, o.source_id, o.source_locator || ' (ön koşul çıkarımı)', o.quote, o.misconception_tag_id, o.created_by_role
    from misconception_tags t where t.id = o.misconception_tag_id and t.prerequisite_skill_id is not null and t.prerequisite_skill_id <> o.skill_id;
    -- türetilmiş gözlem kendi apply_observation çağrısını tetikleyici (observations_after_insert → pg_notify değil, doğrudan çağrı) ile alır
  end if;
end $$;
```

Kesin teşhis eşiği şemada değil görünümdedir: `public.mastery_view` (`p`, `evidence_count`, `is_reliable = evidence_count >= (select (value)::int from settings where key='min_evidence')`); panel ve bot `is_reliable=false` ise yüzde/iddia yazmaz. Worker promptuna düşük kanıtlı kazanımlar "henüz ölçülmedi" olarak gider, `p` değeri hiç gitmez.

#### Puanlama — cevap anahtarı tek kapı

```sql
create function public.submit_answer(p_attempt uuid, p_chosen jsonb)
returns table (is_correct boolean, misconception_text_student text, feedback_locator text)
language plpgsql security definer set search_path = public, secure, pg_temp as $$
declare a record; k record; it record; correct boolean; tag uuid; obs uuid; sk uuid;
begin
  select * into a from attempts where id = p_attempt for update;
  if a.graded_at is not null then raise exception 'OGR-GRADE-002 zaten puanlandı'; end if;
  select * into it from items where id = a.item_id;
  if it.verification_status <> 'approved' then raise exception 'OGR-GRADE-003 onaysız soru'; end if;
  select * into k from secure.answer_keys where item_id = a.item_id;       -- yalnız burada okunur
  if it.kind = 'mcq' then
    correct := (p_chosen->>'letter') = k.correct_letter;
    if not correct then
      select (opt->>'misconception_tag_id')::uuid into tag from jsonb_array_elements(it.options) opt where opt->>'letter' = p_chosen->>'letter';
    end if;
  elsif it.kind = 'numeric' then
    correct := abs((p_chosen->>'value')::numeric - k.numeric_value) <= k.numeric_tolerance;
  else raise exception 'OGR-GRADE-004 açık uçlu soru burada puanlanmaz'; end if;

  perform set_config('ogrenmen.grader', 'on', true);
  update attempts set chosen = p_chosen, is_correct = correct, misconception_tag_id = tag, graded_at = now(), responded_at = coalesce(responded_at, now())
    where id = p_attempt;

  foreach sk in array it.skill_ids loop
    insert into observations(enrollment_id, skill_id, kind, value, source_type, source_id, source_locator, misconception_tag_id, created_by_role)
    values (a.enrollment_id, sk, case when a.test_session_id is not null and exists(select 1 from test_sessions ts join test_sets t on t.id=ts.test_set_id where ts.id=a.test_session_id and t.kind='diagnostic') then 'diagnostic_answer' else 'quiz_answer' end,
            jsonb_build_object('correct', correct), 'attempt', a.id,
            coalesce((select 'Test '||t.code||' · Soru '||(array_position(t.item_ids, a.item_id))::text from test_sessions ts join test_sets t on t.id=ts.test_set_id where ts.id=a.test_session_id), 'Sohbet sorusu '||left(a.id::text,8)),
            tag, 'grader')
    returning id into obs;
    perform apply_observation(obs);
  end loop;

  if tag is not null then
    -- yanılgı kaydı: var olan 'open'/'pending_review' kaydı güncelle, yoksa pending_review olarak aç; kanıt bağla
    insert into misconceptions(enrollment_id, skill_id, tag_id, text_instructor, text_student)
    select a.enrollment_id, coalesce(t.skill_id, it.skill_ids[1]), t.id, t.text_instructor, t.text_student from misconception_tags t where t.id = tag
    on conflict do nothing;  -- (enrollment_id, tag_id) where status in ('pending_review','open') kısmi unique index
    insert into misconception_evidence(misconception_id, observation_id)
    select m.id, obs from misconceptions m where m.enrollment_id = a.enrollment_id and m.tag_id = tag and m.status in ('pending_review','open');
  end if;

  insert into audit.events(actor_role, actor_person_id, action, table_name, row_id, diff)
    values (jwt_role(), null, 'RPC:submit_answer', 'attempts', p_attempt::text, jsonb_build_object('correct', correct));

  return query select correct, (select text_student from misconception_tags where id = tag), 'attempt:'||p_attempt::text;
end $$;
grant execute on function public.submit_answer to bot_worker, authenticated;
-- DÖNÜŞ DEĞERİNDE DOĞRU ŞIK YOKTUR. Doğru şıkkı göstermek (/cevap modu) ayrı RPC: public.reveal_solution(p_attempt) → yalnız graded_at not null VE
-- (mode='direct' OR is_correct) ise solution_md döner; aksi hâlde 'OGR-GRADE-005 önce cevap ver'. Böylece LLM yolu anahtarı yalnız öğrenci cevapladıktan sonra, öğrencinin kendi isteğiyle görür.

-- batch_worker anahtar yazımı: sympy_verified zorunlu, aksi hâlde item review_pending'de kalır
create function public.register_answer_key(p_item uuid, p_key jsonb, p_sympy_verified boolean) returns void
language plpgsql security definer set search_path = public, secure, pg_temp as $$
begin
  if jwt_role() <> 'batch_worker' then raise exception 'OGR-KEY-001'; end if;
  insert into secure.answer_keys(item_id, correct_letter, numeric_value, numeric_tolerance, canonical_expr, solution_md, sympy_verified, verified_at, created_by_role)
  values (p_item, p_key->>'correct_letter', (p_key->>'numeric_value')::numeric, coalesce((p_key->>'numeric_tolerance')::numeric,0), p_key->>'canonical_expr', p_key->>'solution_md', p_sympy_verified, case when p_sympy_verified then now() end, 'batch_worker')
  on conflict (item_id) do update set correct_letter=excluded.correct_letter, numeric_value=excluded.numeric_value, numeric_tolerance=excluded.numeric_tolerance,
    canonical_expr=excluded.canonical_expr, solution_md=excluded.solution_md, sympy_verified=excluded.sympy_verified, verified_at=excluded.verified_at;
  update items set key_verified = p_sympy_verified, verification_status = case when p_sympy_verified then 'auto_checked' else 'review_pending' end where id = p_item and verification_status in ('draft','auto_checked','review_pending');
end $$;
grant execute on function public.register_answer_key to batch_worker;

-- Eğitmen anahtarı görür (inceleme için); her çağrı audit'e yazılır
create function public.peek_answer_key(p_item uuid) returns jsonb ... -- yalnız authenticated + has_cohort_role(any,'instructor','coordinator'); audit.events 'RPC:peek_answer_key'
```

#### Havuz yeniden kullanımı, hafıza, ders onayı, kota

```sql
-- "40 öğrenci 1 çağrı": onaylı havuzdan öğrencinin görmediği bir soru ver; yoksa üretim isteği aç
create function public.pool_or_request(p_enrollment uuid, p_skill uuid, p_band text) returns uuid ... ; grant to bot_worker;

-- pgvector hafıza erişimi: ilgili olgular + son mesajlar; yalnız LLM'e gidebilecek alanlar
create function public.retrieve_context(p_person uuid, p_chat bigint, p_query vector(768), p_k int default 6, p_recent int default 8)
returns table (facts jsonb, recent jsonb)
language sql security definer set search_path = public, pg_temp as $$
  select
    (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'text', f.text, 'valid_until', f.valid_until, 'approved', f.status='approved') order by f.embedding <=> p_query), '[]')
       from (select * from memory_facts where person_id = p_person and status in ('active','approved') and (valid_until is null or valid_until > now() - interval '7 days')
             order by embedding <=> p_query limit p_k) f),
    (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'role', m.sender_role, 'text', m.text_llm, 'at', m.sent_at) order by m.sent_at), '[]')
       from (select * from messages where telegram_chat_id = p_chat and text_llm is not null order by sent_at desc limit p_recent) m)
$$;
grant execute on function public.retrieve_context to bot_worker;

-- Ders analizi onayı: onaylanan claim'ler observation/misconception olur; taslak profile işlenmez
create function public.approve_lesson_analysis(p_analysis uuid, p_decisions jsonb) returns int
-- p_decisions: [{"claim_id":"...","status":"approved|edited|rejected","edited_value":{...}}]
-- yalnız authenticated + can_edit_enrollment; set_config('ogrenmen.approver','on',true); approved/edited claim başına:
--   skill_mastery → observations(kind='lesson_evidence', value={mastery,confidence}, source_type='lesson_claim', source_id=claim.id, source_locator='Ders <n> · mm:ss', quote)
--   misconception → misconceptions(pending_review→open çünkü eğitmen onayladı) + misconception_evidence(observation lesson_evidence correct=false)
--   homework/promise → memory_facts(kind='deadline'/'promise', source_message_ids = '{}' YASAK ⇒ bu tür için source lesson: memory_facts.source_lesson_claim_id sütunu eklenir (0009'da), check (cardinality(source_message_ids)>=1 or source_lesson_claim_id is not null))
-- lesson_analyses.status → 'approved' ya da 'corrected'; lessons.status → 'approved'; audit.

-- Kota: atomik artır ve kalan döndür
create function public.consume_quota(p_person uuid, p_kind text) returns table (allowed boolean, used int, "limit" int, remaining int)
language plpgsql security definer ... -- usage_counters upsert; quota_policies 'default'; gün Europe/Istanbul
grant execute on function public.consume_quota to bot_worker;

-- Harcama kapısı
create function public.spend_status() returns table (day_usd numeric, month_usd numeric, daily_alert boolean, daily_cap boolean, monthly_alert boolean, monthly_cap boolean) ...; grant to bot_worker, batch_worker, authenticated;
```

### 3.5 Saklama ve silme işleri

`retention_policies` seed satırları (süreler `settings` ile de eşlenir; `legal/` metinleri bu tablodan üretilen `saklama-sureleri.md`'yi kaynak alır):

| id | tablo.sütun | gün | mod | kullanıcıya gösterilen |
| --- | --- | --- | --- | --- |
| `messages.hard_delete` | messages.sent_at | 90 | delete | "Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve 90 gün sonra silinir." |
| `bot_responses.prompt_null` | bot_responses.created_at | 30 | null_columns [prompt_text] | — |
| `bot_responses.hard_delete` | bot_responses.created_at | 365 | delete | — |
| `lessons.raw_video` | lessons.held_at | 30 | anonymize (storage obje silinir, `raw_video_deleted_at` yazılır, `proactive_messages` ile öğrenci+veliye bildirim kuyruğa) | "Ders kaydının videosu 30 gün sonra silinir; isimsiz transkript kalır." |
| `memory_facts.expire` | memory_facts.valid_until | 0 | anonymize (status='expired') | — |
| `memory_facts.hard_delete` | memory_facts.extracted_at | 365 | delete | — |
| `research_citations.unresolved` | citations.verified_at (crossref_status='unresolved') | 7 | delete | — |
| `audit.events` | at | 730 | delete | — |
| `usage_counters` | day | 400 | delete | — |

`public.run_retention()` (security definer, yalnız `pg_cron` ve `batch_worker` çağırır): politikaları okur, her biri için dinamik SQL üretir (`format('delete from %I.%I where %I < now() - make_interval(days => %s)', ...)`), silinen satır sayısını `audit.events`'e yazar. Storage nesneleri (video, PDF) Postgres'ten silinemediği için `lessons.raw_video` politikası satırı `storage_deletions` kuyruğuna (`public.storage_deletions(path, requested_at, done_at)`) yazar; Worker'daki saatlik cron Supabase Storage API ile siler ve `done_at` işler. Yedek: GitHub Actions `nightly.yml` içinde `kulaklik_batch retention --report` aynı fonksiyonu çağırır ve kalan kuyruğu loglar.

KVKK silme talebi: `public.erase_person(p_person)` (yalnız coordinator): `persons.status='erased'`, `secure.person_pii`, `secure.telegram_identities`, `secure.auth_links` satırları silinir, `messages.text_raw/text_llm` null'lanır, `memory_facts`/`weekly_summaries`/`bot_responses.prompt_text` silinir; `attempts`/`observations`/`mastery` rastgele kimlikle kalır (artık kişiyle ilişkilendirilemez — ADR-0004, hukuki inceleme konusu).

### 3.6 Seed stratejisi

- **Müfredat seed'i** (`supabase/seed.sql`): `scripts/build-seed.ts`, `content/tyt-matematik/{curriculum,skills,misconception-tags,diagnostic-v1,templates/*}.yaml` okur, deterministik UUID üretir (`uuid5(NAMESPACE_OGRENMEN, code)` — tekrar çalıştırmak aynı kimlikleri verir), `insert ... on conflict (curriculum_id, code) do update` yazar. `items` için `source='diagnostic'`, `verification_status='approved'`, `key_verified=true` (teşhis testi insan eliyle yazıldığı için).
- **Anahtar seed'i** (`supabase/seed.secure.sql`): `diagnostic-v1.keys.yaml` → `secure.answer_keys`; yalnız `service_role`/migrasyon kullanıcısı uygular; CI artefaktı olarak yayınlanmaz (`.gitignore`'da değil, ama panel/worker build'lerine kopyalanmaz).
- **Geliştirme seed'i** (`supabase/seed.dev.sql`, yalnız yerel): 1 kohort, 3 öğrenci (2'si reşit değil, 1'i veli onaylı), 1 eğitmen, 1 koordinatör, sahte Telegram kimlikleri (`900000001…`), 40 mesaj, 12 attempt, 1 ders analizi taslağı. Aynı veri `apps/bot-worker/test/fixtures/seed.json` ve `apps/egitmen-paneli/mocks/*.json` ile **aynı kaynak dosyadan** (`packages/db/seed/dev.yaml`) üretilir: `bun run build:seed` üç çıktıyı da yazar; böylece fake DB, mock panel ve pgTAP aynı dünyayı görür.
- Settings seed: `min_evidence=5`, `quota.messages=25`, `quota.tests=5`, `quota.research_per_week=2`, `retention.*` (tablodan), `spend_caps` daily 1,00/2,00 $, monthly 15/25 $.

---

## 4. Sözleşmeler

Konum: `/home/user/alperen/packages/contracts/schemas/`. Taslak: JSON Schema **2020-12**. Her şema `$id: "https://ogrenmen.easy/schemas/<ad>.schema.json"` taşır; şemalar birbirine `$ref` ile bağlanır (`common.schema.json` içindeki `uuid`, `isoDateTime`, `skillCode`).

Tüketim:

- **TypeScript:** `bun run gen` → `src/generated.d.ts` (json-schema-to-typescript, `additionalProperties:false` korunur). `src/index.ts` Ajv 8 (`ajv/dist/2020`, `ajv-formats`) ile her şema için derlenmiş `validate.<camelCase>` dışa aktarır. Worker ve panel `import { validate, type QuestionItem } from '@ogrenmen/contracts'`.
- **Python:** `python/ogrenmen_contracts/__init__.py`: `SCHEMAS = load_all()` (paket içine `schemas/` symlink değil, `pyproject` `[tool.setuptools.package-data]` ile kopyalanır), `validate(name, obj)` → `jsonschema.Draft202012Validator`. Pydantic yok; boru hatları `dict` üretir ve çıkışta doğrular. Sağlayıcıya verilen `response_schema` da **aynı dosyadan** okunur (Gemini için `$ref` çözülmüş, `$id` kaldırılmış hâli `to_provider_schema(name)` ile; `scripts/flatten.py`).
- **Fikstürler:** `fixtures/<ad>/valid/*.json`, `fixtures/<ad>/invalid/*.json`; her iki dilin testi bunları okur.
- **Sürümleme:** her şemada `"x-version": "1.0"`; kırıcı değişiklik yeni dosya (`question_item.v2.schema.json`) ve DB satırına `schema_version` kolonu (ör. `lesson_analyses.output->>'schema_version'`).

### 4.1 `common.schema.json`

```json
{ "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://ogrenmen.easy/schemas/common.schema.json",
  "$defs": {
    "uuid": { "type": "string", "format": "uuid" },
    "isoDateTime": { "type": "string", "format": "date-time" },
    "skillCode": { "type": "string", "pattern": "^[A-Z0-9]+(\\.[A-Z0-9_]+)+$" },
    "misconceptionCode": { "type": "string", "pattern": "^[A-Z0-9_]+(\\.[A-Z0-9_]+)+$" },
    "probability": { "type": "number", "minimum": 0, "maximum": 1 },
    "speaker": { "type": "string", "enum": ["ÖĞRENCİ", "EĞİTMEN"] },
    "evidenceRef": { "type": "object", "additionalProperties": false, "required": ["kind", "source", "quote"],
      "properties": { "kind": { "enum": ["lesson", "quiz", "chat", "instructor"] }, "source": { "type": "string", "minLength": 3 },
                      "quote": { "type": "string", "minLength": 1, "maxLength": 600 }, "href": { "type": "string" },
                      "observation_id": { "$ref": "#/$defs/uuid" } } },
    "usd": { "type": "number", "minimum": 0 }
  } }
```

### 4.2 `question_item.schema.json` — soru maddesi (anahtar AYRI)

```json
{ "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://ogrenmen.easy/schemas/question_item.schema.json",
  "title": "QuestionItem", "x-version": "1.0", "type": "object", "additionalProperties": false,
  "required": ["schema_version", "kind", "stem", "skill_codes", "source", "verification_status", "figure"],
  "properties": {
    "schema_version": { "const": "1.0" },
    "id": { "$ref": "common.schema.json#/$defs/uuid" },
    "curriculum_code": { "type": "string", "examples": ["TYT-MAT@2026.1"] },
    "kind": { "enum": ["mcq", "numeric", "open"] },
    "stem": { "type": "string", "minLength": 10, "maxLength": 1200, "description": "Soru kökü; Telegram'da şekil altyazısı olur, şekli kelimelerle de anlatır." },
    "figure": { "oneOf": [ { "type": "null" }, { "type": "object", "additionalProperties": false, "required": ["engine", "code", "alt_text"],
        "properties": { "engine": { "enum": ["matplotlib", "svg", "tikz", "vegalite", "schemdraw", "rdkit", "graphviz", "latex"] },
                        "code": { "type": "string", "minLength": 1, "maxLength": 20000 },
                        "alt_text": { "type": "string", "minLength": 10, "maxLength": 400 },
                        "expected_values": { "type": "object", "description": "Vision denetiminin köke karşı kontrol edeceği sayılar: {\"AB\": \"12 cm\", \"açı A\": \"θ\"}", "additionalProperties": { "type": "string" } },
                        "render": { "type": "object", "additionalProperties": false, "properties": {
                            "status": { "enum": ["pending", "rendered", "render_failed"] }, "storage_path": { "type": "string" },
                            "width": { "type": "integer" }, "height": { "type": "integer" }, "bytes": { "type": "integer" },
                            "vision_status": { "enum": ["pending", "passed", "failed", "skipped"] }, "attempts": { "type": "integer", "minimum": 0, "maximum": 3 } } } } } ] },
    "options": { "type": "array", "minItems": 4, "maxItems": 5, "items": { "type": "object", "additionalProperties": false, "required": ["letter", "text", "misconception_code"],
        "properties": { "letter": { "enum": ["A", "B", "C", "D", "E"] }, "text": { "type": "string", "minLength": 1, "maxLength": 300 },
                        "misconception_code": { "oneOf": [ { "type": "null", "description": "null = doğru şık ya da etiketsiz çeldirici; DOĞRU ŞIK BU DOSYADAN ÇIKARILAMAZ çünkü doğru şık da null taşır ve en az bir çeldirici de null olabilir" }, { "$ref": "common.schema.json#/$defs/misconceptionCode" } ] } } } },
    "skill_codes": { "type": "array", "minItems": 1, "maxItems": 3, "items": { "$ref": "common.schema.json#/$defs/skillCode" } },
    "difficulty": { "$ref": "common.schema.json#/$defs/probability" },
    "source": { "enum": ["llm", "template", "instructor", "diagnostic"] },
    "template": { "type": "object", "additionalProperties": false, "properties": { "code": { "type": "string" }, "params": { "type": "object" } } },
    "generation": { "type": "object", "additionalProperties": false, "properties": { "model": { "type": "string" }, "cost_usd": { "$ref": "common.schema.json#/$defs/usd" }, "prompt_hash": { "type": "string" } } },
    "verification_status": { "enum": ["draft", "auto_checked", "review_pending", "approved", "rejected"] },
    "key_verified": { "type": "boolean", "description": "secure.answer_keys.sympy_verified kopyası; anahtarın kendisi burada yok" },
    "review": { "type": "object", "additionalProperties": false, "properties": { "note": { "type": "string" }, "reviewed_at": { "$ref": "common.schema.json#/$defs/isoDateTime" } } }
  },
  "allOf": [ { "if": { "properties": { "kind": { "const": "mcq" } } }, "then": { "required": ["options"] } },
             { "if": { "properties": { "verification_status": { "const": "approved" } } }, "then": { "properties": { "key_verified": { "const": true } }, "required": ["key_verified"] } } ] }
```

`answer_key.schema.json` ayrı dosyadır ve yalnız `register_answer_key` RPC girdisi ile `diagnostic-v1.keys.yaml` için kullanılır; Worker paketine import edilmez (contracts `exports` alanı `./answer-key` alt yolunu yalnız `pipelines/` için açar; ESLint `no-restricted-imports` kuralı Worker'da bu yolu yasaklar):

```json
{ "$id": "https://ogrenmen.easy/schemas/answer_key.schema.json", "title": "AnswerKey", "type": "object", "additionalProperties": false,
  "required": ["item_id", "solution_md", "sympy_verified"],
  "properties": { "item_id": { "$ref": "common.schema.json#/$defs/uuid" }, "correct_letter": { "enum": ["A","B","C","D","E"] },
    "numeric_value": { "type": "number" }, "numeric_tolerance": { "type": "number", "minimum": 0 }, "canonical_expr": { "type": "string" },
    "solution_md": { "type": "string", "minLength": 10 }, "sympy_verified": { "type": "boolean" } },
  "oneOf": [ { "required": ["correct_letter"] }, { "required": ["numeric_value"] } ] }
```

### 4.3 `lesson_analysis.schema.json` — ders videosu analiz çıktısı (güçlü model, zorunlu şema)

```json
{ "$id": "https://ogrenmen.easy/schemas/lesson_analysis.schema.json", "title": "LessonAnalysis", "x-version": "1.0", "type": "object", "additionalProperties": false,
  "required": ["schema_version", "lesson_id", "skills", "questions", "hesitations", "misconceptions", "commitments", "talk", "next_step"],
  "properties": {
    "schema_version": { "const": "1.0" },
    "lesson_id": { "$ref": "common.schema.json#/$defs/uuid" },
    "skills": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["skill_code", "mastery", "confidence", "evidence"],
      "properties": { "skill_code": { "$ref": "common.schema.json#/$defs/skillCode" }, "mastery": { "$ref": "common.schema.json#/$defs/probability" },
                      "confidence": { "$ref": "common.schema.json#/$defs/probability" },
                      "evidence": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/timedQuote" } } } } },
    "questions": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["quote", "t_sec", "skill_code"],
      "properties": { "quote": { "type": "string" }, "t_sec": { "type": "integer", "minimum": 0 }, "skill_code": { "oneOf": [ { "type": "null" }, { "$ref": "common.schema.json#/$defs/skillCode" } ] }, "answered": { "type": "boolean" } } } },
    "hesitations": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["kind", "t_sec", "quote"],
      "properties": { "kind": { "enum": ["said_dont_understand", "long_silence", "wrong_answer", "asked_repeat"] }, "t_sec": { "type": "integer" }, "quote": { "type": "string" }, "skill_code": { "$ref": "common.schema.json#/$defs/skillCode" } } } },
    "misconceptions": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["text_instructor", "evidence"],
      "properties": { "misconception_code": { "oneOf": [ { "type": "null" }, { "$ref": "common.schema.json#/$defs/misconceptionCode" } ] }, "skill_code": { "$ref": "common.schema.json#/$defs/skillCode" },
                      "text_instructor": { "type": "string", "maxLength": 200 }, "text_student": { "type": "string", "maxLength": 200 },
                      "resolved_in_this_lesson": { "type": "boolean" }, "evidence": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/timedQuote" } } } } },
    "commitments": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["by", "kind", "text", "t_sec"],
      "properties": { "by": { "$ref": "common.schema.json#/$defs/speaker" }, "kind": { "enum": ["homework", "promise", "deadline"] }, "text": { "type": "string" }, "due": { "type": "string", "format": "date" }, "t_sec": { "type": "integer" } } } },
    "talk": { "type": "object", "additionalProperties": false, "required": ["student_ratio", "question_count"],
      "properties": { "student_ratio": { "$ref": "common.schema.json#/$defs/probability" }, "question_count": { "type": "integer" }, "attention_notes": { "type": "string", "maxLength": 300 }, "morale_indicator": { "enum": ["up", "flat", "down", "unknown"] } } },
    "next_step": { "type": "object", "additionalProperties": false, "required": ["for_student", "note_for_next_lesson"], "properties": { "for_student": { "type": "string", "maxLength": 400 }, "note_for_next_lesson": { "type": "string", "maxLength": 400 } } },
    "profile_followups": { "type": "array", "description": "Seed profildeki açık yanılgılar için: düzeldi mi?", "items": { "type": "object", "required": ["misconception_id", "status", "evidence"], "properties": { "misconception_id": { "$ref": "common.schema.json#/$defs/uuid" }, "status": { "enum": ["resolved", "persists", "not_observed"] }, "evidence": { "type": "array", "items": { "$ref": "#/$defs/timedQuote" } } } } }
  },
  "$defs": { "timedQuote": { "type": "object", "additionalProperties": false, "required": ["speaker", "quote", "t_start_sec"],
    "properties": { "speaker": { "$ref": "common.schema.json#/$defs/speaker" }, "quote": { "type": "string", "minLength": 3, "maxLength": 400 }, "t_start_sec": { "type": "integer", "minimum": 0 }, "t_end_sec": { "type": "integer" } } } } }
```

### 4.4 `memory_fact.schema.json` ve `weekly_summary.schema.json`

```json
{ "$id": "https://ogrenmen.easy/schemas/memory_fact.schema.json", "title": "MemoryFact", "x-version": "1.0", "type": "object", "additionalProperties": false,
  "required": ["schema_version", "person_id", "kind", "text", "source_message_ids", "confidence"],
  "properties": {
    "schema_version": { "const": "1.0" }, "person_id": { "$ref": "common.schema.json#/$defs/uuid" }, "enrollment_id": { "$ref": "common.schema.json#/$defs/uuid" },
    "kind": { "enum": ["promise", "deadline", "unanswered_question", "morale", "topic_asked", "preference", "instructor_statement"] },
    "text": { "type": "string", "minLength": 5, "maxLength": 300, "description": "PII temizlenmiş; ad, okul, sınıf içermez" },
    "valid_from": { "$ref": "common.schema.json#/$defs/isoDateTime" }, "valid_until": { "$ref": "common.schema.json#/$defs/isoDateTime" },
    "source_message_ids": { "type": "array", "minItems": 1, "items": { "$ref": "common.schema.json#/$defs/uuid" } },
    "confidence": { "$ref": "common.schema.json#/$defs/probability" },
    "requires_approval": { "type": "boolean", "description": "instructor_statement için true; bot onaysız kullanmaz" }
  },
  "if": { "properties": { "kind": { "const": "instructor_statement" } } }, "then": { "properties": { "requires_approval": { "const": true } }, "required": ["requires_approval"] } }
```

```json
{ "$id": "https://ogrenmen.easy/schemas/weekly_summary.schema.json", "title": "WeeklySummary", "x-version": "1.0", "type": "object", "additionalProperties": false,
  "required": ["schema_version", "enrollment_id", "week_start", "text", "fact_ids", "signals"],
  "properties": {
    "schema_version": { "const": "1.0" }, "enrollment_id": { "$ref": "common.schema.json#/$defs/uuid" }, "week_start": { "type": "string", "format": "date" },
    "text": { "type": "string", "maxLength": 900, "description": "Üçüncü tekil, isimsiz, 3-6 cümle" },
    "fact_ids": { "type": "array", "items": { "$ref": "common.schema.json#/$defs/uuid" } },
    "signals": { "type": "object", "additionalProperties": false, "required": ["messages_sent", "active_days", "unanswered_questions", "morale"],
      "properties": { "messages_sent": { "type": "integer" }, "active_days": { "type": "integer", "minimum": 0, "maximum": 7 }, "unanswered_questions": { "type": "integer" },
                      "morale": { "enum": ["up", "flat", "down", "unknown"] }, "topics_asked": { "type": "array", "items": { "$ref": "common.schema.json#/$defs/skillCode" } } } } } }
```

### 4.5 `research_output.schema.json` + `citation.schema.json`

```json
{ "$id": "https://ogrenmen.easy/schemas/citation.schema.json", "title": "Citation", "x-version": "1.0", "type": "object", "additionalProperties": false,
  "required": ["ordinal", "title", "crossref_status"],
  "properties": { "ordinal": { "type": "integer", "minimum": 1 }, "doi": { "type": "string", "pattern": "^10\\.\\d{4,9}/\\S+$" }, "title": { "type": "string" }, "authors": { "type": "string" },
    "venue": { "type": "string" }, "year": { "type": "integer", "minimum": 1800, "maximum": 2100 },
    "crossref_status": { "enum": ["pending", "verified", "unresolved", "no_doi"] }, "verified_at": { "$ref": "common.schema.json#/$defs/isoDateTime" },
    "pdf_url": { "type": "string", "format": "uri" }, "tldr": { "type": "string", "maxLength": 240 }, "source_api": { "enum": ["openalex", "semantic_scholar", "arxiv", "crossref", "manual"] } },
  "allOf": [ { "if": { "properties": { "crossref_status": { "const": "verified" } } }, "then": { "required": ["doi", "verified_at"] } },
             { "if": { "properties": { "crossref_status": { "const": "no_doi" } } }, "then": { "not": { "required": ["doi"] } } } ] }
```

```json
{ "$id": "https://ogrenmen.easy/schemas/research_output.schema.json", "title": "ResearchOutput", "x-version": "1.0", "type": "object", "additionalProperties": false,
  "required": ["schema_version", "request_id", "query", "expanded_queries", "synthesis_md", "citations", "matrix", "bibtex", "apa", "model", "cost_usd"],
  "properties": {
    "schema_version": { "const": "1.0" }, "request_id": { "$ref": "common.schema.json#/$defs/uuid" }, "query": { "type": "string" },
    "expanded_queries": { "type": "array", "minItems": 3, "maxItems": 5, "items": { "type": "string" } },
    "synthesis_md": { "type": "string", "description": "Her paragrafta en az bir [n] atıfı; n citations.ordinal'a eşleşir — Python testi bunu regex ile doğrular" },
    "citations": { "type": "array", "items": { "$ref": "citation.schema.json" } },
    "matrix": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["ordinal", "method", "sample", "finding", "limitation"],
      "properties": { "ordinal": { "type": "integer" }, "method": { "type": "string" }, "sample": { "type": "string" }, "finding": { "type": "string" }, "limitation": { "type": "string" } } } },
    "bibtex": { "type": "string" }, "apa": { "type": "string" }, "model": { "type": "string" }, "cost_usd": { "$ref": "common.schema.json#/$defs/usd" },
    "removed_unresolved": { "type": "array", "description": "Crossref'te çözümlenmediği için silinen atıflar (yalnız inceleme ekranı)", "items": { "$ref": "citation.schema.json" } } } }
```

### 4.6 `exam_item.schema.json` + `priority_plan.schema.json`

```json
{ "$id": "https://ogrenmen.easy/schemas/exam_item.schema.json", "title": "ExamItem", "x-version": "1.0", "type": "object", "additionalProperties": false,
  "required": ["exam_source_id", "ordinal", "topic", "kind", "ocr_text"],
  "properties": { "exam_source_id": { "$ref": "common.schema.json#/$defs/uuid" }, "ordinal": { "type": "integer", "minimum": 1 }, "topic": { "type": "string" },
    "kind": { "enum": ["proof", "calc", "mcq", "other"] }, "points": { "type": "number", "minimum": 0 }, "year": { "type": "integer" }, "term": { "enum": ["vize", "final", "but", "deneme", "diger"] },
    "instructor_label": { "type": "string", "pattern": "^Hoca-[A-Z]$" }, "skill_codes": { "type": "array", "items": { "$ref": "common.schema.json#/$defs/skillCode" } },
    "ocr_text": { "type": "string", "description": "Yalnız eğitmen arşivi ve kümeleme; öğrenciye giden hiçbir şemada yer almaz" } } }
```

```json
{ "$id": "https://ogrenmen.easy/schemas/priority_plan.schema.json", "title": "PriorityPlan", "x-version": "1.0", "type": "object", "additionalProperties": false,
  "required": ["schema_version", "course_id", "title", "years_total", "rows", "generated_at"],
  "properties": {
    "schema_version": { "const": "1.0" }, "course_id": { "$ref": "common.schema.json#/$defs/uuid" },
    "title": { "const": "Sıklık analizine göre öncelikler" },
    "years_total": { "type": "integer", "minimum": 1 }, "generated_at": { "$ref": "common.schema.json#/$defs/isoDateTime" },
    "rows": { "type": "array", "maxItems": 10, "items": { "type": "object", "additionalProperties": false, "required": ["rank", "topic", "kind", "hits", "years", "evidence_count", "cluster_id"],
      "properties": { "rank": { "type": "integer", "minimum": 1 }, "topic": { "type": "string", "maxLength": 80 }, "kind": { "enum": ["ispat", "hesap", "çoktan seçmeli", "diğer"] },
                      "hits": { "type": "integer" }, "years": { "type": "integer" }, "points_label": { "type": "string", "pattern": "^≈\\d+ puan$" },
                      "evidence_count": { "type": "integer", "minimum": 1 }, "cluster_id": { "$ref": "common.schema.json#/$defs/uuid" },
                      "evidence_href": { "type": "string", "description": "eğitmen arşivine; soru metni yok" },
                      "variant_item_ids": { "type": "array", "items": { "$ref": "common.schema.json#/$defs/uuid" }, "description": "özgün varyantlar (items.source='llm', approved)" },
                      "skill_codes": { "type": "array", "items": { "$ref": "common.schema.json#/$defs/skillCode" } } } } },
    "other_topics": { "type": "array", "items": { "type": "string" } }
  },
  "x-forbidden-words": ["tahmin", "çıkacak", "kesin", "garanti"], "x-note": "Contracts testi rows[*].topic ve title içinde bu kelimeleri reddeder (custom keyword)." }
```

### 4.7 `bot_response_log.schema.json`

```json
{ "$id": "https://ogrenmen.easy/schemas/bot_response_log.schema.json", "title": "BotResponseLog", "x-version": "1.0", "type": "object", "additionalProperties": false,
  "required": ["schema_version", "telegram_chat_id", "intent", "prompt_hash", "memory_fact_ids", "recent_message_ids", "fallback_chain", "cost_usd", "pii_scrub"],
  "properties": {
    "schema_version": { "const": "1.0" }, "incoming_message_id": { "$ref": "common.schema.json#/$defs/uuid" }, "reply_telegram_message_id": { "type": "integer" },
    "telegram_chat_id": { "type": "integer" }, "person_id": { "$ref": "common.schema.json#/$defs/uuid" }, "enrollment_id": { "$ref": "common.schema.json#/$defs/uuid" },
    "intent": { "enum": ["tutor", "quiz_feedback", "handoff", "quota", "consent", "command", "proactive", "guard_refusal"] }, "mode": { "enum": ["socratic", "direct"] },
    "prompt_text": { "type": "string", "description": "temizlenmiş tam prompt" }, "prompt_hash": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "memory_fact_ids": { "type": "array", "items": { "$ref": "common.schema.json#/$defs/uuid" } }, "recent_message_ids": { "type": "array", "items": { "$ref": "common.schema.json#/$defs/uuid" } },
    "provider": { "enum": ["gemini-paid", "gemini-free", "groq", "cloudflare-ai", "openrouter-free", "fake", "none"] }, "model": { "type": "string" },
    "input_tokens": { "type": "integer" }, "output_tokens": { "type": "integer" }, "cost_usd": { "$ref": "common.schema.json#/$defs/usd" }, "latency_ms": { "type": "integer" },
    "fallback_chain": { "type": "array", "items": { "type": "object", "required": ["provider", "status"], "properties": { "provider": { "type": "string" }, "status": { "type": "integer" }, "ms": { "type": "integer" } } } },
    "schema_valid": { "type": "boolean" },
    "pii_scrub": { "type": "object", "required": ["replacements"], "properties": { "replacements": { "type": "integer", "minimum": 0 } } },
    "guards": { "type": "array", "items": { "enum": ["forbidden_topic", "unsure", "human_requested", "quota", "consent_missing", "figure_unverified"] } } } }
```

### 4.8 `instructor_alert.schema.json` ve `tutor_reply.schema.json`

```json
{ "$id": "https://ogrenmen.easy/schemas/instructor_alert.schema.json", "title": "InstructorAlert", "x-version": "1.0", "type": "object", "additionalProperties": false,
  "required": ["cohort_id", "kind", "severity", "detail", "since", "evidence"],
  "properties": { "cohort_id": { "$ref": "common.schema.json#/$defs/uuid" }, "enrollment_id": { "$ref": "common.schema.json#/$defs/uuid" },
    "kind": { "enum": ["unanswered", "silent", "morale", "deadline", "response"] }, "severity": { "enum": ["danger", "warning", "neutral"] },
    "detail": { "type": "string", "maxLength": 200, "description": "Tek cümle; cevapsız soruda sorunun kendisi tırnak içinde; yargı kelimesi yok" },
    "since": { "$ref": "common.schema.json#/$defs/isoDateTime" },
    "evidence": { "type": "object", "properties": { "message_id": { "$ref": "common.schema.json#/$defs/uuid" }, "fact_id": { "$ref": "common.schema.json#/$defs/uuid" }, "escalation_id": { "$ref": "common.schema.json#/$defs/uuid" } } } } }
```

`tutor_reply.schema.json` — LLM'den istenen yapılandırılmış öğretmen cevabı (Worker bunu sağlayıcıya `response_schema` olarak verir):

```json
{ "$id": "https://ogrenmen.easy/schemas/tutor_reply.schema.json", "title": "TutorReply", "type": "object", "additionalProperties": false,
  "required": ["message", "ends_with_question", "confidence", "needs_human", "touches_forbidden_topic"],
  "properties": {
    "message": { "type": "string", "minLength": 1, "maxLength": 420, "description": "En çok 4 satır; emoji ve ünlem yok; yalnız **kalın** ve `kod`" },
    "ends_with_question": { "type": "boolean" },
    "hint_level": { "type": "integer", "minimum": 0, "maximum": 3 },
    "skill_codes_touched": { "type": "array", "items": { "$ref": "common.schema.json#/$defs/skillCode" } },
    "confidence": { "$ref": "common.schema.json#/$defs/probability" },
    "needs_human": { "type": "boolean" },
    "touches_forbidden_topic": { "type": "boolean", "description": "not/puan/devamsızlık/ödeme — true ise Worker mesajı atar, handoff gönderir" },
    "suggested_buttons": { "type": "array", "maxItems": 3, "items": { "type": "string", "maxLength": 20 } } } }
```

Diğer şemalar (adları ve amaçları; aynı klasörde): `curriculum.schema.json` (skills.yaml/curriculum.yaml), `diagnostic_test.schema.json` (teşhis seti; anahtar yok), `diagnostic_keys.schema.json` (yalnız seed), `telegram_update.schema.json` (fake Telegram için daraltılmış Update), `spend_event.schema.json`, `figure_render_report.schema.json`.

---

## 5. Worker (Telegram botu)

Konum: `/home/user/alperen/apps/bot-worker`. Çalışma zamanı Cloudflare Workers, TypeScript 5.x, Hono 4.x, `@supabase/supabase-js` 2.x (PostgREST), `@ogrenmen/contracts`, `@ogrenmen/pii`, `@ogrenmen/llm-router`. Python yok.

### 5.1 Dosya düzeni

```
apps/bot-worker/
├── wrangler.toml                 # name=ogrenmen-bot; compatibility_date=2026-09-01; kv_namespaces QUOTA_KV, STATE_KV; triggers.crons
├── .dev.vars.example             # ADAPTERS=fake DB=fake TELEGRAM_WEBHOOK_SECRET=dev ...
├── src/
│   ├── index.ts                  # Hono app: POST /telegram/:secretPath, GET /healthz, scheduled()
│   ├── env.ts                    # Env tipi + zod benzeri el yazımı doğrulama (startup'ta eksik secret → 500 + log)
│   ├── telegram/{api.ts, types.ts, fake.ts, format.ts}     # sendMessage/sendPhoto/pinChatMessage/getChat; fake: bellek içi outbox
│   ├── db/{client.ts, fake.ts, rpc.ts}                     # PostgREST istemcisi (bot_worker JWT) | FakeDb (seed.json); rpc.ts tüm RPC imzaları
│   ├── router/{dispatch.ts, intents.ts}                    # update → handler seçimi
│   ├── handlers/{start.ts, consent.ts, cevap.ts, mode.ts, help.ts, diagnostic.ts, quiz.ts, tutor.ts, group.ts, handoff.ts, quota.ts, callback.ts}
│   ├── guards/{forbidden.ts, consent.ts, quota.ts, spend.ts}
│   ├── memory/{embed.ts, retrieve.ts}
│   ├── prompts/{system.socratic.md, system.direct.md, system.group.md, build.ts}
│   ├── logging/{response_log.ts}
│   ├── cron/{proactive.ts, retention_storage.ts, spend_alert.ts, keepalive.ts, alerts_hourly.ts}
│   └── text/tr.ts                # tüm kullanıcı metinleri tek dosyada (telegram.md kurallarına uygun; emoji/ünlem yok — test eder)
├── scripts/{smoke.ts, set-webhook.ts, mint-jwt.ts → packages/db/scripts kullanılır}
└── test/
    ├── fixtures/{seed.json, updates/*.json}
    ├── unit/*.test.ts            # guards, format, prompts, router mantığı
    └── worker/*.test.ts          # @cloudflare/vitest-pool-workers: tam istek döngüsü, fake Telegram + FakeDb + FakeProvider
```

### 5.2 Webhook doğrulama ve yönlendirme

- Webhook URL: `https://<worker>/telegram/<TELEGRAM_WEBHOOK_PATH>` (rastgele 32 karakter) ve `setWebhook` çağrısında `secret_token=TELEGRAM_WEBHOOK_SECRET`. Her istekte `X-Telegram-Bot-Api-Secret-Token` başlığı sabit-zamanlı karşılaştırma ile kontrol; uymazsa `401` ve log, gövde okunmaz.
- Gövde `telegram_update.schema.json` ile doğrulanır; bilinmeyen tür → `200 OK` (Telegram tekrar göndermesin) + `audit` yok, sadece log.
- İdempotenlik: `update_id` `STATE_KV` içinde 24 saat tutulur; tekrar gelen update işlenmez.
- Yanıt süresi: Telegram 60 sn bekler; LLM çağrısı `ctx.waitUntil` içinde değil, istek içinde yapılır ama toplam bütçe 25 sn; aşılırsa "Biraz uzun sürdü; tekrar sorabilir misin?" ve log. Önce `sendChatAction('typing')`.
- `dispatch.ts` sırası (her adım bir `Guard` ya da `Handler`; ilk kesen kazanır):
  1. `my_chat_member` (bot gruba eklendi) → `group.onAdded`: `getChat` ile gizlilik modu kontrolü (`can_read_all_group_messages`), `chat_bindings` upsert, **kayıt bildirimi** (`legal_texts kind=grup_kayit` güncel sürüm; metindeki `{days}` `retention_policies.messages.hard_delete.days` ile doldurulur) gönderilir ve sabitlenir; `new_chat_members` → aynı bildirim tekrar.
  2. `message` → `messages` tablosuna ham kayıt (`text_raw`, `text_llm = scrub(text_raw, cohortNames)`) — **grup mesajları da dahil**, cevap verilmese bile (Katman 1).
  3. Kimlik: `resolve_telegram(user_id, chat_id)`; yoksa `start.ts` onboarding.
  4. Komutlar: `/start`, `/yardim`|`/help`, `/cevap`, `/mod`, `/test`, `/onay <kod>`, `/sil` (KVKK: veri silme talebi → coordinator'a escalation), `/kota`.
  5. Grup mesajı ise `group.shouldReply`: botun adı geçiyor ya da bota yanıt (reply) ya da `@hoca` yok ve soru işareti var ve `cohort.bot_answers_in_group=true` (settings). Aksi hâlde yalnız kaydet.
  6. `guards/consent` → onay yoksa onay akışı, LLM çağrısı yok.
  7. `guards/forbidden` → deterministik sözlük (`not`, `puan`, `devamsızlık`, `yoklama`, `ödeme`, `taksit`, `ücret`, `karne`, `sınav sonucu` + Türkçe ek varyantları regex) → `instructor_notes.approved_fact=true` ya da `memory_facts kind=instructor_statement status=approved` eşleşmesi var mı? Varsa onaylı olguyu aynen aktar; yoksa **handoff**: "Bunu hocan söyleyebilir; sorunu ona ilettim." + `escalations(reason='forbidden_topic')`. LLM çağrılmaz.
  8. `guards/quota` → `consume_quota(person,'message')`; `remaining == warn_at_remaining` ise tek seferlik hatırlatma; `allowed=false` ise kota metni, LLM yok.
  9. `guards/spend` → `spend_status()`; `daily_cap` ise ücretli sağlayıcılar devre dışı, yalnız ücretsiz zincir; hepsi düşerse "Şu an yanıt veremiyorum; hocan grupta." (`intent='quota'`, `provider='none'`).
  10. `callback_query` (inline düğme) → `callback.ts`: `ans:<attempt_id>:<letter>` → `submit_answer`; `hint:<attempt_id>` → tutor (hint_level+1); `human:<message_id>` → handoff; `consent:<kind>:<yes|no>`.
  11. Aktif teşhis/test oturumu varsa serbest metin cevap sayılır (`numeric` için); yoksa `tutor.ts`.

### 5.3 Komutlar ve durum

| Komut | Davranış |
| --- | --- |
| `/start` | İlk cümle sabit: "Merhaba, ben Öğrenmen. easy'nin yapay zekâ öğretmeniyim; hocaların da bu grupta." (grup değilse "...; hocan da seninle." değil — metin `tr.ts` içinde iki varyant, her ikisi "yapay zekâ öğretmeniyim" içerir). Ardından onboarding: yaş sorusu (`inline: "18 yaşından büyüğüm" / "18 yaşından küçüğüm"`), reşit değilse veli akışı; sonra KVKK aydınlatma (`legal` metin özeti + "Onaylıyorum" / "Şimdi değil"); sonra teşhis testi önerisi. |
| `/onay <kod>` | Veli kendi Telegram hesabından: kod `STATE_KV` içinde `consent:<kod>` → `{student_person_id, expires}` (72 saat). `record_consent(kind='veli_onayi', granted_by=veli_person)`; veli `persons.kind='guardian'` olarak kayıt edilir. Öğrenciye "Velin onayladı, başlayabiliriz." |
| `/cevap` | Yalnız o soru için doğrudan mod: `chat_sessions.direct_mode_item_id = aktif item`; bot "Tamam, bu soruda çözümü doğrudan göstereceğim." Bir sonraki soruda otomatik Sokratik'e döner. Aktif soru yoksa: "Şu an açık bir soru yok; bir soru sor, sonra /cevap yazabilirsin." |
| `/mod` | Oturum varsayılanı (`student_preferences.default_mode`); düğmeler "Sokratik" / "Doğrudan cevap". Sistem kendiliğinden değiştirmez. |
| `/test` | Teşhis (ilk kez) ya da pratik seti; `consume_quota('test')`. Sorular tek tek, A·B·C·D inline düğme; şekilli soru `sendPhoto` + altyazı = kök + şekil betimi; yalnız `figures.review_status='verified'` olan sorular gönderilir (sorgu filtresi + `items_approve_guard`). |
| `/yardim` | Komut listesi, kota durumu, "Verilerin nasıl kullanılıyor?" bağlantısı (legal metin). |
| `/kota` | "Bugün 12/25 mesaj, 1/5 test." |
| `/sil` | Silme talebi → `escalations(reason='human_requested')` + coordinator bildirimi; bot "Talebini koordinatöre ilettim; 30 gün içinde yanıtlanır." |

Durum (`chat_sessions` doğruluk kaynağı, `STATE_KV` 10 dakikalık önbellek): `consent_state`, `onboarding_step`, `mode`, `direct_mode_item_id`, `active_test_session_id`, son `hint_level` (`STATE_KV` yalnız).

Reşit olmayan onay kapısı: `consent_state <> 'granted'` iken bot **yalnız** onboarding/onay mesajları gönderir; `tutor.ts` ve `quiz.ts` çağrılmaz, `messages` yine kaydedilir (grup bildirimi zaten yapıldı) ama `text_llm` boş bırakılır (LLM'e hiçbir şey gitmemesi için worker katmanında ikinci kilit: `scrub` çağrılmaz ve `text_llm=null`). Test: `test/worker/consent.test.ts` reşit olmayan onaysız kullanıcının 5 mesajı için `FakeProvider.calls.length === 0` ve `bot_responses.provider === 'none'`.

### 5.4 LLM yönlendirici (`packages/llm-router`)

```ts
export interface LlmRequest { purpose: Purpose; system: string; messages: {role:'user'|'assistant'; content:string}[];
  responseSchema?: object; maxOutputTokens?: number; temperature?: number; tier: 'lite'|'strong'; }
export interface LlmResponse { text: string; json?: unknown; provider: ProviderId; model: string; inputTokens: number; outputTokens: number; costUsd: number; latencyMs: number; }
export interface LlmProvider { id: ProviderId; models: Record<'lite'|'strong', string|null>; paid: boolean;
  generate(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse>; }   // 429/503/timeout → RouterError{status}
export interface SpendGate { status(): Promise<{dailyCap:boolean; monthlyCap:boolean}>; record(e: SpendEvent): Promise<void>; }
export function createRouter(opts: { providers: LlmProvider[]; order: ProviderId[]; gate: SpendGate; validate: (schema, obj) => boolean; fetch?: typeof fetch; now?: () => number }): Router;
```

- Sıra (`lite`): `gemini-paid` (gemini-2.5-flash-lite) → `gemini-free` (aynı model, ayrı anahtar/proje) → `groq` (llama-3.3-70b-versatile) → `cloudflare-ai` (@cf/meta/llama-3.1-8b-instruct) → `openrouter-free` (`:free` etiketli model listesi, `OPENROUTER_FREE_MODEL`). Düşme koşulları: HTTP 429, 5xx, ağ hatası, 12 sn zaman aşımı, şema doğrulaması 2 kez başarısız. 4xx (400/401) düşmez, hata loglanır (yapılandırma hatası).
- `strong` tier yalnız `purpose='lesson_analysis'` (Python tarafı) ve Worker'da **yok** (router `tier:'strong'` isteğini Worker yapılandırmasında reddeder: `strongAllowed:false`).
- Maliyet tablosu `src/cost.ts` (USD / 1M token; `plan.md` değerleri, sürümlenir ve `docs/adr/ADR-0005-maliyet-tablosu.md` güncellemesiyle değişir):

  | provider | model | input | output |
  | --- | --- | --- | --- |
  | gemini-paid | gemini-2.5-flash-lite | 0.10 | 0.40 |
  | gemini-paid | gemini-2.5-pro (strong, yalnız Python) | 1.25 | 10.00 |
  | gemini-free | gemini-2.5-flash-lite | 0 | 0 |
  | groq | llama-3.3-70b-versatile (free) | 0 | 0 |
  | cloudflare-ai | @cf/meta/llama-3.1-8b-instruct | 0 (neuron kotası) | 0 |
  | openrouter-free | * :free | 0 | 0 |
  | gemini | gemini-embedding-001 | 0 | — |

- Harcama kapısı: `SpendGate.status()` çağrı öncesi; `dailyCap || monthlyCap` → `paid:true` sağlayıcılar atlanır. Her yanıt `spend_ledger`'a (`record`) yazılır; Worker'da `gate` `QUOTA_KV` içinde 60 sn önbellekli `spend_status()` RPC'si.
- Yapılandırılmış çıktı: Gemini → `generationConfig.responseMimeType='application/json'` + `responseSchema` (düzleştirilmiş); Groq/OpenRouter → `response_format: {type:'json_schema', json_schema}` (desteklemiyorsa `json_object` + şemayı prompt'a göm); Cloudflare AI → `response_format json_schema`. Dönen JSON Ajv ile doğrulanır; geçmezse aynı sağlayıcıya "Yalnızca şemaya uygun JSON ver" ile 1 tekrar, sonra düşüş.
- `FakeProvider`: `fixtures/replies/<purpose>/*.json` içinden deterministik seçim (prompt hash mod n); `failWith: {429: [0,1]}` ile belirli çağrılarda hata üretir — düşüş testleri bunu kullanır.

### 5.5 Sokratik prompt tasarımı

`prompts/build.ts` üç bloktan sistem promptu kurar; blok sırası ve kimlik cümlesi sabittir, testler `includes` ile doğrular:

1. **Kimlik ve sınırlar** (`system.socratic.md`): "Sen Öğrenmen'sin, easy'nin yapay zekâ öğretmenisin. Öğrenciye sen diye hitap et. Bir mesajda tek fikir, en çok dört satır, sonunda çoğunlukla bir soru. Cevabı doğrudan verme; ipucu ver. Emoji ve ünlem kullanma. Yalnız **kalın** ve `kod` biçimi. Not, puan, devamsızlık, ödeme hakkında konuşma; bunlar sorulursa `touches_forbidden_topic=true` ver. Emin değilsen `needs_human=true` ve 'Bundan emin değilim; hocana soralım.' yaz. Öğrencinin adını, okulunu bilmiyorsun ve sorma."
2. **Bağlam** (DB'den, PII'siz): kazanım adı ve `is_reliable` ise ustalık bandı (`düşük/orta/yüksek`, yüzde değil), açık yanılgı metinleri (`text_student`), `retrieve_context` olguları (tarih ve tür ile), son 8 mesaj (`text_llm`), aktif soru varsa kök + seçenekler (**anahtar yok**; `direct_mode` ise `reveal_solution` sonucu `solution_md` eklenir — yalnız öğrenci cevap verdikten sonra).
3. **Görev**: `hint_level` 0→"soruyla yönlendir", 1→"ilk adımı göster", 2→"yarısına kadar çöz", 3→"çözümü tamamla ama kontrol sorusu ekle"; `direct` modda doğrudan çözüm, "yine tek balonda tek adım".

Çıktı `tutor_reply.schema.json`. Worker son kontrol: `message` içinde emoji/ünlem regex'i (`/[!\u{1F300}-\u{1FAFF}]/u`) → temizle ve `guards:['format_fix']` logla; `touches_forbidden_topic` → mesaj atılır, handoff; `needs_human` → mesaj + "Hocaya sor" düğmesi + `escalations(unsure)`; 4 satırdan uzun → ilk 4 satır + "Devam" düğmesi.

### 5.6 Hafıza erişimi

- Sorgu gömme: `gemini-embedding-001` (768 boyut, `outputDimensionality:768`) ya da `cloudflare-ai @cf/baai/bge-m3` (768'e kesilir); `ADAPTERS=fake` → `fake embed` = metnin sha256'sından türetilen deterministik vektör.
- `retrieve_context(person, chat, vec, 6, 8)` RPC'si. Sonuçtaki olgu kimlikleri ve mesaj kimlikleri `bot_responses.memory_fact_ids/recent_message_ids`'e yazılır (panelde "kullandığı hafıza olgusu sayısı").
- `instructor_statement` türü olgular yalnız `status='approved'` ise gelir (RPC filtresi); not/devamsızlık cevabı yalnız bu yoldan.

### 5.7 Gruplar, roller, yükseltme

- `memberships.role` üzerinden rol: eğitmen mesajları `sender_role='instructor'` ile kaydedilir ve gece olgu çıkarımında "eğitmen beyanı" adayı olur (onaysız kullanılmaz).
- `@hoca` kalıbı ya da "hocam", "hoca cevaplasın" → bot cevap vermez, `escalations(human_requested)` açar ve eğitmeni etiketler: "Bunu hocana bırakıyorum. @<eğitmen kullanıcı adı>, bu soruya bakabilir misin?" Eğitmen kullanıcı adı `chat_bindings` üzerinden değil, Telegram `getChatAdministrators`/mesaj geçmişinden `STATE_KV`'ye alınır (PII DB'ye değil KV'ye, 7 gün).
- Eğitmen bir escalation'a yanıt (reply) verirse `escalations.status='answered'`, `answered_at`; yanıt süresi panel metriği.
- Grupta bot öğrencinin adını değil `@kullanıcı adı`nı kullanır (`telegram.md`).

### 5.8 Cevap günlüğü

Her gönderilen bot mesajı (komut cevabı dahil) → `bot_responses` (şema 4.7). `prompt_text` yalnız temizlenmiş prompt; `scrub` çıktısındaki `replacements` sayısı `pii_scrub.replacements`. Hata durumunda da satır yazılır (`provider='none'`, `fallback_chain` dolu). Kayıt başarısızsa mesaj yine gönderilir ama `console.error` + `audit` yok (cevapsız kalma, kayıp günlükten kötü) — ADR-0006.

### 5.9 Cron işleri (`wrangler.toml [triggers] crons`)

| Cron (UTC) | İş |
| --- | --- |
| `*/30 * * * *` | `proactive.ts`: `proactive_messages` vadesi gelenleri gönder (günde kişi başı en çok 1; `student_preferences.active_hours` içinde değilse ertele; `proactive_opt_in=false` ise atla) |
| `0 * * * *` | `alerts_hourly.ts`: `escalations` açık > X saat → `instructor_alerts(unanswered)` upsert; `storage_deletions` kuyruğu → Storage API sil |
| `15 */6 * * *` | `spend_alert.ts`: `spend_status()`; `daily_alert` ve `notified_on <> today` → `OPS_CHAT_ID`'ye mesaj; cap aşıldıysa ayrıca |
| `0 5 */2 * *` | `keepalive.ts`: `select 1` eşdeğeri (`settings` tablosundan 1 satır) — Supabase uyumasın (GitHub Actions'taki ile yedekli) |

### 5.10 Ortam değişkenleri ve gizler

| Ad | Tür | Açıklama |
| --- | --- | --- |
| `ADAPTERS` | var | `fake` \| `real` |
| `DB` | var | `fake` \| `supabase` |
| `SUPABASE_URL` | var | proje URL'si |
| `SUPABASE_BOT_JWT` | secret | `packages/db/scripts/mint-jwt.ts --role bot_worker --exp 365d` ile JWT_SECRET'tan üretilir |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_PATH` | secret | |
| `GEMINI_PAID_API_KEY`, `GEMINI_FREE_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` | secret | yoksa o sağlayıcı zincirden düşer (başlangıçta loglanır) |
| `CF_ACCOUNT_ID`, `CF_AI_API_TOKEN` | secret | Workers AI (binding `AI` tercih edilir; REST yedek) |
| `OPS_CHAT_ID` | var | kurucunun Telegram sohbeti (uyarılar) |
| `QUOTA_KV`, `STATE_KV` | binding | |
| `AI` | binding | Workers AI |

Model anahtarları yalnız Worker secret'ı; panel ve istemcilerde hiç yok.

### 5.11 Yerel test

- `bun run test` → vitest; `test/worker/*.test.ts` `@cloudflare/vitest-pool-workers` ile gerçek Workers çalışma zamanında (miniflare), `ADAPTERS=fake DB=fake`. Fake Telegram: `telegram/fake.ts` tüm `sendMessage` çağrılarını `outbox[]`'a yazar; testler outbox metnini `tr.ts` sabitleriyle karşılaştırır.
- Zorunlu senaryolar: `start_minor_consent_gate`, `guardian_onay_code`, `forbidden_topic_handoff_without_llm`, `quota_exhausted_message`, `quota_warning_once`, `cevap_only_current_item`, `quiz_answer_graded_via_rpc_only` (FakeDb `attempts.is_correct` doğrudan yazımını fırlatır), `figure_unverified_not_sent`, `router_fallback_on_429`, `spend_cap_disables_paid`, `group_added_pins_recording_notice_with_retention_days`, `at_hoca_escalation`, `response_log_written_on_error`, `prompt_has_no_pii` (seed'deki adlar prompt_text'te geçmez).
- `bun run dev` (wrangler dev --local, port 8787) + `bun run smoke` (`scripts/smoke.ts` fikstür update'lerini POST eder, `/__fake/outbox` geliştirme uç noktasından çıktıyı okur; bu uç nokta yalnız `DB=fake` iken kayıtlıdır).

---

## 6. Pipelines (Python)

Konum: `/home/user/alperen/pipelines/`. Python 3.13, her boru hattı ayrı `pyproject.toml` (`setuptools`), ortak taban `ogrenmen_common`. Hiçbir boru hattı `secure` şemasını görmez; `batch_worker` JWT ile PostgREST (`postgrest` paketi yerine düz `httpx` + `Authorization: Bearer`, `apikey` başlıkları — bağımlılık az) ve Supabase Storage REST.

### 6.0 `ogrenmen_common` (M06)

```
pipelines/common/src/ogrenmen_common/
├── cli.py            # common_parser(): --adapters fake|real, --dry-run, --fixtures DIR, --out DIR, --limit N, --log-level
├── config.py         # env: OGRENMEN_ADAPTERS, SUPABASE_URL, SUPABASE_BATCH_JWT, GEMINI_*_API_KEY, GROQ_API_KEY, UNPAYWALL_EMAIL, S2_API_KEY
├── adapters/
│   ├── llm.py        # Protocol LlmClient.generate(purpose, system, messages, response_schema, tier) → dict; GeminiClient, GroqClient, FakeLlm(fixtures)
│   ├── vision.py     # VisionClient.check_figure(png_bytes, expected_values) → {"passed":bool,"mismatches":[...]}; GeminiVision, FakeVision
│   ├── embedding.py  # Embedder.embed(texts) → list[list[float]] (768); GeminiEmbedder, CloudflareEmbedder, FakeEmbedder (sha256 → deterministik)
│   ├── transcribe.py # Transcriber.transcribe(wav_path) → segments[{start,end,speaker_raw,text}]; GroqWhisper, GeminiAudio, WhisperCpp(subprocess), FakeTranscriber
│   ├── scholarly.py  # OpenAlex, SemanticScholar, Crossref, Unpaywall istemcileri + Fake*; her biri Protocol
│   ├── storage.py    # Storage.put/get/delete/signed_url; SupabaseStorage, LocalDirStorage(out/)
│   └── db.py         # Db.select/insert/upsert/rpc; PostgrestDb, JsonlDb(out/<table>.jsonl + fixtures okur)
├── spend.py          # record(provider, model, purpose, in_tok, out_tok, cost_usd, ref) → spend_ledger; cost tablosu packages/llm-router/src/cost.json'dan OKUNUR (tek kaynak; M04 cost.ts bu json'u import eder)
├── pii.py            # ogrenmen_pii.scrub sarmalayıcı: scrub_for_llm(text, names)
└── selftest.py       # python -m ogrenmen_common.selftest → tüm fake adaptörleri çağırır, şemaları doğrular
```

Her CLI `--dry-run` ile DB'ye yazmaz, `--out` dizinine `*.jsonl` ve render çıktıları bırakır; `--adapters fake` ile ağ yok. CI ve yerel kabul testleri bu modda koşar.

### 6.1 `tablet` (M07) — soru ve şekil üretimi

Komutlar (`python -m ogrenmen_tablet <komut>`):

| Komut | Girdi | Çıktı | Adımlar |
| --- | --- | --- | --- |
| `generate --skill TYT.MAT.X --band mid --n 5` | skills, misconception_tags (DB/fixtures), onaylı örnekler | `items` (draft) + `figures` (pending) + `register_answer_key` | LLM `question_item.schema.json` + ayrı `answer_key` alanıyla (**tek çağrıda iki şema**: sağlayıcıya `{item, key}` zarfı verilir; item DB'ye `items`, key RPC'ye) → `content_hash` tekrar kontrolü → SymPy doğrulama → `register_answer_key(sympy_verified)` → figure varsa `render` kuyruğu |
| `render --pending` | `figures.render_status='pending'` | PNG (Storage `figures/`), `figures` güncel | sandbox: `subprocess.run([sys.executable,'-I','-S', runner], timeout=20, cwd=tmp, env={})` + `resource.setrlimit` (CPU 10 sn, bellek 512 MB, dosya 5 MB); motor başına runner: matplotlib (Agg, Lexend font yüklü), svg (cairosvg), tikz/latex (tectonic, `-Z shell-escape` YOK), vegalite (vl-convert-python), schemdraw, rdkit, graphviz. Boyut sanity: 300≤w≤2000, 200≤h≤2000, 5 KB≤bytes≤2 MB, boş görüntü (tek renk) reddi |
| `vision --pending` | rendered figürler + `expected_values` | `vision_status`, `vision_report` | Gemini Flash vision (`lite` ücretsiz anahtar): "Şekilde şu değerler görünüyor mu?" → JSON `{passed, mismatches}`; fail → `attempts+1`, 2'den küçükse LLM'e "kodu düzelt" ile `generate --fix figure_id`; 2'yi aştıysa `review_status='pending'` (öğretmen kuyruğu), `items.verification_status='review_pending'` |
| `sympy-verify --item ID` | item + key (key yalnız RPC `peek_answer_key`? **Hayır**: batch key'i kendisi üretmiştir ve bellekte tutar; sonradan doğrulama için `verify_key(item_id, candidate)` RPC'si eşitlik döner, anahtarı döndürmez) | `sympy_verified` | numeric: `sympy.simplify(canonical_expr) == N(value)`; mcq hesaplamalı ise `canonical_expr` değerini şık metinleriyle eşle |
| `template --code kesir-toplama --n 50 --seed 7` | `templates/*.yaml` | items (template) + keys | sıfır LLM; üretici fonksiyon parametreleri çeker, kök/şıklar/çeldirici etiketleri/anahtar deterministik; SymPy ile çapraz kontrol |
| `pdf --test-set TYT-MAT-DIAG-v1 --out deneme.pdf` | test set + figürler | PDF | LaTeX `exam` sınıfı şablonu `templates/exam.tex.j2` + Tectonic; cevap anahtarı sayfası yalnız `--with-keys` ve eğitmen için (RPC `peek_answer_key` audit'li) |

Fikstürler: `fixtures/skills.json`, `fixtures/llm/question_item/*.json` (sahte LLM cevapları, 3'ü bilerek şema dışı), `fixtures/figures/*.py|.svg|.tex`, `fixtures/vision/*.json`. Testler: `test_sandbox_blocks_network_and_fs` (runner içinde `import socket; socket.create_connection` → hata, `open('/etc/passwd')` → hata; `-I -S` ve `env={}` ile), `test_size_sanity`, `test_sympy_rejects_wrong_key`, `test_two_retries_then_review_queue`, `test_template_zero_llm_calls` (`FakeLlm.calls == 0`), `test_item_json_has_no_key_field` (üretilen `items` kaydında `correct_letter` anahtarı yok — regex ile tüm jsonl taranır).

GitHub Actions: `nightly.yml` → `tablet generate` (gece Batch API: Gemini Batch endpoint'i `GeminiClient(batch=True)`; fake'te aynı) + `render.yml` (`workflow_dispatch` ve nightly sonrası) + `vision`.

### 6.2 `kalem` (M08) — çeldirici motoru araçları ve sınav modelleme

(a) Çeldirici motoru SQL'dedir (`submit_answer` → `observations` → `apply_observation` → ön koşul çıkarımı). `kalem` burada **analiz ve kalite** aracıdır: `python -m ogrenmen_kalem distractor-report --cohort ID` → her çeldirici etiketinin seçilme oranı, hiç seçilmeyen çeldiriciler (yeniden yazım adayı), `prerequisite-audit` → ön koşul çıkarımıyla düşen kazanımlar ve sonraki doğrudan ölçümle örtüşme oranı (pilot ölçütü "teşhis uyumu").

(b) Sınav modelleme komutları:

| Komut | Adımlar |
| --- | --- |
| `ocr --exam-source ID` | Storage'dan PDF/foto → sayfa görüntüleri (`pdf2image`/`pypdfium2`) → Gemini Flash vision OCR, çıktı `exam_item.schema.json` listesi (soru ayrımı, konu, tür, puan) → `exam_items` |
| `embed --course ID` | `ocr_text` → embedding (768) → `exam_items.embedding` |
| `cluster --course ID` | sklearn `AgglomerativeClustering(distance_threshold=0.25, metric='cosine', linkage='average')` → `exam_clusters` (`years_hit`, `years_total`, `avg_points`, `label` = kümenin en sık `topic`'i); LLM yok |
| `align --course ID` | `syllabus_topics.skill_ids` ↔ küme `skill_ids`; "işlenmiş ama hiç sorulmamış" ve "her yıl sorulan" listeleri |
| `plan --course ID` | `priority_plan.schema.json` → `priority_plans(status='draft')`; `rows[*].evidence_count = kümedeki exam_items sayısı`; yasak kelime testi; varyant: her küme için `tablet generate --like cluster_id` çağrısı (yalnız onaylı planda, `--with-variants`) |

Fikstürler: 3 yıllık sahte vize/final görüntüleri yerine `fixtures/ocr/*.json` (OCR sonucu), `fixtures/embeddings.npy`. Test: `test_plan_never_contains_ocr_text` (plan jsonl içinde `ocr_text` alanı ve herhangi bir exam_item metni geçmez), `test_forbidden_words`, `test_cluster_years_hit_le_total`.

### 6.3 `kitap` (M09) — akademik araştırma

`python -m ogrenmen_kitap run --request ID` (ya da `--query "..." --dry-run`):

1. `expand`: LLM (lite) 3–5 sorgu (`{"queries": [...]}` şema).
2. `search`: OpenAlex (`/works?search=&per-page=25`, `mailto=` parametresi), Semantic Scholar (`/graph/v1/paper/search`, anahtar varsa); birleştir, DOI'ye göre tekilleştir, puan = 0.5·alaka + 0.3·atıf(log) + 0.2·yenilik.
3. `verify`: **her DOI Crossref'te** (`GET https://api.crossref.org/works/{doi}`) → 200 ve başlık benzerliği ≥0.6 (rapidfuzz) → `verified`; 404/timeout(2 deneme) → `unresolved` → **silinir** (`removed_unresolved` listesine, öğrenciye hiç gitmez). DOI yoksa `no_doi` (DergiPark/YÖK Tez; bağlantı `pdf_url` alanında).
4. `fetch`: Unpaywall (`/v2/{doi}?email=`) → `best_oa_location.url_for_pdf` → PDF (≤20 MB) → `pypdf` metin; Storage `research/<request>/`.
5. `synthesize`: Gemini Flash (1M bağlam; `lite` ücretsiz anahtar, ücretli düşüş) → `research_output.schema.json`; sentezde `[n]` ↔ `citations.ordinal` eşleşmesi regex ile doğrulanır; eşleşmeyen `[n]` → paragraf yeniden üretilir (1 kez), sonra o cümle silinir.
6. `export`: BibTeX (`bibtexparser`), APA 7 (kendi şablonu), isteğe bağlı Zotero (`pyzotero`, `ZOTERO_API_KEY` varsa; fake'te `out/zotero.jsonl`).
7. `write`: `research_outputs`, `citations`; `spend_ledger`; kota `consume_quota(person,'research')` **başlangıçta** (çalışma öncesi; dolu ise işlem `failed:quota`).

Fikstürler: `fixtures/openalex/*.json`, `fixtures/s2/*.json`, `fixtures/crossref/{ok,404}.json`, `fixtures/unpaywall/*.json`, `fixtures/pdf/sample.pdf`. Testler: `test_unresolved_doi_removed`, `test_every_bracket_cites_existing_ordinal`, `test_no_doi_has_no_verified_badge`, `test_quota_checked_before_network`.

### 6.4 `ders` (M10) — ders videosu analizi

`python -m ogrenmen_ders analyze --lesson ID` (yerel: `--video fixtures/ders-kisa.mp4 --dry-run`):

1. `audio`: `ffmpeg -i in.mp4 -vn -ac 1 -ar 16000 -c:a pcm_s16le audio.wav`.
2. `frames`: `ffmpeg -i in.mp4 -vf "select='gt(scene,0.3)',showinfo" -vsync vfr frames/%03d.png`; 20–40 kare hedefi: eşik 0.3'ten başlar, sayı 40'ı aşarsa 0.4/0.5 ile tekrar, 20'nin altındaysa 0.2; yine azsa sabit aralıklı örnekleme ile tamamla.
3. `transcribe`: `Transcriber` (varsayılan GroqWhisper `whisper-large-v3-turbo`; `--transcriber gemini|whispercpp`). Konuşmacı ayrımı: iki konuşmacı varsayımı; Gemini audio kullanılıyorsa etiket ister; Groq'ta `segments` üzerinde basit enerji/duraklama + eğitmen ilk 30 sn konuşan varsayımı; eğitmen panelde düzeltebilir (`lesson_claims.speaker` düzenlenebilir). **Etiket dönüşümü API öncesi**: `secure` erişimi olmadığı için ad listesi `--names` ile değil, `resolve_lesson_labels(lesson_id)` RPC'si (yalnız `batch_worker`; dönen tek şey transkriptte aranacak ad tokenlarının **hash'leri değil, düz adları** — bunlar bellekte kalır, dosyaya yazılmaz) üzerinden alınır; `ogrenmen_pii.scrub` adları `ÖĞRENCİ`/`EĞİTMEN` yapar; kalan özel adlar `profile_names_policy=strip_capitalized_after_hitap` ("hocam X" kalıbı). Transkript `lessons-transcripts/<id>.jsonl` (etiketli, isimsiz) olarak kalır.
4. `seed_profile`: `mastery_view` (reliable olanlar), açık `misconceptions` (`text_instructor`, id), son `weekly_summaries` → `seed_profile` JSON (ad yok).
5. `analyze`: `strong` tier (Gemini 2.5 Pro; `--model claude-sonnet` alternatifi `AnthropicClient`, anahtar yoksa atlanır) → `lesson_analysis.schema.json` zorunlu; doğrulama başarısızsa 1 tekrar; maliyet `spend_ledger(purpose='lesson_analysis')`.
6. `write`: `lesson_analyses(status='draft')` + her madde `lesson_claims(status='pending')`; **observations yazılmaz** (onay RPC'si yazar). `lessons.status='analyzed'`; eğitmene Telegram bildirimi (`proactive_messages` yerine doğrudan `escalations(reason='unsure')` değil — `instructor_alerts(kind='response', detail='Ders raporu onay bekliyor')`).
7. Ham video silme `retention` işine bırakılır (30 gün); `ders purge --due` yedeği.

Fikstürler: `fixtures/ders-kisa.mp4` (20 sn sentetik: ffmpeg `testsrc`+`sine` ile üretilir, repo'ya 300 KB), `fixtures/transcript.json`, `fixtures/analysis.json`. Testler: `test_no_names_in_transcript_file`, `test_frames_between_20_40` (sentetik 90 sahneli video `scripts/make_fixture.sh` ile), `test_analysis_schema_valid`, `test_writes_claims_not_observations` (JsonlDb'de `observations.jsonl` yok).

### 6.5 `kulaklik_batch` (M11) — gece olgular, haftalık özet, panel metrikleri

| Komut | Zamanlama | Adımlar |
| --- | --- | --- |
| `facts --since 24h` | nightly 02:30 TRT | Kişi başına günün `messages.text_llm` (text_raw yetkisi yok) → LLM lite (Batch) → `memory_fact.schema.json[]`; her olgu `source_message_ids` zorunlu; `instructor_statement` → `requires_approval`, `status='active'` değil `'retracted'` değil: `status='active'` ama `approved_by null` → bot kullanmaz (RPC filtresi); embedding → `memory_facts` |
| `summaries --week` | weekly Pazar 03:00 | enrollment başına `weekly_summary.schema.json`; girdi: haftanın olguları + `mastery_history` + attempt sayıları |
| `alerts` | nightly + saatlik (Worker ile paylaşımlı; batch yalnız `silent/morale/deadline/response`) | `silent`: son mesaj > N gün (`settings.alerts.silent_days=3`), `morale`: ardışık 2 `morale` olgusu `down` ya da haftalık `morale='down'`, `deadline`: `memory_facts kind=deadline valid_until` 48 saat içinde, `response`: eğitmen yanıt süresi medyanı > X saat (`escalations`) → `instructor_alerts` upsert; `instructor_alert.schema.json` |
| `review-sample --week` | weekly | `bot_responses` haftanın örneklemi: tüm `flagged` + rastgele 20 → `review_week` işaretle; Markdown rapor `out/review-<week>.md` (prompt_text temizlenmiş olduğu için güvenli) |
| `retention --report` | nightly | `run_retention()` RPC + `storage_deletions` kuyruğunu işle (SupabaseStorage.delete) + rapor |
| `spend-report` | nightly | gün/ay toplamı, provider dağılımı; `spend_caps.alert` aşımı → GitHub Actions job summary + Worker `OPS_CHAT_ID` (RPC `notify_ops(text)`) |

Testler: `test_fact_without_source_rejected` (şema), `test_batch_never_reads_text_raw` (JsonlDb fixture'da `text_raw` alanı yoksa da çalışır; PostgrestDb select listesi `text_raw` içermez — statik test), `test_alert_detail_has_no_judgement_words` ("depresif", "tembel" yasak listesi), `test_silent_threshold_from_settings`.

GitHub Actions eşlemesi: `nightly.yml` → `kulaklik_batch facts`, `kulaklik_batch alerts`, `kulaklik_batch retention`, `kulaklik_batch spend-report`, `tablet generate`, `tablet render`, `tablet vision`, `ders analyze --queued`; `weekly.yml` → `kulaklik_batch summaries`, `kulaklik_batch review-sample`, `kalem cluster/plan --all-courses`.

---

## 7. Eğitmen paneli (web)

Konum: `/home/user/alperen/apps/egitmen-paneli`. Next.js 14.2 (App Router), React 18.3.1 (bundle.js React 18 bekler), TypeScript, `output: 'export'` (statik; Cloudflare Pages'a yüklenir, sunucu yok, dolayısıyla panelde gizli anahtar yok). Supabase auth tarayıcıda (`@supabase/supabase-js` 2.x, PKCE, e-posta + magic link). Veri erişimi doğrudan PostgREST, **RLS altında**; panel asla `service_role` kullanmaz.

### 7.1 Tasarım sistemi tüketimi

- `bun run sync:ds` → `packages/design-system/components/{bundle.js,bundle.css}` ve `fonts/*.woff2` → `public/ds/`. `app/layout.tsx` `<html lang="tr">`, `<link rel="stylesheet" href="/ds/bundle.css">`, `<Script src="/ds/bundle.js" strategy="beforeInteractive">`.
- `lib/ds.tsx`: `window.Ogrenmen`'i tipli dışa aktarır (`import type * as DS from '../../../packages/design-system/components/index.d.ts'`): `export const StatTile = (p: DS.StatTileProps) => createElement(window.Ogrenmen.StatTile, p)` … Tüm sayfalar `'use client'`; veri çekimi istemci tarafında (statik export).
- Tema: `data-theme` kökte; tokens `bundle.css` içinde. Grafik yalnız zaman serisi için (yanıt süresi), tek seri `primary`; tablo görünümü zorunlu (`egitmen-paneli.md`).

### 7.2 Roller ve erişim

- Giriş sonrası `memberships` (RLS kendi satırları) okunur: rol `coordinator` / `instructor` / `observer`. Rol UI'da yalnız görünürlük içindir; güvenlik RLS'tedir (observer'ın "Onayla" düğmesi gizlidir ama tıklanabilse de RPC `can_edit_enrollment` reddeder).
- Öğrenci adı: `persons` tablosunda ad yok; panel `secure.person_pii`'ye erişemez. Çözüm: `public.person_labels(cohort_id)` RPC (security definer, yalnız kohort üyesi instructor/coordinator/observer) → `[{person_id, label:"Elif K."}]` — ad+soyadın ilk harfi fonksiyonda üretilir, tam ad hiç dönmez. Eğitmen adı tam (`instructor_labels()`).
- Branş eğitmeni yalnız kendi dersinin öğrencilerini görür (RLS `can_view_enrollment` subject eşlemesi); panel ek filtre yapmaz.

### 7.3 Sayfalar

| Yol | İçerik | Bileşenler | Veri |
| --- | --- | --- | --- |
| `/` Genel bakış | üstte en çok 4 `StatTile` (cevapsız soru [danger "Acil" >0], sessiz öğrenci [warning "Dikkat"], yaklaşan teslim, ort. yanıt süresi [hint "hedef 2 saat", success "Hedefte"]); altında `AlertRow` listesi Acil→Dikkat→Bilgi, grup içinde en eski üstte; her satır `Button secondary sm` "Cevapla" (Telegram derin bağlantı `tg://` + escalation'ı `answered` yapma) / "Mesaj gönder" | StatTile, AlertRow, Button, Badge | `instructor_alerts` (resolved_at null), `escalations` (open), `v_instructor_response_times` görünümü |
| `/dersler` ve `/dersler/[id]` | ders raporları: `lesson_analyses status in (draft)` listesi `Notice warning "Onay bekliyor"`; detay: `MasteryMeter` listesi (claim `skill_mastery`; `evidence` = mevcut `mastery.evidence_count`, `minEvidence` settings), `MisconceptionItem` kartları (`evidence` → `EvidenceQuote kind=lesson source="Ders 12 · 14:32"`), ödev/sözler listesi; her claim satırında "Onayla/Düzelt/Reddet" (düzelt: değer alanı `TextField`); altta "Onayla" (`primary`, sayfada tek) → `approve_lesson_analysis(analysis_id, decisions)` | MasteryMeter, MisconceptionItem, EvidenceQuote, Notice, Button, TextField, Badge | `lesson_analyses`, `lesson_claims`, `mastery_view`, RPC |
| `/cevaplar` | bot cevapları denetimi: `TutorMessage review={model, cost:"0,002 $", memory: memory_fact_ids.length, flagged, onFlag}`; filtre: kohort, hafta, yalnız işaretli; "İşaretle" → `bot_responses.flagged=true, flag_reason` (RLS instructor U) | TutorMessage, Badge, TextField | `bot_responses` (prompt_text görünür — temizlenmiş), `messages.text_raw` (instructor R) |
| `/kuyruk` | şekil ve soru onay kuyruğu: `FigureFrame status=pending|failed` kartları (`source` üretim aracı; ayrıntı panelinde render/vision/sympy adımları), altında "Onayla" / "Yeniden üret" / "Reddet"; soru metni + şıklar (`QuizOption` salt okunur) + "Cevap anahtarını göster" (RPC `peek_answer_key` — audit'e yazılır, UI bunu söyler) | FigureFrame, QuizOption, Button, Badge, Notice | `figures`, `items`, RPC |
| `/onaylar` (coordinator) | onay yönetimi: kişi etiketi, `consents` türleri ve sürümleri, veli onay durumu, iptal ("Onayı iptal et" → `revoked_at`), KVKK silme talepleri (`escalations reason=human_requested` + `/sil`), `legal_texts` sürümleri; `Notice legal` ile mevcut metin | Notice, Badge, Button, TextField | `consents`, `legal_texts`, `persons`, RPC `person_labels`, `erase_person` |
| `/ogrenci/[enrollment]` | profil: `MasteryMeter` listesi (period etiketi "YKS 2027"), açık `MisconceptionItem`, haftalık özet metni, son attempt'ler | MasteryMeter, MisconceptionItem, EvidenceQuote, Badge | `mastery_view`, `misconceptions`+`misconception_evidence`→`observations`, `weekly_summaries` |

Metin kuralları `lib/format.ts`: göreli süre ("14 saattir cevapsız", "3 gündür sessiz"), Türkçe sayı (`%72`, `1,4 saat`, `0,002 $`), mutlak zaman "19 Eki 14:32".

### 7.4 Veri erişimi ve yerel çalışma

- `lib/data/index.ts` → `DataSource` arayüzü (`alerts()`, `lessonAnalyses()`, `approveLesson()`, `botResponses()`, `flag()`, `queue()`, `consents()` …); `supabase.ts` ve `mock.ts` uygular. `NEXT_PUBLIC_DATA_SOURCE=mock` → `mocks/*.json` (`packages/db/seed/dev.yaml`'dan üretilir, `bun run build:seed` çıktısı kopyalanır).
- Auth mock: `mock` modunda rol seçici (`?role=coordinator|instructor|observer`), gerçek modda Supabase oturumu.
- Testler (vitest + jsdom + testing-library): `overview_orders_alerts_by_severity_then_age`, `stat_tile_shows_status_word`, `mastery_hides_percent_below_min_evidence` (bundle.js gerçek bileşen; `window.Ogrenmen` yüklenir), `lesson_draft_shows_onay_bekliyor`, `observer_has_no_approve_button`, `cost_only_in_review_row`, `student_label_is_initial_only`.
- Komutlar Bölüm 2.8. `bun run build` statik çıktı `out/`; Pages deploy `wrangler pages deploy out --project-name ogrenmen-panel`.

---

## 8. CI/CD ve operasyon

### 8.1 GitHub Actions

`ci.yml` (push + PR; `concurrency` ile aynı dalda tek koşu):

```yaml
jobs:
  ts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2            # bun 1.x
      - run: bun install --frozen-lockfile
      - run: bun run -r typecheck && bun run -r lint && bun run -r test     # tüm workspace'ler
  py:
    runs-on: ubuntu-latest
    strategy: { matrix: { pkg: [common, tablet, kalem, kitap, ders, kulaklik_batch] } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.13" }
      - run: sudo apt-get install -y ffmpeg graphviz
      - run: pip install -e packages/contracts/python -e packages/pii/py -e pipelines/common -e "pipelines/${{ matrix.pkg }}[dev]"
      - run: ruff check pipelines/${{ matrix.pkg }} && python -m pytest pipelines/${{ matrix.pkg }} -q
  pii-parity:
    steps: [checkout, setup-bun, setup-python, "bun run --cwd packages/pii/ts dump > /tmp/ts.json", "python -m ogrenmen_pii.dump > /tmp/py.json", "diff /tmp/ts.json /tmp/py.json"]
  db:
    runs-on: ubuntu-latest
    services:
      postgres: { image: pgvector/pgvector:pg16, env: { POSTGRES_PASSWORD: postgres }, ports: ["5432:5432"], options: --health-cmd pg_isready --health-interval 5s }
    steps:
      - uses: actions/checkout@v4
      - run: pip install sqlfluff && sqlfluff lint packages/db/supabase/migrations --dialect postgres
      - run: sudo apt-get install -y postgresql-client pgtap   # pgtap: apt 'postgresql-16-pgtap' ya da pgxn; yoksa Dockerfile.ci
      - run: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres bash packages/db/scripts/run-pgtap.sh
  content:
    steps: [checkout, setup-bun, "bun run --cwd packages/contracts validate:content"]
```

`nightly.yml` (`cron: '30 23 * * *'` UTC = 02:30 TRT; `workflow_dispatch`): tek job, adımlar sırayla `kulaklik_batch facts → alerts → retention --report → tablet generate --nightly → render → vision → ders analyze --queued → spend-report`. Her adım `continue-on-error: true` ve `$GITHUB_STEP_SUMMARY`'ye özet; `OGRENMEN_ADAPTERS=real` yalnız gizler tanımlıysa (`if: secrets.SUPABASE_BATCH_JWT != ''`), yoksa `fake` ile "dry nightly" (CI sağlığı). Süre bütçesi: 2.000 dk/ay → gece ≤40 dk (`timeout-minutes: 40`).

`weekly.yml` (`cron: '0 0 * * 0'`): `summaries`, `review-sample`, `kalem cluster/plan`.

`render.yml` (`workflow_dispatch` + `repository_dispatch: render`): `tablet render --pending && tablet vision --pending`; Tectonic kurulumu `wtfjoke/setup-tectonic@v3`; Lexend fontu `packages/design-system/fonts` → `~/.fonts`.

`keepalive.yml` (`cron: '0 3 */2 * *'`): `curl -fsS "$SUPABASE_URL/rest/v1/settings?select=key&limit=1" -H "apikey: $SUPABASE_ANON_KEY"`; Worker cron ile yedekli.

`deploy-worker.yml` (`main` push, `apps/bot-worker/**`, `packages/{contracts,pii,llm-router}/**` değişince): `bun install`, `bun run --cwd apps/bot-worker test`, `wrangler deploy` (`CLOUDFLARE_API_TOKEN`), ardından `scripts/set-webhook.ts` (idempotent). `deploy-panel.yml`: `bun run --cwd apps/egitmen-paneli sync:ds && build`, `wrangler pages deploy out`.

Veritabanı şeması deployu **elle ve kapılı**: `supabase db push` kurucunun makinesinden (`packages/db/README`), çünkü migrasyon geri alınamaz; CI yalnızca `supabase db diff --linked` ile "şema sürüklenmesi" uyarısı verir (`schema-drift.yml`, haftalık).

### 8.2 Gizler (GitHub)

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_BATCH_JWT`, `GEMINI_PAID_API_KEY`, `GEMINI_FREE_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `UNPAYWALL_EMAIL`, `S2_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `OPS_WEBHOOK_URL` (Worker'ın `/ops/notify` ucu, HMAC imzalı). `service_role` anahtarı GitHub'da **yok**.

### 8.3 Maliyet uyarı mekanizması (üç katman)

1. **Sağlayıcı tarafı tavan**: Gemini ücretli projede ön ödemeli bakiye + bütçe uyarısı (hesap açılışında elle; `docs/adr/ADR-0007`).
2. **Uygulama tarafı** (`spend_ledger` + `spend_caps`): Worker her çağrıdan önce `spend_status()` (60 sn önbellek). `daily_alert` → `OPS_CHAT_ID`'ye "Bugün 1,02 $ harcandı (uyarı eşiği 1,00 $)". `daily_cap` → ücretli sağlayıcılar kapanır, ücretsiz zincir devam eder; ücretsizler de düşerse öğrenciye dürüst mesaj. `monthly_cap` aynı.
3. **Gece raporu**: `spend-report` job summary + ay sonu tahmini (`gün ortalaması × kalan gün`); tahmin `monthly_alert`'i aşıyorsa Telegram uyarısı.

Panelde `/maliyet` (coordinator) yalnız toplamlar; öğrenci yüzeyinde maliyet asla yok.

### 8.4 Operasyon notları

- Loglar: Worker `console.log` JSON satırları (`{lvl, evt, chat_hash, ms}`) — kişi kimliği değil `sha256(chat_id)[:8]`; Cloudflare Logpush yok (ücretsiz plan), `wrangler tail` yeterli.
- Olay müdahalesi: `docs/runbook.md` (M15) — webhook düşerse `set-webhook.ts`, Supabase uyursa keepalive tetikle, anahtar sızıntısı şüphesinde `mint-jwt.ts --rotate` + Supabase JWT secret döndürme adımları.
- Yedek: Supabase ücretsiz planda otomatik yedek yok → `weekly.yml` içinde `pg_dump --schema=public --schema=audit` (secure HARİÇ) GitHub artefaktı (90 gün, şifreli `age` ile `BACKUP_AGE_PUBKEY`). `secure` şeması ayrı, kurucu makinesinde elle (`packages/db/scripts/backup-secure.sh`).

---

## 9. Güvenlik ve KVKK

### 9.1 Somut mekanizmalar (kod yollarıyla)

| Kural | Mekanizma | Doğrulayan test |
| --- | --- | --- |
| Öğrenci API'lere rastgele kimlikle gider | `persons.id` uuid; ad/okul yalnız `secure.person_pii`; Worker ve Python `secure`'a erişemez (`revoke usage on schema secure`) | pgTAP `10_secure_schema.sql`: `set role bot_worker; select from secure.person_pii` → `permission denied` |
| LLM'e giden metinde PII yok | `messages.text_llm = scrub(text_raw, names)`; prompt yalnız `text_llm`, `memory_facts.text`, `misconception_tags.text_student`, kazanım adları; `bot_responses.prompt_text` temizlenmiş prompt | Worker `prompt_has_no_pii`; pii `cases.json` parity; Python `test_no_names_in_transcript_file` |
| Ham mesajı Python görmez | `revoke select (text_raw) on messages from batch_worker` | pgTAP `11_column_grants.sql` |
| Cevap anahtarı LLM yolundan yazılamaz/okunamaz | `secure.answer_keys`; `submit_answer` security definer; `attempts_protect_graded` tetikleyicisi; `register_answer_key` yalnız `batch_worker` ve `sympy_verified` bayrağı; `reveal_solution` yalnız cevaptan sonra | pgTAP `30_answer_keys.sql`: bot_worker `update attempts set is_correct=true` → exception; `select from secure.answer_keys` → denied; `submit_answer` dönüşünde `correct_letter` yok |
| Kanıtsız iddia yok | `observations.source_id not null` + `observations_check_source` tetikleyicisi; `misconceptions_status_guard` (≥1 kanıt); `mastery` yalnız `apply_observation` yazar; `mastery_view.is_reliable` | pgTAP `40_evidence_chain.sql`: kaynaksız insert → `OGR-EVID-001`; kanıtsız `status='open'` → exception |
| Ders raporu onaysız profile işlenmez | `lesson_claims.status='approved'` şartı `observations_check_source` içinde; `approve_lesson_analysis` tek yol | pgTAP `41_lesson_claims.sql` |
| RLS ve GRANT birlikte | Her tabloda `force row level security`; `0012` GRANT matrisi; `tests/pgtap/20_rls_matrix.sql` matrisi satır satır (`set local role`, `set local request.jwt.claims`) | pgTAP: öğrenci A, öğrenci B'nin `mastery`/`attempts`/`messages` satırını göremez; observer `update` edemez; branş eğitmeni başka dersin öğrencisini göremez |
| Saklama süresi metinle aynı | `retention_policies.user_facing_text` → Worker kayıt bildirimi `{days}`'ı tablodan doldurur; `legal/saklama-sureleri.md` tablodan üretilir (`kulaklik_batch retention --export-md`) | Worker `group_added_pins_recording_notice_with_retention_days`; contracts testi `legal/*.md` içindeki gün sayıları `retention_policies` seed'iyle eşit |
| Model anahtarları yalnız sunucuda | Worker secret; panel statik ve anahtarsız; GitHub gizleri yalnız batch | `apps/egitmen-paneli` build çıktısında `grep -r "AIza\|gsk_\|sk-or-" out/` boş (CI adımı) |
| Reşit olmayan onaysız sohbet etmez | `consent_state` kapısı; LLM çağrısı yok; `text_llm=null` | Worker `start_minor_consent_gate` |
| Audit | `audit.events` tetikleyicileri; `peek_answer_key` ve tüm onay RPC'leri audit yazar | pgTAP `50_audit.sql` |
| Telegram webhook sahteciliği | secret token başlığı + rastgele yol; `update_id` idempotenlik | Worker `webhook_rejects_bad_secret` |
| Sandbox render | `python -I -S`, boş env, rlimit, ağ yok (`unshare -n` varsa), 20 sn zaman aşımı | tablet `test_sandbox_blocks_network_and_fs` |
| Sızıntı tarama | CI `gitleaks` adımı (`gitleaks/gitleaks-action@v2`) | — |

### 9.2 Veri envanteri (KVKK kayıt için)

| Veri | Tablo | Hukuki dayanak (öneri, hukukçu doğrular) | Saklama |
| --- | --- | --- | --- |
| Ad, soyad, doğum yılı, veli iletişimi | `secure.person_pii` | açık rıza / veli rızası (KVKK m.5, m.6 yok) | üyelik + 1 yıl, silme talebiyle anında |
| Telegram kullanıcı kimliği, kullanıcı adı | `secure.telegram_identities` | sözleşmenin ifası | üyelik süresi |
| Mesaj içeriği | `messages` | açık rıza (grup bildirimi + onay) | 90 gün |
| Öğrenme verisi (gözlem, ustalık, yanılgı) | `observations`, `mastery`, `misconceptions` | sözleşmenin ifası | dönem + 2 yıl (rastgele kimlikle) |
| Ders ses/video | Storage `lessons-raw` | açık rıza (ders kaydı bildirimi) | 30 gün |
| Transkript (isimsiz) | Storage `lessons-transcripts` | — (anonimleştirilmiş) | dönem + 2 yıl |
| Bot günlüğü (prompt) | `bot_responses` | meşru menfaat (kalite denetimi) | prompt 30 gün, satır 365 gün |

### 9.3 Hazırlanacak belgeler (`legal/`, hepsi "HUKUKİ İNCELEME GEREKLİ — taslak, yayımlanmaz" bandıyla)

1. `aydinlatma-metni.md` — KVKK m.10 aydınlatma: veri sorumlusu (easy), işlenen veriler (9.2 tablosu), amaçlar, aktarım (model sağlayıcıları: Google, Groq, Cloudflare, OpenRouter — yurt dışı aktarım notu, rastgele kimlik ve PII temizliği açıklaması), saklama süreleri (`{{RETENTION_MESSAGES_DAYS}}` vb. yer tutucular, `kulaklik_batch retention --export-md` ile doldurulur), haklar (m.11), başvuru yolu (`/sil` komutu ve e-posta). Çocuğun anlayacağı kısa sürüm ("Verilerin nasıl kullanılıyor?") aynı dosyanın son bölümü; Worker `/yardim` bu bölümü gösterir.
2. `veli-onay-formu.md` — 18 yaş altı için veli açık rızası: kimlik doğrulama yöntemi (Telegram `/onay <kod>` ya da imzalı form), kapsam (sohbet kaydı, öğrenme profili, ders kaydı analizi), geri alma yolu. Onay ekranı metni `guven-ve-seffaflik.md` kuralına uygun: önceden işaretli kutu yok, "Onaylıyorum" / "Şimdi değil".
3. `grup-kayit-bildirimi.md` — gruba sabitlenen metin: "Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve {{RETENTION_MESSAGES_DAYS}} gün sonra silinir. Öğrenmen bir yapay zekâ öğretmenidir; hocalar da bu grupta." + bağlantı.
4. `saklama-sureleri.md` — üretilen özet (kaynak: `retention_policies`).
5. `ders-kaydi-bildirimi.md` — ders videosu analizi için eğitmen ve öğrenciye/veliye: ses+kare alınır, isimler API'ye gitmez, video 30 gün sonra silinir ve bildirilir, transkript kalır.
6. `veri-isleme-envanteri.md` — 9.2 tablosu (VERBİS gerekliliği hukukçuya sorulur).

`legal/placeholders.json` yer tutucuların tek listesi; M15'in CI adımı `legal/*.md` içinde tanımsız `{{...}}` kalmadığını kontrol eder.

---

## 10. İlk içerik

### 10.1 Müfredat sürümü

`content/tyt-matematik/curriculum.yaml`: `code: TYT-MAT`, `authority: ÖSYM`, `year: 2026`, `version: "2026.1"`, `title: "TYT Matematik (ÖSYM 2026 kılavuzu)"`. Dönem: `academic_periods: YKS-2027` (1 Eyl 2026 – 30 Haz 2027). Program değişince `2027.1` yeni satır; eski `mastery` eski `skills` kimliklerine bağlı kalır; eşleme tablosu `skill_mappings(old_skill_id, new_skill_id, relation)` ileride (`0014`), şimdi değil.

### 10.2 Kazanım ağacı dilimi (pilot: "Temel Kavramlar → Rasyonel sayılar → Denklem/Problem" hattı; 14 yaprak + 4 düğüm)

Kodlar `skills.yaml` içinde; `parent` hiyerarşi, `prereq` ön koşul kenarı (`strength`):

```
TYT.MAT.SAYILAR                        (düğüm)
├── TYT.MAT.SAYILAR.TEMEL              Temel kavramlar: doğal/tam sayılar, tek-çift, pozitif-negatif, işlem önceliği
├── TYT.MAT.SAYILAR.BOLME              Bölme ve bölünebilme kuralları         prereq: TEMEL(1.0)
├── TYT.MAT.SAYILAR.OBEB_OKEK          OBEB-OKEK                               prereq: BOLME(1.0)
├── TYT.MAT.SAYILAR.RASYONEL           (düğüm)
│   ├── TYT.MAT.SAYILAR.RASYONEL.KAVRAM     Kesir kavramı, denk kesirler, sadeleştirme   prereq: BOLME(0.6)
│   ├── TYT.MAT.SAYILAR.RASYONEL.TOPLAMA    Kesirlerde toplama-çıkarma (payda eşitleme)  prereq: KAVRAM(1.0), OBEB_OKEK(0.7)
│   ├── TYT.MAT.SAYILAR.RASYONEL.CARPMA     Kesirlerde çarpma-bölme                       prereq: KAVRAM(1.0)
│   └── TYT.MAT.SAYILAR.RASYONEL.SIRALAMA   Rasyonel sayılarda sıralama ve sayı doğrusu   prereq: TOPLAMA(0.5), CARPMA(0.5)
├── TYT.MAT.SAYILAR.ONDALIK            Ondalık gösterim ve yüzde                prereq: RASYONEL.KAVRAM(1.0)
├── TYT.MAT.SAYILAR.USLU               Üslü ifadeler                            prereq: TEMEL(1.0)
├── TYT.MAT.SAYILAR.KOKLU              Köklü ifadeler                           prereq: USLU(1.0)
└── TYT.MAT.SAYILAR.MUTLAK             Mutlak değer                             prereq: TEMEL(0.8)
TYT.MAT.CEBIR                          (düğüm)
├── TYT.MAT.CEBIR.DENKLEM1             Birinci dereceden bir bilinmeyenli denklem   prereq: RASYONEL.TOPLAMA(0.8), TEMEL(1.0)
├── TYT.MAT.CEBIR.ESITSIZLIK           Basit eşitsizlikler                      prereq: DENKLEM1(1.0)
└── TYT.MAT.CEBIR.ORAN                 Oran-orantı                              prereq: RASYONEL.CARPMA(1.0)
TYT.MAT.PROBLEM                        (düğüm)
├── TYT.MAT.PROBLEM.SAYI               Sayı ve kesir problemleri                prereq: DENKLEM1(1.0), RASYONEL.TOPLAMA(0.7)
├── TYT.MAT.PROBLEM.YUZDE              Yüzde, kâr-zarar                         prereq: ONDALIK(1.0), ORAN(0.8)
└── TYT.MAT.PROBLEM.HAREKET            Hareket ve işçi problemleri              prereq: ORAN(1.0), DENKLEM1(1.0)
```

BKT parametreleri varsayılan (`p_L0=.20, p_T=.10, p_G=.25, p_S=.10`); `numeric` türü sorularda `p_G=.05` (item düzeyi override: `items.difficulty` değil, `apply_observation` `kind`'e göre `skills.bkt_p_g` yerine `0.05` kullanır — `value.guess_rate` alanı attempt'ten gelir, implementer `submit_answer` içinde `jsonb_build_object('correct',correct,'guess_rate', case kind when 'numeric' then 0.05 else 0.25 end)` yazar ve `apply_observation` `coalesce(value->>'guess_rate', p_g)` kullanır).

### 10.3 Çeldirici yanılgı etiket kataloğu (`misconception-tags.yaml`, kesit)

| Kod | Kazanım | Ön koşul işareti | Eğitmen metni |
| --- | --- | --- | --- |
| `RASYONEL.PAY_PAYDA_AYRI_TOPLAMA` | RASYONEL.TOPLAMA | RASYONEL.KAVRAM | Payları ve paydaları ayrı ayrı topluyor. |
| `RASYONEL.PAYDA_ESITLEMEDEN_TOPLAMA` | RASYONEL.TOPLAMA | OBEB_OKEK | Paydaları eşitlemeden payları topluyor. |
| `RASYONEL.BOLMEDE_TERS_CEVIRMEME` | RASYONEL.CARPMA | — | Kesirle bölmede ikinci kesri ters çevirmiyor. |
| `RASYONEL.BUYUK_PAYDA_BUYUK_SAYI` | RASYONEL.SIRALAMA | RASYONEL.KAVRAM | Paydası büyük kesri daha büyük sanıyor. |
| `TEMEL.ISLEM_ONCELIGI_SOLDAN` | TEMEL | — | Çarpma/bölmeyi toplama/çıkarmadan önce yapmıyor, soldan sağa gidiyor. |
| `TEMEL.NEGATIF_ISARET_KAYBI` | TEMEL | — | Parantez açarken eksi işaretini dağıtmıyor. |
| `USLU.TABAN_USSU_CARPIYOR` | USLU | — | a^n ifadesini a·n olarak hesaplıyor. |
| `USLU.USLERI_CARPIYOR_TOPLAMA_YERINE` | USLU | — | Aynı tabanlı çarpımda üsleri topluyor yerine çarpıyor. |
| `KOKLU.KOK_TOPLAMI_AYRIYOR` | KOKLU | USLU | √(a+b) = √a + √b sanıyor. |
| `MUTLAK.ICERIGI_HEP_POZITIF` | MUTLAK | TEMEL | Mutlak değer içindeki ifadenin işaretini incelemiyor. |
| `DENKLEM1.TARAF_DEGISTIRME_ISARET` | DENKLEM1 | TEMEL | Terimi karşı tarafa geçirirken işaret değiştirmiyor. |
| `DENKLEM1.KATSAYIYA_BOLMEME` | DENKLEM1 | RASYONEL.CARPMA | Son adımda bilinmeyenin katsayısına bölmüyor. |
| `ESITSIZLIK.NEGATIFLE_CARPMA_YON` | ESITSIZLIK | DENKLEM1 | Negatifle çarpınca/bölünce eşitsizlik yönünü çevirmiyor. |
| `ORAN.ICLER_DISLAR_YANLIS` | ORAN | RASYONEL.CARPMA | İçler-dışlar çarpımını yanlış eşliyor. |
| `YUZDE.YUZDEYI_TOPLUYOR` | PROBLEM.YUZDE | ONDALIK | Ardışık yüzde değişimlerini toplayarak hesaplıyor. |
| `YUZDE.TABAN_KARISTIRMA` | PROBLEM.YUZDE | ORAN | Kâr yüzdesini maliyet yerine satış fiyatı üzerinden alıyor. |
| `PROBLEM.DENKLEM_KURMA_TERS` | PROBLEM.SAYI | DENKLEM1 | "A, B'den 5 fazla" ifadesini A+5=B olarak kuruyor. |
| `HAREKET.YOL_HIZ_ZAMAN_YER` | PROBLEM.HAREKET | ORAN | Yol = hız / zaman gibi yanlış ilişki kuruyor. |
| `GENEL.BIRIM_UNUTMA` | (çok kazanım) | — | Birim dönüşümünü (dk↔saat, kuruş↔lira) yapmıyor. |
| `GENEL.SORUYU_YARIM_OKUMA` | (çok kazanım) | — | Sorulanı değil ara sonucu işaretliyor. |

Her etiketin `text_student` sürümü sen diliyle aynı dosyada ("Payları ve paydaları ayrı ayrı topluyorsun.").

### 10.4 Teşhis testi stratejisi (`diagnostic-v1.yaml`, 18 soru)

- Hedef: 14 yaprak kazanımın her biri en az 1, hattın omurgası (TEMEL, RASYONEL.TOPLAMA, DENKLEM1, PROBLEM.YUZDE) 2 soru; toplam 18, 25 dakika. Zorluk: 6 kolay (`difficulty .3`), 8 orta (.5), 4 zor (.7). Sıra: kolaydan zora değil, kazanım hattı sırasında (TEMEL → RASYONEL → USLU/KOKLU/MUTLAK → CEBİR → PROBLEM) — öğrenci erken bırakırsa yine temel hat ölçülmüş olur.
- Her soru 4 şıklı (`A–D`), **her yanlış şık bir yanılgı etiketi taşır** (en az 2 şık etiketli; 3. çeldirici hesap hatası olabilir, `null`). 3 soru şekilli (sayı doğrusu, kesir modeli, yüzde grafiği — `templates/` parametrik üreticilerinden `seed` ile sabitlenmiş; şekil `verified` olarak seed edilir çünkü insan denetiminden geçer, `figures.reviewed_by` seed'de kurucu).
- Cevap anahtarları **ayrı dosyada** (`diagnostic-v1.keys.yaml`), yalnız `seed.secure.sql`'e gider; `diagnostic-v1.yaml` içinde doğru şık işareti yoktur (contracts testi: `diagnostic_test.schema.json` `correct` alanı tanımsız ve `additionalProperties:false`).
- Sonuç kuralı: 18 cevap → her kazanım 1–2 gözlem → `evidence_count < 5`, yani **teşhis sonunda yüzde gösterilmez**; bot "İlk haritanı çıkardık: şu konularla başlayalım" der ve en düşük `p`'li 3 kazanımı adıyla verir, sayı vermez (`is_reliable=false`). Yüzde ancak sonraki 3–4 pratik sorudan sonra görünür.
- Örnek madde (yaml):
  ```yaml
  - code: DIAG1-07
    skills: [TYT.MAT.SAYILAR.RASYONEL.TOPLAMA]
    difficulty: 0.5
    stem: "`3/4 + 1/8` işleminin sonucu kaçtır?"
    options:
      - { letter: A, text: "`4/12`", misconception: RASYONEL.PAY_PAYDA_AYRI_TOPLAMA }
      - { letter: B, text: "`7/8`",  misconception: null }
      - { letter: C, text: "`4/8`",  misconception: RASYONEL.PAYDA_ESITLEMEDEN_TOPLAMA }
      - { letter: D, text: "`3/32`", misconception: RASYONEL.BOLMEDE_TERS_CEVIRMEME }
    figure: null
  ```
  (`keys.yaml`: `DIAG1-07: { correct_letter: B, canonical_expr: "Rational(3,4)+Rational(1,8)", solution_md: "Paydaları 8'de eşitle: 6/8 + 1/8 = 7/8." }`)

### 10.5 Öğretmen incelemesinin veride işaretlenmesi

- Soru: `items.verification_status` (`review_pending` → `approved|rejected`), `reviewed_by`, `reviewed_at`, `review_note`; şekil: `figures.review_status`. Panel `/kuyruk`. Öğrenciye yalnız `approved` + `verified` gider (sorgu filtresi + tetikleyici + Worker `figure_unverified_not_sent` testi).
- Yanılgı: `misconceptions.status` `pending_review` → `open` eğitmen onayıyla (panel `/ogrenci`), `resolved` yalnız `resolved_by` + `resolution_observation_id`.
- Ders raporu: `lesson_analyses.status`, `lesson_claims.status` (`approved|edited|rejected`), `decided_by`.
- Bot cevabı: `bot_responses.flagged`, `flag_reason`, `review_week`.
- Olgu: `memory_facts.status` (`approved` yalnız eğitmen; `retracted` ile geri alma), `approved_by`.
- Her biri `audit.events`'e düşer; panelde "kim, ne zaman" görünür.

---

## 11. Paralel inşa planı

Kurallar: her modülün dizini **yalnız ona** aittir; iki modül aynı dosyaya dokunmaz. Kök dosyalar (`package.json`, `bun.lock`, `tsconfig.base.json`, `README.md`, `.github/`, `scripts/`, `docs/adr`, `docs/runbook.md`) yalnız M15'e aittir ve M15 en son çalışır. Bir modül bağımlı olduğu paketi **henüz yoksa** kendi `test/stubs/` altında arayüz taklidiyle geliştirir (ör. M05, M04 bitmeden `FakeProvider` arayüzünü `packages/llm-router` yerine kendi stub'ından alır) — ama kabul testi gerçek bağımlılıkla koşar, bu yüzden dalgalar sıralıdır. Aynı anda 2 ajan çalışır; dalga içi iki modül birbirine bağımlı değildir.

| Dalga | Modüller |
| --- | --- |
| 1 | M01 contracts · M14 legal |
| 2 | M02 db · M03 pii |
| 3 | M12 content · M04 llm-router |
| 4 | M06 py-common · M05 bot-worker |
| 5 | M07 tablet · M11 kulaklik-batch |
| 6 | M10 ders · M13 panel |
| 7 | M08 kalem · M09 kitap |
| 8 | M15 entegrasyon (tek ajan) |

Her modül için: kimlik, dizin, bağımlılıklar, çıktılar, kabul komutları (hepsi hesapsız, `cd` ile başlar, sıfır çıkış kodu ile geçer).

### M01 — contracts
- Dizin: `/home/user/alperen/packages/contracts/`
- Bağımlılık: —
- Çıktılar: Bölüm 4'teki tüm şemalar (`common, question_item, answer_key, lesson_analysis, memory_fact, weekly_summary, citation, research_output, exam_item, priority_plan, bot_response_log, instructor_alert, tutor_reply, curriculum, diagnostic_test, diagnostic_keys, telegram_update, spend_event, figure_render_report`), her şema için ≥2 valid ≥2 invalid fikstür, `src/index.ts` + `src/generated.d.ts`, Python paketi, `scripts/flatten.py`, `x-forbidden-words` özel anahtar kelimesi (Ajv `keyword` + Python `validators.extend`).
- Kabul:
  ```
  cd /home/user/alperen/packages/contracts && bun install && bun run gen && bun run typecheck && bun run test
  cd /home/user/alperen/packages/contracts && pip install -e ./python[dev] && python -m pytest python/tests -q
  cd /home/user/alperen/packages/contracts && git diff --exit-code src/generated.d.ts   # gen çıktısı commit edilmiş
  ```

### M14 — legal
- Dizin: `/home/user/alperen/legal/`
- Bağımlılık: —
- Çıktılar: 9.3'teki 6 belge + `placeholders.json`; her dosya ilk satırda `> HUKUKİ İNCELEME GEREKLİ — taslak, yayımlanmaz`.
- Kabul:
  ```
  cd /home/user/alperen/legal && for f in aydinlatma-metni veli-onay-formu grup-kayit-bildirimi saklama-sureleri ders-kaydi-bildirimi veri-isleme-envanteri; do test -s $f.md && head -1 $f.md | grep -q 'HUKUKİ İNCELEME GEREKLİ'; done
  cd /home/user/alperen/legal && python3 -c "import json,re,glob; ph=set(json.load(open('placeholders.json')).keys()); used={m for f in glob.glob('*.md') for m in re.findall(r'{{(\w+)}}', open(f).read())}; assert used<=ph, used-ph"
  ```

### M02 — db
- Dizin: `/home/user/alperen/packages/db/`
- Bağımlılık: M01 (şema adları), M12 (seed içeriği — M12 yoksa `seed/dev.yaml` ile çalışır; `build:seed` content dosyası yoksa yalnız dev seed üretir ve uyarır)
- Çıktılar: `0001–0013` migrasyonları, `0011` fonksiyonları (BKT, submit_answer, apply_observation, retrieve_context, resolve_telegram, register_telegram_person, record_consent, approve_lesson_analysis, consume_quota, spend_status, run_retention, erase_person, person_labels, pool_or_request, reveal_solution, peek_answer_key, register_answer_key, verify_key, resolve_lesson_labels, notify_ops), `0012` RLS+GRANT matrisi, pgTAP testleri (`10_secure_schema, 11_column_grants, 20_rls_matrix, 30_answer_keys, 40_bkt, 40_evidence_chain, 41_lesson_claims, 50_audit, 60_retention`), `scripts/{build-seed.ts, mint-jwt.ts, run-pgtap.sh, backup-secure.sh}`, `seed/dev.yaml`, `tests/logic/*.test.ts`, `README.md` (db push adımları).
- Kabul:
  ```
  cd /home/user/alperen/packages/db && bun install && bun run build:seed && bun run test:logic
  cd /home/user/alperen/packages/db && pip install sqlfluff && sqlfluff lint supabase/migrations --dialect postgres
  cd /home/user/alperen/packages/db && bash scripts/run-pgtap.sh        # DATABASE_URL yoksa "SKIP: no database" yazar ve 0 döner; varsa pg_prove geçer
  cd /home/user/alperen/packages/db && bun run scripts/mint-jwt.ts --role bot_worker --secret test-secret --exp 1h | python3 -c "import sys,base64,json; t=sys.stdin.read().strip().split('.'); print(json.loads(base64.urlsafe_b64decode(t[1]+'=='))['role'])" | grep -qx bot_worker
  ```

### M03 — pii
- Dizin: `/home/user/alperen/packages/pii/`
- Bağımlılık: —
- Çıktılar: `cases.json` (≥60 vaka: e-posta, telefon, TCKN geçerli/geçersiz, IBAN, @kullanıcı, ad listesi eşlemesi, okul kalıpları, sınıf, URL, matematik ifadeleri DOKUNULMAZ vakaları), `ts/` ve `py/` uygulamaları, `dump` komutları.
- Kabul:
  ```
  cd /home/user/alperen/packages/pii/ts && bun install && bun run typecheck && bun run test
  cd /home/user/alperen/packages/pii/py && pip install -e .[dev] && python -m pytest -q
  cd /home/user/alperen/packages/pii && bun run --cwd ts dump > /tmp/pii-ts.json && python -m ogrenmen_pii.dump > /tmp/pii-py.json && diff /tmp/pii-ts.json /tmp/pii-py.json
  ```

### M12 — content
- Dizin: `/home/user/alperen/content/tyt-matematik/`
- Bağımlılık: M01 (şemalar)
- Çıktılar: `curriculum.yaml`, `skills.yaml` (10.2 ağacı, 18 düğüm, 20 kenar), `misconception-tags.yaml` (≥20), `diagnostic-v1.yaml` (18 madde), `diagnostic-v1.keys.yaml`, `templates/{kesir-toplama,ucgen-aci,yuzde-problemi}.yaml`, `README.md` (kaynak: ÖSYM TYT kılavuzu konu başlıkları; soru metinleri özgün).
- Kabul:
  ```
  cd /home/user/alperen/content/tyt-matematik && pip install pyyaml jsonschema && python3 -c "
  import yaml,json,jsonschema,glob
  S=lambda n: json.load(open('/home/user/alperen/packages/contracts/schemas/%s.schema.json'%n))
  jsonschema.validate(yaml.safe_load(open('skills.yaml')), S('curriculum'))
  d=yaml.safe_load(open('diagnostic-v1.yaml')); jsonschema.validate(d, S('diagnostic_test'))
  k=yaml.safe_load(open('diagnostic-v1.keys.yaml')); jsonschema.validate(k, S('diagnostic_keys'))
  assert 15<=len(d['items'])<=20 and set(i['code'] for i in d['items'])==set(k.keys())
  assert all(sum(1 for o in i['options'] if o['misconception']) >= 2 for i in d['items'])
  assert 'correct' not in json.dumps(d)
  print('ok')"
  ```

### M04 — llm-router
- Dizin: `/home/user/alperen/packages/llm-router/`
- Bağımlılık: M01
- Çıktılar: 5.4 arayüzleri, 5 sağlayıcı + Fake, `cost.json` (tek kaynak; Python okur) + `cost.ts`, `structured.ts`, `SpendGate` arayüzü ve bellek içi uygulama, testler (`fallback_on_429`, `no_fallback_on_401`, `paid_skipped_when_cap`, `schema_retry_once_then_fallback`, `cost_computed_from_table`, `strong_tier_rejected_when_disallowed`, `timeout_falls_through`).
- Kabul:
  ```
  cd /home/user/alperen/packages/llm-router && bun install && bun run typecheck && bun run test
  cd /home/user/alperen/packages/llm-router && node -e "const c=require('./src/cost.json'); if(!c['gemini-paid']['gemini-2.5-flash-lite']) process.exit(1)"
  ```

### M06 — py-common
- Dizin: `/home/user/alperen/pipelines/common/`
- Bağımlılık: M01, M03, M04 (`cost.json` yolu)
- Çıktılar: 6.0 ağacı; `selftest`; `JsonlDb` fikstür okuma (`--fixtures DIR/<table>.json`), `LocalDirStorage`; adaptör sözleşme testleri (her `Fake*` `Protocol`'ü karşılar — `typing.runtime_checkable`).
- Kabul:
  ```
  cd /home/user/alperen/pipelines/common && pip install -e ../../packages/contracts/python -e ../../packages/pii/py -e .[dev] && ruff check . && python -m pytest -q
  cd /home/user/alperen/pipelines/common && OGRENMEN_ADAPTERS=fake python -m ogrenmen_common.selftest
  ```

### M05 — bot-worker
- Dizin: `/home/user/alperen/apps/bot-worker/`
- Bağımlılık: M01, M03, M04 (M02 ile yalnız RPC imzaları: `src/db/rpc.ts` M02 `0011` ile isim-isim eşleşir; CI'da M15 bunu `scripts/check-rpc-parity.sh` ile doğrular)
- Çıktılar: 5.1 ağacı, 5.11 zorunlu senaryoların tümü, `scripts/smoke.ts`, `.dev.vars.example`, `README.md` (webhook kurulumu).
- Kabul:
  ```
  cd /home/user/alperen/apps/bot-worker && bun install && bun run typecheck && bun run lint && bun run test
  cd /home/user/alperen/apps/bot-worker && (bun run dev >/tmp/wr.log 2>&1 & echo $! > /tmp/wr.pid; sleep 8; bun run smoke; kill $(cat /tmp/wr.pid))
  cd /home/user/alperen/apps/bot-worker && ! grep -rn "answer_key\|correct_letter" src/ --include=*.ts | grep -v "reveal_solution\|// anahtar yok"
  cd /home/user/alperen/apps/bot-worker && ! grep -rnP "[!\x{1F300}-\x{1FAFF}]" src/text/tr.ts
  ```

### M07 — tablet
- Dizin: `/home/user/alperen/pipelines/tablet/`
- Bağımlılık: M06, M12 (şablon tanımları), M01
- Çıktılar: 6.1 komutları, sandbox runner'lar, 3 şablon üreticisi, LaTeX `exam` şablonu, fikstürler, testler.
- Kabul:
  ```
  cd /home/user/alperen/pipelines/tablet && pip install -e ../common -e ../../packages/contracts/python -e ../../packages/pii/py -e .[dev] && ruff check . && python -m pytest -q
  cd /home/user/alperen/pipelines/tablet && python -m ogrenmen_tablet template --code kesir-toplama --n 20 --seed 7 --adapters fake --dry-run --out /tmp/tablet && test $(wc -l < /tmp/tablet/items.jsonl) -eq 20 && ! grep -q correct_letter /tmp/tablet/items.jsonl
  cd /home/user/alperen/pipelines/tablet && python -m ogrenmen_tablet render --fixtures fixtures/figures --adapters fake --dry-run --out /tmp/tablet && ls /tmp/tablet/figures/*.png | wc -l | grep -qv '^0$'
  cd /home/user/alperen/pipelines/tablet && python -m ogrenmen_tablet generate --skill TYT.MAT.SAYILAR.RASYONEL.TOPLAMA --band mid --n 3 --adapters fake --dry-run --fixtures fixtures --out /tmp/tablet
  ```
  (Tectonic yoksa `pdf` komutu `SKIP` der; test `test_pdf_requires_tectonic` bunu bekler.)

### M11 — kulaklik-batch
- Dizin: `/home/user/alperen/pipelines/kulaklik_batch/`
- Bağımlılık: M06, M01
- Çıktılar: 6.5 komutları, fikstürler (`fixtures/messages.json` 3 gün × 3 kişi, `fixtures/escalations.json`), testler, `retention --export-md` (legal/saklama-sureleri.md üretimi — dosyayı `--out`'a yazar; `legal/` M14'ündür, M15 kopyalar).
- Kabul:
  ```
  cd /home/user/alperen/pipelines/kulaklik_batch && pip install -e ../common -e ../../packages/contracts/python -e ../../packages/pii/py -e .[dev] && ruff check . && python -m pytest -q
  cd /home/user/alperen/pipelines/kulaklik_batch && python -m ogrenmen_kulaklik_batch facts --since 24h --adapters fake --dry-run --fixtures fixtures --out /tmp/kb && python3 -c "import json; rows=[json.loads(l) for l in open('/tmp/kb/memory_facts.jsonl')]; assert rows and all(len(r['source_message_ids'])>=1 for r in rows)"
  cd /home/user/alperen/pipelines/kulaklik_batch && python -m ogrenmen_kulaklik_batch alerts --adapters fake --dry-run --fixtures fixtures --out /tmp/kb && ! grep -qiE "depresif|tembel" /tmp/kb/instructor_alerts.jsonl
  ```

### M10 — ders
- Dizin: `/home/user/alperen/pipelines/ders/`
- Bağımlılık: M06, M01
- Çıktılar: 6.4 adımları, `scripts/make_fixture.sh` (ffmpeg `testsrc2`/`sine` ile 20 sn + 30 sahne), fikstürler, testler.
- Kabul:
  ```
  cd /home/user/alperen/pipelines/ders && pip install -e ../common -e ../../packages/contracts/python -e ../../packages/pii/py -e .[dev] && ruff check . && python -m pytest -q
  cd /home/user/alperen/pipelines/ders && bash scripts/make_fixture.sh /tmp/ders-fx.mp4 && python -m ogrenmen_ders analyze --video /tmp/ders-fx.mp4 --adapters fake --dry-run --fixtures fixtures --out /tmp/ders && test -f /tmp/ders/lesson_analyses.jsonl && test -f /tmp/ders/lesson_claims.jsonl && ! test -f /tmp/ders/observations.jsonl
  ```

### M13 — egitmen-paneli
- Dizin: `/home/user/alperen/apps/egitmen-paneli/`
- Bağımlılık: M01, `packages/design-system` (salt okunur), M02 (`seed/dev.yaml`'dan üretilen mock'lar — M02 yoksa kendi `mocks/` elle yazılır ve M15 eşitler)
- Çıktılar: 7.3 sayfaları, `lib/ds.tsx`, `lib/data/*`, `mocks/*.json`, testler, `sync:ds` script'i.
- Kabul:
  ```
  cd /home/user/alperen/apps/egitmen-paneli && bun install && bun run sync:ds && bun run typecheck && bun run lint && bun run test
  cd /home/user/alperen/apps/egitmen-paneli && NEXT_PUBLIC_DATA_SOURCE=mock bun run build && test -f out/index.html && ! grep -rlE "AIza|gsk_|sk-or-|service_role" out/
  cd /home/user/alperen/apps/egitmen-paneli && grep -q 'lang="tr"' app/layout.tsx
  ```

### M08 — kalem
- Dizin: `/home/user/alperen/pipelines/kalem/`
- Bağımlılık: M06, M01, (M07 `generate --like` arayüzü yalnız `--with-variants` bayrağında; testlerde fake)
- Kabul:
  ```
  cd /home/user/alperen/pipelines/kalem && pip install -e ../common -e ../../packages/contracts/python -e ../../packages/pii/py -e .[dev] && ruff check . && python -m pytest -q
  cd /home/user/alperen/pipelines/kalem && python -m ogrenmen_kalem plan --course 00000000-0000-0000-0000-000000000001 --adapters fake --dry-run --fixtures fixtures --out /tmp/kalem && python3 -c "import json; p=json.loads(open('/tmp/kalem/priority_plans.jsonl').readline()); assert p['title']=='Sıklık analizine göre öncelikler' and p['rows']; s=json.dumps(p, ensure_ascii=False).lower(); assert 'ocr_text' not in s and 'tahmin' not in s and 'çıkacak' not in s"
  ```

### M09 — kitap
- Dizin: `/home/user/alperen/pipelines/kitap/`
- Bağımlılık: M06, M01
- Kabul:
  ```
  cd /home/user/alperen/pipelines/kitap && pip install -e ../common -e ../../packages/contracts/python -e ../../packages/pii/py -e .[dev] && ruff check . && python -m pytest -q
  cd /home/user/alperen/pipelines/kitap && python -m ogrenmen_kitap run --query "ters yüz sınıf matematik başarısı" --adapters fake --dry-run --fixtures fixtures --out /tmp/kitap && python3 -c "
  import json,re; o=json.loads(open('/tmp/kitap/research_outputs.jsonl').readline()); c=[json.loads(l) for l in open('/tmp/kitap/citations.jsonl')]
  assert all(x['crossref_status'] in ('verified','no_doi') for x in c); ords={x['ordinal'] for x in c}
  assert all(int(n) in ords for n in re.findall(r'\[(\d+)\]', o['synthesis_md']))"
  ```

### M15 — entegrasyon (en son, tek ajan)
- Dizin: kök dosyalar, `.github/`, `scripts/`, `docs/adr/`, `docs/runbook.md`, `README.md`
- Bağımlılık: hepsi
- Çıktılar: kök `package.json` (workspaces: `apps/*`, `packages/contracts`, `packages/db`, `packages/pii/ts`, `packages/llm-router`), `tsconfig.base.json`, 8.1 workflow'ları, `scripts/check-all.sh` (tüm modül kabul komutları), `scripts/check-rpc-parity.sh` (`apps/bot-worker/src/db/rpc.ts` fonksiyon adları ⊆ `packages/db/supabase/migrations/0011_functions.sql`), `scripts/dev-all.sh`, mock/seed eşitleme (`packages/db` build:seed → panel mocks + worker fixtures kopyası), `legal/saklama-sureleri.md` üretimi, ADR-0001…0007, README (Türkçe).
- Kabul:
  ```
  cd /home/user/alperen && bun install --frozen-lockfile && bun run -r typecheck && bun run -r test
  cd /home/user/alperen && bash scripts/check-all.sh
  cd /home/user/alperen && bash scripts/check-rpc-parity.sh
  cd /home/user/alperen && pip install yamllint && yamllint -d relaxed .github/workflows
  cd /home/user/alperen && npx --yes @action-validator/cli .github/workflows/ci.yml   # ya da: python3 -c "import yaml,glob;[yaml.safe_load(open(f)) for f in glob.glob('.github/workflows/*.yml')]"
  ```

---

## 12. Açık sorular ve varsayımlar

Her soru bir **varsayılan** ile kapatılmıştır; implementer durmaz, varsayılanı uygular ve `docs/adr/` altında kayda geçer.

1. **Supabase özel rol JWT'si mi, service_role mü?** Varsayılan: özel roller `bot_worker`/`batch_worker`, JWT `mint-jwt.ts` ile proje JWT secret'ından; `service_role` yalnız migrasyon. Supabase ileride asimetrik anahtara geçerse `mint-jwt.ts` ES256'ya güncellenir (tek dosya).
2. **PostgREST'e açık şema**: Varsayılan `public` tek başına; `secure` ve `audit` hiç açılmaz. Panelin audit okuması `public.audit_recent(cohort)` RPC'si ile.
3. **BKT mi Elo mu?** Varsayılan BKT (yorumlanabilir olasılık, `MasteryMeter.p` ile birebir). Parametreler kazanım başına; kalibrasyon pilot sonrası (`kalem prerequisite-audit` raporu).
4. **Kanıt eşiği**: `min_evidence=5` (`settings`); teşhis testinin tek başına yüzde göstermemesi bilinçli.
5. **Mesaj saklama**: 90 gün (`retention_policies`); ham video 30 gün; prompt metni 30 gün. Değişirse yalnız tablo satırı değişir, metinler üretilir.
6. **Reşitlik bilgisi nasıl alınır?** Varsayılan: öğrenci beyanı (`/start` düğmesi) + reşit değilse veli onayı zorunlu; şüphede koordinatör `persons.is_minor` düzeltir. Kimlik doğrulama yok (hukuki inceleme maddesi).
7. **Veli onayı kanalı**: Telegram `/onay <kod>` (veli ayrı hesap) varsayılan; kâğıt form `method='paper'` ile koordinatör girer.
8. **Grupta bot ne zaman cevap verir?** Varsayılan: etiketlendiğinde ya da kendisine yanıt verildiğinde; `settings.group.answer_unaddressed_questions=false`. Her mesaj yine kaydedilir (bildirim sabitli).
9. **Gömme modeli**: `gemini-embedding-001` 768 boyut varsayılan; `bge-m3` yedek (1024 → ilk 768'e kesilmez, ayrı sütun gerekmesin diye `settings.embedding.model` tek seçimlik; model değişirse `memory_facts.embedding` yeniden hesaplanır — `kulaklik_batch reembed`).
10. **Yapılandırılmış çıktı desteklemeyen sağlayıcı**: şema prompt'a gömülür + Ajv doğrulaması; iki başarısızlıkta sonraki sağlayıcı.
11. **Panel barındırma**: Cloudflare Pages statik export; SSR yok, dolayısıyla panelde gizli anahtar yok. İleride SSR gerekirse ayrı ADR.
12. **Transkript konuşmacı ayrımı doğruluğu**: iki konuşmacı varsayımı; yanlış etiket eğitmen onayında düzeltilir (`lesson_claims.speaker` düzenlenebilir). Diarization modeli eklenmez (maliyet).
13. **Ders analizi güçlü modeli**: Gemini 2.5 Pro varsayılan; Claude Sonnet adaptörü var ama anahtar yoksa pasif.
14. **Batch API**: Gemini Batch (gece) varsayılan; Groq/OpenRouter batch yok → gece işleri ücretsiz zincire düşmez, yalnız Gemini ücretli/ücretsiz; cap aşımında gece işi ertelenir (`spend_status.daily_cap` → `tablet generate` "SKIP").
15. **Kota sıfırlama saati**: 00:00 Europe/Istanbul (`usage_counters.day` TRT).
16. **Kullanıcı adı olmayan Telegram hesabı**: grupta "sen" ile hitap, etiket yok; `escalations` eğitmen etiketi için `getChatAdministrators` yoksa "hocan" genel ifadesi.
17. **Öğrenci adının panelde gösterimi**: "Elif K." (`person_labels` RPC); tam ad yalnız `secure` ve koordinatör `/onaylar` sayfasında (RPC `person_full_name`, audit'li) — hukuki inceleme.
18. **KVKK silme talebinde öğrenme verisi**: rastgele kimlikle anonim kalır (ADR-0004); hukukçu aksi derse `erase_person` cascade'e çevrilir (tek fonksiyon).
19. **ÖSYM/eğitmen soru metinleri**: `exam_items.ocr_text` yalnız eğitmen arşivi; hiçbir öğrenci şemasında/RLS politikasında yok. Üniversite hocası adı hiç saklanmaz (`Hoca-A`).
20. **Tectonic/Graphviz/RDKit kurulu değilse**: ilgili motor `SKIP` ve `figures.render_status='render_failed'` + `vision_status='skipped'`; test ortamı yalnız matplotlib+svg+graphviz(varsa) ile geçer.
21. **pgTAP yerelde yok**: `run-pgtap.sh` SKIP; CI'da zorunlu. RLS ihlali CI'da yakalanır, yerelde `tests/logic` ile mantık korunur.
22. **Supabase ücretsiz plan 500 MB**: `messages` 90 gün ve `bot_responses.prompt_text` 30 gün ile 300 öğrencide ~150 MB tahmini; `spend-report` tablo boyutlarını da yazar (`pg_total_relation_size`), 400 MB'de uyarı.
23. **Proaktif mesaj sıklığı**: günde en çok 1, `active_hours` içinde, `proactive_opt_in` varsayılan `true` (onboarding'de söylenir, `/yardim`dan kapatılır).
24. **Discord**: kapsam dışı; `chat_bindings.kind` ve `messages.telegram_*` sütun adları Telegram'a özel kalır; Discord gelirse yeni tablo.
25. **Ses (Whisper/TTS)**: Telegram'da sesli mesaj gelirse şimdilik "Yazarak sorabilir misin?" (`intent='command'`), ses sonraki faz.
