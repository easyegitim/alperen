-- tests/16_curriculum_builder.sql — müfredat kurucu RPC'leri (0025) authenticated olarak (SET LOCAL ROLE + JWT claim):
--   * save_curriculum_draft / curriculum_draft_supersede / curriculum_autopilot_accept yalnız worker (authenticated'a izin
--     yok); ilk 'practice' önerisi yalnız otopilotta (TYT taslağı: var, üniversite dersi: yok); etiket çakışması
--     müfredata özgü önekle yeniden adlandırılır, o da çakışırsa tags_dropped.
--   * curriculum_edit / publish / set_autopilot / new_version / editor_state: öğrenci, veli ve bağsız eğitmen 42501;
--     öğrencisi üzerinden bağlı eğitmen taslağı düzenler (rename/add/move/merge) ama başka eğitmenin (bağsız) öğrencisi
--     de kullanıyorsa yayınlayamaz ve otopilotu değiştiremez; dersin sahibi eğitmen yeni sürüm açar.
--   * derinlik > 4 OGR-CURR-022, kanıtlı kazanım birleştirme OGR-CURR-023, yayındaki sürüm OGR-CURR-020.
--   * draft_meta / draft_error authenticated'a kapalı (sütun yetkisi); editör curriculum_editor_state ile okur.
--   * curriculum_draft_retry: yalnız düşen + kazanımsız taslak (OGR-CURR-013), yetki ve kaynak sahipliği (42501; bağsız
--     öğrencinin yüklemesi de).
--   * Otopilot kapısı: otopilotu etkin olmayan onaylanmamış taslakta start_practice OGR-PRAC-008; TYT taslağında açılır.
--   * decide_proposal yayındaki ağaca yazmaz (açık taslak sürüme taşır; yeni sürüm yetkisi yoksa OGR-CURR-031).
--   * Yayın açık önerileri kodları çevrilerek yeni sürüme taşır, karşılığı kalmayanı notla reddeder; taslaktan açılan
--     sürüm birleşme eşlemesini taşır; daha yeni açık taslak varken eski taslak yayınlanmaz (OGR-CURR-026).
begin;
\ir _fixture.sql

create function t.draft(p_root text, p_tags jsonb default '[]'::jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'nodes', jsonb_build_array(
      jsonb_build_object('code', p_root, 'parent_code', null, 'name', 'Kök', 'kind', 'unit'),
      jsonb_build_object('code', p_root || '.u1', 'parent_code', p_root, 'name', 'Atom', 'kind', 'unit'),
      jsonb_build_object('code', p_root || '.u1.a', 'parent_code', p_root || '.u1', 'name', 'Atom modelleri', 'kind', 'outcome'),
      jsonb_build_object('code', p_root || '.u1.b', 'parent_code', p_root || '.u1', 'name', 'Atomun yapısı', 'kind', 'outcome'),
      jsonb_build_object('code', p_root || '.u2', 'parent_code', p_root, 'name', 'Bağlar', 'kind', 'unit'),
      jsonb_build_object('code', p_root || '.u2.c', 'parent_code', p_root || '.u2', 'name', 'İyonik bağ', 'kind', 'outcome')),
    'prerequisites', jsonb_build_array(jsonb_build_object('skill_code', p_root || '.u1.b', 'prereq_code', p_root || '.u1.a', 'strength', 0.6)),
    'misconception_tags', p_tags,
    'confidence', 0.8, 'notes_for_instructor', 'Sahte taslak.')
$$;
grant execute on function t.draft(text, jsonb) to public;

-- Dünya: üniversite dersi taslağı D (Elif + bağsız Deniz kayıtlı), TYT taslağı T (Can kayıtlı), düşen taslak F (Elif)
do $$
declare
  v_id uuid;
  v_course uuid;
