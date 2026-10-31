-- tests/12_pilot_metrics.sql — batch_worker'ın doğrudan yazım sözleşmesi (BLUEPRINT §3.8, §6.2 metrics, §12 #57):
-- (1) pilot_metrics: kulaklik metrics haftalık satırları PostgREST upsert'üyle yazar (resolution=merge-duplicates →
--     INSERT … ON CONFLICT (metric, period) DO UPDATE SET <gövdedeki her sütun> = EXCLUDED.…); metrics --gate ve
--     cost-report son dönemi okur. ON CONFLICT DO UPDATE çakışma sütunlarında SELECT ve RLS SELECT politikası ister
--     (0018_pilot_metrics_grants.sql). bot_runtime ve anon bu tabloya hiç erişemez.
-- (2) llm_calls: batch_worker yalnız matristeki sütunlarla ekler (ledger.py); created_at (ve id) sunucunundur.
-- Testler dev dünyasının pilot_metrics satırlarına güvenmez; kendi dönemini (2099-01-05, pazartesi) kullanır.
begin;
\ir _fixture.sql
insert into t.cfg values ('matrix', :'matrix');

-- 'batch_worker upserts pilot_metrics (merge-duplicates) and reads it back'
do $$
declare
  v_row public.pilot_metrics;
  v_n int;
begin
  perform t.as_batch();
  -- ilk hesap: PostgREST return=minimal upsert'ünün SQL'i (gövde: metric, period, value, detail, computed_at)
  insert into public.pilot_metrics (metric, period, value, detail, computed_at)
  values ('question_accuracy', date '2099-01-05', 0.5000, '{"n": 2, "approved": 1, "rejected": 1}', '2099-01-12T01:00:00Z'),
         ('degraded_share', date '2099-01-05', null, '{"n": 0}', '2099-01-12T01:00:00Z')
  on conflict (metric, period) do update
    set metric = excluded.metric, period = excluded.period, value = excluded.value, detail = excluded.detail,
        computed_at = excluded.computed_at;
  get diagnostics v_n = row_count;
  perform t.ok(v_n = 2, 'batch_worker pilot_metrics upsert (ilk yazım, ON CONFLICT DO UPDATE, return=minimal) iki satır yazar');
  -- aynı haftanın yeniden hesabı: satır güncellenir (eskiden "permission denied" → düz eklemeye düşüş, değer ilk hesapta kalırdı)
  insert into public.pilot_metrics (metric, period, value, detail, computed_at)
  values ('question_accuracy', date '2099-01-05', 0.9000, '{"n": 30, "approved": 27, "rejected": 3}', '2099-01-12T02:00:00Z')
  on conflict (metric, period) do update
    set metric = excluded.metric, period = excluded.period, value = excluded.value, detail = excluded.detail,
        computed_at = excluded.computed_at;
  select * into v_row from public.pilot_metrics pm where pm.metric = 'question_accuracy' and pm.period = date '2099-01-05';
  perform t.ok(v_row.value = 0.9000 and (v_row.detail ->> 'n')::int = 30 and v_row.computed_at = timestamptz '2099-01-12T02:00:00Z',
               'batch_worker upsert aynı (metric, period) satırını günceller ve geri okur (value 0.9000, n 30)');
  perform t.ok((select count(*) from public.pilot_metrics pm where pm.period = date '2099-01-05') = 2,
               'batch_worker kendi döneminin iki satırını görür (çift satır yok)');
  -- gate/cost-report: son dönem okuması (PostgREST select=*&order=period.desc)
  perform t.ok((select max(pm.period) from public.pilot_metrics pm) = date '2099-01-05',
               'batch_worker pilot_metrics son dönemini okur (metrics --gate, cost-report)');
  -- return=representation (RETURNING *) da çalışır
  insert into public.pilot_metrics (metric, period, value, detail)
  values ('cost_per_student', date '2099-01-05', 0.0500, '{"month_usd": 1.5, "active_students": 30, "lesson_usd": 0}')
  on conflict (metric, period) do update set value = excluded.value, detail = excluded.detail
  returning * into v_row;
  perform t.ok(v_row.metric = 'cost_per_student' and v_row.value = 0.0500, 'batch_worker upsert RETURNING * satırı döner');
  -- resolution=ignore-duplicates (ON CONFLICT DO NOTHING) çakışmada değeri değiştirmez
  insert into public.pilot_metrics (metric, period, value) values ('cost_per_student', date '2099-01-05', 0.9999)
  on conflict (metric, period) do nothing;
  perform t.ok((select pm.value from public.pilot_metrics pm where pm.metric = 'cost_per_student' and pm.period = date '2099-01-05') = 0.0500,
               'ON CONFLICT DO NOTHING değeri değiştirmez');
  -- düz update (PATCH, update_minimal) de çalışır
  update public.pilot_metrics set value = 0.0400 where metric = 'cost_per_student' and period = date '2099-01-05';
  perform t.ok((select pm.value from public.pilot_metrics pm where pm.metric = 'cost_per_student' and pm.period = date '2099-01-05') = 0.0400,
               'batch_worker pilot_metrics PATCH (update … where metric, period) çalışır');
  perform t.raises($q$delete from public.pilot_metrics where period = date '2099-01-05'$q$, '42501',
                   'batch_worker pilot_metrics silemez (r w u; d yok)');
  perform t.as_admin();
