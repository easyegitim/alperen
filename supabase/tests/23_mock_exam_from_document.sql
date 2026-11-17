-- tests/23_mock_exam_from_document.sql — belgeden uygulama içi deneme (0035 mock_exam_from_document): yalnız worker
-- (authenticated'a hiç verilmez), AST soruları → exams(practice, generated, telifsiz) + exam_questions (şıklı/sayısal,
-- satır içi SVG şekli; betikli SVG reddi) + anahtarlar secure.exam_answer_keys'te (öğrenci okuyamaz, dönüşte değer yok),
-- anahtar ↔ soru birebir, belge yayımlanana dek sınav taslak (başlatılamaz), yayında ready + kartta exam_id + Belgelerim'de
-- "Çöz", öğrenci çözer ve sunucu anahtarla notlar, başka öğrenci başlatamaz, oturumdan sonra yeniden kurulamaz.
begin;
\ir _fixture.sql

do $$
declare
  v_r jsonb;
  v_doc uuid;
begin
  perform t.add_outsiders();
  perform t.as_user(t.u('elif'));
  v_r := public.request_document('mock_exam', '{"question_count": 5, "duration_min": 15}');
  perform t.as_admin();
  v_doc := (v_r -> 'document' ->> 'id')::uuid;
  insert into t.cfg values ('D', v_doc::text), ('R', v_r ->> 'request_id');
  perform t.as_service();
  perform public.document_set_status(v_doc, 'generating');
  perform public.register_generated_document(jsonb_build_object(
    'id', v_doc, 'pdf_path', 'mock/' || t.v('A') || '/' || v_doc || '.pdf',
    'content', jsonb_build_object(
      'kind', 'mock_exam', 'title', '5 soruluk deneme',
      'meta', jsonb_build_object('course_title', 'Test Matematik', 'subtitle', null, 'generated_on', '2026-11-04', 'language', 'tr',
                                 'personalized', true, 'duration_min', 15),
      'sections', '[{"no": 1, "title": "Temel işlemler"}, {"no": 2, "title": "İşaretler"}]'::jsonb,
      'blocks', jsonb_build_array(
        jsonb_build_object('type', 'heading', 'id', 'h1', 'section_no', 1, 'level', 1, 'text', 'Temel işlemler'),
        jsonb_build_object('type', 'question', 'id', 'q1', 'section_no', 1, 'no', 1, 'stem', '$2+3\cdot4$ kaçtır?',
                           'options', '[{"key": "A", "text": "14"}, {"key": "B", "text": "20"}, {"key": "C", "text": "24"}, {"key": "D", "text": "9"}]'::jsonb,
                           'skill_ids', '["t.mat.a"]'::jsonb,
                           'figure', jsonb_build_object('source', 'svg', 'svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
                                                        'alt', 'Kenarı 10 birim olan kare')),
        jsonb_build_object('type', 'question', 'id', 'q2', 'section_no', 2, 'no', 2, 'stem', '$-(3-5)$ kaçtır?',
                           'options', '[{"key": "A", "text": "-2"}, {"key": "B", "text": "2"}, {"key": "C", "text": "8"}, {"key": "D", "text": "-8"}]'::jsonb,
                           'skill_ids', '["t.mat.b"]'::jsonb),
        jsonb_build_object('type', 'question', 'id', 'q3', 'section_no', 2, 'no', 3, 'stem', '$7/8$ ondalık olarak nedir?',
                           'options', '[]'::jsonb, 'skill_ids', '["t.mat.a"]'::jsonb),
        jsonb_build_object('type', 'answer_sheet', 'id', 'as', 'section_no', 2, 'title', 'Cevap kâğıdı', 'question_count', 3, 'options_per_question', 4)),
      'keys', '[]'::jsonb)));
  perform t.as_admin();
  insert into t.cfg values ('K', '[{"question_no": 1, "correct_option": "A", "numeric_value": null, "canonical_expr": "14"},
                                  {"question_no": 2, "correct_option": "B", "numeric_value": null, "canonical_expr": "2"},
                                  {"question_no": 3, "correct_option": null, "numeric_value": 0.875, "canonical_expr": "7/8"}]');
end $$;

-- yetki ve doğrulama
do $$
declare
  v_k jsonb := t.v('K')::jsonb;
  v_notes uuid;
  v_svg text;
