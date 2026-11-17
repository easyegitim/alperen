-- 0006_questions.sql — şekiller, soru bankası, cevap anahtarı yalıtımı, şablonlar, denemeler, içerik havuzu, soru
-- tarzları ve tarz kapsaması (docs/PLAN-v2-detail.md §2.1, §2.3). Doğru şık yalnız secure.answer_keys'tedir;
-- öğrenciye giden görünüm şıkların yanılgı etiketlerini göstermez (RLS/görünüm B2).

create table public.figures (  -- Soru şekilleri; yalnız review_status='verified' öğrenciye gider.
  id uuid primary key default gen_random_uuid(),  -- Şekil kimliği (Storage: figures/<id>.png)
  tool text not null check (tool in ('matplotlib', 'svg', 'tikz', 'vega-lite', 'schemdraw', 'rdkit', 'graphviz', 'latex', 'template')),  -- Üretim aracı
  code text not null,  -- Şekil kaynak kodu
  code_hash text not null unique,  -- sha256(kod); aynı kod bir kez render edilir
  alt_text text not null,  -- Şekli kelimelerle anlatır (erişilebilirlik)
  png_path text,  -- Storage yolu (PNG)
  svg_path text,  -- Storage yolu (SVG)
  width_px int,  -- Genişlik (px)
  height_px int,  -- Yükseklik (px)
  bytes int,  -- Dosya boyutu
  render_status text not null default 'pending' check (render_status in ('pending', 'rendered', 'failed')),  -- Render durumu
  vision_status text not null default 'pending' check (vision_status in ('pending', 'match', 'mismatch', 'not_applicable', 'skipped')),  -- Görsel denetim durumu
  vision_report jsonb,  -- Görsel denetim raporu
  attempts smallint not null default 0,  -- Render denemesi
  review_status text not null default 'pending' check (review_status in ('pending', 'verified', 'rejected')),  -- İnceleme
  reviewed_by uuid references public.profiles (id) on delete set null,  -- İnceleyen
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
comment on column public.figures.alt_text is 'Şekli kelimelerle anlatır (erişilebilirlik)';
comment on column public.figures.png_path is 'Storage yolu (PNG)';
comment on column public.figures.svg_path is 'Storage yolu (SVG)';
comment on column public.figures.width_px is 'Genişlik (px)';
comment on column public.figures.height_px is 'Yükseklik (px)';
comment on column public.figures.bytes is 'Dosya boyutu';
comment on column public.figures.render_status is 'Render durumu';
comment on column public.figures.vision_status is 'Görsel denetim durumu';
comment on column public.figures.vision_report is 'Görsel denetim raporu';
comment on column public.figures.attempts is 'Render denemesi';
comment on column public.figures.review_status is 'İnceleme';
comment on column public.figures.reviewed_by is 'İnceleyen';
comment on column public.figures.reviewed_at is 'İnceleme zamanı';
comment on column public.figures.render_log is 'Render günlüğü';
comment on column public.figures.created_at is 'Oluşturulma zamanı';
-- end comments public.figures
alter table public.figures enable row level security;
alter table public.figures force row level security;

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
  source text not null check (source in ('template', 'llm', 'instructor', 'diagnostic', 'exam')),  -- Kaynak
  template_id text,  -- Şablon kimliği (source='template')
  template_params jsonb,  -- Şablon parametreleri
  content_hash text not null unique,  -- Kök + şık normalize özeti; aynı soru iki kez üretilmez
  verification jsonb not null default '{"schema":true,"sympy":"pending","render":"not_applicable","vision":"not_applicable","attempts":0}',  -- Doğrulama özeti
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'approved', 'rejected', 'retired')),  -- İnceleme durumu
  model text,  -- Üreten model (LLM)
  cost_usd numeric(10, 6) not null default 0,  -- Üretim maliyeti
  prompt_version text,  -- Prompt sürümü
  reviewed_by uuid references public.profiles (id) on delete set null,  -- İnceleyen
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
alter table public.questions enable row level security;
alter table public.questions force row level security;

