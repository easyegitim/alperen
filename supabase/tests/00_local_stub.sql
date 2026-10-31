-- tests/00_local_stub.sql — yerel/CI Postgres'te Supabase'in sağladığı nesnelerin asgari eşleniği (BLUEPRINT §12 #30).
-- Yalnız YOKSA oluşturur; barındırılan Supabase projesinde hiçbir şeyi değiştirmez. vector uzantısı zorunludur
-- (yoksa açık hata). Supabase düzeni taklit edilir: "extensions" şeması ve veritabanı search_path'i
-- "$user", public, extensions. pgvector < 0.7 (halfvec tipi yok) ise halfvec, vector'ün C fonksiyonlarıyla aynı ikili
-- biçimde extensions şemasında tanımlanır (yerel sınırlama; supabase/README.md "Kabul komutu notu").
-- Supabase ayrıcalık modeli: migration'ları süper kullanıcı OLMAYAN "postgres" rolü uygular (BYPASSRLS, CREATEROLE,
-- Supabase rollerinde ADMIN). Yerelde bu rolün eşleniği ogrenmen_owner'dır (yerel kümenin "postgres"i süper kullanıcıdır);
-- db-test.sh migration, seed ve anahtar adımlarını PGOPTIONS='-c role=ogrenmen_owner' ile bu rolle çalıştırır. Böylece
-- SECURITY DEFINER fonksiyonlar ve security_invoker=false görünümler süper kullanıcıya değil bu role ait olur ve
-- FORCE RLS / sahiplik davranışı Supabase'deki gibi sınanır (09_grants_matrix.sql sahipliği denetler).

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'vector') then
    raise exception 'vector (pgvector) uzantısı bu sunucuda yok: migration''lar halfvec(768) ister';
  end if;
end
$$;
create extension if not exists vector;
create schema if not exists extensions;
do $$
begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end
$$;

-- halfvec yedeği (yalnız pgvector 0.7 öncesi): aynı ikili biçim, aynı C işlevleri
do $$
begin
  if exists (select 1 from pg_type where typname = 'halfvec') then
    return;
  end if;
  raise notice 'halfvec tipi yok (pgvector %): yerel yedek tip vector işlevleriyle tanımlanıyor',
    (select extversion from pg_extension where extname = 'vector');
  execute 'create type extensions.halfvec';
  execute $f$create function extensions.halfvec_in(cstring, oid, integer) returns extensions.halfvec
           as '$libdir/vector', 'vector_in' language c immutable strict parallel safe$f$;
  execute $f$create function extensions.halfvec_out(extensions.halfvec) returns cstring
           as '$libdir/vector', 'vector_out' language c immutable strict parallel safe$f$;
  execute $f$create function extensions.halfvec_typmod_in(cstring[]) returns integer
           as '$libdir/vector', 'vector_typmod_in' language c immutable strict parallel safe$f$;
  execute $f$create function extensions.halfvec_recv(internal, oid, integer) returns extensions.halfvec
           as '$libdir/vector', 'vector_recv' language c immutable strict parallel safe$f$;
  execute $f$create function extensions.halfvec_send(extensions.halfvec) returns bytea
           as '$libdir/vector', 'vector_send' language c immutable strict parallel safe$f$;
  execute $f$create type extensions.halfvec (input = extensions.halfvec_in, output = extensions.halfvec_out,
           typmod_in = extensions.halfvec_typmod_in, receive = extensions.halfvec_recv, send = extensions.halfvec_send,
           storage = external)$f$;
  execute $f$create function extensions.halfvec(extensions.halfvec, integer, boolean) returns extensions.halfvec
           as '$libdir/vector', 'vector' language c immutable strict parallel safe$f$;
  execute 'create cast (extensions.halfvec as extensions.halfvec) with function extensions.halfvec(extensions.halfvec, integer, boolean) as implicit';
  execute 'create cast (extensions.halfvec as vector) without function as assignment';
  execute 'create cast (vector as extensions.halfvec) without function as assignment';
  execute $f$create function extensions.halfvec_cosine_distance(extensions.halfvec, extensions.halfvec) returns float8
           as '$libdir/vector', 'cosine_distance' language c immutable strict parallel safe$f$;
  execute $f$create function extensions.halfvec_negative_inner_product(extensions.halfvec, extensions.halfvec) returns float8
           as '$libdir/vector', 'vector_negative_inner_product' language c immutable strict parallel safe$f$;
  execute $f$create function extensions.halfvec_norm(extensions.halfvec) returns float8
           as '$libdir/vector', 'vector_norm' language c immutable strict parallel safe$f$;
  execute $f$create operator extensions.<=> (leftarg = extensions.halfvec, rightarg = extensions.halfvec,
           procedure = extensions.halfvec_cosine_distance, commutator = operator(extensions.<=>))$f$;
  execute $f$create operator class extensions.halfvec_cosine_ops for type extensions.halfvec using hnsw as
           operator 1 extensions.<=> (extensions.halfvec, extensions.halfvec) for order by float_ops,
           function 1 extensions.halfvec_negative_inner_product(extensions.halfvec, extensions.halfvec),
           function 2 extensions.halfvec_norm(extensions.halfvec)$f$;
end
$$;

-- Supabase rolleri (barındırılan projede hazırdır)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator nologin noinherit;
  end if;
end
$$;
grant anon, authenticated, service_role to authenticator;  -- noqa: PRS

-- auth şeması: auth.users, auth.uid(), auth.jwt()
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid
language sql
stable
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
create or replace function auth.jwt() returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

-- Migration sahibi: Supabase "postgres"inin yerel eşleniği (süper kullanıcı değil; BYPASSRLS, CREATEROLE, CREATEDB)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ogrenmen_owner') then
    create role ogrenmen_owner nologin nosuperuser createrole createdb bypassrls;
  end if;
  -- uygulama rolleri önceki bir çalıştırmada (başka sahiple) yaratılmış olabilir: Supabase'deki gibi ADMIN yetkisi
  if exists (select 1 from pg_roles where rolname = 'bot_runtime') then
    execute 'grant bot_runtime to ogrenmen_owner with admin option';
  end if;
  if exists (select 1 from pg_roles where rolname = 'batch_worker') then
    execute 'grant batch_worker to ogrenmen_owner with admin option';
  end if;
  execute format('alter database %I owner to ogrenmen_owner', current_database());   -- public şeması pg_database_owner'a aittir
end
$$;
grant anon, authenticated, service_role, authenticator to ogrenmen_owner with admin option;  -- noqa: PRS
alter schema extensions owner to ogrenmen_owner;
grant usage on schema auth to ogrenmen_owner;
grant select, insert, update, delete, references on auth.users to ogrenmen_owner;   -- Supabase postgres auth.users üzerinde tam yetkilidir
grant execute on function auth.uid(), auth.jwt() to ogrenmen_owner;