begin
  perform t.ok(not has_function_privilege('authenticated', 'public.mock_exam_from_document(uuid, jsonb)', 'execute')
               and not has_function_privilege('anon', 'public.mock_exam_from_document(uuid, jsonb)', 'execute')
               and has_function_privilege('service_role', 'public.mock_exam_from_document(uuid, jsonb)', 'execute'),
               'mock_exam_from_document yalnız service_role (ve doğrudan bağlantı)');
  foreach v_notes in array array[t.u('elif'), t.u('inst'), t.u('parent')] loop
    perform t.as_user(v_notes);
    perform t.raises(format('select public.mock_exam_from_document(%L, %L::jsonb)', t.v('D'), v_k), '42501', 'kullanıcı JWT''si çağıramaz');
  end loop;
  perform t.as_service();
  perform t.raises(format('select public.mock_exam_from_document(%L, %L::jsonb)', t.v('D'), v_k - 2), 'OGR-DOC-008%soru 3%', 'eksik anahtar');
  perform t.raises(format('select public.mock_exam_from_document(%L, %L::jsonb)', t.v('D'),
                          v_k || '[{"question_no": 9, "correct_option": "A", "numeric_value": null}]'::jsonb), 'OGR-DOC-008%', 'fazla anahtar');
  perform t.raises(format('select public.mock_exam_from_document(%L, %L::jsonb)', t.v('D'),
                          jsonb_set(v_k, '{0,correct_option}', '"E"')), 'OGR-DOC-008%soru 1%', 'doğru şık seçeneklerde yok');
  perform t.raises(format('select public.mock_exam_from_document(%L, %L::jsonb)', t.v('D'),
                          jsonb_set(jsonb_set(v_k, '{2,numeric_value}', 'null'), '{2,correct_option}', '"A"')), 'OGR-DOC-008%soru 3%',
                   'şıksız soruda sayısal anahtar gerekli');
  perform t.raises(format('select public.mock_exam_from_document(%L, ''{}''::jsonb)', t.v('D')), 'OGR-DOC-008%', 'anahtar dizi olmalı');
  v_notes := public.register_generated_document(jsonb_build_object('kind', 'notes', 'title', 'Not', 'student_id', t.v('A'), 'course_id', t.v('course')));
  perform t.raises(format('select public.mock_exam_from_document(%L, %L::jsonb)', v_notes, v_k), 'OGR-DOC-001%', 'not sınava çevrilmez');
  -- betikli SVG
  update public.generated_documents gd
     set content = jsonb_set(gd.content, '{blocks,1,figure,svg}', '"<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"alert(1)\"></svg>"')
   where gd.id = t.u('D');
  perform t.raises(format('select public.mock_exam_from_document(%L, %L::jsonb)', t.v('D'), v_k), 'OGR-DOC-008%SVG%', 'olay öznitelikli SVG reddedilir');
  update public.generated_documents gd
     set content = jsonb_set(gd.content, '{blocks,1,figure,svg}', '"<svg xmlns=\"http://www.w3.org/2000/svg\"><script>x()</script></svg>"')
   where gd.id = t.u('D');
  perform t.raises(format('select public.mock_exam_from_document(%L, %L::jsonb)', t.v('D'), v_k), 'OGR-DOC-008%SVG%', 'betikli SVG reddedilir');
  -- kara liste atlatma örnekleri (eğik çizgiyle olay özniteliği, karakter başvurulu javascript:, dış image/use)
  foreach v_svg in array array[
    '<svg xmlns="http://www.w3.org/2000/svg"/onload="alert(1)"><rect width="1" height="1"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="jav&#x61;script:alert(1)"><rect width="1" height="1"/></a></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.example/s.svg#a"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/x.css);</style></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><animateTransform attributeName="transform"/></svg>'] loop
    update public.generated_documents gd set content = jsonb_set(gd.content, '{blocks,1,figure,svg}', to_jsonb(v_svg)) where gd.id = t.u('D');
    perform t.raises(format('select public.mock_exam_from_document(%L, %L::jsonb)', t.v('D'), v_k), 'OGR-DOC-008%SVG%',
                     'SVG reddedilir: ' || left(v_svg, 70));
  end loop;
  -- temiz şekil (sanitizeSvg çıktısı gibi: belge içi <use xlink:href="#…">, style özniteliği) kabul edilir
  update public.generated_documents gd
     set content = jsonb_set(gd.content, '{blocks,1,figure,svg}',
                             to_jsonb('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10">'
                                      || '<defs><path id="m1" d="M0 0L1 1"/></defs><rect width="10" height="10" style="fill: #1f77b4"/>'
                                      || '<use xlink:href="#m1" x="2" y="2"/></svg>'))
   where gd.id = t.u('D');
  -- müfredat dışı kazanım
  update public.generated_documents gd set content = jsonb_set(gd.content, '{blocks,2,skill_ids}', '["yok.kazanim"]') where gd.id = t.u('D');
  perform t.raises(format('select public.mock_exam_from_document(%L, %L::jsonb)', t.v('D'), v_k), 'OGR-CURR-001%', 'müfredat dışı kazanım');
  update public.generated_documents gd set content = jsonb_set(gd.content, '{blocks,2,skill_ids}', '["t.mat.b"]') where gd.id = t.u('D');
  perform t.as_admin();
  perform t.ok(not exists (select 1 from public.exams x where x.generated_document_id = t.u('D')), 'hatalı denemelerden sınav kalmadı');
