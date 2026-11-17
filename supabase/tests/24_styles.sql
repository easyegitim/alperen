-- tests/24_styles.sql — tarz kütüphanesi (0036–0037): çıkmış sınav alımı (ingest_exam_source: yetki, yeniden gönderim,
-- style.ingest işi), madde kaydı (register_exam_items: yıl/tür kaynaktan, kazanım ve gömme doğrulaması, tam küme),
-- tarz yazımı (upsert_question_styles: worker taslak + madde ataması, eğitmen onayı, worker onaylı adı ezmez), RLS
-- (öğrenci tarz tanımını okur, örnek maddeleri ve arşivi okumaz; veli tarz görmez), style_library_view (personel/öğrenci
-- dalı), kapsama tetikleyicileri (attempts, exam_responses, solution_analyses; +1 upsert çift saymaz; kaynağı olmayan
-- satır kalır; kaynak bitince satır silinir; soru tarzı değişince yeniden hesap), student_style_coverage, merge_styles.
begin;
\ir _fixture.sql

do $$
begin
  perform t.add_outsiders();
  insert into public.uploads (id, owner_id, kind, storage_path) values
    ('40000000-0000-4000-8000-0000000000a1', t.u('inst'), 'pdf', t.v('inst') || '/arsiv-2024.pdf'),
    ('40000000-0000-4000-8000-0000000000a2', t.u('inst'), 'photo', t.v('inst') || '/arsiv-2025-1.jpg'),
    ('40000000-0000-4000-8000-0000000000a3', t.u('inst2'), 'pdf', t.v('inst2') || '/baskasi.pdf');
  insert into public.uploads (id, owner_id, student_id, kind, storage_path) values
    ('40000000-0000-4000-8000-0000000000e1', t.u('elif'), t.u('A'), 'photo', t.v('elif') || '/odev.jpg');
end $$;

-- yetkiler
do $$
begin
  perform t.ok(not has_function_privilege('anon', 'public.ingest_exam_source(uuid, jsonb, uuid[])', 'execute')
               and not has_function_privilege('anon', 'public.style_library_view(uuid)', 'execute')
               and not has_function_privilege('anon', 'public.student_style_coverage(uuid)', 'execute')
               and has_function_privilege('authenticated', 'public.upsert_question_styles(uuid, jsonb)', 'execute')
               and has_function_privilege('authenticated', 'public.merge_styles(uuid, uuid)', 'execute')
               and not has_function_privilege('authenticated', 'app.refresh_style_scores(uuid)', 'execute')
               and not has_function_privilege('authenticated', 'app.refresh_style_coverage(uuid, uuid)', 'execute'),
               'RPC yetkileri: anon hiçbirini çağıramaz; iç yardımcılar authenticated''a kapalı');
end $$;

-- ingest_exam_source
do $$
declare
  v_r jsonb;
  v_r2 jsonb;
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.ingest_exam_source(%L, ''{"year": 2024, "term": "osym"}'', array[%L]::uuid[])',
                          t.v('course'), '40000000-0000-4000-8000-0000000000e1'), '42501', 'öğrenci çıkmış sınav yükleyemez');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.ingest_exam_source(%L, ''{"year": 2024, "term": "osym"}'', array[%L]::uuid[])',
                          t.v('course'), '40000000-0000-4000-8000-0000000000a3'), 'OGR-AUTH-002%', 'derse bağlı olmayan eğitmen yükleyemez');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.ingest_exam_source(%L, ''{"year": 2024, "term": "osym"}'', array[%L]::uuid[])',
                          t.v('course'), '40000000-0000-4000-8000-0000000000a3'), 'OGR-UPL-002%', 'başkasının dosyası kullanılamaz');
  perform t.raises(format('select public.ingest_exam_source(%L, ''{"year": 2024, "term": "osym"}'', array[%L]::uuid[])',
                          t.v('course'), '40000000-0000-4000-8000-0000000000e1'), 'OGR-UPL-002%', 'öğrenci yüklemesi arşive alınamaz');
  perform t.raises(format('select public.ingest_exam_source(%L, ''{"year": 24, "term": "osym"}'', array[%L]::uuid[])',
                          t.v('course'), '40000000-0000-4000-8000-0000000000a1'), 'OGR-STYLE-002%', 'yıl dört haneli');
  perform t.raises(format('select public.ingest_exam_source(%L, ''{"year": 2024, "term": "osym", "instructor_alias": "Ahmet Hoca"}'', array[%L]::uuid[])',
                          t.v('course'), '40000000-0000-4000-8000-0000000000a1'), 'OGR-STYLE-002%', 'gerçek hoca adı yazılmaz');
  v_r := public.ingest_exam_source(t.u('course'), '{"year": 2024, "term": "osym", "instructor_alias": "hoca-A"}',
                                   array['40000000-0000-4000-8000-0000000000a1']::uuid[]);
  v_r2 := public.ingest_exam_source(t.u('course'), '{"year": 2024, "term": "osym", "instructor_alias": "hoca-A"}',
                                    array['40000000-0000-4000-8000-0000000000a1']::uuid[]);
  perform t.ok(not (v_r ->> 'reused')::boolean and (v_r2 ->> 'reused')::boolean and v_r2 ->> 'source_id' = v_r ->> 'source_id',
               'aynı dosya kümesi yeniden gönderilince aynı kaynak döner');
  perform t.as_admin();
  insert into t.cfg values ('S24', v_r ->> 'source_id');
  perform t.ok((select s.status = 'uploaded' and s.upload_ids = array['40000000-0000-4000-8000-0000000000a1']::uuid[]
                       and s.upload_id = '40000000-0000-4000-8000-0000000000a1' and s.uploaded_by = t.u('inst') and s.instructor_alias = 'hoca-A'
                  from public.exam_sources s where s.id = t.u('S24'))
               and (select u.status = 'processing' from public.uploads u where u.id = '40000000-0000-4000-8000-0000000000a1'),
               'exam_sources(uploaded) yazıldı, dosya processing');
  perform t.ok((select count(*) from audit.events e where e.action in ('job.enqueue_skipped', 'job.enqueue_failed')
                  and e.diff ->> 'name' = 'style.ingest' and e.diff -> 'data' ->> 'source_id' = t.v('S24')) = 1
               and exists (select 1 from secure.job_outbox o where o.name = 'style.ingest' and o.data ->> 'source_id' = t.v('S24')),
               'style.ingest işi bir kez kuyruğa (pg-boss yok → outbox) atıldı');
  -- ikinci kaynak (2025, iki sayfa değil tek fotoğraf) worker'dan
  perform t.as_service();
  v_r := public.ingest_exam_source(t.u('course'), '{"year": 2025, "term": "osym"}', array['40000000-0000-4000-8000-0000000000a2']::uuid[]);
  perform t.as_admin();
  insert into t.cfg values ('S25', v_r ->> 'source_id');
