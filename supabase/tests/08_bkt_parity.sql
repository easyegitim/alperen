-- tests/08_bkt_parity.sql — BKT SQL paritesi (BLUEPRINT §2.2, §3.7): packages/mastery-math/fixtures/bkt-vectors.json'daki
-- her vektör app.bkt_step / app.blend_step / app.inferred_guess ile 1e-9 toleransla aynı sonucu verir (TS ve Python
-- aynı dosyayı geçer). Ayrıca apply_observation yolu (mastery.p numeric(6,5)) vektörlerle 1e-5 içinde.
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

-- apply_observation yolu: varsayılan kazanım parametreleri (0.30/0.10/0.25/0.10) ile vektör #1 (doğru), #3 (yanlış), #7 (ders)
do $$
declare
  v_q uuid;
  v_r record;
begin
  insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, content_hash, status)
  values (t.u('cur'), array['tyt.mat.temel.sayilar'], 'mcq', 'Parite sorusu: 2 + 3 · 4 = ?',
          '[{"key":"A","text":"14","misconception_tag":null},{"key":"B","text":"20","misconception_tag":"sayilar.islem-onceligi-soldan"},
            {"key":"C","text":"24","misconception_tag":null},{"key":"D","text":"9","misconception_tag":null}]', 'instructor', 'bkt-parity-1', 'draft')
  returning id into v_q;
  insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by) values (v_q, 'A', 'Önce çarpma: 3 · 4 = 12; 2 + 12 = 14.', 'verified', 'staff:test');
  perform set_config('ogrenmen.reviewer', 'on', true);
  update public.questions q set status = 'approved' where q.id = v_q;
  perform set_config('ogrenmen.reviewer', 'off', true);
  if not exists (select 1 from public.misconception_tags mt where mt.tag = 'sayilar.islem-onceligi-soldan') then
    raise notice 'SKIP: no content — sayilar.islem-onceligi-soldan etiketi yok';
    return;
  end if;
  update public.skills s set p_init = 0.3, p_learn = 0.1, p_guess = 0.25, p_slip = 0.1
   where s.curriculum_id = t.u('cur') and s.id in ('tyt.mat.temel.sayilar', 'tyt.mat.temel.bolunebilme');
  perform t.as_bot(t.u('A'));
  select * into v_r from public.grade_attempt(t.u('EA'), v_q, '{"key":"A"}', 'practice', null, 1);
  perform t.ok(abs(v_r.mastery_p - 0.6460674157) < 0.00001, 'apply_observation doğru: 0.30 → 0.64607 (vektör #1)');
  perform t.as_bot(t.u('B'));
  select * into v_r from public.grade_attempt(t.u('EB'), v_q, '{"key":"B"}', 'practice', null, 1);
  perform t.ok(abs(v_r.mastery_p - 0.1486486486) < 0.00001, 'apply_observation yanlış: 0.30 → 0.14865 (vektör #3)');
  perform t.as_staff(t.u('inst_b'));
  perform public.add_instructor_note(t.u('EB'), 'tyt.mat.temel.bolunebilme', 'Kuralları biliyor.', 0.8, false);
  perform t.as_admin();
  perform t.ok((select abs(mh.p_after - 0.3 - 1.0 * 0.30 * (0.8 - 0.3)) < 0.00001 and mh.method = 'blend'
                  from public.mastery_history mh where mh.enrollment_id = t.u('EB') and mh.skill_id = 'tyt.mat.temel.bolunebilme'),
               'eğitmen tahmini (c = 1.0): p + 0.30·c·(m − p)');
end $$;

rollback;
