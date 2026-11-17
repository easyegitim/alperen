-- 0024_dossier_v2.sql — render_dossier v2 (docs/PLAN-v2.md §2 Dossier, §13 Öneri motoru): 0017 gövdesine iki alan eklenir:
--   last_practice       son bitmiş alıştırma setinin özeti {date, total, correct, top_misconception, weak_skill, skill_ids} | null
--   memory_paths        hafıza dosyalarının yolları (içerik değil; içerik hafıza aracıyla okunur)
-- version 2; hash gövdenin sha256'sıdır (alanlar değişince dossier önbelleği yeniden kurulur). Aktif öneri sayısı gövdede
-- YOK: her "Başla" dokunuşunda hash'i ve system[2] önbelleğini bozardı (§3.3: yalnız alt satırlar değişince yeniden kurulur).
-- identity.course_title: onaylanmamış ai_draft müfredatlı derste (başlık öğrencinin serbest metni) null; ders kodu
-- ([A-Z0-9-], ≤ 40) kalır. Öğrencinin yazdığı metin başka öğrencilerin system prompt'una serbest metin olarak girmez.

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
  v_practice jsonb;
  v_paths jsonb;
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
           'enrollment_id', v_enr.id, 'course_id', co.id, 'course_code', co.code,
           'course_title', case when c.origin = 'ai_draft' and c.status <> 'active' then null else co.title end,
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

  -- v2 (0024): son bitmiş alıştırmanın özeti, hafıza dosya yolları (içerik yok)
  select jsonb_build_object('date', (z.finished_at at time zone 'Europe/Istanbul')::date, 'total', z.summary -> 'total',
                            'correct', z.summary -> 'correct', 'top_misconception', z.summary -> 'top_misconception' -> 'tag',
                            'weak_skill', z.summary -> 'weak_skill' -> 'skill_id', 'skill_ids', to_jsonb(z.skill_ids))
    into v_practice
    from (select ps.finished_at, ps.summary, ps.skill_ids from public.practice_sets ps
           where ps.enrollment_id = v_enr.id and ps.status = 'finished'
           order by ps.finished_at desc, ps.id limit 1) as z;
  select coalesce(jsonb_agg(mf.path order by mf.path), '[]'::jsonb) into v_paths
    from public.memory_files mf where mf.student_id = p_student;

  v_body := jsonb_build_object('version', 2, 'as_of', v_today, 'identity', v_identity, 'mastery', v_mastery,
                               'open_misconceptions', v_misc, 'error_causes_30d', v_causes, 'recent_diagnoses', v_diag,
                               'recent_exams', v_exams, 'style_gaps', v_gaps, 'recent_lesson_claims', v_claims,
                               'last_practice', v_practice, 'memory_paths', v_paths);
  return v_body || jsonb_build_object('hash', encode(sha256(convert_to(v_body::text, 'UTF8')), 'hex'));
end
$$;
comment on function public.render_dossier(uuid, uuid) is 'Dossier yapısal JSON''u v2: kimlik, en zayıf 20 / en güçlü 10 yaprak, açık yanılgılar ≤ 8, 30 g hata nedeni, son 10 teşhis, son 3 deneme, tarz boşlukları, son alıştırma, hafıza yolları, hash (öneri sayısı yok: hash kararlı).';
