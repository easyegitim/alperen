-- 0002_grants_baseline.sql — şemalar, uygulama rolleri, varsayılan yetki iptalleri ve tablo OKUMAYAN yardımcılar
-- (BLUEPRINT §3.0). Tablo okuyan yardımcılar (app.current_student, app.staff_role, app.can_see_student …)
-- burada değil 0014_rls.sql başında tanımlanır: check_function_bodies=on ile SQL gövdeleri oluşturma anında
-- doğrulanır ve o tablolar henüz yoktur (check_sql.py OGR-LINT-ORDER).

create schema if not exists secure;
create schema if not exists audit;
create schema if not exists app;

comment on schema secure is 'Kişisel veri ve cevap anahtarları; PostgREST''e açılmaz, yalnız SECURITY DEFINER fonksiyonlar erişir.';
comment on schema audit is 'Yalnız eklemeli denetim izi; tetikleyiciler yazar, koordinatör audit_recent() ile okur.';
comment on schema app is 'Yardımcı ve tetikleyici fonksiyonlar; tablo içermez.';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bot_runtime') then
    create role bot_runtime nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'batch_worker') then
    create role batch_worker nologin;
  end if;
end
$$;

-- PostgREST JWT role claim'i ile SET ROLE yapar
grant bot_runtime, batch_worker to authenticator;  -- noqa: PRS

-- Supabase'in yeni public tablolarına verdiği varsayılan yetkileri kaldır
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
-- migration'ı postgres dışı bir rol uygularsa (ör. supabase_admin) postgres'in yaratacağı tablolar için de aynı iptal;
-- yalnız bu rol postgres'in üyesiyse yapılabilir (yerel testin süper kullanıcı olmayan sahibi üye değildir → atlanır)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') and pg_has_role(current_user, 'postgres', 'member') then
    execute 'alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated';
  end if;
end
$$;
-- Fonksiyonlarda PUBLIC'e EXECUTE KÜRESEL varsayılandır ve şema başına ALTER DEFAULT PRIVILEGES küresel varsayılanı
-- geri alamaz; bu yüzden migration rolünün yaratacağı tüm fonksiyonlar için küresel iptal (yalnız açıkça verilenler çağrılır)
alter default privileges revoke execute on functions from public;
alter default privileges in schema app revoke all on functions from public;

-- Uzantı fonksiyonları (vector/halfvec G/Ç, operatörler) uzantı public şemasına kuruluysa (CI pgvector konteyneri)
-- yukarıdaki toplu iptalden etkilenmesin; Supabase'de uzantılar "extensions" şemasındadır ve uygulama rolleri onu kullanır
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
    execute 'grant usage on schema extensions to bot_runtime, batch_worker';
  end if;
end
$$;

revoke all on schema secure from public, anon, authenticated, bot_runtime, batch_worker;
revoke all on schema audit from public, anon, authenticated, bot_runtime, batch_worker;
grant usage on schema public to anon, authenticated, bot_runtime, batch_worker;
-- yalnız fonksiyon çağrısı; app şemasında tablo yok
grant usage on schema app to bot_runtime, batch_worker, authenticated;
-- anon: hiçbir tabloda yetki yok; yalnız public.ping() ve public.redeem_guardian_token() (§3.8)

-- JWT rolü: PostgREST request.jwt.claims; yoksa oturum rolü (psql/testler)
create or replace function app.jwt_role() returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_user)
$$;
comment on function app.jwt_role() is 'Çağıranın uygulama rolü: JWT role claim''i, yoksa current_user.';

-- JWT sub (auth.users.id); panel kullanıcısının staff.id'si
create or replace function app.uid() returns uuid
language sql
stable
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
comment on function app.uid() is 'JWT sub claim''i (auth.users.id = staff.id); yoksa null.';

-- students.public_ref için rastgele küçük harf base32 (a-z2-7); common.studentRef deseni ^s_[a-z2-7]{12}$
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

revoke all on function app.base32_random(int) from public;
grant execute on function app.jwt_role(), app.uid() to bot_runtime, batch_worker, authenticated;
