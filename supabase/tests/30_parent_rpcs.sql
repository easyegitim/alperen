-- tests/30_parent_rpcs.sql — veli RPC'leri (0043): parent_child_summary, parent_mastery_overview, parent_recent_activity,
-- parent_exam_sessions, parent_reports, parent_request_report (günlük sınır, report.generate), veli sohbeti
-- (parent_open_conversation / parent_history / parent_append_message / parent_log_llm_call / tur kirası). Veli yalnız AKTİF
-- bağlı çocuğunu okur (başka öğrenci, bağsız veli, öğrenci, eğitmen 42501); koç sohbeti, sınav soruları, cevap anahtarları
-- ve ham yüklemeler veliye kapalıdır (42501 ya da 0 satır); dönüşlerde ustalık olasılığı p yok. Bağ iptal edilince hepsi 42501.
begin;
\ir _fixture.sql
select t.add_outsiders();

create function t.coach_token(p_conv uuid, p_ttl int default 600) returns text language plpgsql security definer as $$
declare
  v_exp text := (floor(extract(epoch from now())) + p_ttl)::bigint::text;
begin
  return 'v1.' || v_exp || '.' || encode(hmac(convert_to('coach:' || p_conv::text || ':' || v_exp, 'UTF8'),
                                              convert_to((select k.secret from secure.server_keys k where k.name = 'web_coach'), 'UTF8'), 'sha256'), 'hex');
end $$;
revoke all on function t.coach_token(uuid, int) from public;

-- yetkiler
do $$
begin
  perform t.ok(has_function_privilege('authenticated', 'public.parent_child_summary(uuid)', 'execute')
               and has_function_privilege('authenticated', 'public.parent_request_report(uuid, text, jsonb)', 'execute')
               and has_function_privilege('authenticated', 'public.parent_append_message(uuid, text, jsonb, bigint, jsonb, text)', 'execute'),
               'veli RPC''leri authenticated çağırır');
  perform t.ok(not has_function_privilege('anon', 'public.parent_child_summary(uuid)', 'execute')
               and not has_function_privilege('anon', 'public.parent_history(uuid, int, bigint, uuid)', 'execute')
               and not has_function_privilege('anon', 'public.parent_request_report(uuid, text, jsonb)', 'execute'),
               'anon veli RPC''lerini çağıramaz');
  perform t.ok(not has_function_privilege('authenticated', 'app.parent_conversation(uuid)', 'execute')
               and not has_function_privilege('authenticated', 'app.child_study_stats(uuid, timestamptz, timestamptz, text)', 'execute'),
               'iç yardımcılar doğrudan çağrılamaz');
end $$;

-- dünya: Elif'in (A) bu haftaki etkinliği, bir deneme, hafıza özeti, koç sohbeti, yayımlanmış rapor ve bir yükleme
do $$
declare
  v_exam uuid;
  v_sess uuid;
  v_conv uuid;
  v_up uuid;
  v_doc uuid;
