-- tests/06_grading.sql — puanlama ve pratik seti (BLUEPRINT §3.7, §3.9, §10.4). Dosya KENDİ şablon fikstürünü (6 şablon × 2
-- = 12 soru, source='template', anahtar batch_worker:template/verified) postgres olarak ekler: M06'ya bağımlılık yok.
-- Teşhis vakaları seed-keys.py anahtarlarını ister (:have_keys; yoksa SKIP: no keys).
begin;
\ir _fixture.sql

\if :have_content
-- Şablon fikstürü: her şablondan 2 soru; şekilli şablonlarda doğrulanmış şekil
do $$
declare
  v_t record;
  v_i int;
  v_fig uuid;
  v_q uuid;
  v_tag text;
begin
  perform set_config('ogrenmen.reviewer', 'on', true);
  for v_t in select qt.* from public.question_templates qt where qt.curriculum_id = t.u('cur') order by qt.id loop
    select mt.tag into v_tag from public.misconception_tags mt where mt.skill_id = v_t.skill_id order by mt.tag limit 1;
    for v_i in 1..2 loop
      v_fig := null;
      if v_t.has_figure then
        insert into public.figures (tool, code, code_hash, alt_text, png_path, width_px, height_px, render_status, vision_status, review_status, reviewed_at)
        values ('template', '# ' || v_t.id || ' ' || v_i, md5(v_t.id || v_i), 'Şablon şekli: ' || v_t.id || ' varyant ' || v_i,
                'figures/' || md5(v_t.id || v_i) || '.png', 800, 400, 'rendered', 'not_applicable', 'verified', now())
        returning id into v_fig;
      end if;
      insert into public.questions (curriculum_id, skill_ids, kind, stem, figure_id, options, difficulty, source, template_id, template_params,
                                    content_hash, verification, status)
      values (t.u('cur'), array[v_t.skill_id], 'mcq', 'Şablon sorusu ' || v_t.id || ' #' || v_i, v_fig,
              jsonb_build_array(jsonb_build_object('key', 'A', 'text', 'doğru', 'misconception_tag', null),
                                jsonb_build_object('key', 'B', 'text', 'çeldirici', 'misconception_tag', v_tag),
                                jsonb_build_object('key', 'C', 'text', 'hesap hatası', 'misconception_tag', null),
                                jsonb_build_object('key', 'D', 'text', 'çeldirici 2', 'misconception_tag', null)),
              0.5, 'template', v_t.id, jsonb_build_object('variant', v_i), 'tpl-test-' || v_t.id || '-' || v_i,
              '{"schema":true,"sympy":"verified","render":"ok","vision":"not_applicable","attempts":0}', 'draft')
      returning id into v_q;
      insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by, verified_at)
      values (v_q, 'A', 'Şablon çözümü: A şıkkı SymPy ile doğrulandı.', 'verified', 'batch_worker:template', now());
      update public.questions q set status = 'approved', reviewed_at = now() where q.id = v_q;
    end loop;
  end loop;
  perform set_config('ogrenmen.reviewer', 'off', true);
  perform t.ok((select count(*) from public.questions q where q.source = 'template' and q.status = 'approved' and q.content_hash like 'tpl-test-%') = 12,
               'şablon fikstürü: 12 onaylı şablon sorusu (6 şablon × 2)');
  -- öğrenciye gitmemesi gerekenler: onaylı LLM sorusu ve şekli doğrulanmamış şablon sorusu
  insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, content_hash, status)
  values (t.u('cur'), array['tyt.mat.temel.sayilar'], 'mcq', 'LLM sorusu (pilotta öğrenciye gitmez)',
          '[{"key":"A","text":"1","misconception_tag":null},{"key":"B","text":"2","misconception_tag":null},{"key":"C","text":"3","misconception_tag":null},{"key":"D","text":"4","misconception_tag":null}]',
          'llm', 'tpl-test-llm', 'draft') returning id into v_q;
  insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by) values (v_q, 'A', 'LLM çözümü, doğrulanmış.', 'verified', 'batch_worker:tablet');
  insert into public.figures (tool, code, code_hash, alt_text, review_status) values ('matplotlib', 'x', 'pending-fig', 'Doğrulanmamış şekil açıklaması', 'pending') returning id into v_fig;
  insert into public.questions (curriculum_id, skill_ids, kind, stem, figure_id, options, source, template_id, content_hash, status)
  values (t.u('cur'), array['tyt.mat.temel.sayilar'], 'mcq', 'Şekli onaysız şablon sorusu', v_fig,
          '[{"key":"A","text":"1","misconception_tag":null},{"key":"B","text":"2","misconception_tag":null},{"key":"C","text":"3","misconception_tag":null},{"key":"D","text":"4","misconception_tag":null}]',
          'template', 'islem-onceligi', 'tpl-test-pendingfig', 'draft');
  perform set_config('ogrenmen.reviewer', 'on', true);
  update public.questions q set status = 'approved' where q.content_hash = 'tpl-test-llm';
  perform t.raises('update public.questions set status = ''approved'' where content_hash = ''tpl-test-pendingfig''', 'OGR-Q-001%', 'şekli doğrulanmamış soru onaylanamaz');
  perform set_config('ogrenmen.reviewer', 'off', true);
