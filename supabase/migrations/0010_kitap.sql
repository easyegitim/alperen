-- 0010_kitap.sql — Kitap: araştırma istekleri, çıktılar, atıflar, ders notu kütüphanesi (BLUEPRINT §3.6).

create table public.research_requests (  -- Araştırma istekleri (pilotta research_enabled=false).
  id uuid primary key default gen_random_uuid(),  -- İstek kimliği
  student_id uuid references public.students (id) on delete set null,  -- İsteyen öğrenci
  staff_id uuid references public.staff (id),  -- İsteyen personel
  query text not null,  -- Soru
  expanded_queries text[] not null default '{}',  -- Genişletilmiş sorgular
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'blocked_quota')),  -- Durum
  cost_usd numeric(10, 6) not null default 0,  -- Maliyet
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  finished_at timestamptz  -- Bitiş
);
-- begin comments public.research_requests
comment on table public.research_requests is 'Araştırma istekleri (pilotta research_enabled=false).';
comment on column public.research_requests.id is 'İstek kimliği';
comment on column public.research_requests.student_id is 'İsteyen öğrenci';
comment on column public.research_requests.staff_id is 'İsteyen personel';
comment on column public.research_requests.query is 'Soru';
comment on column public.research_requests.expanded_queries is 'Genişletilmiş sorgular';
comment on column public.research_requests.status is 'Durum';
comment on column public.research_requests.cost_usd is 'Maliyet';
comment on column public.research_requests.created_at is 'Oluşturulma zamanı';
comment on column public.research_requests.finished_at is 'Bitiş';
-- end comments public.research_requests

