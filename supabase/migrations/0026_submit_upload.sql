-- 0026_submit_upload.sql — Yükle ekranının gönderimi (docs/PLAN-v2.md §2 Akış 1, §13 "Yükle"). Web sayfaları
-- Storage'a (<auth.uid()>/<uuid>.jpg|pdf) ve uploads satırlarına (RLS uploads_insert_own) yazar, sonra öğrenci
-- oturumunda public.submit_upload(p_upload_ids, p_kind) çağırır. RPC tek işlemde:
--   * çağıran öğrenci mi (app.my_student_id(); değilse OGR-AUTH-001),
--   * tür own_work (Kendi çalışmam: 1–4 sayfa, PLAN §2 "çözüm fotoğrafı ≤4") ya da school_exam (Okul denemesi: 1–40
--     sayfa) mı (OGR-UPL-001), kimlikler tekil mi,
--   * her yükleme çağıranın (owner_id = auth.uid(), student_id = öğrencisi) ve durumu 'stored' ya da 'processing' mi
--     (OGR-UPL-002 yok/başkasının, OGR-UPL-003 işlenmiş),
--   * öğrencinin en son açılan etkin kaydı (OGR-UPL-004 kayıt yok),
-- sonra yüklemeleri 'processing' yapar ve 'upload.intake' işini public.enqueue_job ile kuyruğa atar (try_enqueue değil:
-- kuyruk yoksa OGR-JOB-001 ile düşer, öğrenci "alındı" görmez). pgboss şeması hiç yoksa (worker kurulmamış yerel
-- veritabanı) enqueue_job audit.events'e 'job.enqueue_skipped' yazar ve job_id null döner (sessiz değil).
-- Yeniden deneme: aynı küme (sırası önemsiz) AYNI türle tekrar gönderilirse yeni iş atılmaz, ilk gönderimin işi döner
-- (reused; küme işlenmiş olsa da: web sonuç sayfasına gider). Anahtar audit.events 'upload.submit' satırıdır: row_id =
-- kümenin en küçük kimliği, diff.upload_set = sıralı küme, diff.kind = tür (enqueue_job tekil anahtar almadığından
-- tekilliği bu satır sağlar). Kümede başka bir gönderime ait sayfa varsa (farklı küme: [A,B] sonra [A,C] ya da alt küme
-- [B]; ya da aynı küme farklı türle) OGR-UPL-003: yeni sayfa sessizce 'processing'te kalmaz, aynı sayfa iki kez teşhis
-- edilmez. Durum yalnız karar verildikten sonra değişir.
-- Döner: {enrollment_id, job_id, upload_ids, kind, reused}.

-- apply_diagnosis (0017) yeniden tanımlanır: alt kazanım önerisi gözlemlerden ÖNCE işlenir; otopilot müfredat
-- kurucunun kuralıyla (public.curriculum_autopilot_state, 0025: ai_draft + TYT/AYT/LGS + eğitmen seçimi ya da
-- runtime_flags.curriculum_autopilot) etkin ve müfredat TASLAKSA öneri hemen kabul edilir ve geçerli yaprak yoksa gözlem
-- yeni yaprağa yazılır, solution_analyses.skill_ids güncellenir. Yayındaki müfredatta öneri açık kalır: yayındaki ağaç
-- değişmez, gece incelemesi kabulü açık taslak sürüme uygular (curriculum_autopilot_accept).
-- Öneri yükü apply_proposal'ın beklediği biçimdedir: {parent_id, name, description, id?} (worker diagnosis.run eşler).

create or replace function public.submit_upload(p_upload_ids uuid[], p_kind text) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
  v_ids uuid[] := coalesce(p_upload_ids, '{}');
  v_max int;
  v_found int;
  v_bad int;
  v_enr uuid;
  v_job uuid;
  v_prev jsonb;
  v_set jsonb;
  v_open int;
