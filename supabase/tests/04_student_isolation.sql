-- tests/04_student_isolation.sql — öğrenci yalıtımı: öğrenci A (Elif) öğrenci B'nin (Can) hiçbir satırını göremez ve
-- B adına hiçbir RPC'yi çağıramaz; veli yazamaz; viewer eğitmen yazamaz; profil/kayıt yazımları yalnız kendine.
begin;
\ir _fixture.sql
select t.add_outsiders();

do $$
begin
  -- B'nin dünyası (worker bağlamı)
  perform public.apply_diagnosis(jsonb_build_object('enrollment_id', t.u('EB'), 'verdict', 'wrong', 'error_cause', 'concept',
            'skill_ids', jsonb_build_array('t.mat.a'), 'misconception_tags', jsonb_build_array('t.a.isaret-hatasi'),
            'analysis', '{}'::jsonb));
  perform public.upsert_memory_file(t.u('B'), '/memories/profile.md', 'Can: görsel anlatım sever.', 'create', 'test');
  insert into public.uploads (owner_id, student_id, kind, storage_path) values (t.u('can'), t.u('B'), 'photo', 'can/1.jpg');
  insert into public.conversations (student_id, kind, participant_id) values (t.u('B'), 'coach', t.u('can'));
  insert into public.preferences (student_id, modality) values (t.u('B'), 'visual');
end $$;

-- Okuma: B'ye ait her tablo A için boş
do $$
declare
  v_tbl text;
  v_bad text := '';
begin
  foreach v_tbl in array array[
    format('select 1 from public.observations where enrollment_id = %L', t.u('EB')),
    format('select 1 from public.mastery where enrollment_id = %L', t.u('EB')),
    format('select 1 from public.mastery_history where enrollment_id = %L', t.u('EB')),
    format('select 1 from public.mastery_view where student_id = %L', t.u('B')),
    format('select 1 from public.misconceptions where enrollment_id = %L', t.u('EB')),
    'select 1 from public.misconception_evidence',
    format('select 1 from public.solution_analyses where enrollment_id = %L', t.u('EB')),
    format('select 1 from public.memory_files where student_id = %L', t.u('B')),
    format('select 1 from public.memory_file_versions where student_id = %L', t.u('B')),
    format('select 1 from public.uploads where student_id = %L', t.u('B')),
    format('select 1 from public.conversations where student_id = %L', t.u('B')),
    format('select 1 from public.preferences where student_id = %L', t.u('B')),
    format('select 1 from public.enrollments where student_id = %L', t.u('B')),
    format('select 1 from public.students where id = %L', t.u('B')),
    format('select 1 from public.profiles where id = %L', t.u('can'))]
  loop
    if t.sees(t.u('elif'), v_tbl) <> 0 then
      v_bad := v_bad || ' [' || v_tbl || ']';
    end if;
  end loop;
  perform t.ok(v_bad = '', 'öğrenci A, B''nin satırlarını göremez' || v_bad);
  perform t.ok(t.sees(t.u('can'), format('select 1 from public.observations where enrollment_id = %L', t.u('EB'))) > 0
               and t.sees(t.u('can'), format('select 1 from public.memory_files where student_id = %L', t.u('B'))) = 1,
               'B kendi satırlarını görür (sınama tutarlı)');
end $$;

