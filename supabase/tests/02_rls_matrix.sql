-- tests/02_rls_matrix.sql — RLS + GRANT birlikte (BLUEPRINT §3.8): sütun düzeyi ham metin yalıtımı, görünümler,
-- panel RPC'lerinin bot/batch rolünde reddi (OGR-AUTH-002), tek yönlü kill-switch, bot'un courses'a erişimsizliği.
begin;
\ir _fixture.sql

-- Ham mesaj metni: gözlemci tablodan text_raw okuyamaz, görünüm ona 0 satır; eğitmen yalnız atanan öğrenciyi görür
do $$
declare
  v_n int;
begin
  perform t.as_staff(t.u('obs'));
  perform t.raises('select text_raw from public.messages', 'permission denied%', 'observer selects text_raw → permission denied');
  perform t.ok((select count(*) from public.v_messages_staff) = 0, 'gözlemciye v_messages_staff 0 satır');
  perform t.ok((select count(*) from public.messages m where m.student_id = t.u('A')) > 0
               and (select count(*) from public.messages m where m.student_id = t.u('B')) = 0,
               'gözlemci messages(text_llm) yalnız atanan öğrenci (A)');
  perform t.as_staff(t.u('inst_a'));
  perform t.raises('select text_raw from public.messages', 'permission denied%', 'eğitmen de tablodan text_raw okuyamaz');
  select count(*) into v_n from public.v_messages_staff v where v.student_id = t.u('A') and v.text_raw is not null;
  perform t.ok(v_n >= 2, 'eğitmen atanan öğrencinin ham metnini görünümden okur (' || v_n || ')');
  perform t.ok((select count(*) from public.v_messages_staff v where v.student_id = t.u('B')) = 0, 'atanmayan öğrencinin (B) ham metni gelmez');
  perform t.as_staff(t.u('coord'));
  perform t.ok((select count(*) from public.v_messages_staff v where v.student_id in (t.u('A'), t.u('B'))) >= 4, 'koordinatör tüm ham metni görür');
  perform t.as_bot(t.u('A'));
  perform t.raises('select text_raw from public.messages', 'permission denied%', 'bot_runtime text_raw okuyamaz');
  perform t.raises('select * from public.v_messages_staff', 'permission denied%', 'bot_runtime v_messages_staff okuyamaz');
  perform t.as_batch();
  perform t.raises('select text_raw from public.messages', 'permission denied%', 'batch_worker text_raw okuyamaz');
  perform t.ok((select count(*) from public.messages) >= 6, 'batch_worker text_llm sütunlarını okur');
  perform t.as_admin();
end $$;

-- Sınav arşivi: ocr_text yalnız E/K ve yalnız v_exam_items_full; gözlemciye 0 satır; öğrenci/bot hiç
do $$
begin
  perform t.as_staff(t.u('inst_a'));
  perform t.raises('select ocr_text from public.exam_items', 'permission denied%', 'select ocr_text from exam_items → permission denied (eğitmen)');
  perform t.ok((select count(*) from public.v_exam_items_full v where v.ocr_text like 'ARŞİV%') = 1, 'eğitmen ocr_text''i v_exam_items_full''dan okur');
  perform t.as_staff(t.u('obs'));
  perform t.raises('select ocr_text from public.exam_items', 'permission denied%', 'select ocr_text from exam_items → permission denied (gözlemci)');
  perform t.ok((select count(*) from public.v_exam_items_full) = 0, 'gözlemciye v_exam_items_full 0 satır');
  perform t.ok((select count(*) from public.exam_items e where e.source_id = '30000000-0000-4000-8000-0000000000e1') = 1, 'gözlemci exam_items meta sütunlarını okur');
  perform t.as_bot(t.u('A'));
  perform t.raises('select id from public.exam_items', 'permission denied%', 'bot_runtime exam_items okuyamaz');
  perform t.as_admin();
end $$;

