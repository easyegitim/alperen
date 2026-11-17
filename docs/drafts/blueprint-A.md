# Öğrenmen — Uygulama Planı A ("önce pilot")

Tarih: 19 Ekim 2026 · Kaynak: `docs/plan.md` (tek doğruluk kaynağı) ve `packages/design-system/` (marka kitabı, `telegram.md`, `egitmen-paneli.md`, `guven-ve-seffaflik.md`).

Bu plan, 8 haftalık yol haritasının 1–3. haftalarında **5 öğrencilik bir Telegram pilotunu** ayağa kaldıracak en kısa güvenilir yolu önceliklendirir: Telegram botu, LLM yönlendiricisi, kotalar, teşhis testi ve ders videosu betiği. Geri kalan her şey (Tablet, Kalem, Kitap, panel, toplu hafıza işleri) **küçük ama gerçek** kurulur: derlenir, test edilir, sahte (fake) adaptörlerle hesapsız çalışır; hiçbir yerde `TODO` ile bırakılmış boş fonksiyon yoktur.

Ortam gerçekleri (tasarım bunlara göre): Node 22 + bun, Python 3.13 + pip, PyPI ve npm erişilebilir, `cdn.jsdelivr.net` kapalı (tüm bağımlılıklar npm/pip ile kurulur, tarayıcıya CDN'den hiçbir şey yüklenmez), ffmpeg var, `psql` istemcisi var ama Postgres sunucusu garanti değil, docker daemon büyük ihtimalle yok, hiçbir sağlayıcı hesabı/anahtarı yok. Her dış servis bir arayüzün (interface) arkasındadır ve her arayüzün yerel bir sahtesi vardır. Aynı anda en fazla 2 ajan çalışır; her modül tek başına kurulup test edilir.

Sözlük: "öğrenci" = Telegram'daki kullanıcı, "eğitmen" = panel kullanıcısı (branş eğitmeni), "koordinatör" = tüm öğrencileri gören panel kullanıcısı, "bot_runtime" = Worker'ın veritabanına eriştiği kısıtlı Postgres rolü, "service_role" = yalnızca güvenilir makinedeki toplu işlerin ve tohumlama (seed) betiklerinin kullandığı Supabase rolü.

## 1. Depo ağacı

```
alperen/                                   (monorepo kökü — M13 entegrasyon modülü)
├── package.json                           npm workspaces: apps/*, packages/*
├── .nvmrc                                 22
├── .gitignore, .editorconfig
├── README.md                              kurulum ve "5 dakikada yerel çalıştırma"
├── .github/
│   └── workflows/                         ci.yml, nightly.yml, weekly.yml, keepalive.yml,
│                                          render.yml, ders.yml, deploy-worker.yml, deploy-panel.yml
├── docs/
│   ├── plan.md                            kurucunun teknik planı (değişmez)
│   ├── drafts/blueprint-A.md              bu belge
│   ├── adr/                               kısa karar kayıtları (ADR-0001-bkt.md, ...)
│   └── hukuk/                             aydınlatma metni, veli onay formu, grup kayıt bildirimi,
│                                          saklama politikası — "HUKUKİ İNCELEME GEREKLİ" damgalı (M12)
├── packages/
│   ├── design-system/                     mevcut tasarım sistemi (değiştirilmez; panel tüketir)
│   ├── contracts/                         JSON Schema sözleşmeleri + model/maliyet tablosu (M01)
│   │   ├── schemas/*.schema.json
│   │   ├── models.json                    sağlayıcı/model/fiyat tablosu (TS ve Python okur)
│   │   ├── src/index.ts                   ajv ile doğrulayıcılar, üretilen tipler
│   │   ├── dist/                          json-schema-to-typescript çıktısı (commit edilmez)
│   │   ├── python/ogrenmen_contracts/     aynı şemaları yükleyen ince Python paketi
│   │   └── examples/*.json                her şema için en az bir geçerli örnek (testlerde kullanılır)
│   └── ds-react/                          design-system bundle'ını React 18 ile saran ince paket (M10'un parçası)
├── supabase/                              veritabanı (M02)
│   ├── config.toml                        supabase CLI için (yerel kullanım isteğe bağlı)
│   ├── migrations/0001_extensions.sql ... 0012_views.sql
│   ├── seed/00_roles.sql, 01_quota_limits.sql
│   ├── tests/*.sql                        RLS + grant testleri (psql ile, DB varsa)
│   └── scripts/db-test.sh, lint.sh        sqlfluff + (varsa) canlı DB testi
├── apps/
│   ├── worker/                            Cloudflare Worker — Telegram botu + LLM yönlendirici (M03)
│   └── panel/                             Next.js eğitmen paneli (M10)
├── content/
│   └── tyt-matematik/                     kazanım ağacı, yanılgı etiketleri, teşhis testi, şablonlar (M04)
│       ├── curriculum.json, skills.json, prerequisites.json, misconception-tags.json
│       ├── diagnostic/questions.json, diagnostic/answer-keys.json
│       ├── templates/*.py                 parametrik soru şablonları (sıfır LLM)
│       └── scripts/seed.py, validate.py
├── pipelines/                             Python toplu işler (her biri ayrı paket, ayrı sahip)
│   ├── common/                            ogrenmen_common: adaptörler + sahteler + DB/Storage istemcisi (M05)
│   ├── ders/                              ders videosu analizi (M06)
│   ├── kulaklik_batch/                    gece olgu çıkarımı, haftalık özet, panel metrikleri (M07)
│   ├── tablet/                            soru/şekil üretimi, render, doğrulama, PDF (M08)
│   ├── kalem/                             sınav arşivi → OCR → kümeleme → öncelik planı (M09)
│   └── kitap/                             akademik araştırma ajanı (M11)
└── scripts/
    ├── dev-all.sh                         worker (wrangler dev) + panel (mock) + sahte Telegram
    └── check-all.sh                       tüm modüllerin kabul komutlarını sırayla çalıştırır (M13)
```

Sahiplik kuralı: her modül yalnızca kendi dizinine yazar. Kök dosyaları (`package.json`, `README.md`, `.github/`, `scripts/`) yalnızca M13'e aittir ve en son yazılır. `packages/design-system/` hiçbir modül tarafından değiştirilmez.

## 2. Paketler ve sahiplik

Genel kurallar: TypeScript paketleri `npm` workspaces ile (bun yalnızca hız için isteğe bağlı; CI `npm ci`), strict mode, ESM, `vitest`. Python paketleri `pyproject.toml` + `pip install -e`, `pytest`, `ruff`. Hiçbir test ağ erişimi gerektirmez; ağ gerektiren adaptör testleri `@pytest.mark.live` / `describe.skipIf(!process.env.LIVE)` ile atlanır. Her paketin `README.md`'si Türkçe, "Yerel çalıştırma" ve "Testler" başlıklarını içerir.

### 2.1 `packages/contracts` (M01) — sözleşmeler

- Amaç: TS ve Python'un paylaştığı JSON Schema (draft 2020-12) dosyaları, model/maliyet tablosu ve örnekler.
- Çalışma zamanı: Node 22 (ajv 8), Python 3.13 (`jsonschema` 4.x, zaten kurulu).
- Giriş noktaları: `src/index.ts` → `validate<Name>(data)` fonksiyonları ve `Models` tablosu; `python/ogrenmen_contracts/__init__.py` → `validate(name, data)`, `load_models()`.
- Teslimat: 10 şema (bkz. §4), `models.json`, `examples/`, üretilen `.d.ts` tipleri.
- Derleme/test:
  ```
  npm -w packages/contracts run build     # json-schema-to-typescript → dist/
  npm -w packages/contracts test          # vitest: her examples/*.json kendi şemasına göre geçerli, örnek yoksa test düşer
  pip install -e packages/contracts/python && pytest packages/contracts/python
  ```

### 2.2 `supabase/` (M02) — veri modeli

- Amaç: migrasyonlar, roller, RLS, RPC fonksiyonları, saklama işleri, test SQL'leri.
- Çalışma zamanı: Postgres 15+ (Supabase), pgvector, pg_cron (Supabase'de var; yoksa GitHub Actions eşleniği).
- Giriş noktaları: `migrations/NNNN_*.sql` (sıralı), `scripts/db-test.sh`.
- Yerel test, hesapsız:
  ```
  pip install sqlfluff && supabase/scripts/lint.sh          # sqlfluff --dialect postgres; sözdizimi + stil
  supabase/scripts/db-test.sh                                # DATABASE_URL yoksa "SKIPPED (no database)" ile 0 döner;
                                                             # varsa: migrasyonları uygular, tests/*.sql çalıştırır (ON_ERROR_STOP)
  ```
  Postgres varsa (`apt install postgresql-16 postgresql-16-pgvector` ya da docker) `DATABASE_URL=postgres://...` verilir; `pg_cron` yoksa ilgili migrasyon `DO $$ ... IF EXISTS extension` ile atlanır.

### 2.3 `apps/worker` (M03) — Telegram botu ve LLM yönlendirici

- Çalışma zamanı: Cloudflare Workers, TypeScript, `wrangler` 3.x. Dış bağımlılık yok: Telegram ve PostgREST `fetch` ile, JWT `WebCrypto` ile. Çerçeve yok (grammY vb. kullanılmaz; sahte adaptör yazmak daha kolay).
- Giriş noktaları: `src/index.ts` (`fetch` → webhook, `scheduled` → cron), `src/app.ts` (`createApp(env, deps)` saf fonksiyon: deps = `{telegram, db, llm, embed, clock, random}`).
- Teslimat: webhook, komutlar, onay kapısı, teşhis testi akışı, Sokratik sohbet, kota, yönlendirici, hafıza çekme, grup/rol/yükseltme, cevap günlüğü, cron işleri.
- Yerel test, hesapsız:
  ```
  npm -w apps/worker run typecheck
  npm -w apps/worker test                 # vitest (Node): FakeTelegram + FakeDb + FakeProvider ile uçtan uca senaryolar
  npm -w apps/worker run build            # wrangler deploy --dry-run --outdir dist  (hesap gerekmez)
  npm -w apps/worker run dev              # wrangler dev --local, FAKE_PROVIDERS=1 → scripts/send-update.sh ile sahte Telegram güncellemesi
  ```

### 2.4 `content/tyt-matematik` (M04) — ilk içerik

- Amaç: TYT Matematik kazanım dilimi, ön koşullar, yanılgı etiketleri, 18 soruluk teşhis testi, 3 parametrik şablon.
- Çalışma zamanı: veri JSON + Python 3.13 (şablonlar ve tohumlama).
- Test: `python content/tyt-matematik/scripts/validate.py` (şemalara göre doğrular, her yanlış şıkta etiket var mı, her etiket tanımlı mı, ön koşul grafı döngüsüz mü, cevap anahtarı dosyasındaki her soru `questions.json`'da var mı); `python content/tyt-matematik/scripts/seed.py --dry-run --out content/dist/seed.sql` (SQL üretir, DB'ye bağlanmaz).

### 2.5 `pipelines/common` (M05) — paylaşılan Python kütüphanesi

- Paket adı `ogrenmen_common`. İçerik: adaptör arayüzleri (`LLM`, `Embedder`, `Transcriber`, `Vision`, `Storage`, `Db`, `Scholar`), gerçek uygulamalar (Gemini, Groq, OpenRouter, Cloudflare AI, Supabase REST/Storage, OpenAlex, Semantic Scholar, Crossref, Unpaywall) ve **her biri için sahte** (`fakes.py`), `scrub.py` (ad/okul temizleme), `costs.py` (`models.json` okur, harcama hesaplar), `cli.py` (ortak `--dry-run`, `--out`, `--fake` bayrakları).
- Seçim ortam değişkeniyle: `OGRENMEN_FAKE=1` → tüm adaptörler sahte; anahtar yoksa zaten sahteye düşer ve uyarı yazar.
- Test: `pip install -e pipelines/common[dev] && pytest pipelines/common`.

### 2.6 `pipelines/ders` (M06) — ders videosu

- CLI `ogrenmen-ders`. Test fixture'ı ffmpeg ile üretilen 12 saniyelik sentetik video (`tests/fixtures/make_fixture.sh`, `testsrc` + `sine`) ve sahte transkript/analiz. `pytest pipelines/ders`.

### 2.7 `pipelines/kulaklik_batch` (M07), `pipelines/tablet` (M08), `pipelines/kalem` (M09), `pipelines/kitap` (M11)

- Her biri kendi `pyproject.toml`, `cli.py`, `tests/fixtures/`. Hepsi `ogrenmen_common` ve `ogrenmen_contracts`'a bağımlı. Ayrıntılar §6.

### 2.8 `apps/panel` (M10) — eğitmen paneli

- Next.js 14.2 (App Router) + React 18.3 (tasarım sistemi `bundle.js` React 18 bekler; bu yüzden Next 15/React 19 **değil**). `@supabase/ssr` ile oturum; `DATA_SOURCE=mock` iken bellek içi sağlayıcı ve sahte oturum.
- Test: `npm -w apps/panel run typecheck && npm -w apps/panel test && DATA_SOURCE=mock npm -w apps/panel run build`.

### 2.9 `docs/hukuk` (M12) ve kök/CI (M13)

- M12 yalnızca Markdown yazar. M13 kök `package.json`, `README.md`, `.github/workflows`, `scripts/` yazar ve `scripts/check-all.sh` ile tüm kabul komutlarını çalıştırır.

## 3. Veri modeli

Tek Supabase projesi, `public` şeması + yardımcı `app` şeması. Migrasyon dosyaları (`supabase/migrations/`):

```
0001_extensions.sql      pgcrypto, vector, pg_cron (varsa)
0002_roles.sql           bot_runtime rolü, app şeması, yardımcı fonksiyonlar
0003_identity.sql        profiles, students, student_private, consents
0004_curriculum.sql      curriculum_versions, skills, skill_prerequisites, misconception_tags, enrollments
0005_gozluk.sql          mastery, observations, misconceptions, preferences + apply_observation()
0006_questions.sql       questions, answer_keys, figures, question_templates, question_attempts, diagnostic_sessions + grade_answer()
0007_chat.sql            telegram_chats, chat_members, messages, bot_sessions, escalations, bot_responses, proactive_messages
0008_memory.sql          memory_facts, weekly_summaries + match_memory_facts()
0009_quota_spend.sql     quota_limits, quota_usage, spend_ledger, spend_caps, system_flags + consume_quota(), record_spend()
0010_lessons.sql         lesson_recordings, lesson_reports + apply_lesson_report()
0011_kalem_kitap.sql     exam_sources, exam_items, exam_clusters, priority_plans, research_requests, research_outputs, citations
0012_alerts_views.sql    instructor_alerts, retention_runs, review_queue_v, panel_overview_v
0013_rls.sql             tüm RLS politikaları ve GRANT'lar (tek dosyada; test dosyası birebir buna karşı yazılır)
0014_retention.sql       purge_expired() ve pg_cron zamanlamaları
```

Yazım kuralları: `snake_case`, `uuid` birincil anahtar (`gen_random_uuid()`), zaman `timestamptz` ve `now()`, her tablo `created_at`. Her tablo ve sütun `comment on` ile Türkçe açıklanır. Enum yerine `text` + `check` (migrasyonu kolay).

### 3.1 Roller ve yardımcılar (`0002_roles.sql`)

```sql
create schema if not exists app;

-- Worker'ın kullandığı kısıtlı rol. JWT'de role=bot_runtime ile PostgREST bu role geçer.
create role bot_runtime nologin;
grant bot_runtime to authenticator;
grant usage on schema public to bot_runtime;

-- JWT'den rol/kimlik okuma (PostgREST request.jwt.claims)
create or replace function app.jwt_role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', 'anon') $$;
create or replace function app.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
-- Panel kullanıcısının uygulama rolü: instructor | coordinator | observer
create or replace function app.panel_role() returns text language sql stable security definer as $$
  select role from public.profiles where id = app.uid() $$;
create or replace function app.is_coordinator() returns boolean language sql stable as $$
  select app.panel_role() = 'coordinator' $$;
-- Eğitmenin görebildiği öğrenciler: aynı Telegram sohbetinde üye olduğu öğrenciler
create or replace function app.instructor_student_ids() returns setof uuid language sql stable security definer as $$
  select distinct s.student_id from public.chat_members s
  join public.chat_members i on i.chat_id = s.chat_id
  where i.profile_id = app.uid() and i.role in ('instructor','coordinator') and s.role = 'student' and s.student_id is not null $$;
create or replace function app.can_see_student(sid uuid) returns boolean language sql stable as $$
  select app.is_coordinator() or app.panel_role() = 'observer' or sid in (select app.instructor_student_ids())
         or exists (select 1 from public.students st where st.id = sid and st.auth_user_id = app.uid()) $$;
```

### 3.2 Kimlik ve onay (`0003_identity.sql`)

```sql
create table public.profiles (                 -- panel kullanıcıları (Supabase Auth)
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('instructor','coordinator','observer')),
  full_name text not null,
  subject text,                                 -- branş eğitmeni için ders: 'matematik'
  created_at timestamptz not null default now()
);

create table public.students (                 -- kalıcı öğrenci kimliği; API'ye yalnızca id gider
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default encode(gen_random_bytes(6),'hex'),  -- loglarda/transkriptlerde kullanılan rastgele kod
  telegram_user_id bigint unique,
  auth_user_id uuid unique references auth.users(id),                            -- ileride PWA için
  is_minor boolean not null default true,       -- veli onayı gerekir; eğitmen panelden değiştirir
  status text not null default 'pending_consent' check (status in ('pending_consent','active','paused','deleted')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.students (telegram_user_id);

create table public.student_private (          -- isim/okul: yalnızca panel; bot_runtime'a GRANT YOK
  student_id uuid primary key references public.students(id) on delete cascade,
  full_name text not null,
  birth_year int,
  school text,
  guardian_name text,
  guardian_contact text,
  notes text,
  updated_at timestamptz not null default now()
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  kind text not null check (kind in ('kvkk_aydinlatma','veli_onayi','grup_kayit')),
  doc_version text not null,                    -- docs/hukuk/*.md başlığındaki sürüm, ör. 'v1-2026-10'
  status text not null check (status in ('granted','revoked','pending')),
  granted_via text not null,                    -- 'telegram_button' | 'panel' | 'form'
  evidence jsonb not null default '{}',         -- {chat_id, message_id, telegram_user_id} — kim, ne zaman, hangi düğme
  granted_at timestamptz, revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.consents (student_id, kind, status);
```

### 3.3 Müfredat ve kayıt (`0004_curriculum.sql`)

```sql
create table public.curriculum_versions (
  id text primary key,                          -- 'tyt-mat-2026'
  program text not null,                        -- 'TYT' | 'AYT' | 'LGS' | 'UNI'
  subject text not null,                        -- 'matematik'
  year int not null,                            -- ÖSYM kılavuzu / MEB programı yılı
  source text not null,                         -- 'MEB 2024 Matematik Öğretim Programı; ÖSYM 2026 TYT kılavuzu'
  created_at timestamptz not null default now()
);

create table public.skills (
  id text primary key,                          -- 'tyt.mat.rasyonel-sayilar'
  curriculum_version_id text not null references public.curriculum_versions(id),
  name text not null,
  description text,
  parent_id text references public.skills(id),
  order_index int not null default 0,
  bkt_params jsonb not null default '{"p_init":0.30,"p_learn":0.08,"p_slip":0.10,"p_guess":0.20}',
  created_at timestamptz not null default now()
);
create index on public.skills (curriculum_version_id, order_index);

create table public.skill_prerequisites (
  skill_id text not null references public.skills(id) on delete cascade,
  prerequisite_id text not null references public.skills(id) on delete cascade,
  primary key (skill_id, prerequisite_id),
  check (skill_id <> prerequisite_id)
);

create table public.misconception_tags (       -- yanlış şıkların kodladığı yanılgılar
  tag text primary key,                         -- 'rasyonel.pay-payda-ayri-toplama'
  skill_id text not null references public.skills(id),
  implies_prerequisite_id text references public.skills(id),  -- "asıl sorun bir alt konuda" çıkarımı
  text_instructor text not null,                -- üçüncü tekil: "Payları ve paydaları ayrı ayrı topluyor."
  text_student text not null,                   -- sen dili: "Payları ve paydaları ayrı ayrı topluyorsun."
  created_at timestamptz not null default now()
);

create table public.enrollments (              -- dönem bazlı akademik kayıt
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  curriculum_version_id text not null references public.curriculum_versions(id),
  period text not null,                         -- 'YKS-2027'
  status text not null default 'active' check (status in ('active','ended')),
  started_at timestamptz not null default now(), ended_at timestamptz,
  unique (student_id, curriculum_version_id, period)
);
create index on public.enrollments (student_id) where status = 'active';
```

### 3.4 Gözlük (`0005_gozluk.sql`)

```sql
create table public.mastery (
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  skill_id text not null references public.skills(id),
  p numeric(6,5) not null check (p >= 0 and p <= 1),
  evidence_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (enrollment_id, skill_id)
);

create table public.observations (             -- ham kanıt; yalnızca fonksiyonlar yazar
  id bigint generated always as identity primary key,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  skill_id text not null references public.skills(id),
  kind text not null check (kind in ('diagnostic','practice','test','lesson','chat','instructor','inferred')),
  value numeric(4,3) not null check (value >= 0 and value <= 1),  -- 0/1 doğru-yanlış ya da 0–1 ustalık tahmini
  weight numeric(3,2) not null default 1.0,     -- inferred=0.5, lesson=0.6 (bkz. apply_observation)
  source_type text not null,                    -- 'question_attempt' | 'lesson_report' | 'message' | 'instructor'
  source_id text not null,                      -- ilgili satırın id'si / 'lesson:<id>#00:14:32'
  misconception_tag text references public.misconception_tags(tag),
  evidence_quote text,                          -- alıntı (isimsiz)
  created_at timestamptz not null default now()
);
create index on public.observations (enrollment_id, skill_id, created_at desc);

create table public.misconceptions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  skill_id text not null references public.skills(id),
  tag text references public.misconception_tags(tag),
  text text not null,                           -- eğitmen sürümü (üçüncü tekil)
  evidence jsonb not null default '[]',         -- [{kind:'quiz'|'lesson'|'chat', source:'Deneme 1 · Soru 8', quote:'...', observation_id:123}]
  evidence_count int not null default 0,
  status text not null default 'pending_review' check (status in ('pending_review','open','resolved','rejected')),
  first_seen timestamptz not null default now(),
  resolved_at timestamptz, resolved_by uuid references public.profiles(id),
  unique (enrollment_id, skill_id, tag)
);

create table public.preferences (
  student_id uuid primary key references public.students(id) on delete cascade,
  timezone text not null default 'Europe/Istanbul',
  active_hour_start int not null default 17 check (active_hour_start between 0 and 23),
  active_hour_end int not null default 22,
  modality text check (modality in ('visual','verbal')),
  explanation_style text,                       -- serbest metin, gece işi günceller: 'önce örnek sonra kural'
  response_mode text not null default 'socratic' check (response_mode in ('socratic','direct')),
  proactive_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
```

**Ustalık güncellemesi — BKT (karar: ADR-0001).** Konu başına Elo yerine BKT seçildi çünkü soru zorluğu kalibrasyonu gerektirmez ve 15–20 soruluk teşhisle anlamlı başlar. Parametreler `skills.bkt_params`'tan gelir. İkili gözlem (doğru/yanlış, `value ∈ {0,1}`):

```
p_prior = mastery.p (yoksa p_init)
doğruysa : p_post = p_prior·(1−p_slip) / ( p_prior·(1−p_slip) + (1−p_prior)·p_guess )
yanlışsa : p_post = p_prior·p_slip     / ( p_prior·p_slip     + (1−p_prior)·(1−p_guess) )
p_new    = p_post + (1−p_post)·p_learn
```

Sürekli gözlem (ders raporundaki 0–1 ustalık tahmini, `kind='lesson'`): `p_new = p_prior + w·(value − p_prior)`, `w = weight·0.5` (varsayılan weight 0.6 → etkin 0.3). Çıkarım gözlemi (`kind='inferred'`, yanılgı etiketi `implies_prerequisite_id` taşıyorsa): ön koşul kazanımına `value=0, weight=0.5` ile ikili güncelleme uygulanır ama `p_guess` yerine `p_guess + (1−p_guess)·(1−weight)` kullanılır (yani daha yumuşak). `evidence_count` her gözlemde +1 (inferred +0 — teşhis eşiğini çıkarımlar doldurmaz). Aynı matematik `apps/worker/src/mastery.ts`'de de yazılır; iki uygulama `packages/contracts/examples/bkt-cases.json` içindeki 12 vakayla birebir karşılaştırılır.

```sql
create or replace function public.apply_observation(
  p_enrollment uuid, p_skill text, p_kind text, p_value numeric, p_weight numeric,
  p_source_type text, p_source_id text, p_tag text default null, p_quote text default null
) returns table (observation_id bigint, p_before numeric, p_after numeric)
language plpgsql security definer set search_path = public as $$
declare prm jsonb; p0 numeric; p1 numeric; ps numeric; pg numeric; pl numeric; pt numeric; obs_id bigint; inc int;
begin
  select bkt_params into prm from skills where id = p_skill;
  if prm is null then raise exception 'unknown skill %', p_skill; end if;
  ps := (prm->>'p_slip')::numeric; pg := (prm->>'p_guess')::numeric; pl := (prm->>'p_learn')::numeric;
  select p into p0 from mastery where enrollment_id = p_enrollment and skill_id = p_skill;
  if p0 is null then p0 := (prm->>'p_init')::numeric; end if;

  if p_kind = 'lesson' then
    p1 := p0 + (p_weight * 0.5) * (p_value - p0); inc := 1;
  else
    if p_kind = 'inferred' then pg := pg + (1 - pg) * (1 - p_weight); inc := 0; else inc := 1; end if;
    if p_value >= 0.5 then pt := p0*(1-ps) / (p0*(1-ps) + (1-p0)*pg);
    else                   pt := p0*ps     / (p0*ps     + (1-p0)*(1-pg)); end if;
    p1 := pt + (1-pt)*pl;
  end if;
  p1 := least(0.999, greatest(0.001, p1));

  insert into observations(enrollment_id, skill_id, kind, value, weight, source_type, source_id, misconception_tag, evidence_quote)
  values (p_enrollment, p_skill, p_kind, p_value, p_weight, p_source_type, p_source_id, p_tag, p_quote) returning id into obs_id;
  insert into mastery(enrollment_id, skill_id, p, evidence_count) values (p_enrollment, p_skill, p1, inc)
  on conflict (enrollment_id, skill_id) do update set p = excluded.p, evidence_count = mastery.evidence_count + inc, updated_at = now();

  -- yanılgı etiketi: misconceptions satırını aç/güncelle; ön koşul çıkarımı (tek seviye, döngüsüz)
  if p_tag is not null then
    insert into misconceptions(enrollment_id, skill_id, tag, text, evidence, evidence_count)
    select p_enrollment, p_skill, p_tag, t.text_instructor,
           jsonb_build_array(jsonb_build_object('kind', p_source_type, 'source', p_source_id, 'quote', coalesce(p_quote,''), 'observation_id', obs_id)), 1
    from misconception_tags t where t.tag = p_tag
    on conflict (enrollment_id, skill_id, tag) do update
      set evidence = misconceptions.evidence || excluded.evidence, evidence_count = misconceptions.evidence_count + 1,
          status = case when misconceptions.status = 'resolved' then 'pending_review' else misconceptions.status end;
    if p_kind <> 'inferred' then
      perform public.apply_observation(p_enrollment, t.implies_prerequisite_id, 'inferred', 0, 0.5, p_source_type, p_source_id, null, null)
      from misconception_tags t where t.tag = p_tag and t.implies_prerequisite_id is not null;
    end if;
  end if;
  return query select obs_id, p0, p1;
end $$;
revoke all on function public.apply_observation from public;
grant execute on function public.apply_observation to bot_runtime, service_role;
```

Yanılgı `evidence_count < 3` iken `pending_review` kalır (gece işi `status='open'` yapar), eğitmen panelde onaylar/çözer; "Çözüldü" yalnızca yeni kanıt + eğitmen onayı (`resolved_by` zorunlu, trigger ile denetlenir).

### 3.5 Soru bankası ve cevap anahtarı izolasyonu (`0006_questions.sql`)

```sql
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  curriculum_version_id text not null references public.curriculum_versions(id),
  skill_ids text[] not null check (array_length(skill_ids,1) >= 1),
  stem text not null,
  stem_values jsonb not null default '{}',      -- şekil denetiminde karşılaştırılan sayısal değerler {a:12,b:8,theta:30}
  options jsonb not null,                       -- [{letter:'A', text:'7/8', misconception_tag:null}, ...] — doğru şık burada BELLİ DEĞİL
  figure_id uuid,                               -- figures(id), FK aşağıda
  difficulty int not null default 2 check (difficulty between 1 and 5),
  origin text not null check (origin in ('authored','llm','template')),
  template_id text, template_params jsonb,
  verification jsonb not null default '{"render":null,"size":null,"vision":null,"sympy":null}',
  status text not null default 'draft' check (status in ('draft','pending_review','approved','rejected')),
  created_by text not null default 'seed',      -- 'seed' | 'tablet' | profile uuid
  reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, review_note text,
  created_at timestamptz not null default now()
);
create index on public.questions using gin (skill_ids);
create index on public.questions (status, curriculum_version_id);

create table public.answer_keys (              -- AYRI TABLO. bot_runtime'a hiçbir yetki yok.
  question_id uuid primary key references public.questions(id) on delete cascade,
  correct_letter char(1) not null check (correct_letter in ('A','B','C','D','E')),
  numeric_answer text,                          -- SymPy ile doğrulanan sayısal cevap ('7/8', '2*sqrt(3)')
  solution text not null,                       -- adım adım çözüm (doğrudan mod bunu sunucu fonksiyonundan alır)
  sympy_check jsonb,                            -- {ok:true, expr:'...', checked_at:...}
  updated_at timestamptz not null default now()
);

create table public.figures (
  id uuid primary key default gen_random_uuid(),
  question_id uuid references public.questions(id) on delete cascade,
  tool text not null check (tool in ('matplotlib','svg','tikz','vega-lite','schemdraw','rdkit','graphviz','latex')),
  code text not null,
  alt_text text not null,
  storage_path text,                            -- Supabase Storage 'figures/<id>.png'
  width int, height int,
  vision_check jsonb,                           -- {ok:bool, mismatches:[...], model:'gemini-2.5-flash'}
  attempts int not null default 0,
  status text not null default 'pending' check (status in ('pending','verified','failed')),
  created_at timestamptz not null default now()
);
alter table public.questions add constraint questions_figure_fk foreign key (figure_id) references public.figures(id);

create table public.question_templates (
  id text primary key,                          -- 'tyt.mat.ucgen-kenar-aci-v1'
  skill_id text not null references public.skills(id),
  module_path text not null,                    -- 'content/tyt-matematik/templates/ucgen.py:generate'
  params_schema jsonb not null,
  created_at timestamptz not null default now()
);

create table public.diagnostic_sessions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  chat_id bigint not null,
  question_ids uuid[] not null,
  current_index int not null default 0,
  status text not null default 'in_progress' check (status in ('in_progress','finished','abandoned')),
  summary jsonb,                                -- {per_skill:[{skill_id,p,evidence}], weakest:[...]}
  started_at timestamptz not null default now(), finished_at timestamptz
);

create table public.question_attempts (        -- yalnızca grade_answer() yazar
  id bigint generated always as identity primary key,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  context text not null check (context in ('diagnostic','practice','test')),
  session_id uuid,
  chosen_letter char(1) not null,
  is_correct boolean not null,
  misconception_tag text references public.misconception_tags(tag),
  answered_at timestamptz not null default now()
);
create index on public.question_attempts (enrollment_id, answered_at desc);

-- Puanlama: cevap anahtarını okur, gözlemi uygular, sonucu döner. LLM yolu yalnızca bunu çağırabilir.
create or replace function public.grade_answer(p_enrollment uuid, p_question uuid, p_letter char, p_context text, p_session uuid default null)
returns table (is_correct boolean, misconception_tag text, feedback_student text, p_after numeric)
language plpgsql security definer set search_path = public as $$
declare k record; q record; v_tag text; sk text; r record;
begin
  select * into q from questions where id = p_question and status = 'approved';
  if q is null then raise exception 'question not approved: %', p_question; end if;
  select * into k from answer_keys where question_id = p_question;
  v_tag := (select o->>'misconception_tag' from jsonb_array_elements(q.options) o where o->>'letter' = p_letter);
  is_correct := (k.correct_letter = p_letter);
  insert into question_attempts(enrollment_id, question_id, context, session_id, chosen_letter, is_correct, misconception_tag)
  values (p_enrollment, p_question, p_context, p_session, p_letter, is_correct, case when is_correct then null else v_tag end);
  foreach sk in array q.skill_ids loop
    select * into r from apply_observation(p_enrollment, sk, p_context, case when is_correct then 1 else 0 end, 1.0,
                                           'question_attempt', p_question::text, case when is_correct then null else v_tag end, null);
  end loop;
  misconception_tag := case when is_correct then null else v_tag end;
  feedback_student := case when is_correct then null else (select t.text_student from misconception_tags t where t.tag = v_tag) end;
  p_after := r.p_after;
  return next;
end $$;
revoke all on function public.grade_answer from public;
grant execute on function public.grade_answer to bot_runtime, authenticated, service_role;

-- Doğrudan modda çözüm metni: anahtar tablosunu okumadan çözüme erişim (yalnız onaylı soru, yalnız cevap verildikten sonra)
create or replace function public.get_solution(p_enrollment uuid, p_question uuid) returns text
language sql security definer set search_path = public as $$
  select k.solution from answer_keys k
  where k.question_id = p_question
    and exists (select 1 from question_attempts a where a.enrollment_id = p_enrollment and a.question_id = p_question) $$;
grant execute on function public.get_solution to bot_runtime, authenticated, service_role;
```

Yazma yolu: `answer_keys`'e yalnızca `service_role` (tohumlama, Tablet boru hattı) ve eğitmen için `set_answer_key(question_id, letter, solution)` SECURITY DEFINER fonksiyonu (`app.panel_role() in ('instructor','coordinator')` kontrolü) yazar. `bot_runtime` için tabloda SELECT/INSERT/UPDATE/DELETE yoktur; `grade_answer` ve `get_solution` fonksiyon gövdeleri tanımlayıcı (owner = postgres) haklarıyla okur. LLM çıktısı hiçbir zaman doğrudan tabloya yazılmaz: Tablet, LLM'den gelen `answer` alanını SymPy doğrulamasından geçirip service_role ile yazar; bu yol Worker'da yoktur.

### 3.6 Sohbet, oturum, yükseltme, günlük (`0007_chat.sql`)

```sql
create table public.telegram_chats (
  chat_id bigint primary key,
  kind text not null check (kind in ('private','group','supergroup')),
  title text,
  recording_notice_message_id bigint,           -- sabitlenen kayıt bildirimi
  retention_days int not null default 90,
  created_at timestamptz not null default now()
);

create table public.chat_members (
  chat_id bigint not null references public.telegram_chats(chat_id) on delete cascade,
  telegram_user_id bigint not null,
  role text not null check (role in ('student','instructor','coordinator','observer','bot')),
  student_id uuid references public.students(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  handle text,                                  -- '@aysehoca' — bot grupta adı değil kullanıcı adını kullanır
  subject text,                                 -- eğitmen için branş: '@hoca' yönlendirmesinde kullanılır
  joined_at timestamptz not null default now(),
  primary key (chat_id, telegram_user_id)
);
create index on public.chat_members (student_id);
create index on public.chat_members (profile_id);

create table public.messages (                 -- 1. katman: ham günlük (saklama süresi sonunda silinir)
  id bigint generated always as identity primary key,
  chat_id bigint not null references public.telegram_chats(chat_id) on delete cascade,
  telegram_message_id bigint not null,
  from_telegram_user_id bigint not null,
  from_role text not null,
  student_id uuid references public.students(id) on delete cascade,  -- gönderen öğrenciyse
  text_scrubbed text,                           -- isim/okul temizlenmiş metin; LLM yalnızca bunu görür
  attachment jsonb,                             -- {type:'photo'|'document'|'voice', file_id, mime}
  reply_to_telegram_message_id bigint,
  mentions_bot boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days',
  unique (chat_id, telegram_message_id)
);
create index on public.messages (chat_id, created_at desc);
create index on public.messages (student_id, created_at desc);
create index on public.messages (expires_at);

create table public.bot_sessions (             -- öğrenci × sohbet başına durum makinesi
  student_id uuid not null references public.students(id) on delete cascade,
  chat_id bigint not null,
  state text not null default 'new' check (state in ('new','awaiting_consent','awaiting_guardian','diagnostic','idle','awaiting_answer')),
  mode text not null default 'socratic' check (mode in ('socratic','direct')),
  direct_once boolean not null default false,   -- /cevap: yalnızca bu soru için
  pending_question_id uuid,
  diagnostic_session_id uuid references public.diagnostic_sessions(id),
  last_activity_at timestamptz not null default now(),
  quota_warning_sent_on date,
  primary key (student_id, chat_id)
);

create table public.escalations (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null, telegram_message_id bigint not null,
  student_id uuid references public.students(id) on delete cascade,
  reason text not null check (reason in ('uncertain','human_requested','grades_attendance','quota_exhausted','mention')),
  question_text text,                           -- temizlenmiş
  assigned_profile_id uuid references public.profiles(id),
  status text not null default 'open' check (status in ('open','answered','dismissed')),
  created_at timestamptz not null default now(), answered_at timestamptz, answered_by uuid references public.profiles(id)
);
create index on public.escalations (status, created_at);

create table public.bot_responses (            -- her bot cevabı: prompt, hafıza, model, maliyet
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null, student_id uuid references public.students(id) on delete cascade,
  in_message_id bigint references public.messages(id) on delete set null,
  out_telegram_message_id bigint,
  mode text not null, purpose text not null,    -- purpose: 'chat' | 'diagnostic_feedback' | 'proactive' | 'escalation_note'
  prompt jsonb not null,                        -- {system, messages:[{role,content}], schema?}
  memory_fact_ids bigint[] not null default '{}',
  recent_message_ids bigint[] not null default '{}',
  provider text not null, model text not null, attempts jsonb not null default '[]',  -- [{provider,model,status:429,ms}]
  input_tokens int not null default 0, output_tokens int not null default 0,
  cost_usd numeric(10,6) not null default 0, latency_ms int,
  response_text text not null,
  flagged boolean not null default false, flagged_by uuid references public.profiles(id), flag_note text, flagged_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);
create index on public.bot_responses (student_id, created_at desc);
create index on public.bot_responses (flagged) where flagged;

create table public.proactive_messages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  kind text not null check (kind in ('deadline','silent','review_suggestion','exam_tomorrow')),
  scheduled_for timestamptz not null,
  text text not null,
  sent_at timestamptz, out_telegram_message_id bigint,
  created_at timestamptz not null default now()
);
-- günde en fazla bir proaktif mesaj (ifade içeren tekillik yalnızca index ile kurulabilir)
create unique index proactive_one_per_day on public.proactive_messages (student_id, ((scheduled_for at time zone 'Europe/Istanbul')::date));
```

### 3.7 Hafıza (`0008_memory.sql`)

```sql
create table public.memory_facts (             -- 2. katman: gece çıkarılan olgular
  id bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  kind text not null check (kind in ('promise','deadline','unanswered_question','morale','topic_asked','preference','instructor_statement','other')),
  text text not null,                           -- isimsiz, kısa
  source_message_ids bigint[] not null,         -- messages.id (kaynak zorunlu)
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  occurs_at timestamptz,                        -- deadline/sınav tarihi
  approved_by uuid references public.profiles(id),  -- not/devamsızlık gibi 'instructor_statement' yalnızca onaylıysa kullanılır
  resolved_at timestamptz,
  embedding vector(768) not null,
  model text not null,
  extracted_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '180 days'
);
create index on public.memory_facts (student_id, extracted_at desc);
create index on public.memory_facts using hnsw (embedding vector_cosine_ops);

create table public.weekly_summaries (         -- 3. katman
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  week_start date not null,
  text text not null,
  fact_ids bigint[] not null default '{}',
  model text not null, cost_usd numeric(10,6) not null default 0,
  generated_at timestamptz not null default now(),
  unique (student_id, week_start)
);

create or replace function public.match_memory_facts(p_student uuid, p_query vector(768), p_k int default 6, p_min_sim numeric default 0.25)
returns table (id bigint, kind text, text text, occurs_at timestamptz, similarity numeric)
language sql stable security definer set search_path = public as $$
  select f.id, f.kind, f.text, f.occurs_at, (1 - (f.embedding <=> p_query))::numeric
  from memory_facts f
  where f.student_id = p_student and f.resolved_at is null and f.expires_at > now()
    and (f.kind <> 'instructor_statement' or f.approved_by is not null)
    and (1 - (f.embedding <=> p_query)) >= p_min_sim
  order by f.embedding <=> p_query limit p_k $$;
grant execute on function public.match_memory_facts to bot_runtime, authenticated, service_role;
```

### 3.8 Kota ve harcama (`0009_quota_spend.sql`)

```sql
create table public.quota_limits (kind text primary key, daily_limit int not null, warn_at_remaining int not null default 5);
insert into public.quota_limits values ('message',25,5), ('test',5,1), ('research',2,0), ('figure',3,0);

create table public.quota_usage (
  student_id uuid not null references public.students(id) on delete cascade,
  day date not null, kind text not null references public.quota_limits(kind),
  used int not null default 0,
  primary key (student_id, day, kind)
);

create or replace function public.consume_quota(p_student uuid, p_kind text, p_day date default (now() at time zone 'Europe/Istanbul')::date)
returns table (allowed boolean, used int, daily_limit int, remaining int)
language plpgsql security definer set search_path = public as $$
declare lim int; cur int;
begin
  select q.daily_limit into lim from quota_limits q where q.kind = p_kind;
  insert into quota_usage(student_id, day, kind, used) values (p_student, p_day, p_kind, 0) on conflict do nothing;
  select u.used into cur from quota_usage u where u.student_id = p_student and u.day = p_day and u.kind = p_kind for update;
  if cur >= lim then return query select false, cur, lim, 0; return; end if;
  update quota_usage set used = used + 1 where student_id = p_student and day = p_day and kind = p_kind;
  return query select true, cur + 1, lim, lim - cur - 1;
end $$;
grant execute on function public.consume_quota to bot_runtime, service_role;

create table public.spend_ledger (
  id bigint generated always as identity primary key,
  day date not null default (now() at time zone 'Europe/Istanbul')::date,
  provider text not null, model text not null, purpose text not null,   -- 'chat','embedding','nightly_facts','lesson','tablet','kitap'
  input_tokens int not null default 0, output_tokens int not null default 0, units int not null default 0,  -- units: neuron/saniye vb.
  cost_usd numeric(10,6) not null default 0,
  created_at timestamptz not null default now()
);
create index on public.spend_ledger (day, provider);

create table public.spend_caps (scope text primary key check (scope in ('daily','monthly')), alert_usd numeric(8,2) not null, cap_usd numeric(8,2) not null);
insert into public.spend_caps values ('daily', 1.50, 3.00), ('monthly', 20.00, 30.00);

create table public.system_flags (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
insert into public.system_flags values ('paid_providers_enabled', 'true'), ('alerts_sent', '{}');

create or replace function public.record_spend(p_provider text, p_model text, p_purpose text, p_in int, p_out int, p_units int, p_cost numeric)
returns void language sql security definer set search_path = public as $$
  insert into spend_ledger(provider, model, purpose, input_tokens, output_tokens, units, cost_usd) values (p_provider, p_model, p_purpose, p_in, p_out, p_units, p_cost) $$;
grant execute on function public.record_spend to bot_runtime, service_role;

create or replace view public.spend_today_v as
  select coalesce(sum(cost_usd),0) as usd from public.spend_ledger where day = (now() at time zone 'Europe/Istanbul')::date;
create or replace view public.spend_month_v as
  select coalesce(sum(cost_usd),0) as usd from public.spend_ledger where date_trunc('month', day) = date_trunc('month', (now() at time zone 'Europe/Istanbul')::date);
```

### 3.9 Ders kayıtları (`0010_lessons.sql`)

```sql
create table public.lesson_recordings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id),
  instructor_profile_id uuid references public.profiles(id),
  recorded_at timestamptz not null, duration_sec int,
  video_storage_path text,                      -- 'lessons/<id>.mp4' — delete_video_after sonrası NULL
  audio_storage_path text, transcript_storage_path text, frames_storage_prefix text,
  delete_video_after timestamptz not null default now() + interval '30 days',
  video_deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.lesson_reports (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.lesson_recordings(id) on delete cascade,
  seq int not null default 1,                   -- kümülatif: aynı öğrencinin kaçıncı dersi
  analysis jsonb not null,                      -- contracts/lesson-analysis.schema.json
  provider text not null, model text not null, cost_usd numeric(10,6) not null default 0,
  status text not null default 'pending_review' check (status in ('pending_review','approved','corrected','rejected')),
  corrections jsonb,                            -- eğitmenin düzelttiği alanlar (analysis ile aynı şema, kısmi)
  reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
  applied_at timestamptz,                       -- apply_lesson_report çalıştı
  created_at timestamptz not null default now()
);

-- Onaylanan raporu profile işler: skills → observations(kind=lesson), misconceptions, memory_facts(promise/deadline)
create or replace function public.apply_lesson_report(p_report uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r record; a jsonb; s jsonb; m jsonb; n int := 0; enr uuid;
begin
  select lr.*, rec.enrollment_id into r from lesson_reports lr join lesson_recordings rec on rec.id = lr.recording_id where lr.id = p_report;
  if r.status not in ('approved','corrected') then raise exception 'report not approved'; end if;
  if r.applied_at is not null then return 0; end if;
  a := coalesce(r.analysis || coalesce(r.corrections, '{}'::jsonb), r.analysis); enr := r.enrollment_id;
  for s in select * from jsonb_array_elements(a->'skills') loop
    perform apply_observation(enr, s->>'skill_id', 'lesson', (s->>'mastery')::numeric, 0.6, 'lesson_report',
                              p_report::text || '#' || coalesce(s->'evidence'->0->>'timestamp',''), null, s->'evidence'->0->>'quote');
    n := n + 1;
  end loop;
  for m in select * from jsonb_array_elements(a->'misconceptions') loop
    perform apply_observation(enr, m->>'skill_id', 'lesson', 0, 0.6, 'lesson_report', p_report::text || '#' || coalesce(m->>'timestamp',''), m->>'tag', m->>'quote');
    n := n + 1;
  end loop;
  update lesson_reports set applied_at = now() where id = p_report;
  return n;
end $$;
revoke all on function public.apply_lesson_report from public;
grant execute on function public.apply_lesson_report to authenticated, service_role;   -- panelde eğitmen onayı tetikler; gövde panel_role kontrolü yapar
```

### 3.10 Kalem ve Kitap (`0011_kalem_kitap.sql`)

```sql
create table public.exam_sources (             -- meşru yoldan edinilmiş geçmiş sınavlar; UYGULAMADA YAYINLANMAZ
  id uuid primary key default gen_random_uuid(),
  course text not null, instructor_label text, term text, year int not null,
  acquired_from text not null,                  -- 'öğrenci arşivi', 'ÖSYM yayımı (yalnız analiz)'
  storage_path text not null, page_count int,
  created_at timestamptz not null default now()
);
create table public.exam_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.exam_sources(id) on delete cascade,
  item_no int not null, topic text not null, kind text not null check (kind in ('proof','computation','multiple_choice','short_answer','other')),
  points numeric(5,2), year int not null, skill_id text references public.skills(id),
  stem_private text not null,                   -- yalnızca analiz; panelde bile yalnız koordinatör
  embedding vector(768), cluster_id uuid,
  created_at timestamptz not null default now()
);
create table public.exam_clusters (
  id uuid primary key default gen_random_uuid(),
  course text not null, label text not null, skill_id text references public.skills(id),
  item_ids uuid[] not null, years int[] not null, hits int not null, years_total int not null,
  avg_points numeric(5,2), created_at timestamptz not null default now()
);
create table public.priority_plans (
  id uuid primary key default gen_random_uuid(),
  course text not null, curriculum_version_id text references public.curriculum_versions(id),
  plan jsonb not null,                          -- contracts/priority-plan.schema.json
  generated_at timestamptz not null default now()
);

create table public.research_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete set null, requested_by uuid references public.profiles(id),
  query text not null, status text not null default 'queued' check (status in ('queued','running','done','failed')),
  cost_usd numeric(10,6) not null default 0, created_at timestamptz not null default now(), finished_at timestamptz
);
create table public.research_outputs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.research_requests(id) on delete cascade,
  output jsonb not null,                        -- contracts/research-output.schema.json
  created_at timestamptz not null default now()
);
create table public.citations (
  id uuid primary key default gen_random_uuid(),
  output_id uuid not null references public.research_outputs(id) on delete cascade,
  doi text not null, title text not null, authors text, venue text, year int,
  crossref_verified boolean not null default false, verified_at timestamptz, pdf_url text, tldr text,
  unique (output_id, doi)
);
```

### 3.11 Uyarılar, görünümler, saklama (`0012`, `0014`)

```sql
create table public.instructor_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('unanswered','silent','morale','deadline','response')),
  severity text not null check (severity in ('danger','warning','neutral')),
  student_id uuid references public.students(id) on delete cascade,
  profile_id uuid references public.profiles(id),      -- hedef eğitmen (null = koordinatör)
  detail text not null, since timestamptz not null,
  ref jsonb not null default '{}',                      -- {escalation_id} | {fact_id} | {chat_id, message_id}
  computed_at timestamptz not null default now(), resolved_at timestamptz
);
create unique index instructor_alerts_dedup on public.instructor_alerts (kind, student_id, coalesce(ref->>'escalation_id',''), coalesce(ref->>'fact_id','')) where resolved_at is null;
create table public.retention_runs (id bigint generated always as identity primary key, job text not null, ran_at timestamptz not null default now(), rows_deleted int not null, detail jsonb);

create or replace view public.review_queue_v as
  select 'question' as kind, id::text as ref_id, created_at, status from public.questions where status = 'pending_review'
  union all select 'figure', id::text, created_at, status from public.figures where status in ('pending','failed')
  union all select 'misconception', id::text, first_seen, status from public.misconceptions where status = 'pending_review'
  union all select 'lesson_report', id::text, created_at, status from public.lesson_reports where status = 'pending_review'
  union all select 'bot_response', id::text, flagged_at, 'flagged' from public.bot_responses where flagged;

-- 0014_retention.sql
create or replace function public.purge_expired() returns jsonb language plpgsql security definer set search_path = public as $$
declare m int; b int; f int; v int;
begin
  delete from messages where expires_at < now(); get diagnostics m = row_count;
  delete from bot_responses where expires_at < now() and not flagged; get diagnostics b = row_count;
  delete from memory_facts where expires_at < now(); get diagnostics f = row_count;
  update lesson_recordings set video_deleted_at = now() where video_deleted_at is null and delete_video_after < now(); get diagnostics v = row_count;
  -- v satırının Storage nesnesi, GitHub Actions 'retention' adımı tarafından silinir (Storage silme SQL'den yapılamaz)
  insert into retention_runs(job, rows_deleted, detail) values ('purge_expired', m+b+f+v, jsonb_build_object('messages',m,'bot_responses',b,'facts',f,'videos_marked',v));
  return jsonb_build_object('messages',m,'bot_responses',b,'facts',f,'videos_marked',v);
end $$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-expired', '15 3 * * *', $c$ select public.purge_expired() $c$);
  end if;
end $$;
```

Saklama süreleri tek yerde: `telegram_chats.retention_days` (varsayılan 90; `messages.expires_at` trigger ile bu değere göre atanır), `memory_facts` 180 gün, `bot_responses` 90 gün (işaretli olanlar inceleme bitene kadar), ham video 30 gün (transkript kalır), `student.deleted_at` → 7 gün sonra tüm satırlar `cascade` ile silinir (`purge_deleted_students()`, aynı dosyada). `docs/hukuk/saklama-politikasi.md` bu sayıları birebir yazar; §9'daki test, metindeki sayıyla DB varsayılanını karşılaştırır.

### 3.12 RLS ve yetki matrisi (`0013_rls.sql`)

`alter table ... enable row level security` her tabloda; `force row level security` tablo sahibi için de. `anon` rolünün hiçbir tabloda yetkisi yok. `service_role` RLS'yi atlar (Supabase varsayılanı) ve yalnızca GitHub Actions/kurucu makinesinde kullanılır. Panel kullanıcıları `authenticated` + `profiles.role`; öğrenci (`authenticated` + `students.auth_user_id`) şimdilik yalnızca ileriye dönük tanımlıdır.

| Tablo | öğrenci (auth) | eğitmen (instructor) | koordinatör | gözlemci | bot_runtime |
| --- | --- | --- | --- | --- | --- |
| profiles | — | kendi satırı R | R/W | kendi R | — |
| students | kendi R | R (can_see_student) | R/W | R | R/W (telegram_user_id ile) |
| student_private | kendi R | R/W (can_see_student) | R/W | R | **GRANT YOK** |
| consents | kendi R | R/W | R/W | R | R/W (telegram düğmesi) |
| curriculum_versions, skills, skill_prerequisites, misconception_tags | R | R | R/W | R | R |
| enrollments | kendi R | R | R/W | R | R/W |
| mastery | kendi R | R | R | R | R (yazma yalnız fonksiyon) |
| observations | kendi R | R | R | R | — (fonksiyon) |
| misconceptions | kendi R (status=open/resolved) | R/W status, resolved_by | R/W | R | R |
| preferences | kendi R/W | R | R/W | R | R/W |
| questions | R (approved) | R/W | R/W | R | R (approved) |
| answer_keys | — | R + set_answer_key() | R + set_answer_key() | — | **GRANT YOK** |
| figures | R (verified) | R/W | R/W | R | R (verified) |
| question_templates | — | R | R/W | R | R |
| diagnostic_sessions | kendi R | R | R | R | R/W |
| question_attempts | kendi R | R | R | R | — (grade_answer) |
| telegram_chats, chat_members | kendi sohbetleri R | kendi sohbetleri R | R/W | R | R/W |
| messages | kendi R | kendi sohbetleri R | R | R | R/W (insert, select; delete yok) |
| bot_sessions | — | — | R | — | R/W |
| escalations | kendi R | R/W (assigned/kendi sohbeti) | R/W | R | R/W (insert, select) |
| bot_responses | — | R + flag (update flagged,flag_note) | R/W | R | insert, select (kendi yazdıkları) |
| proactive_messages | kendi R | R | R/W | R | R/W |
| memory_facts | kendi R | R, approve (approved_by) | R/W | R | select (match_memory_facts) |
| weekly_summaries | kendi R | R | R/W | R | R |
| quota_limits, spend_caps, system_flags | — | R | R/W | R | R (+ system_flags update: alerts_sent) |
| quota_usage, spend_ledger | — | R | R | R | fonksiyon |
| lesson_recordings, lesson_reports | kendi R (status=approved, analysis hariç) | R/W (kendi öğrencileri) | R/W | R | — |
| exam_* , priority_plans | priority_plans R | R | R/W | R | priority_plans R |
| research_* , citations | kendi R | R/W | R/W | R | R/W (research_requests insert) |
| instructor_alerts | — | R/W (profile_id = uid veya null) | R/W | R | — |

Politika şablonu (her tablo için aynı kalıp; örnek `messages`):

```sql
alter table public.messages enable row level security; alter table public.messages force row level security;
grant select, insert on public.messages to bot_runtime;
grant select on public.messages to authenticated;
create policy messages_bot on public.messages for all to bot_runtime using (true) with check (true);
create policy messages_panel_read on public.messages for select to authenticated
  using (app.is_coordinator() or app.panel_role() = 'observer'
         or exists (select 1 from public.chat_members cm where cm.chat_id = messages.chat_id and cm.profile_id = app.uid())
         or (student_id is not null and exists (select 1 from public.students s where s.id = messages.student_id and s.auth_user_id = app.uid())));
```

Test dosyası `supabase/tests/02_rls.sql` her satırı şu kalıpla sınar (psql, `ON_ERROR_STOP`):

```sql
-- bot_runtime cevap anahtarını okuyamaz
set role bot_runtime; select set_config('request.jwt.claims', '{"role":"bot_runtime"}', true);
do $$ begin perform * from public.answer_keys; raise exception 'FAIL: bot_runtime read answer_keys';
exception when insufficient_privilege then null; end $$;
-- ama grade_answer çalışır ve doğru sonucu verir
select ok from (select is_correct as ok from public.grade_answer(:'enr', :'q1', 'B', 'practice')) t where ok;  -- satır dönmezse \if ile FAIL
reset role;
-- eğitmen A, kendi sohbetinde olmayan öğrenci B'nin mesajlarını göremez
set role authenticated; select set_config('request.jwt.claims', '{"role":"authenticated","sub":"<instructorA>"}', true);
select case when count(*) = 0 then 'ok' else 'FAIL' end from public.messages where student_id = :'studentB';
```

`db-test.sh` çıktıda `FAIL` geçerse sıfır olmayan kodla çıkar.

### 3.13 Tohumlama (seed) stratejisi

1. `supabase/seed/00_roles.sql`: `bot_runtime` ve test profilleri (`inst_a`, `inst_b`, `coord`) — yalnızca yerel/test.
2. `supabase/seed/01_quota_limits.sql`: kota ve harcama tavanları (migrasyonda da var; idempotent `on conflict do nothing`).
3. `content/tyt-matematik/scripts/seed.py`: `curriculum.json`, `skills.json`, `prerequisites.json`, `misconception-tags.json`, `diagnostic/questions.json` (status `approved`, `created_by='seed'`), `diagnostic/answer-keys.json` (→ `answer_keys`, yalnızca service_role/DATABASE_URL ile), `question_templates`. `--dry-run` SQL dosyası üretir; CI bu dosyayı sqlfluff ile lint'ler.
4. `supabase/seed/90_demo.sql` (yalnız yerel): 5 sahte öğrenci, 1 grup, 2 eğitmen, 30 mesaj, 10 olgu (embedding sahte-deterministik), 1 ders raporu `pending_review` — panelin mock olmadan canlı DB ile denenmesi için.

## 4. Sözleşmeler

Konum: `packages/contracts/schemas/*.schema.json` (JSON Schema draft 2020-12, `$id` = `https://ogrenmen.easy/schemas/<ad>.json`). Türkçe `description` alanları zorunlu. Her şemanın `examples/<ad>.example.json`'ı vardır ve testte doğrulanır.

Tüketim:

- **TypeScript**: `packages/contracts/src/index.ts`, `ajv` (`strict: true`, `allErrors`) ile her şemayı derler ve `validateQuestion(data): data is Question` biçiminde tip koruyucular dışa verir; tipler `json-schema-to-typescript` ile `dist/types.d.ts`'e üretilir (`npm run build`). Worker, LLM yapılandırılmış çıktısını (Gemini `responseSchema`) bu şemadan türetir: `toGeminiSchema(schema)` fonksiyonu `$ref`, `$id`, `examples` alanlarını kaldırır (Gemini alt kümeyi kabul eder). Panel aynı tipleri `import type` ile kullanır.
- **Python**: `packages/contracts/python/ogrenmen_contracts/__init__.py` — `SCHEMAS = {name: Draft202012Validator}` (dosyalar `importlib.resources` ile paketin içinden okunur; `pyproject` `package-data` ile `schemas/` dizinini kopyalar), `validate(name, obj)` hata listesi döner, `gemini_schema(name)` Gemini `response_schema`'ya dönüştürür. Pydantic kullanılmaz (tek kaynak JSON Schema).
- `models.json` her iki dilde maliyet hesabı için okunur (`costs.ts`, `costs.py`).

Ortak tanımlar `common.schema.json` içinde (`$ref` ile): `uuid`, `skill_id` (`^[a-z]+\.[a-z]+\.[a-z0-9-]+$`), `tag` (`^[a-z0-9-]+\.[a-z0-9-]+$`), `timestamp` (`date-time`), `evidence` (`{kind, source, quote, timestamp?, href?}`), `usd` (number ≥ 0).

### 4.1 `question.schema.json` — soru maddesi (cevap anahtarı burada DEĞİL)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ogrenmen.easy/schemas/question.json",
  "title": "Soru maddesi",
  "type": "object",
  "required": ["id", "curriculum_version_id", "skill_ids", "stem", "options", "origin", "status", "verification"],
  "additionalProperties": false,
  "properties": {
    "id": { "$ref": "common.json#/$defs/uuid" },
    "curriculum_version_id": { "type": "string", "description": "Müfredat sürümü, ör. tyt-mat-2026" },
    "skill_ids": { "type": "array", "minItems": 1, "items": { "$ref": "common.json#/$defs/skill_id" } },
    "stem": { "type": "string", "minLength": 10, "maxLength": 1200, "description": "Soru kökü; formüller düz metin/kod biçiminde" },
    "stem_values": { "type": "object", "additionalProperties": { "type": ["number", "string"] }, "description": "Şekil denetiminde karşılaştırılacak değerler" },
    "figure": {
      "type": ["object", "null"],
      "required": ["tool", "code", "alt_text"],
      "additionalProperties": false,
      "properties": {
        "tool": { "enum": ["matplotlib", "svg", "tikz", "vega-lite", "schemdraw", "rdkit", "graphviz", "latex"] },
        "code": { "type": "string", "maxLength": 20000 },
        "alt_text": { "type": "string", "minLength": 10, "description": "Şekli kelimelerle anlatır (Telegram altyazısı ve alt)" },
        "storage_path": { "type": ["string", "null"] }
      }
    },
    "options": {
      "type": "array", "minItems": 4, "maxItems": 5,
      "items": {
        "type": "object", "required": ["letter", "text"], "additionalProperties": false,
        "properties": {
          "letter": { "enum": ["A", "B", "C", "D", "E"] },
          "text": { "type": "string", "minLength": 1, "maxLength": 200 },
          "misconception_tag": { "oneOf": [{ "$ref": "common.json#/$defs/tag" }, { "type": "null" }], "description": "Yanlış şıkkın kodladığı yanılgı; doğru şıkta null. Doğru şık bu dosyadan anlaşılamaz: tam olarak bir şıkta null olması zorunlu değildir, çeldiricilerden biri de etiketsiz olabilir." }
        }
      }
    },
    "difficulty": { "type": "integer", "minimum": 1, "maximum": 5 },
    "origin": { "enum": ["authored", "llm", "template"] },
    "template_id": { "type": ["string", "null"] },
    "template_params": { "type": ["object", "null"] },
    "verification": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "render": { "type": ["object", "null"], "properties": { "ok": { "type": "boolean" }, "ms": { "type": "integer" }, "error": { "type": "string" } } },
        "size": { "type": ["object", "null"], "properties": { "ok": { "type": "boolean" }, "width": { "type": "integer" }, "height": { "type": "integer" } } },
        "vision": { "type": ["object", "null"], "properties": { "ok": { "type": "boolean" }, "model": { "type": "string" }, "mismatches": { "type": "array", "items": { "type": "string" } } } },
        "sympy": { "type": ["object", "null"], "properties": { "ok": { "type": "boolean" }, "expr": { "type": "string" }, "expected": { "type": "string" } } },
        "attempts": { "type": "integer", "minimum": 0, "maximum": 3 }
      }
    },
    "status": { "enum": ["draft", "pending_review", "approved", "rejected"] },
    "review_note": { "type": ["string", "null"] }
  }
}
```

Cevap anahtarı ayrı şema `answer-key.schema.json`: `{question_id, correct_letter, numeric_answer?, solution, sympy_check?}`; yalnızca `content/.../answer-keys.json`, Tablet'in service_role yazımı ve panelin `set_answer_key` çağrısı tarafından kullanılır. Worker paketi bu şemayı **import etmez** (ESLint `no-restricted-imports` kuralı ile derlemede engellenir).

LLM'den soru üretirken (Tablet) kullanılan yapılandırılmış çıktı şeması `question-generation.schema.json`'dur: `question` alanları + `answer: {correct_letter, numeric_answer, solution}` tek nesnede gelir; boru hattı bunu ikiye böler, `answer` SymPy'den geçmeden hiçbir yere yazılmaz.

### 4.2 `lesson-analysis.schema.json` — ders analizi çıktısı (güçlü model, JSON zorunlu)

```json
{
  "$id": "https://ogrenmen.easy/schemas/lesson-analysis.json",
  "title": "Ders analizi",
  "type": "object",
  "required": ["recording_id", "student_code", "skills", "questions_asked", "hesitations", "misconceptions", "homework", "promises", "talk_ratio", "indicators", "next_step", "note_for_next_lesson"],
  "additionalProperties": false,
  "properties": {
    "recording_id": { "$ref": "common.json#/$defs/uuid" },
    "student_code": { "type": "string", "pattern": "^[0-9a-f]{12}$", "description": "students.public_code; isim asla" },
    "skills": {
      "type": "array",
      "items": {
        "type": "object", "required": ["skill_id", "mastery", "evidence"], "additionalProperties": false,
        "properties": {
          "skill_id": { "$ref": "common.json#/$defs/skill_id" },
          "mastery": { "type": "number", "minimum": 0, "maximum": 1 },
          "evidence": { "type": "array", "minItems": 1, "items": { "$ref": "common.json#/$defs/evidence" }, "description": "Alıntı + zaman damgası (HH:MM:SS); kanıtsız kazanım geçersiz" },
          "improved_since_last": { "type": ["boolean", "null"], "description": "Önceki profilde açık yanılgı/düşük ustalık vardıysa düzeldi mi" }
        }
      }
    },
    "questions_asked": { "type": "array", "items": { "type": "object", "required": ["timestamp", "quote"], "properties": { "timestamp": { "type": "string", "pattern": "^\\d{2}:\\d{2}:\\d{2}$" }, "quote": { "type": "string" }, "skill_id": { "$ref": "common.json#/$defs/skill_id" } } } },
    "hesitations": { "type": "array", "items": { "type": "object", "required": ["timestamp", "kind", "quote"], "properties": { "timestamp": { "type": "string" }, "kind": { "enum": ["said_dont_understand", "long_silence", "wrong_answer", "asked_to_repeat"] }, "quote": { "type": "string" } } } },
    "misconceptions": { "type": "array", "items": { "type": "object", "required": ["skill_id", "text", "quote", "timestamp"], "properties": { "skill_id": { "$ref": "common.json#/$defs/skill_id" }, "tag": { "oneOf": [{ "$ref": "common.json#/$defs/tag" }, { "type": "null" }], "description": "Bilinen etiketlerden biri; yoksa null ve text serbest" }, "text": { "type": "string" }, "quote": { "type": "string" }, "timestamp": { "type": "string" } } } },
    "homework": { "type": "array", "items": { "type": "object", "required": ["text"], "properties": { "text": { "type": "string" }, "due": { "type": ["string", "null"], "format": "date" }, "quote": { "type": "string" } } } },
    "promises": { "type": "array", "items": { "type": "object", "required": ["by", "text"], "properties": { "by": { "enum": ["ÖĞRENCİ", "EĞİTMEN"] }, "text": { "type": "string" }, "quote": { "type": "string" }, "timestamp": { "type": "string" } } } },
    "talk_ratio": { "type": "object", "required": ["student", "instructor"], "properties": { "student": { "type": "number", "minimum": 0, "maximum": 1 }, "instructor": { "type": "number", "minimum": 0, "maximum": 1 } } },
    "indicators": { "type": "object", "required": ["question_count", "attention", "morale"], "properties": { "question_count": { "type": "integer" }, "attention": { "enum": ["low", "medium", "high"] }, "morale": { "enum": ["low", "medium", "high"] }, "morale_evidence": { "type": "string" } } },
    "next_step": { "type": "string", "maxLength": 600 },
    "note_for_next_lesson": { "type": "string", "maxLength": 600 }
  }
}
```

### 4.3 `memory-fact.schema.json` ve `weekly-summary.schema.json`

```json
{ "$id": "https://ogrenmen.easy/schemas/memory-fact.json", "title": "Hafıza olgusu", "type": "object",
  "required": ["kind", "text", "source_message_ids", "confidence"], "additionalProperties": false,
  "properties": {
    "kind": { "enum": ["promise", "deadline", "unanswered_question", "morale", "topic_asked", "preference", "instructor_statement", "other"] },
    "text": { "type": "string", "minLength": 5, "maxLength": 300, "description": "İsimsiz, üçüncü tekil: 'Cuma gününe kadar 20 soru çözeceğini söyledi.'" },
    "source_message_ids": { "type": "array", "minItems": 1, "items": { "type": "integer" }, "description": "messages.id — kaynak zorunlu" },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "occurs_at": { "type": ["string", "null"], "format": "date-time" },
    "requires_approval": { "type": "boolean", "default": false, "description": "Not/devamsızlık/puan içeriyorsa true; onaysız kullanılmaz" }
  } }