begin
  if v_student is null or auth.uid() is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 yükleme yalnız öğrenci oturumunda gönderilir';
  end if;
  v_max := case p_kind when 'own_work' then 4 when 'school_exam' then 40 end;
  if v_max is null then
    raise exception using errcode = 'P0001', message = format('OGR-UPL-001 yükleme türü geçersiz: %s', coalesce(p_kind, '(boş)'));
  end if;
  if cardinality(v_ids) < 1 or cardinality(v_ids) > v_max
     or (select count(distinct x.u) from unnest(v_ids) as x (u)) <> cardinality(v_ids)
     or array_position(v_ids, null) is not null then
    raise exception using errcode = 'P0001',
      message = format('OGR-UPL-001 %s için 1–%s tekil sayfa gerekir (gelen %s)', p_kind, v_max, cardinality(v_ids));
  end if;

  -- yüklemeler: çağıranın ve öğrencisinin; aynı kümenin eşzamanlı ikinci gönderimi burada bekler
  perform 1 from public.uploads u where u.id = any(v_ids) order by u.id for update;
  select count(*), count(*) filter (where u.status not in ('stored', 'processing')), count(*) filter (where u.status = 'processing')
    into v_found, v_bad, v_open
    from public.uploads u
   where u.id = any(v_ids) and u.owner_id = auth.uid() and u.student_id = v_student;
  if v_found <> cardinality(v_ids) then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-002 yükleme bulunamadı ya da senin değil';
  end if;

  select e.id into v_enr from public.enrollments e
   where e.student_id = v_student and e.status = 'active'
   order by e.created_at desc, e.id
   limit 1;
  if v_enr is null then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-004 etkin ders kaydı yok';
  end if;

  -- yeniden deneme: tam aynı küme (sırasız) ve aynı tür için atılmış gönderim varsa ikinci iş yok (küme işlenmiş olsa da)
  v_set := (select jsonb_agg(x.u order by x.u) from unnest(v_ids) as x (u));
  select ae.diff into v_prev from audit.events ae
   where ae.action = 'upload.submit' and ae.row_id = v_set ->> 0 and ae.diff -> 'upload_set' = v_set
     and ae.diff ->> 'kind' = p_kind
   order by ae.created_at desc, ae.id desc limit 1;
  if v_prev is not null then
    return jsonb_build_object('enrollment_id', v_prev ->> 'enrollment_id', 'job_id', v_prev ->> 'job_id',
                              'upload_ids', to_jsonb(v_ids), 'kind', p_kind, 'reused', true);
  end if;
  -- başka gönderimin sayfası: işlenmiş (ready/failed) ya da işleniyor (farklı küme, alt küme, farklı tür)
  if v_bad > 0 then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-003 yükleme zaten işlendi';
  end if;
  if v_open > 0 then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-003 sayfaların bir kısmı başka bir gönderimde işleniyor';
  end if;

  update public.uploads u set status = 'processing' where u.id = any(v_ids) and u.status <> 'processing';
  v_job := public.enqueue_job('upload.intake', jsonb_build_object(
    'upload_ids', to_jsonb(v_ids), 'kind', p_kind, 'student_id', v_student, 'enrollment_id', v_enr));
  perform app.audit_event('upload.submit', 'public.uploads', v_set ->> 0,
                          jsonb_build_object('upload_ids', to_jsonb(v_ids), 'upload_set', v_set, 'kind', p_kind,
                                             'enrollment_id', v_enr, 'job_id', v_job));
  return jsonb_build_object('enrollment_id', v_enr, 'job_id', v_job, 'upload_ids', to_jsonb(v_ids), 'kind', p_kind, 'reused', false);
end
$$;
comment on function public.submit_upload(uuid[], text) is 'Öğrenci: yüklenen sayfaları doğrular, processing yapar, upload.intake işini kuyruğa atar (enqueue_job; aynı küme + türün yeniden denemesinde aynı iş; başka gönderimin sayfası OGR-UPL-003).';

revoke all on function public.submit_upload(uuid[], text) from public, anon;
grant execute on function public.submit_upload(uuid[], text) to authenticated;

-- --- apply_diagnosis: otopilot kabulünde gözlem yeni yaprağa ------------------------------------------

create or replace function public.apply_diagnosis(p_analysis jsonb) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_enr public.enrollments%rowtype;
  v_id uuid;
  v_verdict text;
  v_cause text;
  v_skills text[];
  v_tags text[];
  v_style uuid;
  v_resp uuid;
  v_msg bigint;
  v_step int;
  v_bad text;
  v_weight numeric;
  v_skill text;
  v_tag text;
  v_obs bigint;
  v_prop jsonb;
  v_prop_id uuid;
  v_auto boolean;
  v_res jsonb;
