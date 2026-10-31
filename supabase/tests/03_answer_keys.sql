-- tests/03_answer_keys.sql — cevap anahtarı yalıtımı ve kilitleri (BLUEPRINT §3.4, §3.9, §9.1): secure şeması uygulama
-- rollerine kapalı, puanlama tek kapıdan, OGR-KEY-003 kilitleri, not_applicable anahtar önce görülmeden onaylanmaz.
begin;
\ir _fixture.sql

create function t.mk_question(p_source text, p_kind text, p_hash text) returns uuid language sql as $$
  insert into public.questions (curriculum_id, skill_ids, kind, stem, options, difficulty, source, content_hash, status)
  values (t.u('cur'), array['tyt.mat.temel.rasyonel-sayilar'], p_kind, 'Test sorusu: 3/4 + 1/8 kaçtır?',
          case when p_kind = 'mcq' then '[{"key":"A","text":"4/12","misconception_tag":"rasyonel.pay-payda-ayri-toplama"},
                                         {"key":"B","text":"7/8","misconception_tag":null},
                                         {"key":"C","text":"4/8","misconception_tag":"rasyonel.payda-esitlemeden-toplama"},
                                         {"key":"D","text":"3/32","misconception_tag":null}]'::jsonb end,
          0.5, p_source, p_hash, 'draft')
  returning id
$$;
grant execute on function t.mk_question(text, text, text) to public;

-- secure şeması: bot_runtime, batch_worker, authenticated, anon → permission denied for schema secure
do $$
begin
  perform t.as_bot(t.u('A'));
  perform t.raises('select * from secure.answer_keys', 'permission denied for schema secure%', 'bot_runtime secure.answer_keys');
  perform t.as_batch();
  perform t.raises('select * from secure.answer_keys', 'permission denied for schema secure%', 'batch_worker secure.answer_keys');
  perform t.raises('select * from secure.student_pii', 'permission denied for schema secure%', 'batch_worker secure.student_pii');
  perform t.as_staff(t.u('coord'));
  perform t.raises('select * from secure.answer_keys', 'permission denied for schema secure%', 'authenticated (koordinatör) secure.answer_keys');
  perform t.as_anon();
  perform t.raises('select * from secure.answer_keys', 'permission denied for schema secure%', 'anon secure.answer_keys');
  perform t.as_admin();
end $$;
do $$ begin perform t.as_bot(t.u('A')); perform * from secure.answer_keys; raise exception 'FAIL: secure okundu';
exception when insufficient_privilege then perform t.ok(true, 'insufficient_privilege (42501) ile reddedildi'); end $$;
reset role;

-- LLM yolu: register_answer_key durum makinesi, kilitler ve audit
do $$
declare
  v_q uuid;
  v_q2 uuid;
  v_qn uuid;
  v_diag uuid;
  v_written text;
  v_audit jsonb;
