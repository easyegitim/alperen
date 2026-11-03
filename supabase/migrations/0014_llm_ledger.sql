-- 0014_llm_ledger.sql — LLM çağrı defteri (+önbellek sütunları), harcama defteri, prompt sürümleri, değerlendirme
-- vakaları ve koşuları, denetim izi (docs/PLAN-v2-detail.md §2.1, §2.3, §3). Her Anthropic çağrısı packages/llm
-- geçidinden llm_calls'a yazılır (rota, model, effort, token ve önbellek token'ları, maliyet, durum, prompt sürümü).

create table public.llm_calls (  -- Her LLM/gömme çağrısı (senkron, akış, Batch); öğrenciyi yalnız public_ref ile taşır.
  id bigint generated always as identity primary key,  -- Çağrı kimliği
  route text,  -- Geçit rotası ('coach.chat', 'diagnosis.solution', 'exam.page-class' …)
  purpose text not null,  -- Harcama amacı (spend_ledger anahtarı; genelde rotanın ilk parçası)
  provider text not null default 'anthropic',  -- Sağlayıcı: anthropic | voyage | groq
  model text not null,  -- Model ('claude-opus-5-5' …)
  effort text check (effort in ('low', 'medium', 'high', 'xhigh', 'max')),  -- output_config.effort
  prompt_version text,  -- prompt_versions.version
  tokens_in int not null default 0,  -- Giriş token (önbelleksiz)
  tokens_out int not null default 0,  -- Çıkış token
  cache_read_tokens int not null default 0,  -- Önbellekten okunan giriş token (cache_read_input_tokens)
  cache_write_tokens int not null default 0,  -- Önbelleğe yazılan giriş token (cache_creation_input_tokens)
  audio_sec int,  -- Ses süresi (sn; STT)
  images int,  -- Görsel sayısı
  batch boolean not null default false,  -- Message Batches çağrısı mı
  status text not null check (status in ('ok', 'error', 'rate_limited', 'overloaded', 'timeout', 'cap_blocked', 'bad_output', 'refusal', 'max_tokens')),  -- Sonuç
  error_code text,  -- Hata kodu / stop_details.category
  latency_ms int,  -- Gecikme
  cost_usd numeric(10, 6) not null default 0,  -- Maliyet (packages/llm pricing.ts)
  ref_table text,  -- İlgili tablo
  ref_id text,  -- İlgili satır
  student_ref text,  -- students.public_ref; asla uuid ya da ad
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.llm_calls
comment on table public.llm_calls is 'Her LLM/gömme çağrısı (senkron, akış, Batch); öğrenciyi yalnız public_ref ile taşır.';
comment on column public.llm_calls.id is 'Çağrı kimliği';
comment on column public.llm_calls.route is 'Geçit rotası (''coach.chat'', ''diagnosis.solution'', ''exam.page-class'' …)';
comment on column public.llm_calls.purpose is 'Harcama amacı (spend_ledger anahtarı; genelde rotanın ilk parçası)';
comment on column public.llm_calls.provider is 'Sağlayıcı: anthropic | voyage | groq';
comment on column public.llm_calls.model is 'Model (''claude-opus-5-5'' …)';
comment on column public.llm_calls.effort is 'output_config.effort';
comment on column public.llm_calls.prompt_version is 'prompt_versions.version';
comment on column public.llm_calls.tokens_in is 'Giriş token (önbelleksiz)';
comment on column public.llm_calls.tokens_out is 'Çıkış token';
comment on column public.llm_calls.cache_read_tokens is 'Önbellekten okunan giriş token (cache_read_input_tokens)';
comment on column public.llm_calls.cache_write_tokens is 'Önbelleğe yazılan giriş token (cache_creation_input_tokens)';
comment on column public.llm_calls.audio_sec is 'Ses süresi (sn; STT)';
comment on column public.llm_calls.images is 'Görsel sayısı';
comment on column public.llm_calls.batch is 'Message Batches çağrısı mı';
comment on column public.llm_calls.status is 'Sonuç';
comment on column public.llm_calls.error_code is 'Hata kodu / stop_details.category';
comment on column public.llm_calls.latency_ms is 'Gecikme';
comment on column public.llm_calls.cost_usd is 'Maliyet (packages/llm pricing.ts)';
comment on column public.llm_calls.ref_table is 'İlgili tablo';
comment on column public.llm_calls.ref_id is 'İlgili satır';
comment on column public.llm_calls.student_ref is 'students.public_ref; asla uuid ya da ad';
comment on column public.llm_calls.created_at is 'Oluşturulma zamanı';
-- end comments public.llm_calls
-- Sayaçlar ve maliyet negatif olamaz (negatif kayıt harcama tavanlarını sıfırlayabilirdi)
alter table public.llm_calls add constraint llm_calls_nonnegative
check (tokens_in >= 0 and tokens_out >= 0 and cache_read_tokens >= 0 and cache_write_tokens >= 0 and cost_usd >= 0
       and coalesce(audio_sec, 0) >= 0 and coalesce(images, 0) >= 0 and coalesce(latency_ms, 0) >= 0);
create index llm_calls_created on public.llm_calls (created_at desc);
create index llm_calls_route_created on public.llm_calls (route, created_at desc);
create index llm_calls_student_ref on public.llm_calls (student_ref, created_at desc);
alter table public.llm_calls enable row level security;
alter table public.llm_calls force row level security;

alter table public.conversation_messages add constraint conversation_messages_llm_call_fk
foreign key (llm_call_id) references public.llm_calls (id) on delete set null;

create table public.spend_ledger (  -- Harcama defteri: gün × amaç × sağlayıcı (worker llm_calls'tan toplar).
  day date not null,  -- Gün (Europe/Istanbul)
  purpose text not null,  -- Amaç
  provider text not null,  -- Sağlayıcı
  calls int not null default 0,  -- Çağrı sayısı
  tokens_in bigint not null default 0,  -- Giriş token toplamı
  tokens_out bigint not null default 0,  -- Çıkış token toplamı
  cache_read_tokens bigint not null default 0,  -- Önbellekten okunan token toplamı
  cache_write_tokens bigint not null default 0,  -- Önbelleğe yazılan token toplamı
  cost_usd numeric(12, 6) not null default 0,  -- Maliyet toplamı
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  updated_at timestamptz not null default now(),  -- Son toplama
  primary key (day, purpose, provider)
);
-- begin comments public.spend_ledger
comment on table public.spend_ledger is 'Harcama defteri: gün × amaç × sağlayıcı (worker llm_calls''tan toplar).';
comment on column public.spend_ledger.day is 'Gün (Europe/Istanbul)';
comment on column public.spend_ledger.purpose is 'Amaç';
comment on column public.spend_ledger.provider is 'Sağlayıcı';
comment on column public.spend_ledger.calls is 'Çağrı sayısı';
comment on column public.spend_ledger.tokens_in is 'Giriş token toplamı';
comment on column public.spend_ledger.tokens_out is 'Çıkış token toplamı';
comment on column public.spend_ledger.cache_read_tokens is 'Önbellekten okunan token toplamı';
comment on column public.spend_ledger.cache_write_tokens is 'Önbelleğe yazılan token toplamı';
comment on column public.spend_ledger.cost_usd is 'Maliyet toplamı';
comment on column public.spend_ledger.created_at is 'Oluşturulma zamanı';
comment on column public.spend_ledger.updated_at is 'Son toplama';
-- end comments public.spend_ledger
alter table public.spend_ledger add constraint spend_ledger_nonnegative
check (calls >= 0 and tokens_in >= 0 and tokens_out >= 0 and cache_read_tokens >= 0 and cache_write_tokens >= 0 and cost_usd >= 0);
alter table public.spend_ledger enable row level security;
alter table public.spend_ledger force row level security;

create table public.prompt_versions (  -- Prompt sürümleri (packages/prompts/<rota>/<sürüm>.md front-matter'ından).
  id uuid primary key default gen_random_uuid(),  -- Satır kimliği
  route text not null,  -- Geçit rotası
  version text not null,  -- Sürüm ('v3')
  system_text text not null,  -- Sistem metni
  schema_name text,  -- Yapılandırılmış çıktı şeması (packages/contracts)
  model text not null,  -- Model
  effort text check (effort in ('low', 'medium', 'high', 'xhigh', 'max')),  -- Effort
  active boolean not null default false,  -- Rotanın etkin sürümü mü
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  unique (route, version)
);
-- begin comments public.prompt_versions
comment on table public.prompt_versions is 'Prompt sürümleri (packages/prompts/<rota>/<sürüm>.md front-matter''ından).';
comment on column public.prompt_versions.id is 'Satır kimliği';
comment on column public.prompt_versions.route is 'Geçit rotası';
comment on column public.prompt_versions.version is 'Sürüm (''v3'')';
comment on column public.prompt_versions.system_text is 'Sistem metni';
comment on column public.prompt_versions.schema_name is 'Yapılandırılmış çıktı şeması (packages/contracts)';
comment on column public.prompt_versions.model is 'Model';
comment on column public.prompt_versions.effort is 'Effort';
comment on column public.prompt_versions.active is 'Rotanın etkin sürümü mü';
comment on column public.prompt_versions.created_at is 'Oluşturulma zamanı';
-- end comments public.prompt_versions
create unique index prompt_versions_one_active on public.prompt_versions (route) where active;
alter table public.prompt_versions enable row level security;
alter table public.prompt_versions force row level security;

create table public.eval_cases (  -- Değerlendirme vakaları (rota başına girdi + beklenen).
  id uuid primary key default gen_random_uuid(),  -- Vaka kimliği
  route text not null,  -- Geçit rotası
  input jsonb not null,  -- Girdi
  expected jsonb,  -- Beklenen çıktı / ölçüt
  upload_ids uuid[] not null default '{}',  -- Girdi yüklemeleri
  notes text,  -- Not
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.eval_cases
comment on table public.eval_cases is 'Değerlendirme vakaları (rota başına girdi + beklenen).';
comment on column public.eval_cases.id is 'Vaka kimliği';
comment on column public.eval_cases.route is 'Geçit rotası';
comment on column public.eval_cases.input is 'Girdi';
comment on column public.eval_cases.expected is 'Beklenen çıktı / ölçüt';
comment on column public.eval_cases.upload_ids is 'Girdi yüklemeleri';
comment on column public.eval_cases.notes is 'Not';
comment on column public.eval_cases.created_at is 'Oluşturulma zamanı';
-- end comments public.eval_cases
create index eval_cases_route on public.eval_cases (route);
alter table public.eval_cases enable row level security;
alter table public.eval_cases force row level security;

create table public.eval_runs (  -- Değerlendirme koşuları (rota × prompt sürümü).
  id uuid primary key default gen_random_uuid(),  -- Koşu kimliği
  route text not null,  -- Geçit rotası
  prompt_version text not null,  -- Koşulan prompt sürümü
  started_at timestamptz not null default now(),  -- Başlangıç
  finished_at timestamptz,  -- Bitiş
  scores jsonb,  -- Vaka başına ve toplam skorlar
  summary text,  -- Özet
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.eval_runs
comment on table public.eval_runs is 'Değerlendirme koşuları (rota × prompt sürümü).';
comment on column public.eval_runs.id is 'Koşu kimliği';
comment on column public.eval_runs.route is 'Geçit rotası';
comment on column public.eval_runs.prompt_version is 'Koşulan prompt sürümü';
comment on column public.eval_runs.started_at is 'Başlangıç';
comment on column public.eval_runs.finished_at is 'Bitiş';
comment on column public.eval_runs.scores is 'Vaka başına ve toplam skorlar';
comment on column public.eval_runs.summary is 'Özet';
comment on column public.eval_runs.created_at is 'Oluşturulma zamanı';
-- end comments public.eval_runs
create index eval_runs_route on public.eval_runs (route, started_at desc);
alter table public.eval_runs enable row level security;
alter table public.eval_runs force row level security;

create table audit.events (  -- Yalnız eklemeli denetim izi (bağ değişiklikleri, onaylar, iş kuyruğu düşmeleri).
  id bigint generated always as identity primary key,  -- Olay kimliği
  actor_role text not null default app.jwt_role(),  -- Rol: authenticated | service_role | postgres
  actor_id text,  -- auth.uid() ya da 'worker'
  action text not null,  -- 'INSERT' | 'UPDATE' | 'DELETE' | 'RPC:<ad>' | 'job.enqueue_skipped'
  table_name text not null,  -- Etkilenen tablo (ya da nesne)
  row_id text,  -- Etkilenen satır
  diff jsonb,  -- Değişen alanlar / ayrıntı
  created_at timestamptz not null default now()  -- Olay zamanı
);
-- begin comments audit.events
comment on table audit.events is 'Yalnız eklemeli denetim izi (bağ değişiklikleri, onaylar, iş kuyruğu düşmeleri).';
comment on column audit.events.id is 'Olay kimliği';
comment on column audit.events.actor_role is 'Rol: authenticated | service_role | postgres';
comment on column audit.events.actor_id is 'auth.uid() ya da ''worker''';
comment on column audit.events.action is '''INSERT'' | ''UPDATE'' | ''DELETE'' | ''RPC:<ad>'' | ''job.enqueue_skipped''';
comment on column audit.events.table_name is 'Etkilenen tablo (ya da nesne)';
comment on column audit.events.row_id is 'Etkilenen satır';
comment on column audit.events.diff is 'Değişen alanlar / ayrıntı';
comment on column audit.events.created_at is 'Olay zamanı';
-- end comments audit.events
create index audit_events_created on audit.events (created_at desc);
create index audit_events_row on audit.events (row_id, action);
alter table audit.events enable row level security;
alter table audit.events force row level security;

-- Denetim olayı yazar (RPC'ler ve enqueue_job kullanır)
create or replace function app.audit_event(p_action text, p_table text, p_row_id text, p_diff jsonb) returns void
language plpgsql
security definer
set search_path = public, app, audit, extensions, pg_temp
as $$
begin
  insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
  values (app.jwt_role(), coalesce(auth.uid()::text, app.jwt_role()), p_action, p_table, p_row_id, p_diff);
end
$$;
comment on function app.audit_event(text, text, text, jsonb) is 'audit.events''e bir olay yazar (aktör: auth.uid() ya da JWT rolü).';
revoke all on function app.audit_event(text, text, text, jsonb) from public;

-- Satır tetikleyicisi: INSERT/DELETE tam satır, UPDATE yalnız değişen alanlar
create or replace function app.audit_row() returns trigger
language plpgsql
security definer
set search_path = public, app, audit, extensions, pg_temp
as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_diff jsonb;
  v_row jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
    v_diff := v_row;
  elsif tg_op = 'INSERT' then
    v_row := to_jsonb(new);
    v_diff := v_row;
  else
    v_new := to_jsonb(new);
    v_old := to_jsonb(old);
    v_row := v_new;
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', v_old -> n.key, 'new', n.value)), '{}'::jsonb)
      into v_diff
      from jsonb_each(v_new) as n (key, value)
     where n.value is distinct from v_old -> n.key;
  end if;
  v_diff := v_diff - 'invite_token_hash' - 'content' - 'embedding';
  perform app.audit_event(tg_op, tg_table_schema || '.' || tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'student_id'), v_diff);
  return null;
end
$$;
comment on function app.audit_row() is 'AFTER satır tetikleyicisi: audit.events''e işlem, tablo, satır ve fark yazar (token hash ve gömme hariç).';
revoke all on function app.audit_row() from public;

create trigger audit_row after insert or update or delete on public.guardian_links
for each row execute function app.audit_row();
create trigger audit_row after insert or update or delete on public.instructor_links
for each row execute function app.audit_row();
create trigger audit_row after update of role on public.profiles
for each row execute function app.audit_row();
create trigger audit_row after update of status on public.curriculum_proposals
for each row execute function app.audit_row();
create trigger audit_row after update of status on public.curricula
for each row execute function app.audit_row();
create trigger audit_row after update of status on public.questions
for each row execute function app.audit_row();
create trigger audit_row after update of status on public.misconceptions
for each row execute function app.audit_row();
create trigger audit_row after update of status on public.lesson_claims
for each row execute function app.audit_row();
