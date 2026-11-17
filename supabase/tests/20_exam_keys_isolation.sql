-- tests/20_exam_keys_isolation.sql — deneme anahtarı ve telif yalıtımı (0030–0031): secure.exam_answer_keys'e öğrenci,
-- veli, eğitmen JWT'siyle doğrudan erişim yok; anahtarı okuyan/yazan ve authenticated'ın çağırabildiği fonksiyonlar
-- yalnız izinli küme (değer döndürmeyen notlama/yazım + personel peek); öğrenciye dönen yapılarda (oynatıcı durumu,
-- skor, sonuç görünümü, maskeli görünüm) anahtar yok; telifli sınavda soru metni ve şık metinleri gizli, telifsizde
-- açık (yanılgı etiketi yine yok); bağsız eğitmen/veli/öğrenci oturum görünümünü açamaz; anahtar yazımı yetkileri;
-- notlanmış sınavın anahtarı değişmez; yüklenen deneme öğrenciye özel: yalnız bağlı eğitmen okur, yalnız owner eğitmen
-- yazar (aynı derste başka öğrenciye bağlı viewer eğitmen ne okur ne yazar).
begin;
\ir _fixture.sql

do $$
declare
  v_exam uuid;
  v_q uuid;
  v_c boolean;
begin
  perform t.add_outsiders();
  foreach v_c in array array[true, false] loop
    insert into public.exams (curriculum_id, course_id, kind, source, title, status, question_count, created_by, is_copyrighted)
    values (t.u('cur'), t.u('course'), 'published', 'instructor', case when v_c then 'Telifli' else 'Açık' end, 'published', 1, t.u('inst'), v_c)
    returning id into v_exam;
    insert into public.exam_questions (exam_id, no, kind, skill_ids, stem_text, options)
    values (v_exam, 1, 'mcq', array['t.mat.a'], 'Gizli kök ' || v_c::text,
            '[{"key": "A", "text": "doğru şık metni", "misconception_tag": "t.a.isaret-hatasi"}, {"key": "B", "text": "çeldirici"}]')
    returning id into v_q;
    perform public.set_exam_key(v_q, 'A');
    insert into t.cfg values (case when v_c then 'XC' else 'XO' end, v_exam::text), (case when v_c then 'QC' else 'QO' end, v_q::text);
  end loop;
end $$;

-- secure şeması ve anahtar tablosu kapalı
do $$
declare
  v_uid uuid;
begin
  perform t.ok(not has_schema_privilege('authenticated', 'secure', 'usage') and not has_schema_privilege('anon', 'secure', 'usage'),
               'secure şeması authenticated/anon için kapalı');
  perform t.ok(not has_table_privilege('authenticated', 'secure.exam_answer_keys', 'select'), 'exam_answer_keys: authenticated SELECT yok');
  foreach v_uid in array array[t.u('elif'), t.u('parent'), t.u('inst'), t.u('deniz')] loop
    perform t.as_user(v_uid);
    perform t.raises('select * from secure.exam_answer_keys', '42501', 'doğrudan anahtar okunamaz (' || v_uid::text || ')');
  end loop;
  perform t.as_admin();
end $$;

-- anahtara dokunan fonksiyonlar: authenticated'ın çağırabildiği küme izinli liste ile aynı
do $$
declare
  v_set text;
begin
  select string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname) into v_set
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app') and p.prosrc ilike '%exam_answer_keys%'
     and has_function_privilege('authenticated', p.oid, 'execute');
  perform t.ok(v_set = 'public.grade_exam_session,public.peek_answer_key,public.set_exam_key,public.set_exam_keys',
               'anahtara dokunan, authenticated çağırabilen fonksiyonlar yalnız notlama/yazım/peek (' || coalesce(v_set, '-') || ')');
  perform t.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname in ('public', 'app') and p.prosrc ilike '%exam_answer_keys%'
                              and has_function_privilege('anon', p.oid, 'execute')), 'anon anahtara dokunan fonksiyon çağıramaz');
end $$;

