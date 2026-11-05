-- 0012_lessons.sql — ders kayıtları v2 (video/transkript yüklemesi), analizler, iddialar (docs/PLAN-v2.md §2 akış 4,
-- docs/PLAN-v2-detail.md §2.1). Ders bir öğrencinin kaydına (birebir ders) ya da bir derse (sınıf dersi) bağlıdır;
-- iddialar onaylanınca (ya da güven ≥ auto_apply_threshold ise otomatik) gözlem ya da olgu olur.

create table public.lessons (  -- Ders kayıtları; video/ses/transkript uploads'ta ('lessons' kovası).
  id uuid primary key default gen_random_uuid(),  -- Ders kimliği
  enrollment_id uuid references public.enrollments (id) on delete cascade,  -- Birebir ders: öğrencinin kaydı
  course_id uuid references public.courses (id) on delete cascade,  -- Sınıf dersi: ders (kayıtsız)
  upload_id uuid references public.uploads (id) on delete set null,  -- Video/ses/transkript yüklemesi
  instructor_id uuid references public.profiles (id) on delete set null,  -- Dersi veren eğitmen
  held_at timestamptz not null,  -- Ders zamanı
  duration_min int,  -- Süre (dk)
  transcript_path text,  -- Storage: lessons/<id>/transcript.jsonl
  frames_count smallint,  -- Sahne karesi sayısı
  student_visible boolean not null default false,  -- Öğrenci ders özetini görebilir mi
  auto_apply_threshold numeric(3, 2) not null default 0.80 check (auto_apply_threshold between 0 and 1),  -- Bu güvenin üstündeki iddialar eğitmen onayı beklemeden uygulanır
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'analyzed', 'approved', 'corrected', 'rejected', 'failed')),  -- Durum
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  check (enrollment_id is not null or course_id is not null)
);
-- begin comments public.lessons
comment on table public.lessons is 'Ders kayıtları; video/ses/transkript uploads''ta (''lessons'' kovası).';
comment on column public.lessons.id is 'Ders kimliği';
comment on column public.lessons.enrollment_id is 'Birebir ders: öğrencinin kaydı';
comment on column public.lessons.course_id is 'Sınıf dersi: ders (kayıtsız)';
comment on column public.lessons.upload_id is 'Video/ses/transkript yüklemesi';
comment on column public.lessons.instructor_id is 'Dersi veren eğitmen';
comment on column public.lessons.held_at is 'Ders zamanı';
comment on column public.lessons.duration_min is 'Süre (dk)';
comment on column public.lessons.transcript_path is 'Storage: lessons/<id>/transcript.jsonl';
comment on column public.lessons.frames_count is 'Sahne karesi sayısı';
comment on column public.lessons.student_visible is 'Öğrenci ders özetini görebilir mi';
comment on column public.lessons.auto_apply_threshold is 'Bu güvenin üstündeki iddialar eğitmen onayı beklemeden uygulanır';
comment on column public.lessons.status is 'Durum';
comment on column public.lessons.created_at is 'Oluşturulma zamanı';
-- end comments public.lessons
create index lessons_enrollment on public.lessons (enrollment_id, held_at desc);
create index lessons_course on public.lessons (course_id, held_at desc);
alter table public.lessons enable row level security;
alter table public.lessons force row level security;

create table public.lesson_analyses (  -- Ders analizleri (lesson-analysis v2, course_insights dahil); taslak → onay.
  id uuid primary key default gen_random_uuid(),  -- Analiz kimliği
  lesson_id uuid not null references public.lessons (id) on delete cascade,  -- Ders
  version smallint not null default 1,  -- Analiz sürümü
  seed_profile jsonb not null,  -- Analiz promptuna verilen profil (kümülatiflik)
  analysis jsonb not null,  -- lesson-analysis şeması
  model text not null,  -- Model
  cost_usd numeric(10, 6) not null default 0,  -- Maliyet
  status text not null default 'draft' check (status in ('draft', 'approved', 'corrected', 'rejected')),  -- Durum
  approved_by uuid references public.profiles (id) on delete set null,  -- Onaylayan
  approved_at timestamptz,  -- Onay zamanı
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  unique (lesson_id, version)
);
-- begin comments public.lesson_analyses
comment on table public.lesson_analyses is 'Ders analizleri (lesson-analysis v2, course_insights dahil); taslak → onay.';
comment on column public.lesson_analyses.id is 'Analiz kimliği';
comment on column public.lesson_analyses.lesson_id is 'Ders';
comment on column public.lesson_analyses.version is 'Analiz sürümü';
comment on column public.lesson_analyses.seed_profile is 'Analiz promptuna verilen profil (kümülatiflik)';
comment on column public.lesson_analyses.analysis is 'lesson-analysis şeması';
comment on column public.lesson_analyses.model is 'Model';
comment on column public.lesson_analyses.cost_usd is 'Maliyet';
comment on column public.lesson_analyses.status is 'Durum';
comment on column public.lesson_analyses.approved_by is 'Onaylayan';
comment on column public.lesson_analyses.approved_at is 'Onay zamanı';
comment on column public.lesson_analyses.created_at is 'Oluşturulma zamanı';
-- end comments public.lesson_analyses
alter table public.lesson_analyses enable row level security;
alter table public.lesson_analyses force row level security;

