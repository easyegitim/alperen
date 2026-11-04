-- tests/18_exams_upload.sql — P2 yüklenen deneme hattı (0030): submit_exam_upload (doğrulama, yeniden deneme, exam.analyse
-- işi), worker yazım yolu (set_exam_progress, register_exam_questions, set_exam_keys, record_exam_answers), yüklenen
-- oturumu öğrencinin notlayamaması, grade_exam_session (ÖSYM neti, test gözlemleri g = 0.2, progress), exam_session_view
-- (tek cümle, bölümler, ısı haritası, yanlış/boş listesi; veli yalnız özet), exam_how_far (diagnosis.run deneme bağlamı,
-- yeniden deneme, düşen teşhisten sonra yeniden gönderim), apply_diagnosis bağı (deneme bağlamında style_coverage ikinci kez
-- sayılmaz), exam_blank_reason (time → error_cause, ağırlık 0.5), failed ve done aşamaları (notlanmış oturumda failed
-- sonucu gizlemez), düşmüş analizden sonra aynı sayfalarla yeniden gönderim (yeni deneme), notlanmış denemenin anahtarı
-- değişmez, telifli deneme teşhisinde question_text yazılmaz, exam.report işi yalnız uygulama içi oturuma.
begin;
\ir _fixture.sql

do $$
declare
  v_k text;
begin
  foreach v_k in array array['P1', 'P2', 'P3', 'P4', 'P5', 'W1', 'W2', 'PC'] loop
    insert into t.cfg values (v_k, gen_random_uuid()::text);
  end loop;
  insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime)
  select t.u(k), t.u('elif'), t.u('A'), 'photo', t.v('elif') || '/' || t.v(k) || '.jpg', 'image/jpeg'
    from unnest(array['P1', 'P2', 'P3', 'P4', 'P5', 'W1', 'W2']) as k;
  insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime)
  values (t.u('PC'), t.u('can'), t.u('B'), 'photo', t.v('can') || '/' || t.v('PC') || '.jpg', 'image/jpeg');
  insert into public.question_styles (course_id, curriculum_id, code, name, skill_ids, status)
  values (t.u('course'), t.u('cur'), 'ST-D', 'Deneme tarzı', array['t.mat.a'], 'active') returning id::text into v_k;
  insert into t.cfg values ('style', v_k);
end $$;

-- yetki ve doğrulama
do $$
begin
  perform t.ok(not has_function_privilege('anon', 'public.submit_exam_upload(uuid[], jsonb)', 'execute')
               and has_function_privilege('authenticated', 'public.submit_exam_upload(uuid[], jsonb)', 'execute')
               and not has_function_privilege('anon', 'public.exam_session_view(uuid)', 'execute'),
               'submit_exam_upload / exam_session_view: anon çağıramaz, authenticated çağırır');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.submit_exam_upload(array[%L]::uuid[])', t.v('P1')), 'OGR-AUTH-001%', 'eğitmen deneme yükleyemez');
  perform t.as_user(t.u('elif'));
  perform t.raises('select public.submit_exam_upload(array[]::uuid[])', 'OGR-UPL-001%', 'boş küme');
  perform t.raises(format('select public.submit_exam_upload(array[%L, %L]::uuid[])', t.v('P1'), t.v('P1')), 'OGR-UPL-001%', 'yinelenen sayfa');
  perform t.raises(format('select public.submit_exam_upload(array(select gen_random_uuid() from generate_series(1, 41)))'), 'OGR-UPL-001%',
                   'en çok 40 sayfa');
  perform t.raises(format('select public.submit_exam_upload(array[%L, %L]::uuid[])', t.v('P1'), t.v('PC')), 'OGR-UPL-002%',
                   'başka öğrencinin sayfası');
  perform t.raises(format('select public.submit_exam_upload(array[%L]::uuid[], ''[1]''::jsonb)', t.v('P1')), 'OGR-EXAM-007%', 'p_meta nesne olmalı');
  perform t.raises(format('select public.submit_exam_upload(array[%L]::uuid[], ''{"held_on": "1 Kasım"}''::jsonb)', t.v('P1')),
                   'OGR-EXAM-007%', 'held_on biçimi');
  perform t.raises(format('select public.submit_exam_upload(array[%L]::uuid[], ''{"duration_min": 900}''::jsonb)', t.v('P1')),
                   'OGR-EXAM-007%', 'duration_min sınırı');
  perform t.raises(format('select public.submit_exam_upload(array[%L]::uuid[], %L::jsonb)', t.v('P1'),
                          jsonb_build_object('enrollment_id', t.v('EB'))), 'OGR-UPL-004%', 'başkasının kaydı seçilemez');
  perform t.as_admin();
  perform t.ok(not exists (select 1 from public.uploads u where u.id in (t.u('P1'), t.u('PC')) and u.status <> 'stored'), 'düşen gönderim durumu değiştirmez');
end $$;

