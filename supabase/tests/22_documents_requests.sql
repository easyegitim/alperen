-- tests/22_documents_requests.sql — içerik stüdyosu (0034–0035): request_document (yetki, kapsam doğrulaması, sohbet
-- mesajı idempotansı, günlük yumuşak sınır), document_requests RLS (öğrenci kendi, veli yalnız hazır, bağlı eğitmen),
-- document_request_view, worker durum geçişleri ve doğrulama merdiveni kapısı (document_set_status), yayında Bugün kartı +
-- bildirim, inceleme kapısı (review_required: RLS, yayın tetikleyicisi, review_document onay/ret), blok yeniden üretim
-- kaydı, student_patterns_for_prompt, Belgelerim'in yeni alanları.
begin;
\ir _fixture.sql

do $$
declare
  v_m bigint;
begin
  perform t.add_outsiders();
  insert into public.conversations (id, student_id, kind, participant_id) values
    ('40000000-0000-4000-8000-0000000000a1', t.u('A'), 'coach', t.u('elif')),
    ('40000000-0000-4000-8000-0000000000b1', t.u('B'), 'coach', t.u('can'));
  insert into public.conversation_messages (conversation_id, role, content)
  values ('40000000-0000-4000-8000-0000000000a1', 'user', '[{"type":"text","text":"Rasyonel sayılar notu hazırlar mısın?"}]')
  returning id into v_m;
  insert into t.cfg values ('MA', v_m::text);
  insert into public.conversation_messages (conversation_id, role, content)
  values ('40000000-0000-4000-8000-0000000000b1', 'user', '[{"type":"text","text":"Not ister misin?"}]')
  returning id into v_m;
  insert into t.cfg values ('MB', v_m::text);
end $$;

-- yetkiler ve doğrulama
do $$
begin
  perform t.ok(not has_function_privilege('anon', 'public.request_document(text, jsonb, text, bigint)', 'execute')
               and not has_function_privilege('anon', 'public.document_request_view(uuid)', 'execute')
               and has_function_privilege('authenticated', 'public.request_document(text, jsonb, text, bigint)', 'execute')
               and has_function_privilege('authenticated', 'public.review_document(uuid, text, text)', 'execute')
               and not has_function_privilege('authenticated', 'public.mock_exam_from_document(uuid, jsonb)', 'execute')
               and to_regprocedure('public.request_document(text, uuid, uuid, text, jsonb)') is null,
               'belge isteği RPC''leri: anon çağıramaz; denemeye çevirme authenticated''a kapalı; eski 5 argümanlı imza yok');
  perform t.ok(has_table_privilege('authenticated', 'public.document_requests', 'select')
               and not has_table_privilege('authenticated', 'public.document_requests', 'insert')
               and not has_table_privilege('authenticated', 'public.document_requests', 'update'),
               'document_requests: authenticated yalnız okur (yazım RPC ile)');
  perform t.as_user(t.u('elif'));
  perform t.raises('select public.request_document(''report'', ''{"topic": "x"}'')', 'OGR-DOC-001%', 'rapor bu yoldan istenmez');
  perform t.raises('select public.request_document(''notes'', ''{"topic": "x"}'', ''web'')', 'OGR-DOC-005%', 'geçersiz kaynak');
  perform t.raises('select public.request_document(''notes'', ''{"topic": "x"}'', ''instructor'')', 'OGR-AUTH-002%', 'öğrenci eğitmen kaynağını kullanamaz');
  perform t.raises('select public.request_document(''notes'', ''{}'')', 'OGR-DOC-005%', 'notta konu ya da kazanım gerekli');
  perform t.raises('select public.request_document(''notes'', ''{"skill_ids": ["yok.kazanim"]}'')', 'OGR-DOC-005%', 'müfredat dışı kazanım');
  perform t.raises('select public.request_document(''mock_exam'', ''{"question_count": 500}'')', 'OGR-DOC-005%', 'soru sayısı aralık dışı');
  perform t.raises('select public.request_document(''mock_exam'', ''{"question_count": 41}'')', 'OGR-DOC-005%', 'deneme en çok 40 soru (üretim sınırı)');
  perform t.raises('select public.request_document(''notes'', ''{"topic": "x", "length": "huge"}'')', 'OGR-DOC-005%', 'geçersiz uzunluk');
  perform t.raises('select public.request_document(''notes'', ''{"topic": "x", "duration_min": 40}'')', 'OGR-DOC-005%', 'süre yalnız denemede');
  perform t.raises('select public.request_document(''notes'', ''{"topic": "x", "review": true}'')', 'OGR-DOC-005%', 'öğrenci inceleme isteyemez');
  perform t.raises(format('select public.request_document(''notes'', ''{"topic": "x"}'', ''chat'', %s)', t.v('MB')), 'OGR-AUTH-001%',
                   'başka öğrencinin sohbet mesajı');
  perform t.raises(format('select public.request_document(''notes'', ''{"topic": "x"}'', ''suggestion'', %s)', t.v('MA')), 'OGR-DOC-005%',
                   'sohbet mesajı yalnız chat kaynağında');
  perform t.as_user(t.u('parent'));
  perform t.raises('select public.request_document(''notes'', ''{"topic": "x"}'')', 'OGR-AUTH-001%', 'veli belge isteyemez');
  perform t.as_user(t.u('inst'));
  perform t.raises('select public.request_document(''notes'', ''{"topic": "x"}'', ''instructor'')', 'OGR-DOC-005%', 'eğitmen hedef vermeli');
  perform t.raises(format('select public.request_document(''notes'', %L::jsonb, ''chat'')', jsonb_build_object('student_id', t.v('A'), 'topic', 'x')),
                   'OGR-DOC-005%', 'personel isteğinin kaynağı instructor');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.request_document(''notes'', %L::jsonb, ''instructor'')', jsonb_build_object('student_id', t.v('A'), 'topic', 'x')),
                   'OGR-AUTH-001%', 'bağsız eğitmen öğrenciye belge isteyemez');
  perform t.raises(format('select public.request_document(''notes'', %L::jsonb, ''instructor'')', jsonb_build_object('course_id', t.v('course'), 'topic', 'x')),
                   'OGR-AUTH-002%', 'dersin eğitmeni olmayan ders geneli belge isteyemez');
  perform t.as_admin();