begin
  perform t.add_outsiders();
  insert into public.curricula (code, version, label, status, origin, created_by)
  values ('T-KIM', '1', 'Kimya 101', 'draft', 'ai_draft', t.u('elif')) returning id into v_id;
  insert into public.courses (code, title, kind, curriculum_id, visibility) values ('T-KIM', 'Kimya 101', 'university', v_id, 'shared')
  returning id into v_course;
  insert into t.cfg values ('D', v_id::text), ('DC', v_course::text);
  insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values (t.u('A'), v_id, v_course, '2026 Güz')
  returning id into v_id;
  insert into t.cfg values ('ED', v_id::text);
  insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values (t.u('C'), t.u('D'), v_course, '2026 Güz')
  returning id into v_id;
  insert into t.cfg values ('EDD', v_id::text);

  insert into public.curricula (code, version, label, status, origin, created_by)
  values ('TYT-KIMYA-T', '1', 'TYT Kimya', 'draft', 'ai_draft', t.u('can')) returning id into v_id;
  insert into public.courses (code, title, kind, curriculum_id, visibility) values ('TYT-KIMYA-T', 'TYT Kimya', 'exam_track', v_id, 'shared')
  returning id into v_course;
  insert into t.cfg values ('T', v_id::text);
  insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values (t.u('B'), v_id, v_course, 'YKS 2027')
  returning id into v_id;
  insert into t.cfg values ('ET', v_id::text);

  insert into public.curricula (code, version, label, status, origin, created_by)
  values ('T-BIYO', '1', 'Biyoloji 101', 'draft', 'ai_draft', t.u('elif')) returning id into v_id;
  update public.curricula c set draft_status = 'failed', draft_error = 'ücretli LLM çağrısı kapalı (disabled)' where c.id = v_id;
  insert into public.courses (code, title, kind, curriculum_id, visibility) values ('T-BIYO', 'Biyoloji 101', 'university', v_id, 'shared')
  returning id into v_course;
  insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values (t.u('A'), v_id, v_course, '2026 Güz');
  insert into t.cfg values ('F', v_id::text);
  -- D'nin müfredata özgü etiket öneki de dolu: bu etiket yazılmaz (tags_dropped)
  insert into public.misconception_tags (tag, curriculum_id, skill_id, text_instructor, text_student)
  values (app.code_slug('T-KIM') || '-' || left(replace(t.v('D'), '-', ''), 8) || '.t.a.isaret-hatasi', t.u('cur'), 't.mat.a', 'x', 'y');
end $$;

