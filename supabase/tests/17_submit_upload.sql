-- tests/17_submit_upload.sql — submit_upload (0026): öğrenci yüklediği sayfaları gönderir → doğrulama, 'processing',
-- upload.intake işi (enqueue_job; pgboss bu testte yok: 'job.enqueue_skipped' + job_id null) ve 'upload.submit' denetim
-- satırı. Hatalar: öğrenci olmayan OGR-AUTH-001, geçersiz tür/sayı OGR-UPL-001, başkasının ya da olmayan yükleme
-- OGR-UPL-002, işlenmiş yükleme OGR-UPL-003, etkin kayıt yok OGR-UPL-004. Yeniden deneme ('processing', aynı küme, sırası
-- önemsiz, tür aynı) aynı işi döner (küme işlenmiş olsa da); kümede başka gönderimin sayfası varsa (farklı küme, alt küme,
-- farklı tür) OGR-UPL-003, yeni sayfa 'stored' kalır ve ikinci iş atılmaz.
-- Okul denemesi bu yoldan gönderilmez (0030: school_exam OGR-UPL-001; tek yol submit_exam_upload, 18_exams_upload.sql).
-- Yetki: anon çağıramaz, authenticated çağırır. Ayrıca apply_diagnosis otopilotu (0026): yalnız otopilotu etkin taslakta
-- hemen kabul; eğitmen kapattıysa ya da sınav parkuru dışıysa öneri açık kalır.
begin;
\ir _fixture.sql

do $$
declare
  v_p text;
begin
  insert into t.cfg values ('U1', gen_random_uuid()::text), ('U2', gen_random_uuid()::text), ('UC', gen_random_uuid()::text),
                           ('UD', gen_random_uuid()::text), ('UE', gen_random_uuid()::text);
  v_p := t.v('elif');
  insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime) values
    (t.u('U1'), t.u('elif'), t.u('A'), 'photo', v_p || '/' || t.v('U1') || '.jpg', 'image/jpeg'),
    (t.u('U2'), t.u('elif'), t.u('A'), 'pdf', v_p || '/' || t.v('U2') || '.pdf', 'application/pdf'),
    (t.u('UD'), t.u('elif'), t.u('A'), 'photo', v_p || '/' || t.v('UD') || '.jpg', 'image/jpeg'),
    (t.u('UE'), t.u('elif'), t.u('A'), 'photo', v_p || '/' || t.v('UE') || '.jpg', 'image/jpeg'),
    (t.u('UC'), t.u('can'), t.u('B'), 'photo', t.v('can') || '/' || t.v('UC') || '.jpg', 'image/jpeg');
  insert into t.cfg select 'ENR_A', e.id::text from public.enrollments e
   where e.student_id = t.u('A') and e.status = 'active' order by e.created_at desc, e.id limit 1;
end $$;

