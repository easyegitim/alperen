-- tests/27_lessons.sql — P5 dersler (0039–0041): register_lesson (yalnız öğrencinin owner eğitmeni; öğrenci, veli, bağsız
-- eğitmen çağıramaz; aynı yüklemede aynı ders; yükleme eğitmen arşivine alınır; 'lesson.prepare' işi kaybolmaz), sınıf
-- dersi, RLS (eğitmen yalnız bağlı öğrencinin dersini görür; öğrenci tabloyu doğrudan okuyamaz, student_visible ise
-- yalnız RPC'den özet; veli hiçbir şey), lesson_set_options, lesson_set_progress (worker; failed → yeniden prepare),
-- retry_lesson (eğitmen), list_lessons, lesson_view, saklama listesi (lesson_retention_due: video, ses, kareler,
-- transkript dosyası + lesson_mark_media_deleted), 'lessons' kovası sahne karelerini (image/jpeg) kabul eder.
begin;
\ir _fixture.sql

do $$
declare
  v_r jsonb;
  v_l1 text;
  v_lc text;
begin
  perform t.add_outsiders();
  insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime, bytes) values
    ('50000000-0000-4000-8000-0000000000a1', t.u('inst'), t.u('A'), 'video', t.v('inst') || '/ders-1.mp4', 'video/mp4', 1000),
    ('50000000-0000-4000-8000-0000000000a2', t.u('inst'), null, 'audio', t.v('inst') || '/sinif-1.m4a', 'audio/mp4', 500),
    ('50000000-0000-4000-8000-0000000000a3', t.u('inst'), t.u('A'), 'photo', t.v('inst') || '/foto.jpg', 'image/jpeg', 10),
    ('50000000-0000-4000-8000-0000000000a4', t.u('inst2'), null, 'video', t.v('inst2') || '/ders-x.mp4', 'video/mp4', 10),
    ('50000000-0000-4000-8000-0000000000a5', t.u('inst'), null, 'transcript', t.v('inst') || '/ders-2.txt', 'text/plain', 10);
  insert into t.cfg values ('UP1', '50000000-0000-4000-8000-0000000000a1'), ('UP2', '50000000-0000-4000-8000-0000000000a2'),
    ('UPPH', '50000000-0000-4000-8000-0000000000a3'), ('UPX', '50000000-0000-4000-8000-0000000000a4'),
    ('UPT', '50000000-0000-4000-8000-0000000000a5');

  -- yetki: öğrenci, veli, bağsız eğitmen ders açamaz
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.register_lesson(%L, %L)', jsonb_build_object('enrollment_id', t.v('EA')), t.v('UP1')), '42501', 'öğrenci ders açamaz');
  perform t.as_user(t.u('parent'));
  perform t.raises(format('select public.register_lesson(%L, %L)', jsonb_build_object('enrollment_id', t.v('EA')), t.v('UP1')), '42501', 'veli ders açamaz');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.register_lesson(%L, %L)', jsonb_build_object('enrollment_id', t.v('EA')), t.v('UPX')),
                   'OGR-AUTH-001%', 'bağsız eğitmen başkasının öğrencisine ders açamaz');
  perform t.as_admin();
  insert into public.instructor_links (instructor_id, student_id, role) values (t.u('inst2'), t.u('A'), 'viewer');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.register_lesson(%L, %L)', jsonb_build_object('enrollment_id', t.v('EA')), t.v('UPX')),
                   'OGR-AUTH-001%', 'viewer eğitmen ders açamaz (kanıt yazımı owner)');

  -- doğrulama
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.register_lesson(%L, %L)', jsonb_build_object('enrollment_id', t.v('EA')), t.v('UPX')),
                   'OGR-AUTH-001%yükleme%', 'başkasının yüklemesi kullanılamaz');
  perform t.raises(format('select public.register_lesson(%L, %L)', jsonb_build_object('enrollment_id', t.v('EA')), t.v('UPPH')),
                   'OGR-LESSON-001%', 'fotoğraf ders yüklemesi değildir');
  perform t.raises(format('select public.register_lesson(%L, %L)', '{}'::jsonb, t.v('UP1')), 'OGR-LESSON-001%enrollment_id%', 'kayıt ya da ders gerekli');
  perform t.raises(format('select public.register_lesson(%L, %L)', jsonb_build_object('enrollment_id', 'x'), t.v('UP1')),
                   'OGR-LESSON-001%', 'geçersiz kimlik');
  perform t.raises(format('select public.register_lesson(%L, %L)', jsonb_build_object('enrollment_id', t.v('EA'), 'auto_apply_threshold', 0.3), t.v('UP1')),
                   'OGR-LESSON-001%', 'eşik 0,50 altı olamaz');
  perform t.raises(format('select public.register_lesson(%L, null)', jsonb_build_object('enrollment_id', t.v('EA'))), 'OGR-LESSON-001%', 'yükleme gerekli');

  -- kayıt
  v_r := public.register_lesson(jsonb_build_object('enrollment_id', t.v('EA'), 'title', 'Mutlak değer', 'held_at', '2026-10-29T17:00:00+03:00',
                                                   'duration_sec', 2890), t.u('UP1'));
  perform t.ok((v_r ->> 'created')::boolean and v_r ->> 'status' = 'processing', 'owner eğitmen dersi açar');
  v_l1 := v_r ->> 'lesson_id';
  v_r := public.register_lesson(jsonb_build_object('enrollment_id', t.v('EA')), t.u('UP1'));
  perform t.ok(not (v_r ->> 'created')::boolean and v_r ->> 'lesson_id' = v_l1, 'aynı yükleme aynı dersi döner');
  v_r := public.register_lesson(jsonb_build_object('course_id', t.v('course'), 'title', 'Sınıf dersi 1'), t.u('UP2'));
  v_lc := v_r ->> 'lesson_id';
  v_r := public.register_lesson(jsonb_build_object('enrollment_id', t.v('EB')), t.u('UPT'));
  perform t.as_admin();
  insert into t.cfg values ('L1', v_l1), ('LC', v_lc), ('LB', v_r ->> 'lesson_id');
  perform t.ok((select l.course_id = t.u('course') and l.instructor_id = t.u('inst') and l.duration_sec = 2890 and l.duration_min = 49
                       and l.auto_apply_threshold = 0.80 and not l.student_visible and l.progress ->> 'stage' = 'prepare'
                       and l.retain_until between now() + interval '89 days' and now() + interval '91 days'
                  from public.lessons l where l.id = t.u('L1')),
               'ders: kaydın dersi, eğitmen, süre, eşik 0,80, gizli, prepare, 90 gün saklama');
  perform t.ok((select l.transcript_upload_id = t.u('UPT') and l.retain_until is null from public.lessons l where l.id = t.u('LB')),
               'transkript yüklemesi: transcript_upload_id, ham medya saklaması yok');
  perform t.ok((select u.student_id is null and u.status = 'processing' from public.uploads u where u.id = t.u('UP1')),
               'ders yüklemesi eğitmen arşivine alınır (student_id boş) ve processing olur');
  perform t.ok(exists (select 1 from secure.job_outbox o where o.name = 'lesson.prepare' and o.data ->> 'lesson_id' = t.v('L1')
                                                          and o.data ->> 'upload_kind' = 'video')
               or exists (select 1 from audit.events ev where ev.action like 'job.%' and ev.diff::text like '%lesson.prepare%' and ev.diff::text like '%' || t.v('L1') || '%'),
               'lesson.prepare işi kaybolmaz (pg-boss yoksa outbox)');
  perform t.ok(t.sees(t.u('elif'), format('select 1 from public.uploads u where u.id = %L', t.v('UP1'))) = 0,
               'öğrenci ham ders yüklemesinin satırını görmez');
