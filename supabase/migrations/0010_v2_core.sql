-- Aura v2 çekirdek şeması (CONTRACTS_V2.md §5; KB §3–§4, Ç1, Ç6, Ç11, Ç12; PLAN_V2 Faz 1–3).
-- YEREL DOSYA: staging/production'a push kullanıcı onayı ister (CLAUDE.md). Uygulandıktan sonra `pnpm db:types`.
-- RLS: 0002 ile aynı kalıp. analyses ve coach_reports'a tarayıcı politikası yine verilmez (kilitli değer sızmasın).
-- Yeni tablolarda sahip yalnız okur (auth.uid()); yazma yalnız service role (politika yok = yalnız service role).
-- Fotoğraf, kamera karesi ve 478 nokta hiçbir sütuna yazılmaz; analysis_sets yalnız HMAC set anahtarı ve skor tutar (K21, Ç11).

-- ── profiles: yaş bandı, sunum, yüz şekli düzeltmesi ───────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists age_band text
    check (age_band in ('under_18','18_24','25_34','35_49','50_plus')),
  -- türetilmiş: under_18 = age_band = 'under_18'; yazılamaz (generated)
  add column if not exists under_18 boolean generated always as (age_band = 'under_18') stored,
  -- ödeme öncesi cinsiyet sorusu (KB §3.1/2). questionnaire->>'presentation' ile aynı sözlük; tek kaynak bu sütundur,
  -- anket artık sormaz. Eski kayıtlar aşağıda bir kez taşınır.
  add column if not exists presentation text
    check (presentation in ('male','female','unspecified')),
  -- "Bence değil" (KB §4.10): kullanıcının seçtiği yüz şekli; saç/sakal önerileri buna göre.
  add column if not exists face_shape_override text
    check (face_shape_override in ('oval','round','square','long','heart','diamond'));

comment on column public.profiles.age_band is 'KB P#1/Ç1 yaş bandı; is_adult = age_band <> under_18 (uygulama yazar). under_18 bandı FEATURE_UNDER_18 kapalıyken giremez.';
comment on column public.profiles.under_18 is 'age_band = under_18 türetilmiş; doktor katmanı, yağ oranı ve oruç önerileri bu kullanıcıya gösterilmez (Ç1).';
comment on column public.profiles.presentation is 'Ödeme öncesi cinsiyet (male|female|unspecified); questionnaire.presentation yerine tek kaynak.';
comment on column public.profiles.face_shape_override is 'Kullanıcının yüz şekli düzeltmesi (Ç8/§4.10); null = düzeltme yok.';

update public.profiles
   set presentation = questionnaire->>'presentation'
 where presentation is null
   and questionnaire->>'presentation' in ('male','female','unspecified');

-- Kullanıcı kendi presentation ve face_shape_override sütununu yazabilir; age_band yalnız service role (yaş uç noktası).
grant update (presentation, face_shape_override) on public.profiles to authenticated;

-- ── analyses: durumlar, kart kart açılış, set anahtarı, cihaz sonucu, aralıklar, yüzdelik, çalıştırmalar ──────────
alter table public.analyses drop constraint if exists analyses_status_check;
alter table public.analyses
  add constraint analyses_status_check
    check (status in ('device_only','queued','running','processing','completed','failed'));

