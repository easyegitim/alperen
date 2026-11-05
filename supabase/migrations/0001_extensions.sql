-- 0001_extensions.sql — uzantılar (docs/PLAN-v2-detail.md §2).
-- pgcrypto: gen_random_bytes (app.base32_random), digest; vector: halfvec(1024) gömme sütunları (Voyage voyage-3.5,
-- pgvector 0.7+; yerel pgvector 0.6 için tests/00_local_stub.sql'de yedek tip); pg_trgm: metin benzerliği;
-- pg_cron yalnız sunucuda varsa (Supabase'de var, yerel Postgres'te stub). Supabase bu uzantıları "extensions"
-- şemasına kurar; "if not exists" mevcut kurulumu değiştirmez.

create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_trgm;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron kurulamadı (%): zamanlanmış işleri worker üstlenir', sqlerrm;
    end;
  else
    raise notice 'pg_cron yok: zamanlanmış işleri worker üstlenir (runtime_flags.cron_owner)';
  end if;
end
$$;
