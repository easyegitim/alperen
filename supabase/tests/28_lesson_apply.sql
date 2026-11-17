-- tests/28_lesson_apply.sql — P5 ders iddiaları (0040–0041): write_lesson_analysis (yalnız worker; lesson-analysis
-- türetmesi, yaprak olmayan/bilinmeyen kazanım düşer, eski sürümün bekleyenleri reddedilir, uygulanmışları geri alınır:
-- analiz iki kez yazılırsa kanıt tek sayılır), apply_lesson_claims (güven ≥ eşik → otomatik onay + observations(kind=
-- 'lesson') + BKT blend; eşik sınırı dahil; altı, güvensizler ve modelin öğrenciye dönük yargıları (sonraki adım, ödev)
-- inceleme kuyruğunda), course_insight → syllabus_topics, 'memory.apply' işi (courses/<kod>.md), review_lesson_claim (onay,
-- düzeltme, ret; "Geri al": ustalık geri döner, sonra kanıt geldiyse OGR-LESSON-006), takip iddiası yanılgıyı çözer ve
-- geri alınca eski durumuna döner, sınıf dersinde gözlem yazılmaz, öğrenci özeti yalnız onaylı iddialardan.
begin;
\ir _fixture.sql

do $$
declare
  v_r jsonb;
begin
  perform t.add_outsiders();
  insert into public.uploads (id, owner_id, kind, storage_path) values
    ('51000000-0000-4000-8000-0000000000a1', t.u('inst'), 'video', t.v('inst') || '/l1.mp4'),
    ('51000000-0000-4000-8000-0000000000a2', t.u('inst'), 'video', t.v('inst') || '/l2.mp4'),
    ('51000000-0000-4000-8000-0000000000a3', t.u('inst'), 'video', t.v('inst') || '/lc.mp4'),
    ('51000000-0000-4000-8000-0000000000a4', t.u('inst'), 'video', t.v('inst') || '/l3.mp4');
  perform t.as_user(t.u('inst'));
  v_r := public.register_lesson(jsonb_build_object('enrollment_id', t.v('EA'), 'held_at', '2026-10-20T17:00:00+03:00'), '51000000-0000-4000-8000-0000000000a1');
  perform t.as_admin();
  insert into t.cfg values ('L1', v_r ->> 'lesson_id');
  perform t.as_user(t.u('inst'));
  v_r := public.register_lesson(jsonb_build_object('enrollment_id', t.v('EA'), 'held_at', '2026-10-27T17:00:00+03:00'), '51000000-0000-4000-8000-0000000000a2');
  perform t.as_admin();
  insert into t.cfg values ('L2', v_r ->> 'lesson_id');
  perform t.as_user(t.u('inst'));
  v_r := public.register_lesson(jsonb_build_object('course_id', t.v('course')), '51000000-0000-4000-8000-0000000000a3');
  perform t.as_admin();
  insert into t.cfg values ('LC', v_r ->> 'lesson_id');
  perform t.as_user(t.u('inst'));
  v_r := public.register_lesson(jsonb_build_object('enrollment_id', t.v('EA'), 'held_at', '2026-10-29T17:00:00+03:00'), '51000000-0000-4000-8000-0000000000a4');
  perform t.as_admin();
  insert into t.cfg values ('L3', v_r ->> 'lesson_id');
  insert into t.cfg values ('AN', jsonb_build_object(
    'schema_version', '1.0', 'lesson_ref', t.v('L1'), 'student_ref', 's_k3m7q2x4z6ab', 'duration_min', 48,
    'skills', jsonb_build_array(
      jsonb_build_object('skill_id', 't.mat.a', 'mastery_estimate', 0.9, 'confidence', 0.85,
                         'evidence', '[{"speaker": "ÖĞRENCİ", "quote": "Önce çarpmayı yaparım.", "t": "00:05:10"}]'::jsonb),
      jsonb_build_object('skill_id', 't.mat.b', 'mastery_estimate', 0.4, 'confidence', 0.6,
                         'evidence', '[{"speaker": "ÖĞRENCİ", "quote": "Eksi tarafı hep unutuyorum.", "t": "00:14:10", "t_end": "00:14:30"}]'::jsonb),
      jsonb_build_object('skill_id', 't.mat', 'mastery_estimate', 0.5, 'confidence', 0.95,
                         'evidence', '[{"speaker": "ÖĞRENCİ", "quote": "x", "t": "00:01:00"}]'::jsonb),
      jsonb_build_object('skill_id', 'x.yok', 'mastery_estimate', 0.5, 'confidence', 0.95,
                         'evidence', '[{"speaker": "ÖĞRENCİ", "quote": "x", "t": "00:01:00"}]'::jsonb)),
    'questions', '[{"t": "00:12:31", "quote": "Neden ikinci kesri ters çeviriyoruz?", "skill_id": "t.mat.b", "answered": true}]'::jsonb,
    'hesitations', '[{"t": "00:20:00", "kind": "long_silence", "skill_id": "t.mat.b", "confidence": 0.8},
                     {"t": "00:22:00", "kind": "asked_repeat", "skill_id": null, "confidence": 0.79}]'::jsonb,
    'misconceptions', '[{"tag": "t.a.isaret-hatasi", "skill_id": "t.mat.a", "text_instructor": "Eksiyi dağıtmıyor.",
                         "text_student": "Eksiyi her terime dağıt.", "evidence": [{"speaker": "ÖĞRENCİ", "quote": "x − 3 < 5 yazdım.", "t": "00:13:55"}]}]'::jsonb,
    'commitments', '[{"who": "ÖĞRENCİ", "kind": "homework", "text": "Çalışma kâğıdının ilk 10 sorusu.", "due": "2026-11-10", "t": "00:47:00"},
                     {"who": "EĞİTMEN", "kind": "promise", "text": "Not gönderecek.", "due": null, "t": "00:48:00"}]'::jsonb,
    'talk', '{"student_ratio": 0.4, "student_questions": 1, "attention": "high", "morale": "medium"}'::jsonb,
    'previous_profile_check', '[]'::jsonb,
    'next_step', '{"for_student": "Uç noktaları kontrol ederek beş soru çöz.", "for_instructor": "Uç noktaları tekrar et."}'::jsonb,
    'course_insights', '[{"kind": "syllabus_topic", "topic": "Mutlak değerli eşitsizlikler", "text": "Haftaya bu konu.", "skill_id": "t.mat.b",
                          "evidence": [], "confidence": 0.9}]'::jsonb,
    'model_notes', '{"model": "claude-opus-4-5", "prompt_version": "lesson-analysis@2", "cost_usd": 0.31, "tokens_in": 1, "tokens_out": 1, "frames": 8}'::jsonb)::text);