alter table public.analyses
  add column if not exists sections_ready jsonb not null default '[]'::jsonb,  -- SectionKey[] (P#23 kart kart açılış)
  add column if not exists set_key text,                                        -- analysis_sets.set_key (Ç11); null = önbellek yok
  add column if not exists device_result jsonb,                                 -- DeviceResult (oranlar + ön yüz şekli); herkese açık
  add column if not exists score_range jsonb,                                   -- { overall:[lo,hi], potential:[lo,hi], subscores:{k:[lo,hi]} }
  add column if not exists percentile numeric(5,2),                             -- yalnız genel skor (Ç6); FEATURE_PERCENTILE kapalıyken gönderilmez
  add column if not exists runs jsonb;                                          -- çalıştırma başına alt skor vektörleri (yalnız sayı); istemciye gitmez

comment on column public.analyses.sections_ready is 'hybrid.v2: hazır bölümler, sırayla (device, overall, subscores, potential, faceShape, explanations, improveFirst, report)';
comment on column public.analyses.set_key is 'HMAC-SHA-256 set anahtarı (analysis_sets); fotoğraf değil';
comment on column public.analyses.device_result is 'Cihazdan gelen oranlar ve ön yüz şekli; ödeme öncesi açık; model çıktısı değil';
comment on column public.analyses.score_range is 'Tek ondalıklı [alt, üst] aralıklar (KB §4.5); kilitli kullanıcıya gitmez';
comment on column public.analyses.percentile is 'Genel skor yüzdeliği (normal CDF, h2); yalnız bayrak açıkken sunulur';
comment on column public.analyses.runs is 'Ortanca-3/4 çalıştırmaların ham alt skor sayıları; metin, görsel veya landmark içermez; service role only';

create index if not exists analyses_set_key_idx on public.analyses (set_key) where set_key is not null;

-- ── analysis_sets: aynı dosya seti 1 yıl aynı skor (Ç11) ──────────────────────────────────────────────────────────
create table if not exists public.analysis_sets (
  set_key text primary key,                       -- HMAC-SHA-256(SET_CACHE_SECRET, sıralı sha256'lar '\n' ile birleşik), hex
  user_id uuid not null references auth.users(id) on delete cascade,
  scores jsonb not null,                          -- { overall, potential, subscores, score_range, percentile, signals(client kısmı) }
  model text not null,
  prompt_version text not null,
  calibration_version text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '365 days'
);
create index if not exists analysis_sets_user_idx on public.analysis_sets (user_id);
create index if not exists analysis_sets_expires_idx on public.analysis_sets (expires_at);
comment on table public.analysis_sets is 'Set hash önbelleği (Ç11): fotoğraf yok; hesap silinince cascade; 1 yıl sonra cron siler. Model değişirse eski skor korunur.';

-- ── offers: sunucu süreli teklif (P#18) ───────────────────────────────────────────────────────────────────────────
create table if not exists public.offers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  promo_product text not null check (promo_product in ('one_time_report','weekly','monthly','yearly')),
  regular_product text not null check (regular_product in ('one_time_report','weekly','monthly','yearly'))
);
comment on table public.offers is 'Kullanıcı başına bir kez başlar, sıfırlanmaz; expires_at geçince normal ürün (sahte sayaç yok).';

-- ── referrals: 5 davetle yalnız genel skor (Ç12) ──────────────────────────────────────────────────────────────────
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  code text not null,                              -- davet eden kullanıcının referans kodu
  referrer_id uuid not null references auth.users(id) on delete cascade,
  referee_id uuid not null references auth.users(id) on delete cascade,
  photo_submitted_at timestamptz,                  -- davet edilen fotoğraf yolladığında (device_only analiz)
  created_at timestamptz not null default now(),
  unique (referee_id),
  check (referrer_id <> referee_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id, photo_submitted_at);
comment on table public.referrals is 'Davet kilidi: referrer için photo_submitted_at dolu satır sayısı >= 5 → yalnız genel skor açılır (FEATURE_REFERRAL_UNLOCK).';

-- ── purchases: ürün satın alımları (tek seferlik rapor analize bağlanır) ───────────────────────────────────────────
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product text not null check (product in ('one_time_report','weekly','monthly','yearly')),
  analysis_id uuid references public.analyses(id) on delete set null,   -- one_time_report: tüketildiği analiz; null = henüz kullanılmadı
  provider text not null,                                                -- iyzico | revenuecat
  status text not null check (status in ('pending','paid','refunded','failed')),
  created_at timestamptz not null default now()
);
create index if not exists purchases_user_idx on public.purchases (user_id, created_at desc);
create unique index if not exists purchases_analysis_uidx on public.purchases (analysis_id) where analysis_id is not null;
comment on table public.purchases is 'Hak kaynağı sunucudur: tarayıcıdan gelen "ödeme başarılı" premium açmaz; webhook/doğrulama yazar.';

-- ── RLS (0002 kalıbı): sahip okur; yazma yalnız service role ───────────────────────────────────────────────────────
alter table public.analysis_sets enable row level security;
alter table public.offers enable row level security;
alter table public.referrals enable row level security;
alter table public.purchases enable row level security;

create policy p_analysis_sets_read on public.analysis_sets for select using (auth.uid() = user_id);
create policy p_offers_read on public.offers for select using (auth.uid() = user_id);
create policy p_referrals_read on public.referrals for select using (auth.uid() = referrer_id or auth.uid() = referee_id);
create policy p_purchases_read on public.purchases for select using (auth.uid() = user_id);
-- analyses, coach_reports: politika yok (yalnız service role) — değişmedi.

-- ── reserve_analysis: device_only satırlar kota saymaz ve kotaya takılmaz ─────────────────────────────────────────
-- İmza değişir (p_status eklendi, varsayılan 'processing'): eski 4 parametreli çağrılar aynen çalışır.
drop function if exists public.reserve_analysis(uuid, uuid, int, timestamptz);
create function public.reserve_analysis(
  p_user uuid, p_client_request_id uuid, p_limit int, p_since timestamptz, p_status text default 'processing'
) returns uuid language plpgsql security definer set search_path = public as $$
declare existing uuid; used int; new_id uuid;
begin
  if p_status not in ('device_only','queued','processing') then
    raise exception 'reserve_analysis: invalid initial status %', p_status;
  end if;
  perform pg_advisory_xact_lock(hashtext(p_user::text || ':analysis'));
  select id into existing from analyses where user_id = p_user and client_request_id = p_client_request_id;
  if existing is not null then return existing; end if;           -- idempotency
  if p_status <> 'device_only' then
    -- kota: yalnız ücretli yol (queued/running/processing/completed); device_only ve failed sayılmaz
    select count(*) into used from analyses
      where user_id = p_user and status in ('queued','running','processing','completed') and created_at >= p_since;
    if used >= p_limit then return null; end if;
  end if;
  insert into analyses (user_id, client_request_id, status) values (p_user, p_client_request_id, p_status) returning id into new_id;
  return new_id;
end $$;

-- Ödeme sonrası: device_only satırı aynı clientRequestId ile sıraya alınır (kota burada sayılır; idempotent).
create function public.promote_analysis(
  p_user uuid, p_analysis_id uuid, p_limit int, p_since timestamptz
) returns boolean language plpgsql security definer set search_path = public as $$
declare used int; cur text;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text || ':analysis'));
  select status into cur from analyses where id = p_analysis_id and user_id = p_user;
  if cur is null then return false; end if;
  if cur <> 'device_only' then return true; end if;                 -- zaten sırada/işlendi
  select count(*) into used from analyses
    where user_id = p_user and status in ('queued','running','processing','completed') and created_at >= p_since;
  if used >= p_limit then return false; end if;
  update analyses set status = 'queued' where id = p_analysis_id;
  return true;
