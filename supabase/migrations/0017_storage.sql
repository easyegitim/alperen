-- 0017_storage.sql — Supabase Storage kovaları ve storage.objects politikaları (BLUEPRINT §3.6 sonu). storage şeması
-- yoksa (yerel Postgres) atlanır. figures public-read (PII yok; URL tahmin edilemez uuid), transcripts ve exams private.
-- Rol üyeliği: Storage API JWT'deki role claim'iyle SET ROLE yapar; özel roller supabase_storage_admin'e verilmelidir
-- (ADR-0014; verilemezse yedek create_figure_upload_url yolu).

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage şeması yok (yerel Postgres): kovalar ve politikalar atlandı';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('figures', 'figures', true, 2097152, array['image/png', 'image/svg+xml']),
    ('transcripts', 'transcripts', false, 5242880, array['application/x-ndjson', 'application/json']),
    ('exams', 'exams', false, 20971520, array['application/pdf'])
  on conflict (id) do nothing;
  -- figures: herkes okur (public bucket), yalnız batch_worker yazar; silme storage_deletions kuyruğu ile
  execute $p$create policy figures_public_read on storage.objects for select using (bucket_id = 'figures')$p$;
  execute $p$create policy figures_batch_write on storage.objects for insert to batch_worker with check (bucket_id = 'figures')$p$;
  execute $p$create policy figures_batch_delete on storage.objects for delete to bot_runtime, batch_worker using (bucket_id = 'figures')$p$;
  -- transcripts: batch_worker yazar/okur; atanan eğitmen ve koordinatör okur (gözlemci değil); silme bot_runtime (kuyruk)
  execute $p$create policy transcripts_batch on storage.objects for all to batch_worker
             using (bucket_id = 'transcripts') with check (bucket_id = 'transcripts')$p$;
  -- §3.8 E: yalnız atanan öğrencinin dersi (app.transcript_visible lessons.transcript_path ile eşler); gözlemci hiç
  execute $p$create policy transcripts_staff_read on storage.objects for select to authenticated
             using (bucket_id = 'transcripts' and app.transcript_visible(name))$p$;
  execute $p$create policy transcripts_bot_delete on storage.objects for delete to bot_runtime using (bucket_id = 'transcripts')$p$;
  -- exams: eğitmen/koordinatör yükler ve okur; batch_worker okur (kalem ingest); öğrenci ve bot ASLA
  execute $p$create policy exams_staff on storage.objects for all to authenticated
             using (bucket_id = 'exams' and app.staff_role() in ('instructor', 'coordinator'))
             with check (bucket_id = 'exams' and app.staff_role() in ('instructor', 'coordinator'))$p$;
  execute $p$create policy exams_batch_read on storage.objects for select to batch_worker using (bucket_id = 'exams')$p$;
  if exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    execute 'grant bot_runtime, batch_worker to supabase_storage_admin';
  end if;
end
$$;
