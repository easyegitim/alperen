-- 0005_gozluk.sql — Gözlük: kanıt zinciri, ustalık, yanılgılar, eğitmen notları, tercihler (BLUEPRINT §3.3)
-- Kanıt zinciri şema kısıtıdır: her gözlem bir kaynak satıra (attempt, lesson_claim, message, instructor_note,
-- observation) bağlıdır; kaynaksız gözlem app.observations_check_source() ile reddedilir (OGR-EVID-001).

create table public.observations (  -- Ham kanıt; yalnız SECURITY DEFINER fonksiyonlar yazar.
  id bigint generated always as identity primary key,  -- Gözlem kimliği
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,  -- Kayıt
  curriculum_id uuid not null,  -- Müfredat sürümü; app.fill_curriculum_id() kayıttan doldurur
  skill_id text not null,  -- Kazanım
  kind text not null check (kind in ('diagnostic', 'practice', 'test', 'lesson', 'chat_question', 'chat_misconception', 'instructor', 'inferred', 'resolution')),  -- Gözlem türü
  value numeric(4, 3) check (value between 0 and 1),  -- İkili 0/1 ya da 0–1 ustalık; sohbet gözlemlerinde boş
  weight numeric(3, 2) not null default 1.00 check (weight between 0 and 1),  -- Gözlem ağırlığı
  confidence numeric(3, 2) check (confidence between 0 and 1),  -- Ders analizi güveni
  source_type text not null check (source_type in ('attempt', 'lesson_claim', 'message', 'instructor_note', 'observation')),  -- Kaynak türü
  source_id text not null,  -- Kaynak satır kimliği
  source_locator text not null,  -- İnsan-okur konum: 'Teşhis · Soru 8', 'Ders 12 · 00:14:32'
  quote text check (length(quote) <= 300),  -- Kanıt alıntısı; PII temizlenmiş, ≤ 300 karakter
  misconception_tag text references public.misconception_tags (tag),  -- Yanılgı etiketi
  guess_override numeric(4, 3) check (guess_override between 0.001 and 0.999),  -- Gözleme özel g (numeric sorularda 0.05); boş → skills.p_guess
  counts_for_mastery boolean not null default true,  -- Kanıt sayacına katılır mı (sohbet: hayır)
  created_by_role text not null,  -- Yazan rol: bot_runtime | batch_worker | instructor | grader
  applied_at timestamptz,  -- apply_observation uygulandığı zaman
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id)
);
-- begin comments public.observations
comment on table public.observations is 'Ham kanıt; yalnız SECURITY DEFINER fonksiyonlar yazar.';
comment on column public.observations.id is 'Gözlem kimliği';
comment on column public.observations.enrollment_id is 'Kayıt';
comment on column public.observations.curriculum_id is 'Müfredat sürümü; app.fill_curriculum_id() kayıttan doldurur';
comment on column public.observations.skill_id is 'Kazanım';
comment on column public.observations.kind is 'Gözlem türü';
comment on column public.observations.value is 'İkili 0/1 ya da 0–1 ustalık; sohbet gözlemlerinde boş';
comment on column public.observations.weight is 'Gözlem ağırlığı';
comment on column public.observations.confidence is 'Ders analizi güveni';
comment on column public.observations.source_type is 'Kaynak türü';
comment on column public.observations.source_id is 'Kaynak satır kimliği';
comment on column public.observations.source_locator is 'İnsan-okur konum: ''Teşhis · Soru 8'', ''Ders 12 · 00:14:32''';
comment on column public.observations.quote is 'Kanıt alıntısı; PII temizlenmiş, ≤ 300 karakter';
comment on column public.observations.misconception_tag is 'Yanılgı etiketi';
comment on column public.observations.guess_override is 'Gözleme özel g (numeric sorularda 0.05); boş → skills.p_guess';
comment on column public.observations.counts_for_mastery is 'Kanıt sayacına katılır mı (sohbet: hayır)';
comment on column public.observations.created_by_role is 'Yazan rol: bot_runtime | batch_worker | instructor | grader';
comment on column public.observations.applied_at is 'apply_observation uygulandığı zaman';
comment on column public.observations.created_at is 'Oluşturulma zamanı';
-- end comments public.observations
create index observations_enrollment_skill on public.observations (enrollment_id, skill_id, created_at desc);
create index observations_source on public.observations (source_type, source_id);