-- öğrenci: anahtar yazamaz/okuyamaz; oynatıcı, skor, görünüm anahtarsız; telif maskesi
do $$
declare
  v_st jsonb;
  v_score jsonb;
  v_v jsonb;
  v_row record;
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.peek_answer_key(%L)', t.v('QC')), 'OGR-AUTH-002%', 'öğrenci peek_answer_key çağıramaz');
  perform t.raises(format('select public.set_exam_key(%L, ''B'')', t.v('QC')), 'OGR-AUTH-002%', 'öğrenci set_exam_key çağıramaz');
  perform t.raises(format('select public.set_exam_keys(%L, ''[{"no": 1, "correct_option": "B"}]''::jsonb)', t.v('XC')), 'OGR-AUTH-002%',
                   'öğrenci set_exam_keys çağıramaz');
  perform t.ok(t.n('select 1 from public.exam_questions') = 0, 'öğrenci exam_questions tablosunu doğrudan okuyamaz');
  perform t.ok(t.n(format('select 1 from public.v_exam_questions_student where exam_id = %L', t.v('XC'))) = 0,
               'oturum açılmadan sınavın soruları görünmez');
  v_st := public.start_exam_session(t.u('XC'));
  perform t.as_admin();
  insert into t.cfg values ('SC', v_st ->> 'session_id');
  perform t.as_user(t.u('elif'));
  select q.stem_text, q.options into v_row from public.v_exam_questions_student q where q.id = t.u('QC');
  perform t.ok(v_row.stem_text is null and v_row.options = '[{"key": "A"}, {"key": "B"}]'::jsonb,
               'telifli: soru metni ve şık metinleri gizli (' || coalesce(v_row.options::text, '-') || ')');
  perform public.record_exam_response(t.u('SC'), t.u('QC'), 'B');
  v_v := public.finish_exam_session(t.u('SC'));
  perform t.ok(position('correct_option' in v_v::text) = 0 and position('doğru şık metni' in v_v::text) = 0
               and position('Gizli kök' in v_v::text) = 0 and v_v -> 'items' -> 0 -> 'stem_text' = 'null'::jsonb,
               'telifli sonuç görünümü: anahtar, soru ve şık metni yok');
  v_score := (select es.score from public.exam_sessions es where es.id = t.u('SC'));
  perform t.ok(v_score is not null and position('correct_option' in v_score::text) = 0, 'saklanan skor anahtar taşımaz');

  v_st := public.start_exam_session(t.u('XO'));
  perform t.as_admin();
  insert into t.cfg values ('SO', v_st ->> 'session_id');
  perform t.as_user(t.u('elif'));
  select q.stem_text, q.options into v_row from public.v_exam_questions_student q where q.id = t.u('QO');
  perform t.ok(v_row.stem_text = 'Gizli kök false' and v_row.options -> 0 ->> 'text' = 'doğru şık metni'
               and not (v_row.options -> 0 ? 'misconception_tag'), 'telifsiz: soru ve şık metni açık, yanılgı etiketi yok');
  perform public.record_exam_response(t.u('SO'), t.u('QO'), 'B');
  v_v := public.finish_exam_session(t.u('SO'));
  perform t.ok(v_v -> 'items' -> 0 ->> 'stem_text' = 'Gizli kök false' and position('misconception_tag' in v_v::text) = 0
               and position('correct_option' in v_v::text) = 0, 'telifsiz sonuç görünümü: soru metni var, anahtar ve etiket yok');
  perform t.as_admin();
end $$;

-- yalıtım: başkası oturum görünümünü ve cevapları göremez
do $$
declare
  v_uid uuid;
