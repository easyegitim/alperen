-- 0015: Sprint 3 Faz 6 — affedici seri dondurma kayıtları ve admin "Bozuk görünüyor" oranı RPC'si (CONTRACTS_V2 Sprint 3 S3.6;
-- PLAN_V2 Faz 6 [ÖNERİ]; KB §7.3). YEREL DOSYA: staging/production'a push kullanıcı onayı ister (CLAUDE.md); canlı proje
-- 0010–0014'ü de almadı. Uygulandıktan sonra `pnpm db:types`.
-- Fotoğraf, landmark, hayalet kılavuz çizgisi hiçbir sütuna yazılmaz (hayalet kılavuz yalnız IndexedDB / uygulama sanal alanı).

-- ── routine_freezes: kullanıcının "seriyi dondur" dediği günler (ÖNERİ; sayı yer tutucu) ───────────────────────────
-- Dondurulan gün seriyi KÖPRÜLER, saymaz (lib/routine/forgiving.ts). İstemci canUseFreeze ile UX kapısı, trigger sunucu kapısı.
create table if not exists public.routine_freezes (
  user_id uuid not null references auth.users(id) on delete cascade,
  freeze_date date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, freeze_date)
);
comment on table public.routine_freezes is 'Affedici seri: dondurulan günler (Istanbul tarihi). Ayda en fazla 1 (routine_freeze_limit trigger; kurucu sayıyı değiştirirse migration).';

alter table public.routine_freezes enable row level security;
-- 0002 kalıbı: sahip okur, ekler, siler; güncelleme yok (satır yalnız tarih taşır).
create policy p_routine_freezes_select on public.routine_freezes for select using (auth.uid() = user_id);
create policy p_routine_freezes_insert on public.routine_freezes for insert with check (auth.uid() = user_id);
create policy p_routine_freezes_delete on public.routine_freezes for delete using (auth.uid() = user_id);

-- Aylık sınır (takvim ayı, SQL sabiti 1): ikinci satır reddedilir. Gelecek tarih reddedilir (Istanbul günü istemciden gelir;
-- sunucu UTC+1 gün toleransı tanır).
create or replace function public.routine_freeze_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if new.freeze_date > (current_date + 1) then
    raise exception 'routine_freeze_limit: future_date' using errcode = 'check_violation';
  end if;
  select count(*) into v_count
    from public.routine_freezes
   where user_id = new.user_id
     and date_trunc('month', freeze_date) = date_trunc('month', new.freeze_date);
  if v_count >= 1 then
    raise exception 'routine_freeze_limit: limit_reached' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists routine_freeze_limit_trg on public.routine_freezes;
create trigger routine_freeze_limit_trg before insert on public.routine_freezes
  for each row execute function public.routine_freeze_limit();

-- ── ops: günlük deneme kalitesi (0014 ops.daily_tryon_quality) admin RPC'si (0007 kalıbı; yalnız service role) ──────
create or replace function public.ops_daily_tryon_quality(p_days int default 30)
returns setof ops.daily_tryon_quality language sql security definer set search_path = public, ops stable as $$
  select * from ops.daily_tryon_quality
   where day >= (current_date - greatest(1, least(p_days, 90)))
   order by day desc, mode;
$$;

revoke execute on function public.ops_daily_tryon_quality(int) from public, anon, authenticated;
grant execute on function public.ops_daily_tryon_quality(int) to service_role;
