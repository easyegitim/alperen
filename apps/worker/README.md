# apps/worker — Öğrenmen iş işçisi

Node 22 + TypeScript. pg-boss (şema `pgboss`) tüketicisi; Anthropic geçidi (`@ogrenmen/llm`), Playwright PDF, web-push ve zamanlayıcı burada çalışır. Veritabanına service role ile (RLS atlanır) yalnız bu uygulama bağlanır. Plan: `docs/PLAN-v2.md`, `docs/PLAN-v2-detail.md`.

## Çalıştırma

```bash
cp .env.example .env.local        # DATABASE_URL en azından
bun run dev                       # tsx watch (tüm işler, --process=all)
bun run dev:pdf                   # yalnız pdf.render
node --import tsx src/index.ts --process=worker
bash check.sh                     # typecheck + eslint + vitest; OGRENMEN_LIVE=1 ile pg-boss entegrasyonu da
```

pg-boss şemasını ve tablolarını açılışta kendisi kurar (migration yok). Kuyruklar (`createQueue`) her süreçte tüm iş adları için açılır; böylece SQL tarafındaki `public.enqueue_job(name, data)` hangi süreç ayakta olursa olsun iş ekleyebilir. İşçiyi yalnız işi sahiplenen süreç bağlar.

## Süreçler

| Süreç | İşler | Zamanlayıcı |
| --- | --- | --- |
| `worker` | `noop`, `llm.ping`, `memory.compact`, `dossier.render`, `push.send`, `weekly.summary` | evet |
| `pdf` | `pdf.render` (Chromium kurulu imajda) | hayır |
| `all` | hepsi (yerel geliştirme) | evet |

Seçim: `--process=pdf` bayrağı, yoksa `WORKER_PROCESS`, yoksa `all`.

## İşler (`src/jobs/registry.ts`)

| Ad | Yük | Eşzamanlılık | Yeniden deneme | Durum |
| --- | --- | --- | --- | --- |
| `noop` | `{ echo?, sleepMs?, fail? }` | 4 | 0 | uçtan uca deneme |
| `llm.ping` | `{ route?, text?, maxTokens?, studentRef? }` | 1 | 3, üstel, 30 sn | tek geçit çağrısı; `llm_calls` satırı yazar (`purpose=llm.ping`) |
| `memory.compact` | `{ student_id? }` | 1 | 2 | iskelet (öğrenci sayar) |
| `dossier.render` | `{ student_id, course_id }` | 4 | 3 | `render_dossier` RPC, hash değişince `student_dossier_cache` |
| `pdf.render` | `{ html \| htmlRef, output, document_id?, options? }` | `PDF_CONCURRENCY` | 2 | HTML, A4 PDF, Storage, `generated_documents.pdf_path` |
| `push.send` | `{ notification_id \| user_id+title, ... }` | 4 | 5 | web-push iskeleti (VAPID); 404/410 abonelikleri siler |
| `weekly.summary` | `{ weekStart? }` | 1 | 2 | iskelet |
| `diagnosis.followup`, `exam.report`, `document.generate`, `curriculum.merge` | — | — | — | yalnız kuyruk (işleyici P1+); SQL RPC'leri iş ekler, iş bekler |

Hata semantiği: `PermanentJobError` ya da geçersiz yük yeniden denenmez, doğrudan `dead_letter` kuyruğuna gider (30 gün saklanır). Diğer hatalar kuyruğun politikasıyla (üstel geri çekilme) yeniden denenir; bitince yine `dead_letter`.

## Zamanlayıcı (`src/schedules.ts`)

pg-boss `schedule`, saat dilimi `Europe/Istanbul`:

- `memory.compact`: her gece 03:00 (`0 3 * * *`)
- `weekly.summary`: pazar 19:00 (`0 19 * * 0`)

`WORKER_SCHEDULES=auto` iken `runtime_flags.cron_owner = "pg_cron"` ise kurulmaz (pg_cron yalnız iş ekler). `on` / `off` ile zorlanır. Kurulmayan kipte daha önce kalmış pg-boss zamanlamaları açılışta silinir (`removeSchedules`), böylece pg_cron'a geçişte iş iki kez çalışmaz.

