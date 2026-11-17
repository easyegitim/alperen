-- seed/02_runtime_flags.sql — çalışma bayrakları ve harcama tavanları (public.runtime_flags). cron_owner'ı
-- 0016_cron.sql yazar.
insert into public.runtime_flags (key, value, updated_by) values
  ('paid_llm_enabled', 'true'::jsonb, 'seed'),
  ('degraded_mode', 'false'::jsonb, 'seed'),
  ('daily_cap_usd', '5.0'::jsonb, 'seed'),
  ('monthly_cap_usd', '120.0'::jsonb, 'seed'),
  ('student_monthly_cap_usd', '8.0'::jsonb, 'seed'),
  ('cap_excluded_purposes', '[]'::jsonb, 'seed'),
  ('alert_thresholds', '[0.5,0.8,1.0]'::jsonb, 'seed'),
  ('proactive_enabled', 'true'::jsonb, 'seed'),
  ('curriculum_autopilot', '{"exam_track":true,"school":true,"university":false,"other":false}'::jsonb, 'seed'),
  ('llm_fake', 'false'::jsonb, 'seed')
on conflict (key) do nothing;
