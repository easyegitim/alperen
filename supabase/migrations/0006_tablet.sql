-- 0006_tablet.sql — Tablet: şekiller, soru bankası, cevap anahtarı yalıtımı, şablonlar, denemeler, teşhis, havuz,
-- üretim istekleri (BLUEPRINT §3.4). Cevap anahtarı yalnız secure.answer_keys'tedir; şıklar bota ve öğrenciye
-- etiketsiz görünümle (questions_public, 0012) gider.

create table public.figures (  -- Soru şekilleri; yalnız review_status='verified' öğrenciye gider.
  id uuid primary key default gen_random_uuid(),  -- Şekil kimliği (Storage: figures/<id>.png)
  tool text not null check (tool in ('matplotlib', 'svg', 'tikz', 'vega-lite', 'schemdraw', 'rdkit', 'graphviz', 'latex', 'template')),  -- Üretim aracı
  code text not null,  -- Şekil kaynak kodu
  code_hash text not null unique,  -- sha256(kod); aynı kod bir kez render edilir
  alt_text text not null,  -- Şekli kelimelerle anlatır (Telegram altyazısı)
  png_path text,  -- Storage yolu (PNG)
  svg_path text,  -- Storage yolu (SVG)
  width_px int,  -- Genişlik (px)
  height_px int,  -- Yükseklik (px)
  bytes int,  -- Dosya boyutu
  render_status text not null default 'pending' check (render_status in ('pending', 'rendered', 'failed')),  -- Render durumu
  vision_status text not null default 'pending' check (vision_status in ('pending', 'match', 'mismatch', 'not_applicable', 'skipped')),  -- Görsel denetim durumu
  vision_report jsonb,  -- Görsel denetim raporu
  attempts smallint not null default 0,  -- Render denemesi (2 denemeden sonra eğitmen kuyruğu)
  review_status text not null default 'pending' check (review_status in ('pending', 'verified', 'rejected')),  -- Eğitmen incelemesi
  reviewed_by uuid references public.staff (id),  -- İnceleyen
  reviewed_at timestamptz,  -- İnceleme zamanı
  render_log text,  -- Render günlüğü
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.figures
comment on table public.figures is 'Soru şekilleri; yalnız review_status=''verified'' öğrenciye gider.';
comment on column public.figures.id is 'Şekil kimliği (Storage: figures/<id>.png)';
comment on column public.figures.tool is 'Üretim aracı';
comment on column public.figures.code is 'Şekil kaynak kodu';
comment on column public.figures.code_hash is 'sha256(kod); aynı kod bir kez render edilir';
comment on column public.figures.alt_text is 'Şekli kelimelerle anlatır (Telegram altyazısı)';
comment on column public.figures.png_path is 'Storage yolu (PNG)';
comment on column public.figures.svg_path is 'Storage yolu (SVG)';
comment on column public.figures.width_px is 'Genişlik (px)';
comment on column public.figures.height_px is 'Yükseklik (px)';
comment on column public.figures.bytes is 'Dosya boyutu';
comment on column public.figures.render_status is 'Render durumu';
comment on column public.figures.vision_status is 'Görsel denetim durumu';
comment on column public.figures.vision_report is 'Görsel denetim raporu';
comment on column public.figures.attempts is 'Render denemesi (2 denemeden sonra eğitmen kuyruğu)';
comment on column public.figures.review_status is 'Eğitmen incelemesi';
comment on column public.figures.reviewed_by is 'İnceleyen';
comment on column public.figures.reviewed_at is 'İnceleme zamanı';
comment on column public.figures.render_log is 'Render günlüğü';
comment on column public.figures.created_at is 'Oluşturulma zamanı';
-- end comments public.figures

create table public.questions (  -- Soru bankası; doğru şık bu tabloda YOKTUR (secure.answer_keys).
  id uuid primary key default gen_random_uuid(),  -- Soru kimliği
  curriculum_id uuid not null references public.curricula (id),  -- Müfredat sürümü
  skill_ids text[] not null check (cardinality(skill_ids) between 1 and 3),  -- Kazanımlar (1–3)
  kind text not null default 'mcq' check (kind in ('mcq', 'numeric')),  -- Soru türü
  stem text not null,  -- Soru kökü
  stem_values jsonb not null default '{}',  -- Şekil denetiminde karşılaştırılan değerler
  figure_id uuid references public.figures (id),  -- Şekil
  options jsonb,  -- Şıklar [{key, text, misconception_tag}]; doğru şık işareti yok
  difficulty numeric(3, 2) check (difficulty between 0 and 1),  -- Zorluk
  source text not null check (source in ('template', 'llm', 'instructor', 'diagnostic')),  -- Kaynak
  template_id text,  -- Şablon kimliği (source='template')
  template_params jsonb,  -- Şablon parametreleri
  content_hash text not null unique,  -- Kök + şık normalize özeti; aynı soru iki kez üretilmez
  verification jsonb not null default '{"schema":true,"sympy":"pending","render":"not_applicable","vision":"not_applicable","attempts":0}',  -- Doğrulama özeti
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'approved', 'rejected', 'retired')),  -- İnceleme durumu
  model text,  -- Üreten model (LLM)
  cost_usd numeric(10, 6) not null default 0,  -- Üretim maliyeti
  prompt_version text,  -- Prompt sürümü
  reviewed_by uuid references public.staff (id),  -- İnceleyen
  reviewed_at timestamptz,  -- İnceleme zamanı
  review_note text,  -- İnceleme notu
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.questions
comment on table public.questions is 'Soru bankası; doğru şık bu tabloda YOKTUR (secure.answer_keys).';
comment on column public.questions.id is 'Soru kimliği';
comment on column public.questions.curriculum_id is 'Müfredat sürümü';
comment on column public.questions.skill_ids is 'Kazanımlar (1–3)';
comment on column public.questions.kind is 'Soru türü';
comment on column public.questions.stem is 'Soru kökü';
comment on column public.questions.stem_values is 'Şekil denetiminde karşılaştırılan değerler';
comment on column public.questions.figure_id is 'Şekil';
comment on column public.questions.options is 'Şıklar [{key, text, misconception_tag}]; doğru şık işareti yok';
comment on column public.questions.difficulty is 'Zorluk';
comment on column public.questions.source is 'Kaynak';
comment on column public.questions.template_id is 'Şablon kimliği (source=''template'')';
comment on column public.questions.template_params is 'Şablon parametreleri';
comment on column public.questions.content_hash is 'Kök + şık normalize özeti; aynı soru iki kez üretilmez';
comment on column public.questions.verification is 'Doğrulama özeti';
comment on column public.questions.status is 'İnceleme durumu';
comment on column public.questions.model is 'Üreten model (LLM)';
comment on column public.questions.cost_usd is 'Üretim maliyeti';
comment on column public.questions.prompt_version is 'Prompt sürümü';
comment on column public.questions.reviewed_by is 'İnceleyen';
comment on column public.questions.reviewed_at is 'İnceleme zamanı';
comment on column public.questions.review_note is 'İnceleme notu';
comment on column public.questions.created_at is 'Oluşturulma zamanı';
-- end comments public.questions
create index questions_skill_ids on public.questions using gin (skill_ids);
create index questions_status_curriculum on public.questions (status, curriculum_id);