-- bot_runtime courses'u okuyamaz; priority_plan_for_enrollment yalnız kendi kaydı için planı döner
do $$
declare
  v_plan jsonb;
begin
  perform t.as_bot(t.u('A'));
  perform t.raises('select * from public.courses', 'permission denied%', 'bot_runtime reads courses → permission denied');
  v_plan := public.priority_plan_for_enrollment(t.u('EA'));
  perform t.ok(v_plan ->> 'course_code' = 'TST-MAT' and (v_plan ->> 'years_total')::int = 3 and jsonb_array_length(v_plan -> 'rows') = 5
               and (v_plan -> 'rows' -> 0 ->> 'rank')::int = 1,
               'bot_runtime reads priority_plan_for_enrollment (ilk 5 satır, sıralı)');
  perform t.ok(v_plan::text not like '%ARŞİV%', 'plan çıktısında ham soru metni yok');
  perform t.raises(format('select public.priority_plan_for_enrollment(%L)', t.u('EB')), 'OGR-AUTH-004%', 'başka öğrencinin kaydı için OGR-AUTH-004');
  -- §3.8 S: onaylı VE courses.curriculum_id = kaydın curriculum_id'si. Başka müfredatın onaylı planı görünmez.
  perform t.as_admin();
  insert into public.curricula (id, code, authority, year, version, label, status) values
    ('30000000-0000-4000-8000-0000000000f0', 'AYT-MAT', 'ÖSYM', 2026, '2026.1', 'AYT Matematik (test)', 'draft');
  insert into public.courses (id, code, curriculum_id, title, instructor_alias) values
    ('30000000-0000-4000-8000-0000000000c9', 'TST-AYT', '30000000-0000-4000-8000-0000000000f0', 'Test AYT', 'hoca-B');
  insert into public.exam_priority_plans (id, course_id, period, plan, evidence_count, status, approved_at)
  select '30000000-0000-4000-8000-0000000000ab', '30000000-0000-4000-8000-0000000000c9', p.period, p.plan, p.evidence_count, 'approved', now()
    from public.exam_priority_plans p where p.id = '30000000-0000-4000-8000-0000000000aa';
  perform t.as_bot(t.u('B'));
  perform t.ok(exists (select 1 from public.exam_priority_plans p where p.id = '30000000-0000-4000-8000-0000000000aa')
               and not exists (select 1 from public.exam_priority_plans p where p.id = '30000000-0000-4000-8000-0000000000ab')
               and (select count(*) from public.exam_priority_plans p where p.status = 'approved'
                      and p.course_id in ('30000000-0000-4000-8000-0000000000c0', '30000000-0000-4000-8000-0000000000c9')) = 1,
               'bot (S, B öğrencisi) yalnız kendi müfredatının onaylı planını tablodan görür (AYT planı görünmez)');
  perform t.as_bot(null);
  perform t.ok((select count(*) from public.exam_priority_plans p where p.status = 'approved'
                  and p.id in ('30000000-0000-4000-8000-0000000000aa', '30000000-0000-4000-8000-0000000000ab')) = 2,
               'başlıksız bot (B bağlamı) tüm onaylı planları görür');
  perform t.as_admin();
end $$;

-- Panel RPC'leri: bot/batch rolünde yetki yok (permission denied) ve GÖVDE de reddeder (OGR-AUTH-002)
do $$
declare
  v_calls text[] := array[
    format('select public.update_student_pii(%L, %L)', t.u('A'), '{"school":"X Lisesi"}'),
    format('select public.link_staff_telegram(%L, 1, %L, null)', t.u('inst_a'), 'x'),
    format('select public.mint_staff_code(%L)', t.u('inst_a')),
    format('select public.approve_priority_plan(%L, %L)', '30000000-0000-4000-8000-0000000000aa', 'retired'),
    format('select public.resolve_alert(%L)', gen_random_uuid()),
    format('select public.record_staff_consent(%L, %L, %L, %L)', t.u('A'), 'veli_onayi', 'paper', '{"form_no":"1"}')];
  v_sql text;