-- başarılı gönderim + yeniden deneme
do $$
declare
  v_r jsonb;
  v_r2 jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_r := public.submit_exam_upload(array[t.u('P1'), t.u('P2'), t.u('P3')],
                                   jsonb_build_object('title', 'Kurum Denemesi 3', 'enrollment_id', t.v('EA'), 'held_on', '2026-11-01',
                                                      'publisher', 'Okul', 'kind', 'yok sayılır'));
  perform t.ok(not (v_r ->> 'reused')::boolean and v_r -> 'job_id' = 'null'::jsonb and v_r ->> 'enrollment_id' = t.v('EA')
               and v_r -> 'upload_ids' = jsonb_build_array(t.v('P1'), t.v('P2'), t.v('P3')),
               'gönderim: yeni deneme, pgboss yokken job_id null (' || v_r::text || ')');
  v_r2 := public.submit_exam_upload(array[t.u('P3'), t.u('P1'), t.u('P2')]);
  perform t.ok((v_r2 ->> 'reused')::boolean and v_r2 ->> 'exam_id' = v_r ->> 'exam_id' and v_r2 ->> 'session_id' = v_r ->> 'session_id',
               'aynı küme (sırasız) yeniden gönderilince aynı deneme döner');
  perform t.raises(format('select public.submit_exam_upload(array[%L]::uuid[])', t.v('P1')), 'OGR-UPL-003%', 'alt küme reddedilir');
  perform t.raises(format('select public.submit_upload(array[%L]::uuid[], ''own_work'')', t.v('P2')), 'OGR-UPL-003%',
                   'denemenin sayfası Kendi çalışmam olarak gönderilemez');
  perform t.as_admin();
  insert into t.cfg values ('X', v_r ->> 'exam_id'), ('S', v_r ->> 'session_id');
  perform t.ok((select x.kind = 'deneme' and x.source = 'uploaded' and x.is_copyrighted and x.status = 'processing' and x.created_by = t.u('elif')
                       and x.title = 'Kurum Denemesi 3' and x.publisher = 'Okul' and x.held_on = date '2026-11-01'
                       and x.curriculum_id = t.u('cur') and x.course_id = t.u('course') and x.answer_key_source is null
                  from public.exams x where x.id = t.u('X')), 'exams: deneme, uploaded, telifli, processing, meta yazıldı');
  perform t.ok((select es.mode = 'uploaded' and es.status = 'grading' and es.enrollment_id = t.u('EA')
                       and es.upload_ids = array[t.u('P1'), t.u('P2'), t.u('P3')]
                       and es.progress ->> 'stage' = 'classify' and (es.progress ->> 'pages_total')::int = 3
                  from public.exam_sessions es where es.id = t.u('S')), 'exam_sessions: uploaded, grading, sayfalar, progress classify');
  perform t.ok((select count(*) from public.uploads u where u.id in (t.u('P1'), t.u('P2'), t.u('P3')) and u.status = 'processing') = 3,
               'sayfalar processing');
  perform t.ok((select count(*) from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'exam.analyse') = 1
               and exists (select 1 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'exam.analyse'
                            and e.diff -> 'data' ->> 'session_id' = t.v('S') and e.diff -> 'data' ->> 'exam_id' = t.v('X')
                            and e.diff -> 'data' ->> 'student_id' = t.v('A') and e.diff -> 'data' ->> 'enrollment_id' = t.v('EA')
                            and jsonb_array_length(e.diff -> 'data' -> 'upload_ids') = 3),
               'exam.analyse işi bir kez {session_id, exam_id, enrollment_id, student_id, upload_ids} ile denendi');
  perform t.as_user(t.u('elif'));
  v_r := public.submit_exam_upload(array[t.u('P4')]);
  perform t.as_admin();
  insert into t.cfg values ('S2', v_r ->> 'session_id'), ('X2', v_r ->> 'exam_id');
  perform t.ok((select x.title like 'Okul denemesi · %' and x.duration_min is null from public.exams x where x.id = t.u('X2')),
               'başlık verilmezse "Okul denemesi · <gün> <ay>"');
end $$;

-- öğrenci bekleyen denemeyi görür ama notlayamaz; worker yolu öğrenciye kapalı
do $$
declare
  v_v jsonb;
begin
  perform t.as_user(t.u('elif'));
  perform t.ok(t.n(format('select 1 from public.exams where id = %L', t.v('X'))) = 1
               and t.n(format('select 1 from public.exam_sessions where id = %L', t.v('S'))) = 1, 'öğrenci kendi deneme ve oturumunu görür');
  v_v := public.exam_session_view(t.u('S'));
  perform t.ok((v_v ->> 'pending')::boolean and v_v -> 'summary' = 'null'::jsonb and v_v -> 'progress' ->> 'stage' = 'classify'
               and jsonb_array_length(v_v -> 'items') = 0 and jsonb_array_length(v_v -> 'pages') = 3,
               'bekleyen görünüm: pending, özet yok, aşama classify, sayfalar');
  perform t.raises(format('select public.grade_exam_session(%L)', t.v('S')), 'OGR-AUTH-003%', 'öğrenci yüklenen denemeyi notlayamaz');
  perform t.raises(format('select public.set_exam_progress(%L, ''ocr'')', t.v('S')), 'OGR-AUTH-002%', 'öğrenci ilerleme yazamaz');
  perform t.raises(format('select public.record_exam_answers(%L, ''[]''::jsonb)', t.v('S')), 'OGR-AUTH-002%', 'öğrenci optik cevap yazamaz');
  perform t.raises(format('select public.register_exam_questions(%L, ''[{"no": 1}]''::jsonb)', t.v('X')), 'OGR-AUTH-002%',
                   'öğrenci soru yazamaz (kendi yüklediği denemede de)');
  perform t.raises(format('select public.set_exam_keys(%L, ''[{"no": 1, "correct_option": "A"}]''::jsonb)', t.v('X')), 'OGR-AUTH-002%',
                   'öğrenci anahtar yazamaz');
  perform t.raises(format('select public.record_exam_response(%L, gen_random_uuid(), ''A'')', t.v('S')), 'OGR-EXAM-004%',
                   'yabancı soru reddedilir');
  perform t.as_user(t.u('can'));
  perform t.raises(format('select public.exam_session_view(%L)', t.v('S')), 'OGR-AUTH-001%', 'başka öğrenci görünümü açamaz');
  perform t.as_admin();