end $$;

-- RLS: dersler
do $$
declare
  v_q text := format('select 1 from public.lessons l where l.id = %L', t.v('L1'));
  v_qc text := format('select 1 from public.lessons l where l.id = %L', t.v('LC'));
begin
  perform t.ok(t.sees(t.u('inst'), v_q) = 1, 'owner eğitmen dersi görür');
  perform t.ok(t.sees(t.u('inst2'), v_q) = 1, 'viewer bağlı eğitmen dersi görür');
  perform t.ok(t.sees(t.u('inst2'), format('select 1 from public.lessons l where l.id = %L', t.v('LB'))) = 0,
               'bağsız eğitmen başka öğrencinin dersini görmez');
  perform t.ok(t.sees(t.u('elif'), v_q) = 0 and t.sees(t.u('parent'), v_q) = 0 and t.sees(t.u('can'), v_q) = 0,
               'gizli ders: öğrenci, veli, başka öğrenci görmez');
  perform t.ok(t.sees(t.u('inst'), v_qc) = 1 and t.sees(t.u('elif'), v_qc) = 0 and t.sees(t.u('deniz'), v_qc) = 0,
               'sınıf dersi: oluşturan eğitmen görür, öğrenciler görmez (gizli)');
  perform t.ok(t.sees(t.u('inst2'), v_qc) = 0, 'sınıf dersi: derse kayıtlı öğrencisine (viewer) bağlı başka eğitmen görmez');
  perform t.as_admin();
  delete from public.instructor_links il where il.instructor_id = t.u('inst2');
  perform t.ok(t.sees(t.u('inst2'), v_q) = 0 and t.sees(t.u('inst2'), v_qc) = 0, 'bağı kalkan eğitmen dersleri görmez');