begin
  foreach v_sql in array v_calls loop
    perform t.as_bot(t.u('A'));
    perform t.raises(v_sql, 'permission denied%', 'bot_runtime: ' || split_part(split_part(v_sql, '(', 1), '.', 2) || ' yetkisiz');
    perform t.as_batch();
    perform t.raises(v_sql, 'permission denied%', 'batch_worker: ' || split_part(split_part(v_sql, '(', 1), '.', 2) || ' yetkisiz');
    perform t.claims_only('bot_runtime');
    perform t.raises(v_sql, 'OGR-AUTH-002%', 'gövde bot_runtime JWT''sini reddeder: ' || split_part(split_part(v_sql, '(', 1), '.', 2));
    perform t.claims_only('batch_worker');
    perform t.raises(v_sql, 'OGR-AUTH-002%', 'gövde batch_worker JWT''sini reddeder: ' || split_part(split_part(v_sql, '(', 1), '.', 2));
  end loop;
  perform t.as_staff(t.u('obs'));
  perform t.raises(format('select public.update_student_pii(%L, %L)', t.u('A'), '{"school":"X"}'), 'OGR-AUTH-002%', 'gözlemci JWT ile update_student_pii → OGR-AUTH-002');
  perform t.as_staff(t.u('inst_a'));
  perform t.raises(format('select public.update_student_pii(%L, %L)', t.u('B'), '{"school":"X"}'), 'OGR-AUTH-002%', 'eğitmen atanmayan öğrenciyi düzenleyemez');
  perform t.raises(format('select public.update_student_pii(%L, %L)', t.u('A'), '{"birth_year":2000}'), 'OGR-PII-001%', 'izinli olmayan alan OGR-PII-001');
  perform public.update_student_pii(t.u('A'), '{"school":"Kadıköy Anadolu Lisesi"}');
  perform t.raises(format('select public.link_staff_telegram(%L, 1, %L, null)', t.u('inst_a'), 'x'), 'OGR-AUTH-002%', 'link_staff_telegram yalnız koordinatör');
  perform t.ok(public.record_staff_consent(t.u('A'), 'ders_kaydi', 'paper', '{"form_no":"F-1"}') is not null, 'eğitmen atanan öğrenci için kâğıt onay girer');
  perform t.raises(format('select public.record_staff_consent(%L, %L, %L, %L)', t.u('A'), 'veli_onayi', 'telegram_button', '{}'),
                   'OGR-CONS-004%', 'record_staff_consent yöntemi paper|panel');
  perform t.as_admin();
  perform t.ok((select sp.school from secure.student_pii sp where sp.student_id = t.u('A')) = 'Kadıköy Anadolu Lisesi', 'update_student_pii yazdı');
end $$;

-- 'batch_worker can set paid_llm_enabled=false but not true'
do $$
begin
  perform t.as_batch();
  perform public.set_runtime_flag('paid_llm_enabled', 'false');
  perform t.as_admin();
  perform t.ok((select rf.value = 'false'::jsonb from public.runtime_flags rf where rf.key = 'paid_llm_enabled'), 'batch_worker paid_llm_enabled=false yazdı');
  perform t.as_batch();
  perform t.raises('select public.set_runtime_flag(''paid_llm_enabled'', ''true'')', 'OGR-AUTH-003%', 'batch_worker paid_llm_enabled=true → OGR-AUTH-003');
  perform t.raises('select public.set_runtime_flag(''daily_cap_usd'', ''5'')', 'OGR-AUTH-003%', 'batch_worker daily_cap_usd → OGR-AUTH-003');
  perform public.set_runtime_flag('facts_lag_days', '1');
  perform t.as_bot(null);
  perform t.raises('select public.set_runtime_flag(''paid_llm_enabled'', ''false'')', 'OGR-AUTH-003%', 'bot_runtime kill-switch kullanamaz');
  perform public.set_runtime_flag('degraded_mode', 'true');
  perform t.as_staff(t.u('inst_a'));
  perform t.raises('select public.set_runtime_flag(''paid_llm_enabled'', ''true'')', 'OGR-AUTH-002%', 'eğitmen bayrak yazamaz');
  perform t.as_staff(t.u('coord'));
  perform public.set_runtime_flag('paid_llm_enabled', 'true');
  perform t.as_admin();
  perform t.ok((select rf.value = 'true'::jsonb from public.runtime_flags rf where rf.key = 'paid_llm_enabled'), 'true''ya dönüş koordinatörün işi');