begin
  foreach v_uid in array array[t.u('can'), t.u('deniz'), t.u('inst2'), t.u('parent2')] loop
    perform t.as_user(v_uid);
    perform t.raises(format('select public.exam_session_view(%L)', t.v('SC')), 'OGR-AUTH-001%', 'bağsız kullanıcı görünümü açamaz (' || v_uid::text || ')');
    perform t.ok(t.n(format('select 1 from public.exam_responses where session_id = %L', t.v('SC'))) = 0,
                 'bağsız kullanıcı cevapları göremez (' || v_uid::text || ')');
  end loop;
  perform t.as_user(t.u('parent'));
  perform t.ok(t.n(format('select 1 from public.exam_sessions where id = %L and score is not null', t.v('SC'))) = 1
               and t.n(format('select 1 from public.exam_responses where session_id = %L', t.v('SC'))) = 0
               and t.n('select 1 from public.v_exam_questions_student') = 0,
               'veli skoru görür; cevapları ve soruları görmez');
  perform t.as_user(t.u('inst'));
  perform t.ok(jsonb_array_length(public.exam_session_view(t.u('SC')) -> 'items') = 1
               and (public.peek_answer_key(t.u('QC')) ->> 'correct_option') = 'A', 'owner eğitmen listeyi ve (denetimli) anahtarı görür');
  perform t.raises(format('select public.set_exam_keys(%L, ''[{"no": 1, "correct_option": "A"}]''::jsonb, ''inferred'')', t.v('XC')),
                   'OGR-EXAM-005%', 'eğitmen inferred kaynak yazamaz (yalnız worker)');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.set_exam_keys(%L, ''[{"no": 1, "correct_option": "A"}]''::jsonb)', t.v('XC')), 'OGR-AUTH-002%',
                   'derse bağlı olmayan eğitmen anahtar yazamaz');
  perform t.raises(format('select public.register_exam_questions(%L, ''[{"no": 1}]''::jsonb)', t.v('XC')), 'OGR-AUTH-002%',
                   'derse bağlı olmayan eğitmen soru yazamaz');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.set_exam_keys(%L, ''[{"no": 1, "correct_option": "B"}]''::jsonb)', t.v('XC')), 'OGR-EXAM-003%',
                   'notlanmış oturumu olan sınavın anahtarı (toplu) değişmez');
  perform t.raises(format('select public.set_exam_key(%L, ''B'')', t.v('QC')), 'OGR-EXAM-003%', 'notlanmış oturumu olan sınavın anahtarı (tek) değişmez');
  perform t.as_admin();
  perform t.ok(exists (select 1 from audit.events e where e.action = 'answer_key.peek' and e.row_id = t.v('QC')), 'peek denetim izinde');
  perform t.ok((select es.score ->> 'correct' = '0' from public.exam_sessions es where es.id = t.u('SC'))
               and (select k.correct_option = 'A' from secure.exam_answer_keys k where k.exam_question_id = t.u('QC')),
               'skor ve anahtar notlamadaki gibi');
end $$;

-- yüklenen deneme öğrenciye özeldir: okuma bağlı eğitmen, yazma owner eğitmen
do $$
declare
  v_up uuid := gen_random_uuid();
  v_r jsonb;
