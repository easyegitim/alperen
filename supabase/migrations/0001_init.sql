-- SPEC 13.1 metni birebir (docs/SPEC.md). Değişiklik önce SPEC'te yapılır.
create extension if not exists pgcrypto;

create type consent_type as enum (
  'kvkk_notice_ack', 'biometric_processing', 'photo_ai_analysis', 'cross_border_transfer',
  'tryon_generation', 'expert_data_sharing', 'marketing', 'analytics_cookies',
  'distance_sales_terms', 'instant_performance_waiver'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  birth_year int,
  is_adult boolean not null default false,
  locale text not null default 'tr',
  questionnaire jsonb not null default '{}'::jsonb,
  onboarding_completed_at timestamptz,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type consent_type not null,
  granted boolean not null,
  text_version text not null,
  created_at timestamptz not null default now()
);
create index consents_user_type_idx on public.consents (user_id, type, created_at desc);

create view public.current_consents with (security_invoker = true) as
  select distinct on (user_id, type) user_id, type, granted, text_version, created_at
  from public.consents order by user_id, type, created_at desc;

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_request_id uuid not null,
  status text not null default 'processing' check (status in ('processing','completed','failed')),
  geometry jsonb,                 -- GeometryResult (ham noktalar YOK)
  face_shape text,
  subscores jsonb,                -- kalibre alt skorlar
  gains jsonb,                    -- achievableGain
  observations jsonb,
  flags jsonb,
  raw_overall numeric(4,2),
  overall numeric(3,1),
  potential numeric(3,1),
  calibration_version text,
  scoring_model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, client_request_id)
);
create index analyses_user_created_idx on public.analyses (user_id, created_at desc);

create table public.coach_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  model text not null,
  prompt_version text not null,
  report jsonb not null,
  is_fallback boolean not null default false,
  safety_flags text[] not null default '{}',
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);
create index coach_reports_analysis_idx on public.coach_reports (analysis_id, created_at desc);

create table public.tryon_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_request_id uuid not null,
  preset_id text not null,
  status text not null check (status in ('pending','success','failed','identity_drift')),
  model text not null,
  created_at timestamptz not null default now(),
  unique (user_id, client_request_id)
);

create table public.routine_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('step','exercise','habit')),
  ref_id text,
  slot text not null check (slot in ('morning','evening','daily','weekly')),
  title text not null,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.routine_logs (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.routine_items(id) on delete cascade,
  log_date date not null,
  done boolean not null default true,
  primary key (user_id, item_id, log_date)
);

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'iyzico',
  plan text not null check (plan in ('weekly','monthly','yearly','week_pass')),
  status text not null check (status in ('pending','active','past_due','canceled','expired')),
  provider_subscription_ref text unique,
  provider_customer_ref text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_key text not null unique,
  payload jsonb not null,
  processed_at timestamptz,
  received_at timestamptz not null default now()
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('score','report','tryon','exercise')),
  target_id uuid,
  rating smallint check (rating in (-1, 1)),
  reason text check (char_length(reason) <= 500),
  is_abuse_report boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('doctor','clinic','dietitian','psychologist','dentist')),
  specialties text[] not null,
  city text not null,
  institution text,
  license_no text not null,
  verified_at timestamptz,
  contact_email text not null,
  commercial_model text not null default 'none'
    check (commercial_model in ('commission','listing_fee','lead_fee','none')),
  commission_rate numeric(5,2),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.referral_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  partner_id uuid not null references public.partners(id),
  ref_code text not null unique,
  specialty text not null,
  contact text not null,
  message text check (char_length(message) <= 600),
  shared_analysis_id uuid references public.analyses(id) on delete set null,
  status text not null default 'sent'
    check (status in ('sent','contacted','booked','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.referral_revenue (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referral_requests(id) on delete cascade,
  amount_try numeric(12,2) not null,
  model text not null,
  invoiced_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