end $$;

revoke execute on function public.reserve_analysis(uuid, uuid, int, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.promote_analysis(uuid, uuid, int, timestamptz) from public, anon, authenticated;

-- ── cron (0004 ek): takılı v2 işleri ve süresi dolan set önbelleği ─────────────────────────────────────────────────
create or replace function public.fail_stuck_jobs() returns integer
language plpgsql security definer set search_path = public as $$
declare n1 integer; n2 integer; n3 integer;
begin
  update public.analyses set status = 'failed'
    where status = 'processing' and created_at < now() - interval '10 minutes';
  get diagnostics n1 = row_count;
  -- hybrid.v2 süre sınırı yok (Ç16) ama 2 saat sonra takılı sayılır; hak düşmez (failed sayılmaz)
  update public.analyses set status = 'failed'
    where status in ('queued','running') and created_at < now() - interval '2 hours';
  get diagnostics n3 = row_count;
  update public.tryon_events set status = 'failed'
    where status = 'pending' and created_at < now() - interval '1 hour';
  get diagnostics n2 = row_count;
  return n1 + n2 + n3;
end $$;

create or replace function public.purge_expired_analysis_sets() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.analysis_sets where expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.purge_expired_analysis_sets() from public, anon, authenticated;
select cron.schedule('aura_purge_expired_analysis_sets', '0 0 * * *', $$select public.purge_expired_analysis_sets()$$);