end $$;

-- write_lesson_analysis: yetki ve türetme
do $$
declare
  v_r jsonb;
begin
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.write_lesson_analysis(%L, %L)', t.v('L1'), t.v('AN')), 'OGR-AUTH-002%', 'eğitmen analiz yazamaz');
  perform t.raises(format('select public.apply_lesson_claims(%L)', t.v('L1')), 'OGR-LESSON-004%', 'analiz yokken uygulanamaz');
  perform t.as_service();
  perform t.raises(format('select public.write_lesson_analysis(%L, ''[]'')', t.v('L1')), 'OGR-LESSON-001%', 'analiz nesne olmalı');
  v_r := public.write_lesson_analysis(t.u('L1'), jsonb_build_object('analysis', t.v('AN')::jsonb, 'seed_profile', '{"v": 1}'::jsonb));
  perform t.ok((v_r ->> 'version')::int = 1 and (v_r ->> 'claims')::int = 11 and (v_r ->> 'dropped')::int = 2,
               'v1: 11 iddia; yaprak olmayan ve bilinmeyen kazanım düşer (' || v_r::text || ')');
  perform t.as_admin();
  insert into t.cfg values ('AN1', v_r ->> 'analysis_id');
  perform t.ok((select la.model = 'claude-opus-4-5' and la.cost_usd = 0.31 and la.status = 'draft' and la.seed_profile = '{"v": 1}'
                  from public.lesson_analyses la where la.id = t.u('AN1')), 'model ve maliyet model_notes''tan');
  perform t.ok((select l.status = 'analyzed' and l.frames_count = 8 from public.lessons l where l.id = t.u('L1')), 'ders analyzed, kare sayısı');
  perform t.ok((select count(*) = 11 and bool_and(lc.status = 'pending') from public.lesson_claims lc where lc.analysis_id = t.u('AN1')), 'tüm iddialar pending');
  perform t.ok((select lc.confidence = 0.85 and lc.t_start_sec = 310 and lc.speaker = 'ÖĞRENCİ' and lc.curriculum_id = t.u('cur')
                       and (lc.value ->> 'mastery_estimate')::numeric = 0.9
                  from public.lesson_claims lc where lc.analysis_id = t.u('AN1') and lc.kind = 'skill_mastery' and lc.skill_id = 't.mat.a'),
               'ustalık iddiası: güven, saniye, konuşan, müfredat, değer');
  perform t.ok((select lc.confidence is null and lc.misconception_tag = 't.a.isaret-hatasi'
                  from public.lesson_claims lc where lc.analysis_id = t.u('AN1') and lc.kind = 'misconception'),
               'yanılgı iddiasında güven yok (inceleme)');
  perform t.ok((select lc.confidence = 1 and lc.speaker = 'EĞİTMEN' from public.lesson_claims lc where lc.analysis_id = t.u('AN1') and lc.kind = 'promise'),
               'söz: doğrudan çıkarım güveni 1, konuşan EĞİTMEN');
  perform t.ok((select bool_and(lc.confidence is null) and count(*) = 2 from public.lesson_claims lc
                 where lc.analysis_id = t.u('AN1') and lc.kind in ('next_step', 'homework')),
               'sonraki adım ve ödev (modelin öğrenciye dönük metni) boş güvenle: eğitmen görmeden onaylanmaz');
  perform t.ok((select lc.t_end_sec = 870 from public.lesson_claims lc where lc.analysis_id = t.u('AN1') and lc.skill_id = 't.mat.b' and lc.kind = 'skill_mastery'),
               'bitiş saniyesi');
  perform t.ok(t.sees(t.u('inst2'), format('select 1 from public.lesson_claims lc where lc.analysis_id = %L', t.v('AN1'))) = 0
               and t.sees(t.u('elif'), format('select 1 from public.lesson_claims lc where lc.analysis_id = %L', t.v('AN1'))) = 0
               and t.sees(t.u('elif'), format('select 1 from public.lesson_analyses la where la.id = %L', t.v('AN1'))) = 0
               and t.sees(t.u('inst'), format('select 1 from public.lesson_claims lc where lc.analysis_id = %L', t.v('AN1'))) = 11,
               'iddialar ve analiz: yalnız bağlı eğitmen');
