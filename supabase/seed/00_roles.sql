-- seed/00_roles.sql — YALNIZ yerel/test: uygulama rolleri (migration'da da var, idempotent) ve test personeli
-- (inst_a, inst_b, coord, obs) auth.users yerel eşleniğine ve public.staff'a. Barındırılan Supabase'de (auth.users
-- gerçek GoTrue tablosu, instance_id sütunu var) personel EKLENMEZ: ilk koordinatör docs/runbook/accounts.md ile kurulur.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bot_runtime') then
    create role bot_runtime nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'batch_worker') then
    create role batch_worker nologin;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users' and column_name = 'instance_id') then
    raise notice 'Supabase auth.users: test personeli eklenmedi (yalnız yerel/test seed''i)';
    return;
  end if;
  insert into auth.users (id, email, created_at) values
    ('00000000-0000-4000-8000-0000000000c1', 'coord@ogrenmen.test', '2026-09-01T09:00:00Z'),
    ('00000000-0000-4000-8000-0000000000a1', 'inst_a@ogrenmen.test', '2026-09-01T09:01:00Z'),
    ('00000000-0000-4000-8000-0000000000b1', 'inst_b@ogrenmen.test', '2026-09-01T09:02:00Z'),
    ('00000000-0000-4000-8000-0000000000d1', 'obs@ogrenmen.test', '2026-09-01T09:03:00Z')
  on conflict (id) do nothing;
  insert into public.staff (id, full_name, role, subject, active, created_at) values
    ('00000000-0000-4000-8000-0000000000c1', 'Zeynep Koordinatör', 'coordinator', null, true, '2026-09-01T09:00:00Z'),
    ('00000000-0000-4000-8000-0000000000a1', 'Ayşe Hoca', 'instructor', 'matematik', true, '2026-09-01T09:01:00Z'),
    ('00000000-0000-4000-8000-0000000000b1', 'Burak Hoca', 'instructor', 'matematik', true, '2026-09-01T09:02:00Z'),
    ('00000000-0000-4000-8000-0000000000d1', 'Deniz Gözlemci', 'observer', null, true, '2026-09-01T09:03:00Z')
  on conflict (id) do nothing;
end
$$;
