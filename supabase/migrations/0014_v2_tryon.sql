-- 0014: Sprint 2 sanal deneme v2 — kombin, glow-up, Claude kalite kontrolü, "Bozuk görünüyor" (CONTRACTS_V2 Sprint 2; KB §7, Ç9, Ç10; PLAN_V2 5b–5e).
-- YEREL DOSYA: staging/production'a push kullanıcı onayı ister (CLAUDE.md). Uygulandıktan sonra `pnpm db:types`.
-- Görsel, maske ve landmark hiçbir sütuna yazılmaz; qc yalnız geç/kal ve neden kodları (lib/tryon/types.ts QC_REASONS).

-- ── tryon_events: mod, presetler, kalite kontrolü, ağırlık, bozuk bildirimi ───────────────────────────────────────
alter table public.tryon_events drop constraint if exists tryon_events_status_check;
alter table public.tryon_events
  add constraint tryon_events_status_check
    check (status in ('pending','success','failed','identity_drift','qc_failed'));   -- qc_failed: gösterilmedi, hak düşmedi (Ç10)

alter table public.tryon_events
  add column if not exists mode text not null default 'style' check (mode in ('style','combo','glow_up')),
  add column if not exists presets jsonb not null default '{}'::jsonb,   -- { hair?, beard?, color? } preset kimlikleri
  add column if not exists weight int not null default 1 check (weight between 1 and 5),  -- kota ağırlığı (AÇIK §11.2; 1)
  add column if not exists analysis_id uuid references public.analyses(id) on delete set null,
  add column if not exists plan_step_ids jsonb not null default '[]'::jsonb,  -- glow_up: uygulanmış plan adımı kimlikleri
  add column if not exists qc jsonb,                                       -- QcVerdict (pass, reasons, …); görsel yok
  add column if not exists regen_count int not null default 0 check (regen_count between 0 and 3),
  add column if not exists flagged_broken boolean not null default false,  -- "Bozuk görünüyor" (R2-C10/5)
  add column if not exists flagged_at timestamptz;

comment on column public.tryon_events.preset_id is 'Eski tek preset; v2''de presets jsonb''nin saç>sakal>renk ilk dolu değeri (uyumluluk)';
comment on column public.tryon_events.qc is 'Claude kalite kontrolü sonucu (geç/kal + neden kodları); görsel, maske veya landmark içermez';
comment on column public.tryon_events.flagged_broken is 'Kullanıcı "Bozuk görünüyor" dedi; oran yönetim panelinde izlenir';

create index if not exists tryon_events_flagged_idx on public.tryon_events (created_at) where flagged_broken;

-- ── reserve_tryon: mod + presetler + ağırlık; eski 6 parametreli çağrı aynen çalışır (varsayılanlar) ─────────────
drop function if exists public.reserve_tryon(uuid, uuid, text, text, int, timestamptz);
create function public.reserve_tryon(
  p_user uuid, p_client_request_id uuid, p_preset text, p_model text, p_limit int, p_since timestamptz,
  p_mode text default 'style', p_presets jsonb default null, p_weight int default 1, p_analysis_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare existing uuid; used int; new_id uuid;
begin
  if p_mode not in ('style','combo','glow_up') then
    raise exception 'reserve_tryon: invalid mode %', p_mode;
  end if;
  if p_weight < 1 or p_weight > 5 then
    raise exception 'reserve_tryon: invalid weight %', p_weight;
  end if;
  perform pg_advisory_xact_lock(hashtext(p_user::text || ':tryon'));
  select id into existing from tryon_events where user_id = p_user and client_request_id = p_client_request_id;
  if existing is not null then return existing; end if;                      -- idempotency
  -- kota: ağırlık toplamı; pending + success sayılır; failed, identity_drift ve qc_failed sayılmaz (hak iade, Ç10)
  select coalesce(sum(weight), 0) into used from tryon_events
    where user_id = p_user and status in ('pending','success') and created_at >= p_since;
  if used + p_weight > p_limit then return null; end if;
  insert into tryon_events (user_id, client_request_id, preset_id, status, model, mode, presets, weight, analysis_id)
    values (p_user, p_client_request_id, p_preset, 'pending', p_model, p_mode, coalesce(p_presets, '{}'::jsonb), p_weight, p_analysis_id)
    returning id into new_id;
  return new_id;
end $$;
revoke execute on function public.reserve_tryon(uuid, uuid, text, text, int, timestamptz, text, jsonb, int, uuid) from public, anon, authenticated;

-- "Bozuk görünüyor": kullanıcı yalnız kendi başarılı denemesini işaretler (idempotent). Sunucu rotası service role ile çağırır.
create or replace function public.flag_tryon_broken(p_user uuid, p_event uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.tryon_events set flagged_broken = true, flagged_at = coalesce(flagged_at, now())
   where id = p_event and user_id = p_user and status = 'success';
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.flag_tryon_broken(uuid, uuid) from public, anon, authenticated;

-- ── ops: günlük deneme kalitesi (bozuk oranı, kalite kontrolü başarısızlığı, mod kırılımı) ─────────────────────────
create or replace view ops.daily_tryon_quality as
  select (created_at at time zone 'Europe/Istanbul')::date as day,
         mode,
         count(*) filter (where status = 'success')                           as success,
         count(*) filter (where status = 'qc_failed')                         as qc_failed,
         count(*) filter (where status = 'identity_drift')                    as identity_drift,
         count(*) filter (where flagged_broken)                               as flagged_broken,
         round(coalesce(count(*) filter (where flagged_broken)::numeric
               / nullif(count(*) filter (where status = 'success'), 0), 0), 4) as broken_rate
  from public.tryon_events
  group by 1, 2;
