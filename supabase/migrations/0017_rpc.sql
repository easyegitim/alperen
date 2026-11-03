-- 0017_rpc.sql — uygulama RPC'leri (docs/PLAN-v2-detail.md §2.5, docs/PLAN-v2.md §3, §8, §10, §12).
-- Hepsi SECURITY DEFINER, search_path sabit; hatalar OGR-* kodlu (yetki: SQLSTATE 42501, diğerleri P0001).
-- Web uygulaması bunları kullanıcının JWT'siyle (authenticated), worker service_role ile çağırır. Yazım yetkisi
-- app.assert_student_access() ile: öğrencinin kendisi, owner bağlı eğitmen, admin ya da güvenilir çağıran
-- (service_role JWT'si ya da JWT'siz doğrudan veritabanı oturumu: worker, migration, testler). Veli yalnız okur.
-- Kanıt (apply_diagnosis) ve LLM defteri (log_llm_call) öğrenci oturumuna kapalıdır: teşhis hattı ve defter worker'dadır
-- (app.assert_evidence_writer; log_llm_call yalnız güvenilir çağıran ve personel).
--
-- RPC'ler (imzalar README'de):
--   apply_diagnosis, start_exam_session, record_exam_response, grade_exam_session, set_exam_key, peek_answer_key,
--   render_dossier, decide_proposal, create_guardian_invite, accept_guardian_invite, revoke_guardian_link,
--   upsert_memory_file, log_llm_call, check_spend, set_runtime_flag, request_document.
-- İş kuyruğu: RPC'ler app.try_enqueue() ile aynı işlemde pg-boss işi ekler (diagnosis.followup, exam.report,
-- document.generate, curriculum.merge); kuyruk yoksa ya da ekleme düşerse RPC düşmez, audit.events'e
-- 'job.enqueue_failed' yazılır.

-- --- yardımcılar ------------------------------------------------------------------------------------

