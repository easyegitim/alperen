-- test_live_db.py: boru hattının batch_worker çağrıları gerçek SQL'e karşı (tek işlem, geri alınır).
\set ON_ERROR_STOP 1
begin;
set local role batch_worker;
select set_config('request.jwt.claims', '{"role":"batch_worker"}', true) \g /dev/null
select public.register_lesson(:'student_ref', :'staff'::uuid, :'held_at'::timestamptz, 90, 'local:ders-02.mp4') as lid \gset
select 'registered=' || (select l.status || '|' || l.held_at::text from public.lessons l where l.id = :'lid');
select 'labels=' || coalesce(json_agg(json_build_object('hash', r.hash, 'label', r.label) order by r.hash)::text, '[]')
  from public.resolve_lesson_labels(:'fixture_lesson'::uuid) r;
update public.lessons set status = 'processing' where id = :'lid';
update public.lessons set transcript_path = 'transcripts/' || :'lid' || '.jsonl', frames_count = 8 where id = :'lid';
select 'profile_keys=' || (select string_agg(k, ',' order by k)
  from jsonb_object_keys(public.profile_for_prompt((select enrollment_id from public.lessons where id = :'lid'))) k);
select 'reads=' || (select count(*) from public.students s where s.public_ref = :'student_ref') || ','
  || (select count(*) from public.skills where is_leaf) || ',' || (select count(*) from public.misconception_tags) || ','
  || (select count(*) from public.misconceptions) || ',' || (select count(*) from public.lesson_analyses);
select count(*) as obs_before from public.observations \gset
select public.write_lesson_analysis(:'lid', :'seed'::jsonb, :'analysis'::jsonb, :'model', 0.0123) as aid \gset
select 'claims=' || (select json_object_agg(c.kind, c.n)::text from (select kind, count(*) n from public.lesson_claims
  where analysis_id = :'aid' group by kind) c);
select 'talk=' || (select value::text from public.lesson_claims where analysis_id = :'aid' and kind = 'talk');
select 'analysis=' || (select la.status || '|' || la.version || '|' || la.cost_usd from public.lesson_analyses la where la.id = :'aid');
select 'obs_delta=' || ((select count(*) from public.observations) - :obs_before);
select 'lesson_status=' || (select status from public.lessons where id = :'lid');
select 'alerts=' || (select count(*) from public.instructor_alerts a where a.ref ->> 'lesson_id' = :'lid' and a.status = 'open');
insert into public.instructor_alerts (kind, severity, student_id, staff_id, detail, since, ref)
  values ('ops', 'warning', null, null, 'Ders analizi başarısız: deneme', now(), jsonb_build_object('lesson_id', :'lid'));
insert into public.llm_calls (audio_sec, batch, cost_usd, error_code, images, latency_ms, model, provider, purpose, ref_id,
  ref_table, status, student_ref, tokens_in, tokens_out)
  values (20, false, 0.5, null, null, 0, 'm', 'gemini-paid', 'lesson_analysis', :'lid', 'lessons', 'ok', :'student_ref', 1, 1);
select 'spend=' || (select s.state || '|' || s.day_usd || '|' || (s.lesson_month_usd > 0) from public.check_spend('chat') s);
select public.confirm_video_deleted(:'lid') \g /dev/null
reset role;   -- batch_worker proactive_messages'ı yalnız ekler (SELECT yok); denetim yönetici rolüyle
select 'notices=' || (select string_agg(recipient, ',' order by recipient) from public.proactive_messages
  where template_id = 'video_deleted' and params ->> 'lesson_id' = :'lid');
rollback;
