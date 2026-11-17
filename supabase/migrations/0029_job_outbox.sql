-- 0029_job_outbox.sql — SQL'den kuyruğa atılan işler kaybolmaz (P1-fix; docs/PLAN-v2.md §6, docs/PLAN-v2-detail.md
-- §2.5). Önceden public.enqueue_job() pgboss şeması yoksa yalnız audit.events'e 'job.enqueue_skipped' yazıyordu; kuyruk
-- yoksa ya da INSERT düşerse (en sık neden: enqueue_job'un SECURITY DEFINER sahibi, worker'ın kurduğu pgboss şemasında
-- yetkisiz) OGR-JOB-001 yükseltiyor, app.try_enqueue bunu 'job.enqueue_failed' denetim satırına çevirip işi düşürüyordu
-- (onboarding_enroll, start_practice, finish_practice, apply_diagnosis …). Artık:
--   * enqueue_job pgboss.job'a yazamadığı her durumda (şema/tablo yok, okunamıyor, kuyruk yok, INSERT hatası) işi aynı
--     işlemde secure.job_outbox'a yazar, denetim satırını da bırakır ('job.enqueue_skipped' şema/tablo yokken,
--     'job.enqueue_failed' diğerlerinde; diff.outbox_id) ve null döner. Çağıran RPC düşmez, iş iş kaydıyla aynı işlemdedir
--     (RPC geri alınırsa outbox satırı da geri alınır).
--   * Geçersiz ad (OGR-JOB-002) yine hatadır; politika çakışması (singleton/stately, pg-boss gibi) null döner ve outbox'a
--     yazılmaz (bilinçli tekilleştirme).
--   * apps/worker 'outbox.drain' işi her 30 sn'de outbox'ı kendi bağlantısıyla (pgboss'a yetkili rol) pg-boss'a aktarır:
--     tek işlemde FOR UPDATE SKIP LOCKED → boss.send({ id: outbox.id }) → DELETE; aktarılamayan satırda attempts,
--     retried_at, last_error güncellenir (5 dk sonra yeniden denenir).

-- --- tablo -------------------------------------------------------------------------------------------

create table secure.job_outbox (  -- pg-boss'a yazılamayan SQL işleri; worker outbox.drain ile aktarır, aktarılan satır silinir.
  id uuid primary key default gen_random_uuid(),  -- Satır kimliği; aktarımda pg-boss iş kimliği olarak kullanılır (tekrar aktarım aynı işi yaratmaz)
  name text not null check (name ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]*$'),  -- İş (kuyruk) adı
  data jsonb not null default '{}'::jsonb,  -- İş yükü (enqueue_job'a verilen)
  reason text,  -- Neden düştü (Postgres hata metni ya da 'OGR-JOB-001 kuyruk yok')
  attempts int not null default 0 check (attempts >= 0),  -- Başarısız aktarım denemesi sayısı
  last_error text,  -- Son aktarım hatası
  created_at timestamptz not null default now(),  -- İşin kuyruğa atılmak istendiği zaman
  retried_at timestamptz  -- Son aktarım denemesi (başarısız); null: hiç denenmedi
);
-- begin comments secure.job_outbox
comment on table secure.job_outbox is 'pg-boss''a yazılamayan SQL işleri; worker outbox.drain ile aktarır, aktarılan satır silinir.';
comment on column secure.job_outbox.id is 'Satır kimliği; aktarımda pg-boss iş kimliği olarak kullanılır (tekrar aktarım aynı işi yaratmaz)';
comment on column secure.job_outbox.name is 'İş (kuyruk) adı';
comment on column secure.job_outbox.data is 'İş yükü (enqueue_job''a verilen)';
comment on column secure.job_outbox.reason is 'Neden düştü (Postgres hata metni ya da ''OGR-JOB-001 kuyruk yok'')';
comment on column secure.job_outbox.attempts is 'Başarısız aktarım denemesi sayısı';
comment on column secure.job_outbox.last_error is 'Son aktarım hatası';
comment on column secure.job_outbox.created_at is 'İşin kuyruğa atılmak istendiği zaman';
comment on column secure.job_outbox.retried_at is 'Son aktarım denemesi (başarısız); null: hiç denenmedi';
-- end comments secure.job_outbox
create index job_outbox_created on secure.job_outbox (created_at);
alter table secure.job_outbox enable row level security;
alter table secure.job_outbox force row level security;
-- service_role (worker) 0002'nin varsayılan yetkileriyle select/insert/update/delete alır; authenticated/anon hiçbir şey.

-- --- outbox'a yazım ----------------------------------------------------------------------------------

-- İşi outbox'a yazar ve denetim satırı bırakır (yalnız enqueue_job çağırır); outbox kimliğini döner.
create or replace function app.job_outbox_put(p_name text, p_data jsonb, p_reason text, p_action text) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, audit, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into secure.job_outbox (name, data, reason)
  values (p_name, coalesce(p_data, '{}'::jsonb), left(p_reason, 2000))
  returning id into v_id;
  perform app.audit_event(p_action, 'pgboss.job', v_id::text,
                          jsonb_build_object('name', p_name, 'data', p_data, 'reason', p_reason, 'outbox_id', v_id));
  return v_id;
end
$$;
comment on function app.job_outbox_put(text, jsonb, text, text) is 'enqueue_job yedeği: işi secure.job_outbox''a yazar, audit.events''e p_action (job.enqueue_skipped | job.enqueue_failed) bırakır; outbox kimliğini döner.';
revoke all on function app.job_outbox_put(text, jsonb, text, text) from public, authenticated, service_role;

-- --- enqueue_job (0016'nın yerine) -------------------------------------------------------------------

-- pg-boss işi ekler (pg-boss 12.x send() yolunun taklidi; ayarlar pgboss.queue'dan, bkz. 0016). Yazamazsa outbox'a düşer.
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
      perform app.job_outbox_put(p_name, p_data, sqlerrm, 'job.enqueue_skipped');
      return null;
    when others then  -- en sık: insufficient_privilege (sahip pgboss şemasında yetkisiz)
      perform app.job_outbox_put(p_name, p_data, format('%s (%s)', sqlerrm, sqlstate), 'job.enqueue_failed');
      return null;
  end;
  if not v_queue then
    perform app.job_outbox_put(p_name, p_data, format('OGR-JOB-001 kuyruk yok: %s (worker createQueue çağırmalı)', p_name),
                               'job.enqueue_failed');
    return null;
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
      perform app.job_outbox_put(p_name, p_data, sqlerrm, 'job.enqueue_skipped');
      return null;
    when others then
      perform app.job_outbox_put(p_name, p_data, format('%s (%s)', sqlerrm, sqlstate), 'job.enqueue_failed');
      return null;
  end;
  return v_id;
end
$$;
comment on function public.enqueue_job(text, jsonb) is 'pg-boss işi ekler (pgboss.job, aynı işlemde; ayarlar pgboss.queue''dan); yazamazsa (şema/tablo yok, yetki, kuyruk yok, INSERT hatası) secure.job_outbox''a düşer, audit.events''e job.enqueue_skipped|job.enqueue_failed yazar ve null döner; geçersiz ad OGR-JOB-002.';
revoke all on function public.enqueue_job(text, jsonb) from public;
grant execute on function public.enqueue_job(text, jsonb) to service_role;

comment on function app.try_enqueue(text, jsonb) is 'enqueue_job''u alt işlemde dener; hata RPC''yi düşürmez, audit.events''e job.enqueue_failed yazar (0029''dan beri enqueue_job yalnız geçersiz adda hata verir; yazamadığı işi kendisi secure.job_outbox''a koyar).';

-- --- Realtime -----------------------------------------------------------------------------------------

-- apps/web `useLive` (src/lib/live.ts) bekleme ekranlarında bu tablolara abone olur (RLS Realtime'da da geçerlidir:
-- istemci yalnız görebildiği satırların olayını alır). Supabase'de supabase_realtime yayını vardır; yerelde yoksa atlanır
-- (yoklamaya düşülür). curricula 0025'te eklendi.
do $$
declare
  v_t text;
begin
  if exists (select 1 from pg_publication p where p.pubname = 'supabase_realtime') then
    foreach v_t in array array['suggestions', 'practice_sets', 'solution_analyses', 'uploads'] loop
      if not exists (select 1 from pg_publication_tables pt
                      where pt.pubname = 'supabase_realtime' and pt.schemaname = 'public' and pt.tablename = v_t) then
        execute format('alter publication supabase_realtime add table public.%I', v_t);
      end if;
    end loop;
  end if;
end
$$;
