-- 0004_curriculum.sql — müfredat sürümleri, kazanım ağacı, ön koşullar, yanılgı etiketleri, kayıtlar (BLUEPRINT §3.2)
-- Kazanım anahtarı bileşiktir (curriculum_id, id): aynı kazanım kimliği her müfredat sürümünde yeniden yazılır,
-- eski sürümün satırı ve ustalık değerleri dokunulmaz (ADR-0001 notu).

create table public.curricula (  -- Müfredat sürümleri (TYT-MAT@2026.1); resolve_telegram tek aktif sürümü arar.
  id uuid primary key default gen_random_uuid(),  -- Sürüm kimliği (seed: uuid5(code@version))
  code text not null,  -- Müfredat kodu: 'TYT-MAT'
  authority text not null check (authority in ('MEB', 'ÖSYM', 'UNI', 'OTHER')),  -- Kaynak kurum
  year smallint not null,  -- Kılavuz/program yılı
  version text not null,  -- Sürüm: '2026.1'
  label text not null,  -- Görünen ad: 'TYT Matematik 2026'
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),  -- Yaşam döngüsü
  unique (code, year, version)
);
-- begin comments public.curricula
comment on table public.curricula is 'Müfredat sürümleri (TYT-MAT@2026.1); resolve_telegram tek aktif sürümü arar.';
comment on column public.curricula.id is 'Sürüm kimliği (seed: uuid5(code@version))';
comment on column public.curricula.code is 'Müfredat kodu: ''TYT-MAT''';
comment on column public.curricula.authority is 'Kaynak kurum';
comment on column public.curricula.year is 'Kılavuz/program yılı';
comment on column public.curricula.version is 'Sürüm: ''2026.1''';
comment on column public.curricula.label is 'Görünen ad: ''TYT Matematik 2026''';
comment on column public.curricula.status is 'Yaşam döngüsü';
-- end comments public.curricula

create table public.skills (  -- Kazanımlar; bileşik anahtar (curriculum_id, id).
  curriculum_id uuid not null references public.curricula (id) on delete cascade,  -- Müfredat sürümü
  id text not null,  -- Kazanım kimliği ('tyt.mat.temel.rasyonel-sayilar'); sürümler arası eşleme eşitlikle
  parent_id text,  -- Üst düğüm ('tyt.mat.temel'); ustalık yalnız yapraklarda tutulur
  name text not null,  -- Kazanım adı
  description text,  -- Açıklama
  is_leaf boolean not null default true,  -- Yaprak mı
  order_no int not null default 0,  -- Sıra
  p_init numeric(4, 3) not null default 0.300 check (p_init between 0.001 and 0.999),  -- BKT başlangıç olasılığı
  p_learn numeric(4, 3) not null default 0.100 check (p_learn between 0.001 and 0.999),  -- BKT öğrenme olasılığı
  p_guess numeric(4, 3) not null default 0.250 check (p_guess between 0.001 and 0.999),  -- BKT tahmin olasılığı (4 şık)
  p_slip numeric(4, 3) not null default 0.100 check (p_slip between 0.001 and 0.999),  -- BKT kayma olasılığı
  primary key (curriculum_id, id),
  foreign key (curriculum_id, parent_id) references public.skills (curriculum_id, id)
);
-- begin comments public.skills
comment on table public.skills is 'Kazanımlar; bileşik anahtar (curriculum_id, id).';
comment on column public.skills.curriculum_id is 'Müfredat sürümü';
comment on column public.skills.id is 'Kazanım kimliği (''tyt.mat.temel.rasyonel-sayilar''); sürümler arası eşleme eşitlikle';
comment on column public.skills.parent_id is 'Üst düğüm (''tyt.mat.temel''); ustalık yalnız yapraklarda tutulur';
comment on column public.skills.name is 'Kazanım adı';
comment on column public.skills.description is 'Açıklama';
comment on column public.skills.is_leaf is 'Yaprak mı';
comment on column public.skills.order_no is 'Sıra';
comment on column public.skills.p_init is 'BKT başlangıç olasılığı';
comment on column public.skills.p_learn is 'BKT öğrenme olasılığı';
comment on column public.skills.p_guess is 'BKT tahmin olasılığı (4 şık)';
comment on column public.skills.p_slip is 'BKT kayma olasılığı';
-- end comments public.skills
create index skills_curriculum_order on public.skills (curriculum_id, order_no);

create table public.skill_prerequisites (  -- Ön koşul kenarları (döngüsüz; validate.py denetler).
  curriculum_id uuid not null references public.curricula (id) on delete cascade,  -- Müfredat sürümü
  skill_id text not null,  -- Kazanım
  prereq_id text not null,  -- Ön koşul kazanımı
  strength numeric(3, 2) not null default 1.00 check (strength between 0 and 1),  -- Bağ gücü
  source text not null default 'curriculum' check (source in ('curriculum', 'instructor', 'inferred')),  -- Kenarın kaynağı
  primary key (curriculum_id, skill_id, prereq_id),
  check (skill_id <> prereq_id),
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id) on delete cascade,
  foreign key (curriculum_id, prereq_id) references public.skills (curriculum_id, id) on delete cascade
);
-- begin comments public.skill_prerequisites
comment on table public.skill_prerequisites is 'Ön koşul kenarları (döngüsüz; validate.py denetler).';
comment on column public.skill_prerequisites.curriculum_id is 'Müfredat sürümü';
comment on column public.skill_prerequisites.skill_id is 'Kazanım';
comment on column public.skill_prerequisites.prereq_id is 'Ön koşul kazanımı';
comment on column public.skill_prerequisites.strength is 'Bağ gücü';
comment on column public.skill_prerequisites.source is 'Kenarın kaynağı';
-- end comments public.skill_prerequisites