end $$;

-- register_exam_items
do $$
declare
  v_r jsonb;
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.register_exam_items(%L, ''[{"item_no": 1}]'')', t.v('S24')), '42501', 'öğrenci madde yazamaz');
  perform t.as_service();
  perform t.raises(format('select public.register_exam_items(%L, ''[{"item_no": 1, "skill_ids": ["t.yok"]}]'')', t.v('S24')),
                   'OGR-CURR-001%', 'müfredatta olmayan kazanım reddedilir');
  perform t.raises(format('select public.register_exam_items(%L, ''[{"item_no": 1, "embedding": [0.1, 0.2]}]'')', t.v('S24')),
                   'OGR-STYLE-006%', 'gömme 1024 boyutlu olmalı');
  perform t.raises(format('select public.register_exam_items(%L, ''[{"item_no": 1}, {"item_no": 1}]'')', t.v('S24')),
                   'OGR-STYLE-004%', 'yinelenen madde numarası');
  v_r := public.register_exam_items(t.u('S24'), jsonb_build_array(
    jsonb_build_object('item_no', 1, 'topic', 'İşlem önceliği', 'kind', 'mc', 'format', 'text', 'trick', 'Parantez önce',
                       'difficulty', 0.4, 'points', 4, 'skill_ids', jsonb_build_array('t.mat.a'), 'ocr_text', 'GIZLI-OCR-1',
                       'embedding', (select jsonb_agg(0.01) from generate_series(1, 1024))),
    jsonb_build_object('item_no', 2, 'kind', 'calc', 'skill_id', 't.mat.b', 'ocr_text', 'GIZLI-OCR-2'),
    jsonb_build_object('item_no', 3, 'kind', 'mc', 'ocr_text', 'GIZLI-OCR-3', 'year', 2023)));
  perform t.ok((v_r ->> 'item_count')::int = 3, 'üç madde yazıldı');
  v_r := public.register_exam_items(t.u('S25'), jsonb_build_array(
    jsonb_build_object('item_no', 1, 'kind', 'mc', 'skill_ids', jsonb_build_array('t.mat.a'), 'ocr_text', 'GIZLI-OCR-4'),
    jsonb_build_object('item_no', 2, 'kind', 'mc', 'skill_ids', jsonb_build_array('t.mat.b'), 'ocr_text', 'GIZLI-OCR-5'),
    jsonb_build_object('item_no', 9, 'kind', 'other', 'ocr_text', 'silinecek')));
  -- tam küme: 9 numaralı madde ikinci kayıtta yok → silinir; gömme gönderilmezse korunur
  v_r := public.register_exam_items(t.u('S25'), jsonb_build_array(
    jsonb_build_object('item_no', 1, 'kind', 'mc', 'skill_ids', jsonb_build_array('t.mat.a'), 'ocr_text', 'GIZLI-OCR-4'),
    jsonb_build_object('item_no', 2, 'kind', 'mc', 'skill_ids', jsonb_build_array('t.mat.b'), 'ocr_text', 'GIZLI-OCR-5')));
  perform t.as_admin();
  perform t.ok((select ei.year = 2024 and ei.term = 'osym' and ei.skill_ids = array['t.mat.a'] and ei.skill_id = 't.mat.a'
                       and ei.curriculum_id = t.u('cur') and ei.embedding is not null and ei.difficulty = 0.4
                  from public.exam_items ei where ei.source_id = t.u('S24') and ei.item_no = 1)
               and (select ei.skill_ids = array['t.mat.b'] and ei.skill_id = 't.mat.b' from public.exam_items ei
                     where ei.source_id = t.u('S24') and ei.item_no = 2)
               and (select ei.year = 2023 and ei.term = 'osym' and ei.curriculum_id is null from public.exam_items ei
                     where ei.source_id = t.u('S24') and ei.item_no = 3),
               'yıl/tür kaynaktan (madde yılı verilirse o), kazanımlar ve gömme yazıldı');
  perform t.ok((select count(*) from public.exam_items ei where ei.source_id = t.u('S25')) = 2
               and (select s.status = 'ocr_done' from public.exam_sources s where s.id = t.u('S25'))
               and (select u.status = 'ready' from public.uploads u where u.id = '40000000-0000-4000-8000-0000000000a2'),
               'tam küme: listede olmayan madde silindi; kaynak ocr_done, dosya ready');
  insert into t.cfg select 'I' || s.year || '_' || ei.item_no, ei.id::text
    from public.exam_items ei join public.exam_sources s on s.id = ei.source_id where s.course_id = t.u('course');