create table secure.answer_keys (  -- Cevap anahtarları; PostgREST'e kapalı, LLM rolleri göremez.
  question_id uuid primary key references public.questions (id) on delete cascade,  -- Soru
  correct_option char(1) check (correct_option in ('A', 'B', 'C', 'D')),  -- Doğru şık (mcq)
  numeric_value text,  -- Sayısal cevap (SymPy dizgesi '7/8')
  numeric_tolerance numeric default 0,  -- Sayısal tolerans
  canonical_expr text,  -- Kanonik ifade ('Rational(3,4)+Rational(1,8)')
  solution text not null,  -- Adım adım çözüm; reveal_solution döner
  sympy_status text not null check (sympy_status in ('verified', 'failed', 'not_applicable')),  -- SymPy doğrulaması
  sympy_report jsonb,  -- SymPy raporu
  written_by text not null,  -- batch_worker:tablet | batch_worker:unverified | batch_worker:template | staff:<uuid> | seed
  verified_at timestamptz,  -- Doğrulama zamanı
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments secure.answer_keys
comment on table secure.answer_keys is 'Cevap anahtarları; PostgREST''e kapalı, LLM rolleri göremez.';
comment on column secure.answer_keys.question_id is 'Soru';
comment on column secure.answer_keys.correct_option is 'Doğru şık (mcq)';
comment on column secure.answer_keys.numeric_value is 'Sayısal cevap (SymPy dizgesi ''7/8'')';
comment on column secure.answer_keys.numeric_tolerance is 'Sayısal tolerans';
comment on column secure.answer_keys.canonical_expr is 'Kanonik ifade (''Rational(3,4)+Rational(1,8)'')';
comment on column secure.answer_keys.solution is 'Adım adım çözüm; reveal_solution döner';
comment on column secure.answer_keys.sympy_status is 'SymPy doğrulaması';
comment on column secure.answer_keys.sympy_report is 'SymPy raporu';
comment on column secure.answer_keys.written_by is 'batch_worker:tablet | batch_worker:unverified | batch_worker:template | staff:<uuid> | seed';
comment on column secure.answer_keys.verified_at is 'Doğrulama zamanı';
comment on column secure.answer_keys.created_at is 'Oluşturulma zamanı';
-- end comments secure.answer_keys

create table public.question_templates (  -- Parametrik soru şablonları (sıfır LLM).
  id text primary key,  -- Şablon kimliği ('kesir-modeli-toplama')
  curriculum_id uuid not null references public.curricula (id),  -- Müfredat sürümü
  skill_id text not null,  -- Kazanım
  module_path text not null,  -- Python modül yolu ('…/kesir_modeli_toplama.py:generate')
  engine text not null,  -- Motor
  params_schema jsonb not null,  -- Parametre şeması
  enabled boolean not null default true,  -- Kapalı şablon kullanılmaz
  has_figure boolean not null default true,  -- false: şekilsiz şablon
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id)
);
-- begin comments public.question_templates
comment on table public.question_templates is 'Parametrik soru şablonları (sıfır LLM).';
comment on column public.question_templates.id is 'Şablon kimliği (''kesir-modeli-toplama'')';
comment on column public.question_templates.curriculum_id is 'Müfredat sürümü';
comment on column public.question_templates.skill_id is 'Kazanım';
comment on column public.question_templates.module_path is 'Python modül yolu (''…/kesir_modeli_toplama.py:generate'')';
comment on column public.question_templates.engine is 'Motor';
comment on column public.question_templates.params_schema is 'Parametre şeması';
comment on column public.question_templates.enabled is 'Kapalı şablon kullanılmaz';
comment on column public.question_templates.has_figure is 'false: şekilsiz şablon';
comment on column public.question_templates.created_at is 'Oluşturulma zamanı';
-- end comments public.question_templates