end $$;

-- worker: ilerleme, sorular, anahtar, optik cevaplar, notlama
do $$
declare
  v_items jsonb;
  v_r jsonb;
  v_score jsonb;
begin
  perform t.as_service();
  v_r := public.set_exam_progress(t.u('S'), 'ocr', '{"pages_done": 2, "pages_total": 3}');
  perform t.ok(v_r ->> 'stage' = 'ocr' and (v_r ->> 'pages_done')::int = 2 and (v_r ->> 'pages_total')::int = 3, 'set_exam_progress: aşama + sayaç birleşir');
  perform t.raises(format('select public.set_exam_progress(%L, ''bogus'')', t.v('S')), 'OGR-EXAM-007%', 'geçersiz aşama');
  perform t.raises(format('select public.set_exam_progress(%L, ''ocr'', ''{"x": [1]}''::jsonb)', t.v('S')), 'OGR-EXAM-007%', 'iç içe sayaç');

  v_items := jsonb_build_array(
    jsonb_build_object('no', 1, 'section', 'Mat', 'kind', 'mcq', 'stem_text', 'Telifli kök 1', 'skill_ids', jsonb_build_array('t.mat.a'),
                       'options', jsonb_build_array(jsonb_build_object('key', 'A', 'text', 'bir'), jsonb_build_object('key', 'B', 'text', 'iki')),
                       'page_upload_id', t.v('P1'), 'bbox', jsonb_build_object('x', 0.05, 'y', 0.1, 'w', 0.9, 'h', 0.3)),
    jsonb_build_object('no', 2, 'section', 'Mat', 'stem_text', 'Telifli kök 2', 'skill_ids', jsonb_build_array('t.mat.a'),
                       'page_upload_id', t.v('P1'), 'bbox', jsonb_build_object('x', 0.05, 'y', 0.5, 'w', 0.9, 'h', 0.3)),
    jsonb_build_object('no', 3, 'section', 'Mat', 'skill_ids', jsonb_build_array('t.mat.b'), 'page_upload_id', t.v('P2')),
    jsonb_build_object('no', 4, 'section', 'Mat', 'kind', 'numeric', 'skill_ids', jsonb_build_array('t.mat.b'), 'page_upload_id', t.v('P2')),
    jsonb_build_object('no', 5, 'section', 'Fen', 'skill_ids', jsonb_build_array('t.mat.b'), 'page_upload_id', t.v('P3')),
    jsonb_build_object('no', 6, 'section', 'Fen', 'skill_ids', jsonb_build_array('t.mat.a'), 'page_upload_id', t.v('P3')),
    jsonb_build_object('no', 7, 'section', 'Fen', 'skill_ids', jsonb_build_array('t.mat.a')));
  perform t.raises(format('select public.register_exam_questions(%L, %L::jsonb)', t.v('X'),
                          jsonb_build_array(jsonb_build_object('no', 1, 'page_upload_id', t.v('P1'), 'bbox', jsonb_build_object('x', 0.5, 'y', 0, 'w', 0.6, 'h', 0.2)))),
                   'OGR-EXAM-007%', 'sayfa dışına taşan kırpım kutusu');
  perform t.raises(format('select public.register_exam_questions(%L, %L::jsonb)', t.v('X'),
                          jsonb_build_array(jsonb_build_object('no', 1, 'bbox', jsonb_build_object('x', 0, 'y', 0, 'w', 0.5, 'h', 0.2)))),
                   'OGR-EXAM-007%', 'kırpım kutusu sayfa ister');
  perform t.raises(format('select public.register_exam_questions(%L, %L::jsonb)', t.v('X'),
                          jsonb_build_array(jsonb_build_object('no', 1, 'page_upload_id', t.v('PC')))), 'OGR-EXAM-006%', 'başka öğrencinin sayfası');
  perform t.raises(format('select public.register_exam_questions(%L, %L::jsonb)', t.v('X'),
                          jsonb_build_array(jsonb_build_object('no', 1, 'skill_ids', jsonb_build_array('t.mat')))), 'OGR-EXAM-007%', 'yaprak olmayan kazanım');
  perform t.raises(format('select public.register_exam_questions(%L, ''[{"no": 1}, {"no": 1}]''::jsonb)', t.v('X')), 'OGR-EXAM-007%', 'yinelenen numara');
  perform t.raises(format('select public.register_exam_questions(%L, ''[{"no": 1, "kind": "numeric", "options": [{"key": "A", "text": "x"}]}]''::jsonb)', t.v('X')),
                   'OGR-EXAM-007%', 'mcq dışı soruda şık olmaz');
  v_r := public.register_exam_questions(t.u('X'), v_items);
  perform t.ok((v_r ->> 'question_count')::int = 7 and jsonb_array_length(v_r -> 'questions') = 7, 'register_exam_questions: 7 soru');
  v_r := public.register_exam_questions(t.u('X'), v_items - 6);
  perform t.ok((v_r ->> 'question_count')::int = 6 and (select x.question_count from public.exams x where x.id = t.u('X')) = 6
               and not exists (select 1 from public.exam_questions q where q.exam_id = t.u('X') and q.no = 7),
               'tam küme: listede olmayan soru silinir, question_count 6');
  perform t.ok((select x.sections = '[{"code": "Mat", "title": "Mat", "from_no": 1, "to_no": 4}, {"code": "Fen", "title": "Fen", "from_no": 5, "to_no": 6}]'::jsonb
                  from public.exams x where x.id = t.u('X')), 'bölümler soru kodlarından kuruldu');
  perform t.ok((select q.page_upload_id = t.u('P1') and q.bbox = '{"x": 0.05, "y": 0.1, "w": 0.9, "h": 0.3}'::jsonb and q.kind = 'mcq'
                  from public.exam_questions q where q.exam_id = t.u('X') and q.no = 1), 'sayfa ve kırpım kutusu yazıldı');
  perform t.as_admin();
  insert into t.cfg select 'Q' || q.no, q.id::text from public.exam_questions q where q.exam_id = t.u('X');
  perform t.as_service();

  perform t.raises(format('select public.set_exam_keys(%L, ''[{"no": 9, "correct_option": "A"}]''::jsonb, ''inferred'')', t.v('X')),
                   'OGR-EXAM-004%', 'olmayan soruya anahtar');
  perform t.raises(format('select public.set_exam_keys(%L, ''[{"no": 4, "correct_option": "A"}]''::jsonb, ''inferred'')', t.v('X')),
                   'OGR-EXAM-005%', 'sayısal soruya şık anahtarı');
  v_r := public.set_exam_keys(t.u('X'), '[{"question_no": 1, "correct_option": "A", "confidence": 0.95, "solution_summary": "x"},
                                          {"no": 2, "correct_option": "c", "confidence": 0.9}, {"no": 3, "correct_option": "D", "confidence": 0.9},
                                          {"no": 4, "numeric_value": 0.5, "confidence": 0.99}, {"no": 5, "correct_option": "C", "confidence": 0.9},
                                          {"no": 6, "correct_option": "E", "confidence": 0.5}]', 'inferred');
  perform t.ok((v_r ->> 'written')::int = 6 and (v_r ->> 'keyed')::int = 6 and v_r -> 'missing_nos' = '[]'::jsonb
               and v_r ->> 'answer_key_source' = 'inferred' and (v_r ->> 'unverified')::int = 1 and position('"A"' in v_r::text) = 0,
               'set_exam_keys: 6 anahtar, kaynak inferred, 1 doğrulanmamış, değer dönmez (' || v_r::text || ')');
  perform t.ok((select x.answer_key_source = 'inferred' from public.exams x where x.id = t.u('X'))
               and exists (select 1 from audit.events e where e.action = 'exam_keys.set' and e.row_id = t.v('X')
                            and position('correct_option' in e.diff::text) = 0), 'exams.answer_key_source; denetim izinde değer yok');

  v_r := public.record_exam_answers(t.u('S'), '[{"no": 1, "answer": "a"}, {"no": 2, "answer": "B"}, {"no": 3, "answer": null},
                                                {"no": 4, "answer": "1/2"}, {"question_no": 5, "answer": "C"}]');
  perform t.ok((v_r ->> 'written')::int = 5 and v_r -> 'missing_nos' = '[6]'::jsonb, 'record_exam_answers: 5 cevap, 6. soru eksik');
  perform t.raises(format('select public.record_exam_answers(%L, ''[{"no": 8, "answer": "A"}]''::jsonb)', t.v('S')), 'OGR-EXAM-004%', 'olmayan soru');
  v_score := public.grade_exam_session(t.u('S'));
  perform t.as_admin();
  insert into t.cfg values ('score', v_score::text);
  perform t.ok((v_score ->> 'correct')::int = 3 and (v_score ->> 'wrong')::int = 1 and (v_score ->> 'blank')::int = 1
               and (v_score ->> 'unfinished')::int = 1 and (v_score ->> 'net')::numeric = 2.75 and (v_score ->> 'unverified_keys')::int = 1,
               'notlama: 3 doğru, 1 yanlış, 1 boş, 1 yetişmedi; net 3 − 1/4 = 2,75 (' || (v_score - 'sections')::text || ')');
  perform t.raises(format('select public.record_exam_answers(%L, ''[]''::jsonb)', t.v('S')), 'OGR-EXAM-003%', 'notlanmış oturuma optik cevap yazılmaz');
  perform t.raises(format('select public.register_exam_questions(%L, ''[{"no": 1}]''::jsonb)', t.v('X')), 'OGR-EXAM-003%',
                   'notlanmış denemenin soruları değişmez');
  perform t.raises(format('select public.set_exam_keys(%L, ''[{"no": 1, "correct_option": "D"}]''::jsonb, ''inferred'')', t.v('X')), 'OGR-EXAM-003%',
                   'notlanmış denemenin anahtarı (toplu) değişmez');
  perform t.raises(format('select public.set_exam_key(%L, ''D'', null, ''inferred'', 0.9)', t.v('Q1')), 'OGR-EXAM-003%',
                   'notlanmış denemenin anahtarı (tek) değişmez');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.set_exam_keys(%L, ''[{"no": 1, "correct_option": "D"}]''::jsonb)', t.v('X')), 'OGR-EXAM-003%',
                   'owner eğitmen de notlanmış denemenin anahtarını değiştiremez');
  perform t.as_admin();
  perform t.ok((select k.correct_option = 'A' and k.source = 'inferred' from secure.exam_answer_keys k where k.exam_question_id = t.u('Q1')),
               'anahtar notlamadaki gibi kaldı');
