-- seed/00_people.sql — YALNIZ yerel/test: deneme kullanıcıları (auth.users + profiles) ve bağlar. Barındırılan
-- Supabase'de (auth.users.instance_id sütunu varsa) hiçbir şey eklemez: gerçek hesaplar Supabase Auth ile açılır.
-- Öğrenci profilleri app.profiles_create_student() tetikleyicisiyle students satırını kendisi yaratır.
--   admin    00000000-0000-4000-8000-0000000000c1  admin@ogrenmen.test
--   eğitmen  00000000-0000-4000-8000-0000000000a1  egitmen@ogrenmen.test   (Elif ve Can'ın eğitmeni, owner)
--   veli     00000000-0000-4000-8000-0000000000b1  veli@ogrenmen.test      (Elif'in velisi, active)
--   öğrenci  00000000-0000-4000-8000-0000000000e1  elif@ogrenmen.test
--   öğrenci  00000000-0000-4000-8000-0000000000e2  can@ogrenmen.test
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users' and column_name = 'instance_id') then
    raise notice 'Supabase auth.users: deneme kullanıcıları eklenmedi (yalnız yerel/test seed''i)';
    return;
  end if;
  insert into auth.users (id, email, created_at) values
    ('00000000-0000-4000-8000-0000000000c1', 'admin@ogrenmen.test', '2026-09-01T09:00:00Z'),
    ('00000000-0000-4000-8000-0000000000a1', 'egitmen@ogrenmen.test', '2026-09-01T09:01:00Z'),
    ('00000000-0000-4000-8000-0000000000b1', 'veli@ogrenmen.test', '2026-09-01T09:02:00Z'),
    ('00000000-0000-4000-8000-0000000000e1', 'elif@ogrenmen.test', '2026-09-01T09:03:00Z'),
    ('00000000-0000-4000-8000-0000000000e2', 'can@ogrenmen.test', '2026-09-01T09:04:00Z')
  on conflict (id) do nothing;
  insert into public.profiles (id, role, display_name, created_at) values
    ('00000000-0000-4000-8000-0000000000c1', 'admin', 'Zeynep Yönetici', '2026-09-01T09:00:00Z'),
    ('00000000-0000-4000-8000-0000000000a1', 'instructor', 'Ayşe Hoca', '2026-09-01T09:01:00Z'),
    ('00000000-0000-4000-8000-0000000000b1', 'parent', 'Murat Kaya', '2026-09-01T09:02:00Z'),
    ('00000000-0000-4000-8000-0000000000e1', 'student', 'Elif Kaya', '2026-09-01T09:03:00Z'),
    ('00000000-0000-4000-8000-0000000000e2', 'student', 'Can Demir', '2026-09-01T09:04:00Z')
  on conflict (id) do nothing;
  update public.students s set grade = '11', school = 'Deneme Anadolu Lisesi'
   where s.profile_id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2');
  insert into public.guardian_links (parent_id, student_id, relation, status, created_by, accepted_at)
  select '00000000-0000-4000-8000-0000000000b1', s.id, 'baba', 'active', '00000000-0000-4000-8000-0000000000e1', now()
    from public.students s where s.profile_id = '00000000-0000-4000-8000-0000000000e1'
  on conflict (parent_id, student_id) do nothing;
  insert into public.instructor_links (instructor_id, student_id, role)
  select '00000000-0000-4000-8000-0000000000a1', s.id, 'owner'
    from public.students s
   where s.profile_id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2')
  on conflict do nothing;
end
$$;
