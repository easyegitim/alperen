-- 0016_cron.sql — iş kuyruğuna SQL'den iş ekleme ve pg_cron zamanlamaları (docs/PLAN-v2.md §6, docs/PLAN-v2-detail.md
-- §2.5). İşleri pg-boss (apps/worker) çalıştırır; pgboss şemasını ve tablolarını worker açılışta kendisi kurar, bu
-- migration kurmaz. public.enqueue_job() aynı işlem içinde pgboss.job'a satır ekler (RPC + iş tek işlemde); pgboss
-- şeması/tablosu henüz yoksa hata vermez, audit.events'e 'job.enqueue_skipped' yazar ve null döner.
-- pg_cron yalnız enqueue eder (iş mantığı worker'dadır); pg_cron yoksa runtime_flags.cron_owner = 'worker' ve
-- zamanlamayı worker'ın kendi pg-boss schedule'ı üstlenir.

-- pg-boss işi ekler: pgboss.job (name, data); diğer sütunlar pg-boss'un varsayılanlarıdır (yeniden deneme, saklama).
-- pg-boss kuyruğun (pgboss.queue / bölüm) önceden yaratılmasını ister: worker her iş adı için createQueue çağırır.
-- Tablo/şema yoksa → audit + null; başka bir hata (kuyruk yok, kısıt) → OGR-JOB-001 ile yükselir (iş sessizce kaybolmaz).
create or replace function public.enqueue_job(p_name text, p_data jsonb default '{}'::jsonb) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, audit, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_name is null or p_name !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]*$' then
    raise exception using errcode = 'P0001', message = format('OGR-JOB-002 geçersiz iş adı %s', coalesce(p_name, '(boş)'));
  end if;
  begin
    execute 'insert into pgboss.job (name, data) values ($1, $2) returning id'
      into v_id
      using p_name, coalesce(p_data, '{}'::jsonb);
  exception
    when undefined_table or invalid_schema_name then
      perform app.audit_event('job.enqueue_skipped', 'pgboss.job', null,
                              jsonb_build_object('name', p_name, 'data', p_data, 'reason', sqlerrm));
      return null;
    when others then
      raise exception using errcode = 'P0001', message = format('OGR-JOB-001 iş eklenemedi (%s): %s', p_name, sqlerrm);
  end;
  return v_id;
end
$$;
comment on function public.enqueue_job(text, jsonb) is 'pg-boss işi ekler (pgboss.job, aynı işlemde); pgboss tablosu yoksa audit.events''e düşer ve null döner.';
revoke all on function public.enqueue_job(text, jsonb) from public;
grant execute on function public.enqueue_job(text, jsonb) to service_role;

-- Örnek zamanlamalar (UTC; Europe/Istanbul = UTC+3): yalnız iş ekler
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('ogrenmen-memory-compact', '17 23 * * *',
                          $c$select public.enqueue_job('memory-compact', '{}'::jsonb)$c$);  -- 02:17 TRT
    perform cron.schedule('ogrenmen-weekly-report', '41 15 * * 0',
                          $c$select public.enqueue_job('weekly-report', '{}'::jsonb)$c$);   -- pazar 18:41 TRT
    perform cron.schedule('ogrenmen-spend-rollup', '7 * * * *',
                          $c$select public.enqueue_job('spend-rollup', '{}'::jsonb)$c$);    -- saatlik
    insert into public.runtime_flags (key, value, updated_by) values ('cron_owner', '"pg_cron"'::jsonb, '0016_cron')
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
  else
    insert into public.runtime_flags (key, value, updated_by) values ('cron_owner', '"worker"'::jsonb, '0016_cron')
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
    raise notice 'pg_cron yok: cron_owner=worker (zamanlamayı worker''ın pg-boss schedule''ı üstlenir)';
  end if;
end
$$;
