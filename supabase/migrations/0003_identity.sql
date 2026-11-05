-- 0003_identity.sql — kimlik: profiller, öğrenciler, veli ve eğitmen bağları, ayarlar, çalışma bayrakları
-- (docs/PLAN-v2-detail.md §2.3). Her kullanıcı auth.users ile 1:1 bir profiles satırıdır; rolü profiles.role'dür.
-- Öğrenci profili açılınca app.profiles_create_student() tetikleyicisi students satırını yaratır. v1'in staff,
-- staff_students, onay, kota, Telegram ve saklama tabloları yoktur.

create table public.profiles (  -- Kullanıcı profili (auth.users 1:1); rol ve görünen ad burada.
  id uuid primary key references auth.users (id) on delete cascade,  -- auth.users.id
  role text not null check (role in ('student', 'parent', 'instructor', 'admin')),  -- Uygulama rolü
  display_name text,  -- Görünen ad (uygulamada gösterilir; LLM prompt'una gitmez)
  locale text not null default 'tr',  -- Arayüz dili
  tz text not null default 'Europe/Istanbul',  -- Saat dilimi
  avatar_path text,  -- Storage yolu (profil görseli)
  onboarded_at timestamptz,  -- İlk kurulumun bittiği zaman
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  updated_at timestamptz not null default now()  -- Son güncelleme
);
-- begin comments public.profiles
comment on table public.profiles is 'Kullanıcı profili (auth.users 1:1); rol ve görünen ad burada.';
comment on column public.profiles.id is 'auth.users.id';
comment on column public.profiles.role is 'Uygulama rolü';
comment on column public.profiles.display_name is 'Görünen ad (uygulamada gösterilir; LLM prompt''una gitmez)';
comment on column public.profiles.locale is 'Arayüz dili';
comment on column public.profiles.tz is 'Saat dilimi';
comment on column public.profiles.avatar_path is 'Storage yolu (profil görseli)';
comment on column public.profiles.onboarded_at is 'İlk kurulumun bittiği zaman';
comment on column public.profiles.created_at is 'Oluşturulma zamanı';
comment on column public.profiles.updated_at is 'Son güncelleme';
-- end comments public.profiles
create index profiles_role on public.profiles (role);
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

create table public.students (  -- Öğrenci kimliği; öğrenme verisi bu satıra (ve kayıtlarına) bağlanır.
  id uuid primary key default gen_random_uuid(),  -- İç kimlik
  public_ref text not null unique default ('s_' || app.base32_random(12)),  -- LLM defterine ve loglara giden tek kimlik (s_ + 12 base32)
  profile_id uuid unique references public.profiles (id) on delete set null,  -- Öğrencinin profili (hesabı yoksa boş)
  grade text,  -- Sınıf ('11', 'mezun', 'lisans-1')
  school text,  -- Okul
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),  -- Yaşam döngüsü durumu
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.students
comment on table public.students is 'Öğrenci kimliği; öğrenme verisi bu satıra (ve kayıtlarına) bağlanır.';
comment on column public.students.id is 'İç kimlik';
comment on column public.students.public_ref is 'LLM defterine ve loglara giden tek kimlik (s_ + 12 base32)';
comment on column public.students.profile_id is 'Öğrencinin profili (hesabı yoksa boş)';
comment on column public.students.grade is 'Sınıf (''11'', ''mezun'', ''lisans-1'')';
comment on column public.students.school is 'Okul';
comment on column public.students.status is 'Yaşam döngüsü durumu';
comment on column public.students.created_at is 'Oluşturulma zamanı';
-- end comments public.students
alter table public.students enable row level security;
alter table public.students force row level security;

create table public.guardian_links (  -- Veli ↔ öğrenci bağı; davet token'ı yalnız hash olarak saklanır.
  id uuid primary key default gen_random_uuid(),  -- Bağ kimliği
  parent_id uuid references public.profiles (id) on delete cascade,  -- Veli profili (davet kabul edilene dek boş olabilir)
  student_id uuid not null references public.students (id) on delete cascade,  -- Öğrenci
  relation text,  -- Yakınlık: anne, baba, vasi, diğer
  status text not null default 'invited' check (status in ('invited', 'active', 'revoked')),  -- Bağ durumu
  invite_token_hash text unique,  -- sha256(davet token'ı) hex; token yalnız üretimde bir kez döner
  invite_expires_at timestamptz,  -- Davetin son geçerlilik zamanı
  created_by uuid references public.profiles (id) on delete set null,  -- Daveti oluşturan profil
  accepted_at timestamptz,  -- Davetin kabul zamanı
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  unique (parent_id, student_id),
  check (status = 'invited' or parent_id is not null)
);
-- begin comments public.guardian_links
comment on table public.guardian_links is 'Veli ↔ öğrenci bağı; davet token''ı yalnız hash olarak saklanır.';
comment on column public.guardian_links.id is 'Bağ kimliği';
comment on column public.guardian_links.parent_id is 'Veli profili (davet kabul edilene dek boş olabilir)';
comment on column public.guardian_links.student_id is 'Öğrenci';
comment on column public.guardian_links.relation is 'Yakınlık: anne, baba, vasi, diğer';
comment on column public.guardian_links.status is 'Bağ durumu';
comment on column public.guardian_links.invite_token_hash is 'sha256(davet token''ı) hex; token yalnız üretimde bir kez döner';
comment on column public.guardian_links.invite_expires_at is 'Davetin son geçerlilik zamanı';
comment on column public.guardian_links.created_by is 'Daveti oluşturan profil';
comment on column public.guardian_links.accepted_at is 'Davetin kabul zamanı';
comment on column public.guardian_links.created_at is 'Oluşturulma zamanı';
-- end comments public.guardian_links
create index guardian_links_student on public.guardian_links (student_id);
create index guardian_links_parent_active on public.guardian_links (parent_id) where status = 'active';
alter table public.guardian_links enable row level security;
alter table public.guardian_links force row level security;

create table public.instructor_links (  -- Eğitmen ↔ öğrenci bağı (ders başına olabilir); v1 staff_students'ın yerine.
  id uuid primary key default gen_random_uuid(),  -- Bağ kimliği
  instructor_id uuid not null references public.profiles (id) on delete cascade,  -- Eğitmen profili
  student_id uuid not null references public.students (id) on delete cascade,  -- Öğrenci
  course_id uuid,  -- Ders (boş: tüm dersler); FK 0004_curriculum.sql'de
  role text not null default 'owner' check (role in ('owner', 'viewer')),  -- owner: yazar (RPC ile), viewer: yalnız okur
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  unique nulls not distinct (instructor_id, student_id, course_id)
);
-- begin comments public.instructor_links
comment on table public.instructor_links is 'Eğitmen ↔ öğrenci bağı (ders başına olabilir); v1 staff_students''ın yerine.';
comment on column public.instructor_links.id is 'Bağ kimliği';
comment on column public.instructor_links.instructor_id is 'Eğitmen profili';
comment on column public.instructor_links.student_id is 'Öğrenci';
comment on column public.instructor_links.course_id is 'Ders (boş: tüm dersler); FK 0004_curriculum.sql''de';
comment on column public.instructor_links.role is 'owner: yazar (RPC ile), viewer: yalnız okur';
comment on column public.instructor_links.created_at is 'Oluşturulma zamanı';
-- end comments public.instructor_links
create index instructor_links_student on public.instructor_links (student_id);
alter table public.instructor_links enable row level security;
alter table public.instructor_links force row level security;

create table public.settings (  -- Sabitler (anahtar → jsonb); web ve worker açılışta okur.
  key text primary key,  -- Ayar adı
  value jsonb not null,  -- Değer
  description text,  -- Açıklama
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  updated_at timestamptz not null default now()  -- Son güncelleme
);
-- begin comments public.settings
comment on table public.settings is 'Sabitler (anahtar → jsonb); web ve worker açılışta okur.';
comment on column public.settings.key is 'Ayar adı';
comment on column public.settings.value is 'Değer';
comment on column public.settings.description is 'Açıklama';
comment on column public.settings.created_at is 'Oluşturulma zamanı';
comment on column public.settings.updated_at is 'Son güncelleme';
-- end comments public.settings
alter table public.settings enable row level security;
alter table public.settings force row level security;

create table public.runtime_flags (  -- Çalışma bayrakları ve harcama tavanları (worker ve admin değiştirir).
  key text primary key,  -- Bayrak adı
  value jsonb not null,  -- Değer
  updated_by text,  -- Güncelleyen ('admin:<uuid>' | 'worker' | 'seed' | migration adı)
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  updated_at timestamptz not null default now()  -- Son güncelleme
);
-- begin comments public.runtime_flags
comment on table public.runtime_flags is 'Çalışma bayrakları ve harcama tavanları (worker ve admin değiştirir).';
comment on column public.runtime_flags.key is 'Bayrak adı';
comment on column public.runtime_flags.value is 'Değer';
comment on column public.runtime_flags.updated_by is 'Güncelleyen (''admin:<uuid>'' | ''worker'' | ''seed'' | migration adı)';
comment on column public.runtime_flags.created_at is 'Oluşturulma zamanı';
comment on column public.runtime_flags.updated_at is 'Son güncelleme';
-- end comments public.runtime_flags
alter table public.runtime_flags enable row level security;
alter table public.runtime_flags force row level security;

-- Öğrenci profili açılınca (ya da rol öğrenciye dönünce) students satırı; zaten varsa dokunmaz
create or replace function app.profiles_create_student() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if new.role = 'student' then
    insert into public.students (profile_id) values (new.id) on conflict (profile_id) do nothing;
  end if;
  return new;
end
$$;
comment on function app.profiles_create_student() is 'profiles.role = student olan satır için students satırı yaratır (varsa dokunmaz).';
revoke all on function app.profiles_create_student() from public;

create trigger profiles_create_student after insert or update of role on public.profiles
for each row execute function app.profiles_create_student();
create trigger touch_updated_at before update on public.profiles
for each row execute function app.touch_updated_at();
create trigger touch_updated_at before update on public.settings
for each row execute function app.touch_updated_at();
create trigger touch_updated_at before update on public.runtime_flags
for each row execute function app.touch_updated_at();

-- Ad-token hash türetimi: packages/pii/sql/name_token_hashes.sql bloğunun BİREBİR kopyası (TS/Python temizleyiciyle
-- bayt düzeyinde aynı hash'ler; scripts/check-drift.py denetler). LLM'e giden metinden görünen adların temizlenmesi
-- (packages/pii) bu hash'lerle eşleşir; v2'de zorunlu kapı değildir.
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
grant execute on function app.pii_name_token_hashes(text) to service_role;
