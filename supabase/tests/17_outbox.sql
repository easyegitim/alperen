-- tests/17_outbox.sql — enqueue_job outbox yedeği (0029): pgboss.job'a yazılamayan iş kaybolmaz, secure.job_outbox'a
-- düşer (aynı işlemde) ve denetim satırı bırakır. Durumlar: pgboss şeması yok ('job.enqueue_skipped'), SECURITY DEFINER
-- sahibi pgboss'ta yetkisiz (42501; worker'ı başka rolle kuran üretim hatası), kuyruk yok (OGR-JOB-001), yetki verilince
-- iş pgboss.job'a gider ve outbox'a yazılmaz; politika çakışması (singleton) outbox'a yazılmaz; geçersiz ad hata kalır;
-- RPC geri alınırsa outbox satırı da geri alınır; try_enqueue yolu da outbox'a düşer; outbox istemcilere kapalıdır.
begin;
\ir _fixture.sql

-- 1) pgboss şeması yok
do $$
declare
  v_id uuid;
  v_ob secure.job_outbox%rowtype;
begin
  perform t.ok(to_regclass('pgboss.job') is null, 'başlangıç: pgboss şeması yok');
  v_id := public.enqueue_job('suggestions.refresh', '{"student_id":"s-outbox-1"}');
  select * into v_ob from secure.job_outbox o where o.name = 'suggestions.refresh' and o.data ->> 'student_id' = 's-outbox-1';
  perform t.ok(v_id is null and v_ob.id is not null and v_ob.attempts = 0 and v_ob.retried_at is null and v_ob.reason is not null,
               'pgboss yok: null döner, iş outbox''a yazılır (yük, neden)');
  perform t.ok(exists (select 1 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'suggestions.refresh'
                        and e.diff ->> 'outbox_id' = v_ob.id::text and e.row_id = v_ob.id::text),
               'pgboss yok: audit job.enqueue_skipped outbox kimliğiyle');
  perform t.raises($q$select public.enqueue_job('kötü ad; drop', '{}')$q$, 'OGR-JOB-002%', 'geçersiz ad hâlâ hata');
  perform t.ok(not exists (select 1 from secure.job_outbox o where o.name like 'kötü%'), 'geçersiz ad outbox''a yazılmaz');
end $$;

-- 2) pgboss başka rolün: enqueue_job sahibi (migration rolü) yetkisiz → outbox (iş kaybolmaz)
create role t_boss_owner_0029 nologin;
create schema pgboss authorization t_boss_owner_0029;
set local role t_boss_owner_0029;
create table pgboss.queue (name text primary key, policy text not null, retry_limit int not null, retry_delay int not null,
                           retry_backoff bool not null, retry_delay_max int, expire_seconds int not null, retention_seconds int not null,
                           deletion_seconds int not null, dead_letter text, heartbeat_seconds int);
create table pgboss.job (id uuid not null default gen_random_uuid(), name text not null, priority int not null default 0, data jsonb,
                         retry_limit int not null default 2, retry_count int not null default 0, retry_delay int not null default 0,
                         retry_backoff bool not null default false, retry_delay_max int, expire_seconds int not null default 900,
                         deletion_seconds int not null default 604800, start_after timestamptz not null default now(),
                         created_on timestamptz not null default now(),
                         keep_until timestamptz not null default now() + interval '14 days', policy text, dead_letter text,
                         heartbeat_seconds int);
create unique index job_singleton on pgboss.job (name) where policy = 'singleton';
insert into pgboss.queue (name, policy, retry_limit, retry_delay, retry_backoff, retry_delay_max, expire_seconds, retention_seconds,
                          deletion_seconds, heartbeat_seconds)
values ('curriculum.draft', 'standard', 3, 60, true, 900, 900, 86400, 604800, null),
       ('t.tekil', 'singleton', 0, 0, false, null, 60, 3600, 3600, null);
reset role;

do $$
declare
  v_id uuid;
  v_ob secure.job_outbox%rowtype;
