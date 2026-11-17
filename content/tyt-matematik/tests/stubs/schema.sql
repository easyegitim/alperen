-- M03 canlı testi için ASGARİ şema taslağı (stub). Gerçek şema M02'nin supabase/migrations/ dosyalarıdır;
-- bu dosya yalnız export-sql.py ve seed-keys.py'nin dokunduğu tabloları BLUEPRINT §3.1, §3.2, §3.4 DDL'inden
-- birebir sütunlarla kurar. Tetikleyiciler (questions_check_skills, a_questions_protect_review,
-- b_questions_approve_guard) §3.0 ve §3.4'teki kuralların sadeleştirilmiş eşdeğeridir. M02 hazır olunca
-- db-test.sh aynı seed'i gerçek migration'lara uygular.

create extension if not exists pgcrypto;
create schema if not exists secure;
create schema if not exists app;

create table public.staff (
  id          uuid primary key,
  full_name   text not null,
  role        text not null check (role in ('coordinator','instructor','observer')),
  subject     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.legal_texts (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('kvkk_aydinlatma','veli_onayi','grup_kayit','ders_kaydi','kullanim_kosullari')),
  version        text not null,
  body_md        text not null,
  effective_from date not null,
  unique (kind, version)
);

create table public.curricula (
  id        uuid primary key default gen_random_uuid(),
  code      text not null,
  authority text not null check (authority in ('MEB','ÖSYM','UNI','OTHER')),
  year      smallint not null,
  version   text not null,
  label     text not null,
  status    text not null default 'draft' check (status in ('draft','active','retired')),
  unique (code, year, version)
);
create table public.skills (
  curriculum_id uuid not null references public.curricula(id) on delete cascade,
  id            text not null,
  parent_id     text,
  name          text not null,
  description   text,
  is_leaf       boolean not null default true,
  order_no      int not null default 0,
  p_init  numeric(4,3) not null default 0.300 check (p_init  between 0.001 and 0.999),
  p_learn numeric(4,3) not null default 0.100 check (p_learn between 0.001 and 0.999),
  p_guess numeric(4,3) not null default 0.250 check (p_guess between 0.001 and 0.999),
  p_slip  numeric(4,3) not null default 0.100 check (p_slip  between 0.001 and 0.999),
  primary key (curriculum_id, id),
  foreign key (curriculum_id, parent_id) references public.skills(curriculum_id, id)
);
create table public.skill_prerequisites (
  curriculum_id uuid not null references public.curricula(id) on delete cascade,
  skill_id  text not null,
  prereq_id text not null,
  strength  numeric(3,2) not null default 1.00 check (strength between 0 and 1),
  source    text not null default 'curriculum' check (source in ('curriculum','instructor','inferred')),
  primary key (curriculum_id, skill_id, prereq_id), check (skill_id <> prereq_id),
  foreign key (curriculum_id, skill_id)  references public.skills(curriculum_id, id) on delete cascade,
  foreign key (curriculum_id, prereq_id) references public.skills(curriculum_id, id) on delete cascade
);
create table public.misconception_tags (
  tag              text primary key,
  curriculum_id    uuid not null references public.curricula(id),
  skill_id         text,
  prereq_skill_id  text,
  foreign key (curriculum_id, skill_id)        references public.skills(curriculum_id, id),
  foreign key (curriculum_id, prereq_skill_id) references public.skills(curriculum_id, id),
  text_instructor  text not null,
  text_student     text not null,
  created_at       timestamptz not null default now()
);

