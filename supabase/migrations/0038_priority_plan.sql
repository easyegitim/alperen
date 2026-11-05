-- 0038_priority_plan.sql — P4 sıklık analizine göre öncelik planı (docs/PLAN-v2.md §11; sözleşme exam-priority-plan).
--   compute_priority_plan(p_course, p_period)   worker/eğitmen: app.refresh_style_scores (0037) ile skorları tazeler
--                                       (skor = 0.5·sıklık + 0.3·güncellik + 0.2·müfredat uyumu), sorulmuş ve emekli
--                                       olmayan tarzları skor sırasıyla dizer; ilk 10 tarz satır, kalanı "others", izlencede
--                                       olup hiç sorulmamış konular "uncovered_topics". Başlık sabittir ("Sıklık analizine
--                                       göre öncelikler"); plan tahmin değildir ve soru metni taşımaz (evidence_item_ids
--                                       yalnız arşive bağlantıdır). exam_priority_plans(pending_review) yazar; dersin
--                                       önceki bekleyen planı emekli olur. En az iki yıllık arşiv gerekir (OGR-STYLE-010).
--   approve_priority_plan(p_plan, p_decision)   eğitmen: bekleyen planı approved (dersin önceki onaylı planı emekli
--                                       olur; öğrenci onaylı planı okur) | retired; onaylı plan yalnız emekli edilir,
--                                       emekli plan karara bağlanmaz (OGR-STYLE-012).
--   exam_priority_plans RLS: bekleyen/emekli plan yalnız dersin arşivini okuyabilen personele (0036 arşiv yalıtımı);
--                                       onaylı plan derse erişen öğrenciye (veli hariç; plan tarz adı taşır, 0018 tarz kuralı).
--   Tarz alıştırması: practice_sets.style_id; "Bu tarzı hiç çözmedin" kartından (payload.style_id) kurulan set tarzın
--                                       onaylı sorularını önce alır (app.practice_fill_items), sette tarz sorusu yoksa
--                                       style.question_gen kuyruğa girer; cevaplar style_coverage'a sayılır (0036).

create or replace function public.compute_priority_plan(p_course uuid, p_period text default null) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_co public.courses%rowtype;
  v_scores jsonb;
  v_total int;
  v_from int;
  v_to int;
  v_period text;
  v_rows jsonb;
  v_others jsonb;
  v_uncovered jsonb;
  v_evidence int;
  v_ranked jsonb;
  v_plan jsonb;
  v_id uuid;
