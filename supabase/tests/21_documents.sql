-- tests/21_documents.sql — üretilen belgeler (0032): register_generated_document (yalnız worker; aç/güncelle, AST'de
-- anahtar yok, Storage yolu, tür değişmez, sürüm, deneme raporunu oturuma bağlama → done) ve list_my_documents (öğrenci
-- kendi + kayıtlı dersinin yayımlanmış ders geneli belgeleri; veli yalnız çocuğunun hazır raporları; answer_key asla;
-- tür süzgeci; personel öğrenci kimliğiyle); exam_session_view'daki rapor alanı.
begin;
\ir _fixture.sql

do $$
declare
  v_exam uuid;
  v_sess uuid;
begin
  perform t.add_outsiders();
  insert into public.exams (curriculum_id, course_id, kind, source, title, status, created_by)
  values (t.u('cur'), t.u('course'), 'published', 'instructor', 'Rapor Denemesi', 'published', t.u('inst')) returning id into v_exam;
  insert into public.exam_sessions (exam_id, enrollment_id, mode, status, score, finished_at)
  values (v_exam, t.u('EA'), 'in_app', 'analysing', '{"total": 0, "correct": 0, "wrong": 0, "blank": 0, "unfinished": 0, "net": 0, "sections": []}', now())
  returning id into v_sess;
  insert into t.cfg values ('S', v_sess::text);
end $$;

-- yetki ve doğrulama
do $$
begin
  perform t.ok(not has_function_privilege('anon', 'public.register_generated_document(jsonb)', 'execute')
               and not has_function_privilege('anon', 'public.list_my_documents(text, uuid, int)', 'execute')
               and has_function_privilege('authenticated', 'public.list_my_documents(text, uuid, int)', 'execute'),
               'belge RPC''leri: anon çağıramaz');
  perform t.as_user(t.u('elif'));
  perform t.raises('select public.register_generated_document(''{"kind": "notes", "title": "x"}''::jsonb)', 'OGR-AUTH-002%', 'öğrenci belge kaydı yazamaz');
  perform t.as_user(t.u('inst'));
  perform t.raises('select public.register_generated_document(''{"kind": "notes", "title": "x"}''::jsonb)', 'OGR-AUTH-002%', 'eğitmen de yazamaz (worker yolu)');
  perform t.as_service();
  perform t.raises('select public.register_generated_document(''{"kind": "poster", "title": "x"}''::jsonb)', 'OGR-DOC-001%', 'geçersiz tür');
  perform t.raises('select public.register_generated_document(''{"kind": "notes", "title": " "}''::jsonb)', 'OGR-DOC-001%', 'başlık gerekli');
  perform t.raises('select public.register_generated_document(''{"kind": "notes", "title": "x", "status": "done"}''::jsonb)', 'OGR-DOC-001%', 'geçersiz durum');
  perform t.raises(format('select public.register_generated_document(%L::jsonb)',
                          jsonb_build_object('kind', 'report', 'title', 'x', 'student_id', t.v('A'),
                                             'content', jsonb_build_object('kind', 'report', 'keys', jsonb_build_array(jsonb_build_object('question_no', 1))))),
                   'OGR-DOC-002%', 'öğrenci belgesinde anahtar olmaz');
  perform t.raises('select public.register_generated_document(''{"kind": "notes", "title": "x", "pdf_path": "../gizli.pdf"}''::jsonb)', 'OGR-DOC-001%',
                   'geçersiz Storage yolu');
  perform t.raises(format('select public.register_generated_document(%L::jsonb)',
                          jsonb_build_object('kind', 'notes', 'title', 'x', 'exam_session_id', t.v('S'))), 'OGR-DOC-003%', 'oturuma yalnız rapor bağlanır');
  perform t.raises(format('select public.register_generated_document(%L::jsonb)',
                          jsonb_build_object('kind', 'report', 'title', 'x', 'student_id', t.v('B'), 'exam_session_id', t.v('S'))),
                   'OGR-DOC-003%', 'başka öğrencinin raporu oturuma bağlanmaz');
  perform t.as_admin();