pg_cron tarafı (`supabase/migrations/0016_cron.sql`) aynı iş adlarını UTC'de enqueue eder: `memory.compact` `0 0 * * *` (03:00 TRT), `weekly.summary` `0 16 * * 0` (pazar 19:00 TRT); registry testi adları denetler. SQL'den eklenen işler kuyruğun politikasını (`pgboss.queue`) kopyalar; `PGBOSS_SCHEMA` üretimde `pgboss` olmalıdır (SQL enqueue yalnız bu şemada çalışır). SQL/RPC iş yükleri snake_case'dir (`analysis_id`, `session_id`...); worker işlerinin yükleri de snake_case'tir (`student_id`, `course_id`, `document_id`, `notification_id`, `user_id`); eski camelCase anahtarlar uyumluluk için kabul edilir. İşleyicisi olmayan (`handler: null`) kuyruklarda bekleyen işler 90 gün (`retentionSeconds`) saklanır, sonra silinir.

## Sağlık ve kapanış

`GET /healthz` (node:http): DB ping + açılış tamamlandı + kapanıyor değil, ise 200, değilse 503. SIGTERM/SIGINT: sağlık 503'e döner, pg-boss zarifçe durur (`SHUTDOWN_TIMEOUT_MS`), Chromium ve havuz kapanır.

## PDF (`src/pdf/render.ts`)

Playwright Chromium, süreç başına tek tarayıcı, her çıktı ayrı bağlamda. Ağ varsayılan kapalı (yalnız `data:`/`blob:`/`about:`; `allowedHosts` ile açılır). `@page` boyutu önceliklidir, yoksa A4. Chromium yolu: `PDF_CHROMIUM_PATH`, yoksa `PLAYWRIGHT_BROWSERS_PATH` altındaki kurulu sürüm (yerelde `/opt/pw-browsers`), yoksa Playwright varsayılanı. Kök kullanıcıda `--no-sandbox` otomatik eklenir.

## Ortam değişkenleri

Tam liste ve açıklama: `.env.example`.

| Değişken | Not |
| --- | --- |
| `DATABASE_URL` | zorunlu; doğrudan Postgres (LISTEN/advisory lock için PgBouncer işlem havuzu değil) |
| `WORKER_PROCESS`, `PGBOSS_SCHEMA`, `PGBOSS_POOL_MAX`, `DB_POOL_MAX` | süreç ve havuzlar |
| `HEALTH_HOST`, `HEALTH_PORT` (`PORT`) | sağlık sunucusu |
| `WORKER_SCHEDULES`, `LOG_LEVEL`, `SHUTDOWN_TIMEOUT_MS` | |
| `OGRENMEN_LLM` (`fake`), `ANTHROPIC_API_KEY` | geçit; anahtar yoksa yalnız LLM işleri kalıcı hata verir |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_BUCKET_DOCUMENTS` | Storage (`src/storage.ts`) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | üçü birlikte |
| `PDF_CHROMIUM_PATH`, `PDF_CONCURRENCY` | PDF |

## Dağıtım

```bash
docker build -f apps/worker/Dockerfile -t ogrenmen-worker .     # bağlam: depo kökü
fly deploy -c apps/worker/fly.toml --dockerfile apps/worker/Dockerfile
```

`fly.toml`: iki süreç grubu (`worker`, `pdf`), ikisi de iç port 8080 ve `/healthz` denetimi; dışarı açık hizmet yok. Sırlar `fly secrets set` ile.

## Testler

- `test/registry.test.ts`: kayıt defteri tutarlılığı, süreç dağılımı, yük şemaları, zamanlamalar, yapılandırma
- `test/jobs.test.ts`: `llm.ping` (fake geçit, InMemory defter satırı), `dossier.render`, `pdf.render`, `push.send`, `memory.compact`
- `test/pdf.test.ts`: gerçek Chromium ile A4 PDF
- `test/boss.live.test.ts`: yerel Postgres'te geçici şema (`pgboss_t_*`, sonunda silinir); `OGRENMEN_LIVE=1` ile (`bun run test:live`)
