-- tests/09_dossier.sql — render_dossier(p_student, p_course) şekli (docs/PLAN-v2.md §2, §3.3, §3.4): kimlik (görünen ad
-- yok), en zayıf 20 / en güçlü 10 kanıtlı yaprak (ayrık, sıralı, 14 g trend), açık yanılgılar ≤ 8, 30 g hata-nedeni
-- histogramı (5 anahtar), son 10 teşhis, son 3 deneme, tarz boşlukları, ders iddiaları; hash kararlı ve gövdeye bağlı;
-- yetki (öğrenci, bağlı eğitmen, admin, worker; veli değil). v2 (0024): aktif öneri sayısı, son bitmiş alıştırma özeti,
-- hafıza dosya yolları (içerik yok).
begin;
\ir _fixture.sql

do $$
declare
  v_cur uuid;
  v_course uuid;
  v_enr uuid;
  v_i int;
  v_note uuid;
  v_obs bigint;
  v_exam uuid;
  v_st uuid;
begin
  insert into public.curricula (code, version, label, status) values ('T-BIG', '1', 'Büyük test', 'active') returning id into v_cur;
  insert into public.skills (curriculum_id, id, name, kind, is_leaf, order_no) values (v_cur, 'b', 'Kök', 'unit', false, 0);
  insert into public.skills (curriculum_id, id, parent_id, name, kind, is_leaf, order_no)
  select v_cur, 'b.' || lpad(g::text, 2, '0'), 'b', 'Yaprak ' || g, 'outcome', true, g from generate_series(1, 37) as g;
  insert into public.courses (code, title, kind, curriculum_id, visibility) values ('T-BIG', 'Büyük ders', 'exam_track', v_cur, 'shared') returning id into v_course;
  insert into public.enrollments (student_id, curriculum_id, course_id, period_label, target_exam, exam_date, goal)
  values (t.u('A'), v_cur, v_course, 'YKS 2027', 'TYT', current_date + 200, 'TYT matematikte 30 net') returning id into v_enr;
  insert into t.cfg values ('bcur', v_cur::text), ('bcourse', v_course::text), ('benr', v_enr::text);
  -- 35 kanıtlı yaprak (p = 0.02·g), 2 kanıtsız yaprak
  insert into public.mastery (enrollment_id, skill_id, p, evidence_count)
  select v_enr, 'b.' || lpad(g::text, 2, '0'), round(0.02 * g, 5), case when g > 35 then 0 else 1 + g % 4 end from generate_series(1, 37) as g;
  -- trend: b.30 için 20 gün önce p_after = 0.2 (şimdi 0.60 → trend 0.40)
  insert into public.instructor_notes (enrollment_id, author_id, skill_id, body) values (v_enr, t.u('inst'), 'b.30', 'not') returning id into v_note;
  insert into public.observations (enrollment_id, skill_id, kind, value, source_type, source_id, source_locator)
  values (v_enr, 'b.30', 'instructor', 0.2, 'instructor_note', v_note::text, 'not') returning id into v_obs;
  insert into public.mastery_history (enrollment_id, skill_id, observation_id, p_before, p_after, method, params, created_at)
  values (v_enr, 'b.30', v_obs, 0.3, 0.2, 'blend', '{}', now() - interval '20 days');
  -- 10 açık + 1 inceleme bekleyen yanılgı
  insert into public.misconceptions (enrollment_id, skill_id, text_instructor, text_student, status, evidence_count, last_seen)
  select v_enr, 'b.' || lpad(g::text, 2, '0'), 'Yanılgı ' || g, 'Öğrenci metni ' || g, 'open', g, now() - make_interval(days => g)
    from generate_series(1, 10) as g;
  insert into public.misconceptions (enrollment_id, skill_id, text_instructor, text_student, status, evidence_count)
  values (v_enr, 'b.20', 'Bekleyen', 'Bekleyen', 'pending_review', 99);
  -- 12 teşhis son 30 günde + 1 eski (histograma girmez)
  insert into public.solution_analyses (enrollment_id, analysis, verdict, error_cause, skill_ids, created_at)
  select v_enr, '{}', 'wrong', (array['concept', 'procedure', 'careless', 'reading', 'time', 'concept'])[1 + g % 6], array['b.01'],
         now() - make_interval(hours => g)
    from generate_series(1, 12) as g;
  insert into public.solution_analyses (enrollment_id, analysis, verdict, error_cause, created_at)
  values (v_enr, '{}', 'wrong', 'reading', now() - interval '40 days');
  -- 4 notlanmış deneme
  insert into public.exams (curriculum_id, course_id, kind, source, title, status) values (v_cur, v_course, 'deneme', 'uploaded', 'Deneme', 'ready')
  returning id into v_exam;
  insert into public.exam_sessions (exam_id, enrollment_id, mode, finished_at, status, score)
  select v_exam, v_enr, 'uploaded', now() - make_interval(days => g), 'done', jsonb_build_object('total', 40, 'correct', 20 + g, 'wrong', 4, 'blank', 16 - g, 'net', 19 + g)
    from generate_series(1, 4) as g;
  -- tarzlar: iyi kapsanan (boşluk değil), hiç görülmemiş, düşük doğru oranı, emekli (sayılmaz)
  insert into public.question_styles (course_id, code, name, status, frequency_score) values (v_course, 'S-OK', 'İyi', 'active', 0.9) returning id into v_st;
  insert into public.style_coverage (enrollment_id, style_id, seen_count, solved_count, correct_count) values (v_enr, v_st, 3, 3, 3);
  insert into public.question_styles (course_id, code, name, status, frequency_score) values (v_course, 'S-NEW', 'Hiç görülmemiş', 'active', 0.7);
  insert into public.question_styles (course_id, code, name, status, frequency_score) values (v_course, 'S-LOW', 'Zayıf', 'active', 0.8) returning id into v_st;
  insert into public.style_coverage (enrollment_id, style_id, seen_count, solved_count, correct_count) values (v_enr, v_st, 4, 4, 1);
  insert into public.question_styles (course_id, code, name, status, frequency_score) values (v_course, 'S-OLD', 'Emekli', 'retired', 1.0);
  -- v2: öneriler (2 aktif bu kayıtta + 1 kayıtsız; başlatılmış, süresi dolmuş ve başka kayıttaki sayılmaz), alıştırmalar, hafıza
  insert into public.suggestions (student_id, enrollment_id, kind, title, rank, consumed_at, expires_at) values
    (t.u('A'), v_enr, 'practice', 'Aktif 1', 0, null, null), (t.u('A'), v_enr, 'gap_analysis', 'Aktif 2', 1, null, now() + interval '1 day'),
    (t.u('A'), null, 'document_ready', 'Notun hazır', 2, null, null), (t.u('A'), v_enr, 'practice', 'Başlatılmış', 3, now(), null),
    (t.u('A'), v_enr, 'practice', 'Süresi dolmuş', 4, null, now() - interval '1 minute'), (t.u('A'), t.u('EA'), 'practice', 'Başka ders', 5, null, null);
  insert into public.practice_sets (enrollment_id, status, skill_ids, summary, started_at, finished_at) values
    (v_enr, 'finished', array['b.01'], '{"total": 8, "correct": 3, "top_misconception": {"tag": "eski"}, "weak_skill": {"skill_id": "b.01"}}',
     now() - interval '3 days', now() - interval '3 days'),
    (v_enr, 'finished', array['b.02', 'b.03'], '{"total": 8, "correct": 6, "top_misconception": null, "weak_skill": {"skill_id": "b.03"}}',
     now() - interval '1 hour', now() - interval '1 hour'),
    (v_enr, 'in_progress', array['b.04'], null, now(), null);
  insert into public.memory_files (student_id, path, content) values
    (t.u('A'), '/memories/patterns.md', 'Gizli örüntü metni'), (t.u('A'), '/memories/profile.md', 'Gizli profil metni');
