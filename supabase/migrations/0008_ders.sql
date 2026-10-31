-- 0008_ders.sql — Ders: ders kayıtları, analizler, iddialar (BLUEPRINT §3.6). Ham video Storage'a girmez
-- (kurucu makinesinde 30 gün); transkript isimsiz ve etiketlidir. İddialar onaylanınca gözlem olur.

create table public.lessons (  -- Ders kayıtları; video yolu yalnız kurucu makinesindeki dosyayı gösterir.
  id uuid primary key default gen_random_uuid(),  -- Ders kimliği
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,  -- Kayıt
  staff_id uuid references public.staff (id),  -- Dersi veren eğitmen
  held_at timestamptz not null,  -- Ders zamanı
  duration_min int,  -- Süre (dk)
  video_ref text,  -- Kurucu makinesindeki yol / Drive kimliği; Storage'a girmez
  video_deleted_at timestamptz,  -- Videonun silinme zamanı (confirm_video_deleted)
  deletion_notified_at timestamptz,  -- Silme bildirimi zamanı
  transcript_path text,  -- Storage: transcripts/<id>.jsonl
  frames_count smallint,  -- Kare sayısı
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'analyzed', 'approved', 'corrected', 'rejected', 'failed')),  -- Durum
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.lessons
comment on table public.lessons is 'Ders kayıtları; video yolu yalnız kurucu makinesindeki dosyayı gösterir.';
comment on column public.lessons.id is 'Ders kimliği';
comment on column public.lessons.enrollment_id is 'Kayıt';
comment on column public.lessons.staff_id is 'Dersi veren eğitmen';
comment on column public.lessons.held_at is 'Ders zamanı';
comment on column public.lessons.duration_min is 'Süre (dk)';
comment on column public.lessons.video_ref is 'Kurucu makinesindeki yol / Drive kimliği; Storage''a girmez';
comment on column public.lessons.video_deleted_at is 'Videonun silinme zamanı (confirm_video_deleted)';
comment on column public.lessons.deletion_notified_at is 'Silme bildirimi zamanı';
comment on column public.lessons.transcript_path is 'Storage: transcripts/<id>.jsonl';
comment on column public.lessons.frames_count is 'Kare sayısı';
comment on column public.lessons.status is 'Durum';
comment on column public.lessons.created_at is 'Oluşturulma zamanı';
-- end comments public.lessons

create table public.lesson_analyses (  -- Ders analizleri (taslak → onay); profil anlık görüntüsüyle.
  id uuid primary key default gen_random_uuid(),  -- Analiz kimliği
  lesson_id uuid not null references public.lessons (id) on delete cascade,  -- Ders
  version smallint not null default 1,  -- Analiz sürümü
  seed_profile jsonb not null,  -- Analiz promptuna verilen profil (kümülatiflik)
  analysis jsonb not null,  -- lesson-analysis şeması
  model text not null,  -- Model
  cost_usd numeric(10, 6) not null default 0,  -- Maliyet
  status text not null default 'draft' check (status in ('draft', 'approved', 'corrected', 'rejected')),  -- Durum
  approved_by uuid references public.staff (id),  -- Onaylayan
  approved_at timestamptz,  -- Onay zamanı
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  unique (lesson_id, version)
);
-- begin comments public.lesson_analyses
comment on table public.lesson_analyses is 'Ders analizleri (taslak → onay); profil anlık görüntüsüyle.';
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

create table public.lesson_claims (  -- Analizden çıkan her iddia; onaylanınca gözlem ya da olgu olur.
  id uuid primary key default gen_random_uuid(),  -- İddia kimliği
  analysis_id uuid not null references public.lesson_analyses (id) on delete cascade,  -- Analiz
  kind text not null check (kind in ('skill_mastery', 'misconception', 'question', 'hesitation', 'homework', 'promise', 'deadline', 'next_step', 'followup', 'talk')),  -- İddia türü
  curriculum_id uuid not null,  -- Müfredat sürümü; app.fill_curriculum_id() (analiz → ders → kayıt)
  skill_id text,  -- Kazanım
  misconception_tag text references public.misconception_tags (tag),  -- Yanılgı etiketi
  misconception_id uuid references public.misconceptions (id),  -- followup: önceki yanılgı
  value jsonb not null,  -- İddia değeri
  quote text not null,  -- Kanıt alıntısı (isimsiz)
  speaker text not null check (speaker in ('ÖĞRENCİ', 'EĞİTMEN')),  -- Konuşan
  t_start_sec int not null,  -- Başlangıç (sn)
  t_end_sec int,  -- Bitiş (sn)
  status text not null default 'pending' check (status in ('pending', 'approved', 'edited', 'rejected')),  -- Karar
  edited_value jsonb,  -- Düzeltilmiş değer
  decided_by uuid references public.staff (id),  -- Karar veren
  decided_at timestamptz,  -- Karar zamanı
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id)
);
-- begin comments public.lesson_claims
comment on table public.lesson_claims is 'Analizden çıkan her iddia; onaylanınca gözlem ya da olgu olur.';
comment on column public.lesson_claims.id is 'İddia kimliği';
comment on column public.lesson_claims.analysis_id is 'Analiz';
comment on column public.lesson_claims.kind is 'İddia türü';
comment on column public.lesson_claims.curriculum_id is 'Müfredat sürümü; app.fill_curriculum_id() (analiz → ders → kayıt)';
comment on column public.lesson_claims.skill_id is 'Kazanım';
comment on column public.lesson_claims.misconception_tag is 'Yanılgı etiketi';
comment on column public.lesson_claims.misconception_id is 'followup: önceki yanılgı';
comment on column public.lesson_claims.value is 'İddia değeri';
comment on column public.lesson_claims.quote is 'Kanıt alıntısı (isimsiz)';
comment on column public.lesson_claims.speaker is 'Konuşan';
comment on column public.lesson_claims.t_start_sec is 'Başlangıç (sn)';
comment on column public.lesson_claims.t_end_sec is 'Bitiş (sn)';
comment on column public.lesson_claims.status is 'Karar';
comment on column public.lesson_claims.edited_value is 'Düzeltilmiş değer';
comment on column public.lesson_claims.decided_by is 'Karar veren';
comment on column public.lesson_claims.decided_at is 'Karar zamanı';
-- end comments public.lesson_claims
create index lesson_claims_analysis_status on public.lesson_claims (analysis_id, status);

alter table public.memory_facts add constraint memory_facts_lesson_claim_fk
foreign key (source_lesson_claim_id) references public.lesson_claims (id) on delete set null;

-- lesson_analyses.status / lesson_claims.status yalnız approve_lesson_analysis içinde (ogrenmen.approver='on')
create or replace function app.lesson_protect_status() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if new.status is distinct from old.status and coalesce(current_setting('ogrenmen.approver', true), '') <> 'on' then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-003 ders raporu durumu yalnız approve_lesson_analysis ile değişir';
  end if;
  return new;
end
$$;
comment on function app.lesson_protect_status() is 'Ders analizi ve iddia durumunu korur; yalnız approve_lesson_analysis (ogrenmen.approver=on).';
revoke all on function app.lesson_protect_status() from public;

create trigger lesson_protect_status before update of status on public.lesson_analyses
for each row execute function app.lesson_protect_status();
create trigger lesson_protect_status before update of status on public.lesson_claims
for each row execute function app.lesson_protect_status();
create trigger a_fill_curriculum_id before insert on public.lesson_claims
for each row execute function app.fill_curriculum_id();
