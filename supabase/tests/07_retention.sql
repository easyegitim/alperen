-- tests/07_retention.sql — saklama işleri (BLUEPRINT §3.10): delete / null_columns / expire dinamik SQL ve her custom
-- işleyici (app.retention_*) + storage_pressure (mesaj saklama 60 gün; kayıt bildirimi sütunu değişmez).
begin;
\ir _fixture.sql

-- Senaryo verisi
do $$
declare
  v_c uuid := '10000000-0000-4000-8000-00000000000c';
  v_d uuid := '10000000-0000-4000-8000-00000000000d';
  v_ed uuid := '20000000-0000-4000-8000-0000000000ed';
  v_q uuid;
  v_att bigint;
  v_lesson uuid;
begin
  -- C: 31 gün önce silme talebi
  insert into public.students (id, public_ref, is_minor, status, deleted_at) values (v_c, 's_cccccccccccc', false, 'deleted', now() - interval '31 days');
  insert into secure.student_pii (student_id, display_name) values (v_c, 'Cem Yıldız');
  insert into secure.telegram_identities (telegram_user_id, student_id, username) values (700100003, v_c, 'cem_y');
  insert into secure.guardian_codes (student_id, code_hash, channel, created_by, expires_at) values (v_c, 'h-c', 'telegram', t.u('coord'), now());
  insert into public.enrollments (student_id, curriculum_id, period_label) values (v_c, t.u('cur'), 'YKS 2027');
  insert into public.tg_chats (chat_id, kind) values (700100003, 'private');
  insert into public.chat_roles (chat_id, telegram_user_id, role, student_id) values (700100003, 700100003, 'student', v_c);
  insert into public.messages (chat_id, telegram_message_id, sender_role, student_id, text_raw, text_llm, sent_at)
  values (700100003, 1, 'student', v_c, 'Cem: merhaba', '[ÖĞRENCİ]: merhaba', now() - interval '5 days');
  insert into public.memory_facts (student_id, kind, text, source_message_ids)
  values (v_c, 'other', 'Öğrenci selam verdi.', array[(select m.id from public.messages m where m.chat_id = 700100003)]);
  insert into public.weekly_summaries (student_id, week_start, body, metrics) values (v_c, '2026-10-12', 'Özet.', '{}');
  insert into public.bot_responses (chat_id, student_id, purpose, response_text, prompt_text) values (700100003, v_c, 'chat', 'Merhaba', 'temiz prompt');
  insert into public.instructor_alerts (kind, severity, student_id, detail, ref) values
    ('unanswered', 'warning', v_c, 'Cevapsız soru: "merhaba, kesirleri anlamadım"', jsonb_build_object('message_id', 1)),
    ('deadline', 'warning', v_c, 'Teslim yaklaşıyor: Cem cuma günü ödev teslim edecek', '{}');
  insert into public.research_requests (student_id, query, expanded_queries) values (v_c, 'Cem''in sorduğu: kesirler neden zor?', array['kesir öğrenimi']);
  insert into public.mastery (enrollment_id, skill_id, p, evidence_count)
  select e.id, 'tyt.mat.temel.sayilar', 0.55, 3 from public.enrollments e where e.student_id = v_c;

  -- D: dönemi 800 gün önce kapanmış kayıt (öğrenme verisi + kapalı kayıt temizliği + transkript)
  insert into public.students (id, public_ref, is_minor, status) values (v_d, 's_dddddddddddd', false, 'active');
  insert into public.enrollments (id, student_id, curriculum_id, period_label, status, started_at, ended_at)
  values (v_ed, v_d, t.u('cur'), 'YKS 2024', 'closed', '2023-09-01', (now() - interval '800 days')::date);
  insert into public.questions (curriculum_id, skill_ids, kind, stem, source, content_hash, status)
  values (t.u('cur'), array['tyt.mat.temel.sayilar'], 'numeric', 'Saklama sorusu: 2+2', 'instructor', 'ret-q', 'draft') returning id into v_q;
  perform set_config('ogrenmen.grader', 'on', true);
  insert into public.attempts (enrollment_id, question_id, context, chosen, is_correct, graded_at) values (v_ed, v_q, 'practice', '{"value":"4"}', true, now())
  returning id into v_att;
  perform set_config('ogrenmen.grader', 'off', true);
  insert into public.observations (enrollment_id, skill_id, kind, value, source_type, source_id, source_locator, quote, created_by_role)
  values (v_ed, 'tyt.mat.temel.sayilar', 'practice', 1, 'attempt', v_att::text, 'Pratik', 'öğrenci 4 dedi', 'grader');
  perform public.apply_observation((select max(o.id) from public.observations o where o.enrollment_id = v_ed));
  insert into public.lessons (enrollment_id, staff_id, held_at, transcript_path) values (v_ed, t.u('inst_a'), now() - interval '820 days', 'transcripts/eski-ders.jsonl');
  insert into public.memory_facts (student_id, kind, text, source_message_ids) values (v_d, 'other', 'Eski dönem olgusu.', array[1::bigint]);

  -- Ders videosu 31 gün önce (A)
  insert into public.lessons (enrollment_id, staff_id, held_at, video_ref) values (t.u('EA'), t.u('inst_a'), now() - interval '31 days', 'local:eski.mp4')
  returning id into v_lesson;
  insert into t.cfg values ('lesson_video', v_lesson::text), ('ED', v_ed::text), ('C', v_c::text), ('D', v_d::text);

  -- delete / null_columns / expire satırları
  insert into public.messages (chat_id, telegram_message_id, sender_role, student_id, text_raw, text_llm, sent_at)
  values (700100001, 91, 'student', t.u('A'), '91 günlük mesaj', '91 günlük mesaj', now() - interval '91 days'),
         (700100001, 89, 'student', t.u('A'), '89 günlük mesaj', '89 günlük mesaj', now() - interval '89 days');
  insert into public.bot_responses (chat_id, student_id, purpose, response_text, prompt_text, created_at) values
    (700100001, t.u('A'), 'chat', 'eski cevap', 'eski prompt', now() - interval '31 days'),
    (700100001, t.u('A'), 'chat', 'yeni cevap', 'yeni prompt', now() - interval '1 day'),
    (700100001, t.u('A'), 'chat', 'çok eski cevap', null, now() - interval '181 days');
  insert into public.bot_responses (chat_id, student_id, purpose, response_text, flagged, created_at)
  values (700100001, t.u('A'), 'chat', 'işaretli eski cevap', true, now() - interval '181 days');
  insert into public.memory_facts (student_id, kind, text, source_message_ids, valid_until) values
    (t.u('A'), 'deadline', 'Dünkü teslim.', array[t.v('msg_a_q')::bigint], current_date - 1);
  insert into public.memory_facts (student_id, kind, text, source_message_ids, created_at) values
    (t.u('A'), 'preference', 'Süresiz ve eski olgu.', array[t.v('msg_a_q')::bigint], now() - interval '181 days');
  insert into public.tg_updates (update_id, received_at) values (1, now() - interval '3 days'), (2, now());
  insert into public.quota_usage (student_id, day, kind, used) values (t.u('A'), current_date - 61, 'message', 3);
  insert into audit.events (at, actor_role, action, table_name) values (now() - interval '731 days', 'test', 'TEST', 'x');
