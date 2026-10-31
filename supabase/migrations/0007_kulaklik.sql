-- 0007_kulaklik.sql — Kulaklık: sohbetler, roller, ham günlük, oturumlar, hafıza, haftalık özet, bot cevap kaydı,
-- LLM çağrıları ve harcama defteri, çalışma bayrakları, kota, yükseltme, eğitmen alarmları, proaktif mesajlar,
-- pilot ölçütleri (BLUEPRINT §3.5).

create table public.tg_chats (  -- Telegram sohbetleri (özel ve grup); kayıt bildirimi ve saklama süresi.
  chat_id bigint primary key,  -- Telegram sohbet kimliği
  kind text not null check (kind in ('private', 'group', 'supergroup')),  -- Sohbet türü
  title text,  -- Grup adı
  bot_is_admin boolean not null default false,  -- Bot yönetici mi (getChatMember)
  bot_can_pin boolean not null default false,  -- Bot sabitleyebilir mi (can_pin_messages)
  recording_notice_msg_id bigint,  -- Gönderilen/sabitlenen kayıt bildirimi mesajı
  recording_notice_legal_id uuid references public.legal_texts (id),  -- Bildirimin metin sürümü
  privacy_mode_off_verified boolean not null default false,  -- Gizlilik modu kapalı doğrulandı mı (getMe)
  retention_days smallint not null default 90,  -- Mesaj saklama süresi; bildirim metni bu değeri yazar
  recording_notice_days smallint,  -- Gruba en son gönderilen bildirimdeki gün sayısı
  group_auto_answer_min smallint not null default 0,  -- 0 = kapalı; >0: N dk eğitmen yanıtı yoksa bot yanıtlar
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.tg_chats
comment on table public.tg_chats is 'Telegram sohbetleri (özel ve grup); kayıt bildirimi ve saklama süresi.';
comment on column public.tg_chats.chat_id is 'Telegram sohbet kimliği';
comment on column public.tg_chats.kind is 'Sohbet türü';
comment on column public.tg_chats.title is 'Grup adı';
comment on column public.tg_chats.bot_is_admin is 'Bot yönetici mi (getChatMember)';
comment on column public.tg_chats.bot_can_pin is 'Bot sabitleyebilir mi (can_pin_messages)';
comment on column public.tg_chats.recording_notice_msg_id is 'Gönderilen/sabitlenen kayıt bildirimi mesajı';
comment on column public.tg_chats.recording_notice_legal_id is 'Bildirimin metin sürümü';
comment on column public.tg_chats.privacy_mode_off_verified is 'Gizlilik modu kapalı doğrulandı mı (getMe)';
comment on column public.tg_chats.retention_days is 'Mesaj saklama süresi; bildirim metni bu değeri yazar';
comment on column public.tg_chats.recording_notice_days is 'Gruba en son gönderilen bildirimdeki gün sayısı';
comment on column public.tg_chats.group_auto_answer_min is '0 = kapalı; >0: N dk eğitmen yanıtı yoksa bot yanıtlar';
comment on column public.tg_chats.created_at is 'Oluşturulma zamanı';
-- end comments public.tg_chats
-- RLS burada açılır (politikalar 0014_rls.sql'de): tg_chats üzerindeki tüm ALTER ifadeleri bu dosyada tutulur
alter table public.tg_chats enable row level security;
alter table public.tg_chats force row level security;

create table public.chat_roles (  -- Sohbet üyelerinin rolleri (yönlendirme); kişisel eşleme secure.telegram_identities'te.
  chat_id bigint references public.tg_chats (chat_id) on delete cascade,  -- Sohbet
  telegram_user_id bigint not null,  -- Telegram kullanıcı kimliği (yalnız yönlendirme)
  role text not null check (role in ('student', 'instructor', 'coordinator', 'observer', 'other', 'bot')),  -- Sohbetteki rol
  student_id uuid references public.students (id) on delete cascade,  -- Öğrenci
  staff_id uuid references public.staff (id) on delete cascade,  -- Personel
  mention_handle text,  -- Yalnız personel: '@ayse_hoca'
  joined_at timestamptz not null default now(),  -- Katılma zamanı
  primary key (chat_id, telegram_user_id)
);
-- begin comments public.chat_roles
comment on table public.chat_roles is 'Sohbet üyelerinin rolleri (yönlendirme); kişisel eşleme secure.telegram_identities''te.';
comment on column public.chat_roles.chat_id is 'Sohbet';
comment on column public.chat_roles.telegram_user_id is 'Telegram kullanıcı kimliği (yalnız yönlendirme)';
comment on column public.chat_roles.role is 'Sohbetteki rol';
comment on column public.chat_roles.student_id is 'Öğrenci';
comment on column public.chat_roles.staff_id is 'Personel';
comment on column public.chat_roles.mention_handle is 'Yalnız personel: ''@ayse_hoca''';
comment on column public.chat_roles.joined_at is 'Katılma zamanı';
-- end comments public.chat_roles

create table public.tg_updates (  -- Webhook tekrar denetimi (2 gün); yalnız dedup_update() yazar.
  update_id bigint primary key,  -- Telegram update_id
  received_at timestamptz not null default now()  -- Alınma zamanı
);
-- begin comments public.tg_updates
comment on table public.tg_updates is 'Webhook tekrar denetimi (2 gün); yalnız dedup_update() yazar.';
comment on column public.tg_updates.update_id is 'Telegram update_id';
comment on column public.tg_updates.received_at is 'Alınma zamanı';
-- end comments public.tg_updates

create table public.messages (  -- Katman 1: ham günlük; text_raw yalnız eğitmen/koordinatör görünümünden okunur.
  id bigint generated always as identity primary key,  -- Mesaj kimliği
  chat_id bigint not null references public.tg_chats (chat_id),  -- Sohbet
  telegram_message_id bigint not null,  -- Telegram mesaj kimliği
  sender_role text not null check (sender_role in ('student', 'instructor', 'coordinator', 'observer', 'bot', 'other')),  -- Gönderen rolü
  student_id uuid references public.students (id) on delete cascade,  -- Öğrenci (gönderen ya da muhatap)
  staff_id uuid references public.staff (id),  -- Personel gönderen
  reply_to_telegram_message_id bigint,  -- Yanıtlanan mesaj
  text_raw text,  -- Ham metin; bot ve boru hatları OKUYAMAZ; onaysız öğrencide boş
  text_llm text,  -- Temizlenmiş metin; LLM'e giden tek sürüm; onaysız öğrencide boş
  attachments jsonb not null default '[]',  -- Ek meta verisi
  mentions_bot boolean not null default false,  -- Bot etiketlendi mi
  is_question boolean,  -- Soru mu (girişte sezgisel, gece düzeltilir)
  answered_at timestamptz,  -- Yanıtlanma zamanı
  sent_at timestamptz not null,  -- Gönderilme zamanı
  expires_at timestamptz not null,  -- Silinme eşiği: sent_at + tg_chats.retention_days (tetikleyici)
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  unique (chat_id, telegram_message_id)
);
-- begin comments public.messages
comment on table public.messages is 'Katman 1: ham günlük; text_raw yalnız eğitmen/koordinatör görünümünden okunur.';
comment on column public.messages.id is 'Mesaj kimliği';
comment on column public.messages.chat_id is 'Sohbet';
comment on column public.messages.telegram_message_id is 'Telegram mesaj kimliği';
comment on column public.messages.sender_role is 'Gönderen rolü';
comment on column public.messages.student_id is 'Öğrenci (gönderen ya da muhatap)';
comment on column public.messages.staff_id is 'Personel gönderen';
comment on column public.messages.reply_to_telegram_message_id is 'Yanıtlanan mesaj';
comment on column public.messages.text_raw is 'Ham metin; bot ve boru hatları OKUYAMAZ; onaysız öğrencide boş';
comment on column public.messages.text_llm is 'Temizlenmiş metin; LLM''e giden tek sürüm; onaysız öğrencide boş';
comment on column public.messages.attachments is 'Ek meta verisi';
comment on column public.messages.mentions_bot is 'Bot etiketlendi mi';
comment on column public.messages.is_question is 'Soru mu (girişte sezgisel, gece düzeltilir)';
comment on column public.messages.answered_at is 'Yanıtlanma zamanı';
comment on column public.messages.sent_at is 'Gönderilme zamanı';
comment on column public.messages.expires_at is 'Silinme eşiği: sent_at + tg_chats.retention_days (tetikleyici)';
comment on column public.messages.created_at is 'Oluşturulma zamanı';
-- end comments public.messages
create index messages_student_sent on public.messages (student_id, sent_at desc);
create index messages_chat_sent on public.messages (chat_id, sent_at desc);
create index messages_expires on public.messages (expires_at);
create index messages_unanswered on public.messages (sent_at) where is_question and answered_at is null;

create table public.sessions (  -- Öğrenci × sohbet durum makinesi (KV yok).
  student_id uuid references public.students (id) on delete cascade,  -- Öğrenci
  chat_id bigint references public.tg_chats (chat_id) on delete cascade,  -- Sohbet
  state text not null default 'new' check (state in ('new', 'awaiting_consent', 'awaiting_guardian', 'diagnostic', 'idle', 'awaiting_answer', 'test')),  -- Durum
  mode text not null default 'socratic' check (mode in ('socratic', 'direct')),  -- Sohbet modu
  direct_once boolean not null default false,  -- /cevap: yalnız bekleyen soru doğrudan
  pending_question_id uuid references public.questions (id),  -- Bekleyen soru
  diagnostic_session_id uuid references public.diagnostic_sessions (id),  -- Teşhis oturumu
  hint_level smallint not null default 0,  -- İpucu düzeyi
  last_activity_at timestamptz not null default now(),  -- Son etkinlik
  quota_warned_on date,  -- Kota uyarısının verildiği gün
  primary key (student_id, chat_id)
);
-- begin comments public.sessions
comment on table public.sessions is 'Öğrenci × sohbet durum makinesi (KV yok).';
comment on column public.sessions.student_id is 'Öğrenci';
comment on column public.sessions.chat_id is 'Sohbet';
comment on column public.sessions.state is 'Durum';
comment on column public.sessions.mode is 'Sohbet modu';
comment on column public.sessions.direct_once is '/cevap: yalnız bekleyen soru doğrudan';
comment on column public.sessions.pending_question_id is 'Bekleyen soru';
comment on column public.sessions.diagnostic_session_id is 'Teşhis oturumu';
comment on column public.sessions.hint_level is 'İpucu düzeyi';
comment on column public.sessions.last_activity_at is 'Son etkinlik';
comment on column public.sessions.quota_warned_on is 'Kota uyarısının verildiği gün';
-- end comments public.sessions

create table public.memory_facts (  -- Katman 2: çıkarılmış olgular; kaynak zorunlu, isimsiz.
  id bigint generated always as identity primary key,  -- Olgu kimliği
  student_id uuid not null references public.students (id) on delete cascade,  -- Öğrenci
  kind text not null check (kind in ('promise', 'deadline', 'unanswered_question', 'morale', 'topic_asked', 'preference', 'instructor_fact', 'other')),  -- Olgu türü
  text text not null check (length(text) <= 300),  -- Olgu metni (isimsiz, ≤ 300)
  source_message_ids bigint[] not null default '{}',  -- Kaynak mesajlar
  source_lesson_claim_id uuid,  -- Kaynak ders iddiası (FK 0008'de)
  confidence numeric(3, 2) not null default 0.70 check (confidence between 0 and 1),  -- Güven
  requires_approval boolean not null default false,  -- Not/devamsızlık/puan/ödeme: onaysız kullanılmaz
  approved boolean not null default false,  -- Eğitmen onayı
  approved_by uuid references public.staff (id),  -- Onaylayan
  valid_from date not null default current_date,  -- Geçerlilik başlangıcı
  valid_until date,  -- Geçerlilik sonu
  morale_signal smallint check (morale_signal between -2 and 2),  -- Moral sinyali
  status text not null default 'active' check (status in ('active', 'merged', 'expired', 'retracted')),  -- Durum
  embedding halfvec(768),  -- Gemini gömmesi (768, yarı hassasiyet)
  tsv tsvector generated always as (to_tsvector('turkish', text)) stored,  -- Tam metin arama vektörü
  model text,  -- Çıkaran model
  cost_usd numeric(10, 6) not null default 0,  -- Maliyet
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  check (cardinality(source_message_ids) >= 1 or source_lesson_claim_id is not null)
);
-- begin comments public.memory_facts
comment on table public.memory_facts is 'Katman 2: çıkarılmış olgular; kaynak zorunlu, isimsiz.';
comment on column public.memory_facts.id is 'Olgu kimliği';
comment on column public.memory_facts.student_id is 'Öğrenci';
comment on column public.memory_facts.kind is 'Olgu türü';
comment on column public.memory_facts.text is 'Olgu metni (isimsiz, ≤ 300)';
comment on column public.memory_facts.source_message_ids is 'Kaynak mesajlar';
comment on column public.memory_facts.source_lesson_claim_id is 'Kaynak ders iddiası (FK 0008''de)';
comment on column public.memory_facts.confidence is 'Güven';
comment on column public.memory_facts.requires_approval is 'Not/devamsızlık/puan/ödeme: onaysız kullanılmaz';
comment on column public.memory_facts.approved is 'Eğitmen onayı';
comment on column public.memory_facts.approved_by is 'Onaylayan';
comment on column public.memory_facts.valid_from is 'Geçerlilik başlangıcı';
comment on column public.memory_facts.valid_until is 'Geçerlilik sonu';
comment on column public.memory_facts.morale_signal is 'Moral sinyali';
comment on column public.memory_facts.status is 'Durum';
comment on column public.memory_facts.embedding is 'Gemini gömmesi (768, yarı hassasiyet)';
comment on column public.memory_facts.tsv is 'Tam metin arama vektörü';
comment on column public.memory_facts.model is 'Çıkaran model';
comment on column public.memory_facts.cost_usd is 'Maliyet';
comment on column public.memory_facts.created_at is 'Oluşturulma zamanı';
-- end comments public.memory_facts
create index memory_facts_embedding on public.memory_facts using hnsw (embedding halfvec_cosine_ops) with (m = 16, ef_construction = 64);
create index memory_facts_tsv on public.memory_facts using gin (tsv);
create index memory_facts_student_status on public.memory_facts (student_id, status);

create table public.weekly_summaries (  -- Katman 3: haftalık özet (isimsiz, ≤ 600).
  id uuid primary key default gen_random_uuid(),  -- Özet kimliği
  student_id uuid not null references public.students (id) on delete cascade,  -- Öğrenci
  week_start date not null,  -- Hafta başı (pazartesi)
  body text not null check (length(body) <= 600),  -- Özet metni
  metrics jsonb not null,  -- Haftalık ölçüler
  facts_used bigint[] not null default '{}',  -- Kullanılan olgular
  model text,  -- Model
  cost_usd numeric(10, 6) not null default 0,  -- Maliyet
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  unique (student_id, week_start)
);
-- begin comments public.weekly_summaries
comment on table public.weekly_summaries is 'Katman 3: haftalık özet (isimsiz, ≤ 600).';
comment on column public.weekly_summaries.id is 'Özet kimliği';
comment on column public.weekly_summaries.student_id is 'Öğrenci';
comment on column public.weekly_summaries.week_start is 'Hafta başı (pazartesi)';
comment on column public.weekly_summaries.body is 'Özet metni';
comment on column public.weekly_summaries.metrics is 'Haftalık ölçüler';
comment on column public.weekly_summaries.facts_used is 'Kullanılan olgular';
comment on column public.weekly_summaries.model is 'Model';
comment on column public.weekly_summaries.cost_usd is 'Maliyet';
comment on column public.weekly_summaries.created_at is 'Oluşturulma zamanı';
-- end comments public.weekly_summaries

create table public.bot_responses (  -- Her bot cevabı (komut cevapları dahil); kayıt yoksa cevap yok.
  id bigint generated always as identity primary key,  -- Cevap kimliği
  in_message_id bigint references public.messages (id) on delete set null,  -- Gelen mesaj
  chat_id bigint not null,  -- Sohbet
  student_id uuid references public.students (id) on delete set null,  -- Öğrenci
  out_telegram_message_id bigint,  -- Gönderilen Telegram mesajı
  purpose text not null check (purpose in ('chat', 'feedback', 'hint', 'command', 'proactive', 'escalation', 'quota', 'consent', 'degraded')),  -- Amaç
  mode text check (mode in ('socratic', 'direct')),  -- Mod
  prompt_version text,  -- Prompt sürümü
  prompt_hash text,  -- Prompt özeti
  prompt_text text,  -- Temizlenmiş tam prompt; 30 gün sonra boşaltılır
  response_text text not null,  -- Gönderilen metin
  memory_fact_ids bigint[] not null default '{}',  -- Kullanılan olgular
  recent_message_ids bigint[] not null default '{}',  -- Bağlam mesajları
  pool_id uuid references public.content_pool (id),  -- Havuz isabeti
  cache_hit boolean not null default false,  -- Önbellek isabeti
  provider text,  -- Sağlayıcı
  model text,  -- Model
  provider_attempts jsonb not null default '[]',  -- Sağlayıcı denemeleri
  tokens_in int,  -- Giriş token
  tokens_out int,  -- Çıkış token
  cost_usd numeric(10, 6) not null default 0,  -- Maliyet
  latency_ms int,  -- Gecikme
  confidence numeric(3, 2),  -- Model güveni
  escalated boolean not null default false,  -- Yükseltildi mi
  schema_valid boolean,  -- Şemaya uygun muydu
  quota_state jsonb,  -- Kota durumu
  degraded_mode boolean not null default false,  -- Bozulma modunda mı
  pii_replacements int not null default 0,  -- Temizleyici değişiklik sayısı
  flagged boolean not null default false,  -- Eğitmen işareti
  flagged_by uuid references public.staff (id),  -- İşaretleyen
  flag_reason text,  -- İşaret nedeni
  flagged_at timestamptz,  -- İşaret zamanı
  review_week date,  -- Haftalık inceleme örneği haftası
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.bot_responses
comment on table public.bot_responses is 'Her bot cevabı (komut cevapları dahil); kayıt yoksa cevap yok.';
comment on column public.bot_responses.id is 'Cevap kimliği';
comment on column public.bot_responses.in_message_id is 'Gelen mesaj';
comment on column public.bot_responses.chat_id is 'Sohbet';
comment on column public.bot_responses.student_id is 'Öğrenci';
comment on column public.bot_responses.out_telegram_message_id is 'Gönderilen Telegram mesajı';
comment on column public.bot_responses.purpose is 'Amaç';
comment on column public.bot_responses.mode is 'Mod';
comment on column public.bot_responses.prompt_version is 'Prompt sürümü';
comment on column public.bot_responses.prompt_hash is 'Prompt özeti';
comment on column public.bot_responses.prompt_text is 'Temizlenmiş tam prompt; 30 gün sonra boşaltılır';
comment on column public.bot_responses.response_text is 'Gönderilen metin';
comment on column public.bot_responses.memory_fact_ids is 'Kullanılan olgular';
comment on column public.bot_responses.recent_message_ids is 'Bağlam mesajları';
comment on column public.bot_responses.pool_id is 'Havuz isabeti';
comment on column public.bot_responses.cache_hit is 'Önbellek isabeti';
comment on column public.bot_responses.provider is 'Sağlayıcı';
comment on column public.bot_responses.model is 'Model';
comment on column public.bot_responses.provider_attempts is 'Sağlayıcı denemeleri';
comment on column public.bot_responses.tokens_in is 'Giriş token';
comment on column public.bot_responses.tokens_out is 'Çıkış token';
comment on column public.bot_responses.cost_usd is 'Maliyet';
comment on column public.bot_responses.latency_ms is 'Gecikme';
comment on column public.bot_responses.confidence is 'Model güveni';
comment on column public.bot_responses.escalated is 'Yükseltildi mi';
comment on column public.bot_responses.schema_valid is 'Şemaya uygun muydu';
comment on column public.bot_responses.quota_state is 'Kota durumu';
comment on column public.bot_responses.degraded_mode is 'Bozulma modunda mı';
comment on column public.bot_responses.pii_replacements is 'Temizleyici değişiklik sayısı';
comment on column public.bot_responses.flagged is 'Eğitmen işareti';
comment on column public.bot_responses.flagged_by is 'İşaretleyen';
comment on column public.bot_responses.flag_reason is 'İşaret nedeni';
comment on column public.bot_responses.flagged_at is 'İşaret zamanı';
comment on column public.bot_responses.review_week is 'Haftalık inceleme örneği haftası';
comment on column public.bot_responses.created_at is 'Oluşturulma zamanı';
-- end comments public.bot_responses
create index bot_responses_created on public.bot_responses (created_at desc);
create index bot_responses_student_created on public.bot_responses (student_id, created_at desc);
create index bot_responses_flagged on public.bot_responses (flagged_at) where flagged;

create table public.llm_calls (  -- Her sağlayıcı denemesi (sohbet + toplu işler); yalnız public_ref taşır.
  id bigint generated always as identity primary key,  -- Çağrı kimliği
  purpose text not null check (purpose in ('chat', 'nightly_facts', 'weekly_summary', 'question_gen', 'vision_check', 'ocr', 'lesson_analysis', 'transcribe', 'diarize', 'research', 'embedding', 'query_expand', 'tts')),  -- Amaç
  provider text not null,  -- Sağlayıcı
  model text not null,  -- Model
  tokens_in int not null default 0,  -- Giriş token
  tokens_out int not null default 0,  -- Çıkış token
  audio_sec int,  -- Ses süresi (sn)
  images int,  -- Görsel sayısı
  batch boolean not null default false,  -- Toplu (Batch) çağrı mı
  status text not null check (status in ('ok', 'error', 'rate_limited', 'timeout', 'cap_blocked', 'cooldown_skip', 'bad_output')),  -- Sonuç
  error_code text,  -- Hata kodu
  latency_ms int,  -- Gecikme
  cost_usd numeric(10, 6) not null default 0,  -- Maliyet
  ref_table text,  -- İlgili tablo
  ref_id text,  -- İlgili satır
  student_ref text,  -- students.public_ref; asla uuid ya da ad
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.llm_calls
comment on table public.llm_calls is 'Her sağlayıcı denemesi (sohbet + toplu işler); yalnız public_ref taşır.';
comment on column public.llm_calls.id is 'Çağrı kimliği';
comment on column public.llm_calls.purpose is 'Amaç';
comment on column public.llm_calls.provider is 'Sağlayıcı';
comment on column public.llm_calls.model is 'Model';
comment on column public.llm_calls.tokens_in is 'Giriş token';
comment on column public.llm_calls.tokens_out is 'Çıkış token';
comment on column public.llm_calls.audio_sec is 'Ses süresi (sn)';
comment on column public.llm_calls.images is 'Görsel sayısı';
comment on column public.llm_calls.batch is 'Toplu (Batch) çağrı mı';
comment on column public.llm_calls.status is 'Sonuç';
comment on column public.llm_calls.error_code is 'Hata kodu';
comment on column public.llm_calls.latency_ms is 'Gecikme';
comment on column public.llm_calls.cost_usd is 'Maliyet';
comment on column public.llm_calls.ref_table is 'İlgili tablo';
comment on column public.llm_calls.ref_id is 'İlgili satır';
comment on column public.llm_calls.student_ref is 'students.public_ref; asla uuid ya da ad';
comment on column public.llm_calls.created_at is 'Oluşturulma zamanı';
-- end comments public.llm_calls
create index llm_calls_created on public.llm_calls (created_at desc);

create table public.spend_ledger (  -- Harcama defteri: gün × amaç × sağlayıcı; app.spend_rollup() günceller.
  day date not null,  -- Gün (Europe/Istanbul)
  purpose text not null,  -- Amaç
  provider text not null,  -- Sağlayıcı
  calls int not null default 0,  -- Çağrı sayısı
  tokens_in bigint not null default 0,  -- Giriş token toplamı
  tokens_out bigint not null default 0,  -- Çıkış token toplamı
  cost_usd numeric(12, 6) not null default 0,  -- Maliyet toplamı
  primary key (day, purpose, provider)
);
-- begin comments public.spend_ledger
comment on table public.spend_ledger is 'Harcama defteri: gün × amaç × sağlayıcı; app.spend_rollup() günceller.';
comment on column public.spend_ledger.day is 'Gün (Europe/Istanbul)';
comment on column public.spend_ledger.purpose is 'Amaç';
comment on column public.spend_ledger.provider is 'Sağlayıcı';
comment on column public.spend_ledger.calls is 'Çağrı sayısı';
comment on column public.spend_ledger.tokens_in is 'Giriş token toplamı';
comment on column public.spend_ledger.tokens_out is 'Çıkış token toplamı';
comment on column public.spend_ledger.cost_usd is 'Maliyet toplamı';
-- end comments public.spend_ledger

create table public.runtime_flags (  -- Çalışma bayrakları ve tavanlar (set_runtime_flag ile değişir).
  key text primary key,  -- Bayrak adı
  value jsonb not null,  -- Değer
  updated_at timestamptz not null default now(),  -- Son güncelleme
  updated_by text  -- Güncelleyen rol:kimlik
);
-- begin comments public.runtime_flags
comment on table public.runtime_flags is 'Çalışma bayrakları ve tavanlar (set_runtime_flag ile değişir).';
comment on column public.runtime_flags.key is 'Bayrak adı';
comment on column public.runtime_flags.value is 'Değer';
comment on column public.runtime_flags.updated_at is 'Son güncelleme';
comment on column public.runtime_flags.updated_by is 'Güncelleyen rol:kimlik';
-- end comments public.runtime_flags

create table public.provider_health (  -- Sağlayıcı sağlığı: bekleme süresi, ardışık hata, günlük birim.
  provider text primary key,  -- Sağlayıcı
  cooldown_until timestamptz,  -- Bu zamana kadar atlanır
  consecutive_errors int not null default 0,  -- Ardışık hata
  daily_units_used int not null default 0,  -- Günlük birim (Workers AI neuron)
  daily_units_day date,  -- Birimlerin günü
  last_error text,  -- Son hata
  updated_at timestamptz not null default now()  -- Son güncelleme
);
-- begin comments public.provider_health
comment on table public.provider_health is 'Sağlayıcı sağlığı: bekleme süresi, ardışık hata, günlük birim.';
comment on column public.provider_health.provider is 'Sağlayıcı';
comment on column public.provider_health.cooldown_until is 'Bu zamana kadar atlanır';
comment on column public.provider_health.consecutive_errors is 'Ardışık hata';
comment on column public.provider_health.daily_units_used is 'Günlük birim (Workers AI neuron)';
comment on column public.provider_health.daily_units_day is 'Birimlerin günü';
comment on column public.provider_health.last_error is 'Son hata';
comment on column public.provider_health.updated_at is 'Son güncelleme';
-- end comments public.provider_health

create table public.quota_limits (  -- Katman × tür günlük kota sınırları.
  tier text references public.quota_tiers (tier) on delete cascade,  -- Katman
  kind text not null check (kind in ('message', 'test', 'research', 'voice_minutes', 'figure')),  -- Kota türü
  daily_limit int not null,  -- Günlük sınır
  warn_at_remaining int not null default 5,  -- Bu kadar kala uyar
  primary key (tier, kind)
);
-- begin comments public.quota_limits
comment on table public.quota_limits is 'Katman × tür günlük kota sınırları.';
comment on column public.quota_limits.tier is 'Katman';
comment on column public.quota_limits.kind is 'Kota türü';
comment on column public.quota_limits.daily_limit is 'Günlük sınır';
comment on column public.quota_limits.warn_at_remaining is 'Bu kadar kala uyar';
-- end comments public.quota_limits

create table public.quota_usage (  -- Günlük kota kullanımı: öğrenci ya da personel satırı.
  id bigint generated always as identity primary key,  -- Satır kimliği
  student_id uuid references public.students (id) on delete cascade,  -- Öğrenci
  staff_id uuid references public.staff (id) on delete cascade,  -- Personel
  day date not null,  -- Gün (Europe/Istanbul)
  kind text not null,  -- Kota türü
  used int not null default 0,  -- Kullanılan
  warned boolean not null default false,  -- Uyarı verildi mi
  check ((student_id is null) <> (staff_id is null))
);
-- begin comments public.quota_usage
comment on table public.quota_usage is 'Günlük kota kullanımı: öğrenci ya da personel satırı.';
comment on column public.quota_usage.id is 'Satır kimliği';
comment on column public.quota_usage.student_id is 'Öğrenci';
comment on column public.quota_usage.staff_id is 'Personel';
comment on column public.quota_usage.day is 'Gün (Europe/Istanbul)';
comment on column public.quota_usage.kind is 'Kota türü';
comment on column public.quota_usage.used is 'Kullanılan';
comment on column public.quota_usage.warned is 'Uyarı verildi mi';
-- end comments public.quota_usage
create unique index quota_usage_student on public.quota_usage (student_id, day, kind) where student_id is not null;
create unique index quota_usage_staff on public.quota_usage (staff_id, day, kind) where staff_id is not null;

create table public.escalations (  -- İnsana yükseltmeler.
  id uuid primary key default gen_random_uuid(),  -- Yükseltme kimliği
  chat_id bigint not null,  -- Sohbet
  message_id bigint references public.messages (id),  -- Kaynak mesaj
  student_id uuid references public.students (id) on delete set null,  -- Öğrenci
  reason text not null check (reason in ('bot_unsure', 'human_requested', 'grade_attendance_payment', 'quota_exhausted', 'consent_missing', 'degraded', 'deletion_request')),  -- Neden
  question_text text,  -- Temizlenmiş soru metni
  target_staff_id uuid references public.staff (id),  -- Hedef eğitmen
  status text not null default 'open' check (status in ('open', 'answered', 'dismissed', 'expired')),  -- Durum
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  answered_at timestamptz,  -- Yanıtlanma zamanı
  answered_by uuid references public.staff (id)  -- Yanıtlayan
);
-- begin comments public.escalations
comment on table public.escalations is 'İnsana yükseltmeler.';
comment on column public.escalations.id is 'Yükseltme kimliği';
comment on column public.escalations.chat_id is 'Sohbet';
comment on column public.escalations.message_id is 'Kaynak mesaj';
comment on column public.escalations.student_id is 'Öğrenci';
comment on column public.escalations.reason is 'Neden';
comment on column public.escalations.question_text is 'Temizlenmiş soru metni';
comment on column public.escalations.target_staff_id is 'Hedef eğitmen';
comment on column public.escalations.status is 'Durum';
comment on column public.escalations.created_at is 'Oluşturulma zamanı';
comment on column public.escalations.answered_at is 'Yanıtlanma zamanı';
comment on column public.escalations.answered_by is 'Yanıtlayan';
-- end comments public.escalations
create index escalations_status_created on public.escalations (status, created_at);

create table public.instructor_alerts (  -- Eğitmen paneli alarmları; açık alarm tekilleştirilir (alerts_dedup).
  id uuid primary key default gen_random_uuid(),  -- Alarm kimliği
  kind text not null check (kind in ('unanswered', 'silent', 'morale', 'deadline', 'response', 'ops')),  -- Tür
  severity text not null check (severity in ('danger', 'warning', 'neutral')),  -- Önem (Acil / Dikkat / Bilgi)
  student_id uuid references public.students (id) on delete cascade,  -- Öğrenci (ops alarmlarında boş)
  staff_id uuid references public.staff (id),  -- Hedef eğitmen (boş: koordinatör)
  detail text not null check (length(detail) <= 240),  -- Tek cümle açıklama
  since timestamptz,  -- Durumun başladığı zaman
  ref jsonb not null default '{}',  -- Bağlam: {message_id} | {fact_id} | {escalation_id} | {chat_id} | {lesson_id} | {source_id}
  status text not null default 'open' check (status in ('open', 'done', 'snoozed')),  -- Durum
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  resolved_at timestamptz,  -- Kapanma zamanı
  resolved_by uuid references public.staff (id)  -- Kapatan
);
-- begin comments public.instructor_alerts
comment on table public.instructor_alerts is 'Eğitmen paneli alarmları; açık alarm tekilleştirilir (alerts_dedup).';
comment on column public.instructor_alerts.id is 'Alarm kimliği';
comment on column public.instructor_alerts.kind is 'Tür';
comment on column public.instructor_alerts.severity is 'Önem (Acil / Dikkat / Bilgi)';
comment on column public.instructor_alerts.student_id is 'Öğrenci (ops alarmlarında boş)';
comment on column public.instructor_alerts.staff_id is 'Hedef eğitmen (boş: koordinatör)';
comment on column public.instructor_alerts.detail is 'Tek cümle açıklama';
comment on column public.instructor_alerts.since is 'Durumun başladığı zaman';
comment on column public.instructor_alerts.ref is 'Bağlam: {message_id} | {fact_id} | {escalation_id} | {chat_id} | {lesson_id} | {source_id}';
comment on column public.instructor_alerts.status is 'Durum';
comment on column public.instructor_alerts.created_at is 'Oluşturulma zamanı';
comment on column public.instructor_alerts.resolved_at is 'Kapanma zamanı';
comment on column public.instructor_alerts.resolved_by is 'Kapatan';
-- end comments public.instructor_alerts
create unique index alerts_dedup on public.instructor_alerts (
  kind, coalesce(student_id::text, ''),
  coalesce(ref ->> 'message_id', ref ->> 'fact_id', ref ->> 'escalation_id', ref ->> 'chat_id', ref ->> 'lesson_id', ref ->> 'source_id',
           ref ->> 'staff_id', ''),
  coalesce(left(detail, 24), '')
) where status = 'open';

create table public.proactive_messages (  -- Şablon proaktif mesajlar (LLM yok); alıcı başına günde en çok bir.
  id uuid primary key default gen_random_uuid(),  -- Mesaj kimliği
  student_id uuid not null references public.students (id) on delete cascade,  -- Konu öğrenci
  chat_id bigint,  -- Öğrenci: özel sohbet; veli: boş (cron secure'dan çözer)
  recipient text not null default 'student' check (recipient in ('student', 'guardian')),  -- Alıcı
  template_id text not null,  -- Şablon: exam_tomorrow, deadline_soon, silent_3d, video_deleted, priority_plan_ready, research_ready
  params jsonb not null default '{}',  -- Şablon parametreleri
  scheduled_for timestamptz not null,  -- Planlanan zaman
  sent_at timestamptz,  -- Gönderilme zamanı
  telegram_message_id bigint,  -- Telegram mesajı
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'skipped', 'failed'))  -- Durum
);
-- begin comments public.proactive_messages
comment on table public.proactive_messages is 'Şablon proaktif mesajlar (LLM yok); alıcı başına günde en çok bir.';
comment on column public.proactive_messages.id is 'Mesaj kimliği';
comment on column public.proactive_messages.student_id is 'Konu öğrenci';
comment on column public.proactive_messages.chat_id is 'Öğrenci: özel sohbet; veli: boş (cron secure''dan çözer)';
comment on column public.proactive_messages.recipient is 'Alıcı';
comment on column public.proactive_messages.template_id is 'Şablon: exam_tomorrow, deadline_soon, silent_3d, video_deleted, priority_plan_ready, research_ready';
comment on column public.proactive_messages.params is 'Şablon parametreleri';
comment on column public.proactive_messages.scheduled_for is 'Planlanan zaman';
comment on column public.proactive_messages.sent_at is 'Gönderilme zamanı';
comment on column public.proactive_messages.telegram_message_id is 'Telegram mesajı';
comment on column public.proactive_messages.status is 'Durum';
-- end comments public.proactive_messages
create unique index proactive_one_per_day on public.proactive_messages (student_id, recipient, ((scheduled_for at time zone 'Europe/Istanbul')::date));

create table public.pilot_metrics (  -- Pilot kapı ölçütleri (haftalık; yalnız sayılar, öğrenci kimliği yok).
  metric text not null check (metric in ('diagnostic_agreement', 'citation_relevance', 'priority_uplift', 'cost_per_student', 'distractor_unused_share', 'flagged_response_share', 'degraded_share', 'question_accuracy')),  -- Ölçüt
  period date not null,  -- Haftanın pazartesi'si
  value numeric(8, 4),  -- Değer; boş = yeterli veri yok
  detail jsonb not null default '{}',  -- {n, numerator, denominator, by_skill}
  computed_at timestamptz not null default now(),  -- Hesaplanma zamanı
  primary key (metric, period)
);
-- begin comments public.pilot_metrics
comment on table public.pilot_metrics is 'Pilot kapı ölçütleri (haftalık; yalnız sayılar, öğrenci kimliği yok).';
comment on column public.pilot_metrics.metric is 'Ölçüt';
comment on column public.pilot_metrics.period is 'Haftanın pazartesi''si';
comment on column public.pilot_metrics.value is 'Değer; boş = yeterli veri yok';
comment on column public.pilot_metrics.detail is '{n, numerator, denominator, by_skill}';
comment on column public.pilot_metrics.computed_at is 'Hesaplanma zamanı';
-- end comments public.pilot_metrics

-- messages.expires_at = sent_at + tg_chats.retention_days (gün)
create or replace function app.messages_expires_at() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_days int;
begin
  select c.retention_days into v_days from public.tg_chats c where c.chat_id = new.chat_id;
  new.expires_at := new.sent_at + make_interval(days => coalesce(v_days, 90));
  return new;
end
$$;
comment on function app.messages_expires_at() is 'messages.expires_at sütununu sohbetin saklama süresinden hesaplar.';
revoke all on function app.messages_expires_at() from public;

create trigger messages_expires_at before insert on public.messages
for each row execute function app.messages_expires_at();

-- llm_calls → spend_ledger (gün Europe/Istanbul × amaç × sağlayıcı)
create or replace function app.spend_rollup() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  insert into public.spend_ledger as sl (day, purpose, provider, calls, tokens_in, tokens_out, cost_usd)
  values ((new.created_at at time zone 'Europe/Istanbul')::date, new.purpose, new.provider, 1,
          coalesce(new.tokens_in, 0), coalesce(new.tokens_out, 0), coalesce(new.cost_usd, 0))
  on conflict (day, purpose, provider) do update
     set calls = sl.calls + 1,
         tokens_in = sl.tokens_in + excluded.tokens_in,
         tokens_out = sl.tokens_out + excluded.tokens_out,
         cost_usd = sl.cost_usd + excluded.cost_usd;
  return new;
end
$$;
comment on function app.spend_rollup() is 'Her llm_calls satırını spend_ledger toplamlarına ekler.';
revoke all on function app.spend_rollup() from public;

create trigger spend_rollup after insert on public.llm_calls
for each row execute function app.spend_rollup();