end $$;

-- öğrenci sohbetten not ister: belge + istek + iş; aynı mesaj aynı istek
do $$
declare
  v_r jsonb;
  v_r2 jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_r := public.request_document('notes', '{"topic": "Rasyonel sayılar", "skill_ids": ["t.mat.a"], "unknown": 1}', 'chat', t.v('MA')::bigint);
  v_r2 := public.request_document('notes', '{"topic": "Başka"}', 'chat', t.v('MA')::bigint);
  perform t.as_admin();
  insert into t.cfg values ('R1', v_r ->> 'request_id'), ('D1', v_r -> 'document' ->> 'id');
  perform t.ok(v_r ->> 'status' = 'queued' and v_r ->> 'status_line' = 'Sıraya aldım' and not (v_r ->> 'reused')::boolean
               and v_r ->> 'enrollment_id' = t.v('EA') and v_r ->> 'course_id' = t.v('course') and v_r ->> 'source' = 'chat'
               and v_r -> 'document' ->> 'title' = 'Rasyonel sayılar' and v_r -> 'document' ->> 'status' = 'queued',
               'istek: queued, kayıt ve ders bulundu, başlık konudan (' || v_r::text || ')');
  perform t.ok(v_r -> 'spec' = '{"topic": "Rasyonel sayılar", "skill_ids": ["t.mat.a"], "length": "medium", "difficulty": "medium",
                                 "include_my_mistakes": true, "question_count": 5, "title": "Rasyonel sayılar", "review": false}'::jsonb,
               'kapsam normalleşir: varsayılanlar, bilinmeyen anahtar atılır (' || (v_r -> 'spec')::text || ')');
  perform t.ok(v_r2 ->> 'request_id' = v_r ->> 'request_id' and (v_r2 ->> 'reused')::boolean, 'aynı sohbet mesajı → aynı istek (reused)');
  perform t.ok((select gd.student_id = t.u('A') and gd.kind = 'notes' and gd.status = 'queued' and not gd.review_required
                       and gd.created_by = t.u('elif') and gd.spec ->> 'source' = 'chat'
                  from public.generated_documents gd where gd.id = t.u('D1')), 'belge satırı queued, incelemesiz');
  perform t.ok(exists (select 1 from audit.events e where e.action like 'job.enqueue_%' and e.diff ->> 'name' = 'document.generate'
                        and e.diff -> 'data' ->> 'request_id' = t.v('R1') and e.diff -> 'data' ->> 'document_id' = t.v('D1')
                        and e.diff -> 'data' ->> 'student_id' = t.v('A'))
               or exists (select 1 from secure.job_outbox o where o.name = 'document.generate' and o.data ->> 'request_id' = t.v('R1')),
               'document.generate işi {document_id, request_id, kind, student_id}');
end $$;

-- günlük yumuşak sınır
do $$
declare
  v_r jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_r := public.request_document('mock_exam', '{"question_count": 20, "duration_min": 40}');
  perform t.ok(v_r -> 'document' ->> 'title' = '20 soruluk deneme' and (v_r -> 'spec' ->> 'duration_min')::int = 40
               and v_r -> 'spec' ->> 'difficulty' = 'mixed' and not (v_r -> 'spec' ->> 'include_my_mistakes')::boolean,
               'deneme isteği: başlık soru sayısından, zorluk mixed');
  v_r := public.request_document('question_set', '{"skill_ids": ["t.mat.b"]}', 'suggestion');
  perform t.ok(v_r -> 'document' ->> 'title' = 'İşaret kuralları' and (v_r -> 'spec' ->> 'question_count')::int = 10,
               'soru seti: başlık kazanım adından, 10 soru');
  perform t.as_admin();
  insert into t.cfg values ('R3', v_r ->> 'request_id'), ('D3', v_r -> 'document' ->> 'id');
  perform t.as_user(t.u('elif'));
  perform t.raises('select public.request_document(''notes'', ''{"topic": "Üslü sayılar"}'')', 'OGR-DOC-004%', 'günde 3 istekten sonra sınır');
  perform t.as_service();
  perform public.document_set_status(t.u('D3'), 'failed', '{"error": "model hatası"}');
  perform t.as_user(t.u('elif'));
  v_r := public.request_document('notes', '{"topic": "Üslü sayılar"}');
  perform t.ok(v_r ->> 'status' = 'queued', 'başarısız istek sınırdan düşer');
  perform t.as_user(t.u('inst'));
  v_r := public.request_document('notes', jsonb_build_object('student_id', t.v('A'), 'topic', 'Köklü sayılar'), 'instructor');
  perform t.ok(v_r ->> 'source' = 'instructor' and v_r ->> 'student_id' = t.v('A') and v_r ->> 'enrollment_id' = t.v('EA'),
               'owner eğitmen öğrenci için ister (sınıra takılmaz)');
  perform t.as_user(t.u('elif'));
  perform t.raises('select public.request_document(''notes'', ''{"topic": "Mutlak değer"}'')', 'OGR-DOC-004%', 'eğitmen isteği sayılmaz, sınır yine dolu');
  perform t.as_admin();
  update public.settings st set value = '10'::jsonb where st.key = 'documents_daily_max';
  perform t.as_user(t.u('elif'));
  perform t.ok(public.request_document('notes', '{"topic": "Mutlak değer"}') ->> 'status' = 'queued', 'sınır settings.documents_daily_max''tan');
  perform t.as_admin();