-- RPC'ler: A, B adına çağıramaz
do $$
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.apply_diagnosis(jsonb_build_object('enrollment_id', %L, 'verdict', 'correct', 'analysis', '{}'::jsonb))$q$, t.u('EB')),
                   'OGR-AUTH-001%', 'apply_diagnosis başka öğrencinin kaydına yazamaz');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/x.md', 'x', 'create', 'student')$q$, t.u('B')),
                   'OGR-AUTH-001%', 'upsert_memory_file başka öğrenciye yazamaz');
  perform t.raises(format($q$select public.render_dossier(%L, %L)$q$, t.u('B'), t.u('course')), 'OGR-AUTH-001%', 'render_dossier başka öğrenci');
  perform t.raises(format($q$select public.create_guardian_invite(%L)$q$, t.u('B')), 'OGR-AUTH-001%', 'başka öğrenci için veli daveti');
  perform t.raises(format($q$select public.request_document('notes', %L, %L, 'x')$q$, t.u('B'), t.u('course')), 'OGR-AUTH-001%',
                   'başka öğrenci için belge isteği');
  perform t.raises(format($q$select public.start_exam_session(gen_random_uuid(), %L)$q$, t.u('EB')), 'OGR-AUTH-001%',
                   'başka öğrencinin kaydıyla sınav başlatılamaz');
  -- doğrudan yazımlar
  perform t.raises(format($q$insert into public.enrollments (student_id, curriculum_id, period_label) values (%L, %L, 'x')$q$, t.u('B'), t.u('cur')),
                   '42501', 'başka öğrenci adına kayıt açılamaz');
  perform t.raises(format($q$insert into public.uploads (owner_id, student_id, kind, storage_path) values (%L, %L, 'photo', 'x')$q$, t.u('elif'), t.u('B')),
                   '42501', 'başka öğrenci adına yükleme yapılamaz');
  perform t.raises(format($q$insert into public.uploads (owner_id, kind, storage_path) values (%L, 'photo', 'x')$q$, t.u('can')),
                   '42501', 'başkası adına (owner_id) yükleme yapılamaz');
  perform t.raises(format($q$insert into public.preferences (student_id) values (%L)$q$, t.u('B')), '42501', 'başka öğrencinin tercihleri yazılamaz');
  perform t.raises(format($q$insert into public.conversations (student_id, kind, participant_id) values (%L, 'coach', auth.uid())$q$, t.u('B')),
                   '42501', 'başka öğrenci için koç sohbeti açılamaz');
  update public.profiles set display_name = 'Değişti' where id = t.u('can');
  update public.students set grade = '12' where id = t.u('B');
  -- kendi yazımları
  insert into public.preferences (student_id, default_mode) values (t.u('A'), 'explain');
  update public.students set grade = '12' where id = t.u('A');
  insert into public.uploads (owner_id, student_id, kind, storage_path) values (auth.uid(), t.u('A'), 'photo', 'elif/2.jpg');
  insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values (t.u('A'), t.u('cur'), t.u('course'), 'Yaz 2027');
  perform t.as_admin();
  perform t.ok((select p.display_name from public.profiles p where p.id = t.u('can')) = 'Can Demir'
               and (select s.grade from public.students s where s.id = t.u('B')) = '11', 'başkasının profili/öğrenci satırı güncellenmez (0 satır)');
  perform t.ok((select s.grade from public.students s where s.id = t.u('A')) = '12'
               and (select pr.default_mode from public.preferences pr where pr.student_id = t.u('A')) = 'explain'
               and (select count(*) from public.enrollments e where e.student_id = t.u('A')) = 2, 'öğrenci kendi satırlarını yazar');
end $$;

-- Veli ve viewer eğitmen yazamaz; owner eğitmen yazar
do $$
begin
  perform t.as_user(t.u('parent'));
  perform t.raises(format($q$select public.apply_diagnosis(jsonb_build_object('enrollment_id', %L, 'verdict', 'correct', 'analysis', '{}'::jsonb))$q$, t.u('EA')),
                   'OGR-AUTH-001%', 'veli teşhis yazamaz');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/x.md', 'x', 'create', 'parent')$q$, t.u('A')),
                   'OGR-AUTH-001%', 'veli hafıza yazamaz');
  perform t.raises(format($q$select public.render_dossier(%L, %L)$q$, t.u('A'), t.u('course')), 'OGR-AUTH-001%', 'veli dossier çağıramaz');
  perform t.as_admin();
  update public.instructor_links il set role = 'viewer' where il.instructor_id = t.u('inst') and il.student_id = t.u('B');
  perform t.as_user(t.u('inst'));
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/x.md', 'x', 'create', 'instructor')$q$, t.u('B')),
                   'OGR-AUTH-001%', 'viewer eğitmen yazamaz');
  perform t.ok(t.n(format('select 1 from public.observations where enrollment_id = %L', t.u('EB'))) > 0, 'viewer eğitmen okur');
  perform t.ok((public.upsert_memory_file(t.u('A'), '/memories/courses/T-MAT.md', 'Eğitmen vurgusu: işaret.', 'create', 'instructor') ->> 'version')::int = 1,
               'owner eğitmen yazar');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format($q$select public.render_dossier(%L, %L)$q$, t.u('A'), t.u('course')), 'OGR-AUTH-001%', 'bağsız eğitmen dossier çağıramaz');
  perform t.as_admin();
end $$;

rollback;
