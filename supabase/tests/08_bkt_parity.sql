-- tests/08_bkt_parity.sql — BKT SQL paritesi: packages/mastery-math/fixtures/bkt-vectors.json'daki her vektör
-- app.bkt_step / app.blend_step / app.inferred_guess ile 1e-9 toleransla aynı sonucu verir (TS ve Python aynı dosyayı
-- geçer). Ayrıca public.apply_observation yolu (mastery.p numeric(6,5)) vektörlerle 1e-5 içinde; v2 ağırlığı
-- (w < 1 → p + w·(bkt − p)), guess_override, eğitmen karışımı, sohbet gözlemi, yanılgı sayacı, ön koşul çıkarımı ve
-- kanıt zinciri (OGR-EVID-001) service_role ile sınanır.
begin;
\ir _fixture.sql
insert into t.cfg values ('bkt', :'bkt_vectors');

do $$
declare
  v_doc jsonb := t.v('bkt')::jsonb;
  v_tol numeric := coalesce((v_doc ->> 'tolerance')::numeric, 1e-9);
  v_v jsonb;
  v_got numeric;
  v_n int := 0;
  v_bad text := '';
begin
  for v_v in select x.e from jsonb_array_elements(v_doc -> 'vectors') as x (e) loop
    if v_v ->> 'method' = 'bkt' then
      v_got := app.bkt_step((v_v ->> 'p')::numeric, (v_v ->> 'correct')::boolean, (v_v ->> 'g')::numeric, (v_v ->> 's')::numeric, (v_v ->> 't')::numeric);
    elsif v_v ->> 'method' = 'blend' then
      v_got := app.blend_step((v_v ->> 'p')::numeric, (v_v ->> 'm')::numeric, (v_v ->> 'c')::numeric);
    elsif v_v ->> 'method' = 'inferred' then
      perform t.ok(abs(app.inferred_guess((v_v ->> 'g_base')::numeric, (v_v ->> 'w')::numeric) - (v_v ->> 'g')::numeric) <= v_tol,
                   'vektör ' || (v_v ->> 'id') || ': inferred_guess(g_base, w) = g');
      v_got := app.bkt_step((v_v ->> 'p')::numeric, false, app.inferred_guess((v_v ->> 'g_base')::numeric, (v_v ->> 'w')::numeric),
                            (v_v ->> 's')::numeric, (v_v ->> 't')::numeric);
    else
      raise exception 'FAIL: bilinmeyen yöntem %', v_v ->> 'method';
    end if;
    if v_got is null or abs(v_got - (v_v ->> 'expected')::numeric) > v_tol then
      v_bad := v_bad || format(' #%s(%s≠%s)', v_v ->> 'id', v_got, v_v ->> 'expected');
    end if;
    v_n := v_n + 1;
  end loop;
  perform t.ok(v_n >= 41, 'bkt-vectors.json okundu (' || v_n || ' vektör)');
  perform t.ok(v_bad = '', 'tüm vektörler 1e-9 içinde' || v_bad);
  perform t.ok(app.bkt_step(0.99, true, 0.25, 0.1, 0.1) = 0.99 and app.bkt_step(0.01, false, 0.25, 0.1, 0.1) >= 0.01, 'kırpma [0.01, 0.99]');
end $$;

-- apply_observation yolu (kazanım parametreleri 0.30/0.10/0.25/0.10): worker (service_role) deneme + gözlem yazar
do $$
declare
  v_q uuid;
  v_att bigint;
  v_obs bigint;
  v_ec uuid;
  v_note uuid;
  v_p numeric;
begin
  insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, content_hash, status)
  values (t.u('cur'), array['t.mat.a'], 'mcq', 'Parite sorusu: 2 + 3 · 4 = ?',
          '[{"key":"A","text":"14","misconception_tag":null},{"key":"B","text":"20","misconception_tag":"t.a.isaret-hatasi"},
            {"key":"C","text":"24","misconception_tag":null},{"key":"D","text":"9","misconception_tag":null}]', 'instructor', 'bkt-parity-1', 'draft')
  returning id into v_q;
  insert into t.cfg values ('q', v_q::text);
  insert into public.enrollments (student_id, curriculum_id, course_id, period_label)
  values (t.u('A'), t.u('cur'), t.u('course'), 'YKS 2028') returning id into v_ec;
  insert into t.cfg values ('EC', v_ec::text);
