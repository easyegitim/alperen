-- 0020_suggestions.sql — "koç önerir" kartları (docs/PLAN-v2.md §13 Öneri motoru, docs/PLAN-v2-detail.md §6).
-- Bugün ekranının kahraman kartı ve en çok 3 kutusu bu tablodan gelir. Satırları worker'ın suggestions.refresh işi
-- yazar (her gece ve her etkinlikten sonra; service_role ya da public.replace_suggestions); öğrenci yalnız okur
-- (list_today_suggestions) ve "Başla"ya basınca consume_suggestion / start_practice ile başlatıldı olarak işaretler.
-- Kart metni (title, subtitle) tek cümledir; Haiku üretir. payload türe göre: practice/gap_analysis/weekly_homework/
-- lesson_review → {skill_ids[], count, minutes, template_ids[]?}; mini_exam → {exam_id}; document_ready → {document_id};
-- upload_result → {upload_id, analysis_id?, session_id?}.

create table public.suggestions (  -- Koçun Bugün önerileri (kahraman kart + kutular); worker yazar, öğrenci başlatır.
  id uuid primary key default gen_random_uuid(),  -- Öneri kimliği
  student_id uuid not null references public.students (id) on delete cascade,  -- Öğrenci
  enrollment_id uuid references public.enrollments (id) on delete cascade,  -- İlgili kayıt (ders); belge/yükleme sonucu için boş olabilir
  kind text not null check (kind in ('practice', 'weekly_homework', 'lesson_review', 'gap_analysis', 'mini_exam', 'document_ready', 'upload_result')),  -- Öneri türü
  title text not null check (char_length(title) between 1 and 120),  -- Kart başlığı (tek cümle: 'Rasyonel sayılar')
  subtitle text check (char_length(subtitle) <= 160),  -- Alt satır ('8 soru · 12 dk')
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),  -- Türe özgü veri (skill_ids, count, minutes, exam_id, document_id …)
  rank int not null default 100 check (rank >= 0),  -- Sıra (küçük önce; 0 kahraman kart)
  expires_at timestamptz,  -- Geçerlilik sonu (boş: süresiz)
  consumed_at timestamptz,  -- Öğrencinin "Başla"ya bastığı zaman (boş: aktif)
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.suggestions
comment on table public.suggestions is 'Koçun Bugün önerileri (kahraman kart + kutular); worker yazar, öğrenci başlatır.';
comment on column public.suggestions.id is 'Öneri kimliği';
comment on column public.suggestions.student_id is 'Öğrenci';
comment on column public.suggestions.enrollment_id is 'İlgili kayıt (ders); belge/yükleme sonucu için boş olabilir';
comment on column public.suggestions.kind is 'Öneri türü';
comment on column public.suggestions.title is 'Kart başlığı (tek cümle: ''Rasyonel sayılar'')';
comment on column public.suggestions.subtitle is 'Alt satır (''8 soru · 12 dk'')';
comment on column public.suggestions.payload is 'Türe özgü veri (skill_ids, count, minutes, exam_id, document_id …)';
comment on column public.suggestions.rank is 'Sıra (küçük önce; 0 kahraman kart)';
comment on column public.suggestions.expires_at is 'Geçerlilik sonu (boş: süresiz)';
comment on column public.suggestions.consumed_at is 'Öğrencinin "Başla"ya bastığı zaman (boş: aktif)';
comment on column public.suggestions.created_at is 'Oluşturulma zamanı';
-- end comments public.suggestions
create index suggestions_active on public.suggestions (student_id, rank, created_at) where consumed_at is null;
alter table public.suggestions enable row level security;
alter table public.suggestions force row level security;

-- Öğrenci kendi önerilerini, bağlı eğitmen ve admin öğrencininkileri görür (veli görmez); yazım yalnız RPC ve worker
grant select on public.suggestions to authenticated;
create policy suggestions_select on public.suggestions for select to authenticated using (app.can_read_student_data(student_id));

-- Kaydın öğrencisi tutarlı olmalı (enrollment_id doluysa enrollments.student_id = student_id)
create or replace function app.suggestions_check_student() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if new.enrollment_id is not null and app.student_of_enrollment(new.enrollment_id) is distinct from new.student_id then
    raise exception using errcode = 'P0001', message = 'OGR-SUG-003 öneri kaydı başka öğrencinin';
  end if;
  return new;
