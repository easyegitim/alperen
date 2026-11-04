-- 0011: davet kilidi için kullanıcı başına davet kodu (KB P#15/Ç12; FEATURE_REFERRAL_UNLOCK). Yalnız yerel; push onay ister.
-- referrals (0010) satırları referrer_id ↔ referee_id ilişkisini tutar; kodun sahibini bulmak için profiles.referral_code gerekir.
alter table public.profiles
  add column if not exists referral_code text unique
    check (referral_code ~ '^DV-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$');
comment on column public.profiles.referral_code is 'Davet kodu (DV-XXXX-XXXX); yalnız service role yazar (GET /api/referral ilk açılışta üretir).';
-- authenticated kullanıcı kendi kodunu okur (p_profiles_read 0002), yazamaz (grant verilmez).
