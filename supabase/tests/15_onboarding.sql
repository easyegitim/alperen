-- tests/15_onboarding.sql — onboarding_enroll (0022): ders adı/çip + hedef tarih → kayıt. Eşleşme sırası: görünür ders
-- (taslak müfredatlı da; ikinci öğrenci aynı derse kaydolur) → dersi olmayan aktif müfredat (ders açılır) → hiçbiri
-- yoksa ders + curricula(draft, ai_draft) iskeleti + curriculum.draft işi. Başka kullanıcının özel dersi eşleşmez.
-- Tekrar çağrı aynı kaydı döner (tarih güncellenir); onboarded_at yazılır; suggestions.refresh işi atılır. Hatalar:
-- kısa metin OGR-ONB-001, geçmiş tarih OGR-ONB-002, öğrenci olmayan/başkası adına OGR-AUTH-001, günde 3'ten fazla yeni
-- ders OGR-ONB-003. Öğrencinin açtığı ders özeldir (başka öğrenci başlığı ve müfredat etiketini okuyamaz) ve
-- başkasına yalnız tam eşleşmeyle ulaşır, kaydolan okur (önek/içinde-geçer ve 2 harflik arama eşleşmez); onaylanmamış taslak dersin başlığı dossier'a serbest metin olarak girmez. Canlı içerik: "TYT" çipi
-- TYT-MAT@2026.1 seed müfredatına (aktif) kaydeder.
begin;
\ir _fixture.sql

-- Dünya: dersi olmayan aktif müfredat (Fizik), eğitmenin özel dersi, emekli müfredat
do $$
declare
  v_cur uuid;
begin
  insert into public.curricula (code, version, label, status, origin) values ('X-FIZ', '1', 'Fizik Hazırlık', 'active', 'instructor') returning id into v_cur;
  insert into public.skills (curriculum_id, id, name, is_leaf) values (v_cur, 'fiz.kuvvet', 'Kuvvet', true);
  insert into t.cfg values ('FIZ', v_cur::text);
  insert into public.curricula (code, version, label, status) values ('X-ESKI', '1', 'Kimya Eski', 'retired');
  insert into public.curricula (code, version, label, status) values ('OZEL-KURS', '1', 'Özel Kurs', 'active') returning id into v_cur;
  insert into public.courses (code, title, kind, curriculum_id, visibility, created_by)
  values ('OZEL-KURS', 'Özel Kurs', 'other', v_cur, 'private', t.u('inst'));
  update public.profiles p set onboarded_at = null where p.id in (t.u('elif'), t.u('can'));
end $$;

-- Dersi olmayan aktif müfredat: ders açılır, kaydolunur
do $$
declare
  v_r jsonb;
  v_r2 jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_r := public.onboarding_enroll('  Fizik   hazırlık ', current_date + 120);
  perform t.ok(v_r ->> 'matched' = 'curriculum' and not (v_r ->> 'created')::boolean and v_r ->> 'curriculum_id' = t.v('FIZ')
               and v_r ->> 'curriculum_status' = 'active' and v_r ->> 'course_code' = 'X-FIZ' and v_r ->> 'course_title' = 'Fizik Hazırlık'
               and (v_r ->> 'exam_date')::date = current_date + 120 and v_r -> 'draft_job_id' = 'null'::jsonb,
               'aktif müfredat eşleşmesi: ders açıldı, kayıt (' || v_r::text || ')');
  perform t.as_admin();
  insert into t.cfg values ('FIZ_ENR', v_r ->> 'enrollment_id'), ('FIZ_COURSE', v_r ->> 'course_id');
  perform t.as_user(t.u('elif'));
  perform t.ok(t.n(format('select 1 from public.enrollments where id = %L and course_id = %L', v_r ->> 'enrollment_id', v_r ->> 'course_id')) = 1,
               'öğrenci kaydını görür (RLS)');
  v_r2 := public.onboarding_enroll('FİZİK HAZIRLIK', current_date + 150);
  perform t.ok(v_r2 ->> 'enrollment_id' = v_r ->> 'enrollment_id' and v_r2 ->> 'matched' = 'course'
               and (v_r2 ->> 'exam_date')::date = current_date + 150, 'tekrar çağrı: aynı kayıt (ders eşleşmesi), tarih güncellenir');
  perform t.as_admin();
  perform t.ok((select co.kind = 'other' and co.visibility = 'shared' and co.created_by is null from public.courses co where co.id = t.u('FIZ_COURSE')),
               'açılan ders paylaşılan, sistem dersi');
  perform t.ok((select e.exam_date = current_date + 150 and e.status = 'active' and e.period_label ~ '^[0-9]{4} (Güz|Bahar)$'
                  from public.enrollments e where e.id = t.u('FIZ_ENR')), 'okul dönemi etiketi (Güz/Bahar), tarih güncel');
  perform t.ok((select p.onboarded_at is not null from public.profiles p where p.id = t.u('elif')), 'profiles.onboarded_at yazıldı');
  perform t.ok(exists (select 1 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'suggestions.refresh'
                        and e.diff -> 'data' ->> 'enrollment_id' = t.v('FIZ_ENR')), 'suggestions.refresh işi denendi');
