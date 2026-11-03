-- 0007_uploads_conversations.sql — yüklemeler, sohbetler ve mesajları, hafıza aracı dosyaları (+sürümleri), çıkarılmış
-- olgular, haftalık özetler (docs/PLAN-v2.md §3.2, §3.4; docs/PLAN-v2-detail.md §2.3).
-- Hafıza dosyaları Claude memory tool'unun (memory_20250818) deposudur: yol /memories/ altında, öğrenci başına
-- ≤ 12 dosya, dosya ≤ 8 KB (app.memory_files_guard, OGR-MEM-00x); her değişiklik memory_file_versions'a yazılır.

create table public.uploads (  -- Yüklenen her dosya (fotoğraf, PDF, video, ses, transkript, belge, tuval); ikili Storage'da.
  id uuid primary key default gen_random_uuid(),  -- Yükleme kimliği
  owner_id uuid not null references public.profiles (id) on delete cascade,  -- Yükleyen profil
  student_id uuid references public.students (id) on delete cascade,  -- İlgili öğrenci (eğitmen arşivi: boş)
  kind text not null check (kind in ('photo', 'pdf', 'video', 'audio', 'transcript', 'document', 'canvas')),  -- Dosya türü
  storage_path text not null,  -- Storage yolu ('uploads/<owner>/<id>.jpg')
  mime text,  -- MIME türü
  bytes bigint,  -- Boyut (bayt)
  sha256 text,  -- İçerik özeti (tekrar yükleme tespiti)
  width int,  -- Genişlik (px; görsel)
  height int,  -- Yükseklik (px; görsel)
  pages int,  -- Sayfa sayısı (PDF)
  anthropic_file_id text,  -- Anthropic Files API kimliği (tekrar kullanılır)
  status text not null default 'stored' check (status in ('stored', 'processing', 'ready', 'failed')),  -- İşlem durumu
  extracted_text text,  -- Çıkarılan metin (OCR / transkript)
  embedding halfvec(1024),  -- Metnin gömmesi (Voyage, 1024)
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.uploads
comment on table public.uploads is 'Yüklenen her dosya (fotoğraf, PDF, video, ses, transkript, belge, tuval); ikili Storage''da.';
comment on column public.uploads.id is 'Yükleme kimliği';
comment on column public.uploads.owner_id is 'Yükleyen profil';
comment on column public.uploads.student_id is 'İlgili öğrenci (eğitmen arşivi: boş)';
comment on column public.uploads.kind is 'Dosya türü';
comment on column public.uploads.storage_path is 'Storage yolu (''uploads/<owner>/<id>.jpg'')';
comment on column public.uploads.mime is 'MIME türü';
comment on column public.uploads.bytes is 'Boyut (bayt)';
comment on column public.uploads.sha256 is 'İçerik özeti (tekrar yükleme tespiti)';
comment on column public.uploads.width is 'Genişlik (px; görsel)';
comment on column public.uploads.height is 'Yükseklik (px; görsel)';
comment on column public.uploads.pages is 'Sayfa sayısı (PDF)';
comment on column public.uploads.anthropic_file_id is 'Anthropic Files API kimliği (tekrar kullanılır)';
comment on column public.uploads.status is 'İşlem durumu';
comment on column public.uploads.extracted_text is 'Çıkarılan metin (OCR / transkript)';
comment on column public.uploads.embedding is 'Metnin gömmesi (Voyage, 1024)';
comment on column public.uploads.created_at is 'Oluşturulma zamanı';
-- end comments public.uploads
create index uploads_student_created on public.uploads (student_id, created_at desc);
create index uploads_owner_created on public.uploads (owner_id, created_at desc);
create index uploads_sha256 on public.uploads (sha256);
create index uploads_embedding on public.uploads using hnsw (embedding halfvec_cosine_ops);
alter table public.uploads enable row level security;
alter table public.uploads force row level security;

create table public.conversations (  -- Sohbetler: öğrenci koçu, veli ajanı, eğitmen sohbeti.
  id uuid primary key default gen_random_uuid(),  -- Sohbet kimliği
  student_id uuid not null references public.students (id) on delete cascade,  -- Konu öğrenci
  kind text not null check (kind in ('coach', 'parent', 'instructor')),  -- Sohbet türü (veli koç sohbetini okuyamaz)
  participant_id uuid not null references public.profiles (id) on delete cascade,  -- Sohbeti yürüten profil (öğrenci, veli ya da eğitmen)
  course_id uuid references public.courses (id) on delete set null,  -- Ders bağlamı
  title text,  -- Başlık
  mode text not null default 'hint' check (mode in ('hint', 'explain', 'solve')),  -- Koç modu
  summary text,  -- Eski mesajların özeti (Haiku; son 30 mesaj birebir)
  summary_upto_message_id bigint,  -- Özetin kapsadığı son mesaj
  last_message_at timestamptz,  -- Son mesaj zamanı
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.conversations
comment on table public.conversations is 'Sohbetler: öğrenci koçu, veli ajanı, eğitmen sohbeti.';
comment on column public.conversations.id is 'Sohbet kimliği';
comment on column public.conversations.student_id is 'Konu öğrenci';
comment on column public.conversations.kind is 'Sohbet türü (veli koç sohbetini okuyamaz)';
comment on column public.conversations.participant_id is 'Sohbeti yürüten profil (öğrenci, veli ya da eğitmen)';
comment on column public.conversations.course_id is 'Ders bağlamı';
comment on column public.conversations.title is 'Başlık';
comment on column public.conversations.mode is 'Koç modu';
comment on column public.conversations.summary is 'Eski mesajların özeti (Haiku; son 30 mesaj birebir)';
comment on column public.conversations.summary_upto_message_id is 'Özetin kapsadığı son mesaj';
comment on column public.conversations.last_message_at is 'Son mesaj zamanı';
comment on column public.conversations.created_at is 'Oluşturulma zamanı';
-- end comments public.conversations
create index conversations_student_kind on public.conversations (student_id, kind, last_message_at desc);
create index conversations_participant on public.conversations (participant_id, last_message_at desc);
alter table public.conversations enable row level security;
alter table public.conversations force row level security;

create table public.conversation_messages (  -- Sohbet mesajları; içerik Anthropic içerik blokları (jsonb).
  id bigint generated always as identity primary key,  -- Mesaj kimliği
  conversation_id uuid not null references public.conversations (id) on delete cascade,  -- Sohbet
  role text not null check (role in ('user', 'assistant', 'system')),  -- Konuşan
  content jsonb not null,  -- Anthropic içerik blokları [{type: text|image|document|tool_use|tool_result, …}]
  upload_ids uuid[] not null default '{}',  -- Mesaja eklenen yüklemeler
  llm_call_id bigint,  -- Cevabı üreten LLM çağrısı (FK 0014_llm_ledger.sql'de)
  tool_calls jsonb,  -- Turdaki araç çağrıları özeti
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.conversation_messages
comment on table public.conversation_messages is 'Sohbet mesajları; içerik Anthropic içerik blokları (jsonb).';
comment on column public.conversation_messages.id is 'Mesaj kimliği';
comment on column public.conversation_messages.conversation_id is 'Sohbet';
comment on column public.conversation_messages.role is 'Konuşan';
comment on column public.conversation_messages.content is 'Anthropic içerik blokları [{type: text|image|document|tool_use|tool_result, …}]';
comment on column public.conversation_messages.upload_ids is 'Mesaja eklenen yüklemeler';
comment on column public.conversation_messages.llm_call_id is 'Cevabı üreten LLM çağrısı (FK 0014_llm_ledger.sql''de)';
comment on column public.conversation_messages.tool_calls is 'Turdaki araç çağrıları özeti';
comment on column public.conversation_messages.created_at is 'Oluşturulma zamanı';
-- end comments public.conversation_messages
create index conversation_messages_conversation on public.conversation_messages (conversation_id, id);
alter table public.conversation_messages enable row level security;
alter table public.conversation_messages force row level security;

alter table public.conversations add constraint conversations_summary_upto_fk
foreign key (summary_upto_message_id) references public.conversation_messages (id) on delete set null;

create table public.memory_files (  -- Claude hafıza aracı dosyaları (öğrenci başına; /memories/profile.md, patterns.md, …).
  student_id uuid not null references public.students (id) on delete cascade,  -- Öğrenci
  path text not null check (path ~ '^/memories/[A-Za-z0-9_./-]+$' and path !~ '(^|/)\.\.(/|$)'),  -- Yol: /memories/ altında, '..' yok
  content text not null default '' check (octet_length(content) <= 8192),  -- Dosya içeriği (≤ 8 KB)
  bytes int not null default 0,  -- Boyut (bayt); tetikleyici octet_length(content) yazar
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  updated_at timestamptz not null default now(),  -- Son değişiklik
  primary key (student_id, path)
);
-- begin comments public.memory_files
comment on table public.memory_files is 'Claude hafıza aracı dosyaları (öğrenci başına; /memories/profile.md, patterns.md, …).';
comment on column public.memory_files.student_id is 'Öğrenci';
comment on column public.memory_files.path is 'Yol: /memories/ altında, ''..'' yok';
comment on column public.memory_files.content is 'Dosya içeriği (≤ 8 KB)';
comment on column public.memory_files.bytes is 'Boyut (bayt); tetikleyici octet_length(content) yazar';
comment on column public.memory_files.created_at is 'Oluşturulma zamanı';
comment on column public.memory_files.updated_at is 'Son değişiklik';
-- end comments public.memory_files
alter table public.memory_files enable row level security;
alter table public.memory_files force row level security;

create table public.memory_file_versions (  -- Hafıza dosyası değişiklik geçmişi (her işlem bir satır).
  id bigint generated always as identity primary key,  -- Satır kimliği
  student_id uuid not null references public.students (id) on delete cascade,  -- Öğrenci
  path text not null,  -- Dosya yolu (rename: yeni yol)
  version int not null,  -- Dosyanın sürüm numarası (1'den artar)
  op text not null check (op in ('create', 'str_replace', 'insert', 'delete', 'rename', 'compact')),  -- Hafıza aracı işlemi
  actor text not null,  -- Yazan: 'coach' | 'memory-delta' | 'memory-compact' | 'student:<uuid>' | 'instructor:<uuid>'
  content text,  -- İşlem sonrası içerik (delete: boş)
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.memory_file_versions
comment on table public.memory_file_versions is 'Hafıza dosyası değişiklik geçmişi (her işlem bir satır).';
comment on column public.memory_file_versions.id is 'Satır kimliği';
comment on column public.memory_file_versions.student_id is 'Öğrenci';
comment on column public.memory_file_versions.path is 'Dosya yolu (rename: yeni yol)';
comment on column public.memory_file_versions.version is 'Dosyanın sürüm numarası (1''den artar)';
comment on column public.memory_file_versions.op is 'Hafıza aracı işlemi';
comment on column public.memory_file_versions.actor is 'Yazan: ''coach'' | ''memory-delta'' | ''memory-compact'' | ''student:<uuid>'' | ''instructor:<uuid>''';
comment on column public.memory_file_versions.content is 'İşlem sonrası içerik (delete: boş)';
comment on column public.memory_file_versions.created_at is 'Oluşturulma zamanı';
-- end comments public.memory_file_versions
create index memory_file_versions_path on public.memory_file_versions (student_id, path, version desc);
alter table public.memory_file_versions enable row level security;
alter table public.memory_file_versions force row level security;

create table public.memory_facts (  -- Çıkarılmış olgular (söz, teslim tarihi, moral, tercih …); kaynak zorunlu.
  id bigint generated always as identity primary key,  -- Olgu kimliği
  student_id uuid not null references public.students (id) on delete cascade,  -- Öğrenci
  kind text not null check (kind in ('promise', 'deadline', 'unanswered_question', 'morale', 'topic_asked', 'preference', 'instructor_fact', 'other')),  -- Olgu türü
  text text not null check (length(text) <= 300),  -- Olgu metni (≤ 300)
  source_message_ids bigint[] not null default '{}',  -- Kaynak conversation_messages
  source_lesson_claim_id uuid,  -- Kaynak ders iddiası (FK 0012_lessons.sql'de)
  confidence numeric(3, 2) not null default 0.70 check (confidence between 0 and 1),  -- Güven
  requires_approval boolean not null default false,  -- Not/devamsızlık/puan: eğitmen onayı olmadan kullanılmaz
  approved boolean not null default false,  -- Eğitmen onayı
  approved_by uuid references public.profiles (id) on delete set null,  -- Onaylayan
  valid_from date not null default current_date,  -- Geçerlilik başlangıcı
  valid_until date,  -- Geçerlilik sonu
  morale_signal smallint check (morale_signal between -2 and 2),  -- Moral sinyali
  status text not null default 'active' check (status in ('active', 'merged', 'expired', 'retracted')),  -- Durum
  embedding halfvec(1024),  -- Gömme (Voyage, 1024)
  tsv tsvector generated always as (to_tsvector('turkish', text)) stored,  -- Tam metin arama vektörü
  model text,  -- Çıkaran model
  cost_usd numeric(10, 6) not null default 0,  -- Maliyet
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  check (cardinality(source_message_ids) >= 1 or source_lesson_claim_id is not null)
);
-- begin comments public.memory_facts
comment on table public.memory_facts is 'Çıkarılmış olgular (söz, teslim tarihi, moral, tercih …); kaynak zorunlu.';
comment on column public.memory_facts.id is 'Olgu kimliği';
comment on column public.memory_facts.student_id is 'Öğrenci';
comment on column public.memory_facts.kind is 'Olgu türü';
comment on column public.memory_facts.text is 'Olgu metni (≤ 300)';
comment on column public.memory_facts.source_message_ids is 'Kaynak conversation_messages';
comment on column public.memory_facts.source_lesson_claim_id is 'Kaynak ders iddiası (FK 0012_lessons.sql''de)';
comment on column public.memory_facts.confidence is 'Güven';
comment on column public.memory_facts.requires_approval is 'Not/devamsızlık/puan: eğitmen onayı olmadan kullanılmaz';
comment on column public.memory_facts.approved is 'Eğitmen onayı';
comment on column public.memory_facts.approved_by is 'Onaylayan';
comment on column public.memory_facts.valid_from is 'Geçerlilik başlangıcı';
comment on column public.memory_facts.valid_until is 'Geçerlilik sonu';
comment on column public.memory_facts.morale_signal is 'Moral sinyali';
comment on column public.memory_facts.status is 'Durum';
comment on column public.memory_facts.embedding is 'Gömme (Voyage, 1024)';
comment on column public.memory_facts.tsv is 'Tam metin arama vektörü';
comment on column public.memory_facts.model is 'Çıkaran model';
comment on column public.memory_facts.cost_usd is 'Maliyet';
comment on column public.memory_facts.created_at is 'Oluşturulma zamanı';
-- end comments public.memory_facts
create index memory_facts_embedding on public.memory_facts using hnsw (embedding halfvec_cosine_ops);
create index memory_facts_tsv on public.memory_facts using gin (tsv);
create index memory_facts_student_status on public.memory_facts (student_id, status);
alter table public.memory_facts enable row level security;
alter table public.memory_facts force row level security;

create table public.weekly_summaries (  -- Haftalık özet (veli raporu ve dossier girdisi).
  id uuid primary key default gen_random_uuid(),  -- Özet kimliği
  student_id uuid not null references public.students (id) on delete cascade,  -- Öğrenci
  week_start date not null,  -- Hafta başı (pazartesi)
  body text not null check (length(body) <= 600),  -- Özet metni (≤ 600)
  metrics jsonb not null,  -- Haftalık ölçüler
  facts_used bigint[] not null default '{}',  -- Kullanılan olgular
  model text,  -- Model
  cost_usd numeric(10, 6) not null default 0,  -- Maliyet
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  unique (student_id, week_start)
);
-- begin comments public.weekly_summaries
comment on table public.weekly_summaries is 'Haftalık özet (veli raporu ve dossier girdisi).';
comment on column public.weekly_summaries.id is 'Özet kimliği';
comment on column public.weekly_summaries.student_id is 'Öğrenci';
comment on column public.weekly_summaries.week_start is 'Hafta başı (pazartesi)';
comment on column public.weekly_summaries.body is 'Özet metni (≤ 600)';
comment on column public.weekly_summaries.metrics is 'Haftalık ölçüler';
comment on column public.weekly_summaries.facts_used is 'Kullanılan olgular';
comment on column public.weekly_summaries.model is 'Model';
comment on column public.weekly_summaries.cost_usd is 'Maliyet';
comment on column public.weekly_summaries.created_at is 'Oluşturulma zamanı';
-- end comments public.weekly_summaries
alter table public.weekly_summaries enable row level security;
alter table public.weekly_summaries force row level security;

-- Hafıza dosyası koruması: bytes = octet_length(content); öğrenci başına en çok settings.memory_max_files (12) dosya
create or replace function app.memory_files_guard() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_max int;
  v_count int;
begin
  new.bytes := octet_length(new.content);
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  if tg_op = 'INSERT' or new.path is distinct from old.path or new.student_id is distinct from old.student_id then
    select (st.value #>> '{}')::int into v_max from public.settings st where st.key = 'memory_max_files';
    v_max := coalesce(v_max, 12);
    select count(*) into v_count from public.memory_files mf
     where mf.student_id = new.student_id and mf.path <> new.path;
    if v_count >= v_max then
      raise exception using errcode = 'P0001', message = format('OGR-MEM-001 hafıza dosyası sınırı (%s) aşıldı', v_max);
    end if;
  end if;
  return new;
end
$$;
comment on function app.memory_files_guard() is 'BEFORE INSERT/UPDATE memory_files: bytes hesaplar, öğrenci başına dosya sınırını uygular (OGR-MEM-001).';
revoke all on function app.memory_files_guard() from public;

create trigger memory_files_guard before insert or update on public.memory_files
for each row execute function app.memory_files_guard();