end $$;

-- 'next_practice_items returns 10 template items'
do $$
declare
  v_ids uuid[];
  v_skills text[];
begin
  perform t.as_bot(t.u('B'));
  select array_agg(n.question_id), array_agg(n.skill_id) into v_ids, v_skills from public.next_practice_items(t.u('EB'), 10) n;
  perform t.as_admin();
  perform t.ok(cardinality(v_ids) = 10, 'next_practice_items returns 10 template items (' || cardinality(v_ids) || ')');
  perform t.ok((select bool_and(q.source in ('template', 'instructor')) from public.questions q where q.id = any(v_ids)), 'yalnız source in (template, instructor)');
  perform t.ok(not exists (select 1 from public.questions q where q.id = any(v_ids) and q.content_hash in ('tpl-test-llm', 'tpl-test-pendingfig')),
               'LLM sorusu ve doğrulanmamış şekilli soru seçilmez');
  perform t.ok((select count(distinct s) from unnest(v_skills[1:6]) s) = 6, 'kazanımlar arasında dönüşümlü (ilk 6 satır 6 farklı kazanım)');
  perform t.as_bot(t.u('B'));
  perform t.ok(not exists (select 1 from public.next_practice_items(t.u('EB'), 10) n, jsonb_array_elements(n.options) o where o ? 'misconception_tag'),
               'pratik şıkları etiketsiz');
  perform t.as_admin();
end $$;

-- 'grade without key raises OGR-GRADE-004' ve diğer puanlama kapıları
do $$
declare
  v_q uuid := (select q.id from public.questions q where q.content_hash = 'tpl-test-islem-onceligi-1');
  v_draft uuid := (select q.id from public.questions q where q.content_hash = 'tpl-test-pendingfig');
  v_sess uuid := gen_random_uuid();
begin
  perform t.as_bot(t.u('B'));
  perform public.grade_attempt(t.u('EB'), v_q, '{"key":"A"}', 'practice', v_sess, 500);
  perform t.raises(format('select * from public.grade_attempt(%L, %L, %L, %L, %L, 1)', t.u('EB'), v_q, '{"key":"A"}', 'practice', v_sess), 'OGR-GRADE-002%',
                   'aynı oturumda ikinci cevap OGR-GRADE-002');
  perform t.raises(format('select * from public.grade_attempt(%L, %L, %L, %L, null, 1)', t.u('EB'), v_draft, '{"key":"A"}', 'practice'), 'OGR-GRADE-003%',
                   'onaysız soru OGR-GRADE-003');
  perform t.as_admin();
  delete from secure.answer_keys k where k.question_id = v_q;
  perform t.as_bot(t.u('B'));
  perform t.raises(format('select * from public.grade_attempt(%L, %L, %L, %L, null, 1)', t.u('EB'), v_q, '{"key":"B"}', 'practice'), 'OGR-GRADE-004%',
                   'grade without key raises OGR-GRADE-004 (sessizce yanlış demez)');
  perform t.as_admin();
  perform t.ok((select count(*) from public.attempts a where a.question_id = v_q) = 1, 'anahtarsız denemede attempts satırı yazılmadı (yalnız ilk, anahtarlı cevap)');
end $$;