-- yetki ve doğrulama hataları
do $$
begin
  perform t.ok(not has_function_privilege('anon', 'public.submit_upload(uuid[], text)', 'execute')
               and has_function_privilege('authenticated', 'public.submit_upload(uuid[], text)', 'execute'),
               'submit_upload: anon çağıramaz, authenticated çağırır');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.submit_upload(array[%L]::uuid[], ''own_work'')', t.v('U1')), 'OGR-AUTH-001%',
                   'öğrenci olmayan (eğitmen) gönderemez');
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.submit_upload(array[%L]::uuid[], ''resim'')', t.v('U1')), 'OGR-UPL-001%', 'geçersiz tür');
  perform t.raises('select public.submit_upload(array[]::uuid[], ''own_work'')', 'OGR-UPL-001%', 'boş küme');
  perform t.raises(format('select public.submit_upload(array[%L, %L]::uuid[], ''own_work'')', t.v('U1'), t.v('U1')), 'OGR-UPL-001%',
                   'yinelenen kimlik');
  perform t.raises(format('select public.submit_upload(array[%L,%L,%L,%L,%L]::uuid[], ''own_work'')', gen_random_uuid(), gen_random_uuid(),
                          gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'OGR-UPL-001%', 'Kendi çalışmam en çok 4 sayfa');
  perform t.raises(format('select public.submit_upload(array[%L, %L]::uuid[], ''own_work'')', t.v('U1'), t.v('UC')), 'OGR-UPL-002%',
                   'başka öğrencinin yüklemesi gönderilemez');
  perform t.raises(format('select public.submit_upload(array[%L]::uuid[], ''own_work'')', gen_random_uuid()), 'OGR-UPL-002%',
                   'olmayan yükleme');
  perform t.as_admin();
  perform t.ok((select count(*) = 0 from public.uploads u where u.id in (t.u('U1'), t.u('UC')) and u.status <> 'stored'),
               'düşen gönderim durumu değiştirmez');
end $$;

-- başarılı gönderim + yeniden deneme
do $$
declare
  v_r jsonb;
  v_r2 jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_r := public.submit_upload(array[t.u('U1'), t.u('U2')], 'own_work');
  perform t.ok(v_r ->> 'enrollment_id' = t.v('ENR_A') and v_r -> 'job_id' = 'null'::jsonb and not (v_r ->> 'reused')::boolean
               and v_r -> 'upload_ids' = jsonb_build_array(t.v('U1'), t.v('U2')),
               'gönderim: en son etkin kayıt, pgboss yokken job_id null (' || v_r::text || ')');
  perform t.ok(t.n(format('select 1 from public.uploads where id in (%L, %L) and status = ''processing''', t.v('U1'), t.v('U2'))) = 2,
               'yüklemeler processing (öğrenci görür)');
  perform t.as_admin();
  perform t.ok(exists (select 1 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'upload.intake'
                        and e.diff -> 'data' ->> 'kind' = 'own_work' and e.diff -> 'data' ->> 'student_id' = t.v('A')
                        and e.diff -> 'data' ->> 'enrollment_id' = t.v('ENR_A')
                        and e.diff -> 'data' -> 'upload_ids' = jsonb_build_array(t.v('U1'), t.v('U2'))),
               'upload.intake işi {upload_ids, kind, student_id, enrollment_id} ile denendi');
  perform t.ok(exists (select 1 from audit.events e where e.action = 'upload.submit' and e.row_id = least(t.v('U1'), t.v('U2'))
                        and e.diff -> 'upload_set' = (select jsonb_agg(x order by x) from unnest(array[t.u('U1'), t.u('U2')]) as x)
                        and e.diff -> 'upload_ids' = jsonb_build_array(t.v('U1'), t.v('U2'))),
               'upload.submit denetim satırı (en küçük kimlik, sıralı küme, gönderim sırası)');

  -- pgboss benzetimi: iş kimliği dönen gönderimin tekrarı yeni iş atmaz
  update audit.events e set diff = e.diff || jsonb_build_object('job_id', '11111111-1111-4111-8111-111111111111')
   where e.action = 'upload.submit' and e.diff -> 'upload_ids' ->> 0 = t.v('U1');
  perform t.as_user(t.u('elif'));
  v_r2 := public.submit_upload(array[t.u('U1'), t.u('U2')], 'own_work');
  perform t.ok((v_r2 ->> 'reused')::boolean and v_r2 ->> 'job_id' = '11111111-1111-4111-8111-111111111111'
               and v_r2 ->> 'enrollment_id' = t.v('ENR_A'), 'yeniden deneme (processing): aynı iş döner, yenisi atılmaz');
  v_r2 := public.submit_upload(array[t.u('U2'), t.u('U1')], 'own_work');
  perform t.ok((v_r2 ->> 'reused')::boolean and v_r2 ->> 'job_id' = '11111111-1111-4111-8111-111111111111',
               'yeniden deneme farklı sırayla: aynı küme, aynı iş');
  -- küme kısmen işleniyor ([U1,U2] sonra [U1,UE]): eski iş dönmez, UE sessizce processing'te kalmaz
  perform t.raises(format('select public.submit_upload(array[%L, %L]::uuid[], ''own_work'')', t.v('U1'), t.v('UE')), 'OGR-UPL-003%',
                   'kısmen başka gönderimde işlenen küme reddedilir');
  perform t.raises(format('select public.submit_upload(array[%L]::uuid[], ''own_work'')', t.v('U1')), 'OGR-UPL-003%',
                   'işlenen kümenin alt kümesi reddedilir');
  perform t.raises(format('select public.submit_upload(array[%L]::uuid[], ''own_work'')', t.v('U2')), 'OGR-UPL-003%',
                   'işlenen kümenin ikinci sayfası tek başına reddedilir (ikinci teşhis yok)');
  perform t.raises(format('select public.submit_upload(array[%L, %L]::uuid[], ''school_exam'')', t.v('U1'), t.v('U2')), 'OGR-UPL-001%',
                   'aynı küme school_exam türüyle reddedilir (okul denemesi submit_exam_upload ile)');
  perform t.ok(t.n(format('select 1 from public.uploads where id = %L and status = ''stored''', t.v('UE'))) = 1,
               'reddedilen gönderimde yeni sayfa stored kalır');
  v_r2 := public.submit_upload(array[t.u('UE')], 'own_work');
  perform t.ok(not (v_r2 ->> 'reused')::boolean, 'yeni sayfa kendi başına gönderilebilir');
  perform t.as_admin();
  perform t.ok((select count(*) = 1 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'upload.intake'
                 and e.diff -> 'data' -> 'upload_ids' ->> 0 = t.v('U1')), 'yeniden denemede ikinci iş denenmedi');
  perform t.ok((select count(*) = 0 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'upload.intake'
                 and e.diff -> 'data' -> 'upload_ids' ? t.v('U2') and e.diff -> 'data' -> 'upload_ids' <> jsonb_build_array(t.v('U1'), t.v('U2'))),
               'alt küme ya da tür değişimi için iş atılmadı');
  perform t.ok((select count(*) = 1 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'upload.intake'
                 and e.diff -> 'data' -> 'upload_ids' = jsonb_build_array(t.v('UE'))), 'yeni sayfa için tek iş');

  update public.uploads u set status = 'ready' where u.id in (t.u('U1'), t.u('U2'));
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.submit_upload(array[%L]::uuid[], ''own_work'')', t.v('U1')), 'OGR-UPL-003%',
                   'işlenmiş (ready) yükleme başka kümeyle yeniden gönderilemez');
  v_r2 := public.submit_upload(array[t.u('U1'), t.u('U2')], 'own_work');
  perform t.ok((v_r2 ->> 'reused')::boolean and v_r2 ->> 'job_id' = '11111111-1111-4111-8111-111111111111',
               'işlenmiş kümenin aynı gönderimi hata değil: aynı iş döner (web sonuca gider)');
  perform t.ok(t.n(format('select 1 from public.uploads where id in (%L, %L) and status = ''ready''', t.v('U1'), t.v('U2'))) = 2,
               'yeniden gönderim işlenmiş durumu değiştirmez');