-- Güvenilir çağıran: JWT role claim'i service_role; ya da JWT yok ve oturum rolü anon/authenticated/authenticator değil
-- (worker'ın doğrudan Postgres bağlantısı, migration, psql). SECURITY DEFINER içinde de çağıranın rolünü okur
-- (role GUC'u ve session_user tanımlayıcı geçişinden etkilenmez).
create or replace function app.is_trusted() returns boolean
language plpgsql
stable
set search_path = pg_catalog, app
as $$
declare
  v_claim text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  v_role text := current_setting('role', true);
begin
  if v_claim is not null then
    return v_claim = 'service_role';
  end if;
  if v_role is null or v_role = 'none' then
    v_role := session_user;
  end if;
  return v_role not in ('anon', 'authenticated', 'authenticator');
end
$$;
comment on function app.is_trusted() is 'Güvenilir çağıran mı: service_role JWT''si ya da JWT''siz doğrudan veritabanı oturumu (worker, migration, test).';

create or replace function app.is_staff() returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  return coalesce(app.role() in ('instructor', 'admin'), false);
end
$$;
comment on function app.is_staff() is 'Oturumdaki kullanıcı eğitmen ya da admin mi.';

create or replace function app.student_of_enrollment(p_enrollment uuid) returns uuid
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid;
begin
  select e.student_id into v_student from public.enrollments e where e.id = p_enrollment;
  return v_student;
end
$$;
comment on function app.student_of_enrollment(uuid) is 'Kaydın öğrencisi (enrollments.student_id); yoksa null.';

-- Öğrenci verisine erişim: okuma → can_read_student (veli dahil); yazma → öğrenci, owner eğitmen, admin, güvenilir
create or replace function app.assert_student_access(p_student uuid, p_write boolean) returns void
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if app.is_trusted() or app.is_admin() then
    return;
  end if;
  if p_student is not null and auth.uid() is not null then
    if p_student = app.my_student_id() then
      return;
    end if;
    if exists (select 1 from public.instructor_links il
                where il.instructor_id = auth.uid() and il.student_id = p_student and (not p_write or il.role = 'owner')) then
      return;
    end if;
    if not p_write and exists (select 1 from app.my_children() as c (sid) where c.sid = p_student) then
      return;
    end if;
  end if;
  raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu öğrenci için yetki yok';
end
$$;
comment on function app.assert_student_access(uuid, boolean) is 'Öğrenciye erişim yoksa OGR-AUTH-001 (42501); yazma: öğrenci, owner eğitmen, admin, güvenilir çağıran.';

-- Kanıt yazımı (teşhis): öğrencinin kendisi YAZAMAZ (ustalığını kendisi yükseltemez). Güvenilir çağıran (worker'ın
-- teşhis hattı), admin ya da öğrencinin owner eğitmeni.
create or replace function app.assert_evidence_writer(p_student uuid) returns void
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if app.is_trusted() or app.is_admin() then
    return;
  end if;
  if p_student is not null and auth.uid() is not null and app.role() = 'instructor'
     and exists (select 1 from public.instructor_links il
                  where il.instructor_id = auth.uid() and il.student_id = p_student and il.role = 'owner') then
    return;
  end if;
  raise exception using errcode = '42501', message = 'OGR-AUTH-001 kanıtı yalnız worker, öğrencinin owner eğitmeni ya da admin yazar';
end
$$;
comment on function app.assert_evidence_writer(uuid) is 'Kanıt (teşhis) yazımı: güvenilir çağıran, admin ya da owner eğitmen; öğrencinin kendisi değil (OGR-AUTH-001).';

-- Sınav öğrenciye görünür mü (exams_select'in oturum dalı HARİÇ kuralı): güvenilir çağıran, personel, sınavı oluşturan;
-- kişiye üretilmiş sınav (generated_documents.student_id) yalnız o öğrenciye; diğerleri yalnız ready/published ve
-- published/practice/diagnostic türünde, öğrencinin kayıtlı olduğu dersin ya da müfredatın sınavıysa.
create or replace function app.exam_visible(p_exam uuid, p_student uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_x public.exams%rowtype;
  v_doc_student uuid;
begin
  select x.* into v_x from public.exams x where x.id = p_exam;
  if not found then
    return false;
  end if;
  if app.is_trusted() or app.is_staff() or coalesce(v_x.created_by = auth.uid(), false) then
    return true;
  end if;
  if p_student is null then
    return false;
  end if;
  if v_x.generated_document_id is not null then
    select gd.student_id into v_doc_student from public.generated_documents gd where gd.id = v_x.generated_document_id;
    if v_doc_student is not null then
      return v_doc_student = p_student;
    end if;
  end if;
  return v_x.status in ('ready', 'published') and v_x.kind in ('published', 'practice', 'diagnostic')
     and exists (select 1 from public.enrollments e
                  where e.student_id = p_student and (e.course_id = v_x.course_id or e.curriculum_id = v_x.curriculum_id));
end
$$;
comment on function app.exam_visible(uuid, uuid) is 'Sınav öğrenciye görünür mü (oturumsuz kural): personel/worker, oluşturan, kişiye üretilmiş sınavın öğrencisi, kayıtlı dersin yayımlanmış sınavı.';

-- Yükleme kimlikleri çağırana ait mi: her kimlik uploads'ta var ve yükleyeni oturumdaki kullanıcı ya da ilgili öğrencisi
-- p_student. Güvenilir çağıran denetlenmez; boş/null dizi geçer.
create or replace function app.uploads_ok(p_ids uuid[], p_student uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if p_ids is null or cardinality(p_ids) = 0 or app.is_trusted() then
    return true;
  end if;
  return not exists (
    select 1 from unnest(p_ids) as x (uid)
     where not exists (select 1 from public.uploads u
                        where u.id = x.uid
                          and (u.owner_id = auth.uid() or (p_student is not null and u.student_id = p_student))));
end
$$;
comment on function app.uploads_ok(uuid[], uuid) is 'Yükleme kimlikleri çağıranın ya da öğrencinin mi (owner_id = auth.uid() veya student_id = öğrenci); güvenilir çağıran geçer.';

create or replace function app.setting_num(p_key text, p_default numeric) returns numeric
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_val numeric;
begin
  select (st.value #>> '{}')::numeric into v_val from public.settings st where st.key = p_key;
  return coalesce(v_val, p_default);
end
$$;
comment on function app.setting_num(text, numeric) is 'settings değerini sayı olarak okur; yoksa varsayılan.';

-- İş ekleme denemesi: enqueue_job düşerse (kuyruk yok vb.) RPC'yi düşürmez, audit.events'e 'job.enqueue_failed' yazar
create or replace function app.try_enqueue(p_name text, p_data jsonb) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, audit, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  begin
    v_id := public.enqueue_job(p_name, p_data);
  exception when others then
    perform app.audit_event('job.enqueue_failed', 'pgboss.job', null,
                            jsonb_build_object('name', p_name, 'data', p_data, 'reason', sqlerrm));
    return null;
  end;
  return v_id;
end
$$;
comment on function app.try_enqueue(text, jsonb) is 'enqueue_job''u alt işlemde dener; hata RPC''yi düşürmez, audit.events''e job.enqueue_failed yazar.';

-- --- müfredat önerileri ----------------------------------------------------------------------------

-- Öneriyi uygular ya da reddeder (yetki denetimi çağırandadır). Yerinde uygulanan türler: add_subskill (yeni yaprak;
-- üst kazanım yaprak olmaktan çıkar), rename, add_prereq (döngü denetimi), add_tag. merge yeni müfredat sürümü ister:
-- kabul edilir, 'curriculum.merge' işi kuyruğa atılır, applied = false döner.
create or replace function app.apply_proposal(p_id uuid, p_accept boolean, p_note text) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_pr public.curriculum_proposals%rowtype;
  v_pl jsonb;
  v_skill text;
  v_parent text;
  v_name text;
  v_prereq text;
  v_applied boolean := false;
begin
  select cp.* into v_pr from public.curriculum_proposals cp where cp.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-PROP-001 öneri yok %s', p_id);
  end if;
  if v_pr.status <> 'open' then
    raise exception using errcode = 'P0001', message = format('OGR-PROP-002 öneri zaten karara bağlandı (%s)', v_pr.status);
  end if;
  v_pl := v_pr.payload;
  if p_accept then
    if v_pr.kind = 'add_subskill' then
      v_parent := v_pl ->> 'parent_id';
      v_name := nullif(btrim(v_pl ->> 'name'), '');
      if v_parent is null or v_name is null
         or not exists (select 1 from public.skills s where s.curriculum_id = v_pr.curriculum_id and s.id = v_parent) then
        raise exception using errcode = 'P0001', message = 'OGR-PROP-001 add_subskill: parent_id (müfredatta) ve name gerekli';
      end if;
      v_skill := coalesce(nullif(v_pl ->> 'id', ''), v_parent || '.n' || substr(md5(v_name), 1, 6));
      if exists (select 1 from public.skills s where s.curriculum_id = v_pr.curriculum_id and s.id = v_skill) then
        raise exception using errcode = 'P0001', message = format('OGR-PROP-001 kazanım zaten var: %s', v_skill);
      end if;
      insert into public.skills (curriculum_id, id, parent_id, name, description, kind, is_leaf, order_no, source_refs)
      select v_pr.curriculum_id, v_skill, v_parent, v_name, v_pl ->> 'description', coalesce(v_pl ->> 'kind', 'sub_outcome'), true,
             coalesce((select max(s.order_no) + 1 from public.skills s where s.curriculum_id = v_pr.curriculum_id), 1),
             jsonb_build_array(jsonb_build_object('kind', 'proposal', 'ref', v_pr.id::text));
      update public.skills s set is_leaf = false where s.curriculum_id = v_pr.curriculum_id and s.id = v_parent;
      v_pl := v_pl || jsonb_build_object('id', v_skill);
      v_applied := true;
    elsif v_pr.kind = 'rename' then
      update public.skills s set name = btrim(v_pl ->> 'name')
       where s.curriculum_id = v_pr.curriculum_id and s.id = v_pl ->> 'skill_id' and nullif(btrim(v_pl ->> 'name'), '') is not null;
      if not found then
        raise exception using errcode = 'P0001', message = 'OGR-PROP-001 rename: skill_id (müfredatta) ve name gerekli';
      end if;
      v_applied := true;
    elsif v_pr.kind = 'add_prereq' then
      v_skill := v_pl ->> 'skill_id';
      v_prereq := v_pl ->> 'prereq_id';
      if (select count(*) from public.skills s where s.curriculum_id = v_pr.curriculum_id and s.id in (v_skill, v_prereq)) <> 2
         or v_skill = v_prereq then
        raise exception using errcode = 'P0001', message = 'OGR-PROP-001 add_prereq: skill_id ve prereq_id müfredatta olmalı';
      end if;
      if exists (
        with recursive r (sid) as (
          select v_prereq
          union
          select sp.prereq_id from public.skill_prerequisites sp join r on sp.skill_id = r.sid
           where sp.curriculum_id = v_pr.curriculum_id
        )
        select 1 from r where r.sid = v_skill
      ) then
        raise exception using errcode = 'P0001', message = format('OGR-PROP-003 ön koşul döngüsü: %s → %s', v_skill, v_prereq);
      end if;
      insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source)
      values (v_pr.curriculum_id, v_skill, v_prereq, coalesce((v_pl ->> 'strength')::numeric, 1.0), 'inferred')
      on conflict do nothing;
      v_applied := true;
    elsif v_pr.kind = 'add_tag' then
      if nullif(v_pl ->> 'tag', '') is null or nullif(v_pl ->> 'text_instructor', '') is null or nullif(v_pl ->> 'text_student', '') is null then
        raise exception using errcode = 'P0001', message = 'OGR-PROP-001 add_tag: tag, text_instructor, text_student gerekli';
      end if;
      insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student)
      values (v_pl ->> 'tag', v_pr.curriculum_id, v_pl ->> 'skill_id', v_pl ->> 'prereq_skill_id', v_pl ->> 'text_instructor', v_pl ->> 'text_student');
      v_applied := true;
    else
      perform app.try_enqueue('curriculum.merge', jsonb_build_object('proposal_id', v_pr.id));
    end if;
  end if;
  update public.curriculum_proposals cp
     set status = case when p_accept then 'accepted' else 'rejected' end,
         payload = v_pl || case when p_note is null then '{}'::jsonb else jsonb_build_object('decision_note', p_note) end,
         decided_by = auth.uid(),
         decided_at = now()
   where cp.id = p_id;
  return jsonb_build_object('id', p_id, 'status', case when p_accept then 'accepted' else 'rejected' end, 'applied', v_applied,
                            'skill_id', case when v_pr.kind = 'add_subskill' and p_accept then v_skill end);
end
$$;
comment on function app.apply_proposal(uuid, boolean, text) is 'Müfredat önerisini uygular/reddeder (yetki denetimi çağırana aittir); merge → curriculum.merge işi.';

create or replace function public.decide_proposal(p_id uuid, p_accept boolean, p_note text default null) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_cur uuid;
begin
  select cp.curriculum_id into v_cur from public.curriculum_proposals cp where cp.id = p_id;
  if v_cur is null then
    raise exception using errcode = 'P0001', message = format('OGR-PROP-001 öneri yok %s', p_id);
  end if;
  if not (app.is_trusted() or app.is_admin()
          or (app.role() = 'instructor' and (
                exists (select 1 from public.curricula c where c.id = v_cur and c.created_by = auth.uid())
                or exists (select 1 from public.courses co
                            where co.curriculum_id = v_cur
                              and (co.created_by = auth.uid()
                                   or exists (select 1 from public.instructor_links il
                                               where il.instructor_id = auth.uid() and (il.course_id = co.id or il.course_id is null)
                                                 and exists (select 1 from public.enrollments e
                                                              where e.student_id = il.student_id and e.course_id = co.id)))))))
  then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 öneriye karar yalnız eğitmen ya da admin';
  end if;
  return app.apply_proposal(p_id, coalesce(p_accept, false), p_note);
end
$$;
comment on function public.decide_proposal(uuid, boolean, text) is 'Müfredat önerisine karar (eğitmen: müfredatın/dersin sahibi ya da dersin öğrencilerine bağlı; admin; worker).';

-- --- teşhis (Akış 1) -------------------------------------------------------------------------------

-- Çözüm teşhisini tek işlemde yazar: solution_analyses + her yaprak kazanım için observations(kind='practice',
-- source_type='solution_analysis') → apply_observation + style_coverage (+ proposed_subskill → curriculum_proposals;
-- otopilot açık ve müfredat ai_draft ise öneri hemen kabul edilir). careless/time için ağırlık settings.careless_weight
-- (0.5). Deneme bağlamında (exam_response_id) p'yi notlama zaten güncelledi: gözlemler ağırlık 0 ve kanıt sayısına
-- katılmadan yazılır (hata nedeni ve yanılgı sayacı işlenir). Girdi: SolutionDiagnosis + bağlam alanları (README).
-- Yalnız worker (teşhis hattı), owner eğitmen ya da admin çağırır: öğrenci kendi ustalığını yazamaz (OGR-AUTH-001).
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
  v_kind text;
  v_auto boolean;
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

  -- uygun yaprak yoksa alt kazanım önerisi; otopilot (ders türüne göre) + ai_draft müfredat → hemen kabul
  if jsonb_typeof(v_prop) = 'object' then
    insert into public.curriculum_proposals (curriculum_id, kind, payload, evidence_ids)
    values (v_enr.curriculum_id, 'add_subskill', v_prop || jsonb_build_object('source', 'diagnosis'), array[v_id])
    returning id into v_prop_id;
    update public.solution_analyses sa set proposal_id = v_prop_id where sa.id = v_id;
    select coalesce(co.kind, 'other') into v_kind from public.courses co where co.id = v_enr.course_id;
    select coalesce((rf.value ->> coalesce(v_kind, 'other'))::boolean, false) into v_auto
      from public.runtime_flags rf where rf.key = 'curriculum_autopilot';
    if coalesce(v_auto, false) and exists (select 1 from public.curricula c where c.id = v_enr.curriculum_id and c.origin = 'ai_draft') then
      perform app.apply_proposal(v_prop_id, true, 'otopilot');
    end if;
  end if;

  perform app.try_enqueue('diagnosis.followup', jsonb_build_object('analysis_id', v_id, 'enrollment_id', v_enr.id));
  return v_id;
end
$$;
comment on function public.apply_diagnosis(jsonb) is 'Teşhisi yazar: solution_analyses + observations (careless/time w=0.5) → apply_observation + style_coverage (+ öneri); id döner.';

-- --- denemeler (Akış 2) ----------------------------------------------------------------------------

create or replace function public.start_exam_session(p_exam uuid, p_enrollment uuid, p_mode text default 'in_app') returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_x public.exams%rowtype;
  v_enr public.enrollments%rowtype;
  v_id uuid;
begin
  select e.* into v_enr from public.enrollments e where e.id = p_enrollment;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 kayıt bulunamadı';
  end if;
  perform app.assert_student_access(v_enr.student_id, true);
  select x.* into v_x from public.exams x where x.id = p_exam;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 sınav bulunamadı';
  end if;
  if p_mode is null or p_mode not in ('in_app', 'uploaded') then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-001 geçersiz kip %s', coalesce(p_mode, '(boş)'));
  end if;
  if v_x.curriculum_id <> v_enr.curriculum_id then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-002 sınavın müfredatı kaydın müfredatıyla aynı değil';
  end if;
  if v_x.status in ('failed', 'archived') or (p_mode = 'in_app' and v_x.status not in ('ready', 'published')) then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-003 sınav bu kipte başlatılamaz (durum %s)', v_x.status);
  end if;
  -- sınav kaydın öğrencisine görünür olmalı (app.exam_visible; exams_select'in oturum dalı HARİÇ kuralı): oturum açmak
  -- exams_select ve v_exam_questions_student'ı açtığından başkasının özel sınavı burada durur
  if not app.exam_visible(p_exam, v_enr.student_id) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu sınav için yetki yok';
  end if;
  select es.id into v_id from public.exam_sessions es
   where es.exam_id = p_exam and es.enrollment_id = p_enrollment and es.status = 'in_progress' and es.mode = p_mode
   order by es.started_at desc limit 1;
  if v_id is null then
    insert into public.exam_sessions (exam_id, enrollment_id, mode) values (p_exam, p_enrollment, p_mode) returning id into v_id;
  end if;
  return v_id;
end
$$;
comment on function public.start_exam_session(uuid, uuid, text) is 'Sınav oturumu açar (aynı sınav + kayıt için süren oturum varsa onu döner); in_app için sınav ready/published olmalı; sınav çağırana görünür olmalı.';

-- Cevap yazar (upsert). Oturum bittiyse yalnız "nereye kadar geldim" alanları (how_far_text, work_upload_ids, flagged)
-- güncellenir; cevap değişikliği OGR-EXAM-003.
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
  v_id uuid;
begin
  select es.* into v_s from public.exam_sessions es where es.id = p_session;
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
  select r.id, r.answer into v_id, v_old from public.exam_responses r where r.session_id = p_session and r.exam_question_id = p_exam_question;
  if v_s.status <> 'in_progress' and v_answer is distinct from v_old and v_answer is not null then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-003 oturum %s: cevap değiştirilemez', v_s.status);
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
comment on function public.record_exam_response(uuid, uuid, text, int, boolean, uuid[], text) is 'Sınav cevabını yazar (upsert); bitmiş oturumda yalnız nereye-kadar alanları.';

-- Oturumu secure.exam_answer_keys ile notlar: outcome (correct | wrong | blank | unfinished; anahtarı olmayan ya da açık
-- uçlu soru null = notlanmadı), son cevaplanan sorudan sonraki boşlar 'unfinished'. Her notlanan soru × yaprak kazanım
-- için observations(kind='test', guess_override = settings.exam_guess_override (0.2); boş → ağırlık
-- settings.exam_blank_weight (0.5); unfinished gözlem üretmez) → apply_observation; style_coverage; score jsonb;
-- durum 'analysing' + 'exam.report' işi. Tekrar çağrı (analysing/done) mevcut skoru döner. Aynı sınavın aynı kayıtla
-- ikinci ve sonraki notlanan oturumları (tekrar deneme) gözlemleri ağırlık 0 ve kanıt sayısına katmadan yazar.
create or replace function public.grade_exam_session(p_session uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_s public.exam_sessions%rowtype;
  v_x public.exams%rowtype;
  v_cur uuid;
  v_g numeric := app.setting_num('exam_guess_override', 0.2);
  v_blank_w numeric := app.setting_num('exam_blank_weight', 0.5);
  v_pen numeric := app.setting_num('exam_wrong_penalty', 0.25);
  v_last int;
  v_r record;
  v_ans text;
  v_outcome text;
  v_skill text;
  v_obs bigint;
  v_score jsonb;
  v_sections jsonb;
  v_repeat boolean;
begin
  select es.* into v_s from public.exam_sessions es where es.id = p_session for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 oturum bulunamadı';
  end if;
  perform app.assert_student_access(app.student_of_enrollment(v_s.enrollment_id), true);
  if v_s.status in ('analysing', 'done') then
    return v_s.score;
  end if;
  if v_s.status = 'failed' then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-003 oturum failed: notlanamaz';
  end if;
  select x.* into v_x from public.exams x where x.id = v_s.exam_id;
  select e.curriculum_id into v_cur from public.enrollments e where e.id = v_s.enrollment_id;
  if v_x.curriculum_id <> v_cur then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-002 sınavın müfredatı kaydın müfredatıyla aynı değil';
  end if;
  update public.exam_sessions es set status = 'grading' where es.id = p_session;
  -- aynı sınavın aynı kayıtla daha önce notlanmış oturumu varsa tekrar denemedir: gözlemler ağırlık 0, kanıt sayılmaz
  select exists (select 1 from public.exam_sessions es
                  where es.exam_id = v_s.exam_id and es.enrollment_id = v_s.enrollment_id and es.id <> p_session
                    and es.status in ('analysing', 'done')) into v_repeat;

  insert into public.exam_responses (session_id, exam_question_id)
  select p_session, q.id from public.exam_questions q where q.exam_id = v_s.exam_id
  on conflict (session_id, exam_question_id) do nothing;
  select max(q.no) into v_last from public.exam_responses r join public.exam_questions q on q.id = r.exam_question_id
   where r.session_id = p_session and nullif(btrim(r.answer), '') is not null;

  for v_r in
    select r.id as rid, r.answer, q.no, q.kind, q.skill_ids, q.style_id, k.correct_option, k.numeric_value,
           k.exam_question_id is not null as has_key
      from public.exam_responses r
      join public.exam_questions q on q.id = r.exam_question_id
      left join secure.exam_answer_keys k on k.exam_question_id = q.id
     where r.session_id = p_session
     order by q.no
  loop
    v_ans := nullif(upper(btrim(v_r.answer)), '');
    if v_ans is null then
      v_outcome := case when v_last is null or v_r.no > v_last then 'unfinished' else 'blank' end;
    elsif not v_r.has_key or v_r.kind = 'open' then
      v_outcome := null;
    elsif v_r.kind = 'mcq' then
      v_outcome := case when v_ans !~ '^[A-E]$' then 'blank' when v_ans = v_r.correct_option then 'correct' else 'wrong' end;
    else
      v_outcome := case when app.numeric_equal(v_ans, v_r.numeric_value::text, 0.000001) then 'correct' else 'wrong' end;
    end if;
    update public.exam_responses r set outcome = v_outcome where r.id = v_r.rid;

    if v_outcome in ('correct', 'wrong', 'blank') then
      for v_skill in
        select s.id from public.skills s where s.curriculum_id = v_cur and s.is_leaf and s.id = any(v_r.skill_ids) order by s.id
      loop
        insert into public.observations (enrollment_id, skill_id, kind, value, weight, guess_override, source_type, source_id, source_locator,
                                         counts_for_mastery)
        values (v_s.enrollment_id, v_skill, 'test', case when v_outcome = 'correct' then 1 else 0 end,
                case when v_repeat then 0 when v_outcome = 'blank' then v_blank_w else 1 end, v_g, 'exam_response', v_r.rid::text,
                left(v_x.title, 120) || ' · soru ' || v_r.no || case when v_repeat then ' · tekrar' else '' end, not v_repeat)
        returning id into v_obs;
        perform public.apply_observation(v_obs);
      end loop;
      if v_r.style_id is not null then
        insert into public.style_coverage as sc (enrollment_id, style_id, seen_count, solved_count, correct_count, last_seen_at)
        values (v_s.enrollment_id, v_r.style_id, 1, case when v_outcome = 'blank' then 0 else 1 end,
                case when v_outcome = 'correct' then 1 else 0 end, now())
        on conflict (enrollment_id, style_id) do update
          set seen_count = sc.seen_count + 1,
              solved_count = sc.solved_count + excluded.solved_count,
              correct_count = sc.correct_count + excluded.correct_count,
              last_seen_at = now();
      end if;
    end if;
  end loop;

  select coalesce(jsonb_agg(z.sec order by z.first_no), '[]'::jsonb) into v_sections
    from (
      select min(q.no) as first_no,
             jsonb_build_object('section', coalesce(q.section, 'Genel'), 'total', count(*),
                                'correct', count(*) filter (where r.outcome = 'correct'),
                                'wrong', count(*) filter (where r.outcome = 'wrong'),
                                'blank', count(*) filter (where r.outcome = 'blank'),
                                'unfinished', count(*) filter (where r.outcome = 'unfinished'),
                                'ungraded', count(*) filter (where r.outcome is null),
                                'net', round(count(*) filter (where r.outcome = 'correct') - v_pen * count(*) filter (where r.outcome = 'wrong'), 2)) as sec
        from public.exam_responses r join public.exam_questions q on q.id = r.exam_question_id
       where r.session_id = p_session
       group by coalesce(q.section, 'Genel')
    ) as z;
  select jsonb_build_object(
           'total', count(*),
           'correct', count(*) filter (where r.outcome = 'correct'),
           'wrong', count(*) filter (where r.outcome = 'wrong'),
           'blank', count(*) filter (where r.outcome = 'blank'),
           'unfinished', count(*) filter (where r.outcome = 'unfinished'),
           'ungraded', count(*) filter (where r.outcome is null),
           'net', round(count(*) filter (where r.outcome = 'correct') - v_pen * count(*) filter (where r.outcome = 'wrong'), 2),
           'wrong_penalty', v_pen,
           'unverified_keys', count(*) filter (where k.source = 'inferred' and coalesce(k.confidence, 0) < 0.8),
           'sections', v_sections,
           'graded_at', now())
    into v_score
    from public.exam_responses r
    left join secure.exam_answer_keys k on k.exam_question_id = r.exam_question_id
   where r.session_id = p_session;

  update public.exam_sessions es
     set status = 'analysing',
         score = v_score,
         finished_at = coalesce(es.finished_at, now()),
         duration_sec = coalesce(es.duration_sec, greatest(0, extract(epoch from (coalesce(es.finished_at, now()) - es.started_at)))::int)
   where es.id = p_session;
  perform app.try_enqueue('exam.report', jsonb_build_object('session_id', p_session));
  return v_score;
end
$$;
comment on function public.grade_exam_session(uuid) is 'Oturumu gizli anahtarla notlar: outcome, score (net, bölümler), observations(kind=test, g=0.2), style_coverage; exam.report işi.';

-- Sınav sorusunun anahtarını yazar (yalnız eğitmen/admin/worker). inferred/generated kaynakları yalnız worker yazar.
create or replace function public.set_exam_key(
  p_exam_question uuid, p_correct_option text default null, p_numeric_value numeric default null,
  p_source text default 'instructor', p_confidence numeric default null
) returns void
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_kind text;
  v_exam uuid;
  v_course uuid;
  v_creator uuid;
  v_opt text := nullif(upper(btrim(p_correct_option)), '');
begin
  select q.kind, q.exam_id, x.course_id, x.created_by into v_kind, v_exam, v_course, v_creator
    from public.exam_questions q join public.exams x on x.id = q.exam_id where q.id = p_exam_question;
  if v_exam is null then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 sınav sorusu bulunamadı';
  end if;
  if not (app.is_trusted() or app.is_admin()
          or (app.role() = 'instructor' and (v_creator = auth.uid()
               or exists (select 1 from public.courses co where co.id = v_course and co.created_by = auth.uid())
               or exists (select 1 from public.instructor_links il where il.instructor_id = auth.uid() and il.course_id = v_course)))) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 anahtarı yalnız sınavın eğitmeni ya da admin yazar';
  end if;
  if p_source is null or p_source not in ('uploaded', 'inferred', 'instructor', 'generated')
     or (p_source in ('inferred', 'generated') and not app.is_trusted()) then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-005 anahtar kaynağı geçersiz: %s', coalesce(p_source, '(boş)'));
  end if;
  if (v_kind = 'mcq' and (v_opt is null or v_opt !~ '^[A-E]$')) or (v_kind = 'numeric' and p_numeric_value is null) or v_kind = 'open' then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-005 %s sorusu için anahtar biçimi geçersiz', v_kind);
  end if;
  insert into secure.exam_answer_keys as k (exam_question_id, correct_option, numeric_value, source, confidence)
  values (p_exam_question, case when v_kind = 'mcq' then v_opt end, case when v_kind = 'numeric' then p_numeric_value end, p_source, p_confidence)
  on conflict (exam_question_id) do update
    set correct_option = excluded.correct_option, numeric_value = excluded.numeric_value,
        source = excluded.source, confidence = excluded.confidence;
  perform app.audit_event('exam_key.set', 'secure.exam_answer_keys', p_exam_question::text,
                          jsonb_build_object('exam_id', v_exam, 'source', p_source, 'confidence', p_confidence));
end
$$;
comment on function public.set_exam_key(uuid, text, numeric, text, numeric) is 'secure.exam_answer_keys upsert (eğitmen/admin/worker; inferred/generated yalnız worker); denetim izine değer yazılmaz.';

-- Anahtarı okur: soru bankası (secure.answer_keys) ya da sınav sorusu (secure.exam_answer_keys). Yalnız eğitmen/admin/worker.
create or replace function public.peek_answer_key(p_question uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_out jsonb;
begin
  if not (app.is_trusted() or app.is_staff()) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 cevap anahtarını yalnız eğitmen ya da admin görür';
  end if;
  select jsonb_build_object('kind', 'question', 'question_id', k.question_id, 'correct_option', k.correct_option,
                            'numeric_value', k.numeric_value, 'numeric_tolerance', k.numeric_tolerance, 'canonical_expr', k.canonical_expr,
                            'solution', k.solution, 'sympy_status', k.sympy_status, 'verified_at', k.verified_at)
    into v_out from secure.answer_keys k where k.question_id = p_question;
  if v_out is null then
    select jsonb_build_object('kind', 'exam_question', 'exam_question_id', k.exam_question_id, 'correct_option', k.correct_option,
                              'numeric_value', k.numeric_value, 'source', k.source, 'confidence', k.confidence)
      into v_out from secure.exam_answer_keys k where k.exam_question_id = p_question;
  end if;
  if v_out is null then
    raise exception using errcode = 'P0001', message = format('OGR-KEY-001 anahtar yok %s', p_question);
  end if;
  perform app.audit_event('answer_key.peek', v_out ->> 'kind', p_question::text, null);
  return v_out;
end
$$;
comment on function public.peek_answer_key(uuid) is 'Cevap anahtarı (soru bankası ya da sınav sorusu); yalnız eğitmen/admin/worker, her okuma denetim izine yazılır.';

-- --- dossier ---------------------------------------------------------------------------------------

-- Dossier yaprakları: kanıtı olan yaprak kazanımlar; p iki basamak; 14 g trend = p − (14 gün önceki p)
create or replace function app.dossier_leaves(p_enrollment uuid)
returns table (skill_id text, name text, p numeric, n int, trend numeric)
language sql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
  select m.skill_id, s.name, round(m.p, 2), m.evidence_count,
         round(m.p - coalesce(
           (select h.p_after from public.mastery_history as h
             where h.enrollment_id = m.enrollment_id and h.skill_id = m.skill_id and h.created_at < now() - interval '14 days'
             order by h.created_at desc, h.id desc limit 1),
           (select h.p_before from public.mastery_history as h
             where h.enrollment_id = m.enrollment_id and h.skill_id = m.skill_id
             order by h.created_at asc, h.id asc limit 1)), 2)
    from public.mastery as m
    join public.skills as s on s.curriculum_id = m.curriculum_id and s.id = m.skill_id and s.is_leaf
   where m.enrollment_id = p_enrollment and m.evidence_count > 0
$$;
comment on function app.dossier_leaves(uuid) is 'Kaydın kanıtlı yaprak ustalıkları (p, kanıt sayısı, 14 g trend); render_dossier kullanır.';

-- Dossier bloğunun yapısal kısmı (docs/PLAN-v2.md §2, §3.3, §3.4): deterministik sıra, gün hassasiyeti, p iki
-- basamak. Görünen ad yoktur (LLM'e gitmez). hash = sha256(gövde) → student_dossier_cache ile karşılaştırılır.
-- Veli çağıramaz (veli ajanı kendi araçlarıyla okur).
create or replace function public.render_dossier(p_student uuid, p_course uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_st public.students%rowtype;
  v_enr public.enrollments%rowtype;
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_weak int := app.setting_num('dossier_weak_leaves', 20)::int;
  v_strong int := app.setting_num('dossier_strong_leaves', 10)::int;
  v_mc int := app.setting_num('dossier_open_misconceptions', 8)::int;
  v_identity jsonb;
  v_mastery jsonb;
  v_weakest jsonb;
  v_strongest jsonb;
  v_misc jsonb;
  v_causes jsonb;
  v_diag jsonb;
  v_exams jsonb;
  v_gaps jsonb;
  v_claims jsonb;
  v_body jsonb;
begin
  if not (app.is_trusted() or app.is_admin() or coalesce(p_student = app.my_student_id(), false)
          or exists (select 1 from app.my_students() as m (sid) where m.sid = p_student)) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 dossier için yetki yok';
  end if;
  select s.* into v_st from public.students s where s.id = p_student;
  select e.* into v_enr from public.enrollments e
   where e.student_id = p_student and e.course_id = p_course
   order by (e.status = 'active') desc, e.started_at desc, e.created_at desc limit 1;
  if v_st.id is null or v_enr.id is null then
    raise exception using errcode = 'P0001', message = 'OGR-DOS-001 öğrencinin bu derste kaydı yok';
  end if;

  select jsonb_build_object(
           'student_ref', v_st.public_ref, 'grade', v_st.grade, 'school', v_st.school,
           'enrollment_id', v_enr.id, 'course_id', co.id, 'course_code', co.code, 'course_title', co.title,
           'curriculum', c.code || '@' || c.version, 'curriculum_id', c.id, 'period', v_enr.period_label,
           'target_exam', v_enr.target_exam, 'exam_date', v_enr.exam_date, 'goal', v_enr.goal,
           'days_to_exam', case when v_enr.exam_date is not null then v_enr.exam_date - v_today end)
    into v_identity
    from public.courses co, public.curricula c
   where co.id = p_course and c.id = v_enr.curriculum_id;

  select coalesce(jsonb_agg(jsonb_build_object('skill_id', d.skill_id, 'name', d.name, 'p', d.p, 'n', d.n, 'trend_14d', d.trend)
                            order by d.p, d.skill_id), '[]'::jsonb)
    into v_weakest
    from (select dl.* from app.dossier_leaves(v_enr.id) as dl order by dl.p, dl.skill_id limit v_weak) as d;
  select coalesce(jsonb_agg(jsonb_build_object('skill_id', d.skill_id, 'name', d.name, 'p', d.p, 'n', d.n, 'trend_14d', d.trend)
                            order by d.p desc, d.skill_id), '[]'::jsonb)
    into v_strongest
    from (select dl.* from app.dossier_leaves(v_enr.id) as dl
           where dl.skill_id not in (select w.skill_id from app.dossier_leaves(v_enr.id) as w order by w.p, w.skill_id limit v_weak)
           order by dl.p desc, dl.skill_id limit v_strong) as d;
  select jsonb_build_object(
           'leaves_total', (select count(*) from public.skills s where s.curriculum_id = v_enr.curriculum_id and s.is_leaf),
           'leaves_with_evidence', (select count(*) from app.dossier_leaves(v_enr.id)),
           'evidence_total', (select coalesce(sum(dl.n), 0) from app.dossier_leaves(v_enr.id) as dl),
           'weakest', v_weakest, 'strongest', v_strongest)
    into v_mastery;

  select coalesce(jsonb_agg(jsonb_build_object('tag', z.tag, 'skill_id', z.skill_id, 'text', z.text_instructor,
                                               'evidence', z.evidence_count, 'last_seen', z.last_seen::date)
                            order by z.evidence_count desc, z.last_seen desc, z.skill_id), '[]'::jsonb)
    into v_misc
    from (select mc.* from public.misconceptions mc
           where mc.enrollment_id = v_enr.id and mc.status = 'open'
           order by mc.evidence_count desc, mc.last_seen desc, mc.skill_id limit v_mc) as z;

  select jsonb_build_object(
           'concept', count(*) filter (where sa.error_cause = 'concept'),
           'procedure', count(*) filter (where sa.error_cause = 'procedure'),
           'careless', count(*) filter (where sa.error_cause = 'careless'),
           'reading', count(*) filter (where sa.error_cause = 'reading'),
           'time', count(*) filter (where sa.error_cause = 'time'))
    into v_causes
    from public.solution_analyses sa
   where sa.enrollment_id = v_enr.id and sa.created_at >= now() - interval '30 days';

  select coalesce(jsonb_agg(jsonb_build_object('date', (z.created_at at time zone 'Europe/Istanbul')::date, 'verdict', z.verdict,
                                               'error_cause', z.error_cause, 'failing_step_no', z.failing_step_no,
                                               'skill_ids', to_jsonb(z.skill_ids), 'misconception_tags', to_jsonb(z.misconception_tags),
                                               'source', case when z.exam_response_id is not null then 'exam' else 'ask' end)
                            order by z.created_at desc, z.id), '[]'::jsonb)
    into v_diag
    from (select sa.* from public.solution_analyses sa where sa.enrollment_id = v_enr.id
           order by sa.created_at desc, sa.id limit 10) as z;

  select coalesce(jsonb_agg(jsonb_build_object('date', (z.finished_at at time zone 'Europe/Istanbul')::date, 'title', z.title,
                                               'kind', z.kind, 'total', z.score -> 'total', 'correct', z.score -> 'correct',
                                               'wrong', z.score -> 'wrong', 'blank', z.score -> 'blank', 'net', z.score -> 'net')
                            order by z.finished_at desc, z.id), '[]'::jsonb)
    into v_exams
    from (select es.id, es.finished_at, es.score, x.title, x.kind from public.exam_sessions es join public.exams x on x.id = es.exam_id
           where es.enrollment_id = v_enr.id and es.score is not null
           order by es.finished_at desc nulls last, es.id limit 3) as z;

  -- tarz boşlukları: dersin etkin tarzlarından hiç görülmemiş ya da doğru oranı < 0.5 olanlar (sıklığa göre)
  select coalesce(jsonb_agg(jsonb_build_object('style_id', z.id, 'code', z.code, 'name', z.name, 'frequency', round(z.frequency_score, 2),
                                               'seen', z.seen, 'correct', z.correct)
                            order by z.frequency_score desc nulls last, z.code), '[]'::jsonb)
    into v_gaps
    from (select qs.id, qs.code, qs.name, qs.frequency_score, coalesce(sc.seen_count, 0) as seen, coalesce(sc.correct_count, 0) as correct
            from public.question_styles qs
            left join public.style_coverage sc on sc.style_id = qs.id and sc.enrollment_id = v_enr.id
           where qs.course_id = p_course and qs.status = 'active'
             and (sc.seen_count is null or sc.seen_count = 0 or sc.correct_count::numeric / greatest(sc.solved_count, 1) < 0.5)
           order by qs.frequency_score desc nulls last, qs.code limit 10) as z;

  select coalesce(jsonb_agg(jsonb_build_object('date', (z.held_at at time zone 'Europe/Istanbul')::date, 'kind', z.kind,
                                               'skill_id', z.skill_id, 'value', coalesce(z.edited_value, z.value))
                            order by z.held_at desc, z.id), '[]'::jsonb)
    into v_claims
    from (select lc.id, lc.kind, lc.skill_id, lc.value, lc.edited_value, l.held_at
            from public.lesson_claims lc
            join public.lesson_analyses la on la.id = lc.analysis_id
            join public.lessons l on l.id = la.lesson_id
           where lc.status in ('approved', 'edited')
             and (l.enrollment_id = v_enr.id or (l.enrollment_id is null and l.course_id = p_course))
           order by l.held_at desc, lc.id limit 5) as z;

  v_body := jsonb_build_object('version', 1, 'as_of', v_today, 'identity', v_identity, 'mastery', v_mastery,
                               'open_misconceptions', v_misc, 'error_causes_30d', v_causes, 'recent_diagnoses', v_diag,
                               'recent_exams', v_exams, 'style_gaps', v_gaps, 'recent_lesson_claims', v_claims);
  return v_body || jsonb_build_object('hash', encode(sha256(convert_to(v_body::text, 'UTF8')), 'hex'));
end
$$;
comment on function public.render_dossier(uuid, uuid) is 'Dossier yapısal JSON''u: kimlik, en zayıf 20 / en güçlü 10 yaprak, açık yanılgılar ≤ 8, 30 g hata nedeni, son 10 teşhis, son 3 deneme, tarz boşlukları, hash.';

-- --- veli davetleri --------------------------------------------------------------------------------

-- Davet: rastgele token (yalnız bu yanıtta döner), guardian_links'e sha256(token) hex yazılır; süre settings.guardian_invite_hours
create or replace function public.create_guardian_invite(p_student uuid, p_relation text default null) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_token text := 'gi_' || app.base32_random(32);
  v_id uuid;
  v_exp timestamptz := now() + make_interval(hours => app.setting_num('guardian_invite_hours', 72)::int);
begin
  if not exists (select 1 from public.students s where s.id = p_student) then
    raise exception using errcode = 'P0001', message = 'OGR-INV-001 öğrenci bulunamadı';
  end if;
  if app.role() = 'parent' then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 veli davet oluşturamaz';
  end if;
  perform app.assert_student_access(p_student, true);
  insert into public.guardian_links (student_id, relation, status, invite_token_hash, invite_expires_at, created_by)
  values (p_student, p_relation, 'invited', encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_exp, auth.uid())
  returning id into v_id;
  return jsonb_build_object('link_id', v_id, 'token', v_token, 'expires_at', v_exp);
end
$$;
comment on function public.create_guardian_invite(uuid, text) is 'Veli daveti: token bir kez döner, yalnız sha256 hex saklanır (öğrenci, owner eğitmen, admin).';

-- Kabul: çağıran veli olur (profil yoksa role='parent' profil açılır; başka roldeki profil kabul edemez); token tek kullanımlık
create or replace function public.accept_guardian_invite(p_token text) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_gl public.guardian_links%rowtype;
  v_role text;
  v_existing uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 oturum gerekli';
  end if;
  select gl.* into v_gl from public.guardian_links gl
   where gl.invite_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and gl.status = 'invited'
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-INV-001 davet bulunamadı ya da kullanılmış';
  end if;
  if v_gl.invite_expires_at is not null and v_gl.invite_expires_at < now() then
    raise exception using errcode = 'P0001', message = 'OGR-INV-002 davetin süresi doldu';
  end if;
  v_role := app.role();
  if v_role is null then
    insert into public.profiles (id, role) values (auth.uid(), 'parent');
  elsif v_role <> 'parent' then
    raise exception using errcode = 'P0001', message = format('OGR-INV-003 yalnız veli hesabı kabul edebilir (rol %s)', v_role);
  end if;
  select gl.id into v_existing from public.guardian_links gl where gl.parent_id = auth.uid() and gl.student_id = v_gl.student_id;
  if v_existing is not null then
    update public.guardian_links gl
       set status = 'active', accepted_at = now(), relation = coalesce(v_gl.relation, gl.relation)
     where gl.id = v_existing;
    delete from public.guardian_links gl where gl.id = v_gl.id;   -- davet satırı (veli boş) kapanır; tekil bağ korunur
    v_id := v_existing;
  else
    update public.guardian_links gl
       set parent_id = auth.uid(), status = 'active', accepted_at = now(), invite_token_hash = null
     where gl.id = v_gl.id;
    v_id := v_gl.id;
  end if;
  return jsonb_build_object('link_id', v_id, 'student_id', v_gl.student_id);
end
$$;
comment on function public.accept_guardian_invite(text) is 'Veli davetini kabul eder (token sha256 eşleşmesi, süre, tek kullanım); bağ active olur.';

create or replace function public.revoke_guardian_link(p_link uuid) returns void
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_gl public.guardian_links%rowtype;
begin
  select gl.* into v_gl from public.guardian_links gl where gl.id = p_link;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-INV-001 bağ bulunamadı';
  end if;
  if not coalesce(v_gl.parent_id = auth.uid(), false) then
    perform app.assert_student_access(v_gl.student_id, true);
  end if;
  if v_gl.parent_id is null then
    delete from public.guardian_links gl where gl.id = p_link;   -- kabul edilmemiş davet: satır silinir
  else
    update public.guardian_links gl set status = 'revoked', invite_token_hash = null where gl.id = p_link;
  end if;
end
$$;
comment on function public.revoke_guardian_link(uuid) is 'Veli bağını iptal eder (revoked) ya da kabul edilmemiş daveti siler (öğrenci, velinin kendisi, owner eğitmen, admin).';

-- --- hafıza dosyaları (memory tool deposu) ---------------------------------------------------------

-- Yol izin listesi: /memories/ altında, en çok 3 düzey, parçalar [A-Za-z0-9_-] (dosya adında nokta), uzantı .md | .txt;
-- '..' yok
create or replace function app.memory_path_ok(p_path text) returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_path is not null
     and p_path ~ '^/memories/([A-Za-z0-9_-]+/){0,2}[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(md|txt)$'
     and p_path !~ '\.\.'
     and char_length(p_path) <= 200
$$;
comment on function app.memory_path_ok(text) is 'Hafıza dosyası yolu izin listesinde mi: /memories/…(.md|.txt), ≤ 3 düzey, .. yok.';

-- Hafıza dosyasını yazar ve sürüm satırı ekler. p_content tam yeni içeriktir (str_replace/insert hesabı istemcide);
-- rename'de yeni yol p_new_path. Sınırlar: ≤ settings.memory_max_files (12) dosya, ≤ settings.memory_max_bytes (8 KB);
-- parent_summary.md'yi yalnız worker (gece işi) yazar. Aktör (sürüm geçmişi) yalnız güvenilir çağırandan alınır
-- (worker'ın hafıza aracı: 'coach', 'nightly' …); kullanıcı oturumunda '<rol>:<auth.uid()>' olarak sabitlenir.
create or replace function public.upsert_memory_file(
  p_student uuid, p_path text, p_content text, p_op text, p_actor text, p_new_path text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_max_files int := app.setting_num('memory_max_files', 12)::int;
  v_max_bytes int := app.setting_num('memory_max_bytes', 8192)::int;
  v_exists boolean;
  v_target text := p_path;
  v_content text;
  v_version int;
  v_actor text := p_actor;
begin
  perform app.assert_student_access(p_student, true);
  if not app.is_trusted() then
    v_actor := coalesce(app.role(), 'user') || ':' || auth.uid()::text;
  end if;
  if p_op is null or p_op not in ('create', 'str_replace', 'insert', 'delete', 'rename', 'compact') then
    raise exception using errcode = 'P0001', message = format('OGR-MEM-004 geçersiz işlem %s', coalesce(p_op, '(boş)'));
  end if;
  if nullif(btrim(v_actor), '') is null or char_length(v_actor) > 64 then
    raise exception using errcode = 'P0001', message = 'OGR-MEM-004 actor gerekli (≤ 64 karakter)';
  end if;
  if not app.memory_path_ok(p_path) or (p_op = 'rename' and not app.memory_path_ok(p_new_path)) then
    raise exception using errcode = 'P0001', message = format('OGR-MEM-003 yol izin listesinde değil: %s', coalesce(p_new_path, p_path));
  end if;
  if (p_path = '/memories/parent_summary.md' or p_new_path = '/memories/parent_summary.md') and not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-MEM-007 parent_summary.md yalnız gece işi tarafından yazılır';
  end if;
  perform pg_advisory_xact_lock(hashtext('memory_files:' || p_student::text));
  select exists (select 1 from public.memory_files mf where mf.student_id = p_student and mf.path = p_path) into v_exists;

  if p_op in ('create', 'str_replace', 'insert', 'compact') then
    if p_content is null then
      raise exception using errcode = 'P0001', message = 'OGR-MEM-004 içerik gerekli';
    end if;
    if octet_length(p_content) > v_max_bytes then
      raise exception using errcode = 'P0001', message = format('OGR-MEM-002 dosya %s baytı aşıyor (%s)', v_max_bytes, octet_length(p_content));
    end if;
    if not v_exists and p_op <> 'create' then
      raise exception using errcode = 'P0001', message = format('OGR-MEM-005 dosya yok: %s', p_path);
    end if;
    if not v_exists and (select count(*) from public.memory_files mf where mf.student_id = p_student) >= v_max_files then
      raise exception using errcode = 'P0001', message = format('OGR-MEM-001 hafıza dosyası sınırı (%s) aşıldı', v_max_files);
    end if;
    insert into public.memory_files as mf (student_id, path, content) values (p_student, p_path, p_content)
    on conflict (student_id, path) do update set content = excluded.content;
    v_content := p_content;
  elsif p_op = 'delete' then
    if not v_exists then
      raise exception using errcode = 'P0001', message = format('OGR-MEM-005 dosya yok: %s', p_path);
    end if;
    delete from public.memory_files mf where mf.student_id = p_student and mf.path = p_path;
  else
    if not v_exists then
      raise exception using errcode = 'P0001', message = format('OGR-MEM-005 dosya yok: %s', p_path);
    end if;
    if exists (select 1 from public.memory_files mf where mf.student_id = p_student and mf.path = p_new_path) then
      raise exception using errcode = 'P0001', message = format('OGR-MEM-006 hedef dosya var: %s', p_new_path);
    end if;
    update public.memory_files mf set path = p_new_path where mf.student_id = p_student and mf.path = p_path
    returning mf.content into v_content;
    v_target := p_new_path;
  end if;

  select coalesce(max(v.version), 0) + 1 into v_version from public.memory_file_versions v
   where v.student_id = p_student and v.path = v_target;
  insert into public.memory_file_versions (student_id, path, version, op, actor, content)
  values (p_student, v_target, v_version, p_op, v_actor, v_content);
  return jsonb_build_object('path', v_target, 'version', v_version, 'op', p_op,
                            'bytes', coalesce(octet_length(v_content), 0), 'from_path', case when p_op = 'rename' then p_path end);
end
$$;
comment on function public.upsert_memory_file(uuid, text, text, text, text, text) is 'Hafıza dosyası yazar (create/str_replace/insert/compact/delete/rename), sürüm ekler; ≤ 12 dosya, ≤ 8 KB, /memories/ izin listesi.';

-- --- LLM defteri ve harcama ------------------------------------------------------------------------

-- llm_calls satırı → spend_ledger (gün = Europe/Istanbul tarihi, amaç, sağlayıcı) toplamları
create or replace function app.llm_calls_spend() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  insert into public.spend_ledger as sl (day, purpose, provider, calls, tokens_in, tokens_out, cache_read_tokens, cache_write_tokens, cost_usd)
  values ((new.created_at at time zone 'Europe/Istanbul')::date, new.purpose, new.provider, 1, new.tokens_in, new.tokens_out,
          new.cache_read_tokens, new.cache_write_tokens, new.cost_usd)
  on conflict (day, purpose, provider) do update
    set calls = sl.calls + 1,
        tokens_in = sl.tokens_in + excluded.tokens_in,
        tokens_out = sl.tokens_out + excluded.tokens_out,
        cache_read_tokens = sl.cache_read_tokens + excluded.cache_read_tokens,
        cache_write_tokens = sl.cache_write_tokens + excluded.cache_write_tokens,
        cost_usd = sl.cost_usd + excluded.cost_usd,
        updated_at = now();
  return null;
end
$$;
comment on function app.llm_calls_spend() is 'AFTER INSERT llm_calls: spend_ledger (Istanbul günü, amaç, sağlayıcı) toplamlarını artırır.';
revoke all on function app.llm_calls_spend() from public;

create trigger llm_calls_spend after insert on public.llm_calls
for each row execute function app.llm_calls_spend();

-- Geçit (packages/llm ledger.ts) her çağrıyı buraya ya da doğrudan llm_calls'a yazar. Yalnız güvenilir çağıran (worker)
-- ve personel çağırır: öğrenci/veli oturumu OGR-AUTH-002 (defter harcama tavanlarını besler). Personel oturumunda
-- cost_usd çağrı başına settings.llm_call_max_cost_usd (5) ile sınırlıdır; created_at yalnız worker verebilir (Batch).
-- Negatif sayaç/maliyet tablo kısıtıyla reddedilir (OGR-LLM-001).
create or replace function public.log_llm_call(p_call jsonb) returns bigint
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_id bigint;
  v_ref text := nullif(p_call ->> 'student_ref', '');
begin
  if not (app.is_trusted() or app.is_staff()) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 LLM defterine yalnız worker ve personel yazar';
  end if;
  if coalesce(jsonb_typeof(p_call), '') <> 'object' or nullif(p_call ->> 'purpose', '') is null
     or nullif(p_call ->> 'model', '') is null or nullif(p_call ->> 'status', '') is null then
    raise exception using errcode = 'P0001', message = 'OGR-LLM-001 purpose, model, status gerekli';
  end if;
  begin
    if not app.is_trusted() and coalesce((p_call ->> 'cost_usd')::numeric, 0) > app.setting_num('llm_call_max_cost_usd', 5) then
      raise exception using errcode = 'P0001', message = format('OGR-LLM-001 cost_usd çağrı başına üst sınırı (%s) aşıyor',
                                                               app.setting_num('llm_call_max_cost_usd', 5));
    end if;
  exception when invalid_text_representation then
    raise exception using errcode = 'P0001', message = format('OGR-LLM-001 geçersiz çağrı kaydı: %s', sqlerrm);
  end;
  begin
    insert into public.llm_calls (route, purpose, provider, model, effort, prompt_version, tokens_in, tokens_out, cache_read_tokens,
                                  cache_write_tokens, audio_sec, images, batch, status, error_code, latency_ms, cost_usd, ref_table,
                                  ref_id, student_ref, created_at)
    values (p_call ->> 'route', p_call ->> 'purpose', coalesce(p_call ->> 'provider', 'anthropic'), p_call ->> 'model',
            p_call ->> 'effort', p_call ->> 'prompt_version', coalesce((p_call ->> 'tokens_in')::int, 0),
            coalesce((p_call ->> 'tokens_out')::int, 0), coalesce((p_call ->> 'cache_read_tokens')::int, 0),
            coalesce((p_call ->> 'cache_write_tokens')::int, 0), (p_call ->> 'audio_sec')::int, (p_call ->> 'images')::int,
            coalesce((p_call ->> 'batch')::boolean, false), p_call ->> 'status', p_call ->> 'error_code',
            (p_call ->> 'latency_ms')::int, coalesce((p_call ->> 'cost_usd')::numeric, 0), p_call ->> 'ref_table',
            p_call ->> 'ref_id', v_ref,
            case when app.is_trusted() and p_call ? 'created_at' then (p_call ->> 'created_at')::timestamptz else now() end)
    returning id into v_id;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = format('OGR-LLM-001 geçersiz çağrı kaydı: %s', sqlerrm);
  end;
  return v_id;
end
$$;
comment on function public.log_llm_call(jsonb) is 'llm_calls satırı yazar (tetikleyici spend_ledger''ı günceller); id döner.';

-- Yumuşak harcama tavanı (sade): günlük/aylık kuruluş toplamı (spend_ledger, Istanbul günü) ve öğrenci başına aylık
-- toplam (llm_calls.student_ref) runtime_flags tavanlarıyla karşılaştırılır. Aşım engellemez: downgrade = true
-- (koç Haiku'ya iner, üretim işleri admin onayına girer). paid_llm_enabled = false ya da degraded_mode → paid_allowed = false.
-- runtime_flags.cap_excluded_purposes listesindeki amaçlar tavana takılmaz.
create or replace function public.check_spend(p_purpose text, p_student_ref text default null)
returns table (
  paid_allowed boolean, degraded boolean, downgrade boolean, state text, day_usd numeric, month_usd numeric,
  daily_cap numeric, monthly_cap numeric, student_month_usd numeric, student_cap numeric, alert_level numeric
)
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_month date := date_trunc('month', (now() at time zone 'Europe/Istanbul'))::date;
  v_ref text := p_student_ref;
  v_paid boolean;
  v_deg boolean;
  v_excluded boolean;
  v_day numeric;
  v_mon numeric;
  v_stu numeric;
  v_dc numeric;
  v_mc numeric;
  v_sc numeric;
  v_alert numeric;
  v_over boolean;
  v_stu_over boolean;
begin
  if not (app.is_trusted() or app.is_staff()) then
    select s.public_ref into v_ref from public.students s where s.id = app.my_student_id();
  end if;
  select coalesce((select (rf.value #>> '{}')::boolean from public.runtime_flags rf where rf.key = 'paid_llm_enabled'), false),
         coalesce((select (rf.value #>> '{}')::boolean from public.runtime_flags rf where rf.key = 'degraded_mode'), false),
         coalesce((select (rf.value #>> '{}')::numeric from public.runtime_flags rf where rf.key = 'daily_cap_usd'), 0),
         coalesce((select (rf.value #>> '{}')::numeric from public.runtime_flags rf where rf.key = 'monthly_cap_usd'), 0),
         coalesce((select (rf.value #>> '{}')::numeric from public.runtime_flags rf where rf.key = 'student_monthly_cap_usd'), 0),
         coalesce((select rf.value ? p_purpose from public.runtime_flags rf where rf.key = 'cap_excluded_purposes'), false)
    into v_paid, v_deg, v_dc, v_mc, v_sc, v_excluded;
  select coalesce(sum(sl.cost_usd) filter (where sl.day = v_today), 0), coalesce(sum(sl.cost_usd), 0)
    into v_day, v_mon
    from public.spend_ledger sl where sl.day >= v_month;
  v_stu := 0;
  if v_ref is not null then
    select coalesce(sum(lc.cost_usd), 0) into v_stu from public.llm_calls lc
     where lc.student_ref = v_ref and lc.created_at >= (v_month::timestamp at time zone 'Europe/Istanbul');
  end if;
  select coalesce(max(t.th), 0) into v_alert
    from (select (x.th #>> '{}')::numeric as th
            from public.runtime_flags rf, jsonb_array_elements(rf.value) as x (th)
           where rf.key = 'alert_thresholds' and jsonb_typeof(rf.value) = 'array') as t
   where (v_dc > 0 and v_day >= t.th * v_dc) or (v_mc > 0 and v_mon >= t.th * v_mc);
  v_over := not v_excluded and ((v_dc > 0 and v_day >= v_dc) or (v_mc > 0 and v_mon >= v_mc));
  v_stu_over := not v_excluded and v_ref is not null and v_sc > 0 and v_stu >= v_sc;
  return query select
    v_paid and not v_deg,
    v_deg,
    v_over or v_stu_over,
    case when not v_paid then 'disabled' when v_deg then 'degraded' when v_stu_over then 'student_cap'
         when v_over then 'soft_cap' else 'normal' end,
    round(v_day, 6), round(v_mon, 6), v_dc, v_mc, round(v_stu, 6), v_sc, v_alert;
end
$$;
comment on function public.check_spend(text, text) is 'Yumuşak harcama tavanı: günlük/aylık kuruluş ve aylık öğrenci toplamı; aşımda downgrade = true (engellemez).';

create or replace function public.set_runtime_flag(p_key text, p_value jsonb) returns void
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if not (app.is_trusted() or app.is_admin()) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 çalışma bayrağını yalnız admin değiştirir';
  end if;
  if nullif(btrim(p_key), '') is null or p_value is null then
    raise exception using errcode = 'P0001', message = 'OGR-FLAG-001 anahtar ve değer gerekli';
  end if;
  insert into public.runtime_flags as rf (key, value, updated_by)
  values (p_key, p_value, coalesce('admin:' || auth.uid()::text, 'worker'))
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
  perform app.audit_event('runtime_flag.set', 'public.runtime_flags', p_key, jsonb_build_object('value', p_value));
end
$$;
comment on function public.set_runtime_flag(text, jsonb) is 'runtime_flags upsert (yalnız admin ve worker); denetim izine yazılır.';

-- --- belge isteği (Akış 5, veli "Rapor iste") ------------------------------------------------------

create or replace function public.request_document(
  p_kind text, p_student uuid, p_course uuid, p_title text, p_spec jsonb default '{}'::jsonb
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('notes', 'mock_exam', 'report', 'question_set', 'answer_key')
     or (p_kind = 'answer_key' and not app.is_trusted()) then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-001 geçersiz belge türü %s', coalesce(p_kind, '(boş)'));
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-001 başlık gerekli';
  end if;
  if p_student is null then
    if not (app.is_trusted() or app.is_staff()) then
      raise exception using errcode = '42501', message = 'OGR-AUTH-002 ders geneli belgeyi yalnız eğitmen ya da admin ister';
    end if;
  elsif app.role() = 'parent' then
    if p_kind <> 'report' or not exists (select 1 from app.my_children() as c (sid) where c.sid = p_student) then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 veli yalnız çocuğu için rapor isteyebilir';
    end if;
  else
    perform app.assert_student_access(p_student, true);
  end if;
  insert into public.generated_documents (student_id, course_id, kind, title, spec, status, created_by)
  values (p_student, p_course, p_kind, btrim(p_title), coalesce(p_spec, '{}'::jsonb), 'queued', auth.uid())
  returning id into v_id;
  perform app.try_enqueue('document.generate', jsonb_build_object('document_id', v_id, 'kind', p_kind));
  return v_id;
end
$$;
comment on function public.request_document(text, uuid, uuid, text, jsonb) is 'Belge isteği: generated_documents (queued) + document.generate işi; veli yalnız çocuğu için report.';

-- --- yetkiler --------------------------------------------------------------------------------------

revoke all on function app.is_trusted(), app.is_staff(), app.student_of_enrollment(uuid), app.assert_student_access(uuid, boolean),
  app.setting_num(text, numeric), app.try_enqueue(text, jsonb), app.apply_proposal(uuid, boolean, text),
  app.memory_path_ok(text), app.dossier_leaves(uuid), app.assert_evidence_writer(uuid), app.uploads_ok(uuid[], uuid),
  app.exam_visible(uuid, uuid) from public;
grant execute on function app.uploads_ok(uuid[], uuid), app.exam_visible(uuid, uuid) to authenticated, service_role;
grant execute on function app.is_trusted(), app.is_staff(), app.student_of_enrollment(uuid) to authenticated, service_role;

revoke all on function public.apply_diagnosis(jsonb), public.start_exam_session(uuid, uuid, text),
  public.record_exam_response(uuid, uuid, text, int, boolean, uuid[], text), public.grade_exam_session(uuid),
  public.set_exam_key(uuid, text, numeric, text, numeric), public.peek_answer_key(uuid), public.render_dossier(uuid, uuid),
  public.decide_proposal(uuid, boolean, text), public.create_guardian_invite(uuid, text), public.accept_guardian_invite(text),
  public.revoke_guardian_link(uuid), public.upsert_memory_file(uuid, text, text, text, text, text), public.log_llm_call(jsonb),
  public.check_spend(text, text), public.set_runtime_flag(text, jsonb),
  public.request_document(text, uuid, uuid, text, jsonb) from public;
grant execute on function public.apply_diagnosis(jsonb), public.start_exam_session(uuid, uuid, text),
  public.record_exam_response(uuid, uuid, text, int, boolean, uuid[], text), public.grade_exam_session(uuid),
  public.set_exam_key(uuid, text, numeric, text, numeric), public.peek_answer_key(uuid), public.render_dossier(uuid, uuid),
  public.decide_proposal(uuid, boolean, text), public.create_guardian_invite(uuid, text), public.accept_guardian_invite(text),
  public.revoke_guardian_link(uuid), public.upsert_memory_file(uuid, text, text, text, text, text), public.log_llm_call(jsonb),
  public.check_spend(text, text), public.set_runtime_flag(text, jsonb),
  public.request_document(text, uuid, uuid, text, jsonb) to authenticated, service_role;
