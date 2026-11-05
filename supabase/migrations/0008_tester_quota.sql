-- Test kullanıcıları için sınırsız hak bayrağı (yalnız service role yazar; authenticated'a update grant'ı
-- 0002_rls.sql'de questionnaire ve locale ile sınırlı olduğundan kullanıcı kendi bayrağını açamaz).
-- Skor/teaser/kilit kurallarını değiştirmez; yalnız reserve_analysis / reserve_tryon / rapor yenileme limitlerini kaldırır.
alter table public.profiles add column if not exists unlimited_quota boolean not null default false;
comment on column public.profiles.unlimited_quota is 'Test hesabı: analiz, deneme ve rapor yenileme limitleri uygulanmaz (service role ayarlar).';
