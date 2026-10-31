-- tests/11_spend.sql — iki bütçe (BLUEPRINT §3.9 check_spend, §5.6, §8.4): ders amaçları (lesson_analysis, transcribe,
-- diarize) sohbet/toplu tavanından hariç ve kendi aylık tavanına bağlı; defter tek (spend_ledger), bütçe iki. Kota.
begin;
\ir _fixture.sql

-- Bu işlemde bugünün harcaması sıfırdan başlar (yerel test veritabanında başka llm_calls yok)
delete from public.spend_ledger;

-- 'lesson_analysis spend of 5 USD does not change chat state'
do $$
declare
  v_c record;
  v_l record;
begin
  perform t.as_batch();
  insert into public.llm_calls (purpose, provider, model, tokens_in, tokens_out, status, cost_usd) values ('lesson_analysis', 'gemini-paid', 'gemini-2.5-pro', 1000, 500, 'ok', 5.0);
  select * into v_c from public.check_spend('chat');
  perform t.ok(v_c.state = 'normal' and v_c.day_usd = 0 and v_c.lesson_month_usd = 5.0 and v_c.paid_allowed,
               'lesson_analysis spend of 5 USD does not change chat state (normal, day_usd 0, lesson_month_usd 5)');
  select * into v_l from public.check_spend('lesson_analysis');
  perform t.ok(v_l.paid_allowed and v_l.lesson_cap = 30.00, 'ders bütçesi 30 $ altında: ders analizi ücretli çağırabilir');
  perform t.as_admin();
  perform t.ok((select sl.calls = 1 and sl.cost_usd = 5.0 from public.spend_ledger sl where sl.purpose = 'lesson_analysis'), 'defter tek: ders harcaması spend_ledger''da (amaç anahtar)');
end $$;

-- 'lesson cap blocks only lesson purposes'
do $$
begin
  perform t.as_staff(t.u('coord'));
  perform public.set_runtime_flag('lesson_monthly_cap_usd', '4');
  perform t.as_batch();
  perform t.ok(not (select c.paid_allowed from public.check_spend('lesson_analysis') c), 'lesson_monthly_cap_usd=4 → check_spend(lesson_analysis).paid_allowed=false');
  perform t.ok(not (select c.paid_allowed from public.check_spend('transcribe') c), 'transcribe da ders bütçesine bağlı');
  perform t.ok((select c.paid_allowed and c.state = 'normal' from public.check_spend('chat') c), 'check_spend(chat).paid_allowed=true, state normal');
  perform t.as_admin();
end $$;

-- 'chat spend over daily cap gives free_only'
do $$
declare
  v_c record;
begin
  perform t.as_batch();
  insert into public.llm_calls (purpose, provider, model, tokens_in, tokens_out, status, cost_usd) values ('chat', 'gemini-paid', 'gemini-2.5-flash-lite', 10, 10, 'ok', 0.90);
  select * into v_c from public.check_spend('chat');
  perform t.ok(v_c.state = 'free_only' and not v_c.paid_allowed and v_c.day_usd = 0.90 and v_c.daily_cap = 0.80, 'chat spend over daily cap gives free_only');
  perform t.ok((select c.state from public.check_spend('lesson_analysis') c) = 'free_only', 'state yalnız sohbet/toplu bütçeden türer');
  perform t.as_bot(null);
  perform public.set_runtime_flag('degraded_mode', 'true');
  perform t.ok((select c.state from public.check_spend('chat') c) = 'degraded', 'degraded_mode → degraded');
  perform public.set_runtime_flag('degraded_mode', 'false');
  perform t.as_admin();
  perform t.ok((select count(*) from public.spend_ledger) = 2, 'spend_ledger: gün × amaç × sağlayıcı (2 satır)');
end $$;

-- Aylık tavan ve kill-switch
do $$
begin
  delete from public.spend_ledger;
  insert into public.spend_ledger (day, purpose, provider, calls, cost_usd)
  values ((now() at time zone 'Europe/Istanbul')::date - 1, 'nightly_facts', 'gemini-paid', 1, 0.10),
         (date_trunc('month', (now() at time zone 'Europe/Istanbul')::date)::date, 'question_gen', 'gemini-paid', 1, 24.00);
  perform t.as_bot(null);
  -- Ayın ilk günü (Europe/Istanbul) 24 $'lık satır bugüne düşer; o gün day_usd 24 olur. Aylık tavanın
  -- etkisi gün toplamından bağımsız sınanır: durum free_only ve ay toplamı ≥ 24.
  perform t.ok((select c.state = 'free_only' and c.month_usd >= 24.00
                  and (c.day_usd = 0 or extract(day from (now() at time zone 'Europe/Istanbul')) = 1)
                from public.check_spend('chat') c), 'aylık 24 $ tavanı → free_only');
  perform t.as_admin();
  delete from public.spend_ledger;
  perform t.as_batch();
  perform public.set_runtime_flag('paid_llm_enabled', 'false');
  perform t.ok((select c.state = 'free_only' and not c.paid_allowed from public.check_spend('chat') c), 'paid_llm_enabled=false → free_only');
  perform t.as_admin();
end $$;

-- log_bot_response: her sağlayıcı denemesi llm_calls'a (student_ref = public_ref; uuid/ad yok), tetikleyici deftere
do $$
declare
  v_id bigint;
