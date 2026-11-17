-- tests/29_lesson_transcript_isolation.sql — ders transkripti yalıtımı (0039–0041): lesson_transcripts yalnız bağlı
-- eğitmen ve worker (öğrenci student_visible derste bile, veli, başka öğrenci, bağsız eğitmen görmez; anon'a tablo
-- kapalı); write_lesson_transcript (worker sağlayıcısıyla; eğitmen düzeltmesi 'manual'; doğrulama OGR-LESSON-007);
-- lesson_view öğrenciye transkript, alıntı ve güven döndürmez; koç araması gizli dersin alıntısını ve eğitmene özel
-- konuşma notunu (talk) döndürmez; ortak derste sınıf dersi kiracılar arası sızmaz (kapsam dersi verenin öğrencileri:
-- başka eğitmenin öğrencisi özet/hafıza/izlence almaz, başka eğitmen transkripti görmez, viewer bağı ders açtırmaz);
-- 'lessons' kovası (TUS): eğitmen yalnız kendi klasörüne yazar, görebildiği dersin yüklemesini okur; öğrenci ve veli
-- hiç erişmez.
begin;
\ir _fixture.sql

do $$
declare
  v_r jsonb;
begin
  perform t.add_outsiders();
  insert into public.uploads (id, owner_id, kind, storage_path) values
    ('52000000-0000-4000-8000-0000000000a1', t.u('inst'), 'video', t.v('inst') || '/iz-1.mp4');
  perform t.as_user(t.u('inst'));
  v_r := public.register_lesson(jsonb_build_object('enrollment_id', t.v('EA'), 'student_visible', true), '52000000-0000-4000-8000-0000000000a1');
  perform t.as_admin();
  insert into t.cfg values ('L', v_r ->> 'lesson_id');
end $$;

-- worker yazımı ve doğrulama
do $$
declare
  v_r jsonb;
  v_seg jsonb := '[{"t0": 0, "t1": 4.2, "speaker": null, "text": "Şimdi |x − 3| < 5 eşitsizliğine bakalım."},
                   {"t0": 4.2, "t1": 9.8, "speaker": null, "text": "GIZLI-ALINTI eksi tarafı hep unutuyorum."}]';
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.write_lesson_transcript(%L, %L)', t.v('L'), v_seg), '42501', 'öğrenci transkript yazamaz');
  perform t.as_user(t.u('parent'));
  perform t.raises(format('select public.write_lesson_transcript(%L, %L)', t.v('L'), v_seg), '42501', 'veli transkript yazamaz');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.write_lesson_transcript(%L, %L)', t.v('L'), v_seg), '42501', 'bağsız eğitmen transkript yazamaz');
  perform t.as_service();
  perform t.raises(format('select public.write_lesson_transcript(%L, ''[]'')', t.v('L')), 'OGR-LESSON-007%', 'boş transkript');
  perform t.raises(format('select public.write_lesson_transcript(%L, %L)', t.v('L'), '[{"t0": 5, "t1": 2, "text": "a"}]'), 'OGR-LESSON-007%', 't1 < t0');
  perform t.raises(format('select public.write_lesson_transcript(%L, %L)', t.v('L'), '[{"t0": 0, "t1": 2, "speaker": "ÖĞRETMEN", "text": "a"}]'),
                   'OGR-LESSON-007%', 'bilinmeyen konuşmacı etiketi');
  perform t.raises(format('select public.write_lesson_transcript(%L, %L)', t.v('L'), '[{"t0": 0, "t1": 2, "text": "a", "name": "Elif"}]'),
                   'OGR-LESSON-007%', 'fazladan alan (ad sızıntısı) reddedilir');
  perform t.raises(format('select public.write_lesson_transcript(%L, %L)', t.v('L'), '[{"t0": 0, "t1": 2, "text": ""}]'), 'OGR-LESSON-007%', 'boş metin');
  perform t.raises(format('select public.write_lesson_transcript(%L, %L, ''tr'', ''whisper'')', t.v('L'), v_seg), 'OGR-LESSON-007%', 'bilinmeyen sağlayıcı');
  v_r := public.write_lesson_transcript(t.u('L'), v_seg, 'tr', 'fake');
  perform t.ok((v_r ->> 'segments')::int = 2 and not (v_r ->> 'labeled')::boolean and (v_r ->> 'duration_sec')::int = 10,
               'STT: etiketsiz iki bölüm, süre son bölümden');
  -- label aşaması: aynı satırın üzerine
  v_r := public.write_lesson_transcript(t.u('L'), jsonb_set(jsonb_set(v_seg, '{0,speaker}', '"EĞİTMEN"'), '{1,speaker}', '"ÖĞRENCİ"'), 'tr', 'groq');
  perform t.ok((v_r ->> 'labeled')::boolean, 'label: tüm bölümler etiketli');
  perform t.as_admin();
  perform t.ok((select count(*) = 1 from public.lesson_transcripts lt where lt.lesson_id = t.u('L')), 'ders başına tek transkript');
  perform t.ok((select l.duration_sec = 10 from public.lessons l where l.id = t.u('L')), 'ders süresi transkriptten');
  -- eğitmen düzeltmesi
  perform t.as_user(t.u('inst'));
  v_r := public.write_lesson_transcript(t.u('L'), jsonb_set(jsonb_set(v_seg, '{0,speaker}', '"ÖĞRENCİ"'), '{1,speaker}', '"ÖĞRENCİ"'), 'tr', 'groq');
  perform t.ok(v_r ->> 'provider' = 'manual', 'eğitmen düzeltmesi manual kaydedilir (sağlayıcı taklit edilemez)');
  perform t.as_admin();
  perform t.ok((select lt.edited_by = t.u('inst') and lt.provider = 'manual' from public.lesson_transcripts lt where lt.lesson_id = t.u('L')),
               'düzelten eğitmen kayıtlı');