end
$$;
comment on function app.suggestions_check_student() is 'BEFORE INSERT/UPDATE: enrollment_id doluysa kaydın öğrencisi student_id olmalı (OGR-SUG-003).';
revoke all on function app.suggestions_check_student() from public;
create trigger suggestions_check_student before insert or update of student_id, enrollment_id on public.suggestions
for each row execute function app.suggestions_check_student();

-- Bugünün önerileri: aktif (başlatılmamış, süresi dolmamış), rank sonra oluşturulma sırasıyla. İki bant ayrı sınırlanır:
-- başlatılabilir kartlar (kahraman + kutular) en çok settings.suggestions_today_max (4), bildirim kartları (document_ready,
-- upload_result; Bugün'de ayrı satır) en çok settings.suggestions_notices_max (2); bildirimler kutuların arkasında
-- kalıp görünmez olmaz. p_student boşsa oturumdaki öğrenci; dolu ise öğrenci verisini okuyabilen (bağlı eğitmen,
-- admin) ya da worker. Veli çağıramaz.
create or replace function public.list_today_suggestions(p_student uuid default null)
returns table (
  id uuid, enrollment_id uuid, kind text, title text, subtitle text, payload jsonb, rank int, expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := coalesce(p_student, app.my_student_id());
  v_max int := app.setting_num('suggestions_today_max', 4)::int;
  v_notices int := app.setting_num('suggestions_notices_max', 2)::int;
begin
  if v_student is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 öneriler yalnız öğrenci oturumunda (ya da p_student ile) okunur';
  end if;
  if not (app.is_trusted() or app.can_read_student_data(v_student)) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu öğrencinin önerileri için yetki yok';
  end if;
  return query
    select z.id, z.enrollment_id, z.kind, z.title, z.subtitle, z.payload, z.rank, z.expires_at, z.created_at
      from (select s.*, s.kind in ('document_ready', 'upload_result') as notice,
                   -- bildirim bandında aynı sıradakilerden en yenisi önce (yeni yükleme sonucu eskisinin arkasında kalmaz)
                   row_number() over (partition by s.kind in ('document_ready', 'upload_result')
                                      order by s.rank,
                                               case when s.kind in ('document_ready', 'upload_result') then -extract(epoch from s.created_at) else extract(epoch from s.created_at) end,
                                               s.id) as nth
              from public.suggestions s
             where s.student_id = v_student and s.consumed_at is null and (s.expires_at is null or s.expires_at > now())) as z
     where z.nth <= case when z.notice then v_notices else v_max end
     order by z.rank, z.created_at, z.id;
end
$$;
comment on function public.list_today_suggestions(uuid) is 'Bugünün aktif önerileri (rank sıralı; başlatılabilir ≤ settings.suggestions_today_max = 4, bildirim ≤ suggestions_notices_max = 2); öğrenci kendi, eğitmen/admin/worker p_student ile.';

-- Öneriyi "başlatıldı" işaretler (idempotent: ikinci çağrı aynı consumed_at'i döner). Yalnız öğrencinin kendisi,
-- admin ya da worker. Süresi dolmuş öneri OGR-SUG-002.
create or replace function public.consume_suggestion(p_id uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_s public.suggestions%rowtype;
  v_at timestamptz;
begin
  select s.* into v_s from public.suggestions s where s.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-SUG-001 öneri bulunamadı %s', p_id);
  end if;
  if not (app.is_trusted() or app.is_admin() or coalesce(v_s.student_id = app.my_student_id(), false)) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 öneriyi yalnız öğrencinin kendisi başlatır';
  end if;
  v_at := v_s.consumed_at;
  if v_at is null then
    if v_s.expires_at is not null and v_s.expires_at <= now() then
      raise exception using errcode = 'P0001', message = 'OGR-SUG-002 önerinin süresi doldu';
    end if;
    update public.suggestions s set consumed_at = now() where s.id = p_id returning s.consumed_at into v_at;
  end if;
  return jsonb_build_object('id', v_s.id, 'kind', v_s.kind, 'enrollment_id', v_s.enrollment_id, 'payload', v_s.payload,
                            'consumed_at', v_at);
end
$$;
comment on function public.consume_suggestion(uuid) is 'Öneriyi başlatıldı olarak işaretler (idempotent); öğrencinin kendisi, admin, worker; süresi dolmuşsa OGR-SUG-002.';

-- Worker (suggestions.refresh) için: öğrencinin aktif (başlatılmamış) önerilerini tek işlemde yenileriyle değiştirir.
-- p_items: [{kind, title, subtitle?, payload?, rank?, enrollment_id?, expires_at?}] (en çok 10). Aynı kart
-- (payload.copy_key eşleşen aktif satır) yerinde güncellenir ve kimliğini korur: yenilemeden önce çizilmiş Bugün
-- sayfasındaki "Başla" OGR-SUG-001'e düşmez. Yeni listede olmayan aktif kartlar silinir; başlatılmış öneriler geçmiş
-- olarak kalır. Döner: yazılan (güncellenen + eklenen) satır sayısı. Yalnız worker ve admin.
create or replace function public.replace_suggestions(p_student uuid, p_items jsonb) returns int
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_n int;
  v_ins int;
begin
  if not (app.is_trusted() or app.is_admin()) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 önerileri yalnız worker yazar';
  end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array' or jsonb_array_length(p_items) > 10 then
    raise exception using errcode = 'P0001', message = 'OGR-SUG-003 p_items dizi olmalı (≤ 10 öneri)';
  end if;
  if not exists (select 1 from public.students st where st.id = p_student) then
    raise exception using errcode = 'P0001', message = 'OGR-SUG-003 öğrenci bulunamadı';
  end if;
  perform pg_advisory_xact_lock(hashtext('suggestions:' || p_student::text));
  -- Yeni listede anahtarı olmayan aktif kartlar gider
  delete from public.suggestions s
   where s.student_id = p_student and s.consumed_at is null
     and (s.payload ->> 'copy_key' is null
          or s.payload ->> 'copy_key' not in (select x.it -> 'payload' ->> 'copy_key' from jsonb_array_elements(p_items) as x (it)
                                               where x.it -> 'payload' ->> 'copy_key' is not null));
  begin
    -- Aynı anahtarlı aktif kart yerinde güncellenir (kimlik ve created_at kalır)
    update public.suggestions s
       set enrollment_id = i.enrollment_id, kind = i.kind, title = i.title, subtitle = i.subtitle, payload = i.payload,
           rank = i.rank, expires_at = i.expires_at
      from (select nullif(x.it ->> 'enrollment_id', '')::uuid as enrollment_id, x.it ->> 'kind' as kind,
                   btrim(x.it ->> 'title') as title, nullif(btrim(x.it ->> 'subtitle'), '') as subtitle,
                   coalesce(x.it -> 'payload', '{}'::jsonb) as payload, coalesce((x.it ->> 'rank')::int, 100 + x.ord::int) as rank,
                   nullif(x.it ->> 'expires_at', '')::timestamptz as expires_at, x.it -> 'payload' ->> 'copy_key' as copy_key
              from jsonb_array_elements(p_items) with ordinality as x (it, ord)) as i
     where s.student_id = p_student and s.consumed_at is null and i.copy_key is not null and s.payload ->> 'copy_key' = i.copy_key;
    get diagnostics v_n = row_count;
    insert into public.suggestions (student_id, enrollment_id, kind, title, subtitle, payload, rank, expires_at)
    select p_student, nullif(x.it ->> 'enrollment_id', '')::uuid, x.it ->> 'kind', btrim(x.it ->> 'title'),
           nullif(btrim(x.it ->> 'subtitle'), ''), coalesce(x.it -> 'payload', '{}'::jsonb),
           coalesce((x.it ->> 'rank')::int, 100 + x.ord::int), nullif(x.it ->> 'expires_at', '')::timestamptz
      from jsonb_array_elements(p_items) with ordinality as x (it, ord)
     where x.it -> 'payload' ->> 'copy_key' is null
        or not exists (select 1 from public.suggestions s
                        where s.student_id = p_student and s.consumed_at is null
                          and s.payload ->> 'copy_key' = x.it -> 'payload' ->> 'copy_key');
    get diagnostics v_ins = row_count;
    v_n := v_n + v_ins;
  exception when check_violation or not_null_violation or invalid_text_representation or foreign_key_violation
                 or invalid_datetime_format then
    raise exception using errcode = 'P0001', message = format('OGR-SUG-003 geçersiz öneri: %s', sqlerrm);
  end;
  return v_n;
end
$$;
comment on function public.replace_suggestions(uuid, jsonb) is 'Öğrencinin aktif önerilerini yenileriyle değiştirir (aynı payload.copy_key yerinde güncellenir, kimlik kalır; suggestions.refresh işi; yalnız worker/admin); yazılan satır sayısı.';

revoke all on function public.list_today_suggestions(uuid), public.consume_suggestion(uuid), public.replace_suggestions(uuid, jsonb)
from public;
grant execute on function public.list_today_suggestions(uuid), public.consume_suggestion(uuid), public.replace_suggestions(uuid, jsonb)
to authenticated, service_role;
