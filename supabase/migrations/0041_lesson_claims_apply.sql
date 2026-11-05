-- 0041_lesson_claims_apply.sql — P5 ders iddialarının uygulanması, incelemesi ve okunması (docs/PLAN-v2.md §9):
-- apply_lesson_claims (worker ya da "Dossier'e uygula": güven ≥ lessons.auto_apply_threshold → onay + uygulama; altı
-- eğitmen incelemesine kalır), review_lesson_claim (onayla | düzenle | reddet; uygulanmış iddiada reddet/düzenle "Geri
-- al"dır), lesson_view (eğitmen: transkript + iddialar; öğrenci: student_visible ise yalnız onaylı özet; veli: yok),
-- list_lessons. Kurallar ve hata kodları 0039'un başındadır.
--
-- Uygulama (app.lesson_apply_claim; iddia approved | edited olmalı, kanıt zinciri app.observations_check_source):
--   skill_mastery  → observations(kind='lesson', value = mastery_estimate, confidence) → apply_observation (BKT blend)
--   misconception  → observations(kind='lesson', value = settings.lesson_misconception_value, etiket) → yanılgı sayacı;
--                    etiketsiz yanılgı serbest metinli misconceptions satırı (pending_review) + kanıt bağı
--   followup       → improved: ders gözlemi (lesson_followup_resolved_value) + yanılgı resolved (çözüm kanıtı bu gözlem,
--                    resolved_by iddiaya karar veren; otomatikte boş);
--                    still_present: ders gözlemi (lesson_followup_present_value) + yanılgı sayacı
--   course_insight → kind = syllabus_topic: dersin izlencesine syllabus_topics satırı (başlık tekse; yalnız dersi veren
--                    eğitmen dersin oluşturanıysa: ortak derste izlence herkesi etkiler, orada yalnız hafıza); diğerleri
--                    yalnız hafıza
--   diğer türler   → öğrenen modele dokunmaz (hafıza ve veli özeti onaylı iddiaları okur)
-- Gözlem yalnız birebir derste yazılır (sınıf dersinde kimin kanıtı olduğu belli değil; iddia onaylanır, kayıt atlanır).
-- Güven boşsa onaylanan iddia 0,80 sayılır; eğitmen düzeltmesi en az 0,80'dir. Uygulanan her şey applied_ref'te izlenir.
-- Geri alma (app.lesson_revert_claim): iddianın gözlemi o kazanımdaki son gözlemse ustalık önceki değerine döner
-- (mastery_history'ye 'instructor_override' satırı), yanılgı kanıt bağı silinir, çözülen yanılgı eski durumuna, açılan
-- izlence konusu silinir; sonra yeni kanıt geldiyse OGR-LESSON-006 (geri alınamaz).
-- Hafıza: uygulanan iddia olunca 'memory.apply' işi {source: 'lesson', lesson_id, course_id, course_code, path:
-- '/memories/courses/<kod>.md', student_ids, claim_ids} atılır; worker dosyayı onaylı iddialardan (idempotent) kurar.

-- --- iç yardımcılar ---------------------------------------------------------------------------------------------------

create or replace function app.lesson_apply_claim(p_claim uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_c public.lesson_claims%rowtype;
  v_l public.lessons%rowtype;
  v_mc public.misconceptions%rowtype;
  v_val jsonb;
  v_conf numeric;
  v_value numeric;
  v_loc text;
  v_quote text;
  v_obs bigint;
  v_mc_id uuid;
  v_ref jsonb := '{}'::jsonb;
  v_course_id uuid;
  v_cur uuid;
  v_course_owner uuid;
  v_title text;
  v_topic uuid;
  v_ti text;
  v_ts text;
begin
  select lc.* into v_c from public.lesson_claims lc where lc.id = p_claim for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 iddia bulunamadı';
  end if;
  if v_c.status not in ('approved', 'edited') then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-005 yalnız onaylı iddia uygulanır';
  end if;
  if v_c.applied_at is not null then
    return v_c.applied_ref;
  end if;
  select l.* into v_l from public.lessons l join public.lesson_analyses la on la.lesson_id = l.id where la.id = v_c.analysis_id;
  v_val := coalesce(v_c.edited_value, v_c.value);
  v_conf := case when v_c.status = 'edited' then greatest(coalesce(v_c.confidence, 0), 0.80) else coalesce(v_c.confidence, 0.80) end;
  v_loc := 'Ders ' || coalesce(app.lesson_no(v_l.id), 1) || ' · ' || app.lesson_hms(v_c.t_start_sec);
  v_quote := left(nullif(btrim(v_c.quote), ''), 300);

  if v_c.kind in ('skill_mastery', 'misconception', 'followup') and v_l.enrollment_id is null then
    v_ref := jsonb_build_object('skipped', 'course_lesson');
  elsif v_c.kind = 'skill_mastery' then
    if jsonb_typeof(v_val -> 'mastery_estimate') is distinct from 'number' or (v_val ->> 'mastery_estimate')::numeric not between 0 and 1 then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-005 ustalık iddiasında mastery_estimate 0–1 olmalı';
    end if;
    v_value := round((v_val ->> 'mastery_estimate')::numeric, 3);
    insert into public.observations (enrollment_id, skill_id, kind, value, confidence, source_type, source_id, source_locator, quote)
    values (v_l.enrollment_id, v_c.skill_id, 'lesson', v_value, v_conf, 'lesson_claim', v_c.id::text, v_loc, v_quote)
    returning id into v_obs;
    perform public.apply_observation(v_obs);
    v_ref := jsonb_build_object('observation_id', v_obs);
  elsif v_c.kind = 'misconception' then
    v_value := round(least(app.setting_num('lesson_misconception_value', 0.3), 0.49), 3);
    insert into public.observations (enrollment_id, skill_id, kind, value, confidence, source_type, source_id, source_locator, quote,
                                     misconception_tag)
    values (v_l.enrollment_id, v_c.skill_id, 'lesson', v_value, v_conf, 'lesson_claim', v_c.id::text, v_loc, v_quote, v_c.misconception_tag)
    returning id into v_obs;
    perform public.apply_observation(v_obs);
    if v_c.misconception_tag is null then
      v_ti := left(coalesce(nullif(btrim(v_val ->> 'text_instructor'), ''), nullif(btrim(v_val ->> 'text'), ''), 'Ders analizinde görülen yanılgı'), 300);
      v_ts := left(coalesce(nullif(btrim(v_val ->> 'text_student'), ''), v_ti), 300);
      select mc.id into v_mc_id from public.misconceptions mc
       where mc.enrollment_id = v_l.enrollment_id and mc.skill_id = v_c.skill_id and mc.tag is null
         and lower(mc.text_instructor) = lower(v_ti) and mc.status in ('pending_review', 'open')
       limit 1;
      if v_mc_id is null then
        insert into public.misconceptions (enrollment_id, skill_id, tag, text_instructor, text_student, evidence_count, last_seen)
        values (v_l.enrollment_id, v_c.skill_id, null, v_ti, v_ts, 0, now())
        returning id into v_mc_id;
      end if;
      update public.misconceptions mc set evidence_count = mc.evidence_count + 1, last_seen = now() where mc.id = v_mc_id;
      insert into public.misconception_evidence (misconception_id, observation_id) values (v_mc_id, v_obs) on conflict do nothing;
    else
      select me.misconception_id into v_mc_id from public.misconception_evidence me where me.observation_id = v_obs limit 1;
    end if;
    v_ref := jsonb_build_object('observation_id', v_obs, 'misconception_id', v_mc_id);
  elsif v_c.kind = 'followup' then
    select mc.* into v_mc from public.misconceptions mc where mc.id = v_c.misconception_id for update;
    if not found or v_mc.enrollment_id is distinct from v_l.enrollment_id then
      v_ref := jsonb_build_object('skipped', 'misconception_missing');
    elsif v_val ->> 'status' = 'improved' then
      v_value := round(least(greatest(app.setting_num('lesson_followup_resolved_value', 0.8), 0.5), 1), 3);
      insert into public.observations (enrollment_id, skill_id, kind, value, confidence, source_type, source_id, source_locator, quote)
      values (v_l.enrollment_id, v_mc.skill_id, 'lesson', v_value, v_conf, 'lesson_claim', v_c.id::text, v_loc, v_quote)
      returning id into v_obs;
      perform public.apply_observation(v_obs);
      v_ref := jsonb_build_object('observation_id', v_obs);
      if v_mc.status in ('pending_review', 'open') then
        update public.misconceptions mc
           set status = 'resolved', resolved_at = now(), resolved_by = v_c.decided_by, resolution_observation_id = v_obs
         where mc.id = v_mc.id;
        v_ref := v_ref || jsonb_build_object('resolved_misconception_id', v_mc.id, 'prev_status', v_mc.status);
      end if;
    elsif v_val ->> 'status' = 'still_present' then
      v_value := round(least(app.setting_num('lesson_followup_present_value', 0.3), 0.49), 3);
      insert into public.observations (enrollment_id, skill_id, kind, value, confidence, source_type, source_id, source_locator, quote,
                                       misconception_tag)
      values (v_l.enrollment_id, v_mc.skill_id, 'lesson', v_value, v_conf, 'lesson_claim', v_c.id::text, v_loc, v_quote, v_mc.tag)
      returning id into v_obs;
      perform public.apply_observation(v_obs);
      if v_mc.tag is null then
        update public.misconceptions mc set evidence_count = mc.evidence_count + 1, last_seen = now() where mc.id = v_mc.id;
        insert into public.misconception_evidence (misconception_id, observation_id) values (v_mc.id, v_obs) on conflict do nothing;
      end if;
      v_ref := jsonb_build_object('observation_id', v_obs, 'misconception_id', v_mc.id);
    else
      v_ref := jsonb_build_object('skipped', 'not_observed');
    end if;
  elsif v_c.kind = 'course_insight' and v_val ->> 'kind' = 'syllabus_topic' then
    select coalesce(v_l.course_id, e.course_id) into v_course_id from (select 1) as one left join public.enrollments e on e.id = v_l.enrollment_id;
    select co.curriculum_id, co.created_by into v_cur, v_course_owner from public.courses co where co.id = v_course_id;
    v_title := left(coalesce(nullif(btrim(v_val ->> 'topic'), ''), nullif(btrim(v_val ->> 'text'), '')), 200);
    if v_cur is null or v_title is null then
      v_ref := jsonb_build_object('skipped', 'no_course_curriculum', 'memory_only', true);
    elsif v_l.instructor_id is null or v_course_owner is distinct from v_l.instructor_id then
      -- ortak (ya da başkasının) dersinin izlencesi bütün kayıtlıları etkiler: yalnız dersi oluşturan eğitmen yazar
      v_ref := jsonb_build_object('skipped', 'not_course_owner', 'memory_only', true);
    else
      select st.id into v_topic from public.syllabus_topics st where st.course_id = v_course_id and lower(st.title) = lower(v_title) limit 1;
      if v_topic is not null then
        v_ref := jsonb_build_object('syllabus_topic_id', v_topic, 'created', false);
      else
        insert into public.syllabus_topics (course_id, curriculum_id, title, skill_ids)
        values (v_course_id, v_cur, v_title,
                case when v_c.skill_id is not null
                          and exists (select 1 from public.skills s where s.curriculum_id = v_cur and s.id = v_c.skill_id)
                     then array[v_c.skill_id] else '{}'::text[] end)
        returning id into v_topic;
        v_ref := jsonb_build_object('syllabus_topic_id', v_topic, 'created', true);
      end if;
    end if;
  else
    v_ref := jsonb_build_object('memory_only', true);
  end if;
  update public.lesson_claims lc set applied_at = now(), applied_ref = v_ref where lc.id = p_claim;
  return v_ref;
end
$$;
comment on function app.lesson_apply_claim(uuid) is 'Onaylı ders iddiasını öğrenen modele uygular (gözlem + apply_observation, yanılgı, izlence); iz applied_ref''te.';

create or replace function app.lesson_revert_claim(p_claim uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_c public.lesson_claims%rowtype;
  v_ref jsonb;
  v_obs public.observations%rowtype;
  v_m public.mastery%rowtype;
  v_h public.mastery_history%rowtype;
  v_prev bigint;
  v_mc uuid;
begin
  select lc.* into v_c from public.lesson_claims lc where lc.id = p_claim for update;
  if not found or v_c.applied_at is null then
    return '{}'::jsonb;
  end if;
  v_ref := coalesce(v_c.applied_ref, '{}'::jsonb);
  if v_ref ? 'observation_id' then
    select o.* into v_obs from public.observations o where o.id = (v_ref ->> 'observation_id')::bigint;
    if found then
      select m.* into v_m from public.mastery m where m.enrollment_id = v_obs.enrollment_id and m.skill_id = v_obs.skill_id for update;
      if found then
        if v_m.last_observation_id is distinct from v_obs.id then
          raise exception using errcode = 'P0001', message = 'OGR-LESSON-006 bu kazanıma sonra yeni kanıt geldi: iddia geri alınamaz';
        end if;
        select h.* into v_h from public.mastery_history h where h.observation_id = v_obs.id order by h.id desc limit 1;
        select h2.observation_id into v_prev from public.mastery_history h2
         where h2.enrollment_id = v_obs.enrollment_id and h2.skill_id = v_obs.skill_id and h2.id < v_h.id
         order by h2.id desc limit 1;
        insert into public.mastery_history (enrollment_id, skill_id, observation_id, p_before, p_after, method, params)
        values (v_obs.enrollment_id, v_obs.skill_id, v_obs.id, v_m.p, coalesce(v_h.p_before, v_m.p), 'instructor_override',
                jsonb_build_object('revert', true, 'lesson_claim_id', p_claim));
        update public.mastery m
           set p = coalesce(v_h.p_before, m.p),
               evidence_count = greatest(m.evidence_count - 1, 0),
               last_observation_id = v_prev,
               updated_at = now()
         where m.enrollment_id = v_obs.enrollment_id and m.skill_id = v_obs.skill_id;
      end if;
      for v_mc in delete from public.misconception_evidence me where me.observation_id = v_obs.id returning me.misconception_id loop
        update public.misconceptions mc
           set evidence_count = greatest(mc.evidence_count - 1, 0),
               status = case when mc.evidence_count <= 1 and mc.status in ('pending_review', 'open') then 'rejected' else mc.status end,
               rejected_by = case when mc.evidence_count <= 1 and mc.status in ('pending_review', 'open') then auth.uid() else mc.rejected_by end,
               reject_note = case when mc.evidence_count <= 1 and mc.status in ('pending_review', 'open') then 'ders iddiası geri alındı'
                                  else mc.reject_note end
         where mc.id = v_mc;
      end loop;
      if v_ref ? 'resolved_misconception_id' then
        update public.misconceptions mc
           set status = coalesce(v_ref ->> 'prev_status', 'open'), resolved_at = null, resolved_by = null, resolution_observation_id = null
         where mc.id = (v_ref ->> 'resolved_misconception_id')::uuid and mc.status = 'resolved' and mc.resolution_observation_id = v_obs.id;
      end if;
    end if;
  end if;
  if coalesce((v_ref ->> 'created')::boolean, false) and v_ref ? 'syllabus_topic_id' then
    delete from public.syllabus_topics st where st.id = (v_ref ->> 'syllabus_topic_id')::uuid;
  end if;
  update public.lesson_claims lc set applied_at = null, applied_ref = v_ref || jsonb_build_object('reverted_at', now()) where lc.id = p_claim;
  return v_ref;
end
$$;
comment on function app.lesson_revert_claim(uuid) is 'Uygulanmış ders iddiasını geri alır (son gözlemse ustalık geri, yanılgı bağı, çözüm, açılan izlence konusu); değilse OGR-LESSON-006.';

-- Son analizin sayımlarına göre analiz ve ders durumu: bekleyen yoksa approved (düzeltilen varsa corrected), varsa draft/analyzed.
create or replace function app.lesson_refresh_status(p_lesson uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_an uuid;
  v_total int;
  v_pending int;
  v_applied int;
  v_edited int;
  v_state text;
begin
  select la.id into v_an from public.lesson_analyses la where la.lesson_id = p_lesson order by la.version desc limit 1;
  if v_an is null then
    return jsonb_build_object('total', 0, 'pending', 0, 'applied', 0);
  end if;
  select count(*), count(*) filter (where lc.status = 'pending'), count(*) filter (where lc.applied_at is not null),
         count(*) filter (where lc.status = 'edited')
    into v_total, v_pending, v_applied, v_edited
    from public.lesson_claims lc where lc.analysis_id = v_an;
  v_state := case when v_pending > 0 then 'draft' when v_edited > 0 then 'corrected' else 'approved' end;
  update public.lesson_analyses la
     set status = v_state,
         approved_by = case when v_state = 'draft' then null else coalesce(la.approved_by, auth.uid()) end,
         approved_at = case when v_state = 'draft' then null else coalesce(la.approved_at, now()) end
   where la.id = v_an and la.status is distinct from v_state;
  update public.lessons l
     set status = case when v_state = 'draft' then 'analyzed' else v_state end
   where l.id = p_lesson and l.status in ('analyzed', 'approved', 'corrected');
  return jsonb_build_object('total', v_total, 'pending', v_pending, 'applied', v_applied, 'analysis_status', v_state);
end
$$;
comment on function app.lesson_refresh_status(uuid) is 'Son analizin iddia sayımlarından analiz/ders durumunu günceller (bekleyen yoksa approved | corrected).';

-- 'memory.apply' işi: dersin öğrencilerinin courses/<kod>.md hafıza dosyası onaylı iddialardan kurulur (worker).
create or replace function app.lesson_enqueue_memory(p_lesson uuid) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_l public.lessons%rowtype;
  v_students uuid[] := app.lesson_students(p_lesson);
  v_course public.courses%rowtype;
  v_slug text;
  v_path text;
  v_claims uuid[];
begin
  select l.* into v_l from public.lessons l where l.id = p_lesson;
  if not found or cardinality(v_students) = 0 then
    return null;
  end if;
  select co.* into v_course from public.courses co
   where co.id = coalesce(v_l.course_id, (select e.course_id from public.enrollments e where e.id = v_l.enrollment_id));
  select array_agg(lc.id order by lc.t_start_sec) into v_claims
    from public.lesson_claims lc
   where lc.applied_at is not null
     and lc.analysis_id = (select la.id from public.lesson_analyses la where la.lesson_id = p_lesson order by la.version desc limit 1);
  if v_claims is null then
    return null;
  end if;
  v_slug := left(btrim(lower(regexp_replace(coalesce(v_course.code, 'genel'), '[^A-Za-z0-9_-]+', '-', 'g')), '-'), 60);
  v_path := '/memories/courses/' || coalesce(nullif(v_slug, ''), 'genel') || '.md';
  if not app.memory_path_ok(v_path) then
    v_path := '/memories/courses/genel.md';
  end if;
  return app.try_enqueue('memory.apply', jsonb_build_object('source', 'lesson', 'lesson_id', p_lesson, 'course_id', v_course.id,
                                                            'course_code', v_course.code, 'path', v_path,
                                                            'student_ids', to_jsonb(v_students), 'claim_ids', to_jsonb(v_claims)));
end
$$;
comment on function app.lesson_enqueue_memory(uuid) is '''memory.apply'' işi: dersin öğrencileri için /memories/courses/<kod>.md (uygulanan iddia kimlikleriyle).';

-- --- apply_lesson_claims ----------------------------------------------------------------------------------------------

-- Son analizin bekleyen iddialarından güveni ≥ lessons.auto_apply_threshold olanları onaylar (karar veren boş =
-- otomatik) ve uygular; onaylanmış ama uygulanmamış iddiaları da uygular. Eşiğin altı ve güveni boş olanlar bekler
-- (eğitmen incelemesi). Worker ('apply' aşaması) ya da dersi yöneten eğitmen ("Dossier'e uygula").
create or replace function public.apply_lesson_claims(p_lesson uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_l public.lessons%rowtype;
  v_an uuid;
  v_c record;
  v_applied int := 0;
  v_state jsonb;
  v_job uuid;
begin
  select l.* into v_l from public.lessons l where l.id = p_lesson for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 ders bulunamadı';
  end if;
  if not app.lesson_can_manage(p_lesson) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 iddiaları yalnız worker ya da dersi yöneten eğitmen uygular';
  end if;
  select la.id into v_an from public.lesson_analyses la where la.lesson_id = p_lesson order by la.version desc limit 1;
  if v_an is null then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-004 dersin analizi yok';
  end if;
  for v_c in
    select lc.id, lc.status from public.lesson_claims lc
     where lc.analysis_id = v_an
       and ((lc.status = 'pending' and lc.confidence is not null and lc.confidence >= v_l.auto_apply_threshold)
            or (lc.status in ('approved', 'edited') and lc.applied_at is null and lc.applied_ref is null))
     order by lc.t_start_sec, lc.created_at
  loop
    if v_c.status = 'pending' then
      update public.lesson_claims lc set status = 'approved', decided_by = null, decided_at = now() where lc.id = v_c.id;
    end if;
    perform app.lesson_apply_claim(v_c.id);
    v_applied := v_applied + 1;
  end loop;
  v_state := app.lesson_refresh_status(p_lesson);
  if v_applied > 0 then
    v_job := app.lesson_enqueue_memory(p_lesson);
  end if;
  return jsonb_build_object('lesson_id', p_lesson, 'applied', v_applied, 'pending', v_state -> 'pending',
                            'total', v_state -> 'total', 'threshold', v_l.auto_apply_threshold, 'memory_job_id', v_job);
end
$$;
comment on function public.apply_lesson_claims(uuid) is 'Worker ya da dersi yöneten eğitmen: güveni eşiğin üstündeki bekleyen iddiaları otomatik onaylar ve uygular; altı incelemeye kalır; memory.apply işi.';

-- --- review_lesson_claim ----------------------------------------------------------------------------------------------

-- Dersi yöneten eğitmen: p_decision approve | edit | reject. edit: p_edit iddia değerine birleştirilir (skill_mastery:
-- mastery_estimate 0–1; followup: status improved | still_present) ve düzeltilmiş değerle uygulanır. Uygulanmış iddiada
-- reject/edit önce geri alır ("Geri al"; sonra yeni kanıt geldiyse OGR-LESSON-006); uygulanmış iddiayı approve değişiklik
-- yapmaz. Yalnız son analiz sürümünün iddiaları kararlaştırılır.
create or replace function public.review_lesson_claim(p_claim uuid, p_decision text, p_edit jsonb default null) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_c public.lesson_claims%rowtype;
  v_lesson uuid;
  v_latest uuid;
  v_new jsonb;
  v_was_applied boolean;
  v_ref jsonb;
  v_state jsonb;
  v_job uuid;
  v_status text;
begin
  select lc.* into v_c from public.lesson_claims lc where lc.id = p_claim for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 iddia bulunamadı';
  end if;
  select la.lesson_id into v_lesson from public.lesson_analyses la where la.id = v_c.analysis_id;
  if not app.lesson_can_manage(v_lesson) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 iddiayı yalnız dersi yöneten eğitmen kararlaştırır';
  end if;
  if p_decision is null or p_decision not in ('approve', 'edit', 'reject') then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-005 karar approve, edit ya da reject olmalı';
  end if;
  select la.id into v_latest from public.lesson_analyses la where la.lesson_id = v_lesson order by la.version desc limit 1;
  if v_latest is distinct from v_c.analysis_id then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-005 eski analiz sürümünün iddiası kararlaştırılamaz';
  end if;
  if p_decision = 'edit' then
    if p_edit is null or jsonb_typeof(p_edit) <> 'object' or p_edit = '{}'::jsonb or length(p_edit::text) > 4000 then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-005 düzeltme boş olmayan bir nesne olmalı (≤ 4000 karakter)';
    end if;
    v_new := coalesce(v_c.edited_value, v_c.value) || p_edit;
    if v_c.kind = 'skill_mastery'
       and (jsonb_typeof(v_new -> 'mastery_estimate') is distinct from 'number' or (v_new ->> 'mastery_estimate')::numeric not between 0 and 1) then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-005 ustalık iddiasında mastery_estimate 0–1 olmalı';
    end if;
    if v_c.kind = 'followup' and coalesce(v_new ->> 'status', '') not in ('improved', 'still_present') then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-005 takip iddiasında status improved ya da still_present olmalı';
    end if;
  end if;
  v_was_applied := v_c.applied_at is not null;
  if v_was_applied and p_decision = 'approve' then
    v_state := app.lesson_refresh_status(v_lesson);
    return jsonb_build_object('claim_id', p_claim, 'status', v_c.status, 'applied', true, 'changed', false,
                              'applied_ref', v_c.applied_ref, 'pending', v_state -> 'pending', 'memory_job_id', null);
  end if;
  if v_was_applied then
    perform app.lesson_revert_claim(p_claim);
  end if;
  v_status := case p_decision when 'approve' then 'approved' when 'edit' then 'edited' else 'rejected' end;
  update public.lesson_claims lc
     set status = v_status,
         edited_value = case when p_decision = 'edit' then v_new else lc.edited_value end,
         applied_ref = case when p_decision <> 'reject' then null else lc.applied_ref end,
         decided_by = auth.uid(),
         decided_at = now()
   where lc.id = p_claim;
  if p_decision <> 'reject' then
    v_ref := app.lesson_apply_claim(p_claim);
  end if;
  v_state := app.lesson_refresh_status(v_lesson);
  if v_was_applied or (v_state ->> 'pending')::int = 0 or (p_decision <> 'reject' and v_c.kind = 'course_insight') then
    v_job := app.lesson_enqueue_memory(v_lesson);
  end if;
  -- Bekleyen kalmadıysa analiz approved | corrected olmuştur: öğrencilerin Bugün kartı (lesson_review) onaylı analizden kurulur
  if (v_state ->> 'pending')::int = 0 then
    perform app.try_enqueue('suggestions.refresh', jsonb_build_object('student_id', st, 'reason', 'lesson.approved'))
       from unnest(app.lesson_students(v_lesson)) as st;
  end if;
  return jsonb_build_object('claim_id', p_claim, 'status', v_status, 'applied', p_decision <> 'reject', 'changed', true,
                            'applied_ref', v_ref, 'pending', v_state -> 'pending', 'memory_job_id', v_job);
end
$$;
comment on function public.review_lesson_claim(uuid, text, jsonb) is 'Dersi yöneten eğitmen: ders iddiasını onaylar, düzeltir ya da reddeder (uygulanmışsa geri alır); onay/düzeltme hemen uygulanır.';

-- --- okuma ------------------------------------------------------------------------------------------------------------

-- Ders görünümü. Personel (app.lesson_staff_view): ders, ilerleme, transkript, son analiz özeti, iddialar (kazanım adı,
-- güncel ustalık, bu dersin etkisi p_before → p_after), sayımlar, can_manage. Öğrenci (student_visible ve kendi dersi):
-- yalnız onaylı iddialardan özet {next_step, topics, homework}; transkript, alıntı, güven ve ustalık yok. Veli ve
-- diğerleri: OGR-AUTH-001.
create or replace function public.lesson_view(p_lesson uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_l public.lessons%rowtype;
  v_an public.lesson_analyses%rowtype;
  v_lesson jsonb;
  v_transcript jsonb;
  v_claims jsonb;
  v_counts jsonb;
  v_topics jsonb;
  v_homework jsonb;
  v_next text;
begin
  select l.* into v_l from public.lessons l where l.id = p_lesson;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 ders bulunamadı';
  end if;
  select la.* into v_an from public.lesson_analyses la where la.lesson_id = p_lesson order by la.version desc limit 1;

  if app.lesson_staff_view(p_lesson) then
    select jsonb_build_object(
             'id', v_l.id, 'no', app.lesson_no(v_l.id), 'title', v_l.title, 'held_at', v_l.held_at,
             'duration_sec', coalesce(v_l.duration_sec, v_l.duration_min * 60), 'status', v_l.status,
             'stage', v_l.progress ->> 'stage', 'progress', v_l.progress, 'student_visible', v_l.student_visible,
             'auto_apply_threshold', v_l.auto_apply_threshold, 'retain_until', v_l.retain_until,
             'video_deleted_at', v_l.video_deleted_at, 'audio_deleted_at', v_l.audio_deleted_at,
             'enrollment_id', v_l.enrollment_id, 'course_id', coalesce(v_l.course_id, e.course_id),
             'course_title', co.title, 'course_code', co.code,
             'student', case when e.id is not null then jsonb_build_object('id', e.student_id, 'name', sp.display_name) end,
             'instructor', case when v_l.instructor_id is not null then jsonb_build_object('id', v_l.instructor_id, 'name', ip.display_name) end,
             'upload', case when u.id is not null then jsonb_build_object('id', u.id, 'kind', u.kind, 'storage_path', u.storage_path,
                                                                          'mime', u.mime, 'bytes', u.bytes, 'status', u.status) end,
             'can_manage', app.lesson_can_manage(v_l.id))
      into v_lesson
      from (select 1) as one
      left join public.enrollments e on e.id = v_l.enrollment_id
      left join public.students s on s.id = e.student_id
      left join public.profiles sp on sp.id = s.profile_id
      left join public.profiles ip on ip.id = v_l.instructor_id
      left join public.courses co on co.id = coalesce(v_l.course_id, e.course_id)
      left join public.uploads u on u.id = v_l.upload_id;
    select jsonb_build_object('segments', lt.segments, 'language', lt.language, 'provider', lt.provider, 'labeled', lt.labeled,
                              'segment_count', lt.segment_count, 'updated_at', lt.updated_at)
      into v_transcript
      from public.lesson_transcripts lt where lt.lesson_id = p_lesson;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', lc.id, 'kind', lc.kind, 'skill_id', lc.skill_id, 'skill_name', sk.name, 'misconception_tag', lc.misconception_tag,
             'misconception_id', lc.misconception_id, 'value', lc.value, 'edited_value', lc.edited_value, 'confidence', lc.confidence,
             'below_threshold', lc.confidence is null or lc.confidence < v_l.auto_apply_threshold,
             'quote', lc.quote, 'speaker', lc.speaker, 't_start_sec', lc.t_start_sec, 't_end_sec', lc.t_end_sec,
             'status', lc.status, 'auto', lc.status = 'approved' and lc.decided_by is null, 'decided_at', lc.decided_at,
             'applied', lc.applied_at is not null, 'applied_at', lc.applied_at, 'applied_ref', lc.applied_ref,
             'mastery', case when m.skill_id is not null then jsonb_build_object('p', m.p, 'evidence_count', m.evidence_count) end,
             'effect', case when mh.id is not null then jsonb_build_object('p_before', mh.p_before, 'p_after', mh.p_after) end)
             order by lc.t_start_sec, lc.created_at), '[]'::jsonb),
           jsonb_build_object('total', count(*), 'pending', count(*) filter (where lc.status = 'pending'),
                              'applied', count(*) filter (where lc.applied_at is not null),
                              'rejected', count(*) filter (where lc.status = 'rejected'))
      into v_claims, v_counts
      from public.lesson_claims lc
      left join public.skills sk on sk.curriculum_id = lc.curriculum_id and sk.id = lc.skill_id
      left join public.mastery m on m.enrollment_id = v_l.enrollment_id and m.skill_id = lc.skill_id and lc.kind = 'skill_mastery'
      left join lateral (select h.id, h.p_before, h.p_after from public.mastery_history h
                          where lc.applied_at is not null and h.observation_id = (lc.applied_ref ->> 'observation_id')::bigint
                            and h.method <> 'instructor_override'
                          order by h.id limit 1) as mh on true
     where lc.analysis_id = v_an.id;
    return jsonb_build_object(
      'role', 'staff', 'lesson', v_lesson, 'transcript', v_transcript,
      'analysis', case when v_an.id is not null then jsonb_build_object(
                    'id', v_an.id, 'version', v_an.version, 'status', v_an.status, 'model', v_an.model, 'created_at', v_an.created_at,
                    'next_step', v_an.analysis -> 'next_step', 'talk', v_an.analysis -> 'talk') end,
      'claims', coalesce(v_claims, '[]'::jsonb),
      'counts', coalesce(v_counts, jsonb_build_object('total', 0, 'pending', 0, 'applied', 0, 'rejected', 0)));
  end if;

  if app.lesson_student_view(p_lesson) then
    select coalesce(jsonb_agg(distinct sk.name), '[]'::jsonb) into v_topics
      from public.lesson_claims lc join public.skills sk on sk.curriculum_id = lc.curriculum_id and sk.id = lc.skill_id
     where lc.analysis_id = v_an.id and lc.kind = 'skill_mastery' and lc.status in ('approved', 'edited');
    select coalesce(jsonb_agg(jsonb_build_object('text', coalesce(lc.edited_value, lc.value) ->> 'text',
                                                 'due', coalesce(lc.edited_value, lc.value) ->> 'due') order by lc.t_start_sec), '[]'::jsonb)
      into v_homework
      from public.lesson_claims lc
     where lc.analysis_id = v_an.id and lc.kind in ('homework', 'deadline') and lc.status in ('approved', 'edited')
       and coalesce(lc.edited_value, lc.value) ->> 'who' is distinct from 'EĞİTMEN';
    select coalesce(lc.edited_value, lc.value) ->> 'for_student' into v_next
      from public.lesson_claims lc
     where lc.analysis_id = v_an.id and lc.kind = 'next_step' and lc.status in ('approved', 'edited')
     limit 1;
    return jsonb_build_object(
      'role', 'student',
      'lesson', jsonb_build_object('id', v_l.id, 'no', app.lesson_no(v_l.id), 'title', v_l.title, 'held_at', v_l.held_at,
                                   'duration_sec', coalesce(v_l.duration_sec, v_l.duration_min * 60)),
      'summary', jsonb_build_object('ready', v_an.id is not null and v_an.status in ('approved', 'corrected', 'draft')
                                             and (v_next is not null or jsonb_array_length(v_topics) > 0 or jsonb_array_length(v_homework) > 0),
                                    'next_step', v_next, 'topics', v_topics, 'homework', v_homework));
  end if;
  raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu ders için yetki yok';
end
$$;
comment on function public.lesson_view(uuid) is 'Ders görünümü: eğitmen transkript + iddialar; öğrenci (student_visible) yalnız onaylı özet; veli yok (OGR-AUTH-001).';

-- Ders listesi (en çok 200, yeniden eskiye). Personel: görebildiği dersler (p_student verilirse o öğrencinin birebir ve
-- kapsamında olduğu sınıf dersleri, app.lesson_students; öğrenciyi okuyabilmeli). Öğrenci: yalnız kendi student_visible dersleri (p_student boş ya da kendisi).
-- Veli: OGR-AUTH-001.
create or replace function public.list_lessons(p_student uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_trusted boolean := app.is_trusted();
  v_role text := app.role();
  v_out jsonb;
begin
  if not v_trusted then
    if v_role is null or v_role = 'parent' then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 ders kayıtları veliye kapalı';
    end if;
    if v_role = 'student' then
      if p_student is not null and p_student is distinct from app.my_student_id() then
        raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu öğrenci için yetki yok';
      end if;
      select coalesce(jsonb_agg(x.item order by x.held_at desc), '[]'::jsonb) into v_out
        from (select l.held_at,
                     jsonb_build_object('id', l.id, 'no', app.lesson_no(l.id), 'title', l.title, 'held_at', l.held_at,
                                        'duration_sec', coalesce(l.duration_sec, l.duration_min * 60),
                                        'summary_ready', exists (select 1 from public.lesson_analyses la join public.lesson_claims lc on lc.analysis_id = la.id
                                                                  where la.lesson_id = l.id and lc.status in ('approved', 'edited'))) as item
                from public.lessons l
               where app.lesson_student_view(l.id)
               order by l.held_at desc
               limit 200) as x;
      return v_out;
    end if;
    if p_student is not null and not app.can_read_student_data(p_student) then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu öğrenci için yetki yok';
    end if;
  end if;
  select coalesce(jsonb_agg(x.item order by x.held_at desc), '[]'::jsonb) into v_out
    from (select l.held_at,
                 jsonb_build_object(
                   'id', l.id, 'no', app.lesson_no(l.id), 'title', l.title, 'held_at', l.held_at,
                   'duration_sec', coalesce(l.duration_sec, l.duration_min * 60), 'status', l.status,
                   'stage', l.progress ->> 'stage', 'error', l.progress ->> 'error', 'student_visible', l.student_visible,
                   'enrollment_id', l.enrollment_id, 'course_id', coalesce(l.course_id, e.course_id), 'course_title', co.title,
                   'student', case when e.id is not null then jsonb_build_object('id', e.student_id, 'name', sp.display_name) end,
                   'transcript_ready', exists (select 1 from public.lesson_transcripts lt where lt.lesson_id = l.id),
                   'claims', (select jsonb_build_object('total', count(*), 'pending', count(*) filter (where lc.status = 'pending'),
                                                        'applied', count(*) filter (where lc.applied_at is not null))
                                from public.lesson_claims lc
                               where lc.analysis_id = (select la.id from public.lesson_analyses la where la.lesson_id = l.id
                                                        order by la.version desc limit 1))) as item
            from public.lessons l
            left join public.enrollments e on e.id = l.enrollment_id
            left join public.students s on s.id = e.student_id
            left join public.profiles sp on sp.id = s.profile_id
            left join public.courses co on co.id = coalesce(l.course_id, e.course_id)
           where app.lesson_staff_view(l.id)
             and (p_student is null
                  or e.student_id = p_student
                  or (l.enrollment_id is null and p_student = any (app.lesson_students(l.id))))
           order by l.held_at desc
           limit 200) as x;
  return v_out;
end
$$;
comment on function public.list_lessons(uuid) is 'Ders listesi: personel görebildiklerini (isteğe bağlı öğrenciye göre), öğrenci yalnız student_visible derslerini; veli OGR-AUTH-001.';

-- --- koç araması: ders alıntıları yalnız öğrenciye açık derslerden -----------------------------------------------------
-- 0028'deki coach_tool_search_evidence aynen; tek fark ders dalında l.student_visible (öğrenci yalnız student_visible
-- dersinin özetini görür; koç aracının döndürdüğü alıntı öğrenciye ulaşabilir) ve iddia türü süzgeci: yalnız öğrenciyle
-- ilgili kanıt türleri (soru, tereddüt, ustalık, yanılgı, takip, ödev, söz, son gün). Konuşma dengesi (talk: eğitmene
-- özel dikkat/moral notu), sonraki adım ve ders bilgisi koça alıntı olarak gitmez.
-- search_evidence: kelime eşleşmesi (gömme yokken). p_q boşlukla ayrılmış kelimeler (sunucu küçük harfe çevirip ayırır;
-- ≥ 3 karakter, en çok 6); p_kinds ⊆ {upload, solution_analysis, lesson, exam_response, conversation}; p_limit 1–20.
-- Döner {words, results[{kind, id, at, txt (≤ 4000), score}]}; puan = eşleşen kelime sayısı, sonra yenilik.
create or replace function public.coach_tool_search_evidence(p_q text, p_kinds text[] default null, p_limit int default 5) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
  v_words text[];
  v_kinds text[] := coalesce(nullif(p_kinds, '{}'), array['upload', 'solution_analysis', 'lesson', 'exam_response', 'conversation']);
begin
  if auth.uid() is null or v_student is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 koç araçları yalnız öğrencinin kendisine açıktır';
  end if;
  select coalesce(array_agg(w.word order by w.first), '{}') into v_words
    from (select x.word, min(x.n) as first
            from regexp_split_to_table(lower(coalesce(p_q, '')), '\s+') with ordinality as x (word, n)
           where char_length(x.word) between 3 and 64
           group by x.word order by min(x.n) limit 6) w;
  if cardinality(v_words) = 0 then
    return jsonb_build_object('words', '[]'::jsonb, 'results', '[]'::jsonb);
  end if;
  return jsonb_build_object('words', to_jsonb(v_words), 'results', (
    select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'id', r.id, 'at', r.at, 'txt', left(r.txt, 4000), 'score', r.score)
                              order by r.score desc, r.at desc nulls last), '[]'::jsonb)
      from (
        select ev.kind, ev.id, ev.at, ev.txt,
               (select count(*) from unnest(v_words) as w (word) where ev.txt ilike '%' || w.word || '%')::int as score
          from (
            select 'upload'::text as kind, u.id::text as id, u.created_at as at, coalesce(u.extracted_text, '') as txt
              from public.uploads u where u.student_id = v_student and u.extracted_text is not null
            union all
            select 'solution_analysis', sa.id::text, sa.created_at,
                   concat_ws(' ', sa.question_text, sa.student_work_text, sa.analysis ->> 'why_tr', array_to_string(sa.skill_ids, ' '),
                             array_to_string(sa.misconception_tags, ' '))
              from public.solution_analyses sa join public.enrollments e on e.id = sa.enrollment_id where e.student_id = v_student
            union all
            select 'exam_response', er.id::text, es.created_at, coalesce(er.how_far_text, '')
              from public.exam_responses er join public.exam_sessions es on es.id = er.session_id
              join public.enrollments e on e.id = es.enrollment_id
             where e.student_id = v_student and er.how_far_text is not null
            union all
            select 'lesson', lc.id::text, l.held_at, lc.quote
              from public.lesson_claims lc join public.lesson_analyses la on la.id = lc.analysis_id
              join public.lessons l on l.id = la.lesson_id join public.enrollments e on e.id = l.enrollment_id
             where e.student_id = v_student and lc.status in ('approved', 'edited') and l.student_visible
               and lc.kind in ('question', 'hesitation', 'skill_mastery', 'misconception', 'followup', 'homework', 'promise', 'deadline')
            union all
            select 'conversation', cm.id::text, cm.created_at,
                   coalesce((select string_agg(b.blk ->> 'text', ' ') from jsonb_array_elements(cm.content) as b (blk)
                              where b.blk ->> 'type' = 'text'), '')
              from public.conversation_messages cm join public.conversations c on c.id = cm.conversation_id
             where c.student_id = v_student and c.kind = 'coach' and cm.role in ('user', 'assistant')
          ) ev
         where ev.kind = any(v_kinds)
           and exists (select 1 from unnest(v_words) as w (word) where ev.txt ilike '%' || w.word || '%')
         order by score desc, ev.at desc nulls last
         limit least(greatest(coalesce(p_limit, 5), 1), 20)
      ) r));
end
$$;
comment on function public.coach_tool_search_evidence(text, text[], int) is 'Koç aracı search_evidence: öğrencinin yüklemeleri, teşhisleri, deneme notları, onaylı ders iddiaları (yalnız student_visible ders; 0041) ve koç sohbeti içinde kelime araması.';

-- --- yetkiler ------------------------------------------------------------------------------------------------------------

revoke all on function app.lesson_apply_claim(uuid), app.lesson_revert_claim(uuid), app.lesson_refresh_status(uuid),
  app.lesson_enqueue_memory(uuid) from public;
grant execute on function app.lesson_apply_claim(uuid), app.lesson_revert_claim(uuid), app.lesson_refresh_status(uuid),
  app.lesson_enqueue_memory(uuid) to service_role;

revoke all on function public.apply_lesson_claims(uuid), public.review_lesson_claim(uuid, text, jsonb), public.lesson_view(uuid),
  public.list_lessons(uuid) from public, anon;
grant execute on function public.apply_lesson_claims(uuid), public.review_lesson_claim(uuid, text, jsonb), public.lesson_view(uuid),
  public.list_lessons(uuid) to authenticated, service_role;
