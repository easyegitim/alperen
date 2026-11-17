-- 0039_lessons_v2.sql — P5 ders hattı veri modeli (docs/PLAN-v2.md §9; docs/PLAN-v2-detail.md §2.1).
--
-- Akış: eğitmen videoyu/sesi/transkripti 'lessons' kovasına TUS (resumable) ile yükler → register_lesson (0040) dersi
-- açar ve 'lesson.prepare' işini atar → worker aşamaları lesson_set_progress ile bildirir (prepare → stt → label →
-- analyse → apply → done | failed), transkripti write_lesson_transcript, analizi write_lesson_analysis ile yazar,
-- apply_lesson_claims (0041) güveni eşiğin üstündeki iddiaları uygular; altı eğitmen incelemesine (review_lesson_claim)
-- kalır. Ham video lessons.retain_until'e (varsayılan 90 gün) dek saklanır, STT için çıkarılan ses STT sonrası silinir
-- ('lesson.retention' işi: lesson_retention_due + lesson_mark_media_deleted), transkript kalır.
--
-- Şema ekleri: lessons (+title, duration_sec, transcript_upload_id, audio_path, audio_deleted_at, video_deleted_at,
-- retain_until, progress), lesson_claims (+applied_at, applied_ref: uygulamanın izi, geri alma için), lesson_transcripts
-- (ders başına tek satır; yalnız eğitmen ve worker okur). Sahne kareleri yalnız analiz içindir: analizden sonra, düşen
-- derste hemen, kalanı saklama işinde silinir (frames_deleted_at); yüklenen transkript dosyası içe aktarılınca silinir.
--
-- Görünürlük (0018'deki lessons/lesson_analyses/lesson_claims politikaları burada daraltılır): personel yalnız kendi
-- verdiği dersi ya da bağlı olduğu öğrencinin birebir dersini görür (app.lesson_staff_view); sınıf dersini yalnız dersi
-- veren ve özel (private) dersin oluşturanı görür. Sınıf dersinin kapsamı dersi verenin kendi öğrencileridir
-- (app.lesson_students: derse etkin kayıtlı VE dersi verene owner bağlı); ortak (shared/public) derste başka eğitmenlerin
-- öğrencilerine hafıza, öneri, bildirim ve özet gitmez, izlenceye satır yazılmaz. Öğrenci tabloları doğrudan okumaz: student_visible
-- dersinin sade alanları ve özeti yalnız list_lessons/lesson_view'dan gelir (ilerleme, maliyet, hata metni, Storage yolları,
-- transkript, analiz ve iddialar kapalı). Veli hiçbirini görmez. Yazma (inceleme, transkript
-- düzeltme, ayarlar) app.lesson_can_manage: birebir derste öğrencinin owner eğitmeni (kanıt yazımı kuralı), sınıf
-- dersinde dersi veren ya da dersi oluşturan eğitmen; admin ve güvenilir çağıran her zaman.
-- Hata kodları: OGR-LESSON-001 (geçersiz girdi), -002 (bulunamadı), -003 (durum), -004 (analiz yok), -005 (karar),
-- -006 (geri alınamaz), -007 (transkript).

-- --- şema ekleri ------------------------------------------------------------------------------------------------------

