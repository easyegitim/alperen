-- 0034_document_requests.sql — içerik stüdyosu (P3) veri modeli: belge istekleri, doğrulama merdiveni + inceleme kapısı
-- alanları, üretilmiş deneme sorusunun satır içi şekli (docs/PLAN-v2.md §2 Akış 5, §7 içerik kalite hattı, §13 Belgeler;
-- docs/PLAN-v2-detail.md §2.3, §2.4, §4).
--   document_requests                   not / deneme / soru seti isteği (koç sohbeti, Bugün önerisi, eğitmen) ve üretim
--                                       işinin durumu queued → generating → verifying → (review) → ready | failed.
--   generated_documents (+)             review_required, published_at, reviewed_by/at, review_note; verification nesne.
--                                       Yayın kapısı (tetikleyici): incelemesi gereken belge onaysız 'published' olamaz;
--                                       üretim hattı belgesi (P3) 'review' ya da 'published'a yalnız document_set_status /
--                                       review_document ile geçer.
--   generated_documents_select (yeni)   incelemede bekleyen belge ve yayımlanmamış üretim hattı belgesi (not, deneme, soru seti:
--                                       queued, generating, review, failed) öğrenciye/veliye görünmez; ders geneli belge yalnız
--                                       dersin eğitmenine (app.can_teach_course) ve admine.
--   exam_questions (+)                  figure_svg, figure_alt: üretilmiş denemede AST'nin satır içi SVG şekli
--                                       (v_exam_questions_student sonuna eklenir).
--   request_document(p_kind, p_spec, p_source, p_message_id)   0017'deki 5 argümanlı sürümün yerine (çağıran yoktu).
--   document_request_view(p_id)         isteğin durumu ve belgesi (öğrenci, veli yalnız hazır, bağlı eğitmen).
-- RPC'lerin geri kalanı (worker durumu, inceleme, denemeye çevirme, kişiselleştirme) 0035_document_pipeline.sql'dedir.

create table public.document_requests (  -- Belge istekleri (not, deneme, soru seti): kaynak (sohbet, öneri, eğitmen), kapsam ve üretim işinin durumu.
  id uuid primary key default gen_random_uuid(),  -- İstek kimliği
  student_id uuid references public.students (id) on delete cascade,  -- Kişiye özel isteğin öğrencisi (ders geneli: boş)
  enrollment_id uuid references public.enrollments (id) on delete cascade,  -- Öğrencinin kaydı (ders geneli: boş)
  course_id uuid references public.courses (id) on delete cascade,  -- Ders
  kind text not null check (kind in ('notes', 'mock_exam', 'question_set')),  -- Belge türü
  spec jsonb not null default '{}' check (jsonb_typeof(spec) = 'object'),  -- Kapsam: topic, skill_ids, length, difficulty, include_my_mistakes, question_count, duration_min, title
  source text not null check (source in ('chat', 'suggestion', 'instructor')),  -- İsteğin kaynağı
  conversation_message_id bigint references public.conversation_messages (id) on delete set null,  -- İsteği doğuran koç sohbeti mesajı
  status text not null default 'queued' check (status in ('queued', 'generating', 'verifying', 'review', 'ready', 'failed')),  -- Üretim durumu
  generated_document_id uuid references public.generated_documents (id) on delete set null,  -- Üretilen belge
  error text check (char_length(error) <= 500),  -- Hata (failed; öğrenciye ham gösterilmez)
  requested_by uuid references public.profiles (id) on delete set null,  -- İsteyen profil
  job_id uuid,  -- document.generate işinin kimliği (kuyruk yoksa boş)
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  updated_at timestamptz not null default now(),  -- Son güncelleme
  check ((student_id is null) = (enrollment_id is null))
);
-- begin comments public.document_requests
comment on table public.document_requests is 'Belge istekleri (not, deneme, soru seti): kaynak (sohbet, öneri, eğitmen), kapsam ve üretim işinin durumu.';
comment on column public.document_requests.id is 'İstek kimliği';
comment on column public.document_requests.student_id is 'Kişiye özel isteğin öğrencisi (ders geneli: boş)';
comment on column public.document_requests.enrollment_id is 'Öğrencinin kaydı (ders geneli: boş)';
comment on column public.document_requests.course_id is 'Ders';
comment on column public.document_requests.kind is 'Belge türü';
comment on column public.document_requests.spec is 'Kapsam: topic, skill_ids, length, difficulty, include_my_mistakes, question_count, duration_min, title';
comment on column public.document_requests.source is 'İsteğin kaynağı';
comment on column public.document_requests.conversation_message_id is 'İsteği doğuran koç sohbeti mesajı';
comment on column public.document_requests.status is 'Üretim durumu';
comment on column public.document_requests.generated_document_id is 'Üretilen belge';
comment on column public.document_requests.error is 'Hata (failed; öğrenciye ham gösterilmez)';
comment on column public.document_requests.requested_by is 'İsteyen profil';
comment on column public.document_requests.job_id is 'document.generate işinin kimliği (kuyruk yoksa boş)';
comment on column public.document_requests.created_at is 'Oluşturulma zamanı';
comment on column public.document_requests.updated_at is 'Son güncelleme';
-- end comments public.document_requests
create index document_requests_student on public.document_requests (student_id, created_at desc);
create index document_requests_course on public.document_requests (course_id, created_at desc);
create index document_requests_document on public.document_requests (generated_document_id);
-- aynı sohbet mesajından aynı türde ikinci istek açılmaz (koç aracı yeniden denerse aynı istek döner); aynı turda not +
-- deneme iki ayrı istektir
create unique index document_requests_message on public.document_requests (conversation_message_id, kind) where conversation_message_id is not null;
alter table public.document_requests enable row level security;
alter table public.document_requests force row level security;
create trigger touch_updated_at before update on public.document_requests
for each row execute function app.touch_updated_at();

