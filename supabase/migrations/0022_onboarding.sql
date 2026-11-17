-- 0022_onboarding.sql — iki adımlı onboarding'in veritabanı tarafı (docs/PLAN-v2.md §3.5, §13 "Onboarding").
-- "Hangi sınava/derse hazırlanıyorsun?" metni (arama ya da çip: TYT, AYT, LGS …) + hedef tarih → onboarding_enroll:
--   1. görünür bir ders (courses: paylaşılan/açık ya da çağıranın) koduna/adına uyuyorsa o dersin müfredatına kaydolur
--      (taslak da olsa: aynı dersi seçen ikinci öğrenci mevcut müfredata kaydolur);
--   2. değilse aktif bir müfredatın (curricula.status='active') koduna/adına uyuyorsa ona bir ders açılır ve kaydolunur;
--   3. hiçbiri yoksa ders + curricula(status='draft', origin='ai_draft') iskeleti (kazanımsız) açılır, kaydolunur ve
--      'curriculum.draft' işi kuyruğa atılır (worker taslağı kurar; otopilot sınav parkurlarında öğrenciyi taslakta başlatır).
--      Bu ders visibility='private' açılır (created_by = çağıran): başlığı ve müfredat etiketi yalnız açana, kayıtlılara
--      ve personele görünür (app.can_read_course/can_read_curriculum kayıt koşulu); listEnrollableCourses'a girmez.
-- Her durumda profiles.onboarded_at yazılır ve 'suggestions.refresh' işi atılır (Bugün'ün ilk kartı).
-- Güvenlik: öğrencinin yazdığı metin başka öğrencilere yalnız TAM eşleşmeyle ulaşır: onboarding'in açtığı özel ders
-- (ai_draft + source_refs kind 'onboarding') yalnız kademe 1'de (tam ad/kod) eşleşir ve eşleşen öğrenci kaydıyla
-- okur; başka hiçbir yoldan listelenmez. Önek/içinde-geçer eşleşmesi (kademe
-- 3–6) yalnız 3+ karakterlik aramada ve yalnız eğitmen/seed derslerinde (ai_draft müfredatlı ya da öğrencinin açtığı
-- derste değil) uygulanır. Yeni ders taslağı (ve Opus + web araması kullanan curriculum.draft işi) çağıran başına son
-- 24 saatte en çok settings.onboarding_created_daily (3) kez açılır; fazlası OGR-ONB-003 (worker ve admin muaf).
-- Eşzamanlılık: aynı sade metinle gelen çağrılar metin başına danışma kilidiyle sırayla çalışır (ikincisi ilkinin dersini
-- kademe 1'de bulur); müfredat eşleşmesinde ders açılışı müfredat başına kilitlenir. Yine de kod çakışırsa
-- (unique_violation) eşleşme bir kez yeniden çalışır.

-- Arama için sade biçim: Türkçe harfler ASCII'ye, küçük harf, harf/rakam dışı tek boşluk
create or replace function app.norm_text(p_text text) returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select btrim(regexp_replace(lower(translate(coalesce(p_text, ''), 'ÇĞİIÖŞÜÂÎÛçğıöşüâîû', 'CGIIOSUAIUcgiosuaiu')), '[^a-z0-9]+', ' ', 'g'))
$$;
comment on function app.norm_text(text) is 'Arama biçimi: Türkçe harfler ASCII, küçük harf, harf/rakam dışı tek boşluk (onboarding eşleşmesi).';

-- Kayıt: p_student boşsa oturumdaki öğrenci; doluysa owner eğitmen, admin ya da worker o öğrenci için çağırır.
-- Döner: {enrollment_id, course_id, course_code, course_title, curriculum_id, curriculum_status, curriculum_origin,
-- matched ('course' | 'curriculum' | 'created'), created, target_exam, exam_date, period_label, draft_job_id}.
create or replace function public.onboarding_enroll(p_course_text text, p_exam_date date default null, p_student uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := p_student;
  v_title text := btrim(regexp_replace(coalesce(p_course_text, ''), '\s+', ' ', 'g'));
  v_q text := app.norm_text(p_course_text);
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_course public.courses%rowtype;
  v_cur public.curricula%rowtype;
  v_matched text;
  v_tier int;
  v_course_id uuid;
  v_cur_id uuid;
  v_code text;
  v_exam text;
  v_kind text;
  v_period text;
  v_enr uuid;
  v_job uuid;
  v_created_n int;
  v_try int;
begin
  if v_student is null then
    v_student := app.my_student_id();
    if v_student is null then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 onboarding yalnız öğrenci oturumunda (ya da p_student ile)';
    end if;
  end if;
  perform app.assert_student_access(v_student, true);
  if char_length(v_q) < 2 or char_length(v_title) > 120 then
    raise exception using errcode = 'P0001', message = 'OGR-ONB-001 ders ya da sınav adı 2–120 karakter olmalı';
  end if;
  if p_exam_date is not null and p_exam_date < v_today then
    raise exception using errcode = 'P0001', message = 'OGR-ONB-002 hedef tarih geçmişte olamaz';
  end if;

  -- aynı sade metinle eşzamanlı çağrılar sırayla: ikincisi ilkinin açtığı dersi kademe 1'de bulur
  perform pg_advisory_xact_lock(hashtextextended('onboarding-text:' || v_q, 0));
  for v_try in 1..2 loop
    begin
      -- eşleşme: 1 ders tam ad/kod · 2 aktif müfredat tam ad/kod · 3 ders öneki · 4 müfredat öneki · 5/6 ad içinde geçer.
      -- 3–6 yalnız 3+ karakterde ve yalnız eğitmen/seed içeriğinde (öğrencinin açtığı ders, ai_draft müfredat: yalnız tam)
      select z.course_id, z.curriculum_id, z.tier into v_course_id, v_cur_id, v_tier
        from (
          select co.id as course_id, co.curriculum_id, c.status, c.created_at,
                 case when app.norm_text(co.code) = v_q or app.norm_text(co.title) = v_q then 1
                      when not l.loose or (co.visibility = 'private' and co.created_by is distinct from auth.uid()) then null
                      when app.norm_text(co.code) like v_q || '%' or app.norm_text(co.title) like v_q || '%' then 3
                      when app.norm_text(co.title) like '%' || v_q || '%' then 5 end as tier
            from public.courses co join public.curricula c on c.id = co.curriculum_id
            cross join lateral (
              select char_length(v_q) >= 3 and c.origin <> 'ai_draft'
                     and not exists (select 1 from public.profiles p where p.id = co.created_by and p.role = 'student') as loose
            ) as l
           where c.status <> 'retired'
             and (co.visibility <> 'private' or co.created_by = auth.uid()
                  -- onboarding'in açtığı özel ders: başkasına yalnız tam ad/kod eşleşmesiyle (aşağıda kademe 1)
                  or (c.origin = 'ai_draft' and c.source_refs @> '[{"kind": "onboarding"}]'::jsonb))
          union all
          select null, c.id, c.status, c.created_at,
                 case when app.norm_text(c.code) = v_q or app.norm_text(c.label) = v_q then 2
                      when char_length(v_q) < 3 or c.origin = 'ai_draft' then null
                      when app.norm_text(c.code) like v_q || '%' or app.norm_text(c.label) like v_q || '%' then 4
                      when app.norm_text(c.label) like '%' || v_q || '%' then 6 end
            from public.curricula c
           where c.status = 'active' and not exists (select 1 from public.courses co where co.curriculum_id = c.id)
        ) as z
       where z.tier is not null
       order by z.tier, (z.status = 'active') desc, z.created_at desc, z.curriculum_id
       limit 1;

      if v_course_id is not null then
        select co.* into v_course from public.courses co where co.id = v_course_id;
        v_matched := 'course';
      elsif v_cur_id is not null then
        -- aktif müfredatın dersi yok: aynı kodla (doluysa ekli) paylaşılan bir ders açılır. Müfredat başına kilit: başka
        -- metinle aynı müfredatı bulan eşzamanlı çağrı bu arada dersi açtıysa o ders kullanılır.
        perform pg_advisory_xact_lock(hashtextextended('onboarding-curriculum:' || v_cur_id::text, 0));
        select co.* into v_course from public.courses co
         where co.curriculum_id = v_cur_id and co.visibility <> 'private' order by co.created_at, co.id limit 1;
        if found then
          v_matched := 'course';
          exit;
        end if;
        select c.* into v_cur from public.curricula c where c.id = v_cur_id;
        v_code := v_cur.code;
        if exists (select 1 from public.courses co where co.code = v_code) then
          v_code := v_code || '-' || substr(md5(v_cur.id::text), 1, 4);
        end if;
        insert into public.courses (code, title, kind, curriculum_id, visibility)
        values (v_code, v_cur.label,
                case when app.norm_text(v_cur.code) ~ '^(tyt|ayt|lgs|kpss|yks|ales|dgs|yds)( |$)' then 'exam_track' else 'other' end,
                v_cur.id, 'shared')
        returning * into v_course;
        v_matched := 'curriculum';
      else
        -- yeni taslak (Opus + web araması işi): çağıran başına son 24 saatte en çok onboarding_created_daily
        if not (app.is_trusted() or app.is_admin()) then
          perform pg_advisory_xact_lock(hashtextextended('onboarding:' || coalesce(auth.uid()::text, v_student::text), 0));
          select count(*) into v_created_n from public.curricula c
           where c.origin = 'ai_draft' and c.created_by = auth.uid() and c.created_at > now() - interval '1 day'
             and c.source_refs @> '[{"kind": "onboarding"}]'::jsonb;
          if v_created_n >= app.setting_num('onboarding_created_daily', 3)::int then
            raise exception using errcode = 'P0001', message = 'OGR-ONB-003 bugün yeterince yeni ders açtın; listeden seç ya da yarın dene';
          end if;
        end if;
        v_code := upper(left(replace(v_q, ' ', '-'), 40));
        if exists (select 1 from public.courses co where co.code = v_code)
           or exists (select 1 from public.curricula c where c.code = v_code and c.year = extract(year from v_today) and c.version = '1') then
          v_code := v_code || '-' || substr(md5(gen_random_uuid()::text), 1, 4);
        end if;
        v_exam := upper(substring(v_q from '^(tyt|ayt|lgs|kpss|yks|ales|dgs|yds)( |$)'));
        insert into public.curricula (code, authority, year, version, label, status, origin, source_refs, created_by)
        values (v_code, case when v_exam = 'LGS' then 'MEB' when v_exam is not null then 'ÖSYM' else 'OTHER' end,
                extract(year from v_today)::smallint, '1', v_title, 'draft', 'ai_draft',
                jsonb_build_array(jsonb_build_object('kind', 'onboarding', 'ref', v_title)), auth.uid())
        returning id into v_cur_id;
        insert into public.courses (code, title, kind, curriculum_id, visibility, created_by)
        values (v_code, v_title, case when v_exam is not null then 'exam_track' else 'other' end, v_cur_id, 'private', auth.uid())
        returning * into v_course;
        v_matched := 'created';
      end if;
      exit;
    exception when unique_violation then
      -- kod yarışı (farklı metin, aynı kod): eşleşme bir kez daha; ikincide hata yükselir
      if v_try = 2 then
        raise;
      end if;
      v_course_id := null;
      v_cur_id := null;
      v_matched := null;
    end;
  end loop;
  select c.* into v_cur from public.curricula c where c.id = v_course.curriculum_id;

  v_exam := upper(substring(v_q || ' ' || app.norm_text(v_course.code) from '\m(tyt|ayt|lgs|kpss|yks|ales|dgs|yds)\M'));
  v_kind := v_course.kind;
  v_period := case when v_kind = 'exam_track' then coalesce((select st.value #>> '{}' from public.settings st where st.key = 'default_period'),
                                                              'YKS ' || (extract(year from v_today)::int + 1))
                   when extract(month from v_today) >= 8 then extract(year from v_today)::int || ' Güz'
                   when extract(month from v_today) = 1 then (extract(year from v_today)::int - 1) || ' Güz'
                   else extract(year from v_today)::int || ' Bahar' end;

  insert into public.enrollments as e (student_id, curriculum_id, course_id, period_label, target_exam, exam_date)
  values (v_student, v_cur.id, v_course.id, v_period, v_exam, p_exam_date)
  on conflict (student_id, curriculum_id, period_label) do update
    set status = 'active', course_id = excluded.course_id, target_exam = coalesce(excluded.target_exam, e.target_exam),
        exam_date = coalesce(excluded.exam_date, e.exam_date)
  returning e.id into v_enr;

  update public.profiles p set onboarded_at = now()
   where p.id = (select st.profile_id from public.students st where st.id = v_student) and p.onboarded_at is null;
  if v_matched = 'created' then
    v_job := app.try_enqueue('curriculum.draft', jsonb_build_object(
      'curriculum_id', v_cur.id, 'course_id', v_course.id, 'course_text', v_title, 'enrollment_id', v_enr,
      'student_id', v_student, 'target_exam', v_exam, 'course_kind', v_kind));
  end if;
  perform app.try_enqueue('suggestions.refresh', jsonb_build_object('student_id', v_student, 'enrollment_id', v_enr,
                                                                    'reason', 'onboarding'));
  return jsonb_build_object(
    'enrollment_id', v_enr, 'course_id', v_course.id, 'course_code', v_course.code, 'course_title', v_course.title,
    'curriculum_id', v_cur.id, 'curriculum_status', v_cur.status, 'curriculum_origin', v_cur.origin, 'matched', v_matched,
    'created', v_matched = 'created', 'target_exam', v_exam, 'exam_date', p_exam_date, 'period_label', v_period,
    'draft_job_id', v_job);
end
$$;
comment on function public.onboarding_enroll(text, date, uuid) is 'Onboarding kaydı: ders/aktif müfredat eşleşmesi (öğrenci içeriğinde yalnız tam) ya da özel ders + ai_draft müfredat iskeleti + curriculum.draft işi (günlük sınır OGR-ONB-003); kayıt + onboarded_at + suggestions.refresh.';

revoke all on function app.norm_text(text) from public;
grant execute on function app.norm_text(text) to authenticated, service_role;
revoke all on function public.onboarding_enroll(text, date, uuid) from public;
grant execute on function public.onboarding_enroll(text, date, uuid) to authenticated, service_role;