alter table public.lessons add column title text check (title is null or char_length(title) between 1 and 120);  -- Ders başlığı (ör. 'Mutlak değer ve eşitsizlikler')
alter table public.lessons add column duration_sec int check (duration_sec is null or duration_sec between 0 and 86400);  -- Süre (sn; STT ya da yükleme meta verisi)
alter table public.lessons add column transcript_upload_id uuid references public.uploads (id) on delete set null;  -- Hazır transkript yüklemesi (varsa STT atlanabilir)
alter table public.lessons add column audio_path text check (audio_path is null or (audio_path ~ '^[^/]+(/[^/]+)+$' and audio_path !~ '(^|/)\.{1,2}(/|$)'));  -- Storage ('lessons' kovası): STT için çıkarılan ses; STT sonrası silinir
alter table public.lessons add column audio_deleted_at timestamptz;  -- Çıkarılan sesin silindiği zaman
alter table public.lessons add column video_deleted_at timestamptz;  -- Ham videonun (yüklemenin) silindiği zaman
alter table public.lessons add column retain_until timestamptz;  -- Ham video saklama sonu (settings.lesson_video_retention_days, 90 gün; boş: ham medya yok)
alter table public.lessons add column progress jsonb not null default '{}' check (jsonb_typeof(progress) = 'object');  -- Hat ilerlemesi {stage: prepare|stt|label|analyse|apply|done|failed, sayaçlar, error?, updated_at}
alter table public.lessons add column frames_deleted_at timestamptz;  -- Sahne karelerinin (<sahip>/<ders>/frames/) Storage'dan silindiği zaman (analizden sonra ya da saklama işi)
alter table public.lessons add column transcript_deleted_at timestamptz;  -- Yüklenen transkript dosyasının içe aktarıldıktan sonra Storage'dan silindiği zaman
comment on column public.lessons.title is 'Ders başlığı (ör. ''Mutlak değer ve eşitsizlikler'')';
comment on column public.lessons.duration_sec is 'Süre (sn; STT ya da yükleme meta verisi)';
comment on column public.lessons.transcript_upload_id is 'Hazır transkript yüklemesi (varsa STT atlanabilir)';
comment on column public.lessons.audio_path is 'Storage (''lessons'' kovası): STT için çıkarılan ses; STT sonrası silinir';
comment on column public.lessons.audio_deleted_at is 'Çıkarılan sesin silindiği zaman';
comment on column public.lessons.video_deleted_at is 'Ham videonun (yüklemenin) silindiği zaman';
comment on column public.lessons.retain_until is 'Ham video saklama sonu (settings.lesson_video_retention_days, 90 gün; boş: ham medya yok)';
comment on column public.lessons.progress is 'Hat ilerlemesi {stage: prepare|stt|label|analyse|apply|done|failed, sayaçlar, error?, updated_at}';
comment on column public.lessons.frames_deleted_at is 'Sahne karelerinin (<sahip>/<ders>/frames/) Storage''dan silindiği zaman (analizden sonra ya da saklama işi)';
comment on column public.lessons.transcript_deleted_at is 'Yüklenen transkript dosyasının içe aktarıldıktan sonra Storage''dan silindiği zaman';

create unique index lessons_upload_unique on public.lessons (upload_id) where upload_id is not null;
create index lessons_retention on public.lessons (retain_until) where video_deleted_at is null and retain_until is not null;
create index lessons_instructor on public.lessons (instructor_id, held_at desc);

alter table public.lesson_claims add column applied_at timestamptz;  -- Öğrenen modele uygulandığı zaman (boş: uygulanmadı ya da geri alındı)
alter table public.lesson_claims add column applied_ref jsonb check (applied_ref is null or jsonb_typeof(applied_ref) = 'object');  -- Uygulamanın izi {observation_id, misconception_id, resolved_misconception_id, prev_status, syllabus_topic_id, reverted_at}
comment on column public.lesson_claims.applied_at is 'Öğrenen modele uygulandığı zaman (boş: uygulanmadı ya da geri alındı)';
comment on column public.lesson_claims.applied_ref is 'Uygulamanın izi {observation_id, misconception_id, resolved_misconception_id, prev_status, syllabus_topic_id, reverted_at}';

