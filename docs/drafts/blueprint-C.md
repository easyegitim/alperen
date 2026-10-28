# Öğrenmen — Uygulama Planı C ("maliyet ve operasyon önce")

Tarih: 19 Ekim 2026 · Kaynak: `docs/plan.md` (kapsamın tek doğruluk kaynağı) ve `packages/design-system/` (marka kitabı, `telegram.md`, `egitmen-paneli.md`, `guven-ve-seffaflik.md`).

Bu plan aynı sistemi **işletme maliyeti ve işletilebilirlik** merceğinden kurar. İlkeler:

1. **Önce veritabanı, sonra LLM.** Komut, şık cevabı, kota/ilerleme sorgusu, teşhis geri bildirimi, proaktif hatırlatma: hiçbiri model çağırmaz. Model yalnızca serbest metinli öğretmen sohbeti, gece olgu çıkarımı, soru/şekil üretimi, ders analizi ve araştırma sentezi için çağrılır.
2. **Her çağrının bir fiyatı ve bir kaydı vardır.** `bot_responses` ve `llm_calls` tabloları olmadan hiçbir model çağrısı yapılamaz; yönlendirici (router) kaydı yazamazsa cevabı da göndermez.
3. **Harcama tavanı koddadır, faturada değil.** Günlük ve aylık tavan veritabanında (`runtime_flags`, `spend_ledger`), saatlik denetleyici cron ile; tavan aşılınca sistem kapanmaz, **düşük maliyet moduna** (yalnız ücretsiz sağlayıcılar, sonra şablon cevaplar + hocaya yönlendirme) iner.
4. **Onaylı içerik havuzu.** Aynı kazanım + aynı yanılgı etiketi + aynı mod için üretilen açıklama bir kez üretilir, eğitmen onayından sonra `content_pool`'dan servis edilir.
5. **Depolama da bütçedir.** Supabase ücretsiz katman 500 MB'dir; her tablo için satır boyutu × saklama süresi hesaplanmış, saklama işleri `pg_cron` ile tanımlanmıştır.
6. **Hesapsız yerel inşa.** Her dış servis bir arayüzün arkasında, her arayüzün deterministik bir sahtesi var; `bun test`, `pytest`, `sqlfluff`/`pglast` hiçbir anahtar olmadan geçer. Canlı DB varsa (`OGRENMEN_DATABASE_URL`) RLS/grant testleri de koşar; yoksa atlanır, başarısız olmaz.

**Maliyet kanıtı (özet; ayrıntı §5.6 ve §8.4):** 300 öğrenci × 150 LLM etkileşimi/ay = 45.000 sohbet turu × 0,00025 $ = 11,25 $; gece olgu çıkarımı (Batch) 1,13 $; haftalık özetler 0,19 $; Tablet üretimi (300 yeni soru) 0,16 $; Kalem OCR 0,03 $; Kitap (ayda 40 araştırma tavanı) 1,20 $. Toplam ≈ **14,0 $/ay**; %40 pay ile **≈ 19,6 $/ay**. Aylık sert tavan 24 $ (Gemini ön ödemeli), günlük yumuşak tavan 0,80 $. Ders videosu analizi (ders başına 0,2–0,5 $) bu bütçenin **dışında**, ders ücretine yazılır. Altyapı (Workers, Supabase, GitHub Actions, Telegram) 0 $.

Sözlük: **öğrenci** = Telegram kullanıcısı; **eğitmen** = branş eğitmeni (panel); **koordinatör** = tüm öğrencileri gören panel kullanıcısı; **gözlemci** = salt okunur panel rolü; **bot_runtime** = Worker'ın PostgREST üzerinden kullandığı kısıtlı Postgres rolü; **service_role** = yalnızca güvenilir makinede (kurucunun bilgisayarı, GitHub Actions) çalışan toplu işlerin rolü; **implementer** = §11'deki modül sahibi ajan.

## 1. Depo ağacı

```
alperen/                                  monorepo kökü — sahibi M12 (entegrasyon, en son)
├── package.json                          npm workspaces: apps/*, packages/* ; kök betikler: "ci", "test:all"
├── bunfig.toml                           bun test ayarları (workspace kökünden tek komutla)
├── .nvmrc                                22
├── .editorconfig  .gitignore  .gitattributes
├── README.md                             "hesapsız 10 dakikada yerel çalıştırma" + modül haritası
├── Makefile                              make ci | make nightly-dry | make render-dry | make seed-dry
├── .github/
│   ├── CODEOWNERS                        dizin → modül sahibi
│   └── workflows/
│       ├── ci.yml                        typecheck + lint + bun test + pytest + sql lint (her PR)
│       ├── nightly.yml                   00:15 UTC (03:15 TRT): kulaklik-batch facts → tablet render → ders kuyruğu
│       ├── weekly.yml                    Pazar 01:15 UTC: haftalık özetler + panel metrikleri + maliyet raporu
│       ├── keepalive.yml                 günde 1: Supabase ping (uyumayı engeller) + Worker /health
│       ├── render.yml                    workflow_dispatch + nightly çağrısı: şekil/soru render kuyruğu
│       ├── ders.yml                      workflow_dispatch: ders videosu (URL/Storage yolu) → analiz
│       ├── cost-guard.yml                saatlik: harcama defteri kontrolü, eşik aşımında Issue + Telegram
│       ├── deploy-worker.yml             main'e merge → wrangler deploy (secret'lar GitHub Environments)
│       └── deploy-panel.yml              main'e merge → Cloudflare Pages (next-on-pages)
├── docs/
│   ├── plan.md                           kurucunun planı (değişmez)
│   ├── drafts/blueprint-C.md             bu belge
│   ├── runbook/                          M12: olay müdahale (sağlayıcı 429, Supabase uyku, tavan aşımı, webhook sel)
│   ├── adr/                              kısa karar kayıtları (ADR-0001-bkt.md, ADR-0002-bot-runtime-role.md ...)
│   └── hukuk/                            M11: aydınlatma metni, veli onay formu, grup kayıt bildirimi, saklama politikası
│                                          (her dosya "HUKUKİ İNCELEME GEREKLİ" başlığıyla)
├── packages/
│   ├── design-system/                    MEVCUT; değiştirilmez, panel tüketir
│   ├── contracts/                        M00: JSON Schema sözleşmeleri, models.json fiyat tablosu, BKT referans vektörleri
│   │   ├── schemas/*.schema.json
│   │   ├── fixtures/                     her şema için geçerli/geçersiz örnekler + bkt-vectors.json
│   │   ├── models.json                   sağlayıcı/model/fiyat/limit tablosu — TS ve Python aynı dosyayı okur
│   │   ├── src/index.ts  src/validate.ts ajv doğrulayıcılar; json-schema-to-typescript ile üretilen tipler
│   │   ├── python/ogrenmen_contracts/    aynı şemaları jsonschema ile doğrulayan ince paket (pyproject.toml)
│   │   └── package.json  tsconfig.json
│   └── mastery-math/                     M00: BKT güncellemesi tek kaynak — TS (worker) + Python (pipelines) + SQL (RPC)
│       ├── src/bkt.ts   python/ogrenmen_mastery/bkt.py   sql/bkt.sql
│       └── test/parity.test.ts           üç uygulama fixtures/bkt-vectors.json'a karşı aynı sonucu verir
├── supabase/                             M01: veritabanı
│   ├── config.toml
│   ├── migrations/0001_extensions.sql … 0016_cron.sql
│   ├── seed/00_roles.sql  01_quota_limits.sql  02_runtime_flags.sql  03_curriculum_tyt_2026.sql
│   ├── tests/                            pgTAP benzeri düz SQL testleri: rls_*.sql, grants_*.sql, bkt_parity.sql
│   └── scripts/check_sql.py  lint.sh  db-test.sh  size-report.sql
├── apps/
│   ├── worker/                           M03: Cloudflare Worker — Telegram botu, LLM yönlendirici, cron
│   └── panel/                            M10: Next.js 14 eğitmen paneli (React 18, design-system bundle)
├── content/
│   └── tyt-matematik/                    M02: müfredat sürümü, kazanım ağacı, yanılgı etiketleri, teşhis testi, şablonlar
│       ├── curriculum.json  skills.json  prerequisites.json  misconception-tags.json
│       ├── diagnostic/items.json  diagnostic/answer-keys.json   (ikisi ayrı dosya; ikincisi yalnız seed okur)
│       ├── templates/*.py                parametrik soru şablonları (sıfır LLM)
│       └── scripts/validate.py  seed.py  export-sql.py
├── pipelines/                            Python toplu işler; her biri ayrı pyproject, ayrı sahip
│   ├── common/                           M04: ogrenmen_common — adaptör arayüzleri, sahteler, DB/Storage istemcisi, maliyet defteri
│   ├── tablet/                           M05: soru+şekil üretimi, render, SymPy, vision denetimi, PDF
│   ├── kalem/                            M06: sınav arşivi → OCR → madde → kümeleme → öncelik planı
│   ├── kitap/                            M07: araştırma ajanı (OpenAlex/S2/Unpaywall/Crossref)
│   ├── ders/                             M08: ders videosu analizi
│   └── kulaklik_batch/                   M09: gece olgular, haftalık özet, panel metrikleri, saklama raporu
├── fixtures/                             M04: paylaşılan sahte veri (ders transkripti, Telegram update'leri, PDF'ler) — salt okunur
└── scripts/
    ├── dev-up.sh                         M12: fake Telegram + miniflare + panel mock'u tek komutla
    └── cost-report.py                    M12: spend_ledger → Markdown rapor (weekly.yml çağırır)
```

Dizin sahipliği kesindir: iki modül aynı dosyaya dokunmaz. Kök dosyalar (`package.json`, `Makefile`, `README.md`, `.github/`, `scripts/`) yalnız M12'nindir; diğer modüller kendi dizinlerinde kendi `package.json`/`pyproject.toml`'larıyla bağımsız kurulur ve test edilir.

## 2. Paketler ve sahiplik

Her paket için: amaç, çalışma zamanı, giriş noktaları, teslimatlar ve **hesapsız yerel inşa/test** komutları. Tüm komutlar kökten mutlak yolla çalışır; `cd` gerekmez.

### 2.1 `packages/contracts` (M00) — sözleşmeler ve fiyat tablosu

- Amaç: TS ve Python'un paylaştığı JSON Schema'lar (§4), `models.json` fiyat/limit tablosu, BKT referans vektörleri.
- Çalışma zamanı: Node 22 (ajv 8, json-schema-to-typescript), Python 3.13 (`jsonschema`).
- Giriş: `src/index.ts` (`validate<T>(schemaId, data)`, `Schemas` enum, üretilen tipler), `python/ogrenmen_contracts/__init__.py` (`validate(schema_id, data)`, `load_models()`).
- Teslimat: `schemas/*.schema.json` (draft 2020-12, `$id: https://ogrenmen.easy/schemas/<ad>.json`), `fixtures/<ad>/valid-*.json` ve `invalid-*.json`, `models.json`.
- İnşa/test:
  ```
  bun install --cwd /home/user/alperen/packages/contracts
  bun run --cwd /home/user/alperen/packages/contracts build      # json-schema-to-typescript → src/generated/*.d.ts
  bun test --cwd /home/user/alperen/packages/contracts            # her fixture doğru/yanlış sınıflanır
  python -m pip install -e /home/user/alperen/packages/contracts/python
  python -m pytest /home/user/alperen/packages/contracts/python -q
  ```

### 2.2 `packages/mastery-math` (M00) — BKT tek kaynak