end $$;

-- upsert_question_styles
do $$
declare
  v_r jsonb;
begin
  perform t.as_service();
  v_r := public.upsert_question_styles(t.u('course'), jsonb_build_array(
    jsonb_build_object('code', 'islem-onceligi', 'name', 'İşlem önceliği tuzağı', 'description', 'Parantez ve işaret sırasını sınar.',
                       'format', 'text', 'trick', 'Parantezi atlamak', 'difficulty_band', 'medium', 'skill_ids', jsonb_build_array('t.mat.a'),
                       'item_ids', jsonb_build_array(t.v('I2024_1'), t.v('I2025_1')), 'status', 'active'),
    jsonb_build_object('code', 'isaret', 'name', 'İşaret kuralı', 'description', 'Eksi dağıtma.', 'skill_ids', jsonb_build_array('t.mat.b'),
                       'item_ids', jsonb_build_array(t.v('I2024_2'), t.v('I2025_2'))),
    jsonb_build_object('code', 'isaret-2', 'name', 'İşaret kuralı (ikinci küme)', 'skill_ids', jsonb_build_array('t.mat.b'),
                       'item_ids', jsonb_build_array(t.v('I2024_3')))));
  perform t.ok(jsonb_array_length(v_r -> 'styles') = 3 and (v_r -> 'styles' -> 0 ->> 'created')::boolean, 'üç tarz yaratıldı');
  perform t.raises(format('select public.upsert_question_styles(%L, jsonb_build_array(jsonb_build_object(''code'', ''x1'', ''name'', ''Yanlış madde'', ''item_ids'', jsonb_build_array(%L))))',
                          t.v('course'), gen_random_uuid()), 'OGR-STYLE-005%', 'başka arşivin maddesi atanamaz');
  perform t.raises(format('select public.upsert_question_styles(%L, ''[{"code": "yeni"}]'')', t.v('course')), 'OGR-STYLE-007%', 'yeni tarz ad ister');
  perform t.as_admin();
  insert into t.cfg select 'ST_' || qs.code, qs.id::text from public.question_styles qs where qs.course_id = t.u('course');
  perform t.ok((select qs.status = 'draft' and qs.source = 'extracted' and qs.reviewed_at is null and qs.difficulty_band = 'mid'
                       and qs.curriculum_id = t.u('cur') and qs.exemplar_item_ids = array[t.u('I2024_1'), t.u('I2025_1')]
                       and qs.years_hit = array[2024, 2025]::smallint[] and qs.years_total = 3 and qs.frequency_score = 0.6667
                  from public.question_styles qs where qs.id = t.u('ST_islem-onceligi')),
               'worker tarzı taslak (etkinleştiremez), medium → mid, örnekler maddelerden, skorlar tazelendi');
  perform t.ok((select count(*) from public.exam_items ei where ei.style_id = t.u('ST_isaret')) = 2
               and (select count(*) from public.exam_sources s where s.course_id = t.u('course') and s.status = 'clustered') = 2,
               'maddeler tarza atandı; ocr_done kaynaklar clustered');

  -- eğitmen onayı: ad değişir, tarz etkinleşir; worker sonraki kümelemede adı ezmez
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.upsert_question_styles(%L, ''[{"code": "isaret", "name": "Öğrenci adı"}]'')', t.v('course')),
                   '42501', 'öğrenci tarz yazamaz');
  perform t.as_user(t.u('inst'));
  v_r := public.upsert_question_styles(t.u('course'), '[{"code": "isaret", "name": "Eksiyi dağıtma", "description": "Parantez önündeki eksiyi her terime dağıtır."}, {"code": "islem-onceligi", "status": "active"}]');
  perform t.as_service();
  v_r := public.upsert_question_styles(t.u('course'), jsonb_build_array(
    jsonb_build_object('code', 'isaret', 'name', 'Worker adı', 'description', 'Worker tanımı', 'exemplar_item_ids', jsonb_build_array(t.v('I2025_2')))));
  perform t.as_admin();
  perform t.ok((select qs.name = 'Eksiyi dağıtma' and qs.description = 'Parantez önündeki eksiyi her terime dağıtır.' and qs.status = 'active'
                       and qs.reviewed_by = t.u('inst') and qs.reviewed_at is not null and qs.exemplar_item_ids = array[t.u('I2025_2')]
                  from public.question_styles qs where qs.id = t.u('ST_isaret')),
               'eğitmen adı/tanımı korunur, worker yalnız örnekleri tazeler');
  perform t.ok((select qs.status = 'active' from public.question_styles qs where qs.id = t.u('ST_islem-onceligi'))
               and (select qs.status = 'draft' from public.question_styles qs where qs.id = t.u('ST_isaret-2')),
               'eğitmen taslağı etkinleştirir; dokunulmayan taslak kalır');