end $$;

-- RLS: transkript tablosu
do $$
declare
  v_q text := format('select 1 from public.lesson_transcripts lt where lt.lesson_id = %L', t.v('L'));
begin
  perform t.ok(t.sees(t.u('inst'), v_q) = 1, 'owner eğitmen transkripti görür');
  perform t.ok(t.sees(t.u('elif'), v_q) = 0, 'öğrenci (ders student_visible olsa da) transkripti görmez');
  perform t.ok(t.sees(t.u('parent'), v_q) = 0, 'veli transkripti görmez');
  perform t.ok(t.sees(t.u('can'), v_q) = 0 and t.sees(t.u('deniz'), v_q) = 0, 'başka öğrenciler görmez');
  perform t.ok(t.sees(t.u('inst2'), v_q) = 0, 'bağsız eğitmen görmez');
  perform t.ok(t.sees(t.u('elif'), format('select 1 from public.lessons l where l.id = %L', t.v('L'))) = 0,
               'öğrenci açık dersin satırını da doğrudan okuyamaz (yalnız list_lessons/lesson_view)');
  perform t.ok(t.sees(t.u('elif'), format('select 1 where (public.lesson_view(%L) ->> ''role'') = ''student''', t.v('L'))) = 1,
               'öğrenci açık dersi RPC''den görür');
  perform t.as_anon();
  perform t.raises(v_q, '42501', 'anon tabloya erişemez');
  perform t.as_admin();
  perform t.ok(not has_table_privilege('authenticated', 'public.lesson_transcripts', 'insert')
               and not has_table_privilege('authenticated', 'public.lesson_transcripts', 'update')
               and not has_table_privilege('authenticated', 'public.lessons', 'update')
               and not has_table_privilege('authenticated', 'public.lesson_claims', 'update'),
               'authenticated doğrudan yazamaz (yalnız RPC)');
end $$;

-- lesson_view ve koç araması: transkript ve alıntı öğrenciye ulaşmaz
do $$
declare
  v_v jsonb;
  v_r jsonb;