- Amaç: ustalık güncelleme matematiği (§3.6) üç dilde aynı sonuç: TS (Worker'da anlık geri bildirim için ön hesap), Python (ders analizi/toplu), SQL (`update_mastery` RPC — **yazan tek yer**).
- Test: `bun test` ve `pytest`, `fixtures/bkt-vectors.json`'daki 40 vektöre karşı 1e-9 toleransla; SQL paritesi canlı DB varsa `supabase/tests/bkt_parity.sql`.

### 2.3 `supabase/` (M01) — veri modeli, RLS, RPC, cron

- Çalışma zamanı: Postgres 15 (Supabase), uzantılar `pgcrypto`, `vector`, `pg_cron`, `pg_net` (keepalive için değil; yalnız isteğe bağlı webhook).
- Teslimat: numaralı migration'lar, seed, test SQL'leri, `size-report.sql`.
- Hesapsız test (DB yok): 
  ```
  python -m pip install sqlfluff pglast
  sqlfluff lint --dialect postgres /home/user/alperen/supabase/migrations
  python /home/user/alperen/supabase/scripts/check_sql.py /home/user/alperen/supabase/migrations   # pglast ile sözdizimi ağacı; DDL'de yasak kalıpları (GRANT ALL, RLS kapalı tablo) tarar
  ```
- DB varsa (`OGRENMEN_DATABASE_URL` tanımlı): `bash /home/user/alperen/supabase/scripts/db-test.sh` migration'ları boş veritabanına uygular, `tests/*.sql`'i `psql -v ON_ERROR_STOP=1` ile koşar. Yoksa betik `SKIP: no database` yazar ve 0 ile çıkar.

### 2.4 `apps/worker` (M03) — Telegram botu + yönlendirici

- Çalışma zamanı: Cloudflare Workers, TypeScript (strict), `wrangler` 3.x, test `vitest` + `@cloudflare/vitest-pool-workers` (miniflare içerir).
- Giriş: `src/index.ts` (`fetch`: `/telegram/<WEBHOOK_SECRET_PATH>`, `/health`, `/metrics`; `scheduled`: cron).
- Teslimat: bot, router, kota, hafıza, grup/rol, loglama, cron; `test/fakes/` (Telegram, Supabase REST, sağlayıcılar).
- Test:
  ```
  bun install --cwd /home/user/alperen/apps/worker
  bun run --cwd /home/user/alperen/apps/worker typecheck
  bun run --cwd /home/user/alperen/apps/worker test            # vitest, tüm sağlayıcılar fake, DB fake (bellek içi PostgREST taklidi)
  bun run --cwd /home/user/alperen/apps/worker dev:fake        # wrangler dev + test/fakes/telegram-server.ts (port 8787/8788)
  curl -s -X POST localhost:8788/sendUpdate -d @/home/user/alperen/fixtures/telegram/private_text.json
  ```

### 2.5 `apps/panel` (M10) — eğitmen paneli

- Çalışma zamanı: Next.js **14.2.x** + React **18.3.1** (design-system `bundle.js` React 18 bekler; Next 15 React 19 ister, bu yüzden 14.2 sabit), `@supabase/ssr`, Cloudflare Pages (`@cloudflare/next-on-pages`).
- Test: `bun run typecheck`, `bun run test` (vitest + testing-library; veri katmanı `DATA_MODE=mock` ile `fixtures/panel/*.json`), `bun run dev:mock`.

### 2.6 `content/tyt-matematik` (M02) — ilk içerik

- Çalışma zamanı: JSON + Python 3.13 (şablonlar, doğrulayıcı).
- Test: `python /home/user/alperen/content/tyt-matematik/scripts/validate.py` (şema + ön koşul grafında döngü yok + her teşhis maddesinin her yanlış şıkkında etiket var + anahtar dosyasında her madde için tam bir doğru şık); `python .../scripts/export-sql.py --out /tmp/seed.sql` (DB'siz: SQL üretir, pglast ile parse edilir).

### 2.7 `pipelines/common` (M04) — ogrenmen_common

- Amaç: tüm Python boru hatlarının paylaştığı adaptör arayüzleri (`LLM`, `Embedding`, `Vision`, `Transcriber`, `Scholar`, `DOIResolver`, `OAResolver`, `DB`, `Storage`, `Notifier`), sahteleri (`fakes/`), maliyet defteri (`CostLedger`: her çağrıyı `models.json`'dan fiyatlar, `llm_calls`'a yazar), PII temizleyici, `--dry-run` çerçevesi.
- Test: `python -m pip install -e /home/user/alperen/pipelines/common[dev] && python -m pytest /home/user/alperen/pipelines/common -q`.

### 2.8 `pipelines/tablet` (M05), `kalem` (M06), `kitap` (M07), `ders` (M08), `kulaklik_batch` (M09)

- Her biri: `pyproject.toml` (bağımlılık: `ogrenmen_common`, `ogrenmen_contracts`), `src/<paket>/cli.py` (`python -m <paket> ... --dry-run --fixtures <dizin>`), `tests/`.
- Ortak kural: `--dry-run` hiçbir ağ çağrısı yapmaz, çıktıyı `--out` dizinine JSON olarak yazar, şemaya karşı doğrular ve maliyet tahminini `cost_estimate.json`'a yazar. Ayrıntı §6.

### 2.9 Paylaşılan sahteler ve fixtures (M04 `fixtures/`)

`fixtures/telegram/*.json` (private_text, group_mention, callback_answer, new_member, edited_message, voice), `fixtures/ders/lesson-01.transcript.json` (ÖĞRENCİ/EĞİTMEN etiketli, 90 dk sentetik), `fixtures/ders/frames/*.png` (8 kare), `fixtures/kalem/exam-2022.pdf` (sentetik 3 sayfa), `fixtures/kitap/openalex-search.json`, `crossref-ok.json`, `crossref-404.json`, `unpaywall.json`, `fixtures/panel/*.json`. TS sahteleri aynı dosyaları okur; böylece iki dilde test aynı girdiyi görür.

## 3. Veri modeli

### 3.0 Şemalar, roller, erişim modeli

Üç Postgres şeması:

| Şema | İçerik | PostgREST'te açık mı | Kim erişir |
| --- | --- | --- | --- |
| `public` | Uygulama tabloları, görünümler, RPC'ler | Evet | `authenticated` (panel), `bot_runtime` (Worker), `service_role` (pipelines) |
| `secure` | `answer_keys`, `pii_vault` | **Hayır** (`config.toml` → `[api] schemas = ["public"]`) | Yalnız `service_role` ve `SECURITY DEFINER` fonksiyonlar |
| `app` | Yardımcı fonksiyonlar (`app.current_student()`, `app.staff_role()`), tetikleyiciler | Hayır | Fonksiyonlar `public` RPC'lerinden çağrılır |

Roller:

- **`bot_runtime`** — Supabase'de özel rol: `CREATE ROLE bot_runtime NOLOGIN; GRANT bot_runtime TO authenticator;`. Worker, `SUPABASE_JWT_SECRET` ile `{ "role": "bot_runtime", "exp": now+3600 }` imzalar; PostgREST isteği bu rolle çalıştırır. `service_role` **Worker'da yoktur**; böylece Worker'daki bir hata RLS'i aşamaz ve `secure` şemasını göremez.
- Öğrenci kimliği `bot_runtime` isteklerinde `X-Ogrenmen-Student: <student uuid>` başlığıyla taşınır; `app.current_student()` bunu `current_setting('request.headers', true)::json->>'x-ogrenmen-student'` ile okur. Başlık Worker tarafından güvenilir şekilde set edilir; RLS politikaları bunu **derinlemesine savunma** için kullanır (Worker'daki bir kod hatası başka öğrencinin satırını okuyamaz). Öğrenciler arası işlemler (cron, grup içi yönlendirme) yalnızca açık amaçlı `SECURITY DEFINER` RPC'lerle yapılır.
- **`authenticated`** — Panel kullanıcıları (`staff`). Rol `staff.role` ∈ {coordinator, instructor, observer}. İleride öğrenci PWA'sı için `students.auth_user_id`.
- **`service_role`** — Yalnız güvenilir makine: pipelines, seed, migration. RLS'i geçer; `secure.answer_keys`'e **tek yazan** roldür (SymPy doğrulamasından geçmiş anahtarlar).
- **`anon`** — Hiçbir tabloya yetki yok (`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon`).

Genel kurallar (migration `0002_grants_baseline.sql`): her tabloda `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`; varsayılan `REVOKE ALL ... FROM PUBLIC, anon`; `GRANT` yalnızca gereken sütun/operasyon. `check_sql.py` her `CREATE TABLE` için aynı migration dosyasında `ENABLE ROW LEVEL SECURITY` arar, yoksa lint hatası verir.

Kimlik sütunları: öğrencinin dış dünyaya (LLM, log, panel ekran görüntüsü) giden kimliği `students.public_ref` (`s_` + 12 karakter base32, rastgele). Hiçbir prompt, `llm_calls` satırı veya pipeline çıktısı `students.id`, ad veya Telegram kimliği taşımaz.

### 3.1 Kimlik, kayıt, onay

```sql
-- 0003_identity.sql
create type consent_kind as enum ('kvkk_student','guardian','group_recording');
create type consent_status as enum ('pending','given','revoked','expired');
create type staff_role as enum ('coordinator','instructor','observer');
create type enrollment_status as enum ('active','paused','closed');

create table quota_tiers (tier text primary key, label text not null);   -- 'standard','pilot' (limitler 0006'da)

create table students (
  id               uuid primary key default gen_random_uuid(),
  public_ref       text not null unique default app.gen_public_ref(),       -- 's_' + 12 base32; API'ye giden tek kimlik
  telegram_user_id bigint unique,                                            -- null: henüz bağlanmadı
  auth_user_id     uuid unique references auth.users(id) on delete set null, -- ileride PWA
  display_name     text,                                                     -- yalnız panel; LLM'e gitmez
  birth_year       smallint check (birth_year between 1950 and 2030),
  is_minor         boolean generated always as (birth_year is null or extract(year from now())::int - birth_year < 18) stored,
  tz               text not null default 'Europe/Istanbul',
  tier             text not null default 'standard' references quota_tiers(tier),
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz                                               -- yumuşak silme; anonimleştirme işi 30 gün sonra
);
create index on students (telegram_user_id) where deleted_at is null;

create table guardians (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  relation    text not null,                 -- 'anne','baba','vasi'
  contact_ref uuid references secure.pii_vault(id),  -- telefon/e-posta şifreli kasada
  created_at  timestamptz not null default now()
);

create table consents (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students(id) on delete cascade,
  kind          consent_kind not null,
  status        consent_status not null default 'pending',
  doc_version   text not null,               -- 'aydinlatma-v1', 'veli-onay-v1', 'grup-kayit-v1'
  given_by      text,                        -- 'student' | 'guardian:<guardian uuid>' | 'staff:<uuid>'
  evidence      jsonb not null default '{}', -- {"telegram_message_id":..,"chat_id":..} veya {"form_id":..}
  given_at      timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);
create unique index consents_one_active on consents (student_id, kind) where status = 'given';

create table staff (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  role       staff_role not null,
  subject    text,                            -- 'matematik' ; branş eğitmeni için
  telegram_user_id bigint unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create table staff_students (                 -- branş eğitmeni yalnız kendi öğrencilerini görür
  staff_id   uuid references staff(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  primary key (staff_id, student_id)
);

create table curricula (
  id        uuid primary key default gen_random_uuid(),
  code      text not null,                    -- 'TYT-MAT'
  authority text not null,                    -- 'MEB-2024 / ÖSYM-2026'
  year      smallint not null,
  label     text not null,                    -- 'TYT Matematik 2026'
  status    text not null default 'active' check (status in ('draft','active','retired')),
  unique (code, year)
);
create table enrollments (                    -- kalıcı kimlik, dönem bazlı akademik kayıt
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students(id) on delete cascade,
  curriculum_id uuid not null references curricula(id),
  period_label  text not null,                -- 'YKS 2027'
  status        enrollment_status not null default 'active',
  started_at    date not null default current_date,
  ended_at      date,
  unique (student_id, curriculum_id, period_label)
);
create index on enrollments (student_id) where status = 'active';
```

`secure.pii_vault(id uuid pk, kind text, ciphertext bytea, created_at)` — `pgsodium` yerine basit `pgp_sym_encrypt` (`pgcrypto`) ile; anahtar `vault.secrets`'ta. MVP'de yalnız veli iletişim bilgisi burada tutulur.

### 3.2 Gözlük — kazanım, ustalık, gözlem, yanılgı, tercih

```sql
-- 0004_gozluk.sql
create table skills (
  id            text primary key,              -- 'tyt.mat.temel.rasyonel-sayilar' (müfredat sürümü ile birlikte benzersiz)
  curriculum_id uuid not null references curricula(id),
  parent_id     text references skills(id),
  name          text not null,
  order_no      int not null,
  -- BKT parametreleri kazanım başına (varsayılanlar; teşhis sonrası kalibre edilebilir)
  p_init  numeric(4,3) not null default 0.300,
  p_learn numeric(4,3) not null default 0.100,
  p_guess numeric(4,3) not null default 0.200,  -- 5 şıklı test
  p_slip  numeric(4,3) not null default 0.100
);
create table skill_prerequisites (
  skill_id  text references skills(id) on delete cascade,
  prereq_id text references skills(id) on delete cascade,
  strength  numeric(3,2) not null default 1.00 check (strength between 0 and 1),
  primary key (skill_id, prereq_id),
  check (skill_id <> prereq_id)
);

create type observation_kind as enum ('quiz_correct','quiz_wrong','lesson_mastery','chat_question','chat_misconception','instructor_note','diagnostic');
create type source_kind as enum ('diagnostic','question','lesson','chat','instructor','template');

create table misconception_tags (
  tag                 text primary key,         -- 'MAT-RAS-01'
  skill_id            text not null references skills(id),
  prereq_skill_id     text references skills(id),  -- "asıl sorun alt konuda" çıkarımı için
  text_instructor     text not null,            -- üçüncü tekil
  text_student        text not null             -- sen dili
);

create table observations (
  id             bigint generated always as identity primary key,
  enrollment_id  uuid not null references enrollments(id) on delete cascade,
  skill_id       text not null references skills(id),
  kind           observation_kind not null,
  value          numeric(4,3),                 -- lesson_mastery: 0–1 ; quiz: 1/0 ; diğerleri null
  misconception_tag text references misconception_tags(tag),
  source         source_kind not null,
  source_id      text not null,                -- attempt id, lesson id + ts, message id
  evidence_quote text,                         -- ≤ 240 karakter, isim içermez (PII temizleyiciden geçer)
  created_at     timestamptz not null default now()
);
create index on observations (enrollment_id, skill_id, created_at desc);

create table mastery (
  enrollment_id    uuid references enrollments(id) on delete cascade,
  skill_id         text references skills(id),
  p                numeric(5,4) not null,
  evidence_count   int not null default 0,
  last_evidence_at timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (enrollment_id, skill_id)
);

create type misconception_status as enum ('open','pending_review','resolved');
create table misconceptions (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references enrollments(id) on delete cascade,
  tag            text not null references misconception_tags(tag),
  status         misconception_status not null default 'pending_review',  -- kanıt eşiği geçilince 'open'
  evidence_count int not null default 0,
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_by    uuid references staff(id),     -- "✓ Çözüldü" yalnız eğitmen onayıyla
  unique (enrollment_id, tag)
);

create table preferences (
  student_id        uuid primary key references students(id) on delete cascade,
  active_hours      smallint[] not null default '{18,19,20,21}',  -- yerel saat; proaktif mesaj penceresi
  style             text check (style in ('visual','verbal')),
  default_mode      text not null default 'socratic' check (default_mode in ('socratic','direct')),
  explanation_notes text,                      -- "kısa adımlar işe yarıyor" (nightly batch yazar)
  updated_at        timestamptz not null default now()
);
```

### 3.3 Tablet ve soru bankası (cevap anahtarı ayrı şemada)

```sql
-- 0005_soru_bankasi.sql
create type question_status as enum ('draft','pending_review','approved','rejected','retired');
create type figure_tool as enum ('matplotlib','svg','tikz','vega-lite','schemdraw','rdkit','graphviz','latex','template');
create type figure_status as enum ('pending','rendered','verified','failed');

create table figures (
  id            uuid primary key default gen_random_uuid(),
  tool          figure_tool not null,
  code          text not null,
  code_hash     text not null,                         -- sha256; aynı kod bir kez render edilir
  alt_text      text not null,                         -- şekli kelimelerle anlatır (Telegram altyazısı)
  png_path      text,                                  -- Storage: figures/<id>.png
  svg_path      text,
  width_px      int, height_px int, bytes int,
  status        figure_status not null default 'pending',
  render_log    text,
  vision_check  jsonb,                                 -- {"model":..,"matches_stem":true,"notes":..,"cost_usd":..}
  attempts      smallint not null default 0,           -- 2 deneme sonra eğitmen kuyruğu
  created_at    timestamptz not null default now()
);
create unique index on figures (code_hash);

create table questions (
  id             uuid primary key default gen_random_uuid(),
  curriculum_id  uuid not null references curricula(id),
  skill_ids      text[] not null check (cardinality(skill_ids) >= 1),
  stem           text not null,
  figure_id      uuid references figures(id),
  options        jsonb not null,            -- [{"key":"A","text":"...","misconception_tag":"MAT-RAS-01"|null}, ...] DOĞRU ŞIK BURADA YOK
  difficulty     numeric(3,2),
  source         text not null check (source in ('template','llm','instructor')),
  template_id    text, template_params jsonb,
  status         question_status not null default 'draft',
  verification   jsonb not null default '{}', -- {"schema":true,"sympy":true|false|null,"render":..,"vision":..}
  content_hash   text not null unique,       -- stem+options normalize; aynı soru iki kez üretilmez
  model          text, cost_usd numeric(10,6) not null default 0,
  created_at     timestamptz not null default now(),
  approved_by    uuid references staff(id), approved_at timestamptz,
  review_note    text
);
create index on questions using gin (skill_ids);
create index on questions (status, curriculum_id);

-- secure şeması: PostgREST'e kapalı
create table secure.answer_keys (
  question_id    uuid primary key references public.questions(id) on delete cascade,
  correct_option char(1) not null check (correct_option in ('A','B','C','D','E')),
  numeric_answer text,                        -- SymPy string
  solution       text not null,               -- adım adım çözüm (doğrudan cevap modunda sunucu fonksiyonu verir)
  sympy_check    jsonb,                       -- {"verified":true,"expr":"...","value":"7/8"}
  written_by     text not null default 'pipeline:tablet',
  created_at     timestamptz not null default now()
);
revoke all on schema secure from public;
grant usage on schema secure to service_role;
grant all on secure.answer_keys to service_role;
-- bot_runtime ve authenticated için HİÇBİR grant yok; yalnız secure.grade_attempt() SECURITY DEFINER ile dolaylı erişim.

create table attempts (
  id              bigint generated always as identity primary key,
  enrollment_id   uuid not null references enrollments(id) on delete cascade,
  question_id     uuid not null references questions(id),
  context         text not null check (context in ('diagnostic','practice','test')),
  session_id      uuid,
  chosen_option   char(1) not null,
  is_correct      boolean not null,            -- yalnız secure.grade_attempt yazar
  misconception_tag text,
  response_ms     int,
  created_at      timestamptz not null default now()
);
create index on attempts (enrollment_id, created_at desc);

create table diagnostic_tests (
  id            uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references curricula(id),
  version       text not null,
  item_ids      uuid[] not null,              -- sıralı 15–20 soru
  unique (curriculum_id, version)
);
create table diagnostic_sessions (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  test_id       uuid not null references diagnostic_tests(id),
  current_index smallint not null default 0,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  result        jsonb                         -- {"per_skill":[{"skill_id":..,"p":..,"n":..}],"open_tags":[..]}
);

-- Onaylı içerik havuzu: aynı kazanım+etiket+mod için tek LLM çağrısı
create table content_pool (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('explanation','hint','feedback_wrong','feedback_right')),
  skill_id          text not null references skills(id),
  misconception_tag text references misconception_tags(tag),
  mode              text not null check (mode in ('socratic','direct')),
  body              text not null,            -- ≤ 4 satır, telegram.md kurallarına uygun
  status            text not null default 'pending_review' check (status in ('pending_review','approved','rejected')),
  model             text, cost_usd numeric(10,6) not null default 0,
  hit_count         int not null default 0,
  created_at        timestamptz not null default now(),
  approved_by       uuid references staff(id), approved_at timestamptz
);
create unique index content_pool_key on content_pool (kind, skill_id, coalesce(misconception_tag,''), mode) where status <> 'rejected';
```

### 3.4 Kulaklık — ham günlük, hafıza, cevap kaydı, gruplar, kota, harcama

```sql
-- 0006_kulaklik.sql
create table tg_chats (
  chat_id                  bigint primary key,
  kind                     text not null check (kind in ('private','group','supergroup')),
  title                    text,
  recording_notice_msg_id  bigint,              -- sabitlenen kayıt bildirimi
  privacy_mode_off_verified boolean not null default false,
  retention_days           smallint not null default 90,   -- bildirim metni bu değeri yazar
  created_at               timestamptz not null default now()
);
create table chat_roles (
  chat_id          bigint references tg_chats(chat_id) on delete cascade,
  telegram_user_id bigint not null,
  role             text not null check (role in ('student','instructor','coordinator','observer')),
  student_id       uuid references students(id) on delete cascade,
  staff_id         uuid references staff(id) on delete cascade,
  mention_handle   text,                        -- '@ayse_hoca'
  primary key (chat_id, telegram_user_id)
);

create table tg_updates (                       -- webhook tekrarını engeller; 2 gün saklanır
  update_id   bigint primary key,
  received_at timestamptz not null default now()
);

create table messages (                         -- Katman 1: ham günlük (90 gün)
  id                   bigint generated always as identity primary key,
  chat_id              bigint not null references tg_chats(chat_id),
  telegram_message_id  bigint not null,
  sender_kind          text not null check (sender_kind in ('student','instructor','coordinator','bot','other')),
  student_id           uuid references students(id) on delete cascade,
  staff_id             uuid references staff(id),
  reply_to_message_id  bigint,
  text                 text,                     -- PII temizleyiciden geçmemiş ham metin; LLM'e giderken temizlenir
  attachments          jsonb not null default '[]',
  is_question          boolean,                  -- nightly batch doldurur
  answered_at          timestamptz,              -- cevapsız soru alarmı için
  created_at           timestamptz not null default now(),
  unique (chat_id, telegram_message_id)
);
create index on messages (student_id, created_at desc);
create index on messages (chat_id, created_at desc);
create index messages_unanswered on messages (created_at) where is_question and answered_at is null;

create table sessions (                          -- mod ve kısa durum
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references students(id) on delete cascade,
  chat_id          bigint not null references tg_chats(chat_id),
  mode             text not null default 'socratic' check (mode in ('socratic','direct')),
  direct_once      boolean not null default false,   -- /cevap: yalnız sıradaki soru için
  state            jsonb not null default '{}',      -- {"flow":"diagnostic","diagnostic_session_id":..} | {"flow":"chat","skill_hint":..}
  started_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create unique index sessions_active on sessions (student_id, chat_id);

create table memory_facts (                       -- Katman 2: çıkarılmış olgular
  id                 bigint generated always as identity primary key,
  student_id         uuid not null references students(id) on delete cascade,
  kind               text not null check (kind in ('promise','deadline','unanswered_question','morale','topic_asked','preference','instructor_fact','other')),
  text               text not null,              -- ≤ 300 karakter, isimsiz
  source_message_ids bigint[] not null,
  confidence         numeric(3,2) not null default 0.70,
  approved           boolean not null default false,   -- not/devamsızlık gibi konularda bot yalnız approved=true olguyla konuşur
  valid_from         date not null default current_date,
  valid_until        date,                       -- deadline/promise için; geçince expired
  status             text not null default 'active' check (status in ('active','merged','expired')),
  embedding          halfvec(768),               -- Gemini embedding, 768 boyut (Matryoshka), half precision: 1,5 KB/satır
  tsv                tsvector generated always as (to_tsvector('turkish', text)) stored,
  model              text, cost_usd numeric(10,6) not null default 0,
  created_at         timestamptz not null default now()
);
create index on memory_facts using hnsw (embedding halfvec_cosine_ops) with (m = 16, ef_construction = 64);
create index on memory_facts using gin (tsv);
create index on memory_facts (student_id, status);

create table weekly_summaries (                   -- Katman 3
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  week_start  date not null,
  body        text not null,                     -- ≤ 600 karakter
  metrics     jsonb not null,                    -- weekly-summary şeması
  facts_used  bigint[] not null default '{}',
  model       text, cost_usd numeric(10,6) not null default 0,
  created_at  timestamptz not null default now(),
  unique (student_id, week_start)
);

create table bot_responses (                      -- her bot cevabı; denetim ve maliyet
  id                      bigint generated always as identity primary key,
  in_message_id           bigint references messages(id) on delete set null,
  chat_id                 bigint not null,
  student_id              uuid references students(id) on delete set null,
  out_telegram_message_id bigint,
  purpose                 text not null check (purpose in ('chat','feedback','hint','command','proactive','escalation','quota','consent')),
  prompt_version          text,                  -- 'socratic-v3' ; prompt metni repoda sürümlü
  prompt_hash             text,
  prompt_sample           text,                  -- yalnız %2 örneklem + işaretlenenler; 30 gün sonra null
  memory_fact_ids         bigint[] not null default '{}',
  recent_message_ids      bigint[] not null default '{}',
  pool_id                 uuid references content_pool(id),   -- havuzdan geldiyse
  cache_hit               boolean not null default false,
  provider                text, model text,
  fallback_chain          text[] not null default '{}',       -- ['gemini-paid:429','groq:ok']
  tokens_in int, tokens_out int,
  cost_usd                numeric(10,6) not null default 0,
  latency_ms              int,
  confidence              numeric(3,2),
  escalated               boolean not null default false,
  quota_state             jsonb,                 -- {"used":12,"limit":25}
  degraded_mode           boolean not null default false,
  flagged                 boolean not null default false,
  flagged_by              uuid references staff(id), flag_reason text, flagged_at timestamptz,
  created_at              timestamptz not null default now()
);
create index on bot_responses (created_at desc);
create index on bot_responses (student_id, created_at desc);
create index bot_responses_flagged on bot_responses (flagged_at) where flagged;

create table llm_calls (                          -- her sağlayıcı çağrısı (sohbet + toplu işler)
  id          bigint generated always as identity primary key,
  purpose     text not null check (purpose in ('chat','nightly_facts','weekly_summary','question_gen','vision_check','ocr','lesson_analysis','research','embedding','transcribe','tts')),
  provider    text not null, model text not null,
  tokens_in   int not null default 0, tokens_out int not null default 0,
  audio_sec   int, images int,
  batch       boolean not null default false,
  status      text not null check (status in ('ok','error','rate_limited','timeout','cap_blocked')),
  error_code  text,
  latency_ms  int,
  cost_usd    numeric(10,6) not null default 0,
  ref_table   text, ref_id text,
  student_ref text,                              -- public_ref; asla uuid/ad
  created_at  timestamptz not null default now()
);
create index on llm_calls (created_at desc);

create table spend_ledger (                       -- gün × amaç × sağlayıcı toplamı; tetikleyici günceller
  day        date not null,
  purpose    text not null,
  provider   text not null,
  calls      int not null default 0,
  tokens_in  bigint not null default 0, tokens_out bigint not null default 0,
  cost_usd   numeric(12,6) not null default 0,
  primary key (day, purpose, provider)
);

create table runtime_flags (                      -- işletme anahtarları; panelde koordinatör düzenler
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
-- seed/02_runtime_flags.sql:
--  paid_llm_enabled=true, degraded_mode=false, daily_cap_usd=0.80, monthly_cap_usd=24.00,
--  alert_thresholds=[0.5,0.8,1.0], chat_max_tokens_out=220, memory_k=5, recent_messages=6,
--  min_evidence=5, proactive_enabled=true, research_enabled=false (TYT pilotunda kapalı)

create table provider_health (
  provider           text primary key,
  cooldown_until     timestamptz,
  consecutive_errors int not null default 0,
  last_error         text,
  updated_at         timestamptz not null default now()
);

create table quota_limits (
  tier        text references quota_tiers(tier) on delete cascade,
  kind        text not null check (kind in ('message','test','research','voice_minutes','figure')),
  daily_limit int not null,
  primary key (tier, kind)
);
-- seed: standard: message 25, test 5, research 0, voice_minutes 0, figure 10 ; pilot: message 40, test 8, research 2
create table quota_usage (
  student_id uuid references students(id) on delete cascade,
  day        date not null,
  kind       text not null,
  used       int not null default 0,
  warned     boolean not null default false,   -- "5 mesaj kala" bir kez
  primary key (student_id, day, kind)
);

create table escalations (
  id              uuid primary key default gen_random_uuid(),
  chat_id         bigint not null,
  message_id      bigint references messages(id),
  student_id      uuid references students(id) on delete set null,
  reason          text not null check (reason in ('bot_unsure','human_requested','grade_attendance_payment','quota_exhausted','consent_missing','degraded')),
  target_staff_id uuid references staff(id),
  status          text not null default 'open' check (status in ('open','answered','expired')),
  created_at      timestamptz not null default now(),
  answered_at     timestamptz, answered_by uuid references staff(id)
);
create index on escalations (status, created_at);

create table instructor_alerts (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('unanswered','silent','morale','deadline','response')),
  severity    text not null check (severity in ('danger','warning','neutral')),
  student_id  uuid references students(id) on delete cascade,
  staff_id    uuid references staff(id),          -- hedef eğitmen (null: koordinatör)
  detail      text not null,
  since       timestamptz,
  ref         jsonb not null default '{}',        -- {"message_id":..} | {"fact_id":..}
  status      text not null default 'open' check (status in ('open','done','snoozed')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz, resolved_by uuid references staff(id)
);
create unique index alerts_dedup on instructor_alerts (kind, student_id, coalesce(ref->>'message_id', ref->>'fact_id', '')) where status = 'open';

create table proactive_messages (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references students(id) on delete cascade,
  template_id         text not null,               -- 'exam_tomorrow','silent_3d','deadline_soon'
  params              jsonb not null default '{}',
  scheduled_for       timestamptz not null,
  sent_at             timestamptz,
  telegram_message_id bigint,
  status              text not null default 'scheduled' check (status in ('scheduled','sent','skipped','failed'))
);
create unique index proactive_one_per_day on proactive_messages (student_id, (scheduled_for at time zone 'Europe/Istanbul')::date);
```

### 3.5 Ders, Kalem, Kitap, operasyon

```sql
-- 0007_ders.sql
create table lessons (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references enrollments(id) on delete cascade,
  staff_id       uuid references staff(id),
  held_at        timestamptz not null,
  duration_min   int,
  video_path     text,                      -- Storage: lessons/<id>/video.mp4 (30 gün)
  audio_path     text,                      -- geçici; analiz sonrası silinir
  transcript_path text,                     -- lessons/<id>/transcript.json (kalır; isimsiz)
  frames_count   smallint,
  video_deleted_at timestamptz,
  status         text not null default 'uploaded' check (status in ('uploaded','processing','analyzed','approved','corrected','failed')),
  created_at     timestamptz not null default now()
);
create table lesson_analyses (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references lessons(id) on delete cascade,
  version     smallint not null default 1,
  analysis    jsonb not null,                -- lesson-analysis şeması
  model       text not null, cost_usd numeric(10,6) not null,
  status      text not null default 'draft' check (status in ('draft','approved','corrected','rejected')),
  corrections jsonb,                         -- eğitmenin değiştirdiği maddeler
  approved_by uuid references staff(id), approved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (lesson_id, version)
);

-- 0008_kalem.sql
create table exam_sources (
  id               uuid primary key default gen_random_uuid(),
  course           text not null,            -- 'TYT-MAT' | 'MAT101'
  instructor_alias text,                     -- 'hoca-A' ; gerçek ad yok
  year             smallint not null, term text,
  file_path        text not null,            -- Storage: exams/<id>.pdf — yalnız eğitmen arşivi
  legal_basis      text not null,            -- 'öğrenci kendi kopyası', 'kamuya açık ÖSYM yayını — yalnız istatistik'
  uploaded_by      uuid references staff(id),
  created_at       timestamptz not null default now()
);
create table exam_clusters (
  id          uuid primary key default gen_random_uuid(),
  course      text not null,
  label       text not null,                 -- 'kısmi integrasyon'
  skill_id    text references skills(id),
  item_count  int not null default 0,
  years_hit   smallint[] not null default '{}',
  years_total smallint not null default 0,
  avg_points  numeric(5,2),
  updated_at  timestamptz not null default now()
);
create table exam_items (
  id         uuid primary key default gen_random_uuid(),
  source_id  uuid not null references exam_sources(id) on delete cascade,
  item_no    smallint not null,
  topic      text, kind text check (kind in ('proof','calc','mc','other')),
  points     numeric(5,2),
  skill_id   text references skills(id),
  ocr_text   text,                           -- ASLA öğrenciye; yalnız kümeleme ve eğitmen arşivi
  embedding  halfvec(768),
  cluster_id uuid references exam_clusters(id),
  unique (source_id, item_no)
);
create table exam_priority_plans (
  id             uuid primary key default gen_random_uuid(),
  course         text not null, period text not null,
  plan           jsonb not null,             -- exam-priority-plan şeması
  evidence_count int not null,
  status         text not null default 'pending_review' check (status in ('pending_review','approved','retired')),
  approved_by    uuid references staff(id), approved_at timestamptz,
  created_at     timestamptz not null default now()
);

-- 0009_kitap.sql
create table research_requests (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete set null,
  staff_id   uuid references staff(id),
  query      text not null,
  status     text not null default 'queued' check (status in ('queued','running','done','failed','blocked_quota')),
  cost_usd   numeric(10,6) not null default 0,
  created_at timestamptz not null default now(), finished_at timestamptz
);
create table research_outputs (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references research_requests(id) on delete cascade,
  output     jsonb not null,                 -- research-output şeması
  bibtex     text, apa text,
  status     text not null default 'pending_review' check (status in ('pending_review','released','rejected'))
);
create table citations (
  id                uuid primary key default gen_random_uuid(),
  output_id         uuid not null references research_outputs(id) on delete cascade,
  doi               text,
  title text, authors text, venue text, year smallint,
  crossref_verified boolean not null default false,
  oa_pdf_url        text, tldr text,
  status            text not null default 'kept' check (status in ('kept','removed')),  -- çözülmeyen DOI: removed; öğrenciye hiç gitmez
  removed_reason    text
);

-- 0010_ops.sql
create table audit_log (
  id         bigint generated always as identity primary key,
  actor      text not null,                  -- 'staff:<uuid>' | 'bot_runtime' | 'service_role:tablet'
  action     text not null,
  table_name text not null, row_id text,
  diff       jsonb,
  created_at timestamptz not null default now()
);
create table retention_runs (id bigint generated always as identity primary key, job text not null, deleted_rows int not null, ran_at timestamptz not null default now());
create table table_sizes_daily (day date not null, table_name text not null, total_bytes bigint not null, row_estimate bigint, primary key (day, table_name));
```

### 3.6 Ustalık güncellemesi — BKT (karar: ADR-0001)

Seçim **Bayesian Knowledge Tracing**, kazanım başına dört parametre (`skills.p_init, p_learn, p_guess, p_slip`). Elo yerine BKT: (a) parametreler "tahmin/kayma" olarak eğitmene anlatılabilir, (b) ders analizi gibi 0–1 sürekli kanıt doğal eklenir, (c) soru zorluğu için ikinci bir tablo gerekmez. Tek kaynak `packages/mastery-math`; SQL sürümü **tek yazan**dır.

Tanımlar: `p` = öğrencinin kazanımı bildiği olasılık (önsel), `g` = bilmeden doğru yapma (guess), `s` = bilip yanlış yapma (slip), `t` = bir fırsatta öğrenme (learn).

**Adım 1 — gözleme göre koşullu güncelleme**

- Doğru cevap: `p_obs = p·(1−s) / ( p·(1−s) + (1−p)·g )`
- Yanlış cevap: `p_obs = p·s / ( p·s + (1−p)·(1−g) )`

**Adım 2 — öğrenme geçişi**: `p_new = p_obs + (1 − p_obs)·t`

**Sürekli kanıt** (ders analizi `mastery_estimate ∈ [0,1]`, ağırlık `w = 0.30`): `p_new = p + w·(m − p)`; öğrenme geçişi uygulanmaz (ders gözlemi zaten sonucu ölçer). `evidence_count += 1`.

**Teşhis testi** maddeleri `kind='diagnostic'` ile normal BKT adımı uygular; ancak `p_init` yerine `p` yoksa `skills.p_init` ile başlar.

**Sınırlama**: `p_new` `[0.01, 0.99]` aralığına kırpılır (sayısal kilitlenmeyi önler). `evidence_count < min_evidence (5)` iken `p` saklanır ama **hiçbir yüzeyde yüzde gösterilmez** ve "kesin teşhis" (yanılgı `open`) konmaz; yanılgı `pending_review`'da kalır.

**Ön koşul çıkarımı** (`app.infer_prereq_gap`): bir kazanımda `p < 0.4` ve `evidence_count ≥ 5`, ön koşulunda `p < 0.5` ve `evidence_count ≥ 5` ise sohbete "asıl sorun alt konuda: <prereq>" ipucu eklenir; bu bir öneri, teşhis değildir.

```sql
-- packages/mastery-math/sql/bkt.sql → supabase/migrations/0011_functions_mastery.sql
create or replace function app.bkt_step(p numeric, correct boolean, g numeric, s numeric, t numeric)
returns numeric language sql immutable as $$
  with obs as (
    select case when correct
      then (p*(1-s)) / nullif(p*(1-s) + (1-p)*g, 0)
      else (p*s)     / nullif(p*s + (1-p)*(1-g), 0) end as p_obs)
  select least(0.99, greatest(0.01, p_obs + (1-p_obs)*t)) from obs;
$$;

create or replace function public.update_mastery(p_enrollment uuid, p_skill text, p_kind observation_kind, p_value numeric)
returns table (p numeric, evidence_count int) language plpgsql security definer set search_path = public, app as $$
declare sk skills%rowtype; cur mastery%rowtype; newp numeric;
begin
  select * into sk from skills where id = p_skill;
  if not found then raise exception 'unknown skill %', p_skill; end if;
  select * into cur from mastery where enrollment_id = p_enrollment and skill_id = p_skill for update;
  if not found then cur.p := sk.p_init; cur.evidence_count := 0; end if;
  newp := case p_kind
    when 'quiz_correct' then app.bkt_step(cur.p, true,  sk.p_guess, sk.p_slip, sk.p_learn)
    when 'quiz_wrong'   then app.bkt_step(cur.p, false, sk.p_guess, sk.p_slip, sk.p_learn)
    when 'diagnostic'   then app.bkt_step(cur.p, p_value >= 0.5, sk.p_guess, sk.p_slip, sk.p_learn)
    when 'lesson_mastery' then least(0.99, greatest(0.01, cur.p + 0.30*(p_value - cur.p)))
    else cur.p end;   -- chat_question / instructor_note: kanıt sayılır, p değişmez
  insert into mastery (enrollment_id, skill_id, p, evidence_count, last_evidence_at, updated_at)
  values (p_enrollment, p_skill, newp, cur.evidence_count + 1, now(), now())
  on conflict (enrollment_id, skill_id) do update
    set p = excluded.p, evidence_count = mastery.evidence_count + 1, last_evidence_at = now(), updated_at = now();
  return query select newp, cur.evidence_count + 1;
end $$;
revoke all on function public.update_mastery from public;
-- Doğrudan çağrı yok: yalnız secure.grade_attempt ve service_role (ders analizi) çağırır.
grant execute on function public.update_mastery to service_role;
```

Referans vektörleri (`fixtures/bkt-vectors.json`): `{p:0.3,correct:true,g:0.2,s:0.1,t:0.1} → 0.7257…`; `{p:0.3,correct:false,...} → 0.1407…`; 40 satır, TS/Python/SQL aynı sonucu verir (tolerans 1e-9).

### 3.7 RLS — tablo × rol matrisi

Kısaltmalar: **S** öğrenci (bot_runtime + `X-Ogrenmen-Student`; ileride `authenticated` öğrenci), **E** branş eğitmeni (`staff_students` ile sınırlı), **K** koordinatör, **G** gözlemci, **B** bot_runtime (öğrenci başlığı olmadan, cron/grup), **SR** service_role (RLS'i geçer; her tabloda tam yetki). `r` okuma, `w` ekleme, `u` güncelleme, `d` silme, `rpc` yalnız fonksiyonla, `—` yok.

| Tablo | S | E | K | G | B |
| --- | --- | --- | --- | --- | --- |
| students | r (kendi) | r (kendi öğrencileri, `display_name` dahil) | r u | r | r (kendi başlık) ; w rpc `register_student` |
| guardians, consents | r (kendi) ; consents w rpc `record_consent` | r | r w u | r | r (kendi) ; w rpc |
| staff | — | r (kendi + aynı ders) | r w u | r | r (`telegram_user_id, role`) |
| staff_students | — | r (kendi) | r w d | r | r |
| curricula, skills, skill_prerequisites, misconception_tags | r | r | r | r | r |
| enrollments | r (kendi) | r | r w u | r | r (kendi) ; w rpc |
| mastery | r (kendi; `evidence_count<5` ise p görünür ama arayüz göstermez) | r | r | r | r (kendi) ; w **yalnız** `update_mastery` (SR + grade_attempt) |
| observations | r (kendi) | r | r | r | w rpc `grade_attempt` / `record_chat_observation` |
| misconceptions | r (kendi, yalnız `open/resolved`) | r u (`resolved_at, resolved_by, status`) | r u | r | r (kendi) ; w rpc |
| preferences | r u (kendi) | r | r | r | r u (kendi) |
| figures | r (yalnız `verified`) | r u (`status`, kuyruk kararı) | r u | r | r (`verified`) |
| questions | r (yalnız `approved`; `options.misconception_tag` sütunu `app.strip_tags()` görünümüyle) | r u (`status, review_note, approved_*`) | r u | r | r (`approved`) |
| **secure.answer_keys** | — | — | — | — | — (rpc `grade_attempt`, `reveal_solution` döner; satır okunmaz) |
| attempts | r (kendi) | r | r | r | w rpc `grade_attempt` ; r (kendi) |
| diagnostic_tests | r (`item_ids` değil; `next_diagnostic_item` rpc) | r | r w | r | r |
| diagnostic_sessions | r (kendi) | r | r | r | r u (kendi) ; w rpc |
| content_pool | r (`approved`) | r u (`status, approved_*`) | r w u | r | r (`approved`) ; w (`pending_review`, `hit_count` rpc) |
| tg_chats, chat_roles | — | r (üyesi olduğu) | r w u | r | r w u |
| tg_updates | — | — | — | — | w (insert-only) |
| messages | r (kendi) | r (kendi öğrencilerinin sohbetleri; grup mesajları dahil) | r | r | w ; r (aynı chat, son 50) |
| sessions | r u (kendi) | — | r | — | r w u (kendi) |
| memory_facts | r (kendi) | r u (`approved`) | r u d | r | r (kendi, rpc `retrieve_memory`) |
| weekly_summaries | r (kendi; sen diline çevrilmiş görünüm) | r | r | r | r (kendi) |
| bot_responses | — | r (kendi öğrencileri) u (`flagged, flag_reason, flagged_by`) | r u | r (maliyet dahil; denetim) | w ; r (kendi son 5) |
| llm_calls, spend_ledger | — | — | r | r | w (insert-only) ; r (`spend_ledger` bugün+ay) |
| runtime_flags | — | r | r u | r | r |
| provider_health | — | — | r | r | r u |
| quota_tiers, quota_limits | r | r | r u | r | r |
| quota_usage | r (kendi) | r | r | r | rpc `consume_quota` |
| escalations | r (kendi) | r u (`status, answered_*`) | r u | r | w ; r |
| instructor_alerts | — | r u (kendine atanan + öğrencileri) | r w u | r | w (cron rpc) |
| proactive_messages | r (kendi) | r | r u | r | r w u (cron rpc) |
| lessons | r (kendi; `video_path` hariç) | r w u (kendi öğrencileri) | r w u | r | — |
| lesson_analyses | r (`approved/corrected`, kendi) | r u (`status, corrections, approved_*`) | r u | r | — |
| exam_sources, exam_items | — | r w | r w u d | r | — |
| exam_clusters, exam_priority_plans | r (`approved` plan; `ocr_text` asla) | r u | r u | r | r (`approved`) |
| research_requests | r w (kendi; `research_enabled` flag) | r | r u | r | w rpc `enqueue_research` |
| research_outputs, citations | r (`released` + `kept`) | r u (`status`) | r u | r | r (`released`) |
| audit_log, retention_runs, table_sizes_daily | — | — | r | r | w (`audit_log`) |

Örnek politika SQL (desen; her tabloda aynı yardımcılar):

```sql
-- 0012_rls.sql (kesit)
create or replace function app.current_student() returns uuid language sql stable as $$
  select nullif(current_setting('request.headers', true)::json->>'x-ogrenmen-student','')::uuid $$;
create or replace function app.staff_role() returns staff_role language sql stable security definer as $$
  select role from staff where id = auth.uid() and active $$;
create or replace function app.can_see_student(sid uuid) returns boolean language sql stable security definer as $$
  select app.staff_role() in ('coordinator','observer')
      or exists (select 1 from staff_students where staff_id = auth.uid() and student_id = sid) $$;

alter table mastery enable row level security; alter table mastery force row level security;
create policy mastery_student_r on mastery for select to bot_runtime
  using (enrollment_id in (select id from enrollments where student_id = app.current_student()));
create policy mastery_staff_r on mastery for select to authenticated
  using (app.can_see_student((select student_id from enrollments e where e.id = enrollment_id)));
grant select on mastery to bot_runtime, authenticated;   -- insert/update yok: update_mastery SECURITY DEFINER yazar

alter table bot_responses enable row level security; alter table bot_responses force row level security;
create policy br_bot_w on bot_responses for insert to bot_runtime with check (true);
create policy br_staff_r on bot_responses for select to authenticated using (student_id is null or app.can_see_student(student_id));
create policy br_staff_flag on bot_responses for update to authenticated
  using (app.staff_role() in ('coordinator','instructor') and app.can_see_student(student_id))
  with check (true);
grant insert on bot_responses to bot_runtime;
grant select, update (flagged, flagged_by, flag_reason, flagged_at) on bot_responses to authenticated;
```

**RLS + grant birlikte test** (`supabase/tests/rls_answer_keys.sql`, `rls_student_isolation.sql`, `grants_bot_runtime.sql`): her test `set local role bot_runtime; set local request.headers = '{"x-ogrenmen-student":"<A>"}'` ile A'nın satırını görür, B'nin satırında 0 döner; `select * from secure.answer_keys` → `permission denied` beklenir (`\set ON_ERROR_STOP 0` yerine `do $$ begin ... exception when insufficient_privilege then raise notice 'OK' end $$`). `grants_bot_runtime.sql` `information_schema.role_table_grants`'ı matrisle karşılaştırır: matris dışında bir grant varsa test düşer.

### 3.8 RPC'ler

Tümü `public` şemasında, `security definer`, `set search_path = public, app, secure`, sahibi `postgres`. `grant execute` yalnız matristeki rollere.

| Fonksiyon | Çağıran | Yaptığı |
| --- | --- | --- |
| `register_student(tg_user_id bigint, display_name text, birth_year int) → students` | B | Öğrenci yoksa oluşturur, `public_ref` üretir; aktif `enrollments` yoksa aktif müfredatta açar; `consents(pending)` satırlarını ekler. |
| `record_consent(student uuid, kind consent_kind, doc_version text, given_by text, evidence jsonb)` | B, K | Onayı kaydeder; `kvkk_student` + (reşit değilse) `guardian` verilmeden `consent_ok(student)` false döner → sohbet açılmaz. |
| `consume_quota(student uuid, kind text) → (allowed bool, used int, lim int, remaining int, warn bool)` | B | `insert ... on conflict do update set used = used+1 where used < lim` tek ifadede atomik; `remaining = 5` ve `warned=false` ise `warn=true` + `warned=true`. Tavan dolu ise `allowed=false` ve `used` artmaz. |
| `grade_attempt(enrollment uuid, question uuid, chosen char, context text, session uuid, response_ms int) → (is_correct bool, misconception_tag text, feedback_pool_id uuid, mastery_p numeric, evidence_count int, prereq_hint text)` | B | `secure.answer_keys` okur, `attempts` yazar, `observations` ekler, `update_mastery` çağırır, yanılgı etiketi varsa `misconceptions` upsert (evidence_count++, eşik 3 → `open`), `content_pool`'dan onaylı geri bildirimi bulur, `infer_prereq_gap` ipucunu döner. **LLM yolu bu fonksiyona hiçbir metin yazamaz.** |
| `reveal_solution(enrollment uuid, question uuid) → text` | B | Yalnız `attempts`'te bu soru için en az bir deneme varsa veya `sessions.direct_once` ise `secure.answer_keys.solution` döner; aksi hâlde `null`. Her çağrı `audit_log`'a. |
| `start_diagnostic(enrollment uuid) → diagnostic_sessions` / `next_diagnostic_item(session uuid) → (question_id, stem, figure_png, options_public jsonb, index, total)` | B | Şıkları `misconception_tag` olmadan döner (`app.strip_tags`). |
| `finish_diagnostic(session uuid) → jsonb` | B | `result` hesaplar (kazanım başına p/n), `pending_review` yanılgıları listeler. |
| `retrieve_memory(student uuid, q halfvec(768), q_text text, k int) → setof (fact_id, text, kind, score)` | B | `0.7·(1−cos) + 0.3·ts_rank`; `q` null ise yalnız FTS (embedding sağlayıcısı kapalıyken bozulmaz). Yalnız `status='active'`, `valid_until is null or ≥ today`. |
| `recent_messages(student uuid, chat bigint, n int)` | B | Son n mesaj, `text` PII temizleyiciden geçmiş (`app.scrub(text)`: @kullanıcı, telefon, e-posta, "adım X" kalıpları). |
| `log_bot_response(payload jsonb) → bigint` | B | Tek işlemde `bot_responses` + `llm_calls` (her sağlayıcı denemesi için ayrı satır) + `spend_ledger` upsert. Payload bot-response-log şemasına karşı `app.validate_json` (pg_jsonschema varsa; yoksa minimal check) ile doğrulanır. |
| `check_spend(purpose text) → (paid_allowed bool, degraded bool, day_usd numeric, month_usd numeric, daily_cap numeric, monthly_cap numeric)` | B, SR | `spend_ledger` toplamlarını `runtime_flags` tavanlarıyla karşılaştırır; `≥ cap` ise `paid_allowed=false`; `degraded_mode` bayrağını döner. Pipelines her toplu işten önce çağırır. |
| `set_runtime_flag(key text, value jsonb)` | K, SR (cost-guard) | `runtime_flags` + `audit_log`. |
| `cron_due_proactive(now timestamptz) → setof (student uuid, chat bigint, template_id, params)` | B | Öğrencinin aktif saatinde, bugün gönderilmemiş, `proactive_enabled` ise; `deadline` olguları ve `silent_3d` kuralı. |
| `cron_open_alerts() → int` | B (saatlik) | `messages_unanswered` (> `alert_unanswered_hours`=6), `silent` (> 3 gün), `deadline` (≤ 2 gün) alarmlarını `instructor_alerts`'e dedup ile yazar. |
| `mark_answered(chat bigint, reply_to bigint)` | B | Eğitmen bir soruya yanıt verdiğinde `messages.answered_at`, `escalations.answered_*`, ilgili alarm `done`. |
| `pool_hit(pool_id uuid)` | B | `hit_count++`. |
| `infer_prereq_gap(enrollment uuid, skill text) → text` | B (grade_attempt içinden) | §3.6 kuralı. |
| `panel_overview(staff uuid) → jsonb` | E, K, G | StatTile dörtlüsü + AlertRow listesi tek sorguda (panel tek round-trip). |
| `approve_lesson_analysis(analysis uuid, corrections jsonb)` | E, K | `status`, `corrections`; **ardından** `observations`/`misconceptions`/`update_mastery` yazımı burada yapılır (taslak profilde iz bırakmaz). |
| `purge_*` (bkz. 3.9) | pg_cron | Saklama. |

### 3.9 Saklama ve silme işleri (`0016_cron.sql`, pg_cron, TRT gece)

| İş | Zaman | Ne yapar | Kaynak kural |
| --- | --- | --- | --- |
| `purge_tg_updates` | her gün 02:00 | `tg_updates` 2 günden eski | dedup tablosu şişmesin |
| `purge_messages` | her gün 02:05 | `messages` `created_at < now() − tg_chats.retention_days` (varsayılan 90); `memory_facts.source_message_ids` kalır (olgu kaynağı numara olarak saklanır, metin silinir) | Kayıt bildirimi "90 gün sonra silinir" |
| `purge_prompt_samples` | her gün 02:10 | `bot_responses.prompt_sample := null` 30 günden eski | Depolama |
| `purge_bot_responses` | her gün 02:15 | `bot_responses` 180 günden eski ve `flagged=false` sil; işaretliler 365 gün | Denetim/maliyet geçmişi |
| `expire_memory_facts` | her gün 02:20 | `valid_until < today → expired`; `expired` 180 gün sonra sil; öğrenci başına `active` > 300 ise en eskileri `merged` (haftalık özet zaten kapsar) | Depolama + alaka |
| `flag_video_deletion` | her gün 02:30 | `lessons.video_path` 30 günden eski ve `status in (approved,corrected)` → `video_deleted_at = null` olanları işaret; **dosyayı pipeline `ders purge`** siler, sonra `video_deleted_at` yazar ve öğrenci/veliye bildirim kuyruğa | Plan: ham video silinir, transkript kalır |
| `anonymize_students` | her gün 03:00 | `deleted_at < now()−30d`: `display_name,telegram_user_id,birth_year := null`, `secure.pii_vault` satırları sil, `messages.text := '[silindi]'` | KVKK silme talebi |
| `close_enrollment_cleanup` | haftalık | `enrollments.status='closed'` 365 gün: `memory_facts` sil, `mastery/observations` **kalır** (akademik geçmiş, isimsiz) | Enrollment modeli |
| `rollup_spend` | saatlik | `llm_calls` → `spend_ledger` tutarlılık kontrolü (tetikleyici kaçırırsa) | Maliyet |
| `compute_table_sizes` | her gün 03:30 | `pg_total_relation_size` → `table_sizes_daily`; toplam > 350 MB ise `instructor_alerts(kind='response', severity='warning', detail='Depolama %70')` koordinatöre | 500 MB kota |
| `purge_quota_usage` | haftalık | 60 günden eski | Depolama |

Her iş `retention_runs`'a satır yazar; `weekly.yml` bu tabloyu rapora koyar. pg_cron Supabase ücretsiz katmanda açıktır; açık değilse aynı fonksiyonlar Worker'ın `scheduled()` cron'undan RPC ile çağrılır (`runtime_flags.cron_owner = 'pg_cron' | 'worker'`).

### 3.10 Tohumlama (seed)

1. `supabase/seed/00_roles.sql` — `bot_runtime` rolü, `authenticator`'a grant, `anon` revoke.
2. `01_quota_limits.sql` — `standard`, `pilot` katmanları.
3. `02_runtime_flags.sql` — §3.4'teki anahtarlar.
4. `03_curriculum_tyt_2026.sql` — `content/tyt-matematik/scripts/export-sql.py` çıktısı: `curricula`, `skills`, `skill_prerequisites`, `misconception_tags`, `questions` (status `approved`, source `instructor`), `figures` (status `verified`, önceden render edilmiş PNG'ler `content/.../diagnostic/figures/`), `diagnostic_tests`. Tümü `on conflict do nothing` ile idempotent.
5. **Cevap anahtarları** `secure.answer_keys`'e yalnız `python content/tyt-matematik/scripts/seed.py --keys` ile, `service_role` anahtarıyla, güvenilir makineden; export-sql.py anahtar üretmez (dosya yanlışlıkla repoya girip PostgREST'ten okunabilir hâle gelmesin).
6. Geliştirme sahte verisi `supabase/seed/dev/*.sql`: 3 öğrenci (`s_test0001..3`, biri reşit değil ve veli onayı eksik), 1 eğitmen, 1 koordinatör, 1 grup, 40 mesaj, 12 olgu, 30 `bot_responses`. Yalnız `db-test.sh --dev` yükler.

### 3.11 Depolama bütçesi (Supabase 500 MB)

| Tablo | Satır/gün | Satır boyutu | Saklama | Tahmini |
| --- | --- | --- | --- | --- |
| messages | 300 öğr × %60 aktif × 8 msj + eğitmen ≈ 1.700 | ~450 B + indeks ≈ 700 B | 90 gün | ~107 MB |
| bot_responses | ~1.200 (LLM'siz cevaplar dahil) | ~350 B (prompt_sample yalnız %2) | 180 gün | ~76 MB |
| llm_calls | ~1.500 | ~200 B | 180 gün | ~54 MB |
| memory_facts | ~540 (3/aktif öğrenci) | 1,5 KB halfvec + 400 B + HNSW ≈ 2,3 KB | aktif ≤ 300/öğrenci → ≤ 90k satır | ~200 MB **üst sınır**; pratikte merge ile ~120 MB |
| observations/attempts/mastery | ~2.000 | ~120 B | süresiz | ~90 MB/yıl |
| diğer (questions, figures meta, alerts, ledger) | — | — | — | ~20 MB |
| **Toplam (1. yıl sonu)** | | | | **~420–480 MB** |

Riskli olan `memory_facts`; iki kol: (1) `halfvec(768)` ve öğrenci başına 300 aktif olgu tavanı migration'da sabit, (2) 350 MB'ta uyarı, 450 MB'ta `expire_memory_facts` tavanı 200'e, `messages` saklama 60 güne iner (`runtime_flags.storage_pressure=true`; kayıt bildirimi metni `tg_chats.retention_days` değerinden okunduğu için bildirim de güncellenir — bildirim değişince gruba yeniden gönderilir). Supabase Storage (1 GB): şekil PNG ~60 KB × 3.000 = 180 MB; ders transkriptleri ~150 KB × 500 = 75 MB; ham video Storage'a **girmez** (kurucu makinesinde/Drive'da 30 gün, yalnız yolu kaydedilir) — Storage'da video tutmak 1 GB'ı iki derste bitirir.

## 4. Sözleşmeler

Konum: `packages/contracts/schemas/<ad>.schema.json`, JSON Schema draft 2020-12, `$id: "https://ogrenmen.easy/schemas/<ad>.json"`, `additionalProperties: false` her nesnede. Sürüm `$comment` içinde (`"v1"`); kırıcı değişiklik yeni dosya (`question-item.v2.schema.json`) ve `schema_version` alanı.

**TypeScript tüketimi:** `bun run build` → `json-schema-to-typescript` ile `src/generated/*.d.ts`; `validate<T>('question-item', data)` ajv (2020 modu, `allErrors`, `strict`) ile doğrular ve `T` döner. Worker ve panel `@ogrenmen/contracts` workspace paketini içe alır; LLM yapılandırılmış çıktısı sağlayıcıya gönderilirken aynı şema **Gemini `responseSchema`** biçimine `toGeminiSchema()` ile çevrilir (`$ref` düzleştirme, `additionalProperties` kaldırma, `enum` korunur). Groq/OpenRouter için `response_format: json_schema`; Cloudflare AI için şema prompt'a gömülür ve çıktı ajv ile doğrulanır, geçmezse bir kez onarım denenir, sonra düşülür.

**Python tüketimi:** `ogrenmen_contracts.validate(schema_id, data)` (`jsonschema` Draft202012Validator, `fixtures` ile test); `ogrenmen_contracts.gemini_schema(schema_id)` aynı çeviri; `load_models()` fiyat tablosu. Pipelines çıktıyı yazmadan önce **mutlaka** doğrular; doğrulanmamış JSON DB'ye girmez.

**`models.json`** (fiyatlar varsayım; tek yerde, PR ile güncellenir; `verified_at` alanı zorunlu):

```json
{
  "verified_at": "2026-10-19",
  "currency": "USD",
  "providers": {
    "gemini-paid":  { "kind": "gemini", "base": "https://generativelanguage.googleapis.com/v1beta", "key_env": "GEMINI_PAID_KEY",  "tier": "paid" },
    "gemini-free":  { "kind": "gemini", "base": "https://generativelanguage.googleapis.com/v1beta", "key_env": "GEMINI_FREE_KEY",  "tier": "free", "rpd": 1000 },
    "groq":         { "kind": "openai-compatible", "base": "https://api.groq.com/openai/v1", "key_env": "GROQ_KEY", "tier": "free", "rpd": 1000 },
    "cf-ai":        { "kind": "workers-ai", "binding": "AI", "tier": "free", "neurons_per_day": 10000 },
    "openrouter":   { "kind": "openai-compatible", "base": "https://openrouter.ai/api/v1", "key_env": "OPENROUTER_KEY", "tier": "free", "rpd": 50 }
  },
  "models": {
    "gemini-2.5-flash-lite": { "provider": "gemini-paid", "in_per_m": 0.10, "out_per_m": 0.40, "batch_discount": 0.5, "ctx": 1000000, "structured": true },
    "gemini-2.5-flash":      { "provider": "gemini-paid", "in_per_m": 0.30, "out_per_m": 2.50, "batch_discount": 0.5, "ctx": 1000000, "structured": true, "vision": true, "audio": true },
    "gemini-2.5-pro":        { "provider": "gemini-paid", "in_per_m": 1.25, "out_per_m": 10.00, "batch_discount": 0.5, "ctx": 1000000, "structured": true, "vision": true, "use": ["lesson_analysis"] },
    "gemini-2.5-flash-lite@free": { "provider": "gemini-free", "in_per_m": 0, "out_per_m": 0, "structured": true },
    "llama-3.3-70b-versatile": { "provider": "groq", "in_per_m": 0, "out_per_m": 0, "structured": true },
    "@cf/meta/llama-3.1-8b-instruct": { "provider": "cf-ai", "in_per_m": 0, "out_per_m": 0, "structured": false, "neurons_per_1k_tokens": 1.7 },
    "meta-llama/llama-3.3-70b-instruct:free": { "provider": "openrouter", "in_per_m": 0, "out_per_m": 0, "structured": true },
    "gemini-embedding-001":  { "provider": "gemini-paid", "in_per_m": 0, "out_per_m": 0, "dims": 768, "use": ["embedding"] },
    "whisper-large-v3-turbo": { "provider": "groq", "per_audio_hour": 0.04, "use": ["transcribe"] },
    "claude-sonnet-4-5":     { "provider": "anthropic", "in_per_m": 3.00, "out_per_m": 15.00, "use": ["lesson_analysis"], "enabled": false }
  },
  "chains": {
    "chat":            ["gemini-2.5-flash-lite", "gemini-2.5-flash-lite@free", "llama-3.3-70b-versatile", "@cf/meta/llama-3.1-8b-instruct", "meta-llama/llama-3.3-70b-instruct:free"],
    "chat_free_only":  ["gemini-2.5-flash-lite@free", "llama-3.3-70b-versatile", "@cf/meta/llama-3.1-8b-instruct", "meta-llama/llama-3.3-70b-instruct:free"],
    "nightly_facts":   ["gemini-2.5-flash-lite"],
    "question_gen":    ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
    "vision_check":    ["gemini-2.5-flash-lite@free", "gemini-2.5-flash"],
    "lesson_analysis": ["gemini-2.5-pro", "claude-sonnet-4-5"],
    "research":        ["gemini-2.5-flash"],
    "embedding":       ["gemini-embedding-001"]
  }
}
```

### 4.1 `question-item.schema.json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ogrenmen.easy/schemas/question-item.json",
  "$comment": "v1 — cevap anahtarı BU NESNEDE YOKTUR; secure.answer_keys ve answer-key.schema.json ayrı",
  "type": "object",
  "required": ["schema_version", "curriculum_code", "skill_ids", "stem", "options", "source", "verification"],
  "properties": {
    "schema_version": { "const": 1 },
    "id": { "type": "string", "format": "uuid" },
    "curriculum_code": { "type": "string", "pattern": "^[A-Z]{2,5}-[A-Z]{2,5}@[0-9]{4}$", "examples": ["TYT-MAT@2026"] },
    "skill_ids": { "type": "array", "minItems": 1, "maxItems": 3, "items": { "type": "string", "pattern": "^[a-z0-9.-]+$" } },
    "stem": { "type": "string", "minLength": 10, "maxLength": 900 },
    "stem_values": { "type": "object", "additionalProperties": { "type": ["number", "string"] }, "description": "Şekil denetiminin karşılaştırdığı sayısal değerler (kenar, açı, eksen)" },
    "figure": {
      "type": ["object", "null"],
      "required": ["tool", "code", "alt_text"],
      "properties": {
        "tool": { "enum": ["matplotlib", "svg", "tikz", "vega-lite", "schemdraw", "rdkit", "graphviz", "latex", "template"] },
        "code": { "type": "string", "maxLength": 6000 },
        "alt_text": { "type": "string", "minLength": 15, "maxLength": 400 },
        "expected_px": { "type": "object", "properties": { "min_w": { "type": "integer" }, "max_w": { "type": "integer" }, "min_h": { "type": "integer" }, "max_h": { "type": "integer" } } }
      }
    },
    "options": {
      "type": "array", "minItems": 4, "maxItems": 5,
      "items": {
        "type": "object", "required": ["key", "text"],
        "properties": {
          "key": { "enum": ["A", "B", "C", "D", "E"] },
          "text": { "type": "string", "maxLength": 200 },
          "misconception_tag": { "type": ["string", "null"], "pattern": "^[A-Z]{3}-[A-Z]{2,4}-[0-9]{2}$", "description": "Yanlış şıkların kodladığı yanılgı; doğru şıkta null. Hangi şıkkın doğru olduğu buradan ÇIKARILAMAZ: en az bir yanlış şık da null olabilir." }
        }
      }
    },
    "difficulty": { "type": "number", "minimum": 0, "maximum": 1 },
    "source": { "enum": ["template", "llm", "instructor"] },
    "template": { "type": "object", "properties": { "id": { "type": "string" }, "params": { "type": "object" } } },
    "verification": {
      "type": "object", "required": ["schema", "sympy", "render", "vision", "status"],
      "properties": {
        "schema": { "type": "boolean" },
        "sympy":  { "enum": ["verified", "failed", "not_applicable", "pending"] },
        "render": { "enum": ["ok", "failed", "size_mismatch", "not_applicable", "pending"] },
        "vision": { "enum": ["match", "mismatch", "not_applicable", "pending"] },
        "attempts": { "type": "integer", "minimum": 0, "maximum": 3 },
        "status": { "enum": ["draft", "pending_review", "approved", "rejected", "retired"] },
        "review_note": { "type": "string" }
      }
    },
    "provenance": { "type": "object", "properties": { "model": { "type": "string" }, "cost_usd": { "type": "number" }, "prompt_version": { "type": "string" }, "created_at": { "type": "string", "format": "date-time" } } }
  }
}
```

`answer-key.schema.json` (yalnız pipeline ↔ `secure.answer_keys`; Worker bu şemayı **içe almaz**, `check_sql.py`/eslint kuralı `apps/worker` içinde `answer-key` dizesini yasaklar):

```json
{ "$id": "https://ogrenmen.easy/schemas/answer-key.json", "type": "object",
  "required": ["question_id", "correct_option", "solution"],
  "properties": {
    "question_id": { "type": "string", "format": "uuid" },
    "correct_option": { "enum": ["A", "B", "C", "D", "E"] },
    "numeric_answer": { "type": ["string", "null"] },
    "solution": { "type": "string", "maxLength": 2000 },
    "sympy_check": { "type": "object", "properties": { "verified": { "type": "boolean" }, "expr": { "type": "string" }, "value": { "type": "string" } } }
  }, "additionalProperties": false }
```

### 4.2 `lesson-analysis.schema.json`

```json
{
  "$id": "https://ogrenmen.easy/schemas/lesson-analysis.json", "type": "object",
  "required": ["schema_version", "lesson_ref", "student_ref", "skills", "questions", "hesitations", "misconceptions", "commitments", "talk", "next_step", "model_notes"],
  "properties": {
    "schema_version": { "const": 1 },
    "lesson_ref": { "type": "string", "format": "uuid" },
    "student_ref": { "type": "string", "pattern": "^s_[a-z2-7]{12}$" },
    "duration_min": { "type": "integer" },
    "skills": { "type": "array", "items": { "type": "object", "required": ["skill_id", "mastery_estimate", "evidence"],
      "properties": {
        "skill_id": { "type": "string" },
        "mastery_estimate": { "type": "number", "minimum": 0, "maximum": 1 },
        "evidence": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/evidence" } } } } },
    "questions": { "type": "array", "items": { "type": "object", "required": ["t", "quote"], "properties": { "t": { "$ref": "#/$defs/ts" }, "quote": { "type": "string", "maxLength": 300 }, "skill_id": { "type": ["string", "null"] } } } },
    "hesitations": { "type": "array", "items": { "type": "object", "required": ["t", "kind"], "properties": { "t": { "$ref": "#/$defs/ts" }, "kind": { "enum": ["said_dont_understand", "long_silence", "wrong_answer", "asked_repeat"] }, "quote": { "type": "string" } } } },
    "misconceptions": { "type": "array", "items": { "type": "object", "required": ["text", "evidence"], "properties": { "tag": { "type": ["string", "null"] }, "skill_id": { "type": ["string", "null"] }, "text": { "type": "string", "maxLength": 300 }, "evidence": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/evidence" } }, "resolved_in_lesson": { "type": "boolean" } } } },
    "commitments": { "type": "array", "items": { "type": "object", "required": ["who", "text"], "properties": { "who": { "enum": ["EĞİTMEN", "ÖĞRENCİ"] }, "text": { "type": "string" }, "due": { "type": ["string", "null"], "format": "date" }, "t": { "$ref": "#/$defs/ts" } } } },
    "talk": { "type": "object", "required": ["student_ratio", "student_questions"], "properties": { "student_ratio": { "type": "number", "minimum": 0, "maximum": 1 }, "student_questions": { "type": "integer" }, "attention_notes": { "type": "string" } } },
    "previous_profile_check": { "type": "array", "items": { "type": "object", "properties": { "misconception_tag": { "type": "string" }, "status": { "enum": ["still_present", "improved", "not_observed"] }, "evidence": { "$ref": "#/$defs/evidence" } } } },
    "next_step": { "type": "object", "required": ["for_student", "for_instructor"], "properties": { "for_student": { "type": "string", "maxLength": 400 }, "for_instructor": { "type": "string", "maxLength": 400 } } },
    "model_notes": { "type": "object", "required": ["model", "prompt_version", "cost_usd", "tokens_in", "tokens_out"], "properties": { "model": { "type": "string" }, "prompt_version": { "type": "string" }, "cost_usd": { "type": "number" }, "tokens_in": { "type": "integer" }, "tokens_out": { "type": "integer" } } }
  },
  "$defs": {
    "ts": { "type": "string", "pattern": "^[0-9]{2}:[0-9]{2}:[0-9]{2}$" },
    "evidence": { "type": "object", "required": ["t", "speaker", "quote"], "properties": { "t": { "$ref": "#/$defs/ts" }, "speaker": { "enum": ["EĞİTMEN", "ÖĞRENCİ"] }, "quote": { "type": "string", "minLength": 5, "maxLength": 300 } } }
  }
}
```

### 4.3 `memory-fact.schema.json` ve `weekly-summary.schema.json`

```json
{ "$id": "https://ogrenmen.easy/schemas/memory-fact.json", "type": "object",
  "required": ["student_ref", "kind", "text", "source_message_ids", "confidence"],
  "properties": {
    "student_ref": { "type": "string", "pattern": "^s_[a-z2-7]{12}$" },
    "kind": { "enum": ["promise", "deadline", "unanswered_question", "morale", "topic_asked", "preference", "instructor_fact", "other"] },
    "text": { "type": "string", "minLength": 8, "maxLength": 300, "description": "İsim yok; 'öğrenci' veya 'eğitmen' der" },
    "source_message_ids": { "type": "array", "minItems": 1, "maxItems": 8, "items": { "type": "integer" } },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "valid_until": { "type": ["string", "null"], "format": "date" },
    "morale_signal": { "type": ["integer", "null"], "minimum": -2, "maximum": 2 },
    "requires_approval": { "type": "boolean", "description": "not/devamsızlık/puan/ödeme içeriyorsa true; bot approved olmadan kullanmaz" }
  }, "additionalProperties": false }
```

Gece işinin çıktısı `{ "day": "2026-10-19", "student_ref": "...", "facts": [memory-fact...], "answered_question_message_ids": [..], "is_question_message_ids": [..] }` (`nightly-facts-output.schema.json`).

```json
{ "$id": "https://ogrenmen.easy/schemas/weekly-summary.json", "type": "object",
  "required": ["student_ref", "week_start", "body", "metrics", "facts_used"],
  "properties": {
    "student_ref": { "type": "string" }, "week_start": { "type": "string", "format": "date" },
    "body": { "type": "string", "maxLength": 600 },
    "metrics": { "type": "object", "required": ["messages", "questions_solved", "accuracy", "active_days", "open_misconceptions", "morale_trend"],
      "properties": { "messages": { "type": "integer" }, "questions_solved": { "type": "integer" }, "accuracy": { "type": ["number", "null"] }, "active_days": { "type": "integer", "maximum": 7 }, "open_misconceptions": { "type": "integer" }, "morale_trend": { "enum": ["up", "flat", "down", "unknown"] }, "mastery_deltas": { "type": "array", "items": { "type": "object", "properties": { "skill_id": { "type": "string" }, "delta": { "type": "number" } } } } } },
    "facts_used": { "type": "array", "items": { "type": "integer" } },
    "next_week_focus": { "type": "array", "maxItems": 3, "items": { "type": "string" } }
  }, "additionalProperties": false }
```

### 4.4 `research-output.schema.json` (+ `citation`)

```json
{ "$id": "https://ogrenmen.easy/schemas/research-output.json", "type": "object",
  "required": ["request_id", "query", "expanded_queries", "synthesis", "citations", "matrix", "cost_usd"],
  "properties": {
    "request_id": { "type": "string", "format": "uuid" },
    "query": { "type": "string" },
    "expanded_queries": { "type": "array", "minItems": 3, "maxItems": 5, "items": { "type": "string" } },
    "synthesis": { "type": "array", "items": { "type": "object", "required": ["text", "cites"], "properties": { "text": { "type": "string", "maxLength": 1200 }, "cites": { "type": "array", "minItems": 1, "items": { "type": "string", "description": "citation.doi" } } } }, "description": "Her paragraf en az bir doğrulanmış DOI'ye bağlı" },
    "citations": { "type": "array", "items": { "$ref": "#/$defs/citation" } },
    "matrix": { "type": "array", "items": { "type": "object", "required": ["doi", "method", "sample", "finding", "limitation"], "properties": { "doi": { "type": "string" }, "method": { "type": "string" }, "sample": { "type": "string" }, "finding": { "type": "string" }, "limitation": { "type": "string" } } } },
    "removed": { "type": "array", "items": { "type": "object", "properties": { "doi_or_title": { "type": "string" }, "reason": { "enum": ["crossref_unresolved", "no_doi", "duplicate", "off_topic"] } } } },
    "cost_usd": { "type": "number" }
  },
  "$defs": { "citation": { "type": "object", "required": ["doi", "title", "authors", "year", "crossref_verified"],
    "properties": { "doi": { "type": "string", "pattern": "^10\\.[0-9]{4,9}/\\S+$" }, "title": { "type": "string" }, "authors": { "type": "string" }, "venue": { "type": ["string", "null"] }, "year": { "type": "integer" }, "crossref_verified": { "const": true }, "oa_pdf_url": { "type": ["string", "null"], "format": "uri" }, "tldr": { "type": ["string", "null"], "maxLength": 240 }, "source": { "enum": ["openalex", "semantic_scholar", "arxiv", "crossref"] } } } },
  "additionalProperties": false }
```

`crossref_verified` `const: true` olduğu için doğrulanmamış atıf şemayı **geçemez**; pipeline onu `removed` listesine taşır.

### 4.5 `exam-item.schema.json` ve `exam-priority-plan.schema.json`

```json
{ "$id": "https://ogrenmen.easy/schemas/exam-item.json", "type": "object",
  "required": ["source_id", "item_no", "topic", "kind", "points", "year"],
  "properties": { "source_id": { "type": "string", "format": "uuid" }, "item_no": { "type": "integer" }, "topic": { "type": "string" }, "kind": { "enum": ["proof", "calc", "mc", "other"] }, "points": { "type": ["number", "null"] }, "year": { "type": "integer" }, "term": { "type": ["string", "null"] }, "instructor_alias": { "type": ["string", "null"] }, "skill_id": { "type": ["string", "null"] }, "ocr_text": { "type": "string", "description": "yalnız eğitmen arşivi; hiçbir öğrenci çıktısına kopyalanmaz" }, "ocr_confidence": { "type": "number" } }, "additionalProperties": false }
```

```json
{ "$id": "https://ogrenmen.easy/schemas/exam-priority-plan.json", "type": "object",
  "required": ["course", "period", "title", "years_total", "rows", "evidence_count", "generated_at"],
  "properties": {
    "course": { "type": "string" }, "period": { "type": "string" },
    "title": { "const": "Sıklık analizine göre öncelikler" },
    "years_total": { "type": "integer", "minimum": 2 },
    "rows": { "type": "array", "maxItems": 10, "items": { "type": "object", "required": ["rank", "topic", "kind", "hits", "years", "points_text", "evidence_count", "evidence_item_ids"],
      "properties": { "rank": { "type": "integer" }, "topic": { "type": "string" }, "kind": { "type": "string" }, "skill_id": { "type": ["string", "null"] }, "hits": { "type": "integer" }, "years": { "type": "integer" }, "points_text": { "type": "string", "pattern": "^≈[0-9]+ puan$" }, "evidence_count": { "type": "integer", "minimum": 1 }, "evidence_item_ids": { "type": "array", "items": { "type": "string", "format": "uuid" } }, "syllabus_alignment": { "enum": ["covered_and_asked", "covered_never_asked", "asked_not_in_syllabus"] }, "variant_question_ids": { "type": "array", "items": { "type": "string", "format": "uuid" } } } } },
    "others": { "type": "array", "items": { "type": "string" } },
    "evidence_count": { "type": "integer" },
    "forbidden_words_check": { "const": true, "description": "pipeline 'tahmin|çıkacak|kesin|garanti' taraması geçti" },
    "generated_at": { "type": "string", "format": "date-time" }
  }, "additionalProperties": false }
```

### 4.6 `bot-response-log.schema.json`

```json
{ "$id": "https://ogrenmen.easy/schemas/bot-response-log.json", "type": "object",
  "required": ["chat_id", "purpose", "provider_attempts", "cost_usd", "latency_ms", "cache_hit", "degraded_mode", "memory_fact_ids", "recent_message_ids"],
  "properties": {
    "in_message_id": { "type": ["integer", "null"] }, "chat_id": { "type": "integer" }, "student_id": { "type": ["string", "null"], "format": "uuid" },
    "out_telegram_message_id": { "type": ["integer", "null"] },
    "purpose": { "enum": ["chat", "feedback", "hint", "command", "proactive", "escalation", "quota", "consent"] },
    "prompt_version": { "type": ["string", "null"] }, "prompt_hash": { "type": ["string", "null"] }, "prompt_sample": { "type": ["string", "null"], "maxLength": 12000 },
    "memory_fact_ids": { "type": "array", "items": { "type": "integer" } }, "recent_message_ids": { "type": "array", "items": { "type": "integer" } },
    "pool_id": { "type": ["string", "null"] }, "cache_hit": { "type": "boolean" },
    "provider_attempts": { "type": "array", "items": { "type": "object", "required": ["provider", "model", "status"], "properties": { "provider": { "type": "string" }, "model": { "type": "string" }, "status": { "enum": ["ok", "error", "rate_limited", "timeout", "cap_blocked", "cooldown_skip"] }, "tokens_in": { "type": "integer" }, "tokens_out": { "type": "integer" }, "cost_usd": { "type": "number" }, "latency_ms": { "type": "integer" }, "error_code": { "type": ["string", "null"] } } } },
    "cost_usd": { "type": "number" }, "latency_ms": { "type": "integer" }, "confidence": { "type": ["number", "null"] },
    "escalated": { "type": "boolean" }, "quota_state": { "type": "object", "properties": { "used": { "type": "integer" }, "limit": { "type": "integer" } } },
    "degraded_mode": { "type": "boolean" }
  }, "additionalProperties": false }
```

`provider_attempts` her satırı `llm_calls`'a ayrı yazılır (`purpose='chat'`, `student_ref`); `fallback_chain` sütunu `provider:status` dizisi olarak türetilir.

### 4.7 `instructor-alert.schema.json`

```json
{ "$id": "https://ogrenmen.easy/schemas/instructor-alert.json", "type": "object",
  "required": ["kind", "severity", "student_ref", "detail", "since"],
  "properties": {
    "kind": { "enum": ["unanswered", "silent", "morale", "deadline", "response"] },
    "severity": { "enum": ["danger", "warning", "neutral"] },
    "student_ref": { "type": "string" }, "staff_ref": { "type": ["string", "null"] },
    "detail": { "type": "string", "maxLength": 240, "description": "Tek cümle; cevapsız soruda sorunun kendisi tırnak içinde; yargı yok ('göstergesi düştü')" },
    "since": { "type": "string", "format": "date-time" },
    "ref": { "type": "object", "properties": { "message_id": { "type": "integer" }, "fact_id": { "type": "integer" }, "escalation_id": { "type": "string" } } }
  }, "additionalProperties": false }
```

### 4.8 Chat yapılandırılmış çıktısı — `tutor-reply.schema.json`

LLM'den sohbet cevabı serbest metin değil bu nesneyle alınır; `reply` telegram.md kurallarına göre son kontrolden geçer (satır sayısı ≤ 4, emoji yok, yasaklı kelimeler).

```json
{ "$id": "https://ogrenmen.easy/schemas/tutor-reply.json", "type": "object",
  "required": ["reply", "confidence", "escalate", "detected_skill_ids", "used_fact_ids"],
  "properties": {
    "reply": { "type": "string", "maxLength": 700 },
    "ends_with_question": { "type": "boolean" },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "escalate": { "type": "boolean" }, "escalate_reason": { "type": ["string", "null"], "enum": ["bot_unsure", "grade_attendance_payment", "human_requested", null] },
    "detected_skill_ids": { "type": "array", "maxItems": 2, "items": { "type": "string" } },
    "detected_misconception_tag": { "type": ["string", "null"] },
    "used_fact_ids": { "type": "array", "items": { "type": "integer" } },
    "suggest_pool_save": { "type": "boolean", "description": "Cevap genel bir açıklamaysa content_pool adayı" }
  }, "additionalProperties": false }
```

## 5. Worker (Telegram botu)

Dizin `apps/worker/` (M03). TypeScript strict, bağımlılık az: `@ogrenmen/contracts`, `@ogrenmen/mastery-math`, `zod` yok (ajv contracts'tan gelir), `grammy` **yok** (webhook + 12 API metodu; kendi ince istemcimiz, bundle küçük, davranış şeffaf).

```
apps/worker/
├── wrangler.toml                 name="ogrenmen-bot", compatibility_date, [triggers] crons, [ai] binding="AI", [vars] PUBLIC_*, [observability] enabled
├── package.json  tsconfig.json  vitest.config.ts
├── src/
│   ├── index.ts                  export default { fetch, scheduled }
│   ├── env.ts                    Env tipi + zorunlu secret kontrolü (eksikse /health 500, boot'ta log)
│   ├── telegram/
│   │   ├── client.ts             sendMessage, sendPhoto, editMessageText, answerCallbackQuery, pinChatMessage, getChatMember, setWebhook
│   │   ├── types.ts              Update/Message/CallbackQuery (gereken alt küme)
│   │   ├── verify.ts             X-Telegram-Bot-Api-Secret-Token + path secret
│   │   └── format.ts             telegram.md kuralları: ≤4 satır, kalın/kod, A·B·C·D klavyesi, Türkçe sayı biçimi
│   ├── router/                   update → handler
│   │   ├── dispatch.ts           private/group, command/callback/text/new_member
│   │   ├── commands/{start,cevap,mod,yardim,test,ilerleme,hoca,durdur}.ts
│   │   ├── flows/{consent,diagnostic,chat,quota}.ts
│   │   └── groups/{roles,mention,escalation,recording-notice}.ts
│   ├── llm/
│   │   ├── router.ts             zincir, 429/5xx düşüş, cooldown, tavan kontrolü, yapılandırılmış çıktı
│   │   ├── providers/{gemini,openai-compatible,workers-ai}.ts   ortak Provider arayüzü
│   │   ├── cost.ts               models.json'dan fiyatlama (tokens → usd)
│   │   ├── prompts/socratic.v3.md, direct.v2.md, group.v1.md, consent.v1.md (prompt_version = dosya adı)
│   │   └── guard.ts              çıktı kuralları (emoji/ünlem/yasak kelime/satır sayısı), PII temizleyici
│   ├── data/
│   │   ├── supabase.ts           PostgREST istemcisi: bot_runtime JWT üretimi, X-Ogrenmen-Student başlığı, rpc()
│   │   ├── repo.ts               consumeQuota, gradeAttempt, retrieveMemory, logBotResponse, checkSpend, ...
│   │   └── embeddings.ts         Gemini embedding (768) → halfvec string; hata → null (FTS'e düşer)
│   ├── ops/
│   │   ├── spend.ts              tavan durum makinesi (normal → free_only → degraded)
│   │   ├── metrics.ts            /metrics (Prometheus metni; yalnız METRICS_TOKEN ile)
│   │   └── alerts.ts             kurucuya Telegram DM (ADMIN_CHAT_ID)
│   └── cron/{hourly,proactive,alerts,keepalive}.ts
└── test/
    ├── fakes/telegram-server.ts  Bun/undici ile sahte Bot API: sendUpdate, outbox, setWebhook kaydı
    ├── fakes/supabase.ts         bellek içi PostgREST + RPC taklidi (fixtures'tan seed); RLS taklidi: başlıksız öğrenci erişimi hata
    ├── fakes/providers.ts        deterministik LLM (şablon cevap), 429/500/timeout senaryoları, token sayacı
    ├── scenarios/*.test.ts       start-consent, diagnostic-flow, chat-socratic, quota-exhaust, fallback-chain, cap-reached, group-escalation, dedup
    └── fixtures → ../../fixtures/telegram (symlink değil; vitest alias)
```

### 5.1 Webhook doğrulama ve giriş

- Yol: `POST /telegram/${WEBHOOK_SECRET_PATH}` (32 bayt rastgele). Ayrıca `setWebhook(secret_token=TELEGRAM_WEBHOOK_SECRET)` ile her istekte `X-Telegram-Bot-Api-Secret-Token` eşitliği (`crypto.subtle.timingSafeEqual`). İkisi de yoksa `404` (varlığı sızdırmaz).
- `allowed_updates = ["message","edited_message","callback_query","my_chat_member","chat_member"]`.
- Dedup: `insert into tg_updates(update_id)`; `23505` → `200 OK` ve çık (Telegram tekrar gönderimi).
- Her zaman `200` döneriz (Telegram yeniden denemesini durdurmak için); hata iç loglanır ve kullanıcıya uygun kısa mesaj gider. `ctx.waitUntil` ile log yazımı yanıtı bekletmez, ama **LLM cevabı gönderilmeden önce `log_bot_response` başarıyla yazılmış olmalıdır** (kayıt yoksa cevap yok kuralı); yazım başarısızsa cevap "Şu an yanıt veremiyorum, hocana yazabilirsin" + `escalations(degraded)`.
- Boyut: 64 KB üstü gövde reddedilir; 4.000 karakter üstü metin kırpılır ve "mesajını kısaltarak okudum" denir.

### 5.2 Yönlendirme ve komutlar

`dispatch(update)` sırası: dedup → chat kaydı (`tg_chats` upsert) → gönderen rolü (`chat_roles`) → onay kapısı → komut/callback/metin.

| Komut | Davranış (telegram.md'ye uygun metinler) | LLM |
| --- | --- | --- |
| `/start` | "Merhaba, ben Öğrenmen. easy'nin yapay zekâ öğretmeniyim; hocaların da bu grupta." (kısaltılmaz). `register_student`. Onay yoksa onay akışı (5.3). Onay varsa teşhis yapılmamışsa "Seni tanımak için 15 soruluk kısa bir test var. Başlayalım mı?" [Teste başla · Sonra]. | Hayır |
| `/test` | Teşhis veya 10 soruluk konu testi (`consume_quota('test')`). Şıklar A·B·C·D düğmesi; cevap `grade_attempt` → "✓ Doğru" / "✕ Tekrar dene" + havuzdan tek cümle gerekçe. | Hayır (gerekçe `content_pool`'dan; havuzda yoksa ve `pending_review` üretimi kapalıysa `misconception_tags.text_student`) |
| `/cevap` | `sessions.direct_once=true`; "Tamam, bu soruda çözümü doğrudan göstereceğim." Sıradaki soru çözümü `reveal_solution` (sunucu metni) + gerekirse LLM sadeleştirme **yok** (çözüm metni zaten anahtarla yazılmış). | Hayır |
| `/mod` | Oturum modunu kalıcı değiştirir [Sokratik · Doğrudan]; `preferences.default_mode` değişmez (sistem kendiliğinden açmaz, öğrenci seçer). | Hayır |
| `/ilerleme` | Kazanım başına ustalık: `evidence_count ≥ 5` ise `%72`, değilse "henüz yeterli kanıt yok"; en fazla 6 satır, iki mesaj. | Hayır |
| `/hoca <metin>` | Grupta eğitmeni etiketler, `escalations(human_requested)`; özelde "Hocana ilettim; cevabı burada göreceksin." | Hayır |
| `/yardim` | Komut listesi, kota durumu, "Verilerin nasıl kullanılıyor?" bağlantısı. | Hayır |
| `/durdur` | Proaktif mesajları kapatır (`preferences.active_hours = '{}'`). | Hayır |
| Serbest metin (özel) | 5.5 sohbet akışı. | Evet (kota + tavan izin verirse) |
| Serbest metin (grup) | Yalnız bot etiketlendiğinde, yanıtlandığında veya mesaj soru işaretiyle bitip 10 dk içinde eğitmen yanıtı gelmediğinde (cron) yanıt; aksi hâlde yalnız `messages`'a kayıt. | Koşullu |
| Callback `ans:<session>:<idx>:<key>` | `grade_attempt`; düğmeler kilitlenir (`editMessageReplyMarkup`). | Hayır |
| `my_chat_member` (gruba eklendi) | Kayıt bildirimi (`guven-ve-seffaflik.md` metni, `retention_days` ile) gönder + sabitle; `privacy_mode_off_verified` için `getMe`'den `can_read_all_group_messages` kontrolü; kapalıysa koordinatöre uyarı. | Hayır |
| `chat_member` (yeni üye) | Kayıt bildirimi yeni üyeye tekrar. | Hayır |

Sonuç: öğrenci etkileşimlerinin ~%30–40'ı (komutlar, şık cevapları, kota/ilerleme) **sıfır model çağrısı** ile biter.

### 5.3 Durum: onay kapısı ve oturum modu

- `consent_ok(student)`: `kvkk_student` verilmiş **ve** (`is_minor` ise `guardian` verilmiş). Değilse her metin mesajına tek cevap: aydınlatma özeti (`legal` ton, 4 satır) + "Devam etmek için onay gerekiyor" + [Metni oku · Onaylıyorum]; reşit değilse "Velinin onayı gerekiyor. Veline bu bağlantıyı iletebilirsin: <panel onay formu bağlantısı, tek kullanımlık token>". Veli formu panelde (`/onay/<token>`), koordinatör de elle `record_consent` yapabilir. Onaysız öğrencinin mesajları **`messages`'a yazılmaz** (yalnız `tg_updates` dedup) — veri işlenmez.
- `sessions` satırı öğrenci×chat; `mode` ve `direct_once`; `state.flow` ∈ {idle, diagnostic, test, chat}; 6 saat hareketsizlikte `flow=idle` (cron).
- Yaş bilgisi yoksa `is_minor = true` varsayılır (güvenli taraf).

### 5.4 Kotalar

- `consume_quota` her LLM'li mesajda ve her testte; komutlar kota tüketmez.
- `remaining = 5` → bir kez: "5 mesaj hakkın kaldı; yarın 00:00'da yenilenir."
- Dolunca: "Bugünlük mesaj hakkın doldu (25/25). Yarın 00:00'da yenilenir. Acil bir sorun varsa hocanı etiketleyebilirsin." Mesaj yine `messages`'a kaydedilir (hafıza için), LLM çağrılmaz, `bot_responses(purpose='quota', cost 0)`.
- Patlama koruması (öğrenci başına 1 mesaj/3 sn): `sessions.last_activity_at` ile; aşan mesajlar birleştirilir ("iki mesajını birlikte okudum").
- Gruplarda kota öğrenciye işlenir (etiketleyen öğrenci); eğitmenlerin bot'a soruları ayrı `staff` kotası (günde 50, ölçüm amaçlı).

### 5.5 Sohbet akışı ve Sokratik prompt

Adımlar (hepsi tek `handleChat`):

1. `consume_quota('message')` → izin yok ise kota mesajı.
2. **DB-önce kısa devre**: metin bir soru numarası/şık ise → `grade_attempt`; "ilerleme/kota/ne zaman" kalıpları → şablon; `content_pool` **anahtar eşlemesi**: oturumda aktif kazanım + son yanılgı etiketi + mod için `approved` kayıt varsa ve öğrenci mesajı "anlamadım / tekrar / neden" türünden (regex seti) ise havuzdan ver (`cache_hit=true`, `pool_hit`). Beklenen havuz isabeti pilotta %15–25.
3. `check_spend('chat')` → `paid_allowed`, `degraded`. Degraded ise 5.7.
4. Bağlam: `recent_messages(6)` (temizlenmiş), `retrieve_memory(k=5)` (sorgu embedding'i: öğrenci mesajı; embedding hatasında FTS), profil görünümü (`v_profile_for_prompt`: en zayıf 3 kazanım yalnız `evidence_count ≥ 5` olanlardan, açık yanılgılar `text_instructor`, ön koşul ipucu, tercih notu) — toplam ≤ 900 token.
5. Prompt `socratic.v3.md` (≈ 650 token sabit; sağlayıcı önbelleğinden yararlanmak için sabit kısım başta) + bağlam + öğrenci mesajı; `responseSchema = tutor-reply`; `max_output_tokens = runtime_flags.chat_max_tokens_out (220)`; `temperature 0.4`.
6. `guard.check(reply)`: ≤ 4 satır (fazlaysa ikinci mesaja böl, ikinciyi soruyla bitir), emoji/ünlem yok, yasak kelimeler ("kesin", "çıkacak", "tahmin" sınav bağlamında; "Yanlış!"), `confidence < 0.55` veya `escalate` → yükseltme metni ("Bundan emin değilim; hocana soralım." + `@hoca` etiketi grupta) ve `escalations`.
7. `log_bot_response` → başarılıysa `sendMessage`; `out_telegram_message_id` güncellenir.
8. `detected_skill_ids/misconception_tag` varsa `record_chat_observation` (kind `chat_question`/`chat_misconception`, kanıt = temizlenmiş mesaj ≤ 240 karakter). Bu **p'yi değiştirmez**, evidence sayar.
9. `suggest_pool_save && confidence ≥ 0.8` → `content_pool(pending_review)` adayı (eğitmen onayından sonra yeniden kullanılır).

`socratic.v3.md` iskeleti (Türkçe; kısaltılmış):

```
Sen Öğrenmen'sin: easy'nin yapay zekâ öğretmeni. Öğrenciye "sen" diye hitap et; sıcak ama ciddi.
KURALLAR: (1) Bir balonda tek fikir, en fazla 4 satır. (2) Cevabı verme; bir ipucu ver ve bir soruyla bitir. 
(3) Yanlışta "Tekrar dene" de, nedenini tek cümleyle açıkla; "Yanlış!" yazma, ünlem ve emoji kullanma.
(4) Not, puan, devamsızlık, ödeme hakkında konuşma: escalate=true, reason=grade_attendance_payment.
(5) Emin değilsen uydurma: confidence düşük ver, escalate=true. (6) Sınav için "çıkacak/kesin/tahmin" deme.
(7) Formül düz metin ve `kod` biçiminde: `3/4 + 1/8 = 7/8`. (8) Öğrencinin adını bilmiyorsun; sorma.
BAĞLAM: Mod: {{mode}}. Kazanım profili (yalnız yeterli kanıtlı): {{profile}}. Açık yanılgılar: {{misconceptions}}.
Hafıza (olgu no ile): {{facts}}. Son mesajlar: {{recent}}. 
Çıktı: tutor-reply JSON. used_fact_ids: gerçekten kullandığın olgu numaraları.
```

`direct.v2.md` farkı: "Çözümü adım adım ver; her balonda tek adım; son adımda cevabı **kalın** yaz."

### 5.6 LLM yönlendirici, maliyet tablosu, tavanlar

**Provider arayüzü**

```ts
interface Provider {
  id: string;                                  // 'gemini-paid' | 'gemini-free' | 'groq' | 'cf-ai' | 'openrouter'
  complete(req: { model: string; system: string; messages: Msg[]; schema?: JsonSchema; maxTokens: number; temperature: number; timeoutMs: number }):
    Promise<{ text: string; json?: unknown; tokensIn: number; tokensOut: number; latencyMs: number } | { error: 'rate_limited' | 'server' | 'timeout' | 'bad_output'; status?: number; retryAfterMs?: number }>;
  embed?(texts: string[], dims: number): Promise<number[][]>;
}
```

**Zincir ve düşüş kuralı** (`chains.chat` models.json'dan): sağlayıcı sırayla denenir; `rate_limited` (429) veya `server` (5xx) → bir sonrakine; `timeout` (8 sn) → bir sonrakine; `bad_output` (şema geçmez) → aynı sağlayıcıda 1 onarım denemesi ("yalnız JSON döndür"), sonra sonraki. Her 429'da `provider_health.cooldown_until = now + retry_after | 60 sn` (üst üste 3 hatada 10 dk); cooldown'daki sağlayıcı `cooldown_skip` ile atlanır (çağrı yapılmaz; `llm_calls`'a yine yazılır, maliyet 0). Tüm zincir düşerse → şablon cevap: "Şu an yanıt üretemiyorum. Birkaç dakika sonra tekrar dene; acilse hocanı etiketle." + `escalations(degraded)`; `bot_responses.degraded_mode=true`.

**Maliyet hesabı**: `cost = tokens_in × in_per_m/1e6 + tokens_out × out_per_m/1e6`; Workers AI için `neurons = tokens/1000 × 1.7` sayılır, dolar 0 (günlük 10.000 neuron tavanı `provider_health`'te ayrı sayaç; dolunca `cooldown_until` gün sonu). Her denemenin maliyeti `provider_attempts` ile `log_bot_response`'a.

**Tur başına bütçe** (ölçülebilir, `test/scenarios/cost-budget.test.ts` sahte sağlayıcının token sayacıyla doğrular): sistem+kurallar 650 + profil 250 + 5 olgu × 60 = 300 + 6 mesaj × 80 = 480 + öğrenci 120 = **≈ 1.800 giriş**, çıkış ≤ 220 (ortalama 160). Flash-Lite: `1800×0.10/1e6 + 160×0.40/1e6 = 0.00018 + 0.000064 = 0.000244 $` → **0,00025 $/tur**. Test, prompt bütçesini 2.200 giriş tokenla sınırlar (aşarsa `recent` 4'e, `facts` 3'e düşürülür).

**Aylık kanıt (300 öğrenci):**

| Kalem | Hesap | $/ay |
| --- | --- | --- |
| Sohbet turu (ücretli Flash-Lite) | 300 × 150 tur × 0,00025 | 11,25 |
| Gece olgu çıkarımı (Batch %50) | 300 × %60 aktif × 30 gün = 5.400 iş × (3.000 giriş + 300 çıkış = 0,00042) × 0,5 | 1,13 |
| Haftalık özet (Batch) | 1.200 × (2.000 + 300 = 0,00032) × 0,5 | 0,19 |
| Tablet üretim + vision (Batch; vision ücretsiz katman) | 300 soru × 0,00063 × 0,5 + %30 yeniden deneme | 0,16 |
| Kalem OCR (ayda ~50 sayfa, Flash vision) | 50 × 0,0006 | 0,03 |
| Kitap (ayda 40 araştırma tavanı; TYT pilotunda kapalı) | 40 × (75k giriş + 2k çıkış Flash = 0,0275) | 1,10 |
| Embedding, proaktif, komutlar, teşhis, geri bildirim | DB/ücretsiz | 0,00 |
| **Toplam** | | **13,86** |
| %40 güvenlik payı (uzun mesajlar, onarım denemeleri, prompt büyümesi) | | 5,54 |
| **Planlanan** | | **≈ 19,4** |

Düşüşler ücretsiz katmanlara gittiği için gerçek fatura bunun **altında** kalır; ücretsiz sağlayıcı payı `spend_ledger`'da `provider` kırılımıyla görünür. Ders videosu (ders başına 0,2–0,5 $) ayrı bütçe kalemidir ve ders ücretine yansıtılır.

**Tavan durum makinesi** (`ops/spend.ts`, kaynak `check_spend` + `runtime_flags`):

| Durum | Koşul | Davranış |
| --- | --- | --- |
| `normal` | gün < 0,80 $ ve ay < 24 $ | `chains.chat` |
| `free_only` | gün ≥ 0,80 $ **veya** ay ≥ 24 $ **veya** `paid_llm_enabled=false` | `chains.chat_free_only`; gece toplu işler Batch'i erteler (bir sonraki güne), Tablet üretimi durur, araştırma kuyruğu `blocked_quota` |
| `degraded` | `free_only`'de tüm ücretsiz sağlayıcılar cooldown'da **veya** `degraded_mode=true` | LLM yok: komutlar, testler, havuz cevapları, şablon + yükseltme çalışır; her 15 dk bir deneme |

Uyarılar (`ops/alerts.ts`, saatlik cron ve her durum geçişinde): gün/ay toplamı eşiklerin (%50, %80, %100) birini ilk kez geçince kurucuya Telegram DM ("Ekim: 12,4 $ / 24 $ (%52). Bugün 0,31 $. Ücretsiz pay %38.") ve `instructor_alerts(kind='response', severity)` koordinatöre. Dış kemer: Google Cloud'da Gemini projesi için bütçe uyarısı + ön ödemeli 25 $ (kurulum `docs/runbook/accounts.md`).

### 5.7 Hafıza erişimi

`retrieve_memory(student, q_embedding, q_text, k=5)`: hibrit skor; sonuç `used_fact_ids` ile prompt'a numaralı gider; LLM'in bildirdiği `used_fact_ids` `bot_responses.memory_fact_ids`'e yazılır (panelde "kullanılan hafıza olgusu sayısı" = bu dizinin uzunluğu). Embedding çağrısı ücretsiz ama bir ağ turu; `q_text` 12 karakterden kısaysa veya `/`'li komutsa embedding atlanır. `requires_approval=true` olgular (`approved=false`) **asla** prompt'a girmez — not/devamsızlık sorusu geldiğinde `escalate` zorunlu.

### 5.8 Gruplar, roller, yükseltme

- Rol kaynağı `chat_roles`; bilinmeyen üye `other` (mesajı kaydedilir, botla etkileşimi yok, ad yerine kullanıcı adı).
- Bot gruba cevap verirken öğrencinin **kullanıcı adını** kullanır, adını değil.
- Yükseltme metni: "Bunu hocana bırakıyorum. @ayse_hoca, bu soruya bakabilir misin?" (`chat_roles.mention_handle` ilgili `subject`'ten; yoksa koordinatör). `escalations(open)`; eğitmen yanıtlarsa (`reply_to` ile) `mark_answered`; 6 saat yanıtsız → `instructor_alerts(unanswered, danger)`.
- Not/devamsızlık/puan/ödeme kalıpları (`guard.ts` regex + LLM `escalate_reason`): "Bunu hocan söyleyebilir; sorunu ona ilettim." Bot onaylı olgu (`approved=true`, `kind='instructor_fact'`) varsa yalnız onu aktarır: "Hocanın notu: 'Ödev teslimi Cuma.'"
- Çok eğitmenli grupta `@hoca` yönlendirmesi: `/hoca` veya mesajda `@<handle>` varsa bot sessiz kalır, yalnız kaydeder.

### 5.9 Cron (`wrangler.toml [triggers] crons`)

| Cron (UTC) | İş | Not |
| --- | --- | --- |
| `*/15 * * * *` | `cron_due_proactive` → şablon mesajlar (LLM yok): `exam_tomorrow`, `deadline_soon`, `silent_3d` ("Yarın deneme var. Son çalıştığın konu paydalardı; 10 dakikalık bir tekrar ister misin?") | Günde en fazla 1, aktif saatte |
| `5 * * * *` | `cron_open_alerts`; `check_spend` → uyarılar; `provider_health` cooldown temizliği; `sessions` idle | saatlik |
| `0 6 * * *` | Supabase keepalive (`select 1` RPC `ping`) + `/health` kendine | GitHub keepalive.yml ikinci kemer |
| `0 3 * * *` | `runtime_flags.cron_owner='worker'` ise saklama RPC'leri | pg_cron yoksa |

### 5.10 Ortam değişkenleri ve gizli anahtarlar

`wrangler secret put` ile: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `WEBHOOK_SECRET_PATH`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET` (bot_runtime JWT imzası), `GEMINI_PAID_KEY`, `GEMINI_FREE_KEY`, `GROQ_KEY`, `OPENROUTER_KEY`, `ADMIN_CHAT_ID`, `METRICS_TOKEN`. Vars: `PUBLIC_ENV` (dev/prod), `PROMPT_VERSION_CHAT=socratic.v3`. `service_role` anahtarı Worker'da **yoktur**; `env.ts` boot'ta `SUPABASE_SERVICE_ROLE` adlı bir değişken görürse bilerek hata verir. Yerelde `.dev.vars` (gitignore) — testler `.dev.vars` olmadan sahte değerlerle koşar.

### 5.11 Yerel test

- `bun run test`: vitest, `@cloudflare/vitest-pool-workers` (miniflare; `AI` binding'i sahte). Senaryolar `fixtures/telegram/*.json` update'lerini `fetch()`'e verir, `fakes/telegram-server` outbox'ını ve `fakes/supabase` tablolarını denetler. Zorunlu senaryolar: onay kapısı (reşit olmayan, onaysız → mesaj kaydedilmez), teşhis 15 soru akışı ve BKT sonucu (mastery-math vektörleriyle), Sokratik cevap şema/guard kontrolü, kota 25→26, 5 kala uyarı tek sefer, zincir düşüşü (gemini 429 → groq ok; `fallback_chain` doğru), tavan aşımı (`free_only` → yalnız ücretsiz sağlayıcı çağrıldı), tüm sağlayıcılar kapalı (`degraded`, şablon + yükseltme), grup yükseltmesi (`@handle`, `escalations`), webhook dedup, gizli anahtar başlığı yanlış → 404, `answer-key` dizesi kaynakta yok (lint), tur maliyeti ≤ 0,0003 $.
- `bun run dev:fake`: `wrangler dev --port 8787` + `bun test/fakes/telegram-server.ts --port 8788`; `curl -X POST localhost:8788/sendUpdate -d @fixtures/telegram/private_text.json`, `curl localhost:8788/outbox`. `TELEGRAM_API_BASE=http://localhost:8788` ile istemci sahteye gider.
- `bun run typecheck && bun run lint` (eslint: `no-restricted-imports` ile `answer-key`, `service_role`).

### 5.12 Arıza modları ve bozulmuş davranış

| Arıza | Tespit | Davranış | Toparlanma |
| --- | --- | --- | --- |
| Telegram API 5xx/timeout | `client.ts` 2 deneme | Cevap kuyruğa değil; `bot_responses.out_telegram_message_id=null`, kullanıcı tekrar yazarsa normal | Yok (Telegram yeniden webhook atar) |
| Supabase uykuda / 5xx | `repo.ts` hata | `/health` kırmızı; kullanıcıya "Birkaç dakika sonra tekrar dene"; LLM çağrılmaz (kayıt yoksa cevap yok) | keepalive cron + GitHub keepalive |
| Sağlayıcı 429 | `rate_limited` | Zincirde düş, cooldown | Saatlik temizlik |
| Tüm sağlayıcılar kapalı | zincir boş | `degraded` | 15 dk deneme |
| Tavan aşıldı | `check_spend` | `free_only`; kurucuya DM | Ay başı / tavan güncelleme (`set_runtime_flag`) |
| Embedding kapalı | `embed` hata | FTS ile hafıza | Otomatik |
| Şema geçmeyen çıktı | ajv | 1 onarım, sonra düş | — |
| Prompt enjeksiyonu (öğrenci "kuralları unut") | guard: çıktı kuralları çıktıya uygulanır; sistem metni değiştirilemez | Normal kurallar; `confidence` düşükse yükselt | — |
| Webhook seli (aynı chat 20 msj/dk) | `last_activity_at` | Mesajlar birleştirilir, kota tüketir | — |
| Grup gizlilik modu açık | `getMe` | Koordinatöre uyarı; bot yalnız etiketlenince görür | Elle `/setprivacy` |
| Depolama basıncı | `table_sizes_daily` | `storage_pressure=true`: saklama kısalır, bildirim güncellenir | — |

## 6. Pipelines (Python)

Ortak çerçeve `pipelines/common` (M04, paket adı `ogrenmen_common`):

```
pipelines/common/
├── pyproject.toml                 deps: httpx, pydantic(yalnız CLI arg), jsonschema, numpy, psycopg[binary], typer, rich
├── src/ogrenmen_common/
│   ├── adapters/base.py           Protocol'ler: LLM, Embedding, Vision, Transcriber, Scholar, DOIResolver, OAResolver, OCR, DB, Storage, Notifier
│   ├── adapters/gemini.py groq.py openalex.py semanticscholar.py crossref.py unpaywall.py supabase.py storage.py telegram_notify.py
│   ├── fakes/                      FakeLLM (şablon/fixture cevap, token sayar), FakeEmbedding (sha256→768 deterministik), FakeVision, FakeTranscriber (fixture transkript), FakeScholar/FakeCrossref/FakeUnpaywall (fixtures/kitap/*.json), FakeDB (sqlite bellek + JSON dump), FakeStorage (dizin), FakeNotifier (stdout)
│   ├── ledger.py                   CostLedger: models.json fiyatları, her çağrı → llm_calls; `check_spend` çağrısı; dry-run'da cost_estimate.json
│   ├── scrub.py                    PII temizleyici (ad/okul/sınıf kalıpları, @kullanıcı, telefon, e-posta, TC kimlik deseni) + ÖĞRENCİ/EĞİTMEN etiketleme
│   ├── batch.py                    Gemini Batch API sarmalayıcı: istekleri JSONL'e yaz, gönder, poll, sonuçları eşle; fake'te anında döner
│   ├── runtime.py                  `Runtime.from_env(dry_run: bool)` → gerçek ya da sahte adaptör seti; `OGRENMEN_FAKES=1` zorlar
│   └── cli_base.py                 ortak bayraklar: --dry-run --fixtures --out --limit --since --student-ref
└── tests/
```

Kurallar: (1) hiçbir pipeline `students.id`, ad veya Telegram kimliği kullanmaz; DB adaptörü `student_ref` ile çalışır ve `public_ref → id` eşlemesini yalnız yazım anında yapar. (2) Her LLM çağrısı `CostLedger.call()` üzerinden gider; defter `check_spend` `paid_allowed=false` derse ücretli çağrı yapmaz ve `cap_blocked` yazar. (3) Her çıktı DB'ye yazılmadan `ogrenmen_contracts.validate`. (4) `--dry-run`: ağ yok, `fixtures`'tan okur, `--out`'a JSON + `cost_estimate.json` yazar. (5) GitHub Actions'ta `OGRENMEN_FAKES` yoktur; gerçek anahtarlar `secrets`'tan gelir; **anahtar yoksa iş `--dry-run`'a düşer ve başarılı sayılır** (yeşil CI, kırmızı uyarı satırı).

Ortak kurulum/test:

```
python -m pip install -e /home/user/alperen/packages/contracts/python -e /home/user/alperen/packages/mastery-math/python -e /home/user/alperen/pipelines/common[dev]
python -m pytest /home/user/alperen/pipelines/common -q
```

### 6.1 `pipelines/tablet` (M05) — soru, şekil, doğrulama, PDF

- CLI: `python -m ogrenmen_tablet generate --skill tyt.mat.temel.rasyonel-sayilar --count 10 [--batch] [--dry-run]`; `render --queue` (DB'de `figures.status='pending'`); `verify --question <uuid>`; `template --id ucgen-kenar-aci --count 50` (sıfır LLM); `pdf --test <uuid> --out deneme.pdf`; `review-queue --push`.
- Akış `generate`: (1) `content_pool`/`questions` içinde aynı kazanım için `approved` sayısı ≥ 30 ise üretim **atlanır** (havuz yeter); (2) LLM `question-item` + `answer-key` çıktısı (iki ayrı şema, tek çağrı iki bölümlü JSON; anahtar yalnız bellekte); (3) `content_hash` çakışması → at; (4) şekil kodu sandbox'ta render: `subprocess.run([sys.executable, "-I", "-S", render_stub], timeout=20, env={})` ayrı geçici dizinde, ağ yok (`unshare -n` varsa), matplotlib `Agg`, çıktı PNG boyut sınırı 200–1600 px ve 5–400 KB; (5) SymPy: `numeric_answer` ifadesi `stem_values` ile `sympy.simplify` → `correct_option` metniyle eşit mi; eşit değilse `sympy='failed'` → yeniden üretim; (6) vision: Gemini Flash (ücretsiz katman zinciri) PNG + `stem_values` → `{"matches_stem": bool, "notes"}`; (7) 2 başarısız deneme → `questions.status='pending_review'`, `figures.status='failed'`; başarılı → `pending_review` (eğitmen onayı her zaman gerekir; onaysız soru öğrenciye gitmez); (8) anahtar `secure.answer_keys`'e service_role ile.
- Şablonlar `content/tyt-matematik/templates/*.py`: `def generate(rng) -> (QuestionItem, AnswerKey)`; parametreler SymPy ile çözülür, şekil matplotlib ile; sıfır LLM, `source='template'`, doğrulama `sympy='verified', vision='not_applicable'` (şekil koddan deterministik; vision yalnız LLM kodlu şekillerde).
- PDF: LaTeX `exam` sınıfı şablonu `templates/exam.tex.j2`; `tectonic` ikili dosyası varsa derlenir, yoksa `.tex` üretilir ve test yalnız `.tex`'i doğrular (`--require-pdf` ile zorlanır).
- Adaptörler: LLM (Gemini/fake), Vision (Gemini/fake), Storage (Supabase/dizin), DB.
- Actions: `render.yml` (nightly'den çağrılır + elle); `generate` nightly'de yalnız `runtime_flags.tablet_nightly_count` (varsayılan 10) kadar ve `check_spend` izin verirse, Batch ile.
- Dry-run/fixtures: `fixtures/tablet/llm-question.json` (geçerli soru+anahtar), `llm-question-bad-sympy.json`; test: render sandbox gerçekten çalışır (matplotlib yerelde var), SymPy doğrular, kötü anahtar reddedilir, boyut kontrolü, 2 deneme sonra kuyruk.
  ```
  python -m pip install -e /home/user/alperen/pipelines/tablet[dev]
  python -m pytest /home/user/alperen/pipelines/tablet -q
  python -m ogrenmen_tablet generate --skill tyt.mat.temel.rasyonel-sayilar --count 2 --dry-run --fixtures /home/user/alperen/fixtures/tablet --out /tmp/tablet-out
  python -m ogrenmen_tablet template --id rasyonel-toplama --count 5 --out /tmp/tablet-out    # LLM yok, dry-run gerekmez
  ```

### 6.2 `pipelines/kalem` (M06) — sınav arşivi → öncelik planı

- CLI: `python -m ogrenmen_kalem ingest --pdf <yol> --course MAT101 --year 2023 --term guz --legal-basis "öğrenci kopyası"`; `cluster --course MAT101`; `align --course MAT101 --syllabus syllabus.json`; `plan --course MAT101 --period 2026-guz`; `variants --plan <uuid> --top 5` (Tablet'e iş verir).
- `ingest`: PDF → sayfa PNG (pdf2image/`pdftoppm` yoksa PyMuPDF) → Gemini Flash vision OCR → `exam-item` JSON dizisi (madde başına konu/tür/puan). OCR maliyeti sayfa başına ~0,0006 $; fake OCR fixture döner.
- `cluster`: `ocr_text` embedding (768) → `sklearn.cluster.AgglomerativeClustering(distance_threshold=0.25, metric='cosine', linkage='average')`; küme etiketi en yakın `skills.name` veya en sık konu; `years_hit`.
- `align`: izlence JSON (`[{"week":1,"topics":[...]}]`) ile küme eşleşmesi → `syllabus_alignment`.
- `plan`: `exam-priority-plan` şeması; `points_text = "≈{round(avg)} puan"`; yasaklı kelime taraması (`tahmin|çıkacak|kesin|garanti`) → `forbidden_words_check=true` olmadan yazılamaz; `status='pending_review'`.
- Telif: `ocr_text` yalnız `exam_items`'ta; hiçbir öğrenci çıktısı veya Tablet prompt'u ham soru metnini içermez — Tablet'e giden yalnız `{topic, kind, skill_id, points}`.
- Test: `fixtures/kalem/exam-2022.pdf` + `ocr-2022.json`, `ocr-2023.json`; kümeleme deterministik (fake embedding), plan şemayı geçer, yasaklı kelime testi.
  ```
  python -m pytest /home/user/alperen/pipelines/kalem -q
  python -m ogrenmen_kalem plan --course DEMO --period 2026 --dry-run --fixtures /home/user/alperen/fixtures/kalem --out /tmp/kalem-out
  ```

### 6.3 `pipelines/kitap` (M07) — araştırma ajanı

- CLI: `python -m ogrenmen_kitap run --request <uuid>`; `run --query "..." --dry-run`; `verify --output <uuid>` (yalnız Crossref yeniden denetimi).
- Akış: (1) `check_spend('research')` + `research_enabled` flag + öğrenci `research` kotası (Worker `enqueue_research` zaten düşmüştür); (2) Flash-Lite ile 3–5 sorgu genişletme (≈ 0,0001 $); (3) OpenAlex (`mailto` ile polite pool) + Semantic Scholar (anahtar varsa) → ilk 30 aday; skor `0.5·alaka + 0.3·log(atıf+1)/log(max) + 0.2·yıl yakınlığı`; (4) her aday DOI **Crossref** `GET /works/{doi}` → 200 değilse `removed(crossref_unresolved)`; DOI yoksa `removed(no_doi)`; (5) Unpaywall `best_oa_location.url_for_pdf` → en fazla 6 PDF, her biri ≤ 40 sayfa, `pypdf` ile metin (toplam ≤ 150k token); (6) Gemini Flash uzun bağlam sentez → `research-output` (paragraf başına ≥ 1 DOI); `cites` dizisindeki her DOI doğrulanmış listede olmalı, yoksa paragraf atılır; (7) BibTeX/APA `citations`'tan şablonla üretilir (LLM değil); (8) `research_outputs(pending_review)`; eğitmen yayınlar.
- Adaptörler: Scholar (OpenAlex, S2), DOIResolver (Crossref), OAResolver (Unpaywall), LLM; her birinin fake'i fixtures'tan.
- Maliyet: ~0,0275 $/araştırma; aylık tavan `runtime_flags.research_monthly_cap=40`.
- Test: çözülmeyen DOI gerçekten silinir (fixture `crossref-404.json`), `crossref_verified const true` şema reddi, paragraf-DOI tutarlılığı, BibTeX geçerli (`bibtexparser`).
  ```
  python -m pytest /home/user/alperen/pipelines/kitap -q
  python -m ogrenmen_kitap run --query "spaced repetition matematik" --dry-run --fixtures /home/user/alperen/fixtures/kitap --out /tmp/kitap-out
  ```

### 6.4 `pipelines/ders` (M08) — ders videosu analizi

- CLI: `python -m ogrenmen_ders analyze --lesson <uuid> --video <yol|storage://...>`; `transcribe-only`, `frames-only`, `purge --older-than 30d` (ham videoları siler, `video_deleted_at` yazar, bildirim kuyruğu), `--dry-run --fixtures`.
- Adımlar: (1) `ffmpeg -i video -vn -ac 1 -ar 16000 audio.wav`; (2) `ffmpeg -vf "select='gt(scene,0.3)',showinfo" -vsync vfr` ile sahne kareleri; 20–40 arasına indirgeme (eşik uyarlanır), JPEG 1280px; (3) transkript: `TRANSCRIBER=groq` (Whisper large-v3-turbo, ~0,06 $/90 dk) | `gemini` (ses doğrudan Flash'a, 0 $ ücretsiz katman) | `whispercpp` (yerel, `whisper-cli` ikilisi varsa); konuşmacı ayrımı: Groq'ta `pyannote` yok → Gemini'ye "iki konuşmacı, ÖĞRENCİ/EĞİTMEN" etiketleme (ucuz, Flash-Lite, ≈ 0,003 $); `scrub.py` isim/okul kalıplarını siler ve `[AD]` ile değiştirir **API'ye gitmeden önce**; (4) analiz: `lesson-analysis` şeması ile Gemini 2.5 Pro (zincir `lesson_analysis`), girdi = transkript (~30k token) + ≤ 40 kare + **mevcut profil** (`v_profile_for_prompt` + açık yanılgılar; "geçen ders şu yanılgı vardı, düzeldi mi?" → `previous_profile_check`); ≈ 0,20–0,45 $; (5) `lesson_analyses(draft)` + `lessons.status='analyzed'` + transkript Storage'a; **profile yazım yok** — onay `approve_lesson_analysis` RPC'siyle panelden; (6) ses dosyası silinir; video 30 gün sonra `purge`.
- Ders başına maliyet defteri: transcribe + diarize + analysis satırları `llm_calls(purpose='lesson_analysis', ref_id=lesson)`; panelde ders raporunun altında toplam.
- Test: `fixtures/ders/lesson-01.mp4` yok (boyut) → `fixtures/ders/lesson-01.wav` 20 sn sentetik + `frames/` + `lesson-01.transcript.json`; `ffmpeg` gerçek çalışır (ortamda var), transcriber fake, analiz fake (fixture `analysis-01.json`) şemayı geçer; PII testi: transkripte "Elif" geçtiğinde API'ye giden metinde yok.
  ```
  python -m pytest /home/user/alperen/pipelines/ders -q
  python -m ogrenmen_ders analyze --lesson 00000000-0000-0000-0000-000000000001 --video /home/user/alperen/fixtures/ders/lesson-01.wav --dry-run --fixtures /home/user/alperen/fixtures/ders --out /tmp/ders-out
  ```
- Actions `ders.yml`: `workflow_dispatch` girdileri `lesson_id`, `video_url` (geçici imzalı URL veya Drive); 90 dk ders ≈ 6–10 dk iş; aylık 30 ders ≈ 300 dk (2.000 dk kota içinde). Kurucu makinesi tercih edilir (`make ders LESSON=... VIDEO=...`).

### 6.5 `pipelines/kulaklik_batch` (M09) — gece olgular, haftalık özet, panel metrikleri

- CLI: `python -m ogrenmen_kulaklik facts --day 2026-10-18 [--batch]`; `summaries --week 2026-10-13`; `metrics`; `retention-report`; `cost-report --month 2026-10`.
- `facts`: gün içinde mesajı olan her öğrenci için (`messages` son 24 saat, temizlenmiş, numaralı) → Flash-Lite, `nightly-facts-output` şeması; **Batch API** JSONL (tek iş, sabah 06:00'a kadar sonuç; gecikirse eş zamanlı çağrıya düşmez, ertesi gece tekrar) → `memory_facts` (embedding dahil; `requires_approval` → `approved=false`), `messages.is_question/answered_at`; aynı öğrencide `text` cosine > 0.92 olan eski olgu `merged`. Girdi ≤ 3.000 token (fazlaysa en eski mesajlar atılır, haftalık özet zaten kapsar).
- `summaries`: öğrenci başına son 7 günün olguları + metrikler (SQL'den) → Flash-Lite → `weekly-summary`; moral eğilimi `morale_signal` ortalamasından (LLM değil). Haftalık özetin öğrenciye **gösterilen** sürümü yok (MVP); eğitmen paneli okur.
- `metrics`: SQL'den `instructor_alerts` (cevapsız > 6 saat, sessiz ≥ 3 gün, moral son 7 gün ort ≤ −1 ve ≥ 3 sinyal, teslim ≤ 2 gün, eğitmen yanıt süresi medyanı) — LLM yok; Worker'ın saatlik cron'u aynı RPC'yi kullanır, batch yalnız haftalık metrik tablosunu (`panel_metrics_weekly` görünümü) tazeler.
- `retention-report` ve `cost-report`: `retention_runs`, `spend_ledger`, `table_sizes_daily` → Markdown; `weekly.yml` Issue'ya yorum olarak yazar.
- Test: fake LLM fixture `facts-day.json`; olgu PII içermez; `requires_approval` olgular `approved=false`; merge mantığı; metrik SQL'leri FakeDB (sqlite) üzerinde — sqlite uyumlu alt küme için sorgular `sql/*.sql` dosyalarında iki lehçeyle (`-- pg` / `-- sqlite` blokları) tutulur; canlı DB varsa pg sürümü doğrulanır.
  ```
  python -m pytest /home/user/alperen/pipelines/kulaklik_batch -q
  python -m ogrenmen_kulaklik facts --day 2026-10-18 --dry-run --fixtures /home/user/alperen/fixtures/kulaklik --out /tmp/kulaklik-out
  ```

### 6.6 Zamanlama özeti (GitHub Actions, UTC)

| Workflow | Cron | Adımlar | Süre/ay |
| --- | --- | --- | --- |
| `nightly.yml` | `15 0 * * *` (03:15 TRT) | `check_spend` → `kulaklik facts --batch` → `tablet generate --count 10 --batch` (izin varsa) → `tablet render --queue` → `retention-report` | ~8 dk × 30 = 240 dk |
| `weekly.yml` | `15 1 * * 0` | `kulaklik summaries --batch`, `metrics`, `cost-report` → Issue yorumu | ~10 dk × 4 |
| `keepalive.yml` | `0 9 * * *` | `curl $SUPABASE_URL/rest/v1/rpc/ping`, `curl $WORKER_URL/health` | 1 dk × 30 |
| `cost-guard.yml` | `30 * * * *` | `scripts/cost-report.py --check` → eşik aşımında Issue + Telegram DM; %100'de `set_runtime_flag paid_llm_enabled=false` | 1 dk × 720 (≈ 720 dk!) → **saatlik yerine 4 saatte bir** (`30 */4 * * *`): 180 dk |
| `render.yml` / `ders.yml` | dispatch | — | değişken |

Toplam ≈ 700 dk/ay + ders işleri; 2.000 dk kotasının altında. Worker'ın kendi saatlik cron'u zaten harcama uyarısı verir; `cost-guard.yml` ikinci kemerdir.

## 7. Eğitmen paneli (web)

Dizin `apps/panel/` (M10). Next.js 14.2 App Router, React 18.3.1, TypeScript, `@supabase/ssr`, Cloudflare Pages (`@cloudflare/next-on-pages`, Edge runtime), stil: design-system `bundle.css` + `tokens.json`'dan üretilen CSS değişkenleri (`scripts/tokens-to-css.ts` → `app/tokens.css`), `lang="tr"`.

```
apps/panel/
├── package.json  next.config.mjs  tsconfig.json  vitest.config.ts
├── app/
│   ├── layout.tsx                  BrandLockup (sm, endorsement=false), tema (data-theme), lang="tr"
│   ├── (auth)/giris/page.tsx       Supabase e-posta+şifre; magic link ikincil
│   ├── (panel)/layout.tsx          rol kontrolü (staff.role), yan menü
│   ├── (panel)/page.tsx            Genel bakış: StatTile ×4 + AlertRow listesi (panel_overview RPC)
│   ├── (panel)/dersler/[id]/page.tsx     Ders raporu: MasteryMeter listesi, MisconceptionItem, EvidenceQuote, Onayla/Düzelt
│   ├── (panel)/cevaplar/page.tsx         Bot cevap denetimi: TutorMessage review (model, maliyet, olgu sayısı, İşaretle); filtre: işaretli/örneklem/öğrenci
│   ├── (panel)/kuyruk/page.tsx           Şekil/soru/havuz onay kuyruğu: FigureFrame pending, QuizOption önizleme, Onayla/Yeniden üret/Reddet
│   ├── (panel)/ogrenciler/[ref]/page.tsx Öğrenci profili (Elif K.), MasteryMeter, açık yanılgılar, haftalık özet, kota
│   ├── (panel)/onay/page.tsx             Onay yönetimi (consents), veli formu bağlantısı üret
│   ├── (panel)/maliyet/page.tsx          Koordinatör: spend_ledger gün/ay, sağlayıcı payı, tavan bayrakları (set_runtime_flag), depolama
│   └── onay/[token]/page.tsx             Veli onay formu (giriş gerektirmez; tek kullanımlık token; legal ton; "Onaylıyorum" / "Şimdi değil")
├── lib/
│   ├── ds.tsx                      window.Ogrenmen → React bileşen sarmalayıcıları (bundle.js next/script ile yerelden; CDN yok)
│   ├── data/{types.ts, live.ts, mock.ts, index.ts}   DATA_MODE=live|mock ; aynı arayüz
│   ├── supabase/{server.ts, client.ts}
│   └── format.ts                   Türkçe göreli süre ("14 saattir cevapsız"), %72, 0,002 $, "Elif K."
├── public/ds/                      bundle.js, bundle.css, fontlar, maskot (design-system'den kopya; postinstall betiği)
└── test/                           vitest + @testing-library/react; sayfalar mock veriyle render; rol testi
```

- **Kimlik ve roller**: Supabase Auth; `staff` satırı yoksa "Yetkin yok" sayfası. Branş eğitmeni `staff_students` ile; gözlemci düğmeleri `disabled`. Sunucu bileşenleri `createServerClient` ile kullanıcının JWT'siyle sorgular → RLS zaten sınırlar; panel ek filtre uygulamaz, güvenlik DB'dedir.
- **Veri erişimi**: `lib/data/index.ts` `DATA_MODE` ile `live` (PostgREST + RPC) veya `mock` (`fixtures/panel/*.json`) seçer; her sayfa yalnız bu arayüzü kullanır. Ağır sayfalar tek RPC (`panel_overview`) → tek round-trip.
- **Bileşen kullanımı**: `StatTile` (cevapsız soru `danger` "Acil"; sessiz `warning` "Dikkat"; yaklaşan teslim durumsuz; ort. yanıt süresi `success` "Hedefte"), `AlertRow` (Acil → Dikkat → Bilgi, en eski üstte; eylem `Button secondary sm` "Cevapla" → Telegram `tg://` bağlantısı / "Mesaj gönder"), `MasteryMeter` (`minEvidence=5`, `period`), `MisconceptionItem` + `EvidenceQuote` (`kind='lesson'`, `source="Ders 12 · 14:32"`), `Notice warning` "Onay bekliyor", `TutorMessage review`, `FigureFrame status`, `Badge ai`, `ModeToggle` yok (öğrenci tarafı), `CitationCard` (Kitap incelemesi, `verified=false` → kaldırılacak).
- **Maliyet görünümü**: yalnız `cevaplar` (denetim satırı: "0,002 $") ve koordinatörün `maliyet` sayfası; öğrenciyle ilgili hiçbir yüzeyde maliyet yok.
- **Yerel çalıştırma**: `bun install --cwd /home/user/alperen/apps/panel && DATA_MODE=mock bun run --cwd /home/user/alperen/apps/panel dev` → `http://localhost:3000` (giriş mock'ta "koordinatör/eğitmen/gözlemci" seçici). Test: `bun run test`, `bun run typecheck`, `bun run build` (next-on-pages çıktısı).

## 8. CI/CD ve operasyon

### 8.1 `ci.yml` (her PR ve main)

Matris değil, **değişen yola göre** işler (`dorny/paths-filter`): her modül kendi dizininde `install → typecheck/lint → test`. Ortak kurallar: Node 22 (`actions/setup-node`, bun `oven-sh/setup-bun`), Python 3.13 (`actions/setup-python`, `pip cache`), `ffmpeg` apt. Zorunlu işler: `contracts`, `mastery-math`, `supabase-lint` (sqlfluff + `check_sql.py` + grant matrisi statik kontrolü), `worker`, `panel`, `content`, `py-common`, `tablet`, `kalem`, `kitap`, `ders`, `kulaklik`. Hiçbir iş gizli anahtar istemez. `supabase-live` işi yalnız `OGRENMEN_DATABASE_URL` secret'ı varsa koşar (Supabase'in ücretsiz projesine bağlı gölge şema `ci_<run_id>` yaratıp migration + RLS testlerini çalıştırır, sonunda şemayı düşürür).

### 8.2 Dağıtım

- `deploy-worker.yml`: `main`'e merge, `apps/worker/**` veya `packages/contracts/**` değişti → `bun run test` → `wrangler deploy` (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` GitHub Environment `prod`, manuel onay gerekli). Sonra `curl $WORKER_URL/health` ve `setWebhook` idempotent çağrısı.
- `deploy-panel.yml`: `bun run build` (next-on-pages) → `wrangler pages deploy .vercel/output/static`.
- Veritabanı: `supabase db push` **elle**, kurucu makinesinden, `make db-migrate` (Actions'ta otomatik şema değişikliği yok: geri dönüşü zor). Migration PR'ında `supabase-live` yeşil olmalı.
- Sürümleme: `CHANGELOG.md` yok; git etiketleri `worker-v0.3.0`; `bot_responses.prompt_version` ile prompt değişimleri izlenir.

### 8.3 Operasyon işleri

- `keepalive.yml` + Worker cron: Supabase 7 gün uyku riski iki kemerle.
- `nightly.yml`, `weekly.yml`, `render.yml`, `ders.yml`, `cost-guard.yml`: §6.6. Her iş başında `python -m ogrenmen_kulaklik check-spend` çıktısını adım özetine yazar; `free_only` ise ücretli adımlar `skipped` olur.
- `/metrics` (Worker): `ogrenmen_updates_total`, `ogrenmen_llm_calls_total{provider,status}`, `ogrenmen_cost_usd_today`, `ogrenmen_quota_blocks_total`, `ogrenmen_degraded` — ücretsiz bir Grafana Cloud/Uptime Kuma'ya bağlanabilir; MVP'de panel `maliyet` sayfası yeter.
- Runbook'lar `docs/runbook/`: `provider-429.md`, `supabase-paused.md`, `cap-reached.md`, `webhook-flood.md`, `storage-pressure.md`, `key-rotation.md`, `student-deletion-request.md`.

### 8.4 Maliyet uyarı mekanizması (uçtan uca)

1. Her çağrı → `llm_calls` → tetikleyici `spend_ledger` upsert (gün×amaç×sağlayıcı).
2. `check_spend` RPC (Worker her LLM'li turda, pipelines her iş başında): tavanlar `runtime_flags`.
3. Worker saatlik cron: eşik geçişleri → kurucuya Telegram DM + `instructor_alerts` (koordinatör paneli). Durum geçişi `free_only`/`degraded` her zaman DM.
4. `cost-guard.yml` (4 saatte bir): bağımsız hesap (`scripts/cost-report.py --check`), uyuşmazlık (> %5) varsa Issue "ledger drift".
5. Ay sonu `weekly.yml` raporu: öğrenci başına gerçek maliyet (`cost_usd / aktif öğrenci`), sağlayıcı payı, ücretsiz düşüş oranı, en pahalı 10 tur (prompt_version'a göre), havuz isabet oranı — pilot ölçütü "öğrenci başına gerçek aylık maliyet" buradan okunur.
6. Dış kemer: Gemini projesinde ön ödemeli bakiye (25 $) ve Google Cloud bütçe uyarısı %50/%90; Groq/OpenRouter ücretsiz anahtarlar (fatura yok); Cloudflare Workers ücretsiz plan (aşımda istek reddi, fatura değil).

## 9. Güvenlik ve KVKK

### 9.1 Mekanizmalar

| Konu | Mekanizma | Nerede | Test |
| --- | --- | --- | --- |
| Rastgele kimlik | `students.public_ref` (`s_` + 12 base32, `gen_random_bytes`); LLM, `llm_calls`, pipeline çıktıları, panel ekran paylaşımı yalnız bunu görür; panel ad gösterirse "Elif K." biçimi (`format.ts`) | `0003_identity.sql`, `scrub.py`, `guard.ts` | `grep -r` ile prompt şablonlarında `display_name` yok; vitest: prompt metninde `students.display_name` fixture değeri geçmez |
| PII temizleme LLM öncesi | `app.scrub(text)` (SQL, `recent_messages` içinde) ve `guard.scrub()` (TS) ve `scrub.py` (Py): @kullanıcı, telefon, e-posta, TC kimlik deseni, "adım/benim adım X", okul/sınıf kalıpları ("… Lisesi", "11-A") → `[AD]`, `[OKUL]`; transkriptte konuşmacı adları → ÖĞRENCİ/EĞİTMEN | üç uygulama, ortak test vektörü `fixtures/scrub-vectors.json` | TS/Py/SQL aynı çıktı |
| Model anahtarları | Yalnız Worker secret'ları ve Actions secret'ları; panelde anahtar yok (panel LLM çağırmaz); `service_role` Worker'da yasak (`env.ts` kontrolü, eslint) | §5.10 | `bun run lint` |
| Cevap anahtarı yalıtımı | `secure` şeması PostgREST dışı; `bot_runtime`/`authenticated` grant yok; yalnız `grade_attempt`/`reveal_solution` SECURITY DEFINER; LLM yolu `attempts.is_correct`, `mastery`, `secure.*` yazamaz (grant yok); `question-item` şemasında doğru şık alanı yok | §3.3, §3.7 | `rls_answer_keys.sql`; vitest `answer-key` içe alımı yok; `check_sql.py` `secure.` üzerinde `grant ... to bot_runtime|authenticated|anon` görürse hata |
| RLS + grant birlikte | `FORCE ROW LEVEL SECURITY`; `grants_bot_runtime.sql` matrisle fark alır | §3.7 | canlı DB'de; statik: `check_sql.py` her tabloda RLS |
| Öğrenciler arası yalıtım | `X-Ogrenmen-Student` başlığı + politikalar; çapraz işlemler yalnız adlandırılmış RPC | §3.0 | `rls_student_isolation.sql`; vitest fake Supabase başlıksız sorguda hata fırlatır |
| Saklama | §3.9 işleri; kayıt bildirimi metni `tg_chats.retention_days`'ten | pg_cron | `retention_runs` haftalık raporda |
| Silme talebi | `students.deleted_at` → 30 gün sonra anonimleştirme; `docs/runbook/student-deletion-request.md` | §3.9 | — |
| Webhook kimliği | Gizli yol + `X-Telegram-Bot-Api-Secret-Token` | §5.1 | vitest |
| Prompt enjeksiyonu | Çıktı guard'ı; sistem prompt'u kullanıcı metninden ayrı rolde; `used_fact_ids` sunucu tarafında doğrulanır (bilinmeyen id atılır) | `guard.ts` | vitest "kuralları unut" senaryosu |
| Denetim izi | `audit_log`: onay/ret, bayrak değişimi, `reveal_solution`, onay kayıtları | tetikleyiciler | — |
| Yedek | Supabase günlük yedek (ücretsiz katmanda yok) → `weekly.yml` `pg_dump --schema=public --exclude-table=messages` → şifreli (age) artefakt 4 hafta | Actions | — |
| Loglarda PII | Worker `console.log` yalnız `public_ref`, chat_id hash; Cloudflare log saklama 3 gün | `ops/` | lint kuralı: `console.log(` içinde `display_name` yasak |

### 9.2 Hazırlanacak belgeler (`docs/hukuk/`, M11; her biri "HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayınlanmaz" başlığıyla)

1. `aydinlatma-metni-v1.md` — KVKK m.10: veri sorumlusu (easy), işlenen veriler (Telegram kimliği, mesajlar, öğrenme verisi, ders transkripti), amaç, hukuki dayanak (açık rıza / sözleşme), aktarım (yurt dışı sağlayıcılar: Google, Groq, Cloudflare, Supabase — ülke ve amaç), saklama süreleri (mesaj 90 gün, transkript dönem+1 yıl, video 30 gün), haklar (m.11), başvuru yolu. Çocuğun anlayacağı 1 paragraflık özet (botta "Verilerin nasıl kullanılıyor?").
2. `veli-onay-formu-v1.md` — 18 yaş altı için açık rıza; kimlik doğrulama yöntemi (panel bağlantısı + eğitmen teyidi); geri alma yolu; önceden işaretli kutu yok.
3. `grup-kayit-bildirimi-v1.md` — bota eklenince gönderilen ve sabitlenen metin: "Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve {retention_days} gün sonra silinir." + yapay zekâ olduğu + kime başvurulur.
4. `saklama-politikasi-v1.md` — §3.9 tablosu insan diliyle; süre değişirse botun metni de değişir kuralı.
5. `yurt-disi-aktarim-v1.md` — sağlayıcı listesi, veri türü, "ücretli katmanda eğitimde kullanılmaz" dayanakları (sağlayıcı sözleşme bağlantıları), standart sözleşme/açık rıza notu.
6. `telif-notu-v1.md` — ÖSYM/eğitmen sorularının yalnız istatistik için işlenmesi, yeniden yayınlanmaması; `exam_items.ocr_text` erişim sınırı.

## 10. İlk içerik

### 10.1 TYT Matematik — kazanım ağacı dilimi (`content/tyt-matematik/skills.json`, müfredat `TYT-MAT@2026`)

Pilot dilimi "Temel Matematik + Problemler" (TYT'nin ~%60'ı). 17 kazanım, ön koşul kenarları (`prerequisites.json`, `strength`):

| id | ad | ön koşullar |
| --- | --- | --- |
| `tyt.mat.temel.sayilar` | Sayı kümeleri ve işlem önceliği | — |
| `tyt.mat.temel.bolunebilme` | Bölünebilme kuralları | sayilar (1.0) |
| `tyt.mat.temel.ebob-ekok` | EBOB–EKOK | bolunebilme (1.0) |
| `tyt.mat.temel.rasyonel-sayilar` | Rasyonel sayılarda dört işlem ve sıralama | sayilar (1.0) |
| `tyt.mat.temel.ondalik` | Ondalık gösterim ve dönüşüm | rasyonel-sayilar (0.8) |
| `tyt.mat.temel.esitsizlik` | Basit eşitsizlikler | sayilar (0.8) |
| `tyt.mat.temel.mutlak-deger` | Mutlak değer | esitsizlik (0.9) |
| `tyt.mat.temel.uslu` | Üslü ifadeler | sayilar (1.0) |
| `tyt.mat.temel.koklu` | Köklü ifadeler | uslu (1.0) |
| `tyt.mat.temel.carpanlara-ayirma` | Çarpanlara ayırma ve özdeşlikler | uslu (0.8) |
| `tyt.mat.temel.oran-oranti` | Oran–orantı | rasyonel-sayilar (0.9) |
| `tyt.mat.problem.sayi` | Sayı problemleri | sayilar (1.0) |
| `tyt.mat.problem.kesir` | Kesir problemleri | rasyonel-sayilar (1.0) |
| `tyt.mat.problem.yas` | Yaş problemleri | problem.sayi (0.9) |
| `tyt.mat.problem.yuzde` | Yüzde, kâr–zarar | oran-oranti (1.0) |
| `tyt.mat.problem.hareket` | Hareket problemleri | oran-oranti (0.9) |
| `tyt.mat.problem.isci` | İşçi–havuz problemleri | oran-oranti (0.8), rasyonel-sayilar (0.6) |

`validate.py`: graf asiklik (Kahn), her `parent_id` mevcut, id deseni, BKT parametreleri aralıkta. İkinci dilim (geometri, fonksiyonlar) `skills.json`'a eklenir; müfredat yılı değişince `TYT-MAT@2027` yeni `curricula` satırı, eski `mastery` dokunulmaz.

### 10.2 Yanılgı etiketleri (`misconception-tags.json`, kesit)

| tag | kazanım | eğitmen metni | öğrenci metni (sen dili) | prereq |
| --- | --- | --- | --- | --- |
| `MAT-SAY-01` | sayilar | İşlem önceliğini soldan sağa uyguluyor | Çarpma ve bölmeyi toplamadan önce yapıyoruz. | — |
| `MAT-SAY-02` | sayilar | Negatif sayıların çarpımında işaret kuralını karıştırıyor | İki negatifin çarpımı pozitif olur. | — |
| `MAT-BOL-01` | bolunebilme | 3 ve 9 ile bölünebilme kurallarını karıştırıyor | 9'a bölünebilme için rakamlar toplamı 9'un katı olmalı. | — |
| `MAT-EBK-01` | ebob-ekok | EBOB ile EKOK'u ters kullanıyor | En büyük ortak bölen küçüğü, EKOK büyüğü verir. | bolunebilme |
| `MAT-RAS-01` | rasyonel | Payları ve paydaları ayrı ayrı topluyor | Paylar ve paydalar ayrı ayrı toplanmaz; önce paydaları eşitleyelim. | — |
| `MAT-RAS-02` | rasyonel | Bölmede ikinci kesri ters çevirmiyor | Kesirle bölerken ikinci kesri ters çevirip çarpıyoruz. | — |
| `MAT-RAS-03` | rasyonel | Negatif kesirleri sıralarken mutlak değere bakıyor | Negatif sayılarda mutlak değeri büyük olan daha küçüktür. | sayilar |
| `MAT-OND-01` | ondalik | Virgül kaydırma yönünü karıştırıyor | 10 ile çarparken virgül bir basamak sağa gider. | rasyonel |
| `MAT-ESI-01` | esitsizlik | Negatifle çarpınca yön değiştirmiyor | Eşitsizliği negatif bir sayıyla çarparsan yön değişir. | — |
| `MAT-MUT-01` | mutlak-deger | Mutlak değer denkleminde tek durum alıyor | İçerideki ifade hem pozitif hem negatif olabilir; iki durum var. | esitsizlik |
| `MAT-USL-01` | uslu | Aynı tabanlı çarpımda üsleri çarpıyor | Tabanlar aynıysa üsler toplanır. | — |
| `MAT-USL-02` | uslu | Negatif üssü işaret sanıyor | Negatif üs tersini alır, işareti değiştirmez. | — |
| `MAT-KOK-01` | koklu | Köklerin toplamını kök içine alıyor | √a + √b, √(a+b) değildir. | uslu |
| `MAT-CAR-01` | carpanlara-ayirma | (a+b)² açılımında 2ab terimini unutuyor | Kare açarken ortadaki 2ab terimini ekleyelim. | uslu |
| `MAT-ORA-01` | oran-oranti | Ters orantıyı doğru orantı gibi kuruyor | Biri artarken diğeri azalıyorsa ters orantı var. | — |
| `MAT-YUZ-01` | yuzde | Ardışık yüzdeleri topluyor | %20 sonra %10 artış, %30 değildir; sırayla uygula. | oran-oranti |
| `MAT-YUZ-02` | yuzde | Kârı satış fiyatı üzerinden hesaplıyor | Kâr yüzdesi maliyet üzerinden hesaplanır. | — |
| `MAT-HAR-01` | hareket | Birim dönüşümünü (saat–dakika) atlıyor | Hız km/sa ise süreyi saate çevir. | — |
| `MAT-ISC-01` | isci | İş sürelerini topluyor | İşçiler birlikte çalışırken birim zamandaki işler toplanır, süreler değil. | rasyonel |
| `MAT-KES-01` | problem.kesir | Kalanın kesrini bütünün kesri sanıyor | "Kalanın yarısı" bütünün değil kalanın yarısıdır. | rasyonel |

### 10.3 Teşhis testi stratejisi (`diagnostic/items.json`, `diagnostic/answer-keys.json`)

- **18 madde, sabit sıra, ön koşul köklerinden yapraklara**: sayilar ×2, rasyonel ×2, uslu ×2, bolunebilme, ebob-ekok, ondalik, esitsizlik, mutlak-deger, koklu, carpanlara, oran-oranti, problem.sayi, problem.kesir, problem.yuzde, problem.hareket. Her kazanım ≥ 1 madde, ağacın kök kazanımları 2 madde (ön koşul çıkarımı için daha güçlü kanıt).
- Her madde 5 şık; **4 yanlış şıkın en az 3'ü etiketli** (`misconception_tag`), biri "hesap hatası" (etiketsiz, `null`) — böylece doğru şık `null` olmasından çıkarılamaz.
- Süre: Telegram'da yaklaşık 12–15 dk; iki yarıda (9+9) ve ortada "Devam edelim mi?" düğmesi; yarım kalan test 24 saat bekler.
- Sonuç: `finish_diagnostic` → kazanım başına `p` (BKT ile 1–2 gözlem → `evidence_count` 1–2, yani yüzde **gösterilmez**), yanılgılar `pending_review` (eşik 3 kanıt ya da eğitmen onayı → `open`); öğrenciye mesaj: "Testi bitirdin. Şu üç konuda birlikte çalışmaya başlayabiliriz: … Yüzdeler biraz daha veri toplayınca görünecek." — yüzde yok, kanıt eşiği kuralı.
- Zorluk: her kazanımın maddesi orta zorluk (`difficulty 0.5`); kök kazanımların ikinci maddesi kolay (`0.3`) — `p_guess` kalibrasyonu için.
- Şekil: 3 maddede matplotlib şekli (sayı doğrusu, oran grafiği, basit geometri yok — geometri ikinci dilim); PNG'ler `diagnostic/figures/` içinde önceden render ve `verified` olarak tohumlanır; `alt_text` Telegram altyazısına girer.
- Yeni içerik sürümü: `diagnostic_tests.version` `'2026.1'`; madde değişince `'2026.2'`, eski oturumlar eski sürümle biter.

### 10.4 Öğretmen incelemesinin veride işareti

| Nesne | Alan | Öğrenciye görünürlük |
| --- | --- | --- |
| Soru | `questions.status` (`pending_review` → `approved`/`rejected`), `verification.status`, `review_note`, `approved_by/at` | yalnız `approved` |
| Şekil | `figures.status` (`pending`/`rendered`/`verified`/`failed`), `attempts`, `vision_check` | yalnız `verified` |
| Yanılgı | `misconceptions.status` (`pending_review`/`open`/`resolved`), `resolved_by` | `open`/`resolved` |
| Havuz açıklaması | `content_pool.status`, `approved_by` | yalnız `approved` |
| Ders raporu | `lesson_analyses.status` (`draft` → `approved`/`corrected`), `corrections` | `approved`/`corrected` özet; taslak hiç |
| Bot cevabı | `bot_responses.flagged/flag_reason/flagged_by` | — |
| Öncelik planı, araştırma | `exam_priority_plans.status`, `research_outputs.status` | yalnız `approved`/`released` |

Panel kuyruğu tek görünümden okur: `v_review_queue (kind, ref_id, created_at, reason, student_ref, staff_hint)` — `union all` ile yukarıdakilerin bekleyenleri; "Onayla / Yeniden üret / Reddet" ilgili tabloya `audit_log` tetikleyicisiyle yazar.

## 11. Paralel inşa planı

Kurallar: her modülün dizini **yalnız ona aittir**; başka modülün dizinine yazan PR reddedilir. Kök dosyalar M12'ye aittir ve en son yazılır; o güne kadar her modül kendi `package.json`/`pyproject.toml` ile kurulur. Modüller arası bağımlılık yalnız **bu belgedeki isimlerle** (tablo, RPC, şema `$id`, CLI bayrağı) kurulur; bir modül diğerinin kodunu beklemez, sahte/fixture ile ilerler. Aynı anda 2 ajan: dalga planı altta.

| id | dizin (sahiplik) | bağımlılık | teslimatlar | kabul (yerelde, hesapsız) |
| --- | --- | --- | --- | --- |
| **M00** | `packages/contracts/`, `packages/mastery-math/` | — | §4 şemaları + fixtures (`valid-*`/`invalid-*` her şema için ≥ 2), `models.json`, TS/Py doğrulayıcılar, `toGeminiSchema`, BKT TS/Py/SQL + `bkt-vectors.json` (40 vektör), `scrub-vectors.json` | `bun install --cwd packages/contracts && bun run --cwd packages/contracts build && bun test --cwd packages/contracts` · `python -m pip install -e packages/contracts/python && python -m pytest packages/contracts/python -q` · `bun test --cwd packages/mastery-math` · `python -m pip install -e packages/mastery-math/python && python -m pytest packages/mastery-math/python -q` |
| **M01** | `supabase/` | M00 (`sql/bkt.sql` kopyası, `bkt-vectors.json`) | §3 migration'ları (0001–0016), seed (içerik hariç), RLS/grant testleri, `check_sql.py`, `db-test.sh`, `size-report.sql` | `python -m pip install sqlfluff pglast && sqlfluff lint --dialect postgres supabase/migrations && python supabase/scripts/check_sql.py supabase/migrations` · `bash supabase/scripts/db-test.sh` (DB yoksa `SKIP` ile 0 döner; varsa RLS testleri geçer) · `python supabase/scripts/check_sql.py --grants-matrix supabase/tests/grants_matrix.json supabase/migrations` |
| **M02** | `content/tyt-matematik/` | M00 (şema) | `curriculum.json`, `skills.json` (17), `prerequisites.json`, `misconception-tags.json` (≥ 20), `diagnostic/items.json` (18) + `answer-keys.json`, 3 şekil PNG + kodları, ≥ 3 parametrik şablon (`rasyonel-toplama`, `uslu-carpim`, `yuzde-artis`), `validate.py`, `export-sql.py`, `seed.py` | `python -m pip install -e packages/contracts/python sympy matplotlib && python content/tyt-matematik/scripts/validate.py` · `python content/tyt-matematik/scripts/export-sql.py --out /tmp/seed.sql && python -c "import pglast,sys;pglast.parse_sql(open('/tmp/seed.sql').read())"` · `python -m pytest content/tyt-matematik -q` (şablonlar 50 varyant üretir, SymPy doğrular) |
| **M03** | `apps/worker/` | M00 | §5 tamamı; `test/fakes/*`; `wrangler.toml`; `.dev.vars.example` | `bun install --cwd apps/worker && bun run --cwd apps/worker typecheck && bun run --cwd apps/worker lint && bun run --cwd apps/worker test` · `bun run --cwd apps/worker test -- --reporter=verbose -t "cost-budget"` (tur ≤ 0,0003 $) · `bun run --cwd apps/worker test -t "answer-key"` (kaynakta içe alım yok) |
| **M04** | `pipelines/common/`, `fixtures/` | M00 | `ogrenmen_common` (adaptörler, fakes, ledger, scrub, batch, runtime, cli_base), tüm `fixtures/*` (telegram, ders wav+frames+transcript, kalem pdf+ocr, kitap json'ları, kulaklik, tablet, panel) | `python -m pip install -e packages/contracts/python -e pipelines/common[dev] && python -m pytest pipelines/common -q` · `python -c "from ogrenmen_common.runtime import Runtime; r=Runtime.from_env(dry_run=True); print(r.llm.__class__.__name__)"` → `FakeLLM` · `ffmpeg -i fixtures/ders/lesson-01.wav -f null -` (fixture geçerli) |
| **M05** | `pipelines/tablet/` | M04, M02 (şablonları içe alır) | §6.1 CLI, sandbox render, SymPy, vision adaptörü, PDF `.tex` şablonu | `python -m pip install -e pipelines/tablet[dev] && python -m pytest pipelines/tablet -q` · `python -m ogrenmen_tablet generate --skill tyt.mat.temel.rasyonel-sayilar --count 2 --dry-run --fixtures fixtures/tablet --out /tmp/tablet-out && test -f /tmp/tablet-out/cost_estimate.json` · `python -m ogrenmen_tablet template --id rasyonel-toplama --count 5 --out /tmp/tablet-out && ls /tmp/tablet-out/*.png` |
| **M06** | `pipelines/kalem/` | M04 | §6.2 CLI | `python -m pip install -e pipelines/kalem[dev] && python -m pytest pipelines/kalem -q` · `python -m ogrenmen_kalem plan --course DEMO --period 2026 --dry-run --fixtures fixtures/kalem --out /tmp/kalem-out && grep -q '"Sıklık analizine göre öncelikler"' /tmp/kalem-out/plan.json && ! grep -Eiq 'tahmin|çıkacak|kesin|garanti' /tmp/kalem-out/plan.json` |
| **M07** | `pipelines/kitap/` | M04 | §6.3 CLI | `python -m pip install -e pipelines/kitap[dev] && python -m pytest pipelines/kitap -q` · `python -m ogrenmen_kitap run --query "spaced repetition" --dry-run --fixtures fixtures/kitap --out /tmp/kitap-out && python -c "import json;o=json.load(open('/tmp/kitap-out/output.json'));assert all(c['crossref_verified'] for c in o['citations']);assert o['removed']"` |
| **M08** | `pipelines/ders/` | M04 | §6.4 CLI (`analyze`, `transcribe-only`, `frames-only`, `purge`) | `python -m pip install -e pipelines/ders[dev] && python -m pytest pipelines/ders -q` · `python -m ogrenmen_ders analyze --lesson 00000000-0000-0000-0000-000000000001 --video fixtures/ders/lesson-01.wav --dry-run --fixtures fixtures/ders --out /tmp/ders-out && test -f /tmp/ders-out/analysis.json && ! grep -q 'Elif' /tmp/ders-out/api_payload.json` |
| **M09** | `pipelines/kulaklik_batch/` | M04 | §6.5 CLI (`facts`, `summaries`, `metrics`, `retention-report`, `cost-report`, `check-spend`) | `python -m pip install -e pipelines/kulaklik_batch[dev] && python -m pytest pipelines/kulaklik_batch -q` · `python -m ogrenmen_kulaklik facts --day 2026-10-18 --dry-run --fixtures fixtures/kulaklik --out /tmp/kk-out && test -f /tmp/kk-out/facts.json` · `python -m ogrenmen_kulaklik cost-report --month 2026-10 --dry-run --fixtures fixtures/kulaklik --out /tmp/kk-out && test -f /tmp/kk-out/cost-report.md` |
| **M10** | `apps/panel/` | M00 (tipler); `packages/design-system` salt okunur | §7 sayfaları, `lib/data` live/mock, veli onay formu, testler | `bun install --cwd apps/panel && bun run --cwd apps/panel typecheck && bun run --cwd apps/panel test && DATA_MODE=mock bun run --cwd apps/panel build` · `grep -rq "cdn.jsdelivr\|unpkg.com" apps/panel/app apps/panel/lib && exit 1 || true` (CDN yok) |
| **M11** | `docs/hukuk/` | — | §9.2 altı taslak, her biri inceleme başlığıyla; `docs/hukuk/README.md` sürüm tablosu | `grep -L "HUKUKİ İNCELEME GEREKLİ" docs/hukuk/*.md | wc -l` → `0` (README hariç) · `grep -q "{retention_days}" docs/hukuk/grup-kayit-bildirimi-v1.md` |
| **M12** | kök: `package.json`, `bunfig.toml`, `Makefile`, `README.md`, `.nvmrc`, `.editorconfig`, `.gitignore`, `.github/`, `scripts/`, `docs/runbook/`, `docs/adr/` | M00–M11 tümü | workspaces, `make ci`, tüm workflow'lar, `scripts/dev-up.sh`, `scripts/cost-report.py`, runbook'lar, ADR'ler, README | `make ci` (tüm modül kabul komutlarını sırayla koşar; `OGRENMEN_DATABASE_URL` yoksa DB testleri SKIP) · `bash scripts/dev-up.sh --check` (fake Telegram + worker dev + panel mock ayağa kalkar, `/health` 200, sonra kapanır) · `python -c "import yaml,glob;[yaml.safe_load(open(f)) for f in glob.glob('.github/workflows/*.yml')]"` |

**Dalga planı (2 eş zamanlı ajan):** D1: M00 ‖ M11 → D2: M01 ‖ M04 → D3: M03 ‖ M02 → D4: M05 ‖ M09 → D5: M08 ‖ M10 → D6: M06 ‖ M07 → D7: M12. M03 (Worker) D3'te başlar çünkü M00 dışında hiçbir koda bağlı değildir; DB adlarını bu belgeden alır ve `fakes/supabase.ts` ile çalışır; M01 ile uyum M12'de `db-test.sh` + Worker'ın `rpc-names.test.ts` (çağrılan RPC adları listesi ↔ migration'daki `create function` adları, statik `grep`) ile doğrulanır.

Her modül PR'ı: yalnız kendi dizini, kabul komutları PR açıklamasında çıktısıyla, `docs/plan.md`'ye göre kapsam dışı eklenti yok.

## 12. Açık sorular ve varsayımlar

Her soru bir varsayılan ile kapatılır; implementer bloklanmaz, değiştirmek isteyen ADR açar.

| # | Soru | Varsayılan karar |
| --- | --- | --- |
| 1 | Model adları/fiyatları değişirse? | Tek kaynak `models.json` (`verified_at` ile); kod model adı içermez, zincir adı (`chains.chat`) kullanır. Fiyat PR ile güncellenir; `cost-report` eski fiyatla yazılmış satırları `model` sütunuyla yeniden fiyatlandırmaz (defter tarihsel). |
| 2 | Gemini ücretsiz katman limitleri yayınlanmıyor | `gemini-free` zincirde ikinci sıradadır; 429'da düşer; limit bilinmiyor diye plan yapılmaz. |
| 3 | Batch API gecikmesi 24 saati aşarsa? | `facts` işi bir sonraki gece yeniden gönderir; eş zamanlı (tam fiyat) çağrıya **düşmez**; panelde "hafıza 1 gün geride" notu (`runtime_flags.facts_lag_days`). |
| 4 | pg_cron Supabase ücretsiz projede kapalıysa? | `runtime_flags.cron_owner='worker'`; Worker `scheduled()` aynı RPC'leri çağırır. |
| 5 | Supabase'de özel rol (`bot_runtime`) desteklenmezse? | Yedek: Worker `authenticated` rolüyle, `app_metadata.role='bot'` claim'li uzun ömürlü JWT; politikalar `auth.jwt()->'app_metadata'->>'role' = 'bot'` ile aynı matrisi uygular (`0012_rls.sql`'de her iki koşul `or` ile yazılır). |
| 6 | Embedding boyutu ve sağlayıcısı | `halfvec(768)`, Gemini embedding (Matryoshka 768). Düşüş FTS'tir, başka embedding modeli **değil** (boyut/uzay uyumsuzluğu). |
| 7 | Yaş doğrulama | Beyan (`birth_year`) + eğitmen teyidi; bilinmiyorsa reşit değil varsayılır → veli onayı gerekir. |
| 8 | Veli onayının kimlik doğrulaması | Panelden üretilen tek kullanımlık bağlantı (72 saat) + koordinatör teyidi; hukuki yeterliliği M11 belgesinde "inceleme gerekli". |
| 9 | Saklama süreleri | Mesaj 90 gün, prompt örneği 30 gün, bot cevabı 180 gün (işaretli 365), olgu aktif ≤ 300/öğrenci ve 180 gün `expired`, video 30 gün, transkript dönem + 1 yıl. Değişiklik `tg_chats.retention_days` + belge sürümü ile. |
| 10 | Kanıt eşiği ve yanılgı eşiği | `min_evidence = 5` (yüzde gösterimi), yanılgı `open` için 3 kanıt veya eğitmen onayı. |
| 11 | Kota değerleri | standard: 25 mesaj, 5 test, 0 araştırma, 10 şekil; pilot: 40/8/2/20; eğitmen: 50 mesaj. Gün sınırı 00:00 Europe/Istanbul. |
| 12 | Tavanlar | Gün 0,80 $, ay 24 $, uyarı %50/%80/%100; `free_only` → `degraded` geçişleri §5.6. |
| 13 | Gruplarda otomatik yanıt | Yalnız etiket/yanıt; soru işaretli mesaja eğitmen 10 dk yanıt vermezse bot devreye girer (`runtime_flags.group_auto_answer_min=10`); kapatılabilir. |
| 14 | Discord | Hayır (MVP Telegram); adaptör arayüzü `telegram/client.ts` ile sınırlı, ikinci kanal ayrı modül. |
| 15 | Ses | MVP'de kapalı (`voice_minutes=0`); Telegram sesli mesaj gelirse "Şimdilik yazılı mesajları okuyabiliyorum." |
| 16 | Araştırma (Kitap) TYT pilotunda | `research_enabled=false`; modül inşa edilir, test edilir, açılmaz. |
| 17 | Şekillerde yazı tipi | Lexend TTF yoksa (repoda woff2 var) `fontTools` ile woff2→ttf dönüşümü `tablet` build adımında (`brotli` bağımlılığı); başarısızsa DejaVu Sans, test yine geçer. Renkler: zemin `#f6f8fc`, çizgi `#051c60`, vurgu `#0030a2`, eksen yazısı ≥ 14 px. |
| 18 | Tectonic yoksa PDF | `.tex` üretilir, derleme atlanır; `--require-pdf` CI'da yalnız `tectonic` kurulu işte. |
| 19 | Transkript sağlayıcısı | Varsayılan `gemini` (0 $, ücretsiz katman); kalite yetmezse `groq` (0,06 $/ders); ikisi de yoksa `whispercpp` kurucu makinesinde. |
| 20 | Güçlü model | Gemini 2.5 Pro varsayılan; Claude Sonnet `enabled=false`, anahtar gelince açılır. |
| 21 | Supabase bölgesi | `eu-central-1` (Frankfurt); yurt dışı aktarım belgesinde yazılır. |
| 22 | Panel kimlik sağlayıcısı | E-posta + şifre; Google OAuth sonra. |
| 23 | Öğrenci web girişi | MVP'de yok; `students.auth_user_id` ve `authenticated` öğrenci politikaları hazır ama kullanılmıyor. |
| 24 | Ham video nerede durur | Supabase Storage'da **değil**; kurucu makinesi/Drive'da 30 gün; `lessons.video_path` yalnız yol. |
| 25 | Teşhis adaptif mi | Hayır, sabit 18 madde; adaptif sürüm ikinci dilimle birlikte. |
| 26 | Sohbette şekil üretimi | Yok; şekiller yalnız gece üretilir ve onaylı havuzdan servis edilir (`figure` kotası havuzdan gönderim sayısıdır). |
| 27 | Prompt sürümü değişince havuz ne olur | `content_pool` prompt'tan bağımsız (onaylı metin); `bot_responses.prompt_version` ile A/B karşılaştırması haftalık raporda. |
| 28 | Dil | Tüm öğrenci/eğitmen metni Türkçe; kod tanımlayıcıları İngilizce; SQL yorumları Türkçe. |
| 29 | Para birimi | USD (sağlayıcı faturaları); panelde "0,002 $" biçimi. |
| 30 | Service_role GitHub Actions'ta | Evet, `prod` Environment secret'ı; yalnız `nightly/weekly/render/ders` iş akışları; PR iş akışlarına **asla** geçmez (`environment:` yalnız main'de). |