end $$;

-- RLS: öğrenci tarz tanımını okur, örnekleri ve arşivi okumaz; veli tarz görmez
do $$
begin
  perform t.ok(t.sees(t.u('elif'), $q$select id, code, name, description, trick from public.question_styles where course_id = '30000000-0000-4000-8000-0000000000c0'$q$) = 2,
               'öğrenci dersinin etkin tarzlarının tanımını okur (taslak görünmez)');
  perform t.as_user(t.u('elif'));
  perform t.raises('select exemplar_item_ids from public.question_styles', '42501', 'öğrenci örnek maddeleri okuyamaz');
  perform t.ok(t.n('select 1 from public.exam_items') = 0 and t.n('select 1 from public.exam_sources') = 0
               and t.n('select 1 from public.v_question_styles_staff') = 0, 'öğrenci arşivi ve personel görünümünü okumaz');
  perform t.as_admin();
  perform t.ok(t.sees(t.u('parent'), 'select id from public.question_styles') = 0, 'veli tarz görmez');
  perform t.ok(t.sees(t.u('inst'), 'select 1 from public.exam_items') = 5 and t.sees(t.u('inst'), 'select 1 from public.exam_sources') = 2,
               'dersin eğitmeni arşivi okur');
end $$;

-- style_library_view
do $$
declare
  v_v jsonb;
begin
  perform t.as_user(t.u('inst'));
  v_v := public.style_library_view(t.u('course'));
  perform t.ok(v_v ->> 'role' = 'staff' and (v_v ->> 'can_manage')::boolean and jsonb_array_length(v_v -> 'styles') = 3
               and (v_v -> 'archive' ->> 'years_total')::int = 3 and (v_v -> 'archive' ->> 'items')::int = 5
               and (v_v -> 'archive' ->> 'years_from')::int = 2023 and (v_v -> 'archive' ->> 'years_to')::int = 2025,
               'personel görünümü: arşiv özeti (2023–2025, 3 yıl, 5 madde), 3 tarz');
  perform t.ok((select jsonb_array_length(s -> 'appearances') = 2 and s -> 'exemplar_item_ids' is not null
                       and s -> 'skills' -> 0 ->> 'name' = 'İşlem önceliği' and (s -> 'coverage' ->> 'students_total')::int = 2
                  from jsonb_array_elements(v_v -> 'styles') as s where s ->> 'code' = 'islem-onceligi'),
               'personel: çıktığı sınavlar, örnekler, kazanım adları, bağlı öğrencilerin kapsaması');
  perform t.ok(v_v::text not like '%GIZLI-OCR%', 'personel görünümünde de çıkmış soru metni yok');
  perform t.as_user(t.u('elif'));
  v_v := public.style_library_view(t.u('course'));
  perform t.ok(v_v ->> 'role' = 'student' and jsonb_array_length(v_v -> 'styles') = 2 and v_v ->> 'enrollment_id' = t.v('EA')
               and v_v::text not like '%GIZLI-OCR%' and v_v::text not like '%exemplar%' and v_v::text not like '%appearances%'
               and v_v::text not like '%years_hit%'
               and (select s ->> 'frequency_band' = 'sık soruluyor' and s -> 'coverage' ->> 'text' = 'Bu tarzı hiç çözmedin'
                      from jsonb_array_elements(v_v -> 'styles') as s where s ->> 'code' = 'islem-onceligi'),
               'öğrenci görünümü: etkin tarzlar, tanım, sıklık bandı, kendi kapsaması; örnek/yıl/kaynak/metin yok');
  perform t.as_user(t.u('parent'));
  perform t.raises(format('select public.style_library_view(%L)', t.v('course')), 'OGR-AUTH-001%', 'veli tarz kütüphanesini açamaz');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.style_library_view(%L)', t.v('course')), 'OGR-AUTH-001%', 'derse bağsız eğitmen açamaz');
  perform t.as_admin();
