-- 0036_style_library.sql — P4 tarz kütüphanesi ve soru tahmini, şema + yetki + kapsama (docs/PLAN-v2.md §11,
-- docs/PLAN-v2-detail.md §2.3–2.4). RPC'ler 0037'de (alım, madde kaydı, tarz yazımı, birleştirme, görünümler), öncelik
-- planı 0038'de.
--
-- Şema ekleri:
--   exam_sources.upload_ids (bir çıkmış sınavın birden çok sayfası/dosyası; upload_id ilkidir), exam_items.year/term
--   (kaynaktan doldurulur; arşivde bir kaynak farklı yılların maddelerini taşıyabilir), exam_items.skill_ids (exam-item
--   v2), questions.style_id (tarza özel üretilmiş soru → denemeleri kapsamaya sayılır), question_styles.syllabus_score /
--   priority_score (skor = 0.5·sıklık + 0.3·güncellik + 0.2·müfredat uyumu; 0037 app.refresh_style_scores yazar),
--   reviewed_by/reviewed_at (eğitmenin onayladığı ya da düzenlediği tarzın adını/tanımını worker yeniden kümelemede
--   ezmez), updated_at. exam_items.style_id 0009'dan beri vardır.
--
-- Yetki: çıkmış sınav arşivi (exam_sources, exam_items: ocr_text telifli soru metnidir) yalnız dersin arşivini okuyabilen
-- personeldir (app.can_read_course_archive: worker, admin, dersin eğitmeni, derse kayıtlı bir öğrenciye bağlı eğitmen);
-- 0018'deki "her eğitmen" kuralı daraltıldı. Öğrenci ve veli arşivi hiçbir yoldan okumaz; öğrenci tarz tanımını
-- question_styles'ın sütun yetkileriyle (exemplar_item_ids ve embedding hariç) ve style_library_view ile görür. Yazım
-- app.can_manage_course (worker, admin, dersin sahibi ya da derse bağlı eğitmen).
--
-- Kapsama (style_coverage) türetilmiştir: kaynak satırlar
--   attempts      → questions.style_id     (seen: her deneme, solved: notlanmış, correct: is_correct)
--   exam_responses → exam_questions.style_id (outcome correct|wrong|blank; solved: blank değil; correct)
--   solution_analyses.style_id, deneme bağlamı (exam_response_id) HARİÇ (o soru zaten exam_responses'ta sayıldı)
--                                            (solved: unreadable değil; correct: verdict correct)
-- Kaynak tablolardaki her değişiklik (ekleme, notlama, silme, tarz değişimi) tetikleyiciyle app.refresh_style_coverage'ı
-- çağırır; style_coverage'a yazılan her satırın sayaçları da BEFORE tetikleyicisinde kaynaklardan yeniden hesaplanır
-- (apply_diagnosis/grade_exam_session'ın +1 upsert'leri bu yüzden çift saymaz). Kaynağı hiç olmayan satır (içe aktarım,
-- elle düzeltme) olduğu gibi kalır; kaynağı olan satırın kaynakları biterse satır silinir.

-- --- şema ekleri ---------------------------------------------------------------------------------------------------------

alter table public.exam_sources add column upload_ids uuid[] not null default '{}';  -- Yüklenen sayfalar/dosyalar (eğitmen arşivi; upload_id ilkidir)
comment on column public.exam_sources.upload_ids is 'Yüklenen sayfalar/dosyalar (eğitmen arşivi; upload_id ilkidir)';
create index exam_sources_course on public.exam_sources (course_id, year);

alter table public.exam_items add column year smallint check (year between 1950 and 2100);  -- Sınav yılı (boş gelirse kaynaktan)
alter table public.exam_items add column term text check (term in ('vize', 'final', 'but', 'deneme', 'osym', 'meb', 'diger'));  -- Sınav türü (boş gelirse kaynaktan)
alter table public.exam_items add column skill_ids text[] not null default '{}';  -- Kazanımlar (exam-item v2; register_exam_items doğrular)
comment on column public.exam_items.year is 'Sınav yılı (boş gelirse kaynaktan)';
comment on column public.exam_items.term is 'Sınav türü (boş gelirse kaynaktan)';
comment on column public.exam_items.skill_ids is 'Kazanımlar (exam-item v2; register_exam_items doğrular)';

alter table public.questions add column style_id uuid references public.question_styles (id) on delete set null;  -- Tarza özel üretilmiş sorunun tarzı (kapsama)
comment on column public.questions.style_id is 'Tarza özel üretilmiş sorunun tarzı (kapsama)';
create index questions_style on public.questions (style_id) where style_id is not null;

alter table public.question_styles add column syllabus_score numeric(5, 4) check (syllabus_score between 0 and 1);  -- Müfredat uyumu (0–1)
alter table public.question_styles add column priority_score numeric(5, 4) check (priority_score between 0 and 1);  -- Öncelik skoru = 0.5·sıklık + 0.3·güncellik + 0.2·müfredat uyumu
alter table public.question_styles add column reviewed_by uuid references public.profiles (id) on delete set null;  -- Onaylayan/düzenleyen eğitmen (worker adı ezmez)
alter table public.question_styles add column reviewed_at timestamptz;  -- Eğitmen onayı/düzenlemesi zamanı
alter table public.question_styles add column updated_at timestamptz not null default now();  -- Son güncelleme (kümeleme, skor, düzenleme)
comment on column public.question_styles.syllabus_score is 'Müfredat uyumu (0–1)';
comment on column public.question_styles.priority_score is 'Öncelik skoru = 0.5·sıklık + 0.3·güncellik + 0.2·müfredat uyumu';
comment on column public.question_styles.reviewed_by is 'Onaylayan/düzenleyen eğitmen (worker adı ezmez)';
comment on column public.question_styles.reviewed_at is 'Eğitmen onayı/düzenlemesi zamanı';
comment on column public.question_styles.updated_at is 'Son güncelleme (kümeleme, skor, düzenleme)';
create trigger touch_updated_at before update on public.question_styles
for each row execute function app.touch_updated_at();
-- yeni sütunlar öğrenciye de açıktır; exemplar_item_ids ve embedding 0018'deki gibi kapalı kalır
grant select (syllabus_score, priority_score, reviewed_by, reviewed_at, updated_at) on public.question_styles to authenticated;

create index exam_questions_style on public.exam_questions (style_id) where style_id is not null;
create index solution_analyses_enrollment_style on public.solution_analyses (enrollment_id, style_id) where style_id is not null;

-- exam_items.year/term boş gelirse kaynaktan doldurulur
create or replace function app.exam_items_fill_year() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_year smallint;
  v_term text;
begin
  select s.year, s.term into v_year, v_term from public.exam_sources s where s.id = new.source_id;
  new.year := coalesce(new.year, v_year);
  new.term := coalesce(new.term, v_term);
  return new;
end
$$;
comment on function app.exam_items_fill_year() is 'BEFORE INSERT/UPDATE: exam_items.year/term boşsa kaynağın (exam_sources) yılı/türü.';
create trigger fill_year before insert or update of source_id, year, term on public.exam_items
for each row execute function app.exam_items_fill_year();

-- --- yetki yardımcıları --------------------------------------------------------------------------------------------------

-- Dersin arşivini ve tarz kütüphanesini yönetebilir mi (alım, madde, tarz yazımı, birleştirme, plan): güvenilir çağıran
-- (worker), admin; eğitmen ise dersin sahibi ya da derse bağlı (instructor_links.course_id).
create or replace function app.can_manage_course(p_course uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if p_course is null or not exists (select 1 from public.courses co where co.id = p_course) then
    return false;
  end if;
  if app.is_trusted() or app.is_admin() then
    return true;
  end if;
  if auth.uid() is null or app.role() is distinct from 'instructor' then
    return false;
  end if;
  return exists (select 1 from public.courses co where co.id = p_course and co.created_by = auth.uid())
      or exists (select 1 from public.instructor_links il where il.instructor_id = auth.uid() and il.course_id = p_course);
end
$$;
comment on function app.can_manage_course(uuid) is 'Dersin arşivini/tarz kütüphanesini yazabilir mi: worker, admin, dersin sahibi ya da derse bağlı eğitmen.';

-- Çıkmış sınav arşivini (exam_sources, exam_items: telifli soru metni) okuyabilir mi: yönetebilen ya da derse kayıtlı bir
-- öğrenciye bağlı eğitmen. Öğrenci ve veli asla.
create or replace function app.can_read_course_archive(p_course uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if app.can_manage_course(p_course) then
    return true;
  end if;
  if auth.uid() is null or app.role() is distinct from 'instructor' then
    return false;
  end if;
  return exists (select 1 from public.instructor_links il
                   join public.enrollments e on e.student_id = il.student_id
                  where il.instructor_id = auth.uid() and e.course_id = p_course);
end
$$;
comment on function app.can_read_course_archive(uuid) is 'Çıkmış sınav arşivi okunabilir mi: worker, admin, dersin eğitmeni ya da derse kayıtlı öğrenciye bağlı eğitmen; öğrenci/veli hiç.';

-- --- RLS: arşiv yalnız dersin personeline -----------------------------------------------------------------------------

drop policy exam_sources_select_staff on public.exam_sources;
drop policy exam_items_select_staff on public.exam_items;
create policy exam_sources_select on public.exam_sources for select to authenticated
using (app.can_read_course_archive(course_id));
create policy exam_items_select on public.exam_items for select to authenticated
using (exists (select 1 from public.exam_sources as s where s.id = exam_items.source_id and app.can_read_course_archive(s.course_id)));

-- --- kapsama türetimi ----------------------------------------------------------------------------------------------------

-- (kayıt, tarz) için kaynaklardan sayaçlar: {seen, solved, correct, last_seen_at}
create or replace function app.style_coverage_counts(p_enrollment uuid, p_style uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_out jsonb;
begin
  select jsonb_build_object('seen', coalesce(sum(z.n_seen), 0)::int, 'solved', coalesce(sum(z.n_solved), 0)::int,
                            'correct', coalesce(sum(z.n_correct), 0)::int, 'last_seen_at', max(z.last_at))
    into v_out
    from (
      select count(*) as n_seen, count(*) filter (where a.is_correct is not null) as n_solved,
             count(*) filter (where a.is_correct) as n_correct, max(a.created_at) as last_at
        from public.attempts a
        join public.questions q on q.id = a.question_id
       where a.enrollment_id = p_enrollment and q.style_id = p_style
      union all
      select count(*), count(*) filter (where r.outcome <> 'blank'), count(*) filter (where r.outcome = 'correct'),
             max(coalesce(es.finished_at, r.created_at))
        from public.exam_responses r
        join public.exam_sessions es on es.id = r.session_id
        join public.exam_questions q on q.id = r.exam_question_id
       where es.enrollment_id = p_enrollment and q.style_id = p_style and r.outcome in ('correct', 'wrong', 'blank')
      union all
      select count(*), count(*) filter (where sa.verdict <> 'unreadable'), count(*) filter (where sa.verdict = 'correct'),
             max(sa.created_at)
        from public.solution_analyses sa
       where sa.enrollment_id = p_enrollment and sa.style_id = p_style and sa.exam_response_id is null
    ) as z;
  return v_out;
end
$$;
comment on function app.style_coverage_counts(uuid, uuid) is 'Kaydın tarz kapsaması kaynaklardan: attempts (questions.style_id), notlanmış exam_responses (exam_questions.style_id), deneme dışı solution_analyses; {seen, solved, correct, last_seen_at}.';

-- (kayıt, tarz) satırını kaynaklarla eşitler: kaynak varsa upsert (BEFORE tetikleyicisi sayaçları yazar), yoksa siler.
-- Kayıt ya da tarz silinmekteyse (basamaklı silme, set null) yalnız siler.
create or replace function app.refresh_style_coverage(p_enrollment uuid, p_style uuid) returns void
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_c jsonb;
begin
  if p_enrollment is null or p_style is null then
    return;
  end if;
  if not exists (select 1 from public.enrollments e where e.id = p_enrollment)
     or not exists (select 1 from public.question_styles qs where qs.id = p_style) then
    delete from public.style_coverage sc where sc.enrollment_id = p_enrollment and sc.style_id = p_style;
    return;
  end if;
  v_c := app.style_coverage_counts(p_enrollment, p_style);
  if (v_c ->> 'seen')::int = 0 then
    delete from public.style_coverage sc where sc.enrollment_id = p_enrollment and sc.style_id = p_style;
    return;
  end if;
  insert into public.style_coverage as sc (enrollment_id, style_id, seen_count, solved_count, correct_count, last_seen_at)
  values (p_enrollment, p_style, (v_c ->> 'seen')::int, (v_c ->> 'solved')::int, (v_c ->> 'correct')::int,
          (v_c ->> 'last_seen_at')::timestamptz)
  on conflict (enrollment_id, style_id) do update
    set seen_count = excluded.seen_count, solved_count = excluded.solved_count, correct_count = excluded.correct_count,
        last_seen_at = excluded.last_seen_at;
end
$$;
comment on function app.refresh_style_coverage(uuid, uuid) is 'style_coverage satırını kaynaklarla eşitler (kaynak yoksa ya da kayıt/tarz siliniyorsa satırı siler).';

-- BEFORE INSERT/UPDATE style_coverage: kaynağı olan satırın sayaçları her yazımda kaynaklardan gelir (+1 upsert'ler çift
-- saymaz); kaynağı hiç olmayan satır (içe aktarım) verildiği gibi kalır.
create or replace function app.style_coverage_derive() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_c jsonb;
begin
  v_c := app.style_coverage_counts(new.enrollment_id, new.style_id);
  if (v_c ->> 'seen')::int > 0 then
    new.seen_count := (v_c ->> 'seen')::int;
    new.solved_count := (v_c ->> 'solved')::int;
    new.correct_count := (v_c ->> 'correct')::int;
    new.last_seen_at := coalesce((v_c ->> 'last_seen_at')::timestamptz, new.last_seen_at);
  end if;
  return new;
end
$$;
comment on function app.style_coverage_derive() is 'BEFORE INSERT/UPDATE style_coverage: kaynağı olan satırda sayaçlar kaynaklardan (app.style_coverage_counts) yazılır.';
create trigger derive_counts before insert or update on public.style_coverage
for each row execute function app.style_coverage_derive();

-- attempts → questions.style_id
create or replace function app.style_coverage_from_attempts() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select q.style_id into v_old from public.questions q where q.id = old.question_id;
    perform app.refresh_style_coverage(old.enrollment_id, v_old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select q.style_id into v_new from public.questions q where q.id = new.question_id;
    if tg_op = 'INSERT' or v_new is distinct from v_old or new.enrollment_id <> old.enrollment_id then
      perform app.refresh_style_coverage(new.enrollment_id, v_new);
    end if;
  end if;
  return null;
end
$$;
comment on function app.style_coverage_from_attempts() is 'AFTER attempts: tarzlı sorunun denemesi kapsamayı tazeler.';
create trigger style_coverage after insert or delete or update of is_correct, question_id, enrollment_id on public.attempts
for each row execute function app.style_coverage_from_attempts();

-- exam_responses → exam_questions.style_id (yalnız notlanmış sonuç: correct | wrong | blank)
create or replace function app.style_coverage_from_exam_responses() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_style uuid;
  v_enr uuid;
  v_counts boolean := false;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_counts := coalesce(old.outcome in ('correct', 'wrong', 'blank'), false);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_counts := v_counts or coalesce(new.outcome in ('correct', 'wrong', 'blank'), false);
  end if;
  if not v_counts then
    return null;
  end if;
  if tg_op = 'DELETE' then
    select q.style_id into v_style from public.exam_questions q where q.id = old.exam_question_id;
    select es.enrollment_id into v_enr from public.exam_sessions es where es.id = old.session_id;
  else
    select q.style_id into v_style from public.exam_questions q where q.id = new.exam_question_id;
    select es.enrollment_id into v_enr from public.exam_sessions es where es.id = new.session_id;
  end if;
  perform app.refresh_style_coverage(v_enr, v_style);
  return null;
end
$$;
comment on function app.style_coverage_from_exam_responses() is 'AFTER exam_responses: notlanmış tarzlı deneme cevabı kapsamayı tazeler.';
create trigger style_coverage after insert or delete or update of outcome on public.exam_responses
for each row execute function app.style_coverage_from_exam_responses();

-- solution_analyses.style_id (deneme bağlamı hariç)
create or replace function app.style_coverage_from_analyses() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.style_id is not null and old.exam_response_id is null then
    perform app.refresh_style_coverage(old.enrollment_id, old.style_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.style_id is not null and new.exam_response_id is null then
    perform app.refresh_style_coverage(new.enrollment_id, new.style_id);
  end if;
  return null;
end
$$;
comment on function app.style_coverage_from_analyses() is 'AFTER solution_analyses: deneme dışı tarzlı teşhis kapsamayı tazeler.';
create trigger style_coverage after insert or delete or update of style_id, verdict, exam_response_id, enrollment_id
on public.solution_analyses
for each row execute function app.style_coverage_from_analyses();

-- Soru tarzı değişti (eğitmen düzeltmesi, merge_styles): o soruyu görmüş her kayıtta eski ve yeni tarz tazelenir
create or replace function app.style_coverage_from_style_change() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_enr uuid;
begin
  if old.style_id is not distinct from new.style_id then
    return null;
  end if;
  if tg_table_name = 'exam_questions' then
    for v_enr in
      select distinct es.enrollment_id from public.exam_responses r join public.exam_sessions es on es.id = r.session_id
       where r.exam_question_id = new.id and r.outcome in ('correct', 'wrong', 'blank')
    loop
      perform app.refresh_style_coverage(v_enr, old.style_id);
      perform app.refresh_style_coverage(v_enr, new.style_id);
    end loop;
  else
    for v_enr in select distinct a.enrollment_id from public.attempts a where a.question_id = new.id loop
      perform app.refresh_style_coverage(v_enr, old.style_id);
      perform app.refresh_style_coverage(v_enr, new.style_id);
    end loop;
  end if;
  return null;
end
$$;
comment on function app.style_coverage_from_style_change() is 'AFTER UPDATE OF style_id (exam_questions, questions): soruyu görmüş kayıtlarda eski ve yeni tarzın kapsaması tazelenir.';
create trigger style_coverage after update of style_id on public.exam_questions
for each row execute function app.style_coverage_from_style_change();
create trigger style_coverage after update of style_id on public.questions
for each row execute function app.style_coverage_from_style_change();

-- --- yetkiler ------------------------------------------------------------------------------------------------------------

revoke all on function app.exam_items_fill_year(), app.can_manage_course(uuid), app.can_read_course_archive(uuid),
  app.style_coverage_counts(uuid, uuid), app.refresh_style_coverage(uuid, uuid), app.style_coverage_derive(),
  app.style_coverage_from_attempts(), app.style_coverage_from_exam_responses(), app.style_coverage_from_analyses(),
  app.style_coverage_from_style_change() from public, anon;
-- can_read_course_archive politikalarda çağrılır; can_manage_course web'in düğme durumları için de okunur
grant execute on function app.can_manage_course(uuid), app.can_read_course_archive(uuid) to authenticated, service_role;
grant execute on function app.style_coverage_counts(uuid, uuid), app.refresh_style_coverage(uuid, uuid) to service_role;