end $$;

do $$
begin
  perform t.ok((select es.status = 'analysing' and es.progress ->> 'stage' = 'analyse' and (es.progress ->> 'questions')::int = 6
                       and (es.progress ->> 'wrong_blank')::int = 3 and (es.progress ->> 'pages_done')::int = 2 and es.finished_at is not null
                  from public.exam_sessions es where es.id = t.u('S')), 'oturum analysing, progress analyse (sayaçlar korunur)');
  perform t.ok((select x.status = 'ready' from public.exams x where x.id = t.u('X'))
               and (select count(*) from public.uploads u where u.id in (t.u('P1'), t.u('P2'), t.u('P3')) and u.status = 'ready') = 3,
               'deneme ready, sayfalar ready');
  perform t.ok((select count(*) from public.observations o join public.exam_responses r on r.id::text = o.source_id
                 where r.session_id = t.u('S') and o.source_type = 'exam_response' and o.kind = 'test' and o.guess_override = 0.2) = 5,
               '5 test gözlemi (g = 0.2; yetişmeyen soru gözlemsiz)');
  perform t.ok(not exists (select 1 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'exam.report'),
               'yüklenen oturum için exam.report işi atılmaz (raporu exam.analyse yazar)');
  insert into t.cfg select 'R' || q.no, r.id::text from public.exam_responses r join public.exam_questions q on q.id = r.exam_question_id
   where r.session_id = t.u('S');