end $$;

-- RLS ve görünüm (hazır olmadan)
do $$
begin
  perform t.ok(t.sees(t.u('elif'), 'select 1 from public.document_requests') = 6, 'öğrenci kendi isteklerini görür (6)');
  perform t.ok(t.sees(t.u('can'), 'select 1 from public.document_requests') = 0, 'başka öğrenci görmez');
  perform t.ok(t.sees(t.u('inst'), 'select 1 from public.document_requests') = 6, 'bağlı eğitmen görür');
  perform t.ok(t.sees(t.u('inst2'), 'select 1 from public.document_requests') = 0 and t.sees(t.u('deniz'), 'select 1 from public.document_requests') = 0,
               'bağsız eğitmen ve öğrenci görmez');
  perform t.ok(t.sees(t.u('parent'), 'select 1 from public.document_requests') = 0, 'veli hazır olmayan isteği görmez');
  perform t.as_user(t.u('parent'));
  perform t.raises(format('select public.document_request_view(%L)', t.v('R1')), 'OGR-AUTH-001%', 'veli hazır olmayan isteği açamaz');
  perform t.as_user(t.u('can'));
  perform t.raises(format('select public.document_request_view(%L)', t.v('R1')), 'OGR-AUTH-001%', 'başka öğrenci açamaz');
  perform t.as_user(t.u('inst'));
  perform t.ok(public.document_request_view(t.u('R1')) ->> 'status' = 'queued', 'eğitmen görünümü açar');
  perform t.as_admin();
end $$;