begin
  select co.* into v_co from public.courses co where co.id = p_course;
  if v_co.id is null then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-001 ders bulunamadı';
  end if;
  if not app.can_manage_course(p_course) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 öncelik planını yalnız worker, dersin eğitmeni ya da admin hesaplar';
  end if;
  if length(p_period) > 40 then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-010 dönem en çok 40 karakter';
  end if;
  v_scores := app.refresh_style_scores(p_course);
  select count(distinct coalesce(ei.year, s.year)), min(coalesce(ei.year, s.year)), max(coalesce(ei.year, s.year))
    into v_total, v_from, v_to
    from public.exam_items ei join public.exam_sources s on s.id = ei.source_id
   where s.course_id = p_course and s.status <> 'failed';
  if v_total < 2 then
    raise exception using errcode = 'P0001',
      message = format('OGR-STYLE-010 öncelik planı için en az iki yılın arşivi gerekir (%s: %s yıl)', v_co.code, v_total);
  end if;
  v_period := coalesce(nullif(btrim(p_period), ''), v_from || '–' || v_to);

  -- sorulmuş, emekli olmayan tarzlar skor sırasıyla (refresh_style_scores sırası)
  select coalesce(jsonb_agg(jsonb_build_object('rank', z.rnk, 'style_id', z.id, 'name', z.name, 'hits', z.hits, 'years', z.years,
                                               'alignment', z.alignment, 'has_skills', z.has_skills, 'skill_ids', to_jsonb(z.skill_ids))
                            order by z.rnk), '[]'::jsonb)
    into v_ranked
    from (select row_number() over (order by x.ord) as rnk, qs.id, qs.name, (x.e ->> 'hits')::int as hits,
                 jsonb_array_length(x.e -> 'years_hit') as years, (x.e ->> 'alignment')::numeric as alignment,
                 (x.e ->> 'has_skills')::boolean as has_skills, qs.skill_ids
            from jsonb_array_elements(v_scores) with ordinality as x (e, ord)
            join public.question_styles qs on qs.id = (x.e ->> 'style_id')::uuid
           where (x.e ->> 'hits')::int > 0 and qs.status <> 'retired') as z;
  select coalesce(sum(r.hits), 0) into v_evidence from jsonb_to_recordset(v_ranked)
      as r (rank int, style_id uuid, name text, hits int, years int, alignment numeric, has_skills boolean, skill_ids text[]);
  if v_evidence = 0 then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-011 tarza atanmış çıkmış soru yok; önce kümeleme (style.ingest) tamamlanmalı';
  end if;

  select jsonb_agg(jsonb_build_object(
           'rank', r.rank,
           'topic', left(r.name, 80),
           'kind', case (select mode() within group (order by ei.kind)
                           from public.exam_items ei join public.exam_sources s on s.id = ei.source_id
                          where ei.style_id = r.style_id and s.course_id = p_course and s.status <> 'failed')
                     when 'proof' then 'ispat' when 'calc' then 'hesap' when 'mc' then 'çoktan seçmeli' else 'diğer' end,
           'skill_id', coalesce(r.skill_ids[1],
                                (select mode() within group (order by ei.skill_id)
                                   from public.exam_items ei join public.exam_sources s on s.id = ei.source_id
                                  where ei.style_id = r.style_id and s.course_id = p_course and s.status <> 'failed')),
           'hits', r.hits,
           'years', r.years,
           'points_text', '≈' || coalesce(round((select avg(ei.points)
                                                    from public.exam_items ei join public.exam_sources s on s.id = ei.source_id
                                                   where ei.style_id = r.style_id and s.course_id = p_course and s.status <> 'failed')), 0)
                          || ' puan',
           'evidence_count', r.hits,
           'evidence_item_ids', (select jsonb_agg(ei.id order by coalesce(ei.year, s.year) desc, s.id, ei.item_no)
                                   from public.exam_items ei join public.exam_sources s on s.id = ei.source_id
                                  where ei.style_id = r.style_id and s.course_id = p_course and s.status <> 'failed'),
           'syllabus_alignment', case when r.has_skills and r.alignment > 0 then 'covered_and_asked' else 'asked_not_in_syllabus' end,
           'variant_question_ids', (select coalesce(jsonb_agg(q.id order by q.created_at, q.id), '[]'::jsonb)
                                      from public.questions q
                                     where q.style_id = r.style_id and q.source = 'llm' and q.status = 'approved'),
           'style_ids', jsonb_build_array(r.style_id))
         order by r.rank)
    into v_rows
    from jsonb_to_recordset(v_ranked)
      as r (rank int, style_id uuid, name text, hits int, years int, alignment numeric, has_skills boolean, skill_ids text[]) where r.rank <= 10;
  select coalesce(jsonb_agg(left(r.name, 80) order by r.rank), '[]'::jsonb) into v_others from jsonb_to_recordset(v_ranked)
      as r (rank int, style_id uuid, name text, hits int, years int, alignment numeric, has_skills boolean, skill_ids text[]) where r.rank > 10;

  -- izlencede olup sorulmamış konular: konunun hiçbir kazanımı (kendisi ya da alt kazanımı) sorulmuş bir tarzda yok
  with recursive anc as (
    select sk.id as skill_id, sk.id as anc_id, sk.parent_id from public.skills sk where sk.curriculum_id = v_co.curriculum_id
    union all
    select a.skill_id, p.id, p.parent_id from anc a join public.skills p on p.curriculum_id = v_co.curriculum_id and p.id = a.parent_id
  ),
  asked as (
    select distinct a.anc_id from jsonb_to_recordset(v_ranked)
      as r (rank int, style_id uuid, name text, hits int, years int, alignment numeric, has_skills boolean, skill_ids text[]) cross join unnest(r.skill_ids) as x (sid) join anc a on a.skill_id = x.sid
  )
  select coalesce(jsonb_agg(st.title order by st.week nulls last, st.title), '[]'::jsonb) into v_uncovered
    from public.syllabus_topics st
   where st.course_id = p_course and cardinality(st.skill_ids) > 0
     and not exists (select 1 from unnest(st.skill_ids) as y (sid) join asked on asked.anc_id = y.sid);

  v_plan := jsonb_build_object(
    'schema_version', '1.0', 'course_code', v_co.code, 'period', v_period, 'title', 'Sıklık analizine göre öncelikler',
    'years_total', v_total, 'rows', v_rows, 'others', v_others, 'uncovered_topics', v_uncovered, 'evidence_count', v_evidence,
    'generated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  update public.exam_priority_plans p set status = 'retired' where p.course_id = p_course and p.status = 'pending_review';
  insert into public.exam_priority_plans (course_id, period, plan, evidence_count, status)
  values (p_course, v_period, v_plan, v_evidence, 'pending_review')
  returning id into v_id;
  perform app.audit_event('style.priority_plan', 'public.exam_priority_plans', v_id::text,
                          jsonb_build_object('course_id', p_course, 'period', v_period, 'rows', jsonb_array_length(v_rows),
                                             'evidence_count', v_evidence));
  return jsonb_build_object('plan_id', v_id, 'status', 'pending_review', 'plan', v_plan, 'scores', v_scores);
end
$$;
comment on function public.compute_priority_plan(uuid, text) is 'Worker/eğitmen: tarz skorlarını tazeler (0.5·sıklık + 0.3·güncellik + 0.2·müfredat uyumu) ve exam-priority-plan şemasında "Sıklık analizine göre öncelikler" planını exam_priority_plans(pending_review) olarak yazar; ≥ 2 yıllık arşiv ister; {plan_id, status, plan, scores}.';

create or replace function public.approve_priority_plan(p_plan uuid, p_decision text) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_p public.exam_priority_plans%rowtype;
begin
  select p.* into v_p from public.exam_priority_plans p where p.id = p_plan for update;
  if v_p.id is null then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-012 plan bulunamadı';
  end if;
  if app.is_trusted() or not app.can_manage_course(v_p.course_id) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 planı yalnız dersin eğitmeni ya da admin onaylar';
  end if;
  if p_decision is null or p_decision not in ('approved', 'retired') then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-012 karar approved | retired olmalı';
  end if;
  -- yalnız bekleyen plan karara bağlanır (yeni hesap eskisini emekli ettiyse eski plan onaylanamaz); onaylı plan emekli edilebilir
  if v_p.status <> 'pending_review' and not (p_decision = 'retired' and v_p.status = 'approved') then
    raise exception using errcode = 'P0001', message = format('OGR-STYLE-012 plan bekleyen durumda değil (%s)', v_p.status);
  end if;
  if p_decision = 'approved' then
    update public.exam_priority_plans p set status = 'retired'
     where p.course_id = v_p.course_id and p.status = 'approved' and p.id <> p_plan;
    update public.exam_priority_plans p set status = 'approved', approved_by = auth.uid(), approved_at = now() where p.id = p_plan;
  else
    update public.exam_priority_plans p set status = 'retired' where p.id = p_plan;
  end if;
  perform app.audit_event('style.priority_plan_decision', 'public.exam_priority_plans', p_plan::text,
                          jsonb_build_object('decision', p_decision, 'course_id', v_p.course_id));
  return jsonb_build_object('plan_id', p_plan, 'status', p_decision);
end
$$;
comment on function public.approve_priority_plan(uuid, text) is 'Eğitmen/admin: bekleyen planı onaylar (dersin önceki onaylı planı emekli; öğrenci onaylı planı okur) ya da emekli eder; onaylı plan yalnız emekli edilir; worker onaylayamaz.';

revoke all on function public.compute_priority_plan(uuid, text), public.approve_priority_plan(uuid, text) from public, anon;
grant execute on function public.compute_priority_plan(uuid, text), public.approve_priority_plan(uuid, text) to authenticated, service_role;

-- --- request_style_questions ---------------------------------------------------------------------------------------------
-- Eğitmen "5 soru üret" düğmesi: tarz için `style.question_gen` işini kuyruğa atar (üretilen sorular worker'da doğrulanır,
-- bankaya approved girer; payload apps/worker/src/jobs/style-question-gen.ts ile aynı: style_id, count, reason).

create or replace function public.request_style_questions(p_style uuid, p_count int default 5) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_st public.question_styles%rowtype;
  v_job uuid;
begin
  select qs.* into v_st from public.question_styles qs where qs.id = p_style;
  if v_st.id is null then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-013 tarz bulunamadı';
  end if;
  if not app.can_manage_course(v_st.course_id) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 tarza soru üretimini yalnız dersin eğitmeni, admin ya da worker ister';
  end if;
  if v_st.status = 'retired' then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-013 emekli tarza soru üretilmez';
  end if;
  if p_count is null or p_count not between 1 and 10 then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-013 soru sayısı 1–10 olmalı';
  end if;
  v_job := public.enqueue_job('style.question_gen', jsonb_build_object('style_id', p_style, 'count', p_count, 'reason', 'instructor'));
  perform app.audit_event('style.question_gen_request', 'public.question_styles', p_style::text,
                          jsonb_build_object('course_id', v_st.course_id, 'count', p_count, 'job_id', v_job));
  return jsonb_build_object('style_id', p_style, 'count', p_count, 'job_id', v_job);
end
$$;
comment on function public.request_style_questions(uuid, int) is 'Eğitmen/admin: tarz için style.question_gen işini kuyruğa atar (1–10 soru); {style_id, count, job_id}.';
revoke all on function public.request_style_questions(uuid, int) from public, anon;
grant execute on function public.request_style_questions(uuid, int) to authenticated, service_role;

-- --- exam_priority_plans RLS: bekleyen plan yalnız dersin personeline ----------------------------------------------------
-- 0018 her eğitmene (app.is_staff) bütün derslerin bekleyen planlarını açıyordu (tarz adları, evidence_item_ids); 0036'nın
-- arşiv yalıtımıyla aynı kural: arşivi okuyabilen personel her durumu, derse erişen herkes yalnız onaylı planı görür.
drop policy exam_priority_plans_select on public.exam_priority_plans;
create policy exam_priority_plans_select on public.exam_priority_plans for select to authenticated
-- veli görmez: plan tarz adları taşır ve 0018 tarz kuralı veliden tarz açıklamasını saklar (hile/biçim içeriği)
using (app.can_read_course_archive(course_id)
       or (status = 'approved' and app.can_read_course(course_id) and app.role() is distinct from 'parent'));

-- --- tarz alıştırması: practice_sets.style_id ---------------------------------------------------------------------------

alter table public.practice_sets add column style_id uuid references public.question_styles (id) on delete set null;  -- Tarz kartından kurulan setin tarzı (tarz soruları önce)
comment on column public.practice_sets.style_id is 'Tarz kartından kurulan setin tarzı (tarz soruları önce)';

-- 0027'nin banka doldurucusu + tarz önceliği: set bir tarza bağlıysa o tarzın onaylı soruları (aynı kazanım süzgecinden
-- geçen) önce gelir, kalan yer yapraklar arasında sırayla dolar. Tarzsız sette sıra 0027 ile aynıdır.
create or replace function app.practice_fill_items(p_set uuid) returns int
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_ps public.practice_sets%rowtype;
  v_cur uuid;
  v_n int;