-- 'wrong answer on skill with weak prereq returns prereq_hint'; ön koşul güvenilir değilse null
do $$
declare
  v_r record;
  v_q1 uuid := (select q.id from public.questions q where q.content_hash = 'tpl-test-kesir-modeli-toplama-1');
  v_q2 uuid := (select q.id from public.questions q where q.content_hash = 'tpl-test-kesir-modeli-toplama-2');
  v_expected text := 'Asıl sorun alt konuda olabilir: ' || (select s.name from public.skills s where s.curriculum_id = t.u('cur') and s.id = 'tyt.mat.temel.ebob-ekok');
begin
  insert into public.mastery (enrollment_id, skill_id, p, evidence_count) values
    (t.u('EB'), 'tyt.mat.temel.rasyonel-sayilar', 0.3, 6), (t.u('EB'), 'tyt.mat.temel.ebob-ekok', 0.3, 6);
  perform t.as_bot(t.u('B'));
  select * into v_r from public.grade_attempt(t.u('EB'), v_q1, '{"key":"C"}', 'practice', null, 700);
  perform t.ok(not v_r.is_correct and v_r.prereq_hint = v_expected, 'yanlış cevap + zayıf ön koşul → prereq_hint: ' || coalesce(v_r.prereq_hint, 'null'));
  perform t.ok(v_expected = 'Asıl sorun alt konuda olabilir: EBOB–EKOK ve problemleri', 'ipucu metni blueprint ile aynı');
  perform t.ok(v_r.evidence_count = 7 and v_r.is_reliable and v_r.mastery_p < 0.3, 'dönüşte p, kanıt sayısı ve güvenilirlik (yüzde değil)');
  perform t.as_admin();
  update public.mastery m set evidence_count = 3 where m.enrollment_id = t.u('EB') and m.skill_id = 'tyt.mat.temel.ebob-ekok';
  perform t.as_bot(t.u('B'));
  select * into v_r from public.grade_attempt(t.u('EB'), v_q2, '{"key":"C"}', 'practice', null, 700);
  perform t.ok(v_r.prereq_hint is null, 'ön koşul güvenilir değilse (n=3) prereq_hint null');
  select * into v_r from public.grade_attempt(t.u('EB'), v_q2, '{"key":"A"}', 'practice', null, 700);
  perform t.ok(v_r.is_correct and v_r.prereq_hint is null, 'doğru cevapta ipucu yok');
  perform t.as_admin();
  perform t.ok((select count(*) from public.observations o join public.attempts a on a.id::text = o.source_id and o.source_type = 'attempt'
                 where a.question_id = v_q2 and o.counts_for_mastery) = 1, 'yalnız ilk deneme ustalığa sayılır');
  perform t.as_bot(t.u('B'));
  perform t.ok((select p.prereq_hint from (select public.profile_for_prompt(t.u('EB')) ->> 'prereq_hint' as prereq_hint) p) is null
               and public.profile_for_prompt(t.u('EB'))::text not like '%"p"%', 'profile_for_prompt p değeri döndürmez');
  perform t.as_admin();
end $$;

-- Sayısal cevap: rasyonel/ondalık ayrıştırma (SymPy değil), g = 0.05
do $$
declare
  v_q uuid;
  v_r record;
