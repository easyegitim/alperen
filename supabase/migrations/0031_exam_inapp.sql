-- 0031_exam_inapp.sql — P2 uygulama içi deneme (docs/PLAN-v2.md §2 Akış 2b, §13 Test akışı "zamanlayıcı yalnız deneme
-- kipinde"). Zamanlayıcı sunucu tarafındadır: bitiş sınırı = exam_sessions.started_at + app.exam_duration_min (exams.
-- duration_min, yoksa bölüm dakikaları); istemci yalnız gösterir.
--   start_exam_session(p_exam)          öğrencinin sınavın müfredatındaki etkin kaydıyla oturum açar (süren oturum varsa onu)
--                                       ve oynatıcı durumunu döner (0017'deki 3 argümanlı sürüm aynen durur).
--   record_exam_response (yeniden)      0017 davranışı + süre doldu (sınır + settings.exam_time_grace_sec) ise yeni cevap
--                                       OGR-EXAM-008; oturum kapandıktan sonra "nereye kadar" alanları değişmez
--                                       (OGR-EXAM-003: exam_how_far kullanılır, teşhis işi orada atılır).
--   finish_exam_session(p_session)      bitiş = min(now, sınır), grade_exam_session (uygulama içi oturumda karalama
--                                       tuvali/fotoğrafı ya da "nereye kadar" metni olan her yanlış/boş/yetişmeyen soru
--                                       için 'diagnosis.run' notlamada atılır) ve exam_session_view döner. Tekrar çağrı
--                                       aynı görünümü döner.

-- Oynatıcı durumu: {session_id, exam_id, enrollment_id, title, mode, status, started_at, server_now, duration_min,
-- deadline_at, remaining_sec (süresizde null), expired, question_count, sections, answers [{exam_question_id, no, answer,
-- flagged, has_work}]}. Sorular v_exam_questions_student'tan okunur.
create or replace function app.exam_player_state(p_session uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_s public.exam_sessions%rowtype;
  v_x public.exams%rowtype;
  v_deadline timestamptz;
begin
  select es.* into v_s from public.exam_sessions es where es.id = p_session;
  select x.* into v_x from public.exams x where x.id = v_s.exam_id;
  v_deadline := app.exam_deadline(p_session);
  return jsonb_build_object(
    'session_id', v_s.id, 'exam_id', v_x.id, 'enrollment_id', v_s.enrollment_id, 'title', v_x.title, 'mode', v_s.mode,
    'status', v_s.status, 'started_at', v_s.started_at, 'server_now', now(), 'duration_min', app.exam_duration_min(v_x.id),
    'deadline_at', v_deadline,
    'remaining_sec', case when v_deadline is null then null else greatest(0, floor(extract(epoch from (v_deadline - now()))))::int end,
    'expired', coalesce(v_deadline <= now(), false),
    'question_count', (select count(*) from public.exam_questions q where q.exam_id = v_x.id),
    'sections', v_x.sections,
    'answers', (select coalesce(jsonb_agg(jsonb_build_object('exam_question_id', r.exam_question_id, 'no', q.no, 'answer', r.answer,
                                                             'flagged', r.flagged, 'has_work', cardinality(r.work_upload_ids) > 0)
                                          order by q.no), '[]'::jsonb)
                  from public.exam_responses r join public.exam_questions q on q.id = r.exam_question_id
                 where r.session_id = p_session));
end
$$;
comment on function app.exam_player_state(uuid) is 'Uygulama içi deneme oynatıcısının durumu: sunucu saati, bitiş sınırı, kalan süre, verilen cevaplar.';

create or replace function public.start_exam_session(p_exam uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
  v_cur uuid;
  v_course uuid;
  v_enr uuid;
  v_id uuid;
begin
  if v_student is null or auth.uid() is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 uygulama içi deneme yalnız öğrenci oturumunda başlar';
  end if;
  select x.curriculum_id, x.course_id into v_cur, v_course from public.exams x where x.id = p_exam;
  if v_cur is null then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 sınav bulunamadı';
  end if;
  select e.id into v_enr from public.enrollments e
   where e.student_id = v_student and e.status = 'active' and e.curriculum_id = v_cur
   order by (e.course_id is not distinct from v_course) desc, e.created_at desc, e.id
   limit 1;
  if v_enr is null then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-002 bu sınavın müfredatında etkin kaydın yok';
  end if;
  v_id := public.start_exam_session(p_exam, v_enr, 'in_app');
  return app.exam_player_state(v_id);
end
$$;
comment on function public.start_exam_session(uuid) is 'Öğrenci: uygulama içi deneme oturumu (sınavın müfredatındaki etkin kayıt; süren oturum varsa o) + oynatıcı durumu (sunucu zamanlayıcısı).';

-- 0017 davranışı; ek: uygulama içi oturumda süre sınırı + exam_time_grace_sec (30 sn) geçtiyse yeni ya da değişen
-- cevap OGR-EXAM-008 (karalama, nereye-kadar metni ve işaret serbest; oturumu finish_exam_session kapatır). Oturum
-- in_progress değilken p_how_far_text / p_work_upload_ids değiştirilemez (OGR-EXAM-003): notlanmış soruya "nereye kadar
-- geldim" exam_how_far ile gönderilir (doğrulama + teşhis işi orada); aynı değerin tekrarı sessizce kabul.
create or replace function public.record_exam_response(
  p_session uuid, p_exam_question uuid, p_answer text default null, p_time_spent_sec int default null,
  p_flagged boolean default null, p_work_upload_ids uuid[] default null, p_how_far_text text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_s public.exam_sessions%rowtype;
  v_answer text := nullif(upper(btrim(p_answer)), '');
  v_old text;
  v_old_text text;
  v_old_ids uuid[];
  v_id uuid;
  v_deadline timestamptz;
begin
  -- FOR SHARE: süre dolarken istemcinin kuyruktaki cevapları finish_exam_session'la (FOR UPDATE) yarışır; paylaşılan kilit
  -- bitirmenin işlemesini bekler, oturumu analysing görür ve OGR-EXAM-003 döner (notlanmış cevap sonradan değişmez)
  select es.* into v_s from public.exam_sessions es where es.id = p_session for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 oturum bulunamadı';
  end if;
  perform app.assert_student_access(app.student_of_enrollment(v_s.enrollment_id), true);
  if not exists (select 1 from public.exam_questions q where q.id = p_exam_question and q.exam_id = v_s.exam_id) then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-004 soru bu oturumun sınavında değil';
  end if;
  if not app.uploads_ok(p_work_upload_ids, app.student_of_enrollment(v_s.enrollment_id)) then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-006 work_upload_ids bu öğrenciye ait değil';
  end if;
  select r.id, r.answer, r.how_far_text, r.work_upload_ids into v_id, v_old, v_old_text, v_old_ids
    from public.exam_responses r where r.session_id = p_session and r.exam_question_id = p_exam_question;
  if v_s.status <> 'in_progress'
     and ((p_how_far_text is not null and p_how_far_text is distinct from v_old_text)
          or (p_work_upload_ids is not null and p_work_upload_ids is distinct from coalesce(v_old_ids, '{}'))) then
    raise exception using errcode = 'P0001',
      message = format('OGR-EXAM-003 oturum %s: "nereye kadar geldim" exam_how_far ile gönderilir', v_s.status);
  end if;
  if v_s.status <> 'in_progress' and v_answer is distinct from v_old and v_answer is not null then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-003 oturum %s: cevap değiştirilemez', v_s.status);
  end if;
  if v_s.status = 'in_progress' and v_answer is distinct from v_old then
    v_deadline := app.exam_deadline(p_session);
    if v_deadline is not null and now() > v_deadline + make_interval(secs => app.setting_num('exam_time_grace_sec', 30)) then
      raise exception using errcode = 'P0001', message = 'OGR-EXAM-008 süre doldu: cevap yazılamaz, oturumu bitir';
    end if;
  end if;
  if v_id is null then
    if v_s.status <> 'in_progress' then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-003 oturum %s: yeni cevap yazılamaz', v_s.status);
    end if;
    insert into public.exam_responses (session_id, exam_question_id, answer, time_spent_sec, flagged, work_upload_ids, how_far_text)
    values (p_session, p_exam_question, v_answer, p_time_spent_sec, coalesce(p_flagged, false), coalesce(p_work_upload_ids, '{}'), p_how_far_text)
    returning id into v_id;
  else
    update public.exam_responses r
       set answer = case when v_s.status = 'in_progress' then v_answer else r.answer end,
           time_spent_sec = coalesce(p_time_spent_sec, r.time_spent_sec),
           flagged = coalesce(p_flagged, r.flagged),
           work_upload_ids = coalesce(p_work_upload_ids, r.work_upload_ids),
           how_far_text = coalesce(p_how_far_text, r.how_far_text)
     where r.id = v_id;
  end if;
  return v_id;
end
$$;
comment on function public.record_exam_response(uuid, uuid, text, int, boolean, uuid[], text) is 'Sınav cevabını yazar (upsert); bitmiş oturumda cevap ve nereye-kadar alanları değişmez (exam_how_far); uygulama içi süre dolduysa cevap OGR-EXAM-008.';

create or replace function public.finish_exam_session(p_session uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_s public.exam_sessions%rowtype;
  v_deadline timestamptz;
  v_end timestamptz;
begin
  select es.* into v_s from public.exam_sessions es where es.id = p_session for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 oturum bulunamadı';
  end if;
  perform app.assert_student_access(app.student_of_enrollment(v_s.enrollment_id), true);
  if v_s.mode <> 'in_app' then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-003 yalnız uygulama içi oturum bitirilir';
  end if;
  if v_s.status in ('analysing', 'done') then
    return public.exam_session_view(p_session);
  end if;
  if v_s.status <> 'in_progress' then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-003 oturum %s: bitirilemez', v_s.status);
  end if;
  v_deadline := app.exam_deadline(p_session);
  v_end := least(now(), coalesce(v_deadline, now()));
  update public.exam_sessions es
     set finished_at = v_end, duration_sec = greatest(0, extract(epoch from (v_end - es.started_at)))::int
   where es.id = p_session;
  -- notlama, karalama tuvali / fotoğrafı ya da "nereye kadar" metni olan yanlış, boş ve yetişmeyen soruları kendiliğinden
  -- teşhise gönderir (grade_exam_session, uygulama içi kip)
  perform public.grade_exam_session(p_session);
  return public.exam_session_view(p_session);
end
$$;
comment on function public.finish_exam_session(uuid) is 'Öğrenci: uygulama içi denemeyi bitirir (bitiş ≤ süre sınırı), notlar (karalamalı ya da metinli yanlış/boş/yetişmeyenler için diagnosis.run notlamada); exam_session_view döner.';

revoke all on function app.exam_player_state(uuid) from public;
revoke all on function public.start_exam_session(uuid), public.finish_exam_session(uuid) from public, anon;
grant execute on function public.start_exam_session(uuid), public.finish_exam_session(uuid) to authenticated, service_role;