end $$;

-- sonuç görünümü: öğrenci, eğitmen, veli
do $$
declare
  v_v jsonb;
  v_h jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_v := public.exam_session_view(t.u('S'));
  perform t.as_admin();
  perform t.ok(not (v_v ->> 'pending')::boolean and v_v ->> 'status' = 'analysing' and (v_v ->> 'is_copyrighted')::boolean
               and v_v ->> 'answer_key_source' = 'inferred' and v_v ->> 'title' = 'Kurum Denemesi 3', 'görünüm başlığı ve durumu');
  perform t.ok(v_v -> 'summary' ->> 'one_line' = 'Net 2,75 (anahtar doğrulanmadı); en çok zorlandığın konu: İşlem önceliği.',
               'tek cümle sonuç (' || coalesce(v_v -> 'summary' ->> 'one_line', '-') || ')');
  perform t.ok(v_v -> 'summary' ->> 'counts_line' = '6 soruda 3 doğru, 1 yanlış, 2 boş.',
               'sayılar Detay satırında (' || coalesce(v_v -> 'summary' ->> 'counts_line', '-') || ')');
  perform t.ok(v_v -> 'summary' -> 'weakest' ->> 'skill_id' = 't.mat.a' and (v_v -> 'summary' ->> 'unverified_keys')::int = 1
               and (v_v -> 'summary' ->> 'net')::numeric = 2.75, 'özet: en zayıf kazanım, doğrulanmamış anahtar');
  perform t.ok(v_v -> 'sections' = '[{"net": 1.75, "blank": 1, "title": "Mat", "total": 4, "wrong": 1, "correct": 2, "section": "Mat", "unfinished": 0},
                                     {"net": 1, "blank": 0, "title": "Fen", "total": 2, "wrong": 0, "correct": 1, "section": "Fen", "unfinished": 1}]'::jsonb,
               'bölüm netleri (' || (v_v -> 'sections')::text || ')');
  select h.e into v_h from jsonb_array_elements(v_v -> 'heatmap') as h (e) where h.e ->> 'skill_id' = 't.mat.a';
  perform t.ok((v_h ->> 'total')::int = 3 and (v_h ->> 'correct')::int = 1 and (v_h ->> 'wrong')::int = 1 and (v_h ->> 'blank')::int = 1
               and v_h ->> 'band' = 'low' and v_h ->> 'name' = 'İşlem önceliği', 'ısı haritası t.mat.a: 1/3 → low');
  perform t.ok((select h.e ->> 'band' = 'mid' from jsonb_array_elements(v_v -> 'heatmap') as h (e) where h.e ->> 'skill_id' = 't.mat.b'),
               'ısı haritası t.mat.b: 2/3 → mid');
  perform t.ok(jsonb_array_length(v_v -> 'items') = 3
               and (select string_agg((i.e ->> 'no') || ':' || (i.e ->> 'outcome') || ':' || (i.e ->> 'state'), ',' order by (i.e ->> 'no')::int)
                      from jsonb_array_elements(v_v -> 'items') as i (e)) = '2:wrong:needs_input,3:blank:needs_input,6:unfinished:needs_input',
               'yanlış/boş listesi: 2 yanlış, 3 boş, 6 yetişmedi');
  perform t.ok((select i.e -> 'stem_text' = 'null'::jsonb and i.e ->> 'page_upload_id' = t.v('P1') and i.e -> 'bbox' ->> 'y' = '0.5'
                  from jsonb_array_elements(v_v -> 'items') as i (e) where i.e ->> 'no' = '2'),
               'telifli: soru metni yok, kendi kırpıntısı (sayfa + kutu) var');
  perform t.ok(position('correct_option' in v_v::text) = 0 and position('numeric_value' in v_v::text) = 0, 'görünümde anahtar alanı yok');

  perform t.as_user(t.u('inst'));
  perform t.ok(jsonb_array_length(public.exam_session_view(t.u('S')) -> 'items') = 3, 'owner eğitmen soru listesini görür');
  perform t.as_user(t.u('parent'));
  v_v := public.exam_session_view(t.u('S'));
  perform t.as_admin();
  perform t.ok((v_v ->> 'items_hidden')::boolean and jsonb_array_length(v_v -> 'items') = 0 and jsonb_array_length(v_v -> 'pages') = 0
               and v_v -> 'summary' ->> 'one_line' is not null and jsonb_array_length(v_v -> 'sections') = 2,
               'veli: özet + bölümler, soru listesi ve sayfalar yok');
  perform t.ok(v_v -> 'summary' ->> 'one_line' = 'Net 2,75 (anahtar doğrulanmadı); en çok zorlandığı konu: İşlem önceliği.',
               'veliye tek cümle üçüncü kişiyle (' || coalesce(v_v -> 'summary' ->> 'one_line', '-') || ')');
