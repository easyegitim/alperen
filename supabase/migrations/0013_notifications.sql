-- 0013_notifications.sql — bildirimler, bildirim kuralları, web-push abonelikleri (docs/PLAN-v2.md §2 akış 3,
-- docs/PLAN-v2-detail.md §2.3). v1 proactive_messages'ın yerine: kural motoru (worker) notification_rules'u okur,
-- notifications satırı yazar; kanal (in_app, push, email) gönderimini worker yapar.

create table public.notifications (  -- Bildirimler (uygulama içi + push + e-posta); alıcı bir profildir.
  id uuid primary key default gen_random_uuid(),  -- Bildirim kimliği
  recipient_id uuid not null references public.profiles (id) on delete cascade,  -- Alıcı profil
  kind text not null,  -- Tür: 'weekly_report', 'exam_result', 'streak_break', 'document_ready', 'invite' …
  title text not null,  -- Başlık
  body text,  -- Gövde
  payload jsonb not null default '{}',  -- Bağlantı ve ayrıntı ({student_id, document_id, url, …})
  channels text[] not null default '{in_app}' check (channels <@ array['in_app', 'push', 'email']),  -- Kanallar
  read_at timestamptz,  -- Okunma zamanı
  sent_at timestamptz,  -- Gönderilme zamanı (push/e-posta)
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.notifications
comment on table public.notifications is 'Bildirimler (uygulama içi + push + e-posta); alıcı bir profildir.';
comment on column public.notifications.id is 'Bildirim kimliği';
comment on column public.notifications.recipient_id is 'Alıcı profil';
comment on column public.notifications.kind is 'Tür: ''weekly_report'', ''exam_result'', ''streak_break'', ''document_ready'', ''invite'' …';
comment on column public.notifications.title is 'Başlık';
comment on column public.notifications.body is 'Gövde';
comment on column public.notifications.payload is 'Bağlantı ve ayrıntı ({student_id, document_id, url, …})';
comment on column public.notifications.channels is 'Kanallar';
comment on column public.notifications.read_at is 'Okunma zamanı';
comment on column public.notifications.sent_at is 'Gönderilme zamanı (push/e-posta)';
comment on column public.notifications.created_at is 'Oluşturulma zamanı';
-- end comments public.notifications
create index notifications_recipient_created on public.notifications (recipient_id, created_at desc);
create index notifications_unread on public.notifications (recipient_id) where read_at is null;
alter table public.notifications enable row level security;
alter table public.notifications force row level security;

create table public.notification_rules (  -- Alıcının bildirim kuralları (tür başına aç/kapa + parametreler).
  recipient_id uuid not null references public.profiles (id) on delete cascade,  -- Alıcı profil
  kind text not null,  -- Bildirim türü
  enabled boolean not null default true,  -- Açık mı
  params jsonb not null default '{}',  -- Parametreler ({weekday, hour, threshold, channels, …})
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  primary key (recipient_id, kind)
);
-- begin comments public.notification_rules
comment on table public.notification_rules is 'Alıcının bildirim kuralları (tür başına aç/kapa + parametreler).';
comment on column public.notification_rules.recipient_id is 'Alıcı profil';
comment on column public.notification_rules.kind is 'Bildirim türü';
comment on column public.notification_rules.enabled is 'Açık mı';
comment on column public.notification_rules.params is 'Parametreler ({weekday, hour, threshold, channels, …})';
comment on column public.notification_rules.created_at is 'Oluşturulma zamanı';
-- end comments public.notification_rules
alter table public.notification_rules enable row level security;
alter table public.notification_rules force row level security;

create table public.push_subscriptions (  -- Web-push (PWA) abonelikleri; VAPID ile gönderilir.
  id uuid primary key default gen_random_uuid(),  -- Abonelik kimliği
  user_id uuid not null references public.profiles (id) on delete cascade,  -- Profil
  endpoint text not null unique,  -- Push uç noktası
  p256dh text not null,  -- İstemci genel anahtarı
  auth text not null,  -- İstemci auth sırrı
  ua text,  -- Tarayıcı / cihaz
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.push_subscriptions
comment on table public.push_subscriptions is 'Web-push (PWA) abonelikleri; VAPID ile gönderilir.';
comment on column public.push_subscriptions.id is 'Abonelik kimliği';
comment on column public.push_subscriptions.user_id is 'Profil';
comment on column public.push_subscriptions.endpoint is 'Push uç noktası';
comment on column public.push_subscriptions.p256dh is 'İstemci genel anahtarı';
comment on column public.push_subscriptions.auth is 'İstemci auth sırrı';
comment on column public.push_subscriptions.ua is 'Tarayıcı / cihaz';
comment on column public.push_subscriptions.created_at is 'Oluşturulma zamanı';
-- end comments public.push_subscriptions
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
