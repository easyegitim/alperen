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
| `worker` | `noop`, `llm.ping`, `memory.compact`, `dossier.render`, `push.send`, `weekly.summary`, `curriculum.*`, `suggestions.refresh`, `activity.completed`, `conversation.summarize`, `upload.intake`, `diagnosis.run`, `diagnosis.followup` | evet |
| `pdf` | `pdf.render` (Chromium kurulu imajda) | hayır |
| `all` | hepsi (yerel geliştirme) | evet |

Seçim: `--process=pdf` bayrağı, yoksa `WORKER_PROCESS`, yoksa `all`.

## İşler (`src/jobs/registry.ts`)

| Ad | Yük | Eşzamanlılık | Yeniden deneme | Durum |
| --- | --- | --- | --- | --- |
| `noop` | `{ echo?, sleepMs?, fail? }` | 4 | 0 | uçtan uca deneme |
| `llm.ping` | `{ route?, text?, maxTokens?, studentRef? }` | 1 | 3, üstel, 30 sn | tek geçit çağrısı; `llm_calls` satırı yazar (`purpose=llm.ping`) |
| `memory.compact` | `{ student_id?, batch_id?, meta?, hashes?, attempt?, no_chain? }` | 1 | 2 | gece: > 6 KB hafıza dosyaları `memory_compaction` (Sonnet, Batch) ile ≤ 4 KB; gönder → topla (aynı iş, `batch_id`; bitmediyse 10 dk sonra, en çok 24 sa); `PgStore.write(…, 'compact', 'memory-compact', { expectedHash })`: gönderimdeki md5 (`hashes`) tutan dosyaya Batch çıktısı yazılır, Batch sürerken değişen dosya güncel içerikle senkron yeniden sıkıştırılır (öğrenci başına ≤ 20 senkron; fazlası ve topla sırasında çakışan ertesi geceye, `deferred`); yüksüz çalışma gece zincirini kurar |
| `dossier.render` | `{ student_id, course_id }` | 4 | 3 | `@ogrenmen/llm` `renderDossier`: `render_dossier` RPC → metin → sha256; metin değişince `student_dossier_cache` |
| `suggestions.refresh` | `{ student_id?, reason? }` | 4 | 3 | öneri motoru (aşağıda); yüksüz: etkin kaydı olan her öğrenci için iş (`debounced('suggestions:<id>')`) |
| `activity.completed` | `{ student_id, enrollment_id?, course_id?, kind }` | 4 | 3 | etkinlik sonrası `suggestions.refresh` + `dossier.render` |
| `conversation.summarize` | `{ conversation_id? }` | 2 | 3 | `conversation_summary` (Haiku): son 30 mesaj dışı (önceki özetten sonrası, ≥ 10 mesaj) → `conversations.summary`, `summary_upto_message_id`; girdi penceresi (60 bin karakter) en eskiden başlar ve kullanıcı turu sınırında biter, özet yalnız pencerenin sonuna kadar ilerler, kalan için hemen yeni tur; yüksüz: sohbet başına iş |
| `upload.intake` | `{ upload_ids[1..40], kind: own_work \| school_exam, student_id, enrollment_id }` (own_work en çok 4) | 2 | 3 | Yükle ekranı (`submit_upload` RPC'si `enqueue_job` ile atar): Kendi çalışmam → `diagnosis.run` (`singletonKey diagnosis:<ilk yükleme>`); Okul denemesi → `exams(deneme, uploaded, draft)` + `exam_sessions(uploaded, analysing)` + `audit.events 'exam.upload_intake'` tek SQL deyiminde (yarım kayıt kalmaz; analiz P2) + "Deneme analizi yakında" kartı |
| `diagnosis.run` | `{ upload_ids[1..4], enrollment_id }` | 2 | 3, üstel, 20 sn | Files API (`anthropic_file_id` saklanır, `expires_in_seconds` 90 gün; süresi dolmuş kimlik bir kez yeniden yüklenir; sahte: `fake-file-<id>`) → `solution_diagnosis` (Opus · high; görsel `image`, PDF `document`) → çıktı `audit.events 'diagnosis.raw'`'a (yeniden deneme Opus'u yeniden çağırmaz) → doğrulama (yaprak kazanım, katalog etiketi, adım no; düşenler `analysis.validation`; modelin kazanım sırası `analysis.skill_order`) → `apply_diagnosis` (gözlem + BKT; öneri yükü `{parent_id, name, description, id?}`; otopilot + `ai_draft` müfredatta gözlem yeni yaprağa; `diagnosis.followup` kuyruğa) → Voyage gömmesi (`VOYAGE_API_KEY` yoksa atlanır) → `upload_result` kartı ("Çözümünü inceledim: 3. adımda işlem kuralı."; `copy_key = analysis:<id>`, öneri motoruyla aynı metin: `uploadNotice`) → yüklemeler `ready`; ret (`RefusalError`) ya da şemaya uymayan çıktı (`ParseError`) → `failed` + "Fotoğrafı okuyamadım" kartı (OGR-JOB-143); kalıcı yapılandırma/kimlik/istek hatası → `failed` + "Yüklemeni şu an işleyemedim" + `log.error` (OGR-JOB-146); başka hata son denemede → aynı kart (OGR-JOB-145). Düşen her teşhis `audit.events 'diagnosis.failed'` (`{upload_ids, enrollment_id, failure, reason}`) bırakır; kart `copy_key = upload:<ilk yükleme>`. Aynı küme ikinci kez teşhis edilmez |
| `diagnosis.followup` | `{ analysis_id, enrollment_id }` | 2 | 3 | `memory_delta` (Haiku) → `applyMemoryDelta` (hafıza aracının işleyicileri, actor `memory-delta`) → `activity.completed`; doğru/okunamayan teşhiste Haiku çağrılmaz |
| `pdf.render` | `{ html \| htmlRef, output, document_id?, options? }` | `PDF_CONCURRENCY` | 2 | HTML, A4 PDF, Storage, `generated_documents.pdf_path` |
| `push.send` | `{ notification_id \| user_id+title, ... }` | 4 | 5 | web-push iskeleti (VAPID); 404/410 abonelikleri siler |
| `weekly.summary` | `{ weekStart? }` | 1 | 2 | iskelet |
| `exam.report`, `document.generate`, `practice.generate`, `memory.correction` | — | — | — | yalnız kuyruk (işleyici sonra); SQL RPC'leri iş ekler, iş bekler |
| `curriculum.draft` | `{ curriculum_id, course_text, upload_ids[]?, course_id?, enrollment_id?, student_id?, target_exam?, course_kind?, requested_by? }` | 2 | 3, üstel, 60 sn | müfredat taslağı (aşağıda) |
| `curriculum.merge` | `{ proposal_id }` | 1 | 3 | kabul edilen birleştirme: taslakta yerinde, yayındaysa yeni sürümde; yayın her zaman eğitmende |
| `curriculum.proposals.review` | `{ curriculum_id?, limit?, min_age_hours? }` | 1 | 2 | gece: açık öneriler müfredat başına Batch (`proposal_review`) |
| `curriculum.proposals.collect` | `{ batch_id, meta, proposals }` | 1 | 72 × 10 dk | Batch sonucu: kararlar `payload.review`'a, otopilotta güvenli kabul `curriculum_autopilot_accept` (taslağa) |