```

Gece işinin LLM çıktısı `memory-extraction.schema.json` = `{ "facts": [memory-fact...], "preferences": {modality?, explanation_style?, active_hours?} }`.

```json
{ "$id": "https://ogrenmen.easy/schemas/weekly-summary.json", "title": "Haftalık özet", "type": "object",
  "required": ["student_code", "week_start", "text", "fact_ids", "flags"], "additionalProperties": false,
  "properties": {
    "student_code": { "type": "string" }, "week_start": { "type": "string", "format": "date" },
    "text": { "type": "string", "maxLength": 900, "description": "4–6 cümle: ne çalıştı, nerede takıldı, ne söz verdi, moral" },
    "fact_ids": { "type": "array", "items": { "type": "integer" } },
    "flags": { "type": "object", "properties": { "morale_drop": { "type": "boolean" }, "silent_days": { "type": "integer" }, "open_promises": { "type": "integer" } } }
  } }
```

### 4.4 `research-output.schema.json` + `citation`

```json
{ "$id": "https://ogrenmen.easy/schemas/research-output.json", "title": "Araştırma çıktısı", "type": "object",
  "required": ["query", "expanded_queries", "synthesis", "citations", "matrix", "bibtex", "apa"], "additionalProperties": false,
  "$defs": {
    "citation": { "type": "object", "required": ["doi", "title", "crossref_verified"], "additionalProperties": false,
      "properties": {
        "doi": { "type": "string", "pattern": "^10\\.\\d{4,9}/\\S+$" }, "title": { "type": "string" }, "authors": { "type": "string" },
        "venue": { "type": "string" }, "year": { "type": "integer" }, "tldr": { "type": "string", "maxLength": 240 },
        "pdf_url": { "type": ["string", "null"] }, "source": { "enum": ["openalex", "semantic_scholar", "arxiv", "crossref"] },
        "crossref_verified": { "type": "boolean", "description": "false ise çıktıya girmez; incelemede 'kaldırılacak'" } } } },
  "properties": {
    "query": { "type": "string" },
    "expanded_queries": { "type": "array", "minItems": 3, "maxItems": 5, "items": { "type": "string" } },
    "synthesis": { "type": "string", "description": "Her cümle [doi] işaretiyle; işaretsiz iddia yok" },
    "citations": { "type": "array", "items": { "$ref": "#/$defs/citation" } },
    "matrix": { "type": "array", "items": { "type": "object", "required": ["doi", "method", "sample", "finding"], "properties": { "doi": { "type": "string" }, "method": { "type": "string" }, "sample": { "type": "string" }, "finding": { "type": "string" } } } },
    "bibtex": { "type": "string" }, "apa": { "type": "array", "items": { "type": "string" } }
  } }
