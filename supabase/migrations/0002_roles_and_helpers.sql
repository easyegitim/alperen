-- 0002_roles_and_helpers.sql — şemalar, varsayılan yetki iptalleri, service_role yetkileri ve yardımcı fonksiyonlar
-- (docs/PLAN-v2-detail.md §2.4).
--
-- Roller: v2'de özel uygulama rolü YOKTUR (v1'in bot_runtime ve batch_worker rolleri kaldırıldı). Web uygulaması
-- yalnız kullanıcının JWT'siyle (Supabase "authenticated") çalışır; kimlik auth.uid() + public.profiles'tan gelir.
-- service_role Supabase'in hazır rolüdür (BYPASSRLS): yalnız apps/worker kullanır, RLS'i atlar; tablolara erişimi
-- aşağıdaki varsayılan yetkilerle verilir. anon hiçbir tabloya erişmez.
--
-- Tablo okuyan yardımcılar (app.role, app.my_student_id, app.my_children, app.my_students, app.can_read_student)
-- plpgsql'dir: gövdeleri çağrı anında çözülür, tablolar 0003'te yaratılır (check_sql.py OGR-LINT-ORDER yalnız
-- language sql gövdelerini denetler). SECURITY DEFINER'dır: RLS politikalarının içinden çağrıldıklarında profiles ve
-- bağ tablolarının kendi politikalarına takılmazlar (özyineleme yok).

create schema if not exists secure;
create schema if not exists audit;
create schema if not exists app;

comment on schema secure is 'Cevap anahtarları; PostgREST''e açılmaz, yalnız SECURITY DEFINER fonksiyonlar ve service_role erişir.';
comment on schema audit is 'Yalnız eklemeli denetim izi; tetikleyiciler ve fonksiyonlar yazar.';
comment on schema app is 'Yardımcı ve tetikleyici fonksiyonlar; tablo içermez.';

-- Supabase'in yeni public tablolarına verdiği varsayılan yetkileri kaldır (yetkiler tablo tablo, RLS ile birlikte verilir)
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
-- migration'ı postgres dışı bir rol uygularsa postgres'in yaratacağı tablolar için de aynı iptal; yalnız bu rol
-- postgres'in üyesiyse yapılabilir (yerel testin süper kullanıcı olmayan sahibi üye değildir → atlanır)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') and pg_has_role(current_user, 'postgres', 'member') then
    execute 'alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated';
  end if;
end
$$;
-- Fonksiyonlarda PUBLIC'e EXECUTE küresel varsayılandır; migration rolünün yaratacağı tüm fonksiyonlar için iptal
alter default privileges revoke execute on functions from public;
alter default privileges in schema app revoke all on functions from public;

-- Uzantı fonksiyonları public şemasına kuruluysa (pgvector konteyneri) yukarıdaki toplu iptalden etkilenmesin
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('grant execute on function %s to public', v_fn);
  end loop;
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    execute 'grant usage on schema extensions to anon, authenticated, service_role';
  end if;
end
$$;

revoke all on schema secure from public, anon, authenticated;
revoke all on schema audit from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app to authenticated, service_role;

-- service_role (yalnız apps/worker): RLS'i atlar; tablo yetkileri migration rolünün yaratacağı nesneler için varsayılan
grant usage on schema secure, audit to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema secure grant select, insert, update, delete on tables to service_role;
alter default privileges in schema audit grant select, insert on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
alter default privileges in schema secure grant usage, select on sequences to service_role;
alter default privileges in schema audit grant usage, select on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
alter default privileges in schema app grant execute on functions to service_role;

-- JWT rolü: PostgREST request.jwt.claims; yoksa oturum rolü (psql/testler)
create or replace function app.jwt_role() returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_user)
$$;
comment on function app.jwt_role() is 'Çağıranın rolü: JWT role claim''i (authenticated | service_role | anon), yoksa current_user.';