end $$;

-- kurulum: sınav taslak, anahtar secure'da, dönüşte değer yok
do $$
declare
  v_res jsonb;
  v_exam uuid;
begin
  perform t.as_service();
  v_res := public.mock_exam_from_document(t.u('D'), t.v('K')::jsonb);
  perform t.as_admin();
  v_exam := (v_res ->> 'exam_id')::uuid;
  insert into t.cfg values ('X', v_exam::text);
  perform t.ok((v_res ->> 'question_count')::int = 3 and (v_res ->> 'keyed')::int = 3 and v_res ->> 'status' = 'draft'
               and not (v_res ->> 'reused')::boolean, 'kuruldu: 3 soru, 3 anahtar, taslak (' || v_res::text || ')');
  perform t.ok(position('correct_option' in v_res::text) = 0 and position('0.875' in v_res::text) = 0, 'dönüşte anahtar değeri yok');
  perform t.ok((select x.kind = 'practice' and x.source = 'generated' and not x.is_copyrighted and x.status = 'draft'
                       and x.title = '5 soruluk deneme' and x.course_id = t.u('course') and x.curriculum_id = t.u('cur')
                       and x.created_by = t.u('elif') and x.duration_min = 15 and x.answer_key_source = 'generated'
                       and x.sections = '[{"code": "1", "title": "Temel işlemler", "from_no": 1, "to_no": 1, "minutes": null},
                                          {"code": "2", "title": "İşaretler", "from_no": 2, "to_no": 3, "minutes": null}]'::jsonb
                  from public.exams x where x.id = v_exam), 'exams: practice, generated, telifsiz, bölümler AST''den, süre meta''dan');
  perform t.ok((select string_agg(q.no || ':' || q.kind || ':' || q.section, ',' order by q.no) from public.exam_questions q where q.exam_id = v_exam)
               = '1:mcq:1,2:mcq:2,3:numeric:2', 'sorular: şıklı → mcq, şıksız → numeric; bölüm kodu');
  perform t.ok((select q.figure_svg like '<svg%' and q.figure_alt = 'Kenarı 10 birim olan kare' and q.options -> 0 ->> 'text' = '14'
                  from public.exam_questions q where q.exam_id = v_exam and q.no = 1), 'satır içi SVG şekil ve alt metin');
  perform t.ok((select count(*) from secure.exam_answer_keys k join public.exam_questions q on q.id = k.exam_question_id
                 where q.exam_id = v_exam and k.source = 'generated') = 3
               and (select k.numeric_value = 0.875 from secure.exam_answer_keys k join public.exam_questions q on q.id = k.exam_question_id
                     where q.exam_id = v_exam and q.no = 3), 'anahtarlar secure.exam_answer_keys''te (source generated)');
  perform t.ok((select gd.content -> 'keys' = '[]'::jsonb from public.generated_documents gd where gd.id = t.u('D')), 'belge AST''sinde anahtar yok');
  -- taslak sınav başlatılamaz, görünmez (incelenmemiş üretilmiş soru sızmaz)
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.start_exam_session(%L)', v_exam), 'OGR-EXAM-003%', 'yayımlanmamış belgenin sınavı başlatılamaz');
  perform t.raises(format('select public.start_exam_session(%L, %L, ''uploaded'')', v_exam, t.v('EA')), 'OGR-EXAM-003%',
                   'taslak üretilmiş sınavda uploaded oturumu da açılamaz');
  perform t.ok(t.n(format('select 1 from public.exams where id = %L', v_exam)) = 0
               and t.n(format('select 1 from public.v_exam_questions_student where exam_id = %L', v_exam)) = 0
               and not app.exam_visible(v_exam, t.u('A')),
               'taslak üretilmiş sınav satırı ve soruları öğrenciye görünmez (oluşturan olsa da)');
  perform t.raises('select * from secure.exam_answer_keys', '42501', 'öğrenci anahtar tablosunu okuyamaz');
  perform t.raises(format('select public.peek_answer_key(%L)', (select q.id from public.exam_questions q where q.exam_id = v_exam and q.no = 1)),
                   'OGR-AUTH-002%', 'öğrenci peek_answer_key çağıramaz');
  perform t.as_admin();
  -- yeniden kurma (oturum yokken) aynı sınavı tazeler
  perform t.as_service();
  v_res := public.mock_exam_from_document(t.u('D'), t.v('K')::jsonb);
  perform t.as_admin();
  perform t.ok((v_res ->> 'exam_id')::uuid = v_exam and (v_res ->> 'reused')::boolean
               and (select count(*) from public.exam_questions q where q.exam_id = v_exam) = 3
               and (select count(*) from public.exams x where x.generated_document_id = t.u('D')) = 1, 'tekrar çağrı aynı sınavı yeniden kurar');
