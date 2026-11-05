-- tests/31_notifications.sql — bildirim kural motoru (0042): varsayılan kurallar, set_notification_rule doğrulaması,
-- emit_notification (yalnız worker; kural kapalı → yok; 24 saat tekilleştirme; alıcı öğrenciyle bağlı olmalı; kanallar
-- kuraldan; push aboneliği varsa push.send işi), notification_targets, list_notifications / mark_notification_read,
-- register/unregister_push_subscription, olay tetikleyicileri (deneme analiz edildi → öğrenci + veli; onaylı ders notu →
-- veli, yalnız öğrenciye açık ders) ve RLS (kimse başkasının bildirimini görmez).
begin;
\ir _fixture.sql
select t.add_outsiders();

do $$
begin
  perform t.ok(has_function_privilege('service_role', 'public.emit_notification(uuid, text, jsonb)', 'execute')
               and not has_function_privilege('authenticated', 'public.emit_notification(uuid, text, jsonb)', 'execute')
               and not has_function_privilege('anon', 'public.emit_notification(uuid, text, jsonb)', 'execute')
               and not has_function_privilege('authenticated', 'public.notification_targets(text)', 'execute'),
               'emit_notification ve notification_targets yalnız worker');
  perform t.ok(has_function_privilege('authenticated', 'public.set_notification_rule(text, boolean, jsonb)', 'execute')
               and has_function_privilege('authenticated', 'public.list_notifications(int, timestamptz, boolean)', 'execute')
               and not has_function_privilege('anon', 'public.list_notifications(int, timestamptz, boolean)', 'execute')
               and not has_function_privilege('authenticated', 'app.notify_emit(uuid, text, jsonb, text, text)', 'execute'),
               'kullanıcı RPC''leri authenticated; iç yazım yolu kapalı');
end $$;

-- varsayılanlar ve kural ayarı
do $$
declare
  v jsonb;