create table public.lesson_transcripts (  -- Ders transkripti: konuşmacı etiketli bölümler; yalnız eğitmen (lesson_staff_view) ve worker okur.
  id uuid primary key default gen_random_uuid(),  -- Transkript kimliği
  lesson_id uuid not null unique references public.lessons (id) on delete cascade,  -- Ders (ders başına tek transkript)
  segments jsonb not null check (jsonb_typeof(segments) = 'array'),  -- Bölümler [{t0, t1, speaker: ÖĞRENCİ|EĞİTMEN|DİĞER|null, text}] (sn)
  language text not null default 'tr' check (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),  -- Dil (BCP 47 kısa)
  provider text not null check (provider in ('groq', 'elevenlabs', 'fake', 'upload', 'manual')),  -- Kaynak: STT sağlayıcısı, yüklenen dosya ya da eğitmen düzeltmesi
  labeled boolean not null default false,  -- Tüm bölümlerde konuşmacı etiketi var mı (label aşaması)
  segment_count int not null default 0 check (segment_count >= 0),  -- Bölüm sayısı
  edited_by uuid references public.profiles (id) on delete set null,  -- Son düzelten eğitmen (worker yazımında boş)
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  updated_at timestamptz not null default now()  -- Son yazım
);
-- begin comments public.lesson_transcripts
comment on table public.lesson_transcripts is 'Ders transkripti: konuşmacı etiketli bölümler; yalnız eğitmen (lesson_staff_view) ve worker okur.';
comment on column public.lesson_transcripts.id is 'Transkript kimliği';
comment on column public.lesson_transcripts.lesson_id is 'Ders (ders başına tek transkript)';
comment on column public.lesson_transcripts.segments is 'Bölümler [{t0, t1, speaker: ÖĞRENCİ|EĞİTMEN|DİĞER|null, text}] (sn)';
comment on column public.lesson_transcripts.language is 'Dil (BCP 47 kısa)';
comment on column public.lesson_transcripts.provider is 'Kaynak: STT sağlayıcısı, yüklenen dosya ya da eğitmen düzeltmesi';
comment on column public.lesson_transcripts.labeled is 'Tüm bölümlerde konuşmacı etiketi var mı (label aşaması)';
comment on column public.lesson_transcripts.segment_count is 'Bölüm sayısı';
comment on column public.lesson_transcripts.edited_by is 'Son düzelten eğitmen (worker yazımında boş)';
comment on column public.lesson_transcripts.created_at is 'Oluşturulma zamanı';
comment on column public.lesson_transcripts.updated_at is 'Son yazım';
-- end comments public.lesson_transcripts
alter table public.lesson_transcripts enable row level security;
alter table public.lesson_transcripts force row level security;

insert into public.settings (key, value, description) values
  ('lesson_video_retention_days', '90', 'Ders ham videosunun saklama süresi (gün); sonra lesson.retention siler'),
  ('lesson_misconception_value', '0.3', 'Ders yanılgı iddiasının ders gözlemi değeri (blend; düşük ustalık kanıtı)'),
  ('lesson_followup_resolved_value', '0.8', 'Önceki yanılgı derste düzelmiş: ders gözlemi değeri (yanılgı çözülür)'),
  ('lesson_followup_present_value', '0.3', 'Önceki yanılgı derste sürüyor: ders gözlemi değeri')
on conflict (key) do nothing;

-- --- yardımcılar ------------------------------------------------------------------------------------------------------