-- Taslak kaydı yalnız worker; ilk öneri yalnız otopilotta
do $$
declare
  v_r jsonb;
  v_queued boolean;
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.save_curriculum_draft(%L, %L::jsonb)$q$, t.v('D'), t.draft('kim')), '42501', 'öğrenci taslak yazamaz');
  perform t.as_user(t.u('inst'));
  perform t.raises(format($q$select public.save_curriculum_draft(%L, %L::jsonb)$q$, t.v('D'), t.draft('kim')), '42501', 'eğitmen taslak yazamaz');
  perform t.raises(format($q$select public.curriculum_draft_supersede(%L, %L)$q$, t.v('D'), t.v('cur')), '42501', 'eğitmen taslağı bırakamaz');
  perform t.raises(format($q$select public.curriculum_autopilot_accept(%L)$q$, gen_random_uuid()), '42501', 'eğitmen otopilot kabulü yapamaz');

  perform t.as_service();
  v_r := public.save_curriculum_draft(t.u('D'), t.draft('kim', jsonb_build_array(
    jsonb_build_object('tag', 't.a.isaret-hatasi', 'skill_code', 'kim.u1.a', 'text_instructor', 'a', 'text_student', 'b'),
    jsonb_build_object('tag', 'kim.yeni-etiket', 'skill_code', 'kim.u1.b', 'text_instructor', 'a', 'text_student', 'b'))));
  perform t.ok((v_r ->> 'created')::boolean and (v_r ->> 'skills')::int = 6 and (v_r ->> 'suggestions')::int = 0
               and not (v_r ->> 'autopilot')::boolean, 'üniversite dersi (Kimya 101): taslak kuruldu, otopilot kapalı, öneri yok (' || v_r::text || ')');
  perform t.ok((v_r ->> 'tags')::int = 1 and v_r -> 'tags_dropped' = '["t.a.isaret-hatasi"]'::jsonb,
               'çakışan etiket önekli adıyla da çakışınca yazılmaz ve tags_dropped''a girer');
  v_r := public.save_curriculum_draft(t.u('T'), t.draft('kim', jsonb_build_array(
    jsonb_build_object('tag', 'kim.yeni-etiket', 'skill_code', 'kim.u1.b', 'text_instructor', 'a', 'text_student', 'b'))));
  perform t.ok((v_r ->> 'suggestions')::int = 1 and (v_r ->> 'autopilot')::boolean and v_r -> 'first_skill_ids' = '["kim.u1.a", "kim.u1.b"]'::jsonb,
               'TYT taslağı: otopilot açık, ilk practice önerisi (' || v_r::text || ')');
  perform t.ok((v_r -> 'tags_renamed' -> 0 ->> 'to') = app.code_slug('TYT-KIMYA-T') || '-' || left(replace(t.v('T'), '-', ''), 8) || '.kim.yeni-etiket',
               'çakışan etiket müfredata özgü önekle yeniden adlandırılır');
  perform t.as_admin();
  perform t.ok(not exists (select 1 from public.suggestions s where s.enrollment_id in (t.u('ED'), t.u('EDD')))
               and exists (select 1 from public.suggestions s where s.enrollment_id = t.u('ET') and s.kind = 'practice' and s.rank = 0),
               'öneri satırları: D kayıtlarında yok, T kaydında var');
  -- ilk kartı alan kayda kartın yaprakları için practice.prewarm (0027 app.first_practice_suggestion); pg-boss yoksa outbox
  v_queued := exists (select 1 from secure.job_outbox o where o.name = 'practice.prewarm' and o.data ->> 'enrollment_id' = t.v('ET')
                        and o.data ->> 'reason' = 'curriculum_ready' and o.data -> 'skill_ids' = '["kim.u1.a", "kim.u1.b"]'::jsonb);
  if not v_queued and to_regclass('pgboss.job') is not null then
    execute $q$select exists (select 1 from pgboss.job j where j.name = 'practice.prewarm' and j.data ->> 'enrollment_id' = $1
                                and j.data ->> 'reason' = 'curriculum_ready' and j.data -> 'skill_ids' = '["kim.u1.a", "kim.u1.b"]'::jsonb)$q$
      into v_queued using t.v('ET');
  end if;
  perform t.ok(v_queued, 'otopilotlu taslağın ilk kartı practice.prewarm işini kuyruğa atar (kartın yaprakları)');
  perform t.ok(not exists (select 1 from secure.job_outbox o where o.name = 'practice.prewarm' and o.data ->> 'enrollment_id' in (t.v('ED'), t.v('EDD'))),
               'otopilotsuz taslakta SQL ön ısıtma atmaz');
  perform t.ok((select c.draft_meta -> 'tags_dropped' = '["t.a.isaret-hatasi"]'::jsonb from public.curricula c where c.id = t.u('D')),
               'draft_meta.tags_dropped yazıldı');
end $$;

-- Otopilot kapısı (PLAN §3.5): onaylanmamış taslakta öğrenci yalnız otopilot etkinse başlar
do $$
declare
  v_s jsonb;
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.start_practice(null, %L)$q$, t.v('ED')), 'OGR-PRAC-008%',
                   'otopilot kapalı hazır taslak (Kimya 101): alıştırma eğitmen onayını bekler');
  perform t.as_user(t.u('can'));
  v_s := public.start_practice(null, t.u('ET'));
  perform t.ok(v_s ->> 'set_id' is not null and v_s ->> 'status' in ('in_progress', 'needs_generation'),
               'otopilot etkin TYT taslağında alıştırma açılır (' || coalesce(v_s ->> 'status', '-') || ')');
