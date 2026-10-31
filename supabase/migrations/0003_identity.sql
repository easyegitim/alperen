-- 0003_identity.sql — kimlik, onay, personel, ayarlar, saklama politikaları, kota katmanları (BLUEPRINT §3.1)
-- Kişisel veri (ad, doğum yılı, Telegram kimliği, veli iletişimi) yalnız secure şemasındadır; public.students
-- PII taşımaz. Ad eşlemesi düz adla değil ad-token sha256 hash'leriyle yapılır (app.pii_name_token_hashes).

create table public.quota_tiers (  -- Hizmet seviyeleri: 7/24 yapay zekâ (ai_only) ile insan danışmanlı (ai_plus_advisor) ayrı seviyelerdir (plan §05).
  tier text primary key,  -- Katman anahtarı: standard | pilot | staff
  label text not null,  -- Panelde görünen ad
  service_level text not null default 'ai_only' check (service_level in ('ai_only', 'ai_plus_advisor')),  -- Hizmet seviyesi
  advisor_sla_hours int  -- ai_plus_advisor: eğitmen yanıt hedefi (saat); ai_only: boş
);
-- begin comments public.quota_tiers
comment on table public.quota_tiers is 'Hizmet seviyeleri: 7/24 yapay zekâ (ai_only) ile insan danışmanlı (ai_plus_advisor) ayrı seviyelerdir (plan §05).';
comment on column public.quota_tiers.tier is 'Katman anahtarı: standard | pilot | staff';
comment on column public.quota_tiers.label is 'Panelde görünen ad';
comment on column public.quota_tiers.service_level is 'Hizmet seviyesi';
comment on column public.quota_tiers.advisor_sla_hours is 'ai_plus_advisor: eğitmen yanıt hedefi (saat); ai_only: boş';
-- end comments public.quota_tiers

create table public.students (  -- Kalıcı öğrenci kimliği; kişisel veri taşımaz (ad ve Telegram kimliği secure şemasında).
  id uuid primary key default gen_random_uuid(),  -- İç kimlik; API'ye, prompt'a ve loglara gitmez
  public_ref text not null unique default ('s_' || app.base32_random(12)),  -- Dış dünyaya giden tek kimlik (s_ + 12 base32)
  is_minor boolean not null default true,  -- Reşit değil mi; bilinmiyorsa true (set_birth_year ve recompute_is_minor yazar)
  tz text not null default 'Europe/Istanbul',  -- Saat dilimi
  tier text not null default 'standard' references public.quota_tiers (tier),  -- Kota katmanı
  status text not null default 'pending_consent' check (status in ('pending_consent', 'active', 'paused', 'deleted')),  -- Yaşam döngüsü durumu; consent_ok ile hesaplanır
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  deleted_at timestamptz  -- Silme talebi zamanı; 30 gün sonra anonimleştirme (students.anonymize)
);
-- begin comments public.students
comment on table public.students is 'Kalıcı öğrenci kimliği; kişisel veri taşımaz (ad ve Telegram kimliği secure şemasında).';
comment on column public.students.id is 'İç kimlik; API''ye, prompt''a ve loglara gitmez';
comment on column public.students.public_ref is 'Dış dünyaya giden tek kimlik (s_ + 12 base32)';
comment on column public.students.is_minor is 'Reşit değil mi; bilinmiyorsa true (set_birth_year ve recompute_is_minor yazar)';
comment on column public.students.tz is 'Saat dilimi';
comment on column public.students.tier is 'Kota katmanı';
comment on column public.students.status is 'Yaşam döngüsü durumu; consent_ok ile hesaplanır';
comment on column public.students.created_at is 'Oluşturulma zamanı';
comment on column public.students.deleted_at is 'Silme talebi zamanı; 30 gün sonra anonimleştirme (students.anonymize)';
-- end comments public.students

