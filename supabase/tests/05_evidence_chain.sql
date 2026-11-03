-- tests/05_evidence_chain.sql — kanıt zinciri: apply_diagnosis → solution_analyses → observations
-- (source_type='solution_analysis') → apply_observation → mastery / mastery_history / misconceptions / style_coverage;
-- careless/time ağırlığı 0.5; deneme bağlamında ağırlık 0; okunamayan çözüm gözlem üretmez; doğrulama hataları
-- (OGR-DIAG-00x); alt kazanım önerisi ve otopilot; decide_proposal.
begin;
\ir _fixture.sql

do $$
declare
  v_style uuid;
  v_other_course uuid;
begin
  insert into public.question_styles (course_id, curriculum_id, code, name, skill_ids, status, frequency_score)
  values (t.u('course'), t.u('cur'), 'ST-1', 'Dağılma tuzağı', array['t.mat.a'], 'active', 0.8) returning id into v_style;
  insert into t.cfg values ('style', v_style::text);
  insert into public.courses (code, title, curriculum_id) values ('BASKA', 'Başka ders', t.u('cur')) returning id into v_other_course;
  insert into public.question_styles (course_id, code, name, status) values (v_other_course, 'ST-X', 'Başka tarz', 'active') returning id into v_style;
  insert into t.cfg values ('style_other', v_style::text);
end $$;

-- 1) öğrenci JWT'siyle yanlış teşhis (işlem hatası, yanılgı etiketli, tarzlı)
do $$
declare
  v_id uuid;
  v_o public.observations%rowtype;
  v_p numeric;
begin
  perform t.as_user(t.u('elif'));
  v_id := public.apply_diagnosis(jsonb_build_object(
    'enrollment_id', t.u('EA'), 'verdict', 'wrong', 'error_cause', 'procedure', 'failing_step_no', 2,
    'skill_ids', jsonb_build_array('t.mat.a'), 'misconception_tags', jsonb_build_array('t.a.isaret-hatasi'),
    'style_id', t.u('style'), 'question_text', '2 − (3 − 5) = ?', 'student_work_text', '2 − 3 − 5 = −6',
    'quote', '2 − 3 − 5', 'confidence', 0.9, 'model', 'claude-opus-5-5', 'cost_usd', 0.04,
    'analysis', jsonb_build_object('steps', jsonb_build_array('a', 'b', 'c'))));
  perform t.as_admin();
  insert into t.cfg values ('SA1', v_id::text);
  perform t.ok((select sa.verdict = 'wrong' and sa.failing_step_no = 2 and sa.error_cause = 'procedure' and sa.skill_ids = array['t.mat.a']
                  and sa.misconception_tags = array['t.a.isaret-hatasi'] and sa.style_id = t.u('style') and sa.cost_usd = 0.04
                  from public.solution_analyses sa where sa.id = v_id), 'solution_analyses satırı yazıldı');
  select o.* into v_o from public.observations o where o.source_type = 'solution_analysis' and o.source_id = v_id::text;
  perform t.ok(v_o.kind = 'practice' and v_o.value = 0 and v_o.weight = 1 and v_o.error_cause = 'procedure'
               and v_o.misconception_tag = 't.a.isaret-hatasi' and v_o.applied_at is not null and v_o.confidence = 0.9
               and v_o.quote = '2 − 3 − 5' and v_o.created_by_role = 'authenticated', 'gözlem: practice, değer 0, ağırlık 1, kaynak teşhis, uygulandı');
  select m.p into v_p from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a';
  perform t.ok(abs(v_p - app.bkt_step(0.3, false, 0.25, 0.1, 0.1)) < 0.00001, 'ustalık BKT ile düştü (0.30 → 0.14865)');
  perform t.ok(exists (select 1 from public.mastery_history h where h.observation_id = v_o.id and h.method = 'bkt'), 'mastery_history satırı');
  perform t.ok((select mc.status = 'pending_review' and mc.evidence_count = 1 from public.misconceptions mc
                 where mc.enrollment_id = t.u('EA') and mc.tag = 't.a.isaret-hatasi'), 'yanılgı sayacı açıldı');
  perform t.ok(exists (select 1 from public.observations o where o.enrollment_id = t.u('EA') and o.skill_id = 't.mat.b' and o.kind = 'inferred'
                        and o.source_type = 'observation' and o.source_id = v_o.id::text), 'ön koşul çıkarımı (t.mat.b) gözleme bağlı');
  perform t.ok((select sc.seen_count = 1 and sc.solved_count = 1 and sc.correct_count = 0 from public.style_coverage sc
                 where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('style')), 'style_coverage güncellendi');
  perform t.ok(exists (select 1 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'diagnosis.followup'
                        and e.diff -> 'data' ->> 'analysis_id' = v_id::text), 'diagnosis.followup işi aynı işlemde denendi (pgboss yok → audit)');
  -- kanıt zinciri: her gözlemin kaynak satırı var
  perform t.ok(not exists (select 1 from public.observations o
                            where o.enrollment_id = t.u('EA') and o.source_type = 'solution_analysis'
                              and not exists (select 1 from public.solution_analyses sa where sa.id::text = o.source_id)),
               'her teşhis gözleminin kaynak satırı var');