end $$;

-- run_retention (kulaklik retention yedeği gibi batch_worker ile)
do $$
declare
  v_total int;
begin
  perform t.as_batch();
  v_total := public.run_retention();
  perform t.as_admin();
  perform t.ok(v_total > 0, 'run_retention etkilenen toplam > 0 (' || v_total || ')');
  perform t.ok((select count(*) from public.retention_runs rr) = (select count(*) from public.retention_policies rp where rp.enabled)
               and not exists (select 1 from public.retention_runs rr where rr.detail ? 'error'), 'her etkin politika için hatasız retention_runs satırı');
  -- delete / null_columns / expire
  perform t.ok(not exists (select 1 from public.messages m where m.telegram_message_id = 91 and m.chat_id = 700100001)
               and exists (select 1 from public.messages m where m.telegram_message_id = 89 and m.chat_id = 700100001),
               'messages.hard_delete: 91 günlük mesaj silindi, 89 günlük kaldı');
  perform t.ok((select br.prompt_text from public.bot_responses br where br.response_text = 'eski cevap') is null
               and (select br.prompt_text from public.bot_responses br where br.response_text = 'yeni cevap') = 'yeni prompt',
               'bot_responses.prompt_null: 30 günden eski prompt boşaltıldı');
  perform t.ok(not exists (select 1 from public.bot_responses br where br.response_text = 'çok eski cevap')
               and exists (select 1 from public.bot_responses br where br.response_text = 'işaretli eski cevap'),
               'bot_responses.hard_delete işaretli cevabı korur (flagged = false koşulu)');
  perform t.ok((select f.status from public.memory_facts f where f.text = 'Dünkü teslim.') = 'expired', 'memory_facts.expire: geçerliliği dolan olgu expired');
  perform t.ok((select f.status from public.memory_facts f where f.text = 'Süresiz ve eski olgu.') = 'expired', 'memory_facts.stale: 180 günlük süresiz olgu expired');
  perform t.ok(not exists (select 1 from public.tg_updates u where u.update_id = 1) and exists (select 1 from public.tg_updates u where u.update_id = 2), 'tg_updates.purge 2 gün');
  perform t.ok(not exists (select 1 from public.quota_usage q where q.day = current_date - 61), 'quota_usage.purge 60 gün');
  perform t.ok(not exists (select 1 from audit.events ev where ev.action = 'TEST'), 'audit.events.purge 730 gün');
  -- students.anonymize: secure satırları yok, metin null, olgular silindi, ustalık kalır
  perform t.ok(not exists (select 1 from secure.student_pii sp where sp.student_id = t.u('C'))
               and not exists (select 1 from secure.telegram_identities ti where ti.student_id = t.u('C'))
               and not exists (select 1 from secure.guardian_codes g where g.student_id = t.u('C')),
               'students.anonymize: secure satırları silindi');
  perform t.ok((select m.text_raw is null and m.text_llm is null from public.messages m where m.chat_id = 700100003), 'students.anonymize: mesaj metinleri null');
  perform t.ok(not exists (select 1 from public.memory_facts f where f.student_id = t.u('C')) and not exists (select 1 from public.weekly_summaries w where w.student_id = t.u('C'))
               and (select br.prompt_text from public.bot_responses br where br.student_id = t.u('C')) is null,
               'students.anonymize: olgular ve özetler silindi, prompt boşaltıldı');
  perform t.ok((select bool_and(a.detail = 'Silinmiş öğrenci' and a.status = 'done') from public.instructor_alerts a where a.student_id = t.u('C'))
               and (select count(*) from public.instructor_alerts a where a.student_id = t.u('C')) = 2,
               'students.anonymize: alarm açıklamalarındaki öğrenci metni silindi, alarmlar kapandı');
  perform t.ok((select rr.query = '' and cardinality(rr.expanded_queries) = 0 from public.research_requests rr where rr.student_id = t.u('C')),
               'students.anonymize: araştırma sorgusu boşaltıldı');
  perform t.ok((select m.p from public.mastery m join public.enrollments e on e.id = m.enrollment_id where e.student_id = t.u('C')) = 0.55
               and (select s.public_ref from public.students s where s.id = t.u('C')) = 's_cccccccccccc', 'students.anonymize: ustalık rastgele kimlikle kalır (ADR-0004)');
  -- lessons.video → ops alarmı (gerçek silme ders purge + confirm_video_deleted)
  perform t.ok((select count(*) from public.instructor_alerts a where a.kind = 'ops' and a.ref ->> 'lesson_id' = t.v('lesson_video')
                  and a.detail like 'Ders videosu silinmeyi bekliyor:%') = 1
               and (select l.video_ref from public.lessons l where l.id = t.u('lesson_video')) is not null,
               'lessons.video: ops alarmı açıldı, video satırı (Storage dışı) değişmedi');
  -- lessons.transcript → storage_deletions kuyruğu, transcript_path null
  perform t.ok((select count(*) from public.storage_deletions sd where sd.bucket = 'transcripts' and sd.path = 'eski-ders.jsonl') = 1
               and not exists (select 1 from public.lessons l where l.enrollment_id = t.u('ED') and l.transcript_path is not null),
               'lessons.transcript: storage_deletions 1 satır, transcript_path null');
  -- enrollments.learning_data → quote null, chosen '{}', mastery değişmez
  perform t.ok((select o.quote from public.observations o where o.enrollment_id = t.u('ED')) is null
               and (select a.chosen from public.attempts a where a.enrollment_id = t.u('ED')) = '{}'::jsonb
               and (select m.evidence_count from public.mastery m where m.enrollment_id = t.u('ED')) = 1,
               'enrollments.learning_data: kanıt alıntısı ve seçim anonimleşti, mastery kaldı');
  -- enrollments.closed_cleanup → memory_facts 0
  perform t.ok(not exists (select 1 from public.memory_facts f where f.student_id = t.u('D')), 'enrollments.closed_cleanup: kapalı kaydın olguları silindi');
  -- ikinci çalıştırma idempotent (kimlik verisi zaten yok)
  perform t.as_bot(null);
  perform public.run_retention();
  perform t.as_admin();
  perform t.ok((select rr.affected_rows from public.retention_runs rr where rr.policy_id = 'students.anonymize' order by rr.id desc limit 1) = 0, 'anonimleştirme tekrar çalıştırmada 0');
