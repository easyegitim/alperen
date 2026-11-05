-- tests/19_exam_inapp.sql — P2 uygulama içi deneme (0031): start_exam_session(p_exam) (kayıt çözümü, sunucu zamanlayıcısı:
-- started_at + exams.duration_min ya da bölüm dakikaları, süren oturum, süresi dolmuş oturum), record_exam_response süre
-- denetimi (OGR-EXAM-008, pay exam_time_grace_sec), finish_exam_session (bitiş ≤ sınır, notlama, ÖSYM neti, karalamalı
-- yanlış için diagnosis.run deneme bağlamı, idempotentlik), 3 argümanlı start_exam_session geriye uyumlu, yetkiler.
-- Teşhis dağıtımı notlamadadır: karalamalı yetişmeyen soru ve fotoğrafsız "nereye kadar" metni de iş alır, öğrenci
-- grade_exam_session'ı doğrudan çağırsa da karalama teşhise gider; bitmiş oturumda nereye-kadar alanları yalnız exam_how_far.
begin;
\ir _fixture.sql

do $$
declare
  v_exam uuid;
  v_q uuid;
  v_i int;
  v_cur2 uuid;
begin
  insert into public.exams (curriculum_id, course_id, kind, source, title, status, question_count, created_by, duration_min,
                            sections)
  values (t.u('cur'), t.u('course'), 'published', 'instructor', 'TYT Mini Deneme', 'published', 4, t.u('inst'), 30,
          '[{"code": "Mat", "title": "Matematik", "from_no": 1, "to_no": 4, "minutes": 99}]') returning id into v_exam;
  insert into t.cfg values ('X', v_exam::text);
  for v_i in 1..4 loop
    insert into public.exam_questions (exam_id, no, kind, section, skill_ids, stem_text, options)
    values (v_exam, v_i, 'mcq', 'Mat', array[case when v_i % 2 = 1 then 't.mat.a' else 't.mat.b' end], 'Kök ' || v_i,
            '[{"key": "A", "text": "1"}, {"key": "B", "text": "2"}, {"key": "C", "text": "3"}]') returning id into v_q;
    insert into t.cfg values ('Q' || v_i, v_q::text);
    perform public.set_exam_key(v_q, (array['A', 'C', 'B', 'A'])[v_i]);
  end loop;
  -- süresi bölüm dakikalarından gelen sınav ve süresiz sınav
  insert into public.exams (curriculum_id, course_id, kind, source, title, status, created_by, sections)
  values (t.u('cur'), t.u('course'), 'published', 'instructor', 'Bölümlü', 'published', t.u('inst'),
          '[{"code": "S1", "minutes": 20}, {"code": "S2", "minutes": 25}]') returning id into v_exam;
  insert into t.cfg values ('X3', v_exam::text);
  insert into public.exams (curriculum_id, course_id, kind, source, title, status, created_by)
  values (t.u('cur'), t.u('course'), 'published', 'instructor', 'Süresiz', 'published', t.u('inst')) returning id into v_exam;
  insert into t.cfg values ('X4', v_exam::text);
  insert into public.exam_questions (exam_id, no, kind, skill_ids) values (v_exam, 1, 'mcq', array['t.mat.a']) returning id into v_q;
  insert into t.cfg values ('X4Q1', v_q::text);
  -- başka müfredatın sınavı (Elif'in o müfredatta kaydı yok)
  insert into public.curricula (code, authority, year, version, label, status, origin)
  values ('T-FIZ', 'OTHER', 2026, 'test.1', 'Test Fizik', 'active', 'instructor') returning id into v_cur2;
  insert into public.exams (curriculum_id, kind, source, title, status, created_by)
  values (v_cur2, 'published', 'instructor', 'Fizik', 'published', t.u('inst')) returning id into v_exam;
  insert into t.cfg values ('XF', v_exam::text), ('C1', gen_random_uuid()::text), ('C2', gen_random_uuid()::text),
                           ('C3', gen_random_uuid()::text), ('C4', gen_random_uuid()::text);
  insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime)
  select t.u(k), t.u('elif'), t.u('A'), 'canvas', t.v('elif') || '/' || t.v(k) || '.png', 'image/png'
    from unnest(array['C1', 'C2', 'C3', 'C4']) as k;
end $$;

-- yetki, kayıt çözümü, oynatıcı durumu
do $$
declare
  v_st jsonb;
  v_st2 jsonb;