begin
  select ps.* into v_ps from public.practice_sets ps where ps.id = p_set;
  if not found or exists (select 1 from public.practice_set_items i where i.set_id = p_set) then
    return 0;
  end if;
  select e.curriculum_id into v_cur from public.enrollments e where e.id = v_ps.enrollment_id;
  insert into public.practice_set_items (set_id, no, question_id)
  select p_set, row_number() over (order by z.smiss, z.rn, z.sk, z.h), z.qid
    from (
      select r.qid, r.sk, r.rn, r.h, r.smiss
        from (
          select c.qid, c.sk, c.h, c.smiss,
                 row_number() over (partition by c.sk order by c.smiss, c.diag, c.seen, c.last_seen nulls first, c.h) as rn
            from (
              select q.id as qid,
                     (select x.sid from unnest(q.skill_ids) as x (sid) where x.sid = any(v_ps.skill_ids) order by x.sid limit 1) as sk,
                     md5(q.id::text || p_set::text) as h,
                     -- tarz seti: tarzın sorusu önce (0 önce gelir); tarzsız sette herkes 0
                     case when v_ps.style_id is null then 0 else (q.style_id is distinct from v_ps.style_id)::int end as smiss,
                     -- teşhis sorusu yaprağın sonuna: banka (şablon/LLM/eğitmen) yetmezse kullanılır
                     (exists (select 1 from public.exam_questions eq join public.exams x on x.id = eq.exam_id
                               where eq.question_id = q.id and x.kind = 'diagnostic'))::int as diag,
                     (select count(*) from public.attempts a where a.enrollment_id = v_ps.enrollment_id and a.question_id = q.id) as seen,
                     (select max(a.created_at) from public.attempts a where a.enrollment_id = v_ps.enrollment_id and a.question_id = q.id) as last_seen
                from public.questions q
                join secure.answer_keys k on k.question_id = q.id
               where q.curriculum_id = v_cur and q.status = 'approved' and q.skill_ids && v_ps.skill_ids
                 and app.answer_key_complete(q.kind, k.correct_option, k.numeric_value)
                 -- bu kayda atanmış ve bitmemiş sınavın sorusu alıştırmaya girmez (anahtar sızmaz; 0027)
                 and not app.practice_exam_blocks(v_ps.enrollment_id, q.id)
            ) as c
        ) as r
       order by r.smiss, r.rn, r.sk, r.h
       limit v_ps.target_count
    ) as z;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
