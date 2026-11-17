-- Faz 14 (F18): /admin metrikleri. 'ops' şeması PostgREST'e açık olmadığından view'lar public'te
-- security definer fonksiyonlarla okunur; yalnız service_role çalıştırabilir.
create or replace function public.ops_daily_activity(p_days int default 30)
returns setof ops.daily_activity language sql security definer set search_path = public, ops stable as $$
  select * from ops.daily_activity order by day desc limit greatest(1, least(p_days, 90));
$$;

create or replace function public.ops_daily_ai_cost(p_days int default 30)
returns setof ops.daily_ai_cost language sql security definer set search_path = public, ops stable as $$
  select * from ops.daily_ai_cost order by day desc limit greatest(1, least(p_days, 90));
$$;

create or replace function public.ops_active_subscriptions()
returns setof ops.active_subscriptions language sql security definer set search_path = public, ops stable as $$
  select * from ops.active_subscriptions;
$$;

create or replace function public.ops_funnel()
returns setof ops.funnel language sql security definer set search_path = public, ops stable as $$
  select * from ops.funnel;
$$;

-- Bildirilen içerikler (feedback.is_abuse_report): kişisel veri yok; hedef tür/kimlik ve metin.
create or replace function public.ops_reported_content(p_limit int default 50)
returns table (id uuid, target_type text, target_id uuid, reason text, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select f.id, f.target_type, f.target_id, f.reason, f.created_at
  from public.feedback f
  where f.is_abuse_report
  order by f.created_at desc
  limit greatest(1, least(p_limit, 200));
$$;

revoke execute on function public.ops_daily_activity(int) from public, anon, authenticated;
revoke execute on function public.ops_daily_ai_cost(int) from public, anon, authenticated;
revoke execute on function public.ops_active_subscriptions() from public, anon, authenticated;
revoke execute on function public.ops_funnel() from public, anon, authenticated;
revoke execute on function public.ops_reported_content(int) from public, anon, authenticated;
grant execute on function public.ops_daily_activity(int) to service_role;
grant execute on function public.ops_daily_ai_cost(int) to service_role;
grant execute on function public.ops_active_subscriptions() to service_role;
grant execute on function public.ops_funnel() to service_role;
grant execute on function public.ops_reported_content(int) to service_role;
