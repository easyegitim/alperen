-- 0004_curriculum.sql — dinamik müfredat: sürümler (+köken), kazanım ağacı, ön koşullar, yanılgı etiketleri, dersler,
-- izlence, kayıtlar, müfredat önerileri (docs/PLAN-v2.md §3.5, docs/PLAN-v2-detail.md §2.1, §2.3).
-- Kazanım anahtarı bileşiktir (curriculum_id, id): aynı kazanım kodu her müfredat sürümünde yeniden yazılır, eski
-- sürümün satırı ve ustalık değerleri dokunulmaz. Müfredat seed (content/), yapay zekâ taslağı (curriculum-draft işi)
-- ya da eğitmen elinden gelir (curricula.origin).

create table public.curricula (  -- Müfredat sürümleri (TYT-MAT@2026.1); taslak → aktif → emekli.
  id uuid primary key default gen_random_uuid(),  -- Sürüm kimliği (seed: uuid5(code@version))
  code text not null,  -- Müfredat kodu: 'TYT-MAT', 'MAT101-ODTU'
  authority text not null default 'OTHER' check (authority in ('MEB', 'ÖSYM', 'UNI', 'OTHER')),  -- Kaynak kurum
  year smallint not null default extract(year from current_date)::smallint,  -- Kılavuz/program yılı
  version text not null default '1',  -- Sürüm: '2026.1'
  label text not null,  -- Görünen ad: 'TYT Matematik 2026'
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),  -- Yaşam döngüsü
  origin text not null default 'instructor' check (origin in ('seed', 'ai_draft', 'instructor')),  -- Köken: içerik seed'i, yapay zekâ taslağı, eğitmen
  source_refs jsonb not null default '[]',  -- Kaynaklar [{kind: url|upload|syllabus, ref, title}]
  created_by uuid references public.profiles (id) on delete set null,  -- Oluşturan profil (seed: boş)
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  unique (code, year, version)
);
-- begin comments public.curricula
comment on table public.curricula is 'Müfredat sürümleri (TYT-MAT@2026.1); taslak → aktif → emekli.';
comment on column public.curricula.id is 'Sürüm kimliği (seed: uuid5(code@version))';
comment on column public.curricula.code is 'Müfredat kodu: ''TYT-MAT'', ''MAT101-ODTU''';
comment on column public.curricula.authority is 'Kaynak kurum';
comment on column public.curricula.year is 'Kılavuz/program yılı';
comment on column public.curricula.version is 'Sürüm: ''2026.1''';
comment on column public.curricula.label is 'Görünen ad: ''TYT Matematik 2026''';
comment on column public.curricula.status is 'Yaşam döngüsü';
comment on column public.curricula.origin is 'Köken: içerik seed''i, yapay zekâ taslağı, eğitmen';
comment on column public.curricula.source_refs is 'Kaynaklar [{kind: url|upload|syllabus, ref, title}]';
comment on column public.curricula.created_by is 'Oluşturan profil (seed: boş)';
comment on column public.curricula.created_at is 'Oluşturulma zamanı';
-- end comments public.curricula
alter table public.curricula enable row level security;
alter table public.curricula force row level security;

