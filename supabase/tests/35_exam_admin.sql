-- tests/35_exam_admin.sql — eğitmen Sınavlar sayfası (0048): instructor_exam_list ve instructor_exam_keys. Admin bütün
-- sınavları görür; eğitmen yalnız yayımlanmış, bağlı öğrencisinin çözdüğü/yüklediği ya da düzenleyebildiği sınavları;
-- anahtarsız ve doğrulanmamış (inferred, güven < 0,8) anahtar sayıları; anahtar RPC'si kapsam dışı sınavı reddeder;
-- öğrenci, veli ve anon 42501; set_exam_keys personel için çalışmaya devam eder ve doğrulanmamış sayısını düşürür.
begin;
\ir _fixture.sql

do $$
declare
  v_x uuid;
  v_q uuid;
begin
  perform t.add_outsiders();
  -- XP: yayımlanmış, test dersinde (inst düzenler); 2 soru: 1 çıkarım (güven 0,5), 2 anahtarsız
  insert into public.exams (curriculum_id, course_id, kind, source, title, status, question_count, is_copyrighted)
  values (t.u('cur'), t.u('course'), 'published', 'instructor', 'Yayımlanmış deneme', 'published', 2, true) returning id into v_x;
  insert into t.cfg values ('XP', v_x::text);
  insert into public.exam_questions (exam_id, no, section, kind, skill_ids, stem_text, options)
  values (v_x, 1, 'TYT', 'mcq', array['t.mat.a'], 'Telifli kök', '[{"key": "A", "text": "a"}, {"key": "B", "text": "b"}, {"key": "C", "text": "c"}]')
  returning id into v_q;
  insert into secure.exam_answer_keys (exam_question_id, correct_option, source, confidence) values (v_q, 'B', 'inferred', 0.5);
  insert into public.exam_questions (exam_id, no, section, kind, skill_ids) values (v_x, 2, 'TYT', 'mcq', array['t.mat.b']);

  -- XD: inst2'nin dersiz denemesi (inst'in kapsamı dışında)
  insert into public.exams (curriculum_id, course_id, kind, source, title, status, created_by)
  values (t.u('cur'), null, 'deneme', 'instructor', 'Ali Hoca denemesi', 'ready', t.u('inst2')) returning id into v_x;
  insert into t.cfg values ('XD', v_x::text);
  insert into public.exam_questions (exam_id, no, kind) values (v_x, 1, 'mcq');

  -- XU: Elif'in yüklediği okul denemesi (oturum notlanmadı); anahtar yüklenmiş
  insert into public.exams (curriculum_id, course_id, kind, source, title, status, created_by, is_copyrighted)
  values (t.u('cur'), t.u('course'), 'deneme', 'uploaded', 'Okul denemesi', 'processing', t.u('elif'), true) returning id into v_x;
  insert into t.cfg values ('XU', v_x::text);
  insert into public.exam_questions (exam_id, no, kind) values (v_x, 1, 'mcq') returning id into v_q;
  insert into secure.exam_answer_keys (exam_question_id, correct_option, source) values (v_q, 'C', 'uploaded');
  insert into public.exam_sessions (exam_id, enrollment_id, mode, status) values (v_x, t.u('EA'), 'uploaded', 'grading');

  -- XS: dersiz pratik seti; yalnız bağsız öğrenci (C) çözdü
  insert into public.exams (curriculum_id, course_id, kind, source, title, status)
  values (t.u('cur'), null, 'practice', 'generated', 'Pratik seti', 'ready') returning id into v_x;
  insert into t.cfg values ('XS', v_x::text);
  insert into public.exam_sessions (exam_id, enrollment_id, mode, status) values (v_x, t.u('EC2'), 'in_app', 'in_progress');
end $$;

-- Admin: hepsi, sayılar
do $$
declare
  v jsonb;
  v_p jsonb;