end $$;

-- kapsama tetikleyicileri
do $$
declare
  v_q uuid;
  v_a bigint;
  v_exam uuid;
  v_eq uuid;
  v_sess uuid;
  v_resp uuid;
  v_sa uuid;
  v_r jsonb;
begin
  -- attempts → questions.style_id
  insert into public.questions (curriculum_id, skill_ids, stem, source, content_hash, status, style_id, options)
  values (t.u('cur'), array['t.mat.a'], 'Tarz sorusu', 'llm', 'h-style-24', 'approved', t.u('ST_islem-onceligi'),
          '[{"key": "A", "text": "1"}, {"key": "B", "text": "2"}]')
  returning id into v_q;
  insert into public.attempts (enrollment_id, question_id, context, chosen, is_correct, graded_at)
  values (t.u('EA'), v_q, 'practice', '{"key": "A"}', true, now());
  insert into public.attempts (enrollment_id, question_id, context, chosen)
  values (t.u('EA'), v_q, 'practice', '{"key": "B"}') returning id into v_a;
  perform t.ok((select sc.seen_count = 2 and sc.solved_count = 1 and sc.correct_count = 1 and sc.last_seen_at is not null
                  from public.style_coverage sc where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('ST_islem-onceligi')),
               'attempts: 2 görüldü, 1 notlandı ve doğru');
  update public.attempts a set is_correct = false, graded_at = now() where a.id = v_a;
  perform t.ok((select sc.seen_count = 2 and sc.solved_count = 2 and sc.correct_count = 1 from public.style_coverage sc
                 where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('ST_islem-onceligi')), 'notlama sonrası 2 çözüldü, 1 doğru');
  -- apply_diagnosis/grade_exam_session'ın +1 upsert'i çift saymaz
  insert into public.style_coverage as sc (enrollment_id, style_id, seen_count, solved_count, correct_count, last_seen_at)
  values (t.u('EA'), t.u('ST_islem-onceligi'), 1, 1, 1, now())
  on conflict (enrollment_id, style_id) do update
    set seen_count = sc.seen_count + 1, solved_count = sc.solved_count + 1, correct_count = sc.correct_count + 1;
  perform t.ok((select sc.seen_count = 2 and sc.solved_count = 2 and sc.correct_count = 1 from public.style_coverage sc
                 where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('ST_islem-onceligi')), '+1 upsert kaynaklardan yeniden hesaplanır');

  -- exam_responses → exam_questions.style_id (yalnız notlanmış sonuç)
  insert into public.exams (curriculum_id, course_id, kind, source, title, status, question_count)
  values (t.u('cur'), t.u('course'), 'practice', 'instructor', 'Tarz denemesi', 'ready', 1) returning id into v_exam;
  insert into public.exam_questions (exam_id, no, kind, skill_ids, style_id) values (v_exam, 1, 'mcq', array['t.mat.b'], t.u('ST_isaret'))
  returning id into v_eq;
  insert into public.exam_sessions (exam_id, enrollment_id, mode, status) values (v_exam, t.u('EA'), 'in_app', 'grading') returning id into v_sess;
  insert into public.exam_responses (session_id, exam_question_id, answer) values (v_sess, v_eq, 'C') returning id into v_resp;
  perform t.ok(not exists (select 1 from public.style_coverage sc where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('ST_isaret')),
               'notlanmamış cevap kapsamaya sayılmaz');
  update public.exam_responses r set outcome = 'wrong' where r.id = v_resp;
  perform t.ok((select sc.seen_count = 1 and sc.solved_count = 1 and sc.correct_count = 0 from public.style_coverage sc
                 where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('ST_isaret')), 'notlanmış yanlış cevap: 1 görüldü, 1 çözüldü');

  -- solution_analyses: deneme dışı sayılır, deneme bağlamı sayılmaz
  insert into public.solution_analyses (enrollment_id, analysis, verdict, style_id)
  values (t.u('EA'), '{}', 'correct', t.u('ST_isaret')) returning id into v_sa;
  insert into public.solution_analyses (enrollment_id, analysis, verdict, style_id, exam_response_id)
  values (t.u('EA'), '{}', 'wrong', t.u('ST_isaret'), v_resp);
  perform t.ok((select sc.seen_count = 2 and sc.solved_count = 2 and sc.correct_count = 1 from public.style_coverage sc
                 where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('ST_isaret')),
               'teşhis: deneme dışı doğru sayıldı, deneme bağlamlı teşhis ikinci kez sayılmadı');
  update public.solution_analyses sa set verdict = 'unreadable' where sa.id = v_sa;
  perform t.ok((select sc.seen_count = 2 and sc.solved_count = 1 and sc.correct_count = 0 from public.style_coverage sc
                 where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('ST_isaret')), 'okunamaz teşhis çözülmüş sayılmaz');

  -- kaynağı olmayan (içe aktarılmış) satır kalır
  insert into public.style_coverage (enrollment_id, style_id, seen_count, solved_count, correct_count)
  values (t.u('EB'), t.u('ST_isaret-2'), 3, 2, 1);
  perform t.ok((select sc.seen_count = 3 and sc.solved_count = 2 and sc.correct_count = 1 from public.style_coverage sc
                 where sc.enrollment_id = t.u('EB') and sc.style_id = t.u('ST_isaret-2')), 'kaynağı olmayan satır olduğu gibi kalır');

  -- soru tarzı değişince eski ve yeni tarz yeniden hesaplanır; kaynak bitince satır silinir
  update public.questions q set style_id = t.u('ST_isaret-2') where q.id = v_q;
  perform t.ok(not exists (select 1 from public.style_coverage sc where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('ST_islem-onceligi'))
               and (select sc.seen_count = 2 and sc.solved_count = 2 and sc.correct_count = 1 from public.style_coverage sc
                     where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('ST_isaret-2')),
               'soru tarzı değişti: eski tarzın satırı silindi, yeni tarz sayıldı');
  delete from public.attempts a where a.question_id = v_q;
  perform t.ok(not exists (select 1 from public.style_coverage sc where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('ST_isaret-2')),
               'denemeler silinince kapsama satırı silinir');
  update public.questions q set style_id = t.u('ST_islem-onceligi') where q.id = v_q;
  insert into public.attempts (enrollment_id, question_id, context, chosen, is_correct, graded_at)
  values (t.u('EA'), v_q, 'practice', '{"key": "A"}', true, now());

  -- student_style_coverage
  perform t.as_user(t.u('elif'));
  v_r := public.student_style_coverage(t.u('EA'));
  perform t.ok(jsonb_array_length(v_r -> 'styles') = 2
               and (select s ->> 'text' = '1 çözdün, 0 doğru' and (s ->> 'seen')::int = 2 from jsonb_array_elements(v_r -> 'styles') as s
                     where s ->> 'code' = 'isaret')
               and (select s ->> 'text' = '1 çözdün, 1 doğru' from jsonb_array_elements(v_r -> 'styles') as s where s ->> 'code' = 'islem-onceligi')
               and (v_r -> 'summary' ->> 'never_solved')::int = 0,
               'student_style_coverage: etkin tarzlar ve kapsama cümleleri');
  perform t.raises(format('select public.student_style_coverage(%L)', t.v('EB')), 'OGR-AUTH-001%', 'öğrenci başkasının kapsamasını göremez');
  perform t.as_user(t.u('parent'));
  perform t.raises(format('select public.student_style_coverage(%L)', t.v('EA')), 'OGR-AUTH-001%', 'veli tarz kapsamasını göremez');
  perform t.as_user(t.u('inst'));
  perform t.ok((public.student_style_coverage(t.u('EA')) -> 'summary' ->> 'solved')::int = 2, 'bağlı eğitmen kapsamayı görür');
  perform t.as_admin();