end $$;

-- "Nereye kadar geldim?"
do $$
declare
  v_r jsonb;
  v_r2 jsonb;
  v_sa uuid;
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.exam_how_far(%L, ''x'')', t.v('R1')), 'OGR-EXAM-007%', 'doğru soru için nereye-kadar yok');
  perform t.raises(format('select public.exam_how_far(%L, ''  '')', t.v('R2')), 'OGR-EXAM-007%', 'boş girdi');
  perform t.raises(format('select public.exam_how_far(%L, null, array[%L]::uuid[])', t.v('R2'), t.v('PC')), 'OGR-EXAM-006%', 'başkasının fotoğrafı');
  perform t.raises(format('select public.exam_how_far(%L, null, array[%L]::uuid[])', t.v('R2'), t.v('P1')), 'OGR-UPL-003%', 'işlenmiş sayfa');
  v_r := public.exam_how_far(t.u('R2'), 'Paydaları eşitledim, sonra takıldım', array[t.u('W1')]);
  v_r2 := public.exam_how_far(t.u('R2'), 'Paydaları eşitledim, sonra takıldım', array[t.u('W1')]);
  perform t.ok(not (v_r ->> 'reused')::boolean and (v_r2 ->> 'reused')::boolean and v_r ->> 'response_id' = t.v('R2'),
               'exam_how_far: ilk çağrı iş atar, aynı girdinin tekrarı reused');
  perform t.raises(format('select public.exam_how_far(%L, ''başka metin'')', t.v('R2')), 'OGR-EXAM-009%', 'bekleyen teşhis farklı girdiyle yinelenmez');
  perform t.ok(public.exam_session_view(t.u('S')) -> 'items' -> 0 ->> 'state' = 'pending', 'görünüm: teşhis bekleniyor');
  perform t.as_user(t.u('parent'));
  perform t.raises(format('select public.exam_how_far(%L, ''x'')', t.v('R3')), 'OGR-AUTH-001%', 'veli nereye-kadar yazamaz');
  perform t.as_admin();
  perform t.ok((select count(*) from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'diagnosis.run') = 1
               and exists (select 1 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'diagnosis.run'
                            and e.diff -> 'data' ->> 'context' = 'exam' and e.diff -> 'data' ->> 'exam_response_id' = t.v('R2')
                            and e.diff -> 'data' ->> 'session_id' = t.v('S') and e.diff -> 'data' ->> 'enrollment_id' = t.v('EA')
                            and (e.diff -> 'data' ->> 'question_no')::int = 2
                            and e.diff -> 'data' ->> 'how_far_text' = 'Paydaları eşitledim, sonra takıldım'
                            and e.diff -> 'data' -> 'upload_ids' = jsonb_build_array(t.v('W1'))),
               'diagnosis.run bir kez deneme bağlamıyla (context=exam, exam_response_id, question_no, how_far_text, upload_ids)');
  perform t.ok((select u.status = 'processing' from public.uploads u where u.id = t.u('W1'))
               and (select r.how_far_text = 'Paydaları eşitledim, sonra takıldım' and r.work_upload_ids = array[t.u('W1')]
                      from public.exam_responses r where r.id = t.u('R2')), 'fotoğraf processing, cevaba yazıldı');

  -- worker teşhisi yazar: deneme bağlamında gözlem ağırlığı 0, kanıt dışı; tarz notlamada sayıldı (style_coverage değişmez)
  insert into public.style_coverage (enrollment_id, style_id, seen_count, solved_count, correct_count)
  values (t.u('EA'), t.u('style'), 1, 1, 0);
  perform t.as_service();
  v_sa := public.apply_diagnosis(jsonb_build_object('enrollment_id', t.v('EA'), 'verdict', 'wrong', 'error_cause', 'procedure',
                                                    'skill_ids', jsonb_build_array('t.mat.a'), 'exam_response_id', t.v('R2'),
                                                    'style_id', t.v('style'),
                                                    'upload_ids', jsonb_build_array(t.v('W1')),
                                                    'question_text', 'Telifli kök 2', 'student_work_text', 'Paydaları eşitledim',
                                                    'analysis', jsonb_build_object('one_line', 'İkinci adımda işlem önceliğini kaçırdın.')));
  perform t.as_user(t.u('elif'));
  v_r := public.exam_session_view(t.u('S'));
  perform t.ok(v_r -> 'items' -> 0 ->> 'state' = 'diagnosed' and v_r -> 'items' -> 0 -> 'diagnosis' ->> 'one_line' = 'İkinci adımda işlem önceliğini kaçırdın.'
               and v_r -> 'items' -> 0 ->> 'solution_analysis_id' = v_sa::text, 'görünüm: teşhis bağlandı (tek cümle)');
  perform t.raises(format('select public.exam_how_far(%L, ''yeni'')', t.v('R2')), 'OGR-EXAM-009%', 'teşhis edilmiş soru yinelenmez');
  perform t.as_admin();
  perform t.ok((select bool_and(o.weight = 0 and not o.counts_for_mastery) from public.observations o
                 where o.source_type = 'solution_analysis' and o.source_id = v_sa::text), 'deneme teşhisi gözlemi ağırlık 0, kanıt dışı');
  perform t.ok((select sc.seen_count = 1 and sc.solved_count = 1 and sc.correct_count = 0 from public.style_coverage sc
                 where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('style'))
               and (select sa.style_id = t.u('style') from public.solution_analyses sa where sa.id = v_sa),
               'deneme teşhisi style_coverage''ı ikinci kez saymaz (tarz teşhiste durur)');
  perform t.ok((select sa.question_text is null and sa.student_work_text = 'Paydaları eşitledim' from public.solution_analyses sa where sa.id = v_sa),
               'telifli deneme teşhisi: question_text yazılmaz (worker gönderse de), öğrencinin çalışması kalır');