begin
  v_q := t.mk_question('llm', 'mcq', 'test-llm-1');
  perform t.as_batch();
  perform public.register_answer_key(v_q, '{"correct_option":"B","numeric_value":"7/8","canonical_expr":"Rational(3,4)+Rational(1,8)","solution":"Paydaları 8de eşitle: 6/8 + 1/8 = 7/8.","sympy_status":"verified"}');
  perform t.as_admin();
  perform t.ok((select q.status from public.questions q where q.id = v_q) = 'pending_review', 'verified anahtar: draft → pending_review');
  perform t.ok((select k.written_by from secure.answer_keys k where k.question_id = v_q) = 'batch_worker:tablet', 'written_by = batch_worker:tablet');
  -- 'register_answer_key writes audit' — anahtar değeri audit'e yazılmaz
  select ev.diff into v_audit from audit.events ev where ev.action = 'RPC:register_answer_key' and ev.row_id = v_q::text;
  perform t.ok(v_audit is not null and not (v_audit ? 'correct_option') and not (v_audit ? 'numeric_value') and v_audit ->> 'sympy_status' = 'verified',
               'register_answer_key writes audit (anahtar değeri yok)');
  perform t.ok((select count(*) from audit.events ev where ev.action = 'RPC:register_answer_key' and ev.row_id = v_q::text) = 1, 'tek audit satırı');
  -- onaylanan sorunun anahtarı batch_worker için kilitli
  perform t.as_staff(t.u('inst_a'));
  perform public.approve_question(v_q, 'approved', null);
  perform t.as_batch();
  perform t.raises(format('select public.register_answer_key(%L, %L)', v_q, '{"correct_option":"A","solution":"yanlış anahtar denemesi","sympy_status":"verified"}'),
                   'OGR-KEY-003%', 'approved question key is immutable');
  perform t.as_admin();
  perform t.ok((select k.correct_option from secure.answer_keys k where k.question_id = v_q) = 'B', 'onaylı sorunun anahtarı değişmedi');

  -- numeric + not_applicable → failed: soru rejected, anahtar silinir
  v_qn := t.mk_question('llm', 'numeric', 'test-llm-num');
  perform t.as_batch();
  perform public.register_answer_key(v_qn, '{"numeric_value":"7/8","solution":"Paydaları eşitle ve topla: 7/8.","sympy_status":"not_applicable"}');
  perform t.as_admin();
  perform t.ok((select q.status from public.questions q where q.id = v_qn) = 'rejected', 'not_applicable downgraded to failed for numeric → rejected');
  perform t.ok(not exists (select 1 from secure.answer_keys k where k.question_id = v_qn), 'başarısız anahtar DB''de kalmaz');

  -- yalnız LLM/şablon kaynaklı soru; eğitmen sorusu kilitli; rol denetimi
  v_q2 := t.mk_question('instructor', 'mcq', 'test-instr-1');
  perform t.as_batch();
  perform t.raises(format('select public.register_answer_key(%L, %L)', v_q2, '{"correct_option":"B","solution":"Eğitmen sorusu çözümü.","sympy_status":"verified"}'),
                   'OGR-KEY-003%', 'source=instructor soruya batch anahtarı yazamaz');
  perform t.raises(format('select public.register_answer_key(%L, %L)', v_q2, '{"correct_option":"B","solution":"xxxxxxxxxx","sympy_status":"maybe"}'),
                   'OGR-KEY-002%', 'geçersiz sympy_status OGR-KEY-002');
  perform t.as_bot(t.u('A'));
  perform t.raises(format('select public.register_answer_key(%L, %L)', v_q2, '{}'), 'permission denied%', 'bot_runtime register_answer_key yetkisiz');
  perform t.claims_only('bot_runtime');
  perform t.raises(format('select public.register_answer_key(%L, %L)', v_q2, '{"sympy_status":"verified"}'), 'OGR-KEY-001%', 'gövde: yalnız batch_worker (OGR-KEY-001)');
  perform t.as_admin();

  -- 'batch_worker cannot overwrite seed key' (teşhis sorusu, written_by='seed')
  select q.id into v_diag from public.questions q join secure.answer_keys k on k.question_id = q.id
   where q.source = 'diagnostic' and k.written_by = 'seed' limit 1;
  if v_diag is not null then
    select k.written_by || ':' || k.correct_option into v_written from secure.answer_keys k where k.question_id = v_diag;
    perform t.as_batch();
    perform t.raises(format('select public.register_answer_key(%L, %L)', v_diag, '{"correct_option":"D","solution":"üzerine yazma denemesi","sympy_status":"verified"}'),
                     'OGR-KEY-003%', 'batch_worker cannot overwrite seed key');
    perform t.as_admin();
    perform t.ok((select k.written_by || ':' || k.correct_option from secure.answer_keys k where k.question_id = v_diag) = v_written,
                 'seed anahtarı değişmedi');
  else
    raise notice 'SKIP: no keys — batch_worker cannot overwrite seed key';
  end if;
end $$;

-- 'not_applicable key needs peek before approve'
do $$
declare
  v_q uuid;
  v_q3 uuid;
begin
  v_q := t.mk_question('llm', 'mcq', 'test-llm-sozel');
  perform t.as_batch();
  perform public.register_answer_key(v_q, '{"correct_option":"B","solution":"Sözel soru: B şıkkı metindeki tanıma uyar.","sympy_status":"not_applicable"}');
  perform t.as_admin();
  perform t.ok((select k.written_by = 'batch_worker:unverified' and k.sympy_status = 'not_applicable' from secure.answer_keys k where k.question_id = v_q),
               'sözel mcq not_applicable → written_by=batch_worker:unverified');
  perform t.as_staff(t.u('inst_a'));
  perform t.raises(format('select public.approve_question(%L, %L, null)', v_q, 'approved'), 'OGR-Q-003%', 'peek olmadan approve → OGR-Q-003');
  perform t.ok(public.peek_answer_key(v_q) ->> 'correct_option' = 'B', 'peek_answer_key anahtarı gösterir');
  perform public.approve_question(v_q, 'approved', 'anahtar kontrol edildi');
  perform t.as_admin();
  perform t.ok((select q.status from public.questions q where q.id = v_q) = 'approved', 'peek_answer_key sonrası aynı eğitmen onaylar');

  v_q3 := t.mk_question('llm', 'mcq', 'test-llm-sozel-2');
  perform t.as_batch();
  perform public.register_answer_key(v_q3, '{"correct_option":"D","solution":"Sözel soru: D şıkkı doğru.","sympy_status":"not_applicable"}');
  perform t.as_staff(t.u('inst_a'));
  perform public.peek_answer_key(v_q3);
  perform t.as_staff(t.u('inst_b'));
  perform t.raises(format('select public.approve_question(%L, %L, null)', v_q3, 'approved'), 'OGR-Q-003%', 'başka eğitmen (peek yok) → OGR-Q-003');
  perform t.as_staff(t.u('obs'));
  perform t.raises(format('select public.peek_answer_key(%L)', v_q3), 'OGR-AUTH-002%', 'gözlemci anahtarı göremez');
  perform t.as_admin();
  -- tetikleyici kapısı: ayar açılmadan doğrudan onay da düşer
  perform set_config('ogrenmen.reviewer', 'on', true);
  perform t.raises(format('update public.questions set status = %L where id = %L', 'approved', v_q3), 'OGR-Q-003%', 'questions_approve_guard OGR-Q-003 (key_peeked yok)');
  perform set_config('ogrenmen.reviewer', 'off', true);
