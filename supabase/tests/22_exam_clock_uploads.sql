-- tests/22_exam_clock_uploads.sql — P2 deneme düzeltmeleri (0033): exam_clock salt okur (oturum açmaz, kapatmaz; bitiş
-- yarışında yeni deneme oturumu doğmaz), yetki (öğrenci kendi oturumu; başka öğrenci ve veli okuyamaz), kitapçık
-- sayfası ve şekil yüklemelerine öğrenci yalnız kendi sınavı üzerinden erişir (uploads_select_exam).
begin;
\ir _fixture.sql

do $$
declare
  v_exam uuid;
  v_q uuid;
  v_page uuid := gen_random_uuid();
  v_fig uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_st jsonb;
  v_n bigint;
begin
  insert into public.exams (curriculum_id, course_id, kind, source, title, status, question_count, created_by, duration_min)
  values (t.u('cur'), t.u('course'), 'published', 'instructor', 'Saat Deneme', 'published', 1, t.u('inst'), 30) returning id into v_exam;
  insert into t.cfg values ('SX', v_exam::text);
  -- eğitmenin yüklediği kitapçık sayfası ve şekli (sahibi eğitmen, öğrenciye ait değil)
  insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime)
  values (v_page, t.u('inst'), null, 'photo', t.u('inst')::text || '/sayfa.png', 'image/png'),
         (v_fig, t.u('inst'), null, 'photo', t.u('inst')::text || '/sekil.png', 'image/png'),
         (v_other, t.u('inst'), null, 'photo', t.u('inst')::text || '/baska.png', 'image/png');
  insert into public.exam_questions (exam_id, no, kind, skill_ids, page_upload_id, figure_upload_id, bbox)
  values (v_exam, 1, 'mcq', array['t.mat.a'], v_page, v_fig, '{"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.2}') returning id into v_q;
  insert into t.cfg values ('SXQ', v_q::text), ('SXP', v_page::text), ('SXF', v_fig::text), ('SXO', v_other::text);
  -- oturum açılmadan önce öğrenci kitapçığı göremez
  perform t.as_user(t.u('elif'));
  perform t.ok(app.student_can_read_exam_upload(t.u('SXP')) is false
               and (select count(*) from public.uploads where id = t.u('SXP')) = 0,
               'oturum yokken eğitmenin kitapçık sayfası öğrenciye görünmez');
  perform t.as_admin();
end $$;

-- yetki, salt okur saat, yükleme görünürlüğü (oturum açıldıktan sonra)
do $$
declare
  v_st jsonb;
  v_before bigint;
  v_after bigint;
begin
  perform t.ok(not has_function_privilege('anon', 'public.exam_clock(uuid)', 'execute')
               and has_function_privilege('authenticated', 'public.exam_clock(uuid)', 'execute'),
               'exam_clock: anon çağıramaz, öğrenci çağırabilir');
  perform t.as_user(t.u('elif'));
  v_st := public.start_exam_session(t.u('SX'));
  perform t.ok(v_st ->> 'status' = 'in_progress', 'öğrenci oturumu açtı');
  perform t.as_admin();
  insert into t.cfg values ('SXS', v_st ->> 'session_id');
  perform t.as_user(t.u('elif'));
  -- oturum açılınca öğrenci kendi sınavının kitapçık sayfasını ve şeklini görür; başka yükleme görünmez
  perform t.ok(app.student_can_read_exam_upload(t.u('SXP')) and app.student_can_read_exam_upload(t.u('SXF'))
               and not app.student_can_read_exam_upload(t.u('SXO')),
               'oturumu olan öğrenci: sınavın sayfası ve şekli okunur, başka yükleme okunmaz');
  perform t.ok((select count(*) from public.uploads where id in (t.u('SXP'), t.u('SXF'))) = 2
               and (select count(*) from public.uploads where id = t.u('SXO')) = 0,
               'uploads_select_exam: satır yalnız sınav yoluyla görünür');
  -- saat: yeni oturum açmaz, süren oturumun bitiş sınırını ve sunucu saatini döner
  select count(*) into v_before from public.exam_sessions where exam_id = t.u('SX');
  v_st := public.exam_clock(t.u('SXS'));
  perform t.ok(v_st ->> 'session_id' = t.v('SXS') and v_st ->> 'status' = 'in_progress'
               and (v_st ->> 'deadline_at')::timestamptz is not null and v_st ? 'server_now',
               'exam_clock: süren oturumun bitiş sınırı ve sunucu saati');
  -- bitiş yarışı: oturum bitince saat eşitlemesi yeni deneme oturumu açmaz
  perform public.finish_exam_session(t.u('SXS'));
  v_st := public.exam_clock(t.u('SXS'));
  select count(*) into v_after from public.exam_sessions where exam_id = t.u('SX');
  perform t.ok(v_st ->> 'status' <> 'in_progress' and v_after = v_before,
               'bitmiş oturumda exam_clock yeni deneme oturumu açmaz (bitiş yarışı yok)');
  perform t.as_admin();
end $$;

-- başka öğrenci ve veli: oturum yok, saat ve yükleme okunamaz
do $$
begin
  perform t.as_user(t.u('can'));
  perform t.raises(format('select public.exam_clock(%L::uuid)', t.v('SXS')), 'OGR-AUTH-001%', 'başka öğrenci oturumun saatini okuyamaz');
  perform t.ok(app.student_can_read_exam_upload(t.u('SXP')) is false
               and (select count(*) from public.uploads where id = t.u('SXP')) = 0,
               'başka öğrenci: eğitmenin kitapçık sayfası görünmez');
  perform t.as_user(t.u('parent'));
  perform t.raises(format('select public.exam_clock(%L::uuid)', t.v('SXS')), 'OGR-AUTH-001%', 'veli oturumun saatini okuyamaz');
  perform t.as_admin();
end $$;

rollback;
