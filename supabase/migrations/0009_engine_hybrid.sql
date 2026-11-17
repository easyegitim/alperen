-- hybrid.v1 skor motoru (engine spec §7.1, sözleşme C8). YEREL: staging/production'a push kullanıcı onayı ister.
-- signals: kategorik oylar + türetilmiş açıklama/öncelik; görsel, landmark veya serbest AI metni içermez.
-- ai_usage: {calls, attempts, input, output, cacheRead, cacheWrite, estUsd, servedModels}; başarısız satırlara da yazılır.
-- RLS değişmez: analyses ve coach_reports için tarayıcı politikası yok; yalnız service role erişir.

alter table public.analyses
  add column if not exists engine_version text,   -- null = eski (score.v1, Gemini sayısal)
  add column if not exists signals jsonb,         -- SignalsV1
  add column if not exists ai_usage jsonb;

alter table public.coach_reports
  add column if not exists ai_usage jsonb;

comment on column public.analyses.engine_version is 'null = legacy (score.v1); "hybrid.v1" = geometry + categorical observations scored in code';
comment on column public.analyses.signals is 'hybrid.v1 votes and derived explain/improveFirst; service role only';
comment on column public.analyses.ai_usage is 'token usage and estimated USD (computed in code from AI_PRICING); service role only';
comment on column public.coach_reports.ai_usage is 'token usage summed over every attempt; service role only';

-- Maliyet görünümü: 0005 ile aynı sütunlar ve sıra (ops_daily_ai_cost() 0007 çalışmaya devam eder).
-- ai_usage.estUsd varsa o kullanılır; eski satırlarda 0005'teki birim tahminler (0.004 / 0.005).
create or replace view ops.daily_ai_cost as
with ac as (
  select (created_at at time zone 'Europe/Istanbul')::date as day,
         sum(coalesce((ai_usage->>'estUsd')::numeric, 0.004)) as usd
  from public.analyses
  where status in ('completed', 'failed')
  group by 1
),
rc as (
  select (created_at at time zone 'Europe/Istanbul')::date as day,
         sum(coalesce((ai_usage->>'estUsd')::numeric, 0.005)) as usd
  from public.coach_reports
  group by 1
)
select d.day,
       d.analyses_completed + d.analyses_failed                 as analysis_calls,
       d.reports,
       d.tryons_success + d.tryons_identity_drift               as tryon_generations,
       round((coalesce(ac.usd, 0) + coalesce(rc.usd, 0)
              + (d.tryons_success + d.tryons_identity_drift) * 0.034)::numeric, 4) as est_cost_usd
from ops.daily_activity d
left join ac using (day)
left join rc using (day);
