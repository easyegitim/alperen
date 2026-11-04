-- 0035_document_pipeline.sql — içerik stüdyosu (P3) RPC'leri: worker durum geçişleri ve doğrulama merdiveni, blok
-- yeniden üretim kaydı, eğitmen incelemesi, belgeden uygulama içi deneme, not kişiselleştirme girdisi
-- (docs/PLAN-v2.md §2 Akış 5, §7; docs/PLAN-v2-detail.md §4).
--   document_set_status(p_document, p_status, p_patch)   worker: generating → verifying → ready | review | failed;
--                                       'ready' ve 'review' doğrulama merdiveni tam (schema, sympy, figures, duplicates,
--                                       personalization: pass | skipped), AST + PDF var ve denemenin sınavı kurulmuşsa
--                                       geçer; incelemeli belge 'review'a döner (eğitmene bildirim).
--   document_block_regen_note(p_document, p_block_id, p_step, p_reason, p_attempt)   worker: hatalı bloğun yeniden üretim
--                                       kaydı (verification.regen[]); blok başına sınır settings.documents_block_regen_max.
--   review_document(p_id, p_decision, p_note)   eğitmen: approve → published + Bugün 'document_ready' kartı + bildirim;
--                                       reject → failed.
--   mock_exam_from_document(p_document, p_keys)   worker: belge AST'sinin soruları → exams(kind practice, source
--                                       generated, telifsiz) + exam_questions + secure.exam_answer_keys (set_exam_keys,
--                                       source generated). Anahtarlar AST'de saklanmaz (0010 generated_documents_no_keys):
--                                       worker splitDocumentKeys(doc).keys'i p_keys olarak verir. Öğrenci "Çöz" →
--                                       start_exam_session(p_exam).
--   student_patterns_for_prompt(p_student, p_course)   worker: notun "Senin sık yaptığın hata" kutuları için patterns.md
--                                       satırları, açık yanılgılar, son hatalı teşhisler ve izinli pattern_id kümesi.
--   list_my_documents (yeniden)         + review_required, published_at, request_id, request_status, exam_id; inceleme
--                                       bekleyen belgenin yolları öğrenciye gizli.
--   app.exam_visible, exams_select, start_exam_session (yeniden)   üretilmiş belgenin sınavı öğrenciye yalnız ready |
--                                       published iken görünür ve başlatılır (taslak = incelenmemiş üretilmiş soru).

-- --- yardımcılar ------------------------------------------------------------------------------------------------------

-- "3 Kas" (İstanbul saati)
create or replace function app.tr_short_date(p_at timestamptz) returns text
language plpgsql
stable
set search_path = pg_catalog, app
as $$
declare
  v_local timestamp := p_at at time zone 'Europe/Istanbul';
begin
  if p_at is null then
    return null;
  end if;
  return extract(day from v_local)::int || ' '
         || (array['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'])[extract(month from v_local)::int];
end
$$;
comment on function app.tr_short_date(timestamptz) is 'Kısa Türkçe tarih: "3 Kas" (İstanbul saati).';

-- Metindeki "12 Eki" biçimli tarihler → ['YYYY-AA-GG', …] (yıl: bugünden (İstanbul) sonraki tarih bir önceki yıla
-- düşer; geçersiz gün atlanır). patterns.md satırlarının gözlem günleri için.
create or replace function app.tr_dates_in_text(p_text text) returns jsonb
language plpgsql
stable
set search_path = pg_catalog, app
as $$
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_m text[];
  v_d date;
  v_out jsonb := '[]'::jsonb;
begin
  for v_m in select regexp_matches(coalesce(p_text, ''), '([0-9]{1,2}) (Oca|Şub|Mar|Nis|May|Haz|Tem|Ağu|Eyl|Eki|Kas|Ara)', 'g') loop
    begin
      v_d := make_date(extract(year from v_today)::int,
                       array_position(array['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'], v_m[2]),
                       v_m[1]::int);
    exception when others then
      continue;
    end;
    if v_d > v_today then
      v_d := (v_d - interval '1 year')::date;
    end if;
    if not v_out @> jsonb_build_array(to_char(v_d, 'YYYY-MM-DD')) then
      v_out := v_out || jsonb_build_array(to_char(v_d, 'YYYY-MM-DD'));
    end if;
  end loop;
  return v_out;
end
$$;
comment on function app.tr_dates_in_text(text) is 'Metindeki "12 Eki" biçimli tarihleri YYYY-AA-GG dizisine çevirir (gelecekteki tarih önceki yıla).';

-- Doğrulama merdiveninin basamakları (sıralı; docs/PLAN-v2.md §7). review ayrı: yalnız review_document yazar.
create or replace function app.document_ladder_steps() returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array['schema', 'sympy', 'figures', 'duplicates', 'personalization']
$$;
comment on function app.document_ladder_steps() is 'Doğrulama merdiveni basamakları: schema, sympy, figures, duplicates, personalization.';