end $$;

-- Onay: bot consents'e doğrudan yazamaz; yalnız kendi beyanı (record_student_consent) ve kanıtla
do $$
declare
  v_lt uuid := (select lt.id from public.legal_texts lt where lt.kind = 'kvkk_aydinlatma' order by lt.effective_from desc limit 1);
  v_vo uuid := (select lt.id from public.legal_texts lt where lt.kind = 'veli_onayi' order by lt.effective_from desc limit 1);
begin
  perform t.as_bot(t.u('B'));
  perform t.raises(format('insert into public.consents (student_id, kind, legal_text_id, method, given_by) values (%L, %L, %L, %L, %L)',
                          t.u('B'), 'veli_onayi', v_vo, 'telegram_button', 'student'), 'permission denied%', 'bot consents insert → permission denied');
  perform t.raises(format('select public.record_student_consent(%L, %L, %L)', 'veli_onayi', v_vo, '{"chat_id":1,"message_id":2}'),
                   'OGR-CONS-001%', 'veli onayı botla verilemez');
  perform t.raises(format('select public.record_student_consent(%L, %L, %L)', 'kvkk_aydinlatma', v_lt, '{}'), 'OGR-CONS-002%', 'kanıtsız onay OGR-CONS-002');
  perform public.record_student_consent('kvkk_aydinlatma', v_lt, '{"chat_id":700100002,"message_id":5,"telegram_user_id":700100002}');
  perform t.ok(not public.consent_ok(t.u('B')), 'reşit olmayan B veli onayı olmadan consent_ok=false');
  perform t.as_admin();
  perform t.ok((select s.status from public.students s where s.id = t.u('B')) = 'pending_consent', 'B pending_consent kalır');
end $$;

-- Veli kodu: koordinatör üretir, veli kendi Telegram'ından kullanır; öğrenci kendi velisi olamaz; tek kullanımlık
do $$
declare
  v_code text;
begin
  perform t.as_staff(t.u('inst_b'));
  v_code := public.mint_guardian_code(t.u('B'), 'telegram');
  perform t.ok(v_code ~ '^[A-Z2-7]{8}$', 'veli kodu 8 karakter base32');
  perform t.as_bot(null);
  perform t.raises(format('select public.redeem_guardian_code(%L, %s, %L)', v_code, 700100002, '{"chat_id":1}'), 'OGR-CONS-003%', 'öğrenci kendi velisi olamaz');
  perform t.ok(not public.redeem_guardian_code('YANLISKD', 800000001, '{}'), 'yanlış kod false');
  perform t.ok(public.redeem_guardian_code(left(v_code, 4) || '-' || right(v_code, 4), 800000001, '{"chat_id":800000001,"message_id":3}'), 'doğru kod (K7F3-2QX9 biçimi) true');
  perform t.ok(not public.redeem_guardian_code(v_code, 800000001, '{}'), 'kod tek kullanımlık');
  perform t.as_admin();
  perform t.ok((select count(*) from public.consents c where c.student_id = t.u('B') and c.kind = 'veli_onayi' and c.method = 'guardian_code') = 1, 'veli onayı yazıldı');
  perform t.ok(not exists (select 1 from public.students s join secure.telegram_identities ti on ti.student_id = s.id where ti.telegram_user_id = 800000001),
               'veli öğrenci olarak yaratılmadı');
