-- 0015_storage.sql — Supabase Storage kovaları (docs/PLAN-v2.md §6). storage şeması yoksa (yerel Postgres, stub'sız)
-- atlanır. uploads, lessons, documents özeldir (imzalı URL ya da storage.objects politikası); figures herkese açık
-- okunur (kişisel veri yok, yol tahmin edilemez uuid). storage.objects politikaları RLS ile birlikte B2'de yazılır.
-- lessons kovası Supabase TUS (resumable) yüklemesi içindir: ≤ 5 GB (projenin genel dosya sınırı da yükseltilmeli).

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage')
     or to_regclass('storage.buckets') is null then
    raise notice 'storage şeması yok (yerel Postgres): kovalar atlandı';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('uploads', 'uploads', false, 52428800,
     array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'audio/mpeg', 'audio/mp4', 'audio/webm',
           'text/plain', 'application/json']),
    ('lessons', 'lessons', false, 5368709120,
     array['video/mp4', 'video/quicktime', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/wav',
           'text/plain', 'text/vtt', 'application/x-subrip', 'application/x-ndjson', 'application/json']),
    ('documents', 'documents', false, 52428800, array['application/pdf', 'text/html']),
    ('figures', 'figures', true, 2097152, array['image/png', 'image/svg+xml'])
  on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
                                 allowed_mime_types = excluded.allowed_mime_types;
end
$$;