end $$;

-- düşen teşhis: worker 'diagnosis.failed' yazınca soru kilitli kalmaz, görünüm "bekliyor"da takılmaz
do $$
declare
  v_r jsonb;
  v_r2 jsonb;
  v_i jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_r := public.exam_how_far(t.u('R3'), 'İlk adımı yazdım', array[t.u('W2')]);
  perform t.ok(not (v_r ->> 'reused')::boolean, 'boş soru için teşhis işi atıldı');
  select i.e into v_i from jsonb_array_elements(public.exam_session_view(t.u('S')) -> 'items') as i (e) where i.e ->> 'no' = '3';
  perform t.ok(v_i ->> 'state' = 'pending' and not (v_i ->> 'diagnosis_failed')::boolean, 'iş sürerken pending');
  -- worker son denemede düşer (diagnosis-exam.ts): audit diagnosis.failed (row_id = cevap) + fotoğraflar failed
  perform t.as_admin();
  perform app.audit_event('diagnosis.failed', 'public.exam_responses', t.v('R3'),
                          jsonb_build_object('exam_response_id', t.v('R3'), 'session_id', t.v('S'), 'failure', 'reading'));
  update public.uploads u set status = 'failed' where u.id = t.u('W2');
  perform t.ok(app.exam_how_far_state(t.u('R3')) = 'failed' and app.exam_how_far_state(t.u('R2')) = 'open'
               and app.exam_how_far_state(t.u('R6')) = 'none', 'exam_how_far_state: failed / open / none');
  perform t.as_user(t.u('elif'));
  select i.e into v_i from jsonb_array_elements(public.exam_session_view(t.u('S')) -> 'items') as i (e) where i.e ->> 'no' = '3';
  perform t.ok(v_i ->> 'state' = 'needs_input' and (v_i ->> 'diagnosis_failed')::boolean,
               'düşen teşhis: needs_input + diagnosis_failed (öğrenci yeniden gönderir)');
  -- aynı girdi (düşen işin kendi failed fotoğrafı dahil) yeni iş atar; reused değildir
  v_r2 := public.exam_how_far(t.u('R3'), 'İlk adımı yazdım', array[t.u('W2')]);
  perform t.ok(not (v_r2 ->> 'reused')::boolean, 'düşen teşhisten sonra aynı girdi yeni iş atar');
  select i.e into v_i from jsonb_array_elements(public.exam_session_view(t.u('S')) -> 'items') as i (e) where i.e ->> 'no' = '3';
  perform t.ok(v_i ->> 'state' = 'pending' and not (v_i ->> 'diagnosis_failed')::boolean, 'yeniden gönderim: yine pending');
  perform t.ok((public.exam_how_far(t.u('R3'), 'İlk adımı yazdım', array[t.u('W2')]) ->> 'reused')::boolean,
               'yeni işin tekrarı reused');
  perform t.raises(format('select public.exam_how_far(%L, ''başka metin'')', t.v('R3')), 'OGR-EXAM-009%', 'yeni iş sürerken farklı girdi reddedilir');
  perform t.as_admin();
  perform t.ok((select count(*) from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'diagnosis.run'
                 and e.diff -> 'data' ->> 'exam_response_id' = t.v('R3')) = 2
               and (select u.status = 'processing' from public.uploads u where u.id = t.u('W2')),
               'R3 için iki diagnosis.run (ilk + yeniden); fotoğraf yeniden processing');
end $$;

-- boş bırakma nedeni
do $$
declare
  v_r jsonb;
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.exam_blank_reason(%L, ''sleep'')', t.v('R3')), 'OGR-EXAM-007%', 'geçersiz neden');
  perform t.raises(format('select public.exam_blank_reason(%L, ''time'')', t.v('R2')), 'OGR-EXAM-007%', 'yanlış soruya neden verilmez');
  v_r := public.exam_blank_reason(t.u('R3'), 'time');
  perform t.ok((v_r ->> 'changed')::boolean and (v_r ->> 'observations_marked')::int = 1, 'time: boş gözlemi işaretlendi');
  perform t.ok(not (public.exam_blank_reason(t.u('R3'), 'time') ->> 'changed')::boolean, 'aynı neden tekrar: değişiklik yok');
  perform t.raises(format('select public.exam_blank_reason(%L, ''not_started'')', t.v('R3')), 'OGR-EXAM-009%', 'neden değiştirilemez');
  v_r := public.exam_blank_reason(t.u('R6'), 'not_started');
  perform t.ok((v_r ->> 'changed')::boolean and (v_r ->> 'observations_marked')::int = 0, 'yetişmeyen soru: neden yazılır, gözlem yok');
  perform t.ok((select string_agg((i.e ->> 'no') || ':' || (i.e ->> 'state'), ',' order by (i.e ->> 'no')::int)
                  from jsonb_array_elements(public.exam_session_view(t.u('S')) -> 'items') as i (e)) = '2:diagnosed,3:reason_given,6:reason_given'
               and public.exam_session_view(t.u('S')) -> 'summary' ->> 'top_cause' in ('procedure', 'time'), 'görünüm: nedenler ve en sık hata nedeni');
  perform t.as_user(t.u('parent'));
  perform t.raises(format('select public.exam_blank_reason(%L, ''time'')', t.v('R6')), 'OGR-AUTH-001%', 'veli neden yazamaz');
  perform t.as_admin();
  perform t.ok((select o.error_cause = 'time' and o.weight = 0.5 and o.kind = 'test' and o.value = 0 from public.observations o
                 where o.source_type = 'exam_response' and o.source_id = t.v('R3')), 'gözlem error_cause = time, ağırlık 0.5');
  perform t.ok((select r.blank_reason from public.exam_responses r where r.id = t.u('R6')) = 'not_started', 'blank_reason yazıldı');
