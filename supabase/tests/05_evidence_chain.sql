-- tests/05_evidence_chain.sql — kanıt zinciri şema kısıtıdır (BLUEPRINT §3.3, §3.7, §9.1): kaynaksız gözlem yok,
-- ders iddiası onaysız profile işlenmez, sohbet/çıkarım gözlemleri kanıt sayısını artırmaz, hafıza erişimi FTS'e düşer.
begin;
\ir _fixture.sql

create function t.vec(p_hot int, p_sign numeric default 1) returns text language sql immutable as $$
  select '[' || string_agg(case when g = p_hot then p_sign::text else '0' end, ',' order by g) || ']' from generate_series(1, 768) as g
$$;
grant execute on function t.vec(int, numeric) to public;

-- Kaynaksız / yanlış kayda bağlı gözlem → OGR-EVID-001; müfredat uyuşmazlığı → OGR-CURR-002
do $$
declare
  v_other uuid;
begin
  perform t.raises(format('insert into public.observations (enrollment_id, skill_id, kind, value, source_type, source_id, source_locator, created_by_role) '
                          'values (%L, %L, %L, 1, %L, %L, %L, %L)', t.u('EA'), 'tyt.mat.temel.sayilar', 'practice', 'attempt', '999999', 'yok', 'grader'),
                   'OGR-EVID-001%', 'kaynaksız insert → OGR-EVID-001');
  perform t.raises(format('insert into public.observations (enrollment_id, skill_id, kind, source_type, source_id, source_locator, created_by_role) '
                          'values (%L, %L, %L, %L, %L, %L, %L)', t.u('EB'), 'tyt.mat.temel.sayilar', 'chat_question', 'message', t.v('msg_a_q'), 'Sohbet', 'bot_runtime'),
                   'OGR-EVID-001%', 'başka öğrencinin mesajına bağlı gözlem → OGR-EVID-001');
  perform t.raises(format('insert into public.observations (enrollment_id, skill_id, kind, source_type, source_id, source_locator, created_by_role) '
                          'values (%L, %L, %L, %L, %L, %L, %L)', t.u('EA'), 'tyt.mat.temel.sayilar', 'chat_question', 'message', 'abc', 'Sohbet', 'bot_runtime'),
                   'OGR-EVID-001%', 'geçersiz kaynak kimliği → OGR-EVID-001');
  insert into public.curricula (code, authority, year, version, label, status) values ('TST-X', 'OTHER', 2026, '1', 'Başka', 'draft') returning id into v_other;
  perform t.raises(format('insert into public.observations (enrollment_id, curriculum_id, skill_id, kind, source_type, source_id, source_locator, created_by_role) '
                          'values (%L, %L, %L, %L, %L, %L, %L, %L)', t.u('EA'), v_other, 'tyt.mat.temel.sayilar', 'chat_question', 'message', t.v('msg_a_q'), 'x', 'bot_runtime'),
                   'OGR-CURR-002%', 'curriculum_id kayıtla uyuşmazsa OGR-CURR-002');
end $$;

-- Sohbet gözlemleri: p ve evidence_count değişmez; yanılgı sayacı artar (3 kanıtta open)
do $$
declare
  v_i int;
  v_mc record;
