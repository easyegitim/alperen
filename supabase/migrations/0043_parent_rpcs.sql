-- 0043_parent_rpcs.sql — veli deneyimi (P6; docs/PLAN-v2.md §10, mockup S10 Veli özet, S10b Veli sohbet).
--
-- Veli ajanının araçları ve özet ekranı bu SECURITY DEFINER RPC'lerden okur; hepsi yalnız oturumdaki velinin AKTİF
-- guardian_links çocuğuna açıktır (app.assert_parent_of; güvenilir çağıran — worker — da okuyabilir). Dışlamalar burada
-- ve RLS'tedir, prompt'ta değil: koç sohbeti, gözlemler, ham ustalık olasılığı (p), sınav soruları, cevaplar ve cevap
-- anahtarları, ham yüklemeler, ders transkripti hiçbir dönüşte yoktur.
--
--   parent_child_summary(p_student)                özet ekranının tek cümlesi için yapısal veri: bu hafta tahmini süre,
--                                                  soru sayısı, son deneme neti, ders başına bant ve yön, parent_summary.md
--   parent_mastery_overview(p_student, p_course)   ders başına bantlar (düşük/orta/yüksek/yetersiz) + kazanım bandı ve kanıt
--                                                  sayısı; p yok
--   parent_recent_activity(p_student, p_days)      son günlerin etkinlikleri ve gün başına süre/soru
--   parent_exam_sessions(p_student, p_limit)       deneme skorları (toplam, doğru/yanlış/boş, net, bölümler) + rapor kimliği
--   parent_reports(p_student, p_limit)             rapor belgeleri (hazır olanlar + velinin kendi istekleri)
--   parent_request_report(p_student, p_kind, p_params)   generated_documents(kind report, queued) + 'report.generate' işi;
--                                                  günlük sınır settings.parent_reports_daily_max (3), başarısızlar sayılmaz
--   parent_open_conversation, parent_history, parent_append_message, parent_log_llm_call, parent_claim_turn,
--   parent_release_turn                            veli sohbeti (kind = 'parent'); koç RPC'leriyle aynı sunucu jetonu
--                                                  (app.coach_server_ok: HMAC 'coach:<sohbet>:<bitiş>', web_coach anahtarı;
--                                                  jeton sohbete bağlıdır). Koç sohbeti ASLA (42501).
--
-- "Tahmini süre": alıştırma cevap süreleri (cevap başına en çok 10 dk; süre yoksa 90 sn) + uygulama içi deneme süresi
-- (en çok 4 sa) + yüklenen denemenin sınav süresi + öğrenciye ait birebir ders süresi + incelenen çözüm fotoğrafı başına 3 dk.
-- Hafta: velinin saat diliminde (profiles.tz, varsayılan Europe/Istanbul) pazartesi 00:00'dan.
--
-- Hata kodları: OGR-AUTH-001 veli bu öğrencinin aktif velisi değil (42501), OGR-PARENT-001 sohbet/mesaj geçersiz,
-- OGR-PARENT-002 ders çocuğun kaydı değil, OGR-REPORT-001 geçersiz rapor isteği, OGR-REPORT-002 günlük rapor sınırı.

insert into public.settings (key, value, description) values
  ('parent_reports_daily_max', '3', 'Velinin bir çocuğu için günde isteyebileceği rapor sayısı (başarısızlar sayılmaz)')
on conflict (key) do nothing;

-- --- yardımcılar ----------------------------------------------------------------------------------------------------------

-- Oturumdaki veli bu öğrencinin aktif velisi mi; değilse 42501. Güvenilir çağıran (worker) geçer.
create or replace function app.assert_parent_of(p_student uuid) returns void
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if app.is_trusted() then
    return;
  end if;
  if p_student is not null and auth.uid() is not null and app.role() = 'parent'
     and exists (select 1 from app.my_children() as c (sid) where c.sid = p_student) then
    return;
  end if;
  raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu öğrenci için veli yetkisi yok (yalnız aktif bağlı veli)';
end
$$;
comment on function app.assert_parent_of(uuid) is 'Oturumdaki veli öğrencinin aktif velisi değilse OGR-AUTH-001 (42501); güvenilir çağıran geçer.';

-- Velinin (yoksa varsayılan) saat dilimi.
create or replace function app.viewer_tz() returns text
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_tz text;
begin
  select pr.tz into v_tz from public.profiles pr where pr.id = auth.uid();
  if v_tz is null or not exists (select 1 from pg_timezone_names z where z.name = v_tz) then
    v_tz := 'Europe/Istanbul';
  end if;
  return v_tz;
end
$$;
comment on function app.viewer_tz() is 'Oturumdaki kullanıcının saat dilimi (profiles.tz; geçersiz ya da yoksa Europe/Istanbul).';

-- Kısa Türkçe tarih: '2 Kas'.
create or replace function app.tr_date_short(p_d date) returns text
language sql
immutable
as $$
  select extract(day from p_d)::int || ' '
         || (array['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'])[extract(month from p_d)::int]
$$;
comment on function app.tr_date_short(date) is 'Kısa Türkçe tarih (''2 Kas'').';

-- Çalışma ölçüleri [p_from, p_to): {minutes (tahmini), questions, practice_sets, exams, diagnoses, active_days}.
create or replace function app.child_study_stats(p_student uuid, p_from timestamptz, p_to timestamptz, p_tz text) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_sec numeric := 0;
  v_q int := 0;
  v_sets int;
  v_exams int;
  v_diag int;
  v_days int;
begin
  with ev as (
    select least(coalesce(a.response_ms, 90000), 600000) / 1000.0 as sec, 1 as q, a.created_at as at
      from public.attempts a join public.enrollments e on e.id = a.enrollment_id
     where e.student_id = p_student and a.created_at >= p_from and a.created_at < p_to
    union all
    select case when es.mode = 'in_app' then least(coalesce(es.duration_sec, 0), 14400)
                else least(coalesce(x.duration_min, 0) * 60, 14400) end,
           (select count(*) from public.exam_responses r
             where r.session_id = es.id and r.outcome in ('correct', 'wrong'))::int,
           es.finished_at
      from public.exam_sessions es join public.enrollments e on e.id = es.enrollment_id join public.exams x on x.id = es.exam_id
     where e.student_id = p_student and es.finished_at >= p_from and es.finished_at < p_to and es.status in ('analysing', 'done')
    union all
    select 180, 1, sa.created_at
      from public.solution_analyses sa join public.enrollments e on e.id = sa.enrollment_id
     where e.student_id = p_student and sa.created_at >= p_from and sa.created_at < p_to and sa.verdict <> 'unreadable'
    union all
    select least(coalesce(l.duration_sec, l.duration_min * 60, 0), 14400), 0, l.held_at
      from public.lessons l join public.enrollments e on e.id = l.enrollment_id
     where e.student_id = p_student and l.held_at >= p_from and l.held_at < p_to
  )
  select coalesce(sum(ev.sec), 0), coalesce(sum(ev.q), 0)::int, count(distinct (ev.at at time zone p_tz)::date)::int
    into v_sec, v_q, v_days
    from ev;
  select count(*) into v_sets from public.practice_sets ps join public.enrollments e on e.id = ps.enrollment_id
   where e.student_id = p_student and ps.status = 'finished' and ps.finished_at >= p_from and ps.finished_at < p_to;
  select count(*) into v_exams from public.exam_sessions es join public.enrollments e on e.id = es.enrollment_id
   where e.student_id = p_student and es.status in ('analysing', 'done') and es.finished_at >= p_from and es.finished_at < p_to;
  select count(*) into v_diag from public.solution_analyses sa join public.enrollments e on e.id = sa.enrollment_id
   where e.student_id = p_student and sa.created_at >= p_from and sa.created_at < p_to and sa.verdict <> 'unreadable';
  return jsonb_build_object('minutes', round(v_sec / 60)::int, 'hours', round(v_sec / 3600, 1), 'questions', v_q,
                            'practice_sets', v_sets, 'exams', v_exams, 'diagnoses', v_diag, 'active_days', v_days);
