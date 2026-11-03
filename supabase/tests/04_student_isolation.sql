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
  insert into public.uploads (owner_id, student_id, kind, storage_path) values (t.u('can'), t.u('B'), 'photo', t.u('can') || '/1.jpg');
  insert into public.conversations (student_id, kind, participant_id) values (t.u('B'), 'coach', t.u('can'));
  insert into public.preferences (student_id, modality) values (t.u('B'), 'visual');
  -- Can'ın kendi yüklediği özel deneme (kind='deneme', created_by = Can) ve sorusu
  insert into public.exams (id, curriculum_id, course_id, kind, source, title, status, created_by)
  values ('50000000-0000-4000-8000-0000000000b1', t.u('cur'), t.u('course'), 'deneme', 'uploaded', 'Can özel deneme', 'ready', t.u('can'));
  insert into public.exam_questions (exam_id, no, kind, stem_text, skill_ids)
  values ('50000000-0000-4000-8000-0000000000b1', 1, 'mcq', 'Can''ın gizli sorusu', array['t.mat.a']);
  -- yalnız Can'a üretilmiş deneme (generated_documents.student_id = B)
  insert into public.generated_documents (id, student_id, course_id, kind, title, status, content)
  values ('60000000-0000-4000-8000-0000000000b1', t.u('B'), t.u('course'), 'mock_exam', 'Can kişisel deneme', 'published',
          '{"kind":"mock_exam","title":"Can kişisel deneme","blocks":[],"keys":[]}');
  insert into public.exams (id, curriculum_id, course_id, kind, source, title, status, generated_document_id)
  values ('50000000-0000-4000-8000-0000000000b2', t.u('cur'), t.u('course'), 'practice', 'generated', 'Can kişisel deneme', 'ready',
          '60000000-0000-4000-8000-0000000000b1');
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
  -- başkasının özel sınavı kendi kaydıyla da başlatılamaz (oturum açıp soru metnini okuma yolu kapalı)
  perform t.raises(format($q$select public.start_exam_session('50000000-0000-4000-8000-0000000000b1', %L, 'uploaded')$q$, t.u('EA')),
                   'OGR-AUTH-001%', 'başkasının yüklediği özel deneme başlatılamaz (uploaded)');
  perform t.raises(format($q$select public.start_exam_session('50000000-0000-4000-8000-0000000000b1', %L, 'in_app')$q$, t.u('EA')),
                   'OGR-AUTH-001%', 'başkasının yüklediği özel deneme başlatılamaz (in_app)');
  perform t.raises(format($q$select public.start_exam_session('50000000-0000-4000-8000-0000000000b2', %L)$q$, t.u('EA')),
                   'OGR-AUTH-001%', 'başkasına üretilmiş deneme başlatılamaz');
  perform t.ok(t.n($q$select 1 from public.exams where id in ('50000000-0000-4000-8000-0000000000b1', '50000000-0000-4000-8000-0000000000b2')$q$) = 0
               and t.n($q$select 1 from public.v_exam_questions_student where exam_id = '50000000-0000-4000-8000-0000000000b1'$q$) = 0
               and t.n($q$select 1 from public.exam_sessions$q$) = 0,
               'başkasının özel sınavı, soruları ve oturumu görünmez');
  perform t.raises(format($q$select public.apply_diagnosis(jsonb_build_object('enrollment_id', %L, 'verdict', 'correct',
                            'skill_ids', jsonb_build_array('t.mat.a'), 'analysis', '{}'::jsonb))$q$, t.u('EA')),
                   'OGR-AUTH-001%', 'öğrenci kendi kaydına da teşhis yazamaz');
  -- doğrudan yazımlar
  perform t.raises(format($q$insert into public.enrollments (student_id, curriculum_id, period_label) values (%L, %L, 'x')$q$, t.u('B'), t.u('cur')),
                   '42501', 'başka öğrenci adına kayıt açılamaz');
  perform t.raises(format($q$insert into public.uploads (owner_id, student_id, kind, storage_path) values (%L, %L, 'photo', %L)$q$, t.u('elif'), t.u('B'), t.u('elif') || '/x.jpg'),
                   '42501', 'başka öğrenci adına yükleme yapılamaz');
  perform t.raises(format($q$insert into public.uploads (owner_id, kind, storage_path) values (%L, 'photo', %L)$q$, t.u('can'), t.u('can') || '/x.jpg'),
                   '42501', 'başkası adına (owner_id) yükleme yapılamaz');
  perform t.raises(format($q$insert into public.preferences (student_id) values (%L)$q$, t.u('B')), '42501', 'başka öğrencinin tercihleri yazılamaz');
  perform t.raises(format($q$insert into public.conversations (student_id, kind, participant_id) values (%L, 'coach', auth.uid())$q$, t.u('B')),
                   '42501', 'başka öğrenci için koç sohbeti açılamaz');
  update public.profiles set display_name = 'Değişti' where id = t.u('can');
  update public.students set grade = '12' where id = t.u('B');
  -- kendi yazımları
  insert into public.preferences (student_id, default_mode) values (t.u('A'), 'explain');
  update public.students set grade = '12' where id = t.u('A');
  insert into public.uploads (owner_id, student_id, kind, storage_path) values (auth.uid(), t.u('A'), 'photo', auth.uid() || '/2.jpg');
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
  perform t.raises(format($q$select public.apply_diagnosis(jsonb_build_object('enrollment_id', %L, 'verdict', 'correct', 'analysis', '{}'::jsonb))$q$, t.u('EB')),
                   'OGR-AUTH-001%', 'viewer eğitmen teşhis yazamaz');
  perform t.ok((public.upsert_memory_file(t.u('A'), '/memories/courses/T-MAT.md', 'Eğitmen vurgusu: işaret.', 'create', 'instructor') ->> 'version')::int = 1,
               'owner eğitmen yazar');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format($q$select public.render_dossier(%L, %L)$q$, t.u('A'), t.u('course')), 'OGR-AUTH-001%', 'bağsız eğitmen dossier çağıramaz');
  perform t.as_admin();