create table public.mastery (  -- Kazanım başına güncel ustalık (BKT); yalnız apply_observation yazar.
  enrollment_id uuid references public.enrollments (id) on delete cascade,  -- Kayıt
  curriculum_id uuid not null,  -- Müfredat sürümü; app.fill_curriculum_id()
  skill_id text not null,  -- Kazanım (yaprak)
  p numeric(6, 5) not null check (p between 0 and 1),  -- Bilme olasılığı
  evidence_count int not null default 0,  -- Ustalığa sayılan kanıt sayısı
  last_observation_id bigint references public.observations (id),  -- Son uygulanan gözlem
  last_evidence_at timestamptz,  -- Son sayılan kanıt zamanı
  updated_at timestamptz not null default now(),  -- Son güncelleme
  primary key (enrollment_id, skill_id),
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id)
);
-- begin comments public.mastery
comment on table public.mastery is 'Kazanım başına güncel ustalık (BKT); yalnız apply_observation yazar.';
comment on column public.mastery.enrollment_id is 'Kayıt';
comment on column public.mastery.curriculum_id is 'Müfredat sürümü; app.fill_curriculum_id()';
comment on column public.mastery.skill_id is 'Kazanım (yaprak)';
comment on column public.mastery.p is 'Bilme olasılığı';
comment on column public.mastery.evidence_count is 'Ustalığa sayılan kanıt sayısı';
comment on column public.mastery.last_observation_id is 'Son uygulanan gözlem';
comment on column public.mastery.last_evidence_at is 'Son sayılan kanıt zamanı';
comment on column public.mastery.updated_at is 'Son güncelleme';
-- end comments public.mastery

create table public.mastery_history (  -- Yalnız eklemeli: her p değişimi yöntem ve parametreleriyle.
  id bigint generated always as identity primary key,  -- Satır kimliği
  enrollment_id uuid not null,  -- Kayıt
  skill_id text not null,  -- Kazanım
  observation_id bigint not null references public.observations (id),  -- Değişimi yapan gözlem
  p_before numeric(6, 5),  -- Önceki p
  p_after numeric(6, 5) not null,  -- Sonraki p
  method text not null check (method in ('bkt', 'blend', 'inferred', 'instructor_override')),  -- Güncelleme yöntemi
  params jsonb not null,  -- Kullanılan parametreler (g, s, t, w …)
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.mastery_history
comment on table public.mastery_history is 'Yalnız eklemeli: her p değişimi yöntem ve parametreleriyle.';
comment on column public.mastery_history.id is 'Satır kimliği';
comment on column public.mastery_history.enrollment_id is 'Kayıt';
comment on column public.mastery_history.skill_id is 'Kazanım';
comment on column public.mastery_history.observation_id is 'Değişimi yapan gözlem';
comment on column public.mastery_history.p_before is 'Önceki p';
comment on column public.mastery_history.p_after is 'Sonraki p';
comment on column public.mastery_history.method is 'Güncelleme yöntemi';
comment on column public.mastery_history.params is 'Kullanılan parametreler (g, s, t, w …)';
comment on column public.mastery_history.created_at is 'Oluşturulma zamanı';
-- end comments public.mastery_history
create index mastery_history_enrollment_skill on public.mastery_history (enrollment_id, skill_id, created_at desc);

create table public.misconceptions (  -- Kayda bağlı yanılgılar; open için 3 kanıt ya da eğitmen onayı.
  id uuid primary key default gen_random_uuid(),  -- Yanılgı kimliği
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,  -- Kayıt
  curriculum_id uuid not null,  -- Müfredat sürümü; app.fill_curriculum_id()
  skill_id text not null,  -- Kazanım
  tag text references public.misconception_tags (tag),  -- Etiket; boş: ders analizinden serbest metinli yanılgı
  text_instructor text not null,  -- Eğitmen metni
  text_student text not null,  -- Öğrenci metni
  status text not null default 'pending_review' check (status in ('pending_review', 'open', 'resolved', 'rejected')),  -- İnceleme durumu
  evidence_count int not null default 0,  -- Kanıt sayısı
  first_seen timestamptz not null default now(),  -- İlk görülme
  last_seen timestamptz not null default now(),  -- Son görülme
  resolved_at timestamptz,  -- Çözülme zamanı
  resolved_by uuid references public.staff (id),  -- Çözüldü diyen eğitmen
  resolution_observation_id bigint references public.observations (id),  -- Çözüm kanıtı
  rejected_by uuid references public.staff (id),  -- Reddeden eğitmen
  reject_note text,  -- Ret notu
  check (status <> 'resolved' or (resolved_by is not null and resolution_observation_id is not null)),
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id)
);
-- begin comments public.misconceptions
comment on table public.misconceptions is 'Kayda bağlı yanılgılar; open için 3 kanıt ya da eğitmen onayı.';
comment on column public.misconceptions.id is 'Yanılgı kimliği';
comment on column public.misconceptions.enrollment_id is 'Kayıt';
comment on column public.misconceptions.curriculum_id is 'Müfredat sürümü; app.fill_curriculum_id()';
comment on column public.misconceptions.skill_id is 'Kazanım';
comment on column public.misconceptions.tag is 'Etiket; boş: ders analizinden serbest metinli yanılgı';
comment on column public.misconceptions.text_instructor is 'Eğitmen metni';
comment on column public.misconceptions.text_student is 'Öğrenci metni';
comment on column public.misconceptions.status is 'İnceleme durumu';
comment on column public.misconceptions.evidence_count is 'Kanıt sayısı';
comment on column public.misconceptions.first_seen is 'İlk görülme';
comment on column public.misconceptions.last_seen is 'Son görülme';
comment on column public.misconceptions.resolved_at is 'Çözülme zamanı';
comment on column public.misconceptions.resolved_by is 'Çözüldü diyen eğitmen';
comment on column public.misconceptions.resolution_observation_id is 'Çözüm kanıtı';
comment on column public.misconceptions.rejected_by is 'Reddeden eğitmen';
comment on column public.misconceptions.reject_note is 'Ret notu';
-- end comments public.misconceptions
create unique index misconceptions_active on public.misconceptions (enrollment_id, skill_id, coalesce(tag, id::text)) where status in ('pending_review', 'open');