end $$;

select t.as_service();
do $$
declare
  v_att bigint;
  v_obs bigint;
  v_p numeric;
  v_note uuid;
  v_hist record;
begin
  -- #1 doğru (EA, t.mat.a): 0.30 → 0.64607
  insert into public.attempts (enrollment_id, question_id, context, chosen) values (t.u('EA'), t.u('q'), 'practice', '{"key":"A"}') returning id into v_att;
  insert into public.observations (enrollment_id, skill_id, kind, value, source_type, source_id, source_locator)
  values (t.u('EA'), 't.mat.a', 'practice', 1, 'attempt', v_att::text, 'Parite · Soru 1') returning id into v_obs;
  perform public.apply_observation(v_obs);
  select m.p into v_p from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a';
  perform t.ok(abs(v_p - 0.6460674157) < 0.00001, 'apply_observation doğru: 0.30 → 0.64607 (vektör #1)');
  perform t.ok((select m.evidence_count from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a') = 1, 'kanıt sayısı 1');
  perform public.apply_observation(v_obs);
  perform t.ok((select count(*) from public.mastery_history h where h.observation_id = v_obs) = 1, 'aynı gözlem ikinci kez uygulanmaz');

  -- #3 yanlış + yanılgı etiketi (EB, t.mat.a): 0.30 → 0.14865; yanılgı satırı + ön koşul çıkarımı (t.mat.b)
  insert into public.attempts (enrollment_id, question_id, context, chosen) values (t.u('EB'), t.u('q'), 'practice', '{"key":"B"}') returning id into v_att;
  insert into public.observations (enrollment_id, skill_id, kind, value, source_type, source_id, source_locator, misconception_tag)
  values (t.u('EB'), 't.mat.a', 'practice', 0, 'attempt', v_att::text, 'Parite · Soru 1', 't.a.isaret-hatasi') returning id into v_obs;
  perform public.apply_observation(v_obs);
  select m.p into v_p from public.mastery m where m.enrollment_id = t.u('EB') and m.skill_id = 't.mat.a';
  perform t.ok(abs(v_p - 0.1486486486) < 0.00001, 'apply_observation yanlış: 0.30 → 0.14865 (vektör #3)');
  perform t.ok((select mc.evidence_count = 1 and mc.status = 'pending_review' from public.misconceptions mc
                 where mc.enrollment_id = t.u('EB') and mc.tag = 't.a.isaret-hatasi'), 'yanılgı satırı açıldı (pending_review, 1 kanıt)');
  perform t.ok(exists (select 1 from public.misconception_evidence me where me.observation_id = v_obs), 'yanılgı ↔ gözlem kanıt bağı');
  select h.* into v_hist from public.mastery_history h
    join public.observations o on o.id = h.observation_id
   where o.enrollment_id = t.u('EB') and o.skill_id = 't.mat.b' and o.kind = 'inferred';
  perform t.ok(v_hist.method = 'inferred'
               and abs(v_hist.p_after - app.bkt_step(0.3, false, app.inferred_guess(0.25, 0.5), 0.1, 0.1)) < 0.00001,
               'ön koşul çıkarımı t.mat.b: inferred, g'' = inferred_guess(0.25, 0.5)');
  perform t.ok((select m.evidence_count from public.mastery m where m.enrollment_id = t.u('EB') and m.skill_id = 't.mat.b') = 0,
               'çıkarım gözlemi kanıt sayısını artırmaz');

  -- v2 ağırlığı: careless/time teşhisi w = 0.5 (EA, t.mat.b doğru): p = 0.30 + 0.5·(0.64607 − 0.30)
  insert into public.attempts (enrollment_id, question_id, context, chosen) values (t.u('EA'), t.u('q'), 'practice', '{"key":"A"}') returning id into v_att;
  insert into public.observations (enrollment_id, skill_id, kind, value, weight, error_cause, source_type, source_id, source_locator)
  values (t.u('EA'), 't.mat.b', 'practice', 1, 0.5, 'careless', 'attempt', v_att::text, 'Ağırlık · Soru 2') returning id into v_obs;
  perform public.apply_observation(v_obs);
  select m.p into v_p from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.b';
  perform t.ok(abs(v_p - (0.3 + 0.5 * (0.6460674157 - 0.3))) < 0.00001, 'ağırlık 0.5: p = p0 + w·(bkt − p0) = 0.47303');
  perform t.ok((select (h.params ->> 'w')::numeric = 0.5 and h.params ->> 'error_cause' = 'careless'
                  from public.mastery_history h where h.observation_id = v_obs), 'mastery_history.params w ve error_cause taşır');

  -- guess_override 0.2 (deneme cevabı): EC, t.mat.a doğru
  insert into public.attempts (enrollment_id, question_id, context, chosen) values (t.u('EC'), t.u('q'), 'test', '{"key":"A"}') returning id into v_att;
  insert into public.observations (enrollment_id, skill_id, kind, value, guess_override, source_type, source_id, source_locator)
  values (t.u('EC'), 't.mat.a', 'test', 1, 0.2, 'attempt', v_att::text, 'Deneme · Soru 3') returning id into v_obs;
  perform public.apply_observation(v_obs);
  select m.p into v_p from public.mastery m where m.enrollment_id = t.u('EC') and m.skill_id = 't.mat.a';
  perform t.ok(abs(v_p - app.bkt_step(0.3, true, 0.2, 0.1, 0.1)) < 0.00001 and v_p > 0.6460674157,
               'guess_override 0.2: bkt_step(0.30, doğru, g = 0.2) (' || v_p || ')');

  -- eğitmen tahmini (c = 1.0): p + 0.30·c·(m − p) — EC, t.mat.b
  insert into public.instructor_notes (enrollment_id, author_id, skill_id, body, mastery_estimate)
  values (t.u('EC'), t.u('inst'), 't.mat.b', 'Kuralları biliyor.', 0.8) returning id into v_note;
  insert into public.observations (enrollment_id, skill_id, kind, value, confidence, source_type, source_id, source_locator)
  values (t.u('EC'), 't.mat.b', 'instructor', 0.8, 1.0, 'instructor_note', v_note::text, 'Eğitmen notu') returning id into v_obs;
  perform public.apply_observation(v_obs);
  perform t.ok((select abs(h.p_after - (0.3 + 1.0 * 0.30 * (0.8 - 0.3))) < 0.00001 and h.method = 'blend'
                  from public.mastery_history h where h.observation_id = v_obs), 'eğitmen tahmini (c = 1.0): p + 0.30·c·(m − p)');

  -- kanıt zinciri: olmayan deneme → OGR-EVID-001; yaprak olmayan kazanım → OGR-MAST-002
  perform t.raises($q$insert into public.observations (enrollment_id, skill_id, kind, value, source_type, source_id, source_locator)
                     values ('20000000-0000-4000-8000-0000000000ea', 't.mat.a', 'practice', 1, 'attempt', '999999999', 'yok')$q$,
                   'OGR-EVID-001%', 'kaynaksız gözlem reddedilir');
  perform t.raises($q$insert into public.observations (enrollment_id, skill_id, kind, value, source_type, source_id, source_locator)
                     values ('20000000-0000-4000-8000-0000000000ea', 't.mat.a', 'practice', 1, 'solution_analysis',
                             '00000000-0000-4000-8000-000000000000', 'yok')$q$,
                   'OGR-EVID-001%', 'olmayan solution_analysis kaynağı reddedilir');
end $$;

-- solution_analysis ve exam_response kaynakları (v2 source_type'ları) kanıt zincirinden geçer; sohbet gözlemi p'yi değiştirmez
do $$
declare
  v_sa uuid;
  v_exam uuid;
  v_eq uuid;
  v_sess uuid;
  v_resp uuid;
  v_obs bigint;
  v_p0 numeric;
  v_conv uuid;
  v_msg bigint;
begin
  insert into public.solution_analyses (enrollment_id, analysis, verdict, failing_step_no, error_cause, skill_ids)
  values (t.u('EB'), '{"steps":[]}', 'wrong', 2, 'procedure', array['t.mat.b']) returning id into v_sa;
  insert into public.observations (enrollment_id, skill_id, kind, value, error_cause, source_type, source_id, source_locator)
  values (t.u('EB'), 't.mat.b', 'practice', 0, 'procedure', 'solution_analysis', v_sa::text, 'Sor · teşhis') returning id into v_obs;
  perform public.apply_observation(v_obs);
  perform t.ok((select o.applied_at is not null from public.observations o where o.id = v_obs), 'solution_analysis kaynaklı gözlem uygulandı');

  insert into public.exams (curriculum_id, course_id, kind, source, title, question_count)
  values (t.u('cur'), t.u('course'), 'deneme', 'uploaded', 'Deneme 1', 1) returning id into v_exam;
  insert into public.exam_questions (exam_id, no, kind, skill_ids) values (v_exam, 1, 'mcq', array['t.mat.a']) returning id into v_eq;
  insert into public.exam_sessions (exam_id, enrollment_id, mode) values (v_exam, t.u('EB'), 'uploaded') returning id into v_sess;
  insert into public.exam_responses (session_id, exam_question_id, answer, outcome) values (v_sess, v_eq, 'C', 'wrong') returning id into v_resp;
  insert into public.observations (enrollment_id, skill_id, kind, value, guess_override, source_type, source_id, source_locator)
  values (t.u('EB'), 't.mat.a', 'test', 0, 0.2, 'exam_response', v_resp::text, 'Deneme 1 · Soru 1') returning id into v_obs;
  perform public.apply_observation(v_obs);
  perform t.ok((select o.applied_at is not null from public.observations o where o.id = v_obs), 'exam_response kaynaklı gözlem uygulandı');
  perform t.raises(format($q$insert into public.observations (enrollment_id, skill_id, kind, value, source_type, source_id, source_locator)
                            values (%L, 't.mat.a', 'test', 0, 'exam_response', %L, 'başka kayıt')$q$, t.u('EA'), v_resp),
                   'OGR-EVID-001%', 'başka kaydın deneme cevabı kaynak olamaz');

  insert into public.conversations (student_id, kind, participant_id) values (t.u('B'), 'coach', t.u('can')) returning id into v_conv;
  insert into public.conversation_messages (conversation_id, role, content)
  values (v_conv, 'user', '[{"type":"text","text":"eksiyi nasıl dağıtırım?"}]') returning id into v_msg;
  select m.p into v_p0 from public.mastery m where m.enrollment_id = t.u('EB') and m.skill_id = 't.mat.a';
  insert into public.observations (enrollment_id, skill_id, kind, misconception_tag, counts_for_mastery, source_type, source_id, source_locator)
  values (t.u('EB'), 't.mat.a', 'chat_misconception', 't.a.isaret-hatasi', false, 'message', v_msg::text, 'Koç · mesaj') returning id into v_obs;
  perform public.apply_observation(v_obs);
  perform t.ok((select m.p from public.mastery m where m.enrollment_id = t.u('EB') and m.skill_id = 't.mat.a') = v_p0,
               'sohbet gözlemi ustalığı değiştirmez');
  perform t.ok((select mc.evidence_count from public.misconceptions mc where mc.enrollment_id = t.u('EB') and mc.tag = 't.a.isaret-hatasi') >= 2,
               'sohbet yanılgısı yanılgı sayacına katılır');
end $$;

rollback;
