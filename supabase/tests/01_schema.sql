-- tests/01_schema.sql — şema, kimlik çözümü, iki müfredat sürümü, ad hash'leri, grup alarmları (BLUEPRINT §3.1–3.5, §3.9)
-- psql değişkenleri: have_content, have_keys (db-test.sh), seed2 (export-sql.py --as-version 2027.1 çıktısı, begin/commit'siz),
-- pii_hash_cases (packages/pii/cases.json hash_cases).
begin;
\ir _fixture.sql

-- Şema: her uygulama tablosunda RLS açık ve zorlanmış; secure/audit PostgREST rollerine kapalı
do $$
declare
  v_bad text;
begin
  select string_agg(n.nspname || '.' || c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'r' and n.nspname in ('public', 'secure', 'audit') and not (c.relrowsecurity and c.relforcerowsecurity);
  perform t.ok(v_bad is null, 'her tablo ENABLE + FORCE RLS (eksik: ' || coalesce(v_bad, '-') || ')');
  perform t.ok(not has_schema_privilege('bot_runtime', 'secure', 'usage') and not has_schema_privilege('batch_worker', 'secure', 'usage')
               and not has_schema_privilege('authenticated', 'secure', 'usage') and not has_schema_privilege('anon', 'secure', 'usage'),
               'secure şemasında uygulama rollerinin USAGE yetkisi yok');
  perform t.ok(not has_schema_privilege('authenticated', 'audit', 'usage'), 'audit şeması PostgREST rollerine kapalı');
  perform t.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 join pg_language l on l.oid = p.prolang
                 where n.nspname = 'public' and p.prosecdef = false and p.prokind = 'f' and l.lanname in ('sql', 'plpgsql')
                   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')) = 0,
               'public şemasındaki tüm RPC''ler SECURITY DEFINER');
end $$;

-- students.public_ref deseni, messages.expires_at tetikleyicisi, default_period
do $$
declare
  v_ref text;
  v_exp interval;
begin
  insert into public.students default values returning public_ref into v_ref;
  perform t.ok(v_ref ~ '^s_[a-z2-7]{12}$', 'public_ref deseni ^s_[a-z2-7]{12}$ (' || v_ref || ')');
  select m.expires_at - m.sent_at into v_exp from public.messages m where m.id = t.v('msg_a_q')::bigint;
  perform t.ok(v_exp = interval '90 days', 'messages.expires_at = sent_at + tg_chats.retention_days (90)');
  perform t.ok((select st.value #>> '{}' from public.settings st where st.key = 'default_period') = 'YKS 2027', 'settings.default_period = YKS 2027');
  perform t.ok((select c.retention_days from public.tg_chats c where c.chat_id = 700100001) = 90
               and (select rp.days from public.retention_policies rp where rp.id = 'messages.hard_delete') = 0,
               'tg_chats.retention_days varsayılanı 90; messages.hard_delete eşiği expires_at (days=0)');
end $$;

-- Ad-token hash'leri: SQL app.pii_name_token_hashes ↔ packages/pii cases.json hash_cases (bayt eşitliği)
insert into t.cfg values ('pii_cases', :'pii_hash_cases');
do $$
declare
  v_case jsonb;
  v_n int := 0;
begin
  for v_case in select x.c from jsonb_array_elements(t.v('pii_cases')::jsonb) as x (c) loop
    perform t.ok(app.pii_name_token_hashes(v_case ->> 'full_name') = array(select jsonb_array_elements_text(v_case -> 'expected')),
                 'pii hash vakası ' || (v_case ->> 'id'));
    v_n := v_n + 1;
  end loop;
  perform t.ok(v_n > 0 or t.v('pii_cases') = '[]', 'pii hash vakaları okundu (' || v_n || ')');
end $$;

-- resolve_telegram: özel sohbette ilk temas öğrenci + kayıt + ad hash'leri yaratır
do $$
declare
  v_r record;
  v_sid uuid;
begin
  perform t.as_bot(null);
  select * into v_r from public.resolve_telegram(700199001, 700199001, 'yeni_ogr', false, true, 'Elif', 'Kaya');
  perform t.as_admin();
  v_sid := v_r.student_id;
  perform t.ok(v_sid is not null and v_r.status = 'pending_consent' and not v_r.consent_ok and v_r.is_minor,
               'resolve_telegram on fresh private chat creates student (pending_consent, is_minor varsayılan true)');
  perform t.ok((select count(*) from secure.student_pii sp where sp.student_id = v_sid and sp.display_name = 'Elif Kaya'
                  and cardinality(sp.name_token_hashes) = 2) = 1, 'secure.student_pii display_name ve 2 ad-token hash''i');
  perform t.ok((select sp.name_token_hashes from secure.student_pii sp where sp.student_id = v_sid) = app.pii_name_token_hashes('Elif Kaya'),
               'name_token_hashes = app.pii_name_token_hashes(ad)');
  perform t.ok((select count(*) from public.preferences p where p.student_id = v_sid) = 1, 'preferences satırı');
  perform t.ok((select count(*) from public.enrollments e join public.curricula c on c.id = e.curriculum_id
                 where e.student_id = v_sid and c.code = 'TYT-MAT' and c.status = 'active' and e.period_label = 'YKS 2027'
                   and e.id = v_r.enrollment_id) = 1, 'kayıt aktif TYT-MAT müfredatında, period_label = YKS 2027');
  perform t.ok((select count(*) from public.chat_roles cr where cr.chat_id = 700199001 and cr.student_id = v_sid and cr.role = 'student') = 1,
               'chat_roles öğrenci satırı');
  perform t.ok(exists (select 1 from secure.telegram_identities ti where ti.telegram_user_id = 700199001 and ti.student_id = v_sid),
               'secure.telegram_identities eşlemesi');
end $$;

-- p_create=false: bilinmeyen kullanıcı için satır yaratılmaz, öğrenci sütunları null döner
do $$
declare
  v_before int := (select count(*) from public.students);
  v_r record;
begin
  perform t.as_bot(null);
  select * into v_r from public.resolve_telegram(700199002, 700199002, 'veli_x', false, false, 'Veli', 'Kişi');
  perform t.as_admin();
  perform t.ok(v_r.student_id is null and v_r.public_ref is null and v_r.enrollment_id is null and v_r.consent_ok = false,
               'p_create=false → dönüş öğrenci sütunları null');
  perform t.ok((select count(*) from public.students) = v_before, 'p_create=false → students sayısı değişmez');
  perform t.ok(not exists (select 1 from secure.telegram_identities ti where ti.telegram_user_id = 700199002), 'p_create=false → kimlik satırı yok');
end $$;

-- Aktif müfredat yoksa ilk /start açık hata verir (OGR-ENR-001); yalnız bot_runtime çağırabilir
do $$
begin
  begin
    update public.curricula c set status = 'retired' where c.status = 'active';
    perform t.as_bot(null);
    perform public.resolve_telegram(700199003, 700199003, 'x', false, true, 'Ali', 'Veli');
    raise exception 'FAIL: aktif müfredat yokken OGR-ENR-001 bekleniyordu';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    perform t.ok(sqlerrm like 'OGR-ENR-001%', 'resolve_telegram without active curriculum raises OGR-ENR-001');
  end;
  perform t.as_admin();
  perform t.ok((select count(*) from public.curricula c where c.status = 'active') >= 1, 'aktif müfredat geri geldi (alt işlem geri alındı)');
  perform t.claims_only('authenticated', t.u('coord'));
  perform t.raises('select * from public.resolve_telegram(1, 1, null, false, true)', 'OGR-AUTH-001%', 'resolve_telegram yalnız bot_runtime');
  perform t.as_admin();
end $$;

-- Bağlı eğitmen: link_staff_telegram sonrası grupta çağrı → chat_roles.role='instructor', mention_handle; staff_id döner
do $$
declare
  v_r record;
begin
  perform t.as_staff(t.u('coord'));
  perform public.link_staff_telegram(t.u('inst_b'), 555100002, 'burak_hoca', null);
  perform t.as_bot(null);
  select * into v_r from public.resolve_telegram(555100002, -100900100, 'burak_hoca', true, false);
  perform t.as_admin();
  perform t.ok(v_r.staff_id = t.u('inst_b') and v_r.student_id is null and v_r.role_in_chat = 'instructor',
               'resolve_telegram for linked staff returns staff_id and role_in_chat=instructor');
  perform t.ok((select cr.role = 'instructor' and cr.mention_handle = '@burak_hoca' and cr.staff_id = t.u('inst_b')
                  from public.chat_roles cr where cr.chat_id = -100900100 and cr.telegram_user_id = 555100002),
               'resolve_telegram for linked staff writes chat_roles.role and mention_handle');
  perform t.ok((select count(*) from public.students s join secure.telegram_identities ti on ti.student_id = s.id
                 where ti.telegram_user_id = 555100002) = 0, 'eğitmen öğrenci olarak yaratılmadı');
end $$;

-- Ad hash'leri sohbet üyelerinden (öğrenci + personel) tek çağrıda; düz ad dönmez
do $$
declare
  v_h text[];
begin
  perform t.as_bot(null);
  v_h := public.name_token_hashes(-100900100);
  perform t.as_admin();
  perform t.ok(app.pii_name_token_hashes('Elif Kaya') <@ v_h and app.pii_name_token_hashes('Can Demir') <@ v_h
               and app.pii_name_token_hashes('Ayşe Hoca') <@ v_h, 'name_token_hashes(grup) öğrenci ve personel hash''lerini birleştirir');
  perform t.ok(not exists (select 1 from unnest(v_h) h where h !~ '^[0-9a-f]{64}$'), 'name_token_hashes yalnız sha256 hex döner');
  perform t.claims_only('authenticated', t.u('coord'));
  perform t.ok(cardinality(public.name_token_hashes(-100900100)) = 0, 'name_token_hashes bot_runtime dışında boş');
  perform t.as_admin();
end $$;

-- 'two ops alerts for two chats': iki grup, ikisinde de bot yönetici değil → iki ayrı ops alarmı (unique_violation yok)
do $$
declare
  v_n int;
begin
  insert into public.tg_chats (chat_id, kind, title, privacy_mode_off_verified) values
    (-100900201, 'group', 'Grup 1', true), (-100900202, 'group', 'Grup 2', true);
  update public.tg_chats c set privacy_mode_off_verified = true where c.chat_id = -100900100;
  perform t.as_bot(null);
  perform public.cron_open_alerts();
  perform public.cron_open_alerts();   -- ikinci çalıştırma çoğaltmaz
  perform t.as_admin();
  select count(*) into v_n from public.instructor_alerts a
   where a.kind = 'ops' and a.status = 'open' and a.ref ->> 'chat_id' in ('-100900201', '-100900202')
     and a.detail like 'Bot grupta yönetici değil%';
  perform t.ok(v_n = 2, 'two ops alerts for two chats (' || v_n || ')');
  update public.tg_chats c set bot_is_admin = true where c.chat_id = -100900201;
  perform t.as_bot(null);
  perform public.cron_open_alerts();
  perform t.as_admin();
  perform t.ok((select a.status from public.instructor_alerts a where a.kind = 'ops' and a.ref ->> 'chat_id' = '-100900201'
                  and a.detail like 'Bot grupta yönetici değil%') = 'done', 'bot yönetici olunca ops alarmı done');
end $$;

-- 'response' alarmı: iki eğitmenin yanıt medyanı hedefin üstünde → iki ayrı alarm (ref.staff_id ile), detail'de ad yok
do $$
declare
  v_n int;
begin
  insert into public.escalations (chat_id, student_id, reason, status, created_at, answered_at, answered_by) values
    (700100001, t.u('A'), 'bot_unsure', 'answered', now() - interval '2 days', now() - interval '2 days' + interval '5 hours', t.u('inst_a')),
    (700100002, t.u('B'), 'bot_unsure', 'answered', now() - interval '2 days', now() - interval '2 days' + interval '7 hours', t.u('inst_b'));
  perform t.as_batch();
  perform public.cron_open_alerts();
  perform public.cron_open_alerts();   -- ikinci çalıştırma çoğaltmaz
  perform t.ok((select count(*) from public.instructor_alerts a where a.kind = 'response' and a.status = 'open'
                  and a.staff_id in (t.u('inst_a'), t.u('inst_b'))) = 2, 'iki eğitmen için iki response alarmı (tekilleştirme personel başına)');
  perform t.as_admin();
  select count(*) into v_n from public.instructor_alerts a
    join public.staff st on st.id = a.staff_id
   where a.kind = 'response' and position(st.full_name in a.detail) > 0;
  perform t.ok(v_n = 0, 'response alarmı detail''inde personel adı yok (batch_worker okur)');
  perform t.ok((select a.detail from public.instructor_alerts a where a.kind = 'response' and a.staff_id = t.u('inst_a'))
               = 'Yanıt süresi medyanı hedefin üstünde: 5,0 saat (hedef 2 saat)', 'response detail biçimi');
  perform t.as_admin();
end $$;

-- Grup akışı: bağlı eğitmenin reply yanıtı mark_answered; otomatik yanıt varsayılan kapalı, açılınca soru döner
do $$
declare
  v_n int;
  v_rows int;
begin
  insert into public.messages (chat_id, telegram_message_id, sender_role, student_id, text_raw, text_llm, is_question, sent_at)
  values (-100900100, 41, 'student', t.u('A'), 'Bu soru nasıl çözülür?', 'Bu soru nasıl çözülür?', true, now() - interval '40 minutes');
  perform t.as_bot(null);
  select count(*) into v_rows from public.cron_group_auto_answer();
  perform t.ok(v_rows = 0, 'group_auto_answer_min=0 (varsayılan kapalı) → cron_group_auto_answer satır döndürmez');
  perform t.as_admin();
  update public.tg_chats c set group_auto_answer_min = 15 where c.chat_id = -100900100;
  perform t.as_bot(null);
  select count(*) into v_rows from public.cron_group_auto_answer() g where g.chat_id = -100900100 and g.telegram_message_id = 41;
  perform t.ok(v_rows = 1, 'group-auto-answer-on: 15 dk eğitmen yanıtı olmayan soru döner');
  select count(*) into v_rows from public.cron_group_auto_answer() g where g.telegram_message_id = 31;
  perform t.ok(v_rows = 0, 'eğitmenin reply_to ile yanıtladığı soru dönmez');
  v_n := public.mark_answered(-100900100, 41, 555100001);
  perform t.as_admin();
  perform t.ok(v_n >= 1 and (select m.answered_at is not null from public.messages m where m.chat_id = -100900100 and m.telegram_message_id = 41),
               'mark_answered (bağlı eğitmen) messages.answered_at yazar');
  perform t.as_bot(null);
  perform t.ok(public.mark_answered(-100900100, 32, 700100001) = 0, 'mark_answered öğrenci reply''ı için etkisiz');
  perform t.as_admin();
end $$;

-- Proaktif: yarın teslim olgusu → exam_tomorrow (aktif saatte, günde bir); veli satırı veli kaydı yoksa skipped
do $$
declare
  v_now timestamptz := date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' + interval '19 hours';
  v_rows int;
begin
  insert into public.memory_facts (student_id, kind, text, source_message_ids, valid_until)
  values (t.u('A'), 'deadline', 'Öğrencinin yarın deneme sınavı var.', array[t.v('msg_a_q')::bigint],
          (v_now at time zone 'Europe/Istanbul')::date + 1);
  insert into public.proactive_messages (student_id, chat_id, recipient, template_id, scheduled_for)
  values (t.u('A'), null, 'guardian', 'video_deleted', v_now - interval '1 hour');
  perform t.as_bot(null);
  select count(*) into v_rows from public.cron_due_proactive(v_now) d where d.student_id = t.u('A') and d.template_id = 'exam_tomorrow';
  perform t.ok(v_rows = 1, 'cron_due_proactive exam_tomorrow satırı (aktif saat 19)');
  select count(*) into v_rows from public.cron_due_proactive(v_now - interval '10 hours') d where d.template_id = 'exam_tomorrow';
  perform t.ok(v_rows = 0, 'aktif saat dışında (09:00) dönmez');
  perform t.as_admin();
  perform t.ok((select pm.status from public.proactive_messages pm where pm.student_id = t.u('A') and pm.recipient = 'guardian') = 'skipped',
               'veli kaydı yoksa guardian satırı skipped');
end $$;

-- Bot yardımcı RPC'leri: dedup, yaş beyanı, oturum bekleme, eğitmen kodu, yükseltme → alarm → panelden kapatma
do $$
declare
  v_code text;
  v_esc uuid;
  v_alert uuid;
begin
  perform t.as_bot(null);
  perform t.ok(public.dedup_update(990001) and not public.dedup_update(990001), 'dedup_update ilk kez true, tekrar false');
  perform t.as_bot(t.u('B'));
  perform t.ok(public.set_birth_year((extract(year from current_date)::int - 19)::smallint) = false, 'set_birth_year 19 yaş → reşit');
  perform t.ok(public.set_birth_year((extract(year from current_date)::int - 15)::smallint) = true, 'set_birth_year 15 yaş → reşit değil');
  perform t.raises('select public.set_birth_year(1900::smallint)', 'OGR-PII-002%', 'set_birth_year 1900 → OGR-PII-002');
  perform t.raises(format('select public.set_birth_year(%s::smallint)', extract(year from current_date)::int + 1), 'OGR-PII-002%',
                   'set_birth_year gelecek yıl → OGR-PII-002');
  perform t.as_admin();
  update public.students s set is_minor = false where s.id = t.u('B');
  perform t.as_batch();
  perform t.ok(public.recompute_is_minor() >= 1, 'recompute_is_minor doğum yılından düzeltir');
  perform t.as_admin();
  perform t.ok((select s.is_minor from public.students s where s.id = t.u('B')), 'B yeniden reşit değil');
  insert into public.sessions (student_id, chat_id, state, direct_once, hint_level, last_activity_at)
  values (t.u('A'), 700100001, 'awaiting_answer', true, 2, now() - interval '7 hours');
  perform t.as_bot(null);
  perform t.ok(public.cron_idle_sessions() = 1, 'cron_idle_sessions 6 saatlik hareketsizlik');
  perform t.as_admin();
  perform t.ok((select se.state = 'idle' and not se.direct_once and se.hint_level = 0 from public.sessions se where se.student_id = t.u('A')), 'oturum idle, direct_once sıfır');
  -- eğitmen kodu: koordinatör üretir, eğitmen kendi Telegram'ından kullanır
  perform t.as_staff(t.u('coord'));
  v_code := public.mint_staff_code(t.u('inst_b'));
  perform t.as_bot(null);
  perform t.ok(not public.redeem_staff_code('YANLIS12', 555100009, 'x'), 'yanlış eğitmen kodu false');
  perform t.ok(public.redeem_staff_code(v_code, 555100009, 'burak_h'), 'redeem_staff_code doğru kod');
  perform t.ok(not public.redeem_staff_code(v_code, 555100009, 'burak_h'), 'eğitmen kodu tek kullanımlık');
  perform t.as_admin();
  perform t.ok((select ti.staff_id = t.u('inst_b') and ti.mention_handle = '@burak_h' from secure.telegram_identities ti where ti.telegram_user_id = 555100009),
               'eğitmen Telegram kimliği bağlandı (@kullanıcı)');
  -- yükseltme: hedef sohbetteki eğitmen; 6 saat sonra cevapsız alarmı; panelden resolve_alert kapatır
  perform t.as_bot(t.u('A'));
  v_esc := public.open_escalation(-100900100, t.v('msg_group_a')::bigint, 'human_requested', 'Hocam ödev ne zaman?');
  perform t.as_admin();
  perform t.ok((select e.target_staff_id from public.escalations e where e.id = v_esc) = t.u('inst_a'), 'open_escalation hedefi gruptaki eğitmen');
  update public.escalations e set created_at = now() - interval '7 hours' where e.id = v_esc;
  perform t.as_batch();
  perform public.cron_open_alerts();
  perform t.as_admin();
  select a.id into v_alert from public.instructor_alerts a where a.ref ->> 'escalation_id' = v_esc::text and a.status = 'open';
  perform t.ok(v_alert is not null and (select a.severity from public.instructor_alerts a where a.id = v_alert) = 'warning', '6 saatlik açık yükseltme → unanswered warning');
  perform t.ok(exists (select 1 from public.instructor_alerts a where a.kind = 'unanswered' and a.ref ->> 'message_id' = t.v('msg_a_q')) is false,
               '2 saatlik soru henüz alarm değil');
  perform t.as_staff(t.u('obs'));
  perform t.raises(format('select public.resolve_alert(%L)', v_alert), 'OGR-AUTH-002%', 'gözlemci alarm kapatamaz');
  perform t.as_staff(t.u('inst_a'));
  perform public.resolve_alert(v_alert);
  perform t.as_admin();
  perform t.ok((select e.status = 'answered' and e.answered_by = t.u('inst_a') from public.escalations e where e.id = v_esc)
               and (select a.status from public.instructor_alerts a where a.id = v_alert) = 'done', 'resolve_alert yükseltmeyi answered, alarmı done yapar');
end $$;

-- İki sürüm aynı kazanım kimliği: 2027.1 seed'i uygulanır; eski kaydın ustalığı ve aktif sürüm değişmez
\if :have_content
do $$
begin
  perform t.as_staff(t.u('inst_a'));
  perform public.add_instructor_note(t.u('EA'), 'tyt.mat.temel.rasyonel-sayilar', 'Ortak paydada zorlanıyor.', 0.45, false);
  perform t.as_admin();
  insert into t.cfg select 'p_before', m.p::text from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 'tyt.mat.temel.rasyonel-sayilar';
end $$;
\i :seed2
do $$
declare
  v_old uuid := t.u('cur');
  v_new uuid := (select c.id from public.curricula c where c.code = 'TYT-MAT' and c.version = '2027.1');
begin
  perform t.ok(v_new is not null and (select c.status from public.curricula c where c.id = v_new) = 'draft', 'iki sürüm: TYT-MAT@2027.1 taslak olarak eklendi');
  perform t.ok((select array_agg(s.id order by s.id) from public.skills s where s.curriculum_id = v_old)
               = (select array_agg(s.id order by s.id) from public.skills s where s.curriculum_id = v_new),
               'iki sürüm aynı skill id kümesi (bileşik anahtar)');
  perform t.ok((select m.p::text = t.v('p_before') and m.curriculum_id = v_old from public.mastery m
                 where m.enrollment_id = t.u('EA') and m.skill_id = 'tyt.mat.temel.rasyonel-sayilar'),
               'eski sürümün mastery satırı değişmedi');
  perform t.ok((select c.status from public.curricula c where c.id = v_old) = 'active', 'eski sürüm hâlâ aktif');
  perform t.ok((select count(*) from public.misconception_tags mt where mt.curriculum_id = v_new) = 0, 'etiketler ilk sürümde kalır (on conflict do nothing)');
end $$;
\else
\echo 'SKIP: no content — iki sürüm aynı skill id'
\endif

rollback;