end $$;

-- Web token (anon): kilit satır başınadır (§3.9 guardian_codes.attempts). Sahte tokenlar geçerli bir kodu kilitlemez;
-- eksik form sayacı kalıcıdır (exception ile geri alınmaz) ve 5'te yalnız o kod 1 saat kilitlenir.
do $$
declare
  v_code text;
  v_code2 text;
  v_att int;
  v_lock timestamptz;
  i int;
begin
  perform t.as_staff(t.u('coord'));
  v_code := public.mint_guardian_code(t.u('B'), 'web');
  v_code2 := public.mint_guardian_code(t.u('A'), 'web');
  perform t.as_anon();
  -- (a) 5 (ve fazlası) yanlış token → hepsi false; ardından geçerli token + tam form → true
  for i in 1 .. 6 loop
    perform t.ok(not public.redeem_guardian_token('ZZZZZZZ' || i::text, '{"guardian_name":"Ayla Demir","guardian_relation":"anne"}'),
                 'yanlış token false (' || i || ')');
  end loop;
  perform t.ok(not public.redeem_guardian_token(v_code, '{"guardian_name":""}'), 'eksik veli formu false (sayaç artar, hata yok)');
  perform t.as_admin();
  select g.attempts into v_att from secure.guardian_codes g where g.student_id = t.u('B') and g.channel = 'web' and g.used_at is null;
  perform t.ok(v_att = 1, 'eksik form sayacı kalıcı: attempts = ' || coalesce(v_att::text, 'null'));
  perform t.as_anon();
  perform t.ok(public.redeem_guardian_token(v_code, '{"guardian_name":"Ayla Demir","guardian_relation":"anne","declarations":[1,2,4]}'),
               '6 sahte tokendan sonra geçerli token + form true (küresel kilit yok)');
  perform t.ok(not public.redeem_guardian_token(v_code, '{"guardian_name":"Ayla Demir","guardian_relation":"anne"}'), 'token tek kullanımlık');
  -- (b) geçerli token + eksik form 5 kez → yalnız o kod kilitlenir (OGR-CONS-007), doğru form bile reddedilir
  for i in 1 .. 5 loop
    perform t.ok(not public.redeem_guardian_token(v_code2, '{"guardian_name":"Ali","guardian_relation":""}'), 'eksik form false (' || i || ')');
  end loop;
  perform t.as_admin();
  select g.attempts, g.locked_until into v_att, v_lock from secure.guardian_codes g
   where g.student_id = t.u('A') and g.channel = 'web' and g.used_at is null;
  perform t.ok(v_att = 5 and v_lock > now() + interval '59 minutes' and v_lock <= now() + interval '1 hour',
               '5 eksik formda attempts = 5 ve locked_until = now() + 1 saat');
  perform t.as_anon();
  perform t.raises(format('select public.redeem_guardian_token(%L, %L)', v_code2, '{"guardian_name":"Ali Kaya","guardian_relation":"baba"}'),
                   'OGR-CONS-007%', 'kilitli kod doğru formla da OGR-CONS-007');
  perform t.ok(not public.redeem_guardian_token('ZZZZZZZZ', '{"guardian_name":"Ali Kaya","guardian_relation":"baba"}'),
               'kilit yalnız o kod için: başka (yanlış) token OGR-CONS-007 değil, false');
  perform t.ok(public.ping() = 1, 'anon ping()');
  perform t.raises('select * from public.students', 'permission denied%', 'anon students okuyamaz');
  perform t.raises('select * from secure.answer_keys', 'permission denied for schema secure%', 'anon secure şemasına erişemez');
  perform t.as_admin();
  perform t.ok((select sp.guardian_name from secure.student_pii sp where sp.student_id = t.u('B')) = 'Ayla Demir'
               and app.pii_name_token_hashes('Ayla Demir') <@ (select sp.name_token_hashes from secure.student_pii sp where sp.student_id = t.u('B')),
               'veli adı secure''a yazıldı ve ad hash''lerine katıldı');
  perform t.ok((select count(*) from audit.events ev where ev.action = 'RPC:redeem_guardian_token' and ev.diff ->> 'ok' = 'false') >= 12,
               'hatalı denemeler audit.events''e yazıldı (izleme)');
  -- kilit süresi dolunca kod yeniden kullanılabilir
  update secure.guardian_codes g set locked_until = now() - interval '1 second' where g.student_id = t.u('A') and g.channel = 'web';
  perform t.as_anon();
  perform t.ok(public.redeem_guardian_token(v_code2, '{"guardian_name":"Ali Kaya","guardian_relation":"baba"}'), 'kilit dolduktan sonra doğru form true');
  perform t.as_admin();
