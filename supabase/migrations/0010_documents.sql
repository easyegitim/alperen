-- 0010_documents.sql — üretilen belgeler (not, deneme, rapor, soru seti, anahtar; belge AST'si + HTML/PDF) ve ders notu
-- kütüphanesi (docs/PLAN-v2.md §2 akış 5, docs/PLAN-v2-detail.md §2.3, §4).

create table public.generated_documents (  -- Üretilen belgeler; content = belge AST'si (packages/contracts document-ast).
  id uuid primary key default gen_random_uuid(),  -- Belge kimliği
  student_id uuid references public.students (id) on delete cascade,  -- Kişiye özel belgenin öğrencisi (ders geneli: boş)
  course_id uuid references public.courses (id) on delete cascade,  -- Ders
  kind text not null check (kind in ('notes', 'mock_exam', 'report', 'question_set', 'answer_key')),  -- Belge türü
  title text not null,  -- Başlık
  spec jsonb not null default '{}',  -- İstek: kapsam, uzunluk, zorluk, "hatalarımı dahil et"
  content jsonb,  -- Belge AST'si (document-ast)
  html_path text,  -- Storage yolu (HTML)
  pdf_path text,  -- Storage yolu (PDF)
  status text not null default 'queued' check (status in ('queued', 'generating', 'rendered', 'review', 'published', 'failed')),  -- Durum
  version int not null default 1,  -- Sürüm
  personalization jsonb,  -- Kişiselleştirme izi (zayıf kazanımlar, yanılgılar, tarzlar)
  verification jsonb,  -- Doğrulama merdiveni sonucu (şema, SymPy, figür, kopya, kişiselleştirme)
  model text,  -- Model
  cost_usd numeric(10, 6) not null default 0,  -- Maliyet
  created_by uuid references public.profiles (id) on delete set null,  -- İsteyen profil
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  updated_at timestamptz not null default now()  -- Son güncelleme
);
-- begin comments public.generated_documents
comment on table public.generated_documents is 'Üretilen belgeler; content = belge AST''si (packages/contracts document-ast).';
comment on column public.generated_documents.id is 'Belge kimliği';
comment on column public.generated_documents.student_id is 'Kişiye özel belgenin öğrencisi (ders geneli: boş)';
comment on column public.generated_documents.course_id is 'Ders';
comment on column public.generated_documents.kind is 'Belge türü';
comment on column public.generated_documents.title is 'Başlık';
comment on column public.generated_documents.spec is 'İstek: kapsam, uzunluk, zorluk, "hatalarımı dahil et"';
comment on column public.generated_documents.content is 'Belge AST''si (document-ast)';
comment on column public.generated_documents.html_path is 'Storage yolu (HTML)';
comment on column public.generated_documents.pdf_path is 'Storage yolu (PDF)';
comment on column public.generated_documents.status is 'Durum';
comment on column public.generated_documents.version is 'Sürüm';
comment on column public.generated_documents.personalization is 'Kişiselleştirme izi (zayıf kazanımlar, yanılgılar, tarzlar)';
comment on column public.generated_documents.verification is 'Doğrulama merdiveni sonucu (şema, SymPy, figür, kopya, kişiselleştirme)';
comment on column public.generated_documents.model is 'Model';
comment on column public.generated_documents.cost_usd is 'Maliyet';
comment on column public.generated_documents.created_by is 'İsteyen profil';
comment on column public.generated_documents.created_at is 'Oluşturulma zamanı';
comment on column public.generated_documents.updated_at is 'Son güncelleme';
-- end comments public.generated_documents
create index generated_documents_student_kind on public.generated_documents (student_id, kind, created_at desc);
create index generated_documents_course on public.generated_documents (course_id, created_at desc);
alter table public.generated_documents enable row level security;
alter table public.generated_documents force row level security;

alter table public.exams add constraint exams_generated_document_fk
foreign key (generated_document_id) references public.generated_documents (id) on delete set null;
alter table public.exam_sessions add constraint exam_sessions_report_document_fk
foreign key (report_document_id) references public.generated_documents (id) on delete set null;

create table public.library_documents (  -- Ders notu kütüphanesi (PDF, kitap bölümü, izlence); arama ve kaynak.
  id uuid primary key default gen_random_uuid(),  -- Belge kimliği
  curriculum_id uuid references public.curricula (id),  -- Müfredat sürümü
  course_id uuid references public.courses (id) on delete cascade,  -- Ders
  upload_id uuid references public.uploads (id) on delete set null,  -- Kaynak yükleme
  title text not null,  -- Başlık
  storage_path text not null,  -- Storage yolu
  pages int,  -- Sayfa sayısı
  uploaded_by uuid references public.profiles (id) on delete set null,  -- Yükleyen
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.library_documents
comment on table public.library_documents is 'Ders notu kütüphanesi (PDF, kitap bölümü, izlence); arama ve kaynak.';
comment on column public.library_documents.id is 'Belge kimliği';
comment on column public.library_documents.curriculum_id is 'Müfredat sürümü';
comment on column public.library_documents.course_id is 'Ders';
comment on column public.library_documents.upload_id is 'Kaynak yükleme';
comment on column public.library_documents.title is 'Başlık';
comment on column public.library_documents.storage_path is 'Storage yolu';
comment on column public.library_documents.pages is 'Sayfa sayısı';
comment on column public.library_documents.uploaded_by is 'Yükleyen';
comment on column public.library_documents.created_at is 'Oluşturulma zamanı';
-- end comments public.library_documents
alter table public.library_documents enable row level security;
alter table public.library_documents force row level security;

create table public.library_chunks (  -- Ders notu parçaları (gömme + tam metin).
  id bigint generated always as identity primary key,  -- Parça kimliği
  document_id uuid not null references public.library_documents (id) on delete cascade,  -- Belge
  page int,  -- Sayfa
  text text not null,  -- Metin
  embedding halfvec(1024),  -- Gömme (Voyage, 1024)
  tsv tsvector generated always as (to_tsvector('turkish', text)) stored,  -- Tam metin arama vektörü
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.library_chunks
comment on table public.library_chunks is 'Ders notu parçaları (gömme + tam metin).';
comment on column public.library_chunks.id is 'Parça kimliği';
comment on column public.library_chunks.document_id is 'Belge';
comment on column public.library_chunks.page is 'Sayfa';
comment on column public.library_chunks.text is 'Metin';
comment on column public.library_chunks.embedding is 'Gömme (Voyage, 1024)';
comment on column public.library_chunks.tsv is 'Tam metin arama vektörü';
comment on column public.library_chunks.created_at is 'Oluşturulma zamanı';
-- end comments public.library_chunks
create index library_chunks_embedding on public.library_chunks using hnsw (embedding halfvec_cosine_ops);
create index library_chunks_tsv on public.library_chunks using gin (tsv);
alter table public.library_chunks enable row level security;
alter table public.library_chunks force row level security;

create trigger touch_updated_at before update on public.generated_documents
for each row execute function app.touch_updated_at();