create table public.misconception_evidence (  -- Yanılgı ↔ gözlem kanıt bağı.
  misconception_id uuid references public.misconceptions (id) on delete cascade,  -- Yanılgı
  observation_id bigint references public.observations (id) on delete cascade,  -- Gözlem
  primary key (misconception_id, observation_id)
);
-- begin comments public.misconception_evidence
comment on table public.misconception_evidence is 'Yanılgı ↔ gözlem kanıt bağı.';
comment on column public.misconception_evidence.misconception_id is 'Yanılgı';
comment on column public.misconception_evidence.observation_id is 'Gözlem';
-- end comments public.misconception_evidence

create table public.instructor_notes (  -- Eğitmen notları; ustalık tahmini doluysa instructor gözlemi üretilir.
  id uuid primary key default gen_random_uuid(),  -- Not kimliği
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,  -- Kayıt
  author_id uuid not null references public.staff (id),  -- Yazan eğitmen
  curriculum_id uuid not null,  -- Müfredat sürümü; app.fill_curriculum_id()
  skill_id text,  -- Kazanım (isteğe bağlı)
  body text not null,  -- Not metni
  mastery_estimate numeric(4, 3) check (mastery_estimate between 0 and 1),  -- Eğitmenin ustalık tahmini
  approved_fact boolean not null default false,  -- Bot bunu onaylı olgu olarak aktarabilir
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id)
);
-- begin comments public.instructor_notes
comment on table public.instructor_notes is 'Eğitmen notları; ustalık tahmini doluysa instructor gözlemi üretilir.';
comment on column public.instructor_notes.id is 'Not kimliği';
comment on column public.instructor_notes.enrollment_id is 'Kayıt';
comment on column public.instructor_notes.author_id is 'Yazan eğitmen';
comment on column public.instructor_notes.curriculum_id is 'Müfredat sürümü; app.fill_curriculum_id()';
comment on column public.instructor_notes.skill_id is 'Kazanım (isteğe bağlı)';
comment on column public.instructor_notes.body is 'Not metni';
comment on column public.instructor_notes.mastery_estimate is 'Eğitmenin ustalık tahmini';
comment on column public.instructor_notes.approved_fact is 'Bot bunu onaylı olgu olarak aktarabilir';
comment on column public.instructor_notes.created_at is 'Oluşturulma zamanı';
-- end comments public.instructor_notes