end $$;

-- Video silindi kaydı: öğrenci ve veli için iki bildirim; ops alarmı kapanır
do $$
begin
  perform t.as_batch();
  perform public.confirm_video_deleted(t.u('lesson_video'));
  perform t.as_admin();
  perform t.ok((select count(*) from public.proactive_messages pm where pm.template_id = 'video_deleted' and pm.params ->> 'lesson_id' = t.v('lesson_video')) = 2
               and (select l.video_deleted_at is not null from public.lessons l where l.id = t.u('lesson_video')), 'confirm_video_deleted: öğrenci + veli bildirimi');
  perform t.ok((select a.status from public.instructor_alerts a where a.ref ->> 'lesson_id' = t.v('lesson_video') and a.detail like 'Ders videosu%') = 'done', 'video alarmı kapandı');
end $$;

-- 'storage_pressure shortens messages retention'
do $$
declare
  v_mb int;
begin
  update public.tg_chats c set recording_notice_days = 90 where c.chat_id = -100900100;
  insert into public.table_sizes_daily (day, table_name, total_bytes) values ((now() at time zone 'Europe/Istanbul')::date, 'test.sahte_boyut', 460 * 1024 * 1024);
  perform t.as_batch();
  v_mb := public.compute_table_sizes();
  perform t.as_admin();
  perform t.ok(v_mb > 450, 'compute_table_sizes toplam > 450 MB (sahte boyutla): ' || v_mb);
  perform t.ok((select rf.value = 'true'::jsonb from public.runtime_flags rf where rf.key = 'storage_pressure'), 'storage_pressure = true');
  perform t.ok((select bool_and(c.retention_days = 60) from public.tg_chats c), 'tg_chats.retention_days = 60');
  perform t.ok((select c.recording_notice_days from public.tg_chats c where c.chat_id = -100900100) = 90, 'recording_notice_days değişmez (yeniden gönderim Worker''ın işi)');
  perform t.ok(exists (select 1 from public.instructor_alerts a where a.kind = 'ops' and a.detail like 'Veritabanı boyutu 350 MB%'), '350 MB ops uyarısı');
  perform t.ok((select count(*) from public.table_sizes_daily t2 where t2.table_name = 'public.messages') = 1, 'gerçek tablo boyutları kaydedildi');
  insert into public.messages (chat_id, telegram_message_id, sender_role, student_id, text_llm, sent_at)
  values (-100900100, 99, 'student', t.u('A'), 'yeni', now());
  perform t.ok((select m.expires_at - m.sent_at from public.messages m where m.chat_id = -100900100 and m.telegram_message_id = 99) = interval '60 days',
               'yeni mesajlar 60 gün saklanır');
  -- storage_pressure: prompt 14 gün, olgu tavanı 200
  insert into public.bot_responses (chat_id, student_id, purpose, response_text, prompt_text, created_at)
  values (700100001, t.u('A'), 'chat', '15 günlük cevap', '15 günlük prompt', now() - interval '15 days');
  perform t.as_batch();
  perform public.run_retention();
  perform t.as_admin();
  perform t.ok((select br.prompt_text from public.bot_responses br where br.response_text = '15 günlük cevap') is null, 'storage_pressure: prompt 14 gün');
  insert into public.memory_facts (student_id, kind, text, source_message_ids, created_at)
  select t.u('B'), 'other', 'olgu ' || g, array[1::bigint], now() - make_interval(mins => g) from generate_series(1, 205) g;
  perform t.as_batch();
  perform t.ok(public.cap_memory_facts() = 5, 'cap_memory_facts: storage_pressure iken tavan 200 (5 olgu merged)');
  perform t.as_admin();
  perform t.ok((select count(*) from public.memory_facts f where f.student_id = t.u('B') and f.status = 'active') = 200
               and (select f.status from public.memory_facts f where f.text = 'olgu 205') = 'merged', 'en eski olgular merged');
