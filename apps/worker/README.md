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
| `worker` | `noop`, `llm.ping`, `memory.compact`, `dossier.render`, `push.send`, `weekly.summary`, `curriculum.*`, `suggestions.refresh`, `activity.completed`, `conversation.summarize`, `upload.intake`, `diagnosis.run`, `diagnosis.followup`, `exam.analyse`, `exam.report`, `practice.generate`, `practice.prewarm`, `outbox.drain` | evet |
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
| `upload.intake` | `{ upload_ids[1..40], kind: own_work \| school_exam, student_id, enrollment_id }` (own_work en çok 4) | 2 | 3 | Yükle ekranı (`submit_upload` RPC'si `enqueue_job` ile atar): Kendi çalışmam → `diagnosis.run` (`singletonKey diagnosis:<ilk yükleme>`); Okul denemesi (eski yol; P2 web'i doğrudan `submit_exam_upload` çağırır) → `submit_exam_upload` ile aynı kayıt (`exams(deneme, uploaded, telifli, processing)` + `exam_sessions(uploaded, grading, upload_ids, progress.stage = classify)` + `audit.events 'exam.upload_intake'` tek SQL deyiminde) → `exam.analyse` (`singletonKey exam:<oturum>`) + "Denemeni inceliyorum" kartı |
| `diagnosis.run` | `{ upload_ids[1..4], enrollment_id }`; deneme bağlamı `{ upload_ids[0..4], enrollment_id, context: 'exam', exam_response_id, session_id, exam_id, question_no, how_far_text }` | 2 | 3, üstel, 20 sn | Files API (`anthropic_file_id` saklanır, `expires_in_seconds` 90 gün; süresi dolmuş kimlik bir kez yeniden yüklenir; sahte: `fake-file-<id>`) → `solution_diagnosis` (Opus · high; görsel `image`, PDF `document`) → çıktı `audit.events 'diagnosis.raw'`'a (yeniden deneme Opus'u yeniden çağırmaz) → doğrulama (yaprak kazanım, katalog etiketi, adım no; düşenler `analysis.validation`; modelin kazanım sırası `analysis.skill_order`) → `apply_diagnosis` (gözlem + BKT; öneri yükü `{parent_id, name, description, id?}`; otopilot + `ai_draft` müfredatta gözlem yeni yaprağa; `diagnosis.followup` kuyruğa) → Voyage gömmesi (`VOYAGE_API_KEY` yoksa atlanır) → `upload_result` kartı ("Çözümünü inceledim: 3. adımda işlem kuralı."; `copy_key = analysis:<id>`, öneri motoruyla aynı metin: `uploadNotice`) → yüklemeler `ready`; ret (`RefusalError`) ya da şemaya uymayan çıktı (`ParseError`) → `failed` + "Fotoğrafı okuyamadım" kartı (OGR-JOB-143); kalıcı yapılandırma/kimlik/istek hatası → `failed` + "Yüklemeni şu an işleyemedim" + `log.error` (OGR-JOB-146); başka hata son denemede → aynı kart (OGR-JOB-145). Düşen her teşhis `audit.events 'diagnosis.failed'` (`{upload_ids, enrollment_id, failure, reason}`) bırakır; kart `copy_key = upload:<ilk yükleme>`. Aynı küme ikinci kez teşhis edilmez. **Deneme bağlamı** (`src/jobs/diagnosis-exam.ts`; `exam_how_far`, `finish_exam_session`, `exam.analyse` karalama dağıtımı atar): cevap + soru + gizli anahtar (yalnız modele) → görseller (yoksa sorunun kitapçık sayfası) + `<exam_context>` (prompts `examContextText`, solution_diagnosis v2) + soru ve öğrencinin metni veri bloğu → `apply_diagnosis(exam_response_id)` (ağırlık 0, `exam_responses.solution_analysis_id`; Bugün kartı yok); ham çıktı `audit 'diagnosis.raw'` (row_id = cevap); aynı cevap ikinci kez teşhis edilmez; düşerse `audit 'diagnosis.failed'` ({exam_response_id, session_id}) |
| `diagnosis.followup` | `{ analysis_id, enrollment_id }` | 2 | 3 | `memory_delta` (Haiku) → `applyMemoryDelta` (hafıza aracının işleyicileri, actor `memory-delta`) → `activity.completed`; doğru/okunamayan teşhiste Haiku çağrılmaz |
| `pdf.render` | `{ html \| htmlRef, output, document_id?, options? }` | `PDF_CONCURRENCY` | 2 | HTML, A4 PDF, Storage, `generated_documents.pdf_path` |
| `push.send` | `{ notification_id \| user_id+title, ... }` | 4 | 5 | web-push iskeleti (VAPID); 404/410 abonelikleri siler |
| `weekly.summary` | `{ weekStart? }` | 1 | 2 | iskelet |
| `practice.generate` | `{ set_id, enrollment_id, curriculum_id?, skill_ids[], count, template_ids[] }` | 4 | 2, üstel, 5 sn | `start_practice` bankada soru bulamayınca atar: şablon → yetmezse LLM → banka + set (aşağıda); son denemede `fail_practice_generation` |
| `practice.prewarm` | `{ enrollment_id, skill_ids?, per_skill? (8), reason? }` | 2 | 2, üstel, 60 sn | ilk öneri için banka ısıtma (`curriculum.draft` bitişi, `suggestions.refresh`'in ilk `practice` kartı; yaprak kümesi başına saatte bir; ilk kartı ekleyen SQL `app.first_practice_suggestion` da atar: otopilotlu taslak kaydı ve eğitmen yayını `curriculum_publish`, `reason: curriculum_ready`) |
| `exam.analyse` | `{ session_id, exam_id, enrollment_id?, student_id?, upload_ids[1..40] }` | 2 | 3, üstel, 30 sn (deneme 30 dk) | yüklenen okul denemesinin analizi (aşağıda "Deneme analizi") |
| `exam.report` | `{ session_id }` | 2 | 3, üstel, 30 sn | `grade_exam_session` atar; yalnız uygulama içi oturum: `exam/produce-report.ts` (rapor → PDF → Storage → `register_generated_document` → done) + veli bildirimi; yüklenen oturumda `skipped: uploaded` (raporu `exam.analyse` üretir), bitmiş/notlanmamış oturumda biter |
| `document.generate`, `memory.correction` | — | — | — | yalnız kuyruk (işleyici sonra); SQL RPC'leri iş ekler, iş bekler |
| `outbox.drain` | `{ reason? }` | 1 | 0 | `secure.job_outbox` → pg-boss (yukarıda "Outbox aktarımı"); süreç 30 sn'de bir atar |
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
| `done` | Bugün `upload_result` kartı (`session:<id>`, "Deneme sonucun hazır" + `card_line`), veli `notifications` (`exam_result`, in_app, üçüncü kişiyle: "…: 5,5 net. En çok zorlandığı konu: Oran–orantı."; gönderim P6), karalama sayfası varsa yanlış/boşlar için `diagnosis.run` deneme bağlamı (önce yanlışlar, en çok `EXAM_AUTO_DIAGNOSIS_MAX` = 10; sorunun kitapçık sayfası + karalamalar ≤ 4, `exam_responses.work_upload_ids`); yoksa öğrenci sonuç ekranında "Nereye kadar geldim?" (`exam_how_far`) ya da boş nedeni (`exam_blank_reason`) | `diagnoses_queued`, `warnings` (virgüllü kodlar: `page_unreadable`, `page_unknown`, `question_partial`, `question_duplicate`, `question_gap`, `skill_untagged`, `key_low_confidence`, `key_missing`, `answer_double`, `answer_unclear`, `answer_low_confidence`, `score_mismatch`, `report_fallback`, `report_failed`, `no_scratch`). Maliyet, ayrıntılı uyarılar ve bütün koşuların kodları stash `run_meta`'dadır (progress öğrenciye açık) |
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
- `test/practice.test.ts`: soru bankası (şablon planı, LLM çıktısı eşlemesi, anahtar denetimi + yanlış anahtarlı fikstür maddesi atılır, şablon yolu, fake LLM yolu 8 soru < 5 sn, kalıcı hata → `generation_failed`, ön ısıtma; Python + SymPy varsa gerçek `py/template_fill.py`); `test/practice.live.test.ts`: geçici veritabanı + TYT anahtarları: yeni öğrencinin ilk Başla'sı teşhis sorularından, atanmış teşhiste şablon yolu (şekil Storage'a, < 10 sn), fake LLM yolu (< 5 sn, `llm_calls`), kalıcı hata, `practice.prewarm`
- `test/exam.test.ts`: deneme hattının saf parçaları (aşama makinesi, kitapçık birleştirme, kazanım eşleme (yüksek güven: 8/10, belirsizler kazanımsız), yayıncı eşleşmesi içerik denetimi, anahtar sızıntısı kalıbı, sayı sınırlı özet neti, veli cümlesi, optik form ve çift işaret, anahtar denetimi, net = doğru − yanlış/4 → 5,5, rapor verisi + deterministik rapor `exam-report` sözleşmesine uyar, sharp alımı/eğrilik/EXIF/kırpım, deneme bağlamlı teşhis girdisi)
- `test/exam.live.test.ts`: geçici veritabanı + gerçek pg-boss + sahte LLM + bellek içi Storage + gerçek doc-render PDF: öğrenci JWT'si → `submit_exam_upload` → `exam.analyse` → done < 60 sn (yerelde ~4 sn): 10 soru (5. soru iki sayfada, 3. soruda şekil kırpımı), kazanımlar, çıkarılmış anahtar, net 5,5, 8 gözlem + ustalık (kazanımsız 2 soru gözlemsiz), rapor PDF Storage'da, kart, veli bildirimi, `llm_calls`; öğrenci görünümünde anahtar yok; `exam_how_far` → deneme bağlamlı teşhis; karalama dağıtımı; uygulama içi aynı deneme → `exam.report`; yüklenen anahtar sayfası ve yayıncı eşleşmesi (çıkarım çağrılmaz; başka kişinin yüklemesi, varsayılan başlık, farklı kökler eşleşmez); okunamayan sayfalar → failed + kart; tek sayfanın bozuk çıktısı → done + `page_unreadable`; çıkarım reddi → done + `key_missing`; PDF → OGR-EXAM-104; `EXAM_KEYS_BATCH` (bitmeyen Batch → 120 sn sonra yeniden kuyruk, `plan`'dan süren ikinci koşu, 6 sa sonra senkron); telifli denemede `question_text` null
- `test/startup-checks.test.ts`: başlangıç denetimleri (sahte veritabanı: ön denetim, rol yetkileri, kuyruk açma, enqueue_job sahibi + `auto`/`off` yetki, deneme bloğu, outbox; SQL göçlerinin attığı her ad `REQUIRED_QUEUES`'ta) ve `drainOutbox` (aynı işlem, kayıt noktası, kuyruksuz satır kalır)
- `test/startup.live.test.ts`: geçici veritabanı + gerçek pg-boss: denetimler geçer (sahibe yetki verilir, deneme satırı kalmaz, `/healthz` 200); sahibin yetkisi alınınca SQL işi outbox'a düşer, `outbox.drain` aynı kimlikle aktarır, iş tamamlanır, zamanlayıcı çalışır; `WORKER_PGBOSS_GRANT=off` → `StartupCheckError` (78) + `/healthz` 503 `degraded`; pgboss'ta yetkisiz giriş rolüyle `src/index.ts` 78 ile çıkar
- `test/boss.live.test.ts`: yerel Postgres'te geçici şema (`pgboss_t_*`, sonunda silinir); `OGRENMEN_LIVE=1` ile (`bun run test:live`)
- `test/curriculum.test.ts`: taslak doğrulama kuralları, kod öneki, belge blokları, `curriculum.*` işleri (sahte DB + sahte taşıma)
- `test/curriculum.live.test.ts`: geçici veritabanı (`ogr_worker_cur_*`: stub + tüm göçler + seed'ler, sonunda silinir) + gerçek pg-boss (`pgboss` şeması) + sahte LLM: `onboarding_enroll` → SQL'den `curriculum.draft` → DB satırları; ikinci öğrenci; aktif ikiz; düşen taslak → `curriculum_draft_retry` → ready; review → collect → otopilot (taslağa); otopilot yayındaki ağacı değiştirmez (açık taslak sürüm); yeni sürüm + birleştirme + yayın (ustalık ve soru bankası kodla taşınır, `start_practice` v1'in sorusunu seçer)