create table public.lesson_claims (  -- Analizden çıkan her iddia; onaylanınca gözlem ya da olgu olur.
  id uuid primary key default gen_random_uuid(),  -- İddia kimliği
  analysis_id uuid not null references public.lesson_analyses (id) on delete cascade,  -- Analiz
  kind text not null check (kind in ('skill_mastery', 'misconception', 'question', 'hesitation', 'homework', 'promise', 'deadline', 'next_step', 'followup', 'talk', 'course_insight')),  -- İddia türü
  curriculum_id uuid not null,  -- Müfredat sürümü; app.fill_curriculum_id() (analiz → ders → kayıt/ders)
  skill_id text,  -- Kazanım
  misconception_tag text references public.misconception_tags (tag),  -- Yanılgı etiketi
  misconception_id uuid references public.misconceptions (id) on delete set null,  -- followup: önceki yanılgı
  value jsonb not null,  -- İddia değeri
  confidence numeric(3, 2) check (confidence between 0 and 1),  -- Model güveni (otomatik uygulama eşiğiyle karşılaştırılır)
  quote text not null,  -- Kanıt alıntısı
  speaker text not null check (speaker in ('ÖĞRENCİ', 'EĞİTMEN')),  -- Konuşan
  t_start_sec int not null,  -- Başlangıç (sn)
  t_end_sec int,  -- Bitiş (sn)
  status text not null default 'pending' check (status in ('pending', 'approved', 'edited', 'rejected')),  -- Karar
  edited_value jsonb,  -- Düzeltilmiş değer
  decided_by uuid references public.profiles (id) on delete set null,  -- Karar veren (otomatik: boş)
  decided_at timestamptz,  -- Karar zamanı
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id)
);
-- begin comments public.lesson_claims
comment on table public.lesson_claims is 'Analizden çıkan her iddia; onaylanınca gözlem ya da olgu olur.';
comment on column public.lesson_claims.id is 'İddia kimliği';
comment on column public.lesson_claims.analysis_id is 'Analiz';
comment on column public.lesson_claims.kind is 'İddia türü';
comment on column public.lesson_claims.curriculum_id is 'Müfredat sürümü; app.fill_curriculum_id() (analiz → ders → kayıt/ders)';
comment on column public.lesson_claims.skill_id is 'Kazanım';
comment on column public.lesson_claims.misconception_tag is 'Yanılgı etiketi';
comment on column public.lesson_claims.misconception_id is 'followup: önceki yanılgı';
comment on column public.lesson_claims.value is 'İddia değeri';
comment on column public.lesson_claims.confidence is 'Model güveni (otomatik uygulama eşiğiyle karşılaştırılır)';
comment on column public.lesson_claims.quote is 'Kanıt alıntısı';
comment on column public.lesson_claims.speaker is 'Konuşan';
comment on column public.lesson_claims.t_start_sec is 'Başlangıç (sn)';
comment on column public.lesson_claims.t_end_sec is 'Bitiş (sn)';
comment on column public.lesson_claims.status is 'Karar';
comment on column public.lesson_claims.edited_value is 'Düzeltilmiş değer';
comment on column public.lesson_claims.decided_by is 'Karar veren (otomatik: boş)';
comment on column public.lesson_claims.decided_at is 'Karar zamanı';
comment on column public.lesson_claims.created_at is 'Oluşturulma zamanı';
-- end comments public.lesson_claims
create index lesson_claims_analysis_status on public.lesson_claims (analysis_id, status);
alter table public.lesson_claims enable row level security;
alter table public.lesson_claims force row level security;

alter table public.memory_facts add constraint memory_facts_lesson_claim_fk
foreign key (source_lesson_claim_id) references public.lesson_claims (id) on delete set null;

create trigger a_fill_curriculum_id before insert on public.lesson_claims
for each row execute function app.fill_curriculum_id();
