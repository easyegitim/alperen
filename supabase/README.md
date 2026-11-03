# supabase/ — Öğrenmen veritabanı v2

Postgres 15+ (Supabase) v2 temel şeması: `docs/PLAN-v2.md` §4 ve `docs/PLAN-v2-detail.md` §2. Üretim verisi olmadığı
için v1'in 0001–0019 migration'ları tek bir temiz v2 tabanına katlandı. Tablo/sütun adları detay belgesindeki adlardır;
her tablo ve sütun `comment on` ile Türkçe açıklanır (satır içi yorumlardan `scripts/sync_comments.py` üretir).

P0-B1 tabanı (0001–0016) şemayı, tetikleyicileri, BKT fonksiyonlarını, yardımcıları ve seed'leri içerir. P0-B2 (0017–0019)
uygulama RPC'lerini, RLS politikalarını + `authenticated` yetkilerini ve istemci görünümlerini ekler. Tüm tablolarda
RLS açık ve zorlanmıştır; `secure.*` ve `audit.events` bilinçli olarak politikasızdır (yalnız SECURITY DEFINER
fonksiyonlar ve `service_role`; `scripts/no-policy-allowlist.json`).

## Roller ve kimlik

- Özel uygulama rolü yok (v1'in `bot_runtime` ve `batch_worker` rolleri kaldırıldı; başlık tabanlı
  `app.current_student()` yok). Web uygulaması kullanıcının JWT'siyle (`authenticated`) çalışır; kimlik
  `auth.uid()` + `public.profiles` (rol: `student | parent | instructor | admin`).
- `service_role` yalnız `apps/worker` içindir (BYPASSRLS). 0002 varsayılan yetkileriyle public/secure/audit
  tablolarına, dizilerine ve public/app fonksiyonlarına erişir.
- `secure` (cevap anahtarları) ve `audit` şemaları `anon`/`authenticated`'a kapalıdır.

### Yardımcı fonksiyonlar (B2 RLS politikaları bunları kullanır; hepsi `authenticated` + `service_role` çağırabilir)

| Fonksiyon | Döner |
| --- | --- |
| `app.uid()` | `auth.uid()` |
| `app.jwt_role()` | JWT `role` claim'i, yoksa `current_user` |
| `app.role()` | oturumdaki profilin `profiles.role`'ü (SECURITY DEFINER) |
| `app.is_admin()` | `app.role() = 'admin'` |
| `app.my_student_id()` | `students.id` (`students.profile_id = auth.uid()`), yoksa null |
| `app.my_children()` | `setof uuid`: velinin `status='active'` `guardian_links.student_id`'leri |
| `app.my_students()` | `setof uuid`: eğitmenin `instructor_links.student_id`'leri (tekil) |
| `app.can_read_student(p_student uuid)` | öğrencinin kendisi, aktif velisi, bağlı eğitmeni ya da admin |

Diğer yardımcılar: `app.base32_random(n)`, `app.touch_updated_at()`, `app.pii_name_token_hashes(text)`,
`app.audit_event(p_action, p_table, p_row_id, p_diff)`, `app.audit_row()`, `app.fill_curriculum_id()`,
`app.check_skill_ids()`, `app.observations_check_source()`, `app.memory_files_guard()`,
`app.profiles_create_student()`; BKT: `app.bkt_step`, `app.blend_step`, `app.inferred_guess`, `app.parse_number`,
`app.numeric_equal`, `app.answer_key_complete`, `app.infer_prereq_gap`; RPC'ler: `public.apply_observation(p_obs bigint)`,
`public.enqueue_job(p_name text, p_data jsonb default '{}')` (ikisi de yalnız `service_role` ve SECURITY DEFINER
fonksiyonlar).

## Migration'lar