end $$;

do $$
declare
  v_d jsonb;
  v_d2 jsonb;
  v_keys text;
  v_w jsonb;
  v_s jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_d := public.render_dossier(t.u('A'), t.u('bcourse'));
  v_d2 := public.render_dossier(t.u('A'), t.u('bcourse'));
  perform t.as_admin();
  select string_agg(k, ',' order by k) into v_keys from jsonb_object_keys(v_d) as k;
  perform t.ok(v_keys = 'as_of,error_causes_30d,hash,identity,last_practice,mastery,memory_paths,open_misconceptions,recent_diagnoses,recent_exams,recent_lesson_claims,style_gaps,version',
               'dossier üst anahtarları (' || v_keys || ')');
  perform t.ok((v_d ->> 'version')::int = 2, 'dossier sürümü 2');
  perform t.ok(not v_d ? 'active_suggestions', 'aktif öneri sayısı gövdede yok (hash kararlı)');
  perform t.ok((v_d -> 'last_practice' ->> 'total')::int = 8 and (v_d -> 'last_practice' ->> 'correct')::int = 6
               and v_d -> 'last_practice' ->> 'weak_skill' = 'b.03' and v_d -> 'last_practice' -> 'top_misconception' = 'null'::jsonb
               and v_d -> 'last_practice' -> 'skill_ids' = '["b.02", "b.03"]'::jsonb,
               'son bitmiş alıştırma özeti (süren set değil): ' || coalesce(v_d ->> 'last_practice', '-'));
  perform t.ok(v_d -> 'memory_paths' = '["/memories/patterns.md", "/memories/profile.md"]'::jsonb and position('Gizli' in v_d::text) = 0,
               'hafıza dosya yolları sıralı, içerik yok');
  perform t.ok(v_d -> 'identity' ->> 'student_ref' = (select s.public_ref from public.students s where s.id = t.u('A'))
               and v_d -> 'identity' ->> 'course_code' = 'T-BIG' and v_d -> 'identity' ->> 'curriculum' = 'T-BIG@1'
               and (v_d -> 'identity' ->> 'days_to_exam')::int between 199 and 201 and v_d -> 'identity' ->> 'goal' = 'TYT matematikte 30 net'
               and v_d -> 'identity' ->> 'grade' = '11', 'kimlik: public_ref, ders, müfredat sürümü, sınava kalan gün, hedef, sınıf');
  perform t.ok(position('Elif' in v_d::text) = 0 and position('Kaya' in v_d::text) = 0, 'dossier görünen adı içermez');
  v_w := v_d -> 'mastery' -> 'weakest';
  v_s := v_d -> 'mastery' -> 'strongest';
  perform t.ok(jsonb_array_length(v_w) = 20 and v_w -> 0 ->> 'skill_id' = 'b.01' and v_w -> 19 ->> 'skill_id' = 'b.20'
               and (v_w -> 0 ->> 'p')::numeric = 0.02, 'en zayıf 20 yaprak, artan p');
  perform t.ok(jsonb_array_length(v_s) = 10 and v_s -> 0 ->> 'skill_id' = 'b.35' and v_s -> 9 ->> 'skill_id' = 'b.26',
               'en güçlü 10 yaprak, azalan p, zayıflarla ayrık');
  perform t.ok((v_d -> 'mastery' ->> 'leaves_total')::int = 37 and (v_d -> 'mastery' ->> 'leaves_with_evidence')::int = 35,
               'yaprak sayıları: 37 yaprak, 35 kanıtlı (kanıtsızlar listede yok)');
  perform t.ok((select (e.x ->> 'trend_14d')::numeric = 0.4 from jsonb_array_elements(v_s) as e (x) where e.x ->> 'skill_id' = 'b.30')
               and (v_w -> 0 -> 'trend_14d') = 'null'::jsonb, '14 g trend: b.30 = 0.60 − 0.20; geçmişsiz yaprakta null');
  perform t.ok(jsonb_array_length(v_d -> 'open_misconceptions') = 8 and (v_d -> 'open_misconceptions' -> 0 ->> 'evidence')::int = 10
               and not exists (select 1 from jsonb_array_elements(v_d -> 'open_misconceptions') as e (x) where e.x ->> 'text' = 'Bekleyen'),
               'açık yanılgılar ≤ 8, kanıta göre azalan, inceleme bekleyen yok');
  perform t.ok(v_d -> 'error_causes_30d' = '{"concept":4,"procedure":2,"careless":2,"reading":2,"time":2}'::jsonb,
               'hata nedeni histogramı (30 g; eski teşhis hariç): ' || (v_d -> 'error_causes_30d')::text);
  perform t.ok(jsonb_array_length(v_d -> 'recent_diagnoses') = 10 and v_d -> 'recent_diagnoses' -> 0 ->> 'source' = 'ask',
               'son 10 teşhis');
  perform t.ok(jsonb_array_length(v_d -> 'recent_exams') = 3 and (v_d -> 'recent_exams' -> 0 ->> 'net')::int = 20,
               'son 3 deneme, en yenisi önce');
  perform t.ok((select string_agg(e.x ->> 'code', ',' order by e.ord) from jsonb_array_elements(v_d -> 'style_gaps') with ordinality as e (x, ord)) = 'S-LOW,S-NEW',
               'tarz boşlukları: düşük doğru oranlı ve hiç görülmemiş, sıklığa göre; emekli ve iyi kapsanan yok');
  perform t.ok(v_d -> 'recent_lesson_claims' = '[]'::jsonb, 'ders iddiası yoksa boş dizi');
  perform t.ok(v_d = v_d2 and v_d ->> 'hash' = encode(sha256(convert_to((v_d - 'hash')::text, 'UTF8')), 'hex'),
               'hash kararlı ve gövdenin sha256''sı');
  -- öneri başlatmak (Başla) hash'i değiştirmez: dossier ve system[2] önbelleği bozulmaz
  update public.suggestions s set consumed_at = now() where s.student_id = t.u('A') and s.title = 'Aktif 1';
  perform t.ok(public.render_dossier(t.u('A'), t.u('bcourse')) ->> 'hash' = v_d ->> 'hash', 'öneri başlatılınca hash değişmez');
  update public.mastery m set p = 0.01 where m.enrollment_id = t.u('benr') and m.skill_id = 'b.35';
  perform t.ok(public.render_dossier(t.u('A'), t.u('bcourse')) ->> 'hash' <> v_d ->> 'hash', 'ustalık değişince hash değişir');