create table public.staff (  -- Panel kullanıcıları (eğitmen, koordinatör, gözlemci); kimlik auth.users ile aynıdır.
  id uuid primary key references auth.users (id) on delete cascade,  -- auth.users.id
  full_name text not null,  -- Eğitmen adı (panelde tam yazılır; bot ve boru hatları bu sütunu okuyamaz)
  role text not null check (role in ('coordinator', 'instructor', 'observer')),  -- Uygulama rolü
  subject text,  -- Branş: 'matematik'
  active boolean not null default true,  -- Pasif personel hiçbir yetki taşımaz
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.staff
comment on table public.staff is 'Panel kullanıcıları (eğitmen, koordinatör, gözlemci); kimlik auth.users ile aynıdır.';
comment on column public.staff.id is 'auth.users.id';
comment on column public.staff.full_name is 'Eğitmen adı (panelde tam yazılır; bot ve boru hatları bu sütunu okuyamaz)';
comment on column public.staff.role is 'Uygulama rolü';
comment on column public.staff.subject is 'Branş: ''matematik''';
comment on column public.staff.active is 'Pasif personel hiçbir yetki taşımaz';
comment on column public.staff.created_at is 'Oluşturulma zamanı';
-- end comments public.staff

create table public.staff_students (  -- Branş eğitmeni ve gözlemci yalnız atanan öğrencileri görür.
  staff_id uuid references public.staff (id) on delete cascade,  -- Personel
  student_id uuid references public.students (id) on delete cascade,  -- Atanan öğrenci
  primary key (staff_id, student_id)
);
-- begin comments public.staff_students
comment on table public.staff_students is 'Branş eğitmeni ve gözlemci yalnız atanan öğrencileri görür.';
comment on column public.staff_students.staff_id is 'Personel';
comment on column public.staff_students.student_id is 'Atanan öğrenci';
-- end comments public.staff_students

create table secure.student_pii (  -- Öğrencinin kişisel verileri; yalnız SECURITY DEFINER fonksiyonlar erişir.
  student_id uuid primary key references public.students (id) on delete cascade,  -- Öğrenci
  display_name text,  -- Ad soyad ('Elif Kaya'); yalnız resolve_telegram/update_student_pii yazar
  birth_year smallint check (birth_year between 1950 and 2030),  -- Doğum yılı (beyan)
  school text,  -- Okul
  grade text,  -- Sınıf
  guardian_name text,  -- Veli adı
  guardian_relation text,  -- Veli yakınlığı: anne, baba, vasi
  guardian_contact text,  -- Veli iletişimi; yalnız onay süreci
  name_token_hashes text[] not null default '{}',  -- Ad-token sha256 hash'leri (scrub için); tetikleyici üretir
  updated_at timestamptz not null default now()  -- Son güncelleme
);
-- begin comments secure.student_pii
comment on table secure.student_pii is 'Öğrencinin kişisel verileri; yalnız SECURITY DEFINER fonksiyonlar erişir.';
comment on column secure.student_pii.student_id is 'Öğrenci';
comment on column secure.student_pii.display_name is 'Ad soyad (''Elif Kaya''); yalnız resolve_telegram/update_student_pii yazar';
comment on column secure.student_pii.birth_year is 'Doğum yılı (beyan)';
comment on column secure.student_pii.school is 'Okul';
comment on column secure.student_pii.grade is 'Sınıf';
comment on column secure.student_pii.guardian_name is 'Veli adı';
comment on column secure.student_pii.guardian_relation is 'Veli yakınlığı: anne, baba, vasi';
comment on column secure.student_pii.guardian_contact is 'Veli iletişimi; yalnız onay süreci';
comment on column secure.student_pii.name_token_hashes is 'Ad-token sha256 hash''leri (scrub için); tetikleyici üretir';
comment on column secure.student_pii.updated_at is 'Son güncelleme';
-- end comments secure.student_pii

create table secure.telegram_identities (  -- Telegram kullanıcı kimliği ↔ öğrenci ya da personel eşlemesi.
  telegram_user_id bigint primary key,  -- Telegram kullanıcı kimliği (PII)
  student_id uuid unique references public.students (id) on delete cascade,  -- Öğrenci (personel değilse)
  staff_id uuid unique references public.staff (id) on delete cascade,  -- Personel (öğrenci değilse)
  username text,  -- Telegram kullanıcı adı (PII)
  mention_handle text,  -- Yalnız personel: '@ayse_hoca' (chat_roles.mention_handle'a kopyalanır)
  linked_at timestamptz not null default now(),  -- Bağlanma zamanı
  check ((student_id is null) <> (staff_id is null))
);
-- begin comments secure.telegram_identities
comment on table secure.telegram_identities is 'Telegram kullanıcı kimliği ↔ öğrenci ya da personel eşlemesi.';
comment on column secure.telegram_identities.telegram_user_id is 'Telegram kullanıcı kimliği (PII)';
comment on column secure.telegram_identities.student_id is 'Öğrenci (personel değilse)';
comment on column secure.telegram_identities.staff_id is 'Personel (öğrenci değilse)';
comment on column secure.telegram_identities.username is 'Telegram kullanıcı adı (PII)';
comment on column secure.telegram_identities.mention_handle is 'Yalnız personel: ''@ayse_hoca'' (chat_roles.mention_handle''a kopyalanır)';
comment on column secure.telegram_identities.linked_at is 'Bağlanma zamanı';
-- end comments secure.telegram_identities

create table secure.staff_codes (  -- Eğitmen Telegram bağlama kodu (/egitmen KOD); mint_staff_code üretir, redeem_staff_code tüketir.
  id uuid primary key default gen_random_uuid(),  -- Kod satırı
  staff_id uuid not null references public.staff (id) on delete cascade,  -- Bağlanacak personel
  code_hash text not null unique,  -- sha256(kod) hex; kod yalnız üretim anında bir kez döner
  created_by uuid not null,  -- Kodu üreten koordinatör (staff.id)
  expires_at timestamptz not null,  -- Son geçerlilik (+72 saat)
  used_at timestamptz,  -- Kullanılma zamanı
  used_by_telegram_user_id bigint  -- Kodu kullanan Telegram hesabı
);
-- begin comments secure.staff_codes
comment on table secure.staff_codes is 'Eğitmen Telegram bağlama kodu (/egitmen KOD); mint_staff_code üretir, redeem_staff_code tüketir.';
comment on column secure.staff_codes.id is 'Kod satırı';
comment on column secure.staff_codes.staff_id is 'Bağlanacak personel';
comment on column secure.staff_codes.code_hash is 'sha256(kod) hex; kod yalnız üretim anında bir kez döner';
comment on column secure.staff_codes.created_by is 'Kodu üreten koordinatör (staff.id)';
comment on column secure.staff_codes.expires_at is 'Son geçerlilik (+72 saat)';
comment on column secure.staff_codes.used_at is 'Kullanılma zamanı';
comment on column secure.staff_codes.used_by_telegram_user_id is 'Kodu kullanan Telegram hesabı';
-- end comments secure.staff_codes

create table secure.auth_links (  -- İleride öğrenci PWA'sı: auth.users ↔ öğrenci.
  auth_user_id uuid primary key,  -- auth.users.id
  student_id uuid not null unique references public.students (id) on delete cascade  -- Öğrenci
);
-- begin comments secure.auth_links
comment on table secure.auth_links is 'İleride öğrenci PWA''sı: auth.users ↔ öğrenci.';
comment on column secure.auth_links.auth_user_id is 'auth.users.id';
comment on column secure.auth_links.student_id is 'Öğrenci';
-- end comments secure.auth_links

create table secure.guardian_codes (  -- Veli onayı tek kullanımlık kod/token.
  id uuid primary key default gen_random_uuid(),  -- Kod satırı
  student_id uuid not null references public.students (id) on delete cascade,  -- Onayın konusu olan öğrenci
  code_hash text not null unique,  -- sha256(kod) hex; kod yalnız üretim anında bir kez döner
  channel text not null check (channel in ('telegram', 'web')),  -- telegram: /veli KOD; web: panel /onay?token=
  created_by uuid not null,  -- Kodu üreten personel (staff.id)
  expires_at timestamptz not null,  -- Son geçerlilik (+72 saat)
  used_at timestamptz,  -- Kullanılma zamanı
  used_by_telegram_user_id bigint,  -- Veli Telegram hesabı (özel sohbet kimliği)
  attempts smallint not null default 0,  -- Başarısız deneme sayısı (web token)
  locked_until timestamptz  -- 5 başarısız denemede 1 saat kilit
);
-- begin comments secure.guardian_codes
comment on table secure.guardian_codes is 'Veli onayı tek kullanımlık kod/token.';
comment on column secure.guardian_codes.id is 'Kod satırı';
comment on column secure.guardian_codes.student_id is 'Onayın konusu olan öğrenci';
comment on column secure.guardian_codes.code_hash is 'sha256(kod) hex; kod yalnız üretim anında bir kez döner';
comment on column secure.guardian_codes.channel is 'telegram: /veli KOD; web: panel /onay?token=';
comment on column secure.guardian_codes.created_by is 'Kodu üreten personel (staff.id)';
comment on column secure.guardian_codes.expires_at is 'Son geçerlilik (+72 saat)';
comment on column secure.guardian_codes.used_at is 'Kullanılma zamanı';
comment on column secure.guardian_codes.used_by_telegram_user_id is 'Veli Telegram hesabı (özel sohbet kimliği)';
comment on column secure.guardian_codes.attempts is 'Başarısız deneme sayısı (web token)';
comment on column secure.guardian_codes.locked_until is '5 başarısız denemede 1 saat kilit';
-- end comments secure.guardian_codes

create table public.legal_texts (  -- Hukuk metinleri (docs/hukuk); yer tutucular gerçek gün sayısına çözülmüş hâliyle.
  id uuid primary key default gen_random_uuid(),  -- Metin sürümü kimliği
  kind text not null check (kind in ('kvkk_aydinlatma', 'veli_onayi', 'grup_kayit', 'ders_kaydi', 'kullanim_kosullari')),  -- Metin türü
  version text not null,  -- Belge başlığındaki doc_version ('2026-10-v1')
  body_md text not null,  -- Markdown gövde (ogrenmen:cocuk-dili işaretleri korunur)
  effective_from date not null,  -- Yürürlük tarihi
  unique (kind, version)
);
-- begin comments public.legal_texts
comment on table public.legal_texts is 'Hukuk metinleri (docs/hukuk); yer tutucular gerçek gün sayısına çözülmüş hâliyle.';
comment on column public.legal_texts.id is 'Metin sürümü kimliği';
comment on column public.legal_texts.kind is 'Metin türü';
comment on column public.legal_texts.version is 'Belge başlığındaki doc_version (''2026-10-v1'')';
comment on column public.legal_texts.body_md is 'Markdown gövde (ogrenmen:cocuk-dili işaretleri korunur)';
comment on column public.legal_texts.effective_from is 'Yürürlük tarihi';
-- end comments public.legal_texts

create table public.consents (  -- Onay kayıtları; bot yalnız öğrencinin kendi beyanını, veli onayını yalnız kod/token ya da personel yazar.
  id uuid primary key default gen_random_uuid(),  -- Onay kimliği
  student_id uuid not null references public.students (id) on delete cascade,  -- Öğrenci
  kind text not null check (kind in ('kvkk_aydinlatma', 'veli_onayi', 'grup_kayit', 'ders_kaydi')),  -- Onay türü
  legal_text_id uuid not null references public.legal_texts (id),  -- Onaylanan metin sürümü
  status text not null default 'given' check (status in ('given', 'revoked')),  -- Verildi ya da geri alındı
  method text not null check (method in ('telegram_button', 'guardian_code', 'web_token', 'paper', 'panel')),  -- Onay yöntemi
  given_by text not null,  -- 'student' | 'guardian' | 'staff:<uuid>'
  evidence jsonb not null default '{}',  -- Kanıt: {chat_id, message_id, telegram_user_id} | {code_id} | {form_no}
  given_at timestamptz not null default now(),  -- Onay zamanı
  revoked_at timestamptz,  -- Geri alma zamanı
  created_at timestamptz not null default now()  -- Satırın oluşturulma zamanı
);
-- begin comments public.consents
comment on table public.consents is 'Onay kayıtları; bot yalnız öğrencinin kendi beyanını, veli onayını yalnız kod/token ya da personel yazar.';
comment on column public.consents.id is 'Onay kimliği';
comment on column public.consents.student_id is 'Öğrenci';
comment on column public.consents.kind is 'Onay türü';
comment on column public.consents.legal_text_id is 'Onaylanan metin sürümü';
comment on column public.consents.status is 'Verildi ya da geri alındı';
comment on column public.consents.method is 'Onay yöntemi';
comment on column public.consents.given_by is '''student'' | ''guardian'' | ''staff:<uuid>''';
comment on column public.consents.evidence is 'Kanıt: {chat_id, message_id, telegram_user_id} | {code_id} | {form_no}';
comment on column public.consents.given_at is 'Onay zamanı';
comment on column public.consents.revoked_at is 'Geri alma zamanı';
comment on column public.consents.created_at is 'Satırın oluşturulma zamanı';
-- end comments public.consents
create unique index consents_one_active on public.consents (student_id, kind) where status = 'given';

create table public.settings (  -- Sabitler (anahtar → jsonb); Worker ve boru hatları açılışta okur.
  key text primary key,  -- Ayar adı
  value jsonb not null,  -- Değer
  description text,  -- Açıklama
  updated_at timestamptz not null default now()  -- Son güncelleme
);
-- begin comments public.settings
comment on table public.settings is 'Sabitler (anahtar → jsonb); Worker ve boru hatları açılışta okur.';
comment on column public.settings.key is 'Ayar adı';
comment on column public.settings.value is 'Değer';
comment on column public.settings.description is 'Açıklama';
comment on column public.settings.updated_at is 'Son güncelleme';
-- end comments public.settings

create table public.retention_policies (  -- Saklama: silme işi ve kullanıcıya gösterilen süre metni tek kaynaktan.
  id text primary key,  -- Politika kimliği ('messages.hard_delete')
  schema_name text not null default 'public',  -- Hedef şema
  table_name text not null,  -- Hedef tablo
  ts_column text not null,  -- Eşik zaman sütunu
  days int not null check (days >= 0),  -- Saklama süresi (gün)
  mode text not null check (mode in ('delete', 'null_columns', 'expire', 'custom')),  -- delete | null_columns | expire | custom
  handler text,  -- mode='custom': app.retention_* fonksiyon adı (imza (p_days int) returns int); diğer modlarda boş
  columns text[],  -- null_columns için boşaltılacak sütunlar
  condition_sql text,  -- Ek koşul ('flagged = false')
  user_facing_text text,  -- Kullanıcıya gösterilen metin; '{days}' yer tutucusu
  enabled boolean not null default true,  -- Kapalı politika çalışmaz
  check ((mode = 'custom') = (handler is not null))
);
-- begin comments public.retention_policies
comment on table public.retention_policies is 'Saklama: silme işi ve kullanıcıya gösterilen süre metni tek kaynaktan.';
comment on column public.retention_policies.id is 'Politika kimliği (''messages.hard_delete'')';
comment on column public.retention_policies.schema_name is 'Hedef şema';
comment on column public.retention_policies.table_name is 'Hedef tablo';
comment on column public.retention_policies.ts_column is 'Eşik zaman sütunu';
comment on column public.retention_policies.days is 'Saklama süresi (gün)';
comment on column public.retention_policies.mode is 'delete | null_columns | expire | custom';
comment on column public.retention_policies.handler is 'mode=''custom'': app.retention_* fonksiyon adı (imza (p_days int) returns int); diğer modlarda boş';
comment on column public.retention_policies.columns is 'null_columns için boşaltılacak sütunlar';
comment on column public.retention_policies.condition_sql is 'Ek koşul (''flagged = false'')';
comment on column public.retention_policies.user_facing_text is 'Kullanıcıya gösterilen metin; ''{days}'' yer tutucusu';
comment on column public.retention_policies.enabled is 'Kapalı politika çalışmaz';
-- end comments public.retention_policies

-- Ad-token hash türetimi: packages/pii/sql/name_token_hashes.sql bloğunun BİREBİR kopyası (TS/Python temizleyiciyle
-- bayt düzeyinde aynı hash'ler). Blueprint'teki düz lower() kullanılmaz: lower('Işıl') temizleyicinin katlamasından farklıdır.
-- begin pii
create or replace function app.pii_name_token_hashes(p_name text) returns text[]
language sql immutable strict parallel safe
set search_path = pg_catalog
as $$
  select coalesce(array_agg(t.h order by t.first_ord), '{}'::text[])
    from (
      select encode(sha256(convert_to(
               translate(b.base,
                         'ABCÇDEFGĞHIİıJKLMNOÖPQRSŞTUÜVWXYZÂÎÛ',
                         'abcçdefgğhiiijklmnoöpqrsştuüvwxyzâîû'),
               'UTF8')), 'hex') as h,
             min(b.ord) as first_ord
        from (
          select regexp_replace(m.tok[1], '[''’].*$', '') as base, m.ord
            from regexp_matches(
                   normalize(p_name, NFC),
                   '(?<![A-ZÇĞİÖŞÜÂÎÛa-zçğıöşüâîû\[])[A-ZÇĞİÖŞÜÂÎÛa-zçğıöşüâîû]+(?:[''’][a-zçğıöşüâîû]+)?',
                   'g') with ordinality as m(tok, ord)
        ) b
       where char_length(b.base) >= 3
       group by 1
    ) t
$$;
-- end pii
comment on function app.pii_name_token_hashes(text) is 'Ad metninden 3+ karakterli tokenların Türkçe katlanmış sha256 hex listesi (packages/pii ile aynı).';
revoke all on function app.pii_name_token_hashes(text) from public;

-- secure.student_pii: display_name / guardian_name değişince ad-token hash'leri yeniden üretilir
create or replace function app.refresh_name_hashes() returns trigger
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
begin
  new.name_token_hashes := app.pii_name_token_hashes(concat_ws(' ', new.display_name, new.guardian_name));
  return new;
end
$$;
comment on function app.refresh_name_hashes() is 'secure.student_pii ad alanlarından name_token_hashes üretir (app.pii_name_token_hashes).';
revoke all on function app.refresh_name_hashes() from public;

create trigger refresh_name_hashes
before insert or update of display_name, guardian_name on secure.student_pii
for each row execute function app.refresh_name_hashes();