begin
  perform t.as_user(t.u('parent'));
  v := public.list_notification_rules();
  perform t.ok(jsonb_array_length(v) = 8
               and (select bool_and((x.r ->> 'enabled')::boolean and (x.r ->> 'is_default')::boolean) from jsonb_array_elements(v) as x (r)),
               'sekiz tür, hepsi varsayılan açık');
  perform t.ok((select x.r #>> '{params,weekday}' = '0' and x.r #>> '{params,hour}' = '19' from jsonb_array_elements(v) as x (r)
                 where x.r ->> 'kind' = 'weekly_summary')
               and (select x.r #>> '{params,days}' = '5' from jsonb_array_elements(v) as x (r) where x.r ->> 'kind' = 'inactivity')
               and (select x.r #>> '{params,leaf_p}' = '0.8' and x.r #>> '{params,weekly_net_delta}' = '4'
                      from jsonb_array_elements(v) as x (r) where x.r ->> 'kind' = 'improvement'),
               'haftalık özet Pazar 19:00, sessizlik 5 gün, ilerleme eşikleri');
  v := public.set_notification_rule('weekly_summary', null, '{"hour": 20, "channels": ["push", "email"]}');
  perform t.ok((v ->> 'enabled')::boolean and v #>> '{params,hour}' = '20' and v #>> '{params,weekday}' = '0'
               and v #> '{params,channels}' = '["email", "in_app", "push"]'::jsonb and not (v ->> 'is_default')::boolean,
               'parametreler varsayılanla birleşir; in_app her zaman kanal');
  perform t.raises($q$select public.set_notification_rule('weekly_summary', null, '{"weekday": 7}')$q$, 'OGR-NOTIF-002%', 'hafta günü 0–6');
  perform t.raises($q$select public.set_notification_rule('weekly_summary', null, '{"channels": ["sms"]}')$q$, 'OGR-NOTIF-002%', 'geçersiz kanal');
  perform t.raises($q$select public.set_notification_rule('exam_analysed', null, '{"days": 3}')$q$, 'OGR-NOTIF-002%', 'türe ait olmayan parametre');
  perform t.raises($q$select public.set_notification_rule('spam', true)$q$, 'OGR-NOTIF-001%', 'bilinmeyen tür');
  perform t.ok(not (public.set_notification_rule('inactivity', false) ->> 'enabled')::boolean, 'kural kapatılır');
  perform t.ok((public.set_notification_rule('inactivity', null, '{"days": 7}') #>> '{params,days}') = '7'
               and (select not (x.r ->> 'enabled')::boolean from jsonb_array_elements(public.list_notification_rules()) as x (r)
                     where x.r ->> 'kind' = 'inactivity'), 'parametre güncellemesi açık/kapalıyı değiştirmez');
  perform t.as_user(t.u('elif'));
  perform t.ok(t.n('select 1 from public.notification_rules') = 0, 'öğrenci velinin kurallarını görmez');
  perform t.as_admin();
end $$;

-- emit_notification: yalnız worker, bağ, kapalı kural, tekilleştirme, kanallar, push.send
do $$
declare
  v_id uuid;
  v_n public.notifications%rowtype;
begin
  perform t.as_user(t.u('parent'));
  perform t.raises(format($q$select public.emit_notification(%L, 'weekly_summary', '{}')$q$, t.u('parent')), '42501', 'kullanıcı bildirim yazamaz');
  perform t.as_service();
  v_id := public.emit_notification(t.u('parent'), 'weekly_summary', jsonb_build_object('student_id', t.u('A'), 'week_start', '2026-11-02'));
  perform t.as_admin();
  select n.* into v_n from public.notifications n where n.id = v_id;
  perform t.ok(v_n.title = 'Haftalık özet hazır' and v_n.body = 'Elif için bu haftanın kısa özeti hazır.'
               and v_n.channels = '{email,in_app,push}' and v_n.payload ->> 'dedupe_key' = 'week:' || t.v('A') || ':2026-11-02',
               'varsayılan metin (veliye üçüncü kişi), kanallar kuraldan, tekilleştirme anahtarı');
  perform t.ok(position('!' in v_n.title || coalesce(v_n.body, '')) = 0, 'ünlem yok');
  perform t.as_service();
  perform t.ok(public.emit_notification(t.u('parent'), 'weekly_summary', jsonb_build_object('student_id', t.u('A'), 'week_start', '2026-11-02')) is null,
               '24 saat içinde aynı anahtar ikinci kez yazılmaz');
  perform t.ok(public.emit_notification(t.u('parent'), 'weekly_summary', jsonb_build_object('student_id', t.u('A'), 'week_start', '2026-11-09')) is not null,
               'farklı hafta yeni bildirim');
  perform t.as_admin();
  update public.notifications n set created_at = now() - interval '25 hours' where n.id = v_id;
  perform t.as_service();
  perform t.ok(public.emit_notification(t.u('parent'), 'weekly_summary', jsonb_build_object('student_id', t.u('A'), 'week_start', '2026-11-02')) is not null,
               '24 saat sonra aynı anahtar yeniden yazılır');
  perform t.ok(public.emit_notification(t.u('parent'), 'inactivity', jsonb_build_object('student_id', t.u('A'))) is null,
               'kural kapalı → bildirim yok');
  perform t.raises(format($q$select public.emit_notification(%L, 'weekly_summary', %L)$q$, t.u('parent2'), jsonb_build_object('student_id', t.u('A'))),
                   'OGR-NOTIF-003%', 'bağsız veliye çocuk bildirimi yazılamaz');
  perform t.raises(format($q$select public.emit_notification(%L, 'weekly_summary', %L)$q$, t.u('parent'), jsonb_build_object('student_id', t.u('B'))),
                   'OGR-NOTIF-003%', 'velinin çocuğu olmayan öğrenci');
  perform t.raises(format($q$select public.emit_notification(%L, 'Kötü Tür', '{}')$q$, t.u('parent')), 'OGR-NOTIF-001%', 'geçersiz tür adı');
  v_id := public.emit_notification(t.u('parent'), 'improvement',
                                   jsonb_build_object('student_id', t.u('A'), 'skill_id', 't.mat.a', 'topic', 'İşlem önceliği',
                                                      'title', 'Matematikte güzel bir hafta', 'body', 'Elif işlem önceliğinde rahatladı.'));
  perform t.as_admin();
  select n.* into v_n from public.notifications n where n.id = v_id;
  perform t.ok(v_n.title = 'Matematikte güzel bir hafta' and v_n.body = 'Elif işlem önceliğinde rahatladı.'
               and not (v_n.payload ? 'title') and v_n.channels = '{in_app,push}',
               'worker metni (notification-copy) yükten; yükte tekrar saklanmaz');
  perform t.ok(not exists (select 1 from secure.job_outbox o where o.name = 'push.send' and o.data ->> 'notification_id' = v_id::text)
               and (to_regclass('pgboss.job') is null
                    or t.n(format($q$select 1 from pgboss.job j where j.name = 'push.send' and j.data ->> 'notification_id' = %L$q$, v_id)) = 0),
               'push aboneliği yokken push.send atılmaz (ne kuyrukta ne outbox''ta)');

  -- push aboneliği → push.send
  perform t.as_user(t.u('parent'));
  perform t.ok(public.register_push_subscription('https://push.example.test/abc123', repeat('B', 87), 'authsecret1234', 'Firefox') is not null,
               'push aboneliği eklenir');
  perform t.raises($q$select public.register_push_subscription('http://push.example.test/x', 'a', 'b')$q$, 'OGR-NOTIF-004%', 'http uç nokta reddedilir');
  perform t.as_service();
  v_id := public.emit_notification(t.u('parent'), 'misconception_resolved',
                                   jsonb_build_object('student_id', t.u('A'), 'misconception_id', gen_random_uuid(), 'topic', 'İşaret kuralları'));
  perform t.as_admin();
  perform t.ok((select n.body from public.notifications n where n.id = v_id) = 'Elif daha önce zorlandığı İşaret kuralları konusunu artık doğru çözüyor.',
               'yanılgı çözüldü metni');
  perform t.ok(exists (select 1 from secure.job_outbox o where o.name = 'push.send' and o.data ->> 'notification_id' = v_id::text)
               or (to_regclass('pgboss.job') is not null
                   and t.n(format($q$select 1 from pgboss.job j where j.name = 'push.send' and j.data ->> 'notification_id' = %L$q$, v_id)) = 1),
               'push kanalı + abonelik → push.send işi (kuyrukta ya da outbox''ta, bu bildirim için)');
  -- aynı uç nokta başka kullanıcıya taşınır; kendi aboneliğini siler
  perform t.as_user(t.u('elif'));
  perform public.register_push_subscription('https://push.example.test/abc123', repeat('C', 87), 'authsecret5678');
  perform t.as_admin();
  perform t.ok((select ps.user_id from public.push_subscriptions ps where ps.endpoint = 'https://push.example.test/abc123') = t.u('elif'),
               'paylaşılan cihazda uç nokta yeni kullanıcıya taşınır');
  perform t.as_user(t.u('parent'));
  perform t.ok(not public.unregister_push_subscription('https://push.example.test/abc123'), 'başkasının aboneliği silinmez');
  perform t.as_user(t.u('elif'));
  perform t.ok(public.unregister_push_subscription('https://push.example.test/abc123'), 'kendi aboneliği silinir');
  perform t.as_admin();
end $$;

-- liste ve okundu; RLS
do $$
declare
  v jsonb;
  v_other uuid;
begin
  perform t.as_service();
  v_other := public.emit_notification(t.u('can'), 'report_ready', jsonb_build_object('student_id', t.u('B'), 'document_id', gen_random_uuid()));
  perform t.as_user(t.u('parent'));
  v := public.list_notifications(2);
  perform t.ok((v ->> 'unread')::int = 5 and jsonb_array_length(v -> 'items') = 2
               and (v #>> '{items,0,created_at}')::timestamptz >= (v #>> '{items,1,created_at}')::timestamptz
               and not (v #> '{items,0,payload}' ? 'dedupe_key'), 'liste: okunmamış sayısı, sayfa, en yeni önce, iç anahtar yok');
  perform t.ok(public.mark_notification_read(((v #>> '{items,0,id}'))::uuid) = 1, 'tek bildirim okundu (1 satır)');
  perform t.ok((public.list_notifications() ->> 'unread')::int = 4, 'okunmamış sayısı düşer');
  perform t.ok(jsonb_array_length(public.list_notifications(20, null, true) -> 'items') = 4, 'yalnız okunmamışlar');
  perform t.raises(format($q$select public.mark_notification_read(%L)$q$, v_other), 'OGR-NOTIF-005%', 'başkasının bildirimi işaretlenemez');
  perform t.ok(t.n('select 1 from public.notifications') = 5, 'RLS: veli yalnız kendi bildirimlerini görür');
  perform t.ok(public.mark_notification_read() = 4, 'tümü okundu (4 satır)');
  perform t.ok((public.list_notifications() ->> 'unread')::int = 0, 'okunmamış kalmadı');
  perform t.as_user(t.u('can'));
  perform t.ok((public.list_notifications() ->> 'unread')::int = 1 and t.n('select 1 from public.notifications') = 1, 'öğrenci yalnız kendisininkini görür');
  perform t.as_anon();
  perform t.raises('select public.list_notifications()', '42501', 'anon listeleyemez');
  perform t.as_admin();
end $$;

-- notification_targets (worker)
do $$
declare
  v jsonb;
begin
  perform t.as_service();
  v := public.notification_targets('weekly_summary');
  perform t.ok(exists (select 1 from jsonb_array_elements(v) as x (r)
                        where x.r ->> 'recipient_id' = t.v('parent') and x.r ->> 'student_id' = t.v('A') and x.r ->> 'student_name' = 'Elif'
                          and x.r #>> '{params,hour}' = '20' and x.r ->> 'tz' = 'Europe/Istanbul' and x.r ->> 'last_sent_at' is not null),
               'haftalık özet hedefi: veli × çocuk, parametreler, son gönderim');
  perform t.ok(not exists (select 1 from jsonb_array_elements(public.notification_targets('inactivity')) as x (r)
                            where x.r ->> 'recipient_id' = t.v('parent')), 'kuralı kapalı veli hedef değil');
  perform t.ok(not exists (select 1 from jsonb_array_elements(v) as x (r) where x.r ->> 'recipient_id' = t.v('parent2')), 'bağsız veli hedef değil');
  perform t.raises($q$select public.notification_targets('spam')$q$, 'OGR-NOTIF-001%', 'bilinmeyen tür');
  perform t.as_user(t.u('parent'));
  perform t.raises($q$select public.notification_targets('weekly_summary')$q$, '42501', 'kullanıcı hedef listesini okuyamaz');
  perform t.as_admin();
end $$;

-- tetikleyici: deneme analiz edildi → öğrenci ve aktif veli; veli kuralı kapalıysa yalnız öğrenci; tekrar done çift yazmaz
do $$
declare
  v_exam uuid;
  v_s1 uuid;
  v_s2 uuid;
begin
  insert into public.exams (course_id, curriculum_id, created_by, kind, source, title, status)
  values (t.u('course'), t.u('cur'), t.u('inst'), 'deneme', 'instructor', 'Kasım Denemesi', 'ready') returning id into v_exam;
  insert into public.exam_sessions (exam_id, enrollment_id, mode, finished_at, status, score)
  values (v_exam, t.u('EA'), 'in_app', now(), 'analysing', '{"total": 4, "correct": 3, "wrong": 1, "net": 2.75}') returning id into v_s1;
  insert into public.exam_sessions (exam_id, enrollment_id, mode, finished_at, status, score)
  values (v_exam, t.u('EA'), 'in_app', now(), 'analysing', '{"total": 4, "correct": 2, "wrong": 2, "net": 1.5}') returning id into v_s2;
  update public.exam_sessions es set status = 'done' where es.id = v_s1;
  perform t.ok((select count(*) from public.notifications n where n.kind = 'exam_analysed' and n.payload ->> 'session_id' = v_s1::text) = 2,
               'deneme analiz edildi: öğrenciye ve veliye');
  perform t.ok((select n.title = 'Deneme sonucu hazır' and n.body = 'Elif bir denemeyi tamamladı: “Kasım Denemesi”. Sonuç ve kısa değerlendirme hazır.'
                       and n.payload ->> 'url' = '/veli' and (n.payload ->> 'net')::numeric = 2.75
                  from public.notifications n where n.kind = 'exam_analysed' and n.recipient_id = t.u('parent') and n.payload ->> 'session_id' = v_s1::text),
               'veli metni üçüncü kişi, ünlemsiz; bağlantı veli özetine');
  perform t.ok((select n.title = 'Deneme sonucun hazır' and n.payload ->> 'url' = '/ogrenci/deneme/' || v_s1::text
                  from public.notifications n where n.kind = 'exam_analysed' and n.recipient_id = t.u('elif')),
               'öğrenci metni ikinci kişi; bağlantı sonuç ekranına');
  update public.exam_sessions es set status = 'analysing' where es.id = v_s1;
  update public.exam_sessions es set status = 'done' where es.id = v_s1;
  perform t.ok((select count(*) from public.notifications n where n.kind = 'exam_analysed' and n.payload ->> 'session_id' = v_s1::text) = 2,
               'aynı oturum 24 saat içinde ikinci kez bildirilmez');
  perform t.as_user(t.u('parent'));
  perform public.set_notification_rule('exam_analysed', false);
  perform t.as_admin();
  update public.exam_sessions es set status = 'done' where es.id = v_s2;
  perform t.ok((select count(*) from public.notifications n where n.kind = 'exam_analysed' and n.payload ->> 'session_id' = v_s2::text) = 1
               and exists (select 1 from public.notifications n where n.kind = 'exam_analysed' and n.recipient_id = t.u('elif')
                            and n.payload ->> 'session_id' = v_s2::text), 'velinin kuralı kapalı: yalnız öğrenci');
  -- bağsız/revoke edilmiş veliye gitmez: Can'ın denemesi
  insert into public.exam_sessions (exam_id, enrollment_id, mode, finished_at, status, score)
  values (v_exam, t.u('EB'), 'in_app', now(), 'analysing', '{"total": 4, "net": 4}') returning id into v_s2;
  update public.exam_sessions es set status = 'done' where es.id = v_s2;
  perform t.ok((select array_agg(n.recipient_id) from public.notifications n where n.kind = 'exam_analysed' and n.payload ->> 'session_id' = v_s2::text)
               = array[t.u('can')], 'velisi olmayan öğrencinin denemesi yalnız kendisine');
end $$;

-- tetikleyici: onaylı ders notu → veli (yalnız öğrenciye açık ders); ders başına bir kez; eğitmene özel alan gitmez
do $$
declare
  v_lesson uuid;
  v_an uuid;
  v_c1 uuid;
  v_c2 uuid;
  v_c3 uuid;
  v_n public.notifications%rowtype;
begin
  insert into public.lessons (enrollment_id, instructor_id, held_at, student_visible, title)
  values (t.u('EA'), t.u('inst'), now() - interval '1 day', false, 'İşlem önceliği tekrar') returning id into v_lesson;
  insert into public.lesson_analyses (lesson_id, seed_profile, analysis, model) values (v_lesson, '{}', '{}', 'fake') returning id into v_an;
  insert into public.lesson_claims (analysis_id, kind, value, quote, speaker, t_start_sec) values
    (v_an, 'next_step', '{"for_student": "Cumartesi 20 dakika işlem önceliği alıştırması yap.", "for_instructor": "EĞİTMENE ÖZEL"}', 'x', 'EĞİTMEN', 0)
  returning id into v_c1;
  insert into public.lesson_claims (analysis_id, kind, value, quote, speaker, t_start_sec) values
    (v_an, 'homework', '{"who": "ÖĞRENCİ", "text": "Sayfa 12 alıştırmaları"}', 'x', 'EĞİTMEN', 10) returning id into v_c2;
  insert into public.lesson_claims (analysis_id, kind, value, quote, speaker, t_start_sec) values
    (v_an, 'talk', '{"notes": "sohbet"}', 'x', 'EĞİTMEN', 20) returning id into v_c3;
  update public.lesson_claims lc set status = 'approved', decided_at = now() where lc.id = v_c1;
  perform t.ok(not exists (select 1 from public.notifications n where n.kind = 'instructor_note_shared'),
               'öğrenciye kapalı dersin notu veliye gitmez');
  update public.lessons l set student_visible = true where l.id = v_lesson;
  select n.* into v_n from public.notifications n where n.kind = 'instructor_note_shared';
  perform t.ok(v_n.recipient_id = t.u('parent') and v_n.payload ->> 'note' = 'Cumartesi 20 dakika işlem önceliği alıştırması yap.'
               and v_n.body like 'Elif için dersten bir not paylaşıldı: Cumartesi%' and position('EĞİTMENE ÖZEL' in v_n::text) = 0
               and v_n.payload ->> 'lesson_id' = v_lesson::text, 'ders öğrenciye açılınca onaylı not veliye; eğitmene özel alan yok');
  update public.lesson_claims lc set status = 'approved', decided_at = now() where lc.id = v_c2;
  update public.lesson_claims lc set status = 'approved', decided_at = now() where lc.id = v_c3;
  perform t.ok((select count(*) from public.notifications n where n.kind = 'instructor_note_shared') = 1,
               'aynı ders 24 saatte bir; konuşma iddiası not sayılmaz');
  perform t.ok((select count(*) from public.notifications n where n.kind = 'instructor_note_shared' and n.recipient_id in (t.u('elif'), t.u('can'))) = 0,
               'not bildirimi öğrencilere gitmez');
end $$;

rollback;