-- worker: durum geçişleri, merdiven kapısı, yayın → kart + bildirim
do $$
declare
  v_s jsonb;
  v_ast jsonb := '{"kind": "notes", "title": "Rasyonel sayılar", "meta": {"course_title": "Test Matematik", "subtitle": null,
                   "generated_on": "2026-11-04", "language": "tr", "personalized": true, "duration_min": null},
                   "sections": [{"no": 1, "title": "Tanım"}],
                   "blocks": [{"type": "definition_box", "id": "b1", "section_no": 1, "term": "Rasyonel sayı", "body": "a/b biçimi"},
                              {"type": "common_mistake_callout", "id": "b2", "section_no": 1, "pattern_id": "t.a.isaret-hatasi",
                               "text": "3 Kas: eksiyi dağıtırken işareti kaçırdın."}], "keys": []}';
  v_all jsonb := '{"schema": {"status": "pass"}, "sympy": {"status": "skipped"}, "figures": {"status": "pass"},
                   "duplicates": {"status": "pass"}, "personalization": {"status": "pass", "callouts": 1}}';
  v_card record;
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.document_set_status(%L, ''generating'')', t.v('D1')), 'OGR-AUTH-002%', 'öğrenci durum yazamaz');
  perform t.as_service();
  perform t.raises(format('select public.document_set_status(%L, ''done'')', t.v('D1')), 'OGR-DOC-006%', 'geçersiz durum');
  v_s := public.document_set_status(t.u('D1'), 'generating');
  perform t.ok(v_s ->> 'status' = 'generating' and v_s ->> 'document_status' = 'generating' and v_s ->> 'request_id' = t.v('R1'), 'generating');
  v_s := public.document_set_status(t.u('D1'), 'verifying', '{"verification": {"schema": {"status": "pass"}}}');
  perform t.ok(v_s ->> 'status' = 'verifying' and v_s ->> 'document_status' = 'generating'
               and v_s -> 'verification' -> 'schema' ->> 'status' = 'pass' and v_s -> 'verification' -> 'schema' ? 'at',
               'verifying: belge generating, basamak birleşti');
  perform t.raises(format('select public.document_set_status(%L, ''verifying'', ''{"verification": {"magic": {"status": "pass"}}}'')', t.v('D1')),
                   'OGR-DOC-005%', 'bilinmeyen basamak');
  perform t.raises(format('select public.document_set_status(%L, ''verifying'', ''{"verification": {"sympy": {"status": "ok"}}}'')', t.v('D1')),
                   'OGR-DOC-005%', 'geçersiz basamak durumu');
  perform t.raises(format('select public.document_set_status(%L, ''verifying'', ''{"review_required": false}'')', t.v('D1')),
                   'OGR-DOC-005%', 'inceleme şartı kaldırılamaz');
  perform t.raises(format('select public.document_set_status(%L, ''ready'')', t.v('D1')), 'OGR-DOC-008%sympy%', 'merdiven eksikken ready olmaz');
  perform t.raises(format('select public.document_set_status(%L, ''review'')', t.v('D1')), 'OGR-DOC-008%sympy%',
                   'merdiven eksikken review da olmaz (eğitmen onayı eksik belgeyi yayımlamasın)');
  perform t.raises(format('select public.register_generated_document(%L::jsonb)', jsonb_build_object('id', t.v('D1'), 'status', 'published')),
                   'OGR-DOC-006%', 'register_generated_document üretim hattı belgesini yayımlayamaz (merdiven atlanmaz)');
  perform t.raises(format('select public.register_generated_document(%L::jsonb)', jsonb_build_object('id', t.v('D1'), 'status', 'review')),
                   'OGR-DOC-006%', 'register_generated_document üretim hattı belgesini incelemeye alamaz');
  perform t.raises(format('update public.generated_documents set status = ''published'' where id = %L', t.v('D1')),
                   'OGR-DOC-006%', 'doğrudan yazım da yayın kapısından geçemez');
  perform t.raises(format('select public.document_set_status(%L, ''ready'', %L::jsonb)', t.v('D1'), jsonb_build_object('verification', v_all)),
                   'OGR-DOC-008%', 'AST ve PDF yokken ready olmaz');
  perform t.raises(format('select public.document_set_status(%L, ''review'', %L::jsonb)', t.v('D1'), jsonb_build_object('verification', v_all)),
                   'OGR-DOC-008%', 'AST ve PDF yokken review olmaz');
  perform public.register_generated_document(jsonb_build_object('id', t.v('D1'), 'content', v_ast,
                                                                'pdf_path', 'notes/' || t.v('A') || '/' || t.v('D1') || '.pdf'));
  v_s := public.document_set_status(t.u('D1'), 'ready', jsonb_build_object('verification', v_all, 'personalization', '{"pattern_ids": ["t.a.isaret-hatasi"]}'::jsonb));
  perform t.ok(v_s ->> 'status' = 'ready' and v_s ->> 'document_status' = 'published', 'ready: belge published');
  perform t.raises(format('select public.document_set_status(%L, ''generating'')', t.v('D1')), 'OGR-DOC-006%', 'hazır belgenin durumu değişmez');
  perform t.as_admin();
  perform t.ok((select gd.published_at is not null and gd.personalization -> 'pattern_ids' = '["t.a.isaret-hatasi"]'
                  from public.generated_documents gd where gd.id = t.u('D1'))
               and (select dr.status = 'ready' and dr.error is null from public.document_requests dr where dr.id = t.u('R1')),
               'yayında published_at, istek ready');
  select s.* into v_card from public.suggestions s where s.student_id = t.u('A') and s.kind = 'document_ready' and s.consumed_at is null;
  perform t.ok(v_card.title = 'Rasyonel sayılar notun hazır' and v_card.subtitle = 'PDF · aç ve indir' and v_card.enrollment_id = t.u('EA')
               and v_card.payload ->> 'copy_key' = 'document:' || t.v('D1') and v_card.payload ->> 'document_id' = t.v('D1')
               and v_card.rank = 60 and v_card.expires_at > now() + interval '6 days',
               'Bugün kartı: "Rasyonel sayılar notun hazır · PDF" (copy_key document:<id>)');
  perform t.ok((select count(*) from public.notifications n where n.recipient_id = t.u('elif') and n.kind = 'document_ready'
                   and n.title = 'Rasyonel sayılar notun hazır' and n.payload ->> 'url' = '/ogrenci/belge/' || t.v('D1')) = 1,
               'öğrenciye document_ready bildirimi');
  perform t.ok(position('!' in v_card.title || coalesce(v_card.subtitle, '')) = 0
               and (select bool_and(position('!' in n.title || coalesce(n.body, '')) = 0) from public.notifications n where n.kind = 'document_ready'),
               'kart ve bildirimde ünlem yok');
  -- veli hazır isteği yalnız kısaltılmış görünümle görür; satırı (kapsam, hata, sohbet mesajı) RLS ile okumaz
  perform t.ok(t.sees(t.u('parent'), 'select 1 from public.document_requests') = 0, 'veli istek satırını okumaz (hazır olsa da)');
  perform t.as_user(t.u('parent'));
  v_s := public.document_request_view(t.u('R1'));
  perform t.ok(v_s ->> 'status' = 'ready' and v_s ->> 'title' = 'Rasyonel sayılar' and not v_s ? 'spec' and not v_s ? 'document',
               'veli görünümü kısaltılmış: kapsam ve belge yolu yok');
  perform t.ok(t.n(format('select 1 from public.generated_documents where id = %L', t.v('D1'))) = 0, 'veli notu RLS ile okuyamaz');
  perform t.as_user(t.u('elif'));
  v_s := public.document_request_view(t.u('R1'));
  perform t.ok(v_s ->> 'status_line' = 'Hazır' and v_s -> 'document' ->> 'pdf_path' like 'notes/%' and v_s -> 'document' ->> 'published_at' is not null,
               'öğrenci görünümü: hazır, PDF yolu');
  perform t.as_admin();
end $$;

-- inceleme kapısı: kişisel belge incelemeye yükseltilir → öğrenciden gizli; ret
do $$
declare
  v_doc uuid;
  v_req uuid;
  v_l jsonb;
  v_s jsonb;
  v_all jsonb := '{"schema": {"status": "pass"}, "sympy": {"status": "pass"}, "figures": {"status": "skipped"},
                   "duplicates": {"status": "pass"}, "personalization": {"status": "pass"}}';