begin
  perform t.as_service();
  perform public.write_lesson_analysis(t.u('L'), jsonb_build_object('analysis', '{"schema_version": "1.0"}'::jsonb, 'claims', jsonb_build_array(
    jsonb_build_object('kind', 'skill_mastery', 'skill_id', 't.mat.b', 'value', jsonb_build_object('mastery_estimate', 0.5), 'confidence', 0.95,
                       'quote', 'GIZLI-ALINTI eksi tarafı hep unutuyorum.', 'speaker', 'ÖĞRENCİ', 't', 4.2))));
  perform public.apply_lesson_claims(t.u('L'));
  perform t.as_user(t.u('inst'));
  v_v := public.lesson_view(t.u('L'));
  perform t.ok(jsonb_array_length(v_v -> 'transcript' -> 'segments') = 2 and v_v::text like '%GIZLI-ALINTI%', 'eğitmen: transkript ve alıntı');
  perform t.as_user(t.u('elif'));
  v_v := public.lesson_view(t.u('L'));
  perform t.ok(v_v::text not like '%GIZLI-ALINTI%' and v_v::text not like '%segments%' and v_v -> 'summary' -> 'topics' = '["İşaret kuralları"]'::jsonb,
               'öğrenci: transkript ve alıntı yok, yalnız konu');
  v_r := public.coach_tool_search_evidence('GIZLI-ALINTI unutuyorum');
  perform t.ok(v_r::text like '%GIZLI-ALINTI%', 'koç araması: açık dersin onaylı alıntısı öğrencinin kendi kanıtıdır');
  perform t.as_user(t.u('inst'));
  perform public.lesson_set_options(t.u('L'), '{"student_visible": false}');
  perform t.as_user(t.u('elif'));
  v_r := public.coach_tool_search_evidence('GIZLI-ALINTI unutuyorum');
  perform t.ok(v_r::text not like '%GIZLI-ALINTI%', 'koç araması: gizli dersin alıntısı dönmez');
  perform t.raises(format('select public.lesson_view(%L)', t.v('L')), 'OGR-AUTH-001%', 'gizli ders: öğrenci görünümü yok');
  perform t.as_user(t.u('parent'));
  perform t.raises(format('select public.lesson_view(%L)', t.v('L')), 'OGR-AUTH-001%', 'veli ders görünümü yok');
  perform t.as_admin();
end $$;

-- konuşma notu (talk) eğitmene özeldir: açık derste bile koç aramasına düşmez
do $$
declare
  v_r jsonb;
begin
  perform t.ok((select x ->> 'quote' = '' and x #>> '{value,notes}' = 'GIZLI-NOT dikkat dağınık'
                  from jsonb_array_elements(app.lesson_claims_from_analysis(
                         '{"talk": {"student_ratio": 0.4, "notes": "GIZLI-NOT dikkat dağınık", "confidence": 1}}'::jsonb)) as x
                 where x ->> 'kind' = 'talk'),
               'talk iddiası: alıntı boş, not value.notes''ta');
  perform t.as_user(t.u('inst'));
  perform public.lesson_set_options(t.u('L'), '{"student_visible": true}');
  perform t.as_service();
  -- eski biçim (alıntıda not) ile yazılmış olsa da arama türe göre süzer
  perform public.write_lesson_analysis(t.u('L'), jsonb_build_object('analysis', '{"schema_version": "1.0"}'::jsonb, 'claims', jsonb_build_array(
    jsonb_build_object('kind', 'talk', 'value', jsonb_build_object('notes', 'GIZLI-NOT dikkat dağınık moral düşük'), 'confidence', 1,
                       'quote', 'GIZLI-NOT dikkat dağınık moral düşük', 'speaker', 'EĞİTMEN', 't', 0),
    jsonb_build_object('kind', 'question', 'value', jsonb_build_object('answered', false), 'confidence', 0.95,
                       'quote', 'GIZLI-SORU neden eksi tarafı da alıyoruz', 'speaker', 'ÖĞRENCİ', 't', 4.2))));
  perform public.apply_lesson_claims(t.u('L'));
  perform t.as_admin();
  perform t.ok((select count(*) = 2 from public.lesson_claims lc join public.lesson_analyses la on la.id = lc.analysis_id
                 where la.lesson_id = t.u('L') and lc.status = 'approved' and lc.kind in ('talk', 'question')
                   and la.version = (select max(x.version) from public.lesson_analyses x where x.lesson_id = t.u('L'))),
               'talk ve soru iddiaları onaylandı (eşik üstü)');
  perform t.as_user(t.u('elif'));
  v_r := public.coach_tool_search_evidence('GIZLI-NOT dikkat moral');
  perform t.ok(v_r::text not like '%GIZLI-NOT%', 'koç araması: açık derste eğitmene özel konuşma notu dönmez');
  v_r := public.coach_tool_search_evidence('GIZLI-SORU eksi');
  perform t.ok(v_r::text like '%GIZLI-SORU%', 'koç araması: öğrencinin kendi sorusu döner');
  perform t.as_admin();
end $$;

-- ortak (shared) derste sınıf dersi: kapsam dersi verenin kendi öğrencileri (kiracılar arası sızıntı yok)
do $$
declare
  v_r jsonb;
  v_c jsonb;
