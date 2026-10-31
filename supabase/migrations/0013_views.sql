-- 0013_views.sql — görünümler (BLUEPRINT §3.0 "Görünümler ve yardımcılar"). profile_for_prompt görünüm değil
-- RPC'dir (0012). v_messages_staff ve v_exam_items_full ham metni (text_raw / ocr_text) yalnız eğitmen ve
-- koordinatöre açar: security_invoker = false (sahibi postgres), rol ve öğrenci kapsamı filtresi GÖRÜNÜMÜN İÇİNDE.
-- Bu iki görünümde app.staff_role()/app.can_see_student() (0014) yerine aynı mantık satır içi yazılır: görünüm
-- oluşturulurken çağrılan fonksiyonlar var olmalıdır ve tablo okuyan yardımcılar 0014 başında tanımlanır.

create view public.mastery_view with (security_invoker = true) as
select m.enrollment_id,
       e.student_id,
       m.curriculum_id,
       m.skill_id,
       s.name as skill_name,
       s.parent_id,
       m.p,
       m.evidence_count,
       m.evidence_count >= coalesce((select (st.value #>> '{}')::int from public.settings as st where st.key = 'min_evidence'), 5) as is_reliable,
       case when m.p < 0.4 then 'düşük' when m.p < 0.7 then 'orta' else 'yüksek' end as band,
       m.last_evidence_at
  from public.mastery as m
  join public.enrollments as e on e.id = m.enrollment_id
  join public.skills as s on s.curriculum_id = m.curriculum_id and s.id = m.skill_id;
comment on view public.mastery_view is 'Ustalık görünümü: bant (düşük/orta/yüksek) ve güvenilirlik (kanıt ≥ min_evidence); temel tabloların RLS''i geçerli.';
grant select on public.mastery_view to bot_runtime, batch_worker, authenticated;

-- Ham mesaj metni yalnız buradan (panel cevaplar/yükseltme ekranları); gözlemciye 0 satır
create view public.v_messages_staff with (security_invoker = false) as
select m.id,
       m.chat_id,
       m.telegram_message_id,
       m.sender_role,
       m.student_id,
       m.staff_id,
       m.reply_to_telegram_message_id,
       m.text_raw,
       m.text_llm,
       m.attachments,
       m.mentions_bot,
       m.is_question,
       m.answered_at,
       m.sent_at,
       m.expires_at
  from public.messages as m
 where (select st.role from public.staff as st where st.id = app.uid() and st.active) in ('instructor', 'coordinator')
   and ((m.student_id is null
         and m.chat_id in (select cr.chat_id from public.chat_roles as cr where cr.staff_id = app.uid()))
        or (select st.role from public.staff as st where st.id = app.uid() and st.active) = 'coordinator'
        or exists (select 1 from public.staff_students as ss where ss.staff_id = app.uid() and ss.student_id = m.student_id));
comment on view public.v_messages_staff is 'Ham mesaj metni yalnız eğitmen (atanan öğrenciler) ve koordinatör için; gözlemciye 0 satır.';
grant select on public.v_messages_staff to authenticated;

-- ocr_text yalnız eğitmen/koordinatör ve yalnız bu görünümden; gözlemciye 0 satır
create view public.v_exam_items_full with (security_invoker = false) as
select e.id,
       e.source_id,
       e.item_no,
       e.topic,
       e.kind,
       e.points,
       e.skill_id,
       e.cluster_id,
       e.ocr_text
  from public.exam_items as e
 where (select st.role from public.staff as st where st.id = app.uid() and st.active) in ('instructor', 'coordinator');
comment on view public.v_exam_items_full is 'Sınav maddeleri OCR metniyle; yalnız eğitmen ve koordinatör (gözlemciye 0 satır).';
grant select on public.v_exam_items_full to authenticated;

-- Panel kuyruğu: bekleyen soru/şekil/yanılgı/havuz/ders raporu/işaretli cevap/plan/araştırma
create view public.v_review_queue with (security_invoker = true) as
select 'question'::text as kind, q.id::text as ref_id, q.created_at,
       coalesce(q.review_note, 'Soru incelemesi (' || q.source || ')') as reason,
       null::text as student_ref, q.skill_ids[1] as staff_hint
  from public.questions as q
 where q.status = 'pending_review'
union all
select 'figure', f.id::text, f.created_at,
       'Şekil incelemesi: render ' || f.render_status || ', görsel denetim ' || f.vision_status, null, f.tool
  from public.figures as f
 where f.review_status = 'pending' and f.render_status <> 'pending'
union all
select 'misconception', mc.id::text, mc.first_seen, mc.text_instructor, st.public_ref, mc.skill_id
  from public.misconceptions as mc
  join public.enrollments as e on e.id = mc.enrollment_id
  join public.students as st on st.id = e.student_id
 where mc.status = 'pending_review'
union all
select 'pool', cp.id::text, cp.created_at, 'Havuz içeriği (' || cp.kind || ', ' || cp.mode || ')', null, cp.skill_id
  from public.content_pool as cp
 where cp.status = 'pending_review'
union all
select 'lesson_analysis', la.id::text, la.created_at, 'Ders raporu onay bekliyor', st.public_ref, l.held_at::date::text
  from public.lesson_analyses as la
  join public.lessons as l on l.id = la.lesson_id
  join public.enrollments as e on e.id = l.enrollment_id
  join public.students as st on st.id = e.student_id
 where la.status = 'draft'
union all
select 'flagged_response', br.id::text, coalesce(br.flagged_at, br.created_at), coalesce(br.flag_reason, 'İşaretli cevap'),
       st.public_ref, br.purpose
  from public.bot_responses as br
  left join public.students as st on st.id = br.student_id
 where br.flagged
union all
select 'priority_plan', pp.id::text, pp.created_at, 'Öncelik planı onay bekliyor', null, pp.period
  from public.exam_priority_plans as pp
 where pp.status = 'pending_review'
union all
select 'research', ro.id::text, ro.created_at, 'Araştırma çıktısı inceleme bekliyor', st.public_ref, null
  from public.research_outputs as ro
  join public.research_requests as rr on rr.id = ro.request_id
  left join public.students as st on st.id = rr.student_id
 where ro.status = 'pending_review';
comment on view public.v_review_queue is 'Eğitmen kuyruğu (tek görünüm, union all); çağıranın RLS''i geçerli.';
grant select on public.v_review_queue to authenticated;

-- Eğitmen yanıt süreleri: yükseltme oluşturma → yanıt (gün Europe/Istanbul)
create view public.v_instructor_response_times with (security_invoker = true) as
select coalesce(e.answered_by, e.target_staff_id) as staff_id,
       (e.created_at at time zone 'Europe/Istanbul')::date as day,
       count(*)::int as escalations,
       (count(*) filter (where e.answered_at is not null))::int as answered,
       round((percentile_cont(0.5) within group (order by extract(epoch from (e.answered_at - e.created_at)) / 3600.0))::numeric, 2) as median_hours,
       round((percentile_cont(0.9) within group (order by extract(epoch from (e.answered_at - e.created_at)) / 3600.0))::numeric, 2) as p90_hours
  from public.escalations as e
 where coalesce(e.answered_by, e.target_staff_id) is not null
 group by 1, 2;
comment on view public.v_instructor_response_times is 'Personel × gün yükseltme sayısı, yanıtlanan ve yanıt süresi medyanı/p90 (saat).';
grant select on public.v_instructor_response_times to authenticated;

-- Haftalık panel ölçüleri (normal görünüm; kulaklik summaries doğrudan okur)
create view public.panel_metrics_weekly with (security_invoker = true) as
with weeks as (
  select m.student_id, date_trunc('week', m.sent_at at time zone 'Europe/Istanbul')::date as week_start
    from public.messages as m
   where m.student_id is not null and m.sender_role = 'student'
  union
  select e.student_id, date_trunc('week', a.created_at at time zone 'Europe/Istanbul')::date
    from public.attempts as a
    join public.enrollments as e on e.id = a.enrollment_id
), base as (
  select w.student_id,
         w.week_start,
         (select count(*) from public.messages as m
           where m.student_id = w.student_id and m.sender_role = 'student'
             and m.sent_at >= w.week_start::timestamp at time zone 'Europe/Istanbul'
             and m.sent_at < (w.week_start + 7)::timestamp at time zone 'Europe/Istanbul')::int as messages,
         (select count(*) from public.attempts as a join public.enrollments as e on e.id = a.enrollment_id
           where e.student_id = w.student_id
             and a.created_at >= w.week_start::timestamp at time zone 'Europe/Istanbul'
             and a.created_at < (w.week_start + 7)::timestamp at time zone 'Europe/Istanbul')::int as questions_solved,
         (select round(avg(case when a.is_correct then 1.0 else 0.0 end), 4)
            from public.attempts as a join public.enrollments as e on e.id = a.enrollment_id
           where e.student_id = w.student_id and a.is_correct is not null
             and a.created_at >= w.week_start::timestamp at time zone 'Europe/Istanbul'
             and a.created_at < (w.week_start + 7)::timestamp at time zone 'Europe/Istanbul') as accuracy,
         (select count(distinct x.d)::int from (
            select (m.sent_at at time zone 'Europe/Istanbul')::date as d from public.messages as m
             where m.student_id = w.student_id and m.sender_role = 'student'
               and m.sent_at >= w.week_start::timestamp at time zone 'Europe/Istanbul'
               and m.sent_at < (w.week_start + 7)::timestamp at time zone 'Europe/Istanbul'
            union
            select (a.created_at at time zone 'Europe/Istanbul')::date from public.attempts as a
              join public.enrollments as e on e.id = a.enrollment_id
             where e.student_id = w.student_id
               and a.created_at >= w.week_start::timestamp at time zone 'Europe/Istanbul'
               and a.created_at < (w.week_start + 7)::timestamp at time zone 'Europe/Istanbul') as x) as active_days,
         (select count(*) from public.misconceptions as mc join public.enrollments as e on e.id = mc.enrollment_id
           where e.student_id = w.student_id and mc.status = 'open')::int as open_misconceptions,
         (select count(*) from public.messages as m
           where m.student_id = w.student_id and m.sender_role = 'student' and m.is_question and m.answered_at is null
             and m.sent_at >= w.week_start::timestamp at time zone 'Europe/Istanbul'
             and m.sent_at < (w.week_start + 7)::timestamp at time zone 'Europe/Istanbul')::int as unanswered_questions,
         (select round(avg(f.morale_signal), 2) from public.memory_facts as f
           where f.student_id = w.student_id and f.morale_signal is not null
             and f.created_at >= w.week_start::timestamp at time zone 'Europe/Istanbul'
             and f.created_at < (w.week_start + 7)::timestamp at time zone 'Europe/Istanbul') as morale_avg
    from weeks as w
)
select b.student_id,
       b.week_start,
       b.messages,
       b.questions_solved,
       b.accuracy,
       b.active_days,
       b.open_misconceptions,
       b.unanswered_questions,
       b.morale_avg,
       case when b.morale_avg is null then 'unknown'
            when b.morale_avg >= 0.5 then 'up'
            when b.morale_avg <= -0.5 then 'down'
            else 'flat' end as morale_trend
  from base as b;
comment on view public.panel_metrics_weekly is 'Öğrenci × hafta ölçüleri (mesaj, çözülen soru, doğruluk, aktif gün, açık yanılgı, cevapsız soru, moral eğilimi).';
grant select on public.panel_metrics_weekly to batch_worker, authenticated;