begin
  select dr.generated_document_id, dr.id into v_doc, v_req from public.document_requests dr
   where dr.student_id = t.u('A') and dr.spec ->> 'topic' = 'Üslü sayılar';
  insert into t.cfg values ('D4', v_doc::text), ('R4', v_req::text);
  perform t.as_service();
  perform public.register_generated_document(jsonb_build_object('id', v_doc, 'pdf_path', 'notes/' || t.v('A') || '/' || v_doc || '.pdf',
    'content', '{"kind": "notes", "title": "Üslü sayılar", "meta": {}, "sections": [], "blocks": [{"type": "paragraph", "id": "p1", "section_no": 0, "text": "x"}], "keys": []}'::jsonb));
  v_s := public.document_set_status(v_doc, 'ready', jsonb_build_object('verification', v_all, 'review_required', true));
  perform t.ok(v_s ->> 'status' = 'review' and v_s ->> 'document_status' = 'review' and (v_s ->> 'review_required')::boolean
               and v_s -> 'verification' -> 'review' ->> 'status' = 'pending', 'incelemeli belge ready yerine review');
  perform t.raises(format('select public.document_set_status(%L, ''ready'', %L::jsonb)', v_doc, jsonb_build_object('verification', v_all)),
                   'OGR-DOC-006%', 'incelemedeki belgeyi worker yayımlayamaz');
  perform t.raises(format('select public.register_generated_document(%L::jsonb)', jsonb_build_object('id', v_doc, 'status', 'published')),
                   'OGR-DOC-007%', 'yayın kapısı: onaysız published yazılamaz');
  perform t.as_admin();
  perform t.ok((select count(*) from public.notifications n where n.recipient_id = t.u('inst') and n.kind = 'document_review'
                   and n.payload ->> 'document_id' = v_doc::text) = 1, 'owner eğitmene document_review bildirimi');
  perform t.ok(t.sees(t.u('elif'), format('select 1 from public.generated_documents where id = %L', v_doc)) = 0,
               'inceleme bekleyen belge öğrenciye RLS ile görünmez');
  perform t.ok(t.sees(t.u('inst'), format('select 1 from public.generated_documents where id = %L', v_doc)) = 1, 'eğitmen görür');
  perform t.as_user(t.u('elif'));
  v_l := public.list_my_documents('notes');
  perform t.ok((select d.e ->> 'pdf_path' is null and d.e ->> 'request_status' = 'review' and (d.e ->> 'review_required')::boolean
                  from jsonb_array_elements(v_l -> 'documents') as d (e) where d.e ->> 'id' = v_doc::text),
               'Belgelerim: incelemedeki belge yolsuz, istek durumu review');
  perform t.ok(public.document_request_view(v_req) ->> 'status_line' = 'Hocan inceliyor'
               and public.document_request_view(v_req) -> 'document' ->> 'pdf_path' is null, 'öğrenci görünümü: Hocan inceliyor, yol yok');
  perform t.raises(format('select public.review_document(%L, ''approve'')', v_doc), 'OGR-AUTH-002%', 'öğrenci kendi belgesini onaylayamaz');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.review_document(%L, ''approve'')', v_doc), 'OGR-AUTH-002%', 'bağsız eğitmen onaylayamaz');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.review_document(%L, ''maybe'')', v_doc), 'OGR-DOC-005%', 'geçersiz karar');
  v_s := public.review_document(v_doc, 'reject', 'Örnekler müfredat dışı');
  perform t.ok(v_s ->> 'document_status' = 'failed' and v_s -> 'request' ->> 'status' = 'failed', 'ret: belge ve istek failed');
  perform t.raises(format('select public.review_document(%L, ''approve'')', v_doc), 'OGR-DOC-006%', 'incelemede olmayan belge');
  perform t.as_admin();
  perform t.ok((select gd.reviewed_by = t.u('inst') and gd.review_note = 'Örnekler müfredat dışı' and gd.verification -> 'review' ->> 'status' = 'fail' and not (gd.verification -> 'review' ? 'note')
                  from public.generated_documents gd where gd.id = v_doc)
               and (select dr.error = 'review_rejected' from public.document_requests dr where dr.id = v_req)
               and not exists (select 1 from public.suggestions s where s.payload ->> 'document_id' = v_doc::text),
               'ret izi; kart yok');
  perform t.ok(not exists (select 1 from public.notifications n where n.kind = 'document_review' and n.read_at is null
                            and n.payload ->> 'document_id' = v_doc::text), 'inceleme bildirimi okundu sayılır');
end $$;

-- ders geneli belge: incelemeli; onay → kayıtlı öğrencilere kart
do $$
declare
  v_r jsonb;
  v_doc uuid;
  v_s jsonb;
  v_all jsonb := '{"schema": {"status": "pass"}, "sympy": {"status": "pass"}, "figures": {"status": "pass"},
                   "duplicates": {"status": "pass"}, "personalization": {"status": "skipped"}}';
