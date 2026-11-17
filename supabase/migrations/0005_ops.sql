-- SPEC 13.5: yalnız service role'ün okuyabildiği operasyon görünümleri.
-- Ayrı 'ops' şeması: PostgREST'e açık değildir, anon/authenticated'a yetki verilmez.
create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;
grant usage on schema ops to service_role;

-- Günler Europe/Istanbul'a göre.
create or replace view ops.daily_activity as
with days as (
  select generate_series(
    (date_trunc('day', now() at time zone 'Europe/Istanbul') - interval '89 days')::date,
    (date_trunc('day', now() at time zone 'Europe/Istanbul'))::date,
    interval '1 day'
  )::date as day
),
a as (
  select (created_at at time zone 'Europe/Istanbul')::date as day,
         count(*) filter (where status = 'completed') as completed,
         count(*) filter (where status = 'failed') as failed
  from public.analyses group by 1
),
r as (
  select (created_at at time zone 'Europe/Istanbul')::date as day,
         count(*) as reports,
         count(*) filter (where is_fallback) as fallback_reports
  from public.coach_reports group by 1
),
t as (
  select (created_at at time zone 'Europe/Istanbul')::date as day,
         count(*) filter (where status = 'success') as success,
         count(*) filter (where status = 'identity_drift') as identity_drift,
         count(*) filter (where status = 'failed') as failed
  from public.tryon_events group by 1
)
select d.day,
       coalesce(a.completed, 0)        as analyses_completed,
       coalesce(a.failed, 0)           as analyses_failed,
       coalesce(r.reports, 0)          as reports,
       coalesce(r.fallback_reports, 0) as fallback_reports,
       coalesce(t.success, 0)          as tryons_success,
       coalesce(t.identity_drift, 0)   as tryons_identity_drift,
       coalesce(t.failed, 0)           as tryons_failed
from days d
left join a using (day)
left join r using (day)
left join t using (day)
order by d.day desc;

-- Tahmini AI maliyeti (USD). Birim fiyatlar SPEC 5.4 / 8.9 / 10.7 tahminleridir; model değişirse güncellenir.
create or replace view ops.daily_ai_cost as
select day,
       analyses_completed + analyses_failed                      as analysis_calls,
       reports,
       tryons_success + tryons_identity_drift                    as tryon_generations,
       round(((analyses_completed + analyses_failed) * 0.004
            + reports * 0.005
            + (tryons_success + tryons_identity_drift) * 0.034)::numeric, 4) as est_cost_usd
from ops.daily_activity;

create or replace view ops.active_subscriptions as
select plan, count(*) as active_count,
       count(*) filter (where cancel_at_period_end) as canceling_count
from public.subscriptions
where status in ('active', 'past_due') and current_period_end > now()
group by plan;

-- Huni: profil → 18+ → anket → analiz → ödeme.
create or replace view ops.funnel as
select
  (select count(*) from public.profiles)                                                        as profiles,
  (select count(*) from public.profiles where is_adult)                                         as adults,
  (select count(*) from public.profiles where onboarding_completed_at is not null)              as questionnaire_completed,
  (select count(distinct user_id) from public.analyses where status = 'completed')              as analyzed_users,
  (select count(*) from public.subscriptions)                                                   as ever_checked_out,
  (select count(*) from public.subscriptions where status in ('active', 'past_due') and current_period_end > now()) as premium_now;

grant select on all tables in schema ops to service_role;
alter default privileges in schema ops grant select on tables to service_role;