end $$;

-- lesson_set_options ve öğrenci görünürlüğü
do $$
declare
  v_r jsonb;
  v_q text := format('select 1 from public.lessons l where l.id = %L', t.v('L1'));
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.lesson_set_options(%L, ''{"student_visible": true}'')', t.v('L1')), '42501', 'öğrenci ayar değiştiremez');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.lesson_set_options(%L, ''{"student_visible": true}'')', t.v('L1')), '42501', 'bağsız eğitmen ayar değiştiremez');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.lesson_set_options(%L, ''{"x": 1}'')', t.v('L1')), 'OGR-LESSON-001%', 'bilinmeyen seçenek');
  perform t.raises(format('select public.lesson_set_options(%L, ''{"auto_apply_threshold": 1.2}'')', t.v('L1')), 'OGR-LESSON-001%', 'eşik aralığı');
  v_r := public.lesson_set_options(t.u('L1'), '{"student_visible": true, "auto_apply_threshold": 0.75}');
  perform t.ok((v_r ->> 'student_visible')::boolean and (v_r ->> 'auto_apply_threshold')::numeric = 0.75, 'görünürlük ve eşik yazılır');
  perform t.as_admin();
  perform t.ok(t.sees(t.u('elif'), v_q) = 0, 'student_visible: öğrenci lessons tablosunu doğrudan okuyamaz (ilerleme, maliyet, yollar kapalı)');
  perform t.ok(t.sees(t.u('elif'), 'select 1 from public.lessons') = 0, 'öğrenci hiçbir ders satırını doğrudan görmez');
  perform t.ok(t.sees(t.u('can'), v_q) = 0 and t.sees(t.u('parent'), v_q) = 0, 'student_visible: başka öğrenci ve veli yine görmez');
  perform t.as_user(t.u('inst'));
  perform public.lesson_set_options(t.u('LC'), '{"student_visible": true}');
  perform t.as_admin();
  perform t.ok(t.sees(t.u('elif'), format('select 1 from public.lessons l where l.id = %L', t.v('LC'))) = 0
               and t.sees(t.u('deniz'), format('select 1 from public.lessons l where l.id = %L', t.v('LC'))) = 0,
               'açık sınıf dersi de tablodan okunmaz (öğrenci list_lessons/lesson_view ile görür)');
end $$;