end $$;

-- Sahibi kendi özel denemesini ve kendine üretilmiş denemeyi başlatır; yükleme kimlikleri sahibine ait olmalı
do $$
declare
  v_sess uuid;
  v_q uuid;
  v_up_a uuid;
  v_up_b uuid;
begin
  select q.id into v_q from public.exam_questions q where q.exam_id = '50000000-0000-4000-8000-0000000000b1';
  select u.id into v_up_b from public.uploads u where u.owner_id = t.u('can') limit 1;
  insert into public.uploads (owner_id, student_id, kind, storage_path) values (t.u('elif'), t.u('A'), 'photo', t.u('elif') || '/x.jpg') returning id into v_up_a;
  perform t.as_user(t.u('can'));
  v_sess := public.start_exam_session('50000000-0000-4000-8000-0000000000b1', t.u('EB'), 'uploaded');
  perform t.ok(v_sess is not null and public.start_exam_session('50000000-0000-4000-8000-0000000000b2', t.u('EB')) is not null,
               'öğrenci kendi yüklediği ve kendine üretilmiş denemeyi başlatır');
  perform public.record_exam_response(v_sess, v_q, 'A', null, null, array[v_up_b]);
  perform t.raises(format($q$select public.record_exam_response(%L, %L, 'A', null, null, array[%L]::uuid[])$q$, v_sess, v_q, v_up_a),
                   'OGR-EXAM-006%', 'başkasının yüklemesi cevaba eklenemez');
  perform t.as_admin();
  perform t.ok((select r.work_upload_ids = array[v_up_b] from public.exam_responses r where r.session_id = v_sess), 'kendi yüklemesi cevaba eklendi');
end $$;