end $$;

-- /sil: request_deletion → deleted + koordinatöre yükseltme; erase_student hemen anonimleştirir
do $$
begin
  perform t.as_bot(t.u('B'));
  perform public.request_deletion();
  perform t.as_admin();
  perform t.ok((select s.status = 'deleted' and s.deleted_at is not null from public.students s where s.id = t.u('B')), 'request_deletion: students deleted');
  perform t.ok((select e.target_staff_id from public.escalations e where e.student_id = t.u('B') and e.reason = 'deletion_request') = t.u('coord'),
               'silme talebi koordinatöre yükseltildi');
  perform t.as_staff(t.u('inst_b'));
  perform t.raises(format('select public.erase_student(%L)', t.u('B')), 'OGR-AUTH-002%', 'erase_student yalnız koordinatör');
  perform t.as_staff(t.u('coord'));
  perform t.ok(public.erase_student(t.u('B')) = 1, 'erase_student hemen anonimleştirir');
  perform t.as_admin();
  perform t.ok(not exists (select 1 from secure.student_pii sp where sp.student_id = t.u('B'))
               and (select e.status from public.escalations e where e.student_id = t.u('B') and e.reason = 'deletion_request') = 'answered',
               'secure satırları silindi, silme talebi kapandı');
end $$;

-- Saklama işleri uygulama rollerinde; panel rolü çağıramaz
do $$
begin
  perform t.as_staff(t.u('coord'));
  perform t.raises('select public.run_retention()', 'permission denied%', 'authenticated run_retention çağıramaz');
  perform t.claims_only('authenticated', t.u('coord'));
  perform t.raises('select public.run_retention()', 'OGR-AUTH-002%', 'gövde authenticated JWT''sini reddeder');
  perform t.as_admin();
end $$;

rollback;
