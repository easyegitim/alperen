-- seed/03_runtime_flags.sql — çalışma bayrakları ve tavanlar (BLUEPRINT §3.5, §5.6, §12 #15). İki bütçe: sohbet/toplu
-- (daily_cap_usd, monthly_cap_usd; cap_excluded_purposes HARİÇ) ve ders (lesson_monthly_cap_usd; yalnız cap_excluded_purposes).
-- cron_owner 0016_cron.sql'de pg_cron varlığına göre yazılır; buradaki satır onu ezmez (on conflict do nothing).
insert into public.runtime_flags (key, value, updated_by) values
  ('paid_llm_enabled', 'true'::jsonb, 'seed'),
  ('degraded_mode', 'false'::jsonb, 'seed'),
  ('daily_cap_usd', '0.8'::jsonb, 'seed'),
  ('monthly_cap_usd', '24.0'::jsonb, 'seed'),
  ('cap_excluded_purposes', '["lesson_analysis","transcribe","diarize"]'::jsonb, 'seed'),
  ('lesson_monthly_cap_usd', '30.0'::jsonb, 'seed'),
  ('alert_thresholds', '[0.5,0.8,1.0]'::jsonb, 'seed'),
  ('alerts_sent', '{}'::jsonb, 'seed'),
  ('proactive_enabled', 'true'::jsonb, 'seed'),
  ('research_enabled', 'false'::jsonb, 'seed'),
  ('research_monthly_cap', '40'::jsonb, 'seed'),
  ('tablet_nightly_count', '10'::jsonb, 'seed'),
  ('cron_owner', '"pg_cron"'::jsonb, 'seed'),
  ('storage_pressure', 'false'::jsonb, 'seed'),
  ('facts_lag_days', '0'::jsonb, 'seed'),
  ('prompt_version_chat', '"socratic.v3"'::jsonb, 'seed')
on conflict (key) do nothing;