end $$;

-- 2) careless ağırlığı, doğru teşhis, çok kazanım, okunamayan
do $$
declare
  v_id uuid;
  v_n int;
begin
  perform t.as_user(t.u('can'));
  v_id := public.apply_diagnosis(jsonb_build_object('enrollment_id', t.u('EB'), 'verdict', 'wrong', 'error_cause', 'careless',
            'skill_ids', jsonb_build_array('t.mat.b'), 'analysis', '{}'::jsonb));
  perform t.as_admin();
  perform t.ok((select abs(m.p - (0.3 + 0.5 * (app.bkt_step(0.3, false, 0.25, 0.1, 0.1) - 0.3))) < 0.00001
                  from public.mastery m where m.enrollment_id = t.u('EB') and m.skill_id = 't.mat.b'),
               'careless: ağırlık 0.5 → p = p0 + 0.5·(bkt − p0)');
  perform t.ok((select (h.params ->> 'w')::numeric = 0.5 and h.params ->> 'error_cause' = 'careless'
                  from public.mastery_history h join public.observations o on o.id = h.observation_id
                 where o.source_id = v_id::text), 'mastery_history.params w = 0.5, error_cause = careless');

  v_id := public.apply_diagnosis(jsonb_build_object('enrollment_id', t.u('EB'), 'verdict', 'correct', 'error_cause', 'concept',
            'skill_ids', jsonb_build_array('t.mat.a', 't.mat.b', 't.mat.a'), 'misconception_tags', jsonb_build_array('t.a.isaret-hatasi'),
            'analysis', '{}'::jsonb));
  select count(*) into v_n from public.observations o where o.source_id = v_id::text and o.value = 1 and o.misconception_tag is null
                                                     and o.error_cause is null;
  perform t.ok(v_n = 2, 'doğru teşhis: tekil kazanım başına 1 gözlem, değer 1, etiket/neden yok (' || v_n || ')');

  v_id := public.apply_diagnosis(jsonb_build_object('enrollment_id', t.u('EB'), 'verdict', 'wrong', 'error_cause', 'concept',
            'skill_ids', jsonb_build_array('t.mat.a', 't.mat.b'), 'misconception_tags', jsonb_build_array('t.a.isaret-hatasi'),
            'analysis', '{}'::jsonb));
  perform t.ok((select o.misconception_tag from public.observations o where o.source_id = v_id::text and o.skill_id = 't.mat.a') = 't.a.isaret-hatasi'
               and (select o.misconception_tag from public.observations o where o.source_id = v_id::text and o.skill_id = 't.mat.b') is null,
               'çok kazanımda etiket, etiketin kazanımına bağlanır');

  v_id := public.apply_diagnosis(jsonb_build_object('enrollment_id', t.u('EB'), 'verdict', 'unreadable',
            'skill_ids', jsonb_build_array('t.mat.a'), 'analysis', '{}'::jsonb));
  perform t.ok(exists (select 1 from public.solution_analyses sa where sa.id = v_id)
               and not exists (select 1 from public.observations o where o.source_id = v_id::text), 'okunamayan çözüm: satır var, gözlem yok');
end $$;

-- 3) deneme bağlamı: ağırlık 0, kanıt sayılmaz, exam_responses.solution_analysis_id bağlanır
do $$
declare
  v_exam uuid;
  v_q uuid;
  v_sess uuid;
  v_resp uuid;
  v_p0 numeric;
  v_n0 int;
  v_id uuid;
