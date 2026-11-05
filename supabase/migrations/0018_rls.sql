-- 0018_rls.sql — RLS politikaları ve authenticated yetkileri (docs/PLAN-v2-detail.md §2.4, docs/PLAN-v2.md §4).
-- Öğrenci → kendi satırları, kayıtlı derslerin müfredat/tarzları, oturumu olan sınavların soruları (yalnız
-- v_exam_questions_student görünümüyle; telifli soru metni maskeli), secure.* asla. Veli → aktif guardian_links
-- çocukları: öğrenci kimliği, kayıtlar, deneme oturumları (skor), raporlar (generated_documents kind='report'),
-- haftalık özetler, ustalık (yalnız mastery_view), kendi sohbetleri (kind='parent') ve bildirimleri; koç sohbeti,
-- sınav metinleri, ham yüklemeler, gözlemler YOK. Eğitmen → instructor_links öğrencilerinin tamamı + ders içeriği
-- (sorular, sınavlar, kütüphane, öneriler); yazımlar RPC ile. Admin (profiles.role) → hepsi. service_role (worker)
-- BYPASSRLS ile politikaları atlar; SECURITY DEFINER fonksiyonların sahibi de (Supabase'de postgres) atlar.
-- secure.* ve audit.events politikasızdır (yalnız fonksiyonlar ve service_role; scripts/no-policy-allowlist.json).
-- anon'a hiçbir tablo yetkisi verilmez. authenticated'a tüm public tablolarda SELECT (satırları politikalar süzer),
-- yalnız aşağıdaki kullanıcıya ait tablolarda (sütun düzeyinde) INSERT/UPDATE/DELETE verilir.

-- --- politika yardımcıları (SECURITY DEFINER: politika içinden çağrılınca diğer tabloların RLS'ine takılmaz) ---

-- Öğrencinin öğrenme verisini görebilir mi (veli HARİÇ): öğrencinin kendisi, bağlı eğitmen, admin
create or replace function app.can_read_student_data(p_student uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if p_student is null or auth.uid() is null then
    return false;
  end if;
  return app.is_admin()
      or coalesce(p_student = app.my_student_id(), false)
      or exists (select 1 from app.my_students() as m (sid) where m.sid = p_student);
end
$$;
comment on function app.can_read_student_data(uuid) is 'Öğrenme verisi okunabilir mi: öğrencinin kendisi, bağlı eğitmen, admin (veli hariç).';

create or replace function app.can_read_enrollment(p_enrollment uuid, p_with_parent boolean) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.student_of_enrollment(p_enrollment);
begin
  if p_with_parent then
    return app.can_read_student(v_student);
  end if;
  return app.can_read_student_data(v_student);
end
$$;
comment on function app.can_read_enrollment(uuid, boolean) is 'Kaydı okuyabilir mi (p_with_parent: aktif veli de).';

-- Ders görünürlüğü: personel, paylaşılan/açık ders, sahibi, kendisinin ya da çocuğunun kaydı
create or replace function app.can_read_course(p_course uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if p_course is null or auth.uid() is null then
    return false;
  end if;
  return app.is_staff()
      or exists (select 1 from public.courses co where co.id = p_course and (co.visibility <> 'private' or co.created_by = auth.uid()))
      or exists (select 1 from public.enrollments as e
                  where e.course_id = p_course
                    and (e.student_id = app.my_student_id() or e.student_id in (select c.sid from app.my_children() as c (sid))));
end
$$;
comment on function app.can_read_course(uuid) is 'Ders görünür mü: eğitmen/admin, paylaşılan/açık ders, sahibi, kendi ya da çocuğunun kaydı.';

create or replace function app.can_read_curriculum(p_curriculum uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if p_curriculum is null or auth.uid() is null then
    return false;
  end if;
  return app.is_staff()
      or exists (select 1 from public.curricula c where c.id = p_curriculum and c.created_by = auth.uid())
      or exists (select 1 from public.courses co where co.curriculum_id = p_curriculum and (co.visibility <> 'private' or co.created_by = auth.uid()))
      or exists (select 1 from public.enrollments as e
                  where e.curriculum_id = p_curriculum
                    and (e.student_id = app.my_student_id() or e.student_id in (select c.sid from app.my_children() as c (sid))));
end
$$;
comment on function app.can_read_curriculum(uuid) is 'Müfredat görünür mü: eğitmen/admin, sahibi, görünür bir dersin müfredatı, kendi ya da çocuğunun kaydı.';

-- Sohbet: katılımcı; öğrenci kendi koç sohbetleri; bağlı eğitmen koç ve eğitmen sohbetleri; admin. Veli yalnız kendi
-- (kind='parent') sohbetini görür: koç sohbetinin katılımcısı öğrencidir.
create or replace function app.can_read_conversation(p_conversation uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_c public.conversations%rowtype;
begin
  if auth.uid() is null then
    return false;
  end if;
  select c.* into v_c from public.conversations c where c.id = p_conversation;
  if not found then
    return false;
  end if;
  return app.is_admin()
      or v_c.participant_id = auth.uid()
      or (v_c.kind = 'coach' and coalesce(v_c.student_id = app.my_student_id(), false))
      or (v_c.kind in ('coach', 'instructor') and exists (select 1 from app.my_students() as m (sid) where m.sid = v_c.student_id));
end
$$;
comment on function app.can_read_conversation(uuid) is 'Sohbeti okuyabilir mi: katılımcı, öğrencinin koç sohbeti, bağlı eğitmen (koç/eğitmen), admin; veli koç sohbetini okuyamaz.';

-- Profil görünürlüğü: kendisi, admin, görebildiği öğrencinin profili, kendi/çocuğunun eğitmeni, öğrencisinin/kendisinin velisi
create or replace function app.can_see_profile(p_profile uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  return p_profile = auth.uid()
      or app.is_admin()
      or exists (select 1 from public.students s where s.profile_id = p_profile and app.can_read_student(s.id))
      or exists (select 1 from public.instructor_links il
                  where il.instructor_id = p_profile
                    and (il.student_id = app.my_student_id() or il.student_id in (select c.sid from app.my_children() as c (sid))))
      or exists (select 1 from public.guardian_links gl
                  where gl.parent_id = p_profile and gl.status = 'active'
                    and (gl.student_id = app.my_student_id() or gl.student_id in (select m.sid from app.my_students() as m (sid))));
end
$$;
comment on function app.can_see_profile(uuid) is 'Profil görünür mü: kendisi, admin, öğrencinin profili (okuyabilene), öğrencinin eğitmeni, öğrencinin velisi.';

revoke all on function app.can_read_student_data(uuid), app.can_read_enrollment(uuid, boolean), app.can_read_course(uuid),
  app.can_read_curriculum(uuid), app.can_read_conversation(uuid), app.can_see_profile(uuid) from public;
grant execute on function app.can_read_student_data(uuid), app.can_read_enrollment(uuid, boolean), app.can_read_course(uuid),
  app.can_read_curriculum(uuid), app.can_read_conversation(uuid), app.can_see_profile(uuid) to authenticated, service_role;

-- --- authenticated yetkileri -----------------------------------------------------------------------

grant select on all tables in schema public to authenticated;
-- question_styles: exemplar_item_ids (tarzın örnek sınav maddeleri) ve embedding öğrenciye gizli; personel tam satırı
-- v_question_styles_staff görünümüyle okur (0019). İstemci sütunları açıkça seçmeli (select=* izin hatası verir).
revoke select on public.question_styles from authenticated;
grant select (id, course_id, curriculum_id, code, name, description, format, trick, difficulty_band, skill_ids, years_hit,
              years_total, recency_score, frequency_score, source, status, created_by, created_at)
on public.question_styles to authenticated;
grant insert (id, role, display_name, locale, tz, avatar_path) on public.profiles to authenticated;
grant update (display_name, locale, tz, avatar_path, onboarded_at) on public.profiles to authenticated;
grant update (grade, school) on public.students to authenticated;
grant insert (student_id, curriculum_id, course_id, period_label, target_exam, exam_date, goal) on public.enrollments to authenticated;
grant update (status, target_exam, exam_date, goal) on public.enrollments to authenticated;
grant insert (student_id, active_hours, modality, default_mode, explanation_notes, proactive_enabled) on public.preferences to authenticated;
grant update (active_hours, modality, default_mode, explanation_notes, proactive_enabled) on public.preferences to authenticated;
grant insert (id, owner_id, student_id, kind, storage_path, mime, bytes, sha256, width, height, pages) on public.uploads to authenticated;
grant insert (id, student_id, kind, participant_id, course_id, title, mode) on public.conversations to authenticated;
grant update (title, mode) on public.conversations to authenticated;
grant insert (conversation_id, role, content, upload_ids) on public.conversation_messages to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant insert (recipient_id, kind, enabled, params) on public.notification_rules to authenticated;
grant update (enabled, params) on public.notification_rules to authenticated;
grant delete on public.notification_rules to authenticated;
grant insert (user_id, endpoint, p256dh, auth, ua) on public.push_subscriptions to authenticated;
grant delete on public.push_subscriptions to authenticated;

-- --- kimlik ----------------------------------------------------------------------------------------

create policy profiles_select on public.profiles for select to authenticated using (app.can_see_profile(id));
create policy profiles_insert_self on public.profiles for insert to authenticated
with check (id = auth.uid() and role in ('student', 'parent'));
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy students_select on public.students for select to authenticated using (app.can_read_student(id));
create policy students_update_self on public.students for update to authenticated
using (id = app.my_student_id()) with check (id = app.my_student_id());

create policy guardian_links_select on public.guardian_links for select to authenticated
using (parent_id = auth.uid() or app.can_read_student(student_id));
create policy instructor_links_select on public.instructor_links for select to authenticated
using (instructor_id = auth.uid() or app.can_read_student(student_id));

create policy settings_select on public.settings for select to authenticated using (true);
create policy runtime_flags_select_admin on public.runtime_flags for select to authenticated using (app.is_admin());

-- --- müfredat ve dersler ---------------------------------------------------------------------------

create policy curricula_select on public.curricula for select to authenticated using (app.can_read_curriculum(id));
create policy skills_select on public.skills for select to authenticated using (app.can_read_curriculum(curriculum_id));
create policy skill_prerequisites_select on public.skill_prerequisites for select to authenticated
using (app.can_read_curriculum(curriculum_id));
create policy misconception_tags_select on public.misconception_tags for select to authenticated
using (app.can_read_curriculum(curriculum_id));
create policy courses_select on public.courses for select to authenticated using (app.can_read_course(id));
create policy syllabus_topics_select on public.syllabus_topics for select to authenticated using (app.can_read_course(course_id));
create policy enrollments_select on public.enrollments for select to authenticated using (app.can_read_student(student_id));
-- ders ↔ müfredat eşleşmesini her yazan için app.enrollments_course_curriculum tetikleyicisi (aşağıda) zorlar
create policy enrollments_insert_self on public.enrollments for insert to authenticated
with check (student_id = app.my_student_id() and app.can_read_curriculum(curriculum_id)
            and (course_id is null or app.can_read_course(course_id)));
create policy enrollments_update_self on public.enrollments for update to authenticated
using (student_id = app.my_student_id()) with check (student_id = app.my_student_id());
create policy curriculum_proposals_select_staff on public.curriculum_proposals for select to authenticated using (app.is_staff());

-- --- kanıt zinciri ---------------------------------------------------------------------------------

create policy observations_select on public.observations for select to authenticated
using (app.can_read_enrollment(enrollment_id, false));
create policy mastery_select on public.mastery for select to authenticated using (app.can_read_enrollment(enrollment_id, false));
create policy mastery_history_select on public.mastery_history for select to authenticated
using (app.can_read_enrollment(enrollment_id, false));
create policy misconceptions_select on public.misconceptions for select to authenticated
using (app.can_read_enrollment(enrollment_id, false));
create policy misconception_evidence_select on public.misconception_evidence for select to authenticated
using (exists (select 1 from public.misconceptions as mc where mc.id = misconception_evidence.misconception_id));
create policy instructor_notes_select_staff on public.instructor_notes for select to authenticated
using (app.is_staff() and app.can_read_enrollment(enrollment_id, false));
create policy preferences_select on public.preferences for select to authenticated using (app.can_read_student_data(student_id));
create policy preferences_insert_self on public.preferences for insert to authenticated with check (student_id = app.my_student_id());
create policy preferences_update_self on public.preferences for update to authenticated
using (student_id = app.my_student_id()) with check (student_id = app.my_student_id());
create policy student_dossier_cache_select_staff on public.student_dossier_cache for select to authenticated
using (app.is_staff() and app.can_read_student_data(student_id));
create policy solution_analyses_select on public.solution_analyses for select to authenticated
using (app.can_read_enrollment(enrollment_id, false));

-- --- soru bankası ve tarzlar -----------------------------------------------------------------------

create policy figures_select on public.figures for select to authenticated using (true);
-- öğrenci soru bankasını v_questions_student ile görür (şıkların yanılgı etiketleri yok)
create policy questions_select_staff on public.questions for select to authenticated using (app.is_staff());
create policy question_templates_select_staff on public.question_templates for select to authenticated using (app.is_staff());
create policy attempts_select on public.attempts for select to authenticated using (app.can_read_enrollment(enrollment_id, false));
create policy content_pool_select on public.content_pool for select to authenticated
using (app.is_staff() or (status = 'approved' and app.can_read_curriculum(curriculum_id)));
-- veli tarzları görmez (hile/biçim açıklaması sınav içeriğidir; docs/PLAN-v2-detail.md §2.4)
create policy question_styles_select on public.question_styles for select to authenticated
using (app.can_read_course(course_id) and app.role() is distinct from 'parent' and (status = 'active' or app.is_staff()));
create policy style_coverage_select on public.style_coverage for select to authenticated
using (app.can_read_enrollment(enrollment_id, false));

-- --- yüklemeler, sohbetler, hafıza -----------------------------------------------------------------

create policy uploads_select on public.uploads for select to authenticated
using (owner_id = auth.uid() or app.can_read_student_data(student_id));
-- storage_path'in ilk klasörü yükleyenin kendisi olmalı (Storage'da yalnız kendi klasörüne yazar; 0007 uploads_path_owner):
-- başka öğrencinin nesnesine işaret eden sahte satırla indirme ya da mesaja/sınava ekleme yapılamaz.
create policy uploads_insert_own on public.uploads for insert to authenticated
with check (owner_id = auth.uid()
            and split_part(storage_path, '/', 1) = auth.uid()::text
            and (student_id is null or student_id = app.my_student_id() or app.is_admin()
                 or student_id in (select m.sid from app.my_students() as m (sid))));

create policy conversations_select on public.conversations for select to authenticated using (app.can_read_conversation(id));
create policy conversations_insert_own on public.conversations for insert to authenticated
with check (participant_id = auth.uid()
            and ((kind = 'coach' and student_id = app.my_student_id())
                 or (kind = 'parent' and student_id in (select c.sid from app.my_children() as c (sid)))
                 or (kind = 'instructor' and student_id in (select m.sid from app.my_students() as m (sid)))));
create policy conversations_update_own on public.conversations for update to authenticated
using (participant_id = auth.uid()) with check (participant_id = auth.uid());

create policy conversation_messages_select on public.conversation_messages for select to authenticated
using (app.can_read_conversation(conversation_id));
-- kullanıcı yalnız kendi (role='user') mesajını yazar; assistant/system turlarını worker (service_role) yazar: öğrenci
-- model çıktısı taklit edemez. Eklenen yüklemeler yazana ya da sohbetin öğrencisine ait olmalı.
create policy conversation_messages_insert_own on public.conversation_messages for insert to authenticated
with check (role = 'user'
            and exists (select 1 from public.conversations as c
                         where c.id = conversation_messages.conversation_id and c.participant_id = auth.uid()
                           and app.uploads_ok(conversation_messages.upload_ids, c.student_id)));

-- veli yalnız parent_summary.md'yi okur (gece işinin yazdığı veli özeti)
create policy memory_files_select on public.memory_files for select to authenticated
using (app.can_read_student_data(student_id)
       or (path = '/memories/parent_summary.md' and student_id in (select c.sid from app.my_children() as c (sid))));
create policy memory_file_versions_select on public.memory_file_versions for select to authenticated
using (app.can_read_student_data(student_id));
create policy memory_facts_select on public.memory_facts for select to authenticated using (app.can_read_student_data(student_id));
create policy weekly_summaries_select on public.weekly_summaries for select to authenticated using (app.can_read_student(student_id));

-- --- denemeler -------------------------------------------------------------------------------------

-- Öğrenci: oturumu olan sınavlar + app.exam_visible (kendi oluşturduğu, kendine üretilen, kayıtlı dersinin/müfredatının
-- yayımlanmış sınavları; başka öğrenciye üretilen sınav görünmez); veli: çocuğunun oturumu olan sınavlar (başlık);
-- personel: hepsi. Soru metinleri v_exam_questions_student'tadır. Oturum yalnız görünür sınavda açılır (start_exam_session).
create policy exams_select on public.exams for select to authenticated
using (app.is_staff()
       or created_by = auth.uid()
       or exists (select 1 from public.exam_sessions as es where es.exam_id = exams.id)
       or app.exam_visible(id, app.my_student_id()));
create policy exam_questions_select_staff on public.exam_questions for select to authenticated using (app.is_staff());
create policy exam_sessions_select on public.exam_sessions for select to authenticated
using (app.can_read_enrollment(enrollment_id, true));
create policy exam_responses_select on public.exam_responses for select to authenticated
using (exists (select 1 from public.exam_sessions as es
                where es.id = exam_responses.session_id and app.can_read_enrollment(es.enrollment_id, false)));
create policy exam_sources_select_staff on public.exam_sources for select to authenticated using (app.is_staff());
create policy exam_items_select_staff on public.exam_items for select to authenticated using (app.is_staff());
create policy exam_priority_plans_select on public.exam_priority_plans for select to authenticated
using (app.is_staff() or (status = 'approved' and app.can_read_course(course_id)));

-- --- belgeler --------------------------------------------------------------------------------------

-- kind='answer_key' belgelerini yalnız personel görür; diğer türlerde content anahtarsızdır (0010 generated_documents_no_keys).
-- Veli yalnız çocuğunun raporlarını görür: ders geneli yayımlanmış belgeler (deneme, not; soru metni içerir) veliye kapalı
-- (can_read_course çocuğun kaydını da sayar; docs/PLAN-v2-detail.md §2.4).
create policy generated_documents_select on public.generated_documents for select to authenticated
using ((kind <> 'answer_key' or app.is_staff())
       and (created_by = auth.uid()
            or app.is_admin()
            or (student_id is not null and app.can_read_student_data(student_id))
            or (kind = 'report' and student_id in (select c.sid from app.my_children() as c (sid)))
            or (student_id is null
                and (app.is_staff()
                     or (status = 'published' and app.role() is distinct from 'parent' and app.can_read_course(course_id))))));
create policy library_documents_select_staff on public.library_documents for select to authenticated using (app.is_staff());
create policy library_chunks_select_staff on public.library_chunks for select to authenticated using (app.is_staff());

-- --- dersler ---------------------------------------------------------------------------------------

create policy lessons_select on public.lessons for select to authenticated
using (app.is_admin()
       or instructor_id = auth.uid()
       or (enrollment_id is not null and app.is_staff() and app.can_read_enrollment(enrollment_id, false))
       or (enrollment_id is null and app.role() = 'instructor')
       or (student_visible and enrollment_id is not null and app.student_of_enrollment(enrollment_id) = app.my_student_id())
       or (student_visible and enrollment_id is null
           and exists (select 1 from public.enrollments as e where e.course_id = lessons.course_id and e.student_id = app.my_student_id())));
create policy lesson_analyses_select_staff on public.lesson_analyses for select to authenticated
using (app.is_staff() and exists (select 1 from public.lessons as l where l.id = lesson_analyses.lesson_id));
create policy lesson_claims_select_staff on public.lesson_claims for select to authenticated
using (app.is_staff() and exists (select 1 from public.lesson_analyses as la where la.id = lesson_claims.analysis_id));

-- --- bildirimler -----------------------------------------------------------------------------------

create policy notifications_select_own on public.notifications for select to authenticated
using (recipient_id = auth.uid() or app.is_admin());
create policy notifications_update_own on public.notifications for update to authenticated
using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy notification_rules_select_own on public.notification_rules for select to authenticated using (recipient_id = auth.uid());
create policy notification_rules_insert_own on public.notification_rules for insert to authenticated with check (recipient_id = auth.uid());
create policy notification_rules_update_own on public.notification_rules for update to authenticated
using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy notification_rules_delete_own on public.notification_rules for delete to authenticated using (recipient_id = auth.uid());
create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_subscriptions_insert_own on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy push_subscriptions_delete_own on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- --- defter ve değerlendirme (yalnız admin) --------------------------------------------------------

create policy llm_calls_select_admin on public.llm_calls for select to authenticated using (app.is_admin());
create policy spend_ledger_select_admin on public.spend_ledger for select to authenticated using (app.is_admin());
create policy prompt_versions_select_admin on public.prompt_versions for select to authenticated using (app.is_admin());
create policy eval_cases_select_admin on public.eval_cases for select to authenticated using (app.is_admin());
create policy eval_runs_select_admin on public.eval_runs for select to authenticated using (app.is_admin());

-- --- Storage (storage.objects yoksa atlanır; yerel testlerde tests/00_local_stub.sql eşleniği vardır) -------------
-- uploads kovası: yükleyen kendi klasörüne (<auth.uid()>/…) yazar; okuma, okuyanın RLS'iyle görünen ve sahibi nesnenin
-- ilk klasörüyle aynı olan uploads satırına bağlıdır (sahte yolla başkasının nesnesi indirilemez).
-- documents: generated_documents satırının RLS'i (html_path | pdf_path). lessons: yalnız eğitmen/admin.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects yok (yerel Postgres): Storage politikaları atlandı';
    return;
  end if;
  execute $p$drop policy if exists ogrenmen_uploads_insert on storage.objects$p$;
  execute $p$create policy ogrenmen_uploads_insert on storage.objects for insert to authenticated
           with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute $p$drop policy if exists ogrenmen_uploads_select on storage.objects$p$;
  execute $p$create policy ogrenmen_uploads_select on storage.objects for select to authenticated
           using (bucket_id = 'uploads'
                  and exists (select 1 from public.uploads u
                               where u.storage_path = storage.objects.name
                                 and u.owner_id::text = (storage.foldername(storage.objects.name))[1]))$p$;
  execute $p$drop policy if exists ogrenmen_documents_select on storage.objects$p$;
  execute $p$create policy ogrenmen_documents_select on storage.objects for select to authenticated
           using (bucket_id = 'documents' and exists (select 1 from public.generated_documents gd
                                                      where gd.pdf_path = storage.objects.name or gd.html_path = storage.objects.name))$p$;
  execute $p$drop policy if exists ogrenmen_lessons_staff on storage.objects$p$;
  execute $p$create policy ogrenmen_lessons_staff on storage.objects for all to authenticated
           using (bucket_id = 'lessons' and app.is_staff()) with check (bucket_id = 'lessons' and app.is_staff())$p$;
end
$$;