begin
  perform t.as_bot(t.u('A'));
  for v_i in 1..5 loop
    perform public.record_chat_observation(t.u('EA'), 'tyt.mat.temel.rasyonel-sayilar', 'chat_question', t.v('msg_a_q')::bigint, 'kesirleri nasıl toplarım', null);
  end loop;
  for v_i in 1..3 loop
    perform public.record_chat_observation(t.u('EA'), 'tyt.mat.temel.rasyonel-sayilar', 'chat_misconception', t.v('msg_a_q')::bigint,
                                           'payları ayrı topladım', 'rasyonel.pay-payda-ayri-toplama');
  end loop;
  perform t.raises(format('select public.record_chat_observation(%L, %L, %L, %s, %L, null)', t.u('EA'), 'tyt.mat.temel.rasyonel-sayilar', 'practice',
                          t.v('msg_a_q'), 'x'), 'OGR-OBS-001%', 'sohbet yolu yalnız chat_* gözlemi');
  perform t.as_admin();
  perform t.ok(not exists (select 1 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 'tyt.mat.temel.rasyonel-sayilar'),
               '8 sohbet gözlemi mastery satırı açmaz (p ve evidence_count değişmez)');
  perform t.ok((select count(*) from public.observations o where o.enrollment_id = t.u('EA') and o.kind like 'chat_%' and o.applied_at is not null
                  and not o.counts_for_mastery and o.source_locator like 'Sohbet · %') = 8, 'sohbet gözlemleri kaynaklı ve uygulanmış (counts_for_mastery=false)');
  select mc.* into v_mc from public.misconceptions mc where mc.enrollment_id = t.u('EA') and mc.tag = 'rasyonel.pay-payda-ayri-toplama';
  perform t.ok(v_mc.evidence_count = 3 and v_mc.status = 'open', 'chat_misconception ×3 → yanılgı open (misconception_open_evidence=3)');
  perform t.ok((select count(*) from public.misconception_evidence me where me.misconception_id = v_mc.id) = 3, 'yanılgı kanıt bağları');
  -- çözüldü işareti kanıt gözlemi ister (check kısıtı)
  perform t.raises(format('update public.misconceptions set status = %L where id = %L', 'resolved', v_mc.id), '23514', 'resolved → resolved_by + resolution_observation_id zorunlu');
  perform t.as_staff(t.u('inst_a'));
  perform public.resolve_misconception(v_mc.id, (select me.observation_id from public.misconception_evidence me where me.misconception_id = v_mc.id limit 1));
  perform t.as_admin();
  perform t.ok((select mc.status = 'resolved' and mc.resolved_by = t.u('inst_a') from public.misconceptions mc where mc.id = v_mc.id), 'resolve_misconception kanıtla');
  perform t.as_bot(t.u('A'));
  perform public.record_chat_observation(t.u('EA'), 'tyt.mat.temel.rasyonel-sayilar', 'chat_misconception', t.v('msg_a_q')::bigint, 'yine ayrı topladım', 'rasyonel.pay-payda-ayri-toplama');
  perform t.as_admin();
  perform t.ok((select mc.status from public.misconceptions mc where mc.id = v_mc.id) = 'pending_review'
               and (select count(*) from public.misconceptions mc where mc.enrollment_id = t.u('EA') and mc.tag = 'rasyonel.pay-payda-ayri-toplama') = 1,
               'çözülmüş yanılgıda yeni kanıt aynı satırı yeniden incelemeye açar');
end $$;

-- Ön koşul çıkarımı: inferred gözlem p'yi günceller ama evidence_count artırmaz; tek seviye
do $$
declare
  v_q uuid;
begin
  insert into public.questions (curriculum_id, skill_ids, kind, stem, options, difficulty, source, content_hash, status)
  values (t.u('cur'), array['tyt.mat.temel.rasyonel-sayilar'], 'mcq', 'Çıkarım sorusu: 1/3 + 1/6 kaçtır?',
          '[{"key":"A","text":"2/9","misconception_tag":"rasyonel.payda-esitlemeden-toplama"},{"key":"B","text":"1/2","misconception_tag":null},
            {"key":"C","text":"2/18","misconception_tag":"rasyonel.pay-payda-ayri-toplama"},{"key":"D","text":"1/18","misconception_tag":null}]',
          0.5, 'instructor', 'test-inferred-1', 'draft') returning id into v_q;
  insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by) values (v_q, 'B', '1/3 = 2/6; 2/6 + 1/6 = 3/6 = 1/2.', 'verified', 'staff:test');
  perform set_config('ogrenmen.reviewer', 'on', true);
  update public.questions q set status = 'approved' where q.id = v_q;
  perform set_config('ogrenmen.reviewer', 'off', true);
  perform t.as_bot(t.u('A'));
  perform public.grade_attempt(t.u('EA'), v_q, '{"key":"A"}', 'practice', null, 800);
  perform t.as_admin();
  perform t.ok((select count(*) from public.observations o where o.enrollment_id = t.u('EA') and o.kind = 'inferred'
                  and o.skill_id = 'tyt.mat.temel.ebob-ekok' and o.source_type = 'observation') = 1, 'payda-eşitlemeden etiketi → ebob-ekok çıkarım gözlemi');
  perform t.ok((select m.evidence_count = 0 and m.p < 0.3 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 'tyt.mat.temel.ebob-ekok'),
               'inferred: evidence_count 0, p düştü');
  perform t.ok((select mh.method from public.mastery_history mh where mh.enrollment_id = t.u('EA') and mh.skill_id = 'tyt.mat.temel.ebob-ekok') = 'inferred',
               'mastery_history yöntemi inferred');
  perform t.ok(not exists (select 1 from public.observations o where o.source_type = 'observation'
                             and o.source_id in (select x.id::text from public.observations x where x.kind = 'inferred')), 'çıkarım yeniden çıkarım üretmez');
end $$;

-- Ders raporu onaysız profile işlenmez: write_lesson_analysis yalnız taslak + bekleyen iddia; onay tek yol
do $$
declare
  v_lesson uuid;
  v_an uuid;
  v_claim uuid;
  v_dec jsonb;
  v_n int;