end $$;

-- Yetkisizler: öğrenci, veli, bağsız eğitmen
do $$
declare
  v_who text;
begin
  foreach v_who in array array['elif', 'parent', 'inst2'] loop
    perform t.as_user(t.u(v_who));
    perform t.raises(format($q$select public.curriculum_edit(%L, 'rename', '{"skill_id":"kim.u1","name":"Atom ve yapı"}')$q$, t.v('D')),
                     '42501', v_who || ': curriculum_edit reddedilir');
    perform t.raises(format($q$select public.curriculum_publish(%L)$q$, t.v('D')), '42501', v_who || ': curriculum_publish reddedilir');
    perform t.raises(format($q$select public.curriculum_set_autopilot(%L, true)$q$, t.v('D')), '42501', v_who || ': curriculum_set_autopilot reddedilir');
    perform t.raises(format($q$select public.curriculum_new_version(%L)$q$, t.v('cur')), '42501', v_who || ': curriculum_new_version reddedilir');
    perform t.raises(format($q$select public.curriculum_draft_retry(%L)$q$, t.v('F')), '42501', v_who || ': curriculum_draft_retry reddedilir');
  end loop;
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.curriculum_editor_state(%L)$q$, t.v('D')), '42501', 'öğrenci editör durumunu okuyamaz');
  perform t.raises(format($q$select draft_meta from public.curricula where id = %L$q$, t.v('D')), '42501', 'öğrenci draft_meta okuyamaz');
  perform t.raises(format($q$select draft_error from public.curricula where id = %L$q$, t.v('F')), '42501', 'öğrenci draft_error okuyamaz');
  perform t.ok(t.n(format($q$select id, status, draft_status, draft_progress from public.curricula where id = %L$q$, t.v('D'))) = 1,
               'öğrenci müfredatın durumunu ve ilerlemesini okur');
  perform t.ok((public.curriculum_autopilot_state(t.u('D')) ->> 'reason') = 'not_exam_track', 'öğrenci otopilot durumunu okur');
  perform t.as_user(t.u('inst'));
  perform t.raises(format($q$select draft_meta from public.curricula where id = %L$q$, t.v('D')), '42501', 'eğitmen de draft_meta''yı tablodan okuyamaz');
  perform t.ok((public.curriculum_editor_state(t.u('D')) -> 'draft' ->> 'notes_for_instructor') = 'Sahte taslak.'
               and (public.curriculum_editor_state(t.u('F')) -> 'draft' ->> 'error') like 'ücretli LLM%'
               and (public.curriculum_editor_state(t.u('F')) -> 'draft' ->> 'can_retry')::boolean,
               'eğitmen taslak notunu ve hatasını editör durumundan okur');
end $$;

-- Öğrencisi üzerinden bağlı eğitmen taslağı düzenler; paylaşılan taslağı yayınlayamaz
do $$
declare
  v_r jsonb;
  v_s jsonb;
  v_add text;