begin
  insert into public.exams (curriculum_id, course_id, kind, source, title, status) values (t.u('cur'), t.u('course'), 'deneme', 'uploaded', 'D1', 'ready')
  returning id into v_exam;
  insert into public.exam_questions (exam_id, no, kind, skill_ids) values (v_exam, 1, 'mcq', array['t.mat.a']) returning id into v_q;
  v_sess := public.start_exam_session(v_exam, t.u('EA'), 'uploaded');
  v_resp := public.record_exam_response(v_sess, v_q, 'C');
  insert into t.cfg values ('RESP', v_resp::text);
  select m.p, m.evidence_count into v_p0, v_n0 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a';
  perform t.as_user(t.u('elif'));
  v_id := public.apply_diagnosis(jsonb_build_object('enrollment_id', t.u('EA'), 'exam_response_id', v_resp, 'verdict', 'wrong',
            'error_cause', 'time', 'skill_ids', jsonb_build_array('t.mat.a'), 'analysis', '{}'::jsonb));
  perform t.as_admin();
  perform t.ok((select m.p = v_p0 and m.evidence_count = v_n0 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a'),
               'deneme bağlamı: p ve kanıt sayısı değişmez (notlama zaten saydı)');
  perform t.ok((select o.weight = 0 and not o.counts_for_mastery and o.error_cause = 'time' from public.observations o where o.source_id = v_id::text),
               'deneme bağlamı gözlemi ağırlık 0, hata nedeni taşır');
  perform t.ok((select r.solution_analysis_id = v_id from public.exam_responses r where r.id = v_resp), 'exam_responses.solution_analysis_id bağlandı');
end $$;

-- 4) doğrulama hataları
do $$
begin
  perform t.as_user(t.u('elif'));
  perform t.raises($q$select public.apply_diagnosis('[]')$q$, 'OGR-DIAG-001%', 'girdi nesne olmalı');
  perform t.raises(format($q$select public.apply_diagnosis(jsonb_build_object('enrollment_id', %L, 'verdict', 'wrong'))$q$, t.u('EA')),
                   'OGR-DIAG-001%', 'analysis alanı gerekli');
  perform t.raises(format($q$select public.apply_diagnosis(jsonb_build_object('enrollment_id', %L, 'verdict', 'belki', 'analysis', '{}'::jsonb))$q$, t.u('EA')),
                   'OGR-DIAG-001%', 'verdict enum');
  perform t.raises(format($q$select public.apply_diagnosis(jsonb_build_object('enrollment_id', %L, 'verdict', 'wrong', 'error_cause', 'tembellik',
                            'analysis', '{}'::jsonb))$q$, t.u('EA')), 'OGR-DIAG-001%', 'error_cause enum');
  perform t.raises(format($q$select public.apply_diagnosis(jsonb_build_object('enrollment_id', %L, 'verdict', 'wrong',
                            'skill_ids', jsonb_build_array('t.mat'), 'analysis', '{}'::jsonb))$q$, t.u('EA')), 'OGR-DIAG-002%', 'yaprak olmayan kazanım');
  perform t.raises(format($q$select public.apply_diagnosis(jsonb_build_object('enrollment_id', %L, 'verdict', 'wrong',
                            'skill_ids', jsonb_build_array('t.mat.yok'), 'analysis', '{}'::jsonb))$q$, t.u('EA')), 'OGR-DIAG-002%', 'müfredatta olmayan kazanım');
  perform t.raises(format($q$select public.apply_diagnosis(jsonb_build_object('enrollment_id', %L, 'verdict', 'wrong',
                            'misconception_tags', jsonb_build_array('yok.etiket'), 'analysis', '{}'::jsonb))$q$, t.u('EA')), 'OGR-DIAG-003%', 'bilinmeyen yanılgı etiketi');
  perform t.raises(format($q$select public.apply_diagnosis(jsonb_build_object('enrollment_id', %L, 'verdict', 'wrong', 'failing_step_no', 4,
                            'analysis', jsonb_build_object('steps', jsonb_build_array(1, 2, 3))))$q$, t.u('EA')), 'OGR-DIAG-004%', 'bozulan adım ≤ adım sayısı');
  perform t.raises(format($q$select public.apply_diagnosis(jsonb_build_object('enrollment_id', %L, 'verdict', 'wrong', 'exam_response_id', %L,
                            'analysis', '{}'::jsonb))$q$, t.u('EA'), gen_random_uuid()), 'OGR-DIAG-005%', 'kayda ait olmayan deneme cevabı');
  perform t.raises(format($q$select public.apply_diagnosis(jsonb_build_object('enrollment_id', %L, 'verdict', 'wrong', 'style_id', %L,
                            'analysis', '{}'::jsonb))$q$, t.u('EA'), t.u('style_other')), 'OGR-DIAG-005%', 'başka dersin tarzı');
  perform t.as_admin();
