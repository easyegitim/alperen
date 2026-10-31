-- seed/01_settings.sql — sabitler (BLUEPRINT §3.1). Worker ve boru hatları açılışta okur; tekrar çalıştırmak değeri ezmez.
-- default_period: resolve_telegram ilk kayıtta enrollments.period_label olarak kullanır (curriculum.json period_label ile aynı).
-- pilot_gate: pilot kapısı eşikleri (ADR-0013); kulaklik metrics --gate ve panel /maliyet aynı satırı okur.
insert into public.settings (key, value, description) values
  ('min_evidence', '5'::jsonb, 'Yüzde göstermek için gereken en az kanıt sayısı'),
  ('misconception_open_evidence', '3'::jsonb, 'Yanılgının açık sayılması için kanıt sayısı'),
  ('alert_unanswered_hours', '6'::jsonb, 'Cevapsız soru uyarısı (saat)'),
  ('alert_unanswered_danger_hours', '24'::jsonb, 'Cevapsız soru acil eşiği (saat)'),
  ('alert_silent_days', '3'::jsonb, 'Sessiz öğrenci uyarısı (gün)'),
  ('alert_silent_danger_days', '7'::jsonb, 'Sessiz öğrenci acil eşiği (gün)'),
  ('alert_deadline_days', '2'::jsonb, 'Yaklaşan teslim uyarısı (gün)'),
  ('response_target_hours', '2'::jsonb, 'Eğitmen yanıt süresi hedefi (saat)'),
  ('chat_max_tokens_out', '220'::jsonb, 'Sohbet cevabı en çok çıkış tokenı'),
  ('chat_budget_tokens_in', '2200'::jsonb, 'Sohbet turu en çok giriş tokenı'),
  ('memory_k', '5'::jsonb, 'Prompt''a giren hafıza olgusu sayısı'),
  ('recent_messages', '6'::jsonb, 'Prompt''a giren son mesaj sayısı'),
  ('burst_seconds', '3'::jsonb, 'Patlama koruması (saniye)'),
  ('session_idle_hours', '6'::jsonb, 'Oturumun boşa düşme süresi (saat)'),
  ('max_options', '4'::jsonb, 'Çoktan seçmeli şık sayısı'),
  ('default_period', '"YKS 2027"'::jsonb, 'İlk kayıtta enrollments.period_label'),
  ('pilot_gate', '{"question_accuracy":{"min":0.9,"n_min":30},"diagnostic_agreement":{"min":0.6,"n_min":10},"citation_relevance":{"min":0.8,"n_min":10,"required":false},"priority_uplift":{"min":0.0,"required":false},"cost_per_student":{"max_usd":0.1},"flagged_response_share":{"max":0.05},"degraded_share":{"max":0.05},"isolation_tests":"pass","key_leak_tests":"pass"}'::jsonb, 'Pilot kapısı eşikleri (ADR-0013)')
on conflict (key) do nothing;