create table public.figures (
  id            uuid primary key default gen_random_uuid(),
  tool          text not null check (tool in ('matplotlib','svg','tikz','vega-lite','schemdraw','rdkit','graphviz','latex','template')),
  code          text not null,
  code_hash     text not null unique,
  alt_text      text not null,
  png_path      text, svg_path text,
  width_px int, height_px int, bytes int,
  render_status text not null default 'pending' check (render_status in ('pending','rendered','failed')),
  vision_status text not null default 'pending' check (vision_status in ('pending','match','mismatch','not_applicable','skipped')),
  vision_report jsonb,
  attempts      smallint not null default 0,
  review_status text not null default 'pending' check (review_status in ('pending','verified','rejected')),
  reviewed_by   uuid references public.staff(id), reviewed_at timestamptz,
  render_log    text, created_at timestamptz not null default now()
);
create table public.questions (
  id             uuid primary key default gen_random_uuid(),
  curriculum_id  uuid not null references public.curricula(id),
  skill_ids      text[] not null check (cardinality(skill_ids) between 1 and 3),
  kind           text not null default 'mcq' check (kind in ('mcq','numeric')),
  stem           text not null,
  stem_values    jsonb not null default '{}',
  figure_id      uuid references public.figures(id),
  options        jsonb,
  difficulty     numeric(3,2) check (difficulty between 0 and 1),
  source         text not null check (source in ('template','llm','instructor','diagnostic')),
  template_id    text, template_params jsonb,
  content_hash   text not null unique,
  verification   jsonb not null default '{"schema":true,"sympy":"pending","render":"not_applicable","vision":"not_applicable","attempts":0}',
  status         text not null default 'draft' check (status in ('draft','pending_review','approved','rejected','retired')),
  model text, cost_usd numeric(10,6) not null default 0, prompt_version text,
  reviewed_by    uuid references public.staff(id), reviewed_at timestamptz, review_note text,
  created_at     timestamptz not null default now()
);
create table secure.answer_keys (
  question_id    uuid primary key references public.questions(id) on delete cascade,
  correct_option char(1) check (correct_option in ('A','B','C','D')),
  numeric_value  text,
  numeric_tolerance numeric default 0,
  canonical_expr text,
  solution       text not null,
  sympy_status   text not null check (sympy_status in ('verified','failed','not_applicable')),
  sympy_report   jsonb,
  written_by     text not null,
  verified_at    timestamptz, created_at timestamptz not null default now()
);
create table public.question_templates (
  id          text primary key,
  curriculum_id uuid not null references public.curricula(id),
  skill_id    text not null,
  module_path text not null,
  engine      text not null, params_schema jsonb not null, enabled boolean not null default true,
  has_figure  boolean not null default true,
  created_at  timestamptz not null default now(),
  foreign key (curriculum_id, skill_id) references public.skills(curriculum_id, id)
);
create table public.diagnostic_tests (
  id uuid primary key default gen_random_uuid(), curriculum_id uuid not null references public.curricula(id),
  version text not null, item_ids uuid[] not null check (cardinality(item_ids) between 15 and 20), unique (curriculum_id, version)
);

-- app.questions_check_skills(): her skill_ids elemanı (curriculum_id, id) ile skills'te var, yoksa OGR-CURR-001
create function app.questions_check_skills() returns trigger language plpgsql as $$
begin
  if exists (select 1 from unnest(new.skill_ids) s(v_id)
             where not exists (select 1 from public.skills k where k.curriculum_id = new.curriculum_id and k.id = s.v_id)) then
    raise exception 'OGR-CURR-001 kazanım müfredatta yok';
  end if;
  return new;
end $$;
create trigger questions_check_skills before insert or update of skill_ids, curriculum_id on public.questions
  for each row execute function app.questions_check_skills();

-- app.questions_protect_review(): inceleme sütunları yalnız ogrenmen.reviewer=on iken değişir (OGR-Q-004)
create function app.questions_protect_review() returns trigger language plpgsql as $$
begin
  if (new.status is distinct from old.status or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at or new.review_note is distinct from old.review_note)
     and coalesce(current_setting('ogrenmen.reviewer', true), '') <> 'on' then
    raise exception 'OGR-Q-004 inceleme alanları yalnız onay kapısından';
  end if;
  return new;
end $$;
create trigger a_questions_protect_review before update of reviewed_by, reviewed_at, review_note, status on public.questions
  for each row execute function app.questions_protect_review();

-- app.questions_approve_guard(): approved için doğrulanmış şekil (ya da şekil yok) + doğrulanmış anahtar (OGR-Q-001),
-- tam 4 şık ve ≥ 2 etiketsiz şık (OGR-Q-002)
create function app.questions_approve_guard() returns trigger language plpgsql set search_path = public, secure, pg_temp as $$
begin
  if new.status = 'approved' then
    if new.figure_id is not null and not exists (select 1 from public.figures f where f.id = new.figure_id and f.review_status = 'verified') then
      raise exception 'OGR-Q-001 şekil doğrulanmamış';
    end if;
    if not exists (select 1 from secure.answer_keys k where k.question_id = new.id and k.sympy_status in ('verified','not_applicable')) then
      raise exception 'OGR-Q-001 doğrulanmış cevap anahtarı yok';
    end if;
    if new.kind = 'mcq' and (jsonb_array_length(new.options) <> 4
        or (select count(*) from jsonb_array_elements(new.options) o where o->'misconception_tag' = 'null'::jsonb) < 2) then
      raise exception 'OGR-Q-002 şık kuralı';
    end if;
  end if;
  return new;
end $$;
create trigger b_questions_approve_guard before insert or update of status on public.questions
  for each row execute function app.questions_approve_guard();
