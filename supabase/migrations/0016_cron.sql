-- 0016_cron.sql — iş kuyruğuna SQL'den iş ekleme ve pg_cron zamanlamaları (docs/PLAN-v2.md §6, docs/PLAN-v2-detail.md
-- §2.5). İşleri pg-boss (apps/worker) çalıştırır; pgboss şemasını ve tablolarını worker açılışta kendisi kurar, bu
-- migration kurmaz. public.enqueue_job() aynı işlem içinde pgboss.job'a satır ekler (RPC + iş tek işlemde; kuyruk
-- ayarları pgboss.queue'dan); pgboss şeması/tablosu henüz yoksa hata vermez, audit.events'e 'job.enqueue_skipped'
-- yazar ve null döner.
-- pg_cron yalnız enqueue eder (iş mantığı worker'dadır); pg_cron yoksa runtime_flags.cron_owner = 'worker' ve
-- zamanlamayı worker'ın kendi pg-boss schedule'ı üstlenir.

-- pg-boss işi ekler. pg-boss'un kendi send() yolunu (pg-boss 12.x plans.js insertJobs) taklit eder: yeniden deneme,
-- süre aşımı, saklama ve kalp atışı ayarları kuyruğun pgboss.queue satırından kopyalanır (worker'ın createQueue
-- seçenekleri SQL'den eklenen işlere de uygulanır; tablo varsayılanları değil). pg-boss kuyruğun önceden yaratılmasını
-- ister (worker her iş adı için createQueue çağırır): kuyruk satırı yoksa OGR-JOB-001 'kuyruk yok'. Kuyruk politikası
-- (singleton/stately) çakışmasında pg-boss gibi iş eklenmez ve null döner.
-- pgboss şeması/tablosu yoksa → audit 'job.enqueue_skipped' + null; başka bir hata → OGR-JOB-001 (iş sessizce kaybolmaz).
create or replace function public.enqueue_job(p_name text, p_data jsonb default '{}'::jsonb) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, audit, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_queue boolean;
begin
  if p_name is null or p_name !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]*$' then
    raise exception using errcode = 'P0001', message = format('OGR-JOB-002 geçersiz iş adı %s', coalesce(p_name, '(boş)'));
  end if;
  begin
    execute 'select exists (select 1 from pgboss.queue q where q.name = $1)' into v_queue using p_name;
  exception
    when undefined_table or invalid_schema_name then
      perform app.audit_event('job.enqueue_skipped', 'pgboss.job', null,
                              jsonb_build_object('name', p_name, 'data', p_data, 'reason', sqlerrm));
      return null;
  end;
  if not v_queue then
    raise exception using errcode = 'P0001', message = format('OGR-JOB-001 kuyruk yok: %s (worker createQueue çağırmalı)', p_name);
  end if;
  begin
    execute $sql$
      insert into pgboss.job (name, data, priority, start_after, created_on, expire_seconds, deletion_seconds, keep_until,
                              retry_limit, retry_delay, retry_backoff, retry_delay_max, policy, dead_letter, heartbeat_seconds)
      select $1, $2, 0, now(), now(), q.expire_seconds, q.deletion_seconds, now() + q.retention_seconds * interval '1s',
             q.retry_limit, q.retry_delay, q.retry_backoff, q.retry_delay_max, q.policy, q.dead_letter, q.heartbeat_seconds
        from pgboss.queue q
       where q.name = $1
      on conflict do nothing
      returning id
    $sql$
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
comment on function public.enqueue_job(text, jsonb) is 'pg-boss işi ekler (pgboss.job, aynı işlemde; ayarlar pgboss.queue''dan); kuyruk yoksa OGR-JOB-001; pgboss tablosu yoksa audit.events''e düşer ve null döner.';
revoke all on function public.enqueue_job(text, jsonb) from public;
grant execute on function public.enqueue_job(text, jsonb) to service_role;

-- Örnek zamanlamalar (UTC; Europe/Istanbul = UTC+3): yalnız iş ekler
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    -- İş adları apps/worker kayıt defteriyle birebir aynı olmalıdır (apps/worker/test/registry.test.ts denetler).
    perform cron.schedule('ogrenmen-memory-compact', '0 0 * * *',
                          $c$select public.enqueue_job('memory.compact', '{}'::jsonb)$c$);  -- 03:00 TRT (UTC+3)
    perform cron.schedule('ogrenmen-weekly-summary', '0 16 * * 0',
                          $c$select public.enqueue_job('weekly.summary', '{}'::jsonb)$c$);  -- pazar 19:00 TRT
    insert into public.runtime_flags (key, value, updated_by) values ('cron_owner', '"pg_cron"'::jsonb, '0016_cron')
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
  else
    insert into public.runtime_flags (key, value, updated_by) values ('cron_owner', '"worker"'::jsonb, '0016_cron')
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
    raise notice 'pg_cron yok: cron_owner=worker (zamanlamayı worker''ın pg-boss schedule''ı üstlenir)';
  end if;
end
$$;
