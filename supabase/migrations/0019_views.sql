-- 0019_views.sql — istemci görünümleri (docs/PLAN-v2-detail.md §2.4, docs/PLAN-v2.md §8, §10).
-- Görünümler sahibinin haklarıyla çalışır (security_invoker kapalı, security_barrier açık): altta yatan tabloların RLS'i
-- yerine satırları WHERE'deki yardımcılar süzer. Böylece veli mastery tablosunu değil yalnız mastery_view'u, öğrenci
-- exam_questions/questions tablolarını değil yalnız maskeli görünümleri okur. Görünümdeki fonksiyonlar çağıranın
-- haklarıyla çalışır (app.can_read_student, app.is_staff, app.is_trusted authenticated'a açıktır).

-- Ustalık görünümü (öğrenci, veli, eğitmen, admin): kanıt sayısı settings.min_evidence'ın (5) altındaysa p ve bant null.
-- Bantlar: low < 0.5 ≤ mid < 0.8 ≤ high.
create view public.mastery_view with (security_barrier = true) as
with mv as (select coalesce((select (st.value #>> '{}')::int from public.settings as st where st.key = 'min_evidence'), 5) as min_n)
select e.student_id,
       m.enrollment_id,
       e.course_id,
       m.curriculum_id,
       m.skill_id,
       s.name as skill_name,
       s.parent_id,
       m.evidence_count,
       case when m.evidence_count >= mv.min_n then m.p end as p,
       case when m.evidence_count < mv.min_n then null
            when m.p < 0.5 then 'low'
            when m.p < 0.8 then 'mid'
            else 'high' end as band,
       m.last_evidence_at,
       m.updated_at
  from public.mastery as m
  join public.enrollments as e on e.id = m.enrollment_id
  join public.skills as s on s.curriculum_id = m.curriculum_id and s.id = m.skill_id and s.is_leaf
 cross join mv
 where app.is_trusted() or app.can_read_student(e.student_id);
comment on view public.mastery_view is 'Yaprak ustalığı; kanıt < settings.min_evidence ise p ve bant (low|mid|high) null. Öğrenci, aktif veli, bağlı eğitmen, admin.';

-- Öğrencinin sınav soruları: yalnız kendi oturumu olan sınavlar (ve personel). is_copyrighted ise stem_text null ve
-- şıklarda yalnız harf (metin yok); şıkların yanılgı etiketleri hiç gösterilmez.
create view public.v_exam_questions_student with (security_barrier = true) as
select q.id,
       q.exam_id,
       q.no,
       q.section,
       q.kind,
       case when x.is_copyrighted then null else q.stem_text end as stem_text,
       case when jsonb_typeof(q.options) <> 'array' then q.options
            else (select jsonb_agg(case when x.is_copyrighted then jsonb_build_object('key', o.opt -> 'key')
                                        else o.opt - 'misconception_tag' end order by o.ord)
                    from jsonb_array_elements(q.options) with ordinality as o (opt, ord)) end as options,
       x.is_copyrighted,
       q.figure_upload_id,
       q.skill_ids,
       q.style_id,
       q.difficulty
  from public.exam_questions as q
  join public.exams as x on x.id = q.exam_id
 where app.is_trusted()
    or app.is_staff()
    or exists (select 1 from public.exam_sessions as es join public.enrollments as e on e.id = es.enrollment_id
                where es.exam_id = q.exam_id and e.student_id = app.my_student_id());
comment on view public.v_exam_questions_student is 'Öğrencinin oturumu olan sınavların soruları; telifli sınavda soru metni ve şık metinleri maskeli, yanılgı etiketleri yok.';

-- Soru bankası (öğrenci): onaylı sorular, görebildiği müfredatlar; şıkların yanılgı etiketleri çıkarılır
create view public.v_questions_student with (security_barrier = true) as
select q.id,
       q.curriculum_id,
       q.skill_ids,
       q.kind,
       q.stem,
       q.stem_values,
       q.figure_id,
       case when jsonb_typeof(q.options) <> 'array' then q.options
            else (select jsonb_agg(o.opt - 'misconception_tag' order by o.ord)
                    from jsonb_array_elements(q.options) with ordinality as o (opt, ord)) end as options,
       q.difficulty
  from public.questions as q
 where q.status = 'approved' and (app.is_trusted() or app.can_read_curriculum(q.curriculum_id));
comment on view public.v_questions_student is 'Onaylı sorular (şıklarda yanılgı etiketi yok); görebildiği müfredatlar.';

-- Veli özet kartı: aktif bağ başına çocuk kimliği, etkin kayıtlar, son etkinlik, 7 g teşhis ve 30 g deneme sayısı,
-- son deneme skoru, ustalık bant dağılımı, açık yanılgı sayısı, okunmamış bildirim sayısı. Koç sohbeti içermez.
create view public.v_parent_child_overview with (security_barrier = true) as
with mv as (select coalesce((select (st.value #>> '{}')::int from public.settings as st where st.key = 'min_evidence'), 5) as min_n)
select gl.parent_id,
       gl.student_id,
       gl.relation,
       p.display_name,
       s.grade,
       s.school,
       coalesce((select jsonb_agg(jsonb_build_object('enrollment_id', e.id, 'course_id', e.course_id, 'course_title', co.title,
                                                     'target_exam', e.target_exam, 'exam_date', e.exam_date)
                                  order by e.started_at, e.id)
                   from public.enrollments as e left join public.courses as co on co.id = e.course_id
                  where e.student_id = gl.student_id and e.status = 'active'), '[]'::jsonb) as enrollments,
       greatest((select max(o.created_at) from public.observations as o join public.enrollments as e on e.id = o.enrollment_id
                  where e.student_id = gl.student_id),
                (select max(es.started_at) from public.exam_sessions as es join public.enrollments as e on e.id = es.enrollment_id
                  where e.student_id = gl.student_id)) as last_activity_at,
       (select count(*) from public.solution_analyses as sa join public.enrollments as e on e.id = sa.enrollment_id
         where e.student_id = gl.student_id and sa.created_at >= now() - interval '7 days') as diagnoses_7d,
       (select count(*) from public.exam_sessions as es join public.enrollments as e on e.id = es.enrollment_id
         where e.student_id = gl.student_id and es.started_at >= now() - interval '30 days') as exams_30d,
       (select jsonb_build_object('session_id', es.id, 'title', x.title, 'finished_at', es.finished_at,
                                  'total', es.score -> 'total', 'net', es.score -> 'net')
          from public.exam_sessions as es
          join public.enrollments as e on e.id = es.enrollment_id
          join public.exams as x on x.id = es.exam_id
         where e.student_id = gl.student_id and es.score is not null
         order by es.finished_at desc nulls last, es.id asc limit 1) as last_exam,
       (select jsonb_build_object('low', count(*) filter (where m.evidence_count >= mv.min_n and m.p < 0.5),
                                  'mid', count(*) filter (where m.evidence_count >= mv.min_n and m.p >= 0.5 and m.p < 0.8),
                                  'high', count(*) filter (where m.evidence_count >= mv.min_n and m.p >= 0.8),
                                  'insufficient', count(*) filter (where m.evidence_count < mv.min_n))
          from public.mastery as m
          join public.enrollments as e on e.id = m.enrollment_id and e.status = 'active'
          join public.skills as s2 on s2.curriculum_id = m.curriculum_id and s2.id = m.skill_id and s2.is_leaf
         where e.student_id = gl.student_id) as mastery_bands,
       (select count(*) from public.misconceptions as mc join public.enrollments as e on e.id = mc.enrollment_id
         where e.student_id = gl.student_id and e.status = 'active' and mc.status = 'open') as open_misconceptions,
       (select count(*) from public.notifications as n where n.recipient_id = gl.parent_id and n.read_at is null) as unread_notifications
  from public.guardian_links as gl
  join public.students as s on s.id = gl.student_id
  left join public.profiles as p on p.id = s.profile_id
 cross join mv
 where gl.status = 'active' and (gl.parent_id = auth.uid() or app.is_admin() or app.is_trusted());
comment on view public.v_parent_child_overview is 'Veli özet kartı (aktif bağ başına): kayıtlar, etkinlik, deneme, ustalık bantları, açık yanılgılar; koç sohbeti yok.';

grant select on public.mastery_view, public.v_exam_questions_student, public.v_questions_student, public.v_parent_child_overview
to authenticated, service_role;