begin
  perform t.as_user(t.u('inst'));
  v_r := public.request_document('notes', jsonb_build_object('course_id', t.v('course'), 'topic', 'Bölünebilme', 'include_my_mistakes', true), 'instructor');
  v_doc := (v_r -> 'document' ->> 'id')::uuid;
  perform t.ok(v_r ->> 'student_id' is null and v_r ->> 'enrollment_id' is null and (v_r -> 'document' ->> 'review_required')::boolean
               and not (v_r -> 'spec' ->> 'include_my_mistakes')::boolean and (v_r -> 'spec' ->> 'review')::boolean,
               'ders geneli istek: öğrencisiz, incelemeli, kişisel hata yok');
  perform t.as_admin();
  perform t.ok(t.sees(t.u('elif'), format('select 1 from public.document_requests where id = %L', v_r ->> 'request_id')) = 0
               and t.sees(t.u('inst'), format('select 1 from public.document_requests where id = %L', v_r ->> 'request_id')) = 1,
               'ders geneli istek öğrenciye görünmez, eğitmene görünür');
  perform t.ok(t.sees(t.u('inst2'), format('select 1 from public.document_requests where id = %L', v_r ->> 'request_id')) = 0
               and t.sees(t.u('inst2'), format('select 1 from public.generated_documents where id = %L', v_doc)) = 0,
               'dersin eğitmeni olmayan personel onaysız ders taslağını (istek ve belge) görmez');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.document_request_view(%L)', v_r ->> 'request_id'), 'OGR-AUTH-001%', 'dersin eğitmeni olmayan görünümü açamaz');
  perform t.as_admin();
  perform t.as_service();
  perform public.register_generated_document(jsonb_build_object('id', v_doc, 'pdf_path', 'course/' || v_doc || '.pdf',
    'content', '{"kind": "notes", "title": "Bölünebilme", "meta": {}, "sections": [], "blocks": [{"type": "paragraph", "id": "p1", "section_no": 0, "text": "x"}], "keys": []}'::jsonb));
  v_s := public.document_set_status(v_doc, 'ready', jsonb_build_object('verification', v_all));
  perform t.ok(v_s ->> 'status' = 'review', 'ders geneli belge incelemeye gider');
  -- onay öncesi yeniden denetim: PDF'i kaybolmuş belge onaylanamaz
  perform t.as_admin();
  update public.generated_documents gd set pdf_path = null where gd.id = v_doc;
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.review_document(%L, ''approve'')', v_doc), 'OGR-DOC-008%', 'PDF''siz belge onaylanamaz');
  perform t.as_admin();
  update public.generated_documents gd set pdf_path = 'course/' || v_doc || '.pdf' where gd.id = v_doc;
  perform t.as_user(t.u('elif'));
  perform t.ok(not exists (select 1 from jsonb_array_elements(public.list_my_documents() -> 'documents') as d (e) where d.e ->> 'id' = v_doc::text),
               'onaysız ders belgesi Belgelerim''de yok');
  perform t.as_user(t.u('inst'));
  v_s := public.review_document(v_doc, 'approve', 'Uygun');
  perform t.ok(v_s ->> 'document_status' = 'published' and v_s -> 'request' ->> 'status' = 'ready', 'onay: published, istek ready');
  perform t.as_admin();
  perform t.ok((select count(*) from public.suggestions s where s.kind = 'document_ready' and s.payload ->> 'document_id' = v_doc::text
                   and s.title = 'Bölünebilme notu hazır' and s.student_id in (t.u('A'), t.u('B'), t.u('C'))) = 3
               and (select count(*) from public.notifications n where n.kind = 'document_ready' and n.payload ->> 'document_id' = v_doc::text) = 3,
               'dersin etkin kayıtlı üç öğrencisine kart ve bildirim');
  perform t.as_user(t.u('can'));
  perform t.ok(exists (select 1 from jsonb_array_elements(public.list_my_documents() -> 'documents') as d (e)
                        where d.e ->> 'id' = v_doc::text and d.e ->> 'pdf_path' is not null and d.e ->> 'scope' = 'course'),
               'onaylı ders belgesi Belgelerim''de, yolu açık');
  perform t.ok(t.n(format('select 1 from public.generated_documents where id = %L', v_doc)) = 1, 'öğrenci RLS ile okur');
  perform t.as_admin();
end $$;

-- üretim hattı belgesi yayımlanana dek öğrenciden gizli (satır, içerik, PDF yolu, Belgelerim, istek görünümü). Eğitmeni olmayan
-- öğrenci (Deniz) incelemeye düşünce belge admine bildirilir ve istek "Son kontrolden geçiyor" gösterir.
do $$
declare
  v_r jsonb;
  v_s jsonb;
  v_l jsonb;
  v_doc uuid;
  v_all jsonb := '{"schema": {"status": "pass"}, "sympy": {"status": "pass"}, "figures": {"status": "skipped"},
                   "duplicates": {"status": "pass"}, "personalization": {"status": "pass"}}';
  v_ast jsonb := '{"kind": "notes", "title": "Kesirler", "meta": {}, "sections": [], "blocks": [{"type": "paragraph", "id": "p1", "section_no": 0, "text": "x"}], "keys": []}';