begin
  delete from public.llm_calls;
  delete from public.spend_ledger;
  perform t.as_bot(t.u('A'));
  v_id := public.log_bot_response(jsonb_build_object(
    'chat_id', 700100001, 'purpose', 'chat', 'mode', 'socratic', 'response_text', 'Ortak payda kaç olur?', 'prompt_version', 'socratic.v3',
    'memory_fact_ids', '[]'::jsonb, 'recent_message_ids', jsonb_build_array(t.v('msg_a_q')::bigint), 'cost_usd', 0.00025,
    'provider_attempts', jsonb_build_array(
       jsonb_build_object('provider', 'gemini-paid', 'model', 'gemini-2.5-flash-lite', 'status', 'rate_limited', 'tokens_in', 0, 'tokens_out', 0, 'cost_usd', 0, 'error_code', '429'),
       jsonb_build_object('provider', 'gemini-free', 'model', 'gemini-2.5-flash-lite@free', 'status', 'ok', 'tokens_in', 1800, 'tokens_out', 150, 'cost_usd', 0.00025))));
  perform public.set_out_message(v_id, 4242);
  perform t.raises('select public.log_bot_response(''{"chat_id":1}'')', 'OGR-LOG-001%', 'eksik alan OGR-LOG-001');
  perform t.as_admin();
  perform t.ok((select count(*) from public.llm_calls lc where lc.ref_table = 'bot_responses' and lc.ref_id = v_id::text and lc.student_ref = 's_aaaaaaaaaaaa') = 2,
               'iki deneme → iki llm_calls satırı (student_ref = public_ref)');
  perform t.ok(not exists (select 1 from public.llm_calls lc where lc.student_ref = t.v('A')), 'llm_calls uuid taşımaz');
  perform t.ok((select br.out_telegram_message_id from public.bot_responses br where br.id = v_id) = 4242, 'set_out_message');
  perform t.ok((select sum(sl.calls) from public.spend_ledger sl where sl.purpose = 'chat') = 2
               and (select sl.cost_usd from public.spend_ledger sl where sl.provider = 'gemini-free') = 0.00025, 'spend_rollup tetikleyicisi');
  perform t.as_batch();
  perform t.ok(public.rollup_spend() = 0, 'rollup_spend: defter llm_calls ile tutarlı (düzeltme yok)');
  perform t.as_admin();
  update public.spend_ledger sl set cost_usd = 9 where sl.provider = 'gemini-free';
  perform t.as_batch();
  perform t.ok(public.rollup_spend() = 1, 'rollup_spend sapan 1 satırı düzeltir');
  perform t.ok((select sl.cost_usd from public.spend_ledger sl where sl.provider = 'gemini-free') = 0.00025, 'düzeltilen satır llm_calls toplamına eşit');
  perform t.as_admin();
end $$;

-- Kota: standart 25 mesaj; 5 kala bir kez uyarı; 26. red. Personel kotası chat_roles.staff_id ile
do $$
declare
  v_r record;
  v_i int;
  v_warns int := 0;
  v_warn_at int;
begin
  perform t.as_bot(t.u('A'));
  for v_i in 1..26 loop
    select * into v_r from public.consume_quota('message');
    if v_r.warn then v_warns := v_warns + 1; v_warn_at := v_i; end if;
    if v_i = 25 then perform t.ok(v_r.allowed and v_r.remaining = 0, '25. mesaj izinli, kalan 0'); end if;
  end loop;
  perform t.ok(not v_r.allowed and v_r.used = 25 and v_r.daily_limit = 25, '26. mesaj reddedildi (25/25)');
  perform t.ok(v_warns = 1 and v_warn_at = 20, 'uyarı tam bir kez, 5 hak kalınca (' || coalesce(v_warn_at, 0) || '. mesaj)');
  perform t.raises('select * from public.consume_quota(''tts'')', 'OGR-QUOTA-001%', 'tanımsız kota türü OGR-QUOTA-001');
  perform t.as_bot(null);
  select * into v_r from public.consume_staff_quota(-100900100, 555100001, 'message');
  perform t.ok(v_r.allowed and v_r.daily_limit = 50, 'personel kotası staff katmanından (50)');
  perform t.raises('select * from public.consume_staff_quota(-100900100, 700100001, ''message'')', 'OGR-QUOTA-002%', 'öğrenci personel kotası kullanamaz');
  perform t.as_admin();
  perform t.ok((select count(*) from public.quota_usage q where q.staff_id = t.u('inst_a') and q.student_id is null) = 1, 'quota_usage personel satırı');
end $$;

-- Kitap: araştırma kapalıyken OGR-RES-001; açık + kota varken kuyruğa alınır; released → research_ready bildirimi
do $$
declare
  v_req uuid;
  v_out uuid;
begin
  perform t.as_bot(t.u('A'));
  perform t.raises('select public.enqueue_research(''aralıklı tekrar'')', 'OGR-RES-001%', 'research_enabled=false → OGR-RES-001');
  perform t.as_staff(t.u('coord'));
  perform public.set_runtime_flag('research_enabled', 'true');
  update public.students s set tier = 'pilot' where s.id = t.u('A');
  perform t.as_bot(t.u('A'));
  v_req := public.enqueue_research('aralıklı tekrar matematik');
  perform t.as_admin();
  perform t.ok((select r.status = 'queued' and r.student_id = t.u('A') from public.research_requests r where r.id = v_req), 'enqueue_research kuyruğa aldı (pilot kotası)');
  perform t.as_batch();
  insert into public.research_outputs (request_id, output, model) values (v_req, '{"synthesis":[]}', 'fake') returning id into v_out;
  perform t.as_staff(t.u('inst_a'));
  update public.research_outputs o set status = 'released' where o.id = v_out;
  perform t.as_admin();
  perform t.ok((select pm.params ->> 'output_id' from public.proactive_messages pm where pm.template_id = 'research_ready' and pm.student_id = t.u('A')) = v_out::text,
               'released → research_ready proaktif mesajı (app.research_released)');
end $$;

rollback;