end $$;

-- merge_styles
do $$
declare
  v_r jsonb;
  v_other uuid;
begin
  insert into public.courses (code, title, curriculum_id, created_by) values ('T-OTHER', 'Başka ders', t.u('cur'), t.u('inst'))
  returning id into v_other;
  insert into public.question_styles (course_id, code, name, status) values (v_other, 'baska', 'Başka dersin tarzı', 'active');
  -- isaret-2'ye bir deneme dışı teşhis: birleşince isaret'in kapsamasına geçer
  insert into public.solution_analyses (enrollment_id, analysis, verdict, style_id) values (t.u('EA'), '{}', 'correct', t.u('ST_isaret-2'));
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.merge_styles(%L, %L)', t.v('ST_isaret'), t.v('ST_isaret-2')), '42501', 'öğrenci birleştiremez');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.merge_styles(%L, (select id from public.question_styles where code = ''baska''))', t.v('ST_isaret')),
                   'OGR-STYLE-008%', 'farklı derslerin tarzları birleşmez');
  perform t.raises(format('select public.merge_styles(%L, %L)', t.v('ST_isaret'), t.v('ST_isaret')), 'OGR-STYLE-008%', 'tarz kendisiyle birleşmez');
  v_r := public.merge_styles(t.u('ST_isaret'), t.u('ST_isaret-2'));
  perform t.as_admin();
  perform t.ok((v_r -> 'moved' ->> 'exam_items')::int = 1 and (v_r -> 'moved' ->> 'solution_analyses')::int = 1
               and (v_r -> 'moved' ->> 'imported_coverage')::int = 1, 'birleştirme: 1 madde, 1 teşhis, 1 içe aktarılmış kapsama taşındı');
  perform t.ok(not exists (select 1 from public.question_styles qs where qs.id = t.u('ST_isaret-2'))
               and (select count(*) from public.exam_items ei where ei.style_id = t.u('ST_isaret')) = 3
               and (select qs.years_hit = array[2023, 2024, 2025]::smallint[] and qs.frequency_score = 1 and qs.recency_score = 1
                      from public.question_styles qs where qs.id = t.u('ST_isaret')),
               'birleşen tarz silindi; maddeler ve yıllar (2023–2025) kalan tarzda; skorlar tazelendi');
  perform t.ok((select sc.seen_count = 3 and sc.solved_count = 2 and sc.correct_count = 1 from public.style_coverage sc
                 where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('ST_isaret'))
               and (select sc.seen_count = 3 and sc.solved_count = 2 and sc.correct_count = 1 from public.style_coverage sc
                     where sc.enrollment_id = t.u('EB') and sc.style_id = t.u('ST_isaret')),
               'kapsama: kaynaklı satır yeniden hesaplandı (1 cevap + 2 teşhis), içe aktarılmış satır taşındı');
  perform t.ok(exists (select 1 from audit.events e where e.action = 'style.merge' and e.row_id = t.v('ST_isaret')), 'birleştirme denetim izinde');