end $$;

-- deneme raporu yaşam döngüsü
do $$
declare
  v_id uuid;
  v_v jsonb;
begin
  perform t.as_service();
  v_id := public.register_generated_document(jsonb_build_object(
    'kind', 'report', 'title', 'Rapor Denemesi raporu', 'exam_session_id', t.v('S'), 'status', 'generating',
    'content', jsonb_build_object('kind', 'report', 'title', 'Rapor', 'sections', '[]'::jsonb, 'blocks', '[]'::jsonb), 'model', 'fake', 'cost_usd', 0.01));
  perform t.as_admin();
  insert into t.cfg values ('DR', v_id::text);
  perform t.ok((select gd.student_id = t.u('A') and gd.course_id = t.u('course') and gd.status = 'generating' and gd.version = 1
                  from public.generated_documents gd where gd.id = v_id), 'rapor: öğrenci ve ders oturumdan, generating');
  perform t.ok((select es.report_document_id = v_id and es.status = 'analysing' and es.progress ->> 'stage' = 'report'
                  from public.exam_sessions es where es.id = t.u('S')), 'oturum rapora bağlandı, aşama report');
  perform t.as_service();
  perform public.register_generated_document(jsonb_build_object('id', v_id, 'status', 'rendered',
                                                                'pdf_path', 'reports/' || t.v('A') || '/' || v_id || '.pdf', 'cost_usd', 0.02));
  perform t.raises(format('select public.register_generated_document(%L::jsonb)', jsonb_build_object('id', v_id, 'kind', 'notes')), 'OGR-DOC-001%',
                   'belge türü değişmez');
  perform t.as_admin();
  perform t.ok((select es.status = 'done' and es.progress ->> 'stage' = 'done' and es.progress ->> 'report_status' = 'rendered'
                  from public.exam_sessions es where es.id = t.u('S')), 'rapor hazır: oturum done');
  perform t.ok((select gd.version = 1 and gd.cost_usd = 0.03 and gd.title = 'Rapor Denemesi raporu' and gd.content ->> 'kind' = 'report'
                  from public.generated_documents gd where gd.id = v_id), 'güncelleme: maliyet birikir, alanlar korunur, sürüm 1');
  perform t.as_service();
  perform public.register_generated_document(jsonb_build_object('id', v_id, 'pdf_path', 'reports/' || t.v('A') || '/' || v_id || '-2.pdf'));
  perform t.as_admin();
  perform t.ok((select gd.version = 2 from public.generated_documents gd where gd.id = v_id), 'yeni PDF yolu: sürüm 2');
  perform t.as_user(t.u('elif'));
  v_v := public.exam_session_view(t.u('S'));
  perform t.ok(v_v -> 'report' ->> 'id' = v_id::text and v_v -> 'report' ->> 'status' = 'rendered' and v_v -> 'report' ->> 'pdf_path' like 'reports/%-2.pdf',
               'sonuç görünümü raporu taşır');
  perform t.as_admin();
end $$;

-- belgelerim
do $$
declare
  v_id uuid;
  v_l jsonb;
  v_titles text;