begin
  perform t.as_user(t.u('deniz'));
  v_r := public.request_document('notes', '{"topic": "Kesirler"}');
  v_doc := (v_r -> 'document' ->> 'id')::uuid;
  perform t.as_admin();
  insert into t.cfg values ('DZ', v_doc::text), ('RZ', v_r ->> 'request_id');
  perform t.as_service();
  perform public.document_set_status(v_doc, 'generating');
  perform public.register_generated_document(jsonb_build_object('id', v_doc, 'content', v_ast,
                                                                'pdf_path', 'notes/' || t.v('C') || '/' || v_doc || '.pdf'));
  perform t.as_user(t.u('deniz'));
  perform t.ok(t.n(format('select 1 from public.generated_documents where id = %L', v_doc)) = 0
               and t.n(format('select 1 from public.generated_documents where id = %L and content is not null', v_doc)) = 0,
               'üretilmekte olan kendi belgesinin satırı ve içeriği öğrenciye görünmez');
  perform t.ok(exists (select 1 from jsonb_array_elements(public.list_my_documents('notes') -> 'documents') as d (e)
                        where d.e ->> 'id' = v_doc::text and d.e ->> 'pdf_path' is null),
               'Belgelerim: üretilmekte olan belgenin yolu yok');
  perform t.ok(public.document_request_view(t.u('RZ')) ->> 'status_line' = 'Hazırlıyorum'
               and public.document_request_view(t.u('RZ')) -> 'document' ->> 'pdf_path' is null, 'istek görünümü: Hazırlıyorum, yol yok');
  perform t.as_service();
  v_s := public.document_set_status(v_doc, 'ready', jsonb_build_object('verification', v_all, 'review_required', true));
  perform t.ok(v_s ->> 'status' = 'review', 'eğitmeni olmayan öğrencinin incelemeli belgesi incelemeye gider');
  perform t.as_admin();
  perform t.ok((select count(*) from public.notifications n where n.recipient_id = t.u('admin') and n.kind = 'document_review'
                   and n.payload ->> 'document_id' = v_doc::text) = 1, 'eğitmensiz öğrencinin incelemesi admine bildirilir');
  perform t.as_user(t.u('deniz'));
  v_l := public.document_request_view(t.u('RZ'));
  perform t.ok(v_l ->> 'status_line' = 'Son kontrolden geçiyor' and v_l -> 'document' ->> 'pdf_path' is null,
               'eğitmensiz incelemede "Son kontrolden geçiyor", yol yok');
  perform t.ok(t.n(format('select 1 from public.generated_documents where id = %L', v_doc)) = 0, 'incelemedeki belge öğrenciye görünmez');
  perform t.as_service();
  perform public.document_set_status(v_doc, 'failed', '{"error": "model hatası"}');
  perform t.as_user(t.u('deniz'));
  perform t.ok(t.n(format('select 1 from public.generated_documents where id = %L and (content is not null or pdf_path is not null)', v_doc)) = 0,
               'başarısız belgenin içeriği ve PDF yolu öğrenciye görünmez');
  perform t.ok(exists (select 1 from jsonb_array_elements(public.list_my_documents('notes') -> 'documents') as d (e)
                        where d.e ->> 'id' = v_doc::text and d.e ->> 'pdf_path' is null and d.e ->> 'request_status' = 'failed'),
               'Belgelerim: başarısız belge yolsuz');
  perform t.ok(public.document_request_view(t.u('RZ')) ->> 'status_line' = 'Hazırlayamadım; tekrar isteyebilirsin'
               and public.document_request_view(t.u('RZ')) -> 'document' ->> 'pdf_path' is null, 'başarısız istek görünümü yolsuz');
  perform t.as_admin();
end $$;