-- lesson_set_progress (worker)
do $$
declare
  v_p jsonb;
begin
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.lesson_set_progress(%L, ''stt'')', t.v('L1')), 'OGR-AUTH-002%', 'eğitmen ilerleme yazamaz');
  perform t.as_service();
  perform t.raises(format('select public.lesson_set_progress(%L, ''x'')', t.v('L1')), 'OGR-LESSON-001%', 'geçersiz aşama');
  perform t.raises(format('select public.lesson_set_progress(%L, ''stt'', ''{"a": [1]}'')', t.v('L1')), 'OGR-LESSON-001%', 'iç içe sayaç');
  v_p := public.lesson_set_progress(t.u('L1'), 'stt', jsonb_build_object('audio_path', t.v('L1') || '/audio.flac', 'chunks', 3));
  perform t.ok(v_p ->> 'stage' = 'stt' and (v_p ->> 'chunks')::int = 3 and not v_p ? 'audio_path', 'aşama + sayaç; audio_path ilerlemede değil');
  perform t.as_admin();
  perform t.ok((select l.audio_path = t.v('L1') || '/audio.flac' and l.status = 'processing' from public.lessons l where l.id = t.u('L1')),
               'audio_path derse yazılır');
  perform t.as_service();
  perform t.raises(format('select public.lesson_set_progress(%L, ''stt'', ''{"audio_path": "../x"}'')', t.v('L1')), 'OGR-LESSON-001%', 'geçersiz ses yolu');
  v_p := public.lesson_set_progress(t.u('LC'), 'failed', '{"error": "ses çıkarılamadı"}');
  perform t.ok(v_p ->> 'error' = 'ses çıkarılamadı', 'failed hata metni');
  perform t.as_admin();
  perform t.ok((select l.status = 'failed' from public.lessons l where l.id = t.u('LC'))
               and (select u.status = 'failed' from public.uploads u where u.id = t.u('UP2')), 'failed: ders ve yükleme failed');
  perform t.as_service();
  perform t.raises(format('select public.lesson_set_progress(%L, ''stt'')', t.v('LC')), 'OGR-LESSON-003%', 'failed derste ilerleme yalnız prepare ile');
  -- retry_lesson: yalnız dersi yöneten eğitmen, yalnız düşen ders; aynı yüklemeyle lesson.prepare yeniden atılır
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.retry_lesson(%L)', t.v('LC')), '42501', 'öğrenci yeniden deneyemez');
  perform t.as_user(t.u('parent'));
  perform t.raises(format('select public.retry_lesson(%L)', t.v('LC')), '42501', 'veli yeniden deneyemez');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.retry_lesson(%L)', t.v('L1')), 'OGR-LESSON-003%', 'düşmemiş ders yeniden denenmez');
  v_p := public.retry_lesson(t.u('LC'));
  perform t.ok(v_p ->> 'stage' = 'prepare' and v_p ->> 'status' = 'processing', 'eğitmen düşen dersi yeniden başlatır');
  perform t.as_admin();
  perform t.ok((select l.status = 'processing' and l.progress ->> 'stage' = 'prepare' and not l.progress ? 'error' and (l.progress ->> 'retried')::int = 1
                  from public.lessons l where l.id = t.u('LC'))
               and (select u.status = 'processing' from public.uploads u where u.id = t.u('UP2')), 'yeniden deneme: processing, hata temizlendi, yükleme processing');
  perform t.ok(exists (select 1 from secure.job_outbox o where o.name = 'lesson.prepare' and o.data ->> 'lesson_id' = t.v('LC')
                                                          and (o.data ->> 'retry')::boolean and o.data ->> 'upload_id' = t.v('UP2'))
               or exists (select 1 from audit.events ev where ev.action like 'job.%' and ev.diff::text like '%lesson.prepare%' and ev.diff::text like '%' || t.v('LC') || '%'),
               'yeniden deneme: lesson.prepare aynı yüklemeyle kuyrukta');
  perform t.as_service();
  perform public.lesson_set_progress(t.u('LC'), 'failed', '{"error": "yine düştü"}');
  v_p := public.lesson_set_progress(t.u('LC'), 'prepare');
  perform t.ok(v_p ->> 'stage' = 'prepare' and not v_p ? 'error', 'prepare yeniden başlatır (hata temizlenir)');
  perform t.as_admin();
  perform t.ok((select l.status = 'processing' from public.lessons l where l.id = t.u('LC'))
               and (select u.status = 'processing' from public.uploads u where u.id = t.u('UP2')), 'yeniden başlatma: processing');
  perform t.as_service();
  perform public.lesson_set_progress(t.u('LC'), 'done', '{"duration_sec": 3000}');
  perform t.as_admin();
  perform t.ok((select l.status = 'analyzed' and l.duration_sec = 3000 and l.duration_min = 50 from public.lessons l where l.id = t.u('LC'))
               and (select u.status = 'ready' from public.uploads u where u.id = t.u('UP2')), 'done: analyzed, süre, yükleme ready');