create table public.misconception_tags (  -- Yanılgı etiketi kataloğu; etiket metni sürümler arası sabit, satır onu tanıtan sürüme bağlı.
  tag text primary key,  -- Etiket ('rasyonel.pay-payda-ayri-toplama')
  curriculum_id uuid not null references public.curricula (id),  -- Etiketi tanıtan müfredat sürümü
  skill_id text,  -- Kazanım; boş = çok kazanımlı genel etiket (genel.*)
  prereq_skill_id text,  -- "Asıl sorun alt konuda" çıkarımının ön koşul kazanımı
  text_instructor text not null,  -- Eğitmen metni (üçüncü tekil)
  text_student text not null,  -- Öğrenci metni (sen dili)
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id),
  foreign key (curriculum_id, prereq_skill_id) references public.skills (curriculum_id, id)
);
-- begin comments public.misconception_tags
comment on table public.misconception_tags is 'Yanılgı etiketi kataloğu; etiket metni sürümler arası sabit, satır onu tanıtan sürüme bağlı.';
comment on column public.misconception_tags.tag is 'Etiket (''rasyonel.pay-payda-ayri-toplama'')';
comment on column public.misconception_tags.curriculum_id is 'Etiketi tanıtan müfredat sürümü';
comment on column public.misconception_tags.skill_id is 'Kazanım; boş = çok kazanımlı genel etiket (genel.*)';
comment on column public.misconception_tags.prereq_skill_id is '"Asıl sorun alt konuda" çıkarımının ön koşul kazanımı';
comment on column public.misconception_tags.text_instructor is 'Eğitmen metni (üçüncü tekil)';
comment on column public.misconception_tags.text_student is 'Öğrenci metni (sen dili)';
comment on column public.misconception_tags.created_at is 'Oluşturulma zamanı';
-- end comments public.misconception_tags

create table public.enrollments (  -- Dönem bazlı akademik kayıt; ustalık ve gözlemler kayda bağlıdır.
  id uuid primary key default gen_random_uuid(),  -- Kayıt kimliği
  student_id uuid not null references public.students (id) on delete cascade,  -- Öğrenci
  curriculum_id uuid not null references public.curricula (id),  -- Müfredat sürümü
  period_label text not null,  -- Dönem: 'YKS 2027' (settings.default_period)
  status text not null default 'active' check (status in ('active', 'paused', 'closed')),  -- Kayıt durumu
  started_at date not null default current_date,  -- Başlangıç
  ended_at date,  -- Bitiş (kapalı kayıt; saklama eşikleri buna bağlı)
  unique (student_id, curriculum_id, period_label)
);
-- begin comments public.enrollments
comment on table public.enrollments is 'Dönem bazlı akademik kayıt; ustalık ve gözlemler kayda bağlıdır.';
comment on column public.enrollments.id is 'Kayıt kimliği';
comment on column public.enrollments.student_id is 'Öğrenci';
comment on column public.enrollments.curriculum_id is 'Müfredat sürümü';
comment on column public.enrollments.period_label is 'Dönem: ''YKS 2027'' (settings.default_period)';
comment on column public.enrollments.status is 'Kayıt durumu';
comment on column public.enrollments.started_at is 'Başlangıç';
comment on column public.enrollments.ended_at is 'Bitiş (kapalı kayıt; saklama eşikleri buna bağlı)';
-- end comments public.enrollments
create index enrollments_active_student on public.enrollments (student_id) where status = 'active';

-- Kayıt taşıyan tablolarda (observations, mastery, misconceptions, instructor_notes, lesson_claims) curriculum_id
-- RPC gövdelerinden yazılmaz: bu tetikleyici kayıttan doldurur; dolu gelirse eşit olmalıdır (OGR-CURR-002).
-- Tablolar 0005/0008'de yaratılır; plpgsql gövdesi çağrı anında çözülür.
create or replace function app.fill_curriculum_id() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_cur uuid;
begin
  if tg_table_name = 'lesson_claims' then
    select e.curriculum_id into v_cur
      from public.lesson_analyses la
      join public.lessons l on l.id = la.lesson_id
      join public.enrollments e on e.id = l.enrollment_id
     where la.id = new.analysis_id;
  else
    select e.curriculum_id into v_cur from public.enrollments e where e.id = new.enrollment_id;
  end if;
  if v_cur is null then
    raise exception using errcode = 'P0001', message = 'OGR-CURR-003 kayıt bulunamadı';
  end if;
  if new.curriculum_id is null then
    new.curriculum_id := v_cur;
  elsif new.curriculum_id <> v_cur then
    raise exception using errcode = 'P0001',
      message = format('OGR-CURR-002 curriculum_id kaydın müfredatıyla uyuşmuyor (%s <> %s)', new.curriculum_id, v_cur);
  end if;
  return new;
end
$$;
comment on function app.fill_curriculum_id() is 'curriculum_id sütununu kaydın (enrollments) müfredatından doldurur; uyuşmazlık OGR-CURR-002.';
revoke all on function app.fill_curriculum_id() from public;
