-- tests/_fixture.sql — canlı SQL testlerinin ortak dünyası ve yardımcıları (v2). Her test dosyası "begin;" sonrasında
-- \ir ile içe alır ve sonunda "rollback;" eder (veritabanı testten teste temiz kalır).
-- Yardımcılar t şemasındadır: t.as_admin (süper kullanıcı / migration bağlamı), t.as_user (authenticated + JWT sub),
-- t.as_service (service_role), t.as_anon rol ve JWT bağlamını kurar (SET LOCAL ROLE + request.jwt.claims — PostgREST'in
-- yaptığının aynısı); t.ok koşulu, t.raises beklenen hatayı denetler; t.n / t.sees satır sayar (RLS altında);
-- t.add_outsiders bağsız öğrenci/eğitmen/veli ekler. Başarısız denetim "FAIL: …" ile istisna atar.
-- Dünya: seed/00_people.sql kullanıcıları (admin, eğitmen, veli, Elif, Can) + içerikten bağımsız küçük bir müfredat
-- (T-MAT@test.1: t.mat → t.mat.a, t.mat.b; t.mat.a'nın ön koşulu t.mat.b; yanılgı etiketi t.a.isaret-hatasi →
-- prereq t.mat.b), bir ders ve iki kayıt (EA: Elif, EB: Can).
\set QUIET on
set client_min_messages = notice;

create schema t;
grant usage on schema t to public;
create table t.cfg (k text primary key, v text not null);
grant select on t.cfg to public;

create function t.v(p_k text) returns text language sql stable as $$ select c.v from t.cfg c where c.k = p_k $$;
create function t.u(p_k text) returns uuid language sql stable as $$ select c.v::uuid from t.cfg c where c.k = p_k $$;

create function t.as_admin() returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', '', true);
end $$;
create function t.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', p_uid)::text, true);
  execute 'set local role authenticated';
end $$;
create function t.as_service() returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function t.as_anon() returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;
-- Yalnız JWT claim'i (rol değişmeden): yardımcı fonksiyonların kimlik çözümünü sınar
create function t.claims_only(p_sub uuid) returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', p_sub)::text, true);
end $$;

create function t.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then
    raise notice 'OK: %', p_label;
  else
    raise exception 'FAIL: %', p_label;
  end if;
end $$;
-- p_sql'i çağıranın rolüyle çalıştırır; hata mesajı ya da SQLSTATE p_pattern'e (LIKE) uymalı
create function t.raises(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
declare
  v_msg text;
  v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    if v_msg like p_pattern or v_state like p_pattern then
      raise notice 'OK: % (%)', p_label, left(v_msg, 80);
      return;
    end if;
    raise exception 'FAIL: % — beklenen %, gelen % (%)', p_label, p_pattern, v_msg, v_state;
  end;
  raise exception 'FAIL: % — hata bekleniyordu (%), çalıştı', p_label, p_pattern;
end $$;
-- p_sql'in satır sayısı (çağıranın rolü ve JWT'siyle; RLS uygulanır)
create function t.n(p_sql text) returns bigint language plpgsql as $$
declare
  v_n bigint;
begin
  execute 'select count(*) from (' || p_sql || ') as q' into v_n;
  return v_n;
end $$;
-- p_uid kullanıcısı olarak p_sql'in satır sayısı; sonra t.as_admin() bağlamına döner
create function t.sees(p_uid uuid, p_sql text) returns bigint language plpgsql as $$
declare
  v_n bigint;
begin
  perform t.as_user(p_uid);
  v_n := t.n(p_sql);
  perform t.as_admin();
  return v_n;
