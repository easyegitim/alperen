-- 0008_analysis.sql — çözüm teşhisleri (docs/PLAN-v2.md §3.1, docs/PLAN-v2-detail.md §2.3).
-- Bir soru + çözüm fotoğrafının (ya da deneme cevabının) adım adım teşhisi. observations(source_type='solution_analysis')
-- satırlarının kaynağıdır; apply_diagnosis() (B2) tek işlemde bu satırı, gözlemleri ve style_coverage'ı yazar.

create table public.solution_analyses (  -- Çözüm teşhisi (solution-diagnosis şeması); gözlemlerin kaynak satırı.
  id uuid primary key default gen_random_uuid(),  -- Teşhis kimliği
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,  -- Kayıt
  conversation_message_id bigint references public.conversation_messages (id) on delete set null,  -- Teşhisi tetikleyen sohbet mesajı
  exam_response_id uuid,  -- Deneme cevabı (FK 0009_exams.sql'de)
  upload_ids uuid[] not null default '{}',  -- Soru ve çözüm görselleri
  question_text text,  -- Soru metni (OCR)
  student_work_text text,  -- Öğrencinin çözümünün metni (OCR)
  analysis jsonb not null,  -- solution-diagnosis çıktısı (adımlar, bozulan adım, açıklama)
  verdict text not null check (verdict in ('correct', 'wrong', 'incomplete', 'unreadable')),  -- Hüküm
  failing_step_no int check (failing_step_no >= 1),  -- Bozulan adımın numarası
  error_cause text check (error_cause in ('concept', 'procedure', 'careless', 'reading', 'time')),  -- Hata nedeni
  skill_ids text[] not null default '{}',  -- İlgili kazanımlar
  misconception_tags text[] not null default '{}',  -- Yanılgı etiketleri
  style_id uuid references public.question_styles (id) on delete set null,  -- Soru tarzı
  proposal_id uuid references public.curriculum_proposals (id) on delete set null,  -- Önerilen alt kazanım (müfredatta yoksa)
  model text,  -- Model
  cost_usd numeric(10, 6) not null default 0,  -- Maliyet
  embedding halfvec(1024),  -- Soru + teşhis gömmesi (Voyage, 1024)
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.solution_analyses
comment on table public.solution_analyses is 'Çözüm teşhisi (solution-diagnosis şeması); gözlemlerin kaynak satırı.';
comment on column public.solution_analyses.id is 'Teşhis kimliği';
comment on column public.solution_analyses.enrollment_id is 'Kayıt';
comment on column public.solution_analyses.conversation_message_id is 'Teşhisi tetikleyen sohbet mesajı';
comment on column public.solution_analyses.exam_response_id is 'Deneme cevabı (FK 0009_exams.sql''de)';
comment on column public.solution_analyses.upload_ids is 'Soru ve çözüm görselleri';
comment on column public.solution_analyses.question_text is 'Soru metni (OCR)';
comment on column public.solution_analyses.student_work_text is 'Öğrencinin çözümünün metni (OCR)';
comment on column public.solution_analyses.analysis is 'solution-diagnosis çıktısı (adımlar, bozulan adım, açıklama)';
comment on column public.solution_analyses.verdict is 'Hüküm';
comment on column public.solution_analyses.failing_step_no is 'Bozulan adımın numarası';
comment on column public.solution_analyses.error_cause is 'Hata nedeni';
comment on column public.solution_analyses.skill_ids is 'İlgili kazanımlar';
comment on column public.solution_analyses.misconception_tags is 'Yanılgı etiketleri';
comment on column public.solution_analyses.style_id is 'Soru tarzı';
comment on column public.solution_analyses.proposal_id is 'Önerilen alt kazanım (müfredatta yoksa)';
comment on column public.solution_analyses.model is 'Model';
comment on column public.solution_analyses.cost_usd is 'Maliyet';
comment on column public.solution_analyses.embedding is 'Soru + teşhis gömmesi (Voyage, 1024)';
comment on column public.solution_analyses.created_at is 'Oluşturulma zamanı';
-- end comments public.solution_analyses
create index solution_analyses_enrollment_created on public.solution_analyses (enrollment_id, created_at desc);
create index solution_analyses_embedding on public.solution_analyses using hnsw (embedding halfvec_cosine_ops);
alter table public.solution_analyses enable row level security;
alter table public.solution_analyses force row level security;
