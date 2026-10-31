-- 0018_pilot_metrics_grants.sql — batch_worker pilot_metrics'i okur (BLUEPRINT §3.8 satırı "w u" → "r w u"; §6.2
-- metrics/--gate, cost-report; §12 #57). Uygulanmış 0014 yeniden yazılmaz; bu dosya yalnız ekler.
-- Neden: pipelines/kulaklik_batch pilot.write haftalık satırları PostgREST upsert'üyle yazar
-- (Prefer: resolution=merge-duplicates → INSERT … ON CONFLICT (metric, period) DO UPDATE SET metric, period, value,
-- detail, computed_at = EXCLUDED.…). ON CONFLICT DO UPDATE çakışma sütunlarında SELECT yetkisi ve RLS'de var olan
-- satırı gören bir SELECT politikası ister; ikisi de yoktu, bu yüzden upsert "permission denied" ile düşüp düz eklemeye
-- iniyordu (aynı haftanın yeniden hesabı yazılamıyordu) ve metrics --gate / cost-report son dönemi okuyamayıp aynı
-- veriden yeniden hesaplıyordu. UPDATE yetkisi 0014'te tablo düzeyindedir (upsert'ün SET ettiği beş sütunun hepsi;
-- metric/period da EXCLUDED ile atanır); daraltmak upsert'ü bozar, genişletmeye gerek yok.
-- Tablo yalnız sayı taşır (öğrenci kimliği yok); bot_runtime'a ve anon'a yetki verilmez.

create policy pilot_metrics_batch_r on public.pilot_metrics for select to batch_worker using (true);
grant select on public.pilot_metrics to batch_worker;