end
$$;
comment on function app.child_study_stats(uuid, timestamptz, timestamptz, text) is 'Öğrencinin aralıktaki tahmini çalışma süresi, soru sayısı, alıştırma/deneme/teşhis sayıları ve etkin gün sayısı.';

-- Ders (kayıt) başına bantlar ve son 7 günün yönü: up | steady | down | null (bu hafta ustalık değişimi yok).
create or replace function app.child_course_bands(p_student uuid, p_course uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_min int := app.setting_num('min_evidence', 5)::int;
  v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'course_id', z.course_id, 'enrollment_id', z.enrollment_id, 'title', z.title, 'target_exam', z.target_exam,
           'bands', z.bands, 'trend', z.trend) order by z.started_at, z.enrollment_id), '[]'::jsonb)
    into v_out
    from (select e.id as enrollment_id, e.course_id, e.started_at, e.target_exam, coalesce(co.title, cu.label) as title,
                 (select jsonb_build_object('low', count(*) filter (where m.evidence_count >= v_min and m.p < 0.5),
                                            'mid', count(*) filter (where m.evidence_count >= v_min and m.p >= 0.5 and m.p < 0.8),
                                            'high', count(*) filter (where m.evidence_count >= v_min and m.p >= 0.8),
                                            'insufficient', count(*) filter (where m.evidence_count < v_min))
                    from public.mastery m
                    join public.skills s on s.curriculum_id = m.curriculum_id and s.id = m.skill_id and s.is_leaf
                   where m.enrollment_id = e.id) as bands,
                 (select case when count(*) = 0 then null
                              when sum(h.p_after - coalesce(h.p_before, h.p_after)) >= 0.05 then 'up'
                              when sum(h.p_after - coalesce(h.p_before, h.p_after)) <= -0.05 then 'down'
                              else 'steady' end
                    from public.mastery_history h
                   where h.enrollment_id = e.id and h.created_at >= now() - interval '7 days') as trend
            from public.enrollments e
            left join public.courses co on co.id = e.course_id
            left join public.curricula cu on cu.id = e.curriculum_id
           where e.student_id = p_student and e.status = 'active' and (p_course is null or e.course_id = p_course)) z;
  return v_out;
end
$$;
comment on function app.child_course_bands(uuid, uuid) is 'Öğrencinin etkin kayıtları: ders, bant sayıları (kanıt < min_evidence: yetersiz) ve 7 günlük yön.';

-- --- özet ve araçlar ------------------------------------------------------------------------------------------------------

