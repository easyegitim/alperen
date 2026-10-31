-- seed/02_quota.sql — hizmet seviyeleri ve günlük kota sınırları (BLUEPRINT §3.5, §12 #14). Gün sınırı 00:00 Europe/Istanbul.
insert into public.quota_tiers (tier, label, service_level, advisor_sla_hours) values
  ('standard', 'Standart', 'ai_only', null),
  ('pilot', 'Pilot', 'ai_plus_advisor', 4),
  ('staff', 'Personel', 'ai_only', null)
on conflict (tier) do nothing;

insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values
  ('standard', 'message', 25, 5),
  ('standard', 'test', 5, 5),
  ('standard', 'research', 0, 5),
  ('standard', 'voice_minutes', 0, 5),
  ('standard', 'figure', 10, 5),
  ('pilot', 'message', 40, 5),
  ('pilot', 'test', 8, 5),
  ('pilot', 'research', 2, 5),
  ('pilot', 'voice_minutes', 0, 5),
  ('pilot', 'figure', 20, 5),
  ('staff', 'message', 50, 5),
  ('staff', 'test', 10, 5),
  ('staff', 'research', 5, 5),
  ('staff', 'voice_minutes', 0, 5),
  ('staff', 'figure', 20, 5)
on conflict (tier, kind) do nothing;