end $$;

-- İnceleme ve şık kuralı tetikleyicileri
do $$
declare
  v_q uuid := t.mk_question('instructor', 'mcq', 'test-guard-1');
begin
  perform t.raises(format('update public.questions set status = %L where id = %L', 'pending_review', v_q), 'OGR-Q-004%',
                   'inceleme sütunu ayar olmadan değişmez (OGR-Q-004)');
  perform set_config('ogrenmen.reviewer', 'on', true);
  perform t.raises(format('update public.questions set status = %L where id = %L', 'approved', v_q), 'OGR-Q-001%', 'anahtarsız onay OGR-Q-001');
  update public.questions q set options = q.options - 3 where q.id = v_q;
  insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by) values (v_q, 'B', 'Eğitmen çözümü burada.', 'verified', 'staff:test');
  perform t.raises(format('update public.questions set status = %L where id = %L', 'approved', v_q), 'OGR-Q-002%', '3 şıklı soru onaylanamaz (OGR-Q-002)');
  perform t.raises(format('insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, content_hash, status) values (%L, %L, %L, %L, %L, %L, %L, %L)',
                          t.u('cur'), '{tyt.mat.temel.rasyonel-sayilar}', 'mcq', 'Doğrudan onaylı ekleme', '[]', 'instructor', 'test-direct-approved', 'approved'),
                   'OGR-Q-001%', 'before insert: anahtarsız approved satır yazılamaz');
  perform set_config('ogrenmen.reviewer', 'off', true);
  perform t.raises(format('insert into public.questions (curriculum_id, skill_ids, kind, stem, source, content_hash) values (%L, %L, %L, %L, %L, %L)',
                          t.u('cur'), '{tyt.mat.yok-boyle}', 'numeric', 'Olmayan kazanım', 'instructor', 'test-bad-skill'),
                   'OGR-CURR-001%', 'olmayan kazanım OGR-CURR-001');
end $$;

-- 'batch_worker cannot edit approved question' (ilke 4/7): onaylı soru ve doğrulanmış şekil batch rolüyle değişmez
do $$
declare
  v_q uuid := t.mk_question('instructor', 'mcq', 'test-content-lock');
  v_fig uuid := gen_random_uuid();
  v_n int;
begin
  insert into public.figures (id, tool, code, code_hash, alt_text, png_path, review_status)
  values (v_fig, 'matplotlib', 'print(1)', 'h-content-lock', 'Test şekli', 'figures/' || v_fig || '.png', 'verified');
  insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by)
  values (v_q, 'B', 'Eğitmen çözümü burada.', 'verified', 'staff:test');
  perform set_config('ogrenmen.reviewer', 'on', true);
  update public.questions q set status = 'approved', reviewed_at = now() where q.id = v_q;
  perform set_config('ogrenmen.reviewer', 'off', true);
  perform t.as_batch();
  update public.questions q set stem = 'DEGISTI', options = '[{"key":"A","text":"x","misconception_tag":null}]' where q.id = v_q;
  get diagnostics v_n = row_count;
  perform t.ok(v_n = 0, 'batch_worker cannot edit approved question (RLS: 0 satır)');
  update public.figures f set png_path = 'figures/baska.png' where f.id = v_fig;
  get diagnostics v_n = row_count;
  perform t.ok(v_n = 0, 'batch_worker doğrulanmış şeklin dosyasını değiştiremez (RLS: 0 satır)');
  perform t.as_admin();
  perform t.ok((select q.stem from public.questions q where q.id = v_q) = 'Test sorusu: 3/4 + 1/8 kaçtır?'
               and (select jsonb_array_length(q.options) from public.questions q where q.id = v_q) = 4
               and (select q.status from public.questions q where q.id = v_q) = 'approved', 'onaylı sorunun kökü ve 4 şıkkı aynı');
  -- ikinci kemer: RLS'i aşan sahip/tanımlayıcı yol da tetikleyiciye takılır
  perform t.raises(format('update public.questions set stem = %L where id = %L', 'DEGISTI', v_q), 'OGR-Q-006%',
                   'onaylı sorunun kökü RLS dışından da değişmez (OGR-Q-006)');
  perform t.raises(format('update public.questions set figure_id = %L where id = %L', v_fig, v_q), 'OGR-Q-006%',
                   'onaylı soruya şekil takılamaz (OGR-Q-006)');
  update public.questions q set difficulty = 0.6 where q.id = v_q;   -- içerik dışı sütun serbest
  perform t.ok((select q.difficulty from public.questions q where q.id = v_q) = 0.6, 'içerik dışı sütun (difficulty) güncellenebilir');
  -- taslak soruyu batch_worker düzenleyebilir
  v_q := t.mk_question('llm', 'mcq', 'test-content-draft');
  perform t.as_batch();
  update public.questions q set stem = 'Taslak kök' where q.id = v_q;
  get diagnostics v_n = row_count;
  perform t.ok(v_n = 1, 'batch_worker taslak soruyu düzenler');
  perform t.as_admin();