end $$;

-- 'bot_runtime cannot read or write pilot_metrics'
do $$
begin
  perform t.as_bot(null);
  perform t.raises($q$select count(*) from public.pilot_metrics$q$, '42501', 'bot_runtime (başlıksız) pilot_metrics okuyamaz');
  perform t.raises($q$insert into public.pilot_metrics (metric, period, value) values ('degraded_share', date '2099-01-12', 0.1)$q$, '42501',
                   'bot_runtime pilot_metrics ekleyemez');
  perform t.raises($q$insert into public.pilot_metrics (metric, period, value) values ('degraded_share', date '2099-01-05', 0.1)
                      on conflict (metric, period) do update set value = excluded.value$q$, '42501',
                   'bot_runtime pilot_metrics upsert edemez');
  perform t.raises($q$update public.pilot_metrics set value = 0 where period = date '2099-01-05'$q$, '42501',
                   'bot_runtime pilot_metrics güncelleyemez');
  perform t.as_bot(t.u('A'));
  perform t.raises($q$select count(*) from public.pilot_metrics$q$, '42501', 'bot_runtime (öğrenci başlığıyla) pilot_metrics okuyamaz');
  perform t.as_anon();
  perform t.raises($q$select count(*) from public.pilot_metrics$q$, '42501', 'anon pilot_metrics okuyamaz');
  perform t.as_admin();
end $$;

-- Panel (authenticated) okuması değişmedi: personel okur, yazamaz
do $$
begin
  perform t.as_staff(t.u('coord'));
  perform t.ok((select count(*) from public.pilot_metrics pm where pm.period = date '2099-01-05') = 3,
               'koordinatör pilot_metrics satırlarını okur (/maliyet)');
  perform t.raises($q$update public.pilot_metrics set value = 0 where period = date '2099-01-05'$q$, '42501',
                   'authenticated pilot_metrics güncelleyemez');
  perform t.as_admin();
  perform t.ok((select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'pilot_metrics'
                  and p.policyname = 'pilot_metrics_batch_r' and p.cmd = 'SELECT' and p.roles = '{batch_worker}') = 1,
               'pilot_metrics_batch_r politikası yalnız batch_worker için SELECT');
  perform t.ok(not has_table_privilege('bot_runtime', 'public.pilot_metrics', 'select, insert, update, delete'),
               'bot_runtime pilot_metrics üzerinde hiçbir tablo yetkisi taşımaz');
end $$;

-- 'batch_worker inserts llm_calls with exactly the granted columns; created_at is server-side'
do $$
declare
  v_want text[];
  v_have text[];
  v_id bigint;
  v_row public.llm_calls;
begin
  select array_agg(c.value order by c.value) into v_want
    from jsonb_array_elements_text(t.v('matrix')::jsonb -> 'tables' -> 'public.llm_calls' -> 'batch_worker' -> 'insert') c;
  select array_agg(a.attname::text order by a.attname::text) into v_have
    from pg_attribute a
   where a.attrelid = 'public.llm_calls'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('batch_worker', 'public.llm_calls', a.attname, 'insert');
  perform t.ok(v_have = v_want and not ('created_at' = any(v_have)) and not ('id' = any(v_have)),
               format('batch_worker llm_calls INSERT sütunları = matris (%s sütun; created_at ve id yok)', cardinality(v_want)));

  perform t.as_batch();
  -- ogrenmen_common ledger'ının gövdesi: matrisin 15 sütununun hepsi (created_at yok)
  insert into public.llm_calls (purpose, provider, model, tokens_in, tokens_out, audio_sec, images, batch, status, error_code,
                                latency_ms, cost_usd, ref_table, ref_id, student_ref)
  values ('nightly_facts', 'gemini-paid', 'gemini-2.5-flash', 1200, 300, null, 0, true, 'ok', null,
          850, 0.001234, 'messages', '42', 'S-TEST-12')
  returning id into v_id;
  perform t.ok(v_id is not null, 'batch_worker llm_calls''a granted sütunların tamamıyla ekler (RETURNING id)');
  perform t.raises($q$insert into public.llm_calls (purpose, provider, model, status, created_at)
                      values ('nightly_facts', 'gemini-paid', 'gemini-2.5-flash', 'ok', '2000-01-01T00:00:00Z')$q$, '42501',
                   'batch_worker llm_calls.created_at yazamaz (sütun yetkisi yok)');
  perform t.raises($q$update public.llm_calls set cost_usd = 0 where student_ref = 'S-TEST-12'$q$, '42501',
                   'batch_worker llm_calls güncelleyemez (yalnız w r)');
  perform t.as_bot(null);
  perform t.raises($q$insert into public.llm_calls (purpose, provider, model, status) values ('chat', 'gemini-paid', 'm', 'ok')$q$, '42501',
                   'bot_runtime llm_calls''a doğrudan yazamaz (yalnız log_bot_response içinden)');
  perform t.as_admin();
  select * into v_row from public.llm_calls lc where lc.id = v_id;
  perform t.ok(v_row.created_at = now() and v_row.student_ref = 'S-TEST-12' and v_row.cost_usd = 0.001234 and v_row.batch,
               'llm_calls.created_at sunucu varsayılanı (now()); gönderilen değerler saklandı');
end $$;

rollback;
