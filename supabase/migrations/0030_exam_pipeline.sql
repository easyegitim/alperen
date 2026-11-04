-- 0030_exam_pipeline.sql — P2 deneme hattı, yükleme yolu (docs/PLAN-v2.md §2 Akış 2a, §8; docs/PLAN-v2-detail.md §2).
--
-- Şema ekleri:
--   exams.duration_min (uygulama içi zamanlayıcı), exams.answer_key_source (anahtarın kaynağı: uploaded | inferred |
--   instructor | generated | mixed; boş = henüz anahtar yok), exam_questions.page_upload_id + bbox (sorunun kitapçık
--   fotoğrafındaki kırpımı; öğrenci telifli sınavda metin yerine kendi kırpıntısını görür), exam_sessions.progress
--   (analiz aşaması + sayaçlar; web yoklar), exam_sessions.upload_ids (yüklenen sayfalar), exam_responses.blank_reason
--   (boş/yetişmeyen soru için öğrencinin nedeni). v_exam_questions_student yeni sütunlarla yeniden kurulur.
--
-- Akış (yükleme): öğrenci submit_exam_upload → exams(deneme, uploaded, telifli, processing) + exam_sessions(uploaded,
-- grading, progress.stage = classify) + 'exam.analyse' işi. Worker (güvenilir çağıran) aşamaları set_exam_progress ile
-- bildirir, soruları register_exam_questions, anahtarı set_exam_keys, optik form cevaplarını record_exam_answers ile
-- yazar, sonra grade_exam_session'ı çağırır (yüklenen oturumu öğrenci notlayamaz). Sonuç ekranı exam_session_view'dur;
-- her yanlış/boş için öğrenci exam_how_far (metin/fotoğraf → 'diagnosis.run' deneme bağlamıyla) ya da
-- exam_blank_reason (hiç başlayamadım / süre yetmedi) çağırır.
-- Uygulama içi akış 0031'de (start_exam_session(p_exam), record_exam_response süre denetimi, finish_exam_session).
-- secure.exam_answer_keys'i yalnız SECURITY DEFINER fonksiyonlar okur/yazar; öğrenciye dönen hiçbir yapı anahtar taşımaz.
-- Yüklenen deneme öğrenciye özeldir (PLAN §4): okuma app.can_read_exam (worker, admin, öğrencinin kendisi, ona bağlı
-- eğitmen; exams_select, exam_questions_select_staff, v_exam_questions_student, app.exam_visible, peek_answer_key),
-- yazma app.can_edit_exam (worker, admin, öğrencinin owner eğitmeni; set_exam_key, set_exam_keys,
-- register_exam_questions). Notlanmış oturumu olan sınavın anahtarı da soruları da değişmez (OGR-EXAM-003). Okul
-- denemesinin tek giriş yolu submit_exam_upload'dur (submit_upload 'school_exam' OGR-UPL-001).

-- --- şema ekleri -------------------------------------------------------------------------------------

alter table public.exams add column duration_min int check (duration_min between 1 and 600);  -- Uygulama içi süre (dk; boş: bölüm dakikalarının toplamı ya da süresiz)
alter table public.exams add column answer_key_source text check (answer_key_source in ('uploaded', 'inferred', 'instructor', 'generated', 'mixed'));  -- Anahtarın kaynağı (boş: anahtar yok)
comment on column public.exams.duration_min is 'Uygulama içi süre (dk; boş: bölüm dakikalarının toplamı ya da süresiz)';
comment on column public.exams.answer_key_source is 'Anahtarın kaynağı (boş: anahtar yok)';

alter table public.exam_questions add column page_upload_id uuid references public.uploads (id) on delete set null;  -- Sorunun bulunduğu kitapçık sayfası (yükleme)
alter table public.exam_questions add column bbox jsonb check (bbox is null or (jsonb_typeof(bbox) = 'object' and bbox ?& array['x', 'y', 'w', 'h']));  -- Sayfadaki kırpım kutusu {x, y, w, h} (0..1 oranlı)
comment on column public.exam_questions.page_upload_id is 'Sorunun bulunduğu kitapçık sayfası (yükleme)';
comment on column public.exam_questions.bbox is 'Sayfadaki kırpım kutusu {x, y, w, h} (0..1 oranlı)';

alter table public.exam_sessions add column progress jsonb not null default '{}' check (jsonb_typeof(progress) = 'object');  -- Analiz ilerlemesi {stage: classify|ocr|key|grade|analyse|report|done|failed, sayaçlar, updated_at}
alter table public.exam_sessions add column upload_ids uuid[] not null default '{}';  -- Yüklenen sayfalar (mode = uploaded)
comment on column public.exam_sessions.progress is 'Analiz ilerlemesi {stage: classify|ocr|key|grade|analyse|report|done|failed, sayaçlar, updated_at}';
comment on column public.exam_sessions.upload_ids is 'Yüklenen sayfalar (mode = uploaded)';

alter table public.exam_responses add column blank_reason text check (blank_reason in ('not_started', 'time'));  -- Boş bırakma nedeni (öğrenci: hiç başlayamadım | süre yetmedi)
comment on column public.exam_responses.blank_reason is 'Boş bırakma nedeni (öğrenci: hiç başlayamadım | süre yetmedi)';

create index exam_sessions_exam on public.exam_sessions (exam_id);