begin
  perform t.as_batch();
  v_lesson := public.register_lesson('s_aaaaaaaaaaaa', t.u('inst_a'), now() - interval '2 days', 90, 'local:test.mp4');
  v_an := public.write_lesson_analysis(v_lesson, '{"weak":[]}', '{
    "schema_version":"1.0","lesson_ref":"00000000-0000-0000-0000-000000000001","student_ref":"s_aaaaaaaaaaaa",
    "skills":[{"skill_id":"tyt.mat.temel.rasyonel-sayilar","mastery_estimate":0.6,"confidence":0.8,
               "evidence":[{"speaker":"ÖĞRENCİ","quote":"Paydaları eşitledim, 7/8 buldum.","t":"00:14:32"}]}],
    "questions":[{"t":"00:05:00","quote":"Bu neden böyle oluyor?","skill_id":null,"answered":true}],
    "hesitations":[{"t":"00:07:00","kind":"long_silence"}],
    "misconceptions":[{"tag":null,"skill_id":"tyt.mat.temel.rasyonel-sayilar","text_instructor":"Payı paydaya bölmeyi karıştırıyor.",
                       "text_student":"Pay ve payda yer değiştirmez.","evidence":[{"speaker":"ÖĞRENCİ","quote":"Önce paydayı paya böldüm.","t":"00:20:10"}]}],
    "commitments":[{"who":"ÖĞRENCİ","kind":"homework","text":"Öğrenci 10 kesir sorusu çözecek.","due":"2026-12-01","t":"00:40:00"}],
    "talk":{"student_ratio":0.4,"student_questions":3,"attention":"medium","morale":"low"},
    "previous_profile_check":[],"next_step":{"for_student":"Payda eşitleme pratiği","for_instructor":"Kesir modeliyle tekrar"},
    "model_notes":{"model":"fake","prompt_version":"lesson.v1","cost_usd":0.2,"tokens_in":1,"tokens_out":1}}', 'fake-lesson', 0.2);
  perform t.as_admin();
  perform t.ok((select count(*) from public.lesson_claims lc where lc.analysis_id = v_an) = 7 and
               (select count(*) from public.lesson_claims lc where lc.analysis_id = v_an and lc.kind = 'talk') = 1,
               'write_lesson_analysis: 7 iddia (talk tam 1)');
  perform t.ok(not exists (select 1 from public.observations o where o.source_type = 'lesson_claim'), 'analiz yazımı gözlem YAZMAZ');
  perform t.ok((select count(*) from public.instructor_alerts a where a.kind = 'ops' and a.ref ->> 'lesson_id' = v_lesson::text and a.status = 'open') = 1,
               'ops alarmı: Ders raporu onay bekliyor');
  select lc.id into v_claim from public.lesson_claims lc where lc.analysis_id = v_an and lc.kind = 'skill_mastery';
  perform t.raises(format('insert into public.observations (enrollment_id, skill_id, kind, value, source_type, source_id, source_locator, created_by_role) '
                          'values (%L, %L, %L, 0.6, %L, %L, %L, %L)', t.u('EA'), 'tyt.mat.temel.rasyonel-sayilar', 'lesson', 'lesson_claim', v_claim, 'Ders', 'instructor'),
                   'OGR-EVID-001%', 'onaysız (pending) ders iddiasına bağlı gözlem → OGR-EVID-001');
  perform t.raises(format('update public.lesson_claims set status = %L where id = %L', 'approved', v_claim), 'OGR-LESSON-003%', 'iddia durumu yalnız approve_lesson_analysis ile');
  perform t.as_staff(t.u('obs'));
  perform t.raises(format('select public.approve_lesson_analysis(%L, %L)', v_an, '[]'), 'OGR-AUTH-002%', 'gözlemci ders raporu onaylayamaz');
  perform t.as_staff(t.u('inst_a'));
  select jsonb_agg(case lc.kind
                     when 'misconception' then jsonb_build_object('claim_id', lc.id, 'status', 'edited',
                                                                  'edited_value', jsonb_build_object('text', 'Pay ile paydayı karıştırıyor.', 'text_student', 'Pay üstte, payda altta kalır.'))
                     when 'hesitation' then jsonb_build_object('claim_id', lc.id, 'status', 'rejected')
                     else jsonb_build_object('claim_id', lc.id, 'status', 'approved') end)
    into v_dec from public.lesson_claims lc where lc.analysis_id = v_an;
  v_n := public.approve_lesson_analysis(v_an, v_dec);
  perform t.raises(format('select public.approve_lesson_analysis(%L, %L)', v_an, '[]'), 'OGR-LESSON-001%', 'ikinci karar OGR-LESSON-001');
  perform t.as_admin();
  perform t.ok(v_n = 4, 'uygulanan iddia sayısı 4 (kazanım, yanılgı, ödev, konuşma) — ' || v_n);
  perform t.ok((select count(*) from public.observations o join public.lesson_claims lc on lc.id::text = o.source_id
                 where o.source_type = 'lesson_claim' and lc.analysis_id = v_an and o.kind = 'lesson') = 2, 'onaylı iddialardan lesson gözlemleri');
  perform t.ok((select abs(mh.p_after - (mh.p_before + 0.24 * (0.6 - mh.p_before))) < 0.00001 and (mh.params ->> 'w')::numeric = 0.24
                  from public.mastery_history mh where mh.enrollment_id = t.u('EA') and mh.skill_id = 'tyt.mat.temel.rasyonel-sayilar' and mh.method = 'blend' and (mh.params ->> 'm')::numeric = 0.6),
               'ders karışımı p = p + 0.3·c·(m − p), w = 0.24');
  perform t.ok((select m.evidence_count from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 'tyt.mat.temel.rasyonel-sayilar') = 3,
               'ders gözlemleri kanıt sayısını artırır (pratik 1 + ders 2)');
  perform t.ok((select count(*) from public.misconceptions mc where mc.enrollment_id = t.u('EA') and mc.tag is null and mc.status = 'open'
                  and mc.text_instructor = 'Pay ile paydayı karıştırıyor.') = 1, 'etiketsiz yanılgı düzeltilmiş metniyle kaybolmaz');
  perform t.ok((select count(*) from public.memory_facts f where f.student_id = t.u('A') and f.kind = 'deadline' and f.valid_until = '2026-12-01'
                  and f.source_lesson_claim_id is not null and f.embedding is null) = 1, 'ödev iddiası → deadline olgusu (kaynak iddia, gömme boş)');
  perform t.ok((select f.morale_signal from public.memory_facts f where f.student_id = t.u('A') and f.kind = 'morale') = -2, 'talk morale=low → morale_signal −2');
  perform t.ok((select la.status from public.lesson_analyses la where la.id = v_an) = 'corrected' and (select l.status from public.lessons l where l.id = v_lesson) = 'corrected',
               'düzeltmeli karar → analiz ve ders corrected');
  perform t.ok((select a.status from public.instructor_alerts a where a.kind = 'ops' and a.ref ->> 'lesson_id' = v_lesson::text) = 'done', 'ops alarmı kapandı');
