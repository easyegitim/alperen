-- tests/12_llm_ledger.sql — LLM defteri: log_llm_call(jsonb) → llm_calls (+route, effort, önbellek token'ları) →
-- tetikleyici spend_ledger'ı (Istanbul günü × amaç × sağlayıcı) toplar; doğrulama (OGR-LLM-001; negatif sayaç/maliyet
-- yok); öğrenci/veli oturumu yazamaz (OGR-AUTH-002); personelde çağrı başına maliyet üst sınırı; created_at yalnız worker
-- verir (Batch sonuçları); defter yalnız admin'e görünür.
begin;
\ir _fixture.sql

do $$
declare
  v_id bigint;
  v_id2 bigint;
  v_c public.llm_calls%rowtype;
  v_l public.spend_ledger%rowtype;
  v_day date := (now() at time zone 'Europe/Istanbul')::date;
begin
  perform t.as_service();
  v_id := public.log_llm_call('{"route":"coach","purpose":"chat","model":"claude-sonnet-5-5","effort":"medium","prompt_version":"coach@3",
                                "tokens_in":1200,"tokens_out":300,"cache_read_tokens":9000,"cache_write_tokens":2500,"status":"ok",
                                "latency_ms":1800,"cost_usd":0.0123,"ref_table":"conversation_messages","ref_id":"42","student_ref":"s_aaaaaaaaaaaa"}');
  v_id2 := public.log_llm_call('{"route":"coach","purpose":"chat","model":"claude-sonnet-5-5","tokens_in":800,"tokens_out":100,
                                 "cache_read_tokens":9000,"status":"refusal","error_code":"cyber","cost_usd":0.002}');
  perform t.as_admin();
  select c.* into v_c from public.llm_calls c where c.id = v_id;
  perform t.ok(v_c.route = 'coach' and v_c.effort = 'medium' and v_c.provider = 'anthropic' and v_c.cache_read_tokens = 9000
               and v_c.cache_write_tokens = 2500 and v_c.prompt_version = 'coach@3' and v_c.student_ref = 's_aaaaaaaaaaaa'
               and v_c.cost_usd = 0.0123 and not v_c.batch, 'llm_calls satırı tüm alanlarla yazıldı');
  select l.* into v_l from public.spend_ledger l where l.day = v_day and l.purpose = 'chat' and l.provider = 'anthropic';
  perform t.ok(v_l.calls = 2 and v_l.tokens_in = 2000 and v_l.tokens_out = 400 and v_l.cache_read_tokens = 18000
               and v_l.cache_write_tokens = 2500 and v_l.cost_usd = 0.0143, 'spend_ledger: Istanbul günü toplamları (2 çağrı)');
  perform t.ok((select c.status = 'refusal' and c.error_code = 'cyber' from public.llm_calls c where c.id = v_id2), 'refusal durumu yazılır');

  -- Batch sonucu: worker created_at verir → o günün satırı
  perform t.as_service();
  perform public.log_llm_call('{"purpose":"memory_compact","model":"claude-sonnet-5-5","status":"ok","batch":true,"cost_usd":0.01,
                                "created_at":"2026-10-01T20:30:00Z"}');
  perform t.as_admin();
  perform t.ok(exists (select 1 from public.spend_ledger l where l.day = '2026-10-01' and l.purpose = 'memory_compact' and l.calls = 1),
               'created_at (worker) Istanbul gününe yazılır (20:30Z = 23:30 TRT)');
  perform t.ok(exists (select 1 from public.llm_calls c where c.purpose = 'memory_compact' and c.batch), 'batch bayrağı');
end $$;

-- doğrulama, öğrenci/veli oturumu, personel üst sınırı
do $$
declare
  v_id bigint;
  v_before numeric;