Hata semantiği: `PermanentJobError` ya da geçersiz yük yeniden denenmez, doğrudan `dead_letter` kuyruğuna gider (30 gün saklanır). Diğer hatalar kuyruğun politikasıyla (üstel geri çekilme) yeniden denenir; bitince yine `dead_letter`.

Yükle → Teşhis açıkları (P2, orkestratör kararı bekliyor): PLAN-v2 §13 "Yükle" sonucu Bugün kartına ek olarak Koç'ta bir
mesajla da bildirmeyi ister; `diagnosis.run` şimdilik yalnız Bugün kartını yazar (Koç'a `one_line` + `seed=<analysis_id>`
asistan mesajı, koç sohbeti sahibinin `conversation_messages` sözleşmesiyle eklenecek; P1'de kalırsa plan tablosu
güncellenmeli). Canlı testler: `diagnosis.live.test.ts` işleyicileri doğrudan çağırır; `upload.live.test.ts` zinciri gerçek
pg-boss ile sınar (öğrenci JWT'si → `submit_upload` → `pgboss.job` → `upload.intake` → `diagnosis.run` → kart; ardından
`suggestions.refresh` kartı korur; yeniden gönderim, alt küme, tür değişimi).

## Müfredat kurucu (`src/jobs/curriculum-*.ts`, `src/curriculum/`)

PLAN-v2 §3.5. SQL tarafı `supabase/migrations/0025_curriculum_builder.sql`.

