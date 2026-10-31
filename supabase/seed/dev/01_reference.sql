-- seed/dev/01_reference.sql — geliştirme verisi: başvuru tabloları (kota, ayar, bayrak, saklama, hukuk, müfredat).
-- supabase/scripts/gen-dev-seed.py fixtures/db/dev-seed.json'dan üretir; elle düzenlenmez. Yalnız db-test.sh --dev.
begin;
select set_config('ogrenmen.grader', 'on', true);

-- quota_tiers (3)
insert into public.quota_tiers (tier, label, service_level, advisor_sla_hours) values ('standard', 'Standart', 'ai_only', null)
  on conflict do nothing;
insert into public.quota_tiers (tier, label, service_level, advisor_sla_hours) values ('pilot', 'Pilot', 'ai_plus_advisor', 4)
  on conflict do nothing;
insert into public.quota_tiers (tier, label, service_level, advisor_sla_hours) values ('staff', 'Personel', 'ai_only', null)
  on conflict do nothing;

-- quota_limits (15)
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('standard', 'message', 25, 5)
  on conflict do nothing;
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('standard', 'test', 5, 5)
  on conflict do nothing;
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('standard', 'research', 0, 5)
  on conflict do nothing;
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('standard', 'voice_minutes', 0, 5)
  on conflict do nothing;
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('standard', 'figure', 10, 5)
  on conflict do nothing;
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('pilot', 'message', 40, 5)
  on conflict do nothing;
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('pilot', 'test', 8, 5)
  on conflict do nothing;
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('pilot', 'research', 2, 5)
  on conflict do nothing;
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('pilot', 'voice_minutes', 0, 5)
  on conflict do nothing;
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('pilot', 'figure', 20, 5)
  on conflict do nothing;
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('staff', 'message', 50, 5)
  on conflict do nothing;
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('staff', 'test', 10, 5)
  on conflict do nothing;
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('staff', 'research', 5, 5)
  on conflict do nothing;
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('staff', 'voice_minutes', 0, 5)
  on conflict do nothing;
insert into public.quota_limits (tier, kind, daily_limit, warn_at_remaining) values ('staff', 'figure', 20, 5)
  on conflict do nothing;