end $$;

-- list_lessons ve lesson_view (yetki dalları; içerik 28/29'da)
do $$
declare
  v_r jsonb;
begin
  perform t.as_user(t.u('inst'));
  v_r := public.list_lessons();
  perform t.ok(jsonb_array_length(v_r) = 3 and v_r -> 0 ? 'claims' and v_r -> 0 ? 'student', 'eğitmen listesi: üç ders, iddia sayımı, öğrenci');
  v_r := public.list_lessons(t.u('A'));
  perform t.ok(jsonb_array_length(v_r) = 2, 'öğrenciye göre: birebir + sınıf dersi');
  perform t.ok((select bool_and(x.v ->> 'no' is not null) from jsonb_array_elements(v_r) as x (v)), 'ders sıra numarası');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.list_lessons(%L)', t.v('A')), 'OGR-AUTH-001%', 'bağsız eğitmen öğrencinin derslerini listeleyemez');
  perform t.ok(jsonb_array_length(public.list_lessons()) = 0, 'bağsız eğitmen listesi boş');
  perform t.as_user(t.u('elif'));
  v_r := public.list_lessons();
  perform t.ok(jsonb_array_length(v_r) = 2 and not (v_r -> 0) ? 'status' and not (v_r -> 0) ? 'claims', 'öğrenci: yalnız açık dersleri, sade alanlar');
  perform t.raises(format('select public.list_lessons(%L)', t.v('B')), 'OGR-AUTH-001%', 'öğrenci başkasının derslerini listeleyemez');
  perform t.as_user(t.u('can'));
  v_r := public.list_lessons();
  perform t.ok(jsonb_array_length(v_r) = 1 and v_r -> 0 ->> 'id' = t.v('LC'), 'Can: yalnız açık sınıf dersi (kendi gizli dersi ve Elif''inki yok)');
  perform t.as_user(t.u('parent'));
  perform t.raises('select public.list_lessons()', 'OGR-AUTH-001%', 'veli ders listesi göremez');
  perform t.raises(format('select public.lesson_view(%L)', t.v('L1')), 'OGR-AUTH-001%', 'veli ders görünümü göremez');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.lesson_view(%L)', t.v('L1')), 'OGR-AUTH-001%', 'bağsız eğitmen ders görünümü göremez');
  perform t.as_user(t.u('elif'));
  v_r := public.lesson_view(t.u('L1'));
  perform t.ok(v_r ->> 'role' = 'student' and not v_r ? 'transcript' and not v_r ? 'claims' and v_r -> 'lesson' ->> 'title' = 'Mutlak değer',
               'öğrenci görünümü: yalnız ders ve özet');
  perform t.as_user(t.u('inst'));
  v_r := public.lesson_view(t.u('L1'));
  perform t.ok(v_r ->> 'role' = 'staff' and (v_r -> 'lesson' ->> 'can_manage')::boolean and v_r -> 'lesson' -> 'student' ->> 'name' is not null,
               'eğitmen görünümü: yönetebilir, öğrenci adı');
  perform t.as_anon();
  perform t.raises(format('select public.lesson_view(%L)', t.v('L1')), '42501', 'anon çağıramaz');
  perform t.as_admin();
end $$;

-- saklama (worker)
do $$
declare
  v_due jsonb;
  v_n int;
begin
  perform t.as_user(t.u('inst'));
  perform t.raises('select public.lesson_retention_due()', 'OGR-AUTH-002%', 'eğitmen saklama listesini okuyamaz');
  perform t.as_admin();
  update public.lessons l set retain_until = now() - interval '1 day' where l.id = t.u('L1');
  insert into public.lesson_transcripts (lesson_id, segments, provider, segment_count)
  values (t.u('L1'), '[{"t0": 0, "t1": 2, "speaker": "EĞİTMEN", "text": "Merhaba"}]', 'fake', 1);
  perform t.as_service();
  v_due := public.lesson_retention_due();
  perform t.ok(exists (select 1 from jsonb_array_elements(v_due) as x (v)
                        where x.v ->> 'lesson_id' = t.v('L1') and x.v ->> 'media' = 'video' and x.v ->> 'storage_path' = t.v('inst') || '/ders-1.mp4'),
               'süresi dolan ham video listede');
  perform t.ok(exists (select 1 from jsonb_array_elements(v_due) as x (v)
                        where x.v ->> 'lesson_id' = t.v('L1') and x.v ->> 'media' = 'audio' and x.v ->> 'storage_path' = t.v('L1') || '/audio.flac'),
               'transkripti yazılmış dersin sesi listede');
  perform t.ok(not exists (select 1 from jsonb_array_elements(v_due) as x (v) where x.v ->> 'lesson_id' = t.v('LC')),
               'süresi dolmamış, transkriptsiz, düşmemiş ders listede değil');
  perform t.ok(exists (select 1 from jsonb_array_elements(v_due) as x (v)
                        where x.v ->> 'lesson_id' = t.v('LB') and x.v ->> 'media' = 'transcript_file') is false,
               'transkripti henüz yazılmamış dersin transkript dosyası silinmez');

  -- düşen derste çıkarılan ses ve kareler hemen; takılan derste iki gün sonra
  perform public.lesson_set_progress(t.u('LC'), 'prepare', jsonb_build_object('audio_path', t.v('inst') || '/' || t.v('LC') || '/audio.wav', 'frames_count', 12,
                                                                               'media_prefix', t.v('inst') || '/' || t.v('LC')));
  v_due := public.lesson_retention_due();
  perform t.ok(not exists (select 1 from jsonb_array_elements(v_due) as x (v) where x.v ->> 'lesson_id' = t.v('LC')),
               'işlenen dersin sesi ve kareleri beklenir');
  perform public.lesson_set_progress(t.u('LC'), 'failed', '{"error": "analiz edilemedi"}');
  v_due := public.lesson_retention_due();
  perform t.ok(exists (select 1 from jsonb_array_elements(v_due) as x (v)
                        where x.v ->> 'lesson_id' = t.v('LC') and x.v ->> 'media' = 'audio' and x.v ->> 'storage_path' = t.v('inst') || '/' || t.v('LC') || '/audio.wav'),
               'düşen (transkriptsiz) dersin sesi listede');
  select jsonb_array_length(x.v -> 'paths') into v_n from jsonb_array_elements(v_due) as x (v)
   where x.v ->> 'lesson_id' = t.v('LC') and x.v ->> 'media' = 'frames'
     and x.v -> 'paths' ->> 0 = t.v('inst') || '/' || t.v('LC') || '/frames/frame-01.jpg';
  perform t.ok(v_n = 30, 'düşen dersin kareleri listede (frame-01 … frame-30)');
  perform public.lesson_mark_media_deleted(t.u('LC'), 'frames');
  perform public.lesson_mark_media_deleted(t.u('LC'), 'audio');
  v_due := public.lesson_retention_due();
  perform t.ok(not exists (select 1 from jsonb_array_elements(v_due) as x (v) where x.v ->> 'lesson_id' = t.v('LC')), 'silinen ses ve kareler listeden çıkar');
  perform t.as_admin();
  perform t.ok((select l.frames_deleted_at is not null and l.audio_path is null from public.lessons l where l.id = t.u('LC')), 'kareler ve ses işaretlendi');
  perform t.as_service();
  perform public.lesson_set_progress(t.u('LC'), 'prepare', '{"frames_count": 8}');
  perform t.as_admin();
  perform t.ok((select l.frames_deleted_at is null from public.lessons l where l.id = t.u('LC')), 'yeniden üretilen kareler yeniden izlenir');
  update public.lessons l set progress = l.progress || jsonb_build_object('updated_at', now() - interval '3 days') where l.id = t.u('LC');
  perform t.as_service();
  perform t.ok(exists (select 1 from jsonb_array_elements(public.lesson_retention_due()) as x (v)
                        where x.v ->> 'lesson_id' = t.v('LC') and x.v ->> 'media' = 'frames'),
               'iki günden uzun takılan dersin kareleri listede');

  -- içe aktarılmış transkript dosyası
  perform t.as_admin();
  insert into public.lesson_transcripts (lesson_id, segments, provider, segment_count)
  values (t.u('LB'), '[{"t0": 0, "t1": 2, "speaker": "EĞİTMEN", "text": "Merhaba"}]', 'upload', 1);
  perform t.as_service();
  perform t.ok(exists (select 1 from jsonb_array_elements(public.lesson_retention_due()) as x (v)
                        where x.v ->> 'lesson_id' = t.v('LB') and x.v ->> 'media' = 'transcript_file' and x.v ->> 'storage_path' = t.v('inst') || '/ders-2.txt'),
               'içe aktarılmış transkript dosyası listede');
  perform public.lesson_mark_media_deleted(t.u('LB'), 'transcript_file');
  perform t.ok(not exists (select 1 from jsonb_array_elements(public.lesson_retention_due()) as x (v) where x.v ->> 'lesson_id' = t.v('LB')),
               'silinen transkript dosyası listeden çıkar');

  perform public.lesson_mark_media_deleted(t.u('L1'), 'video');
  perform public.lesson_mark_media_deleted(t.u('L1'), 'audio');
  perform public.lesson_mark_media_deleted(t.u('L1'), 'audio');
  perform t.raises(format('select public.lesson_mark_media_deleted(%L, ''x'')', t.v('L1')), 'OGR-LESSON-001%', 'geçersiz medya');
  v_due := public.lesson_retention_due();
  perform t.ok(not exists (select 1 from jsonb_array_elements(v_due) as x (v) where x.v ->> 'lesson_id' = t.v('L1')), 'silinen medya listeden çıkar');
  perform t.as_admin();
  perform t.ok((select l.video_deleted_at is not null and l.audio_deleted_at is not null and l.audio_path is null
                  from public.lessons l where l.id = t.u('L1'))
               and exists (select 1 from public.lesson_transcripts lt where lt.lesson_id = t.u('L1')),
               'silme işaretlendi; transkript kalır');
end $$;

-- Storage: hattın yüklediği türler 'lessons' kovasında izinli (sahne kareleri, çıkarılan ses)
do $$
begin
  perform t.ok((select b.allowed_mime_types @> array['image/jpeg', 'audio/wav', 'audio/x-wav', 'video/mp4', 'text/vtt']
                  from storage.buckets b where b.id = 'lessons'),
               'lessons kovası: kareler (image/jpeg), ses (audio/wav, audio/x-wav), video, transkript');
  perform t.ok((select cardinality(b.allowed_mime_types) = (select count(distinct m) from unnest(b.allowed_mime_types) as m)
                  from storage.buckets b where b.id = 'lessons'), 'MIME listesinde tekrar yok');
end $$;

rollback;