create table public.research_outputs (  -- Araştırma çıktıları (eğitmen incelemesinden sonra released).
  id uuid primary key default gen_random_uuid(),  -- Çıktı kimliği
  request_id uuid not null references public.research_requests (id) on delete cascade,  -- İstek
  output jsonb not null,  -- research-output şeması
  bibtex text,  -- BibTeX
  apa text,  -- APA
  model text,  -- Model
  status text not null default 'pending_review' check (status in ('pending_review', 'released', 'rejected')),  -- Durum
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.research_outputs
comment on table public.research_outputs is 'Araştırma çıktıları (eğitmen incelemesinden sonra released).';
comment on column public.research_outputs.id is 'Çıktı kimliği';
comment on column public.research_outputs.request_id is 'İstek';
comment on column public.research_outputs.output is 'research-output şeması';
comment on column public.research_outputs.bibtex is 'BibTeX';
comment on column public.research_outputs.apa is 'APA';
comment on column public.research_outputs.model is 'Model';
comment on column public.research_outputs.status is 'Durum';
comment on column public.research_outputs.created_at is 'Oluşturulma zamanı';
-- end comments public.research_outputs

create table public.citations (  -- Atıflar (Crossref doğrulaması; eğitmen ilgi puanı).
  id uuid primary key default gen_random_uuid(),  -- Atıf kimliği
  output_id uuid not null references public.research_outputs (id) on delete cascade,  -- Çıktı
  ordinal int not null,  -- Sıra
  doi text,  -- DOI
  title text not null,  -- Başlık
  authors text,  -- Yazarlar
  venue text,  -- Yayın
  year smallint,  -- Yıl
  crossref_status text not null default 'pending' check (crossref_status in ('pending', 'verified', 'unresolved', 'no_doi')),  -- Crossref durumu
  title_similarity numeric(3, 2),  -- Başlık benzerliği
  verified_at timestamptz,  -- Doğrulama zamanı
  oa_pdf_url text,  -- Açık erişim PDF
  tldr text,  -- Tek cümle özet
  status text not null default 'kept' check (status in ('kept', 'removed')),  -- Tutuldu/çıkarıldı
  removed_reason text,  -- Çıkarılma nedeni
  relevance smallint check (relevance between 0 and 2),  -- Eğitmen ilgi puanı (0–2); öğrenciye görünmez
  relevance_by uuid references public.staff (id),  -- Puanlayan
  relevance_at timestamptz,  -- Puanlama zamanı
  unique (output_id, ordinal)
);
-- begin comments public.citations
comment on table public.citations is 'Atıflar (Crossref doğrulaması; eğitmen ilgi puanı).';
comment on column public.citations.id is 'Atıf kimliği';
comment on column public.citations.output_id is 'Çıktı';
comment on column public.citations.ordinal is 'Sıra';
comment on column public.citations.doi is 'DOI';
comment on column public.citations.title is 'Başlık';
comment on column public.citations.authors is 'Yazarlar';
comment on column public.citations.venue is 'Yayın';
comment on column public.citations.year is 'Yıl';
comment on column public.citations.crossref_status is 'Crossref durumu';
comment on column public.citations.title_similarity is 'Başlık benzerliği';
comment on column public.citations.verified_at is 'Doğrulama zamanı';
comment on column public.citations.oa_pdf_url is 'Açık erişim PDF';
comment on column public.citations.tldr is 'Tek cümle özet';
comment on column public.citations.status is 'Tutuldu/çıkarıldı';
comment on column public.citations.removed_reason is 'Çıkarılma nedeni';
comment on column public.citations.relevance is 'Eğitmen ilgi puanı (0–2); öğrenciye görünmez';
comment on column public.citations.relevance_by is 'Puanlayan';
comment on column public.citations.relevance_at is 'Puanlama zamanı';
-- end comments public.citations

create table public.library_documents (  -- Ders notu PDF'leri (tablet notes ingest yazar).
  id uuid primary key default gen_random_uuid(),  -- Belge kimliği
  curriculum_id uuid references public.curricula (id),  -- Müfredat sürümü
  title text not null,  -- Başlık
  storage_path text not null,  -- Storage yolu
  pages int,  -- Sayfa sayısı
  uploaded_by uuid references public.staff (id),  -- Yükleyen
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.library_documents
comment on table public.library_documents is 'Ders notu PDF''leri (tablet notes ingest yazar).';
comment on column public.library_documents.id is 'Belge kimliği';
comment on column public.library_documents.curriculum_id is 'Müfredat sürümü';
comment on column public.library_documents.title is 'Başlık';
comment on column public.library_documents.storage_path is 'Storage yolu';
comment on column public.library_documents.pages is 'Sayfa sayısı';
comment on column public.library_documents.uploaded_by is 'Yükleyen';
comment on column public.library_documents.created_at is 'Oluşturulma zamanı';
-- end comments public.library_documents

create table public.library_chunks (  -- Ders notu parçaları (gömme + tam metin).
  id bigint generated always as identity primary key,  -- Parça kimliği
  document_id uuid not null references public.library_documents (id) on delete cascade,  -- Belge
  page int,  -- Sayfa
  text text not null,  -- Metin
  embedding halfvec(768),  -- Gömme
  tsv tsvector generated always as (to_tsvector('turkish', text)) stored  -- Tam metin arama vektörü
);
-- begin comments public.library_chunks
comment on table public.library_chunks is 'Ders notu parçaları (gömme + tam metin).';
comment on column public.library_chunks.id is 'Parça kimliği';
comment on column public.library_chunks.document_id is 'Belge';
comment on column public.library_chunks.page is 'Sayfa';
comment on column public.library_chunks.text is 'Metin';
comment on column public.library_chunks.embedding is 'Gömme';
comment on column public.library_chunks.tsv is 'Tam metin arama vektörü';
-- end comments public.library_chunks
create index library_chunks_embedding on public.library_chunks using hnsw (embedding halfvec_cosine_ops);

-- research_outputs released olunca öğrencinin özel sohbetine research_ready proaktif mesajı
-- (proactive_one_per_day çakışırsa ertesi gün)
create or replace function app.research_released() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid;
  v_chat bigint;
  v_day int := 0;
  v_done boolean := false;
begin
  if new.status <> 'released' or old.status = 'released' then
    return new;
  end if;
  select r.student_id into v_student from public.research_requests r where r.id = new.request_id;
  if v_student is null then
    return new;
  end if;
  select cr.chat_id into v_chat
    from public.chat_roles cr join public.tg_chats t on t.chat_id = cr.chat_id
   where cr.student_id = v_student and t.kind = 'private'
   order by cr.joined_at
   limit 1;
  while not v_done and v_day < 7 loop
    begin
      insert into public.proactive_messages (student_id, chat_id, recipient, template_id, params, scheduled_for)
      values (v_student, v_chat, 'student', 'research_ready', jsonb_build_object('output_id', new.id),
              now() + make_interval(days => v_day));
      v_done := true;
    exception when unique_violation then
      v_day := v_day + 1;
    end;
  end loop;
  return new;
end
$$;
comment on function app.research_released() is 'Araştırma çıktısı released olunca öğrenciye research_ready proaktif mesajı kuyruğa alır.';
revoke all on function app.research_released() from public;

create trigger research_released after update of status on public.research_outputs
for each row execute function app.research_released();
