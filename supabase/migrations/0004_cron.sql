-- SPEC 13.4: gece işleri (Europe/Istanbul 03:00 = 00:00 UTC). pg_cron Supabase panelinden de açılabilir.
create extension if not exists pg_cron with schema pg_catalog;

-- 1) Silme talebinin üzerinden 7 gün geçmiş kullanıcıları auth.users'tan sil (cascade ile tüm satırlar gider).
create or replace function public.purge_deleted_users() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from auth.users u
  using public.profiles p
  where p.id = u.id
    and p.deletion_requested_at is not null
    and p.deletion_requested_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- 2) 10 dakikadan uzun 'processing' kalan analizler ve 1 saatten uzun 'pending' kalan denemeler 'failed' olur.
create or replace function public.fail_stuck_jobs() returns integer
language plpgsql security definer set search_path = public as $$
declare n1 integer; n2 integer;
begin
  update public.analyses set status = 'failed'
    where status = 'processing' and created_at < now() - interval '10 minutes';
  get diagnostics n1 = row_count;
  update public.tryon_events set status = 'failed'
    where status = 'pending' and created_at < now() - interval '1 hour';
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

-- 3) 90 günden eski deneme olaylarını sil (SPEC 13 saklama tablosu).
create or replace function public.purge_old_tryon_events() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.tryon_events where created_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- 4) Dönemi geçmiş active/past_due abonelikleri 'expired' yap (webhook kaçarsa güvenlik ağı).
create or replace function public.expire_subscriptions() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.subscriptions set status = 'expired', updated_at = now()
    where status in ('active', 'past_due') and current_period_end is not null and current_period_end < now();
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.purge_deleted_users() from public, anon, authenticated;
revoke execute on function public.fail_stuck_jobs() from public, anon, authenticated;
revoke execute on function public.purge_old_tryon_events() from public, anon, authenticated;
revoke execute on function public.expire_subscriptions() from public, anon, authenticated;

-- cron.schedule aynı adla tekrar çağrılırsa mevcut işi günceller (idempotent).
select cron.schedule('aura_purge_deleted_users',   '0 0 * * *', $$select public.purge_deleted_users()$$);
select cron.schedule('aura_fail_stuck_jobs',       '0 0 * * *', $$select public.fail_stuck_jobs()$$);
select cron.schedule('aura_purge_old_tryon_events', '0 0 * * *', $$select public.purge_old_tryon_events()$$);
select cron.schedule('aura_expire_subscriptions',  '0 0 * * *', $$select public.expire_subscriptions()$$);