end $$;

-- yayın: sınav ready, kart ve Belgelerim exam_id taşır; öğrenci çözer, sunucu notlar
do $$
declare
  v_s jsonb;
  v_st jsonb;
  v_v jsonb;
  v_q record;
  v_l jsonb;
begin
  perform t.as_service();
  v_s := public.document_set_status(t.u('D'), 'ready', '{"verification": {"schema": {"status": "pass"}, "sympy": {"status": "pass", "verified": 3},
                                                        "figures": {"status": "pass"}, "duplicates": {"status": "pass"},
                                                        "personalization": {"status": "skipped"}}}');
  perform t.as_admin();
  perform t.ok(v_s ->> 'status' = 'ready' and (select x.status = 'ready' from public.exams x where x.id = t.u('X')), 'yayında sınav ready');
  perform t.ok((select s.title = 'Denemen hazır' and s.subtitle = 'PDF · aç, indir ya da çöz' and s.payload ->> 'exam_id' = t.v('X')
                  from public.suggestions s where s.student_id = t.u('A') and s.kind = 'document_ready' and s.payload ->> 'document_id' = t.v('D')),
               'Bugün kartı: Denemen hazır, exam_id ile');
  perform t.as_user(t.u('elif'));
  v_l := public.list_my_documents('mock_exam');
  perform t.ok((select d.e ->> 'exam_id' = t.v('X') and d.e ->> 'request_status' = 'ready' from jsonb_array_elements(v_l -> 'documents') as d (e)
                 where d.e ->> 'id' = t.v('D')), 'Belgelerim: Çöz için exam_id');
  perform t.ok(public.document_request_view(t.u('R')) ->> 'exam_id' = t.v('X'), 'istek görünümü exam_id taşır');
  -- başka öğrenci başlatamaz
  perform t.as_user(t.u('can'));
  perform t.raises(format('select public.start_exam_session(%L)', t.v('X')), 'OGR-AUTH-001%', 'başka öğrenci kişiye üretilmiş denemeyi başlatamaz');
  perform t.as_user(t.u('parent'));
  perform t.ok(t.n(format('select 1 from public.v_exam_questions_student where exam_id = %L', t.v('X'))) = 0, 'veli soruları görmez');
  -- öğrenci çözer
  perform t.as_user(t.u('elif'));
  v_st := public.start_exam_session(t.u('X'));
  perform t.ok((v_st ->> 'question_count')::int = 3 and (v_st ->> 'duration_min')::int = 15 and position('correct_option' in v_st::text) = 0,
               'oynatıcı: 3 soru, 15 dk, anahtar yok');
  perform t.ok(t.n(format('select 1 from public.v_exam_questions_student where exam_id = %L and figure_svg like ''<svg%%'' and figure_alt is not null', t.v('X'))) = 1
               and t.n(format('select 1 from public.v_exam_questions_student where exam_id = %L and stem_text is not null', t.v('X'))) = 3,
               'öğrenci görünümü: telifsiz soru metinleri ve satır içi şekil');
  for v_q in select q.id, q.no from public.v_exam_questions_student q where q.exam_id = t.u('X') loop
    perform public.record_exam_response((v_st ->> 'session_id')::uuid, v_q.id, case v_q.no when 1 then 'A' when 2 then 'A' else '7/8' end);
  end loop;
  v_v := public.finish_exam_session((v_st ->> 'session_id')::uuid);
  perform t.ok((v_v -> 'summary' ->> 'correct')::int = 2 and (v_v -> 'summary' ->> 'wrong')::int = 1 and (v_v -> 'summary' ->> 'ungraded')::int = 0,
               'sunucu anahtarla notlar: 2 doğru (şık + 7/8 = 0,875), 1 yanlış (' || (v_v -> 'summary')::text || ')');
  perform t.ok(position('correct_option' in v_v::text) = 0, 'sonuç görünümünde anahtar yok');
  perform t.as_admin();
  insert into t.cfg values ('S', v_st ->> 'session_id');