-- blok yeniden üretim kaydı
do $$
declare
  v_n jsonb;
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.document_block_regen_note(%L, ''b2'', ''personalization'', ''x'')', t.v('D3')), 'OGR-AUTH-002%',
                   'öğrenci yeniden üretim kaydı yazamaz');
  perform t.as_service();
  perform t.raises(format('select public.document_block_regen_note(%L, ''b2'', ''style'', ''x'')', t.v('D3')), 'OGR-DOC-009%', 'geçersiz basamak');
  perform t.raises(format('select public.document_block_regen_note(%L, '''', ''sympy'', ''x'')', t.v('D3')), 'OGR-DOC-009%', 'boş blok kimliği');
  perform t.raises(format('select public.document_block_regen_note(%L, ''b2'', ''sympy'', ''  '')', t.v('D3')), 'OGR-DOC-009%', 'boş neden');
  v_n := public.document_block_regen_note(t.u('D3'), 'q4', 'sympy', 'Anahtar SymPy ile tutmadı');
  perform t.ok((v_n ->> 'attempts')::int = 1 and (v_n ->> 'remaining')::int = 1 and (v_n ->> 'max')::int = 2, 'ilk deneme: kalan 1');
  perform public.document_block_regen_note(t.u('D3'), 'f1', 'figures', 'Şekil boş');
  v_n := public.document_block_regen_note(t.u('D3'), 'q4', 'sympy', 'Yine tutmadı');
  perform t.ok((v_n ->> 'attempts')::int = 2 and (v_n ->> 'remaining')::int = 0, 'ikinci deneme: hak bitti');
  perform t.as_admin();
  perform t.ok((select jsonb_array_length(gd.verification -> 'regen') = 3
                       and gd.verification -> 'regen' -> 2 ->> 'block_id' = 'q4' and (gd.verification -> 'regen' -> 2 ->> 'attempt')::int = 2
                  from public.generated_documents gd where gd.id = t.u('D3')), 'verification.regen[] kaydı');
end $$;

-- kişiselleştirme girdisi
do $$
declare
  v_p jsonb;
begin
  insert into public.memory_files (student_id, path, content) values
    (t.u('A'), '/memories/patterns.md', E'# Örüntüler\n- Parantez önündeki eksiyi dağıtırken işaret kaçıyor · t.mat.a · 3× · 12 Eki, 19 Eki, 27 Eki\n- Kesirleri toplarken paydaları da topluyor · t.mat.b · 2× · 3 Kas, 5 Kas\n'),
    (t.u('A'), '/memories/courses/T-MAT-TEST.md', 'Hoca işlem önceliğini vurguladı.');
  insert into public.misconceptions (enrollment_id, curriculum_id, skill_id, tag, text_instructor, text_student, status, evidence_count)
  values (t.u('EA'), t.u('cur'), 't.mat.a', 't.a.isaret-hatasi', 'Eksiyi dağıtırken işareti kaçırıyor.',
          'Eksiyi parantezin içine dağıtırken her terimin işaretine bak.', 'open', 3);
  insert into public.misconceptions (enrollment_id, curriculum_id, skill_id, tag, text_instructor, text_student, status, evidence_count)
  values (t.u('EA'), t.u('cur'), 't.mat.b', null, 'Eğitmen onayı bekliyor.', 'Onaysız yanılgı metni', 'pending_review', 2);
  insert into public.solution_analyses (enrollment_id, analysis, verdict, error_cause, skill_ids, misconception_tags, failing_step_no, question_text)
  values (t.u('EA'), '{"one_line": "2. adımda eksi parantezin içine dağıtılmamış."}', 'wrong', 'procedure', array['t.mat.a'],
          array['t.a.isaret-hatasi'], 2, '-3(x-2) ifadesini açınız.'),
         (t.u('EB'), '{"one_line": "Can''ın teşhisi"}', 'wrong', 'concept', array['t.mat.a'], '{}', 1, 'Başka');
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.student_patterns_for_prompt(%L, %L)', t.v('A'), t.v('course')), 'OGR-AUTH-002%', 'öğrenci okuyamaz');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.student_patterns_for_prompt(%L, %L)', t.v('A'), t.v('course')), 'OGR-AUTH-002%', 'eğitmen de okuyamaz (worker yolu)');
  perform t.as_service();
  v_p := public.student_patterns_for_prompt(t.u('A'), t.u('course'));
  perform t.as_admin();
  perform t.ok((v_p -> 'patterns' ->> 'exists')::boolean and jsonb_array_length(v_p -> 'patterns' -> 'lines') = 2
               and v_p -> 'patterns' -> 'lines' -> 0 ->> 'pattern_id' = 'patterns.md:2'
               and v_p -> 'patterns' -> 'lines' -> 0 ->> 'text' like 'Parantez önündeki eksiyi%',
               'patterns.md satırları (başlık satırı hariç, satır numaralı kimlik patterns.md:<n>)');
  perform t.ok(not (v_p ? 'course_memory') and not (v_p -> 'patterns' ? 'content') and not (v_p ? 'error_causes_30d'),
               'veri minimizasyonu: ders hafızası, patterns.md içeriği ve neden sayımı worker''a gitmez');
  perform t.ok(jsonb_array_length(v_p -> 'misconceptions') = 1 and v_p -> 'misconceptions' -> 0 ->> 'pattern_id' = 't.a.isaret-hatasi'
               and not ((v_p -> 'misconceptions' -> 0) ? 'text_instructor')
               and not exists (select 1 from jsonb_array_elements(v_p -> 'misconceptions') as m (e) where m.e ->> 'text_student' = 'Onaysız yanılgı metni')
               and v_p -> 'misconceptions' -> 0 ->> 'skill_name' = 'İşlem önceliği', 'açık yanılgı (etiket kimliği, kazanım adı)');
  perform t.ok(jsonb_array_length(v_p -> 'recent_analyses') = 1 and v_p -> 'recent_analyses' -> 0 ->> 'one_line' like '2. adımda%'
               and v_p -> 'recent_analyses' -> 0 ->> 'date_tr' ~ '^[0-9]{1,2} [A-ZÇŞÖÜİ][a-zğüşöçı]{2}$'
               and not (v_p -> 'recent_analyses' -> 0 ? 'question_excerpt'), 'yalnız bu öğrencinin son hatalı teşhisi; Türkçe tarih; soru metni yok');
  perform t.ok(v_p -> 'pattern_ids' @> '["patterns.md:2", "patterns.md:3", "t.a.isaret-hatasi"]'::jsonb
               and v_p -> 'pattern_ids' @> jsonb_build_array(v_p -> 'recent_analyses' -> 0 ->> 'id')
               and jsonb_array_length(v_p -> 'pattern_ids') = 4, 'izinli pattern_id kümesi (teşhis kimliği dahil)');
  perform t.ok(jsonb_array_length(v_p -> 'known_patterns') = 4
               and v_p -> 'known_patterns' -> 0 ->> 'source' = 'patterns.md' and v_p -> 'known_patterns' -> 0 ->> 'id' = 'patterns.md:2'
               and jsonb_array_length(v_p -> 'known_patterns' -> 0 -> 'dates') = 3
               and (v_p -> 'known_patterns' -> 0 -> 'dates' ->> 0) ~ '^[0-9]{4}-10-12$'
               and (v_p -> 'known_patterns' -> 0 -> 'dates' ->> 0)::date <= (now() at time zone 'Europe/Istanbul')::date
               and exists (select 1 from jsonb_array_elements(v_p -> 'known_patterns') as k (e)
                            where k.e ->> 'source' = 'misconception' and k.e ->> 'id' = 't.a.isaret-hatasi'
                              and k.e -> 'dates' @> jsonb_build_array(to_char(now() at time zone 'Europe/Istanbul', 'YYYY-MM-DD')))
               and exists (select 1 from jsonb_array_elements(v_p -> 'known_patterns') as k (e) where k.e ->> 'source' = 'analysis'),
               'known_patterns {source, id, dates}: patterns.md satır tarihleri (12 Eki → geçmiş yıl-10-12), yanılgı ve teşhis günleri');
end $$;

-- aynı sohbet turunda not + deneme: tür başına ayrı istek, aynı tür yine reused
do $$
declare
  v_a jsonb;
  v_b jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_a := public.request_document('mock_exam', '{"question_count": 10}', 'chat', t.v('MA')::bigint);
  v_b := public.request_document('mock_exam', '{"question_count": 12}', 'chat', t.v('MA')::bigint);
  perform t.as_admin();
  perform t.ok(v_a ->> 'kind' = 'mock_exam' and not (v_a ->> 'reused')::boolean and v_a ->> 'request_id' <> t.v('R1'),
               'aynı mesajdan deneme ayrı istek (not isteği dönmez)');
  perform t.ok(v_b ->> 'request_id' = v_a ->> 'request_id' and (v_b ->> 'reused')::boolean, 'aynı mesaj + aynı tür → reused');
  perform t.ok((select count(*) from public.document_requests dr where dr.conversation_message_id = t.v('MA')::bigint) = 2,
               'mesaj başına tür başına bir istek');
end $$;

rollback;