- **Taslak** (`curriculum.draft`): `onboarding_enroll` yeni ders açınca ya da eğitmen düşen taslağı yeniden kurunca
  (`curriculum_draft_retry`, editörde "Taslağı yeniden kur") SQL'den kuyruğa düşer. Durum
  `curricula.draft_status` / `draft_progress` (Realtime ile izlenir): `queued → researching (10) → drafting (45) →
  saving (85) → ready (100)`; hata `failed` + `draft_error` (geçici hata `queued`'a döner ve yeniden denenir); aynı ders
  metnine uyan aktif müfredat varsa `skipped` (kayıtlar `curriculum_draft_supersede` ile ona taşınır). Kazanımı olan
  müfredatta iş yazmadan biter (tekrar çalışma). Adımlar: `curriculum_research` (Opus 5.5 · high, `web_search_20260209`
  + `web_fetch_20260209`, en çok 8 kullanım, atıflı serbest metin) → `curriculum_draft` (Opus 5.5 · high, araçsız,
  `curriculum-draft` şeması; yüklenen dosyalar `document` bloğu: Files API `file_id` yalnız PDF/metinde, diğerlerinde
  çıkarılmış metin; yüklemeler sahiplikle süzülür: müfredatı açanın, `requested_by` eğitmenin ya da kayıtlı öğrencinin) →
  `checkDraft` (tek kök, köke bağlı/döngüsüz, derinlik ≤ 4, kod benzersiz, ön koşul döngüsüz, etiketler geçerli) →
  `save_curriculum_draft` tek işlemde: kazanımlar + kind'a göre BKT varsayılanları (unit 0,35/0,08 · outcome 0,30/0,12
  · sub_outcome 0,25/0,15; tahmin 0,25, kayma 0,10) + ön koşullar + yanılgı etiketleri (küresel çakışmada müfredata
  özgü önekle yeniden adlandırılır; o da çakışırsa yazılmaz, `tags_dropped` döner ve günlüğe yazılır). İlk `practice`
  önerisi (rank 0, ilk ünitenin ilk 3 yaprağı; `app.first_practice_suggestion`) yalnız otopilot etkinse (TYT/AYT/LGS)
  taslak kaydında; kapalıysa (üniversite/okul dersi ya da eğitmen kapattı) eğitmenin yayınında (`curriculum_publish`).
  Ücretli çağrıdan önce `check_spend('curriculum.draft')` (yalnız gerçek taşımada). Sahte taşımada taslak
  `packages/llm/fixtures/curriculum_draft/01-tyt-matematik.json` (2 ünite × 3 kazanım × 2 alt kazanım).
- **İnceltme**: `curriculum.proposals.review` açık önerileri müfredat başına bir Batch öğesi yapar (sistem: prompt, ders
  bloğu: girintili "kod · ad" ağacı); `curriculum.proposals.collect` bitmemiş Batch'te yeniden denenir, bitince
  kararları öneriye yazar. Otopilot (`curriculum_autopilot_state`: `origin = ai_draft` + TYT/AYT/LGS +
  `runtime_flags.curriculum_autopilot[ders türü]` ya da eğitmen seçimi `curricula.autopilot`) açıksa güveni
  `settings.curriculum_autopilot_min_confidence` (varsayılan 0,90) üstündeki `accept` kararları
  `curriculum_autopilot_accept` ile TASLAĞA uygulanır: müfredat yayındaysa açık taslak sürüm açılır (varsa o), öneri
  oraya taşınır (`payload.origin_curriculum_id`, `payload.result.curriculum_id`); yayındaki ağaç hiç değişmez. Ret ve
  `needs_instructor` eğitmene kalır. `proposal_review` promptu prompts paketinde yoksa yedek metin
  (`worker-proposal-review`) kullanılır.
- **Yeni sürüm**: yapısal kabul (birleştirme) `curriculum.merge` işidir: taslakta kanıt yoksa yerinde birleşir; yayındaki
  müfredatta `curriculum_new_version` (aynı kod, sürüm + 1) → `curriculum_edit(merge)`. İş yayınlamaz
  (`result.published = false`); yayın her zaman eğitmenin onayıyla (`curriculum_publish`: önceki sürüm emekli; ders,
  kayıt, ustalık, açık yanılgılar ve sürüme bağlı içerik — soru bankası, şablonlar, içerik havuzu, sınavlar, çıkmış sınav
  maddeleri, izlence konuları, soru tarzları — kazanım koduyla, birleşmede `draft_meta.code_map` eşlemesiyle taşınır).
  İş tekrar çalışırsa (drop kazanımı hedefte yoksa) birleşmiş sayılır.
- **Yetki**: düzenleme ve öneri kararı `app.can_edit_curriculum` (decide_proposal kuralı); yayın, yeni sürüm ve otopilot
  `app.can_publish_curriculum` (müfredatın/dersin sahibi, admin; öğrencisi üzerinden bağlı eğitmen yalnız bütün etkin
  kayıtlar kendi öğrencisiyse).