begin
  perform t.ok(app.numeric_equal('3,5', '7/2', 0) and app.numeric_equal(' -1/2 ', '-0.5', 0) and app.numeric_equal('8', '8.0', 0)
               and not app.numeric_equal('sqrt(2)', '1.414', 0.01) and not app.numeric_equal('1/0', '0', 0) and app.numeric_equal('0.33', '1/3', 0.01)
               and not app.numeric_equal(null, '1', 0), 'app.numeric_equal kesir/ondalık/tolerans; ifade → false');
  insert into public.questions (curriculum_id, skill_ids, kind, stem, difficulty, source, content_hash, status)
  values (t.u('cur'), array['tyt.mat.temel.rasyonel-sayilar'], 'numeric', 'Sayısal soru: 3/4 + 1/8 = ?', 0.5, 'instructor', 'num-test-1', 'draft') returning id into v_q;
  insert into secure.answer_keys (question_id, numeric_value, solution, sympy_status, written_by) values (v_q, '7/8', '6/8 + 1/8 = 7/8.', 'verified', 'staff:test');
  perform set_config('ogrenmen.reviewer', 'on', true);
  update public.questions q set status = 'approved' where q.id = v_q;
  perform set_config('ogrenmen.reviewer', 'off', true);
  perform t.as_bot(t.u('A'));
  select * into v_r from public.grade_attempt(t.u('EA'), v_q, '{"value":"0,875"}', 'practice', null, 3000);
  perform t.as_admin();
  perform t.ok(v_r.is_correct, '0,875 = 7/8 doğru');
  perform t.ok((select o.guess_override from public.observations o join public.attempts a on a.id::text = o.source_id
                 where o.source_type = 'attempt' and a.question_id = v_q) = 0.05
               and (select (mh.params ->> 'g')::numeric from public.mastery_history mh join public.observations o on o.id = mh.observation_id
                     join public.attempts a on a.id::text = o.source_id where a.question_id = v_q) = 0.05,
               'numeric soruda guess_override = 0.05 ve BKT g = 0.05');
  perform t.ok(abs((select mh.p_after from public.mastery_history mh join public.observations o on o.id = mh.observation_id
                     join public.attempts a on a.id::text = o.source_id where a.question_id = v_q) - 0.89672) < 0.00001,
               'p 0.30 → 0.89672 (bkt-vectors #2)');
end $$;

-- Havuz geri bildirimi: onaylı feedback_wrong içeriği yanlış cevabın etiketiyle eşleşir
do $$
declare
  v_pool uuid;
  v_r record;
  v_q uuid := (select q.id from public.questions q where q.content_hash = 'tpl-test-uslu-sadelestirme-1');
  v_tag text := (select o ->> 'misconception_tag' from public.questions q, jsonb_array_elements(q.options) o where q.id = v_q and o ->> 'key' = 'B');
begin
  insert into public.content_pool (kind, curriculum_id, skill_id, misconception_tag, mode, body, status)
  values ('feedback_wrong', t.u('cur'), 'tyt.mat.temel.uslu', v_tag, 'socratic', 'Tabanlar aynıysa üslere ne oluyor?', 'approved') returning id into v_pool;
  perform t.as_bot(t.u('A'));
  select * into v_r from public.grade_attempt(t.u('EA'), v_q, '{"key":"B"}', 'practice', null, 900);
  perform t.ok(v_r.feedback_pool_id = v_pool and v_r.misconception_tag = v_tag and v_r.feedback_student is not null,
               'yanlış şık → etiket, öğrenci metni ve havuz geri bildirimi');
  perform t.as_admin();
end $$;
\else
\echo 'SKIP: no content — şablon fikstürü ve pratik seti'
\endif

\if :have_keys
-- Teşhis: 20 madde, şıklar etiketsiz; rasyonel maddeleri yanlış; sonra 'next_practice_items after diagnostic returns only
-- approved template/instructor items' — hiçbir kazanım güvenilir değil, yedek kural: ilk kazanım teşhiste yanlış yapılan
do $$
declare
  v_sess uuid;
  v_item record;
  v_key text;
  v_choice text;
  v_n int := 0;
  v_res jsonb;
  v_first text;
  v_ids uuid[];