end $$;

-- Hiçbir eşleşme yok: ders + ai_draft müfredat iskeleti + curriculum.draft; ikinci öğrenci aynı taslağa kaydolur
do $$
declare
  v_r jsonb;
  v_r2 jsonb;
  v_n int := (select count(*) from public.curricula);
begin
  perform t.as_user(t.u('elif'));
  v_r := public.onboarding_enroll('Lineer Cebir MAT201', null);
  perform t.ok(v_r ->> 'matched' = 'created' and (v_r ->> 'created')::boolean and v_r ->> 'curriculum_status' = 'draft'
               and v_r ->> 'curriculum_origin' = 'ai_draft' and v_r ->> 'course_code' = 'LINEER-CEBIR-MAT201'
               and v_r ->> 'course_title' = 'Lineer Cebir MAT201' and v_r -> 'target_exam' = 'null'::jsonb and v_r -> 'exam_date' = 'null'::jsonb,
               'yeni ders: taslak ai_draft müfredat (' || v_r::text || ')');
  perform t.ok(t.n(format('select 1 from public.curricula where id = %L', v_r ->> 'curriculum_id')) = 1
               and t.n(format('select 1 from public.courses where id = %L', v_r ->> 'course_id')) = 1, 'öğrenci taslak müfredatı ve dersi görür');
  -- öğrencinin serbest metni başka öğrenciye listelenmez (özel ders; kurs önerileri ve müfredat etiketi kapalı)
  perform t.as_user(t.u('can'));
  perform t.ok(t.n($q$select 1 from public.courses where title ilike '%lineer cebir%' or code ilike '%LINEER%'$q$) = 0
               and t.n($q$select 1 from public.curricula where label ilike '%lineer cebir%' or code ilike '%LINEER%'$q$) = 0
               and t.n(format('select 1 from public.courses where id = %L', v_r ->> 'course_id')) = 0,
               'başka öğrenci açılan dersin başlığını ve müfredat etiketini göremez');
  v_r2 := public.onboarding_enroll('lineer cebir mat201');
  perform t.ok(v_r2 ->> 'matched' = 'course' and v_r2 ->> 'course_id' = v_r ->> 'course_id' and v_r2 ->> 'curriculum_id' = v_r ->> 'curriculum_id'
               and v_r2 ->> 'enrollment_id' <> v_r ->> 'enrollment_id' and v_r2 -> 'draft_job_id' = 'null'::jsonb,
               'ikinci öğrenci tam eşleşmeyle aynı taslak müfredata kaydolur (yeni taslak yok)');
  perform t.ok(t.n(format('select 1 from public.courses where id = %L and title = %L', v_r ->> 'course_id', 'Lineer Cebir MAT201')) = 1
               and t.n(format('select 1 from public.curricula where id = %L', v_r ->> 'curriculum_id')) = 1,
               'kaydolan ikinci öğrenci dersi ve müfredatı okur');
  perform t.as_admin();
  perform t.ok((select count(*) from public.curricula) = v_n + 1, 'yalnız bir müfredat iskeleti açıldı');
  perform t.ok((select co.visibility = 'private' and co.created_by = t.u('elif') from public.courses co where co.id = (v_r ->> 'course_id')::uuid),
               'açılan ders özel, oluşturan öğrenci');
  perform t.ok((select c.created_by = t.u('elif') and c.source_refs -> 0 ->> 'kind' = 'onboarding' and c.authority = 'OTHER'
                       and not exists (select 1 from public.skills s where s.curriculum_id = c.id)
                  from public.curricula c where c.id = (v_r ->> 'curriculum_id')::uuid), 'iskelet: oluşturan, kaynak, kazanımsız');
  perform t.ok((select count(*) from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'curriculum.draft'
                 and e.diff -> 'data' ->> 'curriculum_id' = v_r ->> 'curriculum_id'
                 and e.diff -> 'data' ->> 'course_text' = 'Lineer Cebir MAT201') = 1, 'curriculum.draft işi bir kez denendi');