begin
  perform public.apply_diagnosis(jsonb_build_object('enrollment_id', t.u('EA'), 'verdict', 'wrong', 'error_cause', 'concept',
            'skill_ids', jsonb_build_array('t.mat.a'), 'analysis', '{}'::jsonb));
  perform public.apply_diagnosis(jsonb_build_object('enrollment_id', t.u('EA'), 'verdict', 'correct',
            'skill_ids', jsonb_build_array('t.mat.b'), 'analysis', '{}'::jsonb));
  insert into public.exams (course_id, curriculum_id, created_by, kind, source, title, question_count, status)
  values (t.u('course'), t.u('cur'), t.u('inst'), 'deneme', 'instructor', 'Test Denemesi 1', 2, 'ready') returning id into v_exam;
  insert into public.exam_questions (exam_id, no, kind, stem_text, options, skill_ids)
  values (v_exam, 1, 'mcq', 'GİZLİ SORU METNİ', '[{"key":"A","text":"1"},{"key":"B","text":"2"}]', '{t.mat.a}'),
         (v_exam, 2, 'mcq', 'GİZLİ SORU METNİ 2', '[{"key":"A","text":"1"},{"key":"B","text":"2"}]', '{t.mat.b}');
  insert into public.exam_sessions (exam_id, enrollment_id, mode, started_at, finished_at, duration_sec, status, score)
  values (v_exam, t.u('EA'), 'in_app', now() - interval '61 minutes', now() - interval '1 minute', 3600, 'analysing',
          '{"total": 2, "correct": 1, "wrong": 1, "blank": 0, "unfinished": 0, "net": 0.75,
            "sections": [{"section": "Genel", "total": 2, "correct": 1, "wrong": 1, "blank": 0, "unfinished": 0, "net": 0.75}]}')
  returning id into v_sess;
  insert into public.exam_responses (session_id, exam_question_id, answer, outcome)
  select v_sess, q.id, 'A', case q.no when 1 then 'correct' else 'wrong' end from public.exam_questions q where q.exam_id = v_exam;
  update public.exam_sessions es set status = 'done' where es.id = v_sess;
  insert into public.memory_files (student_id, path, content)
  values (t.u('A'), '/memories/parent_summary.md', 'Elif bu hafta düzenli çalıştı; işaret kurallarında ilerliyor.');
  insert into public.conversations (student_id, kind, participant_id) values (t.u('A'), 'coach', t.u('elif')) returning id into v_conv;
  insert into public.conversation_messages (conversation_id, role, content)
  values (v_conv, 'user', '[{"type":"text","text":"KOÇA ÖZEL SIR"}]');
  insert into public.uploads (owner_id, student_id, kind, storage_path) values (t.u('elif'), t.u('A'), 'photo', t.v('elif') || '/x.jpg')
  returning id into v_up;
  insert into public.generated_documents (student_id, course_id, kind, title, status, pdf_path)
  values (t.u('A'), t.u('course'), 'report', 'Haftalık rapor · 2 Kas', 'published', 'reports/a.pdf') returning id into v_doc;
  insert into public.generated_documents (student_id, course_id, kind, title, status)
  values (t.u('A'), t.u('course'), 'report', 'İncelemedeki rapor', 'review');
  insert into t.cfg values ('exam', v_exam::text), ('sess', v_sess::text), ('coach_conv', v_conv::text), ('up', v_up::text), ('doc', v_doc::text);
end $$;

-- özet
do $$
declare
  v jsonb;
