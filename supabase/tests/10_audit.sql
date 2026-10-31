-- tests/10_audit.sql — denetim izi (BLUEPRINT §3.6, §9.1): onay/ret, bayrak, peek_answer_key, reveal_solution,
-- student_full_name, mint/redeem; audit_row tetikleyicileri PII değerlerini yazmaz (secure'da yalnız alan adları).
begin;
\ir _fixture.sql

do $$
declare
  v_q uuid;
  v_code text;
  v_br bigint;
  v_diff jsonb;
begin
  insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, content_hash, status)
  values (t.u('cur'), array['tyt.mat.temel.rasyonel-sayilar'], 'mcq', 'Denetim sorusu: 1/2 + 1/2 = ?',
          '[{"key":"A","text":"1","misconception_tag":null},{"key":"B","text":"2/4","misconception_tag":"rasyonel.pay-payda-ayri-toplama"},
            {"key":"C","text":"1/4","misconception_tag":null},{"key":"D","text":"2","misconception_tag":null}]', 'llm', 'audit-q', 'pending_review')
  returning id into v_q;
  insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by) values (v_q, 'A', 'İki yarım bir bütün eder.', 'verified', 'batch_worker:tablet');
  -- peek + approve (RPC satırı + tetikleyici satırı)
  perform t.as_staff(t.u('inst_a'));
  perform public.peek_answer_key(v_q);
  perform public.approve_question(v_q, 'approved', null);
  perform t.as_admin();
  perform t.ok(exists (select 1 from audit.events ev where ev.action = 'RPC:peek_answer_key' and ev.row_id = v_q::text and ev.actor_id = 'staff:' || t.v('inst_a')),
               'peek_answer_key audit (staff:<uuid>)');
  perform t.ok(exists (select 1 from audit.events ev where ev.action = 'RPC:approve_question' and ev.row_id = v_q::text and ev.diff ->> 'decision' = 'approved'),
               'approve_question audit');
  select ev.diff into v_diff from audit.events ev where ev.action = 'UPDATE' and ev.table_name = 'public.questions' and ev.row_id = v_q::text;
  perform t.ok(v_diff #>> '{status,old}' = 'pending_review' and v_diff #>> '{status,new}' = 'approved', 'questions(status) audit_row eski/yeni');
  -- reveal_solution
  perform t.as_bot(t.u('A'));
  perform public.grade_attempt(t.u('EA'), v_q, '{"key":"A"}', 'practice', null, 1);
  perform public.reveal_solution(t.u('EA'), v_q);
  perform t.as_admin();
  perform t.ok(exists (select 1 from audit.events ev where ev.action = 'RPC:reveal_solution' and ev.row_id = v_q::text), 'reveal_solution audit');
  perform t.ok(exists (select 1 from audit.events ev where ev.action = 'RPC:grade_attempt' and ev.diff ? 'correct'), 'grade_attempt audit (yalnız doğru/yanlış)');
  -- student_full_name, mint/redeem
  perform t.as_staff(t.u('coord'));
  perform public.student_full_name(t.u('A'));
  v_code := public.mint_guardian_code(t.u('B'), 'telegram');
  perform t.as_bot(null);
  perform public.redeem_guardian_code(v_code, 800000002, '{"chat_id":800000002,"message_id":1}');
  perform t.as_admin();
  perform t.ok(exists (select 1 from audit.events ev where ev.action = 'RPC:student_full_name' and ev.row_id = t.v('A')), 'student_full_name audit');
  perform t.ok(exists (select 1 from audit.events ev where ev.action = 'RPC:mint_guardian_code' and ev.row_id = t.v('B'))
               and exists (select 1 from audit.events ev where ev.action = 'RPC:redeem_guardian_code' and ev.row_id = t.v('B')), 'mint/redeem guardian code audit');
  perform t.ok(not exists (select 1 from audit.events ev where ev.diff::text like '%' || v_code || '%'), 'veli kodu audit''e yazılmaz');
  -- bayrak (eğitmen doğrudan günceller) → audit_row; prompt_text diff'e girmez
  insert into public.bot_responses (chat_id, student_id, purpose, response_text, prompt_text) values (700100001, t.u('A'), 'chat', 'Bir cevap', 'gizli prompt metni')
  returning id into v_br;
  perform t.as_staff(t.u('inst_a'));
  update public.bot_responses br set flagged = true, flag_reason = 'yanlış yönlendirme', flagged_by = t.u('inst_a'), flagged_at = now() where br.id = v_br;
  perform t.as_admin();
  select ev.diff into v_diff from audit.events ev where ev.table_name = 'public.bot_responses' and ev.row_id = v_br::text and ev.action = 'UPDATE';
  perform t.ok(v_diff #>> '{flagged,new}' = 'true' and v_diff::text not like '%gizli prompt%', 'bot_responses(flagged) audit; prompt yok');
  -- secure.student_pii: yalnız alan adları
  perform t.as_staff(t.u('inst_a'));
  perform public.update_student_pii(t.u('A'), '{"guardian_name":"Fatma Kaya","school":"Örnek Lisesi"}');
  perform t.as_admin();
  select ev.diff into v_diff from audit.events ev where ev.table_name = 'secure.student_pii' and ev.action = 'UPDATE' and ev.row_id = t.v('A') order by ev.id desc limit 1;
  perform t.ok(v_diff -> 'fields' ? 'guardian_name' and v_diff -> 'fields' ? 'school' and v_diff::text not like '%Fatma%' and v_diff::text not like '%Örnek%',
               'secure.student_pii audit yalnız alan adları (değer yok)');
  perform t.ok((select ev.diff from audit.events ev where ev.action = 'RPC:update_student_pii' order by ev.id desc limit 1) @> '["guardian_name"]'::jsonb,
               'update_student_pii audit diff alan adları');
  perform t.ok(not exists (select 1 from audit.events ev where ev.diff::text like '%Elif Kaya%' or ev.diff::text like '%Fatma Kaya%' or ev.diff::text like '%elif_k%'),
               'hiçbir audit diff''inde ad/kullanıcı adı yok');
  -- onay, personel ataması, bayraklar, saklama ayarı
  perform t.ok(exists (select 1 from audit.events ev where ev.table_name = 'public.consents' and ev.action = 'INSERT' and not (ev.diff ? 'evidence')),
               'consents audit (kanıt jsonb''si hariç)');
  perform t.ok(exists (select 1 from audit.events ev where ev.table_name = 'public.staff_students' and ev.action = 'INSERT'
                         and ev.row_id = t.v('inst_a') || ':' || t.v('A')), 'staff_students audit (bileşik anahtar)');
  perform t.as_staff(t.u('coord'));
  perform public.set_runtime_flag('research_enabled', 'true');
  update public.tg_chats c set group_auto_answer_min = 30 where c.chat_id = -100900100;
  perform t.ok((select count(*) from public.audit_recent(1000) a where a.action = 'RPC:set_runtime_flag') >= 1, 'audit_recent koordinatöre açık');
  perform t.as_admin();
  perform t.ok(exists (select 1 from audit.events ev where ev.table_name = 'public.runtime_flags' and ev.row_id = 'research_enabled' and ev.action = 'UPDATE'),
               'runtime_flags audit_row');
  perform t.ok(exists (select 1 from audit.events ev where ev.table_name = 'public.tg_chats' and ev.row_id = '-100900100' and ev.diff ? 'group_auto_answer_min'),
               'tg_chats(group_auto_answer_min) audit');
  perform t.as_staff(t.u('inst_a'));
  perform t.raises('select * from public.audit_recent(10)', 'OGR-AUTH-002%', 'audit_recent eğitmene kapalı');
  perform t.raises('select * from audit.events', 'permission denied for schema audit%', 'audit şeması doğrudan okunamaz');
  perform t.as_admin();
end $$;

rollback;