begin
  insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime)
  values (v_up, t.u('elif'), t.u('A'), 'photo', t.v('elif') || '/' || v_up::text || '.jpg', 'image/jpeg');
  insert into t.cfg values ('UP', v_up::text);
  perform t.as_user(t.u('elif'));
  v_r := public.submit_exam_upload(array[v_up], jsonb_build_object('title', 'Özel deneme', 'enrollment_id', t.v('EA')));
  perform t.as_admin();
  insert into t.cfg values ('XU', v_r ->> 'exam_id'), ('SU', v_r ->> 'session_id');
  perform t.as_service();
  perform public.register_exam_questions(t.u('XU'), jsonb_build_array(
    jsonb_build_object('no', 1, 'stem_text', 'Telifli kök', 'skill_ids', jsonb_build_array('t.mat.a'), 'page_upload_id', t.v('UP'),
                       'bbox', jsonb_build_object('x', 0, 'y', 0, 'w', 1, 'h', 0.5)),
    jsonb_build_object('no', 2, 'skill_ids', jsonb_build_array('t.mat.a'))));
  perform public.set_exam_keys(t.u('XU'), '[{"no": 1, "correct_option": "A", "confidence": 0.9}, {"no": 2, "correct_option": "B", "confidence": 0.9}]', 'inferred');
  perform t.as_admin();
  insert into t.cfg select 'QU', q.id::text from public.exam_questions q where q.exam_id = t.u('XU') and q.no = 1;
  -- inst2: aynı derste yalnız Can'a bağlı viewer (Elif'e bağı yok)
  insert into public.instructor_links (instructor_id, student_id, course_id, role) values (t.u('inst2'), t.u('B'), t.u('course'), 'viewer');
  perform t.ok(not exists (select 1 from public.instructor_links il where il.instructor_id = t.u('inst2') and il.student_id = t.u('A')),
               'inst2 Elif''e bağlı değil');

  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.set_exam_keys(%L, ''[{"no": 1, "correct_option": "C"}]''::jsonb)', t.v('XU')), 'OGR-AUTH-002%',
                   'başka öğrenciye bağlı viewer eğitmen yüklenen denemenin anahtarını yazamaz');
  perform t.raises(format('select public.set_exam_key(%L, ''C'')', t.v('QU')), 'OGR-AUTH-002%',
                   'başka öğrenciye bağlı viewer eğitmen tek anahtar da yazamaz');
  perform t.raises(format('select public.register_exam_questions(%L, ''[{"no": 1}]''::jsonb)', t.v('XU')), 'OGR-AUTH-002%',
                   'başka öğrenciye bağlı viewer eğitmen soruları silemez/yazamaz');
  perform t.ok(t.n(format('select 1 from public.exams where id = %L', t.v('XU'))) = 0
               and t.n(format('select 1 from public.exam_questions where exam_id = %L', t.v('XU'))) = 0
               and t.n(format('select 1 from public.v_exam_questions_student where exam_id = %L', t.v('XU'))) = 0,
               'bağsız eğitmen yüklenen denemenin satırını, sorularını, kırpımlarını görmez');
  perform t.raises(format('select public.peek_answer_key(%L)', t.v('QU')), 'OGR-AUTH-002%', 'bağsız eğitmen yüklenen denemenin anahtarını göremez');
  perform t.ok(t.n(format('select 1 from public.exams where id = %L', t.v('XC'))) = 1
               and t.n(format('select 1 from public.exam_questions where exam_id = %L', t.v('XC'))) = 1,
               'eğitmenin yayımlanmış sınav görünürlüğü değişmedi');
  perform t.as_admin();
  perform t.ok((select count(*) from public.exam_questions q where q.exam_id = t.u('XU')) = 2
               and (select k.correct_option = 'A' from secure.exam_answer_keys k where k.exam_question_id = t.u('QU')),
               'reddedilen çağrılar soruları ve anahtarı değiştirmedi');

  foreach v_up in array array[t.u('can'), t.u('deniz'), t.u('parent2')] loop
    perform t.ok(t.sees(v_up, format('select 1 from public.exams where id = %L', t.v('XU'))) = 0
                 and t.sees(v_up, format('select 1 from public.v_exam_questions_student where exam_id = %L', t.v('XU'))) = 0,
                 'başka öğrenci/veli yüklenen denemeyi görmez (' || v_up::text || ')');
  end loop;
  perform t.ok(t.sees(t.u('parent'), format('select 1 from public.exams where id = %L', t.v('XU'))) = 1
               and t.sees(t.u('parent'), format('select 1 from public.v_exam_questions_student where exam_id = %L', t.v('XU'))) = 0,
               'veli çocuğunun denemesinin başlığını görür, sorularını görmez');
  perform t.ok(t.sees(t.u('elif'), format('select 1 from public.v_exam_questions_student where exam_id = %L and stem_text is null and bbox is not null', t.v('XU'))) = 1,
               'öğrenci kendi kırpıntısını görür, telifli metni görmez');

  -- owner eğitmen okur ve (notlamadan önce) yazar
  perform t.as_user(t.u('inst'));
  perform t.ok(t.n(format('select 1 from public.exams where id = %L', t.v('XU'))) = 1
               and t.n(format('select 1 from public.exam_questions where exam_id = %L', t.v('XU'))) = 2, 'owner eğitmen yüklenen denemeyi görür');
  v_r := public.set_exam_keys(t.u('XU'), '[{"no": 1, "correct_option": "B"}]');
  perform t.ok(v_r ->> 'answer_key_source' = 'mixed', 'owner eğitmen anahtarı düzeltir (kaynak mixed)');
  perform t.ok(public.peek_answer_key(t.u('QU')) ->> 'correct_option' = 'B', 'owner eğitmen anahtarı görür');

  -- Elif'e bağlı viewer: okur, yazamaz
  perform t.as_admin();
  insert into public.instructor_links (instructor_id, student_id, role) values (t.u('inst2'), t.u('A'), 'viewer');
  perform t.as_user(t.u('inst2'));
  perform t.ok(t.n(format('select 1 from public.exams where id = %L', t.v('XU'))) = 1
               and t.n(format('select 1 from public.exam_questions where exam_id = %L', t.v('XU'))) = 2, 'öğrenciye bağlı viewer eğitmen denemeyi görür');
  perform t.raises(format('select public.set_exam_keys(%L, ''[{"no": 1, "correct_option": "C"}]''::jsonb)', t.v('XU')), 'OGR-AUTH-002%',
                   'viewer eğitmen yüklenen denemenin anahtarını yazamaz (owner gerekir)');
  perform t.as_admin();
end $$;

rollback;