begin
  perform t.as_user(t.u('admin'));
  v := public.instructor_exam_list();
  perform t.ok((select count(*) from jsonb_array_elements(v) as e
                 where e ->> 'id' in (t.v('XP'), t.v('XD'), t.v('XU'), t.v('XS'))) = 4, 'admin dört sınavı da görür');
  select e into v_p from jsonb_array_elements(v) as e where e ->> 'id' = t.v('XP');
  perform t.ok((v_p ->> 'question_count')::int = 2 and (v_p ->> 'missing_keys')::int = 1 and (v_p ->> 'unverified_keys')::int = 1,
               'XP: 2 soru, 1 anahtarsız, 1 doğrulanmamış');
  perform t.ok(v_p ->> 'kind' = 'published' and (v_p ->> 'can_edit')::boolean and not (v_p ->> 'locked')::boolean, 'XP türü, yetki, kilit');
  perform t.ok(not (v_p ? 'correct_option') and v::text !~ '"B"', 'liste anahtar değeri taşımaz');
  perform t.ok(((select e from jsonb_array_elements(v) as e where e ->> 'id' = t.v('XS')) ->> 'session_count')::int = 1,
               'admin bütün oturumları sayar');
end $$;

-- Eğitmen: kapsam
do $$
declare
  v jsonb;
  v_ids text[];
begin
  perform t.as_user(t.u('inst'));
  v := public.instructor_exam_list();
  select array_agg(e ->> 'id') into v_ids from jsonb_array_elements(v) as e;
  perform t.ok(t.v('XP') = any (v_ids) and t.v('XU') = any (v_ids), 'eğitmen yayımlanmış ve bağlı öğrencisinin yüklediği sınavı görür');
  perform t.ok(not (t.v('XD') = any (v_ids)) and not (t.v('XS') = any (v_ids)), 'eğitmen başkasının denemesini ve bağsız öğrencinin setini görmez');
  perform t.ok(((select e from jsonb_array_elements(v) as e where e ->> 'id' = t.v('XU')) ->> 'session_count')::int = 1,
               'bağlı öğrencinin oturumu sayılır');

  perform t.as_user(t.u('inst2'));
  v := public.instructor_exam_list();
  select array_agg(e ->> 'id') into v_ids from jsonb_array_elements(v) as e;
  perform t.ok(t.v('XP') = any (v_ids) and t.v('XD') = any (v_ids), 'inst2 yayımlanmış ve kendi denemesini görür');
  perform t.ok(not (t.v('XU') = any (v_ids)) and not (t.v('XS') = any (v_ids)), 'inst2 bağsız öğrencinin yüklediği denemeyi görmez');
  perform t.ok(((select e from jsonb_array_elements(v) as e where e ->> 'id' = t.v('XP')) ->> 'session_count')::int = 0,
               'inst2: XP oturumu yok');
  perform t.ok(not ((select e from jsonb_array_elements(v) as e where e ->> 'id' = t.v('XP')) ->> 'can_edit')::boolean,
               'inst2: XP düzenleyemez');
  perform t.as_admin();
end $$;

-- Anahtar RPC'si: kapsam içi soru listesi, kapsam dışı ret
do $$
declare
  v jsonb;
begin
  perform t.as_user(t.u('inst'));
  v := public.instructor_exam_keys(t.v('XP')::uuid);
  perform t.ok(jsonb_array_length(v -> 'questions') = 2 and v -> 'exam' ->> 'title' = 'Yayımlanmış deneme', 'XP: iki soru');
  perform t.ok(v -> 'questions' -> 0 ->> 'correct_option' = 'B' and v -> 'questions' -> 0 ->> 'source' = 'inferred'
               and (v -> 'questions' -> 0 ->> 'unverified')::boolean, 'soru 1: çıkarım anahtarı doğrulanmamış');
  perform t.ok(v -> 'questions' -> 0 -> 'option_keys' = '["A", "B", "C"]'::jsonb and v -> 'questions' -> 0 ->> 'section' = 'TYT',
               'şık anahtarları ve bölüm');
  perform t.ok(v -> 'questions' -> 1 ->> 'correct_option' is null and not (v -> 'questions' -> 1 ->> 'unverified')::boolean, 'soru 2 anahtarsız');
  perform t.ok(v::text !~ 'Telifli kök', 'soru metni dönmez');
  perform t.raises(format('select public.instructor_exam_keys(%L::uuid)', t.v('XD')), 'OGR-AUTH-002%', 'eğitmen kapsam dışı sınavın anahtarını göremez');
  perform t.raises(format('select public.instructor_exam_keys(%L::uuid)', gen_random_uuid()), 'OGR-EXAM-001%', 'olmayan sınav');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.instructor_exam_keys(%L::uuid)', t.v('XU')), 'OGR-AUTH-002%', 'bağsız eğitmen yüklenen denemenin anahtarını göremez');
  perform t.as_admin();
  perform t.ok(exists (select 1 from audit.events ev where ev.action = 'exam_keys.view' and ev.row_id = t.v('XP')), 'okuma denetim izinde');