begin
  perform t.as_user(t.u('inst'));
  v_s := public.curriculum_editor_state(t.u('D'));
  perform t.ok((v_s ->> 'can_edit')::boolean and not (v_s ->> 'can_publish')::boolean,
               'bağlı eğitmen: düzenler, yayınlayamaz (bağsız öğrenci de kayıtlı)');
  v_r := public.curriculum_edit(t.u('D'), 'rename', '{"skill_id":"kim.u1","name":"Atom ve yapısı"}');
  perform t.ok(v_r ->> 'name' = 'Atom ve yapısı', 'rename');
  v_r := public.curriculum_edit(t.u('D'), 'add', '{"parent_id":"kim.u1.a","name":"Bohr modeli"}');
  v_add := v_r ->> 'skill_id';
  perform t.ok(v_add = 'kim.u1.a.bohr-modeli' and v_r ->> 'kind' = 'sub_outcome', 'add: kod üst koddan türer, derinlik 4 alt kazanım');
  perform t.raises(format($q$select public.curriculum_edit(%L, 'add', %L::jsonb)$q$, t.v('D'), jsonb_build_object('parent_id', v_add, 'name', 'Çok derin')),
                   'OGR-CURR-022%', 'derinlik 5 reddedilir');
  v_r := public.curriculum_edit(t.u('D'), 'move', '{"skill_id":"kim.u1.b","direction":"up"}');
  perform t.ok((v_r ->> 'moved')::boolean, 'move up');
  v_r := public.curriculum_edit(t.u('D'), 'move', '{"skill_id":"kim.u1.b","parent_id":"kim.u2"}');
  perform t.ok(v_r ->> 'old_parent_id' = 'kim.u1', 'move: başka üst düğüme');
  perform t.raises(format($q$select public.curriculum_edit(%L, 'move', '{"skill_id":"kim.u1","parent_id":%s}')$q$, t.v('D'), to_json(v_add::text)),
                   'OGR-CURR-022%', 'kendi altına taşınamaz');
  v_r := public.curriculum_edit(t.u('D'), 'merge', '{"keep_id":"kim.u2.c","drop_id":"kim.u1.b"}');
  perform t.ok(v_r ->> 'dropped' = 'kim.u1.b', 'merge');
  perform t.as_admin();
  perform t.ok((select c.draft_meta -> 'code_map' ->> 'kim.u1.b' = 'kim.u2.c' from public.curricula c where c.id = t.u('D'))
               and not exists (select 1 from public.skills s where s.curriculum_id = t.u('D') and s.id = 'kim.u1.b'),
               'birleşme eşlemesi draft_meta.code_map''e yazıldı');
  -- kanıtlı kazanım birleştirilemez
  insert into public.mastery (enrollment_id, curriculum_id, skill_id, p, evidence_count) values (t.u('ED'), t.u('D'), 'kim.u2.c', 0.6, 3);
  perform t.as_user(t.u('inst'));
  perform t.raises(format($q$select public.curriculum_edit(%L, 'merge', '{"keep_id":"kim.u1.a","drop_id":"kim.u2.c"}')$q$, t.v('D')),
                   'OGR-CURR-023%', 'kanıtı olan kazanım bu sürümde birleştirilemez');
  perform t.raises(format($q$select public.curriculum_edit(%L, 'rename', '{"skill_id":"t.mat.a","name":"Yeni ad"}')$q$, t.v('cur')),
                   'OGR-CURR-020%', 'yayındaki sürüm düzenlenmez');
  perform t.raises(format($q$select public.curriculum_publish(%L)$q$, t.v('D')), '42501', 'bağlı eğitmen paylaşılan taslağı yayınlayamaz');
  perform t.raises(format($q$select public.curriculum_set_autopilot(%L, true)$q$, t.v('D')), '42501', 'bağlı eğitmen paylaşılan taslağın otopilotunu değiştiremez');
  -- bağsız öğrencinin kaydı kapanınca bütün kayıtlar bu eğitmenin: yayınlar
  perform t.as_admin();
  update public.enrollments e set status = 'closed' where e.id = t.u('EDD');
  perform t.as_user(t.u('inst'));
  v_r := public.curriculum_publish(t.u('D'));
  perform t.ok(v_r ->> 'status' = 'active', 'kayıtların hepsi kendi öğrencisiyse yayınlar');
  perform t.raises(format($q$select public.curriculum_edit(%L, 'rename', '{"skill_id":"kim.u1","name":"Atom"}')$q$, t.v('D')),
                   'OGR-CURR-020%', 'yayından sonra düzenleme yeni sürüm ister');
  -- dersin sahibi eğitmen yeni sürüm açar; öğrenci/veli/bağsız eğitmen açamaz (yukarıda)
  perform t.ok(public.curriculum_new_version(t.u('cur')) is not null, 'dersin sahibi eğitmen yeni sürüm açar');
  -- yayındaki D'yi bağsız öğrenci de kullanıyorsa bağlı eğitmen yeni sürüm açamaz: kabul OGR-CURR-031, ret yerinde
  perform t.as_admin();
  update public.enrollments e set status = 'active' where e.id = t.u('EDD');
  insert into public.curriculum_proposals (curriculum_id, kind, payload) values (t.u('D'), 'rename', '{"skill_id":"kim.u2","name":"Kimyasal bağlar"}')
  returning id::text into v_add;
  perform t.as_user(t.u('inst'));
  perform t.raises(format($q$select public.decide_proposal(%L, true)$q$, v_add), 'OGR-CURR-031%',
                   'yeni sürüm yetkisi yokken yayındaki sürüme kabul reddedilir');
  perform t.ok(public.decide_proposal(v_add::uuid, false, 'gerek yok') ->> 'status' = 'rejected', 'ret yayındaki sürümde yerinde');
  perform t.ok((select s.name = 'Bağlar' from public.skills s where s.curriculum_id = t.u('D') and s.id = 'kim.u2'), 'yayındaki ağaç değişmedi');