```

### 4.5 `exam-item.schema.json` ve `priority-plan.schema.json`

```json
{ "$id": "https://ogrenmen.easy/schemas/exam-item.json", "type": "object",
  "required": ["source_id", "item_no", "topic", "kind", "year"], "additionalProperties": false,
  "properties": { "source_id": { "$ref": "common.json#/$defs/uuid" }, "item_no": { "type": "integer" }, "topic": { "type": "string" },
    "kind": { "enum": ["proof", "computation", "multiple_choice", "short_answer", "other"] }, "points": { "type": ["number", "null"] },
    "year": { "type": "integer" }, "instructor_label": { "type": ["string", "null"] }, "skill_id": { "oneOf": [{ "$ref": "common.json#/$defs/skill_id" }, { "type": "null" }] },
    "stem_private": { "type": "string", "description": "Yalnızca analiz; hiçbir yüzeyde yayınlanmaz" } } }
```

```json
{ "$id": "https://ogrenmen.easy/schemas/priority-plan.json", "title": "Sıklık analizine göre öncelikler", "type": "object",
  "required": ["course", "years_analyzed", "rows", "uncovered_topics"], "additionalProperties": false,
  "properties": {
    "course": { "type": "string" }, "years_analyzed": { "type": "array", "items": { "type": "integer" } },
    "rows": { "type": "array", "items": { "type": "object", "required": ["rank", "topic", "kind", "hits", "years", "evidence_count"],
      "properties": { "rank": { "type": "integer" }, "topic": { "type": "string" }, "kind": { "type": "string" }, "hits": { "type": "integer" }, "years": { "type": "integer" },
        "avg_points": { "type": ["number", "null"] }, "evidence_count": { "type": "integer" }, "cluster_id": { "type": "string" }, "skill_id": { "type": ["string", "null"] },
        "variant_question_ids": { "type": "array", "items": { "type": "string" }, "description": "Üretilen ÖZGÜN varyantlar; kaynak sorular değil" } } } },
    "uncovered_topics": { "type": "array", "items": { "type": "string" }, "description": "İzlencede var, hiç sorulmamış" },
    "wording_rule": { "const": "Sıklık analizine göre öncelik; 'tahmin', 'çıkacak', 'kesin' kullanılmaz" }
  } }