end $$;

-- failed ve done aşamaları
do $$
declare
  v_v jsonb;
begin
  perform t.as_service();
  perform public.set_exam_progress(t.u('S2'), 'failed', '{"error": "Sayfalar okunamadı"}');
  perform t.raises(format('select public.set_exam_progress(%L, ''ocr'')', t.v('S2')), 'OGR-EXAM-003%', 'failed oturuma ilerleme yazılmaz');
  perform public.set_exam_progress(t.u('S'), 'report');
  -- rapor aşamasında son deneme düşer (exam-analyse failSession): notlanmış sonuç gizlenmez
  perform public.set_exam_progress(t.u('S'), 'failed', '{"error": "Rapor hazırlanamadı", "error_code": "OGR-JOB-000"}');
  perform t.as_user(t.u('elif'));
  v_v := public.exam_session_view(t.u('S'));
  perform t.as_admin();
  perform t.ok(v_v ->> 'status' = 'done' and not (v_v ->> 'pending')::boolean and v_v -> 'summary' ->> 'one_line' is not null
               and jsonb_array_length(v_v -> 'items') = 3 and jsonb_array_length(v_v -> 'heatmap') = 2
               and v_v -> 'progress' ->> 'report_status' = 'failed' and v_v -> 'progress' ->> 'error' = 'Rapor hazırlanamadı'
               and v_v -> 'progress' ->> 'stage' = 'done',
               'notlanmış oturumda failed: oturum done, özet/ısı haritası/liste duruyor, report_status failed');
  perform t.ok((select x.status = 'ready' from public.exams x where x.id = t.u('X'))
               and (select count(*) from public.uploads u where u.id in (t.u('P1'), t.u('P2'), t.u('P3')) and u.status = 'ready') = 3,
               'notlanmış oturumda failed: deneme ve sayfalar ready kalır');
  perform t.as_service();
  perform public.set_exam_progress(t.u('S'), 'done');
  perform t.as_user(t.u('elif'));
  v_v := public.exam_session_view(t.u('S2'));
  perform t.as_admin();
  perform t.ok(v_v ->> 'status' = 'failed' and (v_v ->> 'pending')::boolean and v_v -> 'progress' ->> 'error' = 'Sayfalar okunamadı',
               'failed görünüm: hata metni');
  perform t.ok((select x.status = 'failed' from public.exams x where x.id = t.u('X2'))
               and (select u.status = 'failed' from public.uploads u where u.id = t.u('P4')), 'failed: deneme ve sayfa failed');
  perform t.ok((select es.status = 'done' and es.progress ->> 'stage' = 'done' from public.exam_sessions es where es.id = t.u('S')),
               'done aşaması: oturum done');
end $$;

-- düşmüş analizden sonra yeniden gönderim: aynı sayfalar yeni deneme + oturum açar (40 sayfa yeniden çekilmez)
do $$
declare
  v_r jsonb;
  v_r2 jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_r := public.submit_exam_upload(array[t.u('P4')]);
  perform t.ok(not (v_r ->> 'reused')::boolean and v_r ->> 'session_id' <> t.v('S2') and v_r ->> 'exam_id' <> t.v('X2'),
               'düşmüş oturumun kümesi yeniden gönderilince yeni deneme ve oturum (' || v_r::text || ')');
  v_r2 := public.submit_exam_upload(array[t.u('P4')]);
  perform t.ok((v_r2 ->> 'reused')::boolean and v_r2 ->> 'session_id' = v_r ->> 'session_id',
               'yeni gönderimin tekrarı reused (düşmüş oturum değil yenisi döner)');
  perform t.raises(format('select public.submit_exam_upload(array[%L]::uuid[])', t.v('P1')), 'OGR-UPL-003%',
                   'işlenmiş (ready) sayfa yeni denemeye girmez');
  perform t.as_admin();
  perform t.ok((select es.mode = 'uploaded' and es.status = 'grading' and es.upload_ids = array[t.u('P4')] and es.progress ->> 'stage' = 'classify'
                  from public.exam_sessions es where es.id = (v_r ->> 'session_id')::uuid)
               and (select u.status = 'processing' from public.uploads u where u.id = t.u('P4'))
               and (select es.status = 'failed' from public.exam_sessions es where es.id = t.u('S2')),
               'yeni oturum grading/classify, sayfa yeniden processing, eski oturum failed kalır');
  perform t.ok((select count(*) from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'exam.analyse'
                 and e.diff -> 'data' ->> 'session_id' = v_r ->> 'session_id') = 1, 'yeni oturum için tek exam.analyse işi');
  -- yeni oturum da düşerse yine yeniden gönderilebilir
  perform t.as_service();
  perform public.set_exam_progress((v_r ->> 'session_id')::uuid, 'failed', '{"error": "Sayfalar okunamadı"}');
  perform t.as_user(t.u('elif'));
  v_r2 := public.submit_exam_upload(array[t.u('P4'), t.u('P5')]);
  perform t.ok(not (v_r2 ->> 'reused')::boolean and v_r2 ->> 'session_id' <> v_r ->> 'session_id',
               'düşmüş sayfa yeni sayfayla birlikte de gönderilebilir');
  perform t.as_admin();
end $$;

rollback;
