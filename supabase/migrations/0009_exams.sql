-- 0009_exams.sql — denemeler ve sınavlar: sınavlar, sorular, gizli cevap anahtarları, oturumlar, cevaplar; çıkmış sınav
-- arşivi (kaynaklar, maddeler + biçim/tuzak/zorluk) ve öncelik planları (docs/PLAN-v2.md §2 akış 2 ve 6,
-- docs/PLAN-v2-detail.md §2.1, §2.3). v1 diagnostic_tests/sessions → exams.kind = 'diagnostic'; exam_clusters →
-- question_styles. secure.exam_answer_keys'i yalnız grade_exam_session() (B2) okur.

create table public.exams (  -- Sınavlar: yüklenen deneme, teşhis testi, pratik seti, yayımlanmış (üretilmiş) deneme.
  id uuid primary key default gen_random_uuid(),  -- Sınav kimliği
  course_id uuid references public.courses (id) on delete cascade,  -- Ders
  curriculum_id uuid not null references public.curricula (id),  -- Müfredat sürümü
  created_by uuid references public.profiles (id) on delete set null,  -- Oluşturan (seed: boş)
  kind text not null check (kind in ('deneme', 'diagnostic', 'practice', 'published')),  -- Sınav türü
  source text not null check (source in ('uploaded', 'generated', 'instructor')),  -- Köken
  title text not null,  -- Başlık
  publisher text,  -- Yayınevi / kurum
  held_on date,  -- Sınav tarihi
  is_copyrighted boolean not null default false,  -- Telifli: soru metni öğrenciye gösterilmez
  question_count int check (question_count >= 0),  -- Soru sayısı
  sections jsonb not null default '[]',  -- Bölümler [{code, title, from_no, to_no, minutes}]
  generated_document_id uuid,  -- Üretilmiş deneme belgesi (FK 0010_documents.sql'de)
  status text not null default 'draft' check (status in ('draft', 'processing', 'ready', 'published', 'failed', 'archived')),  -- İşlem durumu
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.exams
comment on table public.exams is 'Sınavlar: yüklenen deneme, teşhis testi, pratik seti, yayımlanmış (üretilmiş) deneme.';
comment on column public.exams.id is 'Sınav kimliği';
comment on column public.exams.course_id is 'Ders';
comment on column public.exams.curriculum_id is 'Müfredat sürümü';
comment on column public.exams.created_by is 'Oluşturan (seed: boş)';
comment on column public.exams.kind is 'Sınav türü';
comment on column public.exams.source is 'Köken';
comment on column public.exams.title is 'Başlık';
comment on column public.exams.publisher is 'Yayınevi / kurum';
comment on column public.exams.held_on is 'Sınav tarihi';
comment on column public.exams.is_copyrighted is 'Telifli: soru metni öğrenciye gösterilmez';
comment on column public.exams.question_count is 'Soru sayısı';
comment on column public.exams.sections is 'Bölümler [{code, title, from_no, to_no, minutes}]';
comment on column public.exams.generated_document_id is 'Üretilmiş deneme belgesi (FK 0010_documents.sql''de)';
comment on column public.exams.status is 'İşlem durumu';
comment on column public.exams.created_at is 'Oluşturulma zamanı';
-- end comments public.exams
create index exams_course_kind on public.exams (course_id, kind);
alter table public.exams enable row level security;
alter table public.exams force row level security;

create table public.exam_questions (  -- Sınav soruları; is_copyrighted sınavda stem_text öğrenciye gizli (görünüm B2).
  id uuid primary key default gen_random_uuid(),  -- Soru kimliği
  exam_id uuid not null references public.exams (id) on delete cascade,  -- Sınav
  no int not null check (no >= 1),  -- Soru numarası
  section text,  -- Bölüm kodu
  kind text not null default 'mcq' check (kind in ('mcq', 'numeric', 'open')),  -- Soru türü
  stem_text text,  -- Soru metni (OCR ya da üretim)
  options jsonb,  -- Şıklar [{key, text}]
  figure_upload_id uuid references public.uploads (id) on delete set null,  -- Şekil görseli
  skill_ids text[] not null default '{}',  -- Kazanımlar
  style_id uuid references public.question_styles (id) on delete set null,  -- Soru tarzı
  difficulty numeric(3, 2) check (difficulty between 0 and 1),  -- Zorluk
  question_id uuid references public.questions (id) on delete set null,  -- Soru bankasındaki karşılığı
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  unique (exam_id, no)
);
-- begin comments public.exam_questions
comment on table public.exam_questions is 'Sınav soruları; is_copyrighted sınavda stem_text öğrenciye gizli (görünüm B2).';
comment on column public.exam_questions.id is 'Soru kimliği';
comment on column public.exam_questions.exam_id is 'Sınav';
comment on column public.exam_questions.no is 'Soru numarası';
comment on column public.exam_questions.section is 'Bölüm kodu';
comment on column public.exam_questions.kind is 'Soru türü';
comment on column public.exam_questions.stem_text is 'Soru metni (OCR ya da üretim)';
comment on column public.exam_questions.options is 'Şıklar [{key, text}]';
comment on column public.exam_questions.figure_upload_id is 'Şekil görseli';
comment on column public.exam_questions.skill_ids is 'Kazanımlar';
comment on column public.exam_questions.style_id is 'Soru tarzı';
comment on column public.exam_questions.difficulty is 'Zorluk';
comment on column public.exam_questions.question_id is 'Soru bankasındaki karşılığı';
comment on column public.exam_questions.created_at is 'Oluşturulma zamanı';
-- end comments public.exam_questions
alter table public.exam_questions enable row level security;
alter table public.exam_questions force row level security;

create table secure.exam_answer_keys (  -- Sınav cevap anahtarları; yalnız grade_exam_session() okur.
  exam_question_id uuid primary key references public.exam_questions (id) on delete cascade,  -- Soru
  correct_option text check (correct_option in ('A', 'B', 'C', 'D', 'E')),  -- Doğru şık (mcq)
  numeric_value numeric,  -- Sayısal cevap
  source text not null check (source in ('uploaded', 'inferred', 'instructor', 'generated')),  -- Anahtarın kaynağı
  confidence numeric(3, 2) check (confidence between 0 and 1),  -- Güven (inferred)
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  check (correct_option is not null or numeric_value is not null)
);
-- begin comments secure.exam_answer_keys
comment on table secure.exam_answer_keys is 'Sınav cevap anahtarları; yalnız grade_exam_session() okur.';
comment on column secure.exam_answer_keys.exam_question_id is 'Soru';
comment on column secure.exam_answer_keys.correct_option is 'Doğru şık (mcq)';
comment on column secure.exam_answer_keys.numeric_value is 'Sayısal cevap';
comment on column secure.exam_answer_keys.source is 'Anahtarın kaynağı';
comment on column secure.exam_answer_keys.confidence is 'Güven (inferred)';
comment on column secure.exam_answer_keys.created_at is 'Oluşturulma zamanı';
-- end comments secure.exam_answer_keys
alter table secure.exam_answer_keys enable row level security;
alter table secure.exam_answer_keys force row level security;

create table public.exam_sessions (  -- Sınav oturumu: uygulama içinde çözme ya da cevap kâğıdı yükleme.
  id uuid primary key default gen_random_uuid(),  -- Oturum kimliği
  exam_id uuid not null references public.exams (id) on delete cascade,  -- Sınav
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,  -- Kayıt
  mode text not null check (mode in ('in_app', 'uploaded')),  -- Çözme biçimi
  started_at timestamptz not null default now(),  -- Başlangıç
  finished_at timestamptz,  -- Bitiş
  duration_sec int check (duration_sec >= 0),  -- Süre (sn)
  status text not null default 'in_progress' check (status in ('in_progress', 'grading', 'analysing', 'done', 'failed')),  -- Durum
  score jsonb,  -- Sonuç: {correct, wrong, blank, net, sections:[…]}
  report_document_id uuid,  -- Deneme raporu belgesi (FK 0010_documents.sql'de)
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.exam_sessions
comment on table public.exam_sessions is 'Sınav oturumu: uygulama içinde çözme ya da cevap kâğıdı yükleme.';
comment on column public.exam_sessions.id is 'Oturum kimliği';
comment on column public.exam_sessions.exam_id is 'Sınav';
comment on column public.exam_sessions.enrollment_id is 'Kayıt';
comment on column public.exam_sessions.mode is 'Çözme biçimi';
comment on column public.exam_sessions.started_at is 'Başlangıç';
comment on column public.exam_sessions.finished_at is 'Bitiş';
comment on column public.exam_sessions.duration_sec is 'Süre (sn)';
comment on column public.exam_sessions.status is 'Durum';
comment on column public.exam_sessions.score is 'Sonuç: {correct, wrong, blank, net, sections:[…]}';
comment on column public.exam_sessions.report_document_id is 'Deneme raporu belgesi (FK 0010_documents.sql''de)';
comment on column public.exam_sessions.created_at is 'Oluşturulma zamanı';
-- end comments public.exam_sessions
create index exam_sessions_enrollment on public.exam_sessions (enrollment_id, started_at desc);
alter table public.exam_sessions enable row level security;
alter table public.exam_sessions force row level security;

create table public.exam_responses (  -- Soru başına cevap; gözlemlerin kaynak satırı (source_type='exam_response').
  id uuid primary key default gen_random_uuid(),  -- Cevap kimliği
  session_id uuid not null references public.exam_sessions (id) on delete cascade,  -- Oturum
  exam_question_id uuid not null references public.exam_questions (id) on delete cascade,  -- Soru
  answer text,  -- Verilen cevap ('B' | '7/8'; boş: işaretsiz)
  outcome text check (outcome in ('correct', 'wrong', 'blank', 'unfinished')),  -- Sonuç (puanlama yazar)
  time_spent_sec int check (time_spent_sec >= 0),  -- Soruda geçen süre (sn)
  flagged boolean not null default false,  -- Öğrencinin işaretlediği soru
  work_upload_ids uuid[] not null default '{}',  -- Çözüm görselleri
  how_far_text text,  -- "Nereye kadar geldim" açıklaması
  solution_analysis_id uuid references public.solution_analyses (id) on delete set null,  -- Adım adım teşhis
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  unique (session_id, exam_question_id)
);
-- begin comments public.exam_responses
comment on table public.exam_responses is 'Soru başına cevap; gözlemlerin kaynak satırı (source_type=''exam_response'').';
comment on column public.exam_responses.id is 'Cevap kimliği';
comment on column public.exam_responses.session_id is 'Oturum';
comment on column public.exam_responses.exam_question_id is 'Soru';
comment on column public.exam_responses.answer is 'Verilen cevap (''B'' | ''7/8''; boş: işaretsiz)';
comment on column public.exam_responses.outcome is 'Sonuç (puanlama yazar)';
comment on column public.exam_responses.time_spent_sec is 'Soruda geçen süre (sn)';
comment on column public.exam_responses.flagged is 'Öğrencinin işaretlediği soru';
comment on column public.exam_responses.work_upload_ids is 'Çözüm görselleri';
comment on column public.exam_responses.how_far_text is '"Nereye kadar geldim" açıklaması';
comment on column public.exam_responses.solution_analysis_id is 'Adım adım teşhis';
comment on column public.exam_responses.created_at is 'Oluşturulma zamanı';
-- end comments public.exam_responses
alter table public.exam_responses enable row level security;
alter table public.exam_responses force row level security;

alter table public.solution_analyses add constraint solution_analyses_exam_response_fk
foreign key (exam_response_id) references public.exam_responses (id) on delete set null;

create table public.exam_sources (  -- Çıkmış sınav arşivi kaynakları (eğitmen yükler; tarz kütüphanesinin girdisi).
  id uuid primary key default gen_random_uuid(),  -- Kaynak kimliği
  course_id uuid not null references public.courses (id) on delete cascade,  -- Ders
  year smallint not null,  -- Yıl
  term text not null check (term in ('vize', 'final', 'but', 'deneme', 'osym', 'meb', 'diger')),  -- Sınav türü
  instructor_alias text check (instructor_alias ~ '^hoca-[A-Z]$'),  -- Hoca takma adı (kaynak başına)
  upload_id uuid references public.uploads (id) on delete set null,  -- Yüklenen dosya
  storage_path text,  -- Storage yolu (yükleme dışı kaynak)
  uploaded_by uuid references public.profiles (id) on delete set null,  -- Yükleyen
  status text not null default 'uploaded' check (status in ('uploaded', 'ocr_done', 'clustered', 'failed')),  -- İşlem durumu
  error text,  -- Hata
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.exam_sources
comment on table public.exam_sources is 'Çıkmış sınav arşivi kaynakları (eğitmen yükler; tarz kütüphanesinin girdisi).';
comment on column public.exam_sources.id is 'Kaynak kimliği';
comment on column public.exam_sources.course_id is 'Ders';
comment on column public.exam_sources.year is 'Yıl';
comment on column public.exam_sources.term is 'Sınav türü';
comment on column public.exam_sources.instructor_alias is 'Hoca takma adı (kaynak başına)';
comment on column public.exam_sources.upload_id is 'Yüklenen dosya';
comment on column public.exam_sources.storage_path is 'Storage yolu (yükleme dışı kaynak)';
comment on column public.exam_sources.uploaded_by is 'Yükleyen';
comment on column public.exam_sources.status is 'İşlem durumu';
comment on column public.exam_sources.error is 'Hata';
comment on column public.exam_sources.created_at is 'Oluşturulma zamanı';
-- end comments public.exam_sources
alter table public.exam_sources enable row level security;
alter table public.exam_sources force row level security;

create table public.exam_items (  -- Çıkmış sınav maddeleri (exam-item v2); ocr_text öğrenciye asla gitmez.
  id uuid primary key default gen_random_uuid(),  -- Madde kimliği
  source_id uuid not null references public.exam_sources (id) on delete cascade,  -- Kaynak
  item_no smallint not null,  -- Madde numarası
  topic text,  -- Konu
  kind text check (kind in ('proof', 'calc', 'mc', 'other')),  -- Tür
  format text,  -- Biçim (tablo, grafik, sözel problem …)
  trick text,  -- Tuzak / püf noktası
  difficulty numeric(3, 2) check (difficulty between 0 and 1),  -- Zorluk
  points numeric(5, 2),  -- Puan
  curriculum_id uuid,  -- Müfredat sürümü
  skill_id text,  -- Kazanım
  ocr_text text,  -- OCR metni (yalnız kümeleme ve eğitmen arşivi)
  embedding halfvec(1024),  -- Gömme (Voyage, 1024)
  style_id uuid references public.question_styles (id) on delete set null,  -- Atandığı tarz (kümeleme)
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id),
  unique (source_id, item_no)
);
-- begin comments public.exam_items
comment on table public.exam_items is 'Çıkmış sınav maddeleri (exam-item v2); ocr_text öğrenciye asla gitmez.';
comment on column public.exam_items.id is 'Madde kimliği';
comment on column public.exam_items.source_id is 'Kaynak';
comment on column public.exam_items.item_no is 'Madde numarası';
comment on column public.exam_items.topic is 'Konu';
comment on column public.exam_items.kind is 'Tür';
comment on column public.exam_items.format is 'Biçim (tablo, grafik, sözel problem …)';
comment on column public.exam_items.trick is 'Tuzak / püf noktası';
comment on column public.exam_items.difficulty is 'Zorluk';
comment on column public.exam_items.points is 'Puan';
comment on column public.exam_items.curriculum_id is 'Müfredat sürümü';
comment on column public.exam_items.skill_id is 'Kazanım';
comment on column public.exam_items.ocr_text is 'OCR metni (yalnız kümeleme ve eğitmen arşivi)';
comment on column public.exam_items.embedding is 'Gömme (Voyage, 1024)';
comment on column public.exam_items.style_id is 'Atandığı tarz (kümeleme)';
comment on column public.exam_items.created_at is 'Oluşturulma zamanı';
-- end comments public.exam_items
create index exam_items_embedding on public.exam_items using hnsw (embedding halfvec_cosine_ops);
create index exam_items_style on public.exam_items (style_id);
alter table public.exam_items enable row level security;
alter table public.exam_items force row level security;

create table public.exam_priority_plans (  -- Sıklık analizine göre öncelik planları (exam-priority-plan; soru metni yok).
  id uuid primary key default gen_random_uuid(),  -- Plan kimliği
  course_id uuid not null references public.courses (id) on delete cascade,  -- Ders
  period text not null,  -- Dönem
  plan jsonb not null,  -- exam-priority-plan şeması (+style_ids)
  evidence_count int not null,  -- Kanıt sayısı
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'retired')),  -- Durum
  approved_by uuid references public.profiles (id) on delete set null,  -- Onaylayan
  approved_at timestamptz,  -- Onay zamanı
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.exam_priority_plans
comment on table public.exam_priority_plans is 'Sıklık analizine göre öncelik planları (exam-priority-plan; soru metni yok).';
comment on column public.exam_priority_plans.id is 'Plan kimliği';
comment on column public.exam_priority_plans.course_id is 'Ders';
comment on column public.exam_priority_plans.period is 'Dönem';
comment on column public.exam_priority_plans.plan is 'exam-priority-plan şeması (+style_ids)';
comment on column public.exam_priority_plans.evidence_count is 'Kanıt sayısı';
comment on column public.exam_priority_plans.status is 'Durum';
comment on column public.exam_priority_plans.approved_by is 'Onaylayan';
comment on column public.exam_priority_plans.approved_at is 'Onay zamanı';
comment on column public.exam_priority_plans.created_at is 'Oluşturulma zamanı';
-- end comments public.exam_priority_plans
alter table public.exam_priority_plans enable row level security;
alter table public.exam_priority_plans force row level security;

create trigger check_skill_ids
before insert or update of skill_ids, exam_id on public.exam_questions
for each row execute function app.check_skill_ids();