- **Eksik**: eğitmen editöründe kaynak (izlence, kitap, çıkmış sınav) yükleme adımı yok; `curriculum_draft_retry`
  `p_upload_ids` alır ama arayüz şimdilik kaynaksız yeniden kurar. Onboarding de kaynak göndermez.
- Gece zamanlaması henüz kurulmadı: `SCHEDULES` ↔ pg_cron eşliği `supabase/tests/01_schema.sql`'de iki zamanlamaya
  sabittir; `curriculum.proposals.review` eklenince ikisi birlikte güncellenmeli.

## Öneri motoru (`src/suggestions/`, docs/PLAN-v2.md §13)

`signals.ts` öğrenci başına sinyalleri okur (yalnız kimlik, kod, sayı, kısa ad; hafıza/sohbet/yükleme içeriği yok),
`rules.ts` saf ve deterministik kurallarla kartları seçer, `copy.ts` metni yazar, iş `public.replace_suggestions` ile
aktif önerileri tek işlemde değiştirir (başlatılmışlar kalır; aynı `copy_key` yerinde güncellenir, kimlik korunur).
Bugün ekranı `list_today_suggestions` ile ilk 4 başlatılabilir kartı ve en çok 2 bildirimi (belge, yükleme) gösterir;
iki bant ayrı sınırlanır, bildirimler kutuların arkasında kalmaz.

| rank | tür | kural | payload |
| --- | --- | --- | --- |
| 0 | `weekly_homework` | son 7 günde eğitmen ödevi: `instructor_notes` gövdesi "Ödev:" ile başlar (sütun eklenirse `kind = 'homework'`) ya da onaylı ders iddiası `lesson_claims.kind = 'homework'`; kazanımsızsa en zayıf yapraklar | `skill_ids, count 10, minutes 20, source, ref_id` |
| 10 | `practice` | en zayıf 2 kanıtlı yaprak (p < 0,85; bugün başlatılan kartların kazanımları geri planda); kanıt yoksa ağaçtaki ilk 2 yaprak (ilk test). Ödev yoksa kahraman kart | `skill_ids, count 8, minutes 12, reason weakest/starter` |
| 20 | `gap_analysis` | en güçlü kanıtlı açık yanılgının yaprağı + etiketin "asıl sorun" ön koşulu; yoksa aralıklı tekrar: p ≥ 0,6 ve son ustalık değişiminden bu yana ≥ aralık (p < 0,75: 2 g, < 0,9: 5 g, değilse 12 g; `mastery_history`), en çok 2, ders tekrarındaki kazanımlar hariç | `skill_ids, count 8, minutes 12, reason misconception/spaced_review` |
| 30 | `lesson_review` | son 7 günde onaylı (`approved`/`corrected`) ders analizi; kazanımlar iddialardan | `skill_ids, count 5, minutes 15, lesson_id, analysis_id, summary_pages 1` |
| 40 | `mini_exam` | sınav tarihine 0–14 gün | `exam_id null, count 20, minutes 30, days_left` |
| 50, 70… | `upload_result` | son 48 saatte: teşhis (`solution_analyses` yüklemeli; alt satır `analysis.one_line`, anahtar `analysis:<id>`), değerlendirilen okul denemesi (`exam_sessions` `uploaded`/`done`, `session:<id>`), bekleyen okul denemesi (`analysing`, "Deneme analizi yakında", `upload:<ilk yükleme>`), işlenemeyen yükleme (`audit.events 'diagnosis.failed'`, sayfalar hâlâ `failed` ve teşhis yok; `upload:<ilk yükleme>`). Worker kartı aynı sinyalle `uploadNotice`'ten yazar: yenileme kartı silmez, yerinde günceller | `upload_id, upload_ids, analysis_id, session_id, verdict` / `pending, exam_id` / `failed, failure, reason` |
| 60, 80… | `document_ready` | son 7 günde `rendered`/`published` kişisel belge | `document_id, kind` |