end $$;

-- Öğrenci, veli, anon: 42501
do $$
begin
  perform t.as_user(t.u('elif'));
  perform t.raises('select public.instructor_exam_list()', 'OGR-AUTH-002%', 'öğrenci sınav listesini göremez');
  perform t.raises(format('select public.instructor_exam_keys(%L::uuid)', t.v('XU')), 'OGR-AUTH-002%', 'öğrenci kendi denemesinin anahtarını göremez');
  perform t.as_user(t.u('parent'));
  perform t.raises('select public.instructor_exam_list()', 'OGR-AUTH-002%', 'veli sınav listesini göremez');
  perform t.raises(format('select public.instructor_exam_keys(%L::uuid)', t.v('XP')), 'OGR-AUTH-002%', 'veli anahtar göremez');
  perform t.as_anon();
  perform t.raises('select public.instructor_exam_list()', '42501', 'anon çalıştıramaz');
  perform t.as_admin();
end $$;

-- set_exam_keys personel için çalışmaya devam eder; eğitmen onayı doğrulanmamışı düşürür
do $$
declare
  v jsonb;
begin
  perform t.as_user(t.u('inst'));
  v := public.set_exam_keys(t.v('XP')::uuid, '[{"no": 1, "correct_option": "B"}, {"no": 2, "correct_option": "d"}]'::jsonb);
  perform t.ok((v ->> 'written')::int = 2 and (v ->> 'unverified')::int = 0 and v -> 'missing_nos' = '[]'::jsonb, 'eğitmen anahtarı yazar');
  v := public.instructor_exam_keys(t.v('XP')::uuid);
  perform t.ok(v -> 'questions' -> 0 ->> 'source' = 'instructor' and v -> 'questions' -> 1 ->> 'correct_option' = 'D', 'yeni anahtar okunur');
  perform t.ok(((select e from jsonb_array_elements(public.instructor_exam_list()) as e where e ->> 'id' = t.v('XP')) ->> 'unverified_keys')::int = 0,
               'liste: doğrulanmamış 0');
  v := public.set_exam_keys(t.v('XU')::uuid, '[{"no": 1, "correct_option": "A"}]'::jsonb);
  perform t.ok((v ->> 'written')::int = 1, 'owner eğitmen yüklenen denemenin anahtarını yazar');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.set_exam_keys(%L::uuid, ''[{"no": 1, "correct_option": "A"}]''::jsonb)', t.v('XU')),
                   'OGR-AUTH-002%', 'bağsız eğitmen yüklenen denemenin anahtarını yazamaz');
  -- 0049: oluşturanı boş, dersi olmayan sınavda can_edit_exam NULL dönüyor ve "if not" engeli çalışmıyordu
  perform t.raises(format('select public.set_exam_keys(%L::uuid, ''[{"no": 1, "correct_option": "A"}]''::jsonb)', t.v('XP')),
                   'OGR-AUTH-002%', 'kapsam dışı eğitmen oluşturanı boş sınavın anahtarını yazamaz (0049)');
  perform t.as_user(t.u('admin'));
  v := public.set_exam_keys(t.v('XD')::uuid, '[{"no": 1, "correct_option": "E"}]'::jsonb);
  perform t.ok((v ->> 'written')::int = 1, 'admin her sınavın anahtarını yazar');
  perform t.as_admin();
end $$;

rollback;