end $$;

-- apply_lesson_claims: eşik (0,80) üstü otomatik, altı inceleme kuyruğunda
do $$
declare
  v_r jsonb;
  v_v jsonb;
begin
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.apply_lesson_claims(%L)', t.v('L1')), '42501', 'bağsız eğitmen uygulayamaz');
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.apply_lesson_claims(%L)', t.v('L1')), '42501', 'öğrenci uygulayamaz');
  perform t.as_service();
  v_r := public.apply_lesson_claims(t.u('L1'));
  perform t.ok((v_r ->> 'applied')::int = 6 and (v_r ->> 'pending')::int = 5, 'eşik üstü 6 iddia uygulandı, 5 bekliyor (' || v_r::text || ')');
  perform t.ok(v_r ->> 'memory_job_id' is not null
               or exists (select 1 from secure.job_outbox o where o.name = 'memory.apply' and o.data ->> 'lesson_id' = t.v('L1')),
               'memory.apply işi atıldı');
  perform t.as_admin();
  perform t.ok((select o.kind = 'lesson' and o.value = 0.9 and o.confidence = 0.85 and o.source_type = 'lesson_claim'
                       and o.source_locator = 'Ders 1 · 00:05:10' and o.quote = 'Önce çarpmayı yaparım.' and o.applied_at is not null
                  from public.observations o where o.enrollment_id = t.u('EA') and o.skill_id = 't.mat.a'),
               'ustalık iddiası → observations(kind=lesson), konum, alıntı');
  perform t.ok((select m.p = 0.453 and m.evidence_count = 1 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a'),
               'BKT blend: 0,3 + 0,3·0,85·(0,9 − 0,3) = 0,453');
  perform t.ok(not exists (select 1 from public.observations o where o.enrollment_id = t.u('EA') and o.skill_id = 't.mat.b'),
               'eşik altı (0,60) gözlem yazılmaz');
  perform t.ok((select lc.status = 'approved' and lc.decided_by is null and lc.applied_at is not null
                  from public.lesson_claims lc where lc.analysis_id = t.u('AN1') and lc.kind = 'hesitation' and lc.confidence = 0.80),
               'eşik sınırı (0,80) dahil: otomatik onay');
  perform t.ok((select string_agg(lc.kind || coalesce(':' || lc.skill_id, ''), ',' order by lc.t_start_sec) from public.lesson_claims lc
                 where lc.analysis_id = t.u('AN1') and lc.status = 'pending') = 'next_step,misconception:t.mat.a,skill_mastery:t.mat.b,hesitation,homework',
               'inceleme kuyruğu: sonraki adım, güvensiz yanılgı, 0,60 ustalık, 0,79 tereddüt, ödev');
  perform t.ok((select st.curriculum_id = t.u('cur') and st.skill_ids = array['t.mat.b'] from public.syllabus_topics st
                 where st.course_id = t.u('course') and st.title = 'Mutlak değerli eşitsizlikler'),
               'ders bilgisi (syllabus_topic) → syllabus_topics');
  perform t.ok(exists (select 1 from secure.job_outbox o
                        where o.name = 'memory.apply' and o.data ->> 'lesson_id' = t.v('L1') and o.data ->> 'path' = '/memories/courses/t-mat-test.md'
                          and o.data -> 'student_ids' = jsonb_build_array(t.v('A')) and jsonb_array_length(o.data -> 'claim_ids') = 6),
               'memory.apply: /memories/courses/<kod>.md, öğrenci, uygulanan iddialar');
  perform t.ok((select l.status = 'analyzed' from public.lessons l where l.id = t.u('L1'))
               and (select la.status = 'draft' from public.lesson_analyses la where la.id = t.u('AN1')), 'bekleyen varken ders analyzed, analiz draft');
  v_r := public.apply_lesson_claims(t.u('L1'));
  perform t.ok((v_r ->> 'applied')::int = 0, 'tekrar uygulama zararsız');
  perform t.ok((select count(*) = 1 from public.observations o where o.enrollment_id = t.u('EA')), 'tek gözlem');

  -- eğitmen sonraki adımı ve ödevi görüp onaylar
  perform t.as_user(t.u('inst'));
  perform public.review_lesson_claim(lc.id, 'approve') from public.lesson_claims lc
   where lc.analysis_id = t.u('AN1') and lc.kind in ('next_step', 'homework');
  perform t.as_admin();
  perform t.ok((select bool_and(lc.status = 'approved' and lc.decided_by = t.u('inst')) from public.lesson_claims lc
                 where lc.analysis_id = t.u('AN1') and lc.kind in ('next_step', 'homework')), 'sonraki adım ve ödev eğitmen kararıyla onaylı');

  -- eğitmen görünümü
  perform t.as_user(t.u('inst'));
  v_v := public.lesson_view(t.u('L1'));
  perform t.ok((v_v -> 'counts' ->> 'total')::int = 11 and (v_v -> 'counts' ->> 'pending')::int = 3 and (v_v -> 'counts' ->> 'applied')::int = 8,
               'görünüm sayımları');
  perform t.ok(exists (select 1 from jsonb_array_elements(v_v -> 'claims') as x (c)
                        where x.c ->> 'skill_id' = 't.mat.a' and x.c ->> 'kind' = 'skill_mastery' and x.c ->> 'skill_name' = 'İşlem önceliği'
                          and (x.c -> 'effect' ->> 'p_before')::numeric = 0.3 and (x.c -> 'effect' ->> 'p_after')::numeric = 0.453
                          and (x.c ->> 'auto')::boolean and not (x.c ->> 'below_threshold')::boolean),
               'iddia: kazanım adı, bu dersin etkisi, otomatik');
  perform t.ok(exists (select 1 from jsonb_array_elements(v_v -> 'claims') as x (c)
                        where x.c ->> 'skill_id' = 't.mat.b' and x.c ->> 'kind' = 'skill_mastery' and (x.c ->> 'below_threshold')::boolean
                          and x.c ->> 'status' = 'pending'),
               'eşik altı iddia işaretli');
  perform t.ok(v_v -> 'analysis' -> 'next_step' ->> 'for_student' like 'Uç noktaları%', 'analiz özeti: sonraki adım');
  perform public.lesson_set_options(t.u('L1'), '{"student_visible": true}');
  perform t.as_user(t.u('elif'));
  v_v := public.lesson_view(t.u('L1'));
  perform t.ok((v_v -> 'summary' ->> 'ready')::boolean and v_v -> 'summary' -> 'topics' = '["İşlem önceliği"]'::jsonb
               and v_v -> 'summary' ->> 'next_step' like 'Uç noktaları%'
               and v_v -> 'summary' -> 'homework' = '[{"due": "2026-11-10", "text": "Çalışma kâğıdının ilk 10 sorusu."}]'::jsonb,
               'öğrenci özeti: onaylı konular, sonraki adım, ödev (' || (v_v -> 'summary')::text || ')');
  perform t.ok(v_v::text not like '%Eksi tarafı%' and v_v::text not like '%Önce çarpmayı%' and v_v::text not like '%confidence%'
               and v_v::text not like '%Not gönderecek%', 'öğrenci özetinde alıntı, güven, eğitmen taahhüdü yok');
  perform t.as_admin();
end $$;

-- review_lesson_claim: onay, düzeltme, ret, geri al
do $$
declare
  v_b uuid;
  v_mis uuid;
  v_a uuid;
  v_h uuid;
  v_r jsonb;
begin
  select lc.id into v_b from public.lesson_claims lc where lc.analysis_id = t.u('AN1') and lc.kind = 'skill_mastery' and lc.skill_id = 't.mat.b';
  select lc.id into v_mis from public.lesson_claims lc where lc.analysis_id = t.u('AN1') and lc.kind = 'misconception';
  select lc.id into v_a from public.lesson_claims lc where lc.analysis_id = t.u('AN1') and lc.kind = 'skill_mastery' and lc.skill_id = 't.mat.a';
  select lc.id into v_h from public.lesson_claims lc where lc.analysis_id = t.u('AN1') and lc.kind = 'hesitation' and lc.confidence = 0.79;
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.review_lesson_claim(%L, ''approve'')', v_b), '42501', 'bağsız eğitmen karar veremez');
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.review_lesson_claim(%L, ''approve'')', v_b), '42501', 'öğrenci karar veremez');
  perform t.as_user(t.u('parent'));
  perform t.raises(format('select public.review_lesson_claim(%L, ''approve'')', v_b), '42501', 'veli karar veremez');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.review_lesson_claim(%L, ''ok'')', v_b), 'OGR-LESSON-005%', 'geçersiz karar');
  perform t.raises(format('select public.review_lesson_claim(%L, ''edit'', ''{}'')', v_b), 'OGR-LESSON-005%', 'boş düzeltme');
  perform t.raises(format('select public.review_lesson_claim(%L, ''edit'', ''{"mastery_estimate": 1.5}'')', v_b), 'OGR-LESSON-005%', 'aralık dışı ustalık');

  v_r := public.review_lesson_claim(v_b, 'approve');
  perform t.ok(v_r ->> 'status' = 'approved' and (v_r ->> 'applied')::boolean and (v_r ->> 'pending')::int = 2, 'onay: hemen uygulanır');
  perform t.as_admin();
  perform t.ok((select m.p = 0.318 and m.evidence_count = 1 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.b'),
               'onaylanan eşik altı iddia kendi güveniyle karışır: 0,3 + 0,3·0,6·(0,4 − 0,3) = 0,318');
  perform t.ok((select lc.decided_by = t.u('inst') from public.lesson_claims lc where lc.id = v_b), 'karar veren eğitmen');

  perform t.as_user(t.u('inst'));
  v_r := public.review_lesson_claim(v_mis, 'edit', '{"text_instructor": "Mutlak değeri tek dal açıyor."}');
  perform t.ok(v_r ->> 'status' = 'edited', 'düzeltme');
  perform t.as_admin();
  perform t.ok((select lc.edited_value ->> 'text_instructor' = 'Mutlak değeri tek dal açıyor.' and lc.edited_value ->> 'tag' = 't.a.isaret-hatasi'
                  from public.lesson_claims lc where lc.id = v_mis), 'düzeltilmiş değer iddia değerine birleşir');
  perform t.ok((select o.value = 0.3 and o.misconception_tag = 't.a.isaret-hatasi' and o.confidence = 0.8
                  from public.observations o where o.source_id = v_mis::text), 'yanılgı → etiketli ders gözlemi (0,3; düzeltme güveni ≥ 0,80)');
  perform t.ok((select mc.status = 'pending_review' and mc.evidence_count = 1 from public.misconceptions mc
                 where mc.enrollment_id = t.u('EA') and mc.tag = 't.a.isaret-hatasi'), 'yanılgı sayacı');

  perform t.as_user(t.u('inst'));
  v_r := public.review_lesson_claim(v_h, 'reject');
  perform t.ok(v_r ->> 'status' = 'rejected' and (v_r ->> 'pending')::int = 0, 'ret; bekleyen kalmadı');
  perform t.as_admin();
  perform t.ok((select l.status = 'corrected' from public.lessons l where l.id = t.u('L1'))
               and (select la.status = 'corrected' and la.approved_by = t.u('inst') from public.lesson_analyses la where la.id = t.u('AN1')),
               'bekleyen yok + düzeltme var: ders ve analiz corrected');
  perform t.ok((select count(*) >= 2 from secure.job_outbox o where o.name = 'memory.apply' and o.data ->> 'lesson_id' = t.v('L1')),
               'inceleme bitince hafıza işi yeniden');

  -- geri al: t.mat.b'nin son gözlemi bu iddianınki → ustalık geri döner
  perform t.as_user(t.u('inst'));
  v_r := public.review_lesson_claim(v_b, 'reject');
  perform t.as_admin();
  perform t.ok((select m.p = 0.3 and m.evidence_count = 0 and m.last_observation_id is null
                  from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.b'), 'geri al: ustalık ve kanıt sayısı geri');
  perform t.ok((select lc.status = 'rejected' and lc.applied_at is null and lc.applied_ref ? 'reverted_at' from public.lesson_claims lc where lc.id = v_b),
               'geri alınan iddia rejected, iz kalır');
  perform t.ok(exists (select 1 from public.mastery_history h where h.enrollment_id = t.u('EA') and h.skill_id = 't.mat.b'
                                                              and h.method = 'instructor_override' and h.p_after = 0.3),
               'mastery_history: geri alma satırı');
  -- t.mat.a'ya yanılgı gözlemi sonra geldi → ustalık iddiası geri alınamaz
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.review_lesson_claim(%L, ''reject'')', v_a), 'OGR-LESSON-006%', 'sonra kanıt geldiyse geri alınamaz');
  -- önce yanılgıyı geri al (son gözlem), sonra ustalık iddiası
  perform public.review_lesson_claim(v_mis, 'reject');
  perform t.as_admin();
  perform t.ok((select m.p = 0.453 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a'), 'yanılgı geri alındı: ustalık önceki değerde');
  perform t.ok((select mc.status = 'rejected' and mc.evidence_count = 0 from public.misconceptions mc
                 where mc.enrollment_id = t.u('EA') and mc.tag = 't.a.isaret-hatasi'), 'tek kanıtlı yanılgı geri alınınca rejected');
  perform t.as_user(t.u('inst'));
  perform public.review_lesson_claim(v_a, 'reject');
  perform t.as_admin();
  perform t.ok((select m.p = 0.3 and m.evidence_count = 0 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a'),
               'ustalık iddiası geri alındı');
  -- reddedilen iddia yeniden onaylanabilir
  perform t.as_user(t.u('inst'));
  v_r := public.review_lesson_claim(v_b, 'approve');
  perform t.as_admin();
  perform t.ok((select count(*) = 2 from public.observations o where o.source_id = v_b::text)
               and (select m.evidence_count = 1 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.b'),
               'yeniden onay: yeni gözlem');
  -- uygulanmış iddiaya approve değişiklik yapmaz
  perform t.as_user(t.u('inst'));
  v_r := public.review_lesson_claim(v_b, 'approve');
  perform t.ok(not (v_r ->> 'changed')::boolean, 'uygulanmış iddiaya onay: değişiklik yok');
  perform t.as_admin();
end $$;

-- takip iddiası (previous_profile_check) ve yeniden analiz
do $$
declare
  v_mc uuid;
  v_mcb uuid;
  v_r jsonb;
  v_old uuid;
  v_f uuid;
  v_claims jsonb;
begin
  insert into public.misconceptions (enrollment_id, skill_id, tag, text_instructor, text_student, status, evidence_count)
  values (t.u('EA'), 't.mat.b', null, 'Uç noktaları dahil ediyor.', 'Uç noktalara bak.', 'open', 3) returning id into v_mc;
  insert into public.misconceptions (enrollment_id, skill_id, tag, text_instructor, text_student, status, evidence_count)
  values (t.u('EB'), 't.mat.b', null, 'Başka öğrenci.', 'Başka.', 'open', 3) returning id into v_mcb;
  v_claims := jsonb_build_array(
    jsonb_build_object('kind', 'skill_mastery', 'skill_id', 't.mat.b', 'value', jsonb_build_object('mastery_estimate', 0.7), 'confidence', 0.95,
                       'quote', 'Uç noktalar dahil değil.', 'speaker', 'ÖĞRENCİ', 't', '00:10:00'),
    jsonb_build_object('kind', 'followup', 'misconception_id', v_mc, 'value', jsonb_build_object('status', 'improved'), 'confidence', 0.91,
                       'quote', 'Artık ilk iş uçlara bakıyorum.', 'speaker', 'ÖĞRENCİ', 't', 1272),
    jsonb_build_object('kind', 'followup', 'misconception_id', v_mcb, 'value', jsonb_build_object('status', 'improved'), 'confidence', 0.91,
                       'quote', 'x', 'speaker', 'ÖĞRENCİ', 't', 1300),
    jsonb_build_object('kind', 'course_insight', 'value', jsonb_build_object('kind', 'exam_hint', 'topic', 'Limit', 'text', 'Finalde limit var.'),
                       'confidence', 0.95, 'quote', 'Finalde limitten soru var.', 'speaker', 'EĞİTMEN', 't', '00:30:00'));
  perform t.as_service();
  v_r := public.write_lesson_analysis(t.u('L2'), jsonb_build_object('analysis', '{"schema_version": "1.0"}'::jsonb, 'model', 'fake', 'claims', v_claims));
  v_old := (v_r ->> 'analysis_id')::uuid;
  perform t.ok((v_r ->> 'claims')::int = 3 and (v_r ->> 'dropped')::int = 1, 'başka kaydın yanılgısına takip düşer');
  v_r := public.write_lesson_analysis(t.u('L2'), jsonb_build_object('analysis', '{"schema_version": "1.0"}'::jsonb, 'model', 'fake', 'claims', v_claims));
  perform t.ok((v_r ->> 'version')::int = 2, 'yeniden analiz: sürüm 2');
  perform t.as_admin();
  perform t.ok((select bool_and(lc.status = 'rejected' and lc.decided_by is null) from public.lesson_claims lc where lc.analysis_id = v_old),
               'eski sürümün bekleyen iddiaları reddedildi');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.review_lesson_claim(%L, ''approve'')',
                          (select lc.id from public.lesson_claims lc where lc.analysis_id = v_old limit 1)),
                   'OGR-LESSON-005%eski%', 'eski sürüm iddiası kararlaştırılamaz');
  v_r := public.apply_lesson_claims(t.u('L2'));
  perform t.ok((v_r ->> 'applied')::int = 3 and (v_r ->> 'pending')::int = 0, 'eğitmen "Dossier''e uygula": üçü de eşik üstü');
  perform t.as_admin();
  perform t.ok((select mc.status = 'resolved' and mc.resolved_by is null and mc.resolution_observation_id is not null
                  from public.misconceptions mc where mc.id = v_mc), 'takip (improved) → yanılgı çözüldü, çözüm kanıtı ders gözlemi');
  perform t.ok((select o.value = 0.8 and o.kind = 'lesson' from public.observations o
                 join public.misconceptions mc on mc.resolution_observation_id = o.id where mc.id = v_mc), 'çözüm gözlemi 0,8');
  perform t.ok((select l.status = 'approved' from public.lessons l where l.id = t.u('L2')), 'bekleyen yok: ders approved');
  perform t.ok(not exists (select 1 from public.syllabus_topics st where st.title = 'Limit'), 'exam_hint izlenceye yazılmaz (yalnız hafıza)');
  select lc.id into v_f from public.lesson_claims lc join public.lesson_analyses la on la.id = lc.analysis_id
   where la.lesson_id = t.u('L2') and la.version = 2 and lc.kind = 'followup';
  perform t.as_user(t.u('inst'));
  perform public.review_lesson_claim(v_f, 'reject');
  perform t.as_admin();
  perform t.ok((select mc.status = 'open' and mc.resolution_observation_id is null and mc.resolved_at is null
                  from public.misconceptions mc where mc.id = v_mc), 'takip geri alındı: yanılgı yeniden open');
  perform t.ok((select l.status = 'approved' from public.lessons l where l.id = t.u('L2')), 'ret sonrası bekleyen yok: approved kalır');
end $$;

-- eşik ayarı ve sınıf dersi
do $$
declare
  v_r jsonb;
begin
  perform t.as_service();
  perform public.write_lesson_analysis(t.u('L3'), jsonb_build_object('analysis', '{"schema_version": "1.0"}'::jsonb, 'claims', jsonb_build_array(
    jsonb_build_object('kind', 'skill_mastery', 'skill_id', 't.mat.a', 'value', jsonb_build_object('mastery_estimate', 0.8), 'confidence', 0.7,
                       'quote', 'q', 'speaker', 'ÖĞRENCİ', 't', 5))));
  v_r := public.apply_lesson_claims(t.u('L3'));
  perform t.ok((v_r ->> 'applied')::int = 0 and (v_r ->> 'pending')::int = 1, '0,70 < 0,80: bekler');
  perform t.as_user(t.u('inst'));
  perform public.lesson_set_options(t.u('L3'), '{"auto_apply_threshold": 0.7}');
  v_r := public.apply_lesson_claims(t.u('L3'));
  perform t.ok((v_r ->> 'applied')::int = 1 and (v_r ->> 'threshold')::numeric = 0.7, 'eşik 0,70''e inince "Dossier''e uygula" uygular');
  perform t.as_admin();
  perform t.ok((select m.p = 0.405 and m.evidence_count = 1 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a'),
               'tek uygulama: 0,3 + 0,3·0,7·(0,8 − 0,3) = 0,405');

  -- aynı analiz iki kez yazılırsa (iş yeniden denendi): eski sürümün uygulanmışı geri alınır, kanıt tek sayılır
  perform t.as_service();
  v_r := public.write_lesson_analysis(t.u('L3'), jsonb_build_object('analysis', '{"schema_version": "1.0"}'::jsonb, 'claims', jsonb_build_array(
    jsonb_build_object('kind', 'skill_mastery', 'skill_id', 't.mat.a', 'value', jsonb_build_object('mastery_estimate', 0.8), 'confidence', 0.7,
                       'quote', 'q', 'speaker', 'ÖĞRENCİ', 't', 5))));
  perform t.ok((v_r ->> 'version')::int = 2 and (v_r ->> 'reverted')::int = 1, 'v2: v1''in uygulanmış iddiası geri alındı');
  v_r := public.apply_lesson_claims(t.u('L3'));
  perform t.ok((v_r ->> 'applied')::int = 1, 'v2 uygulandı');
  perform t.as_admin();
  perform t.ok((select m.p = 0.405 and m.evidence_count = 1 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a'),
               'analiz iki kez yazıldı: ustalık ve kanıt sayısı tek uygulamadaki gibi');
  perform t.ok((select count(*) = 1 from public.lesson_claims lc join public.lesson_analyses la on la.id = lc.analysis_id
                 where la.lesson_id = t.u('L3') and lc.applied_at is not null), 'uygulanmış iddia tek (yalnız son sürüm)');
  perform t.ok((select count(*) = 1 from public.observations o join public.lesson_claims lc on lc.id::text = o.source_id
                  join public.lesson_analyses la on la.id = lc.analysis_id
                 where la.lesson_id = t.u('L3') and lc.applied_at is not null), 'etkin gözlem tek');

  perform t.as_service();
  perform public.write_lesson_analysis(t.u('LC'), jsonb_build_object('analysis', '{"schema_version": "1.0"}'::jsonb, 'claims', jsonb_build_array(
    jsonb_build_object('kind', 'skill_mastery', 'skill_id', 't.mat.b', 'value', jsonb_build_object('mastery_estimate', 0.9), 'confidence', 0.95,
                       'quote', 'Sınıfta biri doğru söyledi.', 'speaker', 'ÖĞRENCİ', 't', 5),
    jsonb_build_object('kind', 'course_insight', 'value', jsonb_build_object('kind', 'syllabus_topic', 'topic', 'Mutlak değerli eşitsizlikler', 'text', 'tekrar'),
                       'confidence', 0.95, 'quote', 'q', 'speaker', 'EĞİTMEN', 't', 9))));
  v_r := public.apply_lesson_claims(t.u('LC'));
  perform t.ok((v_r ->> 'applied')::int = 2, 'sınıf dersi iddiaları onaylandı');
  perform t.as_admin();
  perform t.ok(not exists (select 1 from public.observations o join public.lesson_claims lc on lc.id::text = o.source_id
                            join public.lesson_analyses la on la.id = lc.analysis_id where la.lesson_id = t.u('LC')),
               'sınıf dersinde gözlem yazılmaz (kimin kanıtı belli değil)');
  perform t.ok((select lc.applied_ref ->> 'skipped' = 'course_lesson' from public.lesson_claims lc join public.lesson_analyses la on la.id = lc.analysis_id
                 where la.lesson_id = t.u('LC') and lc.kind = 'skill_mastery'), 'iz: course_lesson');
  perform t.ok((select count(*) = 1 from public.syllabus_topics st where st.course_id = t.u('course') and st.title = 'Mutlak değerli eşitsizlikler'),
               'aynı izlence başlığı ikinci kez açılmaz');
  perform t.ok(exists (select 1 from secure.job_outbox o where o.name = 'memory.apply' and o.data ->> 'lesson_id' = t.v('LC')
                                                         and o.data -> 'student_ids' @> jsonb_build_array(t.v('A'), t.v('B'))),
               'sınıf dersi hafızası: derse kayıtlı öğrenciler');
end $$;

rollback;