end $$;

-- transcripts_staff_read (0017) kapsamı: app.transcript_visible — eğitmen yalnız atanan öğrencinin dersi, gözlemci hiç
do $$
begin
  insert into public.lessons (enrollment_id, staff_id, held_at, transcript_path) values
    (t.u('EA'), t.u('inst_a'), now() - interval '3 days', 'transcripts/ders-a.jsonl'),
    (t.u('EB'), t.u('inst_b'), now() - interval '3 days', 'ders-b.jsonl');
  perform t.as_staff(t.u('inst_a'));
  perform t.ok(app.transcript_visible('ders-a.jsonl') and not app.transcript_visible('ders-b.jsonl'),
               'eğitmen yalnız atanan öğrencinin transkriptini okur (A evet, B hayır)');
  perform t.ok(not app.transcript_visible('yok.jsonl'), 'ders satırı olmayan transkript nesnesi okunmaz');
  perform t.as_staff(t.u('obs'));
  perform t.ok(not app.transcript_visible('ders-a.jsonl'), 'gözlemci transkript okuyamaz');
  perform t.as_staff(t.u('coord'));
  perform t.ok(app.transcript_visible('ders-a.jsonl') and app.transcript_visible('transcripts/ders-b.jsonl'), 'koordinatör tüm transkriptleri okur');
  perform t.as_bot(t.u('A'));
  perform t.raises('select app.transcript_visible(''ders-a.jsonl'')', 'permission denied%', 'bot_runtime transcript_visible çalıştıramaz');
  perform t.as_admin();
end $$;

-- ADR-0014 yedeği: create_figure_upload_url — yalnız batch_worker, 10 dk, yalnız figures/<id>.png; imza HS256 ile doğrulanır
do $$
declare
  v_fig uuid := gen_random_uuid();
  v_fig_ok uuid := gen_random_uuid();
  v_url text;
  v_tok text[];
  v_payload jsonb;
  v_b64 text;
