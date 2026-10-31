-- supabase/scripts/size-report.sql — depolama bütçesi raporu (BLUEPRINT §3.12; Supabase ücretsiz plan 500 MB Postgres).
-- Kullanım: psql "$OGRENMEN_DATABASE_URL" -f supabase/scripts/size-report.sql
-- Eşikler: 350 MB uyarı (compute_table_sizes → instructor_alerts ops), 450 MB storage_pressure (mesaj saklama 60 gün,
-- prompt 14 gün, olgu tavanı 200). Bu rapor yalnız okur; tablo ve sütun adları dışında veri göstermez.

\echo '== Toplam (public + secure + audit)'
select pg_size_pretty(sum(pg_total_relation_size(c.oid))) as toplam,
       round(100.0 * sum(pg_total_relation_size(c.oid)) / (500 * 1024 * 1024), 1) as butce_yuzde,
       case when sum(pg_total_relation_size(c.oid)) > 450 * 1024 * 1024 then 'storage_pressure (> 450 MB)'
            when sum(pg_total_relation_size(c.oid)) > 350 * 1024 * 1024 then 'uyarı (> 350 MB)'
            else 'normal' end as durum
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

\echo '== Riskli sütunlar (§3.12): bot_responses.prompt_text ve memory_facts gömmeleri'
select 'bot_responses.prompt_text' as kalem, count(*) filter (where br.prompt_text is not null) as dolu_satir,
       pg_size_pretty(coalesce(sum(pg_column_size(br.prompt_text)), 0)) as boyut
  from public.bot_responses as br
union all
select 'memory_facts.embedding', count(*) filter (where mf.embedding is not null),
       pg_size_pretty(coalesce(sum(pg_column_size(mf.embedding)), 0))
  from public.memory_facts as mf
union all
select 'messages.text_raw + text_llm', count(*) filter (where m.text_raw is not null or m.text_llm is not null),
       pg_size_pretty(coalesce(sum(pg_column_size(m.text_raw)) + sum(pg_column_size(m.text_llm)), 0))
  from public.messages as m;

\echo '== Öğrenci başına aktif olgu (tavan 300; storage_pressure iken 200) — en yüksek 5'
select count(*) as aktif_olgu
  from public.memory_facts as mf
 where mf.status = 'active'
 group by mf.student_id
 order by count(*) desc
 limit 5;

\echo '== Son 14 günün toplam boyutu (table_sizes_daily, compute_table_sizes yazar)'
select t.day, pg_size_pretty(sum(t.total_bytes)) as toplam
  from public.table_sizes_daily as t
 where t.day > current_date - 14
 group by t.day
 order by t.day;

\echo '== Saklama bayrakları'
select rf.key, rf.value
  from public.runtime_flags as rf
 where rf.key in ('storage_pressure', 'cron_owner');
