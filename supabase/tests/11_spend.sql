-- tests/11_spend.sql — check_spend (sade, yumuşak tavan): günlük/aylık kuruluş toplamı ve öğrenci başına aylık toplam
-- runtime_flags tavanlarıyla karşılaştırılır; aşım engellemez (paid_allowed kalır, downgrade = true, state soft_cap |
-- student_cap); paid_llm_enabled = false → disabled; degraded_mode → degraded; uyarı eşikleri; hariç amaçlar; öğrenci
-- oturumunda student_ref çağıranın öğrencisine sabitlenir.
begin;
\ir _fixture.sql

do $$
declare
  v_r record;
  v_ref_a text := (select s.public_ref from public.students s where s.id = t.u('A'));
  v_ref_b text := (select s.public_ref from public.students s where s.id = t.u('B'));
begin
  insert into t.cfg values ('refA', v_ref_a), ('refB', v_ref_b);
  update public.runtime_flags rf set value = '1.0' where rf.key = 'daily_cap_usd';
  update public.runtime_flags rf set value = '10.0' where rf.key = 'monthly_cap_usd';
  update public.runtime_flags rf set value = '0.5' where rf.key = 'student_monthly_cap_usd';

  select * into v_r from public.check_spend('chat');
  perform t.ok(v_r.paid_allowed and not v_r.degraded and not v_r.downgrade and v_r.state = 'normal' and v_r.day_usd = 0
               and v_r.daily_cap = 1.0 and v_r.monthly_cap = 10.0 and v_r.alert_level = 0, 'boş defter: normal');

  perform public.log_llm_call(jsonb_build_object('purpose', 'chat', 'model', 'claude-sonnet-5-5', 'status', 'ok', 'cost_usd', 0.6, 'student_ref', v_ref_a));
  select * into v_r from public.check_spend('chat');
  perform t.ok(v_r.state = 'normal' and v_r.day_usd = 0.6 and v_r.alert_level = 0.5, 'günlük tavanın %60''ı: normal, uyarı eşiği 0.5');
  select * into v_r from public.check_spend('chat', v_ref_a);
  perform t.ok(v_r.paid_allowed and v_r.downgrade and v_r.state = 'student_cap' and v_r.student_month_usd = 0.6 and v_r.student_cap = 0.5,
               'öğrenci aylık tavanı aşıldı: student_cap, downgrade, yine de ücretli izin var (yumuşak)');
  select * into v_r from public.check_spend('chat', v_ref_b);
  perform t.ok(v_r.state = 'normal' and v_r.student_month_usd = 0, 'diğer öğrenci etkilenmez');

  perform public.log_llm_call(jsonb_build_object('purpose', 'diagnosis', 'model', 'claude-opus-5-5', 'status', 'ok', 'cost_usd', 0.5));
  select * into v_r from public.check_spend('chat');
  perform t.ok(v_r.paid_allowed and v_r.downgrade and v_r.state = 'soft_cap' and v_r.day_usd = 1.1 and v_r.month_usd = 1.1 and v_r.alert_level = 1.0,
               'günlük tavan aşıldı: soft_cap, downgrade, uyarı 1.0');

  -- önceki günler aylık toplama girer, günlüğe girmez
  insert into public.spend_ledger (day, purpose, provider, calls, cost_usd)
  select (now() at time zone 'Europe/Istanbul')::date - 1, 'chat', 'anthropic', 1, 2.0
   where date_trunc('month', (now() at time zone 'Europe/Istanbul')::date - 1) = date_trunc('month', (now() at time zone 'Europe/Istanbul')::date);
  insert into public.spend_ledger (day, purpose, provider, calls, cost_usd)
  values (date_trunc('month', (now() at time zone 'Europe/Istanbul'))::date - 1, 'chat', 'anthropic', 1, 50.0);
  select * into v_r from public.check_spend('chat');
  perform t.ok(v_r.day_usd = 1.1 and v_r.month_usd in (1.1, 3.1), 'geçen ayın harcaması aylık toplama girmez (' || v_r.month_usd || ')');

  -- hariç amaç: tavana takılmaz
  update public.runtime_flags rf set value = '["lesson_analysis"]' where rf.key = 'cap_excluded_purposes';
  select * into v_r from public.check_spend('lesson_analysis', v_ref_a);
  perform t.ok(not v_r.downgrade and v_r.state = 'normal', 'cap_excluded_purposes tavana takılmaz');

  update public.runtime_flags rf set value = 'true' where rf.key = 'degraded_mode';
  select * into v_r from public.check_spend('chat');
  perform t.ok(not v_r.paid_allowed and v_r.degraded and v_r.state = 'degraded', 'degraded_mode: ücretli çağrı yok');
  update public.runtime_flags rf set value = 'false' where rf.key = 'paid_llm_enabled';
  select * into v_r from public.check_spend('chat');
  perform t.ok(not v_r.paid_allowed and v_r.state = 'disabled', 'paid_llm_enabled = false: disabled');
  update public.runtime_flags rf set value = 'true' where rf.key = 'paid_llm_enabled';
  update public.runtime_flags rf set value = 'false' where rf.key = 'degraded_mode';
end $$;

-- öğrenci oturumu: student_ref kendi öğrencisine sabitlenir (başkasının toplamını soramaz); set_runtime_flag yalnız admin
do $$
declare
  v_r record;
begin
  perform t.as_user(t.u('can'));
  select * into v_r from public.check_spend('chat', t.v('refA'));
  perform t.ok(v_r.student_month_usd = 0 and v_r.state = 'soft_cap', 'öğrenci başka öğrencinin toplamını göremez (kendi ref''i kullanılır)');
  perform t.as_user(t.u('elif'));
  select * into v_r from public.check_spend('chat');
  perform t.ok(v_r.student_month_usd = 0.6 and v_r.state = 'student_cap', 'öğrenci ref vermeden kendi tavanını görür');
  perform t.raises($q$select public.set_runtime_flag('daily_cap_usd', '100')$q$, 'OGR-AUTH-002%', 'öğrenci bayrak değiştiremez');
  perform t.as_user(t.u('inst'));
  select * into v_r from public.check_spend('chat', t.v('refA'));
  perform t.ok(v_r.student_month_usd = 0.6, 'eğitmen öğrenci ref''iyle sorar');
  perform t.as_user(t.u('admin'));
  perform public.set_runtime_flag('daily_cap_usd', '100');
  select * into v_r from public.check_spend('chat');
  perform t.ok(v_r.daily_cap = 100 and v_r.state = 'normal', 'admin tavanı yükseltir → normal');
  perform t.as_admin();
  perform t.ok((select rf.updated_by from public.runtime_flags rf where rf.key = 'daily_cap_usd') = 'admin:' || t.v('admin')
               and exists (select 1 from audit.events e where e.action = 'runtime_flag.set' and e.row_id = 'daily_cap_usd'),
               'bayrak değişikliği updated_by ve denetim izinde');
end $$;

rollback;