create table public.preferences (  -- Öğrenci tercihleri (aktif saatler, mod, hatırlatmalar).
  student_id uuid primary key references public.students (id) on delete cascade,  -- Öğrenci
  active_hours smallint[] not null default '{18,19,20,21}',  -- Proaktif mesaj saatleri (yerel saat)
  modality text check (modality in ('visual', 'verbal', 'mixed')),  -- Öğrenme biçimi
  default_mode text not null default 'socratic' check (default_mode in ('socratic', 'direct')),  -- Varsayılan sohbet modu
  explanation_notes text,  -- Gece işinin notu: 'kısa adımlar işe yarıyor'
  proactive_enabled boolean not null default true,  -- /durdur kapatır, /baslat açar
  voice_reply boolean not null default false,  -- Sesli yanıt (MVP'de kapalı)
  updated_at timestamptz not null default now()  -- Son güncelleme
);
-- begin comments public.preferences
comment on table public.preferences is 'Öğrenci tercihleri (aktif saatler, mod, hatırlatmalar).';
comment on column public.preferences.student_id is 'Öğrenci';
comment on column public.preferences.active_hours is 'Proaktif mesaj saatleri (yerel saat)';
comment on column public.preferences.modality is 'Öğrenme biçimi';
comment on column public.preferences.default_mode is 'Varsayılan sohbet modu';
comment on column public.preferences.explanation_notes is 'Gece işinin notu: ''kısa adımlar işe yarıyor''';
comment on column public.preferences.proactive_enabled is '/durdur kapatır, /baslat açar';
comment on column public.preferences.voice_reply is 'Sesli yanıt (MVP''de kapalı)';
comment on column public.preferences.updated_at is 'Son güncelleme';
-- end comments public.preferences

-- Kanıt zinciri: kaynak satır var mı ve aynı kayda mı ait; ders iddiası yalnız onaylı/düzeltilmiş ise
create or replace function app.observations_check_source() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_ok boolean := false;
begin
  if new.source_type in ('attempt', 'message', 'observation') and new.source_id !~ '^[0-9]+$' then
    raise exception using errcode = 'P0001', message = format('OGR-EVID-001 kaynak kimliği geçersiz (%s:%s)', new.source_type, new.source_id);
  end if;
  if new.source_type in ('lesson_claim', 'instructor_note')
     and new.source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = 'P0001', message = format('OGR-EVID-001 kaynak kimliği geçersiz (%s:%s)', new.source_type, new.source_id);
  end if;
  if new.source_type = 'attempt' then
    select exists (select 1 from public.attempts a where a.id = new.source_id::bigint and a.enrollment_id = new.enrollment_id) into v_ok;
  elsif new.source_type = 'lesson_claim' then
    select exists (
      select 1 from public.lesson_claims lc
        join public.lesson_analyses la on la.id = lc.analysis_id
        join public.lessons l on l.id = la.lesson_id
       where lc.id = new.source_id::uuid and l.enrollment_id = new.enrollment_id and lc.status in ('approved', 'edited')
    ) into v_ok;
  elsif new.source_type = 'message' then
    select exists (
      select 1 from public.messages m
        join public.enrollments e on e.student_id = m.student_id
       where m.id = new.source_id::bigint and e.id = new.enrollment_id
    ) into v_ok;
  elsif new.source_type = 'instructor_note' then
    select exists (select 1 from public.instructor_notes n where n.id = new.source_id::uuid and n.enrollment_id = new.enrollment_id) into v_ok;
  elsif new.source_type = 'observation' then
    select exists (select 1 from public.observations o where o.id = new.source_id::bigint and o.enrollment_id = new.enrollment_id) into v_ok;
  end if;
  if not v_ok then
    raise exception using errcode = 'P0001', message = format('OGR-EVID-001 kaynaksız gözlem (%s:%s)', new.source_type, new.source_id);
  end if;
  return new;
end
$$;
comment on function app.observations_check_source() is 'Gözlemin kaynak satırını ve kayıt eşleşmesini doğrular; aksi OGR-EVID-001.';
revoke all on function app.observations_check_source() from public;

create trigger a_fill_curriculum_id before insert on public.observations
for each row execute function app.fill_curriculum_id();
create trigger b_observations_check_source before insert on public.observations
for each row execute function app.observations_check_source();
create trigger a_fill_curriculum_id before insert on public.mastery
for each row execute function app.fill_curriculum_id();
create trigger a_fill_curriculum_id before insert on public.misconceptions
for each row execute function app.fill_curriculum_id();
create trigger a_fill_curriculum_id before insert on public.instructor_notes
for each row execute function app.fill_curriculum_id();
