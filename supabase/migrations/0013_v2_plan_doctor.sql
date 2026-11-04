-- 0013: Sprint 2 plan, anket v2, doktor katmanı kuyruğu, ürün bağlantıları (CONTRACTS_V2 Sprint 2; KB §3.2/5–6, §6.1–6.4, Ç1, Ç3, Ç4, Ç5; PLAN_V2 4c/4d/4f/4g).
-- YEREL DOSYA: staging/production'a push kullanıcı onayı ister (CLAUDE.md). Uygulandıktan sonra `pnpm db:types`.
-- RLS: analyses ve coach_reports'a tarayıcı politikası yine YOK. doctor_recommendations'a da tarayıcı politikası YOK:
-- hekim incelemesi olmadan hiçbir öneri kullanıcıya ulaşamaz (AUP high-risk; Ç3). Teslim yalnız sunucu (admin) ile.
-- Fotoğraf, landmark, skor bu migration'ın hiçbir sütununa yazılmaz.

-- ── coach_reports: plan v2 ──────────────────────────────────────────────────────────────────────────────────────────
alter table public.coach_reports
  add column if not exists plan_v2 jsonb,          -- PlanV2 (lib/coach/planTypes.ts); doktor katmanı adımı içermez
  add column if not exists plan_version text,      -- 'plan.v2'
  add column if not exists report_version text;    -- 'report.v3' (prompt_version eski rapor istemini taşır)
comment on column public.coach_reports.plan_v2 is 'PlanV2 (fazlar, adım kartları, öncelik tablosu, basis çipleri); doctor katmanı okuma anında doctor_recommendations''tan eklenir; service role only';
comment on column public.coach_reports.plan_version is 'plan.v2; null = eski CoachReport (report.v2) satırı';

-- ── profiles: ödeme sonrası anket v2 ve beden algısı taraması ─────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists questionnaire_v2 jsonb,                 -- QuestionnaireV2 (lib/questionnaireV2.ts); skoru değiştirmez
  add column if not exists questionnaire_v2_at timestamptz,
  add column if not exists body_image_screen_result text
    check (body_image_screen_result in ('ok','risk')),            -- KB §6.4: 'risk' → doktor katmanı kapalı, uzmanla konuşma önerisi
  add column if not exists body_image_screened_at timestamptz;
comment on column public.profiles.questionnaire_v2 is 'Ödeme sonrası kişiselleştirme cevapları (KB §3.2/5); yalnız planı etkiler; yazma sunucu rotasıyla (Zod)';
comment on column public.profiles.body_image_screen_result is 'Beden algısı taraması sonucu (yalnız sonuç; cevaplar saklanmaz). risk → doktor katmanı gösterilmez';
-- authenticated bu sütunları yazamaz (0002 grant listesi değişmedi): yalnız service role (POST /api/questionnaire, /api/doctor/screen).

-- ── doctor_recommendations: hekim inceleme kuyruğu ─────────────────────────────────────────────────────────────────
create table if not exists public.doctor_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  report_id uuid references public.coach_reports(id) on delete set null,
  -- draft: YZ taslağı (kullanıcıya görünmez) → physician_reviewed: hekim onayladı/değiştirdi (görünebilir)
  -- → delivered: kullanıcı gördü · rejected: hekim reddetti (görünmez)
  status text not null default 'draft' check (status in ('draft','physician_reviewed','delivered','rejected')),
  -- YZ taslağı: en çok 2 öğe; her öğe { methodId, area, rationale, sources[] } — doz, marka, eczane/satış linki yok (Ç5)
  ai_items jsonb not null default '[]'::jsonb,
  ai_model text not null,
  ai_prompt_version text not null,
  -- hekimin son hali (değiştirebilir); kullanıcıya YALNIZ bu gider
  physician_items jsonb,
  physician_id uuid references auth.users(id) on delete set null,
  physician_notes text check (char_length(physician_notes) <= 2000),
  reviewed_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  -- kuyruk tutarlılığı: physician_reviewed/delivered yalnız hekim ve zaman damgasıyla
  check (status not in ('physician_reviewed','delivered') or (physician_id is not null and reviewed_at is not null and physician_items is not null)),
  check (jsonb_typeof(ai_items) = 'array' and jsonb_array_length(ai_items) <= 2),
  check (physician_items is null or (jsonb_typeof(physician_items) = 'array' and jsonb_array_length(physician_items) <= 2))
);
create index if not exists doctor_recommendations_user_idx on public.doctor_recommendations (user_id, created_at desc);
create index if not exists doctor_recommendations_queue_idx on public.doctor_recommendations (status, created_at) where status = 'draft';
comment on table public.doctor_recommendations is 'Doktor katmanı kuyruğu (Ç3/Ç5, AUP): tarayıcı politikası YOK; kullanıcıya yalnız status=physician_reviewed|delivered satırın physician_items alanı sunucu ile gider; 18 altına asla; FEATURE_DOCTOR_LAYER kapalıyken hiç yazılmaz';
alter table public.doctor_recommendations enable row level security;
-- politika yok = yalnız service role (hekim inceleme ekranı admin rotası üzerinden service role ile yazar)

-- Teslim kuralı veritabanında da: yalnız physician_reviewed → delivered geçişi delivered_at yazar (sunucu çağırır).
create or replace function public.deliver_doctor_recommendation(p_id uuid, p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.doctor_recommendations
     set status = 'delivered', delivered_at = now()
   where id = p_id and user_id = p_user and status = 'physician_reviewed';
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.deliver_doctor_recommendation(uuid, uuid) from public, anon, authenticated;

-- ── product_links: ürün ve uzman bağlantıları ("Reklam" etiketi; Ç4 ücret/komisyon kapalı) ─────────────────────────
create table if not exists public.product_links (
  id text primary key,                                   -- kısa kimlik (plan adımı linkIds)
  ref_id text not null,                                  -- katalog/yöntem kimliği (content/* ya da content/methods)
  kind text not null check (kind in ('product','expert','source')),
  label text not null check (char_length(label) <= 120),
  url text not null check (url ~ '^https://'),
  merchant text,                                          -- satıcı/klinik adı (hekim adı reklamda geçmez: K18)
  is_ad boolean not null default true,                    -- true: arayüzde "Reklam" etiketi zorunlu (K19)
  commercial_model text not null default 'none' check (commercial_model in ('none','listing_fee')),  -- komisyon YOK (Ç4)
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists product_links_ref_idx on public.product_links (ref_id) where active;
comment on table public.product_links is 'Ürün/uzman/kaynak bağlantıları; FEATURE_PRODUCT_LINKS kapalıyken kullanılmaz; komisyon modeli yok (Ç4)';
alter table public.product_links enable row level security;
create policy p_product_links_read on public.product_links for select using (active = true);

create table if not exists public.product_link_clicks (
  id uuid primary key default gen_random_uuid(),
  link_id text not null references public.product_links(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists product_link_clicks_link_idx on public.product_link_clicks (link_id, created_at desc);
alter table public.product_link_clicks enable row level security;
-- politika yok = yalnız service role (POST /api/links/click yazar; analitik olaylarına kimlik gitmez)

-- ── ops: doktor kuyruğu ve "Bozuk görünüyor" oranı sayaçları (0005 ops şeması) ─────────────────────────────────────
create or replace view ops.doctor_queue as
  select status, count(*) as n, min(created_at) as oldest
  from public.doctor_recommendations group by status;