begin
  perform t.as_bot(t.u('A'));
  v_sess := public.start_diagnostic(t.u('EA'), 700100001);
  perform t.ok(public.start_diagnostic(t.u('EA'), 700100001) = v_sess, 'yarım oturum 24 saat içinde sürdürülür');
  loop
    select * into v_item from public.next_diagnostic_item(v_sess);
    exit when not found;
    if v_n = 0 then
      perform t.ok(v_item.total = 20 and v_item.idx = 1 and not exists (select 1 from jsonb_array_elements(v_item.options) o where o ? 'misconception_tag'),
                   'next_diagnostic_item 1/20, şıklar etiketsiz');
    end if;
    perform t.as_admin();
    select k.correct_option into v_key from secure.answer_keys k where k.question_id = v_item.question_id;
    select case when 'tyt.mat.temel.rasyonel-sayilar' = any(q.skill_ids)
                then (select o ->> 'key' from jsonb_array_elements(q.options) o where o ->> 'misconception_tag' is not null order by o ->> 'key' limit 1)
                else v_key end
      into v_choice from public.questions q where q.id = v_item.question_id;
    perform t.as_bot(t.u('A'));
    perform public.grade_attempt(t.u('EA'), v_item.question_id, jsonb_build_object('key', v_choice), 'diagnostic', v_sess, 20000);
    perform public.advance_diagnostic(v_sess);
    v_n := v_n + 1;
  end loop;
  v_res := public.finish_diagnostic(v_sess);
  perform t.ok(v_n = 20, 'teşhis 20 madde');
  perform t.ok((select bool_and(not (e ->> 'reliable')::boolean) from jsonb_array_elements(v_res -> 'per_skill') e)
               and (select max((e ->> 'n')::int) from jsonb_array_elements(v_res -> 'per_skill') e) < 5,
               'teşhis sonunda hiçbir kazanım güvenilir değil (n < 5; yüzde gösterilmez)');
  perform t.ok(v_res -> 'open_tags' ?| array['rasyonel.pay-payda-ayri-toplama', 'rasyonel.payda-esitlemeden-toplama'], 'yanlış şıkların etiketleri open_tags''te');
  select array_agg(n.question_id), (array_agg(n.skill_id))[1] into v_ids, v_first from public.next_practice_items(t.u('EA'), 10) n;
  perform t.as_admin();
  perform t.ok(cardinality(v_ids) = 10, 'teşhis sonrası 10 pratik sorusu');
  perform t.ok((select bool_and(q.source in ('template', 'instructor')) from public.questions q where q.id = any(v_ids)), 'teşhis sonrası yalnız şablon/eğitmen soruları (llm yok)');
  perform t.ok(not exists (select 1 from public.attempts a where a.enrollment_id = t.u('EA') and a.question_id = any(v_ids)), 'görülen soru yok');
  perform t.ok(v_first = 'tyt.mat.temel.rasyonel-sayilar', 'sıralamanın ilk kazanımı teşhiste yanlış yapılan (bekleyen yanılgılı) rasyonel-sayilar: ' || v_first);
  perform t.ok((select ds.status from public.diagnostic_sessions ds where ds.id = v_sess) = 'finished', 'oturum finished');
end $$;
\else
\echo 'SKIP: no keys — teşhis ve teşhis sonrası pratik seti'
\endif

-- Eksik anahtar: onaylı mcq'nun anahtarında doğru şık null (numeric_value dolu) → '{}' ya da {"value":…} DOĞRU sayılmaz,
-- OGR-GRADE-004 ve ustalığa gözlem yazılmaz
do $$
declare
  v_q uuid := (select q.id from public.questions q where q.content_hash = 'tpl-test-islem-onceligi-2');
  v_obs int;
  v_att int;
begin
  update secure.answer_keys k set correct_option = null, numeric_value = '7' where k.question_id = v_q;
  select count(*) into v_obs from public.observations o where o.enrollment_id = t.u('EB');
  select count(*) into v_att from public.attempts a where a.question_id = v_q;
  perform t.as_bot(t.u('B'));
  perform t.raises(format('select * from public.grade_attempt(%L, %L, %L, %L, null, 1)', t.u('EB'), v_q, '{}', 'practice'), 'OGR-GRADE-004%',
                   'mcq anahtarında doğru şık null: boş seçim doğru sayılmaz (OGR-GRADE-004)');
  perform t.raises(format('select * from public.grade_attempt(%L, %L, %L, %L, null, 1)', t.u('EB'), v_q, '{"value":"7"}', 'practice'), 'OGR-GRADE-004%',
                   'mcq anahtarında doğru şık null: {"value":…} doğru sayılmaz (OGR-GRADE-004)');
  perform t.as_admin();
  perform t.ok((select count(*) from public.observations o where o.enrollment_id = t.u('EB')) = v_obs
               and (select count(*) from public.attempts a where a.question_id = v_q) = v_att,
               'eksik anahtarlı denemede attempts/observations yazılmadı');
  update secure.answer_keys k set correct_option = 'A', numeric_value = null where k.question_id = v_q;
  perform t.as_bot(t.u('B'));
  perform t.ok(not (select g.is_correct from public.grade_attempt(t.u('EB'), v_q, '{}', 'practice', null, 1) as g),
               'doğru şık dolu anahtarda boş seçim yanlış (null = null doğru değil)');
  perform t.as_admin();
end $$;

rollback;