end $$;

-- Eksik anahtar biçimi: mcq'da doğru şık yoksa ne anahtar yazılır ne soru onaylanır
do $$
declare
  v_q uuid := t.mk_question('llm', 'mcq', 'test-key-shape');
  v_q2 uuid := t.mk_question('instructor', 'mcq', 'test-key-shape-2');
begin
  perform t.as_batch();
  perform t.raises(format('select public.register_answer_key(%L, %L)', v_q, '{"numeric_value":"7","solution":"Çözüm.","sympy_status":"verified"}'),
                   'OGR-KEY-005%', 'register_answer_key: mcq anahtarında doğru şık yoksa OGR-KEY-005');
  perform t.as_staff(t.u('inst_a'));
  perform t.raises(format('select public.set_answer_key(%L, %L)', v_q2, '{"numeric_value":"7","solution":"Çözüm."}'),
                   'OGR-KEY-005%', 'set_answer_key: mcq anahtarında doğru şık yoksa OGR-KEY-005');
  perform t.as_admin();
  insert into secure.answer_keys (question_id, correct_option, numeric_value, solution, sympy_status, written_by)
  values (v_q2, null, '7', 'Çözüm.', 'verified', 'staff:test');
  perform set_config('ogrenmen.reviewer', 'on', true);
  perform t.raises(format('update public.questions set status = %L where id = %L', 'approved', v_q2), 'OGR-Q-001%',
                   'doğru şıksız mcq anahtarıyla onay OGR-Q-001');
  perform set_config('ogrenmen.reviewer', 'off', true);
end $$;

-- Puanlama tek kapı: bot attempts'i güncelleyemez; dönüşte doğru şık yok; çözüm yalnız cevaptan sonra
do $$
declare
  v_q uuid := t.mk_question('instructor', 'mcq', 'test-grade-1');
  v_r jsonb;
begin
  insert into secure.answer_keys (question_id, correct_option, numeric_value, solution, sympy_status, written_by)
  values (v_q, 'B', '7/8', 'Paydaları 8''de eşitle: 6/8 + 1/8 = 7/8.', 'verified', 'staff:test');
  perform set_config('ogrenmen.reviewer', 'on', true);
  update public.questions q set status = 'approved' where q.id = v_q;
  perform set_config('ogrenmen.reviewer', 'off', true);
  perform t.as_bot(t.u('A'));
  perform t.ok(public.reveal_solution(t.u('EA'), v_q) is null, 'reveal_solution cevap verilmeden null');
  select to_jsonb(g) into v_r from public.grade_attempt(t.u('EA'), v_q, '{"key":"A"}', 'practice', null, 1200) g;
  perform t.ok(not (v_r ? 'correct_option') and (v_r ->> 'is_correct')::boolean = false
               and v_r ->> 'misconception_tag' = 'rasyonel.pay-payda-ayri-toplama' and v_r::text not like '%"B"%',
               'grade_attempt dönüşünde correct_option yok; yanlış şıkkın etiketi döner');
  perform t.raises('update public.attempts set is_correct = true', 'permission denied%', 'bot update attempts set is_correct → reddedilir');
  perform t.ok(public.reveal_solution(t.u('EA'), v_q) like 'Paydaları 8%', 'reveal_solution cevaptan sonra çözüm metni (correct_option yok)');
  perform t.as_admin();
  perform t.raises(format('insert into public.attempts (enrollment_id, question_id, context, chosen, is_correct) values (%L, %L, %L, %L, true)',
                          t.u('EA'), v_q, 'practice', '{"key":"B"}'), 'OGR-GRADE-001%', 'attempts_protect_graded: is_correct yalnız grade_attempt');
  perform t.raises(format('update public.attempts set is_correct = true where question_id = %L', v_q), 'OGR-GRADE-001%', 'attempts_protect_graded: güncelleme de reddedilir');
end $$;

rollback;
