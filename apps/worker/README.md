# apps/worker — Öğrenmen iş işçisi

Node 22 + TypeScript. pg-boss (şema `pgboss`) tüketicisi; Anthropic geçidi (`@ogrenmen/llm`), Playwright PDF, web-push ve zamanlayıcı burada çalışır. Veritabanına doğrudan Postgres bağlantısıyla (üretimde Supabase `postgres` rolü ya da pgboss'a yetkili rol; RLS atlanır) yalnız bu uygulama bağlanır (aşağıda "Üretim bağlantısı"). Plan: `docs/PLAN-v2.md`, `docs/PLAN-v2-detail.md`.

## Çalıştırma

```bash
cp .env.example .env.local        # DATABASE_URL en azından
bun run dev                       # tsx watch (tüm işler, --process=all)
bun run dev:pdf                   # yalnız pdf.render
node --import tsx src/index.ts --process=worker
bash check.sh                     # typecheck + eslint + vitest; OGRENMEN_LIVE=1 ile pg-boss entegrasyonu da
```

pg-boss şemasını ve tablolarını açılışta kendisi kurar (migration yok). Kuyruklar (`createQueue`) her süreçte tüm iş adları için açılır; böylece SQL tarafındaki `public.enqueue_job(name, data)` hangi süreç ayakta olursa olsun iş ekleyebilir. İşçiyi yalnız işi sahiplenen süreç bağlar. Açılışta başlangıç denetimleri koşar (aşağıda); düşerse süreç 78 ile çıkar.

## Üretim bağlantısı ve başlangıç denetimleri (`src/startup-checks.ts`)

SQL'den kuyruğa atılan her iş (`onboarding_enroll`, `submit_upload`, `start_practice`, `apply_diagnosis` …)
`public.enqueue_job` üzerinden `pgboss.job`'a yazılır; fonksiyon SECURITY DEFINER'dır ve **sahibinin** (migration rolü;
Supabase'de `postgres`) haklarıyla çalışır. Bu yüzden üretimde worker'ın `DATABASE_URL`'i **`postgres` rolüyle doğrudan
bağlantıdır** (Supabase "Direct connection", 5432; PgBouncer işlem havuzu değil) ya da pgboss şemasını kuran ve
`enqueue_job` sahibine yetki verebilen bir roldür. Worker başka bir rolle pgboss'u kurarsa sahip o şemaya yazamaz; eskiden
işler sessizce düşerdi, artık outbox'a düşer (`supabase/README.md` "pg-boss") ve açılış denetimi bunu yakalar.

Denetimler (sırayla; `WORKER_STARTUP_CHECKS=strict` varsayılan):

| Ad | Ne | Düşerse |
| --- | --- | --- |
| `pgboss.preflight` | pg-boss başlamadan: şema varsa bağlantı rolünde USAGE, yoksa veritabanında CREATE | **her kipte** (`warn` dahil) çıkış 78: pg-boss şemasız/yetkisiz başlayamaz, `warn` da süremez; pg-boss'un anlaşılmaz hatası (çıkış 1) yerine açık neden |
| `pgboss.role` | (a) bağlantı rolünün `pgboss.job` SELECT/INSERT/UPDATE/DELETE, `pgboss.queue` SELECT/INSERT/UPDATE yetkisi (`has_table_privilege`) | çıkış 78 |
| `pgboss.queues` | (c) gerekli kuyruklar (`REQUIRED_QUEUES`: curriculum.draft, suggestions.refresh, practice.generate, practice.prewarm, memory.correction, upload.intake, diagnosis.run, exam.analyse, exam.report, memory.compact, conversation.summarize, curriculum.proposals.review, pdf.render, push.send, outbox.drain ve SQL'in attığı diğerleri) + kayıt defteri + `startup.probe` var; eksikse `createQueue` ile açılır (`fixed`) | açılamazsa çıkış 78 |
| `enqueue_job` | (b) fonksiyon var; SECURITY DEFINER sahibinin `pgboss`'ta USAGE + `queue` SELECT + `job` SELECT/INSERT yetkisi. Eksikse `WORKER_PGBOSS_GRANT=auto` (varsayılan) iken bağlantı rolü (şema sahibi) bu dört yetkiyi verir (`fixed`, uyarı günlüğü); sonra deneme: geri alınan bir DO bloğunda `enqueue_job('startup.probe')` `pgboss.job`'a satır yazar (ekle → geri al, satır kalmaz). `PGBOSS_SCHEMA` `pgboss` değilse (yalnız testler) `skip` | çıkış 78; ileti çalıştırılacak `grant` cümlesini verir |
| `outbox` | `secure.job_outbox` (0029) varsa: bağlantı rolünde `secure` USAGE + tabloda SELECT/UPDATE/DELETE **ve** süper kullanıcı ya da BYPASSRLS (tabloda ENABLE + FORCE RLS var, politika yok: RLS atlamayan rol 0 satır görür ve aktarım hiçbir şey taşımaz); bekleyen sayısı | tablo yoksa (0029 uygulanmadı) yalnız uyarı (`outbox.drain` kapalı); tablo varken eksik yetki, RLS atlamayan rol ya da sorulamayan veritabanı çıkış 78 (işler outbox'ta sessizce birikmesin) |

Sonuç: `strict` → `HATA: başlangıç denetimi düştü: …` (stderr + JSON günlük), `/healthz` `WORKER_STARTUP_EXIT_DELAY_MS`
(2 sn) boyunca 503 `{"status":"degraded","startupChecks":{…}}`, sonra **çıkış 78** (EX_CONFIG). `warn` → süreç çalışır,
sağlık 503 `degraded` kalır. `off` → denetim yok (yalnız outbox varlığına bakılır). Geçen rapor da `/healthz` gövdesinde
`startupChecks` olarak görünür.

**Outbox aktarımı (`outbox.drain`, `src/outbox.ts`):** `enqueue_job` pgboss'a yazamadığında işi aynı işlemde
`secure.job_outbox`'a koyar. Worker süreci açılışta bir kez doğrudan, sonra her `OUTBOX_DRAIN_INTERVAL_MS` (30 sn)
`outbox.drain` işini `singletonSeconds` ile atar (birden çok kopya tek iş). İş tek işlemde `FOR UPDATE SKIP LOCKED` ile en
çok 100 satır alır, her satırı kayıt noktası içinde `boss.send(name, data, { id: outbox.id, db: <işlem> })` ile ekler ve
siler; kuyruğu olmayan ya da düşen satırda `attempts`, `retried_at`, `last_error` güncellenir, 5 dk sonra yeniden denenir.
İş kimliği outbox kimliğidir (aynı satır iki kez iş olmaz). Her aktarım sonunda bekleyen sayı, en eski satırın yaşı ve
takılı satırlar (`attempts >= 3`: kuyruk yok ya da kalıcı INSERT hatası) sayılır; `/healthz` gövdesinde
`outbox: {pending, oldestAgeSec, stuck, at}` (son aktarım) görünür. Takılı satır varsa ya da en eski satır 1 saatten
eskiyse `log.error('outbox aktarılamayan işler birikiyor')` yazılır (üretim alarmı buna bağlanır).

## Süreçler

| Süreç | İşler | Zamanlayıcı |
| --- | --- | --- |
| `worker` | `noop`, `llm.ping`, `memory.compact`, `dossier.render`, `push.send`, `weekly.summary`, `curriculum.*`, `suggestions.refresh`, `activity.completed`, `conversation.summarize`, `upload.intake`, `diagnosis.run`, `diagnosis.followup`, `exam.analyse`, `exam.report`, `practice.generate`, `practice.prewarm`, `document.generate`, `outbox.drain`, `notifications.evaluate`, `email.send`, `report.generate` | evet |
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
| `activity.completed` | `{ student_id, enrollment_id?, course_id?, kind }` | 4 | 3 | etkinlik sonrası `suggestions.refresh` + `dossier.render` + `notifications.evaluate` (ilerleme, çözülen yanılgı; 60 sn debounce) |
| `conversation.summarize` | `{ conversation_id? }` | 2 | 3 | `conversation_summary` (Haiku): son 30 mesaj dışı (önceki özetten sonrası, ≥ 10 mesaj) → `conversations.summary`, `summary_upto_message_id`; girdi penceresi (60 bin karakter) en eskiden başlar ve kullanıcı turu sınırında biter, özet yalnız pencerenin sonuna kadar ilerler, kalan için hemen yeni tur; yüksüz: sohbet başına iş |
| `upload.intake` | `{ upload_ids[1..40], kind: own_work \| school_exam, student_id, enrollment_id }` (own_work en çok 4) | 2 | 3 | Yükle ekranı (`submit_upload` RPC'si `enqueue_job` ile atar): Kendi çalışmam → `diagnosis.run` (`singletonKey diagnosis:<ilk yükleme>`); Okul denemesi (eski yol; P2 web'i doğrudan `submit_exam_upload` çağırır) → `submit_exam_upload` ile aynı kayıt (`exams(deneme, uploaded, telifli, processing)` + `exam_sessions(uploaded, grading, upload_ids, progress.stage = classify)` + `audit.events 'exam.upload_intake'` tek SQL deyiminde) → `exam.analyse` (`singletonKey exam:<oturum>`) + "Denemeni inceliyorum" kartı |
| `diagnosis.run` | `{ upload_ids[1..4], enrollment_id }`; deneme bağlamı `{ upload_ids[0..4], enrollment_id, context: 'exam', exam_response_id, session_id, exam_id, question_no, how_far_text }` | 2 | 3, üstel, 20 sn | Files API (`anthropic_file_id` saklanır, `expires_in_seconds` 90 gün; süresi dolmuş kimlik bir kez yeniden yüklenir; sahte: `fake-file-<id>`) → `solution_diagnosis` (Opus · high; görsel `image`, PDF `document`) → çıktı `audit.events 'diagnosis.raw'`'a (yeniden deneme Opus'u yeniden çağırmaz) → doğrulama (yaprak kazanım, katalog etiketi, adım no; düşenler `analysis.validation`; modelin kazanım sırası `analysis.skill_order`) → `apply_diagnosis` (gözlem + BKT; öneri yükü `{parent_id, name, description, id?}`; otopilot + `ai_draft` müfredatta gözlem yeni yaprağa; `diagnosis.followup` kuyruğa) → Voyage gömmesi (`VOYAGE_API_KEY` yoksa atlanır) → `upload_result` kartı ("Çözümünü inceledim: 3. adımda işlem kuralı."; `copy_key = analysis:<id>`, öneri motoruyla aynı metin: `uploadNotice`) → yüklemeler `ready`; ret (`RefusalError`) ya da şemaya uymayan çıktı (`ParseError`) → `failed` + "Fotoğrafı okuyamadım" kartı (OGR-JOB-143); kalıcı yapılandırma/kimlik/istek hatası → `failed` + "Yüklemeni şu an işleyemedim" + `log.error` (OGR-JOB-146); başka hata son denemede → aynı kart (OGR-JOB-145). Düşen her teşhis `audit.events 'diagnosis.failed'` (`{upload_ids, enrollment_id, failure, reason}`) bırakır; kart `copy_key = upload:<ilk yükleme>`. Aynı küme ikinci kez teşhis edilmez. **Deneme bağlamı** (`src/jobs/diagnosis-exam.ts`; `exam_how_far`, `finish_exam_session`, `exam.analyse` karalama dağıtımı atar): cevap + soru + gizli anahtar (yalnız modele) → görseller (yoksa sorunun kitapçık sayfası) + `<exam_context>` (prompts `examContextText`, solution_diagnosis v2) + soru ve öğrencinin metni veri bloğu → `apply_diagnosis(exam_response_id)` (ağırlık 0, `exam_responses.solution_analysis_id`; Bugün kartı yok); ham çıktı `audit 'diagnosis.raw'` (row_id = cevap); aynı cevap ikinci kez teşhis edilmez; düşerse `audit 'diagnosis.failed'` ({exam_response_id, session_id}) |
| `diagnosis.followup` | `{ analysis_id, enrollment_id }` | 2 | 3 | `memory_delta` (Haiku) → `applyMemoryDelta` (hafıza aracının işleyicileri, actor `memory-delta`) → `activity.completed`; doğru/okunamayan teşhiste Haiku çağrılmaz |
| `pdf.render` | `{ html \| htmlRef, output, document_id?, options? }` | `PDF_CONCURRENCY` | 2 | HTML, A4 PDF, Storage, `generated_documents.pdf_path` |
| `push.send` | `{ notification_id \| user_id+title, ... }` | 4 | 5 | web-push (VAPID; `emit_notification` push kanalı + abonelik varsa SQL atar); 404/410 abonelikleri siler; teslim `payload.delivery.push` (sent/dry/none/failed); VAPID yoksa kuru çalışma (aşağıda "Veli ve bildirimler") |
| `weekly.summary` | `{ attempt? }` | 1 | 2 | Pazar 19:00: memory.compact bitmediyse 15 dk sonra; `parent_summary.md` + weekly_summary bildirimi (aşağıda) |
| `notifications.evaluate` | `{ kinds?, student_id?, reason? }` | 1 | 2 | kural motoru: saatlik (`5 * * * *`) tüm kurallar + e-posta süpürmesi; olay (`activity.completed`) öğrenci başına ilerleme/yanılgı |
| `email.send` | `{ notification_id }` | 2 | 4, üstel | Resend; anahtar yoksa kuru çalışma; teslim `payload.delivery.email` |
| `report.generate` | `{ document_id, student_id?, report_kind?, params?, requested_by? }` | 2 | 3, üstel, 30 sn | veli raporu (`parent_request_report` atar): `report` rotası → doc-render PDF → Storage → rendered → `report_ready` |
| `practice.generate` | `{ set_id, enrollment_id, curriculum_id?, skill_ids[], count, template_ids[] }` | 4 | 2, üstel, 5 sn | `start_practice` bankada soru bulamayınca atar: şablon → yetmezse LLM → banka + set (aşağıda); son denemede `fail_practice_generation` |
| `practice.prewarm` | `{ enrollment_id, skill_ids?, per_skill? (8), reason? }` | 2 | 2, üstel, 60 sn | ilk öneri için banka ısıtma (`curriculum.draft` bitişi, `suggestions.refresh`'in ilk `practice` kartı; yaprak kümesi başına saatte bir; ilk kartı ekleyen SQL `app.first_practice_suggestion` da atar: otopilotlu taslak kaydı ve eğitmen yayını `curriculum_publish`, `reason: curriculum_ready`) |
| `exam.analyse` | `{ session_id, exam_id, enrollment_id?, student_id?, upload_ids[1..40] }` | 2 | 3, üstel, 30 sn (deneme 30 dk) | yüklenen okul denemesinin analizi (aşağıda "Deneme analizi") |
| `exam.report` | `{ session_id }` | 2 | 3, üstel, 30 sn | `grade_exam_session` atar; yalnız uygulama içi oturum: `exam/produce-report.ts` (rapor → PDF → Storage → `register_generated_document` → done) + veli bildirimi; yüklenen oturumda `skipped: uploaded` (raporu `exam.analyse` üretir), bitmiş/notlanmamış oturumda biter |
| `document.generate` | `{ document_id? \| request_id?, kind?, student_id? }` (en az biri) | 2 | 2, üstel, 20 sn (deneme 30 dk) | `request_document` atar: not / deneme / soru seti üretimi + doğrulama merdiveni + PDF (aşağıda "İçerik stüdyosu"); son denemede belge ve istek `failed` + Türkçe neden |
| `memory.correction` | — | — | — | yalnız kuyruk (işleyici sonra); SQL RPC'si iş ekler, iş bekler |
| `outbox.drain` | `{ reason? }` | 1 | 0 | `secure.job_outbox` → pg-boss (yukarıda "Outbox aktarımı"); süreç 30 sn'de bir atar |
| `curriculum.draft` | `{ curriculum_id, course_text, upload_ids[]?, course_id?, enrollment_id?, student_id?, target_exam?, course_kind?, requested_by? }` | 2 | 3, üstel, 60 sn | müfredat taslağı (aşağıda) |
| `curriculum.merge` | `{ proposal_id }` | 1 | 3 | kabul edilen birleştirme: taslakta yerinde, yayındaysa yeni sürümde; yayın her zaman eğitmende |
| `curriculum.proposals.review` | `{ curriculum_id?, limit?, min_age_hours? }` | 1 | 2 | gece: açık öneriler müfredat başına Batch (`proposal_review`) |
| `curriculum.proposals.collect` | `{ batch_id, meta, proposals }` | 1 | 72 × 10 dk | Batch sonucu: kararlar `payload.review`'a, otopilotta güvenli kabul `curriculum_autopilot_accept` (taslağa) |
| `style.ingest` | `{ source_id, course_id?, year?, term?, upload_ids? }` | 2 | 3, üstel, 30 sn (deneme 30 dk) | `ingest_exam_source` (0037) atar: çıkmış sınav alımı → kümeleme → tarzlar → öncelik planı (aşağıda "Tarz kütüphanesi") |
| `style.coverage.refresh` | `{ course_id, reason? }` | 2 | 3 | `style.ingest` sonu (ders başına 60 sn debounce): dersin öğrencilerinin `suggestions.refresh`'i + öncelikli 3 tarzın bankası < 5 ise `style.question_gen` (tarz başına 6 sa'de bir) |
| `style.question_gen` | `{ style_id, enrollment_id?, count? (5, 1–10), reason? }` | 2 | 2, üstel, 60 sn | tarza özel özgün soru (Opus) → SymPy → yalnız doğrulanan `approved` + `questions.style_id` |
| `lesson.prepare` | `{ lesson_id, upload_id?, transcript_upload_id?, upload_kind? }` | 2 | 2, üstel, 60 sn (deneme 60 dk) | `register_lesson` (0040) atar: ders medya servisi `/prepare` → ses + ≤ 30 kare Storage'a; hazır transkript varsa içe aktarır (aşağıda "Ders hattı") |
| `lesson.stt` | `{ lesson_id, audio_path?, frames[] }` | 2 | 2, üstel, 60 sn | servis `/stt` (Groq Whisper; 25 MB parçalama; anahtarsız `OGRENMEN_STT=fake`) → ad temizliği → `write_lesson_transcript` → ses silinir |
| `lesson.label` | `{ lesson_id, frames[] }` | 2 | 2, üstel, 60 sn | ad temizliği (packages/pii) + `speaker_label` (Sonnet · low, 10 dk pencereler) → temiz, etiketli transkript |
| `lesson.analyse` | `{ lesson_id, frames[] }` | 2 | 2, üstel, 60 sn | `lesson_analysis` (Opus · high, kareler + transkript + dossier) → `write_lesson_analysis` → `apply_lesson_claims` → bildirim + Bugün → done → kareler silinir; yazılmış analiz transkriptten yeniyse model yeniden çağrılmaz |
| `lesson.retention` | `{ limit? (100), reason? }` | 1 | 2 | gece 04:15 (`SCHEDULES`; pg_cron sahibiyse 0040'taki `ogrenmen-lesson-retention` 01:15 UTC): takılan dersler (processing, 2 saattir ilerlemiyor, kuyrukta işi yok) `failed`; süresi dolan ham video (90 gün), kalan çıkarılmış ses ve kareler, içe aktarılmış transkript dosyası Storage'dan → `lesson_mark_media_deleted`; liste sınırı dolarsa 1 dk sonra `more` devamı |
| `memory.apply` | `{ source: 'lesson', lesson_id, course_id, course_code, path, student_ids[], claim_ids[] }` | 2 | 3 | `apply_lesson_claims` (0041) atar: `/memories/courses/<kod>.md` ders bölümü (onaylı, öğrenciye uygun bilgiler) |

Hata semantiği: `PermanentJobError` ya da geçersiz yük yeniden denenmez, doğrudan `dead_letter` kuyruğuna gider (30 gün saklanır). Diğer hatalar kuyruğun politikasıyla (üstel geri çekilme) yeniden denenir; bitince yine `dead_letter`.

Yükle → Teşhis açıkları (P2, orkestratör kararı bekliyor): PLAN-v2 §13 "Yükle" sonucu Bugün kartına ek olarak Koç'ta bir
mesajla da bildirmeyi ister; `diagnosis.run` şimdilik yalnız Bugün kartını yazar (Koç'a `one_line` + `seed=<analysis_id>`
asistan mesajı, koç sohbeti sahibinin `conversation_messages` sözleşmesiyle eklenecek; P1'de kalırsa plan tablosu
güncellenmeli). Canlı testler: `diagnosis.live.test.ts` işleyicileri doğrudan çağırır; `upload.live.test.ts` zinciri gerçek
pg-boss ile sınar (öğrenci JWT'si → `submit_upload` → `pgboss.job` → `upload.intake` → `diagnosis.run` → kart; ardından
`suggestions.refresh` kartı korur; yeniden gönderim, alt küme, tür değişimi).

## İçerik stüdyosu (`src/jobs/document-generate.ts`, `src/documents/`, `py/figure_render.py`)

Not / deneme / soru seti üretimi (docs/PLAN-v2.md §2 Akış 5, §7; supabase 0034–0035). `request_document` belgeyi
(`generated_documents` queued) ve isteği (`document_requests`) açıp `document.generate` atar; iş:

1. **Kapsam** (`documents/context.ts`): belge + istek + müfredat; hedef yapraklar = istek kodları (üst düğüm → altındaki
   yapraklar) → konu adı eşleşmesi → kaydın en zayıf iki yaprağı (deneme kapsamsızsa bütün yapraklar). Örüntüler
   `student_patterns_for_prompt` (patterns.md satırları, açık yanılgılar, son hatalı teşhisler; ≤ 12, hedef yaprağınki
   önce; DB kimliği `patterns.md#N` prompt/AST'de `patterns.md:N`). Koç sohbetindeki istek cümlesi veri olarak gider.
   Not: `notesGenerationUserText` (uzunluk short 3 · medium 6 · long 10 sayfa, kendini sına 1–10). Deneme/soru seti:
   `examGenerationUserText` (en çok 40 soru; bölümler yaprakların en üst atasına göre ≤ 6, sayılar orantılı; zorluk
   easy/medium/hard/mixed bantları; LGS 4 şık, diğerleri 5).
2. **Üretim**: sistem = ürün promptu + ders bloğu + dossier (`buildPromptSystem`; ders geneli belgede yalnız ders bloğu).
   Rota `notes_generation` (document-ast) ya da `exam_generation` (exam-generation → `examToAst`: `q<no>` blokları,
   bölümler blueprint'ten, denemede optik form + anahtar sayfası). Opus · high, akış; `turn.now`; defter
   `ref = generated_documents/<id>`.
3. **Figürler** (`OGRENMEN_FIGURES`, varsayılan `auto`): gerçek anahtarla `code_execution` → model kodu konteynerde
   çalıştırır, `figure_<n>.svg` `collectOutputFiles` + `downloadFigureFiles` ile iner, konteyner aynı iş içindeki
   yeniden üretimde `container` ile yeniden kullanılır. İnmeyen (ya da adı birden çok figürde geçen) figür yerelde
   ÇALIŞTIRILMAZ: blok yeniden istenir, düzelmezse figürsüz. `local` (sahte LLM'de her zaman; gerçek anahtarla yalnız
   açıkça `OGRENMEN_FIGURES=local`; araç gönderilmez, `disableTools`) → `python3 -I -c <py/figure_render.py>` OS
   yalıtımında (`documents/sandbox.ts`): `setpriv --no-new-privs` (worker root ise nobody) → `unshare` kullanıcı + pid +
   ağ + bağlama + ipc + uts ad alanı, yeni `/proc` (worker'ın `/proc/<pid>/environ`'u görünmez), ağ yok, `/home`
   `/root` `/app` `/tmp` `/run` `/opt` … boş tmpfs ile örtülü (python ve kütüphaneleri hariç), iç kullanıcı ad alanında
   yetkisiz kullanıcı (örtü kaldırılamaz), boş ortam, çalışma dizini 64 MB tmpfs; figür başına ayrı süreç, 10 sn duvar
   saati + 9/10 sn CPU, 1,5 GB bellek, 8 MB dosya. Yalıtım kurulamazsa (kullanıcı ad alanı kapalı; ör. Docker'ın
   varsayılan seccomp'u) model kodu çalışmaz; yalnız sahte LLM fikstürünün (güvenilir) kodu yalıtımsız koşar. Ek katman
   AST denetimi: tam modül adı izin listesi (`math`, `numpy`, `matplotlib` ve çizim alt modülleri; sympy YOK: dizeyi
   `eval` eder), `__`, `open`/`exec`/`getattr`…, `os`/`sys`/`animation`/`lib`/`DataSource`/`savefig`/`print_*`… yok,
   `S`/`sympify`/`simplify`/`solve`/`Eq`… çağrılarına dize verilemez; kısıtlı yerleşikler; başlık `@ogrenmen/prompts`
   `FIGURE_PREAMBLE` (`save_figure(fig, n)`). kind=svg kodun kendisidir. Hepsi `sanitizeSvg` → sharp 640 px PNG → boş
   (tek renk) / boyut (≥ 100×40, ≤ 2400 yükseklik, SVG ≤ 60 000 karakter) → `figure_check` (Haiku; bağlam soru kökü ya
   da çevre metin, `hidden` = kökte geçmeyen sayısal cevap). Çizim kod özetine, denetim SVG özetine göre iş içinde
   önbelleklenir.
4. **Doğrulama merdiveni** (`documents/ladder.ts`): schema (geçit loose şemayla doğruladı; birleştirme sonrası
   `documentAst`) → sympy (`py/key_verify.py`; şık ve `canonical_expr` LaTeX'i `latexToPlain` ile `((a)/(b))`,
   `sqrt`, `**` biçimine) → figures → duplicates (belge içi kök+şık; bankaya `llmContentHash` ya da aynı kök: yalnız
   not `bank_matches`) → personalization (yalnız not: `calloutReferenceIssues` + `personalization_check` Haiku;
   kişiselleştirilmemiş notta kişisel başvuru sorundur; kişisel notta hiç hata kutusu yoksa belge düzeyinde `@callout`
   sorunu yeniden istenir ve gelen kutu öncül bloğunun ardına eklenir). Her tur bütün basamakları koşar; sorunlu bloklar
   `document_block_regen_note` ile kaydedilir ve tek çağrıda yeniden istenir (geçmiş: ilk istek + önceki çıktı;
   `<regen_blocks>` yalnız o bloklar ve nedenleri). Çıktı daraltılmıştır: şema `document-block-regen` (not: `blocks` +
   `keys`) ya da `exam-block-regen` (deneme: `items` + `keys`), `maxTokens` 8000; gateway `schema` geçersiz kılmasıyla
   (rotanın prompt'u ve önbelleği aynı kalır). Birleştirme blok kimliğiyle (not) ya da soru numarasıyla (deneme) yapılır,
   öteki bloklar korunur; şemayı bozan birleştirme geri alınır. Yeniden üretim maliyeti `g.costUsd`'de bir kez sayılır
   (`RegenOutcome.costUsd` 0). En çok `REGEN_MAX_ROUNDS` = 2 tur (blok başına sınır `documents_block_regen_max`; bu
   iş çalıştırmasının deneme sayısıyla ölçülür, önceki iş denemelerinin kayıtları hakkı yemez). Hak bitince: hatalı soru
   (anahtar, şekil, kopya) çıkar ve sorular/anahtarlar/optik form yeniden numaralanır; çizilemeyen figür bloğu çıkar
   ("figürsüz + verification notu"); kaynaksız/uydurma hata kutusu çıkar; kişisel notta kutu kalmazsa
   `meta.personalized = false`. Deneme/soru seti sorusuz kalırsa basamak `fail` → belge üretilemez. Anahtar doğrulayıcı
   çalışmazsa (python/SymPy yok) sympy `skipped` ("doğrulayıcı çalışmadı", uyarı günlüğü) ve deneme/soru seti
   `review_required` ile eğitmen incelemesine gider.
   Anahtar güveni (`mock_exam_from_document` p_keys `confidence`): SymPy'nin `verified` dediği anahtar 1,0, öteki (çıkarım,
   zaman aşımı, doğrulayıcı yok) 0,6; doğrulanmayan payı `INFERRED_REVIEW_SHARE` (%30) üstündeyse deneme/soru seti
   `review_required` ile incelemeye gider.
   **Sızıntı kuralı**: öğrenci `generated_documents.verification`'ı okuyabilir; bu yüzden saklanan nedenler (sympy
   `details` yalnız `{no, status}`, `dropped`, `regen[].reason` "soru N anahtarı doğrulanamadı", figür nedeni yalnız
   uyuşmazlık alanları) anahtar, doğru şık, `canonical_expr` ya da cevap değeri taşımaz; ayrıntı (`Issue.detail`)
   yalnız modele giden `<regen_blocks>` isteğinde ve worker günlüğündedir.
5. **Saklama**: `splitDocumentKeys` → `storedDocumentAst` (kodsuz, anahtarsız) → `register_generated_document`
   (content) → deneme/soru setinde `mock_exam_from_document` (exams practice/generated + exam_questions, SVG şekil
   `figure_svg` + anahtarlar `secure.exam_answer_keys`, source generated) → `renderDocumentPdf` (notta cevap sayfası
   anahtarlarla ve kazanım haritası; denemede anahtar basılmaz) → Storage `documents/<notes|exams|question-sets>/
   <öğrenci|course-<ders>>/<belge>.{html,pdf}` → register (yollar, maliyet farkı: `llm_calls` toplamı).
6. **Yayın**: `document_set_status('ready', {verification, personalization, review_required})`. İncelemeli belge
   (ders geneli, `spec.review`, `spec.audience = 'class'`) `review`a döner, eğitmene `document_review` bildirimi gider;
   onay `review_document`'ta. Değilse yayın: Bugün `document_ready` kartı ("Rasyonel sayılar notun hazır" · PDF),
   öğrenci bildirimi (+ `push.send`); veli P6.

Durumlar: `generating` → `verifying` (schema yazılır) → `ready` | `review`. Hata: son denemede ya da kalıcı hatada
(`DocumentFailure`, ret, yapılandırma) `document_set_status('failed', {error, verification?})` + AST silinir (kısmi
belge saklanmaz; Storage'daki `<taban>.html/.pdf` de `StorageLike.remove` ile silinir); taslak sınav `failed`. Nedenler Türkçe ve tek cümle ("Sorular doğrulamadan geçmedi; belge
hazırlanamadı.", "İstek içerik kurallarına takıldı; …", "Bugünkü üretim sınırına ulaşıldı; …"). Gerçek taşımada
`check_spend('document.generate')`.

`verification` jsonb (her basamak `{status: pass|fail|skipped, …}`, DB `at` ekler):

```json
{ "schema": {"status": "pass", "route": "notes_generation", "repaired": false, "rounds": 0},
  "sympy": {"status": "pass", "checked": 3, "verified": 3, "inferred": 0, "dropped": [], "details": [{"no": 1, "status": "verified"}]},
  "figures": {"status": "pass", "mode": "local", "count": 1, "rendered": [{"block_id": "b4", "via": "local", "width_px": 640, "height_px": 220, "bytes": 9000, "check": "match"}], "removed": []},
  "duplicates": {"status": "pass", "checked": 3, "dropped": [], "bank_matches": []},
  "personalization": {"status": "pass", "personalized": true, "callouts": 1, "model_check": "ok", "removed": []},
  "regen": [{"block_id": "q2", "step": "sympy", "reason": "soru 2 anahtarı doğrulanamadı", "attempt": 1, "at": "…"}] }
```

`personalization` jsonb: `{personalized, include_my_mistakes, patterns_offered, callouts: [{block_id, source, id, date}], skills, weak_skills}`.

## Deneme analizi (`src/jobs/exam-analyse.ts`, `src/exam/`)

docs/PLAN-v2.md §2 Akış 2a, §8. SQL tarafı 0030 (`submit_exam_upload`, `set_exam_progress`, `register_exam_questions`,
`set_exam_keys`, `record_exam_answers`, `grade_exam_session`, `exam_session_view`, `exam_how_far`, `exam_blank_reason`),
0031 (uygulama içi), 0032 (`register_generated_document`). Worker güvenilir çağırandır; anahtar değerleri yalnız worker ve
modelde kalır.

| aşama (`progress.stage`) | ne | `progress` sayaçları |
| --- | --- | --- |
| `classify` | alım: Storage'dan sayfa → sharp (EXIF yönü, basit eğrilik düzeltme −4°..+4°, en uzun kenar ≤ 2576 px, JPEG q85; `exam/images.ts`); geometri değiştiyse türev yükleme `<sahip>/exam-<oturum>/page-<n>.jpg` (uploads `photo`, kırpım kutuları ona göre); Files API kimliği `uploads.anthropic_file_id`. `page_class` (Haiku, ≤ 8 paralel); 90/180/270 döndürme uygulanır. Okul denemesinde PDF kabul edilmez (OGR-EXAM-104, "fotoğraf olarak yükle"; model çağrılmaz). Tek bir sayfadaki ret ya da onarımdan sonra da şemaya uymayan çıktı (sınıflama, kitapçık, optik, anahtar sayfası) o sayfayı okunamaz yapar (`page_unreadable`; stash'e `{unreadable, error}`), sınav düşmez | `pages_total`, `pages_done`, `pages_unreadable`, `booklet_pages`, `answer_sheet_pages`, `scratch_pages`, `key_pages` |
| `ocr` | kitapçık sayfaları `exam_page_items` (Sonnet, 6 paralel; ders bloğu) → `exam/merge.ts` (basılı sayfa sırası, `continues_*` birleştirme, yinelenen numarada zengin olan, boşluk uyarısı) → şekil kırpımı (`<sahip>/exam-<oturum>/q<no>-fig1.png`, `exam_questions.figure_upload_id`) → kazanım (`exam/skills.ts`) → `register_exam_questions` (`page_upload_id` = sorunun başladığı sayfa) | `booklet_total`, `booklet_done`, `questions`, `skills_tagged`, `skills_lexical` |
| `key` | (a) `answer_key` sayfası: `answer_sheet` rotası anahtar yönergesiyle → `uploaded`; (b) yayıncı (`exam/db.ts publisherMatch`): aynı müfredat, aynı yayınevi + başlık (Türkçe katlanmış; varsayılan "Okul denemesi · 3 Kas" başlığında aranmaz) ve örneklenen 3 sorunun kökü eşleşen (sözcük Jaccard ≥ 0,8) önceki sınav; aday yalnız yayımlanmış sınavın `instructor`/`generated` anahtarı ya da aynı kişinin (`created_by`) kendi önceki yüklemesi (başka öğrencinin anahtar fotoğrafı kimseyi notlamaz) → anahtar + kazanımlar; eşleşen sınavın kimliği stash `publisher_match`; (c) eksik kalan notlanabilir sorular `inferred_keys` (Opus + code_execution; ret ya da bozuk çıktıda sorular anahtarsız kalır, `key_missing`, notlama ve rapor sürer; varsayılan senkron `batchRetry`; `EXAM_KEYS_BATCH=1` ve gerçek taşımada Batch: kimlik stash'te, bitmediyse iş 2 dk sonra kendini yeniden kuyruğa atar, 6 sa sonra senkron) → `set_exam_keys` (kaynak, güven). `exam/grading.ts validateKeys`: şıklarda olmayan cevap, türe uymayan değer düşer | `key_source` (uploaded \| inferred \| instructor \| generated \| mixed), `keyed`, `key_unverified` (SQL: çıkarım ve güven < 0,8), `key_low_confidence` (aynı eşik, `KEY_LOW_CONFIDENCE` = 0,8: UI "anahtar doğrulanmadı"), `key_batch` |
| `grade` | optik form `answer_sheet` (çift işaret/okunmayan → boş + uyarı; birden çok form sayfası numaraya göre birleşir) → stash `answers` → `record_exam_answers` → `grade_exam_session` (gözlemler, ustalık, bölüm netleri); hattın `expectedScore`'u (net = doğru − yanlış/4) SQL ile karşılaştırılır | `answer_sheet_pages`, `answers_read`, `answers_double`, `answers_unclear` |
| `analyse` | `grade_exam_session` yazar (oturum `analysing`) | `questions`, `wrong_blank` |
| `report` | `exam/produce-report.ts`: `exam_report` (Sonnet, akış; araçlar `get_mastery`, `get_recent_exams` worker tarafında; girdi prompts `examReportUserText`) → modele doğru cevap gitmez (`key: null`; rapor öğrenci ve veliye açık) → özet cümlesi neti taşımıyorsa (sayı sınırlı, "net"e bitişik), metinde anahtar kalıbı varsa ("doğru cevap: C"; `leaksKey`) ya da model kalıcı düşerse deterministik rapor (`exam/report.ts fallbackReport`, aynı şablon) → `@ogrenmen/doc-render` `renderHtml` + `renderPdf` (grafikler: `section_nets`, `skill_map`, `error_causes`, `time_per_question`) → Storage `STORAGE_BUCKET_DOCUMENTS/reports/<öğrenci>/<oturum>.pdf` → `register_generated_document(kind='report', exam_session_id)` | `net`, `card_line`, `report_status` (rendered \| failed) |
| `done` | Bugün `upload_result` kartı (`session:<id>`, "Deneme sonucun hazır" + `card_line`), veli bildirimi `exam_analysed` (`emit_notification`: kural, kanallar, push/e-posta; anahtar `session:<id>`, 0042 tetikleyicisi önce genel metinle yazdıysa o satır bu cümleyle güncellenir, tek kart; üçüncü kişiyle: "…: 5,5 net. En çok zorlandığı konu: Oran–orantı."), karalama sayfası varsa yanlış/boşlar için `diagnosis.run` deneme bağlamı (önce yanlışlar, en çok `EXAM_AUTO_DIAGNOSIS_MAX` = 10; sorunun kitapçık sayfası + karalamalar ≤ 4, `exam_responses.work_upload_ids`); yoksa öğrenci sonuç ekranında "Nereye kadar geldim?" (`exam_how_far`) ya da boş nedeni (`exam_blank_reason`) | `diagnoses_queued`, `warnings` (virgüllü kodlar: `page_unreadable`, `page_unknown`, `question_partial`, `question_duplicate`, `question_gap`, `skill_untagged`, `key_low_confidence`, `key_missing`, `answer_double`, `answer_unclear`, `answer_low_confidence`, `score_mismatch`, `report_fallback`, `report_failed`, `no_scratch`). Maliyet, ayrıntılı uyarılar ve bütün koşuların kodları stash `run_meta`'dadır (progress öğrenciye açık) |
| `failed` | okuma hatası (kitapçık yok/okunamadı OGR-EXAM-101, optik form yok/okunamadı OGR-EXAM-102, PDF OGR-EXAM-104; tek sayfanın ret/bozuk çıktısı okuma hatası değildir) ya da kalıcı/son deneme hatası (OGR-JOB-15x): `set_exam_progress('failed')` (oturum, sınav, sayfalar failed) + `audit 'diagnosis.failed'` + "Fotoğrafı okuyamadım" / "Yüklemeni şu an işleyemedim" kartı | `error` (öğrenciye gösterilebilir tek cümle), `error_code` |

- **Yeniden deneme:** her ücretli çağrının çıktısı `audit.events 'exam.stash'` (row_id = oturum, `{key, data}`;
  `class:<yükleme>`, `items:<yükleme>`, `keypage:<yükleme>`, `inferred:<numaralar>`, `sheet:<yükleme>`, `answers`,
  `report`) satırındadır: aşamalar baştan koşar ama model yeniden çağrılmaz. Sorular kaydedilince `plan` (sayfa türleri,
  model referansları, sorular, o ana kadarki uyarılar) yazılır: sonraki koşu (Batch beklemesi dahil) alım, sınıflama,
  OCR, kırpım ve kaydı atlayıp anahtardan sürer. Oturum `analysing` ise (notlandı) yalnız rapor ve bildirim: uyarı
  kodları `progress.warnings` + `run_meta` + `plan`'dan, karalama referansları (döndürülmüş türevler) `plan`'dan gelir;
  maliyet birikir. `done`/`failed` ise iş biter. P1'in notsuz `analysing` kaydı sürülmez (`legacy`).
- **Kazanım eşleme:** `exam-page-items` sözleşmesi soru başına kazanım taşımaz. Öncelik: modelin kodu (sözleşmeye
  `skill_ids` eklenirse; yalnız müfredat yaprağı) > yayıncı eşleşmesindeki sınavın aynı numaralı sorusu > sözcüksel
  yedek (`exam/skills.ts`: yaprağın adı ×2 + açıklaması, Türkçe katlanmış 5 harflik kökler, idf; kökteki gösterimden
  ipuçları ×2: üs → üslü, |x| → mutlak, 0{,}25 → ondalık, a/b → oran, % → yüzde, < ≤ → eşitsizlik, x = → denklem).
  Sözcüksel eşleme yalnız yüksek güvenle kabul edilir (puan ≥ 3 ve ikinci yaprağın ≥ 1,25 katı); belirsiz soru kayıtlı
  ama kazanımsız kalır (gözlem yazılmaz, ustalık bozulmaz; `skill_untagged`). Sentetik denemede 8/10 doğru, 2 kazanımsız
  (2: "3x−7=11" denklem ile mutlak değer yaprağına eşit uyar; 10: zayıf eşleşme), yanlış yaprak yok.
- **Telif:** yüklenen deneme `is_copyrighted`; soru metni `exam_questions.stem_text`'te yalnız eğitmen/sistem içindir,
  öğrenci `exam_session_view`'da `page_upload_id` (+ `bbox`, sözleşme soru kutusu verince) ile kendi sayfasını görür.
  Rapor soru metni ve doğru cevap içermez. Deneme bağlamlı teşhiste telifli sınavın soru transkripsiyonu
  `solution_analyses.question_text`'e yazılmaz (null; öğrenci/veli okur), audit `diagnosis.raw`'da ve gömmede kalır.
- **Ücret:** gerçek taşımada `check_spend('exam.analyse', public_ref)`; sahte taşımada (Storage yoksa) sayfa görüntüsü
  indirilmez, `fake-file-<özet>` kimliği kullanılır.
- **UI'ın okuduğu:** `exam_sessions.status` + `progress` (Realtime; 0030 yayına ekler) ve sonuç için
  `exam_session_view(p_session)` (`summary.one_line`, `sections`, `heatmap`, `items[].state`, `report.pdf_path`,
  `answer_key_source`, `summary.unverified_keys`); Bugün kartı `payload.session_id`; Belgeler `list_my_documents('report')`.

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

## Alıştırma soru bankası (`src/jobs/practice-generate.ts`, `src/practice/bank.ts`, `py/template_fill.py`, `py/key_verify.py`)

İlk "Başla" çıkmazının kapanışı (README "Nerede kaldık"). Yazım yalnız RPC ile (`supabase/README.md` "Alıştırma bankası").

- **Şablon yolu (sıfır LLM):** hedef yaprağın `question_templates` kayıtları → `python3 -I py/template_fill.py` (stdin
  JSON → stdout JSON; şablon kodu yalnız `content/tyt-matematik/templates/__init__.py` kaydından yüklenir, DB'deki
  `module_path` kullanılmaz; varyantlar `content_hash` ile tekrarsız, bankadakiler dışlanır; cevap taşıyan parametre
  `template_params`'tan çıkarılır; şekil §6.1 kapısından geçer: boyut, 2 KB–2 MB, boş görüntü reddi). PNG `figures`
  kovasına rastgele `<uuid>.png` (herkese açık yol şablon parametrelerinden türemez; bankada doğrulanmış aynı şekil
  yeniden yüklenmez; Storage yoksa şekilli varyant atılır). Varyantın yaprakları korunur (hedef yaprak önce, en çok 3;
  ör. mutlak değer + eşitsizlik). Anahtar SymPy ile `verified`. `OGRENMEN_PYTHON`
  yorumlayıcıyı değiştirir (varsayılan `python3`; imajda Debian `python3-sympy`, `python3-matplotlib`).
- **LLM yolu (şablon yetmezse):** rota `question_generation` (Opus 5.5 · medium, `exam-generation` şeması, araçsız,
  şekilsiz, tarzsız; sistem metni `@ogrenmen/prompts`'ta yoksa `QUESTION_GENERATION_SYSTEM`, sürüm
  `worker-question_generation`). Gerçek taşımada `check_spend('practice.generate')`; geçit kurulamazsa (anahtar yok)
  yalnız şablon yolu. Hafif denetim (şıklar tekil, doğru şık seçeneklerde, sayısal değer sonlu), sonra SymPy anahtar
  denetimi `python3 -I py/key_verify.py` (`content/tyt-matematik/templates/_common.py`: `sympify_expr`, `parse_math`,
  `values_equal`; madde başına 4 sn): `canonical_expr` sayısal soruda `numeric_value`'ya, çoktan seçmelide yalnız doğru
  şıkkın metnine eşit olmalı. Çelişen (`mismatch`) ya da birden çok şıkka eşit (`ambiguous`) madde atılır; tutan madde
  `verified` (anahtar `sympy_status='verified'`, `verification.sympy='verified'`); denetlenemeyen madde
  (`canonical_expr` boş/ayrıştırılamıyor, doğru şık metni sayı değil, doğrulayıcı çalışmadı) `approved` ama anahtar
  `sympy_status='not_applicable'` + `sympy_report.status='inferred'`, `questions.verification.sympy='inferred'`
  (`answer_practice_item` gözlem ağırlığı `settings.practice_inferred_key_weight`, 0.5). Yapraklar istenen yapraklarla
  kesişmeli; kesişmeyen madde atılır (başka kazanımı ölçen soru yanlış yaprağa etiketlenmez; yalnız sahte taşımada
  fikstürün sabit kodu istenen yaprağa eşlenir); `content_hash` müfredat + yaprak + kök + şıklardan. Sahte kipte
  `packages/llm/fixtures/question_generation` 8 deterministik soru döner (anahtarları SymPy denetiminden geçer).
- **practice.generate:** set artık beklemiyorsa biter; ihtiyaç `target_count` yapraklara sırayla eksi mevcut banka.
  Şablon + banka yarıyı karşılıyorsa set hemen dolar (öğrenci beklemez); değilse LLM ile tamamlanıp dolar. Set boş
  kalırsa iş yeniden denenir; son denemede `fail_practice_generation` (set `abandoned`, `generation_failed`; web tek
  cümle "Biraz uzun sürdü, Koç'a sorabilirsin" + Bugün'e dön). Süre: sahte LLM < 5 sn, şablonla < 10 sn (testler ölçer).
- **practice.prewarm:** `practice_bank_status` (yapraklar: verilen kodlar ya da en zayıf iki); `practicable = false`
  (otopilotsuz taslak) ise ücretli üretim yapmaz (`skipped`). Her yaprağı `per_skill` (8) kullanılabilir teşhis dışı
  soruya (`available`; teşhis soruları alıştırmada son çaredir, banka doldukça çekilir)
  tamamlar (önce şablon, sonra yaprak başına bir LLM çağrısı); bitince kaydın bekleyen `needs_generation` setlerini
  bankadan doldurur.

## Tarz kütüphanesi (`src/jobs/style-*.ts`, `src/styles/`, `src/suggestions/styles.ts`; P4, docs/PLAN-v2.md §11)

Eğitmen çıkmış sınav dosyalarını yükler (`ingest_exam_source(course, {year, term, instructor_alias?}, upload_ids)`, 0037)
→ `style.ingest`:

1. **Sayfalar** (`styles/pages.ts`): Storage'dan indirme; PDF `pdftoppm -r 150 -png` (poppler-utils; dosya başına ≤ 40,
   toplam ≤ 80 sayfa), fotoğraf ve PDF sayfası sharp normalleştirmesi (EXIF, fotoğrafta eğrilik, ≤ 2576 px, JPEG q85) →
   Files API (sahte taşımada ağsız kimlik). Storage yoksa her yükleme tek sayfadır (PDF `document` bloğu).
2. **OCR**: `exam_page_items` (Sonnet; deneme rotası ve promptu aynen) + `archivePageUserText` (yükleme sırası + "Çıkmış
   sınav arşivi: 2024 final." + açık uçlu soru notu) → `exam/merge.ts` sayfalar arası birleştirme.
3. **Madde** (exam-item v2): `exam_item_extract` (Sonnet; madde başına, `examItemExtractUserText`): konu, tür
   (proof/calc/mc/other), sunuş biçimi, tuzak, zorluk, puan, kazanımlar. Kaynak kimliği, numara, yıl ve metin OCR'dan
   gelir; model yalnız sınıflar. Ret/şemasız çıktıda madde OCR bilgisiyle yazılır. Bilinmeyen kazanım kodu (OGR-CURR-001)
   gelirse maddeler kazanımsız yeniden yazılır. Gömme `VOYAGE_API_KEY` varsa (`styles/embed.ts`, voyage-3.5, 1024).
   → `register_exam_items` (kaynak `ocr_done`, yüklemeler `ready`).
4. **Kümeleme** (`styles/cluster.ts`, v1 `pipelines/kalem` cluster.py'nin Node karşılığı): dersin bütün maddeleri;
   mesafe = gömme kosinüsü (hepsinde gömme varsa; eşik 0,30) ya da yerel yedek tf-idf kosinüsü (metin + konu + tür/biçim
   belirteçleri, sayılar `#`; eşik 0,60) − 0,35 × kazanım Jaccard'ı (aynı-kazanım bonusu) − 0,20 (aynı konu) + 0,10
   (ispat ↔ hesap); ortalama bağlantılı birleştirici kümeleme, deterministik (eşitlikte küçük dizin; küme kimlikleri
   `k1…` ilk üyeye göre). Var olan tarzlar: eğitmenin onayladığı/etkinleştirdiği tarzın maddeleri yerinde kalır ve
   kümesini o tarza çeker; taslak tarz en çok ortak maddeyle yeniden kullanılır; kalan kümeler `style_definition`
   (Sonnet; en çok 40 küme/çağrı) ile adlandırılır. Ad/tanım "tahmin/çıkacak/kesin" içeriyorsa ya da bir üyenin
   metninden 30+ karakter kopyalıyorsa kullanılmaz (yedek ad: en sık konu → kazanım adı → "Soru tarzı N"; tanım boş).
   → `upsert_question_styles` (worker taslak yazar, etkinleştiremez; kaynaklar `clustered`; skorlar tazelenir).
5. **Plan**: `compute_priority_plan` (≥ 2 yıl; yoksa `plan.status = skipped`) → `exam_priority_plans(pending_review)`.
6. **Kapsama**: `style.coverage.refresh` → öğrencilerin Bugün kartları + tarz bankası ön ısıtması.

Yeniden deneme: OCR ve madde çıktıları `audit.events 'style.stash'` (row_id = kaynak); maddeler yazıldıysa 1–3 atlanır,
kümeleme ve plan idempotenttir (ikinci koşu ücretli çağrı yapmaz). Kalıcı hata/son deneme: maddesi olmayan kaynak
`failed`, yüklemeleri `failed`. Gerçek taşımada `check_spend('style.ingest')`; tavan kapalıysa kaynak düşürülmez (`uploaded` kalır), iş 6 saat sonrasına ertelenir (`SpendBlockedError`).

`style.question_gen` (`styles/bank.ts`): tarzın yaprakları (yoksa maddelerinin en sık yaprakları) + tanımı + örnek
maddelerin **yalnız yapısı** (yıl, tür, biçim, konu, tuzak, zorluk, puan; çıkmış soru metni modele gitmez) + bankadaki
kökler (yinelenmesin) → `style_question_gen` (Opus; `styleQuestionGenUserText`; yerel figür kipinde code_execution
kapalı) → yapı denetimi (4–5 tekil şık, kazanım tarzın yaprağı; sahte taşımada fikstür kazanımı tarzın ilk yaprağına
eşlenir; kök ya da şık dersin arşiv metninden — `exam_items.ocr_text`, yalnız worker okur — 30+ karakter aynen taşıyorsa
madde atılır: "arşiv metnine çok benziyor", `cluster.ts` `copiesSource`) → figür (varsa ve Storage varsa: kod → SVG → PNG → `figure_check`; `figures` satırı `verified`, olmazsa soru
atılır) → SymPy (`py/key_verify.py`): **yalnız `verified`** soru `register_practice_questions` ile bankaya
(`approved`), ardından `questions.style_id` (content_hash ile) ve şekil bağlanır. Kayıt verildiyse öğrencinin
`suggestions.refresh`'i. `check_spend('style.question_gen')` kapalıysa atlanır.

Bugün kuralı (`suggestions/styles.ts`; `signals.ts`'e `styleGap`, `rules.ts`'e tek satır): kaydın dersinde **etkin**,
sorulmuş, kazanımlı ve bankasında onaylı tarz sorusu olan tarzlardan hiç çözülmemiş olanı (önce hiç görülmemiş, sonra
öncelik skoru) → `practice` kartı (rank 15: en zayıf yaprak alıştırmasından sonra), `payload {skill_ids, count: 8,
minutes: 12, reason: 'style_gap', style_id}`, alt satır "Bu tarzı hiç çözmedin · 8 soru · 12 dk". Kazanımları bugün
çalışıldıysa ya da başka kartta kullanıldıysa kart yok.

Sahte LLM fikstürleri (`OGRENMEN_LLM=fake`): `apps/worker/test/fixtures/styles/archive.json` (2 yıl × 5 soru, TYT
yaprakları, 4 tarz) tek kaynaktır; `python3 -I apps/worker/test/fixtures/styles/build.py .` →
`packages/llm/fixtures/{exam_page_items/arsiv-<yıl>, exam_item_extract/arsiv-<yıl>-<no>, style_definition/arsiv,
style_question_gen/arsiv-tarz}.json`.

Bilinen boşluklar: `exam_item_extract` ve `style_definition` Batch rotalarıdır ama şimdilik senkron (`batchRetry`)
çağrılır (Batch gönder/topla `inferred_keys` gibi sonraki iş); `start_practice` (0021) `payload.style_id`'yi okumaz,
tarz kartı tarzın kazanımlarında set açar ve bankadaki tarz soruları bu kazanımların havuzuna girer (tarz soruları
öncelikli seçilsin diye DB tarafında `start_practice` eki gerekir); kümeleme ders başına en çok 800 madde.

## Ders hattı (`src/jobs/lessons.ts`, `src/lessons/`; P5, docs/PLAN-v2.md §9; supabase 0039–0041)

Eğitmen kaydı (video, ses ya da hazır transkript) `lessons` kovasına TUS ile yükler ve `register_lesson` çağırır; ders
`processing` olur, yükleme eğitmen arşivine alınır ve `lesson.prepare` kuyruğa düşer. Her aşama ilerlemeyi
`lesson_set_progress` ile yazar (`prepare → stt → label → analyse → apply → done | failed`; eğitmen ekranı okur) ve bir
sonraki işi (`singletonKey <iş>:<ders>`, 120 sn) atar:

1. **prepare** — ders medya servisi (`pipelines/ders`, `LESSON_SERVICE_URL`, `src/lessons/service.ts`) `/prepare`:
   `ffmpeg -vn -ac 1 -ar 16000` WAV + sahne kareleri (eşik kuralı, ≤ 30 JPEG, ≤ 1280 px). Servisin Storage erişimi
   varsa (`/healthz` `storage: true`; Fly'da sırlar uygulama geneli) kaynağı kendisi indirir, çıktıları
   `<sahip>/<ders>/audio.wav` ve `…/frames/frame-NN.jpg`'ye yükler; yoksa servis aynı makinededir: worker kaynağı
   servisin çalışma köküne (`work_dir`) yazar ve çıktıları oradan Storage'a yükler (90 dk'lık videoda bellek ister:
   üretimde Storage kipi). Kova MIME listesi kareler için `image/jpeg` içerir (0039; testlerin bellek içi Storage'ı
   listeyi göçlerden okuyup zorlar: `test/lesson-storage.ts`). Sayaçlar `duration_sec`, `frames_count`, `audio_path`,
   `media_prefix`. Hazır transkript yüklemesi (`kind = transcript` ya da `transcript_upload_id`) ayrıştırılır
   (`src/lessons/transcript.ts`: JSON, WebVTT, SRT, düz metin; "Hoca:"/"Öğrenci:" önekleri ve `<v …>` konuşmacı olur)
   → ad temizliği → `write_lesson_transcript(provider 'upload')` → dosya Storage'dan silinir
   (`lesson_mark_media_deleted('transcript_file')`) → STT atlanır.
2. **stt** — servis `/stt`: Groq Whisper large-v3-turbo (`GROQ_API_KEY`; ses 600 sn'lik ≈ 19 MB parçalara bölünür,
   zamanlar kaydırılır; 429/5xx üç deneme); anahtarsız ortamda servis `OGRENMEN_STT=fake` ile deterministik
   transkript (`fixtures/ders/lesson-01.transcript.json`, konuşmacısız) döner; ikisi de yoksa `OGR-DERS-008` (sessizce
   sahteye düşülmez). Adlar STT'den önce okunur (öğrencinin adı yoksa STT de yapılmaz, `OGR-JOB-181`); bölümler ad
   temizliğinden geçip konuşmacısız yazılır (düz ad veritabanına hiç yazılmaz), çıkarılan ses hemen silinir (`lesson_mark_media_deleted('audio')`;
   olmazsa gece işi). Konuşma yoksa ders failed ("kayıtta konuşma bulunamadı").
3. **label** — ad temizliği (`src/lessons/names.ts`, packages/pii TS kaynağı): dersin öğrencileri `[ÖĞRENCİ]`, dersi
   veren + bağlı eğitmenler `[EĞİTMEN]`, aktif veliler `[VELİ]`, kalıplar `[AD]`; adlar `profiles.display_name`'den
   yalnız bellekte okunup ad-token hash'ine çevrilir. **Kapalı başarısızlık:** dersin bir öğrencisinin görünen adı
   yoksa hiçbir model çağrısı yapılmaz, ders failed (`OGR-JOB-181`). Etiketsiz bölümler 10 dakikalık pencerelerde
   `speaker_label`'a (Sonnet · low · düşünme kapalı; `speakerLabelUserText`) gider; model her bölümün yalnız ilk üç
   sözcüğünü yazar (çıktı maliyeti), etiketler sırayla ya da başlangıç zamanıyla hizalanır (`alignLabels`). Modele
   giden her metin son kemerden geçer (`assertNoNames`). Temiz + etiketli transkript `write_lesson_transcript`.
4. **analyse** — `lesson_analysis` (Opus · high): ≤ 30 kare (base64 görsel) + `lessonAnalysisUserText` (`<lesson_request>`:
   ders, anonim öğrenci, kare zamanları, açık yanılgılar, önceki onaylı dersin eğitmene sonraki adımı; `<transcript>`)
   + ders bloğu + (birebir) dossier. Gerçek taşımada `check_spend('lesson_analysis')` kapalıysa failed (`OGR-JOB-183`).
   Bağlam denetimi (`src/lessons/analysis.ts`): alıntı transkriptte yoksa kanıt düşer, kanıtsız kazanım/yanılgı düşer;
   yaprak olmayan kazanım ve süre dışı zaman düşer; önceki yanılgı takibi yalnız açık yanılgılara; model metnindeki ad
   deterministik temizlenir; ders başlığı ve açık yanılgıların eğitmen metni de istemden önce temizlenir ("Ayşe ile
   türev" dersi düşmez); öğrenci metinlerinde (text_student, for_student, taahhüt) sınav/sonuç öngörüsü ("sınavda …
   çıkacak", "kesin geçersin", "garanti", "not tahmini"; "önce sonucu tahmin et" serbest), ünlem ya da yüzde varsa bir
   onarım turu (önceki yanıt asistan turu olarak gider). Yine varsa ders düşmez: sorunlu söz (`promise`) çıkar, diğerleri
   zaten eğitmen incelemesinde (sayaç `student_text_dropped/held`). Sonraki adım ve ödev/son tarih iddiaları boş güvenle
   yazılır (0040): eğitmen görmeden öğrenciye, hafızaya ve veliye gitmez. Yeniden deneme: son analiz transkriptten
   yeniyse model atlanır, `apply_lesson_claims`'ten sürülür; yeni sürüm yazılırsa eskisinin uygulanmışları geri alınır. `lesson_ref`, `student_ref`, `duration_min`,
   `model_notes` hattındır. `write_lesson_analysis` → `apply_lesson_claims`: güveni dersin eşiğinin (0,80) üstündeki
   iddialar `observations(kind='lesson')` + BKT; altındakiler ve güvensizler (yanılgı, takip, ders bilgisi) eğitmen
   incelemesinde. Bekleyen varsa eğitmenlere uygulama içi bildirim (`notifications.kind = 'lesson_review'`, analiz başına
   bir kez); dersin öğrencilerine `suggestions.refresh` (Bugün `lesson_review` kartı onaylı analizden gelir: inceleme
   bitince). Son: `done` + sayaçlar (`claims`, `applied`, `pending`, `quotes_dropped`, `frames_used`, maliyet).
5. **memory.apply** — `apply_lesson_claims` bir şey uyguladıysa atar (`src/lessons/memory.ts`):
   `/memories/courses/<kod>.md`'de bu dersin bölümü (`<!-- ders:<id> -->`, en yeni 8 ders, ≤ 6 KB) yalnız uygulanmış
   ve öğrenciye uygun bilgilerden kurulur: izlence konusu, hocanın sınav notu, ortak ödev, kaynak; ders öğrenciye
   açıksa (`student_visible`) ödev, sonraki adım ve yanılgının öğrenci metni. Gizli derste yalnız işlenen konu girer
   (ders başlığı da girmez). Eğitmen metni girmez. Öğrenciler `app.lesson_students` kapsamıdır (sınıf dersinde yalnız
   dersi verene owner bağlı kayıtlılar; `lessonStudents` ve ad temizliği aynı fonksiyonu kullanır).
6. **lesson.retention** — zamanlayıcıdan gelir (`SCHEDULES` 04:15 İstanbul; pg_cron sahibiyse 0040'taki cron
   eşleniği); iş kendini zincirlemez (yalnız liste sınırı dolunca `more` devamı). Önce takılan dersler: `processing`,
   ilerlemesi `STALE_HOURS` (2) saattir yazılmamış ve pg-boss'ta o derse ait bekleyen/çalışan `lesson.*` işi olmayan
   ders (işçi son denemede öldü: dağıtım, OOM) `failed` olur ("İşlem yarıda kaldı"); `retry_lesson` aynı eşikteki
   `processing` dersi de kabul eder. Sonra `lesson_retention_due` (video, ses, kareler, transkript dosyası; `paths[]`) →
   Storage silme → `lesson_mark_media_deleted`. Kareler analiz bitince `lesson.analyse` tarafından silinir; düşen derste
   ses ve kareler `guarded` içinde hemen silinir.

Hata: servis 4xx (bozuk/ses akışı olmayan kayıt, geçersiz istek), ad temizliği, ret/şema hatası kalıcıdır; geçici hata
(servis kapalı, 429/5xx) pg-boss ile yeniden denenir; son denemede ya da kalıcı hatada `lesson_set_progress('failed',
{error})` ("Kayıt hazırlanamadı: OGR-DERS-001 kayıtta ses akışı yok"), türetilmiş medya (`<sahip>/<ders>/audio.wav`,
`frames/`) Storage'dan silinir ve servis çalışma dizini silinir. Eğitmen ders sayfasındaki "Yeniden dene" ile
`retry_lesson`'ı çağırır: aynı yüklemelerle `lesson.prepare` yeniden atılır (dosya yeniden yüklenmez).

## Veli ve bildirimler (`src/notifications/`, `src/reports/`; P6, docs/PLAN-v2.md §10; supabase 0042–0044)

Kural motorunun SQL yarısı (varsayılanlar, alıcının kuralı, `emit_notification`, olay tetikleyicileri exam_analysed ve
instructor_note_shared) supabase 0042'dedir; worker zamanlanmış kuralları değerlendirir (`src/notifications/engine.ts`).

| Kural | Ne zaman (alıcının saat diliminde, `profiles.tz`) | Tekilleştirme |
| --- | --- | --- |
| `weekly_summary` | `weekday` (0 = Pazar) gününde saat ≥ `hour` (19); işçi bir saat kaçırsa da aynı gün yetişir | hafta başına bir (`week:<öğrenci>:<pazartesi>`) |
| `inactivity` | son etkinlikten (`app.child_last_activity`) ≥ `days` (5) tam gün; hiç etkinlik yoksa yok | sessizlik başına bir (son gönderim son etkinlikten önceyse yeniden) |
| `improvement` | (a) yaprak `leaf_p` (0,8) eşiğini `min_evidence` (5) kanıtla geçti (`mastery_history`, son 8 gün; güncel p eşik üstünde) (b) son denemenin neti bir öncekinden ≥ `weekly_net_delta` (4) yüksek | kazanım / oturum başına bir kez (geçmiş anahtar denetimi) |
| `misconception_resolved` | son 7 günde çözülen yanılgı | yanılgı başına bir kez |

Yazım her zaman `emit_notification`'dır (kural kapalıysa ya da 24 saat içinde aynı anahtar varsa null). Kanallar kuraldan:
`push` varsa ve alıcının aboneliği varsa SQL aynı işlemde `push.send` atar; `email` varsa worker `email.send` atar (SQL
tetikleyicilerinin yazdığı e-posta kanallı satırlar saatlik süpürmeyle yakalanır). Teslim `payload.delivery.<kanal>` =
{status: sent | dry | none | failed, at, detail?}; `sent_at` yalnız gerçek gönderimde dolar. Kanal sütununa (`channels`,
CHECK in_app | push | email) `push:dry` gibi değer yazılamadığı için kuru çalışma işareti `payload.delivery`'dedir.

**Haftalık özet** (`weekly.summary`, Pazar 19:00; alıcı başka gün/saat seçtiyse saatlik `notifications.evaluate`):
bu gecenin `memory.compact`'i kuyruktaysa 15 dk sonra yeniden (en çok 8 kez) → velisi olan her aktif öğrenci için
`parent_child_summary` (worker güvenilir çağıran) → `/memories/parent_summary.md` (deterministik, ≤ 1,5 KB, actor
`memory-compact`, ad/p/koç sohbeti yok; değişmediyse yazılmaz) → bildirim metni `notification_copy` (Haiku 5.5 · low;
`<notification>` JSON, şablon dahil) → kural dışıysa (ünlem, yüzde, emoji, uzunluk, girdide olmayan sayı) ya da çağrı
düşerse şablon ("Bu hafta yaklaşık 4,5 saat çalıştı ve 38 soru çözdü. … Ona bu hafta en çok hangi konuyu kolay
bulduğunu sorabilirsiniz.").

**Kuru çalışma:** VAPID yoksa `push.send` iletiyi günlüğe yazar (uç nokta yalnız ana makine adıyla) ve teslimi `dry`
yapar; `RESEND_API_KEY`/`EMAIL_FROM` yoksa `email.send` aynısını yapar (adres maskeli: `v***@alan`). Anahtarlar gelince kod
değişmeden gerçek gönderim başlar. E-posta adresi `auth.users.email`'dir (yalnız worker okur).

**Veli raporu** (`report.generate`, `src/reports/`): belge `generating` → veri (`data.ts`: `parent_*` RPC'leri ve
`app.child_study_stats`, velinin saat diliminde; ad, p, soru, cevap ve anahtar yok) + deterministik grafik verisi
(`daily_time`, `weekly_time` time_per_question; `skill_bands` style_coverage — yalnız bant kelimesi; `section_nets`,
`exam_nets` score_by_section) → `report` rotası (Sonnet 5.5 · medium, report-ast, akış; okuma araçları bant düzeyinde;
system[1] ders bloğu, dossier yok) → temizlik (izinsiz grafik atılır, başlık/meta hattın; anahtar kalıbı, yüzde, ünlem
ya da emoji varsa deterministik rapor) → doc-render rapor şablonu → PDF → Storage `documents/reports/<öğrenci>/<belge>.pdf`
→ `register_generated_document` (rendered; `parent_reports` hazır sayar) → isteyen veliye `report_ready`. Bilerek
`document_set_status('ready')` değil: o yol öğrenci belgelerinin yayın kapısıdır (doğrulama merdiveni + Bugün kartı).

Testler: `test/notifications.test.ts` (kurallar, saat dilimi, tekilleştirme, şablon/Haiku metni, kuru çalışma, Resend,
rapor temizliği ve yedek rapor), `test/notifications.live.test.ts` (geçici DB + gerçek pg-boss: haftalık özet → veli
bildirimi, push/e-posta `dry`; ilerleme; `parent_request_report` → rapor PDF Storage'da → `report_ready`).

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
| 50, 70… | `upload_result` | son 48 saatte: teşhis (`solution_analyses` yüklemeli; alt satır `analysis.one_line`, anahtar `analysis:<id>`), değerlendirilen okul denemesi (`exam_sessions` `uploaded`/`done`, `session:<id>`, başlık "Deneme sonucun hazır", alt satır `progress.card_line`: "Örnek Deneme 1: 5,5 net. Takıldığın yer: Oran–orantı."), analizi süren okul denemesi (`grading`/`analysing`, "Denemeni inceliyorum", `upload:<ilk yükleme>`; sayfalar `exam_sessions.upload_ids`, eski kayıtta `exam.upload_intake` bağı), işlenemeyen yükleme (`audit.events 'diagnosis.failed'`, sayfalar hâlâ `failed` ve teşhis yok; `upload:<ilk yükleme>`). Worker kartı aynı sinyalle `uploadNotice`'ten yazar: yenileme kartı silmez, yerinde günceller | `upload_id, upload_ids, analysis_id, session_id, verdict` / `pending, exam_id` / `failed, failure, reason` |
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
- `notifications.evaluate`: her saat :05 (`5 * * * *`; pg_cron sahipliğinde kurulmaz: 0016_cron.sql'e eklenmesi gerekir, bkz. "Veli ve bildirimler")
- `lesson.retention`: her gece 04:15 (`15 4 * * *`; pg_cron eşleniği 0040 `ogrenmen-lesson-retention` `15 1 * * *` UTC)

Gece zinciri (`NIGHTLY_CHAIN`): pg_cron ve bu süreç yalnız 03:00 `memory.compact`'ı zamanlar (0016_cron.sql ile birebir);
yüksüz `memory.compact` hemen `conversation.summarize`'ı ve 03:30'a `suggestions.refresh`'i kuyruğa atar. Böylece
zamanlama eşliği (`supabase/tests/01_schema.sql`) değişmeden yeni gece işleri çalışır.

`WORKER_SCHEDULES=auto` iken `runtime_flags.cron_owner = "pg_cron"` ise kurulmaz (pg_cron yalnız iş ekler). `on` / `off` ile zorlanır. Kurulmayan kipte daha önce kalmış pg-boss zamanlamaları açılışta silinir (`removeSchedules`), böylece pg_cron'a geçişte iş iki kez çalışmaz.

pg_cron tarafı (`supabase/migrations/0016_cron.sql`) aynı iş adlarını UTC'de enqueue eder: `memory.compact` `0 0 * * *` (03:00 TRT), `weekly.summary` `0 16 * * 0` (pazar 19:00 TRT); registry testi adları denetler. SQL'den eklenen işler kuyruğun politikasını (`pgboss.queue`) kopyalar; `PGBOSS_SCHEMA` üretimde `pgboss` olmalıdır (SQL enqueue yalnız bu şemada çalışır). SQL/RPC iş yükleri snake_case'dir (`analysis_id`, `session_id`...); worker işlerinin yükleri de snake_case'tir (`student_id`, `course_id`, `document_id`, `notification_id`, `user_id`); eski camelCase anahtarlar uyumluluk için kabul edilir. İşleyicisi olmayan (`handler: null`) kuyruklarda bekleyen işler 90 gün (`retentionSeconds`) saklanır, sonra silinir.

## Sağlık ve kapanış

`GET /healthz` (node:http): DB ping + açılış tamamlandı + kapanıyor değil + başlangıç denetimleri geçti ise 200
(`status: ok`), değilse 503 (`unhealthy`; denetim düştüyse `degraded` ve `startupChecks`). Sağlık sunucusu açılışın başında
dinlemeye başlar. SIGTERM/SIGINT: sağlık 503'e döner, pg-boss zarifçe durur (`SHUTDOWN_TIMEOUT_MS`), Chromium ve havuz kapanır.

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
| `WORKER_STARTUP_CHECKS` (`strict` \| `warn` \| `off`), `WORKER_PGBOSS_GRANT` (`auto` \| `off`), `WORKER_STARTUP_EXIT_DELAY_MS` | başlangıç denetimleri (yukarıda) |
| `OUTBOX_DRAIN_INTERVAL_MS` | `outbox.drain` aralığı (30000; 0 zamanlayıcıyı kapatır) |
| `OGRENMEN_LLM` (`fake`), `ANTHROPIC_API_KEY` | geçit; anahtar yoksa yalnız LLM işleri kalıcı hata verir |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_BUCKET_DOCUMENTS` | Storage (`src/storage.ts`) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | üçü birlikte |
| `PDF_CHROMIUM_PATH`, `PDF_CONCURRENCY` | PDF (`pdf.render`); deneme raporu `@ogrenmen/doc-render` kendi Chromium'unu (`PLAYWRIGHT_BROWSERS_PATH`) açar |
| `EXAM_AUTO_DIAGNOSIS_MAX` (10), `EXAM_KEYS_BATCH` (`1`: anahtar çıkarımı Batch) | deneme analizi |
| `OGRENMEN_FIGURES` (`auto` \| `code_execution` \| `local`) | belge figürleri (varsayılan `auto`: gerçek anahtarla code_execution, sahte LLM'de yerel; `local` model kodunu OS yalıtımında worker'da çalıştırır) |
| `RESEND_API_KEY`, `EMAIL_FROM`, `OGRENMEN_SITE_URL` | e-posta kanalı (`email.send`); anahtar yoksa kuru çalışma. Site adresi e-postadaki "Uygulamada aç" bağlantısı |
| `OGRENMEN_NOTIFICATION_COPY` (`template`) | haftalık bildirim metninde Haiku'yu kapatır (varsayılan `notification_copy`, kurala uymazsa şablon) |
| `LESSON_SERVICE_URL` (`http://127.0.0.1:8711`), `LESSON_SERVICE_TOKEN` | ders medya servisi (pipelines/ders); belirteç servis tarafında `OGRENMEN_DERS_TOKEN` ya da aynı ad |

## Dağıtım

```bash
docker build -f apps/worker/Dockerfile -t ogrenmen-worker .     # bağlam: depo kökü
fly deploy -c apps/worker/fly.toml --dockerfile apps/worker/Dockerfile
```

`fly.toml`: üç süreç grubu: `worker`, `pdf` (iç port 8080, `/healthz`) ve `ders` (ders medya servisi,
`python3 -I …/service.py --host :: --port 8711`, ffmpeg imajda; worker `LESSON_SERVICE_URL =
http://ders.process.ogrenmen-worker.internal:8711`); dışarı açık hizmet yok. Sırlar `fly secrets set` ile (`GROQ_API_KEY`,
`LESSON_SERVICE_TOKEN` dahil; uygulama geneli olduğundan ders servisi Storage'a kendisi erişir).

## Testler

- `test/registry.test.ts`: kayıt defteri tutarlılığı, süreç dağılımı, yük şemaları, zamanlamalar, yapılandırma
- `test/jobs.test.ts`: `llm.ping` (fake geçit, InMemory defter satırı), `dossier.render`, `pdf.render`, `push.send`, `memory.compact`
- `test/suggestions.test.ts`: öneri kuralları (`test/fixtures/suggestions/signals.json` → `expected.json`: 3 kart), kart metni (şablon, Haiku, yedek, yeniden kullanım), `suggestions.refresh`
- `test/diagnosis.test.ts` / `test/diagnosis.live.test.ts`: Yükle → Teşhis (doğrulama kuralları, Files API, apply_diagnosis girdisi, kart; canlıda öğrenci JWT'siyle uploads satırı → gözlem/ustalık → öğrenci kendi teşhisini okur, okul denemesi kaydı)
- `test/nightly.test.ts`: `memory.compact` (Batch gönder → topla), `conversation.summarize`, `diagnosis.followup`, `activity.completed`
- `test/suggestions.live.test.ts`: geçici veritabanında (`@ogrenmen/llm/testing`) öneri motoru uçtan uca (RLS'li `list_today_suggestions`, `start_practice`), hafıza sıkıştırma, sohbet özeti, dossier
- `test/pdf.test.ts`: gerçek Chromium ile A4 PDF
- `test/practice.test.ts`: soru bankası (şablon planı, LLM çıktısı eşlemesi, anahtar denetimi + yanlış anahtarlı fikstür maddesi atılır, şablon yolu, fake LLM yolu 8 soru < 5 sn, kalıcı hata → `generation_failed`, ön ısıtma; Python + SymPy varsa gerçek `py/template_fill.py`); `test/practice.live.test.ts`: geçici veritabanı + TYT anahtarları: yeni öğrencinin ilk Başla'sı teşhis sorularından, atanmış teşhiste şablon yolu (şekil Storage'a, < 10 sn), fake LLM yolu (< 5 sn, `llm_calls`), kalıcı hata, `practice.prewarm`
- `test/exam.test.ts`: deneme hattının saf parçaları (aşama makinesi, kitapçık birleştirme, kazanım eşleme (yüksek güven: 8/10, belirsizler kazanımsız), yayıncı eşleşmesi içerik denetimi, anahtar sızıntısı kalıbı, sayı sınırlı özet neti, veli cümlesi, optik form ve çift işaret, anahtar denetimi, net = doğru − yanlış/4 → 5,5, rapor verisi + deterministik rapor `exam-report` sözleşmesine uyar, sharp alımı/eğrilik/EXIF/kırpım, deneme bağlamlı teşhis girdisi)
- `test/exam.live.test.ts`: geçici veritabanı + gerçek pg-boss + sahte LLM + bellek içi Storage + gerçek doc-render PDF: öğrenci JWT'si → `submit_exam_upload` → `exam.analyse` → done < 60 sn (yerelde ~4 sn): 10 soru (5. soru iki sayfada, 3. soruda şekil kırpımı), kazanımlar, çıkarılmış anahtar, net 5,5, 8 gözlem + ustalık (kazanımsız 2 soru gözlemsiz), rapor PDF Storage'da, kart, veli bildirimi, `llm_calls`; öğrenci görünümünde anahtar yok; `exam_how_far` → deneme bağlamlı teşhis; karalama dağıtımı; uygulama içi aynı deneme → `exam.report`; yüklenen anahtar sayfası ve yayıncı eşleşmesi (çıkarım çağrılmaz; başka kişinin yüklemesi, varsayılan başlık, farklı kökler eşleşmez); okunamayan sayfalar → failed + kart; tek sayfanın bozuk çıktısı → done + `page_unreadable`; çıkarım reddi → done + `key_missing`; PDF → OGR-EXAM-104; `EXAM_KEYS_BATCH` (bitmeyen Batch → 120 sn sonra yeniden kuyruk, `plan`'dan süren ikinci koşu, 6 sa sonra senkron); telifli denemede `question_text` null
- `test/document.test.ts`: içerik stüdyosu (exam → AST, blok çıkarma/yeniden numaralama, birleştirme, LaTeX → SymPy, kapsam bölümleri ve zorluk bantları; figür kipi seçimi; yerel matplotlib figürü + kum havuzu retleri (sympy `S('…')` kaçışı, `DataSource.open`, `matplotlib.animation`, `numpy.f2py`, `print_svg`) + sonsuz döngü/uyku ≤ 11 sn, bellek sınırı + yalıtımsız model kodu çalışmaz + boş/küçük SVG + figure_check uyuşmazlığı ve önbellek; OS yalıtımı (kullanıcı ad alanı varsa): kardeş sürecin ve worker'ın `environ`'u okunamaz, tek pid, ağ kapalı, `umount` olmaz, `/home` boş; merdiven: temiz not, SymPy uyuşmazlığında yalnız o soru yeniden istenir (saklanan verification'da anahtar ayrıntısı yok), hak bitince soru/kutu çıkar ve not kişisel sayılmaz, kutusuz kişisel not `@callout` ile istenir, doğrulayıcı çalışmazsa skipped + deneme incelemeye, çizilemeyen figür çıkar, code_execution'da inmeyen figür yerelde çalışmaz, Haiku kişiselleştirme bulgusu, sorusuz deneme fail; iş: ders geneli not → PDF + HTML Storage'da, durum geçişleri, incelemeye döner; code_execution yolu (Files'tan inen `figure_<n>.svg` → via code_execution, konteyner yeniden üretimde aynı, yerel çalışmaz, önceki iş denemelerinin regen kayıtları hakkı yemez); müfredatsız belge → failed + Türkçe neden + Storage dosyaları silinir)
- `test/document.live.test.ts`: geçici veritabanı + gerçek pg-boss + sahte LLM + yerel matplotlib + gerçek PDF: öğrenci `request_document('notes')` → ready < 60 sn (yerelde ~5 sn; figür SVG, `patterns.md:2` / 19 Ekim kutusu, Storage'da PDF/HTML, "Rasyonel sayılar notun hazır" kartı, bildirim, `llm_calls`, Belgelerim); deneme → exams + 10 soru (8, 9 SVG şekilli) + anahtarlar secure'da, öğrenci oturumda anahtarsız görür, öğrenci JWT'siyle `verification::text`'te "doğru şık"/`canonical_expr`/anahtar değeri yok, "Denemen hazır"; eğitmen isteği → review + bildirim → onay → yayın; bozuk anahtarlı set → 2 yeniden üretim turu (4 regen kaydı) → failed + Türkçe neden, AST silinir
- `test/styles.test.ts`: kümeleme (sentetik arşivde beklenen 4 tarz, deterministik, sıra bağımsız, kazanım bonusu, gömme yolu), var olan tarzlarla eşleme, kod/ad kuralları (öngörü sözcüğü, 30+ karakter kopya), skor formülü, PDF → PNG (pdftoppm), fikstür ↔ arşiv tutarlılığı, tarza özel üretim eşlemesi, Bugün tarz kartı; `test/styles.live.test.ts`: geçici veritabanı + sahte LLM + bellek Storage + SymPy: eğitmen `ingest_exam_source` 2024 PDF → 5 madde, 4 taslak tarz, plan atlanır → 2025 fotoğraf → 10 madde, yeni tarz yok, plan pending_review (skor SQL = TS) → yeniden çalıştırma ücretsiz → `style.coverage.refresh` → `style.question_gen` 3 doğrulanmış soru `style_id` ile (çıkmış metin modele gitmez, yinelenmez) → tarz etkin → "Bu tarzı hiç çözmedin" kartı; öğrenci görünümünde soru metni yok
- `test/lessons.test.ts`: ders hattı (analiz bağlam denetimi: alıntı, kısaltma, yaprak, süre, açık yanılgı, ad, öğrenci metni; hazır transkript JSON/VTT/SRT/metin; etiket hizalama; ad temizliği; hafıza bölümü ve sınırları; servis istemcisi 4xx/5xx; prepare → stt (yerel kip) ve label sahte veritabanıyla; öğrencinin adı yoksa model çağrılmaz); `test/lessons.live.test.ts`: geçici veritabanı + gerçek pg-boss + gerçek ders servisi (`python3 -I`, ffmpeg, sahte STT) + sahte LLM + bellek Storage: eğitmen `register_lesson` (10 sn video) → done (~10 sn): 10 kare, ses silindi, temiz etiketli transkript, rasyonel (0,8) gözlem + BKT, denklem (0,6) ve yanılgılar incelemede, eğitmen bildirimi, `llm_calls`, ders hafızası; eğitmen onayı → `lesson_review` kartı; hazır VTT transkripti (STT yok); ses akışı olmayan video → failed + neden; `lesson.retention` ham videoyu siler
- `test/startup-checks.test.ts`: başlangıç denetimleri (sahte veritabanı: ön denetim, rol yetkileri, kuyruk açma, enqueue_job sahibi + `auto`/`off` yetki, deneme bloğu, outbox; SQL göçlerinin attığı her ad `REQUIRED_QUEUES`'ta) ve `drainOutbox` (aynı işlem, kayıt noktası, kuyruksuz satır kalır)
- `test/startup.live.test.ts`: geçici veritabanı + gerçek pg-boss: denetimler geçer (sahibe yetki verilir, deneme satırı kalmaz, `/healthz` 200); sahibin yetkisi alınınca SQL işi outbox'a düşer, `outbox.drain` aynı kimlikle aktarır, iş tamamlanır, zamanlayıcı çalışır; `WORKER_PGBOSS_GRANT=off` → `StartupCheckError` (78) + `/healthz` 503 `degraded`; pgboss'ta yetkisiz giriş rolüyle `src/index.ts` 78 ile çıkar
- `test/boss.live.test.ts`: yerel Postgres'te geçici şema (`pgboss_t_*`, sonunda silinir); `OGRENMEN_LIVE=1` ile (`bun run test:live`)
- `test/curriculum.test.ts`: taslak doğrulama kuralları, kod öneki, belge blokları, `curriculum.*` işleri (sahte DB + sahte taşıma)
- `test/curriculum.live.test.ts`: geçici veritabanı (`ogr_worker_cur_*`: stub + tüm göçler + seed'ler, sonunda silinir) + gerçek pg-boss (`pgboss` şeması) + sahte LLM: `onboarding_enroll` → SQL'den `curriculum.draft` → DB satırları; ikinci öğrenci; aktif ikiz; düşen taslak → `curriculum_draft_retry` → ready; review → collect → otopilot (taslağa); otopilot yayındaki ağacı değiştirmez (açık taslak sürüm); yeni sürüm + birleştirme + yayın (ustalık ve soru bankası kodla taşınır, `start_practice` v1'in sorusunu seçer)