begin
  perform t.ok(not has_function_privilege('anon', 'public.start_exam_session(uuid)', 'execute')
               and not has_function_privilege('anon', 'public.finish_exam_session(uuid)', 'execute')
               and has_function_privilege('authenticated', 'public.finish_exam_session(uuid)', 'execute'),
               'start_exam_session(uuid) / finish_exam_session: anon çağıramaz');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.start_exam_session(%L::uuid)', t.v('X')), 'OGR-AUTH-001%', 'eğitmen uygulama içi deneme başlatamaz');
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.start_exam_session(%L::uuid)', t.v('XF')), 'OGR-EXAM-002%', 'müfredatta kaydı yoksa başlamaz');
  perform t.raises('select public.start_exam_session(gen_random_uuid())', 'OGR-EXAM-001%', 'olmayan sınav');
  v_st := public.start_exam_session(t.u('X'));
  perform t.ok(v_st ->> 'enrollment_id' = t.v('EA') and v_st ->> 'mode' = 'in_app' and v_st ->> 'status' = 'in_progress'
               and (v_st ->> 'duration_min')::int = 30 and (v_st ->> 'question_count')::int = 4 and jsonb_array_length(v_st -> 'answers') = 0
               and not (v_st ->> 'expired')::boolean and (v_st ->> 'remaining_sec')::int between 1790 and 1800
               and (v_st ->> 'deadline_at')::timestamptz = (v_st ->> 'started_at')::timestamptz + interval '30 minutes'
               and v_st ? 'server_now' and v_st -> 'sections' -> 0 ->> 'title' = 'Matematik',
               'oynatıcı durumu: kayıt EA, süre 30 dk (duration_min bölüm dakikasından önce), sunucu sınırı, kalan süre');
  perform t.ok(position('correct_option' in v_st::text) = 0, 'oynatıcı durumunda anahtar yok');
  perform t.as_admin();
  insert into t.cfg values ('S', v_st ->> 'session_id');
  perform t.as_user(t.u('elif'));
  perform public.record_exam_response(t.u('S'), t.u('Q1'), 'A', 40);
  perform public.record_exam_response(t.u('S'), t.u('Q2'), 'B', 55, true, array[t.u('C1')]);
  v_st2 := public.start_exam_session(t.u('X'));
  perform t.ok(v_st2 ->> 'session_id' = t.v('S') and jsonb_array_length(v_st2 -> 'answers') = 2
               and (select (a.e ->> 'has_work')::boolean and (a.e ->> 'flagged')::boolean and a.e ->> 'answer' = 'B'
                      from jsonb_array_elements(v_st2 -> 'answers') as a (e) where (a.e ->> 'no')::int = 2),
               'süren oturum devam eder: cevaplar, işaret, karalama');
  perform t.ok((public.start_exam_session(t.u('X3')) ->> 'duration_min')::int = 45, 'süre yoksa bölüm dakikalarının toplamı (20 + 25)');
  v_st := public.start_exam_session(t.u('X4'));
  perform t.ok(v_st -> 'duration_min' = 'null'::jsonb and v_st -> 'remaining_sec' = 'null'::jsonb and v_st -> 'deadline_at' = 'null'::jsonb
               and not (v_st ->> 'expired')::boolean, 'süresiz sınav: sınır ve kalan süre yok');
  perform t.as_admin();
  insert into t.cfg values ('S4', v_st ->> 'session_id');
  perform t.as_user(t.u('elif'));
  perform t.ok(public.start_exam_session(t.u('X'), t.u('EA')) = t.u('S'), '3 argümanlı start_exam_session geriye uyumlu (uuid)');
  perform t.as_admin();
end $$;

-- süre sınırı
do $$
declare
  v_st jsonb;
