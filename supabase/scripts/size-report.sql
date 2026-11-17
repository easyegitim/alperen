-- supabase/scripts/size-report.sql — depolama raporu (v2). Yalnız okur; tablo ve sütun adları dışında veri göstermez.
-- Kullanım: psql "$OGRENMEN_DATABASE_URL" -f supabase/scripts/size-report.sql

\echo '== Toplam (public + secure + audit)'
select pg_size_pretty(sum(pg_total_relation_size(c.oid))) as toplam
  from pg_class as c
  join pg_namespace as n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p', 'm') and n.nspname in ('public', 'secure', 'audit');

\echo '== En büyük 15 tablo (indeks + TOAST dahil)'
select n.nspname || '.' || c.relname as tablo,
       pg_size_pretty(pg_total_relation_size(c.oid)) as toplam,
       pg_size_pretty(pg_relation_size(c.oid)) as veri,
       pg_size_pretty(pg_indexes_size(c.oid)) as indeks,
       greatest(c.reltuples, 0)::bigint as satir_tahmini
  from pg_class as c
  join pg_namespace as n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p') and n.nspname in ('public', 'secure', 'audit')
 order by pg_total_relation_size(c.oid) desc
 limit 15;

\echo '== Büyüyen sütunlar: sohbet içeriği, yükleme metni ve gömmeler'
select 'conversation_messages.content' as kalem, count(*) as dolu_satir,
       pg_size_pretty(coalesce(sum(pg_column_size(cm.content)), 0)) as boyut
  from public.conversation_messages as cm
union all
select 'uploads.extracted_text', count(*) filter (where u.extracted_text is not null),
       pg_size_pretty(coalesce(sum(pg_column_size(u.extracted_text)), 0))
  from public.uploads as u
union all
select 'uploads.embedding', count(*) filter (where u.embedding is not null),
       pg_size_pretty(coalesce(sum(pg_column_size(u.embedding)), 0))
  from public.uploads as u
union all
select 'solution_analyses.embedding', count(*) filter (where sa.embedding is not null),
       pg_size_pretty(coalesce(sum(pg_column_size(sa.embedding)), 0))
  from public.solution_analyses as sa
union all
select 'library_chunks.embedding', count(*) filter (where lc.embedding is not null),
       pg_size_pretty(coalesce(sum(pg_column_size(lc.embedding)), 0))
  from public.library_chunks as lc;

\echo '== Öğrenci başına hafıza dosyası boyutu — en yüksek 5'
select count(*) as dosya, sum(mf.bytes) as bayt
  from public.memory_files as mf
 group by mf.student_id
 order by sum(mf.bytes) desc
 limit 5;

\echo '== Çalışma bayrakları'
select rf.key, rf.value
  from public.runtime_flags as rf
 where rf.key in ('cron_owner', 'degraded_mode', 'paid_llm_enabled');