end $$;

-- oturumdan sonra yeniden kurulamaz
do $$
begin
  perform t.as_service();
  perform t.raises(format('select public.mock_exam_from_document(%L, %L::jsonb)', t.v('D'), t.v('K')), 'OGR-EXAM-003%', 'oturumu olan deneme yeniden kurulamaz');
  perform t.as_admin();
end $$;

-- ders geneli üretilmiş deneme: yalnız o dersin kayıtlı öğrencisi görür ve başlatır; aynı müfredatı paylaşan başka dersin
-- öğrencisi (Deniz) görmez ve başlatamaz (app.exam_visible; exams_select; start_exam_session)
do $$
declare
  v_course2 uuid := '30000000-0000-4000-8000-0000000000c2';
  v_doc uuid := '60000000-0000-4000-8000-0000000000d2';
  v_x uuid := '70000000-0000-4000-8000-0000000000e2';
begin
  insert into public.courses (id, code, title, kind, curriculum_id, visibility, created_by)
  values (v_course2, 'T-MAT-DENIZ', 'Test Matematik (Deniz)', 'exam_track', t.u('cur'), 'shared', t.u('inst2'));
  update public.enrollments set course_id = v_course2 where id = t.u('EC2');
  insert into public.generated_documents (id, course_id, kind, title, status, pdf_path)
  values (v_doc, t.u('course'), 'mock_exam', 'Ders geneli deneme', 'published', 'course/' || v_doc || '.pdf');
  insert into public.exams (id, course_id, curriculum_id, kind, source, title, is_copyrighted, question_count, status, generated_document_id)
  values (v_x, t.u('course'), t.u('cur'), 'practice', 'generated', 'Ders geneli deneme', false, 0, 'ready', v_doc);
  insert into t.cfg values ('XC', v_x::text);
  perform t.ok(t.sees(t.u('elif'), format('select 1 from public.exams where id = %L', v_x)) = 1
               and t.sees(t.u('deniz'), format('select 1 from public.exams where id = %L', v_x)) = 0,
               'ders geneli deneme: dersin öğrencisi görür, aynı müfredattaki başka dersin öğrencisi görmez');
  perform t.as_user(t.u('deniz'));
  perform t.raises(format('select public.start_exam_session(%L, %L)', v_x, t.u('EC2')), 'OGR-AUTH-001%',
                   'başka dersin öğrencisi ders geneli denemeyi başlatamaz');
  perform t.as_user(t.u('elif'));
  perform t.ok(public.start_exam_session(t.u('XC'), t.u('EA')) is not null, 'dersin öğrencisi ders geneli denemeyi başlatır');
  perform t.as_admin();
end $$;

rollback;