begin
  -- inst: Elif ve Can'ın owner'ı, dersin oluşturanı; inst2: yalnız Deniz'in owner'ı (aynı ortak derse kayıtlı)
  insert into public.instructor_links (instructor_id, student_id, role) values (t.u('inst2'), t.u('C'), 'owner');
  insert into public.uploads (id, owner_id, kind, storage_path) values
    ('52000000-0000-4000-8000-0000000000b1', t.u('inst'), 'audio', t.v('inst') || '/sinif-a.m4a'),
    ('52000000-0000-4000-8000-0000000000b2', t.u('inst2'), 'audio', t.v('inst2') || '/sinif-b.m4a'),
    ('52000000-0000-4000-8000-0000000000b3', t.u('inst2'), 'audio', t.v('inst2') || '/sinif-c.m4a'),
    ('52000000-0000-4000-8000-0000000000b4', t.u('inst2'), 'audio', t.v('inst2') || '/sinif-d.m4a');
  perform t.as_user(t.u('inst'));
  v_r := public.register_lesson(jsonb_build_object('course_id', t.v('course'), 'student_visible', true), '52000000-0000-4000-8000-0000000000b1');
  perform t.as_admin();
  insert into t.cfg values ('LA', v_r ->> 'lesson_id');
  perform t.as_user(t.u('inst2'));
  v_r := public.register_lesson(jsonb_build_object('course_id', t.v('course'), 'student_visible', true), '52000000-0000-4000-8000-0000000000b2');
  perform t.as_admin();
  insert into t.cfg values ('LB2', v_r ->> 'lesson_id');
  perform t.ok((select array_agg(x order by x) from unnest(app.lesson_students(t.u('LA'))) as x)
                 = (select array_agg(x order by x) from unnest(array[t.u('A'), t.u('B')]) as x),
               'inst''in sınıf dersi: yalnız inst''in öğrencileri (Deniz yok)');
  perform t.ok(app.lesson_students(t.u('LB2')) = array[t.u('C')], 'inst2''nin sınıf dersi: yalnız Deniz');

  perform t.as_service();
  perform public.write_lesson_transcript(t.u('LA'), '[{"t0": 0, "t1": 3, "speaker": "EĞİTMEN", "text": "SINIF-A-TRANSKRIPT konu"}]', 'tr', 'fake');
  perform public.write_lesson_transcript(t.u('LB2'), '[{"t0": 0, "t1": 3, "speaker": "EĞİTMEN", "text": "SINIF-B-TRANSKRIPT konu"}]', 'tr', 'fake');
  v_c := jsonb_build_array(
    jsonb_build_object('kind', 'course_insight', 'value', jsonb_build_object('kind', 'syllabus_topic', 'topic', 'YABANCI-KONU', 'text', 'x'),
                       'confidence', 0.95, 'quote', 'konu', 'speaker', 'EĞİTMEN', 't', 0),
    jsonb_build_object('kind', 'skill_mastery', 'skill_id', 't.mat.a', 'value', jsonb_build_object('mastery_estimate', 0.7), 'confidence', 0.95,
                       'quote', 'konu', 'speaker', 'ÖĞRENCİ', 't', 1));
  perform public.write_lesson_analysis(t.u('LA'), jsonb_build_object('analysis', '{"schema_version": "1.0"}'::jsonb, 'claims', v_c));
  perform public.write_lesson_analysis(t.u('LB2'), jsonb_build_object('analysis', '{"schema_version": "1.0"}'::jsonb, 'claims', v_c));
  perform public.apply_lesson_claims(t.u('LB2'));
  perform t.as_admin();
  perform t.ok(not exists (select 1 from public.syllabus_topics st where st.course_id = t.u('course') and st.title = 'YABANCI-KONU')
               and exists (select 1 from public.lesson_claims lc join public.lesson_analyses la on la.id = lc.analysis_id
                            where la.lesson_id = t.u('LB2') and lc.kind = 'course_insight'
                              and lc.applied_ref ->> 'skipped' = 'not_course_owner' and (lc.applied_ref ->> 'memory_only')::boolean),
               'ortak dersin izlencesine dersi oluşturmayan eğitmen yazamaz (yalnız hafıza)');

  -- personel görünürlüğü: aynı derste öğrencisi olan başka eğitmen sınıf dersini, transkripti ve iddiaları görmez
  perform t.ok(t.sees(t.u('inst2'), format('select 1 from public.lesson_transcripts lt where lt.lesson_id = %L', t.v('LA'))) = 0
               and t.sees(t.u('inst2'), format('select 1 from public.lessons l where l.id = %L', t.v('LA'))) = 0
               and t.sees(t.u('inst2'), format('select 1 from public.lesson_analyses la where la.lesson_id = %L', t.v('LA'))) = 0,
               'inst2, inst''in sınıf dersini (satır, transkript, analiz) görmez');
  perform t.ok(t.sees(t.u('inst'), format('select 1 from public.lesson_transcripts lt where lt.lesson_id = %L', t.v('LB2'))) = 0,
               'ortak dersin oluşturanı (inst) inst2''nin sınıf dersinin transkriptini görmez');
  perform t.ok(t.sees(t.u('inst2'), format('select 1 from public.lesson_transcripts lt where lt.lesson_id = %L', t.v('LB2'))) = 1,
               'dersi veren kendi sınıf dersinin transkriptini görür');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.lesson_view(%L)', t.v('LA')), 'OGR-AUTH-001%', 'inst2 inst''in sınıf dersinin görünümünü alamaz');
  perform t.ok(not exists (select 1 from jsonb_array_elements(public.list_lessons()) as x where x ->> 'id' = t.v('LA'))
               and not exists (select 1 from jsonb_array_elements(public.list_lessons(t.u('C'))) as x where x ->> 'id' = t.v('LA')),
               'inst2''nin listesinde inst''in sınıf dersi yok');

  -- öğrenci görünürlüğü: başka eğitmenin sınıf dersinin özeti görünmez
  perform t.as_user(t.u('deniz'));
  perform t.raises(format('select public.lesson_view(%L)', t.v('LA')), 'OGR-AUTH-001%', 'Deniz inst''in açık sınıf dersinin özetini görmez');
  perform t.ok(not exists (select 1 from jsonb_array_elements(public.list_lessons()) as x where x ->> 'id' = t.v('LA'))
               and exists (select 1 from jsonb_array_elements(public.list_lessons()) as x where x ->> 'id' = t.v('LB2')),
               'Deniz yalnız kendi eğitmeninin sınıf dersini listeler');
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.lesson_view(%L)', t.v('LB2')), 'OGR-AUTH-001%', 'Elif inst2''nin açık sınıf dersinin özetini görmez');
  perform t.ok((public.lesson_view(t.u('LA')) ->> 'role') = 'student', 'Elif kendi eğitmeninin açık sınıf dersini görür');

  -- hafıza işi yalnız kapsamdaki öğrencilere (Deniz'e inst'in ders notu yazılmaz)
  perform t.as_service();
  perform public.apply_lesson_claims(t.u('LA'));
  perform t.as_admin();
  -- iş pg-boss'a ya da (kuyruk yoksa) outbox'a düşer: ikisinden de toplanır
  if to_regclass('pgboss.job') is not null then
    execute $q$select coalesce(jsonb_agg(j.data), '[]') from pgboss.job j where j.name = 'memory.apply' and j.data ->> 'lesson_id' = $1$q$
      into v_r using t.v('LA');
  else
    v_r := '[]'::jsonb;
  end if;
  v_r := v_r || (select coalesce(jsonb_agg(o.data), '[]') from secure.job_outbox o where o.name = 'memory.apply' and o.data ->> 'lesson_id' = t.v('LA'));
  perform t.ok(jsonb_array_length(v_r) >= 1
               and not exists (select 1 from jsonb_array_elements(v_r) as x where x -> 'student_ids' ? t.v('C'))
               and exists (select 1 from jsonb_array_elements(v_r) as x where x -> 'student_ids' ? t.v('A')),
               'memory.apply: inst''in sınıf dersi Elif''e yazılır, Deniz''in hafızasına yazılmaz');

  -- takılan ders (processing, 2 saattir ilerlemiyor: işçi son denemede öldü) yeniden denenebilir; taze olan denenemez
  perform t.as_user(t.u('inst2'));
  v_r := public.register_lesson(jsonb_build_object('course_id', t.v('course')), '52000000-0000-4000-8000-0000000000b4');
  perform t.raises(format('select public.retry_lesson(%L)', v_r ->> 'lesson_id'), 'OGR-LESSON-003%', 'ilerleyen (taze) ders yeniden denenmez');
  perform t.as_admin();
  update public.lessons l set progress = l.progress || jsonb_build_object('stage', 'stt', 'updated_at', now() - interval '3 hours')
   where l.id = (v_r ->> 'lesson_id')::uuid;
  perform t.as_user(t.u('inst2'));
  v_c := public.retry_lesson((v_r ->> 'lesson_id')::uuid);
  perform t.ok(v_c ->> 'status' = 'processing' and v_c ->> 'stage' = 'prepare', 'takılan ders yeniden başlatılır (retry_lesson)');
  perform t.as_admin();

  -- viewer bağı sınıf dersi açtırmaz; owner olduğu öğrencisi derste olmayan eğitmen de açamaz
  update public.instructor_links il set role = 'viewer' where il.instructor_id = t.u('inst2') and il.student_id = t.u('C');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.register_lesson(%L, %L)', jsonb_build_object('course_id', t.v('course')), '52000000-0000-4000-8000-0000000000b3'),
                   'OGR-AUTH-001%', 'viewer bağı ortak derste sınıf dersi açtırmaz');
  perform t.as_admin();
  perform t.ok(app.lesson_students(t.u('LB2')) = '{}'::uuid[], 'bağ owner değilse sınıf dersinin kapsamı boşalır');