```

### 4.6 `bot-response-log.schema.json`

```json
{ "$id": "https://ogrenmen.easy/schemas/bot-response-log.json", "type": "object",
  "required": ["chat_id", "mode", "purpose", "prompt", "memory_fact_ids", "recent_message_ids", "provider", "model", "attempts", "input_tokens", "output_tokens", "cost_usd", "response_text"],
  "additionalProperties": false,
  "properties": {
    "chat_id": { "type": "integer" }, "student_id": { "oneOf": [{ "$ref": "common.json#/$defs/uuid" }, { "type": "null" }] }, "in_message_id": { "type": ["integer", "null"] },
    "mode": { "enum": ["socratic", "direct"] }, "purpose": { "enum": ["chat", "diagnostic_feedback", "proactive", "escalation_note"] },
    "prompt": { "type": "object", "required": ["system", "messages"], "properties": { "system": { "type": "string" }, "messages": { "type": "array", "items": { "type": "object", "required": ["role", "content"], "properties": { "role": { "enum": ["user", "assistant"] }, "content": { "type": "string" } } } }, "schema": { "type": ["string", "null"] } } },
    "memory_fact_ids": { "type": "array", "items": { "type": "integer" } }, "recent_message_ids": { "type": "array", "items": { "type": "integer" } },
    "provider": { "type": "string" }, "model": { "type": "string" },
    "attempts": { "type": "array", "items": { "type": "object", "required": ["provider", "model", "status", "ms"], "properties": { "provider": { "type": "string" }, "model": { "type": "string" }, "status": { "type": "integer" }, "ms": { "type": "integer" }, "error": { "type": "string" } } } },
    "input_tokens": { "type": "integer" }, "output_tokens": { "type": "integer" }, "cost_usd": { "$ref": "common.json#/$defs/usd" }, "latency_ms": { "type": "integer" },
    "response_text": { "type": "string" }
  } }
```

Sohbet yanıtının kendisi de yapılandırılmıştır (`tutor-reply.schema.json`): `{ "message": string(≤ 4 satır), "ends_with_question": boolean, "confidence": 0–1, "escalate": boolean, "escalate_reason": enum|null, "topic_skill_id": skill_id|null, "buttons": [{label ≤ 20 karakter, action: 'hint'|'show_solution'|'ask_instructor'|'skip'}] (≤ 3) }`. `confidence < 0.5` ya da `escalate=true` → yükseltme.

### 4.7 `instructor-alert.schema.json`

```json
{ "$id": "https://ogrenmen.easy/schemas/instructor-alert.json", "type": "object",
  "required": ["kind", "severity", "student_id", "detail", "since", "ref"], "additionalProperties": false,
  "properties": {
    "kind": { "enum": ["unanswered", "silent", "morale", "deadline", "response"] },
    "severity": { "enum": ["danger", "warning", "neutral"], "description": "Panelde kelimeyle: Acil / Dikkat / Bilgi" },
    "student_id": { "$ref": "common.json#/$defs/uuid" }, "profile_id": { "oneOf": [{ "$ref": "common.json#/$defs/uuid" }, { "type": "null" }] },
    "detail": { "type": "string", "maxLength": 200, "description": "Tek cümle; cevapsız soruda sorunun kendisi tırnak içinde; 'göstergesi düştü' gibi yargısız" },
    "since": { "type": "string", "format": "date-time" },
    "ref": { "type": "object", "properties": { "escalation_id": { "type": "string" }, "fact_id": { "type": "integer" }, "chat_id": { "type": "integer" }, "message_id": { "type": "integer" } } }
  } }