end $$;

-- tarz kartından alıştırma: set tarza bağlanır, tarzın soruları önce gelir, cevap kapsamaya sayılır (§11 döngüsü)
do $$
declare
  v_q uuid;
  v_i int;
  v_s jsonb;
  v_first uuid;
  v_n int;
begin
  insert into public.question_styles (course_id, curriculum_id, code, name, status, skill_ids)
  values (t.u('course'), t.u('cur'), 'kesir', 'Kesirde işlem sırası', 'active', array['t.mat.a']) returning id into v_q;
  insert into t.cfg values ('ST_kesir', v_q::text);
  insert into public.question_styles (course_id, curriculum_id, code, name, status, skill_ids)
  values (t.u('course'), t.u('cur'), 'bos-banka', 'Bankası boş tarz', 'active', array['t.mat.a']) returning id into v_q;
  insert into t.cfg values ('ST_bos', v_q::text);
  -- tarzsız 6 soru ve tarzın 2 sorusu (hepsi t.mat.a, onaylı, anahtarlı)
  for v_i in 1..8 loop
    insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, content_hash, status, style_id)
    values (t.u('cur'), array['t.mat.a'], 'mcq', format('Soru %s', v_i),
            '[{"key":"A","text":"1"},{"key":"B","text":"2"},{"key":"C","text":"3"},{"key":"D","text":"4"}]', 'llm', 'st-pr-' || v_i,
            'approved', case when v_i > 6 then t.u('ST_kesir') end)
    returning id into v_q;
    insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by)
    values (v_q, 'A', 'x', 'verified', 'seed');
  end loop;
  insert into public.suggestions (id, student_id, enrollment_id, kind, title, payload, rank) values
    ('50000000-0000-4000-8000-0000000000c1', t.u('A'), t.u('EA'), 'practice', 'Kesirde işlem sırası',
     jsonb_build_object('skill_ids', jsonb_build_array('t.mat.a'), 'count', 4, 'reason', 'style_gap', 'style_id', t.v('ST_kesir')), 0),
    ('50000000-0000-4000-8000-0000000000c2', t.u('A'), t.u('EA'), 'practice', 'Bankası boş tarz',
     jsonb_build_object('skill_ids', jsonb_build_array('t.mat.a'), 'count', 2, 'reason', 'style_gap', 'style_id', t.v('ST_bos')), 1);

  perform t.as_user(t.u('elif'));
  v_s := public.start_practice('50000000-0000-4000-8000-0000000000c1');
  perform t.as_admin();
  perform t.ok((select ps.style_id = t.u('ST_kesir') from public.practice_sets ps where ps.id = (v_s ->> 'set_id')::uuid)
               and (v_s ->> 'total')::int = 4,
               'tarz kartından kurulan set tarza bağlı (4 soru)');
  select count(*) filter (where q.style_id = t.u('ST_kesir') and i.no <= 2), count(*) filter (where q.style_id = t.u('ST_kesir'))
    into v_i, v_n
    from public.practice_set_items i join public.questions q on q.id = i.question_id where i.set_id = (v_s ->> 'set_id')::uuid;
  perform t.ok(v_i = 2 and v_n = 2, 'tarzın iki onaylı sorusu setin başında (' || v_i || '/' || v_n || ')');
  select i.question_id into v_first from public.practice_set_items i where i.set_id = (v_s ->> 'set_id')::uuid and i.no = 1;
  perform t.ok(not exists (select 1 from public.style_coverage sc where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('ST_kesir')),
               'cevap öncesi tarz kapsaması yok');
  perform t.as_user(t.u('elif'));
  perform public.answer_practice_item((v_s ->> 'set_id')::uuid, v_first, 'A');
  perform t.as_admin();
  perform t.ok((select sc.seen_count = 1 and sc.solved_count = 1 and sc.correct_count = 1 from public.style_coverage sc
                 where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('ST_kesir')),
               'tarz sorusunun cevabı kapsamaya sayıldı (solved_count = 1): kart döngüsü kapanır');

  -- tarzın bankası boşsa set tarzsız sorularla dolar ve tarz bankası için style.question_gen kuyruğa girer
  perform t.as_user(t.u('elif'));
  v_s := public.start_practice('50000000-0000-4000-8000-0000000000c2');
  perform t.as_admin();
  perform t.ok((v_s ->> 'total')::int = 2 and (select ps.style_id = t.u('ST_bos') from public.practice_sets ps where ps.id = (v_s ->> 'set_id')::uuid)
               and exists (select 1 from secure.job_outbox o where o.name = 'style.question_gen'
                             and o.data ->> 'style_id' = t.v('ST_bos') and o.data ->> 'enrollment_id' = t.v('EA')),
               'bankası boş tarz: set dolar, style.question_gen kuyruğa girer');
  perform t.ok(not exists (select 1 from secure.job_outbox o where o.name = 'style.question_gen' and o.data ->> 'style_id' = t.v('ST_kesir')),
               'tarz sorusu sete giren kartta tarz üretimi atılmaz');