begin
  perform t.ok(not has_schema_privilege('ogrenmen_owner', 'pgboss', 'usage'), 'kurulum: migration rolü pgboss''ta yetkisiz');
  v_id := public.enqueue_job('curriculum.draft', '{"curriculum_id":"c-outbox-2"}');
  select * into v_ob from secure.job_outbox o where o.data ->> 'curriculum_id' = 'c-outbox-2';
  perform t.ok(v_id is null and v_ob.name = 'curriculum.draft' and v_ob.reason like '%42501%',
               'sahip yetkisiz: null döner, iş outbox''ta (neden: 42501)');
  perform t.ok(exists (select 1 from audit.events e where e.action = 'job.enqueue_failed' and e.diff ->> 'outbox_id' = v_ob.id::text),
               'sahip yetkisiz: audit job.enqueue_failed outbox kimliğiyle');
  -- RPC yolu (try_enqueue) da düşmez ve işi kaybetmez
  v_id := app.try_enqueue('curriculum.draft', '{"curriculum_id":"c-outbox-3"}');
  perform t.ok(v_id is null and exists (select 1 from secure.job_outbox o where o.data ->> 'curriculum_id' = 'c-outbox-3'),
               'try_enqueue: yetkisiz pgboss''ta iş outbox''a düşer');
end $$;

-- 3) yetki verilince: iş pgboss.job'a, outbox'a değil; kuyruk yoksa outbox; singleton çakışması outbox'a yazılmaz
grant usage on schema pgboss to ogrenmen_owner;
grant select on pgboss.queue to ogrenmen_owner;
grant select, insert on pgboss.job to ogrenmen_owner;

do $$
declare
  v_id uuid;
  v_n bigint;
begin
  v_n := (select count(*) from secure.job_outbox);
  v_id := public.enqueue_job('curriculum.draft', '{"curriculum_id":"c-outbox-4"}');
  perform t.ok(v_id is not null and (select j.data ->> 'curriculum_id' from pgboss.job j where j.id = v_id) = 'c-outbox-4'
               and (select count(*) from secure.job_outbox) = v_n,
               'yetkili sahip: iş pgboss.job''a yazılır, outbox''a yazılmaz');
  v_id := public.enqueue_job('yok.kuyruk', '{"a":1}');
  perform t.ok(v_id is null and exists (select 1 from secure.job_outbox o where o.name = 'yok.kuyruk' and o.reason like 'OGR-JOB-001 kuyruk yok%'),
               'kuyruk yok: hata yerine outbox (OGR-JOB-001 nedeniyle)');
  v_id := public.enqueue_job('t.tekil', '{}');
  perform t.ok(v_id is not null, 'singleton: ilk iş eklenir');
  v_id := public.enqueue_job('t.tekil', '{}');
  -- ayrı deyim: aynı deyimdeki alt sorgu fonksiyonun yazdığını görmez (anlık görüntü)
  perform t.ok(v_id is null and not exists (select 1 from secure.job_outbox o where o.name = 't.tekil'),
               'singleton çakışması: null, outbox''a yazılmaz (bilinçli tekilleştirme)');
end $$;

-- 4) işlem bütünlüğü: çağıran geri alınırsa outbox satırı da geri alınır
do $$
begin
  begin
    perform public.enqueue_job('yok.kuyruk', '{"rollback":true}');
    raise exception 'geri al';
  exception when others then
    null;
  end;
  perform t.ok(not exists (select 1 from secure.job_outbox o where o.data ->> 'rollback' = 'true'),
               'geri alınan RPC outbox satırı bırakmaz');
end $$;

-- 5) yetki: outbox yalnız SECURITY DEFINER yolu ve service_role (worker)
do $$
begin
  perform t.ok(not has_table_privilege('authenticated', 'secure.job_outbox', 'select')
               and not has_table_privilege('anon', 'secure.job_outbox', 'select')
               and has_table_privilege('service_role', 'secure.job_outbox', 'select, update, delete'),
               'secure.job_outbox: authenticated/anon erişemez, service_role okur/günceller/siler');
  perform t.ok(not has_function_privilege('authenticated', 'app.job_outbox_put(text, jsonb, text, text)', 'execute')
               and not has_function_privilege('service_role', 'app.job_outbox_put(text, jsonb, text, text)', 'execute'),
               'app.job_outbox_put yalnız enqueue_job içinden');
  perform t.as_user(t.u('elif'));
  perform t.raises('select count(*) from secure.job_outbox', '%permission denied%', 'öğrenci outbox''ı okuyamaz');
  perform t.as_admin();
end $$;

rollback;