-- Yükleme yolu sahibine bağlı: başka öğrencinin nesnesine işaret eden satır yazılamaz (RLS + uploads_path_owner);
-- Storage'da (eşleniği varsa) nesneyi yalnız satırı görebilen ve nesnenin klasör sahibine ait satır açar.
do $$
declare
  v_can_path text := t.u('can') || '/1.jpg';
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$insert into public.uploads (owner_id, student_id, kind, storage_path) values (auth.uid(), %L, 'photo', %L)$q$,
                          t.u('A'), t.u('can') || '/gizli.jpg'),
                   '42501', 'öğrenci başkasının yolunu (ilk klasör) gösteren yükleme satırı yazamaz');
  perform t.raises(format($q$insert into public.uploads (owner_id, student_id, kind, storage_path) values (auth.uid(), %L, 'photo', %L)$q$,
                          t.u('A'), 'uploads/' || t.u('can') || '/1.jpg'),
                   '42501', 'kova önekli yol da reddedilir (nesne adı <owner_id>/…)');
  perform t.as_admin();
  perform t.raises(format($q$insert into public.uploads (owner_id, student_id, kind, storage_path) values (%L, %L, 'photo', %L)$q$,
                          t.u('elif'), t.u('A'), v_can_path),
                   '23514', 'güvenilir yazan (worker) için de yol sahibe bağlı (uploads_path_owner)');
  perform t.raises(format($q$insert into public.uploads (owner_id, student_id, kind, storage_path) values (%L, %L, 'photo', %L)$q$,
                          t.u('elif'), t.u('A'), t.u('elif') || '/../' || t.u('can') || '/1.jpg'),
                   '23514', 'yolda .. parçası olamaz');
  perform t.raises(format($q$insert into public.uploads (owner_id, student_id, kind, storage_path) values (%L, %L, 'photo', %L)$q$,
                          t.u('elif'), t.u('A'), t.u('elif')::text),
                   '23514', 'yalnız klasör adı olan yol olamaz');
  if to_regclass('storage.objects') is null then
    raise notice 'SKIP: storage.objects yok (Storage politikaları sınanmadı)';
    return;
  end if;
  insert into storage.objects (bucket_id, name, owner) values ('uploads', v_can_path, t.u('can'));
  perform t.ok(t.sees(t.u('elif'), format($q$select 1 from storage.objects o where o.name = %L$q$, v_can_path)) = 0
               and t.sees(t.u('can'), format($q$select 1 from storage.objects o where o.name = %L$q$, v_can_path)) = 1
               and t.sees(t.u('inst'), format($q$select 1 from storage.objects o where o.name = %L$q$, v_can_path)) = 1
               and t.sees(t.u('parent'), format($q$select 1 from storage.objects o where o.name = %L$q$, v_can_path)) = 0,
               'Storage uploads: nesneyi sahibi ve bağlı eğitmen okur; başka öğrenci ve veli okuyamaz');
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$insert into storage.objects (bucket_id, name) values ('uploads', %L)$q$, t.u('can') || '/2.jpg'),
                   '42501', 'Storage uploads: öğrenci başkasının klasörüne yazamaz');
  insert into storage.objects (bucket_id, name) values ('uploads', t.u('elif') || '/3.jpg');
  perform t.as_admin();
  perform t.ok(true, 'Storage uploads: öğrenci kendi klasörüne yazar');
end $$;

-- Kayıt: ders ↔ müfredat eşleşmesi her yazan için (OGR-CURR-004)
do $$
declare
  v_other uuid;
begin
  insert into public.curricula (code, version, label, status) values ('T-OTHER', '1', 'Başka müfredat', 'active') returning id into v_other;
  insert into public.courses (code, title, curriculum_id, visibility) values ('T-OTHER', 'Başka ders', v_other, 'shared');
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values (%L, %L, %L, 'Karışık')$q$,
                          t.u('A'), v_other, t.u('course')),
                   'OGR-CURR-004%', 'öğrenci dersi başka müfredatla kaydedemez');
  perform t.as_admin();
  perform t.raises(format($q$insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values (%L, %L, %L, 'Karışık')$q$,
                          t.u('A'), v_other, t.u('course')),
                   'OGR-CURR-004%', 'güvenilir yazan da (worker, RPC) dersi başka müfredatla kaydedemez');
  perform t.raises(format($q$update public.enrollments set curriculum_id = %L where id = %L$q$, v_other, t.u('EA')),
                   'OGR-CURR-004%', 'kaydın müfredatı dersinkinden başkasına taşınamaz');
  insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values (t.u('A'), v_other, null, 'Derssiz');
  perform t.ok(true, 'derssiz kayıt herhangi bir müfredatla açılır');
end $$;

rollback;
