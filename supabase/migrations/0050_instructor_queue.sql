-- 0050_instructor_queue.sql — eğitmen "Kuyruk" sayfası: insan kararı bekleyen işlerin tek listesi ve iki eylem.
--   * instructor_queue(): en yeni önce en çok 100 öğe [{kind, id, created_at, title, detail, student_name?, href?}]
--       coach_note     koçun eğitmene yönlendirmesi (notifications kind = 'coach_escalation', okunmamış; coach_escalate
--                      bunu instructor_notes'a değil bildirime yazar). Yalnız bildirim metni döner; sohbet kimliği ya da
--                      sohbet dökümü dönmez.
--       spend_cap      harcama tavanında (check_spend downgrade) durdurulan belge üretim isteği (spend_cap_holds, onaysız,
--                      istek hâlâ failed)
--       review_document  incelemede bekleyen belge (generated_documents.status = 'review') → /egitmen/icerik
--       lesson_claims  dersin otomatik uygulama eşiğinin altındaki (ya da güvensiz) bekleyen iddiaları, ders başına bir
--                      satır → /egitmen/dersler/<ders>
--       curriculum_proposal  açık müfredat önerisi (gece incelemesinin kararı ayrıntıda) → /egitmen/mufredatlar/<müfredat>
--   * resolve_instructor_note(p_id): koç yönlendirmesini okundu yapar (notifications.read_at; ikinci çağrı no-op).
--   * approve_spend_capped_request(p_kind, p_id): tavanda duran isteğe tek seferlik muafiyet: onay (kim, ne zaman, hangi
--     istek) spend_cap_holds'a yazılır, belge ve istek queued'a döner, document.generate yeniden kuyruğa girer. Worker
--     (apps/worker/src/jobs/spend.ts) onayı yalnız o istek için, yalnız bir kez ve yalnız downgrade (yumuşak tavan)
--     durumunda consume_spend_cap_approval ile tüketir; paid_allowed = false (kapatma anahtarı) iken onay okunmaz.
-- Kapsam: admin hepsini; eğitmen yalnız app.my_students() öğrencilerine ait öğeleri, öğrencisiz (ders geneli) öğelerde
-- app.can_teach_course derslerini, kendi verdiği dersleri ve kendi oluşturduğu (ya da dersinin eşlendiği) müfredatları.
-- Hata kodları: OGR-AUTH-002 (42501) eğitmen/admin değil ya da öğe kapsam dışı; OGR-QUEUE-001 öğe yok;
-- OGR-QUEUE-002 desteklenmeyen tür.

create table public.spend_cap_holds (  -- Harcama tavanında (downgrade) durdurulan üretim istekleri ve eğitmenin tek seferlik onayı.
  id uuid primary key default gen_random_uuid(),  -- Kayıt kimliği
  kind text not null check (kind in ('document')),  -- İstek türü (şimdilik yalnız belge isteği)
  request_id uuid not null references public.document_requests (id) on delete cascade,  -- Durdurulan istek
  held_at timestamptz not null default now(),  -- Son durdurulma zamanı
  approved_by uuid references public.profiles (id) on delete set null,  -- Onaylayan eğitmen/admin
  approved_at timestamptz,  -- Onay zamanı
  job_id uuid,  -- Onayla yeniden kuyruğa giren işin kimliği (kuyruk yoksa boş)
  consumed_at timestamptz,  -- Worker'ın onayı tükettiği zaman (bir kez)
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  unique (kind, request_id),
  check (consumed_at is null or approved_at is not null)
);
-- begin comments public.spend_cap_holds
comment on table public.spend_cap_holds is 'Harcama tavanında (downgrade) durdurulan üretim istekleri ve eğitmenin tek seferlik onayı.';
comment on column public.spend_cap_holds.id is 'Kayıt kimliği';
comment on column public.spend_cap_holds.kind is 'İstek türü (şimdilik yalnız belge isteği)';
comment on column public.spend_cap_holds.request_id is 'Durdurulan istek';
comment on column public.spend_cap_holds.held_at is 'Son durdurulma zamanı';
comment on column public.spend_cap_holds.approved_by is 'Onaylayan eğitmen/admin';
comment on column public.spend_cap_holds.approved_at is 'Onay zamanı';
comment on column public.spend_cap_holds.job_id is 'Onayla yeniden kuyruğa giren işin kimliği (kuyruk yoksa boş)';
comment on column public.spend_cap_holds.consumed_at is 'Worker''ın onayı tükettiği zaman (bir kez)';
comment on column public.spend_cap_holds.created_at is 'Oluşturulma zamanı';
-- end comments public.spend_cap_holds
alter table public.spend_cap_holds enable row level security;
alter table public.spend_cap_holds force row level security;
-- Doğrudan okuma yalnız admin'e; eğitmen kuyruğu instructor_queue() üzerinden görür, yazım yalnız RPC'lerle.
create policy spend_cap_holds_select_admin on public.spend_cap_holds for select to authenticated using (app.is_admin());
grant select on public.spend_cap_holds to authenticated;

-- Worker: tavanda durdurulan isteği kaydeder. Tüketilmiş eski onay varsa kayıt yeniden açılır (yeni onay gerekir);
-- bekleyen kayıtta yalnız held_at güncellenir.
create or replace function public.record_spend_cap_hold(p_kind text, p_request uuid) returns void
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 tavan kaydını yalnız worker yazar';
  end if;
  if coalesce(p_kind, '') <> 'document' then
    raise exception using errcode = 'P0001', message = format('OGR-QUEUE-002 desteklenmeyen tür %s', coalesce(p_kind, '(boş)'));
  end if;
  insert into public.spend_cap_holds (kind, request_id) values (p_kind, p_request)
  on conflict (kind, request_id) do update
    set held_at = now(),
        approved_by = case when spend_cap_holds.consumed_at is null then spend_cap_holds.approved_by end,
        approved_at = case when spend_cap_holds.consumed_at is null then spend_cap_holds.approved_at end,
        job_id = case when spend_cap_holds.consumed_at is null then spend_cap_holds.job_id end,
        consumed_at = null;
end
$$;
comment on function public.record_spend_cap_hold(text, uuid) is 'Worker: harcama tavanında (downgrade) durdurulan isteği spend_cap_holds''a yazar; tüketilmiş onay varsa kaydı yeniden açar.';

-- Worker: istek için kayıtlı ve tüketilmemiş onay varsa tüketir ve true döner (tek seferlik); yoksa false.
create or replace function public.consume_spend_cap_approval(p_kind text, p_request uuid) returns boolean
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 tavan onayını yalnız worker tüketir';
  end if;
  update public.spend_cap_holds h set consumed_at = now()
   where h.kind = p_kind and h.request_id = p_request and h.approved_at is not null and h.consumed_at is null
  returning h.id into v_id;
  if v_id is null then
    return false;
  end if;
  perform app.audit_event('spend_cap.consumed', 'spend_cap_holds', v_id::text,
                          jsonb_build_object('kind', p_kind, 'request_id', p_request));
  return true;
end
$$;
comment on function public.consume_spend_cap_approval(text, uuid) is 'Worker: isteğin eğitmen onayını bir kez tüketir (true); onay yoksa ya da tüketilmişse false.';

-- Eğitmen/admin: insan kararı bekleyen işler (en yeni önce, en çok 100).
create or replace function public.instructor_queue() returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_admin boolean := app.is_admin();
  v_me uuid := auth.uid();
  v_students uuid[];
  v_out jsonb;
begin
  if not app.is_staff() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 kuyruğu yalnız eğitmen ya da admin görür';
  end if;
  v_students := array(select app.my_students());

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'kind', q.kind, 'id', q.id, 'created_at', q.created_at, 'title', q.title, 'detail', q.detail,
           'student_name', q.student_name, 'href', q.href)) order by q.created_at desc, q.id), '[]'::jsonb)
    into v_out
    from (select x.* from (
            -- koç yönlendirmeleri (yalnız bildirim metni)
            select 'coach_note'::text as kind, n.id, n.created_at, n.title, n.body as detail, p.display_name as student_name,
                   case when s.id is not null then '/egitmen/ogrenci/' || s.id::text end as href
              from public.notifications n
              left join public.students s
                on s.id = case when n.payload ->> 'student_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                               then (n.payload ->> 'student_id')::uuid end
              left join public.profiles p on p.id = s.profile_id
             where n.kind = 'coach_escalation' and n.read_at is null
               and (v_admin or n.recipient_id = v_me or s.id = any (v_students))
            union all
            -- harcama tavanında duran belge istekleri
            select 'spend_cap', dr.id, h.held_at, coalesce(gd.title, dr.spec ->> 'title', 'Belge'),
                   (case dr.kind when 'notes' then 'Ders notu' when 'mock_exam' then 'Deneme' when 'question_set' then 'Soru seti'
                      else dr.kind end) || ' · harcama tavanında durdu; onaylarsan bir kez üretilir',
                   p.display_name, null
              from public.spend_cap_holds h
              join public.document_requests dr on dr.id = h.request_id
              left join public.generated_documents gd on gd.id = dr.generated_document_id
              left join public.students s on s.id = dr.student_id
              left join public.profiles p on p.id = s.profile_id
             where h.approved_at is null and dr.status = 'failed'
               and (v_admin or dr.student_id = any (v_students) or (dr.student_id is null and app.can_teach_course(dr.course_id)))
            union all
            -- incelemede bekleyen belgeler
            select 'review_document', gd.id, coalesce(gd.updated_at, gd.created_at), gd.title,
                   case gd.kind when 'notes' then 'Ders notu' when 'mock_exam' then 'Deneme' when 'question_set' then 'Soru seti'
                     when 'report' then 'Rapor' else gd.kind end || ' · eğitmen incelemesi bekliyor',
                   p.display_name, '/egitmen/icerik'
              from public.generated_documents gd
              left join public.students s on s.id = gd.student_id
              left join public.profiles p on p.id = s.profile_id
             where gd.status = 'review'
               and (v_admin or gd.student_id = any (v_students) or (gd.student_id is null and app.can_teach_course(gd.course_id)))
            union all
            -- dersin eşik altı bekleyen iddiaları (ders başına bir satır)
            select 'lesson_claims', l.id, max(c.created_at),
                   'Ders · ' || to_char(l.held_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY'),
                   format('%s düşük güvenli iddia onay bekliyor', count(*)),
                   max(p.display_name), '/egitmen/dersler/' || l.id::text
              from public.lesson_claims c
              join public.lesson_analyses la on la.id = c.analysis_id
              join public.lessons l on l.id = la.lesson_id
              left join public.enrollments e on e.id = l.enrollment_id
              left join public.students s on s.id = e.student_id
              left join public.profiles p on p.id = s.profile_id
             where c.status = 'pending' and (c.confidence is null or c.confidence < l.auto_apply_threshold)
               and la.status <> 'rejected' and l.status not in ('rejected', 'failed')
               and (v_admin or l.instructor_id = v_me or e.student_id = any (v_students)
                    or (l.enrollment_id is null and app.can_teach_course(l.course_id)))
             group by l.id, l.held_at
            union all
            -- açık müfredat önerileri
            select 'curriculum_proposal', cp.id, cp.created_at,
                   (case cp.kind when 'add_subskill' then 'Alt kazanım ekle' when 'rename' then 'Yeniden adlandır'
                      when 'merge' then 'Birleştir' when 'add_prereq' then 'Ön koşul ekle' when 'add_tag' then 'Etiket ekle'
                      else cp.kind end) || coalesce(': ' || nullif(btrim(cp.payload ->> 'name'), ''), ''),
                   cu.label || case cp.payload -> 'review' ->> 'action'
                                 when 'needs_instructor' then ' · yapay zekâ: eğitmene bırakıldı'
                                 when 'reject' then ' · yapay zekâ: ret öneriyor'
                                 when 'accept' then ' · yapay zekâ: kabul öneriyor'
                                 else '' end,
                   null, '/egitmen/mufredatlar/' || cp.curriculum_id::text
              from public.curriculum_proposals cp
              join public.curricula cu on cu.id = cp.curriculum_id
             where cp.status = 'open'
               and (v_admin or cu.created_by = v_me
                    or exists (select 1 from public.courses co where co.curriculum_id = cp.curriculum_id and app.can_teach_course(co.id)))
          ) as x
          order by x.created_at desc, x.id
          limit 100) as q;
  return v_out;
end
$$;
comment on function public.instructor_queue() is 'Eğitmen/admin: insan kararı bekleyen işler (koç yönlendirmesi, tavanda duran üretim, incelemedeki belge, eşik altı ders iddiaları, açık müfredat önerileri), en yeni önce en çok 100; eğitmende bağlı öğrenciler ve kendi dersleri/müfredatları; diğerlerine OGR-AUTH-002.';

-- Eğitmen/admin: koç yönlendirmesini okundu yapar; yeni işaretlendiyse true, zaten okunmuşsa false.
create or replace function public.resolve_instructor_note(p_id uuid) returns boolean
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_n public.notifications%rowtype;
  v_student uuid;
begin
  if not app.is_staff() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 koç notunu yalnız eğitmen ya da admin kapatır';
  end if;
  select n.* into v_n from public.notifications n where n.id = p_id and n.kind = 'coach_escalation' for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-QUEUE-001 koç notu bulunamadı';
  end if;
  if v_n.payload ->> 'student_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_student := (v_n.payload ->> 'student_id')::uuid;
  end if;
  if not (app.is_admin() or v_n.recipient_id = auth.uid() or v_student in (select app.my_students())) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 bu koç notu kapsamın dışında';
  end if;
  if v_n.read_at is not null then
    return false;
  end if;
  update public.notifications n set read_at = now() where n.id = p_id;
  return true;
end
$$;
comment on function public.resolve_instructor_note(uuid) is 'Eğitmen/admin: koç yönlendirmesini (coach_escalation bildirimi) okundu yapar; kapsam: admin, alıcı ya da bağlı eğitmen; diğerlerine OGR-AUTH-002.';

-- Eğitmen/admin: tavanda duran isteğe tek seferlik muafiyet; onay kaydedilir, istek queued'a döner ve iş yeniden kuyruğa
-- girer. Zaten onaylıysa no-op ({approved: false, already: true}).
create or replace function public.approve_spend_capped_request(p_kind text, p_id uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_h public.spend_cap_holds%rowtype;
  v_r public.document_requests%rowtype;
  v_job uuid;
begin
  if not app.is_staff() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 üretim onayını yalnız eğitmen ya da admin verir';
  end if;
  if coalesce(p_kind, '') <> 'document' then
    raise exception using errcode = 'P0001', message = format('OGR-QUEUE-002 desteklenmeyen tür %s', coalesce(p_kind, '(boş)'));
  end if;
  select h.* into v_h from public.spend_cap_holds h where h.kind = p_kind and h.request_id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-QUEUE-001 harcama tavanında duran istek bulunamadı';
  end if;
  select dr.* into v_r from public.document_requests dr where dr.id = p_id for update;
  if not (app.is_admin() or v_r.student_id in (select app.my_students())
          or (v_r.student_id is null and app.can_teach_course(v_r.course_id))) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 bu istek kapsamın dışında';
  end if;
  if v_h.approved_at is not null then
    return jsonb_build_object('request_id', p_id, 'approved', false, 'already', true, 'job_id', v_h.job_id);
  end if;
  if v_r.status <> 'failed' then
    raise exception using errcode = 'P0001', message = format('OGR-QUEUE-001 istek tavanda durmuyor (%s)', v_r.status);
  end if;

  update public.generated_documents gd set status = 'queued' where gd.id = v_r.generated_document_id and gd.status = 'failed';
  update public.document_requests dr set status = 'queued', error = null where dr.id = p_id;
  v_job := public.enqueue_job('document.generate', jsonb_strip_nulls(jsonb_build_object(
             'document_id', v_r.generated_document_id, 'request_id', v_r.id, 'kind', v_r.kind, 'student_id', v_r.student_id)));
  update public.document_requests dr set job_id = v_job where dr.id = p_id;
  update public.spend_cap_holds h set approved_by = auth.uid(), approved_at = now(), job_id = v_job where h.id = v_h.id;
  perform app.audit_event('spend_cap.approved', 'spend_cap_holds', v_h.id::text,
                          jsonb_build_object('kind', p_kind, 'request_id', p_id, 'job_id', v_job));
  return jsonb_build_object('request_id', p_id, 'approved', true, 'already', false, 'job_id', v_job);
end
$$;
comment on function public.approve_spend_capped_request(text, uuid) is 'Eğitmen/admin: harcama tavanında duran belge isteğine tek seferlik muafiyet (onaylayan + zaman spend_cap_holds''ta), istek queued, document.generate yeniden kuyrukta; ikinci çağrı no-op; kapsam dışı OGR-AUTH-002.';

revoke all on function public.record_spend_cap_hold(text, uuid), public.consume_spend_cap_approval(text, uuid) from public, anon, authenticated;
grant execute on function public.record_spend_cap_hold(text, uuid), public.consume_spend_cap_approval(text, uuid) to service_role;
revoke all on function public.instructor_queue(), public.resolve_instructor_note(uuid), public.approve_spend_capped_request(text, uuid)
  from public, anon;
grant execute on function public.instructor_queue(), public.resolve_instructor_note(uuid), public.approve_spend_capped_request(text, uuid)
  to authenticated;
