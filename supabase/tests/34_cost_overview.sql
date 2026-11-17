-- tests/34_cost_overview.sql — eğitmen Maliyet özeti (0047): instructor_cost_overview. Admin bütün öğrencileri,
-- eğitmen yalnız instructor_links bağlı öğrencilerini görür; bugün/ay toplamı ve durum check_spend ile aynı; rota
-- kırılımı ve son 7 gün; öğrenci, veli ve anon 42501.
begin;
\ir _fixture.sql

select t.add_outsiders();

do $$
declare
  v_ref_a text := (select s.public_ref from public.students s where s.id = t.u('A'));
  v_ref_b text := (select s.public_ref from public.students s where s.id = t.u('B'));
  v_ref_c text := (select s.public_ref from public.students s where s.id = t.u('C'));
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  delete from public.llm_calls;
  delete from public.spend_ledger;
  insert into public.runtime_flags (key, value, updated_by) values
    ('daily_cap_usd', '1.0'::jsonb, 'test'), ('monthly_cap_usd', '10.0'::jsonb, 'test'),
    ('student_monthly_cap_usd', '1.0'::jsonb, 'test')
  on conflict (key) do update set value = excluded.value;
  insert into public.llm_calls (route, purpose, model, status, cost_usd, student_ref, created_at) values
    ('coach.chat', 'coach', 'claude-opus-5-5', 'ok', 1.2, v_ref_a, now()),
    ('diagnosis.solution', 'diagnosis', 'claude-opus-5-5', 'ok', 0.3, v_ref_b, now()),
    ('coach.chat', 'coach', 'claude-opus-5-5', 'ok', 0.7, v_ref_c, now()),
    (null, 'batch', 'claude-opus-5-5', 'ok', 0.05, null, now()),
    ('coach.chat', 'coach', 'claude-opus-5-5', 'ok', 5.0, v_ref_a, now() - interval '40 days');  -- geçen ay: sayılmaz
  delete from public.spend_ledger;  -- llm_calls tetikleyicisi deftere yazar; gün toplamlarını test kendisi kurar
  insert into public.spend_ledger (day, purpose, provider, calls, cost_usd) values
    (v_today, 'coach', 'anthropic', 3, 0.5),
    (v_today, 'diagnosis', 'anthropic', 1, 0.25),
    (v_today - 3, 'coach', 'anthropic', 2, 0.4);
end $$;

-- Admin: bütün öğrenciler, toplamlar ve tavanlar
do $$
declare
  v jsonb;
  v_cs record;
begin
  perform t.as_user(t.u('admin'));
  v := public.instructor_cost_overview();
  select * into v_cs from public.check_spend(null, null);
  perform t.ok((v ->> 'today_usd')::numeric = 0.75, 'bugün = günün spend_ledger toplamı');
  perform t.ok((v ->> 'month_usd')::numeric = v_cs.month_usd, 'bu ay check_spend ile aynı');
  perform t.ok((v ->> 'daily_cap_usd')::numeric = 1.0 and (v ->> 'monthly_cap_usd')::numeric = 10.0
               and (v ->> 'student_monthly_cap_usd')::numeric = 1.0, 'tavanlar runtime_flags''ten');
  perform t.ok(v ->> 'state' = v_cs.state, 'durum check_spend ile aynı');
  perform t.ok(jsonb_array_length(v -> 'by_student') = 3, 'admin üç öğrenciyi görür');
  perform t.ok(v -> 'by_student' -> 0 ->> 'student_id' = t.v('A') and (v -> 'by_student' -> 0 ->> 'cost_usd')::numeric = 1.2,
               'en pahalı öğrenci A, geçen ay sayılmaz');
  perform t.ok((v -> 'by_student' -> 0 ->> 'over_cap')::boolean and not (v -> 'by_student' -> 1 ->> 'over_cap')::boolean,
               'öğrenci tavanı aşımı işaretli');
  perform t.ok(v -> 'by_student' -> 0 ->> 'name' = (select p.display_name from public.profiles p where p.id = t.u('elif')),
               'öğrenci adı profilden');
  perform t.ok(v -> 'by_route' -> 0 ->> 'route' = 'coach.chat' and (v -> 'by_route' -> 0 ->> 'calls')::int = 2
               and (v -> 'by_route' -> 0 ->> 'cost_usd')::numeric = 1.9, 'rota başına: coach.chat 2 çağrı 1,9 $');
  perform t.ok(exists (select 1 from jsonb_array_elements(v -> 'by_route') as r where r ->> 'route' = 'batch'),
               'rotasız çağrı amacıyla listelenir');
  perform t.ok(jsonb_array_length(v -> 'last_7_days') = 7, 'son 7 gün yedi satır');
  perform t.ok((v -> 'last_7_days' -> 6 ->> 'cost_usd')::numeric = 0.75 and (v -> 'last_7_days' -> 3 ->> 'cost_usd')::numeric = 0.4
               and (v -> 'last_7_days' -> 5 ->> 'cost_usd')::numeric = 0, 'son 7 gün: bugün, 3 gün önce, boş gün 0');
end $$;

-- Eğitmen: yalnız bağlı öğrenciler; bağsız eğitmen öğrenci görmez ama toplamları görür
do $$
declare
  v jsonb;
begin
  perform t.as_user(t.u('inst'));
  v := public.instructor_cost_overview();
  perform t.ok(jsonb_array_length(v -> 'by_student') = 2, 'eğitmen iki bağlı öğrencisini görür');
  perform t.ok(not exists (select 1 from jsonb_array_elements(v -> 'by_student') as x where x ->> 'student_id' = t.v('C')),
               'bağsız öğrenci (C) eğitmene görünmez');
  perform t.ok((v ->> 'today_usd')::numeric = 0.75 and jsonb_array_length(v -> 'by_route') = 3, 'eğitmen toplamları ve rotaları görür');

  perform t.as_user(t.u('inst2'));
  v := public.instructor_cost_overview();
  perform t.ok(jsonb_array_length(v -> 'by_student') = 0, 'bağsız eğitmen öğrenci kırılımı görmez');
end $$;

-- Öğrenci, veli, anon: 42501
do $$
begin
  perform t.as_user(t.u('elif'));
  perform t.raises('select public.instructor_cost_overview()', 'OGR-AUTH-002%', 'öğrenci maliyet özetini göremez');
  perform t.as_user(t.u('parent'));
  perform t.raises('select public.instructor_cost_overview()', 'OGR-AUTH-002%', 'veli maliyet özetini göremez');
  perform t.as_anon();
  perform t.raises('select public.instructor_cost_overview()', '42501', 'anon çalıştıramaz');
  perform t.as_admin();
end $$;

rollback;