end $$;

-- 5) alt kazanım önerisi, decide_proposal, otopilot
do $$
declare
  v_id uuid;
  v_prop uuid;
  v_res jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_id := public.apply_diagnosis(jsonb_build_object('enrollment_id', t.u('EA'), 'verdict', 'wrong', 'analysis', '{}'::jsonb,
            'proposed_subskill', jsonb_build_object('parent_id', 't.mat.a', 'name', 'Parantez önünde eksi', 'description', 'Eksiyi dağıtma')));
  perform t.as_admin();
  select sa.proposal_id into v_prop from public.solution_analyses sa where sa.id = v_id;
  perform t.ok((select cp.status = 'open' and cp.kind = 'add_subskill' and cp.evidence_ids = array[v_id] from public.curriculum_proposals cp where cp.id = v_prop),
               'teşhis alt kazanım önerisi açar (eğitmen müfredatı: otopilot yok)');
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.decide_proposal(%L, true)$q$, v_prop), 'OGR-AUTH-002%', 'öğrenci öneriye karar veremez');
  perform t.as_user(t.u('inst'));
  v_res := public.decide_proposal(v_prop, true, 'mantıklı');
  perform t.ok(v_res ->> 'status' = 'accepted' and (v_res ->> 'applied')::boolean
               and exists (select 1 from public.skills s where s.curriculum_id = t.u('cur') and s.id = v_res ->> 'skill_id' and s.is_leaf
                                                       and s.parent_id = 't.mat.a' and s.p_init = 0.3)
               and not (select s.is_leaf from public.skills s where s.curriculum_id = t.u('cur') and s.id = 't.mat.a'),
               'eğitmen kabulü: yeni yaprak (BKT varsayılanları), üst kazanım yaprak olmaktan çıkar');
  perform t.raises(format($q$select public.decide_proposal(%L, false)$q$, v_prop), 'OGR-PROP-002%', 'karara bağlanmış öneri tekrar karara bağlanamaz');
  perform t.as_admin();
  insert into public.curriculum_proposals (curriculum_id, kind, payload) values (t.u('cur'), 'add_prereq', '{"skill_id":"t.mat.b","prereq_id":"t.mat.a"}')
  returning id into v_prop;
  perform t.as_user(t.u('inst'));
  perform t.raises(format($q$select public.decide_proposal(%L, true)$q$, v_prop), 'OGR-PROP-003%', 'ön koşul döngüsü reddedilir');
  perform t.ok(public.decide_proposal(v_prop, false, 'döngü') ->> 'status' = 'rejected', 'öneri reddedilir');
  perform t.as_user(t.u('admin'));
  perform t.raises(format($q$select public.decide_proposal(%L, true)$q$, gen_random_uuid()), 'OGR-PROP-001%', 'olmayan öneri');
  perform t.as_admin();

  -- otopilot: ai_draft müfredat + ders türü exam_track (runtime_flags.curriculum_autopilot) → öneri hemen kabul
  update public.curricula c set origin = 'ai_draft' where c.id = t.u('cur');
  perform t.as_user(t.u('can'));
  v_id := public.apply_diagnosis(jsonb_build_object('enrollment_id', t.u('EB'), 'verdict', 'wrong', 'analysis', '{}'::jsonb,
            'proposed_subskill', jsonb_build_object('parent_id', 't.mat.b', 'id', 't.mat.b.1', 'name', 'Çift eksi')));
  perform t.as_admin();
  perform t.ok((select cp.status = 'accepted' from public.curriculum_proposals cp join public.solution_analyses sa on sa.proposal_id = cp.id where sa.id = v_id)
               and exists (select 1 from public.skills s where s.curriculum_id = t.u('cur') and s.id = 't.mat.b.1'),
               'otopilot (ai_draft + exam_track) öneriyi hemen kabul eder');
end $$;

rollback;