end $$;
-- RLS/izolasyon testleri için bağsız kullanıcılar: Deniz (öğrenci C, kayıt EC2; kimseye bağlı değil), bağsız eğitmen
-- inst2, bağsız veli parent2. 01_schema.sql'in seed sayımlarını bozmamak için yalnız çağıran testlerde açılır.
create function t.add_outsiders() returns void language plpgsql as $$
begin
  insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-0000000000e3', 'deniz@ogrenmen.test'),
    ('00000000-0000-4000-8000-0000000000a2', 'egitmen2@ogrenmen.test'),
    ('00000000-0000-4000-8000-0000000000b2', 'veli2@ogrenmen.test');
  insert into public.profiles (id, role, display_name) values
    ('00000000-0000-4000-8000-0000000000e3', 'student', 'Deniz Ak'),
    ('00000000-0000-4000-8000-0000000000a2', 'instructor', 'Ali Hoca'),
    ('00000000-0000-4000-8000-0000000000b2', 'parent', 'Selin Ak');
  insert into t.cfg values ('deniz', '00000000-0000-4000-8000-0000000000e3'), ('inst2', '00000000-0000-4000-8000-0000000000a2'),
    ('parent2', '00000000-0000-4000-8000-0000000000b2'), ('EC2', '20000000-0000-4000-8000-0000000000ec');
  insert into t.cfg select 'C', s.id::text from public.students s where s.profile_id = t.u('deniz');
  insert into public.enrollments (id, student_id, curriculum_id, course_id, period_label)
  values (t.u('EC2'), t.u('C'), t.u('cur'), t.u('course'), 'YKS 2027');
end $$;

grant execute on all functions in schema t to public;

insert into t.cfg values
  ('admin', '00000000-0000-4000-8000-0000000000c1'), ('inst', '00000000-0000-4000-8000-0000000000a1'),
  ('parent', '00000000-0000-4000-8000-0000000000b1'), ('elif', '00000000-0000-4000-8000-0000000000e1'),
  ('can', '00000000-0000-4000-8000-0000000000e2'),
  ('course', '30000000-0000-4000-8000-0000000000c0'),
  ('EA', '20000000-0000-4000-8000-0000000000ea'), ('EB', '20000000-0000-4000-8000-0000000000eb');
insert into t.cfg select 'A', s.id::text from public.students s where s.profile_id = t.u('elif');
insert into t.cfg select 'B', s.id::text from public.students s where s.profile_id = t.u('can');

do $$
declare
  v_cur uuid;
begin
  if t.v('A') is null or t.v('B') is null then
    raise exception 'FAIL: seed/00_people.sql öğrencileri yok (students.profile_id)';
  end if;
  insert into public.curricula (code, authority, year, version, label, status, origin)
  values ('T-MAT', 'OTHER', 2026, 'test.1', 'Test Matematik', 'active', 'instructor') returning id into v_cur;
  insert into t.cfg values ('cur', v_cur::text);
  insert into public.skills (curriculum_id, id, parent_id, name, kind, is_leaf, order_no) values
    (v_cur, 't.mat', null, 'Test kökü', 'unit', false, 1),
    (v_cur, 't.mat.a', 't.mat', 'İşlem önceliği', 'outcome', true, 2),
    (v_cur, 't.mat.b', 't.mat', 'İşaret kuralları', 'outcome', true, 3);
  update public.skills s set p_init = 0.3, p_learn = 0.1, p_guess = 0.25, p_slip = 0.1 where s.curriculum_id = v_cur;
  insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength) values (v_cur, 't.mat.a', 't.mat.b', 1.0);
  insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student) values
    ('t.a.isaret-hatasi', v_cur, 't.mat.a', 't.mat.b', 'Eksiyi dağıtırken işareti kaçırıyor.', 'Eksiyi parantezin içine dağıtırken her terimin işaretine bak.');
  insert into public.courses (id, code, title, kind, curriculum_id, visibility, created_by)
  values (t.u('course'), 'T-MAT-TEST', 'Test Matematik', 'exam_track', v_cur, 'shared', t.u('inst'));
  insert into public.enrollments (id, student_id, curriculum_id, course_id, period_label, target_exam) values
    (t.u('EA'), t.u('A'), v_cur, t.u('course'), 'YKS 2027', 'TYT'),
    (t.u('EB'), t.u('B'), v_cur, t.u('course'), 'YKS 2027', 'TYT');
end $$;

reset role;
