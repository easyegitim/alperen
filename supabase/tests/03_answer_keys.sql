-- tests/03_answer_keys.sql — cevap anahtarı yalıtımı: secure.* yalnız fonksiyonlar; peek_answer_key ve set_exam_key yalnız
-- eğitmen/admin/worker; inferred/generated kaynakları yalnız worker; öğrenci soruları yalnız maskeli görünümlerle
-- görür (telifli sınavda soru ve şık metni yok; yanılgı etiketleri hiç yok); notlama anahtarı öğrenci oturumunda da okur.
begin;
\ir _fixture.sql
select t.add_outsiders();

do $$
declare
  v_exam uuid;
  v_cexam uuid;
  v_q uuid;
  v_bank uuid;
begin
  insert into public.exams (curriculum_id, course_id, kind, source, title, status, created_by)
  values (t.u('cur'), t.u('course'), 'published', 'instructor', 'Anahtar Denemesi', 'published', t.u('inst')) returning id into v_exam;
  insert into public.exam_questions (exam_id, no, kind, stem_text, options, skill_ids) values
    (v_exam, 1, 'mcq', '2 + 3 · 4 = ?', '[{"key":"A","text":"14","misconception_tag":null},{"key":"B","text":"20","misconception_tag":"t.a.isaret-hatasi"}]',
     array['t.mat.a']) returning id into v_q;
  insert into t.cfg values ('X', v_exam::text), ('Q1', v_q::text);
  insert into public.exam_questions (exam_id, no, kind, stem_text, skill_ids) values (v_exam, 2, 'numeric', '1/2 + 1/4 = ?', array['t.mat.a'])
  returning id into v_q;
  insert into t.cfg values ('Q2', v_q::text);
  insert into public.exam_questions (exam_id, no, kind, stem_text, skill_ids) values (v_exam, 3, 'open', 'Kanıtla.', array['t.mat.a'])
  returning id into v_q;
  insert into t.cfg values ('Q3', v_q::text);
  -- telifli yayınevi denemesi (yükleme): soru ve şık metni öğrenciye maskeli
  insert into public.exams (curriculum_id, course_id, kind, source, title, publisher, is_copyrighted, status)
  values (t.u('cur'), t.u('course'), 'deneme', 'uploaded', 'Yayınevi TYT 3', 'Yayınevi', true, 'ready') returning id into v_cexam;
  insert into public.exam_questions (exam_id, no, kind, stem_text, options, skill_ids)
  values (v_cexam, 1, 'mcq', 'Telifli soru metni', '[{"key":"A","text":"telifli şık"},{"key":"B","text":"telifli şık 2"}]', array['t.mat.a']);
  insert into t.cfg values ('CX', v_cexam::text);
  perform public.start_exam_session(v_exam, t.u('EA'), 'in_app');
  perform public.start_exam_session(v_cexam, t.u('EA'), 'uploaded');
  insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, content_hash, status)
  values (t.u('cur'), array['t.mat.a'], 'mcq', 'Banka sorusu', '[{"key":"A","text":"1","misconception_tag":null},{"key":"B","text":"2","misconception_tag":"t.a.isaret-hatasi"}]',
          'instructor', 'ak-bank-1', 'approved') returning id into v_bank;
  insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by) values (v_bank, 'A', 'Çözüm', 'verified', 'test');
  insert into t.cfg values ('BANK', v_bank::text);
end $$;

-- set_exam_key: eğitmen (sınavın sahibi) yazar; öğrenci/veli/bağsız eğitmen yazamaz; biçim ve kaynak denetimi
do $$
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.set_exam_key(%L, 'A')$q$, t.u('Q1')), 'OGR-AUTH-002%', 'öğrenci anahtar yazamaz');
  perform t.as_user(t.u('parent'));
  perform t.raises(format($q$select public.set_exam_key(%L, 'A')$q$, t.u('Q1')), 'OGR-AUTH-002%', 'veli anahtar yazamaz');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format($q$select public.set_exam_key(%L, 'A')$q$, t.u('Q1')), 'OGR-AUTH-002%', 'sınavla ilgisi olmayan eğitmen anahtar yazamaz');
  perform t.as_user(t.u('inst'));
  perform public.set_exam_key(t.u('Q1'), 'a');
  perform public.set_exam_key(t.u('Q2'), null, 0.75, 'uploaded', 0.9);
  perform t.raises(format($q$select public.set_exam_key(%L, 'F')$q$, t.u('Q1')), 'OGR-EXAM-005%', 'mcq anahtarı A–E olmalı');
  perform t.raises(format($q$select public.set_exam_key(%L)$q$, t.u('Q2')), 'OGR-EXAM-005%', 'numeric anahtar sayı ister');
  perform t.raises(format($q$select public.set_exam_key(%L, 'A')$q$, t.u('Q3')), 'OGR-EXAM-005%', 'açık uçlu soruya anahtar yazılmaz');
  perform t.raises(format($q$select public.set_exam_key(%L, 'B', null, 'inferred', 0.4)$q$, t.u('Q1')), 'OGR-EXAM-005%',
                   'eğitmen inferred kaynaklı anahtar yazamaz (yalnız worker)');
  perform t.as_service();
  perform public.set_exam_key(t.u('Q1'), 'A', null, 'inferred', 0.6);
  perform t.as_admin();
  perform t.ok((select k.correct_option = 'A' and k.source = 'inferred' from secure.exam_answer_keys k where k.exam_question_id = t.u('Q1'))
               and (select k.numeric_value = 0.75 from secure.exam_answer_keys k where k.exam_question_id = t.u('Q2')),
               'anahtarlar yazıldı (mcq büyük harfe çevrilir; worker inferred yazar)');
  perform t.ok(exists (select 1 from audit.events e where e.action = 'exam_key.set' and e.row_id = t.v('Q1') and not (e.diff ? 'correct_option')),
               'anahtar yazımı denetim izinde, değer olmadan');