create table public.attempts (  -- Soru denemeleri; yalnız grade_attempt() puanlar.
  id bigint generated always as identity primary key,  -- Deneme kimliği
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,  -- Kayıt
  question_id uuid not null references public.questions (id),  -- Soru
  context text not null check (context in ('diagnostic', 'practice', 'test')),  -- Bağlam
  session_id uuid,  -- Teşhis/pratik oturumu
  chosen jsonb not null,  -- Seçim {"key":"B"} | {"value":"7/8"}
  attempt_no smallint not null default 1,  -- Kaçıncı deneme
  is_correct boolean,  -- Doğru mu (yalnız grade_attempt yazar)
  misconception_tag text references public.misconception_tags (tag),  -- Seçilen çeldiricinin yanılgısı
  graded_at timestamptz,  -- Puanlama zamanı
  response_ms int,  -- Yanıt süresi (ms)
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.attempts
comment on table public.attempts is 'Soru denemeleri; yalnız grade_attempt() puanlar.';
comment on column public.attempts.id is 'Deneme kimliği';
comment on column public.attempts.enrollment_id is 'Kayıt';
comment on column public.attempts.question_id is 'Soru';
comment on column public.attempts.context is 'Bağlam';
comment on column public.attempts.session_id is 'Teşhis/pratik oturumu';
comment on column public.attempts.chosen is 'Seçim {"key":"B"} | {"value":"7/8"}';
comment on column public.attempts.attempt_no is 'Kaçıncı deneme';
comment on column public.attempts.is_correct is 'Doğru mu (yalnız grade_attempt yazar)';
comment on column public.attempts.misconception_tag is 'Seçilen çeldiricinin yanılgısı';
comment on column public.attempts.graded_at is 'Puanlama zamanı';
comment on column public.attempts.response_ms is 'Yanıt süresi (ms)';
comment on column public.attempts.created_at is 'Oluşturulma zamanı';
-- end comments public.attempts
create index attempts_enrollment_created on public.attempts (enrollment_id, created_at desc);
create unique index attempts_once_per_session on public.attempts (session_id, question_id) where session_id is not null;

create table public.diagnostic_tests (  -- Teşhis testi sürümleri (sabit 15–20 madde).
  id uuid primary key default gen_random_uuid(),  -- Test kimliği
  curriculum_id uuid not null references public.curricula (id),  -- Müfredat sürümü
  version text not null,  -- Test sürümü ('2026.1')
  item_ids uuid[] not null check (cardinality(item_ids) between 15 and 20),  -- Madde sırası
  unique (curriculum_id, version)
);
-- begin comments public.diagnostic_tests
comment on table public.diagnostic_tests is 'Teşhis testi sürümleri (sabit 15–20 madde).';
comment on column public.diagnostic_tests.id is 'Test kimliği';
comment on column public.diagnostic_tests.curriculum_id is 'Müfredat sürümü';
comment on column public.diagnostic_tests.version is 'Test sürümü (''2026.1'')';
comment on column public.diagnostic_tests.item_ids is 'Madde sırası';
-- end comments public.diagnostic_tests

create table public.diagnostic_sessions (  -- Teşhis oturumları; yarım kalan 24 saat bekler.
  id uuid primary key default gen_random_uuid(),  -- Oturum kimliği
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,  -- Kayıt
  test_id uuid not null references public.diagnostic_tests (id),  -- Test
  chat_id bigint,  -- Sohbet
  current_index smallint not null default 0,  -- Cevaplanan madde sayısı
  status text not null default 'in_progress' check (status in ('in_progress', 'finished', 'abandoned')),  -- Oturum durumu
  started_at timestamptz not null default now(),  -- Başlangıç
  finished_at timestamptz,  -- Bitiş
  result jsonb  -- finish_diagnostic sonucu
);
-- begin comments public.diagnostic_sessions
comment on table public.diagnostic_sessions is 'Teşhis oturumları; yarım kalan 24 saat bekler.';
comment on column public.diagnostic_sessions.id is 'Oturum kimliği';
comment on column public.diagnostic_sessions.enrollment_id is 'Kayıt';
comment on column public.diagnostic_sessions.test_id is 'Test';
comment on column public.diagnostic_sessions.chat_id is 'Sohbet';
comment on column public.diagnostic_sessions.current_index is 'Cevaplanan madde sayısı';
comment on column public.diagnostic_sessions.status is 'Oturum durumu';
comment on column public.diagnostic_sessions.started_at is 'Başlangıç';
comment on column public.diagnostic_sessions.finished_at is 'Bitiş';
comment on column public.diagnostic_sessions.result is 'finish_diagnostic sonucu';
-- end comments public.diagnostic_sessions

create table public.content_pool (  -- Onaylı içerik havuzu: aynı kazanım + yanılgı + mod için açıklama bir kez üretilir.
  id uuid primary key default gen_random_uuid(),  -- Havuz kimliği
  kind text not null check (kind in ('explanation', 'hint', 'feedback_wrong', 'feedback_right')),  -- İçerik türü
  curriculum_id uuid not null references public.curricula (id),  -- Müfredat sürümü
  skill_id text not null,  -- Kazanım
  misconception_tag text references public.misconception_tags (tag),  -- Yanılgı etiketi
  mode text not null check (mode in ('socratic', 'direct')),  -- Sohbet modu
  body text not null,  -- Metin (≤ 4 satır)
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected')),  -- İnceleme durumu
  model text,  -- Üreten model
  cost_usd numeric(10, 6) not null default 0,  -- Üretim maliyeti
  hit_count int not null default 0,  -- Servis sayısı
  approved_by uuid references public.staff (id),  -- Onaylayan
  approved_at timestamptz,  -- Onay zamanı
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id)
);
-- begin comments public.content_pool
comment on table public.content_pool is 'Onaylı içerik havuzu: aynı kazanım + yanılgı + mod için açıklama bir kez üretilir.';
comment on column public.content_pool.id is 'Havuz kimliği';
comment on column public.content_pool.kind is 'İçerik türü';
comment on column public.content_pool.curriculum_id is 'Müfredat sürümü';
comment on column public.content_pool.skill_id is 'Kazanım';
comment on column public.content_pool.misconception_tag is 'Yanılgı etiketi';
comment on column public.content_pool.mode is 'Sohbet modu';
comment on column public.content_pool.body is 'Metin (≤ 4 satır)';
comment on column public.content_pool.status is 'İnceleme durumu';
comment on column public.content_pool.model is 'Üreten model';
comment on column public.content_pool.cost_usd is 'Üretim maliyeti';
comment on column public.content_pool.hit_count is 'Servis sayısı';
comment on column public.content_pool.approved_by is 'Onaylayan';
comment on column public.content_pool.approved_at is 'Onay zamanı';
comment on column public.content_pool.created_at is 'Oluşturulma zamanı';
-- end comments public.content_pool
create unique index content_pool_key on public.content_pool (curriculum_id, kind, skill_id, coalesce(misconception_tag, ''), mode) where status <> 'rejected';

