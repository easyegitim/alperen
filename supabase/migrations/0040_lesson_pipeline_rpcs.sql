-- 0040_lesson_pipeline_rpcs.sql — P5 ders hattının yazım yolu (docs/PLAN-v2.md §9): register_lesson (eğitmen),
-- lesson_set_progress, write_lesson_transcript, write_lesson_analysis (worker), lesson_set_options (eğitmen ayarları),
-- lesson_retention_due + lesson_mark_media_deleted ('lesson.retention' işi), retry_lesson (düşen dersi yeniden başlatır). İddiaların uygulanması, inceleme ve okuma
-- RPC'leri 0041'de. Kurallar ve hata kodları 0039'un başındadır.
--
-- 'lesson.prepare' işinin verisi: {lesson_id, upload_id, transcript_upload_id, upload_kind, retry?}. Worker kuyruğu yoksa iş
-- secure.job_outbox'a düşer (0029); kayıt düşmez.

-- --- register_lesson ------------------------------------------------------------------------------------------------

-- Dersi açar (eğitmen). p_upload_id: 'lessons' kovasına TUS ile yüklenmiş video | ses | transkript (uploads satırı,
-- çağıranın). p_meta: {enrollment_id | course_id (biri gerekli; birebir derste course_id kaydın dersidir), held_at?,
-- title?, duration_sec?, student_visible? (false), auto_apply_threshold? (0.50–1.00, varsayılan 0.80),
-- transcript_upload_id?, instructor_id? (yalnız güvenilir çağıran)}. Birebir derste yetki kanıt yazımı kuralıdır
-- (owner eğitmen, admin, worker); sınıf dersinde özel (private) dersin oluşturanı ya da derse etkin kayıtlı en az bir
-- öğrencisinin owner eğitmeni (viewer bağı yetmez). Sınıf dersinin kapsamı dersi verenin kendi öğrencileridir
-- (app.lesson_students); ortak derste başka eğitmenlerin öğrencileri etkilenmez.
-- Yüklemeler eğitmen arşivine alınır (uploads.student_id = null: öğrenci ham medyayı ve satırı görmez) ve processing
-- olur. Aynı yüklemeyle yeniden çağrı aynı dersi döner (yeni iş atılmaz). Ham medya varsa retain_until = şimdi + 90 gün.
create or replace function public.register_lesson(p_meta jsonb, p_upload_id uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
  v_trusted boolean := app.is_trusted();
  v_up public.uploads%rowtype;
  v_tr public.uploads%rowtype;
  v_enr public.enrollments%rowtype;
  v_course public.courses%rowtype;
  v_existing public.lessons%rowtype;
  v_uuid_re text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_enrollment uuid;
  v_course_id uuid;
  v_tr_id uuid;
  v_instructor uuid;
  v_held timestamptz;
  v_title text;
  v_dur int;
  v_vis boolean;
  v_thr numeric;
  v_days numeric;
  v_id uuid;
  v_job uuid;
begin
  if not v_trusted and not app.is_staff() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 dersi yalnız eğitmen ya da admin kaydeder';
  end if;
  if jsonb_typeof(v_meta) <> 'object' then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 p_meta bir nesne olmalı';
  end if;
  if p_upload_id is null then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 ders yüklemesi (p_upload_id) gerekli';
  end if;
  foreach v_title in array array['enrollment_id', 'course_id', 'transcript_upload_id', 'instructor_id'] loop
    if v_meta ? v_title and jsonb_typeof(v_meta -> v_title) <> 'null'
       and coalesce(v_meta ->> v_title, '') !~ v_uuid_re then
      raise exception using errcode = 'P0001', message = format('OGR-LESSON-001 %s geçerli bir kimlik değil', v_title);
    end if;
  end loop;
  select u.* into v_up from public.uploads u where u.id = p_upload_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 yükleme bulunamadı';
  end if;
  if not v_trusted and v_up.owner_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 yükleme çağırana ait değil';
  end if;
  if v_up.kind not in ('video', 'audio', 'transcript') then
    raise exception using errcode = 'P0001', message = format('OGR-LESSON-001 ders yüklemesi video, ses ya da transkript olmalı (%s)', v_up.kind);
  end if;
  select l.* into v_existing from public.lessons l where l.upload_id = p_upload_id;
  if found then
    if not app.lesson_can_manage(v_existing.id) then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu ders için yetki yok';
    end if;
    return jsonb_build_object('lesson_id', v_existing.id, 'status', v_existing.status, 'created', false, 'job_id', null);
  end if;

  v_enrollment := nullif(v_meta ->> 'enrollment_id', '')::uuid;
  v_course_id := nullif(v_meta ->> 'course_id', '')::uuid;
  if v_enrollment is null and v_course_id is null then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 enrollment_id ya da course_id gerekli';
  end if;
  if v_enrollment is not null then
    select e.* into v_enr from public.enrollments e where e.id = v_enrollment;
    if not found then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 kayıt bulunamadı';
    end if;
    perform app.assert_evidence_writer(v_enr.student_id);
    if v_course_id is not null and v_course_id is distinct from v_enr.course_id then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 course_id kaydın dersiyle aynı olmalı';
    end if;
    v_course_id := v_enr.course_id;
  else
    select c.* into v_course from public.courses c where c.id = v_course_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 ders bulunamadı';
    end if;
    if v_course.curriculum_id is null then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 dersin müfredatı yok (önce müfredat eşlenmeli)';
    end if;
    if not v_trusted and not app.is_admin()
       and not (v_course.visibility = 'private' and v_course.created_by is not distinct from auth.uid())
       and not exists (select 1 from public.enrollments e join public.instructor_links il on il.student_id = e.student_id
                        where e.course_id = v_course_id and e.status = 'active'
                          and il.instructor_id = auth.uid() and il.role = 'owner'
                          and (il.course_id is null or il.course_id = v_course_id)) then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu ders için yetki yok (derste owner olduğunuz öğrenci yok)';
    end if;
  end if;

  begin
    v_held := coalesce(nullif(v_meta ->> 'held_at', '')::timestamptz, now());
  exception when others then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 held_at geçerli bir zaman değil';
  end;
  if v_held > now() + interval '1 day' then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 held_at gelecekte olamaz';
  end if;
  v_title := nullif(left(btrim(coalesce(v_meta ->> 'title', '')), 120), '');
  if v_meta ? 'duration_sec' and jsonb_typeof(v_meta -> 'duration_sec') <> 'null' then
    if jsonb_typeof(v_meta -> 'duration_sec') <> 'number' or (v_meta ->> 'duration_sec')::numeric not between 1 and 86400 then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 duration_sec 1–86400 arası bir sayı olmalı';
    end if;
    v_dur := round((v_meta ->> 'duration_sec')::numeric)::int;
  end if;
  if v_meta ? 'student_visible' and jsonb_typeof(v_meta -> 'student_visible') not in ('boolean', 'null') then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 student_visible mantıksal olmalı';
  end if;
  v_vis := coalesce((v_meta ->> 'student_visible')::boolean, false);
  if v_meta ? 'auto_apply_threshold' and jsonb_typeof(v_meta -> 'auto_apply_threshold') <> 'null' then
    if jsonb_typeof(v_meta -> 'auto_apply_threshold') <> 'number'
       or (v_meta ->> 'auto_apply_threshold')::numeric not between 0.5 and 1 then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 auto_apply_threshold 0,50–1,00 arası olmalı';
    end if;
    v_thr := round((v_meta ->> 'auto_apply_threshold')::numeric, 2);
  end if;

  v_tr_id := nullif(v_meta ->> 'transcript_upload_id', '')::uuid;
  if v_tr_id is null and v_up.kind = 'transcript' then
    v_tr_id := p_upload_id;
  end if;
  if v_tr_id is not null and v_tr_id <> p_upload_id then
    select u.* into v_tr from public.uploads u where u.id = v_tr_id for update;
    if not found or v_tr.kind <> 'transcript' then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 transcript_upload_id bir transkript yüklemesi olmalı';
    end if;
    if not v_trusted and v_tr.owner_id is distinct from auth.uid() then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 transkript yüklemesi çağırana ait değil';
    end if;
  end if;
  v_instructor := case when v_trusted then nullif(v_meta ->> 'instructor_id', '')::uuid else auth.uid() end;
  v_days := greatest(app.setting_num('lesson_video_retention_days', 90), 1);

  insert into public.lessons (enrollment_id, course_id, upload_id, transcript_upload_id, instructor_id, held_at, title,
                              duration_sec, duration_min, student_visible, auto_apply_threshold, status, progress, retain_until)
  values (v_enrollment, v_course_id, p_upload_id, v_tr_id, v_instructor, v_held, v_title,
          v_dur, case when v_dur is not null then ceil(v_dur / 60.0)::int end, v_vis, coalesce(v_thr, 0.80), 'processing',
          jsonb_build_object('stage', 'prepare', 'updated_at', now()),
          case when v_up.kind in ('video', 'audio') then now() + make_interval(days => v_days::int) end)
  returning id into v_id;

  -- eğitmen arşivi: ham medya ve transkript dosyası öğrenciye (uploads_select) görünmez
  update public.uploads u
     set student_id = null,
         status = case when u.status in ('stored', 'failed') then 'processing' else u.status end
   where u.id in (p_upload_id, v_tr_id);

  v_job := app.try_enqueue('lesson.prepare', jsonb_build_object('lesson_id', v_id, 'upload_id', p_upload_id,
                                                                'transcript_upload_id', v_tr_id, 'upload_kind', v_up.kind));
  return jsonb_build_object('lesson_id', v_id, 'status', 'processing', 'created', true, 'job_id', v_job);
end
$$;
comment on function public.register_lesson(jsonb, uuid) is 'Eğitmen: ders yüklemesinden dersi açar (kayıt ya da sınıf dersi), yüklemeyi eğitmen arşivine alır, lesson.prepare işini atar; aynı yüklemede aynı ders.';

-- --- lesson_set_progress ----------------------------------------------------------------------------------------------

-- Worker: hat aşaması + düz sayaçlar (sayı, metin, mantıksal). Özel anahtarlar: error (failed metni, ≤ 300),
-- audio_path (çıkarılan sesin Storage yolu → lessons.audio_path), duration_sec (→ lessons.duration_sec/duration_min),
-- frames_count (> 0 ise kareler yeniden yüklendi: frames_deleted_at boşalır), media_prefix (türetilmiş medyanın klasörü
-- '<sahip>/<ders>'; ilerlemede kalır, saklama işi kareleri oradan siler). failed: ders ve işlenen yüklemeler failed; failed dersin ilerlemesi yalnız 'prepare' ile (yeniden deneme)
-- sürer. done: yüklemeler ready, işlenen ders analyzed.
create or replace function public.lesson_set_progress(p_lesson uuid, p_stage text, p_counters jsonb default '{}'::jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_l public.lessons%rowtype;
  v_counters jsonb := coalesce(p_counters, '{}'::jsonb);
  v_progress jsonb;
  v_audio text;
  v_dur int;
  v_frames int;
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 ders ilerlemesini yalnız worker yazar';
  end if;
  if p_stage is null or p_stage not in ('prepare', 'stt', 'label', 'analyse', 'apply', 'done', 'failed') then
    raise exception using errcode = 'P0001', message = format('OGR-LESSON-001 geçersiz aşama %s', coalesce(p_stage, '(boş)'));
  end if;
  if jsonb_typeof(v_counters) <> 'object'
     or exists (select 1 from jsonb_each(v_counters) as c (k, v) where jsonb_typeof(c.v) not in ('number', 'string', 'null', 'boolean')) then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 p_counters düz bir nesne olmalı (sayı, metin, mantıksal)';
  end if;
  select l.* into v_l from public.lessons l where l.id = p_lesson for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 ders bulunamadı';
  end if;
  if v_l.status = 'failed' and p_stage not in ('failed', 'prepare') then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-003 ders failed: ilerleme yalnız prepare ile yeniden başlar';
  end if;
  if v_counters ? 'audio_path' and jsonb_typeof(v_counters -> 'audio_path') = 'string' then
    v_audio := v_counters ->> 'audio_path';
    if v_audio !~ '^[^/]+(/[^/]+)+$' or v_audio ~ '(^|/)\.{1,2}(/|$)' then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 audio_path geçerli bir Storage yolu değil';
    end if;
  end if;
  if v_counters ? 'duration_sec' and jsonb_typeof(v_counters -> 'duration_sec') = 'number' then
    v_dur := least(greatest(round((v_counters ->> 'duration_sec')::numeric)::int, 0), 86400);
  end if;
  if v_counters ? 'frames_count' and jsonb_typeof(v_counters -> 'frames_count') = 'number' then
    v_frames := least(greatest(round((v_counters ->> 'frames_count')::numeric)::int, 0), 32767);
  end if;

  v_progress := (case when p_stage = 'prepare' and v_l.status = 'failed' then v_l.progress - 'error' else v_l.progress end)
                || (v_counters - 'stage' - 'updated_at' - 'error' - 'audio_path')
                || jsonb_build_object('stage', p_stage, 'updated_at', now());
  if p_stage = 'failed' then
    v_progress := v_progress || jsonb_build_object('error', left(coalesce(nullif(v_counters ->> 'error', ''), 'ders işlenemedi'), 300));
  end if;

  update public.lessons l
     set progress = v_progress,
         audio_path = coalesce(v_audio, l.audio_path),
         audio_deleted_at = case when v_audio is not null then null else l.audio_deleted_at end,
         duration_sec = coalesce(v_dur, l.duration_sec),
         duration_min = coalesce(case when v_dur is not null then ceil(v_dur / 60.0)::int end, l.duration_min),
         frames_count = coalesce(v_frames, l.frames_count),
         frames_deleted_at = case when v_frames > 0 then null else l.frames_deleted_at end,
         status = case when p_stage = 'failed' then 'failed'
                       when p_stage in ('prepare', 'stt', 'label', 'analyse') and l.status in ('uploaded', 'failed') then 'processing'
                       when p_stage = 'done' and l.status in ('uploaded', 'processing') then 'analyzed'
                       else l.status end
   where l.id = p_lesson;
  if p_stage = 'failed' then
    update public.uploads u set status = 'failed' where u.id in (v_l.upload_id, v_l.transcript_upload_id) and u.status = 'processing';
  elsif p_stage = 'done' then
    update public.uploads u set status = 'ready' where u.id in (v_l.upload_id, v_l.transcript_upload_id) and u.status = 'processing';
  elsif p_stage = 'prepare' then
    update public.uploads u set status = 'processing' where u.id in (v_l.upload_id, v_l.transcript_upload_id) and u.status = 'failed';
  end if;
  return v_progress;
end
$$;
comment on function public.lesson_set_progress(uuid, text, jsonb) is 'Worker: ders hattı aşaması + sayaçlar (audio_path, duration_sec, frames_count özel); failed: ders ve yüklemeler failed, prepare yeniden başlatır; done: yüklemeler ready.';

-- --- write_lesson_transcript ----------------------------------------------------------------------------------------

-- Transkripti yazar (ders başına tek satır, üzerine yazılır). Worker (STT ve label aşamaları; p_provider groq |
-- elevenlabs | fake | upload) ya da dersi yöneten eğitmen ("Konuşmacıları düzelt", "Transkripti düzenle"; sağlayıcı
-- 'manual' olarak kaydedilir). p_segments: 1–20000 bölüm [{t0 ≥ 0 sn, t1 ≥ t0, speaker: ÖĞRENCİ | EĞİTMEN | DİĞER |
-- null (etiketlenmemiş), text 1–4000 karakter}]. Ders süresi boşsa son bölümün sonundan yazılır.
create or replace function public.write_lesson_transcript(
  p_lesson uuid, p_segments jsonb, p_language text default 'tr', p_provider text default 'groq'
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_trusted boolean := app.is_trusted();
  v_l public.lessons%rowtype;
  v_provider text := coalesce(p_provider, 'groq');
  v_lang text := coalesce(nullif(btrim(p_language), ''), 'tr');
  v_n int;
  v_bad int;
  v_labeled boolean;
  v_end int;
begin
  select l.* into v_l from public.lessons l where l.id = p_lesson for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 ders bulunamadı';
  end if;
  if not v_trusted then
    if not app.lesson_can_manage(p_lesson) then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 transkripti yalnız worker ya da dersi yöneten eğitmen yazar';
    end if;
    v_provider := 'manual';
  end if;
  if v_provider not in ('groq', 'elevenlabs', 'fake', 'upload', 'manual') then
    raise exception using errcode = 'P0001', message = format('OGR-LESSON-007 geçersiz sağlayıcı %s', v_provider);
  end if;
  if v_lang !~ '^[a-z]{2}(-[A-Z]{2})?$' then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-007 geçersiz dil kodu';
  end if;
  if p_segments is null or jsonb_typeof(p_segments) <> 'array' then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-007 p_segments bir dizi olmalı';
  end if;
  v_n := jsonb_array_length(p_segments);
  if v_n not between 1 and 20000 then
    raise exception using errcode = 'P0001', message = format('OGR-LESSON-007 bölüm sayısı 1–20000 olmalı (%s)', v_n);
  end if;
  select count(*) into v_bad
    from jsonb_array_elements(p_segments) as s (seg)
   where jsonb_typeof(s.seg) <> 'object'
      or jsonb_typeof(s.seg -> 't0') is distinct from 'number' or jsonb_typeof(s.seg -> 't1') is distinct from 'number'
      or (s.seg ->> 't0')::numeric < 0 or (s.seg ->> 't1')::numeric < (s.seg ->> 't0')::numeric
      or (s.seg ->> 't1')::numeric > 86400
      or jsonb_typeof(s.seg -> 'text') is distinct from 'string' or char_length(s.seg ->> 'text') not between 1 and 4000
      or (s.seg ? 'speaker' and jsonb_typeof(s.seg -> 'speaker') <> 'null' and coalesce(s.seg ->> 'speaker', '') not in ('ÖĞRENCİ', 'EĞİTMEN', 'DİĞER'))
      or exists (select 1 from jsonb_object_keys(s.seg) as k (key) where k.key not in ('t0', 't1', 'speaker', 'text'));
  if v_bad > 0 then
    raise exception using errcode = 'P0001',
      message = format('OGR-LESSON-007 %s bölüm geçersiz: {t0 ≥ 0, t1 ≥ t0, speaker ÖĞRENCİ|EĞİTMEN|DİĞER|null, text 1–4000}', v_bad);
  end if;
  select bool_and(coalesce(s.seg ->> 'speaker', '') <> ''), max(ceil((s.seg ->> 't1')::numeric))::int
    into v_labeled, v_end
    from jsonb_array_elements(p_segments) as s (seg);

  insert into public.lesson_transcripts (lesson_id, segments, language, provider, labeled, segment_count, edited_by)
  values (p_lesson, p_segments, v_lang, v_provider, v_labeled, v_n, case when v_trusted then null else auth.uid() end)
  on conflict (lesson_id) do update
     set segments = excluded.segments, language = excluded.language, provider = excluded.provider,
         labeled = excluded.labeled, segment_count = excluded.segment_count, edited_by = excluded.edited_by,
         updated_at = now();
  update public.lessons l
     set duration_sec = coalesce(l.duration_sec, v_end),
         duration_min = coalesce(l.duration_min, ceil(v_end / 60.0)::int)
   where l.id = p_lesson;
  return jsonb_build_object('lesson_id', p_lesson, 'segments', v_n, 'labeled', v_labeled, 'provider', v_provider,
                            'duration_sec', coalesce(v_l.duration_sec, v_end));
end
$$;
comment on function public.write_lesson_transcript(uuid, jsonb, text, text) is 'Worker ya da dersi yöneten eğitmen (manual): ders transkriptini yazar/değiştirir ({t0, t1, speaker, text} bölümleri).';

-- --- write_lesson_analysis ------------------------------------------------------------------------------------------

-- lesson-analysis (packages/contracts) nesnesinden iddia listesi: skills → skill_mastery (değer {mastery_estimate},
-- güven modelden), misconceptions → misconception, previous_profile_check → followup (not_observed atlanır),
-- questions → question, hesitations → hesitation, commitments → homework | promise | deadline, next_step, talk,
-- course_insights → course_insight. Alıntı, konuşan ve zaman kanıtın ilk öğesinden. Güven: öğede 'confidence' varsa o;
-- yoksa öğrenen modele dokunmayan doğrudan çıkarımlarda (soru, tereddüt, söz, konuşma) 1.00, çıkarım gerektirenlerde
-- (yanılgı, takip, ders bilgisi) boş → eğitmen incelemesi. Modelin öğrenciye (ve veliye) dönük yazdığı yargılı metinler
-- (sonraki adım, ödev, son tarih) her zaman boş güvenle gelir: eğitmen görmeden onaylanmaz, öğrenci özetine, hafızaya ve
-- veli bildirimine yalnız eğitmen kararıyla girer.
create or replace function app.lesson_claims_from_analysis(p_a jsonb) returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_it jsonb;
  v_ev jsonb;
begin
  for v_it in select x.v from jsonb_array_elements(case when jsonb_typeof(p_a -> 'skills') = 'array' then p_a -> 'skills' else '[]' end) as x (v) loop
    v_ev := v_it #> '{evidence,0}';
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', 'skill_mastery', 'skill_id', v_it -> 'skill_id', 'confidence', v_it -> 'confidence',
      'value', jsonb_build_object('mastery_estimate', v_it -> 'mastery_estimate', 'evidence_count', jsonb_array_length(coalesce(v_it -> 'evidence', '[]'))),
      'quote', v_ev -> 'quote', 'speaker', v_ev -> 'speaker', 't', v_ev -> 't', 't_end', v_ev -> 't_end'));
  end loop;
  for v_it in select x.v from jsonb_array_elements(case when jsonb_typeof(p_a -> 'misconceptions') = 'array' then p_a -> 'misconceptions' else '[]' end) as x (v) loop
    v_ev := v_it #> '{evidence,0}';
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', 'misconception', 'skill_id', v_it -> 'skill_id', 'misconception_tag', v_it -> 'tag', 'confidence', v_it -> 'confidence',
      'value', jsonb_strip_nulls(jsonb_build_object('tag', v_it -> 'tag', 'text_instructor', v_it -> 'text_instructor',
                                                    'text_student', v_it -> 'text_student', 'resolved_in_lesson', v_it -> 'resolved_in_lesson')),
      'quote', v_ev -> 'quote', 'speaker', v_ev -> 'speaker', 't', v_ev -> 't', 't_end', v_ev -> 't_end'));
  end loop;
  for v_it in select x.v from jsonb_array_elements(case when jsonb_typeof(p_a -> 'previous_profile_check') = 'array' then p_a -> 'previous_profile_check' else '[]' end) as x (v) loop
    continue when v_it ->> 'status' = 'not_observed';
    v_ev := v_it #> '{evidence,0}';
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', 'followup', 'misconception_id', v_it -> 'misconception_id', 'confidence', v_it -> 'confidence',
      'value', jsonb_build_object('status', v_it -> 'status'),
      'quote', v_ev -> 'quote', 'speaker', v_ev -> 'speaker', 't', v_ev -> 't', 't_end', v_ev -> 't_end'));
  end loop;
  for v_it in select x.v from jsonb_array_elements(case when jsonb_typeof(p_a -> 'questions') = 'array' then p_a -> 'questions' else '[]' end) as x (v) loop
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', 'question', 'skill_id', v_it -> 'skill_id', 'confidence', coalesce(v_it -> 'confidence', '1'),
      'value', jsonb_strip_nulls(jsonb_build_object('answered', v_it -> 'answered')),
      'quote', v_it -> 'quote', 'speaker', 'ÖĞRENCİ', 't', v_it -> 't'));
  end loop;
  for v_it in select x.v from jsonb_array_elements(case when jsonb_typeof(p_a -> 'hesitations') = 'array' then p_a -> 'hesitations' else '[]' end) as x (v) loop
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', 'hesitation', 'skill_id', v_it -> 'skill_id', 'confidence', coalesce(v_it -> 'confidence', '1'),
      'value', jsonb_build_object('kind', v_it -> 'kind'),
      'quote', v_it -> 'quote', 'speaker', 'ÖĞRENCİ', 't', v_it -> 't'));
  end loop;
  for v_it in select x.v from jsonb_array_elements(case when jsonb_typeof(p_a -> 'commitments') = 'array' then p_a -> 'commitments' else '[]' end) as x (v) loop
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', coalesce(v_it ->> 'kind', 'promise'),
      'confidence', case when coalesce(v_it ->> 'kind', 'promise') in ('homework', 'deadline') then null
                         else coalesce(v_it -> 'confidence', '1') end,
      'value', jsonb_strip_nulls(jsonb_build_object('who', v_it -> 'who', 'text', v_it -> 'text', 'due', v_it -> 'due')),
      'quote', v_it -> 'text', 'speaker', v_it -> 'who', 't', v_it -> 't'));
  end loop;
  if jsonb_typeof(p_a -> 'next_step') = 'object' then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', 'next_step', 'confidence', null, 'value', p_a -> 'next_step',
      'quote', p_a #> '{next_step,for_student}', 'speaker', 'EĞİTMEN', 't', '0'));
  end if;
  if jsonb_typeof(p_a -> 'talk') = 'object' then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', 'talk', 'confidence', coalesce(p_a #> '{talk,confidence}', '1'), 'value', p_a -> 'talk',
      'quote', '', 'speaker', 'EĞİTMEN', 't', '0'));  -- eğitmene özel not value.notes'ta kalır; alıntı boş (koç aramasına düşmez)
  end if;
  for v_it in select x.v from jsonb_array_elements(case when jsonb_typeof(p_a -> 'course_insights') = 'array' then p_a -> 'course_insights' else '[]' end) as x (v) loop
    v_ev := v_it #> '{evidence,0}';
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', 'course_insight', 'skill_id', v_it -> 'skill_id', 'confidence', v_it -> 'confidence',
      'value', jsonb_build_object('kind', v_it -> 'kind', 'topic', v_it -> 'topic', 'text', v_it -> 'text'),
      'quote', coalesce(v_ev -> 'quote', v_it -> 'text'), 'speaker', coalesce(v_ev -> 'speaker', '"EĞİTMEN"'),
      't', coalesce(v_ev -> 't', '0'), 't_end', v_ev -> 't_end'));
  end loop;
  return v_out;