create table public.skills (  -- Kazanımlar (her derinlikte ağaç); bileşik anahtar (curriculum_id, id).
  curriculum_id uuid not null references public.curricula (id) on delete cascade,  -- Müfredat sürümü
  id text not null,  -- Kazanım kodu ('tyt.mat.temel.rasyonel-sayilar'); sürümler arası eşleme eşitlikle
  parent_id text,  -- Üst düğüm ('tyt.mat.temel'); ustalık yalnız yapraklarda tutulur
  name text not null,  -- Kazanım adı
  description text,  -- Açıklama
  kind text check (kind in ('unit', 'outcome', 'sub_outcome')),  -- Düğüm türü (curriculum-draft); BKT varsayılanları buna göre
  is_leaf boolean not null default true,  -- Yaprak mı
  order_no int not null default 0,  -- Sıra
  exam_weight_hint numeric(4, 3) check (exam_weight_hint between 0 and 1),  -- Sınavdaki ağırlık ipucu (taslak)
  source_refs jsonb not null default '[]',  -- Düğümün dayandığı kaynaklar
  p_init numeric(4, 3) not null default 0.300 check (p_init between 0.001 and 0.999),  -- BKT başlangıç olasılığı
  p_learn numeric(4, 3) not null default 0.100 check (p_learn between 0.001 and 0.999),  -- BKT öğrenme olasılığı
  p_guess numeric(4, 3) not null default 0.250 check (p_guess between 0.001 and 0.999),  -- BKT tahmin olasılığı (4 şık)
  p_slip numeric(4, 3) not null default 0.100 check (p_slip between 0.001 and 0.999),  -- BKT kayma olasılığı
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  primary key (curriculum_id, id),
  foreign key (curriculum_id, parent_id) references public.skills (curriculum_id, id)
);
-- begin comments public.skills
comment on table public.skills is 'Kazanımlar (her derinlikte ağaç); bileşik anahtar (curriculum_id, id).';
comment on column public.skills.curriculum_id is 'Müfredat sürümü';
comment on column public.skills.id is 'Kazanım kodu (''tyt.mat.temel.rasyonel-sayilar''); sürümler arası eşleme eşitlikle';
comment on column public.skills.parent_id is 'Üst düğüm (''tyt.mat.temel''); ustalık yalnız yapraklarda tutulur';
comment on column public.skills.name is 'Kazanım adı';
comment on column public.skills.description is 'Açıklama';
comment on column public.skills.kind is 'Düğüm türü (curriculum-draft); BKT varsayılanları buna göre';
comment on column public.skills.is_leaf is 'Yaprak mı';
comment on column public.skills.order_no is 'Sıra';
comment on column public.skills.exam_weight_hint is 'Sınavdaki ağırlık ipucu (taslak)';
comment on column public.skills.source_refs is 'Düğümün dayandığı kaynaklar';
comment on column public.skills.p_init is 'BKT başlangıç olasılığı';
comment on column public.skills.p_learn is 'BKT öğrenme olasılığı';
comment on column public.skills.p_guess is 'BKT tahmin olasılığı (4 şık)';
comment on column public.skills.p_slip is 'BKT kayma olasılığı';
comment on column public.skills.created_at is 'Oluşturulma zamanı';
-- end comments public.skills
create index skills_curriculum_order on public.skills (curriculum_id, order_no);
alter table public.skills enable row level security;
alter table public.skills force row level security;

create table public.skill_prerequisites (  -- Ön koşul kenarları (döngüsüz; taslak doğrulaması ve content/validate.py denetler).
  curriculum_id uuid not null references public.curricula (id) on delete cascade,  -- Müfredat sürümü
  skill_id text not null,  -- Kazanım
  prereq_id text not null,  -- Ön koşul kazanımı
  strength numeric(3, 2) not null default 1.00 check (strength between 0 and 1),  -- Bağ gücü
  source text not null default 'curriculum' check (source in ('curriculum', 'ai_draft', 'instructor', 'inferred')),  -- Kenarın kaynağı
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  primary key (curriculum_id, skill_id, prereq_id),
  check (skill_id <> prereq_id),
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id) on delete cascade,
  foreign key (curriculum_id, prereq_id) references public.skills (curriculum_id, id) on delete cascade
);
-- begin comments public.skill_prerequisites
comment on table public.skill_prerequisites is 'Ön koşul kenarları (döngüsüz; taslak doğrulaması ve content/validate.py denetler).';
comment on column public.skill_prerequisites.curriculum_id is 'Müfredat sürümü';
comment on column public.skill_prerequisites.skill_id is 'Kazanım';
comment on column public.skill_prerequisites.prereq_id is 'Ön koşul kazanımı';
comment on column public.skill_prerequisites.strength is 'Bağ gücü';
comment on column public.skill_prerequisites.source is 'Kenarın kaynağı';
comment on column public.skill_prerequisites.created_at is 'Oluşturulma zamanı';
-- end comments public.skill_prerequisites
alter table public.skill_prerequisites enable row level security;
alter table public.skill_prerequisites force row level security;

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
alter table public.misconception_tags enable row level security;
alter table public.misconception_tags force row level security;