end $$;

-- Yetki ve hatalar
do $$
begin
  perform t.as_user(t.u('inst'));
  perform t.ok(public.render_dossier(t.u('A'), t.u('bcourse')) ? 'hash', 'bağlı eğitmen dossier alır');
  perform t.as_user(t.u('admin'));
  perform t.ok(public.render_dossier(t.u('A'), t.u('bcourse')) ? 'hash', 'admin dossier alır');
  perform t.as_service();
  perform t.ok(public.render_dossier(t.u('A'), t.u('course')) -> 'mastery' -> 'weakest' = '[]'::jsonb, 'worker; kanıtsız kayıtta boş listeler');
  perform t.ok(public.render_dossier(t.u('B'), t.u('course')) -> 'last_practice' = 'null'::jsonb
               and public.render_dossier(t.u('B'), t.u('course')) -> 'memory_paths' = '[]'::jsonb, 'alıştırmasız öğrencide null, boş dizi');
  perform t.as_user(t.u('parent'));
  perform t.raises(format($q$select public.render_dossier(%L, %L)$q$, t.u('A'), t.u('bcourse')), 'OGR-AUTH-001%', 'veli dossier alamaz');
  perform t.as_user(t.u('can'));
  perform t.raises(format($q$select public.render_dossier(%L, %L)$q$, t.u('B'), t.u('bcourse')), 'OGR-DOS-001%', 'derste kaydı yoksa OGR-DOS-001');
  perform t.as_admin();
end $$;

rollback;