-- --- generated_documents: doğrulama merdiveni + inceleme kapısı ------------------------------------------------------

alter table public.generated_documents add column review_required boolean not null default false;  -- Yayından önce eğitmen onayı gerekir (sınıfa dağıtılacak deneme)
alter table public.generated_documents add column published_at timestamptz;  -- Yayımlanma zamanı (status = published)
alter table public.generated_documents add column reviewed_by uuid references public.profiles (id) on delete set null;  -- İnceleyen eğitmen
alter table public.generated_documents add column reviewed_at timestamptz;  -- İnceleme zamanı (onay ya da ret)
alter table public.generated_documents add column review_note text check (char_length(review_note) <= 1000);  -- İnceleme notu
alter table public.generated_documents add constraint generated_documents_verification_object
check (verification is null or jsonb_typeof(verification) = 'object');
comment on column public.generated_documents.review_required is 'Yayından önce eğitmen onayı gerekir (sınıfa dağıtılacak deneme)';
comment on column public.generated_documents.published_at is 'Yayımlanma zamanı (status = published)';
comment on column public.generated_documents.reviewed_by is 'İnceleyen eğitmen';
comment on column public.generated_documents.reviewed_at is 'İnceleme zamanı (onay ya da ret)';
comment on column public.generated_documents.review_note is 'İnceleme notu (personel; onaylı belgede satır RLS ile öğrenciye de açılır, öğrenci arayüzü ve RPC''ler göstermez; ret yolunda belge gizli kalır).';
comment on column public.generated_documents.verification is 'Doğrulama merdiveni: {schema, sympy, figures, duplicates, personalization, review: {status pass|fail|skipped|pending, …}, regen: [{block_id, step, reason, attempt, at}]}';

-- Yayın kapısı: incelemesi gereken belge (review_required) eğitmen onayı olmadan (reviewed_at + verification.review.status
-- = 'pass'; yalnız review_document yazar) 'published' olamaz; yayımlanan belgenin published_at'i dolar.
-- register_generated_document ya da doğrudan yazım da bu kapıdan geçer. İnceleme şartını yalnız admin kaldırır.
-- Üretim hattı belgesi (notes | mock_exam | question_set; document_requests satırı ya da created_by var) 'review' ya da
-- 'published'a yalnız merdiven kapısından geçer: document_set_status / app.document_publish işlem içi
-- app.document_transition = 'on' ayarıyla yazar; register_generated_document ya da doğrudan UPDATE ile geçiş OGR-DOC-006
-- (merdiveni atlayıp istek satırını geride bırakırdı). Rapor ve isteksiz (eski yol) belgeler etkilenmez.
create or replace function app.generated_documents_publish_guard() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if new.status = 'published' then
    if new.review_required and (new.reviewed_at is null or coalesce(new.verification -> 'review' ->> 'status', '') <> 'pass') then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-007 incelemesi gereken belge eğitmen onayı olmadan yayımlanamaz';
    end if;
    if new.published_at is null then
      new.published_at := now();
    end if;
  end if;
  if new.status in ('review', 'published') and new.kind in ('notes', 'mock_exam', 'question_set')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and coalesce(current_setting('app.document_transition', true), '') <> 'on'
     and (new.created_by is not null
          or exists (select 1 from public.document_requests dr where dr.generated_document_id = new.id)) then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-006 durum yalnız document_set_status ile (%s)', new.status);
  end if;
  if tg_op = 'UPDATE' and old.review_required and not new.review_required and not app.is_admin() then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-007 inceleme şartı kaldırılamaz';
  end if;
  return new;
end
$$;
comment on function app.generated_documents_publish_guard() is 'BEFORE INSERT/UPDATE: review_required belge onaysız (verification.review.status = pass) published olamaz (OGR-DOC-007); üretim hattı belgesi review/published''a yalnız document_set_status ile geçer (OGR-DOC-006); yayında published_at dolar; şartı yalnız admin kaldırır.';
revoke all on function app.generated_documents_publish_guard() from public;
create trigger generated_documents_publish_guard before insert or update of status, review_required, reviewed_at, published_at
on public.generated_documents
for each row execute function app.generated_documents_publish_guard();