create table public.courses (  -- Dersler: sınav parkuru (TYT/AYT/LGS), okul ya da üniversite dersi; müfredata bağlanır.
  id uuid primary key default gen_random_uuid(),  -- Ders kimliği
  code text not null unique,  -- Ders kodu: 'TYT-MAT' | 'MAT101-ODTU'
  title text not null,  -- Ders adı
  kind text not null default 'other' check (kind in ('exam_track', 'school', 'university', 'other')),  -- Ders türü (otopilot sınav parkurlarında açık)
  curriculum_id uuid references public.curricula (id),  -- Eşlenen (aktif ya da taslak) müfredat sürümü
  description text,  -- Açıklama
  visibility text not null default 'private' check (visibility in ('private', 'shared', 'public')),  -- private: oluşturan + bağlılar; shared: kayıtlılar; public: herkes
  created_by uuid references public.profiles (id) on delete set null,  -- Oluşturan profil
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.courses
comment on table public.courses is 'Dersler: sınav parkuru (TYT/AYT/LGS), okul ya da üniversite dersi; müfredata bağlanır.';
comment on column public.courses.id is 'Ders kimliği';
comment on column public.courses.code is 'Ders kodu: ''TYT-MAT'' | ''MAT101-ODTU''';
comment on column public.courses.title is 'Ders adı';
comment on column public.courses.kind is 'Ders türü (otopilot sınav parkurlarında açık)';
comment on column public.courses.curriculum_id is 'Eşlenen (aktif ya da taslak) müfredat sürümü';
comment on column public.courses.description is 'Açıklama';
comment on column public.courses.visibility is 'private: oluşturan + bağlılar; shared: kayıtlılar; public: herkes';
comment on column public.courses.created_by is 'Oluşturan profil';
comment on column public.courses.created_at is 'Oluşturulma zamanı';
-- end comments public.courses
alter table public.courses enable row level security;
alter table public.courses force row level security;

alter table public.instructor_links add constraint instructor_links_course_fk
foreign key (course_id) references public.courses (id) on delete cascade;

create table public.syllabus_topics (  -- İzlence konuları; kazanımlar (curriculum_id, skill_ids) ile denetlenir.
  id uuid primary key default gen_random_uuid(),  -- Konu kimliği
  course_id uuid not null references public.courses (id) on delete cascade,  -- Ders
  curriculum_id uuid not null references public.curricula (id),  -- = courses.curriculum_id
  week int,  -- Hafta
  title text not null,  -- Konu başlığı
  skill_ids text[] not null default '{}',  -- Kazanımlar
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.syllabus_topics
comment on table public.syllabus_topics is 'İzlence konuları; kazanımlar (curriculum_id, skill_ids) ile denetlenir.';
comment on column public.syllabus_topics.id is 'Konu kimliği';
comment on column public.syllabus_topics.course_id is 'Ders';
comment on column public.syllabus_topics.curriculum_id is '= courses.curriculum_id';
comment on column public.syllabus_topics.week is 'Hafta';
comment on column public.syllabus_topics.title is 'Konu başlığı';
comment on column public.syllabus_topics.skill_ids is 'Kazanımlar';
comment on column public.syllabus_topics.created_at is 'Oluşturulma zamanı';
-- end comments public.syllabus_topics
alter table public.syllabus_topics enable row level security;
alter table public.syllabus_topics force row level security;

create table public.enrollments (  -- Öğrencinin bir derse/müfredata kaydı; ustalık ve gözlemler kayda bağlıdır.
  id uuid primary key default gen_random_uuid(),  -- Kayıt kimliği
  student_id uuid not null references public.students (id) on delete cascade,  -- Öğrenci
  curriculum_id uuid not null references public.curricula (id),  -- Müfredat sürümü
  course_id uuid references public.courses (id),  -- Ders
  period_label text not null,  -- Dönem: 'YKS 2027' (settings.default_period), '2026 Güz'
  status text not null default 'active' check (status in ('active', 'paused', 'closed')),  -- Kayıt durumu
  target_exam text,  -- Hedef sınav: 'TYT', 'AYT', 'LGS', 'final'
  exam_date date,  -- Sınav tarihi
  goal text,  -- Öğrencinin hedefi (serbest metin)
  started_at date not null default current_date,  -- Başlangıç
  ended_at date,  -- Bitiş
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  unique (student_id, curriculum_id, period_label)
);
-- begin comments public.enrollments
comment on table public.enrollments is 'Öğrencinin bir derse/müfredata kaydı; ustalık ve gözlemler kayda bağlıdır.';
comment on column public.enrollments.id is 'Kayıt kimliği';
comment on column public.enrollments.student_id is 'Öğrenci';
comment on column public.enrollments.curriculum_id is 'Müfredat sürümü';
comment on column public.enrollments.course_id is 'Ders';
comment on column public.enrollments.period_label is 'Dönem: ''YKS 2027'' (settings.default_period), ''2026 Güz''';
comment on column public.enrollments.status is 'Kayıt durumu';
comment on column public.enrollments.target_exam is 'Hedef sınav: ''TYT'', ''AYT'', ''LGS'', ''final''';
comment on column public.enrollments.exam_date is 'Sınav tarihi';
comment on column public.enrollments.goal is 'Öğrencinin hedefi (serbest metin)';
comment on column public.enrollments.started_at is 'Başlangıç';
comment on column public.enrollments.ended_at is 'Bitiş';
comment on column public.enrollments.created_at is 'Oluşturulma zamanı';
-- end comments public.enrollments
create index enrollments_active_student on public.enrollments (student_id) where status = 'active';
create index enrollments_course on public.enrollments (course_id);
alter table public.enrollments enable row level security;
alter table public.enrollments force row level security;

create table public.curriculum_proposals (  -- Müfredat inceltme önerileri (teşhisten ya da eğitmenden); kabul yeni sürüm üretebilir.
  id uuid primary key default gen_random_uuid(),  -- Öneri kimliği
  curriculum_id uuid not null references public.curricula (id) on delete cascade,  -- Müfredat sürümü
  kind text not null check (kind in ('add_subskill', 'rename', 'merge', 'add_prereq', 'add_tag')),  -- Öneri türü
  payload jsonb not null,  -- Öneri içeriği ({parent_code, code, name, …})
  evidence_ids uuid[] not null default '{}',  -- Kanıt satırları (solution_analyses.id …)
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),  -- Karar durumu
  decided_by uuid references public.profiles (id) on delete set null,  -- Karar veren (boş: otopilot)
  decided_at timestamptz,  -- Karar zamanı
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.curriculum_proposals
comment on table public.curriculum_proposals is 'Müfredat inceltme önerileri (teşhisten ya da eğitmenden); kabul yeni sürüm üretebilir.';
comment on column public.curriculum_proposals.id is 'Öneri kimliği';
comment on column public.curriculum_proposals.curriculum_id is 'Müfredat sürümü';
comment on column public.curriculum_proposals.kind is 'Öneri türü';
comment on column public.curriculum_proposals.payload is 'Öneri içeriği ({parent_code, code, name, …})';
comment on column public.curriculum_proposals.evidence_ids is 'Kanıt satırları (solution_analyses.id …)';
comment on column public.curriculum_proposals.status is 'Karar durumu';
comment on column public.curriculum_proposals.decided_by is 'Karar veren (boş: otopilot)';
comment on column public.curriculum_proposals.decided_at is 'Karar zamanı';
comment on column public.curriculum_proposals.created_at is 'Oluşturulma zamanı';
-- end comments public.curriculum_proposals
create index curriculum_proposals_open on public.curriculum_proposals (curriculum_id) where status = 'open';
alter table public.curriculum_proposals enable row level security;
alter table public.curriculum_proposals force row level security;

-- Kayıt taşıyan tablolarda (observations, mastery, misconceptions, instructor_notes, lesson_claims) curriculum_id
-- RPC gövdelerinden yazılmaz: bu tetikleyici kayıttan (lesson_claims: ders → kayıt ya da ders → course) doldurur;
-- dolu gelirse eşit olmalıdır (OGR-CURR-002). Tablolar sonraki migration'larda; plpgsql gövdesi çağrı anında çözülür.
create or replace function app.fill_curriculum_id() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_cur uuid;
begin
  if tg_table_name = 'lesson_claims' then
    select coalesce(e.curriculum_id, c.curriculum_id) into v_cur
      from public.lesson_analyses la
      join public.lessons l on l.id = la.lesson_id
      left join public.enrollments e on e.id = l.enrollment_id
      left join public.courses c on c.id = l.course_id
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
comment on function app.fill_curriculum_id() is 'BEFORE INSERT: curriculum_id''yi kayıttan doldurur; uyuşmazlıkta OGR-CURR-002.';
revoke all on function app.fill_curriculum_id() from public;

-- skill_ids dizisinin her elemanı (curriculum_id, id) ile kazanımlarda var olmalı (OGR-CURR-001). exam_questions'ta
-- müfredat sınavdan okunur. questions, syllabus_topics, question_styles, exam_questions tetikleyicisi.
create or replace function app.check_skill_ids() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_cur uuid;
  v_missing text;
begin
  if tg_table_name = 'exam_questions' then
    select x.curriculum_id into v_cur from public.exams x where x.id = new.exam_id;
  else
    v_cur := new.curriculum_id;
  end if;
  if v_cur is null or new.skill_ids is null then
    return new;
  end if;
  select string_agg(x.sid, ', ') into v_missing
    from unnest(new.skill_ids) as x (sid)
   where not exists (select 1 from public.skills s where s.curriculum_id = v_cur and s.id = x.sid);
  if v_missing is not null then
    raise exception using errcode = 'P0001', message = format('OGR-CURR-001 kazanım bu müfredat sürümünde yok: %s', v_missing);
  end if;
  return new;
end
$$;
comment on function app.check_skill_ids() is 'BEFORE INSERT/UPDATE: skill_ids elemanları müfredatta yoksa OGR-CURR-001.';
revoke all on function app.check_skill_ids() from public;

create trigger check_skill_ids
before insert or update of skill_ids, curriculum_id on public.syllabus_topics
for each row execute function app.check_skill_ids();