-- Belgeyi inceleyebilir mi: admin; eğitmende kişisel belgenin öğrencisinin owner eğitmeni, ders geneli belgede dersin
-- eğitmeni (app.can_teach_course). Worker inceleyemez (insan kapısı).
create or replace function app.can_review_document(p_doc uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid;
  v_course uuid;
begin
  select gd.student_id, gd.course_id into v_student, v_course from public.generated_documents gd where gd.id = p_doc;
  if not found or auth.uid() is null then
    return false;
  end if;
  if app.is_admin() then
    return true;
  end if;
  if app.role() is distinct from 'instructor' then
    return false;
  end if;
  if v_student is not null then
    return exists (select 1 from public.instructor_links il
                    where il.instructor_id = auth.uid() and il.student_id = v_student and il.role = 'owner');
  end if;
  return app.can_teach_course(v_course);
end
$$;
comment on function app.can_review_document(uuid) is 'Belgeyi inceleyebilir mi: admin; kişisel belgede öğrencinin owner eğitmeni, ders genelinde dersin eğitmeni (worker değil).';

-- İncelemeye yetkili eğitmenler: öğrencinin owner eğitmeni (kişisel belge), dersin eğitmenleri (ders geneli belge). Admin dahil
-- değil; boş küme admin bildirimine düşer (document_notify_reviewers) ve istek "Son kontrolden geçiyor" gösterir.
create or replace function app.document_reviewers(p_doc uuid) returns uuid[]
language sql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
  select coalesce(array_agg(distinct r.pid), '{}'::uuid[])
    from (select il.instructor_id as pid
            from public.generated_documents gd
            join public.instructor_links il on il.student_id = gd.student_id and il.role = 'owner'
           where gd.id = p_doc and gd.student_id is not null
          union
          select co.created_by
            from public.generated_documents gd
            join public.courses co on co.id = gd.course_id
           where gd.id = p_doc and gd.student_id is null and co.created_by is not null
          union
          select il.instructor_id
            from public.generated_documents gd
            join public.instructor_links il on il.course_id = gd.course_id
           where gd.id = p_doc and gd.student_id is null) as r
$$;
comment on function app.document_reviewers(uuid) is 'İncelemeye yetkili eğitmenler (kişisel: öğrencinin owner eğitmeni; ders geneli: dersin eğitmenleri); admin dahil değil.';
revoke all on function app.document_reviewers(uuid) from public;

-- İnceleme bekleyen belge için eğitmen bildirimi (okunmamış aynı bildirim varsa yazılmaz). Eğitmeni olmayan öğrencinin belgesi
-- (ya da eğitmensiz dersin belgesi) admine düşer: yoksa belge sonsuza dek incelemede kalır.
create or replace function app.document_notify_reviewers(p_doc uuid) returns int
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_d public.generated_documents%rowtype;
  v_ids uuid[];
  v_n int;
begin
  select gd.* into v_d from public.generated_documents gd where gd.id = p_doc;
  v_ids := app.document_reviewers(p_doc);
  if cardinality(v_ids) = 0 then
    v_ids := array(select p.id from public.profiles p where p.role = 'admin');
  end if;
  insert into public.notifications (recipient_id, kind, title, body, payload)
  select r.pid, 'document_review', left('İnceleme bekliyor: ' || v_d.title, 160),
         case v_d.kind when 'mock_exam' then 'Üretilen deneme yayımlanmadan önce onayını bekliyor.'
                       else 'Üretilen belge yayımlanmadan önce onayını bekliyor.' end,
         jsonb_build_object('document_id', v_d.id, 'kind', v_d.kind, 'student_id', v_d.student_id, 'course_id', v_d.course_id,
                            'url', '/egitmen/icerik')
    from unnest(v_ids) as r (pid)
   where not exists (select 1 from public.notifications n
                      where n.recipient_id = r.pid and n.kind = 'document_review' and n.read_at is null
                        and n.payload ->> 'document_id' = v_d.id::text);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
comment on function app.document_notify_reviewers(uuid) is 'İnceleme bekleyen belge: incelemeye yetkili eğitmenlere (yoksa admine) document_review bildirimi; döner: yazılan sayı.';

-- Yayın: belge published (yayın kapısı tetikleyicisi review_required'ı denetler), istek ready, bağlı taslak sınav ready;
-- öğrenci(ler)e Bugün 'document_ready' kartı (payload.copy_key = 'document:<id>': suggestions.refresh aynı kartı yerinde
-- günceller) ve 'document_ready' bildirimi. Ders geneli belgede dersin etkin kayıtlı öğrencilerine (≤ 2000).
create or replace function app.document_publish(p_doc uuid) returns int
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_d public.generated_documents%rowtype;
  v_enr uuid;
  v_exam uuid;
  v_title text;
  v_key text := 'document:' || p_doc::text;
  v_rec record;
  v_n int := 0;
begin
  -- yayın kapısı tetikleyicisi üretim hattı belgesinin published geçişini yalnız bu ayarla kabul eder (0034)
  perform set_config('app.document_transition', 'on', true);
  update public.generated_documents gd set status = 'published' where gd.id = p_doc returning gd.* into v_d;
  perform set_config('app.document_transition', '', true);
  update public.document_requests dr set status = 'ready', error = null where dr.generated_document_id = p_doc and dr.status <> 'ready';
  update public.exams x set status = 'ready' where x.generated_document_id = p_doc and x.status in ('draft', 'processing');
  select x.id into v_exam from public.exams x
   where x.generated_document_id = p_doc and x.status in ('ready', 'published') order by x.created_at desc limit 1;
  v_title := app.document_ready_title(v_d.kind, v_d.title, v_d.student_id is not null);
  select dr.enrollment_id into v_enr from public.document_requests dr
   where dr.generated_document_id = p_doc and dr.enrollment_id is not null order by dr.created_at desc limit 1;

  for v_rec in
    select z.student_id, z.enrollment_id, st.profile_id
      from (select v_d.student_id as student_id,
                   coalesce(v_enr, (select e.id from public.enrollments e
                                     where e.student_id = v_d.student_id and e.status = 'active'
                                       and (v_d.course_id is null or e.course_id = v_d.course_id)
                                     order by e.started_at desc, e.created_at desc limit 1)) as enrollment_id
             where v_d.student_id is not null
            union all
            (select distinct on (e.student_id) e.student_id, e.id
               from public.enrollments e
              where v_d.student_id is null and v_d.course_id is not null and e.course_id = v_d.course_id and e.status = 'active'
              order by e.student_id, e.started_at desc, e.created_at desc)) as z
      join public.students st on st.id = z.student_id
     limit 2000
  loop
    if not exists (select 1 from public.suggestions s
                    where s.student_id = v_rec.student_id and s.consumed_at is null and s.payload ->> 'copy_key' = v_key) then
      insert into public.suggestions (student_id, enrollment_id, kind, title, subtitle, payload, rank, expires_at)
      values (v_rec.student_id, v_rec.enrollment_id, 'document_ready', v_title,
              case when v_exam is not null then 'PDF · aç, indir ya da çöz' else 'PDF · aç ve indir' end,
              jsonb_strip_nulls(jsonb_build_object('document_id', v_d.id, 'kind', v_d.kind, 'exam_id', v_exam, 'copy_key', v_key)),
              60, now() + interval '7 days');
    end if;
    if v_rec.profile_id is not null then
      insert into public.notifications (recipient_id, kind, title, body, payload)
      values (v_rec.profile_id, 'document_ready', v_title,
              case when v_exam is not null then 'PDF olarak açabilir ya da uygulamada çözebilirsin.'
                   else 'PDF olarak açabilir, indirebilirsin. Gelişim altındaki Belgelerim''de de durur.' end,
              jsonb_strip_nulls(jsonb_build_object('student_id', v_rec.student_id, 'document_id', v_d.id, 'kind', v_d.kind,
                                                   'exam_id', v_exam, 'url', '/ogrenci/belge/' || v_d.id::text)));
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
comment on function app.document_publish(uuid) is 'Belgeyi yayımlar: published, istek ready, taslak sınav ready; öğrenci(ler)e document_ready kartı (copy_key document:<id>) ve bildirimi; döner: alıcı sayısı.';

-- --- worker: durum geçişi + doğrulama merdiveni ---------------------------------------------------------------------

-- p_status (istek dili): generating | verifying | review | ready | failed. Belge durumu eşlenir: generating/verifying →
-- generating, review → review, ready → published (app.document_publish), failed → failed.
-- p_patch: verification {basamak: {status pass|fail|skipped|pending, ...}} (basamak başına birleşir, 'at' eklenir; yalnız
-- merdiven basamakları), personalization (nesne; yerine yazar), review_required (yalnız true: incelemeye yükseltir),
-- error (≤ 500; failed'de isteğe yazılır).
-- Geçişler: hazır (ready) belge değişmez; incelemedeki belge yalnız failed olabilir (onay review_document'ta); failed →
-- generating yeniden denemedir. 'ready' ve 'review' kapısı (OGR-DOC-008): merdivenin her basamağı pass | skipped, content
-- (AST) ve pdf_path dolu, mock_exam ise mock_exam_from_document ile sınav kurulmuş (eğitmen eksik belgeyi onaylayıp
-- yayımlayamasın). İncelemeli belge 'ready' yerine 'review' olur ve eğitmenlere document_review bildirimi gider.
-- Döner: {document_id, request_id, status (istek dili), document_status, review_required, verification}.
create or replace function public.document_set_status(p_document uuid, p_status text, p_patch jsonb default '{}'::jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_d public.generated_documents%rowtype;
  v_r public.document_requests%rowtype;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_cur text;
  v_target text := p_status;
  v_ver jsonb;
  v_step text;
  v_val jsonb;
  v_missing text;
  v_err text;
  v_review boolean;
  v_pers jsonb;
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 belge durumunu yalnız worker yazar';
  end if;
  if p_status is null or p_status not in ('generating', 'verifying', 'review', 'ready', 'failed') then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-006 geçersiz durum %s', coalesce(p_status, '(boş)'));
  end if;
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-005 p_patch nesne olmalı';
  end if;
  select gd.* into v_d from public.generated_documents gd where gd.id = p_document for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-001 belge bulunamadı %s', p_document);
  end if;
  if v_d.kind = 'answer_key' then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-001 anahtar belgesinin üretim durumu yok';
  end if;
  select dr.* into v_r from public.document_requests dr where dr.generated_document_id = p_document
   order by dr.created_at desc limit 1 for update;
  v_cur := coalesce(v_r.status, case v_d.status when 'published' then 'ready' when 'rendered' then 'verifying' else v_d.status end);
  if v_cur = 'ready' then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-006 hazır belgenin durumu değişmez';
  end if;
  if v_cur = 'review' and p_status not in ('review', 'failed') then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-006 incelemedeki belge yalnız eğitmen onayıyla yayımlanır';
  end if;

  v_ver := coalesce(v_d.verification, '{}'::jsonb);
  if v_patch ? 'verification' then
    if jsonb_typeof(v_patch -> 'verification') <> 'object' then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-005 verification nesne olmalı';
    end if;
    for v_step, v_val in select e.key, e.value from jsonb_each(v_patch -> 'verification') as e loop
      if v_step <> all (app.document_ladder_steps()) then
        raise exception using errcode = 'P0001', message = format('OGR-DOC-005 bilinmeyen doğrulama basamağı %s', v_step);
      end if;
      if jsonb_typeof(v_val) <> 'object' or coalesce(v_val ->> 'status', '') not in ('pass', 'fail', 'skipped', 'pending')
         or octet_length(v_val::text) > 20000 then
        raise exception using errcode = 'P0001', message = format('OGR-DOC-005 %s: {status pass|fail|skipped|pending, …} (≤ 20 KB)', v_step);
      end if;
      v_ver := v_ver || jsonb_build_object(v_step, v_val || jsonb_build_object('at', now()));
    end loop;
  end if;
  if v_patch ? 'personalization' then
    if jsonb_typeof(v_patch -> 'personalization') <> 'object' then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-005 personalization nesne olmalı';
    end if;
    v_pers := v_patch -> 'personalization';
  end if;
  v_review := v_d.review_required;
  if v_patch ? 'review_required' then
    if jsonb_typeof(v_patch -> 'review_required') <> 'boolean' or not (v_patch ->> 'review_required')::boolean then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-005 review_required yalnız true olabilir (inceleme kaldırılamaz)';
    end if;
    v_review := true;
  end if;
  v_err := left(nullif(btrim(v_patch ->> 'error'), ''), 500);

  if p_status in ('review', 'ready') then
    select string_agg(s.step, ', ' order by s.ord) into v_missing
      from unnest(app.document_ladder_steps()) with ordinality as s (step, ord)
     where coalesce(v_ver -> s.step ->> 'status', '') not in ('pass', 'skipped');
    if v_missing is not null then
      raise exception using errcode = 'P0001', message = format('OGR-DOC-008 doğrulama merdiveni tamamlanmadı: %s', v_missing);
    end if;
    if v_d.content is null or v_d.pdf_path is null then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-008 hazır belge için AST (content) ve PDF (pdf_path) gerekli';
    end if;
    if v_d.kind = 'mock_exam' and not exists (select 1 from public.exams x where x.generated_document_id = v_d.id) then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-008 deneme sınavı kurulmadı (mock_exam_from_document)';
    end if;
    if p_status = 'review' then
      v_review := true;
    elsif v_review and (v_d.reviewed_at is null or coalesce(v_ver -> 'review' ->> 'status', '') <> 'pass') then
      v_target := 'review';
    end if;
  end if;
  if v_target = 'review' and coalesce(v_ver -> 'review' ->> 'status', '') <> 'pending' then
    v_ver := v_ver || jsonb_build_object('review', jsonb_build_object('status', 'pending', 'at', now()));
  end if;

  perform set_config('app.document_transition', 'on', true);  -- yayın kapısı: review geçişi yalnız buradan (0034)
  update public.generated_documents gd
     set verification = v_ver,
         personalization = coalesce(v_pers, gd.personalization),
         review_required = v_review,
         status = case v_target when 'generating' then 'generating' when 'verifying' then 'generating'
                                when 'review' then 'review' when 'failed' then 'failed' else gd.status end
   where gd.id = p_document;
  perform set_config('app.document_transition', '', true);
  if v_r.id is not null then
    update public.document_requests dr
       set status = v_target,
           error = case when v_target = 'failed' then coalesce(v_err, 'generation_failed') end
     where dr.id = v_r.id;
  end if;
  if v_target = 'ready' then
    perform app.document_publish(p_document);
  elsif v_target = 'review' and v_cur <> 'review' then
    perform app.document_notify_reviewers(p_document);
  elsif v_target = 'failed' then
    update public.exams x set status = 'failed' where x.generated_document_id = p_document and x.status in ('draft', 'processing');
  end if;

  select gd.* into v_d from public.generated_documents gd where gd.id = p_document;
  return jsonb_build_object('document_id', v_d.id, 'request_id', v_r.id, 'status', v_target, 'document_status', v_d.status,
                            'review_required', v_d.review_required, 'verification', v_d.verification);
end
$$;
comment on function public.document_set_status(uuid, text, jsonb) is 'Worker: belge/istek durumu (generating, verifying, review, ready, failed) + doğrulama merdiveni; ready ve review kapısı merdiven, AST, PDF ve deneme sınavını ister; incelemeli belge review''a döner.';

-- Hatalı blok yalnız kendisi yeniden üretilir (docs/PLAN-v2.md §7): her deneme verification.regen[]'e
-- {block_id, step, reason, attempt, at} olarak yazılır. Blok başına sınır settings.documents_block_regen_max (2);
-- remaining = 0 olunca worker o bloğu yeniden üretmez (belge failed ya da incelemeye gider). Kayıt ≤ 200.
-- Döner: {document_id, block_id, attempts, max, remaining}.
create or replace function public.document_block_regen_note(
  p_document uuid, p_block_id text, p_step text, p_reason text, p_attempt int default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_ver jsonb;
  v_regen jsonb;
  v_attempts int;
  v_max int := app.setting_num('documents_block_regen_max', 2)::int;
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 yeniden üretim kaydını yalnız worker yazar';
  end if;
  if p_block_id is null or char_length(p_block_id) not between 1 and 40 then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-009 blok kimliği 1–40 karakter';
  end if;
  if p_step is null or p_step <> all (app.document_ladder_steps() || array['review']) then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-009 geçersiz basamak %s', coalesce(p_step, '(boş)'));
  end if;
  if nullif(btrim(p_reason), '') is null or char_length(p_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-009 neden 1–500 karakter';
  end if;
  if p_attempt is not null and p_attempt not between 1 and 20 then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-009 deneme numarası 1–20';
  end if;
  select coalesce(gd.verification, '{}'::jsonb) into v_ver from public.generated_documents gd where gd.id = p_document for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-001 belge bulunamadı %s', p_document);
  end if;
  v_regen := case when jsonb_typeof(v_ver -> 'regen') = 'array' then v_ver -> 'regen' else '[]'::jsonb end;
  if jsonb_array_length(v_regen) >= 200 then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-009 yeniden üretim kaydı dolu (200)';
  end if;
  select count(*)::int + 1 into v_attempts from jsonb_array_elements(v_regen) as e (it) where e.it ->> 'block_id' = p_block_id;
  v_regen := v_regen || jsonb_build_array(jsonb_build_object('block_id', p_block_id, 'step', p_step, 'reason', btrim(p_reason),
                                                             'attempt', coalesce(p_attempt, v_attempts), 'at', now()));
  update public.generated_documents gd set verification = v_ver || jsonb_build_object('regen', v_regen) where gd.id = p_document;
  return jsonb_build_object('document_id', p_document, 'block_id', p_block_id, 'attempts', v_attempts, 'max', v_max,
                            'remaining', greatest(v_max - v_attempts, 0));
end
$$;
comment on function public.document_block_regen_note(uuid, text, text, text, int) is 'Worker: hatalı bloğun yeniden üretim kaydı (verification.regen[]); blok başına sınır documents_block_regen_max; döner kalan hak.';

-- --- eğitmen incelemesi -------------------------------------------------------------------------------------------------

-- p_decision approve | reject; not ≤ 1000. Yalnız 'review' durumundaki belge (OGR-DOC-006). approve öncesi belge yeniden
-- denetlenir: AST ve PDF dolu, deneme ise sınavı kurulmuş (yoksa OGR-DOC-008). approve: reviewed_by/at,
-- verification.review = {status: pass, by, at, note} → app.document_publish (öğrenci(ler)e kart + bildirim). reject:
-- belge ve istek failed (error 'review_rejected'), bağlı taslak sınav archived; not verification.review'a yazılmaz, öğrenciye bildirilmez.
-- Döner: {document_id, decision, document_status, request: document_request_view | null}.
create or replace function public.review_document(p_id uuid, p_decision text, p_note text default null) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_d public.generated_documents%rowtype;
  v_req uuid;
  v_note text := nullif(btrim(p_note), '');
  v_rev jsonb;
begin
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-005 karar approve ya da reject olmalı (%s)', coalesce(p_decision, '(boş)'));
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-005 inceleme notu en çok 1000 karakter';
  end if;
  select gd.* into v_d from public.generated_documents gd where gd.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-001 belge bulunamadı %s', p_id);
  end if;
  if not app.can_review_document(p_id) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 belgeyi yalnız öğrencinin owner eğitmeni ya da dersin eğitmeni inceler';
  end if;
  if v_d.status <> 'review' then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-006 belge incelemede değil (%s)', v_d.status);
  end if;
  if p_decision = 'approve'
     and (v_d.content is null or v_d.pdf_path is null
          or (v_d.kind = 'mock_exam' and not exists (select 1 from public.exams x where x.generated_document_id = v_d.id))) then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-008 eksik belge onaylanamaz (AST, PDF ya da deneme sınavı yok)';
  end if;
  -- not verification.review'a yazılmaz (yalnız review_note): inceleme izi durum, kim ve ne zaman
  v_rev := jsonb_strip_nulls(jsonb_build_object('status', case when p_decision = 'approve' then 'pass' else 'fail' end,
                                                'by', auth.uid(), 'at', now()));
  update public.generated_documents gd
     set reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note,
         verification = coalesce(gd.verification, '{}'::jsonb) || jsonb_build_object('review', v_rev),
         status = case when p_decision = 'reject' then 'failed' else gd.status end
   where gd.id = p_id;
  if p_decision = 'approve' then
    perform app.document_publish(p_id);
  else
    update public.document_requests dr set status = 'failed', error = 'review_rejected' where dr.generated_document_id = p_id;
    update public.exams x set status = 'archived' where x.generated_document_id = p_id and x.status in ('draft', 'processing', 'ready');
  end if;
  update public.notifications n set read_at = now()
   where n.kind = 'document_review' and n.read_at is null and n.payload ->> 'document_id' = p_id::text;
  perform app.audit_event('document.review', 'public.generated_documents', p_id::text,
                          jsonb_build_object('decision', p_decision, 'kind', v_d.kind));
  select dr.id into v_req from public.document_requests dr where dr.generated_document_id = p_id order by dr.created_at desc limit 1;
  return jsonb_build_object('document_id', p_id, 'decision', p_decision,
                            'document_status', (select gd.status from public.generated_documents gd where gd.id = p_id),
                            'request', case when v_req is null then null else app.document_request_json(v_req, false) end);
end
$$;
comment on function public.review_document(uuid, text, text) is 'Eğitmen: incelemedeki belgeyi onaylar (published + document_ready kartı ve bildirimi) ya da reddeder (failed).';

-- --- belgeden uygulama içi deneme -------------------------------------------------------------------------------------

-- Yalnız worker (yalnız service_role ve doğrudan bağlantı çalıştırır; authenticated'a verilmez: anahtar yazar).
-- p_document: kind mock_exam | question_set, AST'de en az bir 'question' bloğu. p_keys: splitDocumentKeys(doc).keys
-- [{question_no, correct_option | numeric_value, canonical_expr?}] — her şıklı/sayısal soru için tam bir satır, fazlası yok.
-- Sınav: exams(kind 'practice', source 'generated', is_copyrighted false, generated_document_id, başlık belgeden, bölümler
-- AST bölümlerinden {code: no, title, from_no, to_no, minutes: null}, süre meta.duration_min ?? spec.duration_min);
-- belge yayımlandıysa 'ready', değilse 'draft' (app.document_publish 'ready' yapar). Sorular: şıklı → mcq, şıksız +
-- sayısal anahtar → numeric; şekil: AST figure source=upload → figure_upload_id, source=svg → figure_svg + figure_alt.
-- SVG burada yalnız savunma derinliği için kaba bir kara listeyle elenir (betik/stil/dış kaynak elemanları, olay
-- özniteliği, javascript:, karakter başvurusu &#, belge dışı href); asıl temizlik worker'da doc-render sanitizeSvg'dir
-- (izinli liste). İstemci figure_svg'yi YALNIZ <img src="data:image/svg+xml,…"> ile gösterir, asla innerHTML ile. Anahtarlar set_exam_keys(…, 'generated') ile secure'a.
-- Tekrar çağrı aynı sınavı yeniden kurar (oturumu varsa OGR-EXAM-003). Hata OGR-DOC-008.
-- Döner: {exam_id, document_id, question_count, keyed, status, reused} (anahtar değeri yok).
create or replace function public.mock_exam_from_document(p_document uuid, p_keys jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_d public.generated_documents%rowtype;
  v_cur uuid;
  v_exam uuid;
  v_reused boolean := false;
  v_qs jsonb;
  v_q jsonb;
  v_k jsonb;
  v_keys jsonb := '[]'::jsonb;
  v_no int;
  v_kind text;
  v_fig jsonb;
  v_svg text;
  v_bad text;
  v_sections jsonb;
  v_duration int;
  v_res jsonb;
  v_status text;
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 belgeden deneme kurmayı yalnız worker yapar';
  end if;
  select gd.* into v_d from public.generated_documents gd where gd.id = p_document for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-001 belge bulunamadı %s', p_document);
  end if;
  if v_d.kind not in ('mock_exam', 'question_set') then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-001 yalnız deneme ya da soru seti sınava çevrilir (%s)', v_d.kind);
  end if;
  if v_d.status = 'failed' then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-006 başarısız belge sınava çevrilmez';
  end if;
  select coalesce(jsonb_agg(b.blk order by (b.blk ->> 'no')::int), '[]'::jsonb) into v_qs
    from jsonb_array_elements(case when jsonb_typeof(v_d.content -> 'blocks') = 'array' then v_d.content -> 'blocks' else '[]'::jsonb end) as b (blk)
   where b.blk ->> 'type' = 'question';
  if jsonb_array_length(v_qs) = 0 or jsonb_array_length(v_qs) > 500 then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-008 belge AST''sinde soru yok (ya da 500''den fazla)';
  end if;
  if coalesce(jsonb_typeof(p_keys), '') <> 'array' or jsonb_array_length(p_keys) > 500 then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-008 p_keys dizi olmalı (≤ 500)';
  end if;
  select e.curriculum_id into v_cur from public.document_requests dr join public.enrollments e on e.id = dr.enrollment_id
   where dr.generated_document_id = p_document order by dr.created_at desc limit 1;
  if v_cur is null and v_d.student_id is not null then
    select e.curriculum_id into v_cur from public.enrollments e
     where e.student_id = v_d.student_id and (v_d.course_id is null or e.course_id = v_d.course_id)
     order by (e.status = 'active') desc, e.started_at desc limit 1;
  end if;
  if v_cur is null then
    select co.curriculum_id into v_cur from public.courses co where co.id = v_d.course_id;
  end if;
  if v_cur is null then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-008 belgenin müfredatı bulunamadı (kayıt ya da ders)';
  end if;

  -- anahtar eşlemesi ve soru türü (her şıklı/sayısal soruya tam bir anahtar)
  for v_q in select e.value from jsonb_array_elements(v_qs) as e (value) loop
    v_no := (v_q ->> 'no')::int;
    select k.value into v_k from jsonb_array_elements(p_keys) as k (value)
     where (k.value ->> 'question_no') ~ '^[0-9]{1,3}$' and (k.value ->> 'question_no')::int = v_no limit 1;
    if v_k is null then
      raise exception using errcode = 'P0001', message = format('OGR-DOC-008 soru %s için anahtar yok', v_no);
    end if;
    if jsonb_array_length(coalesce(v_q -> 'options', '[]'::jsonb)) > 0 then
      if coalesce(v_k ->> 'correct_option', '') !~ '^[A-E]$' or jsonb_typeof(v_k -> 'numeric_value') = 'number'
         or not exists (select 1 from jsonb_array_elements(v_q -> 'options') as o (opt) where o.opt ->> 'key' = v_k ->> 'correct_option') then
        raise exception using errcode = 'P0001', message = format('OGR-DOC-008 soru %s: doğru şık seçeneklerden biri olmalı', v_no);
      end if;
    elsif jsonb_typeof(v_k -> 'numeric_value') <> 'number' or nullif(v_k ->> 'correct_option', '') is not null then
      raise exception using errcode = 'P0001', message = format('OGR-DOC-008 soru %s: şıksız soruda sayısal anahtar gerekli', v_no);
    end if;
    v_keys := v_keys || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                'no', v_no, 'correct_option', v_k ->> 'correct_option',
                'numeric_value', case when jsonb_typeof(v_k -> 'numeric_value') = 'number' then v_k -> 'numeric_value' end)));
    v_k := null;
  end loop;
  if jsonb_array_length(p_keys) <> jsonb_array_length(v_keys)
     or (select count(distinct k.value ->> 'question_no') from jsonb_array_elements(p_keys) as k (value)) <> jsonb_array_length(p_keys) then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-008 anahtar satırları sorularla birebir olmalı (fazla ya da yinelenen var)';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('code', s.sec ->> 'no', 'title', s.sec ->> 'title', 'from_no', r.from_no,
                                               'to_no', r.to_no, 'minutes', null) order by r.from_no), '[]'::jsonb)
    into v_sections
    from jsonb_array_elements(case when jsonb_typeof(v_d.content -> 'sections') = 'array' then v_d.content -> 'sections' else '[]'::jsonb end) as s (sec)
    join lateral (select min((q.value ->> 'no')::int) as from_no, max((q.value ->> 'no')::int) as to_no
                    from jsonb_array_elements(v_qs) as q (value) where q.value ->> 'section_no' = s.sec ->> 'no') as r on r.from_no is not null;
  v_duration := coalesce(case when jsonb_typeof(v_d.content -> 'meta' -> 'duration_min') = 'number' then (v_d.content -> 'meta' ->> 'duration_min')::int end,
                         case when jsonb_typeof(v_d.spec -> 'duration_min') = 'number' then (v_d.spec ->> 'duration_min')::int end);
  v_status := case when v_d.status = 'published' then 'ready' else 'draft' end;

  select x.id into v_exam from public.exams x where x.generated_document_id = p_document order by x.created_at desc limit 1 for update;
  if v_exam is not null then
    if exists (select 1 from public.exam_sessions es where es.exam_id = v_exam) then
      raise exception using errcode = 'P0001', message = 'OGR-EXAM-003 oturumu olan deneme yeniden kurulamaz';
    end if;
    delete from public.exam_questions q where q.exam_id = v_exam;
    update public.exams x
       set title = v_d.title, curriculum_id = v_cur, course_id = v_d.course_id, question_count = jsonb_array_length(v_qs),
           sections = v_sections, duration_min = v_duration, status = v_status, is_copyrighted = false
     where x.id = v_exam;
    v_reused := true;
  else
    insert into public.exams (course_id, curriculum_id, created_by, kind, source, title, is_copyrighted, question_count, sections,
                              generated_document_id, status, duration_min)
    values (v_d.course_id, v_cur, v_d.created_by, 'practice', 'generated', v_d.title, false, jsonb_array_length(v_qs), v_sections,
            p_document, v_status, v_duration)
    returning id into v_exam;
  end if;

  begin
    for v_q in select e.value from jsonb_array_elements(v_qs) as e (value) loop
      v_fig := case when jsonb_typeof(v_q -> 'figure') = 'object' then v_q -> 'figure' end;
      v_svg := case when v_fig ->> 'source' = 'svg' then nullif(v_fig ->> 'svg', '') end;
      if v_svg is not null
         and (v_svg !~* '^\s*(<\?xml[^>]*>\s*)?<svg'
              or v_svg ~* '<(a|script|foreignobject|iframe|object|embed|image|set|animate[a-z]*|feimage|style)\M'
              or v_svg ~* '[\s/"''](on[a-z]+)\s*='
              or v_svg ~* 'javascript:|&#'
              or v_svg ~* 'href\s*=\s*["'']?\s*[^#"''\s]') then
        raise exception using errcode = 'P0001', message = format('OGR-DOC-008 soru %s: SVG şekli güvenli değil (betik, olay özniteliği, dış başvuru ya da yasak eleman)', v_q ->> 'no');
      end if;
      v_kind := case when jsonb_array_length(coalesce(v_q -> 'options', '[]'::jsonb)) > 0 then 'mcq' else 'numeric' end;
      insert into public.exam_questions (exam_id, no, section, kind, stem_text, options, figure_upload_id, figure_svg, figure_alt,
                                         skill_ids, style_id)
      values (v_exam, (v_q ->> 'no')::int, v_q ->> 'section_no', v_kind, v_q ->> 'stem',
              case when v_kind = 'mcq' then v_q -> 'options' end,
              case when v_fig ->> 'source' = 'upload' then nullif(v_fig ->> 'upload_id', '')::uuid end,
              v_svg, left(v_fig ->> 'alt', 400),
              coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(v_q -> 'skill_ids') = 'array' then v_q -> 'skill_ids' else '[]'::jsonb end)), '{}'),
              nullif(v_q ->> 'style_id', '')::uuid);
    end loop;
  exception when foreign_key_violation or check_violation or invalid_text_representation or not_null_violation or unique_violation then
    get stacked diagnostics v_bad = message_text;
    raise exception using errcode = 'P0001', message = format('OGR-DOC-008 soru yazılamadı: %s', left(v_bad, 200));
  end;

  v_res := public.set_exam_keys(v_exam, v_keys, 'generated');
  return jsonb_build_object('exam_id', v_exam, 'document_id', p_document, 'question_count', jsonb_array_length(v_qs),
                            'keyed', (v_res ->> 'keyed')::int, 'status', v_status, 'reused', v_reused);
end
$$;
comment on function public.mock_exam_from_document(uuid, jsonb) is 'Worker: belge AST''sinin soruları + ayrı anahtarlar → exams(practice, generated, telifsiz) + exam_questions + secure.exam_answer_keys (set_exam_keys); belge yayımlanınca sınav ready.';

-- --- not ve deneme kişiselleştirme girdisi ---------------------------------------------------------------------------

-- Worker (not ve deneme üretimi): öğrencinin tekrar eden hataları. Veri minimizasyonu: yalnız worker'ın kullandığı alanlar
-- döner (documents/context.ts loadPatterns). Döner:
--   {student_id, course_id, enrollment_ids[],
--    patterns: {path '/memories/patterns.md', exists, updated_at,
--               lines: [{source 'patterns.md', pattern_id 'patterns.md:<satır>', line_no, text, dates[]}]},
--    misconceptions: [{source 'misconception', pattern_id (etiket ya da yanılgı kimliği), tag, skill_id, skill_name,
--                      text_student, evidence_count, first_seen, last_seen, last_seen_tr, dates[]}]
--                    (yalnız eğitmenin onayladığı açık yanılgılar, ≤ 12; inceleme bekleyen, çözülmüş, reddedilmiş yok),
--    recent_analyses: [{source 'analysis', pattern_id (teşhis kimliği), id, date, date_tr, dates[], verdict, error_cause,
--                       skill_ids, misconception_tags, failing_step_no, one_line}] (son 60 gün, ≤ 10),
--    known_patterns: [{source, id, dates[]}]  (packages/contracts KnownPattern; calloutReferenceIssues girdisi),
--    pattern_ids: [...]}  — common_mistake_callout.pattern_id (= pattern_ref.id) bu kümeden, pattern_ref.date dates'ten
--    olmalı (personalization basamağı). Tarihler YYYY-AA-GG (İstanbul).
-- p_course boşsa öğrencinin tüm kayıtları. Yalnız worker ve admin (hafıza içeriği taşır).
create or replace function public.student_patterns_for_prompt(p_student uuid, p_course uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_enrs uuid[];
  v_mf public.memory_files%rowtype;
  v_lines jsonb;
  v_mis jsonb;
  v_sa jsonb;
  v_ids jsonb;
  v_known jsonb;
begin
  if not (app.is_trusted() or app.is_admin()) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 kişiselleştirme girdisini yalnız worker okur';
  end if;
  if not exists (select 1 from public.students st where st.id = p_student) then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-005 öğrenci bulunamadı';
  end if;
  select coalesce(array_agg(e.id order by e.started_at desc), '{}') into v_enrs from public.enrollments e
   where e.student_id = p_student and (p_course is null or e.course_id = p_course);

  select mf.* into v_mf from public.memory_files mf where mf.student_id = p_student and mf.path = '/memories/patterns.md';
  select coalesce(jsonb_agg(jsonb_build_object('source', 'patterns.md', 'pattern_id', 'patterns.md:' || l.no, 'line_no', l.no,
                                               'text', regexp_replace(l.line, '^\s*[-*]\s+', ''),
                                               'dates', app.tr_dates_in_text(l.line)) order by l.no), '[]'::jsonb)
    into v_lines
    from regexp_split_to_table(coalesce(v_mf.content, ''), E'\n') with ordinality as l (line, no)
   where l.line ~ '^\s*[-*]\s+\S';

  select coalesce(jsonb_agg(z.j order by z.last_seen desc), '[]'::jsonb) into v_mis
    from (select m.last_seen,
                 jsonb_build_object('source', 'misconception', 'pattern_id', coalesce(m.tag, m.id::text), 'tag', m.tag,
                                    'skill_id', m.skill_id, 'skill_name', sk.name, 'text_student', m.text_student,
                                    'evidence_count', m.evidence_count,
                                    'first_seen', m.first_seen, 'last_seen', m.last_seen, 'last_seen_tr', app.tr_short_date(m.last_seen),
                                    'dates', (select coalesce(jsonb_agg(distinct dd.d order by dd.d), '[]'::jsonb)
                                                from (select to_char(m.first_seen at time zone 'Europe/Istanbul', 'YYYY-MM-DD') as d
                                                      union select to_char(m.last_seen at time zone 'Europe/Istanbul', 'YYYY-MM-DD')
                                                      union select to_char(o.created_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD')
                                                              from public.misconception_evidence me
                                                              join public.observations o on o.id = me.observation_id
                                                             where me.misconception_id = m.id
                                                      union select to_char(sa2.created_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD')
                                                              from public.solution_analyses sa2
                                                             where sa2.enrollment_id = m.enrollment_id and m.tag is not null
                                                               and m.tag = any (sa2.misconception_tags)) as dd)) as j
            from public.misconceptions m
            left join public.skills sk on sk.curriculum_id = m.curriculum_id and sk.id = m.skill_id
           where m.enrollment_id = any (v_enrs) and m.status = 'open'
           order by m.last_seen desc
           limit 12) as z;

  select coalesce(jsonb_agg(z.j order by z.created_at desc), '[]'::jsonb) into v_sa
    from (select sa.created_at,
                 jsonb_build_object('source', 'analysis', 'pattern_id', sa.id::text, 'id', sa.id,
                                    'date', to_char(sa.created_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD'),
                                    'dates', jsonb_build_array(to_char(sa.created_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD')),
                                    'date_tr', app.tr_short_date(sa.created_at), 'verdict', sa.verdict, 'error_cause', sa.error_cause,
                                    'skill_ids', to_jsonb(sa.skill_ids), 'misconception_tags', to_jsonb(sa.misconception_tags),
                                    'failing_step_no', sa.failing_step_no, 'one_line', left(sa.analysis ->> 'one_line', 300)) as j
            from public.solution_analyses sa
           where sa.enrollment_id = any (v_enrs) and sa.verdict in ('wrong', 'incomplete')
             and sa.created_at >= now() - interval '60 days'
           order by sa.created_at desc
           limit 10) as z;

  select coalesce(jsonb_agg(x.kp order by x.ord, x.no), '[]'::jsonb), coalesce(jsonb_agg(distinct x.kp ->> 'id'), '[]'::jsonb)
    into v_known, v_ids
    from (select 1 as ord, l.no, jsonb_build_object('source', l.value ->> 'source', 'id', l.value ->> 'pattern_id', 'dates', l.value -> 'dates') as kp
            from jsonb_array_elements(v_lines) with ordinality as l (value, no)
          union all
          select 2, m.no, jsonb_build_object('source', m.value ->> 'source', 'id', m.value ->> 'pattern_id', 'dates', m.value -> 'dates')
            from jsonb_array_elements(v_mis) with ordinality as m (value, no)
          union all
          select 3, a.no, jsonb_build_object('source', a.value ->> 'source', 'id', a.value ->> 'pattern_id', 'dates', a.value -> 'dates')
            from jsonb_array_elements(v_sa) with ordinality as a (value, no)) as x;

  return jsonb_build_object(
    'student_id', p_student, 'course_id', p_course, 'enrollment_ids', to_jsonb(v_enrs),
    'patterns', jsonb_build_object('path', '/memories/patterns.md', 'exists', v_mf.student_id is not null,
                                   'updated_at', v_mf.updated_at, 'lines', v_lines),
    'misconceptions', v_mis, 'recent_analyses', v_sa, 'known_patterns', v_known, 'pattern_ids', v_ids);
end
$$;
comment on function public.student_patterns_for_prompt(uuid, uuid) is 'Worker: not ve deneme kişiselleştirmesi için patterns.md satırları, eğitmen onaylı açık yanılgılar, son hatalı teşhisler, known_patterns {source, id, dates} ve izinli pattern_id kümesi.';

-- --- Belgelerim (0032 + istek, inceleme, deneme) ------------------------------------------------------------------------

-- 0032 kuralları aynen; satıra review_required, published_at, request_id, request_status (document_requests) ve exam_id
-- (belgeden kurulmuş, ready/published sınav: "Çöz") eklenir. Yayımlanmamış üretim hattı belgesinin ve inceleme bekleyen belgenin yolları personel dışına gizlidir
-- (öğrenci kendi isteğini "Hocan inceliyor" olarak görür).
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
  v_staff boolean := app.is_trusted() or app.is_staff();
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
                                    'pdf_path', case when z2.masked then null else gd.pdf_path end,
                                    'html_path', case when z2.masked then null else gd.html_path end,
                                    'student_id', gd.student_id,
                                    'course_id', gd.course_id, 'course_title', co.title,
                                    'scope', case when gd.student_id is null then 'course' else 'personal' end,
                                    'exam_session_id', (select es.id from public.exam_sessions es where es.report_document_id = gd.id
                                                         order by es.created_at desc limit 1),
                                    'review_required', gd.review_required, 'published_at', gd.published_at,
                                    'request_id', rq.id, 'request_status', rq.status,
                                    'exam_id', (select x.id from public.exams x
                                                 where x.generated_document_id = gd.id and x.status in ('ready', 'published')
                                                 order by x.created_at desc limit 1),
                                    'created_at', gd.created_at, 'updated_at', gd.updated_at) as doc
            from public.generated_documents gd
            left join public.courses co on co.id = gd.course_id
            cross join lateral (select not v_staff and ((gd.review_required and gd.status <> 'published') or app.document_pipeline_unpublished(gd.kind, gd.status)) as masked) as z2
            left join lateral (select dr.id, dr.status from public.document_requests dr
                                where dr.generated_document_id = gd.id order by dr.created_at desc limit 1) as rq on true
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
comment on function public.list_my_documents(text, uuid, int) is 'Belgelerim: öğrenci kendi + kayıtlı dersinin yayımlanmış ders geneli belgeleri (istek durumu, inceleme, deneme sınavı); veli çocuklarının hazır raporları; answer_key asla.';

-- --- üretilmiş denemenin görünürlüğü (0030 app.exam_visible, exams_select; 0017 start_exam_session) ---------------------

-- 0030 app.exam_visible + üretilmiş belge kuralı: belgeden kurulmuş sınav (generated_document_id) öğrenciye yalnız ready |
-- published iken görünür. Taslak sınav incelenmemiş (ya da merdiveni bitmemiş) üretilmiş soru taşır; oluşturan dalı
-- (kişisel istekte created_by öğrencinin kendisidir) bu sınavlarda kullanılmaz. Kişiye üretilmişse yalnız o öğrenciye,
-- ders geneli üretilmişse yalnız o dersin öğrencilerine (müfredat dalı yok). Personel dalı (app.can_read_exam) ve geri kalanı aynen.
create or replace function app.exam_visible(p_exam uuid, p_student uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_x public.exams%rowtype;
  v_doc_student uuid;
begin
  select x.* into v_x from public.exams x where x.id = p_exam;
  if not found then
    return false;
  end if;
  if app.is_trusted() or app.can_read_exam(p_exam) then
    return true;
  end if;
  if v_x.generated_document_id is not null then
    if p_student is null or v_x.status not in ('ready', 'published') then
      return false;
    end if;
    select gd.student_id into v_doc_student from public.generated_documents gd where gd.id = v_x.generated_document_id;
    if v_doc_student is not null then
      return v_doc_student = p_student;
    end if;
    -- ders geneli üretilmiş sınav: yalnız o dersin etkin kayıtlı öğrencileri (müfredat dalı YOK: aynı müfredatı paylaşan
    -- başka derslere açılmaz; list_my_documents'in ders geneli kuralıyla aynı)
    return v_x.kind in ('published', 'practice', 'diagnostic') and exists (select 1 from public.enrollments e
            where e.student_id = p_student and e.status = 'active' and e.course_id = v_x.course_id);
  elsif coalesce(v_x.created_by = auth.uid(), false) then
    return true;
  end if;
  if p_student is null then
    return false;
  end if;
  return v_x.status in ('ready', 'published') and v_x.kind in ('published', 'practice', 'diagnostic')
     and exists (select 1 from public.enrollments e
                  where e.student_id = p_student and (e.course_id = v_x.course_id or e.curriculum_id = v_x.curriculum_id));
end
$$;
comment on function app.exam_visible(uuid, uuid) is 'Sınav öğrenciye görünür mü (oturumsuz kural): worker, app.can_read_exam, oluşturan (üretilmiş sınav hariç), kişiye üretilmiş ready/published sınavın öğrencisi, kayıtlı dersin yayımlanmış sınavı; ders geneli üretilmiş sınav yalnız o dersin öğrencisine.';

-- 0030 exams_select: oluşturan dalı üretilmiş sınavı kapsamaz (taslak üretilmiş deneme satırı öğrenciye görünmez;
-- görünürlük app.exam_visible'da); geri kalanı aynen.
drop policy exams_select on public.exams;
create policy exams_select on public.exams for select to authenticated
using (app.can_read_exam(id)
       or (created_by = auth.uid() and generated_document_id is null)
       or exists (select 1 from public.exam_sessions as es where es.exam_id = exams.id)
       or app.exam_visible(id, app.my_student_id()));

-- 0017 start_exam_session + üretilmiş sınav kuralı: belgeden kurulmuş sınav her kipte (uploaded dahil) yalnız ready |
-- published iken başlar (OGR-EXAM-003); aksi hâlde taslak sınavda açılan oturum v_exam_questions_student'tan incelenmemiş
-- soruları açar ve mock_exam_from_document'ın yeniden kurulumunu kilitlerdi. Geri kalanı aynen.
create or replace function public.start_exam_session(p_exam uuid, p_enrollment uuid, p_mode text default 'in_app') returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_x public.exams%rowtype;
  v_enr public.enrollments%rowtype;
  v_id uuid;
begin
  select e.* into v_enr from public.enrollments e where e.id = p_enrollment;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 kayıt bulunamadı';
  end if;
  perform app.assert_student_access(v_enr.student_id, true);
  select x.* into v_x from public.exams x where x.id = p_exam;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 sınav bulunamadı';
  end if;
  if p_mode is null or p_mode not in ('in_app', 'uploaded') then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-001 geçersiz kip %s', coalesce(p_mode, '(boş)'));
  end if;
  if v_x.curriculum_id <> v_enr.curriculum_id then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-002 sınavın müfredatı kaydın müfredatıyla aynı değil';
  end if;
  if v_x.status in ('failed', 'archived')
     or ((p_mode = 'in_app' or v_x.generated_document_id is not null) and v_x.status not in ('ready', 'published')) then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-003 sınav bu kipte başlatılamaz (durum %s)', v_x.status);
  end if;
  -- sınav kaydın öğrencisine görünür olmalı (app.exam_visible; exams_select'in oturum dalı HARİÇ kuralı): oturum açmak
  -- exams_select ve v_exam_questions_student'ı açtığından başkasının özel sınavı burada durur
  if not app.exam_visible(p_exam, v_enr.student_id) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu sınav için yetki yok';
  end if;
  select es.id into v_id from public.exam_sessions es
   where es.exam_id = p_exam and es.enrollment_id = p_enrollment and es.status = 'in_progress' and es.mode = p_mode
   order by es.started_at desc limit 1;
  if v_id is null then
    insert into public.exam_sessions (exam_id, enrollment_id, mode) values (p_exam, p_enrollment, p_mode) returning id into v_id;
  end if;
  return v_id;
end
$$;
comment on function public.start_exam_session(uuid, uuid, text) is 'Sınav oturumu açar (aynı sınav + kayıt için süren oturum varsa onu döner); in_app için ve belgeden üretilmiş sınavda her kipte sınav ready/published olmalı; sınav çağırana görünür olmalı.';

-- --- yetkiler ------------------------------------------------------------------------------------------------------------

revoke all on function app.tr_short_date(timestamptz), app.tr_dates_in_text(text), app.document_ladder_steps(), app.can_review_document(uuid),
  app.document_reviewers(uuid), app.document_notify_reviewers(uuid), app.document_publish(uuid) from public;
grant execute on function app.tr_short_date(timestamptz), app.tr_dates_in_text(text), app.document_ladder_steps(),
  app.can_review_document(uuid) to authenticated, service_role;

revoke all on function public.document_set_status(uuid, text, jsonb), public.document_block_regen_note(uuid, text, text, text, int),
  public.review_document(uuid, text, text), public.mock_exam_from_document(uuid, jsonb),
  public.student_patterns_for_prompt(uuid, uuid) from public, anon;
-- document_set_status / document_block_regen_note / student_patterns_for_prompt authenticated'a açıktır ama gövde
-- app.is_trusted() ister (açık OGR-AUTH-002). mock_exam_from_document anahtar yazar: authenticated'a hiç verilmez
-- (tests/20_exam_keys_isolation.sql anahtara dokunan, authenticated'ın çağırabildiği küme).
grant execute on function public.document_set_status(uuid, text, jsonb), public.document_block_regen_note(uuid, text, text, text, int),
  public.review_document(uuid, text, text), public.student_patterns_for_prompt(uuid, uuid) to authenticated, service_role;
grant execute on function public.mock_exam_from_document(uuid, jsonb) to service_role;