begin
  perform t.as_user(t.u('parent'));
  v := public.parent_child_summary(t.u('A'));
  perform t.ok(v #>> '{student,name}' = 'Elif' and v #>> '{student,id}' = t.v('A'), 'özet: çocuğun adı (ilk ad)');
  perform t.ok((v #>> '{week,questions}')::int = 4 and (v #>> '{week,minutes}')::int = 66 and (v #>> '{week,exams}')::int = 1
               and (v #>> '{week,diagnoses}')::int = 2 and (v #>> '{week,active_days}')::int >= 1,
               'bu hafta: 2 teşhis + 2 deneme sorusu, 60 dk deneme + 2 × 3 dk çözüm = 66 dk');
  perform t.ok((v #>> '{last_exam,net}')::numeric = 0.75 and v #>> '{last_exam,title}' = 'Test Denemesi 1'
               and (v #>> '{last_exam,blank}')::int = 0, 'son deneme neti ve başlığı');
  perform t.ok(v ->> 'summary_md' like 'Elif bu hafta%' and v #>> '{latest_report,id}' = t.v('doc')
               and (v #>> '{latest_report,ready}')::boolean, 'parent_summary.md ve son hazır rapor (incelemedeki değil)');
  perform t.ok(jsonb_array_length(v -> 'courses') = 1 and v #>> '{courses,0,title}' = 'Test Matematik'
               and (v #>> '{courses,0,bands,insufficient}')::int = 2 and v #> '{courses,0,trend}' is not null,
               'ders bantları (kanıt yetersiz) ve yön');
  perform t.ok(position('"p":' in v::text) = 0 and position('KOÇA ÖZEL' in v::text) = 0, 'özette p ve koç sohbeti yok');

  -- başka öğrenci, bağsız veli, öğrenci, eğitmen
  perform t.raises(format($q$select public.parent_child_summary(%L)$q$, t.u('B')), '42501', 'veli bağlı olmadığı öğrenciyi okuyamaz');
  perform t.as_user(t.u('parent2'));
  perform t.raises(format($q$select public.parent_child_summary(%L)$q$, t.u('A')), '42501', 'bağsız veli okuyamaz');
  perform t.raises(format($q$select public.parent_mastery_overview(%L)$q$, t.u('A')), '42501', 'bağsız veli ustalık okuyamaz');
  perform t.raises(format($q$select public.parent_exam_sessions(%L)$q$, t.u('A')), '42501', 'bağsız veli deneme okuyamaz');
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.parent_child_summary(%L)$q$, t.u('A')), '42501', 'öğrenci veli RPC''sini çağıramaz');
  perform t.as_user(t.u('inst'));
  perform t.raises(format($q$select public.parent_recent_activity(%L)$q$, t.u('A')), '42501', 'eğitmen veli RPC''sini çağıramaz');
  perform t.as_anon();
  perform t.raises(format($q$select public.parent_child_summary(%L)$q$, t.u('A')), '42501', 'anon çağıramaz');
  perform t.as_service();
  perform t.ok(public.parent_child_summary(t.u('A')) #>> '{student,name}' = 'Elif', 'worker (service_role) okuyabilir');
  perform t.as_admin();
end $$;

-- ustalık, etkinlik, denemeler, raporlar
do $$
declare
  v jsonb;
begin
  perform t.as_user(t.u('parent'));
  v := public.parent_mastery_overview(t.u('A'));
  perform t.ok((v ->> 'min_evidence')::int = 5 and jsonb_array_length(v -> 'courses') = 1
               and jsonb_array_length(v #> '{courses,0,skills}') = 2
               and v #> '{courses,0,skills,0,band}' = 'null'::jsonb and (v #>> '{courses,0,skills,0,evidence_count}')::int = 1
               and v #>> '{courses,0,skills,0,unit}' = 'Test kökü', 'ustalık: kazanım bandı (kanıt yetersiz: null) + kanıt sayısı + ünite');
  perform t.ok(position('"p":' in v::text) = 0, 'ustalıkta olasılık p yok');
  perform t.raises(format($q$select public.parent_mastery_overview(%L, %L)$q$, t.u('A'), gen_random_uuid()), 'OGR-PARENT-002%',
                   'çocuğun kaydı olmayan ders reddedilir');
  perform t.ok(public.parent_mastery_overview(t.u('A'), t.u('course')) #>> '{courses,0,course_id}' = t.v('course'), 'ders süzgeci');

  v := public.parent_recent_activity(t.u('A'), 7);
  perform t.ok((v ->> 'days')::int = 7 and jsonb_array_length(v -> 'per_day') = 7
               and (select sum((d ->> 'questions')::int) from jsonb_array_elements(v -> 'per_day') as x (d)) = 4,
               'etkinlik: 7 gün, gün başına soru toplamı haftayla tutarlı');
  perform t.ok(exists (select 1 from jsonb_array_elements(v -> 'items') as x (i) where x.i ->> 'kind' = 'exam' and x.i ->> 'title' = 'Test Denemesi 1')
               and exists (select 1 from jsonb_array_elements(v -> 'items') as x (i) where x.i ->> 'kind' = 'uploads' and (x.i #>> '{detail,count}')::int = 2)
               and exists (select 1 from jsonb_array_elements(v -> 'items') as x (i) where x.i ->> 'kind' = 'report'),
               'etkinlik öğeleri: deneme, çözüm fotoğrafları (gün başına), rapor');
  perform t.ok((public.parent_recent_activity(t.u('A'), 500) ->> 'days')::int = 60, 'gün sayısı 1–60 ile sınırlı');

  v := public.parent_exam_sessions(t.u('A'));
  perform t.ok(jsonb_array_length(v) = 1 and v #>> '{0,session_id}' = t.v('sess') and (v #>> '{0,score,net}')::numeric = 0.75
               and v #>> '{0,score,sections,0,section}' = 'Genel' and v #>> '{0,status}' = 'done',
               'denemeler: skor, bölüm neti');
  perform t.ok(position('GİZLİ SORU' in v::text) = 0 and not (v -> 0 ? 'items') and not (v -> 0 ? 'responses')
               and position('correct_option' in v::text) = 0, 'denemelerde soru, cevap ve anahtar yok');

  v := public.parent_reports(t.u('A'));
  perform t.ok(jsonb_array_length(v) = 1 and v #>> '{0,id}' = t.v('doc') and (v #>> '{0,ready}')::boolean
               and v #>> '{0,pdf_path}' = 'reports/a.pdf', 'raporlar: yalnız hazır olan (incelemedeki yok), pdf yolu');
  perform t.as_admin();
end $$;

-- rapor isteği: türler, doğrulama, günlük sınır (başarısız sayılmaz), report.generate işi
do $$
declare
  v jsonb;
  v_doc public.generated_documents%rowtype;
begin
  perform t.as_user(t.u('parent'));
  v := public.parent_request_report(t.u('A'), 'weekly', '{"extra": 1}');
  perform t.as_admin();
  select gd.* into v_doc from public.generated_documents gd where gd.id = (v ->> 'document_id')::uuid;
  perform t.ok(v_doc.kind = 'report' and v_doc.status = 'queued' and v_doc.student_id = t.u('A') and v_doc.created_by = t.u('parent')
               and v_doc.spec ->> 'report_kind' = 'weekly' and v_doc.spec ->> 'source' = 'parent'
               and v_doc.spec #>> '{params,week_start}' = date_trunc('week', now() at time zone 'Europe/Istanbul')::date::text
               and not (v_doc.spec -> 'params' ? 'extra') and v_doc.title like 'Haftalık rapor · %'
               and (v ->> 'used')::int = 1 and (v ->> 'max')::int = 3,
               'haftalık rapor: generated_documents(report, queued), parametreler normalleşir, bilinmeyen anahtar atılır');
  perform t.ok(v ->> 'job_id' is not null
               or exists (select 1 from secure.job_outbox o where o.name = 'report.generate' and o.data ->> 'document_id' = v ->> 'document_id'),
               'report.generate işi (kuyruk ya da outbox)');
  perform t.as_user(t.u('parent'));
  v := public.parent_request_report(t.u('A'), 'exam', jsonb_build_object('session_id', t.u('sess')));
  perform t.ok(v ->> 'title' = 'Deneme raporu · Test Denemesi 1', 'deneme raporu: oturumun başlığı');
  perform t.raises(format($q$select public.parent_request_report(%L, 'exam', %L)$q$, t.u('A'), jsonb_build_object('session_id', gen_random_uuid())),
                   'OGR-REPORT-001%', 'çocuğun olmayan oturumu reddedilir');
  perform t.raises(format($q$select public.parent_request_report(%L, 'topic', '{}')$q$, t.u('A')), 'OGR-REPORT-001%', 'konu raporu kapsam ister');
  perform t.raises(format($q$select public.parent_request_report(%L, 'topic', '{"skill_ids": ["yok.kazanim"]}')$q$, t.u('A')),
                   'OGR-REPORT-001%', 'müfredat dışı kazanım reddedilir');
  perform t.raises(format($q$select public.parent_request_report(%L, 'trend', '{"weeks": 40}')$q$, t.u('A')), 'OGR-REPORT-001%', 'weeks aralık dışı');
  perform t.raises(format($q$select public.parent_request_report(%L, 'custom', '{"question": "ne"}')$q$, t.u('A')), 'OGR-REPORT-001%', 'özel soru çok kısa');
  perform t.raises(format($q$select public.parent_request_report(%L, 'pdf', '{}')$q$, t.u('A')), 'OGR-REPORT-001%', 'geçersiz tür');
  perform t.raises(format($q$select public.parent_request_report(%L, 'weekly', '{"week_start": "2020-01-06"}')$q$, t.u('A')),
                   'OGR-REPORT-001%', 'bir yıldan eski hafta reddedilir');
  v := public.parent_request_report(t.u('A'), 'topic', '{"skill_ids": ["t.mat.a"]}');
  perform t.ok(v ->> 'title' = 'Konu raporu · İşlem önceliği' and (v ->> 'used')::int = 3, 'konu raporu (üçüncü istek)');
  perform t.raises(format($q$select public.parent_request_report(%L, 'trend', '{}')$q$, t.u('A')), 'OGR-REPORT-002%', 'günlük sınır 3');
  perform t.as_admin();
  update public.generated_documents gd set status = 'failed' where gd.id = (v ->> 'document_id')::uuid;
  perform t.as_user(t.u('parent'));
  v := public.parent_request_report(t.u('A'), 'trend', '{"weeks": 4}');
  perform t.ok(v ->> 'title' = 'Gelişim raporu · son 4 hafta', 'başarısız istek sınıra sayılmaz');
  perform t.ok(jsonb_array_length(public.parent_reports(t.u('A'))) = 5, 'raporlar: hazır olan + velinin kendi istekleri (durumlarıyla)');
  perform t.ok((select bool_and(not (x.r ? 'pdf_path') or x.r -> 'pdf_path' = 'null'::jsonb or (x.r ->> 'ready')::boolean)
                  from jsonb_array_elements(public.parent_reports(t.u('A'))) as x (r)), 'hazır olmayan isteğin pdf yolu yok');
  perform t.raises(format($q$select public.parent_request_report(%L, 'weekly', '{}')$q$, t.u('B')), '42501', 'bağlı olmayan çocuk için rapor yok');
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.parent_request_report(%L, 'weekly', '{}')$q$, t.u('A')), '42501', 'öğrenci veli raporu isteyemez');
  perform t.as_service();
  perform t.raises(format($q$select public.parent_request_report(%L, 'weekly', '{}')$q$, t.u('A')), '42501', 'rapor isteği yalnız veliden');
  perform t.as_admin();
end $$;

-- velinin özel rapor isteği öğrenciye görünmez (RLS, Belgelerim, Bugün); veli ve eğitmen görür
do $$
declare
  v jsonb;
begin
  update public.settings st set value = '10' where st.key = 'parent_reports_daily_max';
  perform t.as_user(t.u('parent'));
  v := public.parent_request_report(t.u('A'), 'custom', '{"question": "Neden ders çalışmıyor, tembel mi?"}');
  perform t.as_admin();
  update public.generated_documents gd set status = 'rendered', pdf_path = 'reports/custom.pdf' where gd.id = (v ->> 'document_id')::uuid;
  insert into t.cfg values ('custom_doc', v ->> 'document_id');
  perform t.ok(t.sees(t.u('parent'), format('select 1 from public.generated_documents gd where gd.id = %L', v ->> 'document_id')) = 1,
               'veli kendi istediği raporu okur');
  perform t.ok(t.sees(t.u('elif'), format('select 1 from public.generated_documents gd where gd.id = %L', v ->> 'document_id')) = 0
               and t.sees(t.u('elif'), $q$select 1 from public.generated_documents gd where gd.spec ->> 'source' = 'parent'$q$) = 0,
               'öğrenci velinin istediği raporları (özel soru dahil) RLS ile okuyamaz');
  perform t.ok(t.sees(t.u('inst'), format('select 1 from public.generated_documents gd where gd.id = %L', v ->> 'document_id')) = 1,
               'bağlı eğitmen raporu görür');
  perform t.as_user(t.u('elif'));
  perform t.ok(position('Özel rapor' in public.list_my_documents()::text) = 0
               and position(v ->> 'document_id' in public.list_my_documents()::text) = 0
               and position(t.v('doc') in public.list_my_documents()::text) > 0,
               'öğrencinin Belgelerim listesinde velinin isteği yok (diğer raporları var)');
  perform t.as_user(t.u('parent'));
  perform t.ok(position(v ->> 'document_id' in public.list_my_documents()::text) > 0, 'velinin Belgelerim listesinde hazır isteği var');
  perform t.as_admin();
end $$;

-- veli sohbeti; koç sohbeti asla
do $$
declare
  v_conv uuid;
  v_conv2 uuid;
  v_h jsonb;
  v_id bigint;
  v_call bigint;
  v_tok uuid;
  v_t1 text;
  v_t2 text;
begin
  perform t.as_user(t.u('parent'));
  v_h := public.parent_history(null, 80, null, t.u('A'));
  perform t.ok(v_h -> 'conversation' = 'null'::jsonb, 'sohbet yokken null');
  v_conv := public.parent_open_conversation(t.u('A'));
  perform t.ok(public.parent_open_conversation(t.u('A')) = v_conv, 'ikinci çağrı aynı sohbeti döner');
  v_conv2 := public.parent_open_conversation(t.u('A'), true);
  perform t.ok(v_conv2 <> v_conv, 'p_new yeni sohbet açar');
  perform t.ok((select c.kind = 'parent' and c.participant_id = t.u('parent') and c.student_id = t.u('A')
                  from public.conversations c where c.id = v_conv), 'sohbet kind=parent, katılımcı veli');
  perform t.as_admin();
  v_t1 := t.coach_token(v_conv);
  v_t2 := t.coach_token(v_conv2);
  perform t.as_user(t.u('parent'));
  perform t.raises(format($q$select public.parent_open_conversation(%L)$q$, t.u('B')), '42501', 'bağlı olmayan çocuk için sohbet yok');
  v_id := public.parent_append_message(v_conv, 'user', '[{"type":"text","text":"Bu hafta ne çalıştı?"}]');
  perform t.ok(v_id is not null, 'veli metin mesajı ekler');
  perform t.raises(format($q$insert into public.conversation_messages (conversation_id, role, content)
                            values (%L, 'user', '[{"type":"tool_result","tool_use_id":"x","content":"y"}]')$q$, v_conv),
                   '42501', 'veli sohbetine doğrudan INSERT yok (yalnız parent_append_message)');
  perform t.raises(format($q$select public.parent_append_message(%L, 'assistant', '[{"type":"text","text":"x"}]')$q$, v_conv),
                   'OGR-COACH-001%', 'jetonsuz assistant turu reddedilir');
  perform t.raises(format($q$select public.parent_append_message(%L, 'user', %L)$q$, v_conv,
                          jsonb_build_array(jsonb_build_object('type', 'image', 'source', jsonb_build_object('type', 'upload', 'upload_id', t.u('up'))))),
                   'OGR-COACH-001%', 'veli yükleme bloğu yazamaz');
  perform t.raises(format($q$select public.parent_append_message(%L, 'assistant', '[{"type":"text","text":"x"}]', null, null, %L)$q$,
                          v_conv, v_t2), 'OGR-COACH-001%', 'başka sohbetin jetonu geçmez');
  v_id := public.parent_append_message(v_conv, 'assistant', '[{"type":"text","text":"Elif bu hafta 66 dakika çalıştı."}]', null, null,
                                       v_t1);
  v_call := public.parent_log_llm_call(v_conv, '{"route":"parent_chat","model":"claude-sonnet-5","status":"ok","tokens_in":10,"tokens_out":5,"cost_usd":0.001}',
                                       v_t1);
  perform t.raises(format($q$select public.parent_log_llm_call(%L, '{"route":"coach_chat","model":"m","status":"ok"}', %L)$q$, v_conv, v_t1),
                   'OGR-PARENT-001%', 'defter yalnız parent_chat rotası');
  perform t.raises(format($q$select public.parent_log_llm_call(%L, '{"route":"parent_chat","model":"m","status":"ok"}')$q$, v_conv),
                   'OGR-COACH-001%', 'defter jetonsuz yazılamaz');
  v_h := public.parent_history(v_conv);
  perform t.ok((v_h ->> 'total')::int = 2 and v_h #>> '{messages,1,role}' = 'assistant' and v_h #>> '{conversation,student_id}' = t.v('A'),
               'parent_history: mesajlar eskiden yeniye');
  perform t.ok(public.parent_history(null, 80, null, t.u('A')) #>> '{conversation,id}' in (v_conv::text, v_conv2::text), 'en son sohbet');
  v_tok := public.parent_claim_turn(v_conv);
  perform t.ok(v_tok is not null and public.parent_claim_turn(v_conv) is null and public.parent_release_turn(v_conv, v_tok),
               'tur kirası: ikinci kira null, bırakılır');

  -- koç sohbeti asla
  perform t.raises(format($q$select public.parent_history(%L)$q$, t.u('coach_conv')), '42501', 'veli koç sohbetini parent_history ile okuyamaz');
  perform t.raises(format($q$select public.coach_history(%L)$q$, t.u('coach_conv')), '42501', 'veli coach_history çağıramaz');
  perform t.raises(format($q$select public.parent_append_message(%L, 'user', '[{"type":"text","text":"x"}]')$q$, t.u('coach_conv')),
                   '42501', 'veli koç sohbetine yazamaz');
  perform t.ok((select count(*) from public.conversations c where c.kind = 'coach') = 0
               and (select count(*) from public.conversation_messages m where m.conversation_id = t.u('coach_conv')) = 0,
               'RLS: koç sohbeti ve mesajları veliye görünmez');
  -- sınav soruları, cevap anahtarları, ham yüklemeler
  perform t.ok((select count(*) from public.exam_questions) = 0 and (select count(*) from public.v_exam_questions_student) = 0,
               'sınav soruları veliye görünmez');
  perform t.raises('select count(*) from secure.exam_answer_keys', '42501', 'cevap anahtarları şeması kapalı');
  perform t.raises(format($q$select public.peek_answer_key(%L)$q$, gen_random_uuid()), '42501', 'veli anahtar okuyamaz');
  perform t.raises(format($q$insert into public.exam_questions (exam_id, no, kind) values (%L, 9, 'mcq')$q$, t.u('exam')), '42501',
                   'veli sınav sorusu yazamaz');
  perform t.ok((public.exam_session_view(t.u('sess')) ->> 'items_hidden')::boolean
               and jsonb_array_length(public.exam_session_view(t.u('sess')) -> 'items') = 0, 'sonuç görünümünde soru listesi veliye gizli');
  perform t.ok((select count(*) from public.uploads) = 0 and (select count(*) from storage.objects) = 0, 'ham yüklemeler veliye görünmez');
  perform t.raises(format($q$select public.coach_uploads(array[%L]::uuid[])$q$, t.u('up')), '42501', 'veli koç eklerini okuyamaz');
  perform t.as_admin();
  insert into t.cfg values ('pconv', v_conv::text);
  perform t.ok((select l.student_ref = s.public_ref and l.ref_table = 'conversations' and l.ref_id = v_conv::text
                  from public.llm_calls l join public.students s on s.id = t.u('A') where l.id = v_call), 'defter: student_ref ve ref sohbetten');

  -- başkaları veli sohbetini okuyamaz
  perform t.as_user(t.u('parent2'));
  perform t.raises(format($q$select public.parent_history(%L)$q$, v_conv), '42501', 'bağsız veli başkasının sohbetini okuyamaz');
  perform t.raises(format($q$select public.parent_append_message(%L, 'user', '[{"type":"text","text":"x"}]')$q$, v_conv), '42501',
                   'bağsız veli başkasının sohbetine yazamaz');
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.parent_history(%L)$q$, v_conv), '42501', 'öğrenci veli sohbetini RPC ile okuyamaz');
  perform t.ok(t.n(format('select 1 from public.conversation_messages m where m.conversation_id = %L', v_conv)) = 0,
               'öğrenci veli sohbetini RLS ile de okuyamaz');
  perform t.as_admin();
end $$;

-- ayrılmış ebeveynler: aynı çocuğun öteki velisi (parent2, bağlı) velinin özel sorusunu ve PDF'ini görmez; isteyen veli görür
do $$
declare
  v jsonb;
begin
  perform t.as_admin();
  insert into public.guardian_links (parent_id, student_id, relation, status, accepted_at)
  values (t.u('parent2'), t.u('A'), 'diğer', 'active', now());
  perform t.as_user(t.u('parent2'));
  v := public.parent_request_report(t.u('A'), 'custom', '{"question": "Babasıyla yaşadığı sorunlar neler, bunu bilmem gerekiyor mu?"}');
  perform t.as_admin();
  -- test tek işlemde (created_at = now() sabit): özet sıralaması için bu isteği en yeni yap
  update public.generated_documents gd set status = 'rendered', pdf_path = 'reports/custom2.pdf',
         created_at = now() + interval '1 minute' where gd.id = (v ->> 'document_id')::uuid;
  insert into storage.objects (bucket_id, name) values ('documents', 'reports/custom2.pdf');
  insert into t.cfg values ('custom2_doc', v ->> 'document_id');
  perform t.ok(t.sees(t.u('parent'), format('select 1 from public.generated_documents gd where gd.id = %L', t.v('custom2_doc'))) = 0
               and t.sees(t.u('parent'), $q$select 1 from storage.objects o where o.name = 'reports/custom2.pdf'$q$) = 0,
               'öteki bağlı veli isteği (RLS) ve PDF nesnesini (Storage) göremez');
  perform t.ok(t.sees(t.u('parent2'), format('select 1 from public.generated_documents gd where gd.id = %L', t.v('custom2_doc'))) = 1,
               'isteyen veli kendi raporunu RLS ile okur');
  perform t.as_user(t.u('parent'));
  perform t.ok(position(t.v('custom2_doc') in public.parent_reports(t.u('A'))::text) = 0
               and position(t.v('custom2_doc') in public.list_my_documents()::text) = 0
               and position(t.v('custom2_doc') in public.parent_recent_activity(t.u('A'), 7)::text) = 0
               and public.parent_child_summary(t.u('A')) #>> '{latest_report,id}' is distinct from t.v('custom2_doc'),
               'öteki veli: rapor listesi, Belgelerim, son etkinlik ve özet bu isteği göstermez (en yeni olsa bile)');
  perform t.as_user(t.u('parent2'));
  perform t.ok(position(t.v('custom2_doc') in public.parent_reports(t.u('A'))::text) > 0
               and position(t.v('custom2_doc') in public.list_my_documents()::text) > 0
               and public.parent_child_summary(t.u('A')) #>> '{latest_report,id}' = t.v('custom2_doc'),
               'isteyen veli: rapor listesi, Belgelerim ve özet kendi raporunu gösterir');
  perform t.as_admin();
end $$;

-- bağ iptal edilince her şey kapanır
do $$
begin
  update public.guardian_links gl set status = 'revoked' where gl.parent_id = t.u('parent') and gl.student_id = t.u('A');
  perform t.as_user(t.u('parent'));
  perform t.raises(format($q$select public.parent_child_summary(%L)$q$, t.u('A')), '42501', 'iptal sonrası özet 42501');
  perform t.raises(format($q$select public.parent_history(%L)$q$, t.u('pconv')), '42501', 'iptal sonrası sohbet 42501');
  perform t.raises(format($q$select public.parent_request_report(%L, 'weekly', '{}')$q$, t.u('A')), '42501', 'iptal sonrası rapor isteği 42501');
  perform t.ok(public.parent_history(null) -> 'conversation' = 'null'::jsonb, 'iptal sonrası en son sohbet yok');
  perform t.ok(t.n(format('select 1 from public.generated_documents gd where gd.id = %L', t.v('custom_doc'))) = 0
               and t.n($q$select 1 from public.generated_documents gd where gd.spec ->> 'source' = 'parent'$q$) = 0,
               'iptal sonrası velinin istediği raporlar da RLS ile kapalı (Storage bu politikayı izler)');
  perform t.ok(t.n(format('select 1 from public.conversation_messages m where m.conversation_id = %L', t.v('pconv'))) = 0
               and t.n(format('select 1 from public.conversations c where c.id = %L', t.v('pconv'))) = 0,
               'iptal sonrası eski veli sohbeti RLS ile okunmaz');
  perform t.as_admin();
end $$;

rollback;