end $$;

-- Okul denemesi bu yoldan gönderilmez (tek yol submit_exam_upload); etkin kayıt yoksa OGR-UPL-004
do $$
declare
  v_r jsonb;
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.submit_upload(array[%L]::uuid[], ''school_exam'')', t.v('UD')), 'OGR-UPL-001%submit_exam_upload%',
                   'school_exam reddedilir: okul denemesi submit_exam_upload ile');
  perform t.as_admin();
  perform t.ok((select u.status = 'stored' from public.uploads u where u.id = t.u('UD'))
               and not exists (select 1 from audit.events e where e.action = 'upload.submit' and e.diff ->> 'kind' = 'school_exam'),
               'reddedilen school_exam gönderimi durum değiştirmez, iş atmaz');
  update public.enrollments e set status = 'paused' where e.student_id = t.u('A');
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.submit_upload(array[%L]::uuid[], ''own_work'')', t.v('UD')), 'OGR-UPL-004%',
                   'etkin kayıt yoksa gönderilemez');
  perform t.as_admin();
  update public.enrollments e set status = 'active' where e.id = t.u('ENR_A');
  perform t.as_user(t.u('elif'));
  v_r := public.submit_upload(array[t.u('UD')], 'own_work');
  perform t.ok(v_r ->> 'kind' = 'own_work' and v_r ->> 'enrollment_id' = t.v('ENR_A'), 'kayıt etkinleşince gönderim');
end $$;

-- apply_diagnosis otopilotu (0026) müfredat kurucunun kuralıyla: curriculum_autopilot_state (ai_draft + TYT/AYT/LGS +
-- eğitmen seçimi ya da runtime_flags) etkin ve müfredat taslaksa öneri hemen kabul, gözlem yeni yaprağa; eğitmen
-- otopilotu kapattıysa (curricula.autopilot = false) ya da ders sınav parkuru değilse öneri açık kalır.
do $$
declare
  v_cur uuid;
  v_uni uuid;
  v_course uuid;
  v_enr uuid;
  v_enr_uni uuid;
  v_id uuid;