begin
  perform t.as_service();
  perform public.register_generated_document(jsonb_build_object('kind', 'notes', 'title', 'Elif notu', 'student_id', t.v('A'), 'course_id', t.v('course')));
  perform public.register_generated_document(jsonb_build_object('kind', 'notes', 'title', 'Can notu', 'student_id', t.v('B'), 'course_id', t.v('course'), 'status', 'published'));
  perform public.register_generated_document(jsonb_build_object('kind', 'notes', 'title', 'Ders notu', 'course_id', t.v('course'), 'status', 'published'));
  perform public.register_generated_document(jsonb_build_object('kind', 'mock_exam', 'title', 'Ders taslağı', 'course_id', t.v('course'), 'status', 'review'));
  perform public.register_generated_document(jsonb_build_object('kind', 'answer_key', 'title', 'Anahtar', 'course_id', t.v('course'), 'status', 'published',
                                                                'content', jsonb_build_object('keys', jsonb_build_array(jsonb_build_object('question_no', 1, 'correct_option', 'A')))));
  perform public.register_generated_document(jsonb_build_object('kind', 'report', 'title', 'Elif taslak rapor', 'student_id', t.v('A'), 'status', 'queued'));

  perform t.as_user(t.u('elif'));
  v_l := public.list_my_documents();
  select string_agg(d.e ->> 'title' || '/' || (d.e ->> 'scope'), ',' order by d.e ->> 'title') into v_titles from jsonb_array_elements(v_l -> 'documents') as d (e);
  perform t.ok(v_titles = 'Ders notu/course,Elif notu/personal,Elif taslak rapor/personal,Rapor Denemesi raporu/personal' and (v_l ->> 'count')::int = 4,
               'öğrenci: kendi belgeleri + yayımlanmış ders notu; Can''ın notu, taslak ders belgesi ve anahtar yok (' || coalesce(v_titles, '-') || ')');
  perform t.ok((select d.e ->> 'exam_session_id' = t.v('S') and d.e ->> 'course_title' = 'Test Matematik'
                  from jsonb_array_elements(v_l -> 'documents') as d (e) where d.e ->> 'title' = 'Rapor Denemesi raporu'),
               'rapor satırı deneme oturumunu ve dersi taşır');
  perform t.ok((public.list_my_documents('report') ->> 'count')::int = 2, 'tür süzgeci: report');
  perform t.ok((public.list_my_documents('notes', null, 1) ->> 'count')::int = 1, 'sınır (p_limit)');
  perform t.raises('select public.list_my_documents(''answer_key'')', 'OGR-DOC-001%', 'anahtar türü listelenemez');
  perform t.raises(format('select public.list_my_documents(null, %L)', t.v('B')), 'OGR-AUTH-001%', 'öğrenci başka öğrenciyi listeleyemez');

  perform t.as_user(t.u('can'));
  select string_agg(d.e ->> 'title', ',' order by d.e ->> 'title') into v_titles from jsonb_array_elements(public.list_my_documents() -> 'documents') as d (e);
  perform t.ok(v_titles = 'Can notu,Ders notu', 'Can: kendi notu + ders notu (' || coalesce(v_titles, '-') || ')');

  perform t.as_user(t.u('parent'));
  select string_agg(d.e ->> 'title', ',') into v_titles from jsonb_array_elements(public.list_my_documents() -> 'documents') as d (e);
  perform t.ok(v_titles = 'Rapor Denemesi raporu', 'veli: yalnız çocuğunun hazır raporu (' || coalesce(v_titles, '-') || ')');
  perform t.ok((public.list_my_documents('notes') ->> 'count')::int = 0, 'veli not göremez');
  perform t.raises(format('select public.list_my_documents(null, %L)', t.v('B')), 'OGR-AUTH-001%', 'veli başka öğrenciyi listeleyemez');
  perform t.ok(t.n(format('select 1 from public.generated_documents where id = %L', t.v('DR'))) = 1, 'veli raporu RLS ile de okur');
  perform t.as_user(t.u('parent2'));
  perform t.ok((public.list_my_documents() ->> 'count')::int = 0, 'bağsız veli: boş liste');

  perform t.as_user(t.u('inst'));
  perform t.raises('select public.list_my_documents()', 'OGR-AUTH-001%', 'personel öğrenci kimliği vermeden listeleyemez');
  perform t.ok((public.list_my_documents(null, t.u('A')) ->> 'count')::int = 4, 'bağlı eğitmen öğrencinin listesini görür');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.list_my_documents(null, %L)', t.v('A')), 'OGR-AUTH-001%', 'bağsız eğitmen göremez');
  perform t.as_admin();
end $$;

rollback;