| Dosya | İçerik |
| --- | --- |
| `0001_extensions.sql` | pgcrypto, vector, pg_trgm, (varsa) pg_cron |
| `0002_roles_and_helpers.sql` | şemalar (secure, audit, app), varsayılan yetki iptalleri, service_role yetkileri, yukarıdaki yardımcılar |
| `0003_identity.sql` | profiles, students, guardian_links, instructor_links, settings, runtime_flags; profil → öğrenci tetikleyicisi; PII hash bloğu |
| `0004_curriculum.sql` | curricula (+origin, source_refs, created_by), skills (+kind, exam_weight_hint, source_refs), skill_prerequisites, misconception_tags, courses, syllabus_topics, enrollments (+course_id, target_exam, exam_date, goal), curriculum_proposals |
| `0005_evidence.sql` | observations (+error_cause; source_type += solution_analysis, exam_response), mastery, mastery_history, misconceptions, misconception_evidence, instructor_notes, preferences, student_dossier_cache |
| `0006_questions.sql` | figures, questions, secure.answer_keys, question_templates, attempts, content_pool, question_styles, style_coverage |
| `0007_uploads_conversations.sql` | uploads, conversations, conversation_messages, memory_files (+sınır tetikleyicisi), memory_file_versions, memory_facts, weekly_summaries |
| `0008_analysis.sql` | solution_analyses |
| `0009_exams.sql` | exams, exam_questions, secure.exam_answer_keys, exam_sessions, exam_responses, exam_sources, exam_items (+format, trick, difficulty, style_id), exam_priority_plans |
| `0010_documents.sql` | generated_documents, library_documents, library_chunks |
| `0011_mastery.sql` | BKT (`packages/mastery-math/sql/bkt.sql` BİREBİR, `-- begin bkt` … `-- end bkt`), `apply_observation` |
| `0012_lessons.sql` | lessons v2 (+upload_id, course_id, student_visible, auto_apply_threshold), lesson_analyses, lesson_claims (+confidence, course_insight) |
| `0013_notifications.sql` | notifications, notification_rules, push_subscriptions |
| `0014_llm_ledger.sql` | llm_calls (+route, effort, prompt_version, cache_read_tokens, cache_write_tokens), spend_ledger, prompt_versions, eval_cases, eval_runs, audit.events + denetim tetikleyicileri |
| `0015_storage.sql` | kovalar: uploads, lessons (≤ 5 GB, TUS), documents özel; figures herkese açık |
| `0016_cron.sql` | `public.enqueue_job()` (pgboss.job'a aynı işlemde INSERT; tablo yoksa `audit.events` 'job.enqueue_skipped' + null), pg_cron örnekleri (yalnız enqueue) |
| `0017_rpc.sql` | uygulama RPC'leri (aşağıda), `app.is_trusted/is_staff/assert_student_access/try_enqueue/apply_proposal/dossier_leaves/memory_path_ok`, `llm_calls → spend_ledger` tetikleyicisi |
| `0018_rls.sql` | politika yardımcıları (`app.can_read_student_data/enrollment/course/curriculum/conversation`, `app.can_see_profile`), `authenticated` yetkileri, 61 tablonun 58'inde politikalar, `storage.objects` politikaları (yalnız Supabase'de) |
| `0019_views.sql` | `mastery_view`, `v_exam_questions_student`, `v_questions_student`, `v_parent_child_overview` |

BKT dosyası `0011_mastery.sql` adını korur: `scripts/check-drift.py` bu adı bekler.

Sözleşmeler: tüm tablolarda `created_at`; tek sütunlu uuid birincil anahtarlar `default gen_random_uuid()`;
gömmeler `halfvec(1024)` (Voyage voyage-3.5; HNSW `halfvec_cosine_ops`); hata kodları `OGR-*` (`OGR-CURR-00x`,
`OGR-EVID-001`, `OGR-MAST-00x`, `OGR-MEM-00x`, `OGR-JOB-00x`, B2: `OGR-AUTH-00x`, `OGR-DIAG-00x`, `OGR-EXAM-00x`, `OGR-KEY-001`,
`OGR-DOS-001`, `OGR-PROP-00x`, `OGR-INV-00x`, `OGR-LLM-001`, `OGR-FLAG-001`, `OGR-DOC-001`).