-- Sınavı (satırı, soruları, kırpımları, anahtar peek'i) okuyabilir mi. Yüklenen deneme (source = 'uploaded') öğrenciye
-- özeldir: worker, admin ya da oturumunun öğrencisinin öğrenme verisini okuyabilen (öğrencinin kendisi, ona bağlı
-- eğitmen; can_read_student_data, veli hariç). Diğer sınavlar: worker, admin, eğitmen (0018'deki personel kuralı).
-- Öğrenci/veli için oturum ve görünürlük dalları ayrıca politikalarda (exams_select) ve app.exam_visible'dadır.
create or replace function app.can_read_exam(p_exam uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_source text;
begin
  select x.source into v_source from public.exams x where x.id = p_exam;
  if not found then
    return false;
  end if;
  if app.is_trusted() or app.is_admin() then
    return true;
  end if;
  if v_source = 'uploaded' then
    return exists (select 1 from public.exam_sessions es join public.enrollments e on e.id = es.enrollment_id
                    where es.exam_id = p_exam and app.can_read_student_data(e.student_id));
  end if;
  return app.is_staff();
end
$$;
comment on function app.can_read_exam(uuid) is 'Sınavı okuyabilir mi: worker, admin; yüklenen denemede öğrencinin kendisi ve bağlı eğitmen, diğerlerinde eğitmen.';

-- v_exam_questions_student: sona page_upload_id ve bbox eklenir (öğrencinin kendi kırpıntısı; telifli sınavda da görünür)
create or replace view public.v_exam_questions_student with (security_barrier = true) as
select q.id,
       q.exam_id,
       q.no,
       q.section,
       q.kind,
       case when x.is_copyrighted then null else q.stem_text end as stem_text,
       case when jsonb_typeof(q.options) <> 'array' then q.options
            else (select jsonb_agg(case when x.is_copyrighted then jsonb_build_object('key', o.opt -> 'key')
                                        else o.opt - 'misconception_tag' end order by o.ord)
                    from jsonb_array_elements(q.options) with ordinality as o (opt, ord)) end as options,
       x.is_copyrighted,
       q.figure_upload_id,
       q.skill_ids,
       q.style_id,
       q.difficulty,
       q.page_upload_id,
       q.bbox
  from public.exam_questions as q
  join public.exams as x on x.id = q.exam_id
 where app.is_trusted()
    or (app.is_staff() and app.can_read_exam(q.exam_id))
    or exists (select 1 from public.exam_sessions as es join public.enrollments as e on e.id = es.enrollment_id
                where es.exam_id = q.exam_id and e.student_id = app.my_student_id());
comment on view public.v_exam_questions_student is 'Öğrencinin oturumu olan sınavların soruları (personel: app.can_read_exam); telifli sınavda soru metni ve şık metinleri maskeli, yanılgı etiketleri yok; kitapçık kırpımı (page_upload_id, bbox) görünür.';

-- 0018 politikaları: personel dalı app.can_read_exam (yüklenen deneme yalnız bağlı eğitmene); öğrenci/veli dalları aynen
drop policy exams_select on public.exams;
create policy exams_select on public.exams for select to authenticated
using (app.can_read_exam(id)
       or created_by = auth.uid()
       or exists (select 1 from public.exam_sessions as es where es.exam_id = exams.id)
       or app.exam_visible(id, app.my_student_id()));
drop policy exam_questions_select_staff on public.exam_questions;
create policy exam_questions_select_staff on public.exam_questions for select to authenticated
using (app.is_staff() and app.can_read_exam(exam_id));

-- Realtime (yalnız Supabase'de yayın vardır): analiz ilerlemesi
do $$
begin
  if exists (select 1 from pg_publication p where p.pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables pt
                      where pt.pubname = 'supabase_realtime' and pt.schemaname = 'public' and pt.tablename = 'exam_sessions') then
    execute 'alter publication supabase_realtime add table public.exam_sessions';
  end if;
end
$$;

-- --- yardımcılar ---------------------------------------------------------------------------------------

-- Sınavı düzenleyebilir mi (soru/anahtar yazımı): güvenilir çağıran (worker), admin; yüklenen denemede (öğrenciye özel)
-- yalnız oturumunun öğrencisinin owner eğitmeni (assert_student_access(öğrenci, yazma) ile aynı); diğer sınavlarda
-- sınavın eğitmeni (oluşturan, dersin sahibi ya da derse bağlı eğitmen). set_exam_key, set_exam_keys,
-- register_exam_questions kullanır.
create or replace function app.can_edit_exam(p_exam uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_course uuid;
  v_creator uuid;
  v_source text;
begin
  select x.course_id, x.created_by, x.source into v_course, v_creator, v_source from public.exams x where x.id = p_exam;
  if not found then
    return false;
  end if;
  if app.is_trusted() or app.is_admin() then
    return true;
  end if;
  if app.role() is distinct from 'instructor' then
    return false;
  end if;
  if v_source = 'uploaded' then
    return exists (select 1 from public.exam_sessions es
                     join public.enrollments e on e.id = es.enrollment_id
                     join public.instructor_links il on il.student_id = e.student_id
                    where es.exam_id = p_exam and il.instructor_id = auth.uid() and il.role = 'owner');
  end if;
  return v_creator = auth.uid()
      or exists (select 1 from public.courses co where co.id = v_course and co.created_by = auth.uid())
      or exists (select 1 from public.instructor_links il where il.instructor_id = auth.uid() and il.course_id = v_course);
end
$$;
comment on function app.can_edit_exam(uuid) is 'Sınavın sorularını/anahtarını yazabilir mi: worker, admin; yüklenen denemede öğrencinin owner eğitmeni, diğerlerinde sınavın eğitmeni.';

-- Notlanmış (analysing/done) oturumu olan sınav: anahtar ve sorular değişmez (skor, outcome, gözlemler eski anahtarla
-- yazıldı; paylaşılan sınavda erken ve geç bitirenler farklı anahtarla notlanırdı). Notlama sonrası düzeltme ayrı bir
-- yeniden notlama RPC'si olarak eklenir.
create or replace function app.exam_has_graded_session(p_exam uuid) returns boolean
language sql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
  select exists (select 1 from public.exam_sessions es where es.exam_id = p_exam and es.status in ('analysing', 'done'))
$$;
comment on function app.exam_has_graded_session(uuid) is 'Sınavın notlanmış (analysing/done) oturumu var mı (anahtar/soru yazımı kilidi).';

-- 0017 app.exam_visible: personel dalı app.can_read_exam (yüklenen deneme yalnız bağlı eğitmene; start_exam_session
-- başkasının denemesini bir öğrenciye bu yoldan açamaz); geri kalanı aynen.
create or replace function app.exam_visible(p_exam uuid, p_student uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_x public.exams%rowtype;
  v_doc_student uuid;
begin
  select x.* into v_x from public.exams x where x.id = p_exam;
  if not found then
    return false;
  end if;
  if app.is_trusted() or app.can_read_exam(p_exam) or coalesce(v_x.created_by = auth.uid(), false) then
    return true;
  end if;
  if p_student is null then
    return false;
  end if;
  if v_x.generated_document_id is not null then
    select gd.student_id into v_doc_student from public.generated_documents gd where gd.id = v_x.generated_document_id;
    if v_doc_student is not null then
      return v_doc_student = p_student;
    end if;
  end if;
  return v_x.status in ('ready', 'published') and v_x.kind in ('published', 'practice', 'diagnostic')
     and exists (select 1 from public.enrollments e
                  where e.student_id = p_student and (e.course_id = v_x.course_id or e.curriculum_id = v_x.curriculum_id));
end
$$;
comment on function app.exam_visible(uuid, uuid) is 'Sınav öğrenciye görünür mü (oturumsuz kural): worker, app.can_read_exam, oluşturan, kişiye üretilmiş sınavın öğrencisi, kayıtlı dersin yayımlanmış sınavı.';

-- Sınav süresi (dk): exams.duration_min, yoksa sections[].minutes toplamı, o da yoksa null (süresiz)
create or replace function app.exam_duration_min(p_exam uuid) returns int
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_min int;
  v_sections jsonb;
begin
  select x.duration_min, x.sections into v_min, v_sections from public.exams x where x.id = p_exam;
  if v_min is null and jsonb_typeof(v_sections) = 'array' then
    select nullif(sum((s.e ->> 'minutes')::int) filter (where (s.e ->> 'minutes') ~ '^[0-9]+$'), 0)::int into v_min
      from jsonb_array_elements(v_sections) as s (e);
  end if;
  return v_min;
end
$$;
comment on function app.exam_duration_min(uuid) is 'Sınav süresi (dk): duration_min, yoksa bölüm dakikalarının toplamı, yoksa null.';

-- Oturumun bitiş sınırı: uygulama içi oturumda started_at + süre; yükleme ya da süresiz sınavda null
create or replace function app.exam_deadline(p_session uuid) returns timestamptz
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_s public.exam_sessions%rowtype;
  v_min int;
begin
  select es.* into v_s from public.exam_sessions es where es.id = p_session;
  if not found or v_s.mode <> 'in_app' then
    return null;
  end if;
  v_min := app.exam_duration_min(v_s.exam_id);
  return case when v_min is null then null else v_s.started_at + make_interval(mins => v_min) end;
end
$$;
comment on function app.exam_deadline(uuid) is 'Uygulama içi oturumun bitiş sınırı (started_at + süre); süresiz ya da yüklemede null.';

-- "Okul denemesi · 3 Kas" (Europe/Istanbul; worker schoolExamTitle ile aynı biçim)
create or replace function app.exam_default_title(p_at timestamptz) returns text
language plpgsql
stable
set search_path = pg_catalog, app
as $$
declare
  v_local timestamp := p_at at time zone 'Europe/Istanbul';
begin
  return 'Okul denemesi · ' || extract(day from v_local)::int || ' '
         || (array['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'])[extract(month from v_local)::int];
end
$$;
comment on function app.exam_default_title(timestamptz) is 'Yüklenen denemenin varsayılan başlığı: "Okul denemesi · <gün> <ay kısaltması>" (İstanbul saati).';

-- Sayıyı Türkçe yazar: 26.25 → '26,25', 10.00 → '10'
create or replace function app.tr_num(p_n numeric) returns text
language plpgsql
immutable
set search_path = pg_catalog, app
as $$
declare
  v_t text;
begin
  if p_n is null then
    return null;
  end if;
  v_t := round(p_n, 2)::text;
  if position('.' in v_t) > 0 then
    v_t := rtrim(rtrim(v_t, '0'), '.');
  end if;
  return replace(v_t, '.', ',');
end
$$;
comment on function app.tr_num(numeric) is 'Sayıyı Türkçe ondalıkla yazar (26,25; tam sayıda ondalık yok).';

-- exam_how_far yeniden deneme anahtarı: {text_md5, upload_ids (sıralı)}
create or replace function app.exam_how_far_key(p_text text, p_upload_ids uuid[]) returns jsonb
language sql
immutable
set search_path = pg_catalog, app
as $$
  select jsonb_build_object('text_md5', md5(coalesce(nullif(btrim(p_text), ''), '')),
                            'upload_ids', (select coalesce(jsonb_agg(x.u order by x.u), '[]'::jsonb) from unnest(coalesce(p_upload_ids, '{}')) as x (u)))
$$;
comment on function app.exam_how_far_key(text, uuid[]) is 'exam_how_far yeniden deneme anahtarı: metnin md5''i ve sıralı fotoğraf kimlikleri.';

-- Cevabın "nereye kadar geldim" teşhis denemesinin durumu: 'none' (hiç iş atılmadı), 'open' (son audit 'exam.how_far'
-- satırından sonra 'diagnosis.failed' yok: iş sürüyor ya da teşhis yazıldı), 'failed' (worker son denemeden sonra
-- 'diagnosis.failed' yazdı: öğrenci yeniden gönderebilir). Sıra (created_at, id) ile: aynı işlemdeki satırlar da ayrışır.
-- exam_how_far (yeniden deneme / OGR-EXAM-009), grade_exam_session (karalama dağıtımı) ve exam_session_view (state) kullanır.
create or replace function app.exam_how_far_state(p_response uuid) returns text
language sql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
  with h as (
    select ae.created_at, ae.id from audit.events ae
     where ae.action = 'exam.how_far' and ae.row_id = p_response::text
     order by ae.created_at desc, ae.id desc limit 1
  )
  select case when not exists (select 1 from h) then 'none'
              when exists (select 1 from audit.events f cross join h
                            where f.action = 'diagnosis.failed' and f.table_name = 'public.exam_responses'
                              and f.row_id = p_response::text and (f.created_at, f.id) > (h.created_at, h.id)) then 'failed'
              else 'open' end
$$;
comment on function app.exam_how_far_state(uuid) is 'Deneme sorusunun teşhis denemesi: none (iş yok) | open (iş atıldı, düşmedi) | failed (son iş diagnosis.failed ile düştü).';

-- Deneme bağlamında teşhis işi: 'diagnosis.run' {upload_ids, enrollment_id, context:'exam', exam_response_id, session_id,
-- exam_id, question_no, how_far_text}. Fotoğraflar 'processing' yapılır (başka gönderime girmez; düşen denemenin
-- 'failed' fotoğrafı yeniden denemede yine 'processing' olur); audit.events
-- 'exam.how_far' satırı (row_id = cevap, diff.key = {text_md5, sıralı upload_ids}) exam_how_far'ın yeniden deneme
-- anahtarıdır. İş kimliği döner (pgboss yazılamazsa outbox → null). Yetki çağırandadır.
create or replace function app.exam_enqueue_diagnosis(p_response uuid, p_text text, p_upload_ids uuid[]) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_r record;
  v_ids uuid[] := coalesce(p_upload_ids, '{}');
  v_job uuid;
begin
  select r.id, r.session_id, es.enrollment_id, es.exam_id, q.no
    into v_r
    from public.exam_responses r
    join public.exam_sessions es on es.id = r.session_id
    join public.exam_questions q on q.id = r.exam_question_id
   where r.id = p_response;
  update public.uploads u set status = 'processing' where u.id = any(v_ids) and u.status in ('stored', 'failed');
  v_job := public.enqueue_job('diagnosis.run', jsonb_build_object(
    'upload_ids', to_jsonb(v_ids), 'enrollment_id', v_r.enrollment_id, 'context', 'exam',
    'exam_response_id', v_r.id, 'session_id', v_r.session_id, 'exam_id', v_r.exam_id, 'question_no', v_r.no,
    'how_far_text', p_text));
  perform app.audit_event('exam.how_far', 'public.exam_responses', p_response::text,
                          jsonb_build_object('key', app.exam_how_far_key(p_text, v_ids), 'session_id', v_r.session_id, 'job_id', v_job));
  return v_job;
end
$$;
comment on function app.exam_enqueue_diagnosis(uuid, text, uuid[]) is 'Deneme sorusu için diagnosis.run işi (context=exam, exam_response_id, how_far_text) + audit exam.how_far; fotoğraflar processing.';

-- --- yükleme: submit_exam_upload ---------------------------------------------------------------------

-- Öğrenci "Okul denemesi" sayfalarını gönderir (1–40 sayfa: kitapçık, optik form, karalama, varsa anahtar; sınıflamayı
-- worker yapar). p_meta (isteğe bağlı, bilinmeyen anahtar yok sayılır): title (≤ 120), publisher (≤ 80), held_on
-- (YYYY-AA-GG), enrollment_id (öğrencinin etkin kaydı; yoksa en son açılan etkin kayıt), duration_min (1–600).
-- Telif: yüklenen deneme her zaman is_copyrighted = true açılır (soru metni öğrenciye gösterilmez; personel değiştirir).
-- Yeniden deneme: aynı küme (sırasız) yeni sınav açmaz, ilk gönderimi döner (reused); kümenin bir kısmı başka gönderimde
-- işleniyor ya da işlenmişse OGR-UPL-003 (submit_upload ile aynı kural, anahtar audit.events 'exam.submit').
-- Analizi düşmüş (failed) gönderim yeniden kullanılmaz: aynı ya da yeni küme yeni sınav + oturum açar; öğrencinin düşmüş
-- bir deneme oturumundaki 'failed' sayfalar kabul edilir (40 sayfayı yeniden çekmek gerekmez; exam_how_far'daki kural).
-- Döner: {exam_id, session_id, enrollment_id, job_id, upload_ids, reused}.
create or replace function public.submit_exam_upload(p_upload_ids uuid[], p_meta jsonb default '{}'::jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
  v_ids uuid[] := coalesce(p_upload_ids, '{}');
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
  v_found int;
  v_bad int;
  v_open int;
  v_enr public.enrollments%rowtype;
  v_set jsonb;
  v_prev jsonb;
  v_title text;
  v_publisher text;
  v_held date;
  v_dur int;
  v_exam uuid;
  v_sess uuid;
  v_job uuid;
begin
  if v_student is null or auth.uid() is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 deneme yüklemesi yalnız öğrenci oturumunda gönderilir';
  end if;
  if cardinality(v_ids) < 1 or cardinality(v_ids) > 40
     or (select count(distinct x.u) from unnest(v_ids) as x (u)) <> cardinality(v_ids)
     or array_position(v_ids, null) is not null then
    raise exception using errcode = 'P0001',
      message = format('OGR-UPL-001 okul denemesi için 1–40 tekil sayfa gerekir (gelen %s)', cardinality(v_ids));
  end if;
  if jsonb_typeof(v_meta) <> 'object' then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 p_meta nesne olmalı';
  end if;
  v_title := nullif(btrim(v_meta ->> 'title'), '');
  v_publisher := nullif(btrim(v_meta ->> 'publisher'), '');
  if length(v_title) > 120 or length(v_publisher) > 80 then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 başlık en çok 120, yayınevi en çok 80 karakter';
  end if;
  if nullif(v_meta ->> 'held_on', '') is not null then
    if (v_meta ->> 'held_on') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 held_on YYYY-AA-GG olmalı';
    end if;
    begin
      v_held := (v_meta ->> 'held_on')::date;
    exception when others then
      raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 held_on geçerli bir tarih değil';
    end;
  end if;
  if nullif(v_meta ->> 'duration_min', '') is not null then
    if (v_meta ->> 'duration_min') !~ '^[0-9]{1,3}$' or (v_meta ->> 'duration_min')::int not between 1 and 600 then
      raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 duration_min 1–600 dakika olmalı';
    end if;
    v_dur := (v_meta ->> 'duration_min')::int;
  end if;

  perform 1 from public.uploads u where u.id = any(v_ids) order by u.id for update;
  -- işlenmiş sayılmayan: stored, processing ve öğrencinin düşmüş deneme oturumundaki failed sayfa
  select count(*),
         count(*) filter (where u.status not in ('stored', 'processing')
                            and not (u.status = 'failed'
                                     and exists (select 1 from public.exam_sessions es join public.enrollments e on e.id = es.enrollment_id
                                                  where es.mode = 'uploaded' and es.status = 'failed' and u.id = any(es.upload_ids)
                                                    and e.student_id = v_student))),
         count(*) filter (where u.status = 'processing')
    into v_found, v_bad, v_open
    from public.uploads u
   where u.id = any(v_ids) and u.owner_id = auth.uid() and u.student_id = v_student;
  if v_found <> cardinality(v_ids) then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-002 yükleme bulunamadı ya da senin değil';
  end if;

  if nullif(v_meta ->> 'enrollment_id', '') is not null then
    if (v_meta ->> 'enrollment_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 enrollment_id geçersiz';
    end if;
    select e.* into v_enr from public.enrollments e
     where e.id = (v_meta ->> 'enrollment_id')::uuid and e.student_id = v_student and e.status = 'active';
  else
    select e.* into v_enr from public.enrollments e
     where e.student_id = v_student and e.status = 'active'
     order by e.created_at desc, e.id
     limit 1;
  end if;
  if v_enr.id is null then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-004 etkin ders kaydı yok';
  end if;

  -- yeniden deneme: aynı küme için açılmış ve düşmemiş deneme varsa yenisi açılmaz
  v_set := (select jsonb_agg(x.u order by x.u) from unnest(v_ids) as x (u));
  select ae.diff into v_prev from audit.events ae
    join public.exam_sessions es on es.id = (ae.diff ->> 'session_id')::uuid
   where ae.action = 'exam.submit' and ae.row_id = v_set ->> 0 and ae.diff -> 'upload_set' = v_set and es.status <> 'failed'
   order by ae.created_at desc, ae.id desc limit 1;
  if v_prev is not null then
    return jsonb_build_object('exam_id', v_prev ->> 'exam_id', 'session_id', v_prev ->> 'session_id',
                              'enrollment_id', v_prev ->> 'enrollment_id', 'job_id', v_prev ->> 'job_id',
                              'upload_ids', to_jsonb(v_ids), 'reused', true);
  end if;
  if v_bad > 0 then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-003 yükleme zaten işlendi';
  end if;
  if v_open > 0 then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-003 sayfaların bir kısmı başka bir gönderimde işleniyor';
  end if;

  insert into public.exams (course_id, curriculum_id, created_by, kind, source, title, publisher, held_on, is_copyrighted, status, duration_min)
  values (v_enr.course_id, v_enr.curriculum_id, auth.uid(), 'deneme', 'uploaded', coalesce(v_title, app.exam_default_title(now())),
          v_publisher, v_held, true, 'processing', v_dur)
  returning id into v_exam;
  insert into public.exam_sessions (exam_id, enrollment_id, mode, status, upload_ids, progress)
  values (v_exam, v_enr.id, 'uploaded', 'grading', v_ids,
          jsonb_build_object('stage', 'classify', 'pages_total', cardinality(v_ids), 'pages_done', 0, 'updated_at', now()))
  returning id into v_sess;
  update public.uploads u set status = 'processing' where u.id = any(v_ids) and u.status <> 'processing';
  v_job := public.enqueue_job('exam.analyse', jsonb_build_object(
    'session_id', v_sess, 'exam_id', v_exam, 'enrollment_id', v_enr.id, 'student_id', v_student, 'upload_ids', to_jsonb(v_ids)));
  perform app.audit_event('exam.submit', 'public.exam_sessions', v_set ->> 0,
                          jsonb_build_object('upload_ids', to_jsonb(v_ids), 'upload_set', v_set, 'exam_id', v_exam,
                                             'session_id', v_sess, 'enrollment_id', v_enr.id, 'job_id', v_job));
  return jsonb_build_object('exam_id', v_exam, 'session_id', v_sess, 'enrollment_id', v_enr.id, 'job_id', v_job,
                            'upload_ids', to_jsonb(v_ids), 'reused', false);
end
$$;
comment on function public.submit_exam_upload(uuid[], jsonb) is 'Öğrenci: okul denemesi sayfaları → exams(deneme, uploaded, telifli) + exam_sessions(uploaded, grading) + exam.analyse işi; aynı kümenin yeniden denemesi aynı denemeyi döner (düşmüş analiz: yeni deneme, failed sayfalar kabul).';

-- --- submit_upload (0026) yeniden: yalnız Kendi çalışmam ----------------------------------------------------

-- Okul denemesinin tek giriş yolu submit_exam_upload'dur (meta doğrulaması, 'exam.submit' yeniden deneme anahtarı,
-- duration_min, düşmüş analizin yeniden gönderimi): p_kind = 'school_exam' OGR-UPL-001. own_work davranışı 0026 ile aynı.
create or replace function public.submit_upload(p_upload_ids uuid[], p_kind text) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
  v_ids uuid[] := coalesce(p_upload_ids, '{}');
  v_max int;
  v_found int;
  v_bad int;
  v_enr uuid;
  v_job uuid;
  v_prev jsonb;
  v_set jsonb;
  v_open int;
begin
  if v_student is null or auth.uid() is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 yükleme yalnız öğrenci oturumunda gönderilir';
  end if;
  if p_kind = 'school_exam' then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-001 okul denemesi submit_exam_upload ile gönderilir';
  end if;
  v_max := case p_kind when 'own_work' then 4 end;
  if v_max is null then
    raise exception using errcode = 'P0001', message = format('OGR-UPL-001 yükleme türü geçersiz: %s', coalesce(p_kind, '(boş)'));
  end if;
  if cardinality(v_ids) < 1 or cardinality(v_ids) > v_max
     or (select count(distinct x.u) from unnest(v_ids) as x (u)) <> cardinality(v_ids)
     or array_position(v_ids, null) is not null then
    raise exception using errcode = 'P0001',
      message = format('OGR-UPL-001 %s için 1–%s tekil sayfa gerekir (gelen %s)', p_kind, v_max, cardinality(v_ids));
  end if;

  -- yüklemeler: çağıranın ve öğrencisinin; aynı kümenin eşzamanlı ikinci gönderimi burada bekler
  perform 1 from public.uploads u where u.id = any(v_ids) order by u.id for update;
  select count(*), count(*) filter (where u.status not in ('stored', 'processing')), count(*) filter (where u.status = 'processing')
    into v_found, v_bad, v_open
    from public.uploads u
   where u.id = any(v_ids) and u.owner_id = auth.uid() and u.student_id = v_student;
  if v_found <> cardinality(v_ids) then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-002 yükleme bulunamadı ya da senin değil';
  end if;

  select e.id into v_enr from public.enrollments e
   where e.student_id = v_student and e.status = 'active'
   order by e.created_at desc, e.id
   limit 1;
  if v_enr is null then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-004 etkin ders kaydı yok';
  end if;

  -- yeniden deneme: tam aynı küme (sırasız) ve aynı tür için atılmış gönderim varsa ikinci iş yok (küme işlenmiş olsa da)
  v_set := (select jsonb_agg(x.u order by x.u) from unnest(v_ids) as x (u));
  select ae.diff into v_prev from audit.events ae
   where ae.action = 'upload.submit' and ae.row_id = v_set ->> 0 and ae.diff -> 'upload_set' = v_set
     and ae.diff ->> 'kind' = p_kind
   order by ae.created_at desc, ae.id desc limit 1;
  if v_prev is not null then
    return jsonb_build_object('enrollment_id', v_prev ->> 'enrollment_id', 'job_id', v_prev ->> 'job_id',
                              'upload_ids', to_jsonb(v_ids), 'kind', p_kind, 'reused', true);
  end if;
  -- başka gönderimin sayfası: işlenmiş (ready/failed) ya da işleniyor (farklı küme, alt küme, farklı tür)
  if v_bad > 0 then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-003 yükleme zaten işlendi';
  end if;
  if v_open > 0 then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-003 sayfaların bir kısmı başka bir gönderimde işleniyor';
  end if;

  update public.uploads u set status = 'processing' where u.id = any(v_ids) and u.status <> 'processing';
  v_job := public.enqueue_job('upload.intake', jsonb_build_object(
    'upload_ids', to_jsonb(v_ids), 'kind', p_kind, 'student_id', v_student, 'enrollment_id', v_enr));
  perform app.audit_event('upload.submit', 'public.uploads', v_set ->> 0,
                          jsonb_build_object('upload_ids', to_jsonb(v_ids), 'upload_set', v_set, 'kind', p_kind,
                                             'enrollment_id', v_enr, 'job_id', v_job));
  return jsonb_build_object('enrollment_id', v_enr, 'job_id', v_job, 'upload_ids', to_jsonb(v_ids), 'kind', p_kind, 'reused', false);
end
$$;
comment on function public.submit_upload(uuid[], text) is 'Öğrenci: Kendi çalışmam sayfalarını doğrular, processing yapar, upload.intake işini kuyruğa atar (aynı küme + türün yeniden denemesinde aynı iş; başka gönderimin sayfası OGR-UPL-003); okul denemesi submit_exam_upload ile (school_exam OGR-UPL-001).';

-- --- worker yazım yolu ---------------------------------------------------------------------------------

-- Analiz ilerlemesi (yalnız worker): aşama classify | ocr | key | grade | analyse | report | done | failed + sayaçlar
-- (p_counters nesne; değerler sayı, metin ya da boş; anahtarlar progress'e birleştirilir). 'failed': oturum ve sınav
-- failed, işlenen sayfalar failed, progress.error = p_counters.error (≤ 300). Notlanmış (analysing/done) oturumda
-- 'failed' sonucu gizlemez: oturum done, progress.stage done + report_status failed + error. 'done': analysing oturum done.
create or replace function public.set_exam_progress(p_session uuid, p_stage text, p_counters jsonb default '{}'::jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_s public.exam_sessions%rowtype;
  v_counters jsonb := coalesce(p_counters, '{}'::jsonb);
  v_progress jsonb;
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 analiz ilerlemesini yalnız worker yazar';
  end if;
  if p_stage is null or p_stage not in ('classify', 'ocr', 'key', 'grade', 'analyse', 'report', 'done', 'failed') then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-007 geçersiz aşama %s', coalesce(p_stage, '(boş)'));
  end if;
  if jsonb_typeof(v_counters) <> 'object'
     or exists (select 1 from jsonb_each(v_counters) as c (k, v) where jsonb_typeof(c.v) not in ('number', 'string', 'null', 'boolean')) then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 p_counters düz bir nesne olmalı (sayı, metin, mantıksal)';
  end if;
  select es.* into v_s from public.exam_sessions es where es.id = p_session for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 oturum bulunamadı';
  end if;
  if v_s.status = 'failed' and p_stage <> 'failed' then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-003 oturum failed: ilerleme yazılamaz';
  end if;
  if p_stage = 'failed' and v_s.status in ('analysing', 'done') then
    -- notlanmış oturum (rapor ya da dağıtım düştü): sonuç ekranı kaybolmaz (notlama gözlemleri ve ustalık zaten yazıldı);
    -- oturum done + report_status failed (produce-report'un rapor düşünce yazdığıyla aynı), hata metni progress.error
    v_progress := v_s.progress || (v_counters - 'stage' - 'updated_at' - 'error')
                  || jsonb_build_object('stage', 'done', 'updated_at', now(), 'report_status', 'failed',
                                        'error', left(coalesce(nullif(v_counters ->> 'error', ''), 'rapor hazırlanamadı'), 300));
    update public.exam_sessions es set status = 'done', progress = v_progress where es.id = p_session;
    return v_progress;
  end if;
  v_progress := v_s.progress || (v_counters - 'stage' - 'updated_at' - 'error')
                || jsonb_build_object('stage', p_stage, 'updated_at', now());
  if p_stage = 'failed' then
    v_progress := v_progress || jsonb_build_object('error', left(coalesce(nullif(v_counters ->> 'error', ''), 'analiz tamamlanamadı'), 300));
    update public.exam_sessions es set status = 'failed', progress = v_progress where es.id = p_session;
    update public.exams x set status = 'failed' where x.id = v_s.exam_id and x.source = 'uploaded' and x.status in ('draft', 'processing');
    update public.uploads u set status = 'failed' where u.id = any(v_s.upload_ids) and u.status = 'processing';
  else
    update public.exam_sessions es
       set progress = v_progress,
           status = case when p_stage = 'done' and es.status = 'analysing' then 'done' else es.status end
     where es.id = p_session;
  end if;
  return v_progress;
end
$$;
comment on function public.set_exam_progress(uuid, text, jsonb) is 'Worker: deneme analizi aşaması + sayaçlar (failed: oturum/sınav/sayfalar failed, notlanmış oturumda done + report_status failed; done: analysing → done).';

-- Soruları yazar (worker, eğitmen, admin). p_items sınavın TAM soru kümesidir (listede olmayan sorular silinir):
-- [{no, section?, kind? (mcq|numeric|open; varsayılan mcq), stem_text?, options? [{key A–E, text}], skill_ids? (sınavın
-- müfredatında yaprak), style_id?, difficulty? (0..1), page_upload_id?, bbox? {x,y,w,h}, figure_upload_id?}].
-- Yükleme kimlikleri sınavın oturum sayfalarından ya da sınavı oluşturanın yüklemelerinden olmalı. Notlanmış oturumu
-- olan sınavda soru değişmez (OGR-EXAM-003). exams.question_count güncellenir; sections yüklenen denemede her çağrıda,
-- diğerlerinde boşsa bölüm kodlarından kurulur ({code, title, from_no, to_no}).
-- Döner: {exam_id, question_count, questions: [{no, id}]}.
create or replace function public.register_exam_questions(p_exam uuid, p_items jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_x public.exams%rowtype;
  v_it jsonb;
  v_no int;
  v_kind text;
  v_opts jsonb;
  v_skills text[];
  v_bad text;
  v_bbox jsonb;
  v_page uuid;
  v_fig uuid;
  v_nos int[] := '{}';
  v_count int;
begin
  select x.* into v_x from public.exams x where x.id = p_exam for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 sınav bulunamadı';
  end if;
  if not app.can_edit_exam(p_exam) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 soruları yalnız sınavın eğitmeni, admin ya da worker yazar';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 500 then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 p_items 1–500 maddelik bir dizi olmalı';
  end if;
  if app.exam_has_graded_session(p_exam) then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-003 notlanmış oturumu olan sınavın soruları değiştirilemez';
  end if;

  for v_it in select e.value from jsonb_array_elements(p_items) as e (value) loop
    if jsonb_typeof(v_it) <> 'object' or coalesce(v_it ->> 'no', '') !~ '^[0-9]{1,3}$' or (v_it ->> 'no')::int < 1 then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-007 soru numarası geçersiz: %s', left(v_it::text, 80));
    end if;
    v_no := (v_it ->> 'no')::int;
    if v_no = any(v_nos) then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-007 soru numarası yinelendi: %s', v_no);
    end if;
    v_nos := v_nos || v_no;
    v_kind := coalesce(nullif(v_it ->> 'kind', ''), 'mcq');
    if v_kind not in ('mcq', 'numeric', 'open') then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-007 soru %s türü geçersiz: %s', v_no, v_kind);
    end if;
    v_opts := case when jsonb_typeof(v_it -> 'options') = 'array' and jsonb_array_length(v_it -> 'options') > 0 then v_it -> 'options' end;
    if v_opts is not null and (v_kind <> 'mcq' or jsonb_array_length(v_opts) > 5
        or exists (select 1 from jsonb_array_elements(v_opts) as o (opt)
                    where jsonb_typeof(o.opt) <> 'object' or coalesce(o.opt ->> 'key', '') !~ '^[A-E]$')
        or (select count(distinct o.opt ->> 'key') from jsonb_array_elements(v_opts) as o (opt)) <> jsonb_array_length(v_opts)) then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-007 soru %s şıkları geçersiz (yalnız mcq, ≤ 5, tekil A–E)', v_no);
    end if;
    if length(v_it ->> 'stem_text') > 4000 or length(v_it ->> 'section') > 80 then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-007 soru %s metni ya da bölümü çok uzun', v_no);
    end if;
    if (v_it -> 'difficulty') is not null and jsonb_typeof(v_it -> 'difficulty') <> 'null'
       and (jsonb_typeof(v_it -> 'difficulty') <> 'number' or (v_it ->> 'difficulty')::numeric not between 0 and 1) then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-007 soru %s zorluğu 0..1 olmalı', v_no);
    end if;
    v_skills := array(select distinct x.sid from jsonb_array_elements_text(coalesce(nullif(v_it -> 'skill_ids', 'null'::jsonb), '[]')) as x (sid) order by x.sid);
    select string_agg(x.sid, ', ') into v_bad from unnest(v_skills) as x (sid)
     where not exists (select 1 from public.skills s where s.curriculum_id = v_x.curriculum_id and s.id = x.sid and s.is_leaf);
    if v_bad is not null then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-007 soru %s: kazanım sınavın müfredatında yaprak değil: %s', v_no, v_bad);
    end if;
    v_bbox := case when jsonb_typeof(v_it -> 'bbox') = 'object' then v_it -> 'bbox' end;
    if v_bbox is not null then
      if not (v_bbox ?& array['x', 'y', 'w', 'h'])
         or exists (select 1 from jsonb_each(v_bbox) as b (k, v) where b.k in ('x', 'y', 'w', 'h') and jsonb_typeof(b.v) <> 'number')
         or (v_bbox ->> 'x')::numeric < 0 or (v_bbox ->> 'y')::numeric < 0
         or (v_bbox ->> 'w')::numeric <= 0 or (v_bbox ->> 'h')::numeric <= 0
         or (v_bbox ->> 'x')::numeric + (v_bbox ->> 'w')::numeric > 1.001
         or (v_bbox ->> 'y')::numeric + (v_bbox ->> 'h')::numeric > 1.001 then
        raise exception using errcode = 'P0001', message = format('OGR-EXAM-007 soru %s kırpım kutusu geçersiz ({x,y,w,h}, 0..1, sayfa içinde)', v_no);
      end if;
      v_bbox := jsonb_build_object('x', v_bbox -> 'x', 'y', v_bbox -> 'y', 'w', v_bbox -> 'w', 'h', v_bbox -> 'h');
    end if;
    v_page := nullif(v_it ->> 'page_upload_id', '')::uuid;
    v_fig := nullif(v_it ->> 'figure_upload_id', '')::uuid;
    if v_bbox is not null and v_page is null then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-007 soru %s: kırpım kutusu sayfa (page_upload_id) ister', v_no);
    end if;
    if exists (select 1 from unnest(array_remove(array[v_page, v_fig], null)) as x (u)
                where not exists (select 1 from public.uploads u
                                   where u.id = x.u
                                     and (u.owner_id = v_x.created_by
                                          or exists (select 1 from public.exam_sessions es
                                                      where es.exam_id = p_exam and u.id = any(es.upload_ids))))) then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-006 soru %s: sayfa/şekil yüklemesi bu sınavın değil', v_no);
    end if;

    insert into public.exam_questions as q (exam_id, no, section, kind, stem_text, options, figure_upload_id, skill_ids, style_id,
                                            difficulty, page_upload_id, bbox)
    values (p_exam, v_no, nullif(btrim(v_it ->> 'section'), ''), v_kind, nullif(v_it ->> 'stem_text', ''), v_opts, v_fig, v_skills,
            nullif(v_it ->> 'style_id', '')::uuid, (v_it ->> 'difficulty')::numeric, v_page, v_bbox)
    on conflict (exam_id, no) do update
      set section = excluded.section, kind = excluded.kind, stem_text = excluded.stem_text, options = excluded.options,
          figure_upload_id = excluded.figure_upload_id, skill_ids = excluded.skill_ids, style_id = excluded.style_id,
          difficulty = excluded.difficulty, page_upload_id = excluded.page_upload_id, bbox = excluded.bbox;
  end loop;

  delete from public.exam_questions q where q.exam_id = p_exam and q.no <> all(v_nos);
  select count(*) into v_count from public.exam_questions q where q.exam_id = p_exam;
  update public.exams x
     set question_count = v_count,
         sections = case when x.source <> 'uploaded' and jsonb_typeof(x.sections) = 'array' and jsonb_array_length(x.sections) > 0 then x.sections
                         else coalesce((select jsonb_agg(jsonb_build_object('code', z.section, 'title', z.section, 'from_no', z.from_no,
                                                                            'to_no', z.to_no) order by z.from_no)
                                          from (select q.section, min(q.no) as from_no, max(q.no) as to_no from public.exam_questions q
                                                 where q.exam_id = p_exam and q.section is not null group by q.section) as z), '[]'::jsonb) end
   where x.id = p_exam;
  return jsonb_build_object('exam_id', p_exam, 'question_count', v_count,
                            'questions', (select coalesce(jsonb_agg(jsonb_build_object('no', q.no, 'id', q.id) order by q.no), '[]'::jsonb)
                                            from public.exam_questions q where q.exam_id = p_exam));
end
$$;
comment on function public.register_exam_questions(uuid, jsonb) is 'Worker/eğitmen: sınavın tam soru kümesini yazar (upsert + listede olmayanı siler; kırpım kutusu, sayfa, kazanım doğrulaması); {exam_id, question_count, questions}.';

-- 0017 set_exam_key yeniden: yetki app.can_edit_exam (yüklenen denemede yalnız öğrencinin owner eğitmeni), notlanmış
-- oturumu olan sınavda OGR-EXAM-003; geri kalanı aynen.
create or replace function public.set_exam_key(
  p_exam_question uuid, p_correct_option text default null, p_numeric_value numeric default null,
  p_source text default 'instructor', p_confidence numeric default null
) returns void
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_kind text;
  v_exam uuid;
  v_opt text := nullif(upper(btrim(p_correct_option)), '');
begin
  select q.kind, q.exam_id into v_kind, v_exam from public.exam_questions q where q.id = p_exam_question;
  if v_exam is null then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 sınav sorusu bulunamadı';
  end if;
  if not app.can_edit_exam(v_exam) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 anahtarı yalnız sınavın eğitmeni ya da admin yazar';
  end if;
  if p_source is null or p_source not in ('uploaded', 'inferred', 'instructor', 'generated')
     or (p_source in ('inferred', 'generated') and not app.is_trusted()) then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-005 anahtar kaynağı geçersiz: %s', coalesce(p_source, '(boş)'));
  end if;
  if (v_kind = 'mcq' and (v_opt is null or v_opt !~ '^[A-E]$')) or (v_kind = 'numeric' and p_numeric_value is null) or v_kind = 'open' then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-005 %s sorusu için anahtar biçimi geçersiz', v_kind);
  end if;
  if app.exam_has_graded_session(v_exam) then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-003 notlanmış oturumu olan sınavın anahtarı değiştirilemez';
  end if;
  insert into secure.exam_answer_keys as k (exam_question_id, correct_option, numeric_value, source, confidence)
  values (p_exam_question, case when v_kind = 'mcq' then v_opt end, case when v_kind = 'numeric' then p_numeric_value end, p_source, p_confidence)
  on conflict (exam_question_id) do update
    set correct_option = excluded.correct_option, numeric_value = excluded.numeric_value,
        source = excluded.source, confidence = excluded.confidence;
  perform app.audit_event('exam_key.set', 'secure.exam_answer_keys', p_exam_question::text,
                          jsonb_build_object('exam_id', v_exam, 'source', p_source, 'confidence', p_confidence));
end
$$;
comment on function public.set_exam_key(uuid, text, numeric, text, numeric) is 'secure.exam_answer_keys upsert (app.can_edit_exam; inferred/generated yalnız worker; notlanmış sınavda OGR-EXAM-003); denetim izine değer yazılmaz.';

-- 0017 peek_answer_key yeniden: sınav sorusunun anahtarı yalnız sınavı okuyabilen personele (app.can_read_exam:
-- yüklenen deneme yalnız öğrenciye bağlı eğitmene); soru bankası kuralı aynen.
create or replace function public.peek_answer_key(p_question uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_out jsonb;
  v_exam uuid;
begin
  if not (app.is_trusted() or app.is_staff()) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 cevap anahtarını yalnız eğitmen ya da admin görür';
  end if;
  select jsonb_build_object('kind', 'question', 'question_id', k.question_id, 'correct_option', k.correct_option,
                            'numeric_value', k.numeric_value, 'numeric_tolerance', k.numeric_tolerance, 'canonical_expr', k.canonical_expr,
                            'solution', k.solution, 'sympy_status', k.sympy_status, 'verified_at', k.verified_at)
    into v_out from secure.answer_keys k where k.question_id = p_question;
  if v_out is null then
    select jsonb_build_object('kind', 'exam_question', 'exam_question_id', k.exam_question_id, 'correct_option', k.correct_option,
                              'numeric_value', k.numeric_value, 'source', k.source, 'confidence', k.confidence), q.exam_id
      into v_out, v_exam
      from secure.exam_answer_keys k join public.exam_questions q on q.id = k.exam_question_id
     where k.exam_question_id = p_question;
    if v_out is not null and not app.can_read_exam(v_exam) then
      raise exception using errcode = '42501', message = 'OGR-AUTH-002 bu sınavın anahtarını göremezsin';
    end if;
  end if;
  if v_out is null then
    raise exception using errcode = 'P0001', message = format('OGR-KEY-001 anahtar yok %s', p_question);
  end if;
  perform app.audit_event('answer_key.peek', v_out ->> 'kind', p_question::text, null);
  return v_out;
end
$$;
comment on function public.peek_answer_key(uuid) is 'Cevap anahtarı (soru bankası ya da sınav sorusu; sınavda app.can_read_exam); yalnız eğitmen/admin/worker, her okuma denetim izine yazılır.';

-- Anahtarları toplu yazar (worker, eğitmen, admin): p_keys [{no | question_no, correct_option? (A–E), numeric_value?,
-- confidence? (0..1)}] (inferred-keys sözleşmesiyle uyumlu; fazla alanlar yok sayılır). p_source set_exam_key ile aynı
-- (inferred/generated yalnız worker). exams.answer_key_source tüm anahtarların kaynağından (tek kaynak ya da mixed).
-- Notlanmış oturumu olan sınavda OGR-EXAM-003 (register_exam_questions ile aynı kural). Denetim izine değer yazılmaz.
-- Döner: {exam_id, written, question_count, keyed, missing_nos, answer_key_source, unverified}.
create or replace function public.set_exam_keys(p_exam uuid, p_keys jsonb, p_source text default 'instructor') returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_k jsonb;
  v_no int;
  v_qid uuid;
  v_qkind text;
  v_opt text;
  v_num numeric;
  v_conf numeric;
  v_written int := 0;
  v_src text;
  v_out jsonb;
begin
  if not exists (select 1 from public.exams x where x.id = p_exam) then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 sınav bulunamadı';
  end if;
  if not app.can_edit_exam(p_exam) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 anahtarı yalnız sınavın eğitmeni ya da admin yazar';
  end if;
  if p_source is null or p_source not in ('uploaded', 'inferred', 'instructor', 'generated')
     or (p_source in ('inferred', 'generated') and not app.is_trusted()) then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-005 anahtar kaynağı geçersiz: %s', coalesce(p_source, '(boş)'));
  end if;
  if jsonb_typeof(p_keys) <> 'array' or jsonb_array_length(p_keys) not between 1 and 500 then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-005 p_keys 1–500 maddelik bir dizi olmalı';
  end if;
  if app.exam_has_graded_session(p_exam) then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-003 notlanmış oturumu olan sınavın anahtarı değiştirilemez';
  end if;
  for v_k in select e.value from jsonb_array_elements(p_keys) as e (value) loop
    if jsonb_typeof(v_k) <> 'object' or coalesce(v_k ->> 'no', v_k ->> 'question_no', '') !~ '^[0-9]{1,3}$' then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-005 anahtar satırı geçersiz: %s', left(v_k::text, 80));
    end if;
    v_no := coalesce(v_k ->> 'no', v_k ->> 'question_no')::int;
    v_qid := null;
    select q.id, q.kind into v_qid, v_qkind from public.exam_questions q where q.exam_id = p_exam and q.no = v_no;
    if v_qid is null then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-004 soru %s bu sınavda yok', v_no);
    end if;
    v_opt := nullif(upper(btrim(v_k ->> 'correct_option')), '');
    v_num := case when jsonb_typeof(v_k -> 'numeric_value') = 'number' then (v_k ->> 'numeric_value')::numeric end;
    v_conf := case when jsonb_typeof(v_k -> 'confidence') = 'number' then (v_k ->> 'confidence')::numeric end;
    if (v_qkind = 'mcq' and (v_opt is null or v_opt !~ '^[A-E]$')) or (v_qkind = 'numeric' and v_num is null) or v_qkind = 'open'
       or (v_conf is not null and v_conf not between 0 and 1) then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-005 soru %s (%s) için anahtar biçimi geçersiz', v_no, v_qkind);
    end if;
    insert into secure.exam_answer_keys as k (exam_question_id, correct_option, numeric_value, source, confidence)
    values (v_qid, case when v_qkind = 'mcq' then v_opt end, case when v_qkind = 'numeric' then v_num end, p_source, v_conf)
    on conflict (exam_question_id) do update
      set correct_option = excluded.correct_option, numeric_value = excluded.numeric_value,
          source = excluded.source, confidence = excluded.confidence;
    v_written := v_written + 1;
  end loop;

  select case when count(distinct k.source) = 1 then min(k.source) when count(distinct k.source) > 1 then 'mixed' end into v_src
    from secure.exam_answer_keys k join public.exam_questions q on q.id = k.exam_question_id where q.exam_id = p_exam;
  update public.exams x set answer_key_source = v_src where x.id = p_exam;
  select jsonb_build_object(
           'exam_id', p_exam, 'written', v_written, 'question_count', count(*),
           'keyed', count(k.exam_question_id),
           'missing_nos', coalesce(jsonb_agg(q.no order by q.no) filter (where k.exam_question_id is null and q.kind <> 'open'), '[]'::jsonb),
           'answer_key_source', v_src,
           'unverified', count(*) filter (where k.source = 'inferred' and coalesce(k.confidence, 0) < 0.8))
    into v_out
    from public.exam_questions q left join secure.exam_answer_keys k on k.exam_question_id = q.id
   where q.exam_id = p_exam;
  perform app.audit_event('exam_keys.set', 'secure.exam_answer_keys', p_exam::text,
                          jsonb_build_object('exam_id', p_exam, 'source', p_source, 'written', v_written));
  return v_out;
end
$$;
comment on function public.set_exam_keys(uuid, jsonb, text) is 'Worker/eğitmen: soru numarasına göre toplu anahtar (secure.exam_answer_keys) + exams.answer_key_source; değer döndürmez, denetime değer yazılmaz.';

-- Optik form cevapları (yalnız worker; yüklenen oturum 'grading' iken): p_answers [{no, answer? ('B' | '7/8' | boş),
-- time_spent_sec?, flagged?}]; çift işaret/okunmayan satır boş gönderilir. Döner: {session_id, written, missing_nos}.
create or replace function public.record_exam_answers(p_session uuid, p_answers jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_s public.exam_sessions%rowtype;
  v_a jsonb;
  v_no int;
  v_q uuid;
  v_written int := 0;
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 optik form cevaplarını yalnız worker yazar';
  end if;
  select es.* into v_s from public.exam_sessions es where es.id = p_session for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 oturum bulunamadı';
  end if;
  if v_s.mode <> 'uploaded' or v_s.status <> 'grading' then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-003 cevaplar yalnız notlanmayı bekleyen yüklemeye yazılır (%s/%s)', v_s.mode, v_s.status);
  end if;
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) > 500 then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 p_answers en çok 500 maddelik bir dizi olmalı';
  end if;
  for v_a in select e.value from jsonb_array_elements(p_answers) as e (value) loop
    if jsonb_typeof(v_a) <> 'object' or coalesce(v_a ->> 'no', v_a ->> 'question_no', '') !~ '^[0-9]{1,3}$' then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-007 cevap satırı geçersiz: %s', left(v_a::text, 80));
    end if;
    v_no := coalesce(v_a ->> 'no', v_a ->> 'question_no')::int;
    v_q := null;
    select q.id into v_q from public.exam_questions q where q.exam_id = v_s.exam_id and q.no = v_no;
    if v_q is null then
      raise exception using errcode = 'P0001', message = format('OGR-EXAM-004 soru %s bu oturumun sınavında yok', v_no);
    end if;
    insert into public.exam_responses as r (session_id, exam_question_id, answer, time_spent_sec, flagged)
    values (p_session, v_q, nullif(upper(btrim(v_a ->> 'answer')), ''),
            case when jsonb_typeof(v_a -> 'time_spent_sec') = 'number' then greatest(0, (v_a ->> 'time_spent_sec')::int) end,
            coalesce((v_a ->> 'flagged')::boolean, false))
    on conflict (session_id, exam_question_id) do update
      set answer = excluded.answer, time_spent_sec = coalesce(excluded.time_spent_sec, r.time_spent_sec), flagged = excluded.flagged;
    v_written := v_written + 1;
  end loop;
  return jsonb_build_object('session_id', p_session, 'written', v_written,
                            'missing_nos', (select coalesce(jsonb_agg(q.no order by q.no), '[]'::jsonb) from public.exam_questions q
                                             where q.exam_id = v_s.exam_id
                                               and not exists (select 1 from public.exam_responses r
                                                                where r.session_id = p_session and r.exam_question_id = q.id)));
end
$$;
comment on function public.record_exam_answers(uuid, jsonb) is 'Worker: optik formdan okunan cevaplar (soru numarasına göre upsert; yalnız uploaded + grading oturum).';

-- --- notlama (0017 gözden geçirildi) ---------------------------------------------------------------------

-- 0017 davranışı korunur (outcome kuralları, ÖSYM neti doğru − yanlış × exam_wrong_penalty (0.25), bölüm netleri,
-- observations(kind='test', guess_override 0.2, boş ağırlık 0.5), style_coverage, tekrar deneme ağırlık 0; 'exam.report'
-- işi yalnız uygulama içi oturuma (yüklenen oturumun raporunu exam.analyse yazar).
-- 0030 ekleri: yüklenen oturumu yalnız worker/owner eğitmen/admin notlar (öğrenci notlarsa boş sınavı notlamış olurdu;
-- OGR-AUTH-003); uygulama içi oturumun bitişi süre sınırını aşmaz; progress
-- 'analyse' aşamasına geçer (sayaçlar: questions, wrong_blank); yüklenen sınav 'ready', sayfaları 'ready'.
-- Uygulama içi oturumda karalama tuvali/fotoğrafı ya da sınav sırasında yazılmış "nereye kadar" metni olan her yanlış/boş/
-- yetişmeyen soru için 'diagnosis.run' (app.exam_enqueue_diagnosis; ilk 4 yükleme, metin ≤ 2000) burada atılır: oturum
-- finish_exam_session'la da grade_exam_session'la da kapansa karalama teşhise gider (yüklenen oturumda dağıtım worker'da).
create or replace function public.grade_exam_session(p_session uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_s public.exam_sessions%rowtype;
  v_x public.exams%rowtype;
  v_cur uuid;
  v_g numeric := app.setting_num('exam_guess_override', 0.2);
  v_blank_w numeric := app.setting_num('exam_blank_weight', 0.5);
  v_pen numeric := app.setting_num('exam_wrong_penalty', 0.25);
  v_last int;
  v_r record;
  v_ans text;
  v_outcome text;
  v_skill text;
  v_obs bigint;
  v_score jsonb;
  v_sections jsonb;
  v_repeat boolean;
  v_deadline timestamptz;
  v_d record;
begin
  select es.* into v_s from public.exam_sessions es where es.id = p_session for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 oturum bulunamadı';
  end if;
  perform app.assert_student_access(app.student_of_enrollment(v_s.enrollment_id), true);
  if v_s.status in ('analysing', 'done') then
    return v_s.score;
  end if;
  if v_s.status = 'failed' then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-003 oturum failed: notlanamaz';
  end if;
  if v_s.mode = 'uploaded' and not (app.is_trusted() or app.is_staff()) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-003 yüklenen denemeyi analiz hattı notlar';
  end if;
  select x.* into v_x from public.exams x where x.id = v_s.exam_id;
  select e.curriculum_id into v_cur from public.enrollments e where e.id = v_s.enrollment_id;
  if v_x.curriculum_id <> v_cur then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-002 sınavın müfredatı kaydın müfredatıyla aynı değil';
  end if;
  v_deadline := app.exam_deadline(p_session);
  update public.exam_sessions es set status = 'grading' where es.id = p_session;
  select exists (select 1 from public.exam_sessions es
                  where es.exam_id = v_s.exam_id and es.enrollment_id = v_s.enrollment_id and es.id <> p_session
                    and es.status in ('analysing', 'done')) into v_repeat;

  insert into public.exam_responses (session_id, exam_question_id)
  select p_session, q.id from public.exam_questions q where q.exam_id = v_s.exam_id
  on conflict (session_id, exam_question_id) do nothing;
  select max(q.no) into v_last from public.exam_responses r join public.exam_questions q on q.id = r.exam_question_id
   where r.session_id = p_session and nullif(btrim(r.answer), '') is not null;

  for v_r in
    select r.id as rid, r.answer, q.no, q.kind, q.skill_ids, q.style_id, k.correct_option, k.numeric_value,
           k.exam_question_id is not null as has_key
      from public.exam_responses r
      join public.exam_questions q on q.id = r.exam_question_id
      left join secure.exam_answer_keys k on k.exam_question_id = q.id
     where r.session_id = p_session
     order by q.no
  loop
    v_ans := nullif(upper(btrim(v_r.answer)), '');
    if v_ans is null then
      v_outcome := case when v_last is null or v_r.no > v_last then 'unfinished' else 'blank' end;
    elsif not v_r.has_key or v_r.kind = 'open' then
      v_outcome := null;
    elsif v_r.kind = 'mcq' then
      v_outcome := case when v_ans !~ '^[A-E]$' then 'blank' when v_ans = v_r.correct_option then 'correct' else 'wrong' end;
    else
      v_outcome := case when app.numeric_equal(v_ans, v_r.numeric_value::text, 0.000001) then 'correct' else 'wrong' end;
    end if;
    update public.exam_responses r set outcome = v_outcome where r.id = v_r.rid;

    if v_outcome in ('correct', 'wrong', 'blank') then
      for v_skill in
        select s.id from public.skills s where s.curriculum_id = v_cur and s.is_leaf and s.id = any(v_r.skill_ids) order by s.id
      loop
        insert into public.observations (enrollment_id, skill_id, kind, value, weight, guess_override, source_type, source_id, source_locator,
                                         counts_for_mastery)
        values (v_s.enrollment_id, v_skill, 'test', case when v_outcome = 'correct' then 1 else 0 end,
                case when v_repeat then 0 when v_outcome = 'blank' then v_blank_w else 1 end, v_g, 'exam_response', v_r.rid::text,
                left(v_x.title, 120) || ' · soru ' || v_r.no || case when v_repeat then ' · tekrar' else '' end, not v_repeat)
        returning id into v_obs;
        perform public.apply_observation(v_obs);
      end loop;
      if v_r.style_id is not null then
        insert into public.style_coverage as sc (enrollment_id, style_id, seen_count, solved_count, correct_count, last_seen_at)
        values (v_s.enrollment_id, v_r.style_id, 1, case when v_outcome = 'blank' then 0 else 1 end,
                case when v_outcome = 'correct' then 1 else 0 end, now())
        on conflict (enrollment_id, style_id) do update
          set seen_count = sc.seen_count + 1,
              solved_count = sc.solved_count + excluded.solved_count,
              correct_count = sc.correct_count + excluded.correct_count,
              last_seen_at = now();
      end if;
    end if;
  end loop;

  select coalesce(jsonb_agg(z.sec order by z.first_no), '[]'::jsonb) into v_sections
    from (
      select min(q.no) as first_no,
             jsonb_build_object('section', coalesce(q.section, 'Genel'), 'total', count(*),
                                'correct', count(*) filter (where r.outcome = 'correct'),
                                'wrong', count(*) filter (where r.outcome = 'wrong'),
                                'blank', count(*) filter (where r.outcome = 'blank'),
                                'unfinished', count(*) filter (where r.outcome = 'unfinished'),
                                'ungraded', count(*) filter (where r.outcome is null),
                                'net', round(count(*) filter (where r.outcome = 'correct') - v_pen * count(*) filter (where r.outcome = 'wrong'), 2)) as sec
        from public.exam_responses r join public.exam_questions q on q.id = r.exam_question_id
       where r.session_id = p_session
       group by coalesce(q.section, 'Genel')
    ) as z;
  select jsonb_build_object(
           'total', count(*),
           'correct', count(*) filter (where r.outcome = 'correct'),
           'wrong', count(*) filter (where r.outcome = 'wrong'),
           'blank', count(*) filter (where r.outcome = 'blank'),
           'unfinished', count(*) filter (where r.outcome = 'unfinished'),
           'ungraded', count(*) filter (where r.outcome is null),
           'net', round(count(*) filter (where r.outcome = 'correct') - v_pen * count(*) filter (where r.outcome = 'wrong'), 2),
           'wrong_penalty', v_pen,
           'unverified_keys', count(*) filter (where k.source = 'inferred' and coalesce(k.confidence, 0) < 0.8),
           'sections', v_sections,
           'graded_at', now())
    into v_score
    from public.exam_responses r
    left join secure.exam_answer_keys k on k.exam_question_id = r.exam_question_id
   where r.session_id = p_session;

  update public.exam_sessions es
     set status = 'analysing',
         score = v_score,
         finished_at = coalesce(es.finished_at, least(now(), coalesce(v_deadline, now()))),
         duration_sec = coalesce(es.duration_sec,
                                 greatest(0, extract(epoch from (coalesce(es.finished_at, least(now(), coalesce(v_deadline, now()))) - es.started_at)))::int),
         progress = es.progress || jsonb_build_object('stage', 'analyse', 'updated_at', now(), 'questions', (v_score ->> 'total')::int,
                                                       'wrong_blank', (v_score ->> 'wrong')::int + (v_score ->> 'blank')::int
                                                                      + (v_score ->> 'unfinished')::int)
   where es.id = p_session;
  if v_s.mode = 'uploaded' then
    update public.exams x set status = 'ready' where x.id = v_s.exam_id and x.status in ('draft', 'processing');
    update public.uploads u set status = 'ready' where u.id = any(v_s.upload_ids) and u.status = 'processing';
  end if;
  if v_s.mode = 'in_app' then
    -- karalama / sınav sırasında yazılan "nereye kadar" → deneme bağlamlı teşhis (exam_how_far ile aynı anahtar)
    for v_d in
      select r.id, left(nullif(btrim(r.how_far_text), ''), 2000) as txt, r.work_upload_ids[1:4] as ids
        from public.exam_responses r join public.exam_questions q on q.id = r.exam_question_id
       where r.session_id = p_session and r.outcome in ('wrong', 'blank', 'unfinished') and r.solution_analysis_id is null
         and (cardinality(r.work_upload_ids) > 0 or nullif(btrim(r.how_far_text), '') is not null)
         and app.exam_how_far_state(r.id) = 'none'
       order by q.no
    loop
      perform app.exam_enqueue_diagnosis(v_d.id, v_d.txt, v_d.ids);
    end loop;
  end if;
  -- yüklenen oturumun raporunu exam.analyse kendisi üretir; ayrı iş yalnız uygulama içi oturuma
  if v_s.mode = 'in_app' then
    perform app.try_enqueue('exam.report', jsonb_build_object('session_id', p_session));
  end if;
  return v_score;
end
$$;
comment on function public.grade_exam_session(uuid) is 'Oturumu gizli anahtarla notlar: outcome, score (ÖSYM neti, bölümler), observations(kind=test, g=0.2), style_coverage, progress analyse; yüklenen oturumu yalnız analiz hattı; uygulama içi karalamalı yanlış/boşlar için diagnosis.run ve exam.report işi.';

-- --- sonuç ekranı: exam_session_view -----------------------------------------------------------------

-- Öğrencinin (ve bağlı eğitmen, admin, worker) sonuç görünümü; veli yalnız özet + bölümler + ısı haritası (soru listesi
-- yok). Cevap anahtarı hiçbir alanda yoktur; soru metni yalnız is_copyrighted = false ise (telifli: kırpım kutusu).
-- Döner: {session_id, exam_id, title, kind, source, mode, status, pending, progress, started_at, finished_at,
--   duration_sec, deadline_at, is_copyrighted, answer_key_source, pages[], report {id, status, pdf_path} | null,
--   summary {total, correct, wrong, blank, unfinished, ungraded, net, unverified_keys, weakest {skill_id, name} | null,
--            top_cause | null, one_line, counts_line} | null,
--   sections [{section, title, total, correct, wrong, blank, unfinished, net}],
--   heatmap [{skill_id, name, total, correct, wrong, blank, band low|mid|high}],
--   items [{response_id, exam_question_id, no, section, kind, outcome, answer, stem_text, options, page_upload_id, bbox,
--           figure_upload_id, skill_ids, how_far_text, work_upload_ids, blank_reason, solution_analysis_id,
--           diagnosis {verdict, error_cause, failing_step_no, one_line} | null, state needs_input|pending|diagnosed|reason_given,
--           diagnosis_failed}],
--   items_hidden}
-- state: diagnosed (teşhis bağlı) > reason_given (boş nedeni) > pending (gerçekten atılmış ve düşmemiş teşhis işi:
-- app.exam_how_far_state = open) > needs_input. Son teşhis işi düştüyse state needs_input ve diagnosis_failed true
-- (öğrenci yeniden gönderebilir). one_line tek cümledir (S05 sonuç: büyük sayı + tek satır): "Net 2,75[ (anahtar
-- doğrulanmadı)][; en çok zorlandığın konu: …]." (veliye üçüncü kişi: "zorlandığı"); sayılar Detay'ın satırı
-- counts_line'dadır: "6 soruda 3 doğru, 1 yanlış, 2 boş[, N notlanmadı]." (toplam tutar).
create or replace function public.exam_session_view(p_session uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_s public.exam_sessions%rowtype;
  v_x public.exams%rowtype;
  v_student uuid;
  v_parent boolean;
  v_graded boolean;
  v_heat jsonb;
  v_sections jsonb;
  v_items jsonb := '[]'::jsonb;
  v_weak jsonb;
  v_cause text;
  v_summary jsonb;
  v_report jsonb;
  v_line text;
  v_counts text;
  v_blank int;
  v_ungraded int;
  v_unverified int;
begin
  select es.* into v_s from public.exam_sessions es where es.id = p_session;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 oturum bulunamadı';
  end if;
  v_student := app.student_of_enrollment(v_s.enrollment_id);
  if not (app.is_trusted() or app.can_read_student(v_student)) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu oturum için yetki yok';
  end if;
  v_parent := not app.is_trusted() and not app.can_read_student_data(v_student);
  select x.* into v_x from public.exams x where x.id = v_s.exam_id;
  v_graded := v_s.status in ('analysing', 'done') and v_s.score is not null;

  if v_graded then
    select coalesce(jsonb_agg(jsonb_build_object('skill_id', z.skill_id, 'name', z.name, 'total', z.total, 'correct', z.correct,
                                                 'wrong', z.wrong, 'blank', z.blank,
                                                 'band', case when z.correct::numeric / z.total < 0.5 then 'low'
                                                              when z.correct::numeric / z.total < 0.8 then 'mid' else 'high' end)
                              order by z.order_no, z.skill_id), '[]'::jsonb)
      into v_heat
      from (select s.id as skill_id, s.name, s.order_no, count(*) as total,
                   count(*) filter (where r.outcome = 'correct') as correct,
                   count(*) filter (where r.outcome = 'wrong') as wrong,
                   count(*) filter (where r.outcome in ('blank', 'unfinished')) as blank
              from public.exam_responses r
              join public.exam_questions q on q.id = r.exam_question_id
              join public.skills s on s.curriculum_id = v_x.curriculum_id and s.is_leaf and s.id = any(q.skill_ids)
             where r.session_id = p_session and r.outcome is not null
             group by s.id, s.name, s.order_no) as z;
    select h.e into v_weak from jsonb_array_elements(v_heat) as h (e)
     where (h.e ->> 'wrong')::int + (h.e ->> 'blank')::int > 0
     order by (h.e ->> 'wrong')::int + (h.e ->> 'blank')::int desc, (h.e ->> 'correct')::numeric / (h.e ->> 'total')::numeric, h.e ->> 'skill_id'
     limit 1;
    select c.cause into v_cause
      from (select sa.error_cause as cause from public.exam_responses r join public.solution_analyses sa on sa.id = r.solution_analysis_id
             where r.session_id = p_session and sa.error_cause is not null
            union all
            select 'time' from public.exam_responses r where r.session_id = p_session and r.blank_reason = 'time') as c
     group by c.cause order by count(*) desc, c.cause limit 1;
    v_blank := (v_s.score ->> 'blank')::int + (v_s.score ->> 'unfinished')::int;
    v_ungraded := coalesce((v_s.score ->> 'ungraded')::int, 0);
    v_unverified := coalesce((v_s.score ->> 'unverified_keys')::int, 0);
    -- sayılar toplamı tutar (anahtarsız soru "notlanmadı"); doğrulanmamış anahtar düşük güven etiketiyle
    v_counts := (v_s.score ->> 'total') || ' soruda ' || (v_s.score ->> 'correct') || ' doğru, ' || (v_s.score ->> 'wrong') || ' yanlış, '
                || v_blank || ' boş' || case when v_ungraded > 0 then ', ' || v_ungraded || ' notlanmadı' else '' end || '.';
    v_line := 'Net ' || app.tr_num((v_s.score ->> 'net')::numeric)
              || case when v_unverified > 0 then ' (anahtar doğrulanmadı)' else '' end
              || coalesce(case when v_parent then '; en çok zorlandığı konu: ' else '; en çok zorlandığın konu: ' end
                          || (v_weak ->> 'name'), '') || '.';
    v_summary := jsonb_build_object('total', (v_s.score ->> 'total')::int, 'correct', (v_s.score ->> 'correct')::int,
                                    'wrong', (v_s.score ->> 'wrong')::int, 'blank', (v_s.score ->> 'blank')::int,
                                    'unfinished', (v_s.score ->> 'unfinished')::int, 'ungraded', (v_s.score ->> 'ungraded')::int,
                                    'net', (v_s.score ->> 'net')::numeric, 'unverified_keys', coalesce((v_s.score ->> 'unverified_keys')::int, 0),
                                    'weakest', case when v_weak is null then null
                                                    else jsonb_build_object('skill_id', v_weak ->> 'skill_id', 'name', v_weak ->> 'name') end,
                                    'top_cause', v_cause, 'one_line', v_line, 'counts_line', v_counts);
    select coalesce(jsonb_agg(jsonb_build_object(
                                'section', sec.e ->> 'section',
                                'title', coalesce((select xs.e ->> 'title' from jsonb_array_elements(case when jsonb_typeof(v_x.sections) = 'array'
                                                                                                         then v_x.sections else '[]'::jsonb end) as xs (e)
                                                    where xs.e ->> 'code' = sec.e ->> 'section' limit 1), sec.e ->> 'section'),
                                'total', (sec.e ->> 'total')::int, 'correct', (sec.e ->> 'correct')::int, 'wrong', (sec.e ->> 'wrong')::int,
                                'blank', (sec.e ->> 'blank')::int, 'unfinished', (sec.e ->> 'unfinished')::int, 'net', (sec.e ->> 'net')::numeric)
                              order by sec.ord), '[]'::jsonb)
      into v_sections
      from jsonb_array_elements(coalesce(v_s.score -> 'sections', '[]'::jsonb)) with ordinality as sec (e, ord);

    if not v_parent then
      select coalesce(jsonb_agg(jsonb_build_object(
                                  'response_id', r.id, 'exam_question_id', q.id, 'no', q.no, 'section', q.section, 'kind', q.kind,
                                  'outcome', r.outcome, 'answer', r.answer,
                                  'stem_text', case when v_x.is_copyrighted then null else q.stem_text end,
                                  'options', case when jsonb_typeof(q.options) <> 'array' then q.options
                                                  else (select jsonb_agg(case when v_x.is_copyrighted then jsonb_build_object('key', o.opt -> 'key')
                                                                              else o.opt - 'misconception_tag' end order by o.ord)
                                                          from jsonb_array_elements(q.options) with ordinality as o (opt, ord)) end,
                                  'page_upload_id', q.page_upload_id, 'bbox', q.bbox, 'figure_upload_id', q.figure_upload_id,
                                  'skill_ids', to_jsonb(q.skill_ids), 'how_far_text', r.how_far_text, 'work_upload_ids', to_jsonb(r.work_upload_ids),
                                  'blank_reason', r.blank_reason, 'solution_analysis_id', r.solution_analysis_id,
                                  'diagnosis', case when sa.id is null then null
                                                    else jsonb_build_object('verdict', sa.verdict, 'error_cause', sa.error_cause,
                                                                            'failing_step_no', sa.failing_step_no,
                                                                            'one_line', sa.analysis ->> 'one_line') end,
                                  'state', case when sa.id is not null then 'diagnosed'
                                                when r.blank_reason is not null then 'reason_given'
                                                when hf.st = 'open' then 'pending'
                                                else 'needs_input' end,
                                  'diagnosis_failed', sa.id is null and hf.st = 'failed')
                                order by q.no), '[]'::jsonb)
        into v_items
        from public.exam_responses r
        join public.exam_questions q on q.id = r.exam_question_id
        left join public.solution_analyses sa on sa.id = r.solution_analysis_id
        cross join lateral (select app.exam_how_far_state(r.id) as st) as hf
       where r.session_id = p_session and r.outcome in ('wrong', 'blank', 'unfinished');
    end if;
  end if;

  select jsonb_build_object('id', gd.id, 'status', gd.status, 'pdf_path', gd.pdf_path) into v_report
    from public.generated_documents gd where gd.id = v_s.report_document_id;

  return jsonb_build_object(
    'session_id', v_s.id, 'exam_id', v_x.id, 'title', v_x.title, 'kind', v_x.kind, 'source', v_x.source, 'mode', v_s.mode,
    'status', v_s.status, 'pending', not v_graded, 'progress', v_s.progress, 'started_at', v_s.started_at,
    'finished_at', v_s.finished_at, 'duration_sec', v_s.duration_sec, 'deadline_at', app.exam_deadline(v_s.id),
    'is_copyrighted', v_x.is_copyrighted, 'answer_key_source', v_x.answer_key_source,
    'pages', case when v_parent then '[]'::jsonb else to_jsonb(v_s.upload_ids) end,
    'report', v_report, 'summary', v_summary, 'sections', coalesce(v_sections, '[]'::jsonb), 'heatmap', coalesce(v_heat, '[]'::jsonb),
    'items', v_items, 'items_hidden', v_parent);
end
$$;
comment on function public.exam_session_view(uuid) is 'Deneme sonuç ekranı: tek cümle özet, bölüm netleri, kazanım ısı haritası, yanlış/boş listesi (anahtar yok; telifli sınavda soru metni yok); veli yalnız özet.';

-- --- "Nereye kadar geldim?" ve boş bırakma nedeni ------------------------------------------------------

-- Öğrenci (ya da owner eğitmen, admin, worker) notlanmış oturumda yanlış/boş bir soru için metin ve/veya ≤ 4 fotoğraf
-- gönderir: exam_responses.how_far_text / work_upload_ids yazılır, fotoğraflar 'processing', 'diagnosis.run' işi deneme
-- bağlamıyla (context='exam', exam_response_id; apply_diagnosis deneme bağlamında ağırlık 0 yazar). Aynı girdinin yeniden
-- denemesi aynı işi döner (reused, anahtar audit.events 'exam.how_far'); teşhis edilmiş ya da başka girdiyle bekleyen
-- soru OGR-EXAM-009. Son iş düştüyse (app.exam_how_far_state = failed: worker 'diagnosis.failed' yazdı) deneme kapalıdır:
-- aynı ya da yeni girdi yeni iş atar; düşen işin kendi 'failed' fotoğrafları yeniden gönderilebilir.
-- Döner: {response_id, job_id, reused}.
create or replace function public.exam_how_far(p_response uuid, p_text text default null, p_upload_ids uuid[] default null) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_r public.exam_responses%rowtype;
  v_s public.exam_sessions%rowtype;
  v_student uuid;
  v_text text := nullif(btrim(p_text), '');
  v_ids uuid[] := coalesce(p_upload_ids, '{}');
  v_key jsonb;
  v_prev jsonb;
  v_state text;
  v_job uuid;
begin
  select r.* into v_r from public.exam_responses r where r.id = p_response for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 cevap bulunamadı';
  end if;
  select es.* into v_s from public.exam_sessions es where es.id = v_r.session_id;
  v_student := app.student_of_enrollment(v_s.enrollment_id);
  perform app.assert_student_access(v_student, true);
  if v_s.status not in ('analysing', 'done') then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-003 oturum %s: önce notlanmalı', v_s.status);
  end if;
  if v_r.outcome is null or v_r.outcome not in ('wrong', 'blank', 'unfinished') then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 yalnız yanlış ya da boş soru için';
  end if;
  if v_text is null and cardinality(v_ids) = 0 then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 metin ya da en az bir fotoğraf gerekir';
  end if;
  if length(v_text) > 2000 or cardinality(v_ids) > 4 or array_position(v_ids, null) is not null
     or (select count(distinct x.u) from unnest(v_ids) as x (u)) <> cardinality(v_ids) then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 metin en çok 2000 karakter, en çok 4 tekil fotoğraf';
  end if;
  if cardinality(v_ids) > 0 and (not app.uploads_ok(v_ids, v_student)
       or (select count(*) from public.uploads u where u.id = any(v_ids) and u.student_id = v_student) <> cardinality(v_ids)) then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-006 fotoğraflar bu öğrenciye ait değil';
  end if;
  v_key := app.exam_how_far_key(v_text, v_ids);
  v_state := app.exam_how_far_state(p_response);
  select ae.diff into v_prev from audit.events ae
   where ae.action = 'exam.how_far' and ae.row_id = p_response::text
   order by ae.created_at desc, ae.id desc limit 1;
  if v_state = 'open' and v_prev -> 'key' = v_key then
    return jsonb_build_object('response_id', p_response, 'job_id', v_prev ->> 'job_id', 'reused', true);
  end if;
  if v_r.solution_analysis_id is not null then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-009 bu soru zaten teşhis edildi';
  end if;
  if v_state = 'open' then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-009 bu sorunun teşhisi sürüyor';
  end if;
  if exists (select 1 from public.uploads u where u.id = any(v_ids)
                and u.status <> 'stored' and not (u.status = 'failed' and u.id = any(v_r.work_upload_ids))) then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-003 fotoğraf başka bir gönderimde işleniyor ya da işlendi';
  end if;
  update public.exam_responses r
     set how_far_text = coalesce(v_text, r.how_far_text),
         work_upload_ids = case when cardinality(v_ids) > 0 then v_ids else r.work_upload_ids end
   where r.id = p_response;
  v_job := app.exam_enqueue_diagnosis(p_response, v_text, v_ids);
  return jsonb_build_object('response_id', p_response, 'job_id', v_job, 'reused', false);
end
$$;
comment on function public.exam_how_far(uuid, text, uuid[]) is 'Öğrenci: yanlış/boş deneme sorusu için "nereye kadar geldim" (metin, ≤ 4 fotoğraf) → diagnosis.run (context=exam); aynı girdinin tekrarı aynı işi döner; düşen teşhisten sonra yeniden gönderilebilir.';

-- Boş (ya da yetişmeyen) soru için neden: 'not_started' (hiç başlayamadım) ya da 'time' (süre yetmedi). Bir kez yazılır
-- (aynı neden tekrar: değişiklik yok; farklı neden OGR-EXAM-009). 'time': sorunun notlama gözlemleri (boş → ağırlık
-- exam_blank_weight 0.5) error_cause = 'time' olarak işaretlenir (dossier'in 30 g hata nedeni histogramına "süre" girer;
-- ağırlık zaten 0.5: ustalık yeniden hesaplanmaz). Yetişmeyen (unfinished) soru notlamada gözlem üretmediğinden yeni
-- kanıt yazılmaz. 'not_started': gözlem değişmez (boş kanıtı olduğu gibi kalır). Döner: {response_id, blank_reason,
-- observations_marked, changed}.
create or replace function public.exam_blank_reason(p_response uuid, p_reason text) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_r public.exam_responses%rowtype;
  v_s public.exam_sessions%rowtype;
  v_n int := 0;
begin
  if p_reason is null or p_reason not in ('not_started', 'time') then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-007 geçersiz neden %s', coalesce(p_reason, '(boş)'));
  end if;
  select r.* into v_r from public.exam_responses r where r.id = p_response for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 cevap bulunamadı';
  end if;
  select es.* into v_s from public.exam_sessions es where es.id = v_r.session_id;
  perform app.assert_student_access(app.student_of_enrollment(v_s.enrollment_id), true);
  if v_s.status not in ('analysing', 'done') then
    raise exception using errcode = 'P0001', message = format('OGR-EXAM-003 oturum %s: önce notlanmalı', v_s.status);
  end if;
  if v_r.outcome is null or v_r.outcome not in ('blank', 'unfinished') then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 neden yalnız boş bırakılan soru için';
  end if;
  if v_r.blank_reason = p_reason then
    return jsonb_build_object('response_id', p_response, 'blank_reason', p_reason, 'observations_marked', 0, 'changed', false);
  end if;
  if v_r.blank_reason is not null then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-009 neden zaten verildi';
  end if;
  update public.exam_responses r set blank_reason = p_reason where r.id = p_response;
  if p_reason = 'time' then
    update public.observations o
       set error_cause = 'time'
     where o.source_type = 'exam_response' and o.source_id = p_response::text and o.enrollment_id = v_s.enrollment_id
       and o.kind = 'test' and o.value = 0;
    get diagnostics v_n = row_count;
  end if;
  perform app.audit_event('exam.blank_reason', 'public.exam_responses', p_response::text,
                          jsonb_build_object('reason', p_reason, 'session_id', v_s.id, 'observations_marked', v_n));
  return jsonb_build_object('response_id', p_response, 'blank_reason', p_reason, 'observations_marked', v_n, 'changed', true);
end
$$;
comment on function public.exam_blank_reason(uuid, text) is 'Öğrenci: boş soru nedeni (not_started | time); time → sorunun boş gözlemleri error_cause=time (ağırlık 0.5 korunur).';

-- --- apply_diagnosis (0026) yeniden: deneme bağlamında style_coverage yok ------------------------------------

-- 0026 davranışı aynen; farklar: exam_response_id taşıyan (deneme bağlamlı) teşhis style_coverage'a yazmaz, çünkü
-- grade_exam_session aynı soruyu (seen_count, solved_count, correct_count) zaten saydı; cevabın sınavı telifliyse
-- question_text yazılmaz (solution_analyses öğrenci/veliye RLS ile açık; telif koruması worker'a bırakılmaz). Gözlem
-- ağırlığı 0 kuralı aynen.
create or replace function public.apply_diagnosis(p_analysis jsonb) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_enr public.enrollments%rowtype;
  v_id uuid;
  v_verdict text;
  v_cause text;
  v_skills text[];
  v_tags text[];
  v_style uuid;
  v_resp uuid;
  v_msg bigint;
  v_step int;
  v_bad text;
  v_weight numeric;
  v_skill text;
  v_tag text;
  v_obs bigint;
  v_prop jsonb;
  v_prop_id uuid;
  v_auto boolean;
  v_res jsonb;
  v_qtext text;
begin
  if coalesce(jsonb_typeof(p_analysis), '') <> 'object' or coalesce(jsonb_typeof(p_analysis -> 'analysis'), '') <> 'object' then
    raise exception using errcode = 'P0001', message = 'OGR-DIAG-001 girdi nesne olmalı ve analysis alanı (nesne) taşımalı';
  end if;
  select e.* into v_enr from public.enrollments e where e.id = (p_analysis ->> 'enrollment_id')::uuid;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-DIAG-001 enrollment_id bulunamadı';
  end if;
  perform app.assert_evidence_writer(v_enr.student_id);

  v_verdict := p_analysis ->> 'verdict';
  v_cause := nullif(p_analysis ->> 'error_cause', '');
  v_style := nullif(p_analysis ->> 'style_id', '')::uuid;
  v_resp := nullif(p_analysis ->> 'exam_response_id', '')::uuid;
  v_msg := nullif(p_analysis ->> 'conversation_message_id', '')::bigint;
  v_step := nullif(p_analysis ->> 'failing_step_no', '')::int;
  v_prop := p_analysis -> 'proposed_subskill';
  v_skills := array(select distinct x.sid from jsonb_array_elements_text(coalesce(p_analysis -> 'skill_ids', '[]')) as x (sid) order by x.sid);
  v_tags := array(select x.tag from jsonb_array_elements_text(coalesce(p_analysis -> 'misconception_tags', '[]')) with ordinality as x (tag, ord)
                   group by x.tag order by min(x.ord));

  if v_verdict is null or v_verdict not in ('correct', 'wrong', 'incomplete', 'unreadable') then
    raise exception using errcode = 'P0001', message = format('OGR-DIAG-001 verdict geçersiz: %s', coalesce(v_verdict, '(boş)'));
  end if;
  if v_cause is not null and v_cause not in ('concept', 'procedure', 'careless', 'reading', 'time') then
    raise exception using errcode = 'P0001', message = format('OGR-DIAG-001 error_cause geçersiz: %s', v_cause);
  end if;
  select string_agg(x.sid, ', ') into v_bad from unnest(v_skills) as x (sid)
   where not exists (select 1 from public.skills s where s.curriculum_id = v_enr.curriculum_id and s.id = x.sid and s.is_leaf);
  if v_bad is not null then
    raise exception using errcode = 'P0001', message = format('OGR-DIAG-002 kazanım bu kaydın müfredatında yaprak değil: %s', v_bad);
  end if;
  select string_agg(x.tag, ', ') into v_bad from unnest(v_tags) as x (tag)
   where not exists (select 1 from public.misconception_tags mt where mt.tag = x.tag);
  if v_bad is not null then
    raise exception using errcode = 'P0001', message = format('OGR-DIAG-003 bilinmeyen yanılgı etiketi: %s', v_bad);
  end if;
  if v_step is not null and jsonb_typeof(p_analysis -> 'analysis' -> 'steps') = 'array'
     and v_step > jsonb_array_length(p_analysis -> 'analysis' -> 'steps') then
    raise exception using errcode = 'P0001', message = format('OGR-DIAG-004 failing_step_no (%s) adım sayısından büyük', v_step);
  end if;
  if v_resp is not null and not exists (select 1 from public.exam_responses r join public.exam_sessions es on es.id = r.session_id
                                         where r.id = v_resp and es.enrollment_id = v_enr.id) then
    raise exception using errcode = 'P0001', message = 'OGR-DIAG-005 exam_response_id bu kayda ait değil';
  end if;
  v_qtext := p_analysis ->> 'question_text';
  if v_resp is not null and exists (select 1 from public.exam_responses r
                                       join public.exam_questions q on q.id = r.exam_question_id
                                       join public.exams x on x.id = q.exam_id
                                      where r.id = v_resp and x.is_copyrighted) then
    v_qtext := null;
  end if;
  if v_msg is not null and not exists (select 1 from public.conversation_messages m join public.conversations c on c.id = m.conversation_id
                                        where m.id = v_msg and c.student_id = v_enr.student_id) then
    raise exception using errcode = 'P0001', message = 'OGR-DIAG-005 conversation_message_id bu öğrenciye ait değil';
  end if;
  if v_style is not null and not exists (select 1 from public.question_styles qs
                                          where qs.id = v_style and (v_enr.course_id is null or qs.course_id = v_enr.course_id)) then
    raise exception using errcode = 'P0001', message = 'OGR-DIAG-005 style_id bu kaydın dersinde değil';
  end if;
  if not app.uploads_ok(array(select x.u::uuid from jsonb_array_elements_text(coalesce(p_analysis -> 'upload_ids', '[]')) as x (u)),
                        v_enr.student_id) then
    raise exception using errcode = 'P0001', message = 'OGR-DIAG-005 upload_ids bu öğrenciye ait değil';
  end if;

  insert into public.solution_analyses (enrollment_id, conversation_message_id, exam_response_id, upload_ids, question_text,
                                        student_work_text, analysis, verdict, failing_step_no, error_cause, skill_ids,
                                        misconception_tags, style_id, model, cost_usd, embedding)
  values (v_enr.id, v_msg, v_resp,
          array(select x.u::uuid from jsonb_array_elements_text(coalesce(p_analysis -> 'upload_ids', '[]')) as x (u)),
          v_qtext, p_analysis ->> 'student_work_text', p_analysis -> 'analysis', v_verdict, v_step, v_cause,
          v_skills, v_tags, v_style, p_analysis ->> 'model', coalesce((p_analysis ->> 'cost_usd')::numeric, 0),
          case when jsonb_typeof(p_analysis -> 'embedding') = 'array' then (p_analysis ->> 'embedding')::halfvec(1024) end)
  returning id into v_id;

  -- uygun yaprak yoksa alt kazanım önerisi; otopilot etkin taslak müfredatta → hemen kabul ve gözlem yeni yaprağa
  -- (0026: öneri bloğu gözlemlerden önce)
  if jsonb_typeof(v_prop) = 'object' then
    insert into public.curriculum_proposals (curriculum_id, kind, payload, evidence_ids)
    values (v_enr.curriculum_id, 'add_subskill', v_prop || jsonb_build_object('source', 'diagnosis'), array[v_id])
    returning id into v_prop_id;
    update public.solution_analyses sa set proposal_id = v_prop_id where sa.id = v_id;
    -- otopilot kuralı müfredat kurucuyla aynı (curriculum_autopilot_state: ai_draft + TYT/AYT/LGS + eğitmen seçimi ya da
    -- runtime_flags). Yerinde kabul yalnız taslakta: yayındaki ağaç değişmez, öneri açık kalır ve gece incelemesi
    -- (curriculum_autopilot_accept) onu açık taslak sürüme uygular.
    v_auto := coalesce((public.curriculum_autopilot_state(v_enr.curriculum_id) ->> 'effective')::boolean, false)
              and exists (select 1 from public.curricula c where c.id = v_enr.curriculum_id and c.status = 'draft');
    if v_auto then
      v_res := app.apply_proposal(v_prop_id, true, 'otopilot');
      -- otopilotun açtığı yaprak bu çözümün kanıtıdır: gözlem ona yazılır (0026)
      if v_res ->> 'skill_id' is not null and cardinality(v_skills) = 0 then
        v_skills := array[v_res ->> 'skill_id'];
        update public.solution_analyses sa set skill_ids = v_skills where sa.id = v_id;
      end if;
    end if;
  end if;

  -- gözlemler: okunamayan çözüm kanıt değildir
  if v_verdict <> 'unreadable' then
    v_weight := case when v_resp is not null then 0
                     when v_cause in ('careless', 'time') then app.setting_num('careless_weight', 0.5)
                     else 1 end;
    foreach v_skill in array v_skills loop
      v_tag := null;
      if v_verdict <> 'correct' then
        select x.tag into v_tag from unnest(v_tags) with ordinality as x (tag, ord)
          join public.misconception_tags mt on mt.tag = x.tag
         where mt.skill_id = v_skill
         order by x.ord limit 1;
        if v_tag is null and cardinality(v_skills) = 1 then
          v_tag := v_tags[1];
        end if;
      end if;
      insert into public.observations (enrollment_id, skill_id, kind, value, weight, confidence, error_cause, source_type, source_id,
                                       source_locator, quote, misconception_tag, counts_for_mastery)
      values (v_enr.id, v_skill, 'practice', case when v_verdict = 'correct' then 1 else 0 end, v_weight,
              (p_analysis ->> 'confidence')::numeric, case when v_verdict = 'correct' then null else v_cause end,
              'solution_analysis', v_id::text,
              'teşhis ' || left(v_id::text, 8) || coalesce(' · adım ' || v_step, '') || case when v_resp is not null then ' · deneme' else '' end,
              left(nullif(p_analysis ->> 'quote', ''), 300), v_tag, v_resp is null)
      returning id into v_obs;
      perform public.apply_observation(v_obs);
    end loop;
  end if;

  -- deneme bağlamında (exam_response_id) tarzı grade_exam_session zaten saydı: ikinci kez sayılmaz (0030)
  if v_style is not null and v_resp is null then
    insert into public.style_coverage as sc (enrollment_id, style_id, seen_count, solved_count, correct_count, last_seen_at)
    values (v_enr.id, v_style, 1, case when v_verdict = 'unreadable' then 0 else 1 end, case when v_verdict = 'correct' then 1 else 0 end, now())
    on conflict (enrollment_id, style_id) do update
      set seen_count = sc.seen_count + 1,
          solved_count = sc.solved_count + excluded.solved_count,
          correct_count = sc.correct_count + excluded.correct_count,
          last_seen_at = now();
  end if;
  if v_resp is not null then
    update public.exam_responses r set solution_analysis_id = v_id where r.id = v_resp;
  end if;

  perform app.try_enqueue('diagnosis.followup', jsonb_build_object('analysis_id', v_id, 'enrollment_id', v_enr.id));
  return v_id;
end
$$;
comment on function public.apply_diagnosis(jsonb) is 'Teşhisi yazar: solution_analyses (telifli deneme sorusunda question_text yok) + observations (careless/time w=0.5; deneme bağlamı 0) → apply_observation + style_coverage (deneme bağlamında yok: notlama saydı) (+ öneri; otopilot etkin taslakta hemen kabul, gözlem yeni yaprağa); id döner.';

-- --- yetkiler ------------------------------------------------------------------------------------------

revoke all on function app.can_edit_exam(uuid), app.can_read_exam(uuid), app.exam_has_graded_session(uuid), app.exam_duration_min(uuid), app.exam_deadline(uuid), app.exam_default_title(timestamptz),
  app.tr_num(numeric), app.exam_enqueue_diagnosis(uuid, text, uuid[]), app.exam_how_far_key(text, uuid[]),
  app.exam_how_far_state(uuid) from public;
-- app.can_read_exam politikalarda (exams_select, exam_questions_select_staff) ve v_exam_questions_student'ta çağrılır
grant execute on function app.can_read_exam(uuid), app.exam_duration_min(uuid), app.exam_deadline(uuid), app.tr_num(numeric) to authenticated, service_role;

revoke all on function public.submit_exam_upload(uuid[], jsonb), public.set_exam_progress(uuid, text, jsonb),
  public.register_exam_questions(uuid, jsonb), public.set_exam_keys(uuid, jsonb, text), public.record_exam_answers(uuid, jsonb),
  public.exam_session_view(uuid), public.exam_how_far(uuid, text, uuid[]), public.exam_blank_reason(uuid, text) from public, anon;
-- set_exam_progress / record_exam_answers authenticated'a açıktır ama gövde app.is_trusted() ister (açık OGR-AUTH-002)
grant execute on function public.submit_exam_upload(uuid[], jsonb), public.set_exam_progress(uuid, text, jsonb),
  public.register_exam_questions(uuid, jsonb), public.set_exam_keys(uuid, jsonb, text), public.record_exam_answers(uuid, jsonb),
  public.exam_session_view(uuid), public.exam_how_far(uuid, text, uuid[]), public.exam_blank_reason(uuid, text)
  to authenticated, service_role;
