-- 0047_cost_overview.sql — eğitmen "Maliyet" sayfası için tek okuma RPC'si. llm_calls ve spend_ledger yalnız admin'e
-- okunur (0018_rls.sql); eğitmen ham deftere erişmez, bu SECURITY DEFINER özet üzerinden toplamları görür.
--   * today_usd / month_usd, tavanlar ve state: check_spend(null, null) ile aynı hesap (Europe/Istanbul günü/ayı,
--     spend_ledger toplamı, runtime_flags tavanları)
--   * by_route: bu ay rota başına (rota yoksa amaç) çağrı sayısı ve maliyet, en pahalı 10
--   * by_student: bu ay öğrenci başına maliyet, en pahalı 10; eğitmen yalnız instructor_links bağlı öğrencilerini,
--     admin hepsini görür; ad profiles.display_name, student_cap aşımı over_cap
--   * last_7_days: son 7 İstanbul günü, gün başına spend_ledger toplamı (boş gün 0)
-- Hata kodu: OGR-AUTH-002 (42501) eğitmen ya da admin değil.

create or replace function public.instructor_cost_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_month_start timestamptz := (date_trunc('month', (now() at time zone 'Europe/Istanbul')) at time zone 'Europe/Istanbul');
  v_admin boolean := app.is_admin();
  v_spend record;
  v_routes jsonb;
  v_students jsonb;
  v_days jsonb;
begin
  if not app.is_staff() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 maliyet özetini yalnız eğitmen ya da admin görür';
  end if;
  select cs.day_usd, cs.month_usd, cs.daily_cap, cs.monthly_cap, cs.student_cap, cs.state, cs.alert_level
    into v_spend
    from public.check_spend(null, null) as cs;

  select coalesce(jsonb_agg(jsonb_build_object('route', r.route, 'calls', r.calls, 'cost_usd', r.cost_usd)
                            order by r.cost_usd desc, r.route), '[]'::jsonb)
    into v_routes
    from (select coalesce(lc.route, lc.purpose) as route, count(*)::int as calls, round(sum(lc.cost_usd), 6) as cost_usd
            from public.llm_calls lc
           where lc.created_at >= v_month_start
           group by coalesce(lc.route, lc.purpose)
           order by sum(lc.cost_usd) desc, coalesce(lc.route, lc.purpose)
           limit 10) as r;

  select coalesce(jsonb_agg(jsonb_build_object('student_ref', x.student_ref, 'student_id', x.student_id, 'name', x.name,
                                               'cost_usd', x.cost_usd,
                                               'over_cap', v_spend.student_cap > 0 and x.cost_usd >= v_spend.student_cap)
                            order by x.cost_usd desc, x.student_ref), '[]'::jsonb)
    into v_students
    from (select s.public_ref as student_ref, s.id as student_id, max(p.display_name) as name,
                 round(sum(lc.cost_usd), 6) as cost_usd
            from public.llm_calls lc
            join public.students s on s.public_ref = lc.student_ref
            left join public.profiles p on p.id = s.profile_id
           where lc.created_at >= v_month_start
             and (v_admin or s.id in (select app.my_students()))
           group by s.public_ref, s.id
           order by sum(lc.cost_usd) desc, s.public_ref
           limit 10) as x;

  select jsonb_agg(jsonb_build_object('day', d.day, 'cost_usd', d.cost_usd) order by d.day)
    into v_days
    from (select v_today - g.i as day,
                 round(coalesce((select sum(sl.cost_usd) from public.spend_ledger sl where sl.day = v_today - g.i), 0), 6) as cost_usd
            from generate_series(0, 6) as g (i)) as d;

  return jsonb_build_object(
    'today_usd', v_spend.day_usd,
    'month_usd', v_spend.month_usd,
    'daily_cap_usd', v_spend.daily_cap,
    'monthly_cap_usd', v_spend.monthly_cap,
    'student_monthly_cap_usd', v_spend.student_cap,
    'state', v_spend.state,
    'alert_level', v_spend.alert_level,
    'by_route', v_routes,
    'by_student', v_students,
    'last_7_days', v_days
  );
end
$$;
comment on function public.instructor_cost_overview() is 'Eğitmen/admin: bugün ve bu ay harcama, tavanlar ve durum (check_spend), bu ayın rota ve öğrenci (eğitmene bağlı) kırılımı, son 7 gün; diğerlerine OGR-AUTH-002.';

revoke all on function public.instructor_cost_overview() from public, anon;
grant execute on function public.instructor_cost_overview() to authenticated;
