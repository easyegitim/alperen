-- 0009_kalem.sql — Kalem: dersler, izlence, sınav arşivi, maddeler, kümeler, öncelik planları (BLUEPRINT §3.6).
-- Öğrenci ve bot bu tablolara ASLA erişmez; exam_items.ocr_text yalnız eğitmen/koordinatör görünümünden okunur.

create table public.courses (  -- Dersler; eğitmenin gerçek adı saklanmaz (instructor_alias).
  id uuid primary key default gen_random_uuid(),  -- Ders kimliği
  code text not null unique,  -- Ders kodu: 'TYT-MAT' | 'MAT101'
  curriculum_id uuid references public.curricula (id),  -- Eşlenen müfredat sürümü
  title text not null,  -- Ders adı
  instructor_alias text  -- Takma ad ('hoca-A')
);
-- begin comments public.courses
comment on table public.courses is 'Dersler; eğitmenin gerçek adı saklanmaz (instructor_alias).';
comment on column public.courses.id is 'Ders kimliği';
comment on column public.courses.code is 'Ders kodu: ''TYT-MAT'' | ''MAT101''';
comment on column public.courses.curriculum_id is 'Eşlenen müfredat sürümü';
comment on column public.courses.title is 'Ders adı';
comment on column public.courses.instructor_alias is 'Takma ad (''hoca-A'')';
-- end comments public.courses

create table public.syllabus_topics (  -- İzlence konuları; kazanımlar (curriculum_id, skill_ids) ile denetlenir.
  id uuid primary key default gen_random_uuid(),  -- Konu kimliği
  course_id uuid not null references public.courses (id) on delete cascade,  -- Ders
  curriculum_id uuid not null references public.curricula (id),  -- = courses.curriculum_id (kalem align yazar)
  week int,  -- Hafta
  title text not null,  -- Konu başlığı
  skill_ids text[] not null default '{}'  -- Kazanımlar
);
-- begin comments public.syllabus_topics
comment on table public.syllabus_topics is 'İzlence konuları; kazanımlar (curriculum_id, skill_ids) ile denetlenir.';
comment on column public.syllabus_topics.id is 'Konu kimliği';
comment on column public.syllabus_topics.course_id is 'Ders';
comment on column public.syllabus_topics.curriculum_id is '= courses.curriculum_id (kalem align yazar)';
comment on column public.syllabus_topics.week is 'Hafta';
comment on column public.syllabus_topics.title is 'Konu başlığı';
comment on column public.syllabus_topics.skill_ids is 'Kazanımlar';
-- end comments public.syllabus_topics

create table public.exam_sources (  -- Sınav arşivi kaynakları (PDF yalnız eğitmen arşivi).
  id uuid primary key default gen_random_uuid(),  -- Kaynak kimliği
  course_id uuid not null references public.courses (id) on delete cascade,  -- Ders
  year smallint not null,  -- Yıl
  term text not null check (term in ('vize', 'final', 'but', 'deneme', 'osym', 'diger')),  -- Sınav türü
  instructor_alias text check (instructor_alias ~ '^hoca-[A-Z]$'),  -- Hoca takma adı (kaynak başına)
  storage_path text not null,  -- Storage: exams/<id>.pdf
  legal_basis text not null,  -- Hukuki dayanak beyanı
  uploaded_by uuid references public.staff (id),  -- Yükleyen
  status text not null default 'uploaded' check (status in ('uploaded', 'ocr_done', 'clustered', 'failed')),  -- İşlem durumu
  error text,  -- Hata
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.exam_sources
comment on table public.exam_sources is 'Sınav arşivi kaynakları (PDF yalnız eğitmen arşivi).';
comment on column public.exam_sources.id is 'Kaynak kimliği';
comment on column public.exam_sources.course_id is 'Ders';
comment on column public.exam_sources.year is 'Yıl';
comment on column public.exam_sources.term is 'Sınav türü';
comment on column public.exam_sources.instructor_alias is 'Hoca takma adı (kaynak başına)';
comment on column public.exam_sources.storage_path is 'Storage: exams/<id>.pdf';
comment on column public.exam_sources.legal_basis is 'Hukuki dayanak beyanı';
comment on column public.exam_sources.uploaded_by is 'Yükleyen';
comment on column public.exam_sources.status is 'İşlem durumu';
comment on column public.exam_sources.error is 'Hata';
comment on column public.exam_sources.created_at is 'Oluşturulma zamanı';
-- end comments public.exam_sources

create table public.exam_clusters (  -- Madde kümeleri (konu × tür).
  id uuid primary key default gen_random_uuid(),  -- Küme kimliği
  course_id uuid not null references public.courses (id) on delete cascade,  -- Ders
  label text not null,  -- Küme adı
  kind text,  -- Tür
  curriculum_id uuid,  -- = courses.curriculum_id
  skill_id text,  -- Kazanım
  item_count int not null default 0,  -- Madde sayısı
  years_hit smallint[] not null default '{}',  -- Sorulduğu yıllar
  years_total smallint not null default 0,  -- Arşivdeki yıl sayısı
  avg_points numeric(5, 2),  -- Ortalama puan
  updated_at timestamptz not null default now(),  -- Son güncelleme
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id)
);
-- begin comments public.exam_clusters
comment on table public.exam_clusters is 'Madde kümeleri (konu × tür).';
comment on column public.exam_clusters.id is 'Küme kimliği';
comment on column public.exam_clusters.course_id is 'Ders';
comment on column public.exam_clusters.label is 'Küme adı';
comment on column public.exam_clusters.kind is 'Tür';
comment on column public.exam_clusters.curriculum_id is '= courses.curriculum_id';
comment on column public.exam_clusters.skill_id is 'Kazanım';
comment on column public.exam_clusters.item_count is 'Madde sayısı';
comment on column public.exam_clusters.years_hit is 'Sorulduğu yıllar';
comment on column public.exam_clusters.years_total is 'Arşivdeki yıl sayısı';
comment on column public.exam_clusters.avg_points is 'Ortalama puan';
comment on column public.exam_clusters.updated_at is 'Son güncelleme';
-- end comments public.exam_clusters

