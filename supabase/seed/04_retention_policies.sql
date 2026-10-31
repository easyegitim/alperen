-- seed/04_retention_policies.sql — saklama politikaları (BLUEPRINT §3.10). Gün sayıları kullanıcı metinlerinin ve docs/hukuk
-- yer tutucularının tek kaynağıdır (content/tyt-matematik/scripts/export-sql.py bu dosyayı pglast ile okur; satırlar
-- "insert into public.retention_policies (...) values (...)" biçiminde, days tam sayı sabiti olmalıdır).
-- mode='custom' satırlarında handler = app.retention_* (imza (p_days int) returns int). messages.hard_delete days=0:
-- eşik messages.expires_at sütunundadır (= sent_at + tg_chats.retention_days, varsayılan 90).
insert into public.retention_policies (id, schema_name, table_name, ts_column, days, mode, handler, columns, condition_sql, user_facing_text, enabled) values
  ('tg_updates.purge', 'public', 'tg_updates', 'received_at', 2, 'delete', null, null, null, null, true),
  ('messages.hard_delete', 'public', 'messages', 'expires_at', 0, 'delete', null, null, null, 'Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve {days} gün sonra silinir.', true),
  ('bot_responses.prompt_null', 'public', 'bot_responses', 'created_at', 30, 'null_columns', null, array['prompt_text']::text[], null, 'Bot cevaplarının tam istem metni {days} gün sonra silinir.', true),
  ('bot_responses.hard_delete', 'public', 'bot_responses', 'created_at', 180, 'delete', null, null, 'flagged = false', 'Bot cevap kayıtları {days} gün sonra silinir.', true),
  ('bot_responses.flagged_delete', 'public', 'bot_responses', 'created_at', 365, 'delete', null, null, 'flagged = true', null, true),
  ('llm_calls.hard_delete', 'public', 'llm_calls', 'created_at', 180, 'delete', null, null, null, null, true),
  ('memory_facts.expire', 'public', 'memory_facts', 'valid_until', 0, 'expire', null, null, null, null, true),
  ('memory_facts.hard_delete', 'public', 'memory_facts', 'created_at', 180, 'delete', null, null, 'status = ''expired''', null, true),
  ('memory_facts.stale', 'public', 'memory_facts', 'created_at', 180, 'expire', null, null, 'valid_until is null and status = ''active''', 'Hafıza olguları {days} gün sonra silinir.', true),
  ('lessons.video', 'public', 'lessons', 'held_at', 30, 'custom', 'app.retention_lessons_video', null, null, 'Ders kaydının videosu {days} gün sonra silinir; isimsiz transkript kalır.', true),
  ('lessons.transcript', 'public', 'enrollments', 'ended_at', 730, 'custom', 'app.retention_lessons_transcript', null, null, 'Transkript dönem bitiminden 2 yıl sonra silinir.', true),
  ('citations.unresolved', 'public', 'citations', 'verified_at', 7, 'delete', null, null, 'crossref_status = ''unresolved''', null, true),
  ('quota_usage.purge', 'public', 'quota_usage', 'day', 60, 'delete', null, null, null, null, true),
  ('audit.events.purge', 'audit', 'events', 'at', 730, 'delete', null, null, null, null, true),
  ('students.anonymize', 'public', 'students', 'deleted_at', 30, 'custom', 'app.retention_students_anonymize', null, null, 'Silme talebinden {days} gün sonra kişisel verilerin silinir.', true),
  ('enrollments.closed_cleanup', 'public', 'enrollments', 'ended_at', 365, 'custom', 'app.retention_enrollments_closed', null, 'status = ''closed''', null, true),
  ('enrollments.learning_data', 'public', 'enrollments', 'ended_at', 730, 'custom', 'app.retention_enrollments_learning_data', null, 'status = ''closed''', 'Öğrenme verisi dönem bitiminden 2 yıl sonra anonimleştirilir.', true)
on conflict (id) do nothing;