İlk kart rank 0 olur. Başlatılmış (`consumed_at`) bir kaynağa (not, ders analizi, belge, yükleme; mini deneme o gün)
yeniden kart açılmaz. Hepsi ertesi gün 05:00'te (Europe/Istanbul, `cardExpiry`) düşer: gece yenilemesi (03:30) yeni
kartları yazana dek Bugün boş kalmaz. En çok 8 başlatılabilir + 2 bildirim kartı yazılır; aynı türün sonraki bildirimi
bant içinde geri düşer (yükleme ve belge birbirini gölgelemez). Her karta `payload.copy_key` yazılır: aynı kart
sonraki yenilemede yeniden metin üretmez ve kimliğini korur. Metin: `suggestions_copy` (Haiku · low,
notification-copy; prompt `@ogrenmen/prompts`); `OGRENMEN_LLM=fake` ya da `OGRENMEN_SUGGESTIONS_COPY=template` iken
şablon. Başlığı yalnız kahraman kartta LLM yazar; kutu ve bildirimlerde şablon etiketi kalır, LLM alt satırı yazar.
LLM metni sınırı aşarsa (başlık ≤ 120, alt satır ≤ 160), ünlem/yüzde/emoji içerirse, şablondaki bir sayıyı
değiştirirse ya da girdide olmayan sayı uydurursa veya çağrı düşerse şablon kullanılır.

Tekilleştirme (`src/jobs/dedupe.ts`): kuyruklar pg-boss `standard` politikasıyla açılır ve orada `singletonKey` tek
başına yinelemeyi düşürmez. `debounced(key)` 15 sn'lik dilimde anahtar başına tek iş açar, dilim doluysa işi sonraki
dilime erteler (`suggestions:<id>`, `dossier:<id>:<ders>`); `oncePer(key)` 12 saatlik dilimde bir kez (gece zinciri,
`summary:<sohbet>`). stately/short politikası seçilmedi: SQL `enqueue_job` anahtarsız iş ekler ve bu politikalarda
anahtarsız işler (tüm öğrenciler) tek iş sayılırdı.

Tetikleyiciler: gece 03:30 (zincir, aşağıda), `finish_practice` ve `onboarding_enroll` (SQL, doğrudan), `activity.completed`
(teşhis sonrası `diagnosis.followup`; apps/web etkinlik sonunda kuyruğa atar).

## Zamanlayıcı (`src/schedules.ts`)

pg-boss `schedule`, saat dilimi `Europe/Istanbul`:

- `memory.compact`: her gece 03:00 (`0 3 * * *`)
- `weekly.summary`: pazar 19:00 (`0 19 * * 0`)

Gece zinciri (`NIGHTLY_CHAIN`): pg_cron ve bu süreç yalnız 03:00 `memory.compact`'ı zamanlar (0016_cron.sql ile birebir);
yüksüz `memory.compact` hemen `conversation.summarize`'ı ve 03:30'a `suggestions.refresh`'i kuyruğa atar. Böylece
zamanlama eşliği (`supabase/tests/01_schema.sql`) değişmeden yeni gece işleri çalışır.

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
- `test/suggestions.test.ts`: öneri kuralları (`test/fixtures/suggestions/signals.json` → `expected.json`: 3 kart), kart metni (şablon, Haiku, yedek, yeniden kullanım), `suggestions.refresh`
- `test/diagnosis.test.ts` / `test/diagnosis.live.test.ts`: Yükle → Teşhis (doğrulama kuralları, Files API, apply_diagnosis girdisi, kart; canlıda öğrenci JWT'siyle uploads satırı → gözlem/ustalık → öğrenci kendi teşhisini okur, okul denemesi kaydı)
- `test/nightly.test.ts`: `memory.compact` (Batch gönder → topla), `conversation.summarize`, `diagnosis.followup`, `activity.completed`
- `test/suggestions.live.test.ts`: geçici veritabanında (`@ogrenmen/llm/testing`) öneri motoru uçtan uca (RLS'li `list_today_suggestions`, `start_practice`), hafıza sıkıştırma, sohbet özeti, dossier
- `test/pdf.test.ts`: gerçek Chromium ile A4 PDF
- `test/boss.live.test.ts`: yerel Postgres'te geçici şema (`pgboss_t_*`, sonunda silinir); `OGRENMEN_LIVE=1` ile (`bun run test:live`)
- `test/curriculum.test.ts`: taslak doğrulama kuralları, kod öneki, belge blokları, `curriculum.*` işleri (sahte DB + sahte taşıma)
- `test/curriculum.live.test.ts`: geçici veritabanı (`ogr_worker_cur_*`: stub + tüm göçler + seed'ler, sonunda silinir) + gerçek pg-boss (`pgboss` şeması) + sahte LLM: `onboarding_enroll` → SQL'den `curriculum.draft` → DB satırları; ikinci öğrenci; aktif ikiz; düşen taslak → `curriculum_draft_retry` → ready; review → collect → otopilot (taslağa); otopilot yayındaki ağacı değiştirmez (açık taslak sürüm); yeni sürüm + birleştirme + yayın (ustalık ve soru bankası kodla taşınır, `start_practice` v1'in sorusunu seçer)