-- --- exam_questions: üretilmiş denemenin satır içi şekli ----------------------------------------------------------------

alter table public.exam_questions add column figure_svg text check (char_length(figure_svg) <= 60000);  -- Satır içi SVG şekil (üretilmiş deneme; belge AST'sinden)
alter table public.exam_questions add column figure_alt text check (char_length(figure_alt) <= 400);  -- Şeklin metin anlatımı
comment on column public.exam_questions.figure_svg is 'Satır içi SVG şekil (üretilmiş deneme; belge AST''sinden)';
comment on column public.exam_questions.figure_alt is 'Şeklin metin anlatımı';

-- v_exam_questions_student: 0030 tanımı + sona figure_svg, figure_alt (istemci <img src="data:image/svg+xml,…"> ile
-- gösterir; betik içeren SVG mock_exam_from_document'ta reddedilir)
create or replace view public.v_exam_questions_student with (security_barrier = true) as
select q.id,
       q.exam_id,
       q.no,
       q.section,
       q.kind,
       case when x.is_copyrighted then null else q.stem_text end as stem_text,
       case when jsonb_typeof(q.options) <> 'array' then q.options
            else (select jsonb_agg(case when x.is_copyrighted then jsonb_build_object('key', o.opt -> 'key')
                                        else o.opt - 'misconception_tag' end order by o.ord)
                    from jsonb_array_elements(q.options) with ordinality as o (opt, ord)) end as options,
       x.is_copyrighted,
       q.figure_upload_id,
       q.skill_ids,
       q.style_id,
       q.difficulty,
       q.page_upload_id,
       q.bbox,
       case when x.is_copyrighted then null else q.figure_svg end as figure_svg,
       q.figure_alt
  from public.exam_questions as q
  join public.exams as x on x.id = q.exam_id
 where app.is_trusted()
    or (app.is_staff() and app.can_read_exam(q.exam_id))
    or exists (select 1 from public.exam_sessions as es join public.enrollments as e on e.id = es.enrollment_id
                where es.exam_id = q.exam_id and e.student_id = app.my_student_id());
comment on view public.v_exam_questions_student is 'Öğrencinin oturumu olan sınavların soruları (personel: app.can_read_exam); telifli sınavda soru metni, şık metinleri ve satır içi şekil maskeli, yanılgı etiketleri yok; kitapçık kırpımı (page_upload_id, bbox) ve üretilmiş denemenin şekli (figure_svg, figure_alt) görünür.';

-- --- dersin eğitmeni (politikalar ve RPC'ler kullanır) ---------------------------------------------------------------

-- Dersin eğitmeni mi (ders geneli belge isteği ve incelemesi): worker, admin; eğitmende dersi açan ya da derse bağlı
-- (instructor_links.course_id). app.can_edit_exam'in ders dalıyla aynı kural.
create or replace function app.can_teach_course(p_course uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if p_course is null then
    return false;
  end if;
  if app.is_trusted() or app.is_admin() then
    return true;
  end if;
  if app.role() is distinct from 'instructor' then
    return false;
  end if;
  return exists (select 1 from public.courses co where co.id = p_course and co.created_by = auth.uid())
      or exists (select 1 from public.instructor_links il where il.instructor_id = auth.uid() and il.course_id = p_course);
end
$$;
comment on function app.can_teach_course(uuid) is 'Dersin eğitmeni mi: worker, admin; eğitmende dersi açan ya da instructor_links.course_id ile bağlı.';

-- --- RLS ----------------------------------------------------------------------------------------------------------------

-- Belge istekleri: öğrencinin kendisi ve bağlı eğitmen (can_read_student_data), ders geneli istek: dersin eğitmeni
-- (app.can_teach_course); isteyen her zaman. Veli satırı okumaz (kapsam, hata, sohbet mesajı taşır): çocuğunun hazır
-- isteğini document_request_view'un kısaltılmış biçimiyle görür. Yazımlar yalnız RPC ile.
grant select on public.document_requests to authenticated;
create policy document_requests_select on public.document_requests for select to authenticated
using (app.is_admin()
       or requested_by = auth.uid()
       or (student_id is not null and app.can_read_student_data(student_id))
       or (student_id is null and app.can_teach_course(course_id)));

-- Üretim hattı belgesi yayımlanmadan (queued, generating, verifying, review, failed) personel dışına kapalıdır: içerik ve PDF
-- yolu öğrenciye RLS ile, Storage 'documents' nesnelerine de (ogrenmen_documents_select bu politikayı izler) açılmaz. Yayımlanmış
-- (published) ve eski yolun 'rendered' belgeleri aynen kalır; üretim hattı 'rendered' durumuna hiç geçmez.
create or replace function app.document_pipeline_unpublished(p_kind text, p_status text) returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_kind in ('notes', 'mock_exam', 'question_set') and p_status not in ('published', 'rendered')
$$;
comment on function app.document_pipeline_unpublished(text, text) is 'Üretim hattı belgesi (not, deneme, soru seti) henüz yayımlanmamış mı: öğrenci ve veli görmez (RLS, Storage, list_my_documents, document_request_json).';
revoke all on function app.document_pipeline_unpublished(text, text) from public;
grant execute on function app.document_pipeline_unpublished(text, text) to authenticated, service_role;

-- 0018 generated_documents_select + inceleme kapısı: review_required belge yayımlanana dek yalnız personele görünür
-- (öğrencinin kendi isteği de dahil; Storage 'documents' nesneleri bu politikayı izler). Ders geneli belge yayımlanana dek
-- yalnız dersin eğitmenine (app.can_teach_course; admin dahil); yayımlanmış ders belgesi personele ve dersi görebilen
-- öğrenciye (0018 gibi).
drop policy generated_documents_select on public.generated_documents;
create policy generated_documents_select on public.generated_documents for select to authenticated
using ((kind <> 'answer_key' or app.is_staff())
       and (app.is_staff() or not review_required or status = 'published')
       and (app.is_staff() or not app.document_pipeline_unpublished(kind, status))
       and (created_by = auth.uid()
            or app.is_admin()
            or (student_id is not null and app.can_read_student_data(student_id))
            or (kind = 'report' and student_id in (select c.sid from app.my_children() as c (sid)))
            or (student_id is null
                and (app.can_teach_course(course_id)
                     or (status = 'published'
                         and (app.is_staff() or (app.role() is distinct from 'parent' and app.can_read_course(course_id))))))));

-- --- yardımcılar ------------------------------------------------------------------------------------------------------

-- Bugün kartı ve bildirim başlığı (apps/worker suggestions/rules.ts DOC_TITLE ile aynı metin; başlık ≤ 60 kırpılır).
-- Ders geneli belge (p_personal false) bir öğrencinin değil sınıfın belgesidir: "Bölünebilme notu hazır", "Yeni deneme hazır".
create or replace function app.document_ready_title(p_kind text, p_title text, p_personal boolean) returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select left(case p_kind
                when 'notes' then left(p_title, 60) || case when p_personal then ' notun hazır' else ' notu hazır' end
                when 'mock_exam' then case when p_personal then 'Denemen hazır' else 'Yeni deneme hazır' end
                when 'question_set' then left(p_title, 60) || case when p_personal then ' soruların hazır' else ' soruları hazır' end
                when 'report' then 'Raporun hazır'
                else left(p_title, 60) || ' hazır'
              end, 120)
$$;
comment on function app.document_ready_title(text, text, boolean) is 'document_ready kartı/bildirimi başlığı (worker DOC_TITLE eşleniği): kişisel "Rasyonel sayılar notun hazır", ders geneli "Rasyonel sayılar notu hazır".';

-- İsteğin dışarı verilen biçimi. Yayımlanmamış üretim hattı belgesinin ve inceleme bekleyen belgenin yolları personel dışına
-- gizlenir; p_parent: veli için kısaltılmış biçim (kapsam, hata, belge yolları yok). İnceleme metni ("Hocan inceliyor") yalnız
-- incelemeye yetkili bir eğitmen varsa; yoksa (admin bildirilir) "Son kontrolden geçiyor".
create or replace function app.document_request_json(p_id uuid, p_parent boolean) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_r public.document_requests%rowtype;
  v_d public.generated_documents%rowtype;
  v_exam uuid;
  v_line text;
  v_masked boolean;
begin
  select dr.* into v_r from public.document_requests dr where dr.id = p_id;
  if not found then
    return null;
  end if;
  if v_r.generated_document_id is not null then
    select gd.* into v_d from public.generated_documents gd where gd.id = v_r.generated_document_id;
    select x.id into v_exam from public.exams x
     where x.generated_document_id = v_r.generated_document_id and x.status in ('ready', 'published')
     order by x.created_at desc limit 1;
  end if;
  v_masked := v_d.id is not null
              and ((v_d.review_required and v_d.status <> 'published') or app.document_pipeline_unpublished(v_d.kind, v_d.status))
              and not (app.is_trusted() or app.is_staff());
  v_line := case v_r.status
              when 'queued' then 'Sıraya aldım'
              when 'generating' then 'Hazırlıyorum'
              when 'verifying' then 'Kontrol ediyorum'
              when 'review' then case when v_d.id is not null and cardinality(app.document_reviewers(v_d.id)) > 0
                                      then 'Hocan inceliyor' else 'Son kontrolden geçiyor' end
              when 'ready' then 'Hazır'
              else 'Hazırlayamadım; tekrar isteyebilirsin'
            end;
  if p_parent then
    return jsonb_build_object('request_id', v_r.id, 'kind', v_r.kind, 'status', v_r.status, 'status_line', v_line,
                              'title', v_d.title, 'student_id', v_r.student_id, 'course_id', v_r.course_id,
                              'created_at', v_r.created_at, 'updated_at', v_r.updated_at);
  end if;
  return jsonb_build_object(
    'request_id', v_r.id, 'kind', v_r.kind, 'status', v_r.status, 'status_line', v_line, 'source', v_r.source,
    'spec', v_r.spec, 'student_id', v_r.student_id, 'enrollment_id', v_r.enrollment_id, 'course_id', v_r.course_id,
    'conversation_message_id', v_r.conversation_message_id, 'error', case when v_r.status = 'failed' then v_r.error end,
    'created_at', v_r.created_at, 'updated_at', v_r.updated_at, 'exam_id', v_exam,
    'document', case when v_d.id is null then null
                     else jsonb_build_object('id', v_d.id, 'title', v_d.title, 'status', v_d.status, 'version', v_d.version,
                                             'pdf_path', case when v_masked then null else v_d.pdf_path end,
                                             'html_path', case when v_masked then null else v_d.html_path end,
                                             'review_required', v_d.review_required, 'published_at', v_d.published_at) end);
end
$$;
comment on function app.document_request_json(uuid, boolean) is 'document_requests satırının istemci biçimi (durum satırı, belge, deneme); yayımlanmamış üretim hattı ve inceleme bekleyen belgenin yolları personel dışına gizli; veli: kısaltılmış.';

-- --- RPC: belge isteği -------------------------------------------------------------------------------------------------

drop function public.request_document(text, uuid, uuid, text, jsonb);

-- Not / deneme / soru seti isteği (Akış 5): kapsamı doğrular ve normalleştirir, generated_documents (queued) + istek
-- satırı açar, 'document.generate {document_id, request_id, kind, student_id}' işini kuyruğa atar.
--   Kim: öğrenci kendisi için (kaynak chat | suggestion; günlük yumuşak sınır settings.documents_daily_max = 3: başarısız
--        istekler ve eğitmen istekleri sayılmaz, OGR-DOC-004); owner eğitmen / admin p_spec.enrollment_id ya da
--        p_spec.student_id ile (kaynak instructor), ders geneli p_spec.course_id ile (dersin eğitmeni; incelemeli);
--        worker her kaynakla. Veli OGR-AUTH-001.
--   p_spec: topic (≤ 120), skill_ids[] (≤ 12; kaydın müfredatında), length short|medium|long, difficulty
--        easy|medium|hard|mixed, include_my_mistakes (kişisel notta varsayılan true; ders genelinde false), question_count
--        (not 0–10 kendini sına, soru seti 1–40, deneme 5–40: üretim üst sınırı packages/prompts MAX_EXAM_QUESTIONS), duration_min (deneme 1–600), title (≤ 120), review
--        (yalnız personel: incelemeli). Not ve soru setinde topic ya da skill_ids gerekir. Geçersiz alan OGR-DOC-005;
--        bilinmeyen anahtar atılır.
--   p_message_id: koç sohbeti mesajı (yalnız source = chat; öğrencinin sohbeti). Aynı mesaj + aynı türle ikinci çağrı
--        aynı isteği döner (reused = true); aynı mesajdan farklı tür (not + deneme) ayrı istektir. Mesaj başına danışma
--        kilidi eşzamanlı iki çağrıyı sıraya koyar (ikincisi reused döner, ham 23505 yok).
-- Döner: document_request_view biçimi + {job_id, reused}.
create or replace function public.request_document(
  p_kind text, p_spec jsonb default '{}'::jsonb, p_source text default 'chat', p_message_id bigint default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_me uuid := app.my_student_id();
  v_trusted boolean := app.is_trusted();
  v_spec jsonb := coalesce(p_spec, '{}'::jsonb);
  v_student uuid;
  v_enr public.enrollments%rowtype;
  v_course uuid;
  v_cur uuid;
  v_prev public.document_requests%rowtype;
  v_out jsonb := '{}'::jsonb;
  v_topic text;
  v_title text;
  v_skills text[];
  v_bad text;
  v_count int;
  v_len text;
  v_diff text;
  v_mistakes boolean;
  v_duration int;
  v_review boolean := false;
  v_max int;
  v_used int;
  v_doc uuid;
  v_req uuid;
  v_job uuid;
begin
  if p_kind is null or p_kind not in ('notes', 'mock_exam', 'question_set') then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-001 geçersiz belge türü %s', coalesce(p_kind, '(boş)'));
  end if;
  if p_source is null or p_source not in ('chat', 'suggestion', 'instructor') then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-005 geçersiz kaynak %s', coalesce(p_source, '(boş)'));
  end if;
  if jsonb_typeof(v_spec) <> 'object' then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-005 kapsam (p_spec) nesne olmalı';
  end if;
  foreach v_bad in array array['enrollment_id', 'student_id', 'course_id'] loop
    if v_spec ? v_bad and jsonb_typeof(v_spec -> v_bad) <> 'null'
       and coalesce(v_spec ->> v_bad, '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception using errcode = 'P0001', message = format('OGR-DOC-005 %s geçersiz', v_bad);
    end if;
  end loop;

  -- hedef: öğrenci + kayıt ya da ders geneli
  if v_me is not null and not v_trusted then
    if p_source = 'instructor' then
      raise exception using errcode = '42501', message = 'OGR-AUTH-002 eğitmen kaynağını yalnız personel kullanır';
    end if;
    if nullif(v_spec ->> 'student_id', '') is not null and (v_spec ->> 'student_id')::uuid <> v_me then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 öğrenci yalnız kendisi için belge ister';
    end if;
    v_student := v_me;
    if nullif(v_spec ->> 'enrollment_id', '') is not null then
      select e.* into v_enr from public.enrollments e where e.id = (v_spec ->> 'enrollment_id')::uuid;
      if not found or v_enr.student_id <> v_me then
        raise exception using errcode = '42501', message = 'OGR-AUTH-001 kayıt öğrencinin değil';
      end if;
    end if;
  elsif app.role() = 'parent' and not v_trusted then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 veli belge isteyemez (rapor ayrı yoldan)';
  elsif v_trusted or app.is_staff() then
    if not v_trusted and p_source <> 'instructor' then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-005 personel isteğinin kaynağı instructor olmalı';
    end if;
    if nullif(v_spec ->> 'enrollment_id', '') is not null then
      select e.* into v_enr from public.enrollments e where e.id = (v_spec ->> 'enrollment_id')::uuid;
      if not found then
        raise exception using errcode = 'P0001', message = 'OGR-DOC-005 kayıt bulunamadı';
      end if;
      v_student := v_enr.student_id;
      perform app.assert_student_access(v_student, true);
    elsif nullif(v_spec ->> 'student_id', '') is not null then
      v_student := (v_spec ->> 'student_id')::uuid;
      perform app.assert_student_access(v_student, true);
    elsif nullif(v_spec ->> 'course_id', '') is not null then
      v_course := (v_spec ->> 'course_id')::uuid;
      if not exists (select 1 from public.courses co where co.id = v_course) then
        raise exception using errcode = 'P0001', message = 'OGR-DOC-005 ders bulunamadı';
      end if;
      if not app.can_teach_course(v_course) then
        raise exception using errcode = '42501', message = 'OGR-AUTH-002 ders geneli belgeyi yalnız dersin eğitmeni ister';
      end if;
    else
      raise exception using errcode = 'P0001', message = 'OGR-DOC-005 öğrenci, kayıt ya da ders gerekli';
    end if;
  else
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 belge isteği için oturum gerekli';
  end if;

  if v_student is not null and v_enr.id is null then
    select e.* into v_enr from public.enrollments e
     where e.student_id = v_student and e.status = 'active'
       and (nullif(v_spec ->> 'course_id', '') is null or e.course_id = (v_spec ->> 'course_id')::uuid)
     order by e.started_at desc, e.created_at desc, e.id limit 1;
    if not found then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-006 etkin kayıt yok';
    end if;
  end if;
  if v_enr.id is not null then
    if v_enr.status <> 'active' then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-006 kayıt etkin değil';
    end if;
    v_course := v_enr.course_id;
    v_cur := v_enr.curriculum_id;
  else
    select co.curriculum_id into v_cur from public.courses co where co.id = v_course;
  end if;

  -- sohbet mesajı: yalnız chat; öğrencinin koç sohbeti; aynı mesaj → aynı istek
  if p_message_id is not null then
    if p_source <> 'chat' or v_student is null then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-005 sohbet mesajı yalnız sohbet kaynaklı kişisel istekte';
    end if;
    if not exists (select 1 from public.conversation_messages cm join public.conversations cv on cv.id = cm.conversation_id
                    where cm.id = p_message_id and cv.student_id = v_student and cv.kind = 'coach') then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 mesaj öğrencinin koç sohbetinde değil';
    end if;
    perform pg_advisory_xact_lock(hashtext('document_requests:msg:' || p_message_id::text));
    select dr.* into v_prev from public.document_requests dr
     where dr.conversation_message_id = p_message_id and dr.kind = p_kind;
    if found then
      return app.document_request_json(v_prev.id, false)
             || jsonb_build_object('job_id', v_prev.job_id, 'reused', true);
    end if;
  end if;

  -- kapsam
  v_topic := nullif(btrim(v_spec ->> 'topic'), '');
  if v_topic is not null and char_length(v_topic) > 120 then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-005 konu en çok 120 karakter';
  end if;
  v_title := nullif(btrim(v_spec ->> 'title'), '');
  if v_title is not null and char_length(v_title) > 120 then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-005 başlık en çok 120 karakter';
  end if;
  if v_spec ? 'skill_ids' and jsonb_typeof(v_spec -> 'skill_ids') <> 'null' then
    if jsonb_typeof(v_spec -> 'skill_ids') <> 'array' or jsonb_array_length(v_spec -> 'skill_ids') > 12
       or exists (select 1 from jsonb_array_elements(v_spec -> 'skill_ids') as s (v) where jsonb_typeof(s.v) <> 'string') then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-005 skill_ids en çok 12 metinlik dizi olmalı';
    end if;
    select array_agg(distinct s.v) into v_skills from jsonb_array_elements_text(v_spec -> 'skill_ids') as s (v);
    select string_agg(x.sid, ', ') into v_bad from unnest(v_skills) as x (sid)
     where v_cur is null or not exists (select 1 from public.skills sk where sk.curriculum_id = v_cur and sk.id = x.sid);
    if v_bad is not null then
      raise exception using errcode = 'P0001', message = format('OGR-DOC-005 kazanım bu müfredatta yok: %s', left(v_bad, 200));
    end if;
  end if;
  v_skills := coalesce(v_skills, '{}');
  if p_kind in ('notes', 'question_set') and v_topic is null and cardinality(v_skills) = 0 then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-005 not ve soru seti için konu ya da kazanım gerekli';
  end if;
  v_len := coalesce(nullif(v_spec ->> 'length', ''), 'medium');
  v_diff := coalesce(nullif(v_spec ->> 'difficulty', ''), case when p_kind = 'notes' then 'medium' else 'mixed' end);
  if v_len not in ('short', 'medium', 'long') or v_diff not in ('easy', 'medium', 'hard', 'mixed') then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-005 uzunluk short|medium|long, zorluk easy|medium|hard|mixed';
  end if;
  if v_spec ? 'include_my_mistakes' and jsonb_typeof(v_spec -> 'include_my_mistakes') not in ('boolean', 'null') then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-005 include_my_mistakes mantıksal olmalı';
  end if;
  v_mistakes := v_student is not null and coalesce((v_spec ->> 'include_my_mistakes')::boolean, p_kind = 'notes');
  if v_spec ? 'question_count' and jsonb_typeof(v_spec -> 'question_count') <> 'null' then
    if jsonb_typeof(v_spec -> 'question_count') <> 'number' or (v_spec ->> 'question_count') !~ '^[0-9]{1,3}$' then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-005 question_count tam sayı olmalı';
    end if;
    v_count := (v_spec ->> 'question_count')::int;
  end if;
  v_count := coalesce(v_count, case p_kind when 'notes' then 5 when 'question_set' then 10 else 40 end);
  if (p_kind = 'notes' and v_count not between 0 and 10) or (p_kind = 'question_set' and v_count not between 1 and 40)
     or (p_kind = 'mock_exam' and v_count not between 5 and 40) then
    raise exception using errcode = 'P0001', message = format('OGR-DOC-005 soru sayısı bu tür için aralık dışında: %s', v_count);
  end if;
  if v_spec ? 'duration_min' and jsonb_typeof(v_spec -> 'duration_min') <> 'null' then
    if p_kind <> 'mock_exam' or jsonb_typeof(v_spec -> 'duration_min') <> 'number' or (v_spec ->> 'duration_min') !~ '^[0-9]{1,3}$'
       or (v_spec ->> 'duration_min')::int not between 1 and 600 then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-005 duration_min yalnız denemede 1–600 dk';
    end if;
    v_duration := (v_spec ->> 'duration_min')::int;
  end if;
  if v_spec ? 'review' and jsonb_typeof(v_spec -> 'review') <> 'null' then
    if jsonb_typeof(v_spec -> 'review') <> 'boolean' or ((v_spec ->> 'review')::boolean and not (v_trusted or app.is_staff())) then
      raise exception using errcode = 'P0001', message = 'OGR-DOC-005 review yalnız personel isteğinde (mantıksal)';
    end if;
    v_review := (v_spec ->> 'review')::boolean;
  end if;
  -- sınıfa dağıtılacak (ders geneli) belge incelemeli; kişisel belge yalnız istenirse (docs/PLAN-v2.md §7)
  v_review := v_review or v_student is null;

  -- günlük yumuşak sınır (yalnız öğrencinin kendi istekleri; başarısızlar sayılmaz)
  if v_me is not null and not v_trusted then
    perform pg_advisory_xact_lock(hashtext('document_requests:' || v_student::text));
    v_max := app.setting_num('documents_daily_max', 3)::int;
    select count(*) into v_used from public.document_requests dr
     where dr.student_id = v_student and dr.source <> 'instructor' and dr.status <> 'failed'
       and dr.created_at >= (date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul');
    if v_used >= v_max then
      raise exception using errcode = 'P0001', message = format('OGR-DOC-004 bugünkü belge sınırı doldu (%s); yarın yeniden isteyebilirsin', v_max);
    end if;
  end if;

  if v_title is null then
    v_title := coalesce(v_topic,
                        (select sk.name from public.skills sk where sk.curriculum_id = v_cur and sk.id = v_skills[1]),
                        (select co.title from public.courses co where co.id = v_course), 'Belge');
    if p_kind = 'mock_exam' then
      v_title := case when v_topic is null then format('%s soruluk deneme', v_count) else format('%s · %s soruluk deneme', v_topic, v_count) end;
    end if;
    v_title := left(v_title, 120);
  end if;

  v_spec := jsonb_strip_nulls(jsonb_build_object(
    'topic', v_topic, 'skill_ids', to_jsonb(v_skills), 'length', v_len, 'difficulty', v_diff,
    'include_my_mistakes', v_mistakes, 'question_count', v_count, 'duration_min', v_duration, 'title', v_title,
    'review', v_review));

  insert into public.generated_documents (student_id, course_id, kind, title, spec, status, review_required, created_by)
  values (v_student, v_course, p_kind, v_title, v_spec || jsonb_build_object('source', p_source), 'queued', v_review, auth.uid())
  returning id into v_doc;
  insert into public.document_requests (student_id, enrollment_id, course_id, kind, spec, source, conversation_message_id,
                                        status, generated_document_id, requested_by)
  values (v_student, v_enr.id, v_course, p_kind, v_spec, p_source, p_message_id, 'queued', v_doc, auth.uid())
  returning id into v_req;
  v_job := app.try_enqueue('document.generate', jsonb_build_object('document_id', v_doc, 'request_id', v_req, 'kind', p_kind,
                                                                   'student_id', v_student));
  update public.document_requests dr set job_id = v_job where dr.id = v_req;
  v_out := app.document_request_json(v_req, false);
  return v_out || jsonb_build_object('job_id', v_job, 'reused', false);
end
$$;
comment on function public.request_document(text, jsonb, text, bigint) is 'Belge isteği (not, deneme, soru seti): kapsam doğrulanır; generated_documents (queued) + document_requests + document.generate işi; öğrencide günlük yumuşak sınır (documents_daily_max), ders geneli istek incelemeli.';

-- İsteğin durumu (bekleme ekranı / sohbet kartı): öğrenci (kendi), bağlı eğitmen, ders geneli istekte dersin eğitmeni,
-- admin, worker, isteyen; veli yalnız çocuğunun HAZIR isteğini kısaltılmış biçimde görür; diğerleri OGR-AUTH-001.
create or replace function public.document_request_view(p_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_r public.document_requests%rowtype;
begin
  select dr.* into v_r from public.document_requests dr where dr.id = p_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-DOC-001 istek bulunamadı';
  end if;
  if app.is_trusted() or app.is_admin()
     or (v_r.student_id is not null and app.can_read_student_data(v_r.student_id))
     or (v_r.student_id is null and app.can_teach_course(v_r.course_id))
     or coalesce(v_r.requested_by = auth.uid(), false) then
    return app.document_request_json(p_id, false);
  end if;
  if v_r.student_id is not null and v_r.status = 'ready'
     and exists (select 1 from app.my_children() as c (sid) where c.sid = v_r.student_id) then
    return app.document_request_json(p_id, true);
  end if;
  raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu belge isteği için yetki yok';
end
$$;
comment on function public.document_request_view(uuid) is 'Belge isteğinin durumu ve belgesi: öğrenci, bağlı eğitmen, admin, worker, isteyen; veli yalnız hazır isteği (kısaltılmış).';

revoke all on function app.can_teach_course(uuid), app.document_ready_title(text, text, boolean), app.document_request_json(uuid, boolean)
from public;
grant execute on function app.can_teach_course(uuid), app.document_ready_title(text, text, boolean) to authenticated, service_role;
revoke all on function public.request_document(text, jsonb, text, bigint), public.document_request_view(uuid) from public, anon;
grant execute on function public.request_document(text, jsonb, text, bigint), public.document_request_view(uuid) to authenticated, service_role;

-- --- Realtime ------------------------------------------------------------------------------------------------------------

-- Koç sohbetindeki "Hazırlıyorum…" kartı ve Belgelerim satırı isteği izler (RLS Realtime'da da geçerli; yerelde yayın yoksa
-- atlanır, istemci document_request_view ile yoklar).
do $$
begin
  if exists (select 1 from pg_publication p where p.pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables pt
                      where pt.pubname = 'supabase_realtime' and pt.schemaname = 'public' and pt.tablename = 'document_requests') then
    execute 'alter publication supabase_realtime add table public.document_requests';
  end if;
end
$$;