begin
  insert into public.figures (id, tool, code, code_hash, alt_text, review_status) values
    (v_fig, 'matplotlib', 'print(2)', 'h-upload-1', 'Yükleme testi', 'pending'),
    (v_fig_ok, 'matplotlib', 'print(3)', 'h-upload-2', 'Doğrulanmış', 'verified');
  perform t.as_batch();
  perform t.raises(format('select public.create_figure_upload_url(%L)', v_fig), 'OGR-STOR-001%', 'imza anahtarı yoksa OGR-STOR-001');
  perform set_config('app.settings.jwt_secret', 'test-secret', true);
  v_url := public.create_figure_upload_url(v_fig);
  perform t.ok(v_url like '/storage/v1/object/upload/sign/figures/' || v_fig || '.png?token=%', 'imzalı yükleme yolu figures/<id>.png');
  perform t.as_admin();   -- doğrulama hmac ister (uygulama rollerine pgcrypto yetkisi verilmez)
  v_tok := string_to_array(split_part(v_url, '?token=', 2), '.');
  v_b64 := translate(v_tok[2], '-_', '+/');
  v_b64 := v_b64 || repeat('=', (4 - length(v_b64) % 4) % 4);
  v_payload := convert_from(decode(v_b64, 'base64'), 'UTF8')::jsonb;
  perform t.ok(v_payload ->> 'url' = 'figures/' || v_fig || '.png' and (v_payload ->> 'exp')::bigint - (v_payload ->> 'iat')::bigint = 600
               and (v_payload ->> 'exp')::bigint > extract(epoch from now()),
               'belirteç yükü: url yalnız bu nesne, 10 dakika geçerli');
  perform t.ok(v_tok[3] = translate(encode(hmac(convert_to(v_tok[1] || '.' || v_tok[2], 'UTF8'), convert_to('test-secret', 'UTF8'), 'sha256'), 'base64'), E'+/=\n', '-_'),
               'HS256 imzası anahtarla doğrulanır');
  perform t.ok(v_tok[3] <> translate(encode(hmac(convert_to(v_tok[1] || '.' || v_tok[2], 'UTF8'), convert_to('baska-anahtar', 'UTF8'), 'sha256'), 'base64'), E'+/=\n', '-_'),
               'başka anahtarla imza tutmaz');
  perform t.as_batch();
  perform set_config('app.settings.jwt_secret', 'test-secret', true);
  perform t.raises(format('select public.create_figure_upload_url(%L)', v_fig_ok), 'OGR-STOR-002%', 'doğrulanmış şekle yükleme yolu verilmez');
  perform t.raises(format('select public.create_figure_upload_url(%L)', gen_random_uuid()), 'OGR-STOR-002%', 'olmayan şekil OGR-STOR-002');
  perform t.as_bot(t.u('A'));
  perform t.raises(format('select public.create_figure_upload_url(%L)', v_fig), 'permission denied%', 'bot_runtime create_figure_upload_url çalıştıramaz');
  perform t.claims_only('bot_runtime');
  perform t.raises(format('select public.create_figure_upload_url(%L)', v_fig), 'OGR-AUTH-002%', 'gövde bot_runtime JWT''sini reddeder');
  perform t.as_admin();
  perform set_config('app.settings.jwt_secret', '', true);
end $$;

-- Personel kapsamı: eğitmen ve gözlemci yalnız atananları; gözlemci güncelleyemez; koordinatör hepsini
do $$
declare
  v_n int;
begin
  perform t.as_staff(t.u('inst_a'));
  perform t.ok((select count(*) from public.students s where s.id in (t.u('A'), t.u('B'))) = 1, 'eğitmen yalnız atanan öğrenciyi görür');
  perform t.ok((select count(*) from public.staff st where st.id = t.u('inst_b')) = 1, 'eğitmen aynı branştaki eğitmeni görür');
  perform t.ok((select count(*) from public.staff st where st.id = t.u('obs')) = 0, 'eğitmen gözlemciyi görmez');
  perform t.as_staff(t.u('obs'));
  update public.students s set tier = 'pilot' where s.id = t.u('A');
  get diagnostics v_n = row_count;
  perform t.ok(v_n = 0, 'gözlemci öğrenci güncelleyemez (0 satır)');
  perform t.ok((select count(*) from public.staff st) = 1, 'gözlemci yalnız kendi personel satırını görür');
  perform t.as_staff(t.u('coord'));
  perform t.ok((select count(*) from public.students s where s.id in (t.u('A'), t.u('B'))) = 2, 'koordinatör tüm öğrencileri görür');
  update public.students s set tier = 'pilot' where s.id = t.u('A');
  get diagnostics v_n = row_count;
  perform t.ok(v_n = 1, 'koordinatör tier günceller');
  perform t.as_bot(t.u('A'));
  perform t.raises('select full_name from public.staff', 'permission denied%', 'bot personel adını (full_name) okuyamaz');
  perform t.ok((select count(*) from public.staff st where st.role = 'instructor') >= 2, 'bot personel id/rol/branş okur');
  perform t.as_admin();