end
$$;
comment on function app.lesson_claims_from_analysis(jsonb) is 'lesson-analysis nesnesi → iddia listesi (tür, kazanım, değer, güven, alıntı, konuşan, zaman); güven kuralı yorumda.';

-- Worker: analizi yeni sürüm olarak yazar ve iddia satırlarını açar (hepsi pending; uygulama apply_lesson_claims'te).
-- p_analysis: {analysis: lesson-analysis nesnesi, model?, cost_usd?, seed_profile?, claims?}. model/cost_usd yoksa
-- analysis.model_notes'tan. claims verilirse türetme yerine o liste kullanılır: [{kind, skill_id?, misconception_tag?,
-- misconception_id?, value (nesne), confidence? (0–1), quote, speaker, t (sn ya da 'SS:DD:ss'), t_end?}]. Kazanımı
-- dersin müfredatında yaprak olmayan skill_mastery/misconception iddiası düşer (dropped sayılır); diğer türlerde
-- geçersiz kazanım boşaltılır. Katalogda olmayan yanılgı etiketi boşaltılır (metin value.tag'da kalır); takip iddiasının
-- yanılgısı dersin kaydına ait değilse iddia düşer. Önceki sürümlerin bekleyen iddiaları reddedilir (karar veren boş),
-- uygulanmışları geri alınır (app.lesson_revert_claim; yeniden analiz kanıtı iki kez saymaz).
create or replace function public.write_lesson_analysis(p_lesson uuid, p_analysis jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_l public.lessons%rowtype;
  v_wrap jsonb;
  v_a jsonb;
  v_claims jsonb;
  v_model text;
  v_cost numeric;
  v_cur uuid;
  v_version int;
  v_id uuid;
  v_c jsonb;
  v_kind text;
  v_skill text;
  v_tag text;
  v_mc uuid;
  v_conf numeric;
  v_speaker text;
  v_t0 int;
  v_t1 int;
  v_n int := 0;
  v_dropped int := 0;
  v_old record;
  v_reverted int := 0;
  v_kept_skills text[] := '{}';
  v_kept_mcs uuid[] := '{}';
  v_uuid_re text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 ders analizini yalnız worker yazar';
  end if;
  if p_analysis is null or jsonb_typeof(p_analysis) <> 'object' then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 p_analysis bir nesne olmalı';
  end if;
  v_wrap := case when p_analysis ? 'analysis' then p_analysis else jsonb_build_object('analysis', p_analysis) end;
  v_a := v_wrap -> 'analysis';
  if jsonb_typeof(v_a) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 analysis bir nesne olmalı (lesson-analysis)';
  end if;
  if v_wrap ? 'claims' and jsonb_typeof(v_wrap -> 'claims') <> 'array' then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 claims bir dizi olmalı';
  end if;
  v_model := coalesce(nullif(v_wrap ->> 'model', ''), nullif(v_a #>> '{model_notes,model}', ''), 'unknown');
  begin
    v_cost := coalesce((v_wrap ->> 'cost_usd')::numeric, (v_a #>> '{model_notes,cost_usd}')::numeric, 0);
  exception when others then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 cost_usd bir sayı olmalı';
  end;
  if v_cost < 0 then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 cost_usd negatif olamaz';
  end if;
  select l.* into v_l from public.lessons l where l.id = p_lesson for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 ders bulunamadı';
  end if;
  select coalesce(e.curriculum_id, c.curriculum_id) into v_cur
    from public.lessons l
    left join public.enrollments e on e.id = l.enrollment_id
    left join public.courses c on c.id = l.course_id
   where l.id = p_lesson;
  if v_cur is null then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 dersin müfredatı yok';
  end if;

  update public.lesson_claims lc set status = 'rejected', decided_at = now(), decided_by = null
    from public.lesson_analyses la
   where la.id = lc.analysis_id and la.lesson_id = p_lesson and lc.status = 'pending';
  -- yeni sürüm eskisinin yerine geçer: eski sürümlerin uygulanmış iddiaları geri alınır (aynı kanıt iki kez sayılmaz).
  -- Sonra yeni kanıt geldiği için geri alınamayan (OGR-LESSON-006) iddia yerinde kalır; yeni sürümün aynı kazanım ya da
  -- yanılgı için iddiası boş güvenle eğitmen incelemesine kalır.
  for v_old in
    select lc.id, lc.skill_id, lc.misconception_id, lc.kind from public.lesson_claims lc
      join public.lesson_analyses la on la.id = lc.analysis_id
     where la.lesson_id = p_lesson and lc.applied_at is not null
     order by lc.applied_at desc, lc.t_start_sec desc, lc.created_at desc
  loop
    begin
      perform app.lesson_revert_claim(v_old.id);
      v_reverted := v_reverted + 1;
    exception when others then
      if v_old.skill_id is not null then
        v_kept_skills := v_kept_skills || v_old.skill_id;
      end if;
      if v_old.misconception_id is not null then
        v_kept_mcs := v_kept_mcs || v_old.misconception_id;
      end if;
    end;
  end loop;
  select coalesce(max(la.version), 0) + 1 into v_version from public.lesson_analyses la where la.lesson_id = p_lesson;
  insert into public.lesson_analyses (lesson_id, version, seed_profile, analysis, model, cost_usd, status)
  values (p_lesson, v_version, coalesce(v_wrap -> 'seed_profile', '{}'::jsonb), v_a, left(v_model, 120), round(v_cost, 6), 'draft')
  returning id into v_id;

  v_claims := case when v_wrap ? 'claims' then v_wrap -> 'claims' else app.lesson_claims_from_analysis(v_a) end;
  for v_c in select x.v from jsonb_array_elements(v_claims) as x (v) loop
    if jsonb_typeof(v_c) <> 'object' then
      v_dropped := v_dropped + 1;
      continue;
    end if;
    v_kind := v_c ->> 'kind';
    if v_kind is null or v_kind not in ('skill_mastery', 'misconception', 'question', 'hesitation', 'homework', 'promise',
                                        'deadline', 'next_step', 'followup', 'talk', 'course_insight') then
      v_dropped := v_dropped + 1;
      continue;
    end if;
    v_skill := nullif(v_c ->> 'skill_id', '');
    if v_skill is not null and not exists (select 1 from public.skills s
                                            where s.curriculum_id = v_cur and s.id = v_skill
                                              and (s.is_leaf or v_kind not in ('skill_mastery', 'misconception'))) then
      v_skill := null;
    end if;
    if v_kind in ('skill_mastery', 'misconception') and v_skill is null then
      v_dropped := v_dropped + 1;
      continue;
    end if;
    if v_kind = 'skill_mastery'
       and (jsonb_typeof(v_c #> '{value,mastery_estimate}') is distinct from 'number'
            or (v_c #>> '{value,mastery_estimate}')::numeric not between 0 and 1) then
      v_dropped := v_dropped + 1;
      continue;
    end if;
    v_tag := nullif(v_c ->> 'misconception_tag', '');
    if v_tag is not null and not exists (select 1 from public.misconception_tags mt where mt.tag = v_tag) then
      v_tag := null;
    end if;
    v_mc := null;
    if coalesce(v_c ->> 'misconception_id', '') ~ v_uuid_re then
      select mc.id into v_mc from public.misconceptions mc
       where mc.id = (v_c ->> 'misconception_id')::uuid and mc.enrollment_id = v_l.enrollment_id;
    end if;
    if v_kind = 'followup' and (v_mc is null or coalesce(v_c #>> '{value,status}', '') not in ('improved', 'still_present')) then
      v_dropped := v_dropped + 1;
      continue;
    end if;
    v_conf := null;
    if jsonb_typeof(v_c -> 'confidence') = 'number' or (jsonb_typeof(v_c -> 'confidence') = 'string' and v_c ->> 'confidence' ~ '^\d+(\.\d+)?$') then
      v_conf := round(least(greatest((v_c ->> 'confidence')::numeric, 0), 1), 2);
    end if;
    v_speaker := case when v_c ->> 'speaker' in ('ÖĞRENCİ', 'EĞİTMEN') then v_c ->> 'speaker'
                      when v_kind in ('question', 'hesitation', 'skill_mastery', 'misconception') then 'ÖĞRENCİ'
                      else 'EĞİTMEN' end;
    v_t0 := coalesce(app.lesson_ts_sec(v_c -> 't'), app.lesson_ts_sec(v_c -> 't_start_sec'), 0);
    v_t1 := coalesce(app.lesson_ts_sec(v_c -> 't_end'), app.lesson_ts_sec(v_c -> 't_end_sec'));
    if v_t1 is not null and v_t1 < v_t0 then
      v_t1 := null;
    end if;
    if (v_kind in ('skill_mastery', 'misconception') and v_skill = any (v_kept_skills)) or (v_mc is not null and v_mc = any (v_kept_mcs)) then
      v_conf := null;
    end if;
    insert into public.lesson_claims (analysis_id, kind, skill_id, misconception_tag, misconception_id, value, confidence,
                                      quote, speaker, t_start_sec, t_end_sec)
    values (v_id, v_kind, v_skill, v_tag, v_mc,
            case when jsonb_typeof(v_c -> 'value') = 'object' then v_c -> 'value' else jsonb_build_object('value', v_c -> 'value') end,
            v_conf, left(coalesce(v_c ->> 'quote', ''), 1000), v_speaker, v_t0, v_t1);
    v_n := v_n + 1;
  end loop;

  update public.lessons l
     set status = case when l.status in ('uploaded', 'processing', 'failed', 'approved', 'corrected') then 'analyzed' else l.status end,
         frames_count = coalesce(case when jsonb_typeof(v_a #> '{model_notes,frames}') = 'number'
                                      then least((v_a #>> '{model_notes,frames}')::numeric, 32767)::smallint end, l.frames_count),
         duration_min = coalesce(l.duration_min, case when jsonb_typeof(v_a -> 'duration_min') = 'number'
                                                      then (v_a ->> 'duration_min')::numeric::int end)
   where l.id = p_lesson;
  return jsonb_build_object('analysis_id', v_id, 'version', v_version, 'claims', v_n, 'dropped', v_dropped, 'reverted', v_reverted);
end
$$;
comment on function public.write_lesson_analysis(uuid, jsonb) is 'Worker: ders analizini yeni sürüm olarak yazar, iddiaları (lesson-analysis türetmesi ya da verilen liste) pending açar; önceki bekleyenler reddedilir.';

-- --- ayarlar ve saklama -------------------------------------------------------------------------------------------------

-- Dersi yöneten eğitmen: {student_visible?, auto_apply_threshold? (0,50–1,00), title?}. Eşik değişince bekleyen iddialar
-- kendiliğinden uygulanmaz ("Dossier'e uygula" = apply_lesson_claims).
create or replace function public.lesson_set_options(p_lesson uuid, p_options jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_o jsonb := coalesce(p_options, '{}'::jsonb);
  v_l public.lessons%rowtype;
begin
  select l.* into v_l from public.lessons l where l.id = p_lesson for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 ders bulunamadı';
  end if;
  if not app.lesson_can_manage(p_lesson) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu ders için yetki yok';
  end if;
  if jsonb_typeof(v_o) <> 'object'
     or exists (select 1 from jsonb_object_keys(v_o) as k (key) where k.key not in ('student_visible', 'auto_apply_threshold', 'title')) then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 seçenekler: student_visible, auto_apply_threshold, title';
  end if;
  if v_o ? 'student_visible' and jsonb_typeof(v_o -> 'student_visible') <> 'boolean' then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 student_visible mantıksal olmalı';
  end if;
  if v_o ? 'auto_apply_threshold'
     and (jsonb_typeof(v_o -> 'auto_apply_threshold') <> 'number' or (v_o ->> 'auto_apply_threshold')::numeric not between 0.5 and 1) then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 auto_apply_threshold 0,50–1,00 arası olmalı';
  end if;
  if v_o ? 'title' and jsonb_typeof(v_o -> 'title') not in ('string', 'null') then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 title metin olmalı';
  end if;
  update public.lessons l
     set student_visible = coalesce((v_o ->> 'student_visible')::boolean, l.student_visible),
         auto_apply_threshold = coalesce(round((v_o ->> 'auto_apply_threshold')::numeric, 2), l.auto_apply_threshold),
         title = case when v_o ? 'title' then nullif(left(btrim(coalesce(v_o ->> 'title', '')), 120), '') else l.title end
   where l.id = p_lesson
  returning l.* into v_l;
  return jsonb_build_object('lesson_id', v_l.id, 'student_visible', v_l.student_visible,
                            'auto_apply_threshold', v_l.auto_apply_threshold, 'title', v_l.title);
end
$$;
comment on function public.lesson_set_options(uuid, jsonb) is 'Dersi yöneten eğitmen: öğrenci görünürlüğü, otomatik uygulama eşiği (0,50–1,00), başlık.';

-- Worker ('lesson.retention'): silinmesi gereken ders medyası (kova her zaman 'lessons'). Öğe {lesson_id, media,
-- bucket, storage_path, paths[], upload_id}; worker paths'teki nesneleri siler (yoksa sessiz) ve lesson_mark_media_deleted
-- ile işaretler.
--   video           retain_until geçmiş ve silinmemiş ham yükleme (video ya da ses)
--   audio           çıkarılan ses: transkripti yazılmış derste hemen; düşen (failed) derste hemen; transkriptsiz ve iki
--                   günden uzun süredir ilerlemeyen derste (takılmış hat) de
--   frames          sahne kareleri '<sahip>/<ders>/frames/frame-NN.jpg' (≤ 30): ham video silinmiş, ders düşmüş ya da iki
--                   günden uzun süredir ilerlemiyor (analiz bitince worker zaten siler; bu kalanları toplar)
--   transcript_file yüklenen transkript dosyası: transkripti yazılmış derste (içe aktarma sonrası silinemediyse)
create or replace function public.lesson_retention_due(p_limit int default 100) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_out jsonb;
  v_stale timestamptz := now() - interval '2 days';
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 saklama listesini yalnız worker okur';
  end if;
  select coalesce(jsonb_agg(q.item order by q.due_at), '[]'::jsonb) into v_out
    from (select x.item, x.due_at
            from (select jsonb_build_object('lesson_id', l.id, 'media', 'video', 'bucket', 'lessons', 'storage_path', u.storage_path,
                                            'paths', jsonb_build_array(u.storage_path), 'upload_id', u.id) as item, l.retain_until as due_at
                    from public.lessons l join public.uploads u on u.id = l.upload_id
                   where l.retain_until <= now() and l.video_deleted_at is null and u.kind in ('video', 'audio')
                  union all
                  select jsonb_build_object('lesson_id', l.id, 'media', 'audio', 'bucket', 'lessons', 'storage_path', l.audio_path,
                                            'paths', jsonb_build_array(l.audio_path), 'upload_id', null),
                         coalesce(lt.updated_at, (l.progress ->> 'updated_at')::timestamptz, l.created_at)
                    from public.lessons l left join public.lesson_transcripts lt on lt.lesson_id = l.id
                   where l.audio_path is not null and l.audio_deleted_at is null
                     and (lt.id is not null or l.status = 'failed'
                          or coalesce((l.progress ->> 'updated_at')::timestamptz, l.created_at) < v_stale)
                  union all
                  select jsonb_build_object('lesson_id', f.id, 'media', 'frames', 'bucket', 'lessons', 'storage_path', f.prefix || '/frames',
                                            'paths', (select jsonb_agg(f.prefix || '/frames/frame-' || lpad(g.n::text, 2, '0') || '.jpg' order by g.n)
                                                        from generate_series(1, 30) as g (n)),
                                            'upload_id', null),
                         f.due_at
                    from (select l.id, coalesce(nullif(l.progress ->> 'media_prefix', ''), split_part(u.storage_path, '/', 1) || '/' || l.id::text) as prefix,
                                 coalesce(l.video_deleted_at, (l.progress ->> 'updated_at')::timestamptz, l.created_at) as due_at
                            from public.lessons l left join public.uploads u on u.id = l.upload_id
                           where coalesce(l.frames_count, 0) > 0 and l.frames_deleted_at is null
                             and (l.video_deleted_at is not null or l.status = 'failed'
                                  or coalesce((l.progress ->> 'updated_at')::timestamptz, l.created_at) < v_stale)) as f
                   where f.prefix ~ '^[^/]+/[^/]+$' and f.prefix !~ '(^|/)\.{1,2}(/|$)'
                  union all
                  select jsonb_build_object('lesson_id', l.id, 'media', 'transcript_file', 'bucket', 'lessons', 'storage_path', u.storage_path,
                                            'paths', jsonb_build_array(u.storage_path), 'upload_id', u.id),
                         lt.updated_at
                    from public.lessons l join public.uploads u on u.id = l.transcript_upload_id
                    join public.lesson_transcripts lt on lt.lesson_id = l.id
                   where l.transcript_deleted_at is null and u.kind = 'transcript') as x
           order by x.due_at
           limit least(greatest(coalesce(p_limit, 100), 1), 1000)) as q;
  return v_out;
end
$$;
comment on function public.lesson_retention_due(int) is 'Worker: silinecek ders medyası (süresi dolan ham video; işi biten, düşen ya da takılan dersin sesi ve kareleri; içe aktarılmış transkript dosyası).';

-- Worker: Storage nesnesini sildikten sonra işaretler. video → video_deleted_at (ders ve transkript kalır);
-- audio → audio_deleted_at, audio_path boşalır; frames → frames_deleted_at; transcript_file → transcript_deleted_at.
-- Tekrar çağrı zararsızdır.
create or replace function public.lesson_mark_media_deleted(p_lesson uuid, p_media text) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_l public.lessons%rowtype;
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 medya silme kaydını yalnız worker yazar';
  end if;
  if p_media is null or p_media not in ('video', 'audio', 'frames', 'transcript_file') then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 p_media video, audio, frames ya da transcript_file olmalı';
  end if;
  update public.lessons l
     set video_deleted_at = case when p_media = 'video' then coalesce(l.video_deleted_at, now()) else l.video_deleted_at end,
         audio_deleted_at = case when p_media = 'audio' then coalesce(l.audio_deleted_at, now()) else l.audio_deleted_at end,
         audio_path = case when p_media = 'audio' then null else l.audio_path end,
         frames_deleted_at = case when p_media = 'frames' then coalesce(l.frames_deleted_at, now()) else l.frames_deleted_at end,
         transcript_deleted_at = case when p_media = 'transcript_file' then coalesce(l.transcript_deleted_at, now()) else l.transcript_deleted_at end
   where l.id = p_lesson
  returning l.* into v_l;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 ders bulunamadı';
  end if;
  return jsonb_build_object('lesson_id', v_l.id, 'video_deleted_at', v_l.video_deleted_at, 'audio_deleted_at', v_l.audio_deleted_at,
                            'frames_deleted_at', v_l.frames_deleted_at, 'transcript_deleted_at', v_l.transcript_deleted_at);
end
$$;
comment on function public.lesson_mark_media_deleted(uuid, text) is 'Worker: ders medyası Storage''dan silindi (video, audio: audio_path boşalır, frames, transcript_file).';

-- --- retry_lesson -----------------------------------------------------------------------------------------------------

-- Düşen (failed) dersi yeniden başlatır (dersi yöneten eğitmen; worker ve admin de): ilerleme 'prepare'e döner (hata
-- temizlenir), ders ve yüklemeler processing olur ve 'lesson.prepare' işi aynı yüklemelerle yeniden atılır (yeniden
-- yükleme gerekmez). Takılan ders de (processing, ilerlemesi 2 saattir yazılmamış: işçi son denemede öldü) yeniden
-- denenir; gece saklama işi aynı eşikte bu dersleri failed yapar. Ham medya silinmişse (ve transkript yoksa) yeniden
-- işlenemez: OGR-LESSON-003.
create or replace function public.retry_lesson(p_lesson uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_l public.lessons%rowtype;
  v_kind text;
  v_job uuid;
begin
  select l.* into v_l from public.lessons l where l.id = p_lesson for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 ders bulunamadı';
  end if;
  if not app.lesson_can_manage(p_lesson) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu ders için yetki yok';
  end if;
  if v_l.status <> 'failed'
     and not (v_l.status = 'processing'
              and coalesce((v_l.progress ->> 'updated_at')::timestamptz, v_l.created_at) < now() - interval '2 hours') then
    raise exception using errcode = 'P0001', message = format('OGR-LESSON-003 yalnız düşen ya da takılan ders yeniden denenir (%s)', v_l.status);
  end if;
  select u.kind into v_kind from public.uploads u where u.id = v_l.upload_id;
  if v_kind is null
     or (v_l.video_deleted_at is not null and not exists (select 1 from public.lesson_transcripts lt where lt.lesson_id = p_lesson))
     or (v_kind = 'transcript' and v_l.transcript_deleted_at is not null
         and not exists (select 1 from public.lesson_transcripts lt where lt.lesson_id = p_lesson)) then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-003 dersin kaydı artık yok: yeniden yüklenmeli';
  end if;
  update public.lessons l
     set status = 'processing',
         progress = (l.progress - 'error') || jsonb_build_object('stage', 'prepare', 'updated_at', now(), 'retried', coalesce((l.progress ->> 'retried')::int, 0) + 1)
   where l.id = p_lesson;
  update public.uploads u set status = 'processing' where u.id in (v_l.upload_id, v_l.transcript_upload_id) and u.status = 'failed';
  v_job := app.try_enqueue('lesson.prepare', jsonb_build_object('lesson_id', p_lesson, 'upload_id', v_l.upload_id,
                                                                'transcript_upload_id', v_l.transcript_upload_id, 'upload_kind', v_kind,
                                                                'retry', true));
  return jsonb_build_object('lesson_id', p_lesson, 'status', 'processing', 'stage', 'prepare', 'job_id', v_job);
end
$$;
comment on function public.retry_lesson(uuid) is 'Dersi yöneten eğitmen: düşen ya da takılan (2 saattir ilerlemeyen) dersi aynı yüklemelerle yeniden başlatır (prepare, lesson.prepare işi).';

-- --- zamanlama ------------------------------------------------------------------------------------------------------------

-- Gece ders medyası saklama (apps/worker/src/schedules.ts 'lesson.retention' '15 4 * * *' Europe/Istanbul = 01:15 UTC).
-- pg_cron sahibi ise (0016) worker kendi zamanlamasını kurmaz; bu iş burada olmazsa 90 günlük video silme hiç çalışmazdı.
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('ogrenmen-lesson-retention', '15 1 * * *',
                          $c$select public.enqueue_job('lesson.retention', '{}'::jsonb)$c$);  -- 04:15 TRT (UTC+3)
  end if;
end
$$;

-- --- yetkiler ------------------------------------------------------------------------------------------------------------

revoke all on function app.lesson_claims_from_analysis(jsonb) from public;
grant execute on function app.lesson_claims_from_analysis(jsonb) to service_role;

revoke all on function public.register_lesson(jsonb, uuid), public.lesson_set_progress(uuid, text, jsonb),
  public.write_lesson_transcript(uuid, jsonb, text, text), public.write_lesson_analysis(uuid, jsonb),
  public.lesson_set_options(uuid, jsonb), public.lesson_retention_due(int), public.lesson_mark_media_deleted(uuid, text),
  public.retry_lesson(uuid)
  from public, anon;
-- lesson_set_progress / write_lesson_analysis / lesson_retention_due / lesson_mark_media_deleted authenticated'a açıktır
-- ama gövde app.is_trusted() ister (açık OGR-AUTH-002).
grant execute on function public.register_lesson(jsonb, uuid), public.lesson_set_progress(uuid, text, jsonb),
  public.write_lesson_transcript(uuid, jsonb, text, text), public.write_lesson_analysis(uuid, jsonb),
  public.lesson_set_options(uuid, jsonb), public.lesson_retention_due(int), public.lesson_mark_media_deleted(uuid, text),
  public.retry_lesson(uuid)
  to authenticated, service_role;