-- Personel (eğitmen/admin) dersi görebilir mi: admin, güvenilir çağıran, dersi veren eğitmen; birebir derste öğrenciye
-- bağlı eğitmen (owner ya da viewer); sınıf dersinde yalnız özel (private) dersin oluşturanı. Aynı ortak derste öğrencisi
-- olan başka eğitmen sınıf dersini (transkript, iddialar) görmez. Öğrenci ve veli için her zaman false.
create or replace function app.lesson_staff_view(p_lesson uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_l public.lessons%rowtype;
begin
  select l.* into v_l from public.lessons l where l.id = p_lesson;
  if not found then
    return false;
  end if;
  if app.is_trusted() or app.is_admin() then
    return true;
  end if;
  if auth.uid() is null or app.role() is distinct from 'instructor' then
    return false;
  end if;
  if v_l.instructor_id = auth.uid() then
    return true;
  end if;
  if v_l.enrollment_id is not null then
    return exists (select 1 from app.my_students() as m (sid) where m.sid = app.student_of_enrollment(v_l.enrollment_id));
  end if;
  return exists (select 1 from public.courses co
                  where co.id = v_l.course_id and co.created_by = auth.uid() and co.visibility = 'private');
end
$$;
comment on function app.lesson_staff_view(uuid) is 'Personel dersi (transkript, analiz, iddialar) görebilir mi: admin, worker, dersi veren, birebir derste öğrenciye bağlı eğitmen; sınıf dersinde yalnız özel dersin oluşturanı.';

-- Dersi yönetebilir mi (inceleme, transkript düzeltme, ayarlar, uygulama): admin, güvenilir çağıran; birebir derste
-- öğrencinin owner eğitmeni (kanıt yazımı kuralı: app.assert_evidence_writer); sınıf dersinde dersi veren ya da özel
-- (private) dersin oluşturanı.
create or replace function app.lesson_can_manage(p_lesson uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_l public.lessons%rowtype;
begin
  select l.* into v_l from public.lessons l where l.id = p_lesson;
  if not found then
    return false;
  end if;
  if app.is_trusted() or app.is_admin() then
    return true;
  end if;
  if auth.uid() is null or app.role() is distinct from 'instructor' then
    return false;
  end if;
  if v_l.enrollment_id is not null then
    return exists (select 1 from public.instructor_links il
                    where il.instructor_id = auth.uid() and il.role = 'owner'
                      and il.student_id = app.student_of_enrollment(v_l.enrollment_id));
  end if;
  return v_l.instructor_id = auth.uid()
      or exists (select 1 from public.courses co
                  where co.id = v_l.course_id and co.created_by = auth.uid() and co.visibility = 'private');
end
$$;
comment on function app.lesson_can_manage(uuid) is 'Dersi yönetebilir mi: admin, worker; birebir derste owner eğitmen, sınıf dersinde dersi veren ya da özel dersin oluşturanı.';

-- Öğrenci dersin özetini görebilir mi: student_visible ve kendi kaydı (birebir) ya da sınıf dersinin kapsamında
-- (app.lesson_students: derse kayıtlı ve dersi verene bağlı).
create or replace function app.lesson_student_view(p_lesson uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_l public.lessons%rowtype;
  v_me uuid := app.my_student_id();
begin
  if v_me is null then
    return false;
  end if;
  select l.* into v_l from public.lessons l where l.id = p_lesson;
  if not found or not v_l.student_visible then
    return false;
  end if;
  if v_l.enrollment_id is not null then
    return app.student_of_enrollment(v_l.enrollment_id) = v_me;
  end if;
  return v_me = any (app.lesson_students(p_lesson));
end
$$;
comment on function app.lesson_student_view(uuid) is 'Öğrenci dersin özetini görebilir mi: student_visible ve kendi kaydı ya da sınıf dersinin kapsamı (app.lesson_students).';

-- Dersin öğrencileri: birebir derste kaydın öğrencisi; sınıf dersinde derse etkin kayıtlı VE dersi veren eğitmene
-- (dersi veren yoksa dersin oluşturanına) owner bağlı öğrenciler (bağ tüm dersler için ya da bu ders için). Ortak
-- (shared/public) derste başka eğitmenlerin öğrencileri kapsam dışıdır: hafıza (memory.apply), öneri, veli bildirimi,
-- özet görünürlüğü ve ad temizliği bu listeyi kullanır (worker da: select unnest(app.lesson_students(...))).
create or replace function app.lesson_students(p_lesson uuid) returns uuid[]
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_l public.lessons%rowtype;
  v_ids uuid[];
begin
  select l.* into v_l from public.lessons l where l.id = p_lesson;
  if not found then
    return '{}';
  end if;
  if v_l.enrollment_id is not null then
    select array_agg(e.student_id) into v_ids from public.enrollments e where e.id = v_l.enrollment_id;
  else
    select array_agg(distinct e.student_id) into v_ids
      from public.enrollments e
     where e.course_id = v_l.course_id and e.status = 'active'
       and exists (select 1 from public.instructor_links il
                    where il.student_id = e.student_id and il.role = 'owner'
                      and (il.course_id is null or il.course_id = v_l.course_id)
                      and il.instructor_id = coalesce(v_l.instructor_id,
                                                      (select co.created_by from public.courses co where co.id = v_l.course_id)));
  end if;
  return coalesce(v_ids, '{}');
end
$$;
comment on function app.lesson_students(uuid) is 'Dersin öğrencileri: birebir derste kaydın öğrencisi; sınıf dersinde etkin kayıtlı ve dersi verene owner bağlı öğrenciler.';

-- Zaman damgası → saniye: 'SS:DD:ss(.ms)', 'DD:ss' ya da sayı (sn). Geçersiz/boş → null.
create or replace function app.lesson_ts_sec(p_t jsonb) returns int
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_s text;
  v_parts text[];
begin
  if p_t is null or jsonb_typeof(p_t) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_t) = 'number' then
    return case when (p_t #>> '{}')::numeric >= 0 then floor((p_t #>> '{}')::numeric)::int end;
  end if;
  if jsonb_typeof(p_t) <> 'string' then
    return null;
  end if;
  v_s := btrim(p_t #>> '{}');
  if v_s ~ '^\d+(\.\d+)?$' then
    return floor(v_s::numeric)::int;
  end if;
  if v_s !~ '^\d{1,2}(:\d{1,2}){1,2}(\.\d+)?$' then
    return null;
  end if;
  v_parts := string_to_array(split_part(v_s, '.', 1), ':');
  if array_length(v_parts, 1) = 3 then
    return v_parts[1]::int * 3600 + v_parts[2]::int * 60 + v_parts[3]::int;
  end if;
  return v_parts[1]::int * 60 + v_parts[2]::int;
end
$$;
comment on function app.lesson_ts_sec(jsonb) is 'Ders zaman damgası (''SS:DD:ss'', ''DD:ss'' ya da sayı) → saniye; geçersizse null.';

create or replace function app.lesson_hms(p_sec int) returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_sec is null then null
              else lpad((p_sec / 3600)::text, 2, '0') || ':' || lpad(((p_sec % 3600) / 60)::text, 2, '0') || ':'
                   || lpad((p_sec % 60)::text, 2, '0') end
$$;
comment on function app.lesson_hms(int) is 'Saniye → ''SS:DD:ss''.';

-- Dersin sıra numarası (aynı kayıt ya da aynı eğitmenin aynı dersteki sınıf dersleri içinde ders zamanına göre): 'Ders 12'.
create or replace function app.lesson_no(p_lesson uuid) returns int
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_l public.lessons%rowtype;
  v_n int;
begin
  select l.* into v_l from public.lessons l where l.id = p_lesson;
  if not found then
    return null;
  end if;
  select count(*) into v_n from public.lessons o
   where ((v_l.enrollment_id is not null and o.enrollment_id = v_l.enrollment_id)
          or (v_l.enrollment_id is null and o.enrollment_id is null and o.course_id = v_l.course_id
              and o.instructor_id is not distinct from v_l.instructor_id))
     and (o.held_at < v_l.held_at or (o.held_at = v_l.held_at and o.created_at <= v_l.created_at));
  return v_n;
end
$$;
comment on function app.lesson_no(uuid) is 'Dersin sıra numarası (aynı kayıt ya da sınıf dersi içinde ders zamanına göre).';

-- Storage nesnesi bir dersin yüklemesi mi ve çağıran o dersi görebilir mi (lessons kovası okuma politikası).
create or replace function app.lesson_object_visible(p_name text) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if p_name is null or auth.uid() is null then
    return false;
  end if;
  return exists (select 1 from public.lessons l
                   join public.uploads u on u.id in (l.upload_id, l.transcript_upload_id)
                  where u.storage_path = p_name and app.lesson_staff_view(l.id));
end
$$;
comment on function app.lesson_object_visible(text) is '''lessons'' kovasındaki nesne görülebilen bir dersin yüklemesi mi (personel; öğrenci/veli asla).';

-- --- RLS: 0018'deki ders politikaları daraltılır ---------------------------------------------------------------------

drop policy if exists lessons_select on public.lessons;
drop policy if exists lesson_analyses_select_staff on public.lesson_analyses;
drop policy if exists lesson_claims_select_staff on public.lesson_claims;

-- öğrenci dalı yok: öğrenci okumaları security definer list_lessons/lesson_view'dan geçer (satırın tamamı açılmaz)
create policy lessons_select on public.lessons for select to authenticated
using (app.lesson_staff_view(id));
create policy lesson_analyses_select_staff on public.lesson_analyses for select to authenticated
using (app.lesson_staff_view(lesson_id));
create policy lesson_claims_select_staff on public.lesson_claims for select to authenticated
using (exists (select 1 from public.lesson_analyses as la where la.id = lesson_claims.analysis_id and app.lesson_staff_view(la.lesson_id)));
create policy lesson_transcripts_select_staff on public.lesson_transcripts for select to authenticated
using (app.lesson_staff_view(lesson_id));
grant select on public.lesson_transcripts to authenticated;

-- --- Storage: 'lessons' kovası (TUS resumable) ------------------------------------------------------------------------
-- Kova 0015'te açılır; hattın türettiği sahne kareleri (image/jpeg) ve tarayıcının .wav için gönderebileceği audio/x-wav
-- izin listesine eklenir (yoksa Storage 415 invalid_mime_type ile reddeder ve her video dersi prepare'de düşer).
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets yok (yerel Postgres): lessons kovası MIME listesi atlandı';
    return;
  end if;
  update storage.buckets b
     set allowed_mime_types = array(select distinct m.t from unnest(b.allowed_mime_types || array['image/jpeg', 'audio/x-wav']) as m (t)
                                     order by m.t)
   where b.id = 'lessons' and b.allowed_mime_types is not null;  -- boş liste: her tür serbest (dokunulmaz)
end
$$;

-- Eğitmen yalnız kendi klasörüne (<auth.uid()>/…) yazar; TUS yeniden başlatma ve x-upsert için aynı klasörde update ve
-- select (yarım yüklemeyi sürdürmek), iptal için delete. Okuma ayrıca görebildiği dersin yüklemesine açıktır
-- (app.lesson_object_visible). Öğrenci ve veli kovaya hiç erişmez; worker service_role ile (politikasız) okur/siler.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects yok (yerel Postgres): lessons kovası politikaları atlandı';
    return;
  end if;
  execute $p$drop policy if exists ogrenmen_lessons_staff on storage.objects$p$;
  execute $p$drop policy if exists ogrenmen_lessons_insert on storage.objects$p$;
  execute $p$create policy ogrenmen_lessons_insert on storage.objects for insert to authenticated
           with check (bucket_id = 'lessons' and app.is_staff() and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute $p$drop policy if exists ogrenmen_lessons_update on storage.objects$p$;
  execute $p$create policy ogrenmen_lessons_update on storage.objects for update to authenticated
           using (bucket_id = 'lessons' and app.is_staff() and (storage.foldername(name))[1] = auth.uid()::text)
           with check (bucket_id = 'lessons' and app.is_staff() and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute $p$drop policy if exists ogrenmen_lessons_select on storage.objects$p$;
  execute $p$create policy ogrenmen_lessons_select on storage.objects for select to authenticated
           using (bucket_id = 'lessons'
                  and ((app.is_staff() and (storage.foldername(name))[1] = auth.uid()::text)
                       or app.is_admin()
                       or app.lesson_object_visible(name)))$p$;
  execute $p$drop policy if exists ogrenmen_lessons_delete on storage.objects$p$;
  execute $p$create policy ogrenmen_lessons_delete on storage.objects for delete to authenticated
           using (bucket_id = 'lessons' and app.is_staff() and (storage.foldername(name))[1] = auth.uid()::text)$p$;
end
$$;

-- --- yetkiler ------------------------------------------------------------------------------------------------------------

revoke all on function app.lesson_staff_view(uuid), app.lesson_can_manage(uuid), app.lesson_student_view(uuid),
  app.lesson_students(uuid), app.lesson_ts_sec(jsonb), app.lesson_hms(int), app.lesson_no(uuid),
  app.lesson_object_visible(text) from public;
grant execute on function app.lesson_staff_view(uuid), app.lesson_can_manage(uuid), app.lesson_student_view(uuid),
  app.lesson_object_visible(text) to authenticated, service_role;
grant execute on function app.lesson_students(uuid), app.lesson_ts_sec(jsonb), app.lesson_hms(int), app.lesson_no(uuid) to service_role;