create table secure.answer_keys (  -- Soru bankası cevap anahtarları; PostgREST'e kapalı, yalnız SECURITY DEFINER puanlama okur.
  question_id uuid primary key references public.questions (id) on delete cascade,  -- Soru
  correct_option char(1) check (correct_option in ('A', 'B', 'C', 'D', 'E')),  -- Doğru şık (mcq)
  numeric_value text,  -- Sayısal cevap (SymPy dizgesi '7/8')
  numeric_tolerance numeric default 0,  -- Sayısal tolerans
  canonical_expr text,  -- Kanonik ifade ('Rational(3,4)+Rational(1,8)')
  solution text not null,  -- Adım adım çözüm
  sympy_status text not null check (sympy_status in ('verified', 'failed', 'not_applicable')),  -- SymPy doğrulaması
  sympy_report jsonb,  -- SymPy raporu
  written_by text not null,  -- 'seed' | 'worker:<iş>' | 'instructor:<uuid>'
  verified_at timestamptz,  -- Doğrulama zamanı
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments secure.answer_keys
comment on table secure.answer_keys is 'Soru bankası cevap anahtarları; PostgREST''e kapalı, yalnız SECURITY DEFINER puanlama okur.';
comment on column secure.answer_keys.question_id is 'Soru';
comment on column secure.answer_keys.correct_option is 'Doğru şık (mcq)';
comment on column secure.answer_keys.numeric_value is 'Sayısal cevap (SymPy dizgesi ''7/8'')';
comment on column secure.answer_keys.numeric_tolerance is 'Sayısal tolerans';
comment on column secure.answer_keys.canonical_expr is 'Kanonik ifade (''Rational(3,4)+Rational(1,8)'')';
comment on column secure.answer_keys.solution is 'Adım adım çözüm';
comment on column secure.answer_keys.sympy_status is 'SymPy doğrulaması';
comment on column secure.answer_keys.sympy_report is 'SymPy raporu';
comment on column secure.answer_keys.written_by is '''seed'' | ''worker:<iş>'' | ''instructor:<uuid>''';
comment on column secure.answer_keys.verified_at is 'Doğrulama zamanı';
comment on column secure.answer_keys.created_at is 'Oluşturulma zamanı';
-- end comments secure.answer_keys
alter table secure.answer_keys enable row level security;
alter table secure.answer_keys force row level security;

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
alter table public.question_templates enable row level security;
alter table public.question_templates force row level security;

create table public.attempts (  -- Soru bankası denemeleri; puanlamayı SECURITY DEFINER fonksiyon yapar.
  id bigint generated always as identity primary key,  -- Deneme kimliği
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,  -- Kayıt
  question_id uuid not null references public.questions (id),  -- Soru
  context text not null check (context in ('diagnostic', 'practice', 'test')),  -- Bağlam
  session_id uuid,  -- Pratik/deneme oturumu
  chosen jsonb not null,  -- Seçim {"key":"B"} | {"value":"7/8"}
  attempt_no smallint not null default 1,  -- Kaçıncı deneme
  is_correct boolean,  -- Doğru mu (puanlama yazar)
  misconception_tag text references public.misconception_tags (tag),  -- Seçilen çeldiricinin yanılgısı
  graded_at timestamptz,  -- Puanlama zamanı
  response_ms int,  -- Yanıt süresi (ms)
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.attempts
comment on table public.attempts is 'Soru bankası denemeleri; puanlamayı SECURITY DEFINER fonksiyon yapar.';
comment on column public.attempts.id is 'Deneme kimliği';
comment on column public.attempts.enrollment_id is 'Kayıt';
comment on column public.attempts.question_id is 'Soru';
comment on column public.attempts.context is 'Bağlam';
comment on column public.attempts.session_id is 'Pratik/deneme oturumu';
comment on column public.attempts.chosen is 'Seçim {"key":"B"} | {"value":"7/8"}';
comment on column public.attempts.attempt_no is 'Kaçıncı deneme';
comment on column public.attempts.is_correct is 'Doğru mu (puanlama yazar)';
comment on column public.attempts.misconception_tag is 'Seçilen çeldiricinin yanılgısı';
comment on column public.attempts.graded_at is 'Puanlama zamanı';
comment on column public.attempts.response_ms is 'Yanıt süresi (ms)';
comment on column public.attempts.created_at is 'Oluşturulma zamanı';
-- end comments public.attempts
create index attempts_enrollment_created on public.attempts (enrollment_id, created_at desc);
create unique index attempts_once_per_session on public.attempts (session_id, question_id) where session_id is not null;
alter table public.attempts enable row level security;
alter table public.attempts force row level security;

create table public.content_pool (  -- Onaylı içerik havuzu: aynı kazanım + yanılgı + mod için açıklama bir kez üretilir.
  id uuid primary key default gen_random_uuid(),  -- Havuz kimliği
  kind text not null check (kind in ('explanation', 'hint', 'feedback_wrong', 'feedback_right')),  -- İçerik türü
  curriculum_id uuid not null references public.curricula (id),  -- Müfredat sürümü
  skill_id text not null,  -- Kazanım
  misconception_tag text references public.misconception_tags (tag),  -- Yanılgı etiketi
  mode text not null check (mode in ('hint', 'explain', 'solve')),  -- Koç modu
  body text not null,  -- Metin
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected')),  -- İnceleme durumu
  model text,  -- Üreten model
  cost_usd numeric(10, 6) not null default 0,  -- Üretim maliyeti
  hit_count int not null default 0,  -- Servis sayısı
  approved_by uuid references public.profiles (id) on delete set null,  -- Onaylayan
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
comment on column public.content_pool.mode is 'Koç modu';
comment on column public.content_pool.body is 'Metin';
comment on column public.content_pool.status is 'İnceleme durumu';
comment on column public.content_pool.model is 'Üreten model';
comment on column public.content_pool.cost_usd is 'Üretim maliyeti';
comment on column public.content_pool.hit_count is 'Servis sayısı';
comment on column public.content_pool.approved_by is 'Onaylayan';
comment on column public.content_pool.approved_at is 'Onay zamanı';
comment on column public.content_pool.created_at is 'Oluşturulma zamanı';
-- end comments public.content_pool
create unique index content_pool_key on public.content_pool (curriculum_id, kind, skill_id, coalesce(misconception_tag, ''), mode) where status <> 'rejected';
alter table public.content_pool enable row level security;
alter table public.content_pool force row level security;

create table public.question_styles (  -- Soru tarzı kütüphanesi: çıkmış sınav maddelerinden kümelenen ya da eğitmenin tanımladığı tarzlar.
  id uuid primary key default gen_random_uuid(),  -- Tarz kimliği
  course_id uuid not null references public.courses (id) on delete cascade,  -- Ders
  curriculum_id uuid references public.curricula (id),  -- Müfredat sürümü
  code text not null,  -- Tarz kodu ('tyt.mat.problem.yas-tablo')
  name text not null,  -- Tarz adı
  description text,  -- Açıklama
  format text,  -- Biçim (tablo, grafik, sözel problem …)
  trick text,  -- Tuzak / püf noktası
  difficulty_band text check (difficulty_band in ('easy', 'mid', 'hard')),  -- Zorluk bandı
  skill_ids text[] not null default '{}',  -- Kazanımlar
  years_hit smallint[] not null default '{}',  -- Sorulduğu yıllar
  years_total smallint not null default 0,  -- Arşivdeki yıl sayısı
  recency_score numeric(5, 4),  -- Güncellik skoru (0–1)
  frequency_score numeric(5, 4),  -- Sıklık skoru (0–1)
  exemplar_item_ids uuid[] not null default '{}',  -- Örnek exam_items (öğrenciye gizli)
  embedding halfvec(1024),  -- Tarz merkezinin gömmesi (Voyage, 1024)
  source text not null default 'extracted' check (source in ('extracted', 'instructor')),  -- Köken
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),  -- Yaşam döngüsü
  created_by uuid references public.profiles (id) on delete set null,  -- Oluşturan (çıkarımda boş)
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  unique (course_id, code)
);
-- begin comments public.question_styles
comment on table public.question_styles is 'Soru tarzı kütüphanesi: çıkmış sınav maddelerinden kümelenen ya da eğitmenin tanımladığı tarzlar.';
comment on column public.question_styles.id is 'Tarz kimliği';
comment on column public.question_styles.course_id is 'Ders';
comment on column public.question_styles.curriculum_id is 'Müfredat sürümü';
comment on column public.question_styles.code is 'Tarz kodu (''tyt.mat.problem.yas-tablo'')';
comment on column public.question_styles.name is 'Tarz adı';
comment on column public.question_styles.description is 'Açıklama';
comment on column public.question_styles.format is 'Biçim (tablo, grafik, sözel problem …)';
comment on column public.question_styles.trick is 'Tuzak / püf noktası';
comment on column public.question_styles.difficulty_band is 'Zorluk bandı';
comment on column public.question_styles.skill_ids is 'Kazanımlar';
comment on column public.question_styles.years_hit is 'Sorulduğu yıllar';
comment on column public.question_styles.years_total is 'Arşivdeki yıl sayısı';
comment on column public.question_styles.recency_score is 'Güncellik skoru (0–1)';
comment on column public.question_styles.frequency_score is 'Sıklık skoru (0–1)';
comment on column public.question_styles.exemplar_item_ids is 'Örnek exam_items (öğrenciye gizli)';
comment on column public.question_styles.embedding is 'Tarz merkezinin gömmesi (Voyage, 1024)';
comment on column public.question_styles.source is 'Köken';
comment on column public.question_styles.status is 'Yaşam döngüsü';
comment on column public.question_styles.created_by is 'Oluşturan (çıkarımda boş)';
comment on column public.question_styles.created_at is 'Oluşturulma zamanı';
-- end comments public.question_styles
create index question_styles_embedding on public.question_styles using hnsw (embedding halfvec_cosine_ops);
alter table public.question_styles enable row level security;
alter table public.question_styles force row level security;

create table public.style_coverage (  -- Öğrencinin tarz kapsaması (görülen, çözülen, doğru).
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,  -- Kayıt
  style_id uuid not null references public.question_styles (id) on delete cascade,  -- Tarz
  seen_count int not null default 0,  -- Görülen soru sayısı
  solved_count int not null default 0,  -- Çözülen (cevaplanan) soru sayısı
  correct_count int not null default 0,  -- Doğru sayısı
  last_seen_at timestamptz,  -- Son görülme
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  primary key (enrollment_id, style_id),
  check (correct_count <= solved_count and solved_count <= seen_count)
);
-- begin comments public.style_coverage
comment on table public.style_coverage is 'Öğrencinin tarz kapsaması (görülen, çözülen, doğru).';
comment on column public.style_coverage.enrollment_id is 'Kayıt';
comment on column public.style_coverage.style_id is 'Tarz';
comment on column public.style_coverage.seen_count is 'Görülen soru sayısı';
comment on column public.style_coverage.solved_count is 'Çözülen (cevaplanan) soru sayısı';
comment on column public.style_coverage.correct_count is 'Doğru sayısı';
comment on column public.style_coverage.last_seen_at is 'Son görülme';
comment on column public.style_coverage.created_at is 'Oluşturulma zamanı';
-- end comments public.style_coverage
alter table public.style_coverage enable row level security;
alter table public.style_coverage force row level security;

create trigger check_skill_ids
before insert or update of skill_ids, curriculum_id on public.questions
for each row execute function app.check_skill_ids();
create trigger check_skill_ids
before insert or update of skill_ids, curriculum_id on public.question_styles
for each row execute function app.check_skill_ids();