-- settings (17)
insert into public.settings (key, value, description, updated_at) values ('min_evidence', '5'::jsonb, 'Yüzde göstermek için gereken en az kanıt sayısı', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('misconception_open_evidence', '3'::jsonb, 'Yanılgının açık sayılması için kanıt sayısı', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('alert_unanswered_hours', '6'::jsonb, 'Cevapsız soru uyarısı (saat)', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('alert_unanswered_danger_hours', '24'::jsonb, 'Cevapsız soru acil eşiği (saat)', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('alert_silent_days', '3'::jsonb, 'Sessiz öğrenci uyarısı (gün)', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('alert_silent_danger_days', '7'::jsonb, 'Sessiz öğrenci acil eşiği (gün)', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('alert_deadline_days', '2'::jsonb, 'Yaklaşan teslim uyarısı (gün)', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('response_target_hours', '2'::jsonb, 'Eğitmen yanıt süresi hedefi (saat)', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('chat_max_tokens_out', '220'::jsonb, 'Sohbet cevabı en çok çıkış tokenı', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('chat_budget_tokens_in', '2200'::jsonb, 'Sohbet turu en çok giriş tokenı', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('memory_k', '5'::jsonb, 'Prompt''a giren hafıza olgusu sayısı', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('recent_messages', '6'::jsonb, 'Prompt''a giren son mesaj sayısı', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('burst_seconds', '3'::jsonb, 'Patlama koruması (saniye)', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('session_idle_hours', '6'::jsonb, 'Oturumun boşa düşme süresi (saat)', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('max_options', '4'::jsonb, 'Çoktan seçmeli şık sayısı', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('default_period', '"YKS 2027"'::jsonb, 'İlk kayıtta enrollments.period_label', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.settings (key, value, description, updated_at) values ('pilot_gate', '{"question_accuracy":{"min":0.9,"n_min":30},"diagnostic_agreement":{"min":0.6,"n_min":10},"citation_relevance":{"min":0.8,"n_min":10,"required":false},"priority_uplift":{"min":0.0,"required":false},"cost_per_student":{"max_usd":0.1},"flagged_response_share":{"max":0.05},"degraded_share":{"max":0.05},"isolation_tests":"pass","key_leak_tests":"pass"}'::jsonb, 'Pilot kapısı eşikleri (ADR-0013)', '2026-10-01T00:00:00Z')
  on conflict do nothing;

-- runtime_flags (16)
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('paid_llm_enabled', 'true'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('degraded_mode', 'false'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('daily_cap_usd', '0.8'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('monthly_cap_usd', '24.0'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('cap_excluded_purposes', '["lesson_analysis","transcribe","diarize"]'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('lesson_monthly_cap_usd', '30.0'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('alert_thresholds', '[0.5,0.8,1.0]'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('alerts_sent', '{}'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('proactive_enabled', 'true'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('research_enabled', 'false'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('research_monthly_cap', '40'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('tablet_nightly_count', '10'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('cron_owner', '"pg_cron"'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('storage_pressure', 'false'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('facts_lag_days', '0'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;
insert into public.runtime_flags (key, value, updated_at, updated_by) values ('prompt_version_chat', '"socratic.v3"'::jsonb, '2026-10-01T00:00:00Z', 'seed')
  on conflict do nothing;

-- retention_policies (17)
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('tg_updates.purge', 'public', 'tg_updates', 'received_at', 2, 'delete', null, null, null, null, true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('messages.hard_delete', 'public', 'messages', 'expires_at', 0, 'delete', null, null, null, 'Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve {days} gün sonra silinir.', true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('bot_responses.prompt_null', 'public', 'bot_responses', 'created_at', 30, 'null_columns', null, array['prompt_text']::text[], null, 'Bot cevaplarının tam istem metni {days} gün sonra silinir.', true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('bot_responses.hard_delete', 'public', 'bot_responses', 'created_at', 180, 'delete', null, null, 'flagged = false', 'Bot cevap kayıtları {days} gün sonra silinir.', true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('bot_responses.flagged_delete', 'public', 'bot_responses', 'created_at', 365, 'delete', null, null, 'flagged = true', null, true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('llm_calls.hard_delete', 'public', 'llm_calls', 'created_at', 180, 'delete', null, null, null, null, true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('memory_facts.expire', 'public', 'memory_facts', 'valid_until', 0, 'expire', null, null, null, null, true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('memory_facts.hard_delete', 'public', 'memory_facts', 'created_at', 180, 'delete', null, null, 'status = ''expired''', null, true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('memory_facts.stale', 'public', 'memory_facts', 'created_at', 180, 'expire', null, null, 'valid_until is null and status = ''active''', 'Hafıza olguları {days} gün sonra silinir.', true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('lessons.video', 'public', 'lessons', 'held_at', 30, 'custom', 'app.retention_lessons_video', null, null, 'Ders kaydının videosu {days} gün sonra silinir; isimsiz transkript kalır.', true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('lessons.transcript', 'public', 'enrollments', 'ended_at', 730, 'custom', 'app.retention_lessons_transcript', null, null, 'Transkript dönem bitiminden 2 yıl sonra silinir.', true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('citations.unresolved', 'public', 'citations', 'verified_at', 7, 'delete', null, null, 'crossref_status = ''unresolved''', null, true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('quota_usage.purge', 'public', 'quota_usage', 'day', 60, 'delete', null, null, null, null, true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('audit.events.purge', 'audit', 'events', 'at', 730, 'delete', null, null, null, null, true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('students.anonymize', 'public', 'students', 'deleted_at', 30, 'custom', 'app.retention_students_anonymize', null, null, 'Silme talebinden {days} gün sonra kişisel verilerin silinir.', true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('enrollments.closed_cleanup', 'public', 'enrollments', 'ended_at', 365, 'custom', 'app.retention_enrollments_closed', null, 'status = ''closed''', null, true)
  on conflict do nothing;
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values ('enrollments.learning_data', 'public', 'enrollments', 'ended_at', 730, 'custom', 'app.retention_enrollments_learning_data', null, 'status = ''closed''', 'Öğrenme verisi dönem bitiminden 2 yıl sonra anonimleştirilir.', true)
  on conflict do nothing;

-- legal_texts (5)
insert into public.legal_texts (id, kind, version, body_md, effective_from) values ('675a8680-b4d6-5837-9155-7792d2824422', 'kvkk_aydinlatma', '2026-10-v1', '# Aydınlatma metni

> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz

Veri sorumlusu easy''dir. Öğrenmen; adını, doğum yılını ve Telegram kimliğini ayrı ve kapalı bir bölümde tutar. Yapay zekâ sağlayıcılarına yalnız temizlenmiş metin gider.

Mesajlar 90 gün, bot cevaplarındaki tam istem metni 30 gün, hafıza olguları 180 gün, ders videoları 30 gün saklanır.

Bu metni onaylamamış bir grup üyesinin mesajlarının içeriği saklanmaz; yalnız gönderim zamanı ve rolü kaydedilir, yapay zekâ bu mesajları okumaz.

<!-- ogrenmen:cocuk-dili:start -->
**Verilerin nasıl kullanılıyor?** Yazdıklarını sana daha iyi yardım etmek için saklıyoruz.
Adını ve okulunu yapay zekâya göndermiyoruz; mesajların 90 gün sonra silinir.
İstediğin zaman /sil yazarak verilerinin silinmesini isteyebilirsin.
<!-- ogrenmen:cocuk-dili:end -->
', '2026-10-15')
  on conflict do nothing;
insert into public.legal_texts (id, kind, version, body_md, effective_from) values ('436801a0-024e-56dd-ab6e-257889632603', 'veli_onayi', '2026-10-v1', '# Veli onay formu

> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz

18 yaşından küçük öğrencinin sohbet kaydı, öğrenme profili ve ders kaydı analizi için veli ya da vasinin açık rızası gerekir. Onay, koordinatörün verdiği kodla ya da kâğıt formla alınır ve her zaman geri alınabilir.
', '2026-10-15')
  on conflict do nothing;
insert into public.legal_texts (id, kind, version, body_md, effective_from) values ('2ca970eb-50ec-5a04-bf51-76466d40ffc7', 'grup_kayit', '2026-10-v1', 'Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve {days} gün sonra silinir. Öğrenmen bir yapay zekâ öğretmenidir; hocalar da bu grupta. Ayrıntı: /gizlilik

Botla özel sohbette onay vermeyen üyelerin mesaj içeriği saklanmaz; yalnız zaman ve rol bilgisi tutulur. Onay için bota özelden /start yazın.
', '2026-10-15')
  on conflict do nothing;
insert into public.legal_texts (id, kind, version, body_md, effective_from) values ('2b72129e-dae5-5d58-a707-054ca7096193', 'ders_kaydi', '2026-10-v1', '# Ders kaydı bildirimi

> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz

Ders videosunun sesi ve birkaç karesi analiz edilir; isimler yapay zekâya gitmez. Video 30 gün sonra silinir ve öğrenciye ve veliye bildirilir; isimsiz transkript dönem bitiminden 730 gün sonra silinir.
', '2026-10-15')
  on conflict do nothing;
insert into public.legal_texts (id, kind, version, body_md, effective_from) values ('583dcb45-dcdb-5e18-9db7-d7579d78d0b4', 'kullanim_kosullari', '2026-10-v1', '# Kullanım koşulları

Öğrenmen bir yapay zekâ öğretmenidir; not, devamsızlık ve ödeme konularında eğitmen adına konuşmaz.
', '2026-10-15')
  on conflict do nothing;

-- curricula (1)
insert into public.curricula (id, code, authority, year, version, label, status) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'TYT-MAT', 'ÖSYM', 2026, '2026.1', 'TYT Matematik 2026', 'active')
  on conflict do nothing;

-- skills (21)
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel', null, 'Temel matematik', null, false, 1, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.sayilar', 'tyt.mat.temel', 'Sayı kümeleri, işlem önceliği, işaret kuralları', null, true, 2, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.bolunebilme', 'tyt.mat.temel', 'Bölünebilme kuralları, kalan', null, true, 3, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.ebob-ekok', 'tyt.mat.temel', 'EBOB–EKOK ve problemleri', null, true, 4, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.rasyonel-sayilar', 'tyt.mat.temel', 'Rasyonel sayılarda dört işlem ve sıralama', null, true, 5, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.ondalik', 'tyt.mat.temel', 'Ondalık gösterim, devirli ondalık, dönüşüm', null, true, 6, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.uslu', 'tyt.mat.temel', 'Üslü ifadeler ve özellikleri', null, true, 7, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.koklu', 'tyt.mat.temel', 'Köklü ifadeler, kök içine alma, eşlenik', null, true, 8, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.carpanlara-ayirma', 'tyt.mat.temel', 'Çarpanlara ayırma ve özdeşlikler', null, true, 9, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir', null, 'Cebir', null, false, 10, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.denklem', 'tyt.mat.cebir', 'Birinci dereceden denklemler ve sistemler', null, true, 11, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.esitsizlik', 'tyt.mat.cebir', 'Basit eşitsizlikler', null, true, 12, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.mutlak-deger', 'tyt.mat.cebir', 'Mutlak değer: tanım, denklem, eşitsizlik', null, true, 13, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.oran-oranti', 'tyt.mat.cebir', 'Oran–orantı, doğru/ters orantı', null, true, 14, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem', null, 'Problemler', null, false, 15, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.sayi', 'tyt.mat.problem', 'Sayı problemleri', null, true, 16, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.kesir', 'tyt.mat.problem', 'Kesir problemleri', null, true, 17, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.yas', 'tyt.mat.problem', 'Yaş problemleri', null, true, 18, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.yuzde', 'tyt.mat.problem', 'Yüzde, kâr–zarar', null, true, 19, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.hareket', 'tyt.mat.problem', 'Hareket problemleri', null, true, 20, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;
insert into public.skills (curriculum_id, id, parent_id, name, description, is_leaf, order_no, p_init, p_learn, p_guess, p_slip) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.isci', 'tyt.mat.problem', 'İşçi–havuz problemleri', null, true, 21, 0.3, 0.1, 0.25, 0.1)
  on conflict do nothing;

-- skill_prerequisites (24)
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.bolunebilme', 'tyt.mat.temel.sayilar', 1.0, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.ebob-ekok', 'tyt.mat.temel.bolunebilme', 1.0, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.rasyonel-sayilar', 'tyt.mat.temel.sayilar', 1.0, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.rasyonel-sayilar', 'tyt.mat.temel.ebob-ekok', 0.6, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.ondalik', 'tyt.mat.temel.rasyonel-sayilar', 0.8, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.uslu', 'tyt.mat.temel.sayilar', 1.0, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.koklu', 'tyt.mat.temel.uslu', 1.0, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.carpanlara-ayirma', 'tyt.mat.temel.uslu', 0.8, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.denklem', 'tyt.mat.temel.sayilar', 1.0, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.denklem', 'tyt.mat.temel.rasyonel-sayilar', 0.8, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.esitsizlik', 'tyt.mat.cebir.denklem', 1.0, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.mutlak-deger', 'tyt.mat.cebir.esitsizlik', 0.9, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.mutlak-deger', 'tyt.mat.temel.sayilar', 0.6, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.oran-oranti', 'tyt.mat.temel.rasyonel-sayilar', 0.9, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.sayi', 'tyt.mat.cebir.denklem', 1.0, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.kesir', 'tyt.mat.temel.rasyonel-sayilar', 1.0, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.kesir', 'tyt.mat.cebir.denklem', 0.7, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.yas', 'tyt.mat.problem.sayi', 0.9, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.yuzde', 'tyt.mat.cebir.oran-oranti', 1.0, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.yuzde', 'tyt.mat.temel.ondalik', 0.7, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.hareket', 'tyt.mat.cebir.oran-oranti', 0.9, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.hareket', 'tyt.mat.cebir.denklem', 0.8, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.isci', 'tyt.mat.cebir.oran-oranti', 0.8, 'curriculum')
  on conflict do nothing;
insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source) values ('7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.isci', 'tyt.mat.temel.rasyonel-sayilar', 0.6, 'curriculum')
  on conflict do nothing;

-- misconception_tags (27)
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('sayilar.islem-onceligi-soldan', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.sayilar', null, 'İşlem önceliğini atlayıp soldan sağa gidiyor.', 'Çarpma ve bölmeyi toplama ve çıkarmadan önce yapıyoruz.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('sayilar.negatif-carpim-isaret', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.sayilar', null, 'Negatif × negatif sonucunu negatif alıyor.', 'İki negatifin çarpımı pozitif olur.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('sayilar.parantez-eksi-dagitma', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.sayilar', null, 'Parantez önündeki eksiyi dağıtmıyor.', 'Eksi işareti parantezdeki her terime dağılır.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('bolunebilme.3-ile-9-karistirma', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.bolunebilme', null, '9 ile bölünebilmeyi 3 kuralıyla kontrol ediyor.', '9''a bölünebilme için rakamlar toplamı 9''un katı olmalı.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('ebob-ekok.karistirma', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.ebob-ekok', 'tyt.mat.temel.bolunebilme', 'EBOB ile EKOK''u yer değiştiriyor.', 'En büyük ortak bölen küçüğü, EKOK büyüğü verir.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('rasyonel.pay-payda-ayri-toplama', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.rasyonel-sayilar', null, 'Payları ve paydaları ayrı ayrı topluyor.', 'Paylar ve paydalar ayrı ayrı toplanmaz; önce paydaları eşitleyelim.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('rasyonel.payda-esitlemeden-toplama', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.rasyonel-sayilar', 'tyt.mat.temel.ebob-ekok', 'Paydaları eşitlemeden payları topluyor.', 'Toplamadan önce paydaları eşitlemen gerekiyor.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('rasyonel.bolmede-ters-cevirmeme', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.rasyonel-sayilar', null, 'Kesirle bölmede ikinci kesri ters çevirmiyor.', 'Kesirle bölerken ikinci kesri ters çevirip çarpıyoruz.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('rasyonel.negatif-siralama-mutlak', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.rasyonel-sayilar', 'tyt.mat.temel.sayilar', 'Negatif kesirleri mutlak değerlerine göre sıralıyor.', 'Negatif sayılarda mutlak değeri büyük olan daha küçüktür.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('ondalik.virgul-kaydirma-yon', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.ondalik', 'tyt.mat.temel.rasyonel-sayilar', 'Virgül kaydırma yönünü karıştırıyor.', '10 ile çarparken virgül bir basamak sağa gider.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('uslu.usleri-carpma', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.uslu', null, 'Aynı tabanlı çarpımda üsleri çarpıyor.', 'Tabanlar aynıysa üsler toplanır.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('uslu.negatif-us-isaret', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.uslu', 'tyt.mat.temel.sayilar', 'Negatif üssü sonucun işareti sanıyor.', 'Negatif üs tersini alır, işareti değiştirmez.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('koklu.toplam-kok-icine', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.koklu', 'tyt.mat.temel.uslu', '√a + √b''yi √(a+b) olarak topluyor.', '√a + √b, √(a+b) değildir.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('koklu.kok-icine-alma-kare', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.koklu', 'tyt.mat.temel.uslu', 'Katsayıyı kök içine alırken karesini almıyor.', 'Katsayı kök içine karesi alınarak girer.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('carpan.tam-kare-orta-terim', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.carpanlara-ayirma', 'tyt.mat.temel.uslu', '(a+b)² açılımında 2ab terimini unutuyor.', 'Kare açarken ortadaki 2ab terimini ekleyelim.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('carpan.iki-kare-farki', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.carpanlara-ayirma', null, 'a²−b²''yi (a−b)² ile karıştırıyor.', 'a²−b² = (a−b)(a+b) olur.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('denklem.taraf-degistirme-isaret', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.denklem', 'tyt.mat.temel.sayilar', 'Terimi karşı tarafa işaret değiştirmeden geçiriyor.', 'Terim karşı tarafa geçerken işareti değişir.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('denklem.paydayla-carpma-eksik', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.denklem', 'tyt.mat.temel.rasyonel-sayilar', 'Paydadan kurtarırken tüm terimleri çarpmıyor.', 'Paydayla çarparken her terimi çarpıyoruz.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('esitsizlik.negatifle-carpma-yon', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.esitsizlik', 'tyt.mat.cebir.denklem', 'Negatifle çarpınca eşitsizliğin yönünü çevirmiyor.', 'Eşitsizliği negatifle çarparsan yön değişir.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('mutlak.tek-durum', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.mutlak-deger', 'tyt.mat.cebir.esitsizlik', 'Mutlak değer denkleminde tek durum alıyor.', 'İçerideki ifade hem pozitif hem negatif olabilir; iki durum var.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('oran.ters-oran-dogru-gibi', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.oran-oranti', 'tyt.mat.temel.rasyonel-sayilar', 'Ters orantıyı doğru orantı gibi kuruyor.', 'Biri artarken diğeri azalıyorsa ters orantı var.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('yuzde.ardisik-toplama', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.yuzde', 'tyt.mat.cebir.oran-oranti', 'Ardışık yüzdeleri topluyor.', '%20 sonra %10 artış, %30 değildir; sırayla uygula.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('yuzde.kar-satis-uzerinden', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.yuzde', null, 'Kârı satış fiyatı üzerinden hesaplıyor.', 'Kâr yüzdesi maliyet üzerinden hesaplanır.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('hareket.birim-donusumu', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.hareket', null, 'Saat–dakika dönüşümünü atlıyor.', 'Hız km/sa ise süreyi saate çevir.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('isci.sureleri-toplama', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.isci', 'tyt.mat.temel.rasyonel-sayilar', 'İş sürelerini topluyor.', 'Birlikte çalışırken birim zamandaki işler toplanır, süreler değil.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('kesir.kalan-butun-karistirma', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.kesir', 'tyt.mat.temel.rasyonel-sayilar', 'Kalanın kesrini bütünün kesri sanıyor.', '"Kalanın yarısı" bütünün değil kalanın yarısıdır.', '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student, created_at) values ('genel.soruyu-yarim-okuma', '7a988b84-8937-5242-8c35-ddbc4ea9216d', null, null, 'Sorulanı değil ara sonucu işaretliyor.', 'Soru neyi istiyor, son adımda tekrar bak.', '2026-10-01T00:00:00Z')
  on conflict do nothing;

-- question_templates (6)
insert into public.question_templates (id, curriculum_id, skill_id, module_path, engine, params_schema, enabled, has_figure, created_at) values ('islem-onceligi', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.sayilar', 'content/tyt-matematik/templates/islem_onceligi.py:generate', 'sympy', '{"$ref":"https://ogrenmen.easy/schemas/template-params.json"}'::jsonb, true, false, '2026-10-05T00:00:00Z')
  on conflict do nothing;
insert into public.question_templates (id, curriculum_id, skill_id, module_path, engine, params_schema, enabled, has_figure, created_at) values ('uslu-sadelestirme', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.uslu', 'content/tyt-matematik/templates/uslu_sadelestirme.py:generate', 'sympy', '{"$ref":"https://ogrenmen.easy/schemas/template-params.json"}'::jsonb, true, false, '2026-10-05T00:00:00Z')
  on conflict do nothing;
insert into public.question_templates (id, curriculum_id, skill_id, module_path, engine, params_schema, enabled, has_figure, created_at) values ('denklem-birinci-derece', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.denklem', 'content/tyt-matematik/templates/denklem_birinci_derece.py:generate', 'sympy', '{"$ref":"https://ogrenmen.easy/schemas/template-params.json"}'::jsonb, true, false, '2026-10-05T00:00:00Z')
  on conflict do nothing;
insert into public.question_templates (id, curriculum_id, skill_id, module_path, engine, params_schema, enabled, has_figure, created_at) values ('kesir-modeli-toplama', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.temel.rasyonel-sayilar', 'content/tyt-matematik/templates/kesir_modeli_toplama.py:generate', 'matplotlib', '{"$ref":"https://ogrenmen.easy/schemas/template-params.json"}'::jsonb, true, true, '2026-10-05T00:00:00Z')
  on conflict do nothing;
insert into public.question_templates (id, curriculum_id, skill_id, module_path, engine, params_schema, enabled, has_figure, created_at) values ('sayi-dogrusu-esitsizlik', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.cebir.mutlak-deger', 'content/tyt-matematik/templates/sayi_dogrusu_esitsizlik.py:generate', 'matplotlib', '{"$ref":"https://ogrenmen.easy/schemas/template-params.json"}'::jsonb, true, true, '2026-10-05T00:00:00Z')
  on conflict do nothing;
insert into public.question_templates (id, curriculum_id, skill_id, module_path, engine, params_schema, enabled, has_figure, created_at) values ('yuzde-grafik', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'tyt.mat.problem.yuzde', 'content/tyt-matematik/templates/yuzde_grafik.py:generate', 'matplotlib', '{"$ref":"https://ogrenmen.easy/schemas/template-params.json"}'::jsonb, true, true, '2026-10-05T00:00:00Z')
  on conflict do nothing;

commit;