begin
  update public.exam_sessions es set started_at = es.started_at - interval '31 minutes' where es.id in (t.u('S'), t.u('S4'));
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.record_exam_response(%L, %L, ''B'')', t.v('S'), t.v('Q3')), 'OGR-EXAM-008%', 'süre dolunca yeni cevap yazılmaz');
  perform t.raises(format('select public.record_exam_response(%L, %L, ''C'')', t.v('S'), t.v('Q1')), 'OGR-EXAM-008%', 'süre dolunca cevap değişmez');
  perform public.record_exam_response(t.u('S'), t.u('Q1'), 'A', 41);
  perform public.record_exam_response(t.u('S'), t.u('Q4'), null, null, true, array[t.u('C2')]);
  perform public.record_exam_response(t.u('S'), t.u('Q3'), null, null, null, null, 'İlk adımı yazdım');
  perform t.ok(true, 'süre dolunca aynı cevap, işaret, karalama ve nereye-kadar metni yazılabilir');
  perform public.record_exam_response(t.u('S4'), t.u('X4Q1'), 'A');
  perform t.ok(true, 'süresiz sınavda geç cevap kabul');
  v_st := public.start_exam_session(t.u('X'));
  perform t.ok(v_st ->> 'session_id' = t.v('S') and (v_st ->> 'expired')::boolean and (v_st ->> 'remaining_sec')::int = 0,
               'süresi dolmuş oturum: expired, kalan 0 (istemci bitirir)');
  perform t.as_user(t.u('can'));
  perform t.raises(format('select public.finish_exam_session(%L)', t.v('S')), 'OGR-AUTH-001%', 'başka öğrenci bitiremez');
  perform t.as_user(t.u('parent'));
  perform t.raises(format('select public.finish_exam_session(%L)', t.v('S')), 'OGR-AUTH-001%', 'veli bitiremez');
  perform t.as_admin();
end $$;

-- bitir: notlama, süre, karalama → teşhis işi
do $$
declare
  v_v jsonb;
  v_n int;
  v_r2 uuid;
begin
  perform t.as_user(t.u('elif'));
  v_v := public.finish_exam_session(t.u('S'));
  perform t.as_admin();
  perform t.ok(not (v_v ->> 'pending')::boolean and v_v ->> 'status' = 'analysing'
               and (v_v -> 'summary' ->> 'correct')::int = 1 and (v_v -> 'summary' ->> 'wrong')::int = 1
               and (v_v -> 'summary' ->> 'unfinished')::int = 2 and (v_v -> 'summary' ->> 'net')::numeric = 0.75,
               'bitir: 1 doğru, 1 yanlış, 2 yetişmedi; net 1 − 1/4 = 0,75 (' || (v_v -> 'summary')::text || ')');
  perform t.ok(v_v -> 'summary' ->> 'one_line' like 'Net 0,75%.' and position('. ' in v_v -> 'summary' ->> 'one_line') = 0
               and v_v -> 'summary' ->> 'counts_line' = '4 soruda 1 doğru, 1 yanlış, 2 boş.',
               'tek cümle sonuç, sayılar Detay satırında (' || coalesce(v_v -> 'summary' ->> 'one_line', '-') || ')');
  perform t.ok((select es.finished_at = es.started_at + interval '30 minutes' and es.duration_sec = 1800 and es.score is not null
                  from public.exam_sessions es where es.id = t.u('S')), 'bitiş süre sınırında kesilir: 1800 sn');
  perform t.ok(position('correct_option' in v_v::text) = 0, 'sonuç görünümünde anahtar yok');
  select r.id into v_r2 from public.exam_responses r where r.session_id = t.u('S') and r.exam_question_id = t.u('Q2');
  perform t.ok(exists (select 1 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'diagnosis.run'
                        and e.diff -> 'data' ->> 'context' = 'exam' and e.diff -> 'data' ->> 'exam_response_id' = v_r2::text
                        and e.diff -> 'data' -> 'upload_ids' = jsonb_build_array(t.v('C1')))
               and (select u.status = 'processing' from public.uploads u where u.id = t.u('C1')),
               'karalamalı yanlış soru kendiliğinden "nereye kadar geldim": diagnosis.run (context=exam), tuval processing');
  perform t.ok(exists (select 1 from audit.events e join public.exam_responses r on r.id::text = e.diff -> 'data' ->> 'exam_response_id'
                        where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'diagnosis.run'
                          and r.exam_question_id = t.u('Q4') and e.diff -> 'data' -> 'upload_ids' = jsonb_build_array(t.v('C2')))
               and (select u.status = 'processing' from public.uploads u where u.id = t.u('C2')),
               '(a) karalamalı yetişmeyen soru da diagnosis.run alır');
  perform t.ok(exists (select 1 from audit.events e join public.exam_responses r on r.id::text = e.diff -> 'data' ->> 'exam_response_id'
                        where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'diagnosis.run'
                          and r.exam_question_id = t.u('Q3') and e.diff -> 'data' -> 'upload_ids' = '[]'::jsonb
                          and e.diff -> 'data' ->> 'how_far_text' = 'İlk adımı yazdım')
               and (select count(*) from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'diagnosis.run') = 3,
               '(b) sınavda yazılan fotoğrafsız "nereye kadar" metni de diagnosis.run alır; toplam 3 iş');
  perform t.ok((select string_agg((i.e ->> 'no') || ':' || (i.e ->> 'state'), ',' order by (i.e ->> 'no')::int)
                  from jsonb_array_elements(public.exam_session_view(t.u('S')) -> 'items') as i (e)) = '2:pending,3:pending,4:pending',
               'görünüm: yalnız gerçekten iş atılmış sorular pending');
  select count(*) into v_n from public.observations o where o.enrollment_id = t.u('EA');
  perform t.as_user(t.u('elif'));
  perform t.ok(public.finish_exam_session(t.u('S')) -> 'summary' = v_v -> 'summary', 'tekrar bitir aynı görünümü döner');
  perform t.ok((public.exam_how_far(v_r2, null, array[t.u('C1')]) ->> 'reused')::boolean, 'aynı karalamayla nereye-kadar: aynı iş');
  perform t.raises(format('select public.record_exam_response(%L, %L, ''C'')', t.v('S'), t.v('Q2')), 'OGR-EXAM-003%', 'bitmiş oturumda cevap değişmez');
  perform t.raises(format('select public.record_exam_response(%L, %L, null, null, null, null, ''sonradan'')', t.v('S'), t.v('Q2')),
                   'OGR-EXAM-003%exam_how_far%', '(d) bitmiş oturumda nereye-kadar metni record_exam_response ile yazılmaz');
  perform t.raises(format('select public.record_exam_response(%L, %L, null, null, null, array[%L]::uuid[])', t.v('S'), t.v('Q2'), t.v('C3')),
                   'OGR-EXAM-003%exam_how_far%', '(d) bitmiş oturumda karalama record_exam_response ile değişmez');
  perform public.record_exam_response(t.u('S'), t.u('Q2'), null, null, null, array[t.u('C1')]);
  perform t.ok(true, 'bitmiş oturumda aynı karalamanın tekrarı (istemci kuyruğu) sessizce kabul');
  perform t.as_admin();
  perform t.ok((select count(*) from public.observations o where o.enrollment_id = t.u('EA')) = v_n
               and (select count(*) from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'diagnosis.run') = 3,
               'tekrar bitir: yeni gözlem ve iş yok');
  perform t.ok((select count(*) from public.observations o join public.exam_responses r on r.id::text = o.source_id
                 where r.session_id = t.u('S') and o.kind = 'test' and o.guess_override = 0.2) = 2, 'iki test gözlemi (g = 0.2)');
  perform t.ok(exists (select 1 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'exam.report'
                        and e.diff -> 'data' ->> 'session_id' = t.v('S')), 'exam.report işi');