-- {student {id, name, grade}, tz, week {start, minutes, hours, questions, practice_sets, exams, diagnoses, active_days},
--  prev_week {...}, last_exam {session_id, title, finished_at, net, total, correct, wrong, blank, report_document_id} | null,
--  courses [{course_id, enrollment_id, title, target_exam, bands {low, mid, high, insufficient}, trend}], open_misconceptions,
--  summary_md | null, summary_updated_at, latest_report {id, title, status, created_at, ready} | null, last_activity_at}
create or replace function public.parent_child_summary(p_student uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_tz text := app.viewer_tz();
  v_week timestamptz := date_trunc('week', now() at time zone v_tz) at time zone v_tz;
  v_student jsonb;
  v_last jsonb;
  v_md public.memory_files%rowtype;
  v_report jsonb;
begin
  perform app.assert_parent_of(p_student);
  select jsonb_build_object('id', s.id, 'name', app.first_name(pr.display_name), 'grade', s.grade) into v_student
    from public.students s left join public.profiles pr on pr.id = s.profile_id where s.id = p_student;
  if v_student is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu öğrenci için veli yetkisi yok (yalnız aktif bağlı veli)';
  end if;
  select jsonb_build_object('session_id', es.id, 'title', x.title, 'finished_at', es.finished_at, 'net', es.score -> 'net',
                            'total', es.score -> 'total', 'correct', es.score -> 'correct', 'wrong', es.score -> 'wrong',
                            'blank', coalesce((es.score ->> 'blank')::int, 0) + coalesce((es.score ->> 'unfinished')::int, 0),
                            'report_document_id', es.report_document_id)
    into v_last
    from public.exam_sessions es
    join public.enrollments e on e.id = es.enrollment_id
    join public.exams x on x.id = es.exam_id
   where e.student_id = p_student and es.status in ('analysing', 'done') and es.score is not null
   order by es.finished_at desc nulls last, es.id limit 1;
  select mf.* into v_md from public.memory_files mf where mf.student_id = p_student and mf.path = '/memories/parent_summary.md';
  select jsonb_build_object('id', gd.id, 'title', gd.title, 'status', gd.status, 'created_at', gd.created_at,
                            'ready', gd.status in ('rendered', 'published'))
    into v_report
    from public.generated_documents gd
   where gd.student_id = p_student and gd.kind = 'report' and gd.status in ('rendered', 'published')
     and (not gd.review_required or gd.status = 'published')
     and (coalesce(gd.spec ->> 'source', '') <> 'parent' or gd.created_by = auth.uid())
   order by gd.created_at desc limit 1;
  return jsonb_build_object(
    'student', v_student, 'tz', v_tz,
    'week', jsonb_build_object('start', (v_week at time zone v_tz)::date) || app.child_study_stats(p_student, v_week, v_week + interval '7 days', v_tz),
    'prev_week', jsonb_build_object('start', ((v_week - interval '7 days') at time zone v_tz)::date)
                 || app.child_study_stats(p_student, v_week - interval '7 days', v_week, v_tz),
    'last_exam', v_last,
    'courses', app.child_course_bands(p_student, null),
    'open_misconceptions', (select count(*) from public.misconceptions mc join public.enrollments e on e.id = mc.enrollment_id
                             where e.student_id = p_student and e.status = 'active' and mc.status = 'open'),
    'summary_md', nullif(v_md.content, ''), 'summary_updated_at', v_md.updated_at,
    'latest_report', v_report,
    'last_activity_at', app.child_last_activity(p_student));
end
$$;
comment on function public.parent_child_summary(uuid) is 'Veli: çocuğun özet verisi (bu hafta tahmini süre/soru, son deneme, ders bantları ve yönü, parent_summary.md, son rapor); koç sohbeti ve p yok.';

-- {courses [{course_id, enrollment_id, title, target_exam, bands, trend, skills [{skill_id, name, unit, band, evidence_count,
--   last_evidence_at}] (kanıtı olanlar, ≤ 80; band null: kanıt yetersiz)}]}
create or replace function public.parent_mastery_overview(p_student uuid, p_course uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_min int := app.setting_num('min_evidence', 5)::int;
  v_courses jsonb;
  v_out jsonb := '[]'::jsonb;
  v_c jsonb;
  v_skills jsonb;
begin
  perform app.assert_parent_of(p_student);
  if p_course is not null and not exists (select 1 from public.enrollments e
                                           where e.student_id = p_student and e.course_id = p_course and e.status = 'active') then
    raise exception using errcode = 'P0001', message = 'OGR-PARENT-002 ders çocuğun etkin kaydı değil';
  end if;
  v_courses := app.child_course_bands(p_student, p_course);
  for v_c in select x.v from jsonb_array_elements(v_courses) as x (v) loop
    select coalesce(jsonb_agg(jsonb_build_object('skill_id', z.skill_id, 'name', z.name, 'unit', z.unit, 'band', z.band,
                                                 'evidence_count', z.evidence_count, 'last_evidence_at', z.last_evidence_at)
                              order by z.ord, z.name), '[]'::jsonb)
      into v_skills
      from (select m.skill_id, s.name, ps.name as unit, m.evidence_count, m.last_evidence_at,
                   case when m.evidence_count < v_min then null when m.p < 0.5 then 'low' when m.p < 0.8 then 'mid' else 'high' end as band,
                   case when m.evidence_count < v_min then 3 when m.p < 0.5 then 0 when m.p < 0.8 then 1 else 2 end as ord
              from public.mastery m
              join public.skills s on s.curriculum_id = m.curriculum_id and s.id = m.skill_id and s.is_leaf
              left join public.skills ps on ps.curriculum_id = s.curriculum_id and ps.id = s.parent_id
             where m.enrollment_id = (v_c ->> 'enrollment_id')::uuid and m.evidence_count > 0
             order by ord, name limit 80) z;
    v_out := v_out || jsonb_build_array(v_c || jsonb_build_object('skills', v_skills));
  end loop;
  return jsonb_build_object('min_evidence', v_min, 'courses', v_out);
end
$$;
comment on function public.parent_mastery_overview(uuid, uuid) is 'Veli: ders başına ustalık bantları ve kazanım bandı + kanıt sayısı (olasılık p yok).';

-- {days, from, per_day [{date, minutes, questions}], items [{at, kind practice|exam|uploads|misconception_resolved|report,
--   title, detail}] (en yeni önce, ≤ 60)}
create or replace function public.parent_recent_activity(p_student uuid, p_days int default 7) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_tz text := app.viewer_tz();
  v_days int := least(greatest(coalesce(p_days, 7), 1), 60);
  v_from timestamptz;
  v_items jsonb;
  v_per_day jsonb;
begin
  perform app.assert_parent_of(p_student);
  v_from := (((now() at time zone v_tz)::date - (v_days - 1))::timestamp) at time zone v_tz;
  select coalesce(jsonb_agg(z.item order by z.at desc), '[]'::jsonb)
    into v_items
    from (select y.at, y.item from (
            select ps.finished_at as at,
                   jsonb_build_object('at', ps.finished_at, 'kind', 'practice', 'title', 'Alıştırma',
                                      'detail', jsonb_build_object('total', ps.summary -> 'total', 'answered', ps.summary -> 'answered',
                                                                   'correct', ps.summary -> 'correct')) as item
              from public.practice_sets ps join public.enrollments e on e.id = ps.enrollment_id
             where e.student_id = p_student and ps.status = 'finished' and ps.finished_at >= v_from
            union all
            select es.finished_at,
                   jsonb_build_object('at', es.finished_at, 'kind', 'exam', 'title', x.title,
                                      'detail', jsonb_build_object('session_id', es.id, 'net', es.score -> 'net', 'total', es.score -> 'total'))
              from public.exam_sessions es join public.enrollments e on e.id = es.enrollment_id join public.exams x on x.id = es.exam_id
             where e.student_id = p_student and es.status in ('analysing', 'done') and es.finished_at >= v_from
            union all
            select max(sa.created_at),
                   jsonb_build_object('at', max(sa.created_at), 'kind', 'uploads', 'title', 'Çözüm fotoğrafları incelendi',
                                      'detail', jsonb_build_object('count', count(*), 'date', (sa.created_at at time zone v_tz)::date))
              from public.solution_analyses sa join public.enrollments e on e.id = sa.enrollment_id
             where e.student_id = p_student and sa.created_at >= v_from and sa.verdict <> 'unreadable'
             group by (sa.created_at at time zone v_tz)::date
            union all
            select mc.resolved_at,
                   jsonb_build_object('at', mc.resolved_at, 'kind', 'misconception_resolved', 'title', s.name,
                                      'detail', jsonb_build_object('skill_id', mc.skill_id))
              from public.misconceptions mc join public.enrollments e on e.id = mc.enrollment_id
              join public.skills s on s.curriculum_id = mc.curriculum_id and s.id = mc.skill_id
             where e.student_id = p_student and mc.status = 'resolved' and mc.resolved_at >= v_from
            union all
            select coalesce(gd.published_at, gd.updated_at),
                   jsonb_build_object('at', coalesce(gd.published_at, gd.updated_at), 'kind', 'report', 'title', gd.title,
                                      'detail', jsonb_build_object('document_id', gd.id))
              from public.generated_documents gd
             where gd.student_id = p_student and gd.kind = 'report' and gd.status in ('rendered', 'published')
               and (not gd.review_required or gd.status = 'published') and coalesce(gd.published_at, gd.updated_at) >= v_from
               and (coalesce(gd.spec ->> 'source', '') <> 'parent' or gd.created_by = auth.uid())
          ) y order by y.at desc limit 60) z;
  select coalesce(jsonb_agg(jsonb_build_object('date', d.day) || app.child_study_stats(p_student, d.day_from, d.day_from + interval '1 day', v_tz)
                            - 'practice_sets' - 'exams' - 'diagnoses' - 'active_days' - 'hours' order by d.day), '[]'::jsonb)
    into v_per_day
    from (select g.day::date as day, (g.day::timestamp at time zone v_tz) as day_from
            from generate_series((v_from at time zone v_tz)::date, (now() at time zone v_tz)::date, interval '1 day') as g (day)) d;
  return jsonb_build_object('days', v_days, 'from', (v_from at time zone v_tz)::date, 'per_day', v_per_day, 'items', v_items);
end
$$;
comment on function public.parent_recent_activity(uuid, int) is 'Veli: son günlerin etkinlikleri (alıştırma, deneme, çözüm fotoğrafı, çözülen yanılgı, rapor) ve gün başına süre/soru.';

-- [{session_id, title, kind, mode, status, started_at, finished_at, score {total, correct, wrong, blank, net, sections
--  [{section, total, correct, wrong, blank, net}]}, report_document_id, report_ready}] — soru, cevap, anahtar yok.
create or replace function public.parent_exam_sessions(p_student uuid, p_limit int default 10) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_out jsonb;
begin
  perform app.assert_parent_of(p_student);
  select coalesce(jsonb_agg(jsonb_build_object(
           'session_id', z.id, 'title', z.title, 'kind', z.kind, 'mode', z.mode, 'status', z.status, 'started_at', z.started_at,
           'finished_at', z.finished_at,
           'score', case when z.score is null then null else jsonb_build_object(
                      'total', z.score -> 'total', 'correct', z.score -> 'correct', 'wrong', z.score -> 'wrong',
                      'blank', coalesce((z.score ->> 'blank')::int, 0) + coalesce((z.score ->> 'unfinished')::int, 0),
                      'net', z.score -> 'net',
                      'sections', coalesce((select jsonb_agg(jsonb_build_object(
                                                   'section', sec.e -> 'section', 'total', sec.e -> 'total', 'correct', sec.e -> 'correct',
                                                   'wrong', sec.e -> 'wrong',
                                                   'blank', coalesce((sec.e ->> 'blank')::int, 0) + coalesce((sec.e ->> 'unfinished')::int, 0),
                                                   'net', sec.e -> 'net'))
                                              from jsonb_array_elements(case when jsonb_typeof(z.score -> 'sections') = 'array'
                                                                             then z.score -> 'sections' else '[]'::jsonb end) as sec (e)),
                                           '[]'::jsonb)) end,
           'report_document_id', z.report_document_id, 'report_ready', z.report_ready)
         order by z.finished_at desc nulls last, z.started_at desc), '[]'::jsonb)
    into v_out
    from (select es.id, x.title, x.kind, es.mode, es.status, es.started_at, es.finished_at, es.score, es.report_document_id,
                 coalesce((select gd.status in ('rendered', 'published') from public.generated_documents gd
                            where gd.id = es.report_document_id), false) as report_ready
            from public.exam_sessions es
            join public.enrollments e on e.id = es.enrollment_id
            join public.exams x on x.id = es.exam_id
           where e.student_id = p_student and es.status in ('grading', 'analysing', 'done')
           order by es.finished_at desc nulls last, es.started_at desc
           limit least(greatest(coalesce(p_limit, 10), 1), 50)) z;
  return v_out;
end
$$;
comment on function public.parent_exam_sessions(uuid, int) is 'Veli: çocuğun deneme oturumları (skor, bölüm netleri, rapor); soru, cevap ve anahtar yok.';

-- [{id, title, report_kind, status, ready, created_at, published_at, pdf_path (hazırsa), requested_by_me}]
create or replace function public.parent_reports(p_student uuid, p_limit int default 20) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_out jsonb;
begin
  perform app.assert_parent_of(p_student);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', z.id, 'title', z.title, 'report_kind', coalesce(z.spec ->> 'report_kind', 'weekly'), 'status', z.status,
           'ready', z.ready, 'created_at', z.created_at, 'published_at', z.published_at,
           'pdf_path', case when z.ready then z.pdf_path end, 'requested_by_me', z.created_by is not distinct from auth.uid())
         order by z.created_at desc), '[]'::jsonb)
    into v_out
    from (select gd.id, gd.title, gd.spec, gd.status, gd.created_at, gd.published_at, gd.pdf_path, gd.created_by,
                 gd.status in ('rendered', 'published') and (not gd.review_required or gd.status = 'published') as ready
            from public.generated_documents gd
           where gd.student_id = p_student and gd.kind = 'report'
             and (((gd.status in ('rendered', 'published') and (not gd.review_required or gd.status = 'published'))
                   and (coalesce(gd.spec ->> 'source', '') <> 'parent' or gd.created_by = auth.uid()))
                  or (auth.uid() is not null and gd.created_by = auth.uid()))
           order by gd.created_at desc
           limit least(greatest(coalesce(p_limit, 20), 1), 100)) z;
  return v_out;
