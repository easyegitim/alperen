-- 0032_documents.sql — üretilen belgelerin kayıt yolu ve "Belgelerim" listesi (docs/PLAN-v2.md §13 Belgeler, §8 rapor;
-- docs/PLAN-v2-detail.md §2 generated_documents, §4 belge AST).
--   register_generated_document(p_doc)  worker: belge satırını açar ya da günceller (AST, HTML/PDF yolu, durum,
--                                       doğrulama); kind='report' + exam_session_id deneme oturumuna bağlar ve rapor
--                                       hazırsa (rendered/published) oturumu 'done' yapar.
--   list_my_documents(p_kind, p_student, p_limit)  öğrenci: kendi belgeleri + kayıtlı derslerinin yayımlanmış ders geneli
--                                       belgeleri; veli: çocuklarının hazır raporları; anahtar belgesi hiç listelenmez.

create or replace function public.register_generated_document(p_doc jsonb) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_old public.generated_documents%rowtype;
  v_kind text;
  v_status text;
  v_student uuid;
  v_course uuid;
  v_sess public.exam_sessions%rowtype;
  v_sess_student uuid;
  v_path text;
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 belge kaydını yalnız worker yazar';
  end if;
  if coalesce(jsonb_typeof(p_doc), '') <> 'object' then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-001 girdi nesne olmalı';
  end if;
  v_id := nullif(p_doc ->> 'id', '')::uuid;
  if v_id is not null then
    select gd.* into v_old from public.generated_documents gd where gd.id = v_id for update;
    if not found then
      raise exception using errcode = 'P0001', message = format('OGR-DOC-001 belge bulunamadı %s', v_id);
    end if;
  end if;
  v_kind := coalesce(nullif(p_doc ->> 'kind', ''), v_old.kind);
  if v_kind is null or v_kind not in ('notes', 'mock_exam', 'report', 'question_set', 'answer_key')
     or (v_old.id is not null and v_kind <> v_old.kind) then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-001 geçersiz ya da değişen belge türü %s', coalesce(v_kind, '(boş)'));
  end if;
  v_status := coalesce(nullif(p_doc ->> 'status', ''), v_old.status, 'queued');
  if v_status not in ('queued', 'generating', 'rendered', 'review', 'published', 'failed') then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-001 geçersiz durum %s', v_status);
  end if;
  if coalesce(nullif(btrim(coalesce(p_doc ->> 'title', v_old.title)), ''), '') = '' then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-001 başlık gerekli';
  end if;
  if (p_doc ? 'content') and jsonb_typeof(p_doc -> 'content') <> 'null'
     and (jsonb_typeof(p_doc -> 'content') <> 'object'
          or (v_kind <> 'answer_key' and coalesce(p_doc -> 'content' -> 'keys', '[]'::jsonb) <> '[]'::jsonb)) then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-002 belge AST''si nesne olmalı; anahtar yalnız answer_key belgesinde';
  end if;
  foreach v_path in array array[p_doc ->> 'html_path', p_doc ->> 'pdf_path'] loop
    if v_path is not null and (v_path !~ '^[^/]+(/[^/]+)+$' or v_path ~ '(^|/)\.{1,2}(/|$)') then
      raise exception using errcode = 'P0001', message = format('OGR-DOC-001 geçersiz Storage yolu %s', left(v_path, 120));
    end if;
  end loop;
  v_student := coalesce(nullif(p_doc ->> 'student_id', '')::uuid, v_old.student_id);
  v_course := coalesce(nullif(p_doc ->> 'course_id', '')::uuid, v_old.course_id);

  if nullif(p_doc ->> 'exam_session_id', '') is not null then
    select es.* into v_sess from public.exam_sessions es where es.id = (p_doc ->> 'exam_session_id')::uuid for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-003 exam_session_id bulunamadı';
    end if;
    v_sess_student := app.student_of_enrollment(v_sess.enrollment_id);
    if v_kind <> 'report' or (v_student is not null and v_student <> v_sess_student) then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-003 deneme oturumuna yalnız aynı öğrencinin raporu bağlanır';
    end if;
    v_student := v_sess_student;
    v_course := coalesce(v_course, (select e.course_id from public.enrollments e where e.id = v_sess.enrollment_id));
  elsif v_old.id is not null then
    -- güncellemede bağlı oturum report_document_id'den bulunur
    select es.* into v_sess from public.exam_sessions es where es.report_document_id = v_old.id
     order by es.created_at desc limit 1 for update;
  end if;

  if v_old.id is null then
    insert into public.generated_documents (student_id, course_id, kind, title, spec, content, html_path, pdf_path, status,
                                            personalization, verification, model, cost_usd, created_by)
    values (v_student, v_course, v_kind, btrim(p_doc ->> 'title'), coalesce(p_doc -> 'spec', '{}'::jsonb), p_doc -> 'content',
            p_doc ->> 'html_path', p_doc ->> 'pdf_path', v_status, p_doc -> 'personalization', p_doc -> 'verification',
            p_doc ->> 'model', coalesce((p_doc ->> 'cost_usd')::numeric, 0), nullif(p_doc ->> 'created_by', '')::uuid)
    returning id into v_id;
  else
    update public.generated_documents gd
       set student_id = v_student,
           course_id = v_course,
           title = coalesce(nullif(btrim(p_doc ->> 'title'), ''), gd.title),
           spec = coalesce(p_doc -> 'spec', gd.spec),
           content = case when p_doc ? 'content' then p_doc -> 'content' else gd.content end,
           html_path = coalesce(p_doc ->> 'html_path', gd.html_path),
           pdf_path = coalesce(p_doc ->> 'pdf_path', gd.pdf_path),
           status = v_status,
           personalization = coalesce(p_doc -> 'personalization', gd.personalization),
           verification = coalesce(p_doc -> 'verification', gd.verification),
           model = coalesce(p_doc ->> 'model', gd.model),
           cost_usd = gd.cost_usd + coalesce((p_doc ->> 'cost_usd')::numeric, 0),
           version = gd.version + case when gd.pdf_path is not null and p_doc ->> 'pdf_path' is not null
                                            and p_doc ->> 'pdf_path' <> gd.pdf_path then 1 else 0 end
     where gd.id = v_id;
  end if;

  if v_sess.id is not null then
    update public.exam_sessions es
       set report_document_id = v_id,
           status = case when v_status in ('rendered', 'published') and es.status = 'analysing' then 'done' else es.status end,
           progress = es.progress || jsonb_build_object('stage', case when v_status in ('rendered', 'published') then 'done'
                                                                      when v_status = 'failed' then coalesce(es.progress ->> 'stage', 'report')
                                                                      else 'report' end,
                                                        'report_status', v_status, 'updated_at', now())
     where es.id = v_sess.id;
  end if;
  return v_id;