-- Kimlik: Supabase auth.uid() (JWT sub); v1'in başlık tabanlı app.current_student() mekanizması yoktur
create or replace function app.uid() returns uuid
language sql
stable
as $$
  select auth.uid()
$$;
comment on function app.uid() is 'Oturumdaki kullanıcı: auth.uid() (= auth.users.id = profiles.id); yoksa null.';

-- students.public_ref için rastgele küçük harf base32 (a-z2-7); desen ^s_[a-z2-7]{12}$
create or replace function app.base32_random(n int) returns text
language sql
volatile
set search_path = pg_catalog, public, extensions
as $$
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz234567', (get_byte(r.b, g.i) % 32) + 1, 1), '' order by g.i)
    from (select gen_random_bytes(n) as b) as r,
         generate_series(0, n - 1) as g (i)
$$;
comment on function app.base32_random(int) is 'n karakterlik rastgele base32 (a-z2-7); pgcrypto gen_random_bytes; volatile.';

-- updated_at sütununu her güncellemede now() yapar (tetikleyici)
create or replace function app.touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
comment on function app.touch_updated_at() is 'BEFORE UPDATE tetikleyicisi: updated_at = now().';

-- Oturumdaki kullanıcının rolü (profiles.role): student | parent | instructor | admin; profil yoksa null
create or replace function app.role() returns text
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_role text;
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  return v_role;
end
$$;
comment on function app.role() is 'Oturumdaki kullanıcının profiles.role değeri (student | parent | instructor | admin); yoksa null.';

create or replace function app.is_admin() returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  return coalesce(app.role() = 'admin', false);
end
$$;
comment on function app.is_admin() is 'Oturumdaki kullanıcı admin mi (profiles.role = admin); RLS''te tam erişim.';

-- Oturumdaki öğrencinin students.id'si (profil öğrenci değilse null)
create or replace function app.my_student_id() returns uuid
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  select s.id into v_id from public.students s where s.profile_id = auth.uid();
  return v_id;
end
$$;
comment on function app.my_student_id() is 'Oturumdaki öğrencinin students.id''si (students.profile_id = auth.uid()); yoksa null.';

-- Velinin çocukları: yalnız status = active guardian_links
create or replace function app.my_children() returns setof uuid
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  return query
    select gl.student_id from public.guardian_links gl
     where gl.parent_id = auth.uid() and gl.status = 'active';
end
$$;
comment on function app.my_children() is 'Oturumdaki velinin aktif guardian_links bağlarındaki students.id''ler.';

-- Eğitmenin öğrencileri: instructor_links (ders başına bağ olabilir; öğrenci tekil döner)
create or replace function app.my_students() returns setof uuid
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  return query
    select distinct il.student_id from public.instructor_links il
     where il.instructor_id = auth.uid();
end
$$;
comment on function app.my_students() is 'Oturumdaki eğitmenin instructor_links bağlarındaki students.id''ler (tekil).';

-- Öğrenci satırını okuyabilir mi: kendisi, aktif velisi, bağlı eğitmeni ya da admin
create or replace function app.can_read_student(p_student uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if p_student is null or auth.uid() is null then
    return false;
  end if;
  return app.is_admin()
      or coalesce(p_student = app.my_student_id(), false)
      or exists (select 1 from app.my_children() as c (sid) where c.sid = p_student)
      or exists (select 1 from app.my_students() as m (sid) where m.sid = p_student);
end
$$;
comment on function app.can_read_student(uuid) is 'Öğrenciyi görebilir mi: öğrencinin kendisi, aktif veli, bağlı eğitmen ya da admin.';

revoke all on function app.base32_random(int) from public;
revoke all on function app.touch_updated_at() from public;
grant execute on function app.jwt_role(), app.uid(), app.role(), app.is_admin(), app.my_student_id(),
  app.my_children(), app.my_students(), app.can_read_student(uuid) to authenticated, service_role;