comment on function app.practice_fill_items(uuid) is 'Sorusuz alıştırma setini onaylı + anahtarlı bankadan doldurur (atanmış ve bitmemiş sınav soruları hariç: app.practice_exam_blocks; tarz setinde tarzın soruları önce; teşhis soruları yaprakta en sona); eklenen sayıyı döner.';

-- 0021'in start_practice'i + tarz: öneri payload.style_id taşıyorsa (öneri motoru "Bu tarzı hiç çözmedin" kartı) set o
-- tarza bağlanır; practice.generate yüküne style_id eklenir; set dolduğu hâlde tarzın sorusu yoksa (anahtarsız ya da
-- kazanımı dışında) tarz bankası için style.question_gen kuyruğa girer. Geri kalan her kural 0021 ile aynıdır.
create or replace function public.start_practice(
  p_suggestion uuid, p_enrollment uuid default null, p_skill_ids text[] default null, p_count int default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sug public.suggestions%rowtype;
  v_enr public.enrollments%rowtype;
  v_enr_id uuid := p_enrollment;
  v_codes text[] := p_skill_ids;
  v_count int := p_count;
  v_skills text[];
  v_set uuid;
  v_n int;
  v_open public.practice_sets%rowtype;
  v_cur public.curricula%rowtype;
  v_daily int;
  v_style uuid;
begin
  if p_suggestion is not null then
    select s.* into v_sug from public.suggestions s where s.id = p_suggestion for update;
    if not found then
      raise exception using errcode = 'P0001', message = format('OGR-SUG-001 öneri bulunamadı %s', p_suggestion);
    end if;
    -- öneriyi yalnız öğrencinin kendisi, admin ya da worker başlatır (consume_suggestion ile aynı kural)
    if not (app.is_trusted() or app.is_admin() or coalesce(v_sug.student_id = app.my_student_id(), false)) then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 öneriyi yalnız öğrencinin kendisi başlatır';
    end if;
    if v_sug.kind not in ('practice', 'weekly_homework', 'lesson_review', 'gap_analysis') then
      raise exception using errcode = 'P0001', message = format('OGR-PRAC-002 bu öneri alıştırma değil (%s)', v_sug.kind);
    end if;
    select ps.id into v_set from public.practice_sets ps where ps.suggestion_id = p_suggestion;
    if v_set is not null then
      perform app.practice_expire_generation(v_set);  -- üretim zaman aşımına uğradıysa: yeniden dene ya da kapat
      return app.practice_set_json(v_set);
    end if;
    perform public.consume_suggestion(p_suggestion);
    v_enr_id := coalesce(v_sug.enrollment_id, p_enrollment);
    if v_codes is null and jsonb_typeof(v_sug.payload -> 'skill_ids') = 'array' then
      v_codes := array(select jsonb_array_elements_text(v_sug.payload -> 'skill_ids'));
    end if;
    if v_count is null and jsonb_typeof(v_sug.payload -> 'count') = 'number' then
      v_count := (v_sug.payload ->> 'count')::int;
    end if;
    -- tarz kartı: tarz geçerli değilse (silindi, birleşti) set tarzsız kurulur
    if coalesce(v_sug.payload ->> 'style_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select qs.id into v_style from public.question_styles qs where qs.id = (v_sug.payload ->> 'style_id')::uuid and qs.status <> 'retired';
    end if;
  end if;
  select e.* into v_enr from public.enrollments e where e.id = v_enr_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-PRAC-001 kayıt bulunamadı (öneri ya da p_enrollment)';
  end if;
  if v_sug.id is not null and v_sug.student_id <> v_enr.student_id then
    raise exception using errcode = 'P0001', message = 'OGR-PRAC-001 kayıt önerinin öğrencisine ait değil';
  end if;
  perform app.assert_student_access(v_enr.student_id, true);
  if v_sug.id is null then
    -- koç yolu: aynı kayıt için eşzamanlı çağrılar sırayla (tek açık set ve günlük sınır sayımı yarışsız)
    perform pg_advisory_xact_lock(hashtextextended('practice:' || v_enr.id::text, 0));
  end if;
  v_skills := app.practice_target_leaves(v_enr.id, v_codes);
  if coalesce(cardinality(v_skills), 0) = 0 then
    select c.* into v_cur from public.curricula c where c.id = v_enr.curriculum_id;
    if not exists (select 1 from public.skills s where s.curriculum_id = v_enr.curriculum_id and s.is_leaf)
       and (v_cur.draft_status in ('queued', 'researching', 'drafting', 'saving')
            or (v_cur.draft_status is null and v_cur.status = 'draft' and v_cur.origin = 'ai_draft')) then
      raise exception using errcode = 'P0001', message = 'OGR-PRAC-006 müfredat hazırlanıyor; alıştırma taslak bitince açılır';
    end if;
    raise exception using errcode = 'P0001', message = 'OGR-PRAC-001 hedef kazanım bu kaydın müfredatında yok';
  end if;
  -- onaylanmamış taslak: otopilot etkin değilse öğrenci eğitmenin yayınını bekler (PLAN §3.5; 0025)
  select c.* into v_cur from public.curricula c where c.id = v_enr.curriculum_id;
  if v_cur.status = 'draft' and not coalesce((public.curriculum_autopilot_state(v_cur.id) ->> 'effective')::boolean, false) then
    raise exception using errcode = 'P0001', message = 'OGR-PRAC-008 müfredat eğitmen onayını bekliyor; alıştırma yayından sonra açılır';
  end if;
  v_count := least(greatest(coalesce(v_count, app.setting_num('practice_set_size', 8)::int), 1), 10);

  if v_sug.id is null then
    -- tek açık koç seti: kazanımları kesişiyorsa aynısı döner (boş bankada üretim işi yeniden atılmaz); değilse kapanır.
    -- Üretimi zaman aşımına uğramış set önce yeniden denenir ya da kapatılır (yeni set yeni practice.generate işi atar).
    perform app.practice_expire_generation(ps.id) from public.practice_sets ps
     where ps.enrollment_id = v_enr.id and ps.suggestion_id is null and ps.status = 'needs_generation';
    select ps.* into v_open from public.practice_sets ps
     where ps.enrollment_id = v_enr.id and ps.suggestion_id is null and ps.status in ('in_progress', 'needs_generation')
     order by ps.started_at desc, ps.id
     limit 1;
    if found then
      if v_open.skill_ids && v_skills then
        return app.practice_set_json(v_open.id);
      end if;
      perform public.finish_practice(v_open.id);
    end if;
    if not app.is_trusted() then
      select count(*) into v_daily from public.practice_sets ps
       where ps.enrollment_id = v_enr.id and ps.suggestion_id is null and ps.started_at > now() - interval '1 day';
      if v_daily >= app.setting_num('practice_daily_sets', 10)::int then
        raise exception using errcode = 'P0001', message = 'OGR-PRAC-007 bugünlük alıştırma sınırına ulaştın; yarın yeni set açılır';
      end if;
    end if;
  end if;

  insert into public.practice_sets (enrollment_id, suggestion_id, status, skill_ids, target_count, style_id)
  values (v_enr.id, v_sug.id, 'needs_generation', v_skills, v_count, v_style)
  returning id into v_set;

  v_n := app.practice_fill_items(v_set);

  if v_n > 0 then
    update public.practice_sets ps set status = 'in_progress' where ps.id = v_set;
  else
    perform app.try_enqueue('practice.generate', jsonb_build_object(
      'set_id', v_set, 'enrollment_id', v_enr.id, 'curriculum_id', v_enr.curriculum_id, 'skill_ids', to_jsonb(v_skills),
      'count', v_count, 'style_id', v_style,
      'template_ids', coalesce((select jsonb_agg(qt.id order by qt.id) from public.question_templates qt
                                 where qt.curriculum_id = v_enr.curriculum_id and qt.enabled and qt.skill_id = any(v_skills)), '[]'::jsonb)));
  end if;
  -- tarz seti tarzın sorusunu alamadıysa: tarz bankası doldurulur (sonraki kart tarzın sorularıyla açılır)
  if v_style is not null and not exists (select 1 from public.practice_set_items i join public.questions q on q.id = i.question_id
                                          where i.set_id = v_set and q.style_id = v_style) then
    perform app.try_enqueue('style.question_gen', jsonb_build_object('style_id', v_style, 'enrollment_id', v_enr.id,
                                                                     'count', 5, 'reason', 'practice_set'));
  end if;
  return app.practice_set_json(v_set);
end
$$;
comment on function public.start_practice(uuid, uuid, text[], int) is 'Alıştırma seti kurar (öneriden ya da kayıt + kazanımlardan; onaylı bankadan ≤ 10 soru, bitmemiş sınav soruları hariç; tarz kartında tarzın soruları önce); soru yoksa needs_generation + practice.generate işi; koç yolunda tek açık set ve günlük sınır.';