```

### 4.8 `models.json` — sağlayıcı ve maliyet tablosu

```json
{
  "updated": "2026-10-19",
  "note": "Fiyatlar 1M token başına USD; 0 = ücretsiz katman. Model adları ortam değişkeniyle ezilebilir (MODEL_<ROLE>). Ücretsiz katman limitleri sık değişir; gerçek limit AI Studio/sağlayıcı panelinde.",
  "providers": {
    "gemini_paid":  { "base": "https://generativelanguage.googleapis.com/v1beta", "key_env": "GEMINI_API_KEY_PAID" },
    "gemini_free":  { "base": "https://generativelanguage.googleapis.com/v1beta", "key_env": "GEMINI_API_KEY_FREE" },
    "groq":         { "base": "https://api.groq.com/openai/v1", "key_env": "GROQ_API_KEY" },
    "cloudflare":   { "base": "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run", "key_env": "CF_AI_TOKEN", "binding": "AI" },
    "openrouter":   { "base": "https://openrouter.ai/api/v1", "key_env": "OPENROUTER_API_KEY" },
    "anthropic":    { "base": "https://api.anthropic.com/v1", "key_env": "ANTHROPIC_API_KEY" }
  },
  "roles": {
    "chat":      [ ["gemini_paid", "gemini-2.5-flash-lite"], ["gemini_free", "gemini-2.5-flash-lite"], ["groq", "llama-3.3-70b-versatile"], ["cloudflare", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"], ["openrouter", "meta-llama/llama-3.3-70b-instruct:free"] ],
    "vision":    [ ["gemini_free", "gemini-2.5-flash"], ["gemini_paid", "gemini-2.5-flash"] ],
    "embedding": [ ["gemini_free", "gemini-embedding-001"], ["cloudflare", "@cf/baai/bge-m3"] ],
    "strong":    [ ["gemini_paid", "gemini-2.5-pro"], ["anthropic", "claude-sonnet-4-5"] ],
    "transcribe":[ ["gemini_free", "gemini-2.5-flash"], ["groq", "whisper-large-v3-turbo"], ["local", "whisper.cpp"] ]
  },
  "prices": {
    "gemini-2.5-flash-lite": { "in": 0.10, "out": 0.40, "batch_discount": 0.5 },
    "gemini-2.5-flash":      { "in": 0.30, "out": 2.50, "batch_discount": 0.5 },
    "gemini-2.5-pro":        { "in": 1.25, "out": 10.00, "batch_discount": 0.5 },
    "gemini-embedding-001":  { "in": 0.0, "out": 0.0, "dims": 768 },
    "claude-sonnet-4-5":     { "in": 3.00, "out": 15.00 },
    "llama-3.3-70b-versatile": { "in": 0.0, "out": 0.0 },
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { "in": 0.0, "out": 0.0 },
    "@cf/baai/bge-m3": { "in": 0.0, "out": 0.0, "dims": 1024, "note": "pgvector 768 ile uyumsuz; yalnızca embedding_dims=1024 ile ayrı sütun — pilotta kullanılmaz" },
    "meta-llama/llama-3.3-70b-instruct:free": { "in": 0.0, "out": 0.0 },
    "whisper-large-v3-turbo": { "per_hour_usd": 0.04 }
  },
  "free_tier_limits_note": "Ücretsiz katmanda gönderilen veri ürün eğitiminde kullanılabilir; bu yüzden öğrenci mesajı içeren 'chat' rolünde gemini_free yalnızca yedek ve her zaman temizlenmiş (scrub) metinle."
}
```

## 5. Worker (Telegram botu)

Dizin: `apps/worker/`. Tek Worker, iki giriş: `fetch` (webhook + sağlık) ve `scheduled` (cron). Tüm iş mantığı `createApp(env, deps)` saf fonksiyonunda; `index.ts` yalnızca gerçek bağımlılıkları bağlar. Böylece testler Workers çalışma zamanı olmadan Node'da koşar.

```
apps/worker/
├── wrangler.toml                 name="ogrenmen-bot", compatibility_date="2026-09-01", [triggers] crons, [ai] binding="AI", [vars] (gizli olmayanlar)
├── package.json                  scripts: dev, test, typecheck, build (= wrangler deploy --dry-run --outdir dist), lint
├── tsconfig.json                 strict, types: @cloudflare/workers-types
├── src/
│   ├── index.ts                  export default { fetch, scheduled } — deps'i gerçek adaptörlerle kurar
│   ├── app.ts                    createApp(env, deps): { handleUpdate(update), runCron(name, now) }
│   ├── env.ts                    Env arayüzü + zorunlu değişken kontrolü (eksikse 500 yerine açık hata)
│   ├── telegram/
│   │   ├── types.ts              Update, Message, CallbackQuery (gereken alt küme)
│   │   ├── api.ts                TelegramApi arayüzü + HttpTelegramApi (fetch, retry, 429 bekleme)
│   │   ├── fake.ts               FakeTelegramApi: gönderilenleri biriktirir, update üretici yardımcılar
│   │   ├── keyboard.ts           inline klavye: ≤ 3 düğme, tek satır, ≤ 20 karakter (telegram.md kuralı test edilir)
│   │   └── format.ts             kalın/kod kaçışları (MarkdownV2), 4 satır sınırı, Türkçe sayı biçimi
│   ├── router.ts                 update → komut | callback | grup mesajı | özel mesaj | üye değişikliği
│   ├── commands/                 start.ts, cevap.ts, mod.ts, yardim.ts, test.ts, hoca.ts, kota.ts, sil.ts
│   ├── flows/
│   │   ├── consent.ts            onay kapısı (KVKK + veli)
│   │   ├── diagnostic.ts         teşhis testi durum makinesi
│   │   ├── chat.ts               Sokratik/doğrudan sohbet: kota → hafıza → LLM → günlük → gönder
│   │   ├── group.ts              grup kuralları: kayıt bildirimi, @hoca yönlendirme, eğitmen adına konuşmama
│   │   └── escalation.ts         yükseltme kaydı + eğitmen etiketi
│   ├── llm/
│   │   ├── types.ts              LlmProvider { id, complete(req): Promise<LlmResult> }, LlmRequest {system, messages, schema?, maxTokens}
│   │   ├── router.ts             LlmRouter: rol → sıralı sağlayıcılar, 429/5xx/zaman aşımı → sonraki; harcama tavanı; günlük
│   │   ├── structured.ts         şema → sağlayıcı biçimi; çıktı ajv doğrulaması; 1 onarım denemesi
│   │   ├── costs.ts              models.json'dan maliyet
│   │   └── providers/            gemini.ts, groq.ts (OpenAI uyumlu), openrouter.ts (OpenAI uyumlu), cloudflare.ts (AI binding), fake.ts
│   ├── db/
│   │   ├── types.ts              Db arayüzü: tüm sorgular/RPC'ler isimli metotlar (getStudentByTelegramId, consumeQuota, gradeAnswer, ...)
│   │   ├── postgrest.ts          PostgrestDb: fetch + bot_runtime JWT; her metot tek PostgREST çağrısı
│   │   ├── jwt.ts                HS256 (WebCrypto) ile {role:'bot_runtime', exp} imzalama, 50 dk önbellek
│   │   └── fake.ts               FakeDb: bellek içi tablolar + grade_answer/consume_quota/apply_observation'ın TS eşlenikleri
│   ├── memory/
│   │   ├── embed.ts              Embedder arayüzü (gemini, cloudflare, fake: deterministik hash → 768 boyut)
│   │   └── retrieve.ts           buildContext(studentId, text): olgular (match_memory_facts, k=6) + son 8 mesaj + haftalık özet
│   ├── prompts/
│   │   ├── socratic.ts           sistem promptu (sen dili, 4 satır, soruyla bitir, emoji yok, cevabı verme)
│   │   ├── direct.ts             doğrudan mod: tek balonda tek adım
│   │   ├── diagnostic.ts         teşhis sonucu anlatımı (sayılar sunucudan; LLM yalnızca anlatır)
│   │   └── guard.ts              not/devamsızlık/puan/ödeme algılayıcı (regex + LLM 'escalate' alanı)
│   ├── scrub.ts                  PII temizleme: isim listesi, @kullanıcı, telefon, e-posta → [ÖĞRENCİ]/[EĞİTMEN]/[KİŞİ]
│   ├── mastery.ts                BKT (SQL ile birebir), teşhis özeti
│   ├── quota.ts                  consume + uyarı mesajı (5 kala, bir kez)
│   ├── spend.ts                  günlük/aylık toplam, tavan kontrolü, uyarı gönderimi
│   ├── cron/                     proactive.ts, retention.ts, keepalive.ts, spend-alert.ts
│   └── texts.ts                  tüm kullanıcı metinleri tek dosyada (telegram.md'ye birebir; test edilir)
├── test/
│   ├── fixtures/updates/*.json   gerçek Telegram update biçiminde örnekler
│   ├── e2e/*.test.ts             senaryolar (aşağıda)
│   ├── unit/*.test.ts
│   └── helpers.ts                makeApp({ now, random }) → { app, telegram, db, llm }
└── scripts/send-update.sh        wrangler dev'e sahte update POST eder
```

### 5.1 Webhook doğrulama ve yönlendirme

- Telegram'a `setWebhook(url=https://<worker>/telegram/<WEBHOOK_PATH_SECRET>, secret_token=TELEGRAM_WEBHOOK_SECRET, allowed_updates=[message, callback_query, my_chat_member, chat_member])` bir kez `scripts/set-webhook.sh` ile (anahtar gerektirir; pilot kurulumunda).
- Worker: yol eşleşmeli **ve** `X-Telegram-Bot-Api-Secret-Token` başlığı sabit zamanlı karşılaştırmayla doğru olmalı; değilse 401 ve gövde okunmaz. Her durumda Telegram'a 200 döner (yeniden teslimat fırtınası olmaz); iş `ctx.waitUntil` içinde tamamlanır; hata olursa `console.error` + Telegram'a kısa "Bir şey ters gitti, tekrar dener misin?" mesajı.
- Aynı `update_id` iki kez gelirse (yeniden deneme) `bot_sessions.last_update_id` ile yoksayılır.
- `router.ts` sırası: (1) `my_chat_member` → bot gruba eklendi/çıkarıldı → `telegram_chats` upsert + kayıt bildirimi gönder ve sabitle; (2) `chat_member` → yeni üye → kayıt bildirimi tekrar + `chat_members` upsert (rol: `student`, panelden değiştirilir); (3) `callback_query` → `consent:*`, `diag:<session>:<letter>`, `act:hint|show_solution|ask_instructor|skip`; (4) komut (`/start`, `/cevap`, `/mod`, `/yardim`, `/test`, `/hoca`, `/kota`, `/sil`); (5) grupta: yalnızca bota yanıt/etiket ya da `@hoca` içeren mesajlar işlenir, diğerleri **yalnız günlüğe** yazılır (gizlilik modu kapalı, her mesaj kaydedilir); (6) özelde: durum makinesine göre.
- `/health` → `{ok:true, version}`; `/metrics` yok (Cloudflare analytics yeter).

### 5.2 Komutlar ve metinler (`telegram.md` kuralı: 4 satır, emoji yok, fiille başlayan ≤ 20 karakterlik düğmeler)

| Komut | Davranış |
| --- | --- |
| `/start` | İlk cümle sabit: "Merhaba, ben Öğrenmen. easy'nin yapay zekâ öğretmeniyim; hocaların da bu grupta." Özelde onay kapısına girer. |
| `/cevap` | Yalnızca bekleyen soru için `direct_once=true`; "Tamam, bu soruda çözümü doğrudan göstereceğim." |
| `/mod` | Kalıcı mod seçimi: iki düğme "Sokratik kal" / "Doğrudan cevap". Sistem kendiliğinden doğrudan moda geçmez. |
| `/yardim` | Komut listesi, 4 satır. |
| `/test` | Teşhis testini başlatır/devam ettirir (`test` kotası). |
| `/hoca <metin>` | Soruyu yükseltir: "Bunu hocana bırakıyorum. @aysehoca, bu soruya bakabilir misin?" (`chat_members.subject` ile branş eğitmeni, yoksa koordinatör). |
| `/kota` | "Bugün 12/25 mesaj, 1/5 test kullandın. Yarın 00:00'da yenilenir." |
| `/sil` | Verilerin silinmesi talebi: onay düğmesi → `students.status='deleted'`, 7 gün sonra kalıcı silme; eğitmene bilgi. |

Grup kayıt bildirimi (sabitlenir): "Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve 90 gün sonra silinir. Ayrıntı: /gizlilik". Süre `telegram_chats.retention_days`'ten gelir; metin ve değer aynı kaynaktan (`texts.ts` fonksiyonu parametre alır).

### 5.3 Durum ve onay kapısı

`bot_sessions.state` makinesi (özel sohbet):

```
new ─/start─▶ awaiting_consent ─[Onaylıyorum]─▶ (is_minor ? awaiting_guardian : diagnostic|idle)
awaiting_guardian ─(panelde veli onayı kaydı | veli bağlantısı düğmesi)─▶ diagnostic
diagnostic ─18 soru─▶ idle ⇄ awaiting_answer (pratik sorusu bekleniyor)
```

- `awaiting_consent`: `Notice legal` metni (aydınlatma özeti + bağlantı), düğmeler "Onaylıyorum" / "Şimdi değil". Onay → `consents(kind='kvkk_aydinlatma', granted_via='telegram_button', evidence={chat_id,message_id,telegram_user_id})`.
- `is_minor` varsayılan **true** (18 yaş altı varsayımı); veli onayı iki yoldan: (a) eğitmen panelde "Veli onayı alındı" işaretler (form/ıslak imza kaydı `consents.evidence`), (b) `/veli <kod>` ile velinin Telegram'dan girdiği tek kullanımlık kod (panel üretir). Onay yokken bot yalnızca "Veli onayı tamamlanınca başlayabiliriz. Hocan sana yardımcı olacak." der; hiçbir LLM çağrısı yapılmaz.
- Grupta: onay kapısı kişi başına aynıdır; onaysız öğrencinin mesajı günlüğe `text_scrubbed=null` olarak yazılır (yalnız meta veri) ve bot ona cevap vermez.

### 5.4 Kota

Her LLM çağrısı öncesinde `consume_quota(student, kind)`; `kind`: `message` (sohbet), `test` (teşhis/pratik başlatma), `research`, `figure`. Red → `texts.quotaExhausted(used, limit)`: "Bugünlük mesaj hakkın doldu (25/25). Yarın 00:00'da yenilenir. Acil bir sorun varsa hocanı etiketleyebilirsin." `remaining == warn_at_remaining` ve `quota_warning_sent_on != today` → bir kez hatırlatma. Kota harcanmayan yollar: komutlar, düğmeler, veritabanından okunan cevaplar (`/kota`, teşhis özetinin tekrar gösterimi), günlüğe yazma. Kurucu makinesinden test için `QUOTA_BYPASS_TELEGRAM_IDS` ortam değişkeni.

### 5.5 LLM yönlendirici

```ts
interface LlmProvider { id: ProviderId; model: string; complete(req: LlmRequest, signal: AbortSignal): Promise<LlmResult>; }
interface LlmRequest { role: 'chat'|'vision'|'strong'; system: string; messages: {role:'user'|'assistant', content: string}[]; schema?: JsonSchema; maxTokens: number; temperature?: number; }
interface LlmResult { text: string; json?: unknown; inputTokens: number; outputTokens: number; }
class LlmRouter { constructor(chain: LlmProvider[], spend: SpendGuard, log: (attempt) => void, timeoutMs = 20000) ; complete(req): Promise<LlmResult & {provider, model, attempts}> }
```

- Zincir `models.json → roles.chat` sırasıyla: `gemini_paid` → `gemini_free` → `groq` → `cloudflare` → `openrouter`. Düşme koşulları: HTTP 429, 5xx, ağ hatası, 20 sn zaman aşımı, şema doğrulaması 2 kez başarısız. 4xx (400/401/403) düşmez, hata fırlatır (yapılandırma hatası sessizce ücretsiz katmana kaymamalı).
- `SpendGuard`: istek öncesi `system_flags.paid_providers_enabled` ve `spend_today_v / spend_month_v` (5 dk önbellek) okur. Günlük `cap_usd` aşıldıysa ücretli sağlayıcı zincirden çıkar (ücretsizler kalır); `alert_usd` aşıldıysa koordinatör sohbetine (`ALERT_CHAT_ID`) bir kez uyarı (`system_flags.alerts_sent[today]`). İstek sonrası `record_spend`.
- Yapılandırılmış çıktı: Gemini → `generationConfig.responseMimeType='application/json', responseSchema=toGeminiSchema(schema)`; Groq/OpenRouter → `response_format={type:'json_object'}` + şema metni sistem promptunda; Cloudflare AI → `response_format: {type:'json_schema', json_schema}`. Dönen JSON ajv ile doğrulanır; geçmezse aynı sağlayıcıya "Şu hatalar var: ... yalnızca JSON döndür" ile 1 onarım, sonra sonraki sağlayıcı.
- Her sağlayıcı sınıfı `fetch`'i kurucu parametresi olarak alır (test için). `FakeProvider` senaryolu: `{ respondWith: [...] , failWith: [429, 500] }`.
- PII: yönlendiriciye giren her metin `scrub()`'dan geçmiş olmalı; `LlmRouter.complete` isteğin `messages`'ında `[ÖĞRENCİ]` dışında bir Türkçe özel ad kalıbı (`chat_members.handle` ve `student_private` listesi) bulursa fırlatır (savunma hattı; testte sınanır).

Maliyet tahmini (pilot): 5 öğrenci × 25 mesaj × ~1.800 giriş + ~250 çıkış token ≈ 125 çağrı/gün ≈ 0,035 $/gün Flash-Lite ile; teşhis geri bildirimleri dahil ay ≈ 1,2 $. Günlük tavan 3 $ bu yüzden geniş bir emniyet.

### 5.6 Sokratik prompt tasarımı

`prompts/socratic.ts` sistem promptu (özet; tam metin dosyada, `texts.ts` ile aynı dil kuralları):

1. Kimlik: "Sen Öğrenmen'sin, easy'nin AI öğretmeni. Öğrenciye 'sen' diye hitap et. Sıcak ama ciddi."
2. Biçim: "En fazla 4 satır. Tek fikir. Çoğu zaman bir soruyla bitir. Emoji ve ünlem yok. Yalnızca **kalın** ve `kod` biçimi. Formül düz metin: `3/4 + 1/8 = 7/8`."
3. Pedagoji: "Cevabı verme; bir sonraki küçük adımı sor ya da tek ipucu ver. Öğrenci 'direkt söyle' derse `escalate=false, buttons=[show_solution]` öner ama cevabı verme (öğrenci /cevap der)."
4. Hata: "Yanlışta '✕ Tekrar dene' ile başla, nedenini tek cümleyle söyle, utandırma."
5. Sınırlar: "Not, devamsızlık, puan, ödeme, sınav tarihi hakkında kesin bilgi verme; `escalate=true, escalate_reason='grades_attendance'`. Emin değilsen 'Bundan emin değilim; hocana soralım.' ve `escalate=true`."
6. Bağlam (dinamik): kazanım durumu (`mastery` özetinden metin: "Rasyonel sayılarda kanıt yeterli, %62; üslü sayılarda henüz yeterli kanıt yok" — düşük kanıtta yüzde verilmez), açık yanılgılar (`text_student`), çekilen olgular (kaynak id'leriyle), son 8 mesaj (temizlenmiş), haftalık özet.
7. Çıktı: `tutor-reply.schema.json`.

`direct.ts`: aynı kurallar, ama "çözümü adım adım, her mesajda tek adım, soruyu bekle" ve bekleyen soru varsa çözüm metni **LLM'den değil** `get_solution()` RPC'sinden gelir; LLM yalnızca adımı sadeleştirip anlatır.

### 5.7 Hafıza çekme

`retrieve.buildContext(studentId, chatId, text)`:
1. `embed(text)` (rol `embedding`; sahte: deterministik hash → 768 boyutlu birim vektör) — Gemini ücretsiz, ücretsizse kaydedilir (0 $).
2. `rpc match_memory_facts(student, embedding, k=6, min_sim=0.25)`.
3. `messages` son 8 (aynı chat, `text_scrubbed is not null`).
4. `weekly_summaries` son hafta (varsa).
5. `mastery` + `misconceptions(status in open)` özeti (DB'den metin, LLM yok).
Dönüş `{facts, recent, summary, profileText, factIds, messageIds}`; `bot_responses.memory_fact_ids/recent_message_ids` buradan dolar.

### 5.8 Gruplar, roller, yükseltme

- Gizlilik modu kapalı (BotFather `/setprivacy` Disable); bot grupta **her** mesajı `messages`'a yazar (temizlenmiş metin), ama yalnızca etiketlenince/yanıtlanınca ya da öğrenci `@hoca`/`/hoca` deyince konuşur.
- Roller `chat_members.role`; yeni üye varsayılan `student`, eğitmenler panelden (`profile_id` bağlanır) ya da `/rol @kisi egitmen matematik` (yalnızca koordinatör Telegram id'si `COORDINATOR_TELEGRAM_IDS`).
- `@hoca` yönlendirme: mesajda `@hoca` ya da `/hoca` → `escalations(reason='human_requested')` + ilgili branş eğitmeninin `handle`'ı etiketlenir. Eğitmen o mesaja yanıt verince (`reply_to` eşleşmesi) `escalations.status='answered'`, `answered_at` → panel yanıt süresi metriği.
- LLM `escalate=true` → `reason='uncertain'`/`'grades_attendance'`; bot metni: "Bunu hocana bırakıyorum. @aysehoca, bu soruya bakabilir misin?" veya "Bunu hocan söyleyebilir; sorunu ona ilettim."
- Eğitmen adına konuşmama: `memory_facts.kind='instructor_statement'` yalnızca `approved_by` doluysa bağlama girer (RPC zaten filtreler).
- Grupta öğrenci adı değil `handle` kullanılır; `handle` yoksa "sen".

### 5.9 Cevap günlüğü

Her gönderim öncesi `bot_responses` satırı (`bot-response-log.schema.json` ile doğrulanır) — prompt (sistem + mesajlar), olgu ve mesaj id'leri, sağlayıcı/model/denemeler, token ve maliyet, gecikme. Gönderimden sonra `out_telegram_message_id` güncellenir. Eğitmen panelde "İşaretle" → `flagged=true`; haftalık inceleme listesi `review_queue_v`.

### 5.10 Cron işleri (`wrangler.toml [triggers] crons`)

| Cron | İş | Not |
| --- | --- | --- |
| `*/30 * * * *` | `proactive`: `proactive_messages` tablosunda `scheduled_for <= now` ve `sent_at is null` olanları gönder | Üretimi gece Python işi yapar; Worker yalnız gönderir (DB önce, LLM yok). Günde en fazla 1, aktif saat içinde. |
| `0 */1 * * *` | `spend-alert`: günlük/aylık toplam vs `spend_caps`; uyarı/kill-switch | `system_flags.paid_providers_enabled=false` → zincirden ücretliler çıkar |
| `20 3 * * *` | `retention`: `purge_expired()` RPC (pg_cron yoksa yedek) | Storage silme GitHub Actions'ta |
| `0 6 * * *` | `keepalive`: `select 1` (PostgREST `/rest/v1/quota_limits?select=kind&limit=1`) | Supabase 7 gün uyumasın; GitHub Actions'ta da ikinci bir ping |

### 5.11 Ortam değişkenleri ve gizler

`wrangler.toml [vars]` (gizli değil): `SUPABASE_URL`, `CURRICULUM_VERSION_ID=tyt-mat-2026`, `RETENTION_DAYS_DEFAULT=90`, `MODELS_JSON_OVERRIDE` (boş), `FAKE_PROVIDERS=0`, `ALERT_CHAT_ID`, `COORDINATOR_TELEGRAM_IDS`.
`wrangler secret put`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `WEBHOOK_PATH_SECRET`, `SUPABASE_JWT_SECRET` (bot_runtime JWT imzası), `GEMINI_API_KEY_PAID`, `GEMINI_API_KEY_FREE`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `CF_ACCOUNT_ID` (AI binding varsa gerekmez). Yerelde `.dev.vars` (gitignore) ve `.dev.vars.example` (commit).

Anahtar yoksa ilgili sağlayıcı zincirden **sessizce değil** `console.warn` ile çıkar; zincir boşsa ve `FAKE_PROVIDERS=1` değilse Worker açılışta hata verir.

### 5.12 Yerel test

- `vitest` (Node ortamı, `@cloudflare/workers-types` yalnız tipler için). `test/helpers.ts`: `makeApp()` → `FakeTelegramApi`, `FakeDb` (TS'te `grade_answer`, `consume_quota`, `apply_observation`, `match_memory_facts` eşlenikleri; teşhis soruları `content/tyt-matematik/diagnostic/*.json`'dan yüklenir — bu dosyalar M04'ten gelir, M03 kendi `test/fixtures/questions.sample.json` ile de çalışır), `FakeProvider`, sabit `clock`/`random`.
- Uçtan uca senaryolar (`test/e2e`): `start-consent.test.ts` (onaysız LLM çağrısı 0), `minor-guardian-gate.test.ts`, `diagnostic-18.test.ts` (18 cevap → `mastery` 14 kazanım, `evidence_count` toplamı 18, yanlış şıkta yanılgı satırı), `chat-socratic.test.ts` (yanıt ≤ 4 satır, soruyla bitiyor, `bot_responses` satırı şemaya uygun), `cevap-direct-once.test.ts`, `quota.test.ts` (26. mesajda red metni, 21. mesajda uyarı, 22.'de uyarı yok), `router-fallback.test.ts` (429 → sonraki sağlayıcı, `attempts` dizisi 2 kayıt; 401 → düşmez), `spend-cap.test.ts`, `group-escalation.test.ts` (`@hoca` → escalation + handle etiketi; not sorusu → eğitmen adına konuşmaz), `scrub.test.ts` (isim/telefon/e-posta → etiket), `webhook-auth.test.ts` (yanlış secret → 401, gövde işlenmez), `texts.test.ts` (tüm metinler: emoji yok, ünlem yok, düğme ≤ 20 karakter, ≤ 3 düğme).
- `wrangler dev --local --var FAKE_PROVIDERS:1` + `scripts/send-update.sh test/fixtures/updates/start.json` → sahte Telegram yerine `FAKE_TELEGRAM=1` iken gönderimler `console.log`'a düşer. `FakeDb` dev modda da kullanılabilir (`FAKE_DB=1`), böylece Supabase olmadan bot uçtan uca "konuşur".
- Kabul: `npm -w apps/worker run typecheck && npm -w apps/worker test && npm -w apps/worker run build`.

## 6. Pipelines (Python)

Ortak kurallar (`pipelines/common`): her CLI `--fake` (tüm adaptörler sahte), `--dry-run` (DB/Storage'a yazmaz, `--out <dir>` içine JSON yazar), `--student <uuid|code>`, `--since/--until`. Çıktı JSON'ları `ogrenmen_contracts.validate` ile doğrulanmadan yazılmaz. Harcama her LLM çağrısında `record_spend` ile (dry-run'da `out/spend.jsonl`). Adaptör seçimi: `OGRENMEN_FAKE=1` ya da anahtar eksikliği → sahte + uyarı. Sahteler deterministiktir (girdi hash'inden sabit çıktı) ki testler kararlı olsun.

```
pipelines/common/ogrenmen_common/
├── adapters/{llm.py, embed.py, transcribe.py, vision.py, storage.py, db.py, scholar.py}   # arayüzler + gerçekler
├── fakes.py          FakeLLM(script=...), FakeEmbedder(768), FakeTranscriber(fixture), FakeVision, LocalStorage(dir), JsonlDb(dir), FakeScholar(fixture)
├── scrub.py          names → [ÖĞRENCİ]/[EĞİTMEN]; telefon/e-posta/okul kalıpları
├── costs.py          models.json; estimate(model, in, out)
├── bkt.py            apply_observation'ın saf Python eşleniği (contracts/examples/bkt-cases.json ile test)
├── supabase.py       REST (service_role), rpc(), storage upload/delete; retry/backoff
└── cli.py            ortak argparse yardımcıları, --fake/--dry-run/--out
```

### 6.1 `pipelines/ders` — ders videosu analizi (pilot kritik)

CLI: `ogrenmen-ders analyze --video <path|url> --student <code> --instructor <profile_id> --recorded-at 2026-10-20T18:00 [--fake] [--dry-run --out out/]`, `ogrenmen-ders apply --report <id>` (yalnızca onaylı rapor için `apply_lesson_report` RPC), `ogrenmen-ders retention` (süresi dolan videoları Storage'dan siler, `video_deleted_at` zaten SQL'den işaretlidir).

Adımlar (`ders/steps/`):
1. `preprocess.py`: `ffmpeg -i in.mp4 -vn -ac 1 -ar 16000 audio.wav`; `ffmpeg -i in.mp4 -vf "select='gt(scene,0.30)',showinfo" -vsync vfr frames/%03d.jpg` → 20–40 kare hedefi: eşik 0.30'dan başlar, 40'tan çoksa 0.45, 20'den azsa 0.20'ye düşer, hâlâ azsa eşit aralıklı örnekleme. Süre `ffprobe`.
2. `transcribe.py`: `Transcriber` zinciri `models.json roles.transcribe`: Gemini Flash (ses dosyası doğrudan, konuşmacı etiketi istenir) → Groq Whisper turbo (etiketsiz; etiketleme 2b) → whisper.cpp (yerel, `WHISPER_CPP_BIN` varsa). 2b: etiket yoksa ucuz LLM'e 2 dakikalık pencerelerle "ÖĞRENCİ/EĞİTMEN" ataması. Çıktı `transcript.json`: `[{t:'00:14:32', speaker:'ÖĞRENCİ'|'EĞİTMEN', text}]`. **İsimler API'ye gitmez**: `scrub.names(transcript, names=[öğrenci adı, eğitmen adı])` metinde geçen adları etikete çevirir; Gemini'ye yalnız `public_code` gider.
3. `analyze.py`: `strong` rolü (Gemini 2.5 Pro → Claude Sonnet yedek), `lesson-analysis.schema.json` ile yapılandırılmış çıktı. Girdi: transkript + ≤ 40 kare + **mevcut profil** (`mastery`, açık `misconceptions`, önceki raporun `note_for_next_lesson`) + `skills.json` kazanım listesi (model yalnızca bu id'leri kullanabilir) + `misconception-tags.json`. Doğrulama: her `skill_id` listede, her kazanımda ≥ 1 kanıt; değilse 1 onarım, sonra `status='pending_review'` + `review_note`.
4. `persist.py`: `lesson_recordings` + `lesson_reports(status='pending_review')`; ses/transkript/kareler Storage'a; video yolu kaydedilir, `delete_video_after = +30 gün`. Rapor onaylanana kadar profile **yazılmaz**.
5. Panelde onay → `apply_lesson_report` (SQL). Düzeltmeler `corrections` olarak birleşir.

Test: `tests/fixtures/make_fixture.sh` ffmpeg `testsrc=duration=12:size=320x240` + `sine` ile `ders-12s.mp4` üretir (commit edilmez, test başında üretilir); `FakeTranscriber` `fixtures/transcript.json` döner; `FakeLLM` `fixtures/analysis.json` döner. Testler: sahne kare sayısı 1–40 arası, transkriptte ad yok (`"Elif"` fixture adı etiketlenmiş), çıktı şemaya uygun, dry-run `out/` içine 4 dosya yazıyor, maliyet kaydı 1 satır. Kabul: `pytest pipelines/ders`.

GitHub Actions `ders.yml`: `workflow_dispatch` (girdi: Storage'daki video yolu, öğrenci kodu) — kurucu videoyu Supabase Storage `lessons/` kovasına yükler, iş akışını elle tetikler; ya da kurucu makinesinde doğrudan CLI.

### 6.2 `pipelines/kulaklik_batch` — gece olgular, haftalık özet, panel metrikleri, proaktif mesajlar

CLI: `ogrenmen-kulaklik facts --date 2026-10-20`, `ogrenmen-kulaklik weekly --week 2026-10-13`, `ogrenmen-kulaklik alerts`, `ogrenmen-kulaklik proactive --for 2026-10-21`.

- `facts`: öğrenci başına günün `messages` (temizlenmiş) → `chat` rolü LLM, `memory-extraction.schema.json`; her olgu `source_message_ids` doğrulanır (gerçekten o günün mesajı mı), embedding (`embedding` rolü, 768), `memory_facts` insert; `requires_approval` → `approved_by=null`. Gemini Batch API ile (`--batch`, gece %50 indirim; sahte batch anında döner). Preferences güncellemesi (`explanation_style`, `modality`).
- `weekly`: olgular + `mastery` deltaları → `weekly-summary.schema.json`; `flags.morale_drop` → alert.
- `alerts` (LLM yok, saf SQL/Python): `unanswered` (escalations açık > `UNANSWERED_HOURS=6` → warning, > 24 → danger), `silent` (son mesaj > `SILENT_DAYS=3` → warning, > 7 → danger), `morale` (haftalık `flags.morale_drop` ya da son ders `indicators.morale='low'`), `deadline` (`memory_facts.kind='deadline'`, `occurs_at` ≤ 3 gün), `response` (eğitmen ortalama yanıt süresi > 12 saat). `instructor_alerts` upsert; çözülenler `resolved_at`.
- `proactive`: öğrenci başına günde en fazla 1 satır `proactive_messages` (DB'den: yarın `deadline` varsa "Yarın deneme var. Son çalıştığın konu paydalardı; 10 dakikalık bir tekrar ister misin?"; 3 gün sessizse hafif hatırlatma; `preferences.active_hour_start` saatine zamanlanır). Metin şablonlardan, LLM yok.

Test: `fixtures/messages-day.json` (30 mesaj, 3 öğrenci), FakeLLM sabit olgular; testler: her olgu kaynak id'si fixture'da var, embedding boyutu 768, `requires_approval` olgu `approved_by` null, alerts sıralaması Acil→Dikkat→Bilgi, günde 1 proaktif. Kabul: `pytest pipelines/kulaklik_batch`. Actions: `nightly.yml` 02:30 TRT `facts` + `alerts` + `proactive`; `weekly.yml` Pazartesi 05:00 `weekly`.

### 6.3 `pipelines/tablet` — soru ve şekil üretimi

CLI: `ogrenmen-tablet template --id tyt.mat.ucgen-kenar-aci-v1 --count 20 --seed 7` (sıfır LLM), `ogrenmen-tablet generate --skill tyt.mat.koklu-sayilar --count 5 [--batch]` (LLM), `ogrenmen-tablet render --question <id>`, `ogrenmen-tablet verify --question <id>`, `ogrenmen-tablet pdf --set <json> --out deneme.pdf`.

- Şablonlar `content/tyt-matematik/templates/*.py`: `generate(params, rng) -> (question_dict, answer_dict)`; ilk 3: `ucgen.py` (kenar-açı, Matplotlib), `fonksiyon_grafik.py` (parabol köşe/kesişim, Matplotlib), `sayi_dogrusu.py` (mutlak değer/eşitsizlik, SVG). Çeldiriciler şablonda etiketli üretilir (ör. `mutlak.negatif-cikti`).
- LLM üretimi: `question-generation.schema.json` yapılandırılmış çıktı; `answer` ayrılır.
- Render sandbox: alt süreç `python -I -S render_worker.py` (ayrı dizin, `resource.setrlimit` CPU 10 sn / RAM 512 MB, ağ yok: `unshare -n` varsa, yoksa `socket` modülü monkeypatch), yalnızca izinli modüller (`matplotlib.use('Agg')`, `numpy`, `schemdraw`, `graphviz`, `rdkit` kuruluysa). SVG/TikZ: TikZ için `tectonic` varsa, yoksa `pending`. Boyut kontrolü: 200 ≤ genişlik ≤ 1600 px, dosya 2 KB–2 MB, boş görüntü (varyans ~0) → başarısız. Çizim stili `paper` zemin, `navy` çizgi, `#0030a2` vurgu, Lexend 14 px+ (fonts/ dizininden `font_manager`).
- Vision denetimi: `vision` rolü (Gemini Flash ücretsiz), prompt: `stem_values` listesi + görüntü → `{ok, mismatches[]}`.
- SymPy: `numeric_answer` ifadesi `sympy.sympify` + şablon/LLM'in verdiği `check_expr` ile eşitlik (`simplify(a-b)==0`); çoktan seçmelide doğru şık metni de parse edilip karşılaştırılır.
- Akış: render → boyut → vision → sympy; biri geçmezse `attempts+1`, 2 yeniden deneme (LLM'e hata mesajıyla), sonra `status='pending_review'`, `figures.status='failed'`. Geçerse `status='pending_review'` (pilotta **her** LLM sorusu eğitmen onayından geçer; `--auto-approve-templates` yalnız şablon soruları `approved` yapar).
- PDF: LaTeX `exam` sınıfı şablonu (`tablet/latex/deneme.tex.j2`) + `tectonic` (varsa; yoksa `.tex` üretir ve testte bu kabul edilir).

Test: şablon 20 varyant hepsi şemaya uygun ve SymPy geçiyor; render sandbox'ta `import os; os.system` içeren kod reddediliyor (AST denetimi + izinli modül listesi); boş görüntü başarısız; FakeVision `mismatch` döndürünce `attempts` artıyor ve 3. denemede `pending_review`. Kabul: `pytest pipelines/tablet` (matplotlib, sympy, numpy pip ile kurulur; `rdkit`, `schemdraw`, `graphviz` isteğe bağlı, yoksa ilgili testler `skip`). Actions: `render.yml` `workflow_dispatch` + `nightly.yml` içinde `generate --batch` (Batch API).

### 6.4 `pipelines/kalem` — sınav modelleme

CLI: `ogrenmen-kalem ingest --course "Calculus I" --year 2024 --term guz --file vize.pdf --acquired-from "öğrenci arşivi"`, `ogrenmen-kalem cluster --course ...`, `ogrenmen-kalem align --course ... --syllabus izlence.pdf`, `ogrenmen-kalem plan --course ... --out plan.json`.

- `ingest`: PDF sayfaları → PNG (`pdftoppm` varsa, yoksa `pypdfium2`) → `vision` rolü OCR, çıktı `exam-item.schema.json` listesi; `exam_items.stem_private` yalnız DB (koordinatör RLS). 
- `cluster`: `embedding` rolü → kosinüs uzaklığı ile aglomeratif kümeleme (`scipy` yoksa saf numpy tek-bağ eşik 0.18); küme = şablon; `hits`, `years`.
- `align`: izlence başlıkları → embedding → kümelerle eşleme; eşleşmeyen başlıklar `uncovered_topics`.
- `plan`: `priority-plan.schema.json`; satır metni "Kısmi integrasyon · hesaplama · 5/5 yıl · ~20 puan · 5 kanıt"; her küme için Tablet `generate --from-cluster` ile özgün varyant (kaynak soru **asla** çıktıya girmez; test, çıktı JSON'unda `stem_private` metinlerinin alt dizisini arar ve bulursa düşer).

Test: `fixtures/exam-items.json` (3 yıl × 6 madde), FakeEmbedder ile kümeler kararlı; plan "tahmin/çıkacak/kesin" kelimeleri içermiyor (regex); Kabul: `pytest pipelines/kalem`. Actions: elle (`workflow_dispatch`).

### 6.5 `pipelines/kitap` — akademik araştırma

CLI: `ogrenmen-kitap research --query "..." --max-papers 8 --out out/` (öğrenci için `research` kotası Worker'da, burada `--request <id>`).

Akış: (1) `chat` rolü ile 3–5 sorgu genişletme; (2) `Scholar.openalex.search`, `Scholar.s2.search` (anahtar varsa) → birleştir, atıf/yıl/alaka puanı; (3) `Scholar.unpaywall.pdf(doi)` → PDF indir (≤ 8, her biri ≤ 15 MB), `pypdf` ile metin; (4) `chat` rolü Gemini Flash uzun bağlam (makaleler ≤ 800k token, aşarsa en alakalı ilk N) → `research-output.schema.json`; (5) **her DOI `Scholar.crossref.resolve(doi)`**; çözülmeyen atıf çıktıdan silinir ve sentezde ona işaret eden cümleler kaldırılır (cümle bazlı; sentez boş kalırsa `status='failed'`); (6) BibTeX/APA üretimi Crossref üst verisinden (LLM'den değil); isteğe bağlı `--zotero` (Zotero Web API, anahtar varsa).

Test: FakeScholar fixture'ında 1 sahte DOI (`10.9999/fake`) Crossref'te çözülmez → çıktıda yok ve sentezde ilgili cümle yok; BibTeX anahtarları benzersiz; `expanded_queries` 3–5. Kabul: `pytest pipelines/kitap`.

## 7. Eğitmen paneli (web)

Dizin: `apps/panel/`. Next.js 14.2 App Router, React 18.3, TypeScript, Supabase SSR (`@supabase/ssr`). Stil: tasarım sistemi `bundle.css` + sayfa düzeni için küçük bir `panel.css` (tokens.json'daki değerler CSS değişkeni olarak `:root`/`[data-theme=dark]`'a kopyalanır; `scripts/tokens-to-css.mjs` üretir). Yazı tipleri `packages/design-system/fonts/` → `public/fonts/` (CDN yok). `<html lang="tr">`.

### 7.1 Tasarım sistemi köprüsü — `packages/ds-react`

`bundle.js` bir IIFE'dir ve `window.React` bekler. `packages/ds-react/src/index.tsx`:

```ts
'use client';
import * as React from 'react';
import type * as DS from '@ogrenmen/design-system/components/index';
let loaded: Window['Ogrenmen'] | null = null;
export function loadDs(): Window['Ogrenmen'] {
  if (loaded) return loaded;
  (window as any).React = React;
  require('@ogrenmen/design-system/components/bundle.js');   // webpack IIFE'yi çalıştırır, window.Ogrenmen dolar
  loaded = window.Ogrenmen; return loaded;
}
export const StatTile: typeof DS.StatTile = (p) => React.createElement(loadDs().StatTile, p);
// ... her bileşen için aynı kalıp; SSR'da (typeof window === 'undefined') boş <span data-ds="StatTile"/> döner
```

`packages/design-system` npm workspace'e `"name": "@ogrenmen/design-system"` olmadan dahil edilemez; tasarım sistemi dizinine dokunulmayacağı için M10 `apps/panel/package.json`'da `"@ogrenmen/design-system": "file:../../packages/design-system"` kullanır ve `bundle.css` `next.config.js`'de `transpilePackages` gerekmeden `app/layout.tsx`'te `import '@ogrenmen/design-system/components/bundle.css'` ile yüklenir (Next, `node_modules` dışı CSS importunu destekler). Vitest + jsdom testinde `loadDs()` gerçek bundle'ı yükler ve `StatTile` render edilir — tasarım sistemi API'sine karşı gerçek bir test.

### 7.2 Yetki ve roller

- Giriş: Supabase Auth e-posta + şifre (magic link ikinci). `middleware.ts` oturumsuz isteği `/giris`'e yollar. `profiles.role` yoksa "Hesabın henüz bir role bağlanmadı; koordinatörle görüş" sayfası.
- Rol kuralları (`egitmen-paneli.md`): koordinatör her şeyi; branş eğitmeni yalnız kendi sohbetlerindeki öğrencileri (RLS zaten zorlar; UI buna güvenir, ek filtre uygulamaz); gözlemci yalnız okur (yazma düğmeleri gizli + RLS reddi).
- Öğrenci adları `student_private.full_name` → "Elif K." biçimine `formatStudentName()` ile; ham ad yalnız öğrenci detay sayfasının başlığında.

### 7.3 Sayfalar ve bileşenler

| Yol | İçerik | Bileşenler | Veri |
| --- | --- | --- | --- |
| `/` Genel bakış | Üstte 4 `StatTile`: cevapsız soru (Acil/danger if >0 ve >6 sa), sessiz öğrenci, yaklaşan teslim, ort. yanıt süresi (hedef 2 saat → Hedefte/Dikkat). Altında `AlertRow` listesi Acil→Dikkat→Bilgi, grup içinde en eski üstte; her satırda `Button secondary sm` "Cevapla" (escalation'a Telegram derin bağlantı `tg://`) / "Mesaj gönder". | StatTile, AlertRow, Button, Badge | `panel_overview_v` + `instructor_alerts` |
| `/ogrenciler/[id]` | Profil: `MasteryMeter` listesi (p, evidence, minEvidence=5, period), `MisconceptionItem` (status Açık/Çözüldü, `EvidenceQuote`), haftalık özet, son dersler | MasteryMeter, MisconceptionItem, EvidenceQuote, Badge, Notice | mastery, misconceptions, weekly_summaries |
| `/dersler` ve `/dersler/[id]` | Rapor onayı: `Notice warning` "Onay bekliyor"; kazanım başına MasteryMeter (önerilen değer, kanıt alıntısı `EvidenceQuote kind=lesson source="Ders 12 · 14:32"`), yanılgı kartları, ödev/sözler listesi; "Onayla" (`primary`, sayfada tek) → `update lesson_reports set status='approved'` + `rpc apply_lesson_report`; "Düzelt" (`secondary`) → düzenlenebilir alanlar, `corrections` jsonb | Notice, MasteryMeter, MisconceptionItem, EvidenceQuote, Button, TextField | lesson_reports |
| `/cevaplar` | Bot cevapları denetimi: `TutorMessage review={model, cost:"0,002 $", memory:n, flagged}`; "İşaretle" → `flagged=true, flag_note`; filtre: işaretliler, son 7 gün, öğrenci | TutorMessage, Badge, TextField | bot_responses |
| `/kuyruk` | Şekil/soru onay kuyruğu: `FigureFrame status=pending|failed` (src Storage imzalı URL, alt, source=tool); soru kökü + şıklar (`QuizOption` salt okunur, doğru şık **görünür**: eğitmen `answer_keys` okuyabilir); "Onayla" / "Yeniden üret" (Actions `render.yml` tetikleme bağlantısı; pilotta: `questions.status='draft'` + not) / "Reddet" | FigureFrame, QuizOption, Button, Notice | review_queue_v, questions, figures, answer_keys |
| `/onaylar` | Onay yönetimi: öğrenci listesi, `consents` durumu (KVKK, veli, grup), "Veli onayı alındı" işaretleme (`evidence` metni zorunlu), veli kodu üretme, `is_minor` değiştirme; `Notice legal` metni belgenin güncel sürümünü gösterir | Notice, Badge, Button, TextField | students, consents |
| `/ayarlar` (koordinatör) | Kota limitleri, harcama tavanları, eşikler (`UNANSWERED_HOURS` vb. `system_flags`), roller | TextField, Button | quota_limits, spend_caps, system_flags |

Grafik yalnız `/` altında "Yanıt süresi (14 gün)" tek seri çizgi (SVG, `primary` 2 px, ızgara `line`); tablo görünümü yanında (`<details>`). Başka grafik yok.

### 7.4 Veri erişimi

`lib/data/types.ts`: `PanelData` arayüzü (`overview()`, `alerts()`, `student(id)`, `lessonReports(status)`, `approveReport(id, corrections?)`, `botResponses(filter)`, `flagResponse(id, note)`, `reviewQueue()`, `approveQuestion(id)`, `rejectQuestion(id, note)`, `consents(studentId)`, `markGuardianConsent(studentId, evidence)` ...). İki uygulama: `lib/data/supabase.ts` (sunucu bileşenlerinde `createServerClient`, RLS'ye güvenir; yazımlar Server Actions ile) ve `lib/data/mock.ts` (bellek içi, `fixtures/*.json`'dan; `DATA_SOURCE=mock` iken `middleware` sahte oturum çerezi koyar ve `getData()` mock döner). Seçim tek yerde: `lib/data/index.ts`.

### 7.5 Yerel çalıştırma ve test

```
DATA_SOURCE=mock npm -w apps/panel run dev          # http://localhost:3000, sahte koordinatör oturumu
npm -w apps/panel run typecheck
npm -w apps/panel test                               # vitest + @testing-library/react + jsdom: formatStudentName, alert sıralama, ds-react gerçek bundle render,
                                                     # MasteryMeter evidence<5 iken yüzde yok (DS davranışı doğrulanır), "primary" düğme sayfada en fazla 1 (statik analiz testi)
DATA_SOURCE=mock npm -w apps/panel run build         # next build (ağ gerektirmez; next/font kullanılmaz)
```

Deploy: Cloudflare Pages (`@cloudflare/next-on-pages`) ya da Vercel; pilotta kurucu makinesinde `next start` da yeter. Ortam: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (RLS ile güvenli), `DATA_SOURCE`.

## 8. CI/CD ve operasyon

`.github/workflows/` (M13 yazar):

| Dosya | Tetik | İş |
| --- | --- | --- |
| `ci.yml` | push, PR | `node 22` + `python 3.13` matrisi: `npm ci`, `npm run typecheck --workspaces`, `npm test --workspaces`, `npm -w apps/worker run build`, `DATA_SOURCE=mock npm -w apps/panel run build`; `pip install -e` tüm pipeline paketleri + `ruff check` + `pytest pipelines packages/contracts/python content`; `sqlfluff lint supabase/migrations content/dist`; `services: postgres (pgvector/pgvector:pg16)` ile `supabase/scripts/db-test.sh` (CI'da DB var; yerelde yoksa atlanır) |
| `nightly.yml` | `30 23 * * *` UTC (02:30 TRT) | `ogrenmen-kulaklik facts --date <yesterday> --batch`, `alerts`, `proactive --for <today>`; `ogrenmen-tablet generate --batch` (varsa `content/queue.json` istekleri); `purge_expired` RPC (pg_cron yedeği) + `ogrenmen-ders retention` (Storage silme); harcama özetini `ALERT_CHAT_ID`'ye gönder |
| `weekly.yml` | Pazartesi `0 2 * * 1` UTC | `ogrenmen-kulaklik weekly`; işaretli cevap örneklemi (`bot_responses.flagged` + rastgele 20) `review/<week>.md` olarak artifact |
| `keepalive.yml` | `0 9 * * *` UTC | `curl -f "$SUPABASE_URL/rest/v1/quota_limits?select=kind&limit=1" -H "apikey: $SUPABASE_ANON_KEY"` (RLS: anon'a `quota_limits` SELECT özel olarak verilir — tek istisna, veri hassas değil) |
| `render.yml` | `workflow_dispatch` (question_id) | `ogrenmen-tablet render` + `verify` |
| `ders.yml` | `workflow_dispatch` (storage_path, student_code, instructor_id) | `ogrenmen-ders analyze --video supabase://lessons/<path>` |
| `deploy-worker.yml` | push main, `apps/worker/**` | `wrangler deploy` (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`); ardından `scripts/set-webhook.sh` |
| `deploy-panel.yml` | push main, `apps/panel/**` | `next build` + Pages deploy (ya da Vercel entegrasyonu; pilotta isteğe bağlı) |

GitHub Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY_PAID/FREE`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` (isteğe bağlı), `TELEGRAM_BOT_TOKEN` (yalnız bildirim için), `ALERT_CHAT_ID`, `CLOUDFLARE_*`, `UNPAYWALL_EMAIL`, `S2_API_KEY`. Hiçbir anahtar depoya girmez; `gitleaks` CI adımı (`gitleaks/gitleaks-action`) sızıntıyı düşürür.

Deploy adımları (ilk kurulum, `README.md` "Pilot kurulumu"): (1) Supabase projesi → `supabase db push` ya da `psql -f` ile migrasyonlar sırayla, `supabase/seed/*.sql`, `content/.../seed.py` (service_role); JWT secret'ı al. (2) BotFather: bot, `/setprivacy Disable`, profil fotoğrafı maskot. (3) `wrangler secret put` × 9, `wrangler deploy`, `set-webhook.sh`. (4) Panel: ilk koordinatör kullanıcısını Supabase Auth'ta aç, `profiles` satırını `psql` ile ekle. (5) Gemini ücretli projede 5 $ ön yükleme + Google Cloud bütçe uyarısı (3 $ / 20 $); Groq, OpenRouter anahtarları.

Maliyet uyarı mekanizması (üç katman): (a) uygulama içi `spend_ledger` + `spend_caps` → Worker saatlik cron ve her istek öncesi `SpendGuard`; eşikte `ALERT_CHAT_ID`'ye mesaj, tavanda `paid_providers_enabled=false` (ücretsiz katmanlar çalışmayı sürdürür); (b) `nightly.yml` günlük özet mesajı ("Dün 0,41 $: chat 0,30, embedding 0, ders 0,11"); (c) sağlayıcı tarafı: Google Cloud bütçe uyarısı ve ön ödemeli bakiye; OpenRouter'da kredi 0 (yalnız :free). `scripts/spend-report.sh` aynı sorguyu elle çalıştırır.

## 9. Güvenlik ve KVKK

Mekanizmalar (her biri bir testle bağlı):

1. **Rastgele kimlik**: API'ye giden her bağlamda öğrenci `students.id`/`public_code` ile temsil edilir; `student_private` bot_runtime'a kapalı (grant yok; `tests/02_rls.sql`). Ders transkriptinde `ÖĞRENCİ/EĞİTMEN`; `ders` testinde fixture adı çıktıda aranır ve bulunursa düşer.
2. **PII temizleme (LLM öncesi)**: `scrub.ts`/`scrub.py` — bilinen adlar (`student_private.full_name` parçaları, `profiles.full_name`, `chat_members.handle`), `@kullanıcı`, telefon (`(\+90|0)?5\d{9}`), e-posta, "… Lisesi/Okulu/Koleji" kalıbı → `[ÖĞRENCİ]`, `[EĞİTMEN]`, `[KİŞİ]`, `[OKUL]`. `messages.text_scrubbed` **yalnızca** temizlenmiş metni saklar; ham metin saklanmaz (Telegram'da zaten durur). `LlmRouter` ikinci savunma hattı (§5.5).
3. **Saklama**: `purge_expired()` (pg_cron + Worker cron + nightly yedeği, idempotent); süreler tek kaynaktan; `supabase/tests/03_retention.sql` 91 gün önceye tarihli mesaj ekleyip fonksiyon sonrası yokluğunu doğrular. Ham video 30 gün; silinince öğrenci ve veliye proaktif bildirim (`proactive_messages kind='other'` — metin: "Ders kaydının videosu silindi; transkripti saklıyoruz").
4. **Cevap anahtarı izolasyonu**: ayrı tablo, bot_runtime'a grant yok, LLM'in yazdığı hiçbir alan anahtar tablosuna doğrudan gitmez (Tablet: SymPy → service_role), eğitmen yazımı `set_answer_key()` ile; Worker paketinde `answer-key.schema.json` importu lint ile yasak; teşhis geri bildirim promptu doğru şıkkı **almaz**, yalnızca `is_correct` ve `text_student` alır (test: prompt JSON'unda `correct_letter` anahtarı yok).
5. **RLS + GRANT birlikte**: `0013_rls.sql` tek dosya, `tests/02_rls.sql` her tablo × rol için en az bir olumlu ve bir olumsuz denetim; CI Postgres servisiyle koşar.
6. **bot_runtime JWT**: Worker HS256 ile kendi imzalar (`SUPABASE_JWT_SECRET`), `exp` 60 dk; service_role anahtarı Worker'da **yoktur**. Supabase'in JWT secret'ı döndürülürse (rotation) yalnız Worker gizi güncellenir.
7. **Webhook**: yol gizi + başlık gizi; Telegram IP aralığı kontrolü yapılmaz (Cloudflare arkasında güvenilmez), gizler yeter.
8. **Model anahtarları** yalnızca Worker gizleri ve GitHub Secrets'ta; panel yalnız anon anahtar + RLS.
9. **Veri silme hakkı**: `/sil` komutu ve panelden silme → `status='deleted'`, 7 gün bekleme, `purge_deleted_students()`; Storage nesneleri nightly'de silinir; işlem `retention_runs`'a yazılır.
10. **Günlükler**: `bot_responses.prompt` temizlenmiş metin içerir, 90 gün saklanır; Cloudflare `console.log`'a mesaj içeriği yazılmaz (yalnız id'ler) — lint kuralı `no-console` istisnası sadece `log.ts`.

Hazırlanacak belgeler (`docs/hukuk/`, M12; her dosyanın başında "TASLAK — HUKUKİ İNCELEME GEREKLİ, yürürlüğe girmeden avukat onayı alınır" ve `doc_version: v1-2026-10`):

- `aydinlatma-metni.md` — KVKK m.10 aydınlatma: veri sorumlusu (easy), işlenen veriler (Telegram kimliği, mesajlar, ders ses kaydı/transkript, ustalık verileri), amaçlar, hukuki sebep, aktarım (Google/Groq/Cloudflare/OpenRouter — yurt dışı aktarım açık rıza gerektirir, ücretli katmanda eğitimde kullanılmaz notu), saklama süreleri (90/180/30 gün — DB varsayılanlarıyla aynı; `tests/04_docs_consistency.test.ts` sayıları karşılaştırır), haklar (m.11), başvuru yolu, `/sil`.
- `veli-onay-formu.md` — 18 yaş altı için veli/vasi açık rızası; çocuğun anlayacağı dilde "Verilerin nasıl kullanılıyor?" paragrafı; ıslak imza/e-posta/tek kullanımlık Telegram kodu seçenekleri; vazgeçme yolu.
- `grup-kayit-bildirimi.md` — gruba sabitlenen metin ve uzun sürümü; "Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve 90 gün sonra silinir."; ders kaydı öncesi sözlü/yazılı bildirim şablonu.
- `saklama-politikasi.md` — tablo: veri türü → süre → silme mekanizması → istisna (işaretli cevaplar, hukuki yükümlülük).
- `telif-ve-etik.md` — ÖSYM/eğitmen sorularının yalnız analiz için kullanımı, yayınlanmaması; meşru edinim beyanı (`exam_sources.acquired_from`).

## 10. İlk içerik

### 10.1 TYT Matematik kazanım dilimi (`content/tyt-matematik/skills.json`, `curriculum_versions.id='tyt-mat-2026'`)

Pilot dilimi "Temel Matematik — sayılar ve cebir temeli": TYT'nin yaklaşık 12–14 sorusunu kapsar ve ön koşul zinciri nettir.

| id | ad | ön koşullar |
| --- | --- | --- |
| `tyt.mat.temel-kavramlar` | Temel kavramlar: tam sayılar, işlem önceliği, işaret | — |
| `tyt.mat.sayi-basamaklari` | Sayı basamakları ve çözümleme | temel-kavramlar |
| `tyt.mat.bolunebilme` | Bölünebilme kuralları, kalan | temel-kavramlar |
| `tyt.mat.ebob-ekok` | EBOB–EKOK ve problemleri | bolunebilme |
| `tyt.mat.rasyonel-sayilar` | Rasyonel sayılar, kesir işlemleri, sıralama | temel-kavramlar |
| `tyt.mat.ondalik-sayilar` | Ondalık gösterim, devirli ondalık | rasyonel-sayilar |
| `tyt.mat.basit-esitsizlikler` | Birinci dereceden eşitsizlikler | temel-kavramlar |
| `tyt.mat.mutlak-deger` | Mutlak değer: tanım, denklem, eşitsizlik | temel-kavramlar, basit-esitsizlikler |
| `tyt.mat.uslu-sayilar` | Üslü ifadeler ve özellikleri | temel-kavramlar |
| `tyt.mat.koklu-sayilar` | Köklü ifadeler, kök içine alma, eşlenik | uslu-sayilar |
| `tyt.mat.carpanlara-ayirma` | Çarpanlara ayırma, özdeşlikler | uslu-sayilar |
| `tyt.mat.oran-oranti` | Oran–orantı, doğru/ters orantı | rasyonel-sayilar |
| `tyt.mat.denklem-cozme` | Birinci dereceden denklemler ve sistemler | temel-kavramlar, rasyonel-sayilar |
| `tyt.mat.problemler-sayi` | Sayı ve kesir problemleri | denklem-cozme, rasyonel-sayilar |

`prerequisites.json` yukarıdaki kenarlardır (DAG; `validate.py` döngü denetimi). Sonraki dilimler (yüzde/kâr-zarar, hareket, kümeler, fonksiyon, geometri) aynı dosya biçimiyle eklenir; `curriculum_version_id` değişmez, yeni program yılı gelirse `tyt-mat-2027` açılır ve eski `mastery` satırları dönemde kalır.

### 10.2 Yanılgı etiketleri (`misconception-tags.json`, 22 etiket; örnekler)

| tag | skill | implies_prerequisite | eğitmen metni |
| --- | --- | --- | --- |
| `temel.isaret-negatif-carpim` | temel-kavramlar | — | Negatif × negatif sonucunu negatif alıyor. |
| `temel.islem-onceligi` | temel-kavramlar | — | Çarpma/bölmeden önce toplama yapıyor. |
| `bolunebilme.3-ile-9-karistirma` | bolunebilme | — | 9 ile bölünebilmeyi 3 kuralıyla kontrol ediyor. |
| `ebob-ekok.karistirma` | ebob-ekok | bolunebilme | EBOB ile EKOK'u yer değiştiriyor. |
| `rasyonel.pay-payda-ayri-toplama` | rasyonel-sayilar | — | Payları ve paydaları ayrı ayrı topluyor. |
| `rasyonel.negatif-kesir-siralama` | rasyonel-sayilar | temel-kavramlar | Negatif kesirleri mutlak değerlerine göre sıralıyor. |
| `ondalik.virgul-kaydirma` | ondalik-sayilar | rasyonel-sayilar | Çarpmada virgülü yanlış sayıda kaydırıyor. |
| `esitsizlik.negatifle-carpinca-yon` | basit-esitsizlikler | — | Negatifle çarparken eşitsizliğin yönünü çevirmiyor. |
| `mutlak.negatif-cikti` | mutlak-deger | — | Mutlak değer sonucunu negatif kabul ediyor. |
| `mutlak.tek-durum` | mutlak-deger | basit-esitsizlikler | |x|=a denkleminde yalnızca pozitif durumu alıyor. |
| `uslu.taban-us-carpma` | uslu-sayilar | — | a^m · a^n için üsleri çarpıyor. |
| `uslu.negatif-us-isaret` | uslu-sayilar | temel-kavramlar | Negatif üssü sonucun işareti sanıyor. |
| `koklu.toplama-kok-icinde` | koklu-sayilar | — | √a + √b'yi √(a+b) olarak topluyor. |
| `koklu.kok-icine-alma-kare` | koklu-sayilar | uslu-sayilar | Katsayıyı kök içine alırken karesini almıyor. |
| `carpan.iki-kare-farki-eksik` | carpanlara-ayirma | — | a²−b²'yi (a−b)² ile karıştırıyor. |
| `carpan.tam-kare-orta-terim` | carpanlara-ayirma | uslu-sayilar | (a+b)²'de 2ab terimini unutuyor. |
| `oran.ters-oran` | oran-oranti | rasyonel-sayilar | Ters orantıyı doğru orantı gibi kuruyor. |
| `denklem.tarafa-gecirme-isaret` | denklem-cozme | temel-kavramlar | Terimi karşı tarafa işaret değiştirmeden geçiriyor. |
| `denklem.paydayla-carpma-eksik` | denklem-cozme | rasyonel-sayilar | Paydadan kurtarırken tüm terimleri çarpmıyor. |
| `problem.kesir-tam-karistirma` | problemler-sayi | rasyonel-sayilar | Kesrin "tamamı" ile "kalanı"nı karıştırıyor. |
| `problem.ardisik-sayi-kurulum` | problemler-sayi | denklem-cozme | Ardışık sayıları n, n+1 yerine n, 2n alıyor. |
| `basamak.cozumleme-katsayi` | sayi-basamaklari | temel-kavramlar | Çözümlemede basamak değerini yanlış katsayıyla yazıyor. |

Her etiket `text_student` (sen dili) ile de gelir; `validate.py` her yanlış şıkkın etiketinin bu listede olduğunu ve `implies_prerequisite_id`'nin gerçekten `prerequisites.json`'da ön koşul olduğunu denetler.

### 10.3 Teşhis testi (`diagnostic/questions.json`, 18 soru; `answer-keys.json` ayrı)

Strateji: 14 kazanımın her biri en az 1 soru, ön koşul zincirinin başındaki 4 kazanım (temel-kavramlar, rasyonel, üslü, denklem) 2 soru; toplam 18. Zorluk 2–3 (TYT orta). Her sorunun 5 şıkkı: 1 doğru, **en az 3 çeldirici etiketli** (biri "hesap hatası" için etiketsiz olabilir). Sıra: kolaydan zora, kazanımlar karışık (aynı kazanımın iki sorusu ardışık değil). Şekilli soru yok (pilotta Telegram'da metin; şekilli sorular Tablet şablonlarından pratik modunda gelir). Süre sınırı yok; yarım kalırsa `/test` kaldığı yerden sürer (`current_index`).

Örnek madde (questions.json öğesi; anahtar ayrı dosyada `{"question_id":"...","correct_letter":"C","numeric_answer":"7/8","solution":"Paydaları 8'de eşitle: 6/8 + 1/8 = 7/8."}`):

```json
{ "id": "7f3c…", "curriculum_version_id": "tyt-mat-2026", "skill_ids": ["tyt.mat.rasyonel-sayilar"],
  "stem": "`3/4 + 1/8` işleminin sonucu kaçtır?", "stem_values": {}, "figure": null, "difficulty": 2, "origin": "authored",
  "options": [
    { "letter": "A", "text": "4/12", "misconception_tag": "rasyonel.pay-payda-ayri-toplama" },
    { "letter": "B", "text": "4/8",  "misconception_tag": "rasyonel.pay-payda-ayri-toplama" },
    { "letter": "C", "text": "7/8",  "misconception_tag": null },
    { "letter": "D", "text": "3/32", "misconception_tag": null },
    { "letter": "E", "text": "1",    "misconception_tag": "denklem.paydayla-carpma-eksik" } ],
  "verification": { "render": null, "size": null, "vision": null, "sympy": { "ok": true, "expr": "3/4+1/8", "expected": "7/8" }, "attempts": 0 },
  "status": "approved" }
```

Akış (Worker `flows/diagnostic.ts`): soru metni + şıklar gövdede, A·B·C·D·E düğmeleri tek satır (Telegram 5 düğme sığar; 20 karakter kuralı şık harfi için geçerli); cevap → `grade_answer(..., 'diagnostic', session)` → "✓ Doğru" ya da "✕ Tekrar dene — Paylar ve paydalar ayrı ayrı toplanmaz." (ikinci deneme yok, sonraki soru); 18. sorudan sonra özet DB'den: her kazanım için `p` ve `evidence_count`; 1–2 soruluk kazanımlarda yüzde değil "başlangıç" ifadesi (eşik 5 için `evidence_count < 5` → yüzde yok, `guven-ve-seffaflik.md`); bu yüzden özet metni "En güçlü görünen: rasyonel sayılar. Birlikte başlayacağımız yer: üslü sayılar (2 soruda da takıldın)." biçiminde, LLM `prompts/diagnostic.ts` ile yalnızca bu DB özetini anlatır. `summary` jsonb `diagnostic_sessions`'a yazılır.

Teşhis testi sonrası sonuç kalibrasyonu (pilot ölçütü "teşhis örtüşmesi"): 2 hafta sonra aynı kazanımlardan pratik sorularla `p` karşılaştırması; `pipelines/kulaklik_batch alerts` içinde `diagnostic_agreement` metriği (koordinatör panelinde sayı).

### 10.4 Eğitmen incelemesinin veride işaretlenmesi

- `questions.status`: `authored` → `approved` (kurucu/eğitmen yazdı), `llm`/`template` → `pending_review` (pilotta hepsi); onay `reviewed_by/at`.
- `figures.status`: `pending` → `verified` ancak vision + boyut geçtiyse **ve** eğitmen onayladıysa; `failed` → kuyruk.
- `misconceptions.status`: `pending_review` (evidence_count < 3) → `open` (gece işi) → `resolved` (yeni kanıt + eğitmen; trigger `resolved_by not null` zorunlu).
- `lesson_reports.status`: `pending_review` → `approved|corrected|rejected`; profile yalnız `apply_lesson_report` ile.
- `bot_responses.flagged` + `flag_note`; haftalık örneklem `weekly.yml`.
- `memory_facts.approved_by`: `instructor_statement` türü onaysız kullanılmaz.
- Hepsi `review_queue_v`'de tek listede.

## 11. Paralel inşa planı

Kurallar: her modül yalnız kendi dizinine yazar; modüller arası sözleşme bu belgedir (tablo adları §3, şema adları §4, CLI bayrakları §6). Bir modül başka modülün dosyasını okuyabilir ama değiştiremez; eksik bağımlılık yerelde kendi `test/fixtures` kopyasıyla ikame edilir. 2 ajan paralel çalışır; dalgalar aşağıda. Kabul komutları `git clone` sonrası yalnızca `npm ci` / `pip install -e` ile, hesapsız ve ağ anahtarı olmadan geçmelidir. Kök `package.json` M13'e kadar yoksa, modüller `npm --prefix <dir>` ile kendi `package.json`'larında çalışır; M13 workspaces'e alır.

| id | dizin (münhasır) | bağımlılık | teslimat | kabul (yerel, hesapsız) |
| --- | --- | --- | --- | --- |
| **M01 contracts** | `packages/contracts/` | — | 11 şema + `common`, `models.json`, `examples/`, TS doğrulayıcılar + üretilen tipler, Python paketi | `cd packages/contracts && npm ci && npm run build && npm test` ; `pip install -e packages/contracts/python && pytest packages/contracts/python -q` |
| **M02 db** | `supabase/` | M01 (örnek JSON'lar) | 14 migrasyon, roller, RLS, RPC'ler, saklama, seed/00-01, `tests/*.sql`, `scripts/{lint,db-test}.sh` | `pip install sqlfluff && supabase/scripts/lint.sh` ; `supabase/scripts/db-test.sh` (DB yoksa `SKIPPED` ile 0; `DATABASE_URL` varsa tüm testler) |
| **M03 worker** | `apps/worker/` | M01 | §5'in tamamı, FakeTelegram/FakeDb/FakeProvider, 12 e2e senaryo | `cd apps/worker && npm ci && npm run typecheck && npm test && npm run build` |
| **M04 content** | `content/tyt-matematik/` | M01 | 14 kazanım, 22 etiket, 18 soru + anahtarlar, 3 şablon, `validate.py`, `seed.py` | `pip install -e packages/contracts/python && python content/tyt-matematik/scripts/validate.py && python content/tyt-matematik/scripts/seed.py --dry-run --out content/dist/seed.sql && sqlfluff lint content/dist/seed.sql` ; `pytest content/tyt-matematik/templates -q` |
| **M05 common** | `pipelines/common/` | M01 | adaptörler + sahteler, scrub, costs, bkt, supabase istemcisi, cli | `pip install -e "pipelines/common[dev]" && pytest pipelines/common -q && ruff check pipelines/common` |
| **M06 ders** | `pipelines/ders/` | M01, M05 | CLI analyze/apply/retention, ffmpeg adımları, fixture üretici, 8 test | `pip install -e "pipelines/ders[dev]" && pytest pipelines/ders -q` (ffmpeg gerekir; var) ; `ogrenmen-ders analyze --video pipelines/ders/tests/fixtures/ders-12s.mp4 --student 0123456789ab --fake --dry-run --out /tmp/ders-out && test -f /tmp/ders-out/lesson_analysis.json` |
| **M07 kulaklik_batch** | `pipelines/kulaklik_batch/` | M01, M05 | facts/weekly/alerts/proactive CLI'ları | `pip install -e "pipelines/kulaklik_batch[dev]" && pytest pipelines/kulaklik_batch -q && ogrenmen-kulaklik facts --date 2026-10-20 --fake --dry-run --out /tmp/kb-out && test -f /tmp/kb-out/memory_facts.json` |
| **M08 tablet** | `pipelines/tablet/` | M01, M05 (şablonlar M04'ten okunur; yoksa `tests/fixtures/template_sample.py`) | template/generate/render/verify/pdf, sandbox, SymPy, vision | `pip install -e "pipelines/tablet[dev]" && pytest pipelines/tablet -q && ogrenmen-tablet template --id sample --count 5 --seed 1 --fake --dry-run --out /tmp/tb-out && ls /tmp/tb-out/*.png` |
| **M09 kalem** | `pipelines/kalem/` | M01, M05 | ingest/cluster/align/plan | `pip install -e "pipelines/kalem[dev]" && pytest pipelines/kalem -q && ogrenmen-kalem plan --course demo --fake --dry-run --out /tmp/kl-out && ! grep -Ei "tahmin|çıkacak|kesin" /tmp/kl-out/priority_plan.json` |
| **M10 panel** | `apps/panel/`, `packages/ds-react/` | M01 | Next 14 panel, 7 sayfa, mock/supabase veri katmanı, ds-react köprüsü | `cd packages/ds-react && npm ci && npm test` ; `cd apps/panel && npm ci && npm run typecheck && npm test && DATA_SOURCE=mock npm run build` |
| **M11 kitap** | `pipelines/kitap/` | M01, M05 | research CLI, Crossref doğrulama, BibTeX/APA | `pip install -e "pipelines/kitap[dev]" && pytest pipelines/kitap -q && ogrenmen-kitap research --query "demo" --fake --dry-run --out /tmp/kt-out && ! grep -q "10.9999/fake" /tmp/kt-out/research_output.json` |
| **M12 hukuk** | `docs/hukuk/`, `docs/adr/` | — | 5 taslak belge + ADR-0001 (BKT), ADR-0002 (bot_runtime rolü), ADR-0003 (Next 14/React 18) | `test $(grep -l "HUKUKİ İNCELEME GEREKLİ" docs/hukuk/*.md \| wc -l) -eq 5 && grep -q "90 gün" docs/hukuk/grup-kayit-bildirimi.md` |
| **M13 integration** | kök: `package.json`, `README.md`, `.gitignore`, `.nvmrc`, `.github/`, `scripts/` | hepsi | workspaces, CI/CD iş akışları, `check-all.sh`, `dev-all.sh`, `set-webhook.sh`, `spend-report.sh`, docs tutarlılık testi | `npm ci && npm run typecheck --workspaces --if-present && npm test --workspaces --if-present && scripts/check-all.sh` ; `act`/`actionlint` ile `actionlint .github/workflows/*.yml` |

Dalgalar (2 ajan): **D1** M01 ‖ M12 → **D2** M02 ‖ M03 → **D3** M04 ‖ M05 → **D4** M06 ‖ M07 → **D5** M10 ‖ M08 → **D6** M09 ‖ M11 → **D7** M13. Pilot için zorunlu çekirdek D1–D4 + M10 (hafta 1–3); D5'teki M08 ve D6 hafta 4–6'ya kayabilir. M03 ve M10, M02'nin tablolarını bu belgedeki DDL'den okur (`Db` arayüzü ve `PanelData` arayüzü Fake/Mock ile test edilir; canlı DB entegrasyonu M13'te `db-test.sh` + `wrangler dev` dumanı).

## 12. Açık sorular ve varsayımlar

| # | Soru | Varsayılan karar (uygulayıcı bloke olmaz) |
| --- | --- | --- |
| 1 | BKT mi Elo mu? | **BKT** (ADR-0001), parametreler `skills.bkt_params`; Elo istenirse `apply_observation` tek fonksiyon, değişim yerel. |
| 2 | pgvector boyutu | **768** (Gemini embedding `output_dimensionality=768`); CF bge-m3 (1024) pilotta kullanılmaz. |
| 3 | Gemini model adları | `models.json`'daki `gemini-2.5-*`; `MODEL_<ROLE>` ortam değişkeni ezer; yayın gününde AI Studio'dan doğrulanır. |
| 4 | Worker'ın DB rolü | **Özel `bot_runtime` Postgres rolü + Worker'ın imzaladığı JWT** (ADR-0002); service_role Worker'da yok. |
| 5 | Telegram çerçevesi | Yok; `fetch` + kendi küçük yönlendirici. |
| 6 | Öğrenci yaşı bilinmiyorsa | `is_minor=true` varsayılır; veli onayı olmadan LLM çağrısı yok; eğitmen panelden düzeltir. |
| 7 | Saklama süreleri | mesaj/bot cevabı 90 gün, olgu 180, ham video 30, haftalık özet ve mastery dönem boyunca; silinen öğrenci 7 gün sonra kalıcı. |
| 8 | Kota değerleri | message 25, test 5, research 2, figure 3; uyarı 5 kala; TRT gün sınırı 00:00. |
| 9 | Harcama tavanları | günlük uyarı 1,50 $ / tavan 3 $; aylık 20 $ / 30 $; tavanda ücretli sağlayıcı kapanır, ücretsizler sürer. |
| 10 | Sokratik mod kalıcılığı | `/mod` kalıcı (preferences), `/cevap` tek soruluk; sistem asla kendiliğinden doğrudan moda geçmez. |
| 11 | Grupta hangi mesajlara cevap | Yalnız etiket/yanıt/`@hoca`; diğerleri yalnız günlüğe. |
| 12 | Eğitmen yanıt süresi ölçümü | Yükseltme mesajına eğitmenin `reply_to` ile yanıtı; yanıtsız 6 sa Dikkat, 24 sa Acil; sessizlik 3/7 gün. |
| 13 | Ders videosu kaynağı | Zoom/Meet mp4'ü kurucu Supabase Storage `lessons/`'a yükler; iş `ders.yml` ile elle ya da yerel CLI. Diarizasyon Gemini ses; yoksa LLM etiketleme. |
| 14 | Pilotta LLM soruları öğrenciye gider mi | Hayır; yalnız `authored` ve onaylı `template` soruları; LLM soruları onay kuyruğunda. |
| 15 | Panel barındırma | Pilotta kurucu makinesi/`next start` ya da Cloudflare Pages; Vercel isteğe bağlı. |
| 16 | Next sürümü | **14.2 + React 18.3** (tasarım sistemi bundle'ı React 18 bekler; ADR-0003). |
| 17 | Supabase CLI gerekliliği | Gerekmez; migrasyonlar `psql -f` ile de uygulanır (`scripts/db-test.sh` böyle yapar). |
| 18 | pg_cron yoksa | Worker cron + nightly Actions aynı `purge_expired()`'ı çağırır (idempotent). |
| 19 | Embedding sahtesi | Deterministik hash tabanlı 768 boyutlu vektör; benzerlik testleri yalnızca "aynı metin → aynı vektör" ve boyut doğruluğu üzerinden. |
| 20 | Ücretsiz katman veri kullanımı | Öğrenci metni içeren `chat` rolünde `gemini_free` yalnız yedek ve her zaman temizlenmiş metinle; aydınlatma metni bunu yazar. |
| 21 | Teşhis sonucu eşiği | 1–2 soruluk kazanımda yüzde yok (eşik 5); özet "başlangıç" ifadesi kullanır. |
| 22 | Dil | Kullanıcı metni ve belgeler Türkçe; kod tanımlayıcıları İngilizce; SQL yorumları Türkçe. |
| 23 | Discord | Pilot dışı; `telegram/api.ts` arayüzü `ChatPlatform` olarak adlandırılır ki ikinci uygulama eklenebilsin. |
| 24 | Zotero, PubMed, DergiPark, YÖK Tez | `Scholar` arayüzünde yer tutucu uygulama yok; yalnızca OpenAlex, S2, Crossref, Unpaywall, arXiv. Eklenecekse yeni adaptör. |
| 25 | Sesli giriş/çıkış | Pilot dışı; Telegram `voice` ekleri günlüğe yazılır, bot "Şimdilik yazılı mesajları anlayabiliyorum." der. |