end $$;

-- Sürüm zinciri ve öneriler: yayındaki X → taslak v2 (birleştirme) → taslaktan v3. Kabul açık taslağa gider; eski
-- taslak yayınlanmaz (OGR-CURR-026); v3 yayınında açık öneriler kodla taşınır, karşılığı kalmayanlar notla kapanır.
do $$
declare
  v_x uuid;
  v_v2 uuid;
  v_v3 uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_p3 uuid;
  v_p4 uuid;
  v_p5 uuid;
  v_done uuid;
  v_r jsonb;
begin
  perform t.as_admin();
  insert into public.curricula (code, version, label, status, origin, created_by)
  values ('T-ZINCIR', '1', 'Zincir', 'active', 'instructor', t.u('inst')) returning id into v_x;
  insert into public.skills (curriculum_id, id, parent_id, name, kind, is_leaf, order_no) values
    (v_x, 'z', null, 'Kök', 'unit', false, 1), (v_x, 'z.a', 'z', 'A', 'outcome', true, 2),
    (v_x, 'z.b', 'z', 'B', 'outcome', true, 3), (v_x, 'z.c', 'z', 'C', 'outcome', true, 4);
  insert into public.curriculum_proposals (curriculum_id, kind, payload) values (v_x, 'add_subskill', '{"parent_id":"z.c","name":"C alt"}')
  returning id into v_p1;
  insert into public.curriculum_proposals (curriculum_id, kind, payload) values (v_x, 'rename', '{"skill_id":"z.b","name":"B yeni"}')
  returning id into v_p2;
  insert into public.curriculum_proposals (curriculum_id, kind, payload) values (v_x, 'merge', '{"keep_id":"z.a","drop_id":"z.c"}')
  returning id into v_p3;
  insert into public.curriculum_proposals (curriculum_id, kind, payload) values (v_x, 'rename', '{"skill_id":"z.yok","name":"Yok"}')
  returning id into v_p4;
  insert into public.curriculum_proposals (curriculum_id, kind, payload, status) values (v_x, 'rename', '{"skill_id":"z.a","name":"Eski"}', 'rejected')
  returning id into v_done;

  perform t.as_user(t.u('inst'));
  v_v2 := public.curriculum_new_version(v_x);
  perform public.curriculum_edit(v_v2, 'merge', '{"keep_id":"z.a","drop_id":"z.c"}');
  -- yayındaki X'e gelen yeni öneri: eğitmenin kabulü X'e değil açık taslak v2'ye uygulanır
  perform t.as_admin();
  insert into public.curriculum_proposals (curriculum_id, kind, payload) values (v_x, 'add_subskill', '{"parent_id":"z.b","name":"B alt"}')
  returning id into v_p5;
  perform t.as_user(t.u('inst'));
  v_r := public.decide_proposal(v_p5, true, 'uygun');
  perform t.ok((v_r ->> 'new_version')::boolean and (v_r ->> 'curriculum_id')::uuid = v_v2 and (v_r ->> 'applied')::boolean,
               'yayındaki sürüme kabul açık taslak sürüme uygulanır (' || v_r::text || ')');
  perform t.ok(not exists (select 1 from public.skills s where s.curriculum_id = v_x and s.parent_id = 'z.b')
               and exists (select 1 from public.skills s where s.curriculum_id = v_v2 and s.parent_id = 'z.b' and s.name = 'B alt')
               and (select s.is_leaf from public.skills s where s.curriculum_id = v_x and s.id = 'z.b'),
               'yayındaki ağaç değişmez, yaprak taslakta');
  perform t.ok((select cp.curriculum_id = v_v2 and cp.payload ->> 'origin_curriculum_id' = v_x::text and cp.payload -> 'result' ->> 'curriculum_id' = v_v2::text
                  from public.curriculum_proposals cp where cp.id = v_p5), 'öneri taslağa taşındı ve sonucu yazıldı');

  -- taslaktan yeni sürüm (kanıtlı taslakta birleştirme yolu): birleşme eşlemesi taşınır; eski taslak yayınlanmaz
  v_v3 := public.curriculum_new_version(v_v2);
  perform t.as_admin();
  perform t.ok((select c.draft_meta -> 'code_map' ->> 'z.c' = 'z.a' and c.previous_id = v_v2 from public.curricula c where c.id = v_v3),
               'taslaktan açılan sürüm birleşme eşlemesini taşır');
  perform t.as_user(t.u('inst'));
  perform t.ok((public.curriculum_editor_state(v_x) ->> 'draft_child_id')::uuid = v_v3
               and (public.curriculum_editor_state(v_v2) ->> 'draft_child_id')::uuid = v_v3, 'editör en yeni açık taslağa yönlendirir');
  perform t.raises(format($q$select public.curriculum_publish(%L)$q$, v_v2), 'OGR-CURR-026%', 'daha yeni açık taslak varken eski taslak yayınlanmaz');
  perform t.ok((select c.status = 'draft' from public.curricula c where c.id = v_v3), 'yeni taslak emekliye ayrılmadı');

  v_r := public.curriculum_publish(v_v3);
  perform t.ok(v_r ->> 'status' = 'active' and v_r -> 'retired' @> jsonb_build_array(v_x, v_v2), 'v3 yayında; X ve v2 emekli');
  perform t.as_admin();
  perform t.ok((select cp.status = 'open' and cp.curriculum_id = v_v3 and cp.payload ->> 'origin_curriculum_id' = v_x::text
                       and cp.payload ->> 'parent_id' = 'z.a' from public.curriculum_proposals cp where cp.id = v_p1),
               'açık öneri yeni sürüme taşındı, kodu birleşme eşlemesiyle çevrildi (z.c → z.a)');
  perform t.ok((select cp.status = 'open' and cp.curriculum_id = v_v3 from public.curriculum_proposals cp where cp.id = v_p2),
               'karşılığı olan öneri taşındı');
  perform t.ok((select cp.status = 'rejected' and cp.curriculum_id = v_x and cp.payload ->> 'decision_note' like '%zaten birleşik%'
                  from public.curriculum_proposals cp where cp.id = v_p3), 'birleşmiş kazanımların birleştirme önerisi notla kapandı');
  perform t.ok((select cp.status = 'rejected' and cp.curriculum_id = v_x and cp.payload ->> 'decision_note' like '%yeni sürümde yok%'
                  from public.curriculum_proposals cp where cp.id = v_p4), 'kazanımı yeni sürümde olmayan öneri notla kapandı');
  perform t.ok((select cp.status = 'rejected' and cp.curriculum_id = v_x and not cp.payload ? 'decision_note'
                  from public.curriculum_proposals cp where cp.id = v_done), 'karara bağlanmış öneri eski sürümde kalır');
  perform t.ok((public.curriculum_editor_state(v_v3) ->> 'open_proposals')::int = 2, 'yeni sürüm editörü taşınan önerileri gösterir');