create table public.generation_requests (  -- Boru hatları arası sözleşme tablosu: yalnız meta (kazanım, bant, konu, tür, puan); ham soru metni yok.
  id uuid primary key default gen_random_uuid(),  -- İstek kimliği
  kind text not null default 'pool_miss' check (kind in ('pool_miss', 'regenerate', 'exam_variant')),  -- İstek türü
  curriculum_id uuid not null references public.curricula (id),  -- Müfredat sürümü
  skill_id text not null,  -- Kazanım
  difficulty_band text not null default 'mid' check (difficulty_band in ('easy', 'mid', 'hard')),  -- Zorluk bandı
  topic text,  -- exam_variant: küme konusu (ham soru metni asla)
  question_kind text check (question_kind in ('mcq', 'numeric')),  -- Soru türü
  points numeric(5, 2),  -- exam_variant: kümenin ortalama puanı
  plan_id uuid,  -- exam_variant: onaylı plan (FK 0009'da)
  requested_by uuid references public.enrollments (id),  -- pool_miss: isteyen kayıt
  requested_by_staff uuid references public.staff (id),  -- regenerate / exam_variant: isteyen eğitmen
  served_question_id uuid references public.questions (id),  -- Karşılayan soru
  served_at timestamptz,  -- Karşılanma zamanı
  needs_generation boolean not null default false,  -- Gece üretimi gerekiyor mu
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  foreign key (curriculum_id, skill_id) references public.skills (curriculum_id, id)
);
-- begin comments public.generation_requests
comment on table public.generation_requests is 'Boru hatları arası sözleşme tablosu: yalnız meta (kazanım, bant, konu, tür, puan); ham soru metni yok.';
comment on column public.generation_requests.id is 'İstek kimliği';
comment on column public.generation_requests.kind is 'İstek türü';
comment on column public.generation_requests.curriculum_id is 'Müfredat sürümü';
comment on column public.generation_requests.skill_id is 'Kazanım';
comment on column public.generation_requests.difficulty_band is 'Zorluk bandı';
comment on column public.generation_requests.topic is 'exam_variant: küme konusu (ham soru metni asla)';
comment on column public.generation_requests.question_kind is 'Soru türü';
comment on column public.generation_requests.points is 'exam_variant: kümenin ortalama puanı';
comment on column public.generation_requests.plan_id is 'exam_variant: onaylı plan (FK 0009''da)';
comment on column public.generation_requests.requested_by is 'pool_miss: isteyen kayıt';
comment on column public.generation_requests.requested_by_staff is 'regenerate / exam_variant: isteyen eğitmen';
comment on column public.generation_requests.served_question_id is 'Karşılayan soru';
comment on column public.generation_requests.served_at is 'Karşılanma zamanı';
comment on column public.generation_requests.needs_generation is 'Gece üretimi gerekiyor mu';
comment on column public.generation_requests.created_at is 'Oluşturulma zamanı';
-- end comments public.generation_requests
create index generation_requests_open on public.generation_requests (skill_id, created_at) where needs_generation and served_question_id is null;

-- questions / syllabus_topics: her skill_ids elemanı (curriculum_id, id) ile kazanımlarda var olmalı (OGR-CURR-001)
create or replace function app.questions_check_skills() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_missing text;
begin
  select string_agg(x.sid, ', ') into v_missing
    from unnest(new.skill_ids) as x (sid)
   where not exists (select 1 from public.skills s where s.curriculum_id = new.curriculum_id and s.id = x.sid);
  if v_missing is not null then
    raise exception using errcode = 'P0001', message = format('OGR-CURR-001 kazanım bu müfredat sürümünde yok: %s', v_missing);
  end if;
  return new;
end
$$;
comment on function app.questions_check_skills() is 'skill_ids elemanlarının (curriculum_id, id) ile skills tablosunda varlığını denetler; aksi OGR-CURR-001.';
revoke all on function app.questions_check_skills() from public;

-- reviewed_by/reviewed_at/review_note/status yalnız ogrenmen.reviewer='on' iken değişir (OGR-Q-004)
create or replace function app.questions_protect_review() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if (new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
      or new.review_note is distinct from old.review_note
      or new.status is distinct from old.status)
     and coalesce(current_setting('ogrenmen.reviewer', true), '') <> 'on' then
    raise exception using errcode = 'P0001', message = 'OGR-Q-004 inceleme sütunları yalnız onay fonksiyonlarıyla değişir';
  end if;
  return new;
end
$$;
comment on function app.questions_protect_review() is 'İnceleme sütunlarını korur: yalnız approve_question, register_template_question, register_answer_key ve seed-keys.py (ogrenmen.reviewer=on).';
revoke all on function app.questions_protect_review() from public;

-- approved durumuna geçiş (ve approved ile ekleme): şekil verified/yok + anahtar verified/not_applicable (OGR-Q-001),
-- tam max_options şık ve ≥ 2 etiketsiz şık (OGR-Q-002), not_applicable anahtar için önce anahtar görülmüş olmalı (OGR-Q-003)
create or replace function app.questions_approve_guard() returns trigger
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_fig_status text;
  v_key_status text;
  v_key_ok boolean;
  v_max int;
  v_n_options int;
  v_n_null int;
begin
  if new.status <> 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') then
    return new;
  end if;
  if new.figure_id is not null then
    select f.review_status into v_fig_status from public.figures f where f.id = new.figure_id;
    if v_fig_status is distinct from 'verified' then
      raise exception using errcode = 'P0001', message = 'OGR-Q-001 şekil doğrulanmadan soru onaylanamaz';
    end if;
  end if;
  select k.sympy_status, app.answer_key_complete(new.kind, k.correct_option::text, k.numeric_value)
    into v_key_status, v_key_ok
    from secure.answer_keys k where k.question_id = new.id;
  if v_key_status is null or v_key_status not in ('verified', 'not_applicable') then
    raise exception using errcode = 'P0001', message = 'OGR-Q-001 doğrulanmış cevap anahtarı olmadan soru onaylanamaz';
  end if;
  if not v_key_ok then
    raise exception using errcode = 'P0001', message = 'OGR-Q-001 cevap anahtarı eksik (mcq: doğru şık, numeric: sayısal cevap)';
  end if;
  if new.kind = 'mcq' then
    select coalesce((st.value #>> '{}')::int, 4) into v_max from public.settings st where st.key = 'max_options';
    v_max := coalesce(v_max, 4);
    select count(*), count(*) filter (where o.opt -> 'misconception_tag' is null or jsonb_typeof(o.opt -> 'misconception_tag') = 'null')
      into v_n_options, v_n_null
      from jsonb_array_elements(coalesce(new.options, '[]'::jsonb)) as o (opt);
    if v_n_options <> v_max or v_n_null < 2 then
      raise exception using errcode = 'P0001',
        message = format('OGR-Q-002 şık kuralı: %s şık ve en az 2 etiketsiz şık gerekir (%s şık, %s etiketsiz)', v_max, v_n_options, v_n_null);
    end if;
  end if;
  if v_key_status = 'not_applicable' and coalesce(current_setting('ogrenmen.key_peeked', true), '') <> 'on' then
    raise exception using errcode = 'P0001', message = 'OGR-Q-003 anahtar görülmeden onay yok';
  end if;
  return new;
end
$$;
comment on function app.questions_approve_guard() is 'Onaylı soru kapısı: şekil, anahtar, şık kuralı ve not_applicable anahtarın görülmüş olması (OGR-Q-001/002/003).';
revoke all on function app.questions_approve_guard() from public;

-- Onaylı sorunun öğrenciye giden içeriği (kök, şıklar, şekil, tür, kazanımlar, değerler, şablon parametreleri)
-- değişmez: questions_batch_u zaten onaylı satırı kapsamaz; bu tetikleyici ikinci kemerdir (OGR-Q-006).
-- Değişiklik gerekiyorsa soru retired yapılır ve yenisi incelemeye girer; yalnız ogrenmen.reviewer='on' (seed-keys.py) geçer.
create or replace function app.questions_protect_content() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if old.status = 'approved'
     and (new.stem is distinct from old.stem
          or new.options is distinct from old.options
          or new.figure_id is distinct from old.figure_id
          or new.kind is distinct from old.kind
          or new.skill_ids is distinct from old.skill_ids
          or new.stem_values is distinct from old.stem_values
          or new.template_params is distinct from old.template_params)
     and coalesce(current_setting('ogrenmen.reviewer', true), '') <> 'on' then
    raise exception using errcode = 'P0001', message = 'OGR-Q-006 onaylı sorunun içeriği değiştirilemez';
  end if;
  return new;
end
$$;
comment on function app.questions_protect_content() is 'Onaylı sorunun kök/şık/şekil/tür/kazanım/değer/parametre sütunlarını korur (OGR-Q-006).';
revoke all on function app.questions_protect_content() from public;

-- is_correct / misconception_tag / graded_at yalnız grade_attempt içinde (ogrenmen.grader='on') yazılır
create or replace function app.attempts_protect_graded() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if coalesce(current_setting('ogrenmen.grader', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.is_correct is not null or new.misconception_tag is not null or new.graded_at is not null then
      raise exception using errcode = 'P0001', message = 'OGR-GRADE-001 puanlama yalnız grade_attempt ile';
    end if;
  elsif new.is_correct is distinct from old.is_correct
        or new.misconception_tag is distinct from old.misconception_tag
        or new.graded_at is distinct from old.graded_at then
    raise exception using errcode = 'P0001', message = 'OGR-GRADE-001 puanlama yalnız grade_attempt ile';
  end if;
  return new;
end
$$;
comment on function app.attempts_protect_graded() is 'Puanlama sütunlarını korur; yalnız grade_attempt (ogrenmen.grader=on) yazar.';
revoke all on function app.attempts_protect_graded() from public;

create trigger questions_check_skills
before insert or update of skill_ids, curriculum_id on public.questions
for each row execute function app.questions_check_skills();
create trigger a_questions_protect_review
before update of reviewed_by, reviewed_at, review_note, status on public.questions
for each row execute function app.questions_protect_review();
create trigger b_questions_approve_guard
before insert or update of status on public.questions
for each row execute function app.questions_approve_guard();
create trigger c_questions_protect_content
before update of stem, options, figure_id, kind, skill_ids, stem_values, template_params on public.questions
for each row execute function app.questions_protect_content();
create trigger attempts_protect_graded
before insert or update on public.attempts
for each row execute function app.attempts_protect_graded();