end
$$;
comment on function public.register_generated_document(jsonb) is 'Worker: generated_documents aç/güncelle (AST anahtarsız, Storage yolları, durum, sürüm); rapor deneme oturumuna bağlanır, hazırsa oturum done.';

create or replace function public.list_my_documents(p_kind text default null, p_student uuid default null, p_limit int default 50) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_me uuid := app.my_student_id();
  v_role text := app.role();
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_students uuid[];
  v_parent boolean := false;
  v_docs jsonb;
begin
  if p_kind is not null and p_kind not in ('notes', 'mock_exam', 'report', 'question_set') then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-001 geçersiz belge türü %s', p_kind);
  end if;
  if v_me is not null and (p_student is null or p_student = v_me) then
    v_students := array[v_me];
  elsif v_role = 'parent' then
    v_parent := true;
    v_students := array(select c.sid from app.my_children() as c (sid) where p_student is null or c.sid = p_student);
    if p_student is not null and cardinality(v_students) = 0 then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 veli yalnız çocuğunun belgelerini görür';
    end if;
  elsif p_student is not null and (app.is_trusted() or app.can_read_student_data(p_student)) then
    v_students := array[p_student];
  else
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 belge listesi öğrenci ya da veli içindir';
  end if;

  select coalesce(jsonb_agg(z.doc order by z.created_at desc, z.id), '[]'::jsonb) into v_docs
    from (select gd.id, gd.created_at,
                 jsonb_build_object('id', gd.id, 'kind', gd.kind, 'title', gd.title, 'status', gd.status, 'version', gd.version,
                                    'pdf_path', gd.pdf_path, 'html_path', gd.html_path, 'student_id', gd.student_id,
                                    'course_id', gd.course_id, 'course_title', co.title,
                                    'scope', case when gd.student_id is null then 'course' else 'personal' end,
                                    'exam_session_id', (select es.id from public.exam_sessions es where es.report_document_id = gd.id
                                                         order by es.created_at desc limit 1),
                                    'created_at', gd.created_at, 'updated_at', gd.updated_at) as doc
            from public.generated_documents gd
            left join public.courses co on co.id = gd.course_id
           where gd.kind <> 'answer_key'
             and (p_kind is null or gd.kind = p_kind)
             and ((not v_parent and gd.student_id = any(v_students))
                  or (v_parent and gd.kind = 'report' and gd.student_id = any(v_students) and gd.status in ('rendered', 'published'))
                  or (not v_parent and gd.student_id is null and gd.status = 'published'
                      and exists (select 1 from public.enrollments e
                                   where e.student_id = any(v_students) and e.status = 'active' and e.course_id = gd.course_id)))
           order by gd.created_at desc, gd.id
           limit v_limit) as z;
  return jsonb_build_object('documents', v_docs, 'count', jsonb_array_length(v_docs));
end
$$;
comment on function public.list_my_documents(text, uuid, int) is 'Belgelerim: öğrenci kendi + kayıtlı dersinin yayımlanmış ders geneli belgeleri; veli çocuklarının hazır raporları; answer_key asla.';

revoke all on function public.register_generated_document(jsonb), public.list_my_documents(text, uuid, int) from public, anon;
-- register_generated_document authenticated'a açıktır ama gövde app.is_trusted() ister (açık OGR-AUTH-002)
grant execute on function public.register_generated_document(jsonb), public.list_my_documents(text, uuid, int) to authenticated, service_role;
