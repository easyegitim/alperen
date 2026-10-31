-- 0001_extensions.sql — uzantılar (BLUEPRINT §3.0)
-- pgcrypto: gen_random_bytes (app.base32_random); vector: halfvec(768) gömme sütunları (pgvector 0.7+);
-- pg_trgm: metin benzerliği; pg_cron yalnız sunucuda varsa (Supabase'de var, yerel Postgres'te yok).
-- Supabase bu uzantıları "extensions" şemasına kurar; "if not exists" mevcut kurulumu değiştirmez.

create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_trgm;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron kurulamadı (%): Worker cron üstlenir', sqlerrm;
    end;
  else
    raise notice 'pg_cron yok: zamanlanmış işleri Worker cron üstlenir (runtime_flags.cron_owner)';
  end if;
end
$$;