end
$$;
comment on function public.parent_reports(uuid, int) is 'Veli: çocuğun hazır raporları ve kendi rapor isteklerinin durumu.';

-- Rapor isteği. p_kind weekly | exam | topic | trend | custom; p_params (bilinmeyen anahtar atılır):
--   weekly {week_start?: 'YYYY-MM-DD' (≤ 1 yıl geriye; varsayılan bu hafta)}; exam {session_id (çocuğun bitmiş oturumu)};
--   topic {course_id?, skill_ids? (≤ 12, kaydın müfredatında), topic? (≤ 120); skill_ids ya da topic gerekli};
--   trend {weeks? 2–26 (8), course_id?}; custom {question (5–500)}.
-- Döner: {document_id, title, status, report_kind, job_id, used, max}.
create or replace function public.parent_request_report(p_student uuid, p_kind text, p_params jsonb default '{}'::jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_tz text := app.viewer_tz();
  v_p jsonb := coalesce(p_params, '{}'::jsonb);
  v_params jsonb := '{}'::jsonb;
  v_course uuid;
  v_cur uuid;
  v_title text;
  v_week date;
  v_sess uuid;
  v_exam_title text;
  v_skills text[];
  v_topic text;
  v_weeks int;
  v_q text;
  v_max int := app.setting_num('parent_reports_daily_max', 3)::int;
  v_used int;
  v_doc uuid;
  v_job uuid;
begin
  if app.is_trusted() or auth.uid() is null or app.role() is distinct from 'parent' then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 rapor isteği yalnız velinin kendisinden';
  end if;
  perform app.assert_parent_of(p_student);
  if coalesce(p_kind, '') not in ('weekly', 'exam', 'topic', 'trend', 'custom') then
    raise exception using errcode = 'P0001', message = format('OGR-REPORT-001 geçersiz rapor türü %s', coalesce(p_kind, '(boş)'));
  end if;
  if jsonb_typeof(v_p) <> 'object' then
    raise exception using errcode = 'P0001', message = 'OGR-REPORT-001 parametreler nesne olmalı';
  end if;

  -- ders: verilirse çocuğun etkin kaydı olmalı; yoksa en son açılan etkin kaydın dersi
  if v_p ? 'course_id' and jsonb_typeof(v_p -> 'course_id') <> 'null' then
    if coalesce(v_p ->> 'course_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from public.enrollments e
                       where e.student_id = p_student and e.status = 'active' and e.course_id = (v_p ->> 'course_id')::uuid) then
      raise exception using errcode = 'P0001', message = 'OGR-REPORT-001 course_id çocuğun etkin kaydının dersi olmalı';
    end if;
    v_course := (v_p ->> 'course_id')::uuid;
    v_params := v_params || jsonb_build_object('course_id', v_course);
  end if;
  select e.course_id, e.curriculum_id into v_course, v_cur from public.enrollments e
   where e.student_id = p_student and e.status = 'active' and (v_course is null or e.course_id = v_course)
   order by e.started_at desc limit 1;

  if p_kind = 'weekly' then
    if v_p ? 'week_start' and jsonb_typeof(v_p -> 'week_start') <> 'null' then
      if coalesce(v_p ->> 'week_start', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode = 'P0001', message = 'OGR-REPORT-001 week_start YYYY-AA-GG olmalı';
      end if;
      begin
        v_week := (v_p ->> 'week_start')::date;
      exception when others then
        raise exception using errcode = 'P0001', message = 'OGR-REPORT-001 week_start geçerli bir tarih olmalı';
      end;
      v_week := date_trunc('week', v_week)::date;
    else
      v_week := date_trunc('week', now() at time zone v_tz)::date;
    end if;
    if v_week > (now() at time zone v_tz)::date or v_week < (now() at time zone v_tz)::date - 366 then
      raise exception using errcode = 'P0001', message = 'OGR-REPORT-001 week_start son bir yıl içinde olmalı';
    end if;
    v_params := v_params || jsonb_build_object('week_start', v_week);
    v_title := 'Haftalık rapor · ' || app.tr_date_short(v_week);
  elsif p_kind = 'exam' then
    if coalesce(v_p ->> 'session_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P0001', message = 'OGR-REPORT-001 session_id gerekli';
    end if;
    v_sess := (v_p ->> 'session_id')::uuid;
    select x.title, e.course_id into v_exam_title, v_course
      from public.exam_sessions es join public.enrollments e on e.id = es.enrollment_id join public.exams x on x.id = es.exam_id
     where es.id = v_sess and e.student_id = p_student and es.status in ('analysing', 'done') and es.score is not null;
    if v_exam_title is null then
      raise exception using errcode = 'P0001', message = 'OGR-REPORT-001 oturum çocuğun değerlendirilmiş denemesi değil';
    end if;
    v_params := v_params || jsonb_build_object('session_id', v_sess);
    v_title := 'Deneme raporu · ' || v_exam_title;
  elsif p_kind = 'topic' then
    if v_p ? 'skill_ids' and jsonb_typeof(v_p -> 'skill_ids') <> 'null' then
      if jsonb_typeof(v_p -> 'skill_ids') <> 'array' or jsonb_array_length(v_p -> 'skill_ids') not between 1 and 12
         or exists (select 1 from jsonb_array_elements(v_p -> 'skill_ids') as x (v) where jsonb_typeof(x.v) <> 'string') then
        raise exception using errcode = 'P0001', message = 'OGR-REPORT-001 skill_ids 1–12 kazanım kodundan oluşan dizi olmalı';
      end if;
      select array_agg(distinct x.v order by x.v) into v_skills from jsonb_array_elements_text(v_p -> 'skill_ids') as x (v);
      if exists (select 1 from unnest(v_skills) as k (id)
                  where not exists (select 1 from public.skills s where s.curriculum_id = v_cur and s.id = k.id)) then
        raise exception using errcode = 'P0001', message = 'OGR-REPORT-001 kazanım çocuğun kaydının müfredatında değil';
      end if;
      v_params := v_params || jsonb_build_object('skill_ids', to_jsonb(v_skills));
    end if;
    v_topic := nullif(btrim(coalesce(v_p ->> 'topic', '')), '');
    if v_topic is not null then
      if char_length(v_topic) > 120 then
        raise exception using errcode = 'P0001', message = 'OGR-REPORT-001 topic en çok 120 karakter';
      end if;
      v_params := v_params || jsonb_build_object('topic', v_topic);
    end if;
    if v_topic is null and v_skills is null then
      raise exception using errcode = 'P0001', message = 'OGR-REPORT-001 konu raporu için topic ya da skill_ids gerekli';
    end if;
    v_title := 'Konu raporu · ' || coalesce(v_topic, (select s.name from public.skills s where s.curriculum_id = v_cur and s.id = v_skills[1]));
  elsif p_kind = 'trend' then
    v_weeks := 8;
    if v_p ? 'weeks' and jsonb_typeof(v_p -> 'weeks') <> 'null' then
      if jsonb_typeof(v_p -> 'weeks') <> 'number' or (v_p ->> 'weeks') !~ '^[0-9]{1,2}$' or (v_p ->> 'weeks')::int not between 2 and 26 then
        raise exception using errcode = 'P0001', message = 'OGR-REPORT-001 weeks 2–26 olmalı';
      end if;
      v_weeks := (v_p ->> 'weeks')::int;
    end if;
    v_params := v_params || jsonb_build_object('weeks', v_weeks);
    v_title := format('Gelişim raporu · son %s hafta', v_weeks);
  else
    v_q := nullif(btrim(coalesce(v_p ->> 'question', '')), '');
    if v_q is null or char_length(v_q) not between 5 and 500 then
      raise exception using errcode = 'P0001', message = 'OGR-REPORT-001 özel rapor için 5–500 karakterlik question gerekli';
    end if;
    v_params := v_params || jsonb_build_object('question', v_q);
    v_title := 'Özel rapor';
  end if;

  -- günlük sınır: velinin bu çocuk için bugünkü (velinin saat dilimi) istekleri; başarısızlar sayılmaz
  perform pg_advisory_xact_lock(hashtext('parent_report:' || auth.uid()::text || ':' || p_student::text));
  select count(*) into v_used from public.generated_documents gd
   where gd.kind = 'report' and gd.student_id = p_student and gd.created_by = auth.uid() and gd.status <> 'failed'
     and gd.spec ->> 'source' = 'parent'
     and gd.created_at >= (date_trunc('day', now() at time zone v_tz) at time zone v_tz);
  if v_used >= v_max then
    raise exception using errcode = 'P0001', message = format('OGR-REPORT-002 bugünkü rapor sınırı doldu (%s); yarın yeniden isteyebilirsiniz', v_max);
  end if;

  insert into public.generated_documents (student_id, course_id, kind, title, spec, status, created_by)
  values (p_student, v_course, 'report', left(v_title, 120),
          jsonb_build_object('report_kind', p_kind, 'params', v_params, 'source', 'parent', 'requested_by', auth.uid()),
          'queued', auth.uid())
  returning id into v_doc;
  v_job := app.try_enqueue('report.generate', jsonb_build_object('document_id', v_doc, 'student_id', p_student, 'report_kind', p_kind,
                                                                 'params', v_params, 'requested_by', auth.uid()));
  return jsonb_build_object('document_id', v_doc, 'title', left(v_title, 120), 'status', 'queued', 'report_kind', p_kind,
                            'job_id', v_job, 'used', v_used + 1, 'max', v_max);
end
$$;
comment on function public.parent_request_report(uuid, text, jsonb) is 'Veli: rapor ister (weekly|exam|topic|trend|custom) → generated_documents(report, queued) + report.generate; günlük sınır parent_reports_daily_max.';

-- --- veli sohbeti ---------------------------------------------------------------------------------------------------------

-- Velinin kendi sohbeti: kind = 'parent', katılımcı = auth.uid(), öğrenci hâlâ aktif çocuğu; değilse 42501 (koç sohbeti dahil).
create or replace function app.parent_conversation(p_conversation uuid) returns public.conversations
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype;
begin
  select c.* into v_conv from public.conversations c where c.id = p_conversation;
  if not found or auth.uid() is null or v_conv.kind <> 'parent' or v_conv.participant_id <> auth.uid()
     or not exists (select 1 from app.my_children() as ch (sid) where ch.sid = v_conv.student_id) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 veli sohbeti yalnız velinin kendisine açıktır';
  end if;
  return v_conv;
end
$$;
comment on function app.parent_conversation(uuid) is 'Oturumdaki velinin sohbeti (kind=parent, katılımcı, aktif çocuk); değilse 42501 — koç sohbeti asla.';

-- En son veli sohbetini döner; yoksa (ya da p_new) yenisini açar.
create or replace function public.parent_open_conversation(p_student uuid, p_new boolean default false) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  if app.is_trusted() or app.role() is distinct from 'parent' then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 veli sohbeti yalnız velinin kendisine açıktır';
  end if;
  perform app.assert_parent_of(p_student);
  if not coalesce(p_new, false) then
    select c.id into v_id from public.conversations c
     where c.student_id = p_student and c.participant_id = auth.uid() and c.kind = 'parent'
     order by coalesce(c.last_message_at, c.created_at) desc, c.created_at desc limit 1;
  end if;
  if v_id is null then
    insert into public.conversations (student_id, kind, participant_id, title)
    values (p_student, 'parent', auth.uid(), 'Veli sohbeti')
    returning id into v_id;
  end if;
  return v_id;
end
$$;
comment on function public.parent_open_conversation(uuid, boolean) is 'Veli: çocuk için en son veli sohbetini döner ya da yenisini açar (yalnız aktif bağ).';

-- coach_history biçimi: {conversation {id, student_id, summary, summary_upto_message_id, turn_in_progress} | null, total,
-- messages[{id, role, content, tool_calls, created_at}]}; p_conversation null → p_student'ın (yoksa herhangi bir çocuğun) en son sohbeti.
create or replace function public.parent_history(
  p_conversation uuid default null, p_limit int default 80, p_after_id bigint default null, p_student uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype;
  v_limit int := least(greatest(coalesce(p_limit, 80), 0), 200);
  v_after bigint := coalesce(p_after_id, 0);
  v_total int;
  v_msgs jsonb;
begin
  if auth.uid() is null or app.role() is distinct from 'parent' then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 veli sohbeti yalnız velinin kendisine açıktır';
  end if;
  if p_conversation is null then
    if p_student is not null then
      perform app.assert_parent_of(p_student);
    end if;
    select c.* into v_conv from public.conversations c
     where c.participant_id = auth.uid() and c.kind = 'parent' and (p_student is null or c.student_id = p_student)
       and c.student_id in (select ch.sid from app.my_children() as ch (sid))
     order by coalesce(c.last_message_at, c.created_at) desc, c.created_at desc limit 1;
    if not found then
      return jsonb_build_object('conversation', null, 'total', 0, 'messages', '[]'::jsonb);
    end if;
  else
    v_conv := app.parent_conversation(p_conversation);
  end if;
  select count(*)::int into v_total from public.conversation_messages m where m.conversation_id = v_conv.id and m.id > v_after;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'role', t.role, 'content', t.content, 'tool_calls', t.tool_calls,
                                               'created_at', t.created_at) order by t.id), '[]'::jsonb)
    into v_msgs
    from (select m.id, m.role, m.content, m.tool_calls, m.created_at from public.conversation_messages m
           where m.conversation_id = v_conv.id and m.id > v_after order by m.id desc limit v_limit) t;
  return jsonb_build_object(
    'conversation', jsonb_build_object(
      'id', v_conv.id, 'student_id', v_conv.student_id, 'summary', v_conv.summary, 'summary_upto_message_id', v_conv.summary_upto_message_id,
      'turn_in_progress', exists (select 1 from secure.coach_turns ct where ct.conversation_id = v_conv.id and ct.expires_at > now())),
    'total', v_total, 'messages', v_msgs);
end
$$;
comment on function public.parent_history(uuid, int, bigint, uuid) is 'Veli: kendi veli sohbetinin geçmişi (koç sohbeti 42501).';

-- Jetonsuz: yalnız role = 'user' ve {type:'text', text} blokları (yükleme yok). Sunucu jetonuyla (app.coach_server_ok,
-- sohbete bağlı): assistant/system turları, araç blokları, defter bağı ve tur kaydı.
create or replace function public.parent_append_message(
  p_conversation uuid, p_role text, p_content jsonb, p_llm_call_id bigint default null, p_tool_calls jsonb default null,
  p_server_token text default null
) returns bigint
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.parent_conversation(p_conversation);
begin
  if not app.coach_server_ok(p_conversation, p_server_token) then
    if coalesce(p_role, '') <> 'user' then
      raise exception using errcode = '42501',
        message = 'OGR-COACH-001 assistant ve system turlarını yalnız web sunucusu yazar (sunucu jetonu gerekli)';
    end if;
    if p_llm_call_id is not null or p_tool_calls is not null or not app.coach_client_blocks_ok(p_content, '{}'::uuid[]) then
      raise exception using errcode = '42501',
        message = 'OGR-COACH-001 istemci yalnız metin bloğu yazar; araç blokları, ek anahtarlar ve defter bağı yalnız web sunucusundan';
    end if;
  end if;
  return app.coach_insert_message(v_conv, p_role, p_content, '{}'::uuid[], p_llm_call_id, p_tool_calls);
end
$$;
comment on function public.parent_append_message(uuid, text, jsonb, bigint, jsonb, text) is 'Veli: sohbete mesaj ekler; jetonsuz yalnız velinin metin mesajı, assistant/system/araç turu yalnız sunucu jetonuyla.';

-- Defter: parent_chat rotasının llm_calls satırı (student_ref ve ref sohbetten; maliyet tavanı); yalnız sunucu jetonuyla.
create or replace function public.parent_log_llm_call(p_conversation uuid, p_call jsonb, p_server_token text default null) returns bigint
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.parent_conversation(p_conversation);
  v_id bigint;
begin
  perform app.coach_require_server(p_conversation, p_server_token);
  if coalesce(jsonb_typeof(p_call), '') <> 'object' or coalesce(p_call ->> 'route', '') <> 'parent_chat'
     or coalesce(nullif(p_call ->> 'purpose', ''), 'parent_chat') <> 'parent_chat'
     or nullif(p_call ->> 'model', '') is null or nullif(p_call ->> 'status', '') is null then
    raise exception using errcode = 'P0001', message = 'OGR-PARENT-001 veli defter satırı: route/purpose parent_chat, model ve status gerekli';
  end if;
  begin
    if coalesce((p_call ->> 'cost_usd')::numeric, 0) > app.setting_num('llm_call_max_cost_usd', 5) then
      raise exception using errcode = 'P0001', message = format('OGR-LLM-001 cost_usd çağrı başına üst sınırı (%s) aşıyor',
                                                               app.setting_num('llm_call_max_cost_usd', 5));
    end if;
    insert into public.llm_calls (route, purpose, provider, model, effort, prompt_version, tokens_in, tokens_out, cache_read_tokens,
                                  cache_write_tokens, images, batch, status, error_code, latency_ms, cost_usd, ref_table, ref_id,
                                  student_ref)
    values ('parent_chat', 'parent_chat', 'anthropic', p_call ->> 'model', p_call ->> 'effort', left(p_call ->> 'prompt_version', 64),
            coalesce((p_call ->> 'tokens_in')::int, 0), coalesce((p_call ->> 'tokens_out')::int, 0),
            coalesce((p_call ->> 'cache_read_tokens')::int, 0), coalesce((p_call ->> 'cache_write_tokens')::int, 0),
            (p_call ->> 'images')::int, false, p_call ->> 'status', left(p_call ->> 'error_code', 120), (p_call ->> 'latency_ms')::int,
            coalesce((p_call ->> 'cost_usd')::numeric, 0), 'conversations', v_conv.id::text,
            (select s.public_ref from public.students s where s.id = v_conv.student_id))
    returning id into v_id;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = format('OGR-LLM-001 geçersiz çağrı kaydı: %s', sqlerrm);
  end;
  return v_id;
end
$$;
comment on function public.parent_log_llm_call(uuid, jsonb, text) is 'Veli: parent_chat llm_calls satırı (student_ref ve ref sohbetten; maliyet tavanı); yalnız sunucu jetonuyla.';

create or replace function public.parent_claim_turn(p_conversation uuid, p_ttl_s int default 180) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.parent_conversation(p_conversation);
  v_got uuid;
begin
  insert into secure.coach_turns as ct (conversation_id, token, expires_at)
  values (v_conv.id, gen_random_uuid(), now() + make_interval(secs => least(greatest(coalesce(p_ttl_s, 180), 30), 900)))
  on conflict (conversation_id) do update set token = excluded.token, expires_at = excluded.expires_at, created_at = now()
  where ct.expires_at <= now()
  returning ct.token into v_got;
  return v_got;
end
$$;
comment on function public.parent_claim_turn(uuid, int) is 'Veli: tur kirası alır (aynı sohbette tek tur); sürüyorsa null.';

create or replace function public.parent_release_turn(p_conversation uuid, p_token uuid) returns boolean
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.parent_conversation(p_conversation);
begin
  delete from secure.coach_turns ct where ct.conversation_id = v_conv.id and ct.token = p_token;
  return found;
end
$$;
comment on function public.parent_release_turn(uuid, uuid) is 'Veli: tur kirasını bırakır (jeton eşleşirse).';

-- --- gizlilik: velinin rapor istekleri ve veli sohbeti --------------------------------------------------------------------
--
-- * Velinin istediği rapor (spec.source = 'parent'; özel raporda velinin kendi sorusu spec.params.question'dadır ve PDF'e
--   "Sorunuz: …" olarak basılır) öğrenciye görünmez: ne RLS'te (can_read_student_data dalı), ne Belgelerim'de
--   (list_my_documents), ne de Storage 'documents' nesnelerinde (ogrenmen_documents_select bu politikayı izler).
-- * Aynı çocuğun öteki velisi de göremez (ayrılmış ebeveynler: velinin özel sorusu başkasına açılmaz). Veli bu raporları
--   yalnız İSTEYEN veli ve yalnız AKTİF bağla okur (created_by = auth.uid() ve my_children()). Özet (latest_report),
--   rapor listesi (parent_reports), son etkinlik, Belgelerim ve Storage aynı koşulu kullanır; bağ iptal edilince satır da
--   PDF de kapanır (personel ve admin değişmez).
-- * Veli sohbetine doğrudan INSERT yok: veli mesajı yalnız parent_append_message'dan geçer (içerik izin listesi
--   app.coach_client_blocks_ok; 0028'in koç sohbeti için kapattığı yol). Eğitmen sohbetleri 0018'deki hakla kalır.
-- * Veli sohbeti (araç sonuçlarında çocuğun verisi vardır) katılımcısına yalnız bağ aktifken açıktır.

drop policy generated_documents_select on public.generated_documents;
create policy generated_documents_select on public.generated_documents for select to authenticated
using ((kind <> 'answer_key' or app.is_staff())
       and (app.is_staff() or not review_required or status = 'published')
       and (app.is_staff() or not app.document_pipeline_unpublished(kind, status))
       and not coalesce(kind = 'report' and spec ->> 'source' = 'parent' and student_id = app.my_student_id(), false)
       and ((created_by = auth.uid() and not coalesce(kind = 'report' and spec ->> 'source' = 'parent', false))
            or app.is_admin()
            or (student_id is not null and app.can_read_student_data(student_id))
            or (kind = 'report' and student_id in (select c.sid from app.my_children() as c (sid))
                and (coalesce(spec ->> 'source', '') <> 'parent' or created_by = auth.uid()))
            or (student_id is null
                and (app.can_teach_course(course_id)
                     or (status = 'published'
                         and (app.is_staff() or (app.role() is distinct from 'parent' and app.can_read_course(course_id))))))));

drop policy conversation_messages_insert_own on public.conversation_messages;
create policy conversation_messages_insert_own on public.conversation_messages for insert to authenticated
with check (role = 'user'
            and exists (select 1 from public.conversations as c
                         where c.id = conversation_messages.conversation_id and c.participant_id = auth.uid()
                           and c.kind not in ('coach', 'parent')
                           and app.uploads_ok(conversation_messages.upload_ids, c.student_id)));

-- 0018 + veli sohbeti yalnız aktif bağla (katılımcı olsa bile).
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
      or (v_c.participant_id = auth.uid()
          and (v_c.kind <> 'parent' or exists (select 1 from app.my_children() as ch (sid) where ch.sid = v_c.student_id)))
      or (v_c.kind = 'coach' and coalesce(v_c.student_id = app.my_student_id(), false))
      or (v_c.kind in ('coach', 'instructor') and exists (select 1 from app.my_students() as m (sid) where m.sid = v_c.student_id));
end
$$;
comment on function app.can_read_conversation(uuid) is 'Sohbeti okuyabilir mi: katılımcı (veli sohbeti yalnız bağ aktifken), öğrencinin koç sohbeti, bağlı eğitmen (koç/eğitmen), admin; veli koç sohbetini okuyamaz.';

-- 0035 + velinin istediği rapor öğrencinin Belgelerim listesinde yok.
create or replace function public.list_my_documents(p_kind text default null, p_student uuid default null, p_limit int default 50) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_me uuid := app.my_student_id();
  v_role text := app.role();
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_staff boolean := app.is_trusted() or app.is_staff();
  v_students uuid[];
  v_parent boolean := false;
  v_docs jsonb;
begin
  if p_kind is not null and p_kind not in ('notes', 'mock_exam', 'report', 'question_set') then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-001 geçersiz belge türü %s', p_kind);
  end if;
  if v_me is not null and (p_student is null or p_student = v_me) then
    v_students := array[v_me];
  elsif v_role = 'parent' then
    v_parent := true;
    v_students := array(select c.sid from app.my_children() as c (sid) where p_student is null or c.sid = p_student);
    if p_student is not null and cardinality(v_students) = 0 then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 veli yalnız çocuğunun belgelerini görür';
    end if;
  elsif p_student is not null and (app.is_trusted() or app.can_read_student_data(p_student)) then
    v_students := array[p_student];
  else
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 belge listesi öğrenci ya da veli içindir';
  end if;

  select coalesce(jsonb_agg(z.doc order by z.created_at desc, z.id), '[]'::jsonb) into v_docs
    from (select gd.id, gd.created_at,
                 jsonb_build_object('id', gd.id, 'kind', gd.kind, 'title', gd.title, 'status', gd.status, 'version', gd.version,
                                    'pdf_path', case when z2.masked then null else gd.pdf_path end,
                                    'html_path', case when z2.masked then null else gd.html_path end,
                                    'student_id', gd.student_id,
                                    'course_id', gd.course_id, 'course_title', co.title,
                                    'scope', case when gd.student_id is null then 'course' else 'personal' end,
                                    'exam_session_id', (select es.id from public.exam_sessions es where es.report_document_id = gd.id
                                                         order by es.created_at desc limit 1),
                                    'review_required', gd.review_required, 'published_at', gd.published_at,
                                    'request_id', rq.id, 'request_status', rq.status,
                                    'exam_id', (select x.id from public.exams x
                                                 where x.generated_document_id = gd.id and x.status in ('ready', 'published')
                                                 order by x.created_at desc limit 1),
                                    'created_at', gd.created_at, 'updated_at', gd.updated_at) as doc
            from public.generated_documents gd
            left join public.courses co on co.id = gd.course_id
            cross join lateral (select not v_staff and ((gd.review_required and gd.status <> 'published') or app.document_pipeline_unpublished(gd.kind, gd.status)) as masked) as z2
            left join lateral (select dr.id, dr.status from public.document_requests dr
                                where dr.generated_document_id = gd.id order by dr.created_at desc limit 1) as rq on true
           where gd.kind <> 'answer_key'
             and (p_kind is null or gd.kind = p_kind)
             and (v_staff or v_parent or not (gd.kind = 'report' and coalesce(gd.spec ->> 'source', '') = 'parent'))
             and ((not v_parent and gd.student_id = any(v_students))
                  or (v_parent and gd.kind = 'report' and gd.student_id = any(v_students) and gd.status in ('rendered', 'published')
                      and (coalesce(gd.spec ->> 'source', '') <> 'parent' or gd.created_by = auth.uid()))
                  or (not v_parent and gd.student_id is null and gd.status = 'published'
                      and exists (select 1 from public.enrollments e
                                   where e.student_id = any(v_students) and e.status = 'active' and e.course_id = gd.course_id)))
           order by gd.created_at desc, gd.id
           limit v_limit) as z;
  return jsonb_build_object('documents', v_docs, 'count', jsonb_array_length(v_docs));
end
$$;
comment on function public.list_my_documents(text, uuid, int) is 'Belgelerim: öğrenci kendi (velinin istediği raporlar hariç) + kayıtlı dersinin yayımlanmış ders geneli belgeleri (istek durumu, inceleme, deneme sınavı); veli çocuklarının hazır raporları; answer_key asla.';


-- --- yetkiler -------------------------------------------------------------------------------------------------------------

revoke all on function app.assert_parent_of(uuid), app.viewer_tz(), app.tr_date_short(date),
  app.child_study_stats(uuid, timestamptz, timestamptz, text), app.child_course_bands(uuid, uuid), app.parent_conversation(uuid)
from public;
revoke all on function public.parent_child_summary(uuid), public.parent_mastery_overview(uuid, uuid), public.parent_recent_activity(uuid, int),
  public.parent_exam_sessions(uuid, int), public.parent_reports(uuid, int), public.parent_request_report(uuid, text, jsonb),
  public.parent_open_conversation(uuid, boolean), public.parent_history(uuid, int, bigint, uuid),
  public.parent_append_message(uuid, text, jsonb, bigint, jsonb, text), public.parent_log_llm_call(uuid, jsonb, text),
  public.parent_claim_turn(uuid, int), public.parent_release_turn(uuid, uuid)
from public, anon;
grant execute on function public.parent_child_summary(uuid), public.parent_mastery_overview(uuid, uuid), public.parent_recent_activity(uuid, int),
  public.parent_exam_sessions(uuid, int), public.parent_reports(uuid, int)
to authenticated, service_role;
grant execute on function public.parent_request_report(uuid, text, jsonb), public.parent_open_conversation(uuid, boolean),
  public.parent_history(uuid, int, bigint, uuid), public.parent_append_message(uuid, text, jsonb, bigint, jsonb, text),
  public.parent_log_llm_call(uuid, jsonb, text), public.parent_claim_turn(uuid, int), public.parent_release_turn(uuid, uuid)
to authenticated;