end $$;

-- Sınav çipi (KPSS): sınav parkuru, hedef sınav, ÖSYM; özel ders eşleşmez (kod çakışınca ekli kod)
do $$
declare
  v_r jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_r := public.onboarding_enroll('KPSS', current_date + 300);
  perform t.ok(v_r ->> 'matched' = 'created' and v_r ->> 'target_exam' = 'KPSS' and v_r ->> 'period_label' = 'YKS 2027',
               'KPSS: sınav parkuru, hedef sınav, varsayılan dönem');
  perform t.as_admin();
  perform t.ok((select co.kind = 'exam_track' and c.authority = 'ÖSYM' from public.courses co join public.curricula c on c.id = co.curriculum_id
                 where co.id = (v_r ->> 'course_id')::uuid), 'KPSS dersi exam_track, müfredat ÖSYM');
  perform t.as_user(t.u('elif'));
  v_r := public.onboarding_enroll('Özel kurs');
  perform t.ok(v_r ->> 'matched' = 'created' and v_r ->> 'course_code' ~ '^OZEL-KURS-[0-9a-f]{4}$',
               'başkasının özel dersi eşleşmez; çakışan kod eklenir (' || (v_r ->> 'course_code') || ')');
  perform t.raises($q$select public.onboarding_enroll('Biyoloji Temel')$q$, 'OGR-ONB-003%', 'günde en çok 3 yeni ders taslağı');
  perform t.as_admin();
  perform t.ok((select count(*) from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'curriculum.draft'
                 and e.diff -> 'data' ->> 'course_text' = 'Biyoloji Temel') = 0, 'sınırda curriculum.draft işi atılmaz');
  perform t.as_user(t.u('can'));
  v_r := public.onboarding_enroll('Kimya Eski');
  perform t.ok(v_r ->> 'matched' = 'created', 'emekli müfredat eşleşmez');
  perform t.as_admin();
end $$;

-- Öğrencinin serbest metni: başka öğrenciye yalnız tam eşleşmeyle; dossier'da taslak başlığı yok
do $$
declare
  v_r jsonb;
  v_r2 jsonb;
  v_d jsonb;
begin
  perform t.add_outsiders();
  perform t.as_user(t.u('can'));
  v_r := public.onboarding_enroll('Kopya cevaplar burada www.ornek.com');
  perform t.ok(v_r ->> 'matched' = 'created', 'Can serbest metinle ders açtı');
  perform t.as_admin();
  insert into t.cfg values ('KOPYA_COURSE', v_r ->> 'course_id');
  perform t.as_user(t.u('deniz'));
  v_r2 := public.onboarding_enroll('ce');
  perform t.ok(v_r2 ->> 'course_id' <> t.v('KOPYA_COURSE') and v_r2 ->> 'matched' = 'created', '2 harflik arama öğrenci dersine eşleşmez');
  v_r2 := public.onboarding_enroll('kopya cevaplar');
  perform t.ok(v_r2 ->> 'course_id' <> t.v('KOPYA_COURSE'), 'öğrencinin dersine önekle eşleşme yok');
  v_r2 := public.onboarding_enroll('Kopya cevaplar burada www.ornek.com');
  perform t.ok(v_r2 ->> 'matched' = 'course' and v_r2 ->> 'course_id' = t.v('KOPYA_COURSE'), 'tam eşleşmede aynı derse kaydolur');
  perform t.ok(public.onboarding_enroll('fiz') ->> 'curriculum_id' = t.v('FIZ'), 'eğitmen/seed dersinde 3+ harfte önek eşleşmesi sürer');
  perform t.as_admin();
  v_d := public.render_dossier(t.u('B'), t.u('KOPYA_COURSE'));
  perform t.ok(v_d -> 'identity' -> 'course_title' = 'null'::jsonb and position('www.ornek.com' in v_d::text) = 0
               and v_d -> 'identity' ->> 'course_code' ~ '^[A-Z0-9-]+$',
               'onaylanmamış taslak dersin başlığı dossier''da yok, yalnız kod (' || (v_d -> 'identity')::text || ')');
  v_d := public.render_dossier(t.u('A'), t.u('FIZ_COURSE'));
  perform t.ok(v_d -> 'identity' ->> 'course_title' = 'Fizik Hazırlık', 'eğitmen/seed dersinin başlığı dossier''da kalır');
