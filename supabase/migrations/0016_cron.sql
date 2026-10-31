-- 0016_cron.sql — pg_cron zamanlamaları (UTC; Europe/Istanbul = UTC+3). pg_cron yoksa runtime_flags.cron_owner='worker'
-- ve Worker scheduled() aynı RPC'leri çağırır (BLUEPRINT §3.10, §5.9, §12 #28).

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ogrenmen-run-retention', '5 23 * * *', 'select public.run_retention()');            -- 02:05 TRT
    perform cron.schedule('ogrenmen-anonymize', '15 23 * * *', 'select public.anonymize_students()');          -- 02:15 TRT
    perform cron.schedule('ogrenmen-cap-facts', '20 23 * * *', 'select public.cap_memory_facts()');            -- 02:20 TRT
    perform cron.schedule('ogrenmen-table-sizes', '30 0 * * *', 'select public.compute_table_sizes()');        -- 03:30 TRT
    perform cron.schedule('ogrenmen-minor', '40 0 * * *', 'select public.recompute_is_minor()');               -- 03:40 TRT
    perform cron.schedule('ogrenmen-rollup-spend', '7 * * * *', 'select public.rollup_spend()');               -- saatlik
    perform cron.schedule('ogrenmen-idle-sessions', '9 * * * *', 'select public.cron_idle_sessions()');        -- saatlik
    insert into public.runtime_flags (key, value, updated_by) values ('cron_owner', '"pg_cron"'::jsonb, '0016_cron')
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  else
    insert into public.runtime_flags (key, value, updated_by) values ('cron_owner', '"worker"'::jsonb, '0016_cron')
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
    raise notice 'pg_cron yok: cron_owner=worker (Worker scheduled() saklama, boyut ve bakım RPC''lerini çağırır)';
  end if;
end
$$;