end $$;

-- tekrar deneme ve kip kuralları
do $$
declare
  v_up uuid;
  v_st jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_st := public.start_exam_session(t.u('X'));
  perform t.ok(v_st ->> 'session_id' <> t.v('S'), 'bitmiş oturumdan sonra yeni oturum');
  -- (c) öğrenci finish_exam_session yerine grade_exam_session'ı doğrudan çağırır: karalama yine teşhise gider
  perform public.record_exam_response((v_st ->> 'session_id')::uuid, t.u('Q1'), 'B', null, null, array[t.u('C4')]);
  perform public.grade_exam_session((v_st ->> 'session_id')::uuid);
  perform t.ok(public.exam_session_view((v_st ->> 'session_id')::uuid) -> 'items' -> 0 ->> 'state' = 'pending',
               '(c) doğrudan notlama: karalamalı yanlış pending');
  perform t.as_admin();
  perform t.ok(exists (select 1 from audit.events e join public.exam_responses r on r.id::text = e.diff -> 'data' ->> 'exam_response_id'
                        where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'diagnosis.run'
                          and r.session_id = (v_st ->> 'session_id')::uuid and e.diff -> 'data' -> 'upload_ids' = jsonb_build_array(t.v('C4'))),
               '(c) doğrudan grade_exam_session da diagnosis.run atar');
  insert into public.exam_sessions (exam_id, enrollment_id, mode, status) values (t.u('X'), t.u('EA'), 'uploaded', 'grading') returning id into v_up;
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.finish_exam_session(%L)', v_up), 'OGR-EXAM-003%', 'yüklenen oturum finish ile bitirilmez');
  perform t.raises('select public.finish_exam_session(gen_random_uuid())', 'OGR-EXAM-001%', 'olmayan oturum');
  perform t.as_admin();
end $$;

rollback;