end $$;

-- Panel: panel_overview dört anahtar; v_review_queue; approve_priority_plan (aynı kurs+dönemde tek onaylı)
do $$
declare
  v_o jsonb;
  v_new uuid;
begin
  insert into public.instructor_alerts (kind, severity, student_id, staff_id, detail, since, ref) values
    ('silent', 'warning', t.u('A'), t.u('inst_a'), 'Uzun süredir mesaj yok (test)', now() - interval '4 days', '{}'),
    ('unanswered', 'danger', t.u('A'), t.u('inst_a'), 'Cevapsız soru: "test"', now() - interval '1 day', jsonb_build_object('message_id', t.v('msg_a_q')::bigint)),
    ('unanswered', 'warning', t.u('B'), t.u('inst_b'), 'Cevapsız soru: "B"', now() - interval '7 hours', '{}');
  perform t.as_staff(t.u('inst_a'));
  v_o := public.panel_overview();
  perform t.ok(v_o ?& array['tiles', 'alerts', 'response_series', 'pilot'] and jsonb_array_length(v_o -> 'response_series') = 14,
               'panel_overview dört anahtar ve 14 günlük seri');
  perform t.ok((v_o #>> '{tiles,unanswered}')::int = 1 and (v_o #>> '{tiles,silent}')::int = 1, 'eğitmen yalnız atanan öğrencinin alarmlarını sayar');
  perform t.ok(v_o #>> '{alerts,0,severity}' = 'danger' and v_o #>> '{alerts,0,student_ref}' = 's_aaaaaaaaaaaa' and v_o #>> '{alerts,0,schema_version}' = '1.0',
               'alarmlar önem → yaş sırasında, student_ref ile (uuid yok)');
  perform t.ok(v_o::text not like '%' || t.v('A') || '%', 'panel_overview öğrenci uuid''si taşımaz');
  perform t.as_admin();
  insert into public.exam_priority_plans (course_id, period, plan, evidence_count)
  values ('30000000-0000-4000-8000-0000000000c0', 'YKS 2027', '{"rows":[]}', 3) returning id into v_new;
  perform t.as_staff(t.u('coord'));
  perform t.ok((select count(*) from public.v_review_queue q where q.kind = 'priority_plan' and q.ref_id = v_new::text) = 1, 'v_review_queue bekleyen planı listeler');
  perform public.approve_priority_plan(v_new, 'approved');
  perform t.as_admin();
  perform t.ok((select p.status from public.exam_priority_plans p where p.id = v_new) = 'approved'
               and (select p.status from public.exam_priority_plans p where p.id = '30000000-0000-4000-8000-0000000000aa') = 'retired',
               'yeni plan onaylandı, eski onaylı plan retired');
  perform t.ok(exists (select 1 from public.proactive_messages pm where pm.template_id = 'priority_plan_ready' and pm.student_id = t.u('A')),
               'onayda priority_plan_ready bildirimi');
  perform t.as_staff(t.u('inst_a'));
  perform t.raises(format('update public.exam_priority_plans set status = %L where id = %L', 'approved', v_new), 'permission denied%',
                   'eğitmen plan durumunu doğrudan güncelleyemez (yalnız RPC)');
  perform t.as_admin();
end $$;

-- Soru bankası: bot ve öğrenci şıkları yalnız questions_public (etiketsiz) üzerinden
do $$
begin
  perform t.as_bot(t.u('A'));
  perform t.raises('select options from public.questions', 'permission denied%', 'bot questions tablosunu okuyamaz');
  perform t.ok(not exists (select 1 from public.questions_public q cross join lateral jsonb_array_elements(q.options) o where o ? 'misconception_tag'),
               'questions_public şıklarında misconception_tag yok');
  perform t.as_admin();
end $$;

rollback;