begin
  perform t.as_user(t.u('elif'));
  perform t.raises($q$select public.log_llm_call('{"purpose":"chat","model":"x","status":"ok","cost_usd":-9999}')$q$, 'OGR-AUTH-002%',
                   'öğrenci deftere yazamaz (tavanı negatif kayıtla sıfırlayamaz)');
  perform t.raises($q$select public.log_llm_call('{"purpose":"chat","model":"x","status":"ok","cost_usd":9999}')$q$, 'OGR-AUTH-002%',
                   'öğrenci deftere büyük maliyet yazamaz (herkes için tavan DoS yok)');
  perform t.as_user(t.u('parent'));
  perform t.raises($q$select public.log_llm_call('{"purpose":"chat","model":"x","status":"ok"}')$q$, 'OGR-AUTH-002%', 'veli deftere yazamaz');
  perform t.as_service();
  perform t.raises($q$select public.log_llm_call('{"model":"x","status":"ok"}')$q$, 'OGR-LLM-001%', 'purpose gerekli');
  perform t.raises($q$select public.log_llm_call('[]')$q$, 'OGR-LLM-001%', 'nesne olmalı');
  perform t.raises($q$select public.log_llm_call('{"purpose":"chat","model":"x","status":"belki"}')$q$, 'OGR-LLM-001%', 'durum enum');
  perform t.raises($q$select public.log_llm_call('{"purpose":"chat","model":"x","status":"ok","effort":"turbo"}')$q$, 'OGR-LLM-001%', 'effort enum');
  perform t.raises($q$select public.log_llm_call('{"purpose":"chat","model":"x","status":"ok","tokens_in":"çok"}')$q$, 'OGR-LLM-001%', 'sayı alanı');
  select coalesce(sum(l.cost_usd), 0) into v_before from public.spend_ledger l;
  perform t.raises($q$select public.log_llm_call('{"purpose":"chat","model":"x","status":"ok","cost_usd":-9999}')$q$, 'OGR-LLM-001%',
                   'negatif maliyet reddedilir (worker da)');
  perform t.raises($q$select public.log_llm_call('{"purpose":"chat","model":"x","status":"ok","tokens_out":-5}')$q$, 'OGR-LLM-001%',
                   'negatif token reddedilir');
  perform t.as_admin();
  perform t.raises($q$insert into public.spend_ledger (day, purpose, provider, cost_usd) values (current_date, 'x', 'y', -1)$q$, '23514',
                   'spend_ledger negatif maliyet kabul etmez');
  perform t.ok((select coalesce(sum(l.cost_usd), 0) from public.spend_ledger l) = v_before, 'reddedilen kayıtlar toplamı değiştirmez');
  perform t.as_user(t.u('inst'));
  perform t.raises($q$select public.log_llm_call('{"purpose":"chat","model":"x","status":"ok","cost_usd":9999}')$q$, 'OGR-LLM-001%',
                   'personel: çağrı başına maliyet üst sınırı (settings.llm_call_max_cost_usd)');
  v_id := public.log_llm_call('{"purpose":"chat","model":"claude-haiku-5-5","status":"ok","cost_usd":0.5,"student_ref":"s_aaaaaaaaaaaa","created_at":"2020-01-01T00:00:00Z"}');
  perform t.as_admin();
  perform t.ok((select c.student_ref = 's_aaaaaaaaaaaa' and c.cost_usd = 0.5 and c.created_at > now() - interval '1 minute'
                  from public.llm_calls c where c.id = v_id), 'personel oturumu yazar; created_at yok sayılır');
  perform t.ok(t.sees(t.u('elif'), 'select 1 from public.llm_calls') = 0 and t.sees(t.u('inst'), 'select 1 from public.llm_calls') = 0
               and t.sees(t.u('admin'), 'select 1 from public.llm_calls') = 4 and t.sees(t.u('admin'), 'select 1 from public.spend_ledger') = 2,
               'defter yalnız admin''e görünür');
  perform t.as_user(t.u('elif'));
  perform t.raises($q$insert into public.llm_calls (purpose, model, status) values ('chat', 'x', 'ok')$q$, '42501', 'llm_calls''a doğrudan yazım yok');
  perform t.as_admin();
end $$;

rollback;