end $$;

-- peek_answer_key: yalnız eğitmen/admin/worker
do $$
declare
  v_k jsonb;
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.peek_answer_key(%L)$q$, t.u('Q1')), 'OGR-AUTH-002%', 'öğrenci anahtarı göremez (peek)');
  perform t.as_user(t.u('parent'));
  perform t.raises(format($q$select public.peek_answer_key(%L)$q$, t.u('BANK')), 'OGR-AUTH-002%', 'veli anahtarı göremez (peek)');
  perform t.as_user(t.u('inst'));
  v_k := public.peek_answer_key(t.u('Q1'));
  perform t.ok(v_k ->> 'kind' = 'exam_question' and v_k ->> 'correct_option' = 'A', 'eğitmen sınav anahtarını görür');
  v_k := public.peek_answer_key(t.u('BANK'));
  perform t.ok(v_k ->> 'kind' = 'question' and v_k ->> 'correct_option' = 'A' and v_k ->> 'solution' = 'Çözüm', 'eğitmen soru bankası anahtarını görür');
  perform t.raises($q$select public.peek_answer_key(gen_random_uuid())$q$, 'OGR-KEY-001%', 'olmayan anahtar OGR-KEY-001');
  perform t.as_user(t.u('admin'));
  perform t.ok(public.peek_answer_key(t.u('Q2')) ->> 'numeric_value' = '0.75', 'admin anahtarı görür');
  perform t.as_admin();
  perform t.ok((select count(*) from audit.events e where e.action = 'answer_key.peek') = 3, 'her peek denetim izine yazılır');
  perform t.ok(not has_function_privilege('anon', 'public.peek_answer_key(uuid)', 'execute'), 'anon peek çağıramaz');
end $$;

-- maskeli görünümler: öğrenci exam_questions/questions tablolarını görmez; görünümde yanılgı etiketi ve telifli metin yok
do $$
declare
  v_opts jsonb;
begin
  perform t.ok(t.sees(t.u('elif'), 'select 1 from public.exam_questions') = 0, 'öğrenci exam_questions tablosunu doğrudan göremez');
  perform t.ok(t.sees(t.u('elif'), 'select 1 from public.questions') = 0, 'öğrenci questions tablosunu doğrudan göremez');
  perform t.ok(t.sees(t.u('elif'), format('select 1 from public.v_exam_questions_student q where q.exam_id = %L', t.u('X'))) = 3,
               'öğrenci oturumu olan sınavın sorularını görünümle görür');
  perform t.ok(t.sees(t.u('can'), format('select 1 from public.v_exam_questions_student q where q.exam_id = %L', t.u('X'))) = 0,
               'oturumu olmayan öğrenci soruları göremez');
  perform t.as_user(t.u('elif'));
  select q.options into v_opts from public.v_exam_questions_student q where q.id = t.u('Q1');
  perform t.ok(jsonb_array_length(v_opts) = 2 and not exists (select 1 from jsonb_array_elements(v_opts) o where o ? 'misconception_tag')
               and v_opts -> 0 ->> 'text' = '14', 'şıklar metinle, yanılgı etiketi olmadan');
  perform t.ok((select q.stem_text is null and q.is_copyrighted and q.options = '[{"key":"A"},{"key":"B"}]'::jsonb
                  from public.v_exam_questions_student q where q.exam_id = t.u('CX')),
               'telifli sınavda soru metni null, şıklarda yalnız harf');
  select q.options into v_opts from public.v_questions_student q where q.id = t.u('BANK');
  perform t.ok(v_opts is not null and not exists (select 1 from jsonb_array_elements(v_opts) o where o ? 'misconception_tag'),
               'v_questions_student: onaylı banka sorusu, yanılgı etiketi yok');
  perform t.raises('select correct_option from secure.exam_answer_keys', '42501', 'öğrenci anahtar tablosuna erişemez');
  perform t.as_user(t.u('inst'));
  perform t.ok((select q.stem_text = 'Telifli soru metni' from public.exam_questions q where q.exam_id = t.u('CX')), 'eğitmen telifli metni tablodan görür');
  perform t.as_admin();
end $$;

-- grade_exam_session öğrenci oturumunda çalışır ve anahtarı okur; öğrenci sonuçtan anahtar tablosuna ulaşamaz
do $$
declare
  v_sess uuid;
  v_score jsonb;
begin
  select es.id into v_sess from public.exam_sessions es where es.exam_id = t.u('X') and es.enrollment_id = t.u('EA');
  perform t.as_user(t.u('elif'));
  perform public.record_exam_response(v_sess, t.u('Q1'), 'A');
  perform public.record_exam_response(v_sess, t.u('Q2'), '3/4');
  perform public.record_exam_response(v_sess, t.u('Q3'), 'Uzun cevap');
  v_score := public.grade_exam_session(v_sess);
  perform t.ok((v_score ->> 'correct')::int = 2 and (v_score ->> 'ungraded')::int = 1 and (v_score ->> 'unverified_keys')::int = 1,
               'öğrenci oturumu notlanır: 2 doğru (3/4 = 0.75), açık uçlu notlanmadı, doğrulanmamış (inferred) anahtar 1');
  perform t.as_admin();
end $$;

rollback;