create table public.exam_items (  -- Sınav maddeleri; ocr_text öğrenciye asla gitmez.
  id uuid primary key default gen_random_uuid(),  -- Madde kimliği
  source_id uuid not null references public.exam_sources (id) on delete cascade,  -- Kaynak
  item_no smallint not null,  -- Madde numarası
  topic text,  -- Konu
  kind text check (kind in ('proof', 'calc', 'mc', 'other')),  -- Tür
  points numeric(5, 2),  -- Puan
  curriculum_id uuid,  -- Müfredat sürümü
  skill_id text,  -- Kazanım
  ocr_text text,  -- OCR metni (yalnız kümeleme ve eğitmen arşivi)
  embedding halfvec(768),  -- Gömme
  cluster_id uuid references public.exam_clusters (id),  -- Küme
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id),
  unique (source_id, item_no)
);
-- begin comments public.exam_items
comment on table public.exam_items is 'Sınav maddeleri; ocr_text öğrenciye asla gitmez.';
comment on column public.exam_items.id is 'Madde kimliği';
comment on column public.exam_items.source_id is 'Kaynak';
comment on column public.exam_items.item_no is 'Madde numarası';
comment on column public.exam_items.topic is 'Konu';
comment on column public.exam_items.kind is 'Tür';
comment on column public.exam_items.points is 'Puan';
comment on column public.exam_items.curriculum_id is 'Müfredat sürümü';
comment on column public.exam_items.skill_id is 'Kazanım';
comment on column public.exam_items.ocr_text is 'OCR metni (yalnız kümeleme ve eğitmen arşivi)';
comment on column public.exam_items.embedding is 'Gömme';
comment on column public.exam_items.cluster_id is 'Küme';
-- end comments public.exam_items

create table public.exam_priority_plans (  -- Sıklık analizine göre öncelik planları (soru metni yok — şema garanti).
  id uuid primary key default gen_random_uuid(),  -- Plan kimliği
  course_id uuid not null references public.courses (id),  -- Ders
  period text not null,  -- Dönem
  plan jsonb not null,  -- exam-priority-plan şeması
  evidence_count int not null,  -- Kanıt sayısı
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'retired')),  -- Durum
  approved_by uuid references public.staff (id),  -- Onaylayan
  approved_at timestamptz,  -- Onay zamanı
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.exam_priority_plans
comment on table public.exam_priority_plans is 'Sıklık analizine göre öncelik planları (soru metni yok — şema garanti).';
comment on column public.exam_priority_plans.id is 'Plan kimliği';
comment on column public.exam_priority_plans.course_id is 'Ders';
comment on column public.exam_priority_plans.period is 'Dönem';
comment on column public.exam_priority_plans.plan is 'exam-priority-plan şeması';
comment on column public.exam_priority_plans.evidence_count is 'Kanıt sayısı';
comment on column public.exam_priority_plans.status is 'Durum';
comment on column public.exam_priority_plans.approved_by is 'Onaylayan';
comment on column public.exam_priority_plans.approved_at is 'Onay zamanı';
comment on column public.exam_priority_plans.created_at is 'Oluşturulma zamanı';
-- end comments public.exam_priority_plans

alter table public.generation_requests add constraint generation_requests_plan_fk
foreign key (plan_id) references public.exam_priority_plans (id);

create trigger questions_check_skills
before insert or update of skill_ids, curriculum_id on public.syllabus_topics
for each row execute function app.questions_check_skills();