end $$;

-- son kümeleme tarihi skor tazelemesiyle oynamaz: yalnız worker'ın tarz yazımı (audit style.upsert)
do $$
declare
  v_before text;
  v_after text;
begin
  perform t.as_user(t.u('inst'));
  v_before := public.style_library_view(t.u('course')) -> 'archive' ->> 'last_clustered_at';
  perform t.as_admin();
  update audit.events e set created_at = e.created_at - interval '1 day' where e.action = 'style.upsert' and e.row_id = t.v('course');
  perform app.refresh_style_scores(t.u('course'));
  perform t.as_user(t.u('inst'));
  perform public.upsert_question_styles(t.u('course'), '[{"code": "kesir", "name": "Kesirde işlem sırası (düzenlendi)"}]');
  v_after := public.style_library_view(t.u('course')) -> 'archive' ->> 'last_clustered_at';
  perform t.as_admin();
  perform t.ok(v_before is not null and v_after::timestamptz = v_before::timestamptz - interval '1 day',
               'last_clustered_at: skor tazelemesi ve eğitmen düzenlemesi tarihi ilerletmez');
end $$;

-- yeniden kümeleme: maddesini kaybeden taslak silinir; emekli tarz birleştirilmez; etkin tarz taşınınca tutan tarz etkin olur
do $$
declare
  v_r jsonb;
begin
  perform t.as_service();
  v_r := public.upsert_question_styles(t.u('course'), ('[{"code": "taslak-a", "name": "Taslak A", "item_ids": ["' || t.v('I2024_3') || '"]}]')::jsonb);
  perform t.ok(exists (select 1 from public.question_styles qs where qs.code = 'taslak-a' and qs.status = 'draft'), 'worker taslak yazar');
  -- ikinci kümeleme: madde taslak-b'ye geçer, taslak-a boşalır ve kimseye bağlı değildir → silinir
  perform public.upsert_question_styles(t.u('course'), ('[{"code": "taslak-b", "name": "Taslak B", "item_ids": ["' || t.v('I2024_3') || '"]}]')::jsonb);
  perform t.ok(not exists (select 1 from public.question_styles qs where qs.code = 'taslak-a')
               and exists (select 1 from public.question_styles qs where qs.code = 'taslak-b' and qs.status = 'draft'),
               'boşalan taslak silinir; maddeyi alan yeni taslak kalır');
  perform t.as_admin();
  insert into public.question_styles (course_id, code, name, status, years_hit)
    values (t.u('course'), 'emekli', 'Emekli tarz', 'retired', '{}');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.merge_styles(%L, %L)', (select id from public.question_styles where code = 'emekli'), t.v('ST_isaret')),
                   'OGR-STYLE-008%', 'emekli tarz birleştirme hedefi olamaz');
  perform t.as_admin();
  insert into public.question_styles (course_id, code, name, status)
    values (t.u('course'), 'taslak-c', 'Taslak C', 'draft');
  perform t.as_user(t.u('inst'));
  v_r := public.merge_styles((select id from public.question_styles where code = 'taslak-c'), t.u('ST_isaret'));
  perform t.as_admin();
  perform t.ok((select qs.status from public.question_styles qs where qs.code = 'taslak-c') = 'active',
               'etkin tarz taslağa taşınınca tutan tarz etkin olur');
end $$;

rollback;
