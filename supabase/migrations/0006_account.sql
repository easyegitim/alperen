-- Faz 13 (F15): veri dışa aktarma sayacı. GET /api/me/export günde 3 (SPEC 14).
-- Yalnız service role yazar/okur; tarayıcı politikası yok (RLS açık, politika yok).
create table public.data_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index data_exports_user_created_idx on public.data_exports (user_id, created_at desc);
alter table public.data_exports enable row level security;

-- Rıza geri alma ve silme talebi mevcut politikalarla çalışır:
--   consents  → p_consents_insert (yeni satır, geçmiş korunur)
--   profiles  → p_profiles_update (deletion_requested_at)
-- Geçmiş analiz silme (biometric_processing geri alınınca) service role ile yapılır; analyses'e tarayıcı politikası verilmez.