end $$;

-- Düşen taslağı yeniden kur
do $$
declare
  v_up_can uuid := gen_random_uuid();
  v_up_inst uuid := gen_random_uuid();
  v_up_deniz uuid := gen_random_uuid();
  v_f2 uuid;
  v_course uuid;
  v_r jsonb;
begin
  perform t.as_admin();
  insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime)
  values (v_up_can, t.u('can'), t.u('B'), 'pdf', t.v('can') || '/' || v_up_can || '.pdf', 'application/pdf'),
         (v_up_inst, t.u('inst'), null, 'pdf', t.v('inst') || '/' || v_up_inst || '.pdf', 'application/pdf');
  perform t.as_user(t.u('inst'));
  perform t.raises(format($q$select public.curriculum_draft_retry(%L)$q$, t.v('D')), 'OGR-CURR-013%', 'kazanımlı/yayındaki müfredat yeniden kurulmaz');
  perform t.raises(format($q$select public.curriculum_draft_retry(%L, array[%L]::uuid[])$q$, t.v('F'), v_up_can), '42501',
                   'başka öğrencinin yüklemesi kaynak olamaz');
  -- eğitmenin kendi taslağı ama kayıtlı öğrenci (Deniz) ona bağlı değil: öğrencinin özel yüklemesi kaynak olamaz
  perform t.as_admin();
  insert into public.curricula (code, version, label, status, origin, created_by)
  values ('T-FIZ', '1', 'Fizik 101', 'draft', 'ai_draft', t.u('inst')) returning id into v_f2;
  update public.curricula c set draft_status = 'failed' where c.id = v_f2;
  insert into public.courses (code, title, kind, curriculum_id, visibility) values ('T-FIZ', 'Fizik 101', 'university', v_f2, 'shared')
  returning id into v_course;
  insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values (t.u('C'), v_f2, v_course, '2026 Güz');
  insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime)
  values (v_up_deniz, t.u('deniz'), t.u('C'), 'pdf', t.v('deniz') || '/' || v_up_deniz || '.pdf', 'application/pdf');
  perform t.as_user(t.u('inst'));
  perform t.raises(format($q$select public.curriculum_draft_retry(%L, array[%L]::uuid[])$q$, v_f2, v_up_deniz), '42501',
                   'bağsız öğrencinin yüklemesi kaynak olamaz (taslağı düzenleme yetkisi yetmez)');
  perform t.ok(public.curriculum_draft_retry(v_f2) ->> 'draft_status' = 'queued', 'kaynaksız yeniden kurma çalışır');
  v_r := public.curriculum_draft_retry(t.u('F'), array[v_up_inst]);
  perform t.ok(v_r ->> 'draft_status' = 'queued' and v_r -> 'upload_ids' = jsonb_build_array(v_up_inst), 'düşen taslak kuyruğa döner');
  perform t.raises(format($q$select public.curriculum_draft_retry(%L)$q$, t.v('F')), 'OGR-CURR-013%', 'kuyruktaki taslak tekrar kurulmaz');
  perform t.as_admin();
  perform t.ok((select c.draft_status = 'queued' and c.draft_error is null and c.draft_progress = 0 and (c.draft_meta ->> 'retry_count')::int = 1
                  from public.curricula c where c.id = t.u('F')), 'durum queued, hata temiz, deneme sayısı');
  perform t.ok(exists (select 1 from audit.events e
                        where e.action in ('job.enqueue_skipped', 'job.enqueue_failed') and e.diff ->> 'name' = 'curriculum.draft'
                          and e.diff -> 'data' ->> 'curriculum_id' = t.v('F') and e.diff -> 'data' ->> 'requested_by' = t.v('inst')
                          and e.diff -> 'data' -> 'upload_ids' = jsonb_build_array(v_up_inst)),
               'curriculum.draft işi (kaynak + isteyen) denendi');
end $$;

rollback;