end $$;

-- 'lessons' kovası (TUS resumable) politikaları
do $$
declare
  v_inst_obj text := t.v('inst') || '/iz-1.mp4';
begin
  if to_regclass('storage.objects') is null then
    raise notice 'SKIP: storage.objects yok (lessons kovası politikaları sınanmadı)';
    return;
  end if;
  insert into storage.objects (bucket_id, name) values ('lessons', v_inst_obj), ('lessons', t.v('L') || '/audio.flac');
  perform t.as_user(t.u('inst'));
  insert into storage.objects (bucket_id, name) values ('lessons', t.v('inst') || '/yeni-ders.mp4');
  update storage.objects o set metadata = '{"tus": "parca-2"}' where o.bucket_id = 'lessons' and o.name = t.v('inst') || '/yeni-ders.mp4';
  perform t.ok(t.n(format('select 1 from storage.objects o where o.bucket_id = ''lessons'' and o.name = %L and o.metadata ->> ''tus'' = ''parca-2''',
                          t.v('inst') || '/yeni-ders.mp4')) = 1, 'eğitmen kendi klasörüne yükler ve sürdürür (TUS: insert + update + select)');
  perform t.raises(format('insert into storage.objects (bucket_id, name) values (''lessons'', %L)', t.v('inst2') || '/sahte.mp4'),
                   '42501', 'başkasının klasörüne yazamaz');
  perform t.as_user(t.u('elif'));
  perform t.raises(format('insert into storage.objects (bucket_id, name) values (''lessons'', %L)', t.v('elif') || '/ders.mp4'),
                   '42501', 'öğrenci lessons kovasına yazamaz');
  perform t.as_admin();
  perform t.ok(t.sees(t.u('inst'), format('select 1 from storage.objects o where o.bucket_id = ''lessons'' and o.name = %L', v_inst_obj)) = 1,
               'eğitmen dersinin videosunu okur');
  perform t.ok(t.sees(t.u('elif'), format('select 1 from storage.objects o where o.bucket_id = ''lessons'' and o.name = %L', v_inst_obj)) = 0
               and t.sees(t.u('parent'), format('select 1 from storage.objects o where o.bucket_id = ''lessons'' and o.name = %L', v_inst_obj)) = 0,
               'öğrenci ve veli ham videoyu okuyamaz');
  perform t.ok(t.sees(t.u('inst2'), format('select 1 from storage.objects o where o.bucket_id = ''lessons'' and o.name = %L', v_inst_obj)) = 0,
               'bağsız eğitmen başkasının ders videosunu okuyamaz');
  perform t.ok(t.sees(t.u('inst'), format('select 1 from storage.objects o where o.bucket_id = ''lessons'' and o.name = %L', t.v('L') || '/audio.flac')) = 0,
               'worker''ın çıkardığı ses kullanıcılara kapalı');
  insert into public.instructor_links (instructor_id, student_id, role) values (t.u('inst2'), t.u('A'), 'viewer');
  perform t.ok(t.sees(t.u('inst2'), format('select 1 from storage.objects o where o.bucket_id = ''lessons'' and o.name = %L', v_inst_obj)) = 1,
               'öğrenciye bağlanan eğitmen dersin videosunu okur');
end $$;

rollback;