### apply_observation (v1 semantiği + ağırlık)

İkili gözlem (`diagnostic | practice | test | resolution`): `g = guess_override ?? skills.p_guess`,
`p' = bkt_step(p, value ≥ 0.5, g, s, t)`; `weight < 1` ise `p' = p + w·(bkt_step − p)` (careless/time teşhisleri
w = 0.5; w = 1 v1 ile birebir). `lesson | instructor`: `blend_step(p, value, confidence)`. `inferred`:
`g' = inferred_guess(g, w)`, yanlış adım, kanıt sayısı artmaz. Sohbet gözlemleri p'yi değiştirmez, yanılgı sayacına
katılır. Etiketli yanlışta tek seviyeli ön koşul çıkarımı.

### pg-boss

pgboss şemasını worker kurar. `enqueue_job` SECURITY DEFINER'dır ve migration sahibinin (Supabase'de `postgres`) haklarıyla
`pgboss.job`'a yazar: worker pg-boss'u aynı rolle kurmalı (ya da `pgboss` şeması/`job` tablosu için o role USAGE + INSERT
vermeli) ve her iş adı için kuyruğu (`createQueue`) önceden yaratmalı; kuyruk yoksa `OGR-JOB-001` yükselir.


## RPC'ler (P0-B2; apps/web ve apps/worker)

