-- 0014_rls.sql — tablo okuyan yardımcılar (BAŞTA), satır düzeyi güvenlik ve GRANT matrisi (BLUEPRINT §3.8).
-- tests/grants_matrix.json bu dosyadaki (ve 0013/0015/0017'deki) GRANT'lerin makine-okur hâlidir; check_sql.py
-- --grants-matrix ikisini birebir karşılaştırır, tests/09_grants_matrix.sql canlı DB'de ACL'lerle karşılaştırır.
-- Bağlamlar: S = bot_runtime + X-Ogrenmen-Student başlığı; B = bot_runtime başlıksız (cron/grup); W = batch_worker;
-- E/K/G = authenticated + staff.role (instructor/coordinator/observer). service_role RLS'i geçer, uygulamada yoktur.

-- Tablo okuyan yardımcılar ------------------------------------------------------------------------------

create or replace function app.current_student_sd() returns uuid
language sql
stable
security definer
set search_path = public, secure, pg_temp
as $$
  select al.student_id from secure.auth_links as al where al.auth_user_id = app.uid()   -- secure şemasına yalnız bu sarmal dokunur
$$;
comment on function app.current_student_sd() is 'auth.users → öğrenci (ileride PWA); secure.auth_links okuması RLS''siz sarmal.';

create or replace function app.current_student() returns uuid
language sql
stable
as $$
  select case when app.jwt_role() = 'bot_runtime'
              then nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-ogrenmen-student', '')::uuid
              else app.current_student_sd() end
$$;
comment on function app.current_student() is 'İsteğin öğrencisi: bot_runtime için X-Ogrenmen-Student başlığı, diğerleri için auth_links.';

create or replace function app.staff_role() returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select st.role from public.staff as st where st.id = app.uid() and st.active
$$;
comment on function app.staff_role() is 'Panel kullanıcısının aktif personel rolü (coordinator/instructor/observer) ya da null.';

create or replace function app.can_see_student(sid uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(app.staff_role() = 'coordinator', false)
      or exists (select 1 from public.staff_students as ss where ss.staff_id = app.uid() and ss.student_id = sid)   -- E ve G: atanan öğrenciler
$$;
comment on function app.can_see_student(uuid) is 'Koordinatör herkesi, eğitmen ve gözlemci yalnız atanan öğrencileri görür.';

create or replace function app.can_edit_student(sid uuid) returns boolean
language sql
stable
as $$
  select coalesce(app.staff_role() in ('coordinator', 'instructor'), false) and app.can_see_student(sid)
$$;
comment on function app.can_edit_student(uuid) is 'Düzenleme: koordinatör ya da öğrenciye atanmış eğitmen (gözlemci değil).';

create or replace function app.enrollment_student(eid uuid) returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.student_id from public.enrollments as e where e.id = eid
$$;
comment on function app.enrollment_student(uuid) is 'Kaydın öğrencisi (RLS''siz sarmal; politikalar ve RPC''ler kullanır).';

-- Politika özyinelemesini önleyen iki küçük sarmal (staff ve chat_roles politikaları kendi tablolarını okuyamaz)
create or replace function app.staff_subject() returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select st.subject from public.staff as st where st.id = app.uid() and st.active
$$;
comment on function app.staff_subject() is 'Panel kullanıcısının branşı (staff politikası: aynı branş eğitmenleri).';

create or replace function app.staff_in_chat(p_chat bigint) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.chat_roles as cr where cr.chat_id = p_chat and cr.staff_id = app.uid())
$$;
comment on function app.staff_in_chat(bigint) is 'Panel kullanıcısı bu sohbetin üyesi mi (tg_chats/chat_roles politikası).';

-- §3.8 exam_priority_plans S: onaylı ve courses.curriculum_id = öğrencinin kaydının curriculum_id'si. bot_runtime courses'u
-- okuyamaz (S/B —), bu yüzden eşleme RLS'siz sarmalda; başlıksız (B) bağlam yalnız status='approved' ile sınırlıdır.
create or replace function app.plan_visible_to_student(p_course uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.current_student() is null
      or exists (select 1 from public.courses as c
                   join public.enrollments as e on e.curriculum_id = c.curriculum_id
                  where c.id = p_course and e.student_id = app.current_student())
$$;
comment on function app.plan_visible_to_student(uuid) is 'Öncelik planı bu öğrencinin müfredatına mı ait (başlıksız bot bağlamında true); courses okuması RLS''siz sarmal.';
revoke all on function app.plan_visible_to_student(uuid) from public;

-- 0017 transcripts_staff_read: §3.8 E sütunu atanan öğrencilerle sınırlıdır. storage.objects.name (kova içi yol)
-- lessons.transcript_path ile eşlenir (yol 'transcripts/<id>.jsonl' ya da '<id>.jsonl' biçiminde; retention aynı kuralı kullanır).
create or replace function app.transcript_visible(p_name text) returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.staff_role() in ('instructor', 'coordinator')
     and exists (select 1 from public.lessons as l
                  where l.transcript_path is not null
                    and regexp_replace(l.transcript_path, '^transcripts/', '') = regexp_replace(p_name, '^transcripts/', '')
                    and app.can_see_student(app.enrollment_student(l.enrollment_id)))
$$;
comment on function app.transcript_visible(text) is 'Panel kullanıcısı bu transkript nesnesini okuyabilir mi: eğitmen yalnız atanan öğrencinin dersi, koordinatör hepsi, gözlemci hiç.';
revoke all on function app.transcript_visible(text) from public;
grant execute on function app.transcript_visible(text) to authenticated;
grant execute on function app.plan_visible_to_student(uuid) to bot_runtime;

revoke all on function app.current_student_sd(), app.current_student(), app.staff_role(), app.can_see_student(uuid),
                       app.can_edit_student(uuid), app.enrollment_student(uuid), app.staff_subject(), app.staff_in_chat(bigint) from public;
-- Politikalar çağıranın yetkisiyle değerlendirilir: uygulama rolleri bu yardımcıları çalıştırabilmelidir
-- (app.current_student içindeki app.current_student_sd çağrısı ifade başlatılırken yetki denetimine girer).
grant execute on function app.current_student_sd(), app.current_student(), app.staff_role(), app.can_see_student(uuid),
                          app.can_edit_student(uuid), app.enrollment_student(uuid), app.staff_subject(), app.staff_in_chat(bigint)
  to bot_runtime, batch_worker, authenticated;

-- 0003 kimlik ------------------------------------------------------------------------------------------

alter table public.quota_tiers enable row level security;
alter table public.quota_tiers force row level security;
create policy quota_tiers_read on public.quota_tiers for select to bot_runtime, batch_worker, authenticated using (true);
grant select on public.quota_tiers to bot_runtime, batch_worker, authenticated;

alter table public.students enable row level security;
alter table public.students force row level security;
create policy students_bot_r on public.students for select to bot_runtime
  using (app.current_student() is null or id = app.current_student());
create policy students_batch_r on public.students for select to batch_worker using (true);
create policy students_staff_r on public.students for select to authenticated using (app.can_see_student(id));
create policy students_coord_u on public.students for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
grant select on public.students to bot_runtime, batch_worker, authenticated;
grant update (tier, status, is_minor) on public.students to authenticated;

alter table secure.student_pii enable row level security;
alter table secure.student_pii force row level security;
alter table secure.telegram_identities enable row level security;
alter table secure.telegram_identities force row level security;
alter table secure.staff_codes enable row level security;
alter table secure.staff_codes force row level security;
alter table secure.auth_links enable row level security;
alter table secure.auth_links force row level security;
alter table secure.guardian_codes enable row level security;
alter table secure.guardian_codes force row level security;
-- secure.*: politika ve GRANT yok (scripts/no-policy-allowlist.json); yalnız SECURITY DEFINER fonksiyonlar

alter table public.staff enable row level security;
alter table public.staff force row level security;
create policy staff_self_r on public.staff for select to authenticated
  using (id = app.uid()
         or (app.staff_role() = 'instructor' and role in ('instructor', 'coordinator') and subject is not distinct from app.staff_subject()));
create policy staff_coord_all on public.staff for all to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy staff_bot_r on public.staff for select to bot_runtime using (true);
create policy staff_batch_r on public.staff for select to batch_worker using (true);
grant select, insert, update on public.staff to authenticated;
grant select (id, role, subject) on public.staff to bot_runtime;
grant select (id, role) on public.staff to batch_worker;

alter table public.staff_students enable row level security;
alter table public.staff_students force row level security;
create policy staff_students_staff_r on public.staff_students for select to authenticated
  using (staff_id = app.uid() or app.staff_role() = 'coordinator');
create policy staff_students_coord_w on public.staff_students for insert to authenticated with check (app.staff_role() = 'coordinator');
create policy staff_students_coord_d on public.staff_students for delete to authenticated using (app.staff_role() = 'coordinator');
create policy staff_students_bot_r on public.staff_students for select to bot_runtime using (true);
create policy staff_students_batch_r on public.staff_students for select to batch_worker using (true);
grant select on public.staff_students to bot_runtime, batch_worker, authenticated;
grant insert, delete on public.staff_students to authenticated;

alter table public.legal_texts enable row level security;
alter table public.legal_texts force row level security;
create policy legal_texts_read on public.legal_texts for select to bot_runtime, batch_worker, authenticated using (true);
grant select on public.legal_texts to bot_runtime, batch_worker, authenticated;

alter table public.consents enable row level security;
alter table public.consents force row level security;
create policy consents_bot_r on public.consents for select to bot_runtime using (student_id = app.current_student());
create policy consents_batch_r on public.consents for select to batch_worker using (true);
create policy consents_staff_r on public.consents for select to authenticated using (app.can_see_student(student_id));
create policy consents_coord_u on public.consents for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
grant select on public.consents to bot_runtime, batch_worker, authenticated;
grant update (status, revoked_at) on public.consents to authenticated;

alter table public.settings enable row level security;
alter table public.settings force row level security;
create policy settings_read on public.settings for select to bot_runtime, batch_worker, authenticated using (true);
create policy settings_coord_u on public.settings for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
grant select on public.settings to bot_runtime, batch_worker, authenticated;
grant update (value, description, updated_at) on public.settings to authenticated;

alter table public.retention_policies enable row level security;
alter table public.retention_policies force row level security;
create policy retention_policies_read on public.retention_policies for select to bot_runtime, batch_worker, authenticated using (true);
create policy retention_policies_coord_u on public.retention_policies for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
grant select on public.retention_policies to bot_runtime, batch_worker, authenticated;
grant update (days, enabled, user_facing_text) on public.retention_policies to authenticated;

-- 0004 müfredat --------------------------------------------------------------------------------------------

alter table public.curricula enable row level security;
alter table public.curricula force row level security;
create policy curricula_read on public.curricula for select to bot_runtime, batch_worker, authenticated using (true);
create policy curricula_coord_u on public.curricula for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy curricula_batch_w on public.curricula for insert to batch_worker with check (true);
create policy curricula_batch_u on public.curricula for update to batch_worker using (true) with check (true);
grant select on public.curricula to bot_runtime, batch_worker, authenticated;
grant update on public.curricula to authenticated;
grant insert, update on public.curricula to batch_worker;

alter table public.skills enable row level security;
alter table public.skills force row level security;
create policy skills_read on public.skills for select to bot_runtime, batch_worker, authenticated using (true);
create policy skills_coord_u on public.skills for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy skills_batch_w on public.skills for insert to batch_worker with check (true);
create policy skills_batch_u on public.skills for update to batch_worker using (true) with check (true);
grant select on public.skills to bot_runtime, batch_worker, authenticated;
grant update on public.skills to authenticated;
grant insert, update on public.skills to batch_worker;

alter table public.skill_prerequisites enable row level security;
alter table public.skill_prerequisites force row level security;
create policy skill_prerequisites_read on public.skill_prerequisites for select to bot_runtime, batch_worker, authenticated using (true);
create policy skill_prerequisites_coord_u on public.skill_prerequisites for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy skill_prerequisites_batch_w on public.skill_prerequisites for insert to batch_worker with check (true);
create policy skill_prerequisites_batch_u on public.skill_prerequisites for update to batch_worker using (true) with check (true);
grant select on public.skill_prerequisites to bot_runtime, batch_worker, authenticated;
grant update on public.skill_prerequisites to authenticated;
grant insert, update on public.skill_prerequisites to batch_worker;

alter table public.misconception_tags enable row level security;
alter table public.misconception_tags force row level security;
create policy misconception_tags_read on public.misconception_tags for select to bot_runtime, batch_worker, authenticated using (true);
create policy misconception_tags_coord_u on public.misconception_tags for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy misconception_tags_batch_w on public.misconception_tags for insert to batch_worker with check (true);
create policy misconception_tags_batch_u on public.misconception_tags for update to batch_worker using (true) with check (true);
grant select on public.misconception_tags to bot_runtime, batch_worker, authenticated;
grant update on public.misconception_tags to authenticated;
grant insert, update on public.misconception_tags to batch_worker;

alter table public.enrollments enable row level security;
alter table public.enrollments force row level security;
create policy enrollments_bot_r on public.enrollments for select to bot_runtime using (student_id = app.current_student());
create policy enrollments_batch_r on public.enrollments for select to batch_worker using (true);
create policy enrollments_staff_r on public.enrollments for select to authenticated using (app.can_see_student(student_id));
create policy enrollments_coord_w on public.enrollments for insert to authenticated with check (app.staff_role() = 'coordinator');
create policy enrollments_coord_u on public.enrollments for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
grant select on public.enrollments to bot_runtime, batch_worker, authenticated;
grant insert, update on public.enrollments to authenticated;

-- 0005 Gözlük --------------------------------------------------------------------------------------------

alter table public.observations enable row level security;
alter table public.observations force row level security;
create policy observations_bot_r on public.observations for select to bot_runtime
  using (app.enrollment_student(enrollment_id) = app.current_student());
create policy observations_batch_r on public.observations for select to batch_worker using (true);
create policy observations_staff_r on public.observations for select to authenticated
  using (app.can_see_student(app.enrollment_student(enrollment_id)));
grant select on public.observations to bot_runtime, batch_worker, authenticated;   -- yazım yalnız SECURITY DEFINER RPC'ler

alter table public.mastery enable row level security;
alter table public.mastery force row level security;
create policy mastery_student_r on public.mastery for select to bot_runtime
  using (app.enrollment_student(enrollment_id) = app.current_student());
create policy mastery_batch_r on public.mastery for select to batch_worker using (true);
create policy mastery_staff_r on public.mastery for select to authenticated using (app.can_see_student(app.enrollment_student(enrollment_id)));
grant select on public.mastery to bot_runtime, batch_worker, authenticated;   -- insert/update yok: apply_observation SECURITY DEFINER yazar

alter table public.mastery_history enable row level security;
alter table public.mastery_history force row level security;
create policy mastery_history_student_r on public.mastery_history for select to bot_runtime
  using (app.enrollment_student(enrollment_id) = app.current_student());
create policy mastery_history_batch_r on public.mastery_history for select to batch_worker using (true);
create policy mastery_history_staff_r on public.mastery_history for select to authenticated
  using (app.can_see_student(app.enrollment_student(enrollment_id)));
grant select on public.mastery_history to bot_runtime, batch_worker, authenticated;

alter table public.misconceptions enable row level security;
alter table public.misconceptions force row level security;
create policy misconceptions_bot_r on public.misconceptions for select to bot_runtime
  using (app.enrollment_student(enrollment_id) = app.current_student() and status in ('open', 'resolved'));
create policy misconceptions_batch_r on public.misconceptions for select to batch_worker using (true);
create policy misconceptions_staff_r on public.misconceptions for select to authenticated
  using (app.can_see_student(app.enrollment_student(enrollment_id)));
create policy misconceptions_staff_u on public.misconceptions for update to authenticated
  using (app.can_edit_student(app.enrollment_student(enrollment_id))) with check (app.can_edit_student(app.enrollment_student(enrollment_id)));
grant select on public.misconceptions to bot_runtime, batch_worker, authenticated;
grant update (status, resolved_at, resolved_by, resolution_observation_id, rejected_by, reject_note) on public.misconceptions to authenticated;

alter table public.misconception_evidence enable row level security;
alter table public.misconception_evidence force row level security;
-- kanıt bağı, yanılgı satırı görülebiliyorsa görülür (misconceptions politikası alt sorguda uygulanır)
create policy misconception_evidence_read on public.misconception_evidence for select to bot_runtime, batch_worker, authenticated
  using (exists (select 1 from public.misconceptions as mc where mc.id = misconception_id));
grant select on public.misconception_evidence to bot_runtime, batch_worker, authenticated;

alter table public.instructor_notes enable row level security;
alter table public.instructor_notes force row level security;
create policy instructor_notes_staff_r on public.instructor_notes for select to authenticated
  using (app.can_see_student(app.enrollment_student(enrollment_id)));
create policy instructor_notes_staff_w on public.instructor_notes for insert to authenticated
  with check (author_id = app.uid() and app.can_edit_student(app.enrollment_student(enrollment_id)));
create policy instructor_notes_coord_u on public.instructor_notes for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy instructor_notes_bot_r on public.instructor_notes for select to bot_runtime
  using (approved_fact and (app.current_student() is null or app.enrollment_student(enrollment_id) = app.current_student()));
create policy instructor_notes_batch_r on public.instructor_notes for select to batch_worker using (true);
grant select on public.instructor_notes to bot_runtime, batch_worker, authenticated;
grant insert, update on public.instructor_notes to authenticated;

alter table public.preferences enable row level security;
alter table public.preferences force row level security;
create policy preferences_bot_r on public.preferences for select to bot_runtime using (student_id = app.current_student());
create policy preferences_bot_u on public.preferences for update to bot_runtime
  using (student_id = app.current_student()) with check (student_id = app.current_student());
create policy preferences_batch_r on public.preferences for select to batch_worker using (true);
create policy preferences_batch_u on public.preferences for update to batch_worker using (true) with check (true);
create policy preferences_staff_r on public.preferences for select to authenticated using (app.can_see_student(student_id));
create policy preferences_coord_u on public.preferences for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
grant select on public.preferences to bot_runtime, batch_worker, authenticated;
grant update (active_hours, modality, default_mode, explanation_notes, proactive_enabled, voice_reply, updated_at)
  on public.preferences to bot_runtime, batch_worker, authenticated;

-- 0006 Tablet ---------------------------------------------------------------------------------------------

alter table public.figures enable row level security;
alter table public.figures force row level security;
create policy figures_bot_r on public.figures for select to bot_runtime using (review_status = 'verified');
create policy figures_staff_r on public.figures for select to authenticated using (app.staff_role() is not null);
create policy figures_staff_u on public.figures for update to authenticated
  using (app.staff_role() in ('instructor', 'coordinator')) with check (app.staff_role() in ('instructor', 'coordinator'));
create policy figures_batch_r on public.figures for select to batch_worker using (true);
create policy figures_batch_w on public.figures for insert to batch_worker with check (review_status = 'pending');
-- doğrulanmış (öğrenciye giden) şekil batch_worker tarafından değiştirilemez; yeniden çizim yeni şekil satırıdır
create policy figures_batch_u on public.figures for update to batch_worker
  using (review_status <> 'verified') with check (review_status <> 'verified');
grant select on public.figures to bot_runtime, batch_worker, authenticated;
grant update (review_status, reviewed_by, reviewed_at) on public.figures to authenticated;
grant insert (id, tool, code, code_hash, alt_text, png_path, svg_path, width_px, height_px, bytes, render_status, vision_status,
              vision_report, attempts, render_log)
  on public.figures to batch_worker;
grant update (png_path, svg_path, width_px, height_px, bytes, render_status, vision_status, vision_report, attempts, render_log)
  on public.figures to batch_worker;

alter table public.questions enable row level security;
alter table public.questions force row level security;
-- bot ve öğrenci tabloyu doğrudan okumaz: yalnız questions_public (etiketsiz şıklar)
create policy questions_staff_r on public.questions for select to authenticated using (app.staff_role() is not null);
create policy questions_staff_u on public.questions for update to authenticated
  using (app.staff_role() in ('instructor', 'coordinator')) with check (app.staff_role() in ('instructor', 'coordinator'));
create policy questions_batch_r on public.questions for select to batch_worker using (true);
create policy questions_batch_w on public.questions for insert to batch_worker with check (status in ('draft', 'pending_review'));
-- onaylı (ve emekli) soru batch_worker tarafından değiştirilemez (ilke 4/7); ikinci kemer app.questions_protect_content
create policy questions_batch_u on public.questions for update to batch_worker
  using (status in ('draft', 'pending_review', 'rejected')) with check (status in ('draft', 'pending_review', 'rejected'));
grant select on public.questions to batch_worker, authenticated;
grant update (status, review_note, reviewed_by, reviewed_at) on public.questions to authenticated;   -- tetikleyici: yalnız approve_question
grant insert (id, curriculum_id, skill_ids, kind, stem, stem_values, figure_id, options, difficulty, source, template_id,
              template_params, content_hash, verification, status, model, cost_usd, prompt_version)
  on public.questions to batch_worker;
grant update (skill_ids, kind, stem, stem_values, figure_id, options, difficulty, template_id, template_params, content_hash,
              verification, model, cost_usd, prompt_version)
  on public.questions to batch_worker;

alter table secure.answer_keys enable row level security;
alter table secure.answer_keys force row level security;

alter table public.question_templates enable row level security;
alter table public.question_templates force row level security;
create policy question_templates_read on public.question_templates for select to bot_runtime, batch_worker, authenticated using (true);
create policy question_templates_coord_u on public.question_templates for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy question_templates_batch_w on public.question_templates for insert to batch_worker with check (true);
create policy question_templates_batch_u on public.question_templates for update to batch_worker using (true) with check (true);
grant select on public.question_templates to bot_runtime, batch_worker, authenticated;
grant update on public.question_templates to authenticated;
grant insert, update on public.question_templates to batch_worker;

alter table public.attempts enable row level security;
alter table public.attempts force row level security;
create policy attempts_bot_r on public.attempts for select to bot_runtime using (app.enrollment_student(enrollment_id) = app.current_student());
create policy attempts_batch_r on public.attempts for select to batch_worker using (true);
create policy attempts_staff_r on public.attempts for select to authenticated using (app.can_see_student(app.enrollment_student(enrollment_id)));
grant select on public.attempts to bot_runtime, batch_worker, authenticated;   -- yazım yalnız grade_attempt

alter table public.diagnostic_tests enable row level security;
alter table public.diagnostic_tests force row level security;
create policy diagnostic_tests_read on public.diagnostic_tests for select to bot_runtime, batch_worker, authenticated using (true);
create policy diagnostic_tests_coord_w on public.diagnostic_tests for insert to authenticated with check (app.staff_role() = 'coordinator');
grant select (id, curriculum_id, version) on public.diagnostic_tests to bot_runtime;   -- madde sırası yalnız next_diagnostic_item ile
grant select on public.diagnostic_tests to batch_worker, authenticated;
grant insert on public.diagnostic_tests to authenticated;

alter table public.diagnostic_sessions enable row level security;
alter table public.diagnostic_sessions force row level security;
create policy diagnostic_sessions_bot_r on public.diagnostic_sessions for select to bot_runtime
  using (app.enrollment_student(enrollment_id) = app.current_student());
create policy diagnostic_sessions_bot_u on public.diagnostic_sessions for update to bot_runtime
  using (app.enrollment_student(enrollment_id) = app.current_student()) with check (app.enrollment_student(enrollment_id) = app.current_student());
create policy diagnostic_sessions_batch_r on public.diagnostic_sessions for select to batch_worker using (true);
create policy diagnostic_sessions_staff_r on public.diagnostic_sessions for select to authenticated
  using (app.can_see_student(app.enrollment_student(enrollment_id)));
grant select on public.diagnostic_sessions to bot_runtime, batch_worker, authenticated;
grant update (chat_id, current_index, status, finished_at, result) on public.diagnostic_sessions to bot_runtime;

alter table public.content_pool enable row level security;
alter table public.content_pool force row level security;
create policy content_pool_bot_r on public.content_pool for select to bot_runtime using (status = 'approved');
create policy content_pool_bot_w on public.content_pool for insert to bot_runtime with check (status = 'pending_review');
create policy content_pool_staff_r on public.content_pool for select to authenticated using (app.staff_role() is not null);
create policy content_pool_staff_u on public.content_pool for update to authenticated
  using (app.staff_role() in ('instructor', 'coordinator')) with check (app.staff_role() in ('instructor', 'coordinator'));
create policy content_pool_coord_w on public.content_pool for insert to authenticated with check (app.staff_role() = 'coordinator');
create policy content_pool_batch_r on public.content_pool for select to batch_worker using (true);
create policy content_pool_batch_w on public.content_pool for insert to batch_worker with check (status = 'pending_review');
grant select on public.content_pool to bot_runtime, batch_worker, authenticated;
grant insert (kind, curriculum_id, skill_id, misconception_tag, mode, body, status, model, cost_usd) on public.content_pool to bot_runtime;
grant insert (kind, curriculum_id, skill_id, misconception_tag, mode, body, status, model, cost_usd) on public.content_pool to batch_worker;
grant insert on public.content_pool to authenticated;
grant update (status, approved_by, approved_at) on public.content_pool to authenticated;   -- body yok: onaylı metin panelden düzenlenmez (§3.8 E)

alter table public.generation_requests enable row level security;
alter table public.generation_requests force row level security;
create policy generation_requests_bot_r on public.generation_requests for select to bot_runtime using (kind = 'pool_miss');
create policy generation_requests_bot_w on public.generation_requests for insert to bot_runtime with check (kind = 'pool_miss');
create policy generation_requests_staff_r on public.generation_requests for select to authenticated using (app.staff_role() is not null);
create policy generation_requests_batch_r on public.generation_requests for select to batch_worker using (true);
create policy generation_requests_batch_w on public.generation_requests for insert to batch_worker with check (kind = 'exam_variant');
create policy generation_requests_batch_u on public.generation_requests for update to batch_worker using (true) with check (true);
grant select on public.generation_requests to bot_runtime, batch_worker, authenticated;
grant insert (kind, curriculum_id, skill_id, difficulty_band, question_kind, requested_by, needs_generation)
  on public.generation_requests to bot_runtime;
grant insert (kind, curriculum_id, skill_id, difficulty_band, topic, question_kind, points, plan_id, requested_by_staff, needs_generation)
  on public.generation_requests to batch_worker;
grant update (served_question_id, served_at) on public.generation_requests to batch_worker;

-- 0007 Kulaklık -----------------------------------------------------------------------------------------

-- tg_chats: enable/force RLS 0007_kulaklik.sql'de, tablo tanımının hemen ardında (export-sql.py tg_chats.retention_days
-- varsayılanını migration'lardan okur ve sonraki dosyalardaki "alter table tg_chats" ifadelerini varsayılanı sıfırlamış sayar).
create policy tg_chats_bot on public.tg_chats for all to bot_runtime using (true) with check (true);
create policy tg_chats_batch_r on public.tg_chats for select to batch_worker using (true);
create policy tg_chats_staff_r on public.tg_chats for select to authenticated
  using (app.staff_role() in ('coordinator', 'observer') or app.staff_in_chat(chat_id));
create policy tg_chats_coord_w on public.tg_chats for insert to authenticated with check (app.staff_role() = 'coordinator');
create policy tg_chats_coord_u on public.tg_chats for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
grant select, insert, update on public.tg_chats to bot_runtime, authenticated;
grant select on public.tg_chats to batch_worker;

alter table public.chat_roles enable row level security;
alter table public.chat_roles force row level security;
create policy chat_roles_bot on public.chat_roles for all to bot_runtime using (true) with check (true);
create policy chat_roles_batch_r on public.chat_roles for select to batch_worker using (true);
create policy chat_roles_staff_r on public.chat_roles for select to authenticated
  using (staff_id = app.uid() or app.staff_role() in ('coordinator', 'observer') or app.staff_in_chat(chat_id));
create policy chat_roles_coord_w on public.chat_roles for insert to authenticated with check (app.staff_role() = 'coordinator');
create policy chat_roles_coord_u on public.chat_roles for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
grant select, insert, update on public.chat_roles to bot_runtime, authenticated;
grant select on public.chat_roles to batch_worker;

alter table public.tg_updates enable row level security;
alter table public.tg_updates force row level security;
-- tg_updates: politika ve GRANT yok; yalnız dedup_update() SECURITY DEFINER yazar (no-policy-allowlist)

alter table public.messages enable row level security;
alter table public.messages force row level security;
create policy msg_bot_w on public.messages for insert to bot_runtime with check (true);
create policy msg_bot_r on public.messages for select to bot_runtime
  using (student_id = app.current_student()
         or (sender_role in ('bot', 'instructor', 'coordinator')
             and chat_id in (select cr.chat_id from public.chat_roles as cr where cr.student_id = app.current_student())));
create policy msg_bot_u on public.messages for update to bot_runtime using (true) with check (true);
create policy msg_batch_r on public.messages for select to batch_worker using (true);
create policy msg_batch_u on public.messages for update to batch_worker using (true) with check (true);
create policy msg_staff_r on public.messages for select to authenticated
  using ((student_id is null and app.staff_in_chat(chat_id)) or app.can_see_student(student_id));
-- is_question: Worker giriş sezgiseli (§5.2); gece kulaklik facts yalnız düzeltir
grant insert (chat_id, telegram_message_id, sender_role, student_id, staff_id, reply_to_telegram_message_id, text_raw, text_llm,
              attachments, mentions_bot, is_question, sent_at)
  on public.messages to bot_runtime;
grant select (id, chat_id, telegram_message_id, sender_role, student_id, staff_id, reply_to_telegram_message_id, text_llm,
              attachments, mentions_bot, is_question, answered_at, sent_at, created_at)
  on public.messages to bot_runtime, batch_worker;
grant update (is_question, answered_at) on public.messages to bot_runtime, batch_worker;
-- authenticated: text_raw SÜTUNU YOK (sütun yetkisi staff.role'e göre ayrışamaz; ham metin yalnız v_messages_staff)
grant select (id, chat_id, telegram_message_id, sender_role, student_id, staff_id, reply_to_telegram_message_id, text_llm,
              attachments, mentions_bot, is_question, answered_at, sent_at, expires_at, created_at)
  on public.messages to authenticated;

alter table public.sessions enable row level security;
alter table public.sessions force row level security;
create policy sessions_bot on public.sessions for all to bot_runtime
  using (student_id = app.current_student()) with check (student_id = app.current_student());
create policy sessions_coord_r on public.sessions for select to authenticated using (app.staff_role() = 'coordinator');
grant select, insert, update on public.sessions to bot_runtime;
grant select on public.sessions to authenticated;

alter table public.memory_facts enable row level security;
alter table public.memory_facts force row level security;
create policy memory_facts_bot_r on public.memory_facts for select to bot_runtime
  using (student_id = app.current_student() and (approved or not requires_approval));
create policy memory_facts_staff_r on public.memory_facts for select to authenticated using (app.can_see_student(student_id));
create policy memory_facts_staff_u on public.memory_facts for update to authenticated
  using (app.can_edit_student(student_id)) with check (app.can_edit_student(student_id));
create policy memory_facts_coord_d on public.memory_facts for delete to authenticated using (app.staff_role() = 'coordinator');
create policy memory_facts_batch_r on public.memory_facts for select to batch_worker using (true);
create policy memory_facts_batch_w on public.memory_facts for insert to batch_worker with check (true);
create policy memory_facts_batch_u on public.memory_facts for update to batch_worker using (true) with check (true);
grant select on public.memory_facts to bot_runtime, batch_worker, authenticated;
grant update (approved, approved_by, status) on public.memory_facts to authenticated;
grant delete on public.memory_facts to authenticated;
grant insert, update on public.memory_facts to batch_worker;

alter table public.weekly_summaries enable row level security;
alter table public.weekly_summaries force row level security;
create policy weekly_summaries_bot_r on public.weekly_summaries for select to bot_runtime using (student_id = app.current_student());
create policy weekly_summaries_staff_r on public.weekly_summaries for select to authenticated using (app.can_see_student(student_id));
create policy weekly_summaries_batch_r on public.weekly_summaries for select to batch_worker using (true);
create policy weekly_summaries_batch_w on public.weekly_summaries for insert to batch_worker with check (true);
create policy weekly_summaries_batch_u on public.weekly_summaries for update to batch_worker using (true) with check (true);
grant select on public.weekly_summaries to bot_runtime, batch_worker, authenticated;
grant insert, update on public.weekly_summaries to batch_worker;

alter table public.bot_responses enable row level security;
alter table public.bot_responses force row level security;
create policy br_bot_r on public.bot_responses for select to bot_runtime using (student_id = app.current_student());
create policy br_staff_r on public.bot_responses for select to authenticated
  using ((student_id is null and app.staff_role() is not null) or app.can_see_student(student_id));
create policy br_staff_flag on public.bot_responses for update to authenticated using (app.can_edit_student(student_id)) with check (true);
create policy br_batch_r on public.bot_responses for select to batch_worker using (true);
create policy br_batch_u on public.bot_responses for update to batch_worker using (true) with check (true);
grant select on public.bot_responses to bot_runtime, batch_worker, authenticated;   -- insert yalnız log_bot_response
grant update (flagged, flagged_by, flag_reason, flagged_at) on public.bot_responses to authenticated;
grant update (review_week) on public.bot_responses to batch_worker;

alter table public.llm_calls enable row level security;
alter table public.llm_calls force row level security;
create policy llm_calls_staff_r on public.llm_calls for select to authenticated using (app.staff_role() in ('coordinator', 'observer'));
create policy llm_calls_batch_r on public.llm_calls for select to batch_worker using (true);
create policy llm_calls_batch_w on public.llm_calls for insert to batch_worker with check (true);
grant select on public.llm_calls to batch_worker, authenticated;
grant insert (purpose, provider, model, tokens_in, tokens_out, audio_sec, images, batch, status, error_code, latency_ms, cost_usd,
              ref_table, ref_id, student_ref)
  on public.llm_calls to batch_worker;   -- Worker llm_calls'ı yalnız log_bot_response içinden yazar

alter table public.spend_ledger enable row level security;
alter table public.spend_ledger force row level security;
create policy spend_ledger_staff_r on public.spend_ledger for select to authenticated using (app.staff_role() in ('coordinator', 'observer'));
create policy spend_ledger_bot_r on public.spend_ledger for select to bot_runtime
  using (day >= date_trunc('month', (now() at time zone 'Europe/Istanbul'))::date);
create policy spend_ledger_batch_r on public.spend_ledger for select to batch_worker using (true);
create policy spend_ledger_batch_w on public.spend_ledger for insert to batch_worker with check (true);
grant select on public.spend_ledger to bot_runtime, batch_worker, authenticated;
grant insert on public.spend_ledger to batch_worker;

alter table public.runtime_flags enable row level security;
alter table public.runtime_flags force row level security;
create policy runtime_flags_read on public.runtime_flags for select to bot_runtime, batch_worker, authenticated using (true);
grant select on public.runtime_flags to bot_runtime, batch_worker, authenticated;   -- yazım yalnız set_runtime_flag

alter table public.provider_health enable row level security;
alter table public.provider_health force row level security;
create policy provider_health_staff_r on public.provider_health for select to authenticated using (app.staff_role() in ('coordinator', 'observer'));
create policy provider_health_rw on public.provider_health for all to bot_runtime, batch_worker using (true) with check (true);
grant select on public.provider_health to authenticated;
grant select, insert, update on public.provider_health to bot_runtime, batch_worker;   -- insert: Worker upsert (on conflict merge)

alter table public.quota_limits enable row level security;
alter table public.quota_limits force row level security;
create policy quota_limits_read on public.quota_limits for select to bot_runtime, batch_worker, authenticated using (true);
create policy quota_limits_coord_u on public.quota_limits for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
grant select on public.quota_limits to bot_runtime, batch_worker, authenticated;
grant update (daily_limit, warn_at_remaining) on public.quota_limits to authenticated;

alter table public.quota_usage enable row level security;
alter table public.quota_usage force row level security;
create policy quota_usage_bot_r on public.quota_usage for select to bot_runtime using (student_id = app.current_student());
create policy quota_usage_staff_r on public.quota_usage for select to authenticated
  using ((student_id is null and app.staff_role() is not null) or app.can_see_student(student_id));
create policy quota_usage_batch_r on public.quota_usage for select to batch_worker using (true);
grant select on public.quota_usage to bot_runtime, batch_worker, authenticated;   -- yazım consume_quota / consume_staff_quota

alter table public.escalations enable row level security;
alter table public.escalations force row level security;
create policy escalations_bot_w on public.escalations for insert to bot_runtime
  with check (student_id is null or student_id = app.current_student());
create policy escalations_bot_r on public.escalations for select to bot_runtime
  using (app.current_student() is null or student_id = app.current_student());
create policy escalations_staff_r on public.escalations for select to authenticated
  using (app.staff_role() = 'coordinator' or target_staff_id = app.uid() or (student_id is not null and app.can_see_student(student_id)));
create policy escalations_staff_u on public.escalations for update to authenticated
  using (app.staff_role() = 'coordinator' or target_staff_id = app.uid() or app.can_edit_student(student_id))
  with check (app.staff_role() in ('coordinator', 'instructor'));
create policy escalations_batch_r on public.escalations for select to batch_worker using (true);
create policy escalations_batch_u on public.escalations for update to batch_worker using (true) with check (true);
grant insert (chat_id, message_id, student_id, reason, question_text, target_staff_id) on public.escalations to bot_runtime;
grant select on public.escalations to bot_runtime, batch_worker, authenticated;
grant update (status, answered_at, answered_by) on public.escalations to batch_worker, authenticated;

alter table public.instructor_alerts enable row level security;
alter table public.instructor_alerts force row level security;
create policy instructor_alerts_staff_r on public.instructor_alerts for select to authenticated
  using (app.staff_role() = 'coordinator' or staff_id = app.uid() or (student_id is not null and app.can_see_student(student_id)));
create policy instructor_alerts_coord_w on public.instructor_alerts for insert to authenticated with check (app.staff_role() = 'coordinator');
create policy instructor_alerts_coord_snooze on public.instructor_alerts for update to authenticated
  using (app.staff_role() = 'coordinator') with check (status = 'snoozed');
-- Worker ops alarmları (grup yönetici değil / gizlilik modu / pratik stoku): açar ve koşul düzelince done yapar
create policy instructor_alerts_bot_r on public.instructor_alerts for select to bot_runtime using (kind = 'ops');
create policy instructor_alerts_bot_w on public.instructor_alerts for insert to bot_runtime with check (kind = 'ops');
create policy instructor_alerts_bot_u on public.instructor_alerts for update to bot_runtime using (kind = 'ops') with check (status = 'done');
create policy instructor_alerts_batch on public.instructor_alerts for all to batch_worker using (true) with check (true);
grant select on public.instructor_alerts to authenticated, batch_worker;
grant select (id, kind, severity, student_id, staff_id, detail, ref, status, created_at) on public.instructor_alerts to bot_runtime;
grant insert on public.instructor_alerts to authenticated;
grant update (status) on public.instructor_alerts to authenticated;
grant insert (kind, severity, student_id, staff_id, detail, since, ref) on public.instructor_alerts to bot_runtime, batch_worker;
grant update (status, resolved_at) on public.instructor_alerts to bot_runtime;
grant update (severity, detail, status, resolved_at, resolved_by) on public.instructor_alerts to batch_worker;

alter table public.proactive_messages enable row level security;
alter table public.proactive_messages force row level security;
create policy proactive_messages_bot on public.proactive_messages for all to bot_runtime
  using (app.current_student() is null or student_id = app.current_student())
  with check (app.current_student() is null or student_id = app.current_student());
create policy proactive_messages_staff_r on public.proactive_messages for select to authenticated using (app.can_see_student(student_id));
create policy proactive_messages_coord_u on public.proactive_messages for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy proactive_messages_batch_w on public.proactive_messages for insert to batch_worker with check (true);
grant select on public.proactive_messages to bot_runtime, authenticated;
grant insert (student_id, chat_id, recipient, template_id, params, scheduled_for) on public.proactive_messages to bot_runtime, batch_worker;
grant update (status, sent_at, telegram_message_id) on public.proactive_messages to bot_runtime;
grant update (status, scheduled_for) on public.proactive_messages to authenticated;

alter table public.pilot_metrics enable row level security;
alter table public.pilot_metrics force row level security;
create policy pilot_metrics_staff_r on public.pilot_metrics for select to authenticated using (app.staff_role() is not null);
create policy pilot_metrics_batch_w on public.pilot_metrics for insert to batch_worker with check (true);
create policy pilot_metrics_batch_u on public.pilot_metrics for update to batch_worker using (true) with check (true);
grant select on public.pilot_metrics to authenticated;
grant insert, update on public.pilot_metrics to batch_worker;

-- 0008 Ders ----------------------------------------------------------------------------------------------

alter table public.lessons enable row level security;
alter table public.lessons force row level security;
create policy lessons_bot_r on public.lessons for select to bot_runtime using (app.enrollment_student(enrollment_id) = app.current_student());
create policy lessons_staff_r on public.lessons for select to authenticated using (app.can_see_student(app.enrollment_student(enrollment_id)));
create policy lessons_staff_w on public.lessons for insert to authenticated with check (app.can_edit_student(app.enrollment_student(enrollment_id)));
create policy lessons_staff_u on public.lessons for update to authenticated
  using (app.can_edit_student(app.enrollment_student(enrollment_id))) with check (app.can_edit_student(app.enrollment_student(enrollment_id)));
create policy lessons_batch_r on public.lessons for select to batch_worker using (true);
create policy lessons_batch_u on public.lessons for update to batch_worker using (true) with check (true);
grant select (id, enrollment_id, staff_id, held_at, duration_min, video_deleted_at, transcript_path, frames_count, status, created_at)
  on public.lessons to bot_runtime;   -- video_ref hariç
grant select, insert, update on public.lessons to authenticated;
grant select on public.lessons to batch_worker;
grant update (status, transcript_path, frames_count, video_deleted_at) on public.lessons to batch_worker;

alter table public.lesson_analyses enable row level security;
alter table public.lesson_analyses force row level security;
create policy lesson_analyses_bot_r on public.lesson_analyses for select to bot_runtime
  using (status in ('approved', 'corrected')
         and exists (select 1 from public.lessons as l where l.id = lesson_id and app.enrollment_student(l.enrollment_id) = app.current_student()));
create policy lesson_analyses_staff_r on public.lesson_analyses for select to authenticated
  using (exists (select 1 from public.lessons as l where l.id = lesson_id));
create policy lesson_analyses_staff_u on public.lesson_analyses for update to authenticated
  using (exists (select 1 from public.lessons as l where l.id = lesson_id and app.can_edit_student(app.enrollment_student(l.enrollment_id))))
  with check (true);
create policy lesson_analyses_batch_r on public.lesson_analyses for select to batch_worker using (true);
create policy lesson_analyses_batch_w on public.lesson_analyses for insert to batch_worker with check (status = 'draft');
grant select on public.lesson_analyses to bot_runtime, batch_worker, authenticated;
grant update (status, approved_by, approved_at) on public.lesson_analyses to authenticated;   -- tetikleyici: yalnız approve_lesson_analysis
grant insert (lesson_id, version, seed_profile, analysis, model, cost_usd) on public.lesson_analyses to batch_worker;

alter table public.lesson_claims enable row level security;
alter table public.lesson_claims force row level security;
create policy lesson_claims_staff_r on public.lesson_claims for select to authenticated
  using (exists (select 1 from public.lesson_analyses as la where la.id = analysis_id));
create policy lesson_claims_staff_u on public.lesson_claims for update to authenticated
  using (exists (select 1 from public.lesson_analyses as la join public.lessons as l on l.id = la.lesson_id
                  where la.id = analysis_id and app.can_edit_student(app.enrollment_student(l.enrollment_id))))
  with check (true);
create policy lesson_claims_batch_r on public.lesson_claims for select to batch_worker using (true);
create policy lesson_claims_batch_w on public.lesson_claims for insert to batch_worker with check (status = 'pending');
grant select on public.lesson_claims to batch_worker, authenticated;
grant update (status, edited_value, decided_by, decided_at) on public.lesson_claims to authenticated;
grant insert (analysis_id, kind, skill_id, misconception_tag, misconception_id, value, quote, speaker, t_start_sec, t_end_sec)
  on public.lesson_claims to batch_worker;

-- 0009 Kalem — öğrenci ve bot ASLA -----------------------------------------------------------------------

alter table public.courses enable row level security;
alter table public.courses force row level security;
create policy courses_staff_r on public.courses for select to authenticated using (app.staff_role() is not null);
create policy courses_staff_w on public.courses for insert to authenticated with check (app.staff_role() in ('instructor', 'coordinator'));
create policy courses_coord_u on public.courses for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy courses_coord_d on public.courses for delete to authenticated using (app.staff_role() = 'coordinator');
create policy courses_batch on public.courses for all to batch_worker using (true) with check (true);
grant select, insert, update, delete on public.courses to authenticated;
grant select, insert, update on public.courses to batch_worker;

alter table public.syllabus_topics enable row level security;
alter table public.syllabus_topics force row level security;
create policy syllabus_topics_staff_r on public.syllabus_topics for select to authenticated using (app.staff_role() is not null);
create policy syllabus_topics_staff_w on public.syllabus_topics for insert to authenticated with check (app.staff_role() in ('instructor', 'coordinator'));
create policy syllabus_topics_coord_u on public.syllabus_topics for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy syllabus_topics_coord_d on public.syllabus_topics for delete to authenticated using (app.staff_role() = 'coordinator');
create policy syllabus_topics_batch on public.syllabus_topics for all to batch_worker using (true) with check (true);
grant select, insert, update, delete on public.syllabus_topics to authenticated;
grant select, insert, update on public.syllabus_topics to batch_worker;

alter table public.exam_sources enable row level security;
alter table public.exam_sources force row level security;
create policy exam_sources_staff_r on public.exam_sources for select to authenticated using (app.staff_role() is not null);
create policy exam_sources_staff_w on public.exam_sources for insert to authenticated with check (app.staff_role() in ('instructor', 'coordinator'));
create policy exam_sources_coord_u on public.exam_sources for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy exam_sources_coord_d on public.exam_sources for delete to authenticated using (app.staff_role() = 'coordinator');
create policy exam_sources_batch on public.exam_sources for all to batch_worker using (true) with check (true);
grant select, insert, update, delete on public.exam_sources to authenticated;
grant select, insert, update on public.exam_sources to batch_worker;

alter table public.exam_clusters enable row level security;
alter table public.exam_clusters force row level security;
create policy exam_clusters_staff_r on public.exam_clusters for select to authenticated using (app.staff_role() is not null);
create policy exam_clusters_staff_w on public.exam_clusters for insert to authenticated with check (app.staff_role() in ('instructor', 'coordinator'));
create policy exam_clusters_coord_u on public.exam_clusters for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy exam_clusters_coord_d on public.exam_clusters for delete to authenticated using (app.staff_role() = 'coordinator');
create policy exam_clusters_batch on public.exam_clusters for all to batch_worker using (true) with check (true);
grant select, insert, update, delete on public.exam_clusters to authenticated;
grant select, insert, update on public.exam_clusters to batch_worker;

alter table public.exam_items enable row level security;
alter table public.exam_items force row level security;
create policy exam_items_staff on public.exam_items for select to authenticated
  using (app.staff_role() in ('instructor', 'coordinator', 'observer'));
create policy exam_items_staff_w on public.exam_items for insert to authenticated with check (app.staff_role() in ('instructor', 'coordinator'));
create policy exam_items_coord_u on public.exam_items for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy exam_items_coord_d on public.exam_items for delete to authenticated using (app.staff_role() = 'coordinator');
create policy exam_items_batch on public.exam_items for all to batch_worker using (true) with check (true);
grant select (id, source_id, item_no, topic, kind, points, skill_id, cluster_id) on public.exam_items to authenticated;   -- ocr_text YOK
grant insert (source_id, item_no, topic, kind, points, curriculum_id, skill_id) on public.exam_items to authenticated;
grant update (topic, kind, points, skill_id, cluster_id) on public.exam_items to authenticated;
grant delete on public.exam_items to authenticated;
grant select, insert, update on public.exam_items to batch_worker;
-- öğrenci ve bot_runtime için politika ve grant yok ⇒ sıfır satır

alter table public.exam_priority_plans enable row level security;
alter table public.exam_priority_plans force row level security;
create policy exam_priority_plans_bot_r on public.exam_priority_plans for select to bot_runtime
  using (status = 'approved' and app.plan_visible_to_student(course_id));
create policy exam_priority_plans_staff_r on public.exam_priority_plans for select to authenticated using (app.staff_role() is not null);
create policy exam_priority_plans_batch_r on public.exam_priority_plans for select to batch_worker using (true);
create policy exam_priority_plans_batch_w on public.exam_priority_plans for insert to batch_worker with check (status = 'pending_review');
create policy exam_priority_plans_batch_u on public.exam_priority_plans for update to batch_worker using (true) with check (true);
grant select on public.exam_priority_plans to bot_runtime, batch_worker, authenticated;   -- onay yalnız approve_priority_plan
grant insert (course_id, period, plan, evidence_count) on public.exam_priority_plans to batch_worker;
grant update (period, plan, evidence_count) on public.exam_priority_plans to batch_worker;

-- 0010 Kitap ---------------------------------------------------------------------------------------------

alter table public.research_requests enable row level security;
alter table public.research_requests force row level security;
create policy research_requests_bot_r on public.research_requests for select to bot_runtime using (student_id = app.current_student());
create policy research_requests_staff_r on public.research_requests for select to authenticated
  using ((student_id is null and app.staff_role() is not null) or app.can_see_student(student_id));
create policy research_requests_coord_u on public.research_requests for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy research_requests_batch_r on public.research_requests for select to batch_worker using (true);
create policy research_requests_batch_u on public.research_requests for update to batch_worker using (true) with check (true);
grant select on public.research_requests to bot_runtime, batch_worker, authenticated;   -- ekleme yalnız enqueue_research
grant update (status) on public.research_requests to authenticated;
grant update (status, expanded_queries, cost_usd, finished_at) on public.research_requests to batch_worker;

alter table public.research_outputs enable row level security;
alter table public.research_outputs force row level security;
create policy research_outputs_bot_r on public.research_outputs for select to bot_runtime using (status = 'released');
create policy research_outputs_staff_r on public.research_outputs for select to authenticated using (app.staff_role() is not null);
create policy research_outputs_staff_u on public.research_outputs for update to authenticated
  using (app.staff_role() in ('instructor', 'coordinator')) with check (app.staff_role() in ('instructor', 'coordinator'));
create policy research_outputs_batch_r on public.research_outputs for select to batch_worker using (true);
create policy research_outputs_batch_w on public.research_outputs for insert to batch_worker with check (status = 'pending_review');
create policy research_outputs_batch_u on public.research_outputs for update to batch_worker using (true) with check (true);
grant select on public.research_outputs to bot_runtime, batch_worker, authenticated;
grant update (status) on public.research_outputs to authenticated;
grant insert (request_id, output, bibtex, apa, model) on public.research_outputs to batch_worker;
grant update (output, bibtex, apa, model) on public.research_outputs to batch_worker;

alter table public.citations enable row level security;
alter table public.citations force row level security;
create policy citations_bot_r on public.citations for select to bot_runtime
  using (status = 'kept' and exists (select 1 from public.research_outputs as o where o.id = output_id and o.status = 'released'));
create policy citations_staff_r on public.citations for select to authenticated using (app.staff_role() is not null);
create policy citations_staff_u on public.citations for update to authenticated
  using (app.staff_role() in ('instructor', 'coordinator')) with check (app.staff_role() in ('instructor', 'coordinator'));
create policy citations_batch_r on public.citations for select to batch_worker using (true);
create policy citations_batch_w on public.citations for insert to batch_worker with check (true);
create policy citations_batch_u on public.citations for update to batch_worker using (true) with check (true);
grant select (id, output_id, ordinal, doi, title, authors, venue, year, crossref_status, title_similarity, verified_at, oa_pdf_url,
              tldr, status)
  on public.citations to bot_runtime;   -- relevance sütunları görünmez
grant select on public.citations to batch_worker, authenticated;
grant update (relevance, relevance_by, relevance_at, status, removed_reason) on public.citations to authenticated;
grant insert (output_id, ordinal, doi, title, authors, venue, year, crossref_status, title_similarity, verified_at, oa_pdf_url, tldr,
              status, removed_reason)
  on public.citations to batch_worker;
grant update (doi, crossref_status, title_similarity, verified_at, oa_pdf_url, tldr, status, removed_reason) on public.citations to batch_worker;

alter table public.library_documents enable row level security;
alter table public.library_documents force row level security;
create policy library_documents_read on public.library_documents for select to bot_runtime, batch_worker, authenticated using (true);
create policy library_documents_staff_w on public.library_documents for insert to authenticated with check (app.staff_role() in ('instructor', 'coordinator'));
create policy library_documents_coord_u on public.library_documents for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy library_documents_coord_d on public.library_documents for delete to authenticated using (app.staff_role() = 'coordinator');
create policy library_documents_batch_w on public.library_documents for insert to batch_worker with check (true);
grant select on public.library_documents to bot_runtime, batch_worker, authenticated;
grant insert, update, delete on public.library_documents to authenticated;
grant insert on public.library_documents to batch_worker;

alter table public.library_chunks enable row level security;
alter table public.library_chunks force row level security;
create policy library_chunks_read on public.library_chunks for select to bot_runtime, batch_worker, authenticated using (true);
create policy library_chunks_staff_w on public.library_chunks for insert to authenticated with check (app.staff_role() in ('instructor', 'coordinator'));
create policy library_chunks_coord_u on public.library_chunks for update to authenticated
  using (app.staff_role() = 'coordinator') with check (app.staff_role() = 'coordinator');
create policy library_chunks_coord_d on public.library_chunks for delete to authenticated using (app.staff_role() = 'coordinator');
create policy library_chunks_batch_w on public.library_chunks for insert to batch_worker with check (true);
grant select on public.library_chunks to bot_runtime, batch_worker, authenticated;
grant insert (document_id, page, text, embedding), update (page, text, embedding), delete on public.library_chunks to authenticated;
grant insert (document_id, page, text, embedding) on public.library_chunks to batch_worker;