begin
  if coalesce(jsonb_typeof(p_analysis), '') <> 'object' or coalesce(jsonb_typeof(p_analysis -> 'analysis'), '') <> 'object' then
    raise exception using errcode = 'P0001', message = 'OGR-DIAG-001 girdi nesne olmalı ve analysis alanı (nesne) taşımalı';
  end if;
  select e.* into v_enr from public.enrollments e where e.id = (p_analysis ->> 'enrollment_id')::uuid;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-DIAG-001 enrollment_id bulunamadı';
  end if;
  perform app.assert_evidence_writer(v_enr.student_id);

  v_verdict := p_analysis ->> 'verdict';
  v_cause := nullif(p_analysis ->> 'error_cause', '');
  v_style := nullif(p_analysis ->> 'style_id', '')::uuid;
  v_resp := nullif(p_analysis ->> 'exam_response_id', '')::uuid;
  v_msg := nullif(p_analysis ->> 'conversation_message_id', '')::bigint;
  v_step := nullif(p_analysis ->> 'failing_step_no', '')::int;
  v_prop := p_analysis -> 'proposed_subskill';
  v_skills := array(select distinct x.sid from jsonb_array_elements_text(coalesce(p_analysis -> 'skill_ids', '[]')) as x (sid) order by x.sid);
  v_tags := array(select x.tag from jsonb_array_elements_text(coalesce(p_analysis -> 'misconception_tags', '[]')) with ordinality as x (tag, ord)
                   group by x.tag order by min(x.ord));

  if v_verdict is null or v_verdict not in ('correct', 'wrong', 'incomplete', 'unreadable') then
    raise exception using errcode = 'P0001', message = format('OGR-DIAG-001 verdict geçersiz: %s', coalesce(v_verdict, '(boş)'));
  end if;
  if v_cause is not null and v_cause not in ('concept', 'procedure', 'careless', 'reading', 'time') then
    raise exception using errcode = 'P0001', message = format('OGR-DIAG-001 error_cause geçersiz: %s', v_cause);
  end if;
  select string_agg(x.sid, ', ') into v_bad from unnest(v_skills) as x (sid)
   where not exists (select 1 from public.skills s where s.curriculum_id = v_enr.curriculum_id and s.id = x.sid and s.is_leaf);
  if v_bad is not null then
    raise exception using errcode = 'P0001', message = format('OGR-DIAG-002 kazanım bu kaydın müfredatında yaprak değil: %s', v_bad);
  end if;
  select string_agg(x.tag, ', ') into v_bad from unnest(v_tags) as x (tag)
   where not exists (select 1 from public.misconception_tags mt where mt.tag = x.tag);
  if v_bad is not null then
    raise exception using errcode = 'P0001', message = format('OGR-DIAG-003 bilinmeyen yanılgı etiketi: %s', v_bad);
  end if;
  if v_step is not null and jsonb_typeof(p_analysis -> 'analysis' -> 'steps') = 'array'
     and v_step > jsonb_array_length(p_analysis -> 'analysis' -> 'steps') then
    raise exception using errcode = 'P0001', message = format('OGR-DIAG-004 failing_step_no (%s) adım sayısından büyük', v_step);
  end if;
  if v_resp is not null and not exists (select 1 from public.exam_responses r join public.exam_sessions es on es.id = r.session_id
                                         where r.id = v_resp and es.enrollment_id = v_enr.id) then
    raise exception using errcode = 'P0001', message = 'OGR-DIAG-005 exam_response_id bu kayda ait değil';
  end if;
  if v_msg is not null and not exists (select 1 from public.conversation_messages m join public.conversations c on c.id = m.conversation_id
                                        where m.id = v_msg and c.student_id = v_enr.student_id) then
    raise exception using errcode = 'P0001', message = 'OGR-DIAG-005 conversation_message_id bu öğrenciye ait değil';
  end if;
  if v_style is not null and not exists (select 1 from public.question_styles qs
                                          where qs.id = v_style and (v_enr.course_id is null or qs.course_id = v_enr.course_id)) then
    raise exception using errcode = 'P0001', message = 'OGR-DIAG-005 style_id bu kaydın dersinde değil';
  end if;
  if not app.uploads_ok(array(select x.u::uuid from jsonb_array_elements_text(coalesce(p_analysis -> 'upload_ids', '[]')) as x (u)),
                        v_enr.student_id) then
    raise exception using errcode = 'P0001', message = 'OGR-DIAG-005 upload_ids bu öğrenciye ait değil';
  end if;

  insert into public.solution_analyses (enrollment_id, conversation_message_id, exam_response_id, upload_ids, question_text,
                                        student_work_text, analysis, verdict, failing_step_no, error_cause, skill_ids,
                                        misconception_tags, style_id, model, cost_usd, embedding)
  values (v_enr.id, v_msg, v_resp,
          array(select x.u::uuid from jsonb_array_elements_text(coalesce(p_analysis -> 'upload_ids', '[]')) as x (u)),
          p_analysis ->> 'question_text', p_analysis ->> 'student_work_text', p_analysis -> 'analysis', v_verdict, v_step, v_cause,
          v_skills, v_tags, v_style, p_analysis ->> 'model', coalesce((p_analysis ->> 'cost_usd')::numeric, 0),
          case when jsonb_typeof(p_analysis -> 'embedding') = 'array' then (p_analysis ->> 'embedding')::halfvec(1024) end)
  returning id into v_id;

  -- uygun yaprak yoksa alt kazanım önerisi; otopilot etkin taslak müfredatta → hemen kabul ve gözlem yeni yaprağa
  -- (0026: öneri bloğu gözlemlerden önce)
  if jsonb_typeof(v_prop) = 'object' then
    insert into public.curriculum_proposals (curriculum_id, kind, payload, evidence_ids)
    values (v_enr.curriculum_id, 'add_subskill', v_prop || jsonb_build_object('source', 'diagnosis'), array[v_id])
    returning id into v_prop_id;
    update public.solution_analyses sa set proposal_id = v_prop_id where sa.id = v_id;
    -- otopilot kuralı müfredat kurucuyla aynı (curriculum_autopilot_state: ai_draft + TYT/AYT/LGS + eğitmen seçimi ya da
    -- runtime_flags). Yerinde kabul yalnız taslakta: yayındaki ağaç değişmez, öneri açık kalır ve gece incelemesi
    -- (curriculum_autopilot_accept) onu açık taslak sürüme uygular.
    v_auto := coalesce((public.curriculum_autopilot_state(v_enr.curriculum_id) ->> 'effective')::boolean, false)
              and exists (select 1 from public.curricula c where c.id = v_enr.curriculum_id and c.status = 'draft');
    if v_auto then
      v_res := app.apply_proposal(v_prop_id, true, 'otopilot');
      -- otopilotun açtığı yaprak bu çözümün kanıtıdır: gözlem ona yazılır (0026)
      if v_res ->> 'skill_id' is not null and cardinality(v_skills) = 0 then
        v_skills := array[v_res ->> 'skill_id'];
        update public.solution_analyses sa set skill_ids = v_skills where sa.id = v_id;
      end if;
    end if;
  end if;

  -- gözlemler: okunamayan çözüm kanıt değildir
  if v_verdict <> 'unreadable' then
    v_weight := case when v_resp is not null then 0
                     when v_cause in ('careless', 'time') then app.setting_num('careless_weight', 0.5)
                     else 1 end;
    foreach v_skill in array v_skills loop
      v_tag := null;
      if v_verdict <> 'correct' then
        select x.tag into v_tag from unnest(v_tags) with ordinality as x (tag, ord)
          join public.misconception_tags mt on mt.tag = x.tag
         where mt.skill_id = v_skill
         order by x.ord limit 1;
        if v_tag is null and cardinality(v_skills) = 1 then
          v_tag := v_tags[1];
        end if;
      end if;
      insert into public.observations (enrollment_id, skill_id, kind, value, weight, confidence, error_cause, source_type, source_id,
                                       source_locator, quote, misconception_tag, counts_for_mastery)
      values (v_enr.id, v_skill, 'practice', case when v_verdict = 'correct' then 1 else 0 end, v_weight,
              (p_analysis ->> 'confidence')::numeric, case when v_verdict = 'correct' then null else v_cause end,
              'solution_analysis', v_id::text,
              'teşhis ' || left(v_id::text, 8) || coalesce(' · adım ' || v_step, '') || case when v_resp is not null then ' · deneme' else '' end,
              left(nullif(p_analysis ->> 'quote', ''), 300), v_tag, v_resp is null)
      returning id into v_obs;
      perform public.apply_observation(v_obs);
    end loop;
  end if;

  if v_style is not null then
    insert into public.style_coverage as sc (enrollment_id, style_id, seen_count, solved_count, correct_count, last_seen_at)
    values (v_enr.id, v_style, 1, case when v_verdict = 'unreadable' then 0 else 1 end, case when v_verdict = 'correct' then 1 else 0 end, now())
    on conflict (enrollment_id, style_id) do update
      set seen_count = sc.seen_count + 1,
          solved_count = sc.solved_count + excluded.solved_count,
          correct_count = sc.correct_count + excluded.correct_count,
          last_seen_at = now();
  end if;
  if v_resp is not null then
    update public.exam_responses r set solution_analysis_id = v_id where r.id = v_resp;
  end if;

  perform app.try_enqueue('diagnosis.followup', jsonb_build_object('analysis_id', v_id, 'enrollment_id', v_enr.id));
  return v_id;
end
$$;
comment on function public.apply_diagnosis(jsonb) is 'Teşhisi yazar: solution_analyses + observations (careless/time w=0.5) → apply_observation + style_coverage (+ öneri; otopilot etkin taslakta hemen kabul, gözlem yeni yaprağa); id döner.';
