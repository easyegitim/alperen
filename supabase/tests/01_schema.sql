-- tests/01_schema.sql — v2 temel şeması (docs/PLAN-v2-detail.md §2): her tablo ve sütun var, CHECK kısıtları beklenen
-- değerleri taşıyor, RLS açık + zorlanmış (+ yetki/politika kapsamı, B2), secure/audit kapalı, halfvec(1024), created_at, uuid pk varsayılanı,
-- yardımcılar (app.uid/role/my_student_id/my_children/my_students/can_read_student), tetikleyiciler (profil → öğrenci,
-- hafıza dosyası sınırı, müfredat denetimleri, denetim izi), enqueue_job (pgboss yoksa audit), pg_cron eşleniği,
-- Storage kovaları, seed'ler ve müfredat seed'i (export-sql.py --schema v2; ikinci sürüm seed2).
-- psql değişkenleri: have_content, seed2 (export-sql.py --schema v2 --as-version 2027.1, begin/commit'siz),
-- pii_hash_cases (packages/pii/cases.json hash_cases).
begin;
\ir _fixture.sql

-- Tablo ve sütun envanteri: liste tamdır (public/secure/audit'te listede olmayan tablo da FAIL)
create temporary table expected_columns (tbl text primary key, cols text) on commit drop;
insert into expected_columns values
    ('public.profiles', 'id role display_name locale tz avatar_path onboarded_at created_at updated_at'),
    ('public.students', 'id public_ref profile_id grade school status created_at'),
    ('public.guardian_links', 'id parent_id student_id relation status invite_token_hash invite_expires_at created_by accepted_at created_at'),
    ('public.instructor_links', 'id instructor_id student_id course_id role created_at'),
    ('public.settings', 'key value description created_at updated_at'),
    ('public.runtime_flags', 'key value updated_by created_at updated_at'),
    ('public.curricula', 'id code authority year version label status origin source_refs created_by created_at'),
    ('public.skills', 'curriculum_id id parent_id name description kind is_leaf order_no exam_weight_hint source_refs p_init p_learn p_guess p_slip created_at'),
    ('public.skill_prerequisites', 'curriculum_id skill_id prereq_id strength source created_at'),
    ('public.misconception_tags', 'tag curriculum_id skill_id prereq_skill_id text_instructor text_student created_at'),
    ('public.courses', 'id code title kind curriculum_id description visibility created_by created_at'),
    ('public.syllabus_topics', 'id course_id curriculum_id week title skill_ids created_at'),
    ('public.enrollments', 'id student_id curriculum_id course_id period_label status target_exam exam_date goal started_at ended_at created_at'),
    ('public.curriculum_proposals', 'id curriculum_id kind payload evidence_ids status decided_by decided_at created_at'),
    ('public.observations', 'id enrollment_id curriculum_id skill_id kind value weight confidence error_cause source_type source_id source_locator quote misconception_tag guess_override counts_for_mastery created_by_role applied_at created_at'),
    ('public.mastery', 'enrollment_id curriculum_id skill_id p evidence_count last_observation_id last_evidence_at created_at updated_at'),
    ('public.mastery_history', 'id enrollment_id skill_id observation_id p_before p_after method params created_at'),
    ('public.misconceptions', 'id enrollment_id curriculum_id skill_id tag text_instructor text_student status evidence_count first_seen last_seen resolved_at resolved_by resolution_observation_id rejected_by reject_note created_at'),
    ('public.misconception_evidence', 'misconception_id observation_id created_at'),
    ('public.instructor_notes', 'id enrollment_id author_id curriculum_id skill_id body mastery_estimate approved_fact created_at'),
    ('public.preferences', 'student_id active_hours modality default_mode explanation_notes proactive_enabled created_at updated_at'),
    ('public.student_dossier_cache', 'student_id course_id hash rendered created_at updated_at'),
    ('public.figures', 'id tool code code_hash alt_text png_path svg_path width_px height_px bytes render_status vision_status vision_report attempts review_status reviewed_by reviewed_at render_log created_at'),
    ('public.questions', 'id curriculum_id skill_ids kind stem stem_values figure_id options difficulty source template_id template_params content_hash verification status model cost_usd prompt_version reviewed_by reviewed_at review_note created_at'),
    ('secure.answer_keys', 'question_id correct_option numeric_value numeric_tolerance canonical_expr solution sympy_status sympy_report written_by verified_at created_at'),
    ('public.question_templates', 'id curriculum_id skill_id module_path engine params_schema enabled has_figure created_at'),
    ('public.attempts', 'id enrollment_id question_id context session_id chosen attempt_no is_correct misconception_tag graded_at response_ms created_at'),
    ('public.content_pool', 'id kind curriculum_id skill_id misconception_tag mode body status model cost_usd hit_count approved_by approved_at created_at'),
    ('public.question_styles', 'id course_id curriculum_id code name description format trick difficulty_band skill_ids years_hit years_total recency_score frequency_score exemplar_item_ids embedding source status created_by created_at'),
    ('public.style_coverage', 'enrollment_id style_id seen_count solved_count correct_count last_seen_at created_at'),
    ('public.uploads', 'id owner_id student_id kind storage_path mime bytes sha256 width height pages anthropic_file_id status extracted_text embedding created_at'),
    ('public.conversations', 'id student_id kind participant_id course_id title mode summary summary_upto_message_id last_message_at created_at'),
    ('public.conversation_messages', 'id conversation_id role content upload_ids llm_call_id tool_calls created_at'),
    ('public.memory_files', 'student_id path content bytes created_at updated_at'),
    ('public.memory_file_versions', 'id student_id path version op actor content created_at'),
    ('public.memory_facts', 'id student_id kind text source_message_ids source_lesson_claim_id confidence requires_approval approved approved_by valid_from valid_until morale_signal status embedding tsv model cost_usd created_at'),
    ('public.weekly_summaries', 'id student_id week_start body metrics facts_used model cost_usd created_at'),
    ('public.solution_analyses', 'id enrollment_id conversation_message_id exam_response_id upload_ids question_text student_work_text analysis verdict failing_step_no error_cause skill_ids misconception_tags style_id proposal_id model cost_usd embedding created_at'),
    ('public.exams', 'id course_id curriculum_id created_by kind source title publisher held_on is_copyrighted question_count sections generated_document_id status created_at'),
    ('public.exam_questions', 'id exam_id no section kind stem_text options figure_upload_id skill_ids style_id difficulty question_id created_at'),
    ('secure.exam_answer_keys', 'exam_question_id correct_option numeric_value source confidence created_at'),
    ('public.exam_sessions', 'id exam_id enrollment_id mode started_at finished_at duration_sec status score report_document_id created_at'),
    ('public.exam_responses', 'id session_id exam_question_id answer outcome time_spent_sec flagged work_upload_ids how_far_text solution_analysis_id created_at'),
    ('public.exam_sources', 'id course_id year term instructor_alias upload_id storage_path uploaded_by status error created_at'),
    ('public.exam_items', 'id source_id item_no topic kind format trick difficulty points curriculum_id skill_id ocr_text embedding style_id created_at'),
    ('public.exam_priority_plans', 'id course_id period plan evidence_count status approved_by approved_at created_at'),
    ('public.generated_documents', 'id student_id course_id kind title spec content html_path pdf_path status version personalization verification model cost_usd created_by created_at updated_at'),
    ('public.library_documents', 'id curriculum_id course_id upload_id title storage_path pages uploaded_by created_at'),
    ('public.library_chunks', 'id document_id page text embedding tsv created_at'),
    ('public.lessons', 'id enrollment_id course_id upload_id instructor_id held_at duration_min transcript_path frames_count student_visible auto_apply_threshold status created_at'),
    ('public.lesson_analyses', 'id lesson_id version seed_profile analysis model cost_usd status approved_by approved_at created_at'),
    ('public.lesson_claims', 'id analysis_id kind curriculum_id skill_id misconception_tag misconception_id value confidence quote speaker t_start_sec t_end_sec status edited_value decided_by decided_at created_at'),
    ('public.notifications', 'id recipient_id kind title body payload channels read_at sent_at created_at'),
    ('public.notification_rules', 'recipient_id kind enabled params created_at'),
    ('public.push_subscriptions', 'id user_id endpoint p256dh auth ua created_at'),
    ('public.llm_calls', 'id route purpose provider model effort prompt_version tokens_in tokens_out cache_read_tokens cache_write_tokens audio_sec images batch status error_code latency_ms cost_usd ref_table ref_id student_ref created_at'),
    ('public.spend_ledger', 'day purpose provider calls tokens_in tokens_out cache_read_tokens cache_write_tokens cost_usd created_at updated_at'),
    ('public.prompt_versions', 'id route version system_text schema_name model effort active created_at'),
    ('public.eval_cases', 'id route input expected upload_ids notes created_at'),
    ('public.eval_runs', 'id route prompt_version started_at finished_at scores summary created_at'),
    ('audit.events', 'id actor_role actor_id action table_name row_id diff created_at'),
    -- P1 ekleri (0020–0023)
    ('public.suggestions', 'id student_id enrollment_id kind title subtitle payload rank expires_at consumed_at created_at'),
    ('public.practice_sets', 'id enrollment_id suggestion_id status skill_ids target_count summary started_at finished_at created_at'),
    ('public.practice_set_items', 'set_id no question_id attempt_id answered_at created_at'),
    ('public.memory_corrections', 'id student_id path text status requested_by resolved_by resolution_note resolved_at created_at'),
    ('secure.server_keys', 'name secret rotated_at created_at'),
    ('secure.coach_turns', 'conversation_id token expires_at created_at'),
    ('secure.job_outbox', 'id name data reason attempts last_error created_at retried_at');

do $$
declare
  v_missing text;
  v_extra text;
  v_n int;
begin
  select string_agg(e.tbl || '.' || c.col, ', ' order by e.tbl, c.col) into v_missing
    from expected_columns e, unnest(string_to_array(e.cols, ' ')) as c (col)
   where not exists (select 1 from information_schema.columns ic
                      where ic.table_schema || '.' || ic.table_name = e.tbl and ic.column_name = c.col);
  perform t.ok(v_missing is null, 'beklenen tüm tablo ve sütunlar var (eksik: ' || coalesce(v_missing, '-') || ')');
  select string_agg(n.nspname || '.' || c.relname, ', ') into v_extra
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p') and n.nspname in ('public', 'secure', 'audit')
     and not exists (select 1 from expected_columns e where e.tbl = n.nspname || '.' || c.relname);
  perform t.ok(v_extra is null, 'listede olmayan tablo yok (fazla: ' || coalesce(v_extra, '-') || ')');
  select count(*) into v_n from expected_columns;
  perform t.ok(v_n = 68, 'v2 tabanı 61 tablo + P1 ekleri 4 tablo + koç üretim yolu 2 tablo + iş outbox''ı 1 tablo (' || v_n || ')');
  perform t.ok(to_regclass('public.staff') is null and to_regclass('public.messages') is null and to_regclass('public.consents') is null
               and to_regclass('public.tg_chats') is null and to_regclass('public.quota_usage') is null
               and to_regclass('public.diagnostic_tests') is null and to_regclass('public.legal_texts') is null
               and to_regclass('public.retention_policies') is null and to_regclass('secure.telegram_identities') is null,
               'v1 tabloları (staff, messages, onay, Telegram, kota, saklama, teşhis testi, hukuk) yok');
  perform t.ok(to_regprocedure('app.current_student()') is null, 'app.current_student() başlık mekanizması yok');
end $$;

-- CHECK kısıtları: (tablo, sütun, izin verilen değerler) — kısıt tanımı sütunu ve tüm değerleri içermeli
create temporary table expected_checks (tbl text, col text, vals text[]) on commit drop;
insert into expected_checks values
  ('public.profiles', 'role', array['student', 'parent', 'instructor', 'admin']),
  ('public.guardian_links', 'status', array['invited', 'active', 'revoked']),
  ('public.instructor_links', 'role', array['owner', 'viewer']),
  ('public.curricula', 'origin', array['seed', 'ai_draft', 'instructor']),
  ('public.curricula', 'status', array['draft', 'active', 'retired']),
  ('public.skills', 'kind', array['unit', 'outcome', 'sub_outcome']),
  ('public.courses', 'kind', array['exam_track', 'school', 'university', 'other']),
  ('public.courses', 'visibility', array['private', 'shared', 'public']),
  ('public.curriculum_proposals', 'kind', array['add_subskill', 'rename', 'merge', 'add_prereq', 'add_tag']),
  ('public.curriculum_proposals', 'status', array['open', 'accepted', 'rejected']),
  ('public.observations', 'error_cause', array['concept', 'procedure', 'careless', 'reading', 'time']),
  ('public.observations', 'source_type', array['attempt', 'lesson_claim', 'message', 'instructor_note', 'observation', 'solution_analysis', 'exam_response']),
  ('public.observations', 'kind', array['diagnostic', 'practice', 'test', 'lesson', 'chat_question', 'chat_misconception', 'instructor', 'inferred', 'resolution']),
  ('public.preferences', 'default_mode', array['hint', 'explain', 'solve']),
  ('public.question_styles', 'source', array['extracted', 'instructor']),
  ('public.uploads', 'kind', array['photo', 'pdf', 'video', 'audio', 'transcript', 'document', 'canvas']),
  ('public.uploads', 'status', array['stored', 'processing', 'ready', 'failed']),
  ('public.conversations', 'kind', array['coach', 'parent', 'instructor']),
  ('public.conversations', 'mode', array['hint', 'explain', 'solve']),
  ('public.conversation_messages', 'role', array['user', 'assistant', 'system']),
  ('public.memory_file_versions', 'op', array['create', 'str_replace', 'insert', 'delete', 'rename']),
  ('public.solution_analyses', 'verdict', array['correct', 'wrong', 'incomplete', 'unreadable']),
  ('public.solution_analyses', 'error_cause', array['concept', 'procedure', 'careless', 'reading', 'time']),
  ('public.exams', 'kind', array['deneme', 'diagnostic', 'practice', 'published']),
  ('public.exams', 'source', array['uploaded', 'generated', 'instructor']),
  ('public.exam_questions', 'kind', array['mcq', 'numeric', 'open']),
  ('secure.exam_answer_keys', 'source', array['uploaded', 'inferred', 'instructor', 'generated']),
  ('public.exam_sessions', 'mode', array['in_app', 'uploaded']),
  ('public.exam_sessions', 'status', array['in_progress', 'grading', 'analysing', 'done', 'failed']),
  ('public.exam_responses', 'outcome', array['correct', 'wrong', 'blank', 'unfinished']),
  ('public.generated_documents', 'kind', array['notes', 'mock_exam', 'report', 'question_set', 'answer_key']),
  ('public.generated_documents', 'status', array['queued', 'generating', 'rendered', 'review', 'published', 'failed']),
  ('public.lessons', 'status', array['uploaded', 'processing', 'analyzed', 'approved', 'corrected', 'rejected', 'failed']),
  ('public.llm_calls', 'status', array['ok', 'error', 'refusal', 'max_tokens', 'bad_output']),
  ('public.llm_calls', 'effort', array['low', 'medium', 'high', 'xhigh', 'max']),
  ('public.suggestions', 'kind', array['practice', 'weekly_homework', 'lesson_review', 'gap_analysis', 'mini_exam', 'document_ready', 'upload_result']),
  ('public.practice_sets', 'status', array['needs_generation', 'in_progress', 'finished', 'abandoned']),
  ('public.memory_corrections', 'status', array['open', 'applied', 'rejected']);

do $$
declare
  v_bad text;
begin
  select string_agg(e.tbl || '.' || e.col, ', ') into v_bad
    from expected_checks e
   where not exists (
     select 1 from pg_constraint k
       join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
      where k.contype = 'c' and n.nspname || '.' || c.relname = e.tbl
        and pg_get_constraintdef(k.oid) ~ ('\m' || e.col || '\M')
        and (select bool_and(pg_get_constraintdef(k.oid) like '%''' || v || '''%') from unnest(e.vals) as v));
  perform t.ok(v_bad is null, 'CHECK kısıtları beklenen değerleri taşıyor (eksik: ' || coalesce(v_bad, '-') || ')');
  perform t.raises($q$insert into public.solution_analyses (enrollment_id, analysis, verdict, error_cause)
                     values ('20000000-0000-4000-8000-0000000000ea', '{}', 'wrong', 'tembellik')$q$,
                   '23514', 'error_cause dışı değer reddedilir (check_violation)');
  perform t.raises($q$insert into public.guardian_links (student_id, status) values ('00000000-0000-4000-8000-000000000000', 'active')$q$,
                   '23%', 'veli bağı parent_id olmadan active olamaz');
end $$;

-- RLS, şema erişimi, halfvec(1024), created_at, uuid pk varsayılanı
do $$
declare
  v_bad text;
begin
  select string_agg(n.nspname || '.' || c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'r' and n.nspname in ('public', 'secure', 'audit') and not (c.relrowsecurity and c.relforcerowsecurity);
  perform t.ok(v_bad is null, 'her tablo ENABLE + FORCE RLS (eksik: ' || coalesce(v_bad, '-') || ')');
  perform t.ok(not has_schema_privilege('authenticated', 'secure', 'usage') and not has_schema_privilege('anon', 'secure', 'usage')
               and not has_schema_privilege('authenticated', 'audit', 'usage') and not has_schema_privilege('anon', 'audit', 'usage'),
               'secure ve audit şemaları anon/authenticated rollerine kapalı');
  perform t.ok(has_schema_privilege('service_role', 'secure', 'usage') and has_table_privilege('service_role', 'secure.exam_answer_keys', 'select')
               and has_table_privilege('service_role', 'public.observations', 'insert') and has_table_privilege('service_role', 'audit.events', 'select'),
               'service_role (worker) secure/public/audit tablolarına erişir');
  -- B2 (0018_rls.sql): anon hiçbir tabloya/görünüme erişmez; authenticated tüm public tablolarında SELECT (satırları
  -- politikalar süzer), tablo düzeyinde INSERT/UPDATE yok (yalnız sütun düzeyinde, kullanıcıya ait tablolarda), DELETE
  -- yalnız notification_rules ve push_subscriptions; public tablolarının hepsinde en az bir politika var
  select string_agg(n.nspname || '.' || c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'v') and n.nspname in ('public', 'secure', 'audit')
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
          or has_any_column_privilege('anon', c.oid, 'select'));
  perform t.ok(v_bad is null, 'anon hiçbir tabloyu/görünümü okuyamaz (fazla: ' || coalesce(v_bad, '-') || ')');
  select string_agg(n.nspname || '.' || c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'r' and n.nspname = 'public'
     and ((not has_table_privilege('authenticated', c.oid, 'select') and c.relname not in ('question_styles', 'curricula', 'figures'))
          or has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update')
          or (has_table_privilege('authenticated', c.oid, 'delete') and c.relname not in ('notification_rules', 'push_subscriptions'))
          or has_table_privilege('authenticated', c.oid, 'truncate'));
  perform t.ok(v_bad is null, 'authenticated: public tablolarında SELECT; tablo düzeyinde yazım yok (fazla/eksik: ' || coalesce(v_bad, '-') || ')');
  perform t.ok(not has_column_privilege('authenticated', 'public.question_styles', 'exemplar_item_ids', 'select')
               and not has_column_privilege('authenticated', 'public.question_styles', 'embedding', 'select')
               and has_column_privilege('authenticated', 'public.question_styles', 'code', 'select')
               and (select count(*) from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'question_styles'
                       and not has_column_privilege('authenticated', 'public.question_styles', c.column_name, 'select')) = 2,
               'question_styles: authenticated exemplar_item_ids ve embedding dışındaki sütunları okur');
  perform t.ok(not has_column_privilege('authenticated', 'public.figures', 'code', 'select')
               and not has_column_privilege('authenticated', 'public.figures', 'code_hash', 'select')
               and not has_column_privilege('authenticated', 'public.figures', 'vision_report', 'select')
               and not has_column_privilege('authenticated', 'public.figures', 'render_log', 'select')
               and has_column_privilege('authenticated', 'public.figures', 'png_path', 'select')
               and has_column_privilege('authenticated', 'public.figures', 'alt_text', 'select')
               and has_table_privilege('authenticated', 'public.v_figures_staff', 'select'),
               'figures: authenticated kaynak sütunlarını (code, code_hash, vision_report, render_log) okumaz; personel v_figures_staff (0027)');
  select string_agg(c.relname, ', ' order by c.relname) into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'r' and n.nspname = 'public'
     and (has_any_column_privilege('authenticated', c.oid, 'insert') or has_any_column_privilege('authenticated', c.oid, 'update'));
  perform t.ok(v_bad = 'conversation_messages, conversations, enrollments, notification_rules, notifications, preferences, profiles, push_subscriptions, students, uploads',
               'authenticated sütun düzeyi yazımları yalnız kullanıcıya ait tablolarda (' || coalesce(v_bad, '-') || ')');
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'r' and n.nspname = 'public' and not exists (select 1 from pg_policy pol where pol.polrelid = c.oid);
  perform t.ok(v_bad is null, 'her public tablosunda en az bir RLS politikası (eksik: ' || coalesce(v_bad, '-') || ')');
  perform t.ok(not exists (select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname in ('secure', 'audit')), 'secure ve audit tablolarında politika yok (yalnız fonksiyonlar)');
  select string_agg(a.attrelid::regclass || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ') into v_bad
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
     and format_type(a.atttypid, a.atttypmod) like '%halfvec%' and format_type(a.atttypid, a.atttypmod) not like '%halfvec(1024)';
  perform t.ok(v_bad is null, 'tüm halfvec sütunları 1024 boyutlu (' || coalesce(v_bad, '-') || ')');
  perform t.ok((select count(*) from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relkind = 'r' and a.attname = 'embedding' and not a.attisdropped
                   and format_type(a.atttypid, a.atttypmod) like '%halfvec(1024)') = 6,
               'embedding sütunları: uploads, solution_analyses, question_styles, memory_facts, exam_items, library_chunks');
  perform t.raises($q$insert into public.uploads (owner_id, kind, storage_path, embedding)
                     values ('00000000-0000-4000-8000-0000000000e1', 'photo', '00000000-0000-4000-8000-0000000000e1/x.jpg', ('[' || array_to_string(array_fill(0.1, array[768]), ',') || ']')::halfvec)$q$,
                   '%1024%', 'halfvec(1024) sütununa 768 boyut yazılamaz');
  select string_agg(e.tbl, ', ') into v_bad from expected_columns e where ' ' || e.cols || ' ' not like '% created_at %';
  perform t.ok(v_bad is null, 'her tabloda created_at (' || coalesce(v_bad, '-') || ')');
  select string_agg(c.table_schema || '.' || c.table_name, ', ') into v_bad
    from information_schema.columns c
    join information_schema.key_column_usage k on k.table_schema = c.table_schema and k.table_name = c.table_name and k.column_name = c.column_name
    join information_schema.table_constraints tc on tc.constraint_name = k.constraint_name and tc.table_schema = k.table_schema
   where tc.constraint_type = 'PRIMARY KEY' and c.data_type = 'uuid' and c.column_name = 'id' and c.table_schema in ('public', 'secure', 'audit')
     and c.table_name <> 'profiles' and coalesce(c.column_default, '') <> 'gen_random_uuid()';
  perform t.ok(v_bad is null, 'uuid id birincil anahtarları default gen_random_uuid() (' || coalesce(v_bad, '-') || ')');
end $$;

-- Seed'ler: kullanıcılar, profil → öğrenci tetikleyicisi, bağlar, ayarlar, bayraklar
do $$
declare
  v_ref text;
  v_uid uuid := gen_random_uuid();
begin
  perform t.ok((select count(*) from public.profiles) = 5 and (select count(*) from public.students) = 2, 'seed: 5 profil, 2 öğrenci');
  perform t.ok((select count(*) from public.guardian_links gl where gl.status = 'active') = 1
               and (select count(*) from public.instructor_links) = 2, 'seed: 1 aktif veli bağı, 2 eğitmen bağı');
  perform t.ok((select st.value #>> '{}' from public.settings st where st.key = 'default_period') = 'YKS 2027'
               and (select (st.value #>> '{}')::int from public.settings st where st.key = 'misconception_open_evidence') = 3,
               'settings: default_period, misconception_open_evidence');
  perform t.ok((select (rf.value #>> '{}')::boolean from public.runtime_flags rf where rf.key = 'paid_llm_enabled'), 'runtime_flags seed');
  insert into auth.users (id, email) values (v_uid, 'yeni@ogrenmen.test');
  insert into public.profiles (id, role) values (v_uid, 'student');
  select s.public_ref into v_ref from public.students s where s.profile_id = v_uid;
  perform t.ok(v_ref ~ '^s_[a-z2-7]{12}$', 'öğrenci profili students satırı yaratır; public_ref ^s_[a-z2-7]{12}$ (' || coalesce(v_ref, '-') || ')');
  update public.profiles p set role = 'student', display_name = 'Yeni' where p.id = v_uid;
  perform t.ok((select count(*) from public.students s where s.profile_id = v_uid) = 1, 'rol güncellemesi ikinci öğrenci satırı açmaz');
  perform t.raises($q$insert into public.instructor_links (instructor_id, student_id, role)
                     select '00000000-0000-4000-8000-0000000000a1', s.id, 'viewer' from public.students s
                      where s.profile_id = '00000000-0000-4000-8000-0000000000e1'$q$,
                   '23505', 'instructor_links (eğitmen, öğrenci, ders=null) tekil (nulls not distinct)');
end $$;

-- Yardımcılar: kimlik auth.uid() + profiles'tan
do $$
begin
  perform t.claims_only(t.u('elif'));
  perform t.ok(app.uid() = t.u('elif') and app.role() = 'student' and app.my_student_id() = t.u('A'), 'öğrenci: uid, role, my_student_id');
  perform t.ok(app.can_read_student(t.u('A')) and not app.can_read_student(t.u('B')), 'öğrenci yalnız kendini görür');
  perform t.claims_only(t.u('parent'));
  perform t.ok(app.role() = 'parent' and app.my_student_id() is null
               and array(select x from app.my_children() as x) = array[t.u('A')], 'veli: my_children = aktif bağlı çocuk');
  perform t.ok(app.can_read_student(t.u('A')) and not app.can_read_student(t.u('B')), 'veli yalnız bağlı çocuğunu görür');
  update public.guardian_links gl set status = 'revoked' where gl.parent_id = t.u('parent');
  perform t.ok(not exists (select 1 from app.my_children()) and not app.can_read_student(t.u('A')), 'iptal edilen bağ görünürlüğü kaldırır');
  update public.guardian_links gl set status = 'active' where gl.parent_id = t.u('parent');
  perform t.claims_only(t.u('inst'));
  perform t.ok((select count(*) from app.my_students()) = 2 and app.can_read_student(t.u('B')), 'eğitmen: my_students bağlı öğrenciler');
  perform t.claims_only(t.u('admin'));
  perform t.ok(app.is_admin() and app.can_read_student(t.u('B')), 'admin hepsini görür');
  perform t.as_admin();
  perform t.ok(app.uid() is null and not app.can_read_student(t.u('A')), 'JWT yoksa kimlik yok');
end $$;

-- Müfredat denetimleri ve kayıt tetikleyicileri
do $$
begin
  perform t.raises(format($q$insert into public.syllabus_topics (course_id, curriculum_id, title, skill_ids)
                            values (%L, %L, 'x', array['t.mat.yok'])$q$, t.u('course'), t.u('cur')),
                   'OGR-CURR-001%', 'izlence: müfredatta olmayan kazanım reddedilir');
  perform t.raises(format($q$insert into public.questions (curriculum_id, skill_ids, stem, source, content_hash)
                            values (%L, array['t.mat.yok'], 'x', 'llm', 'h-yok')$q$, t.u('cur')),
                   'OGR-CURR-001%', 'soru: müfredatta olmayan kazanım reddedilir');
  perform t.raises(format($q$insert into public.mastery (enrollment_id, curriculum_id, skill_id, p) values (%L, gen_random_uuid(), 't.mat.a', 0.3)$q$, t.u('EA')),
                   'OGR-CURR-002%', 'curriculum_id kaydın müfredatıyla uyuşmalı');
  insert into public.mastery (enrollment_id, skill_id, p) values (t.u('EA'), 't.mat.a', 0.3);
  perform t.ok((select m.curriculum_id from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a') = t.u('cur'),
               'fill_curriculum_id kayıttan doldurur');
end $$;

-- Hafıza dosyaları: yol, boyut, dosya sınırı, bytes
do $$
declare
  v_i int;
begin
  insert into public.memory_files (student_id, path, content) values (t.u('A'), '/memories/profile.md', 'Sınıf: 11. Kısa adımlar.');
  perform t.ok((select mf.bytes from public.memory_files mf where mf.student_id = t.u('A') and mf.path = '/memories/profile.md')
               = octet_length('Sınıf: 11. Kısa adımlar.'), 'memory_files.bytes = octet_length(content)');
  perform t.raises(format($q$insert into public.memory_files (student_id, path) values (%L, '/memories/../x.md')$q$, t.u('A')),
                   '23514', 'yol .. içeremez');
  perform t.raises(format($q$insert into public.memory_files (student_id, path) values (%L, '/etc/passwd')$q$, t.u('A')),
                   '23514', 'yol /memories/ altında olmalı');
  perform t.raises(format($q$insert into public.memory_files (student_id, path, content) values (%L, '/memories/big.md', repeat('a', 8193))$q$, t.u('A')),
                   '23514', 'dosya ≤ 8 KB');
  for v_i in 2..12 loop
    insert into public.memory_files (student_id, path) values (t.u('A'), '/memories/f' || v_i || '.md');
  end loop;
  perform t.raises(format($q$insert into public.memory_files (student_id, path) values (%L, '/memories/f13.md')$q$, t.u('A')),
                   'OGR-MEM-001%', '13. dosya reddedilir (≤ 12)');
  update public.memory_files mf set content = 'güncel' where mf.student_id = t.u('A') and mf.path = '/memories/f2.md';
  perform t.ok(true, '12 dosyadayken var olan dosya güncellenebilir');
end $$;

-- Denetim izi: bağ değişiklikleri audit.events'e yazılır, token hash yazılmaz
do $$
begin
  insert into public.guardian_links (student_id, status, invite_token_hash, created_by)
  values (t.u('B'), 'invited', 'deadbeef', t.u('can'));
  perform t.ok(exists (select 1 from audit.events e where e.table_name = 'public.guardian_links' and e.action = 'INSERT'
                        and not (e.diff ? 'invite_token_hash')), 'guardian_links INSERT denetim izi (token hash hariç)');
end $$;

-- enqueue_job: pgboss tablosu yoksa audit + outbox + null; varsa satır (ayarlar pgboss.queue'dan); kuyruk yoksa outbox (0029);
-- geçersiz ad → OGR-JOB-002
do $$
declare
  v_id uuid;
begin
  v_id := public.enqueue_job('memory-compact', '{"student":"s_test"}');
  perform t.ok(v_id is null and exists (select 1 from audit.events e where e.action = 'job.enqueue_skipped'
                                         and e.diff ->> 'name' = 'memory-compact'), 'pgboss yok: null döner, audit.events''e düşer');
  perform t.raises($q$select public.enqueue_job('kötü ad; drop', '{}')$q$, 'OGR-JOB-002%', 'geçersiz iş adı reddedilir');
  -- pg-boss şemasını Supabase'de migration sahibi (postgres) bağlantısıyla worker kurar; yerelde eşleniği ogrenmen_owner
  set local role ogrenmen_owner;
  -- pg-boss 12.x eşleniği: pgboss.queue (createQueue seçenekleri) + pgboss.job (tablo varsayılanları pg-boss'unkiler)
  create schema pgboss;
  create table pgboss.queue (name text primary key, policy text not null, retry_limit int not null, retry_delay int not null,
                             retry_backoff bool not null, retry_delay_max int, expire_seconds int not null, retention_seconds int not null,
                             deletion_seconds int not null, dead_letter text, heartbeat_seconds int, partition bool not null default false,
                             table_name text not null default 'job');
  create table pgboss.job (id uuid not null default gen_random_uuid(), name text not null, priority int not null default 0, data jsonb,
                           retry_limit int not null default 2, retry_count int not null default 0, retry_delay int not null default 0,
                           retry_backoff bool not null default false, retry_delay_max int, expire_seconds int not null default 900,
                           deletion_seconds int not null default 604800, start_after timestamptz not null default now(),
                           created_on timestamptz not null default now(),
                           keep_until timestamptz not null default now() + interval '14 days', policy text, dead_letter text,
                           heartbeat_seconds int);
  create unique index job_singleton on pgboss.job (name) where policy = 'singleton';
  insert into pgboss.queue (name, policy, retry_limit, retry_delay, retry_backoff, retry_delay_max, expire_seconds, retention_seconds,
                            deletion_seconds, heartbeat_seconds)
  values ('memory-compact', 'standard', 5, 30, true, 600, 3600, 86400, 172800, 60),
         ('tekil-is', 'singleton', 1, 0, false, null, 60, 3600, 3600, null);
  reset role;
  v_id := public.enqueue_job('memory-compact', '{"student":"s_test"}');
  perform t.ok(v_id is not null and (select j.data ->> 'student' from pgboss.job j where j.id = v_id) = 's_test',
               'pgboss.job varsa aynı işlemde satır eklenir');
  perform t.ok((select j.retry_limit = 5 and j.retry_delay = 30 and j.retry_backoff and j.retry_delay_max = 600 and j.expire_seconds = 3600
                       and j.deletion_seconds = 172800 and j.heartbeat_seconds = 60 and j.policy = 'standard' and j.priority = 0
                       and abs(extract(epoch from (j.keep_until - j.start_after)) - 86400) < 1
                  from pgboss.job j where j.id = v_id),
               'iş ayarları kuyruktan kopyalanır (yeniden deneme, süre aşımı, saklama, kalp atışı; tablo varsayılanları değil)');
  v_id := public.enqueue_job('yok-kuyruk', '{}');
  perform t.ok(v_id is null
               and exists (select 1 from secure.job_outbox o where o.name = 'yok-kuyruk' and o.reason like 'OGR-JOB-001 kuyruk yok%'),
               'kuyruk yoksa iş kaybolmaz: secure.job_outbox (0029; neden OGR-JOB-001)');
  v_id := app.try_enqueue('yok-kuyruk', '{}');
  perform t.ok(v_id is null
               and exists (select 1 from audit.events e where e.action = 'job.enqueue_failed' and e.diff ->> 'name' = 'yok-kuyruk'),
               'RPC yolu (try_enqueue): kuyruk yoksa düşmez, job.enqueue_failed yazar');
  perform t.ok(public.enqueue_job('tekil-is', '{}') is not null and public.enqueue_job('tekil-is', '{}') is null,
               'kuyruk politikası çakışmasında (singleton) pg-boss gibi null döner');
  perform t.ok(not has_function_privilege('authenticated', 'public.enqueue_job(text, jsonb)', 'execute')
               and has_function_privilege('service_role', 'public.enqueue_job(text, jsonb)', 'execute'),
               'enqueue_job yalnız service_role (ve SECURITY DEFINER RPC''ler)');
end $$;

-- pg_cron (ya da eşleniği) ve Storage kovaları. Zamanlamalar apps/worker/src/schedules.ts SCHEDULES ile birebir aynı
-- (db-test.sh 'iş|cron;…' olarak geçirir; worker saati Europe/Istanbul = UTC+3, pg_cron UTC).
insert into t.cfg values ('worker_schedules', :'worker_schedules');
do $$
declare
  v_jobs text[];
  v_worker text[];
  v_def text;
  v_job text;
  v_f text[];
  v_utc text[];
  v_bad text := '';
begin
  if to_regclass('cron.job') is not null then
    select array_agg(j.jobname order by j.jobname) into v_jobs from cron.job j where j.jobname like 'ogrenmen-%';
    perform t.ok(v_jobs = array['ogrenmen-memory-compact', 'ogrenmen-weekly-summary'],
                 format('pg_cron tam iki zamanlama kurar: memory.compact, weekly.summary (%s)', v_jobs));
    perform t.ok(not exists (select 1 from cron.job j
                              where j.jobname like 'ogrenmen-%'
                                and (j.command !~ '^select public\.enqueue_job\(''[a-z0-9.]+'', ''\{\}''::jsonb\)$'
                                     or j.jobname <> 'ogrenmen-' || replace(substring(j.command from 'enqueue_job\(''([a-z0-9.]+)'''), '.', '-'))),
                 'pg_cron yalnız enqueue_job zamanlar (her komut tek bir public.enqueue_job çağrısı, iş adı zamanlama adıyla aynı)');
    if coalesce(t.v('worker_schedules'), '') = '' then
      raise notice 'SKIP: apps/worker/src/schedules.ts yok (pg_cron ↔ worker SCHEDULES eşliği denetlenmedi)';
    else
      foreach v_def in array string_to_array(t.v('worker_schedules'), ';') loop
        v_job := split_part(v_def, '|', 1);
        v_f := regexp_split_to_array(split_part(v_def, '|', 2), ' ');
        v_worker := array_append(v_worker, v_job);
        -- Istanbul → UTC: saat −3; gece yarısını geçerse haftanın günü bir geri (ayın günü/ay sabitse denetlenemez)
        if v_f[2] ~ '^\d+$' then
          v_utc := array[v_f[1], ((v_f[2]::int + 21) % 24)::text, v_f[3], v_f[4],
                         case when v_f[2]::int < 3 and v_f[5] ~ '^\d$' then ((v_f[5]::int + 6) % 7)::text else v_f[5] end];
          if v_f[2]::int < 3 and v_f[3] <> '*' then
            v_utc := null;
          end if;
        end if;
        if not exists (select 1 from cron.job j
                        where j.command = format('select public.enqueue_job(%L, ''{}''::jsonb)', v_job)
                          and (v_utc is null or j.schedule = array_to_string(v_utc, ' '))) then
          v_bad := v_bad || format(' [%s @ %s → UTC %s]', v_job, split_part(v_def, '|', 2), array_to_string(v_utc, ' '));
        end if;
      end loop;
      perform t.ok(v_bad = '' and (select array_agg(x order by x) from unnest(v_worker) as x)
                                  = (select array_agg(q.job order by q.job)
                                       from (select substring(j.command from 'enqueue_job\(''([a-z0-9.]+)''') as job
                                               from cron.job j where j.jobname like 'ogrenmen-%') as q),
                   format('pg_cron zamanlamaları worker SCHEDULES ile aynı (iş adları ve saatler, Istanbul→UTC)%s', v_bad));
    end if;
    perform t.ok((select rf.value #>> '{}' from public.runtime_flags rf where rf.key = 'cron_owner') = 'pg_cron', 'cron_owner = pg_cron');
  else
    perform t.ok((select rf.value #>> '{}' from public.runtime_flags rf where rf.key = 'cron_owner') = 'worker', 'cron_owner = worker');
  end if;
  if to_regclass('storage.buckets') is not null then
    perform t.ok((select count(*) from storage.buckets b where (b.id, b.public) in
                   (('uploads', false), ('lessons', false), ('documents', false), ('figures', true))) = 4,
                 'kovalar: uploads/lessons/documents özel, figures açık');
  else
    raise notice 'SKIP: storage şeması yok';
  end if;
end $$;

-- Ad-token hash'leri: SQL app.pii_name_token_hashes ↔ packages/pii cases.json hash_cases (bayt eşitliği)
insert into t.cfg values ('pii_cases', :'pii_hash_cases');
do $$
declare
  v_case jsonb;
  v_n int := 0;
begin
  for v_case in select x.c from jsonb_array_elements(t.v('pii_cases')::jsonb) as x (c) loop
    perform t.ok(app.pii_name_token_hashes(v_case ->> 'full_name') = array(select jsonb_array_elements_text(v_case -> 'expected')),
                 'pii hash vakası ' || (v_case ->> 'id'));
    v_n := v_n + 1;
  end loop;
  perform t.ok(v_n > 0 or t.v('pii_cases') = '[]', 'pii hash vakaları okundu (' || v_n || ')');
end $$;

-- Müfredat seed'i (content/tyt-matematik, export-sql.py --schema v2) ve ikinci sürüm
insert into t.cfg values ('have_content', :'have_content');
do $$
declare
  v_cur uuid;
begin
  if t.v('have_content') <> '1' then
    raise notice 'SKIP: no content';
    return;
  end if;
  select c.id into v_cur from public.curricula c where c.code = 'TYT-MAT' and c.version = '2026.1';
  perform t.ok(v_cur is not null and (select c.origin from public.curricula c where c.id = v_cur) = 'seed', 'TYT-MAT@2026.1 origin = seed');
  perform t.ok((select count(*) from public.skills s where s.curriculum_id = v_cur and s.is_leaf) >= 10, 'kazanım yaprakları yüklendi');
  perform t.ok((select count(*) from public.exams x where x.curriculum_id = v_cur and x.kind = 'diagnostic') = 1, 'teşhis testi exams(kind=diagnostic)');
  perform t.ok((select count(*) from public.exam_questions q join public.exams x on x.id = q.exam_id
                 join public.questions qq on qq.id = q.question_id
                 where x.curriculum_id = v_cur and x.kind = 'diagnostic' and qq.source = 'diagnostic') = 20,
               'teşhis testinin 20 sorusu soru bankasına bağlı');
  perform t.ok((select count(*) from public.figures f where f.review_status = 'verified') >= 1, 'teşhis şekilleri verified');
end $$;

-- TYT teşhis anahtarları (seed-keys.py --schema v2, db-test.sh iki kez uygular)
insert into t.cfg values ('have_keys', :'have_keys');
do $$
declare
  v_cur uuid;
begin
  if t.v('have_keys') <> '1' then
    raise notice 'SKIP: no keys';
    return;
  end if;
  select c.id into v_cur from public.curricula c where c.code = 'TYT-MAT' and c.version = '2026.1';
  perform t.ok((select count(*) from public.questions qq join secure.answer_keys k on k.question_id = qq.id
                 where qq.curriculum_id = v_cur and qq.source = 'diagnostic' and qq.status = 'approved'
                   and k.written_by = 'seed' and k.sympy_status = 'verified'
                   and app.answer_key_complete(qq.kind, k.correct_option, k.numeric_value)) = 20,
               'seed-keys: 20 teşhis sorusu approved + SymPy doğrulanmış anahtar (secure.answer_keys)');
  perform t.ok((select count(*) from public.exam_questions q join public.exams x on x.id = q.exam_id
                 join secure.exam_answer_keys k on k.exam_question_id = q.id
                 where x.curriculum_id = v_cur and x.kind = 'diagnostic' and k.source = 'instructor') = 20,
               'seed-keys: teşhis testinin 20 sorusunda sınav anahtarı (secure.exam_answer_keys)');
  perform t.ok((select count(*) from public.questions qq where qq.reviewed_by = (select p.id from public.profiles p where p.role = 'admin'
                                                                                    order by p.created_at limit 1)
                   and qq.source = 'diagnostic') = 20, 'onaylayan ilk admin profili');
end $$;
\if :have_content
\i :seed2
do $$
begin
  perform t.ok((select count(*) from public.curricula c where c.code = 'TYT-MAT') = 2
               and (select count(distinct s.id) from public.skills s join public.curricula c on c.id = s.curriculum_id where c.code = 'TYT-MAT')
                 = (select count(*) from public.skills s join public.curricula c on c.id = s.curriculum_id where c.code = 'TYT-MAT' and c.version = '2026.1'),
               'ikinci sürüm (2027.1) aynı kazanım kodlarını yeni curricula satırı altında yazar');
end $$;
\endif

rollback;
