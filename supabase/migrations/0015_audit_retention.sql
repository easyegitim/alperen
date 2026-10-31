-- 0015_audit_retention.sql — denetim izi, saklama işleri, boyut ölçümü, Storage silme kuyruğu (BLUEPRINT §3.6, §3.10).
-- run_retention() retention_policies satırlarını okur: delete / null_columns / expire dinamik SQL, custom → app.retention_*
-- işleyicileri (çoklu tablo, secure şeması ve Storage kuyruğu mantığı yalnız bu işleyicilerdedir).

create table audit.events (  -- Yalnız eklemeli denetim izi; PII sütunları diff'e yazılmaz.
  id bigint generated always as identity primary key,  -- Olay kimliği
  at timestamptz not null default now(),  -- Olay zamanı
  actor_role text not null,  -- Rol: authenticated | bot_runtime | batch_worker | postgres
  actor_id text,  -- 'staff:<uuid>' | 'bot_runtime' | 'batch_worker:tablet'
  action text not null,  -- 'RPC:<ad>' ya da INSERT/UPDATE/DELETE
  table_name text not null,  -- Etkilenen tablo
  row_id text,  -- Etkilenen satır
  diff jsonb  -- Değişen alanlar (PII hariç)
);
-- begin comments audit.events
comment on table audit.events is 'Yalnız eklemeli denetim izi; PII sütunları diff''e yazılmaz.';
comment on column audit.events.id is 'Olay kimliği';
comment on column audit.events.at is 'Olay zamanı';
comment on column audit.events.actor_role is 'Rol: authenticated | bot_runtime | batch_worker | postgres';
comment on column audit.events.actor_id is '''staff:<uuid>'' | ''bot_runtime'' | ''batch_worker:tablet''';
comment on column audit.events.action is '''RPC:<ad>'' ya da INSERT/UPDATE/DELETE';
comment on column audit.events.table_name is 'Etkilenen tablo';
comment on column audit.events.row_id is 'Etkilenen satır';
comment on column audit.events.diff is 'Değişen alanlar (PII hariç)';
-- end comments audit.events
create index audit_events_at on audit.events (at desc);
create index audit_events_row on audit.events (row_id, action);

create table public.retention_runs (  -- Saklama işi çalıştırma kayıtları.
  id bigint generated always as identity primary key,  -- Kayıt kimliği
  policy_id text not null,  -- retention_policies.id
  affected_rows int not null,  -- Etkilenen satır/öğe sayısı
  ran_at timestamptz not null default now(),  -- Çalışma zamanı
  detail jsonb  -- Ayrıntı (mod, gün, hata)
);
-- begin comments public.retention_runs
comment on table public.retention_runs is 'Saklama işi çalıştırma kayıtları.';
comment on column public.retention_runs.id is 'Kayıt kimliği';
comment on column public.retention_runs.policy_id is 'retention_policies.id';
comment on column public.retention_runs.affected_rows is 'Etkilenen satır/öğe sayısı';
comment on column public.retention_runs.ran_at is 'Çalışma zamanı';
comment on column public.retention_runs.detail is 'Ayrıntı (mod, gün, hata)';
-- end comments public.retention_runs

create table public.table_sizes_daily (  -- Günlük tablo boyutları (depolama bütçesi).
  day date not null,  -- Gün
  table_name text not null,  -- Tablo (şema.tablo)
  total_bytes bigint not null,  -- Toplam boyut (indeks dahil)
  row_estimate bigint,  -- Satır tahmini
  primary key (day, table_name)
);
-- begin comments public.table_sizes_daily
comment on table public.table_sizes_daily is 'Günlük tablo boyutları (depolama bütçesi).';
comment on column public.table_sizes_daily.day is 'Gün';
comment on column public.table_sizes_daily.table_name is 'Tablo (şema.tablo)';
comment on column public.table_sizes_daily.total_bytes is 'Toplam boyut (indeks dahil)';
comment on column public.table_sizes_daily.row_estimate is 'Satır tahmini';
-- end comments public.table_sizes_daily

create table public.storage_deletions (  -- Storage silme kuyruğu; Worker saatlik cron Storage API ile siler.
  id bigint generated always as identity primary key,  -- Kuyruk kimliği
  bucket text not null,  -- Storage kovası
  path text not null,  -- Kova içindeki yol
  requested_at timestamptz not null default now(),  -- İstek zamanı
  done_at timestamptz,  -- Silinme zamanı
  error text  -- Son hata
);
-- begin comments public.storage_deletions
comment on table public.storage_deletions is 'Storage silme kuyruğu; Worker saatlik cron Storage API ile siler.';
comment on column public.storage_deletions.id is 'Kuyruk kimliği';
comment on column public.storage_deletions.bucket is 'Storage kovası';
comment on column public.storage_deletions.path is 'Kova içindeki yol';
comment on column public.storage_deletions.requested_at is 'İstek zamanı';
comment on column public.storage_deletions.done_at is 'Silinme zamanı';
comment on column public.storage_deletions.error is 'Son hata';
-- end comments public.storage_deletions

-- Denetim tetikleyicisi: TG_ARGV[0] = satır anahtarı sütunları (virgülle); PII ve büyük gövde sütunları diff'e girmez;
-- secure şemasında yalnız değişen alan ADLARI yazılır (değer yok).
create or replace function app.audit_row() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_skip text[] := array['text_raw', 'text_llm', 'display_name', 'username', 'guardian_name', 'guardian_relation', 'guardian_contact',
                         'birth_year', 'school', 'grade', 'name_token_hashes', 'mention_handle', 'prompt_text', 'evidence',
                         'analysis', 'seed_profile', 'body_md', 'plan', 'output', 'code', 'embedding', 'tsv', 'question_text'];
  v_keys text[] := string_to_array(coalesce(tg_argv[0], 'id'), ',');
  v_row_id text;
  v_diff jsonb;
  v_fields text[];
  v_uid uuid := app.uid();
begin
  select string_agg(v_row ->> k.col, ':' order by k.ord) into v_row_id from unnest(v_keys) with ordinality as k (col, ord);
  select array_agg(c.key order by c.key) into v_fields
    from jsonb_each(coalesce(v_new, v_old)) as c
   where tg_op <> 'UPDATE' or (v_old -> c.key) is distinct from (v_new -> c.key);
  if tg_table_schema = 'secure' then
    v_diff := jsonb_build_object('fields', coalesce(to_jsonb(v_fields), '[]'::jsonb));
  elsif tg_op = 'UPDATE' then
    select jsonb_object_agg(c.key, jsonb_build_object('old', v_old -> c.key, 'new', v_new -> c.key)) into v_diff
      from jsonb_each(v_new) as c
     where (v_old -> c.key) is distinct from c.value and not (c.key = any(v_skip));
  else
    select jsonb_object_agg(c.key, c.value) into v_diff
      from jsonb_each(v_row) as c
     where not (c.key = any(v_skip));
  end if;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
  values (app.jwt_role(), case when v_uid is not null then 'staff:' || v_uid else app.jwt_role() end, tg_op,
          tg_table_schema || '.' || tg_table_name, v_row_id, v_diff);
  return null;
end
$$;
comment on function app.audit_row() is 'Satır değişikliğini audit.events''e yazar (PII sütunları hariç; secure şemasında yalnız alan adları).';
revoke all on function app.audit_row() from public;

create trigger audit_row after insert or update or delete on public.consents
for each row execute function app.audit_row('id');
create trigger audit_row after insert or delete on public.staff_students
for each row execute function app.audit_row('staff_id,student_id');
create trigger audit_row after update of status on public.questions
for each row execute function app.audit_row('id');
create trigger audit_row after update of review_status on public.figures
for each row execute function app.audit_row('id');
create trigger audit_row after update of status on public.misconceptions
for each row execute function app.audit_row('id');
create trigger audit_row after update of status on public.lesson_analyses
for each row execute function app.audit_row('id');
create trigger audit_row after update of status on public.lesson_claims
for each row execute function app.audit_row('id');
create trigger audit_row after update of flagged on public.bot_responses
for each row execute function app.audit_row('id');
create trigger audit_row after update of approved, status on public.memory_facts
for each row execute function app.audit_row('id');
create trigger audit_row after insert or update or delete on public.runtime_flags
for each row execute function app.audit_row('key');
create trigger audit_row after insert or update or delete on public.retention_policies
for each row execute function app.audit_row('id');
create trigger audit_row after update of status on public.content_pool
for each row execute function app.audit_row('id');
create trigger audit_row after update of status on public.exam_priority_plans
for each row execute function app.audit_row('id');
create trigger audit_row after update of status on public.research_outputs
for each row execute function app.audit_row('id');
create trigger audit_row after update of status on public.instructor_alerts
for each row execute function app.audit_row('id');
create trigger audit_row after update of group_auto_answer_min, retention_days on public.tg_chats
for each row execute function app.audit_row('chat_id');
create trigger audit_row after insert or update on secure.student_pii
for each row execute function app.audit_row('student_id');

-- Saklama işleyicileri (imza (p_days int) returns int; yalnız run_retention ve bakım RPC'leri çağırır) ---------------

-- Kimlik verisini siler, ham metinleri boşaltır; öğrenme verisi rastgele kimlikle kalır (ADR-0004). Dönüş: öğrenci sayısı.
create or replace function app.anonymize_student_ids(p_ids uuid[]) returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
begin
  if coalesce(cardinality(p_ids), 0) = 0 then
    return 0;
  end if;
  delete from secure.student_pii sp where sp.student_id = any(p_ids);
  delete from secure.telegram_identities ti where ti.student_id = any(p_ids);
  delete from secure.auth_links al where al.student_id = any(p_ids);
  delete from secure.guardian_codes gc where gc.student_id = any(p_ids);
  update public.messages m set text_raw = null, text_llm = null
   where m.student_id = any(p_ids) and (m.text_raw is not null or m.text_llm is not null);
  delete from public.memory_facts f where f.student_id = any(p_ids);
  delete from public.weekly_summaries ws where ws.student_id = any(p_ids);
  update public.bot_responses br set prompt_text = null where br.student_id = any(p_ids) and br.prompt_text is not null;
  update public.escalations e set question_text = null where e.student_id = any(p_ids) and e.question_text is not null;
  -- öğrenci metninin kopyaları: alarm açıklamaları ('Cevapsız soru: "<text_llm>"', 'Teslim yaklaşıyor: <olgu>') ve
  -- araştırma sorguları. Açık alarmlar kapanır (silinmiş öğrenci için iş kalmaz), açıklama sabit metne iner.
  update public.instructor_alerts a set status = 'done', resolved_at = coalesce(a.resolved_at, now())
   where a.student_id = any(p_ids) and a.status <> 'done';
  update public.instructor_alerts a set detail = 'Silinmiş öğrenci'
   where a.student_id = any(p_ids) and a.detail <> 'Silinmiş öğrenci';
  update public.research_requests rr set query = '', expanded_queries = '{}'
   where rr.student_id = any(p_ids) and (rr.query <> '' or cardinality(rr.expanded_queries) > 0);
  delete from public.chat_roles cr where cr.student_id = any(p_ids);   -- Telegram kimliği yalnız yönlendirme içindi
  update public.consents c set evidence = c.evidence - 'telegram_user_id' where c.student_id = any(p_ids) and c.evidence ? 'telegram_user_id';
  update public.proactive_messages pm set status = 'skipped' where pm.student_id = any(p_ids) and pm.status = 'scheduled';
  update public.students s set status = 'deleted', deleted_at = coalesce(s.deleted_at, now()) where s.id = any(p_ids);
  return cardinality(p_ids);
end
$$;
comment on function app.anonymize_student_ids(uuid[]) is 'Öğrencilerin kimlik verisini siler ve ham metinleri boşaltır; deneme/gözlem/ustalık kalır.';
revoke all on function app.anonymize_student_ids(uuid[]) from public;

create or replace function app.retention_students_anonymize(p_days int) returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(s.id), '{}') into v_ids
    from public.students s
   where s.deleted_at is not null and s.deleted_at < now() - make_interval(days => p_days)
     and (exists (select 1 from secure.student_pii sp where sp.student_id = s.id)
          or exists (select 1 from secure.telegram_identities ti where ti.student_id = s.id)
          or exists (select 1 from secure.auth_links al where al.student_id = s.id)
          or exists (select 1 from secure.guardian_codes gc where gc.student_id = s.id)
          or exists (select 1 from public.messages m where m.student_id = s.id and (m.text_raw is not null or m.text_llm is not null))
          or exists (select 1 from public.memory_facts f where f.student_id = s.id)
          or exists (select 1 from public.weekly_summaries ws where ws.student_id = s.id)
          or exists (select 1 from public.bot_responses br where br.student_id = s.id and br.prompt_text is not null)
          or exists (select 1 from public.instructor_alerts a where a.student_id = s.id and a.detail <> 'Silinmiş öğrenci')
          or exists (select 1 from public.research_requests rr where rr.student_id = s.id and rr.query <> ''));
  return app.anonymize_student_ids(v_ids);
end
$$;
comment on function app.retention_students_anonymize(int) is 'students.deleted_at + p_days geçmiş öğrencileri anonimleştirir (secure satırları silinir, metinler boşaltılır).';

-- Video Storage'da değildir: bekleyen dersler için ops alarmı; gerçek silme kurucu makinesinde ders purge + confirm_video_deleted
create or replace function app.retention_lessons_video(p_days int) returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_n int;
  v_coord uuid;
begin
  select s.id into v_coord from public.staff s where s.role = 'coordinator' and s.active order by s.created_at limit 1;
  select count(*) into v_n from public.lessons l
   where l.held_at < now() - make_interval(days => p_days) and l.video_deleted_at is null and l.video_ref is not null;
  insert into public.instructor_alerts (kind, severity, student_id, staff_id, detail, since, ref)
  select 'ops', 'warning', null, v_coord,
         'Ders videosu silinmeyi bekliyor: ' || app.tr_stamp(l.held_at, false) || ' dersi (' || v_n || ' bekleyen)',
         l.held_at + make_interval(days => p_days), jsonb_build_object('lesson_id', l.id)
    from public.lessons l
   where l.held_at < now() - make_interval(days => p_days) and l.video_deleted_at is null and l.video_ref is not null
  on conflict do nothing;
  return v_n;
end
$$;
comment on function app.retention_lessons_video(int) is 'Silinmeyi bekleyen ders videoları için ops alarmı (video Storage''da değildir); bekleyen sayısı.';

create or replace function app.retention_lessons_transcript(p_days int) returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_n int;
begin
  with due as (
    select l.id, l.transcript_path
      from public.lessons l join public.enrollments e on e.id = l.enrollment_id
     where l.transcript_path is not null and e.status = 'closed' and e.ended_at is not null
       and e.ended_at < (now() - make_interval(days => p_days))::date
  ), q as (
    insert into public.storage_deletions (bucket, path)
    select 'transcripts', regexp_replace(d.transcript_path, '^transcripts/', '') from due d
    returning 1
  ), upd as (
    update public.lessons l set transcript_path = null from due d where l.id = d.id
    returning 1
  )
  select count(*) into v_n from upd;
  return v_n;
end
$$;
comment on function app.retention_lessons_transcript(int) is 'Kapalı kaydın transkriptini Storage silme kuyruğuna alır, lessons.transcript_path boşaltılır.';

create or replace function app.retention_enrollments_learning_data(p_days int) returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(e.id), '{}') into v_ids
    from public.enrollments e
   where e.status = 'closed' and e.ended_at is not null and e.ended_at < (now() - make_interval(days => p_days))::date
     and (exists (select 1 from public.observations o where o.enrollment_id = e.id and o.quote is not null)
          or exists (select 1 from public.attempts a where a.enrollment_id = e.id and a.chosen <> '{}'::jsonb));
  update public.observations o set quote = null where o.enrollment_id = any(v_ids) and o.quote is not null;
  update public.attempts a set chosen = '{}'::jsonb where a.enrollment_id = any(v_ids) and a.chosen <> '{}'::jsonb;
  return cardinality(v_ids);   -- mastery, mastery_history, misconceptions.text_* kalır
end
$$;
comment on function app.retention_enrollments_learning_data(int) is 'Kapalı kayıtlarda kanıt alıntıları ve seçimler anonimleştirilir; ustalık sayıları kalır.';

create or replace function app.retention_enrollments_closed(p_days int) returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_n int;
begin
  delete from public.memory_facts f
   where f.student_id in (
           select e.student_id from public.enrollments e
            where e.status = 'closed' and e.ended_at is not null and e.ended_at < (now() - make_interval(days => p_days))::date)
     and not exists (select 1 from public.enrollments a where a.student_id = f.student_id and a.status in ('active', 'paused'));
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
comment on function app.retention_enrollments_closed(int) is 'Kapalı kaydı (başka açık kaydı olmayan) öğrencinin hafıza olgularını siler; ustalık/gözlem kalır.';

revoke all on function app.retention_students_anonymize(int), app.retention_lessons_video(int), app.retention_lessons_transcript(int),
                       app.retention_enrollments_learning_data(int), app.retention_enrollments_closed(int) from public;

-- Saklama işi: politika başına retention_runs satırı; toplam etkilenen sayı
create function public.run_retention() returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_p public.retention_policies%rowtype;
  v_days int;
  v_n int;
  v_total int := 0;
  v_cond text;
  v_set text;
  v_nonnull text;
  v_pressure boolean;
begin
  if app.jwt_role() in ('authenticated', 'anon') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select coalesce((rf.value)::boolean, false) into v_pressure from public.runtime_flags rf where rf.key = 'storage_pressure';
  for v_p in select rp.* from public.retention_policies rp where rp.enabled order by rp.id loop
    v_days := v_p.days;
    if coalesce(v_pressure, false) and v_p.id = 'bot_responses.prompt_null' then
      v_days := least(v_days, 14);   -- storage_pressure: prompt 14 gün
    end if;
    v_cond := coalesce(' and (' || nullif(trim(v_p.condition_sql), '') || ')', '');
    begin
      if v_p.mode = 'delete' then
        execute format('delete from %I.%I where %I < now() - make_interval(days => %s)%s',
                       v_p.schema_name, v_p.table_name, v_p.ts_column, v_days, v_cond);
        get diagnostics v_n = row_count;
      elsif v_p.mode = 'null_columns' then
        select string_agg(format('%I = null', c.col), ', '), string_agg(format('%I is not null', c.col), ' or ')
          into v_set, v_nonnull from unnest(v_p.columns) as c (col);
        execute format('update %I.%I set %s where %I < now() - make_interval(days => %s) and (%s)%s',
                       v_p.schema_name, v_p.table_name, v_set, v_p.ts_column, v_days, v_nonnull, v_cond);
        get diagnostics v_n = row_count;
      elsif v_p.mode = 'expire' then
        execute format('update %I.%I set status = %L where %I < now() - make_interval(days => %s) and status not in (%L, %L)%s',
                       v_p.schema_name, v_p.table_name, 'expired', v_p.ts_column, v_days, 'expired', 'retracted', v_cond);
        get diagnostics v_n = row_count;
      else
        if v_p.handler !~ '^app\.retention_[a-z_]+$' then
          raise exception using errcode = 'P0001', message = format('OGR-RET-001 geçersiz işleyici %s', v_p.handler);
        end if;
        execute format('select %s($1)', v_p.handler) into v_n using v_days;
      end if;
      insert into public.retention_runs (policy_id, affected_rows, detail)
      values (v_p.id, coalesce(v_n, 0), jsonb_build_object('mode', v_p.mode, 'days', v_days));
      v_total := v_total + coalesce(v_n, 0);
    exception when others then
      insert into public.retention_runs (policy_id, affected_rows, detail)
      values (v_p.id, 0, jsonb_build_object('mode', v_p.mode, 'days', v_days, 'error', sqlerrm));
    end;
  end loop;
  return v_total;
end
$$;
comment on function public.run_retention() is 'retention_policies''e göre silme/boşaltma/süre dolumu/özel işleyiciler; politika başına retention_runs.';

-- Günlük boyut ölçümü: > 350 MB koordinatöre ops uyarısı; > 450 MB storage_pressure=true ve mesaj saklama 60 gün
-- (yalnız tg_chats.retention_days güncellenir; grup bildirimini Worker saatlik cron'u yeniden gönderir).
-- Toplam, günün table_sizes_daily satırlarının toplamıdır. Dönüş: toplam boyut (MB).
create function public.compute_table_sizes() returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_total bigint;
  v_coord uuid;
begin
  if app.jwt_role() in ('authenticated', 'anon') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  insert into public.table_sizes_daily as t (day, table_name, total_bytes, row_estimate)
  select v_today, n.nspname || '.' || c.relname, pg_total_relation_size(c.oid), greatest(c.reltuples, 0)::bigint
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p') and n.nspname in ('public', 'secure', 'audit')
  on conflict (day, table_name) do update set total_bytes = excluded.total_bytes, row_estimate = excluded.row_estimate;
  select coalesce(sum(t.total_bytes), 0) into v_total from public.table_sizes_daily t where t.day = v_today;
  select s.id into v_coord from public.staff s where s.role = 'coordinator' and s.active order by s.created_at limit 1;
  if v_total > 350 * 1024 * 1024 then
    insert into public.instructor_alerts (kind, severity, student_id, staff_id, detail, since, ref)
    values ('ops', 'warning', null, v_coord, 'Veritabanı boyutu 350 MB eşiğini aştı: ' || (v_total / 1048576) || ' MB', now(), '{}'::jsonb)
    on conflict do nothing;
  end if;
  if v_total > 450 * 1024 * 1024 then
    insert into public.runtime_flags as rf (key, value, updated_by) values ('storage_pressure', 'true'::jsonb, 'compute_table_sizes')
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by
     where rf.value is distinct from excluded.value;
    update public.tg_chats t set retention_days = 60 where t.retention_days > 60;   -- recording_notice_days DEĞİŞMEZ
  end if;
  return (v_total / 1048576)::int;
end
$$;
comment on function public.compute_table_sizes() is 'Tablo boyutlarını kaydeder; 350 MB uyarı, 450 MB storage_pressure (mesaj saklama 60 gün); toplam MB.';

create function public.anonymize_students() returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_days int;
begin
  if app.jwt_role() in ('authenticated', 'anon') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select rp.days into v_days from public.retention_policies rp where rp.id = 'students.anonymize';
  return app.retention_students_anonymize(coalesce(v_days, 30));
end
$$;
comment on function public.anonymize_students() is 'Cron: silme talebinden 30 gün sonra anonimleştirme (students.anonymize politikasının günü).';

-- Öğrenci başına aktif olgu tavanı (300; storage_pressure iken 200): en eskiler merged
create function public.cap_memory_facts() returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_cap int;
  v_n int;
begin
  if app.jwt_role() in ('authenticated', 'anon') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select case when coalesce((rf.value)::boolean, false) then 200 else 300 end into v_cap
    from public.runtime_flags rf where rf.key = 'storage_pressure';
  v_cap := coalesce(v_cap, 300);
  update public.memory_facts f set status = 'merged'
   where f.id in (select r.id from (select x.id, row_number() over (partition by x.student_id order by x.created_at desc, x.id desc) as rn
                                      from public.memory_facts x where x.status = 'active') as r
                   where r.rn > v_cap);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
comment on function public.cap_memory_facts() is 'Öğrenci başına aktif olgu tavanı (300; storage_pressure iken 200); fazlası merged.';

-- Koordinatör: silme talebini hemen uygular (30 gün beklemeden)
create function public.erase_student(p_student uuid) returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_n int;
begin
  if app.jwt_role() <> 'authenticated' or app.staff_role() is distinct from 'coordinator' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  v_n := app.anonymize_student_ids(array[p_student]);
  update public.escalations e set status = 'answered', answered_at = now(), answered_by = app.uid()
   where e.student_id = p_student and e.reason = 'deletion_request' and e.status = 'open';
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:erase_student', 'students', p_student::text);
  return v_n;
end
$$;
comment on function public.erase_student(uuid) is 'Koordinatör: öğrencinin kimlik verisini hemen siler ve metinleri boşaltır (ADR-0004); audit.';

grant execute on function public.run_retention(), public.compute_table_sizes(), public.anonymize_students(), public.cap_memory_facts()
  to bot_runtime, batch_worker;   -- pg_cron yoksa Worker ya da kulaklik retention çağırır
grant execute on function public.erase_student(uuid) to authenticated;

-- RLS ve yetkiler (0015 tabloları) ------------------------------------------------------------------------

alter table audit.events enable row level security;
alter table audit.events force row level security;
-- audit.events: politika ve GRANT yok; tetikleyiciler/RPC'ler (SECURITY DEFINER) yazar, koordinatör audit_recent() ile okur

alter table public.retention_runs enable row level security;
alter table public.retention_runs force row level security;
create policy retention_runs_staff_r on public.retention_runs for select to authenticated using (app.staff_role() in ('coordinator', 'observer'));
create policy retention_runs_batch on public.retention_runs for all to batch_worker using (true) with check (true);
grant select on public.retention_runs to authenticated;
grant select, insert, update on public.retention_runs to batch_worker;

alter table public.table_sizes_daily enable row level security;
alter table public.table_sizes_daily force row level security;
create policy table_sizes_daily_staff_r on public.table_sizes_daily for select to authenticated using (app.staff_role() in ('coordinator', 'observer'));
create policy table_sizes_daily_batch on public.table_sizes_daily for all to batch_worker using (true) with check (true);
grant select on public.table_sizes_daily to authenticated;
grant select, insert, update on public.table_sizes_daily to batch_worker;

alter table public.storage_deletions enable row level security;
alter table public.storage_deletions force row level security;
create policy storage_deletions_staff_r on public.storage_deletions for select to authenticated using (app.staff_role() in ('coordinator', 'observer'));
create policy storage_deletions_bot on public.storage_deletions for select to bot_runtime using (true);
create policy storage_deletions_bot_u on public.storage_deletions for update to bot_runtime using (true) with check (true);
create policy storage_deletions_batch on public.storage_deletions for all to batch_worker using (true) with check (true);
grant select on public.storage_deletions to bot_runtime, authenticated;
grant update (done_at, error) on public.storage_deletions to bot_runtime;
grant select, insert, update on public.storage_deletions to batch_worker;