Hepsi `SECURITY DEFINER`, `search_path` sabit, `authenticated` ve `service_role` çağırır (anon çağıramaz). Yetki hatası
SQLSTATE `42501` + `OGR-AUTH-00x`; diğer hatalar `P0001` + `OGR-*` mesajı. **Güvenilir çağıran** (`app.is_trusted()`):
`service_role` JWT'si ya da JWT'siz doğrudan Postgres oturumu (worker'ın pg bağlantısı, migration, testler). **Öğrenci
yazımı** (`app.assert_student_access(p_student, true)`): öğrencinin kendisi, `owner` bağlı eğitmen, admin, güvenilir
çağıran; veli yalnız okur.

| İmza | Döner | Kim | Not |
| --- | --- | --- | --- |
| `apply_diagnosis(p_analysis jsonb)` | `uuid` (solution_analyses.id) | öğrenci yazımı | Girdi: `enrollment_id`, `verdict` (correct/wrong/incomplete/unreadable), `analysis` (nesne; `steps[]` varsa `failing_step_no ≤` adım), isteğe bağlı `error_cause`, `failing_step_no`, `skill_ids[]` (kaydın müfredatında yaprak), `misconception_tags[]`, `style_id`, `exam_response_id`, `conversation_message_id`, `upload_ids[]`, `question_text`, `student_work_text`, `quote`, `confidence`, `model`, `cost_usd`, `embedding` (1024), `proposed_subskill {parent_id, name, id?, description?, kind?}`. Kazanım başına `observations(kind='practice', source_type='solution_analysis')` → `apply_observation`; careless/time ağırlığı `settings.careless_weight` (0.5); deneme bağlamında (`exam_response_id`) ağırlık 0 ve kanıt sayılmaz; `unreadable` gözlem üretmez; `style_coverage`; öneri → `curriculum_proposals` (otopilot + `ai_draft` → hemen kabul); iş `diagnosis.followup`. Hatalar `OGR-DIAG-001..005` |
| `start_exam_session(p_exam uuid, p_enrollment uuid, p_mode text default 'in_app')` | `uuid` | öğrenci yazımı | süren oturum varsa onu döner; in_app için sınav `ready/published`; sınav ve kayıt müfredatı aynı (`OGR-EXAM-002`) |
| `record_exam_response(p_session uuid, p_exam_question uuid, p_answer text default null, p_time_spent_sec int default null, p_flagged boolean default null, p_work_upload_ids uuid[] default null, p_how_far_text text default null)` | `uuid` | öğrenci yazımı | upsert; bitmiş oturumda yalnız nereye-kadar alanları (`OGR-EXAM-003`) |
| `grade_exam_session(p_session uuid)` | `jsonb` score | öğrenci yazımı | `secure.exam_answer_keys` okur; outcome correct/wrong/blank/unfinished (son cevaptan sonraki boşlar) / null (anahtarsız, açık uçlu); `observations(kind='test', guess_override=settings.exam_guess_override 0.2)`, boş ağırlık 0.5; `style_coverage`; durum `analysing`; iş `exam.report`; tekrar çağrı aynı skoru döner. Score: `{total, correct, wrong, blank, unfinished, ungraded, net, wrong_penalty, unverified_keys, sections:[{section,total,correct,wrong,blank,unfinished,ungraded,net}], graded_at}` |
| `set_exam_key(p_exam_question uuid, p_correct_option text default null, p_numeric_value numeric default null, p_source text default 'instructor', p_confidence numeric default null)` | `void` | sınavın eğitmeni, admin, worker | `inferred/generated` yalnız worker; denetim izine değer yazılmaz |
| `peek_answer_key(p_question uuid)` | `jsonb` | eğitmen, admin, worker | soru bankası (`kind:'question'`) ya da sınav sorusu (`kind:'exam_question'`); her okuma `audit.events` |
| `render_dossier(p_student uuid, p_course uuid)` | `jsonb` | öğrenci, bağlı eğitmen, admin, worker (veli değil) | `{version, as_of, identity{student_ref, grade, school, enrollment_id, course_*, curriculum, period, target_exam, exam_date, goal, days_to_exam}, mastery{leaves_total, leaves_with_evidence, evidence_total, weakest[≤20], strongest[≤10] {skill_id,name,p,n,trend_14d}}, open_misconceptions[≤8], error_causes_30d{concept,procedure,careless,reading,time}, recent_diagnoses[≤10], recent_exams[≤3], style_gaps[≤10], recent_lesson_claims[≤5], hash}`; görünen ad yok; `hash = sha256(gövde)` (`student_dossier_cache` ile karşılaştırma) |
| `decide_proposal(p_id uuid, p_accept boolean, p_note text default null)` | `jsonb {id, status, applied, skill_id}` | müfredatın/dersin eğitmeni, admin, worker | yerinde: add_subskill, rename, add_prereq (döngü `OGR-PROP-003`), add_tag; merge → `curriculum.merge` işi |
| `create_guardian_invite(p_student uuid, p_relation text default null)` | `jsonb {link_id, token, expires_at}` | öğrenci yazımı (veli değil) | token yalnız burada döner; saklanan `sha256(token)` hex; süre `settings.guardian_invite_hours` |
| `accept_guardian_invite(p_token text)` | `jsonb {link_id, student_id}` | oturumlu kullanıcı | profil yoksa `role='parent'` açılır; başka rol `OGR-INV-003`; tek kullanım, süre (`OGR-INV-001/002`) |
| `revoke_guardian_link(p_link uuid)` | `void` | öğrenci yazımı ya da velinin kendisi | kabul edilmemiş davet silinir |
| `upsert_memory_file(p_student uuid, p_path text, p_content text, p_op text, p_actor text, p_new_path text default null)` | `jsonb {path, version, op, bytes, from_path}` | öğrenci yazımı | op: create (üzerine yazar) / str_replace / insert / compact (tam yeni içerik) / delete / rename (`p_new_path`); ≤ 12 dosya, ≤ 8 KB, `/memories/…(.md|.txt)` ≤ 3 düzey; `parent_summary.md` yalnız worker; her işlem `memory_file_versions`. Hatalar `OGR-MEM-001..007` |
| `log_llm_call(p_call jsonb)` | `bigint` | herkes (oturumlu) | `llm_calls` alanları; tetikleyici `spend_ledger` (Istanbul günü × purpose × provider); öğrenci/veli oturumunda `student_ref` sabitlenir; `created_at` yalnız worker |
| `check_spend(p_purpose text, p_student_ref text default null)` | `table(paid_allowed, degraded, downgrade, state, day_usd, month_usd, daily_cap, monthly_cap, student_month_usd, student_cap, alert_level)` | herkes | yumuşak tavan: aşımda `downgrade=true`, state `soft_cap | student_cap`; `disabled` (paid_llm_enabled=false), `degraded`; `cap_excluded_purposes` |
| `set_runtime_flag(p_key text, p_value jsonb)` | `void` | admin, worker | denetim izi |
| `request_document(p_kind text, p_student uuid, p_course uuid, p_title text, p_spec jsonb default '{}')` | `uuid` | öğrenci yazımı; veli yalnız çocuğu için `report`; ders geneli (`p_student` null) eğitmen | `generated_documents(status='queued')` + iş `document.generate` |
| `apply_observation(p_obs bigint)`, `enqueue_job(p_name text, p_data jsonb)` | | yalnız worker | B1 |

İşler: RPC'ler `app.try_enqueue()` ile aynı işlemde pg-boss işi ekler — `diagnosis.followup {analysis_id, enrollment_id}`,
`exam.report {session_id}`, `document.generate {document_id, kind}`, `curriculum.merge {proposal_id}`. Kuyruk yoksa ya da
ekleme düşerse RPC düşmez; `audit.events`'e `job.enqueue_failed` (pgboss tablosu hiç yoksa `job.enqueue_skipped`) yazılır.
Worker bu kuyrukları `createQueue` ile önceden kurmalıdır.

## Görünümler

Sahibinin haklarıyla çalışır (`security_barrier`); satırları WHERE'deki yardımcılar süzer. `authenticated` okur.

| Görünüm | Kim | İçerik |
| --- | --- | --- |
| `mastery_view` | öğrenci, aktif veli, bağlı eğitmen, admin | yaprak başına `student_id, enrollment_id, course_id, curriculum_id, skill_id, skill_name, parent_id, evidence_count, p, band (low < 0.5 ≤ mid < 0.8 ≤ high), last_evidence_at, updated_at`; kanıt < `settings.min_evidence` (5) ise `p` ve `band` null |
| `v_exam_questions_student` | oturumu olan öğrenci, personel | `exam_questions` sütunları + `is_copyrighted`; telifli sınavda `stem_text` null ve şıklarda yalnız `key`; şıklardan `misconception_tag` çıkarılır |
| `v_questions_student` | görebildiği müfredatın kullanıcısı | onaylı sorular, şıklarda yanılgı etiketi yok |
| `v_parent_child_overview` | veli (kendi aktif bağları), admin | `parent_id, student_id, relation, display_name, grade, school, enrollments[], last_activity_at, diagnoses_7d, exams_30d, last_exam, mastery_bands{low,mid,high,insufficient}, open_misconceptions, unread_notifications` |

## RLS özeti (0018)

- `anon`: hiçbir tablo/görünüm. `authenticated`: tüm public tablolarında SELECT (politikalar süzer); sütun düzeyinde yazım
  yalnız: `profiles` (kendi; insert rol student/parent; update ad/dil/tz/avatar/onboarded_at — rol değişmez),
  `students` (grade, school), `enrollments` (kendine kayıt), `preferences`, `uploads` (owner = kendisi), `conversations`
  (kendi: öğrenci coach, veli parent, eğitmen instructor), `conversation_messages` (katılımcı; role user/assistant),
  `notifications.read_at`, `notification_rules`, `push_subscriptions`. Diğer tüm yazımlar RPC'lerle.
- Öğrenci: kendi kayıt/kanıt/teşhis/deneme/hafıza/yükleme satırları; görünür ders ve müfredatlar; soru metinleri yalnız
  görünümlerle; `secure.*` asla. Veli: çocuğunun öğrenci/kayıt/deneme oturumu (skor)/`report` belgeleri/haftalık özet/
  `parent_summary.md`, `mastery_view`, kendi sohbet ve bildirimleri; **koç sohbeti, gözlemler, ustalık tablosu, sınav
  soruları, ham yüklemeler yok**. Eğitmen: bağlı öğrencilerin her şeyi (koç sohbeti dahil) + ders içeriği (sorular,
  sınavlar, kütüphane, öneriler, dersler). Admin: hepsi (+ `llm_calls`, `spend_ledger`, `runtime_flags`, eval).
- Storage (`storage.objects`, yalnız Supabase'de): `uploads` kovasına `<auth.uid()>/…` altına yazılır, okuma `uploads`
  satırının RLS'ine; `documents` → `generated_documents` RLS'i; `lessons` yalnız eğitmen/admin.

## Seed'ler

| Dosya | İçerik |
| --- | --- |
| `seed/00_people.sql` | yalnız yerel/test: admin, eğitmen, veli, iki öğrenci (auth.users + profiles), veli ve eğitmen bağları; Supabase auth.users'ta (instance_id) kendini atlar |
| `seed/01_settings.sql` | sabitler (min_evidence, misconception_open_evidence, max_options, default_period, careless_weight, exam_guess_override, exam_blank_weight, exam_wrong_penalty, hafıza sınırları, dossier sınırları, guardian_invite_hours …) |
| `seed/02_runtime_flags.sql` | harcama tavanları (daily/monthly/student_monthly_cap_usd, cap_excluded_purposes, alert_thresholds) ve bayraklar (cron_owner'ı 0016 yazar) |

Müfredat seed'i çalışma anında üretilir: `python content/tyt-matematik/scripts/export-sql.py --schema v2 --out x.sql`
(teşhis testi `exams(kind='diagnostic')` + `exam_questions`; hukuk metni yok). Teşhis cevap anahtarları
(`content/.../seed-keys.py`) henüz v1 tabanına (`public.staff`) yazar; v2'de atlanır.

## Denetim

```
bash /home/user/alperen/supabase/check.sh                  # lint.sh + check_sql.py (DB gerekmez)
OGRENMEN_LIVE=1 bash /home/user/alperen/supabase/check.sh  # + db-test.sh (yerel Postgres)
```

- `scripts/lint.sh`: sqlfluff (`supabase/.sqlfluff`), `sync_comments.py --check`, BKT ve PII kopyalarının birebirliği,
  `scripts/tests/test_check_sql.py`.
- `scripts/check_sql.py <migrations> [--require-policies]` (check.sh `--require-policies` ile çalıştırır): `OGR-LINT-RLS`
  (ENABLE + FORCE), `OGR-LINT-POLICY` (politikasız tablo `scripts/no-policy-allowlist.json`'da olmalı), `OGR-LINT-SECURE`, `OGR-LINT-GRANTALL`, `OGR-LINT-BASELINE`,
  `OGR-LINT-SEARCHPATH`, `OGR-LINT-GENERATED`, `OGR-LINT-ORDER`, `OGR-LINT-VARCONFLICT`, `OGR-LINT-COMMENT`,
  `OGR-LINT-CREATEDAT`, `OGR-LINT-UUIDPK`, `OGR-LINT-HALFVEC`, `OGR-LINT-MATRIX` (PUBLIC'e EXECUTE).
- `scripts/db-test.sh [--keep]`: `OGRENMEN_DATABASE_URL` sunucusunda geçici `OGRENMEN_TEST_DB` (varsayılan
  `ogrenmen_test`; `ogrenmen` adı reddedilir) açar: `tests/00_local_stub.sql` → migration'lar (süper kullanıcı olmayan
  `ogrenmen_owner` ile) → seed'ler ve müfredat seed'i iki kez → `tests/[0-9][0-9]_*.sql`; sonunda veritabanını siler.
  Değişken yoksa `SKIP: no database`.

### Testler

| Dosya | Kapsam |
| --- | --- |
| `tests/00_local_stub.sql` | yerelde Supabase eşlenikleri: roller, `auth.users`, `auth.uid()/jwt()/role()`, `extensions` şeması, halfvec yedeği (pgvector < 0.7), pg_cron yoksa `cron.job` + `cron.schedule`, storage yoksa `storage.buckets`, migration sahibi `ogrenmen_owner` |
| `tests/_fixture.sql` | `t.as_admin/as_user/as_service/as_anon/claims_only`, `t.ok`, `t.raises`, `t.n`/`t.sees` (RLS altında satır sayısı), `t.add_outsiders()` (bağsız öğrenci/eğitmen/veli); küçük test müfredatı + ders + iki kayıt |
| `tests/01_schema.sql` | 61 tablonun tüm sütunları, CHECK değerleri, RLS, şema erişimi, halfvec(1024), created_at, uuid pk; yardımcılar; tetikleyiciler; hafıza sınırları; denetim izi; enqueue_job; cron; kovalar; PII hash vakaları; müfredat seed'i ve ikinci sürüm |
| `tests/02_rls_matrix.sql` | RLS matrisi: 32 sorgu × 8 kullanıcı (öğrenci A/B, veli, eğitmen, admin + bağsız öğrenci/eğitmen/veli); veli koç sohbetini okuyamaz, öğrenci/admin JWT'si `secure.*` göremez, anon hiçbir şey; kullanıcı yazımları |
| `tests/03_answer_keys.sql` | `set_exam_key` / `peek_answer_key` yetkileri ve biçimi, denetim izi, maskeli görünümler (telif, yanılgı etiketi), notlamanın anahtarı öğrenci oturumunda okuması |
| `tests/04_student_isolation.sql` | A, B'nin hiçbir satırını göremez ve B adına RPC/yazım yapamaz; veli ve viewer eğitmen yazamaz; owner eğitmen yazar |
| `tests/05_evidence_chain.sql` | `apply_diagnosis` → observations → mastery/history/yanılgı/çıkarım/style_coverage; careless 0.5; deneme bağlamı 0; okunamayan; `OGR-DIAG-00x`; öneri, `decide_proposal`, otopilot |
| `tests/06_grading.sql` | oturum → cevap → `grade_exam_session`: outcome kuralları, skor/net/bölümler, test gözlemleri (g = 0.2, boş 0.5), BKT zinciri, idempotentlik, `OGR-EXAM-00x` |
| `tests/07_memory_files.sql` | `upsert_memory_file` işlemleri, sürümler, ≤ 12 dosya, ≤ 8 KB, izin listesi, parent_summary.md, okuma RLS'i |
| `tests/08_bkt_parity.sql` | `packages/mastery-math/fixtures/bkt-vectors.json` paritesi (1e-9) + apply_observation yolu (ağırlık, guess_override, karışım, çıkarım, sohbet, kanıt zinciri) |
| `tests/09_dossier.sql` | `render_dossier` şekli: sınırlar (20/10/8/10/3), sıralama, trend, histogram, tarz boşlukları, hash, yetki |
| `tests/10_guardian.sql` | davet → kabul → görünürlük (özet kartı, mastery_view, rapor) → iptal; token hash, süre, tek kullanım |
| `tests/11_spend.sql` | `check_spend` yumuşak tavanları (günlük/aylık/öğrenci), eşik, hariç amaç, degraded/disabled, `set_runtime_flag` |
| `tests/12_llm_ledger.sql` | `log_llm_call` → `llm_calls` → `spend_ledger` tetikleyicisi, doğrulama, student_ref sabitleme, Batch created_at |



## Diğer betikler

- `scripts/size-report.sql` — depolama raporu (yalnız okur).
- `scripts/backup-public.sh` — public + audit (ya da `--secure`) `pg_dump` → `age` ile şifreli.