end $$;

-- 'retrieve_memory ranks null-embedding facts by fts only'
do $$
declare
  v_q text := t.vec(1);
  v_rows jsonb;
  v_null bigint;
begin
  insert into public.memory_facts (student_id, kind, text, source_message_ids, embedding, created_at)
  values (t.u('A'), 'other', 'Ödev teslimi cuma günü yapılacak.', array[t.v('msg_a_q')::bigint], null, now() - interval '3 days')
  returning id into v_null;
  insert into public.memory_facts (student_id, kind, text, source_message_ids, embedding, created_at) values
    (t.u('A'), 'topic_asked', 'Öğrenci üslü sayıları sordu.', array[t.v('msg_a_q')::bigint], t.vec(1)::halfvec, now() - interval '1 day'),
    (t.u('A'), 'preference', 'Öğrenci kısa açıklamaları seviyor.', array[t.v('msg_a_q')::bigint], t.vec(2)::halfvec, now() - interval '2 days');
  insert into public.memory_facts (student_id, kind, text, source_message_ids, requires_approval, approved)
  values (t.u('A'), 'instructor_fact', 'Ödev notu 70.', array[t.v('msg_a_q')::bigint], true, false);
  perform t.as_bot(t.u('A'));
  select jsonb_agg(jsonb_build_object('id', m.fact_id, 'score', m.score)) into v_rows from public.retrieve_memory(v_q::halfvec, 'ödev teslimi', 10) m;
  perform t.ok((select bool_and(e ->> 'score' is not null) from jsonb_array_elements(v_rows) e), 'skorlar NULL değil (NULLS FIRST hatası yok)');
  perform t.ok((v_rows -> 1 ->> 'id')::bigint = v_null and (v_rows -> 1 ->> 'score')::numeric > 0,
               'embedding''siz olgu p_text eşleşince FTS payıyla yukarı çıkar (2. sıra)');
  select jsonb_agg(jsonb_build_object('id', m.fact_id, 'score', m.score)) into v_rows from public.retrieve_memory(v_q::halfvec, 'üçgen alanı', 10) m;
  perform t.ok((v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'id')::bigint = v_null and (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'score')::numeric < 0.000001,
               'eşleşmezse embedding''siz olgu listenin sonunda (skor ≈ 0, NULL değil)');
  select jsonb_agg(m.fact_id) into v_rows from public.retrieve_memory(null, 'ödev teslimi', 10) m;
  perform t.ok((v_rows ->> 0)::bigint = v_null, 'p_query null → yalnız FTS sıralaması');
  perform t.ok((select count(*) from public.retrieve_memory(null, 'ödev notu', 10) m where m.text = 'Ödev notu 70.') = 0, 'onay gerektiren olgu onaysızken gelmez');
  perform t.as_admin();
end $$;

rollback;