begin
  perform t.as_admin();
  insert into public.curricula (code, version, label, status, origin) values ('TYT-OTO-T', '1', 'TYT Otopilot', 'draft', 'ai_draft') returning id into v_cur;
  insert into public.skills (curriculum_id, id, parent_id, name, kind, is_leaf, order_no) values
    (v_cur, 'oto', null, 'Kök', 'unit', false, 1), (v_cur, 'oto.a', 'oto', 'Toplama', 'outcome', true, 2);
  update public.curricula c set draft_status = 'ready' where c.id = v_cur;
  insert into public.courses (code, title, kind, curriculum_id, visibility) values ('TYT-OTO-T', 'TYT Otopilot', 'exam_track', v_cur, 'shared')
  returning id into v_course;
  insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values (t.u('B'), v_cur, v_course, 'YKS 2027 oto')
  returning id into v_enr;
  insert into public.curricula (code, version, label, status, origin) values ('UNI-OTO-T', '1', 'Kimya 101', 'draft', 'ai_draft') returning id into v_uni;
  insert into public.skills (curriculum_id, id, parent_id, name, kind, is_leaf, order_no) values
    (v_uni, 'uni', null, 'Kök', 'unit', false, 1), (v_uni, 'uni.a', 'uni', 'Atom', 'outcome', true, 2);
  insert into public.courses (code, title, kind, curriculum_id, visibility) values ('UNI-OTO-T', 'Kimya 101', 'exam_track', v_uni, 'shared')
  returning id into v_course;
  insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values (t.u('B'), v_uni, v_course, '2026 Güz oto')
  returning id into v_enr_uni;
  perform t.ok((public.curriculum_autopilot_state(v_cur) ->> 'effective')::boolean
               and not (public.curriculum_autopilot_state(v_uni) ->> 'effective')::boolean, 'TYT taslağında otopilot etkin, Kimya 101''de değil');

  perform t.as_service();
  v_id := public.apply_diagnosis(jsonb_build_object('enrollment_id', v_enr, 'verdict', 'wrong', 'analysis', '{}'::jsonb,
            'proposed_subskill', jsonb_build_object('parent_id', 'oto.a', 'id', 'oto.a.1', 'name', 'Eldeli toplama')));
  perform t.as_admin();
  perform t.ok((select cp.status = 'accepted' from public.curriculum_proposals cp join public.solution_analyses sa on sa.proposal_id = cp.id where sa.id = v_id)
               and exists (select 1 from public.skills s where s.curriculum_id = v_cur and s.id = 'oto.a.1' and s.is_leaf),
               'otopilot etkin taslak: teşhis önerisi hemen kabul, yeni yaprak');
  perform t.ok((select sa.skill_ids = array['oto.a.1'] from public.solution_analyses sa where sa.id = v_id)
               and exists (select 1 from public.observations o where o.source_id = v_id::text and o.skill_id = 'oto.a.1' and o.enrollment_id = v_enr and o.value = 0)
               and exists (select 1 from public.mastery m where m.enrollment_id = v_enr and m.skill_id = 'oto.a.1' and m.evidence_count = 1),
               'geçerli yaprak yoksa gözlem otopilotun açtığı yaprağa yazılır');

  -- eğitmen otopilotu kapattı: öneri açık kalır (runtime_flags exam_track açık olsa da)
  update public.curricula c set autopilot = false where c.id = v_cur;
  perform t.as_service();
  v_id := public.apply_diagnosis(jsonb_build_object('enrollment_id', v_enr, 'verdict', 'wrong', 'analysis', '{}'::jsonb,
            'proposed_subskill', jsonb_build_object('parent_id', 'oto.a', 'id', 'oto.a.2', 'name', 'Basamak değeri')));
  perform t.as_admin();
  perform t.ok((select cp.status = 'open' from public.curriculum_proposals cp join public.solution_analyses sa on sa.proposal_id = cp.id where sa.id = v_id)
               and not exists (select 1 from public.skills s where s.curriculum_id = v_cur and s.id = 'oto.a.2')
               and (select cardinality(sa.skill_ids) = 0 from public.solution_analyses sa where sa.id = v_id),
               'curricula.autopilot = false: öneri açık kalır, ağaç değişmez');

  -- sınav parkuru olmayan ders (ders türü exam_track olsa da ad TYT/AYT/LGS değil): öneri açık kalır
  perform t.as_service();
  v_id := public.apply_diagnosis(jsonb_build_object('enrollment_id', v_enr_uni, 'verdict', 'wrong', 'analysis', '{}'::jsonb,
            'proposed_subskill', jsonb_build_object('parent_id', 'uni.a', 'id', 'uni.a.1', 'name', 'İzotop')));
  perform t.as_admin();
  perform t.ok((select cp.status = 'open' from public.curriculum_proposals cp join public.solution_analyses sa on sa.proposal_id = cp.id where sa.id = v_id)
               and not exists (select 1 from public.skills s where s.curriculum_id = v_uni and s.id = 'uni.a.1'),
               'sınav parkuru dışı taslak: öneri açık kalır');
end $$;

rollback;