end $$;

-- Yetki ve hatalar
do $$
begin
  perform t.as_user(t.u('elif'));
  perform t.raises($q$select public.onboarding_enroll('x')$q$, 'OGR-ONB-001%', 'tek harf');
  perform t.raises($q$select public.onboarding_enroll('  -- ')$q$, 'OGR-ONB-001%', 'harfsiz metin');
  perform t.raises(format($q$select public.onboarding_enroll('Fizik', %L)$q$, current_date - 1), 'OGR-ONB-002%', 'geçmiş tarih');
  perform t.raises(format($q$select public.onboarding_enroll('Fizik', null, %L)$q$, t.u('B')), '42501', 'başka öğrenci adına kayıt yok');
  perform t.as_user(t.u('parent'));
  perform t.raises($q$select public.onboarding_enroll('TYT')$q$, 'OGR-AUTH-001%', 'veli onboarding yapamaz');
  perform t.as_user(t.u('inst'));
  perform t.raises($q$select public.onboarding_enroll('TYT')$q$, 'OGR-AUTH-001%', 'eğitmen p_student olmadan kaydolamaz');
  perform t.ok(public.onboarding_enroll('Fizik Hazırlık', null, t.u('B')) ->> 'matched' = 'course', 'owner eğitmen öğrencisi adına kaydeder');
  perform t.as_admin();
  perform t.ok(exists (select 1 from public.enrollments e where e.student_id = t.u('B') and e.curriculum_id = t.u('FIZ')), 'Can Fizik''e kayıtlı');
end $$;

-- Canlı içerik: "TYT" çipi seed müfredatına (TYT-MAT@2026.1, aktif) kaydeder; ikinci öğrenci aynı derse
insert into t.cfg values ('have_content', :'have_content');
do $$
declare
  v_r jsonb;
  v_r2 jsonb;
begin
  if t.v('have_content') <> '1' then
    raise notice 'SKIP: no content';
    return;
  end if;
  perform t.as_user(t.u('elif'));
  v_r := public.onboarding_enroll('TYT', current_date + 200);
  perform t.ok(v_r ->> 'matched' = 'curriculum' and v_r ->> 'target_exam' = 'TYT' and v_r ->> 'curriculum_status' = 'active'
               and v_r ->> 'course_code' = 'TYT-MAT' and v_r ->> 'period_label' = 'YKS 2027'
               and v_r ->> 'curriculum_id' = (select c.id::text from public.curricula c where c.code = 'TYT-MAT' and c.version = '2026.1'),
               'TYT çipi: seed müfredatı, TYT-MAT dersi açıldı (' || v_r::text || ')');
  perform t.as_user(t.u('can'));
  v_r2 := public.onboarding_enroll('TYT Matematik', current_date + 200);
  perform t.ok(v_r2 ->> 'matched' = 'course' and v_r2 ->> 'course_id' = v_r ->> 'course_id', 'ikinci öğrenci aynı TYT-MAT dersine kaydolur');
  perform t.as_admin();
  perform t.ok((select co.kind from public.courses co where co.id = (v_r ->> 'course_id')::uuid) = 'exam_track', 'TYT-MAT dersi sınav parkuru');
end $$;

rollback;
