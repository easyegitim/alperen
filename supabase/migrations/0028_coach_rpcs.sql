-- 0028_coach_rpcs.sql — koç sohbetinin üretim yolu (P1-fix; docs/PLAN-v2.md §2 Akış 1, §3.3, §6; PLAN-v2-detail §2.4
-- "web yalnız kullanıcının JWT'si"). apps/web artık doğrudan Postgres bağlantısı açmaz ve service_role kullanmaz: koç
-- turunun her okuması ve yazımı kullanıcının JWT'siyle (authenticated) çağrılan bu SECURITY DEFINER RPC'lerden geçer.
--
-- Kimlik ve kapsam: her RPC sohbeti app.coach_conversation() ile çözer — kind = 'coach', student_id =
-- app.my_student_id(), participant_id = auth.uid(); başka öğrenci, veli, eğitmen (koç sohbetinin katılımcısı değil)
-- 42501 alır. Araç RPC'leri (coach_tool_*) yalnız çağıranın kendi öğrenci satırını okur.
--
-- Rol kararı: ayrı bir `ogrenmen_web_coach` veritabanı rolü AÇILMAZ. Supabase'de PostgREST isteğin rolünü JWT'nin
-- `role` iddiasından alır; web sunucusunun böyle bir rolle çağırabilmesi için projenin JWT gizli anahtarıyla jeton
-- basması gerekirdi — o anahtar service_role'den de güçlüdür (her rolü basar) ve web'e konamaz. Bu yüzden EXECUTE
-- yalnız authenticated'a verilir, kapsam fonksiyon içinde app.uid()/app.my_student_id() ile kurulur.
--
-- Sunucu jetonu: model çıktısı (assistant/system turları, araç turları), llm_calls defteri, koçun hafıza yazımı ve
-- eğitmen yönlendirmesi istemciden gelmemeli — öğrencinin JWT'si tarayıcıda da vardır ve PostgREST'e doğrudan
-- gidebilir. Bu yazımlar p_server_token ister: 'v1.<bitiş unix sn>.<hex hmac_sha256(anahtar, "coach:<sohbet>:<bitiş>")>'.
-- Anahtar secure.server_keys('web_coach') satırıdır (bu göçte rastgele üretilir; depoda sır yok), yalnız web sunucusunun
-- ortamında (OGRENMEN_WEB_COACH_KEY, server-only) durur; tarayıcıya gitmez. Jeton sohbete bağlıdır ve en çok 1 saat
-- geçerlidir (sızan jeton yalnız o sohbete, kısa süre yazar). Jetonsuz çağrı yalnız 'user' rolünde, metin ve yükleme
-- başvurusu bloklarından oluşan bir mesaj ekleyebilir (app.coach_client_blocks_ok); koç sohbetine doğrudan INSERT bu
-- göçle kapanır (aşağıda, 0018 politikalarının daraltılması).
--
-- Tur kilidi: PostgREST işlem kipinde (havuzlu) oturum düzeyinde danışma kilidi taşınamaz; yerine kira tablosu
-- secure.coach_turns (sohbet başına tek satır, süresi dolan kira düşer — süreç ölürse kilit kendiliğinden açılır).
--
-- Hafıza: koçun hafıza aracı yazımları coach_memory_write ile (actor 'coach:<sohbet>'), upsert_memory_file ile aynı
-- sınırlar app.memory_apply() içinde tek yolda (≤ 12 dosya, ≤ 8 KB, yol izin listesi, öğrenci kilidi, koşullu yazım
-- OGR-MEM-028, sürüm satırı); parent_summary.md koçtan kapalı (OGR-MEM-007). Kuyruk ('memory.apply' işi) seçilmedi:
-- araç döngüsü aynı turda yazdığını okur (create → view → str_replace); kuyruk okumayı yazımdan koparırdı.
--
-- Hata kodları: OGR-COACH-001 sunucu jetonu yok/geçersiz (42501), 002 geçersiz mesaj, 003 geçersiz mod,
-- 004 ders öğrencinin kaydı değil (42501), 005 geçersiz defter satırı ya da llm_call_id, 006 yükleme öğrenciye ait değil
-- (42501), 007 geçersiz yönlendirme.

-- --- tablolar ----------------------------------------------------------------------------------------

create table secure.server_keys (  -- Sunucu HMAC anahtarları; yalnız SECURITY DEFINER fonksiyonlar okur (web_coach: koç sunucu jetonu).
  name text primary key check (name ~ '^[a-z_]{3,32}$'),  -- Anahtar adı ('web_coach')
  secret text not null check (char_length(secret) >= 32),  -- Gizli değer (hex); web sunucusunun OGRENMEN_WEB_COACH_KEY ortam değişkeni
  rotated_at timestamptz,  -- Son değiştirme zamanı
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments secure.server_keys
comment on table secure.server_keys is 'Sunucu HMAC anahtarları; yalnız SECURITY DEFINER fonksiyonlar okur (web_coach: koç sunucu jetonu).';
comment on column secure.server_keys.name is 'Anahtar adı (''web_coach'')';
comment on column secure.server_keys.secret is 'Gizli değer (hex); web sunucusunun OGRENMEN_WEB_COACH_KEY ortam değişkeni';
comment on column secure.server_keys.rotated_at is 'Son değiştirme zamanı';
comment on column secure.server_keys.created_at is 'Oluşturulma zamanı';
-- end comments secure.server_keys
alter table secure.server_keys enable row level security;
alter table secure.server_keys force row level security;

-- Göç anahtarı kendisi üretir (depoda sır yok); kurucu değeri bir kez okur ve web ortamına koyar (supabase/README.md).
insert into secure.server_keys (name, secret) values ('web_coach', encode(gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

create table secure.coach_turns (  -- Koç turu kiraları: aynı sohbette aynı anda tek tur; süresi dolan kira düşer.
  conversation_id uuid primary key references public.conversations (id) on delete cascade,  -- Sohbet
  token uuid not null,  -- Kirayı tutanın jetonu (bırakmak için)
  expires_at timestamptz not null,  -- Kiranın bitişi (süreç ölürse kilit burada açılır)
  created_at timestamptz not null default now()  -- Kiranın alındığı zaman
);
-- begin comments secure.coach_turns
comment on table secure.coach_turns is 'Koç turu kiraları: aynı sohbette aynı anda tek tur; süresi dolan kira düşer.';
comment on column secure.coach_turns.conversation_id is 'Sohbet';
comment on column secure.coach_turns.token is 'Kirayı tutanın jetonu (bırakmak için)';
comment on column secure.coach_turns.expires_at is 'Kiranın bitişi (süreç ölürse kilit burada açılır)';
comment on column secure.coach_turns.created_at is 'Kiranın alındığı zaman';
-- end comments secure.coach_turns
alter table secure.coach_turns enable row level security;
alter table secure.coach_turns force row level security;

-- --- yardımcılar ---------------------------------------------------------------------------------------

-- Oturumdaki öğrencinin koç sohbeti; değilse 42501 (başka öğrenci, veli, eğitmen, anon).
create or replace function app.coach_conversation(p_conversation uuid) returns public.conversations
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
  v_conv public.conversations%rowtype;
begin
  if auth.uid() is null or v_student is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 koç sohbeti yalnız öğrencinin kendisine açıktır';
  end if;
  select c.* into v_conv from public.conversations c
   where c.id = p_conversation and c.kind = 'coach' and c.student_id = v_student and c.participant_id = auth.uid();
  if not found then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu koç sohbeti için yetki yok';
  end if;
  return v_conv;
end
$$;
comment on function app.coach_conversation(uuid) is 'Oturumdaki öğrencinin koç sohbeti (kind=coach, kendi öğrencisi, katılımcı = auth.uid()); değilse 42501.';

-- Öğrencinin koç dersi: verilen ders yalnız öğrencinin o derste kaydı varsa; yoksa (ya da verilmediyse) en son açılan
-- etkin kaydın dersi. conversations.course_id istemciden de yazılabildiği için (0018 INSERT hakkı) ona güvenilmez.
create or replace function app.coach_course(p_student uuid, p_course uuid) returns uuid
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_course uuid;
begin
  if p_course is not null
     and exists (select 1 from public.enrollments e where e.student_id = p_student and e.course_id = p_course) then
    return p_course;
  end if;
  select e.course_id into v_course from public.enrollments e
   where e.student_id = p_student and e.status = 'active'
   order by e.started_at desc, e.created_at desc limit 1;
  return v_course;
end
$$;
comment on function app.coach_course(uuid, uuid) is 'Koç bağlamının dersi: verilen ders (yalnız öğrencinin o derste kaydı varsa) ya da en son açılan etkin kaydının dersi.';

-- Sunucu jetonu: 'v1.<bitiş>.<hex hmac_sha256(web_coach anahtarı, "coach:<sohbet>:<bitiş>")>'; bitiş ≤ 1 saat sonra.
create or replace function app.coach_server_ok(p_conversation uuid, p_token text) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_parts text[];
  v_exp bigint;
  v_now bigint := floor(extract(epoch from now()))::bigint;
  v_secret text;
begin
  if p_token is null or p_conversation is null then
    return false;
  end if;
  v_parts := string_to_array(p_token, '.');
  if cardinality(v_parts) <> 3 or v_parts[1] <> 'v1' or v_parts[2] !~ '^[0-9]{1,12}$' or v_parts[3] !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  v_exp := v_parts[2]::bigint;
  if v_exp < v_now or v_exp > v_now + 3600 then
    return false;
  end if;
  select k.secret into v_secret from secure.server_keys k where k.name = 'web_coach';
  if v_secret is null then
    return false;
  end if;
  return encode(hmac(convert_to('coach:' || p_conversation::text || ':' || v_parts[2], 'UTF8'),
                     convert_to(v_secret, 'UTF8'), 'sha256'), 'hex') = v_parts[3];
end
$$;
comment on function app.coach_server_ok(uuid, text) is 'Koç sunucu jetonu geçerli mi (HMAC-SHA256, sohbete bağlı, en çok 1 saat).';

create or replace function app.coach_require_server(p_conversation uuid, p_token text) returns void
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if not app.coach_server_ok(p_conversation, p_token) then
    raise exception using errcode = '42501',
      message = 'OGR-COACH-001 bu yazım yalnız web sunucusundan yapılır (sunucu jetonu yok ya da geçersiz)';
  end if;
end
$$;
comment on function app.coach_require_server(uuid, text) is 'Sunucu jetonu geçersizse 42501 OGR-COACH-001.';

-- Mesaj ekleme (iç yol): rol, içerik biçimi ve boyutu, yükleme sahipliği, defter bağı; sohbetin son mesaj zamanı.
create or replace function app.coach_insert_message(
  p_conv public.conversations, p_role text, p_content jsonb, p_upload_ids uuid[], p_llm_call_id bigint, p_tool_calls jsonb
) returns bigint
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_id bigint;
begin
  if p_role is null or p_role not in ('user', 'assistant', 'system') then
    raise exception using errcode = 'P0001', message = format('OGR-COACH-002 geçersiz rol %s', coalesce(p_role, '(boş)'));
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_content) as b (blk)
                 where jsonb_typeof(b.blk) <> 'object' or coalesce(b.blk ->> 'type', '') = '') then
    raise exception using errcode = 'P0001', message = 'OGR-COACH-002 içerik {type, …} bloklarından oluşan dizi olmalı';
  end if;
  if octet_length(p_content::text) > 524288 then
    raise exception using errcode = 'P0001', message = 'OGR-COACH-002 mesaj içeriği 512 KB sınırını aşıyor';
  end if;
  if p_tool_calls is not null and jsonb_typeof(p_tool_calls) <> 'object' then
    raise exception using errcode = 'P0001', message = 'OGR-COACH-002 tool_calls nesne olmalı';
  end if;
  if cardinality(coalesce(p_upload_ids, '{}')) > 8 or not app.uploads_ok(coalesce(p_upload_ids, '{}'), p_conv.student_id) then
    raise exception using errcode = '42501', message = 'OGR-COACH-006 ekli yükleme bu öğrenciye ait değil';
  end if;
  if p_llm_call_id is not null
     and not exists (select 1 from public.llm_calls lc
                      where lc.id = p_llm_call_id and lc.ref_table = 'conversations' and lc.ref_id = p_conv.id::text) then
    raise exception using errcode = 'P0001', message = format('OGR-COACH-005 llm_call_id bu sohbetin çağrısı değil: %s', p_llm_call_id);
  end if;
  insert into public.conversation_messages (conversation_id, role, content, upload_ids, llm_call_id, tool_calls)
  values (p_conv.id, p_role, p_content, coalesce(p_upload_ids, '{}'), p_llm_call_id, p_tool_calls)
  returning id into v_id;
  update public.conversations c set last_message_at = now() where c.id = p_conv.id;
  return v_id;
end
$$;
comment on function app.coach_insert_message(public.conversations, text, jsonb, uuid[], bigint, jsonb) is 'Koç mesajı ekler (iç yol; yetki çağıranda): rol, içerik dizisi ≤ 512 KB, yükleme sahipliği, llm_call_id bu sohbetin çağrısı.';

-- Hafıza yazımının tek yolu (0023 upsert_memory_file gövdesi): işlem, actor, yol izin listesi, öğrenci kilidi,
-- koşullu yazım (OGR-MEM-028), ≤ 12 dosya, ≤ 8 KB, sürüm satırı. Yetki çağıranda; p_allow_parent yalnız güvenilir çağıran.
create or replace function app.memory_apply(
  p_student uuid, p_path text, p_content text, p_op text, p_actor text, p_new_path text, p_expected_hash text,
  p_allow_parent boolean
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_max_files int := app.setting_num('memory_max_files', 12)::int;
  v_max_bytes int := app.setting_num('memory_max_bytes', 8192)::int;
  v_exists boolean;
  v_target text := p_path;
  v_content text;
  v_version int;
begin
  if p_op is null or p_op not in ('create', 'str_replace', 'insert', 'delete', 'rename', 'compact') then
    raise exception using errcode = 'P0001', message = format('OGR-MEM-004 geçersiz işlem %s', coalesce(p_op, '(boş)'));
  end if;
  if nullif(btrim(p_actor), '') is null or char_length(p_actor) > 64 then
    raise exception using errcode = 'P0001', message = 'OGR-MEM-004 actor gerekli (≤ 64 karakter)';
  end if;
  if not app.memory_path_ok(p_path) or (p_op = 'rename' and not app.memory_path_ok(p_new_path)) then
    raise exception using errcode = 'P0001', message = format('OGR-MEM-003 yol izin listesinde değil: %s', coalesce(p_new_path, p_path));
  end if;
  if (p_path = '/memories/parent_summary.md' or p_new_path = '/memories/parent_summary.md') and not coalesce(p_allow_parent, false) then
    raise exception using errcode = '42501', message = 'OGR-MEM-007 parent_summary.md yalnız gece işi tarafından yazılır';
  end if;
  perform pg_advisory_xact_lock(hashtext('memory_files:' || p_student::text));
  select exists (select 1 from public.memory_files mf where mf.student_id = p_student and mf.path = p_path) into v_exists;
  if p_expected_hash is not null
     and (select md5(mf.content) from public.memory_files mf where mf.student_id = p_student and mf.path = p_path)
         is distinct from p_expected_hash then
    raise exception using errcode = 'P0001', message = format('OGR-MEM-028 dosya okunduktan sonra değişti: %s', p_path);
  end if;

  if p_op in ('create', 'str_replace', 'insert', 'compact') then
    if p_content is null then
      raise exception using errcode = 'P0001', message = 'OGR-MEM-004 içerik gerekli';
    end if;
    if octet_length(p_content) > v_max_bytes then
      raise exception using errcode = 'P0001', message = format('OGR-MEM-002 dosya %s baytı aşıyor (%s)', v_max_bytes, octet_length(p_content));
    end if;
    if not v_exists and p_op <> 'create' then
      raise exception using errcode = 'P0001', message = format('OGR-MEM-005 dosya yok: %s', p_path);
    end if;
    if not v_exists and (select count(*) from public.memory_files mf where mf.student_id = p_student) >= v_max_files then
      raise exception using errcode = 'P0001', message = format('OGR-MEM-001 hafıza dosyası sınırı (%s) aşıldı', v_max_files);
    end if;
    insert into public.memory_files as mf (student_id, path, content) values (p_student, p_path, p_content)
    on conflict (student_id, path) do update set content = excluded.content;
    v_content := p_content;
  elsif p_op = 'delete' then
    if not v_exists then
      raise exception using errcode = 'P0001', message = format('OGR-MEM-005 dosya yok: %s', p_path);
    end if;
    delete from public.memory_files mf where mf.student_id = p_student and mf.path = p_path;
  else
    if not v_exists then
      raise exception using errcode = 'P0001', message = format('OGR-MEM-005 dosya yok: %s', p_path);
    end if;
    if exists (select 1 from public.memory_files mf where mf.student_id = p_student and mf.path = p_new_path) then
      raise exception using errcode = 'P0001', message = format('OGR-MEM-006 hedef dosya var: %s', p_new_path);
    end if;
    update public.memory_files mf set path = p_new_path where mf.student_id = p_student and mf.path = p_path
    returning mf.content into v_content;
    v_target := p_new_path;
  end if;

  select coalesce(max(v.version), 0) + 1 into v_version from public.memory_file_versions v
   where v.student_id = p_student and v.path = v_target;
  insert into public.memory_file_versions (student_id, path, version, op, actor, content)
  values (p_student, v_target, v_version, p_op, p_actor, v_content);
  return jsonb_build_object('path', v_target, 'version', v_version, 'op', p_op,
                            'bytes', coalesce(octet_length(v_content), 0), 'from_path', case when p_op = 'rename' then p_path end);
end
$$;
comment on function app.memory_apply(uuid, text, text, text, text, text, text, boolean) is 'Hafıza dosyası yazımının tek yolu (upsert_memory_file ve coach_memory_write): sınırlar, kilit, koşullu yazım, sürüm; yetki çağıranda.';

-- upsert_memory_file (0023) aynı imza ve davranış; gövde app.memory_apply'a taşındı.
create or replace function public.upsert_memory_file(
  p_student uuid, p_path text, p_content text, p_op text, p_actor text, p_new_path text default null,
  p_expected_hash text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_actor text := p_actor;
begin
  perform app.assert_memory_writer(p_student);
  if not app.is_trusted() then
    v_actor := coalesce(app.role(), 'user') || ':' || auth.uid()::text;
  end if;
  return app.memory_apply(p_student, p_path, p_content, p_op, v_actor, p_new_path, p_expected_hash, app.is_trusted());
end
$$;
comment on function public.upsert_memory_file(uuid, text, text, text, text, text, text) is 'Hafıza dosyası yazar (create/str_replace/insert/compact/delete/rename), sürüm ekler; ≤ 12 dosya, ≤ 8 KB, /memories/ izin listesi; p_expected_hash (md5) verilirse koşullu yazar (OGR-MEM-028); yalnız worker, owner eğitmen, admin.';

-- --- koç RPC'leri ------------------------------------------------------------------------------------

-- Oturumdaki öğrenci: {student_id, public_ref, enrollment_id, course_id} (en son açılan etkin kayıt); öğrenci değilse 42501.
create or replace function public.coach_student() returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_out jsonb;
begin
  select jsonb_build_object('student_id', s.id, 'public_ref', s.public_ref, 'enrollment_id', e.id, 'course_id', e.course_id)
    into v_out
    from public.students s
    left join lateral (
      select en.id, en.course_id from public.enrollments en
       where en.student_id = s.id and en.status = 'active'
       order by en.started_at desc, en.created_at desc limit 1
    ) e on true
   where s.profile_id = auth.uid() and s.status = 'active';
  if v_out is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 koç yalnız etkin öğrenci hesabında açılır';
  end if;
  return v_out;
end
$$;
comment on function public.coach_student() is 'Koç: oturumdaki etkin öğrenci {student_id, public_ref, enrollment_id, course_id}; değilse 42501.';

-- Yeni koç sohbeti açar. p_course: öğrencinin kaydı olan ders (yoksa en son etkin kaydın dersi); p_mode hint|explain|solve.
create or replace function public.coach_open_conversation(p_course uuid default null, p_mode text default 'hint') returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
  v_course uuid;
  v_id uuid;
begin
  if auth.uid() is null or v_student is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 koç sohbetini yalnız öğrencinin kendisi açar';
  end if;
  if coalesce(p_mode, '') not in ('hint', 'explain', 'solve') then
    raise exception using errcode = 'P0001', message = format('OGR-COACH-003 geçersiz mod %s', coalesce(p_mode, '(boş)'));
  end if;
  if p_course is not null
     and not exists (select 1 from public.enrollments e where e.student_id = v_student and e.course_id = p_course) then
    raise exception using errcode = '42501', message = 'OGR-COACH-004 bu derste kaydın yok';
  end if;
  v_course := app.coach_course(v_student, p_course);
  insert into public.conversations (student_id, kind, participant_id, course_id, mode)
  values (v_student, 'coach', auth.uid(), v_course, p_mode)
  returning id into v_id;
  return v_id;
end
$$;
comment on function public.coach_open_conversation(uuid, text) is 'Koç: yeni koç sohbeti açar (öğrencinin kendisi; ders kaydı olmalı, yoksa etkin kaydın dersi); sohbet kimliğini döner.';

-- Geçmiş: {conversation {id, mode, course_id, summary, summary_upto_message_id, turn_in_progress} | null, total,
-- messages[{id, role, content, upload_ids, tool_calls, created_at}]} — p_conversation null: en son koç sohbeti.
-- total = p_after_id'den sonraki mesaj sayısı; messages = bunların en yeni p_limit'i (0–200), eskiden yeniye.
create or replace function public.coach_history(p_conversation uuid default null, p_limit int default 80, p_after_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
  v_conv public.conversations%rowtype;
  v_limit int := least(greatest(coalesce(p_limit, 80), 0), 200);
  v_after bigint := coalesce(p_after_id, 0);
  v_total int;
  v_msgs jsonb;
begin
  if auth.uid() is null or v_student is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 koç sohbeti yalnız öğrencinin kendisine açıktır';
  end if;
  if p_conversation is null then
    select c.* into v_conv from public.conversations c
     where c.student_id = v_student and c.participant_id = auth.uid() and c.kind = 'coach'
     order by coalesce(c.last_message_at, c.created_at) desc, c.created_at desc limit 1;
    if not found then
      return jsonb_build_object('conversation', null, 'total', 0, 'messages', '[]'::jsonb);
    end if;
  else
    v_conv := app.coach_conversation(p_conversation);
  end if;
  select count(*)::int into v_total from public.conversation_messages m where m.conversation_id = v_conv.id and m.id > v_after;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'role', t.role, 'content', t.content, 'upload_ids', to_jsonb(t.upload_ids),
                                               'tool_calls', t.tool_calls, 'created_at', t.created_at) order by t.id), '[]'::jsonb)
    into v_msgs
    from (select m.id, m.role, m.content, m.upload_ids, m.tool_calls, m.created_at from public.conversation_messages m
           where m.conversation_id = v_conv.id and m.id > v_after order by m.id desc limit v_limit) t;
  return jsonb_build_object(
    'conversation', jsonb_build_object(
      'id', v_conv.id, 'mode', v_conv.mode, 'course_id', v_conv.course_id, 'summary', v_conv.summary,
      'summary_upto_message_id', v_conv.summary_upto_message_id,
      'turn_in_progress', exists (select 1 from secure.coach_turns ct where ct.conversation_id = v_conv.id and ct.expires_at > now())),
    'total', v_total, 'messages', v_msgs);
end
$$;
comment on function public.coach_history(uuid, int, bigint) is 'Koç: sohbet + özet + tur durumu + p_after_id sonrası mesaj sayısı ve en yeni p_limit mesaj (öğrencinin kendisi; veli ve başka öğrenci 42501).';

create or replace function public.coach_set_mode(p_conversation uuid, p_mode text) returns boolean
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.coach_conversation(p_conversation);
begin
  if coalesce(p_mode, '') not in ('hint', 'explain', 'solve') then
    raise exception using errcode = 'P0001', message = format('OGR-COACH-003 geçersiz mod %s', coalesce(p_mode, '(boş)'));
  end if;
  update public.conversations c set mode = p_mode where c.id = v_conv.id;
  return true;
end
$$;
comment on function public.coach_set_mode(uuid, text) is 'Koç: sohbetin modunu öğrenci değiştirir (hint | explain | solve).';

-- Jetonsuz (istemciden) yazılabilecek içerik: yalnız {type:'text', text} ve {type:'image'|'document', source:{type:'upload',
-- upload_id}} (yükleme p_upload_ids içinde olmalı; sahipliği coach_insert_message denetler). Başka anahtar yok
-- (cache_control, citations, …); base64/url/file kaynağı yok. Uydurma blok sohbetin sonraki her turunu API'de 400 yapardı.
create or replace function app.coach_client_blocks_ok(p_content jsonb, p_upload_ids uuid[]) returns boolean
language plpgsql
immutable
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_blk jsonb;
  v_src jsonb;
  v_keys text[];
begin
  if jsonb_typeof(p_content) is distinct from 'array' then
    return true;  -- biçim hatası coach_insert_message'da OGR-COACH-002 olur
  end if;
  for v_blk in select b.blk from jsonb_array_elements(p_content) as b (blk) loop
    if jsonb_typeof(v_blk) <> 'object' then
      return false;
    end if;
    select array_agg(k order by k) into v_keys from jsonb_object_keys(v_blk) as k;
    if v_blk ->> 'type' = 'text' then
      if v_keys is distinct from array['text', 'type'] or jsonb_typeof(v_blk -> 'text') is distinct from 'string' then
        return false;
      end if;
    elsif v_blk ->> 'type' in ('image', 'document') then
      v_src := v_blk -> 'source';
      if v_keys is distinct from array['source', 'type'] or jsonb_typeof(v_src) <> 'object' then
        return false;
      end if;
      select array_agg(k order by k) into v_keys from jsonb_object_keys(v_src) as k;
      if v_keys is distinct from array['type', 'upload_id'] or v_src ->> 'type' is distinct from 'upload'
         or coalesce(v_src ->> 'upload_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return false;
      end if;
      if not ((v_src ->> 'upload_id')::uuid = any(coalesce(p_upload_ids, '{}'))) then
        return false;
      end if;
    else
      return false;
    end if;
  end loop;
  return true;
end
$$;
comment on function app.coach_client_blocks_ok(jsonb, uuid[]) is 'Jetonsuz koç mesajı içeriği izinli mi: yalnız {type:text, text} ve upload başvurulu image/document (p_upload_ids içinde); başka anahtar yok.';

-- Tek mesaj. Jetonsuz (istemci ya da öğrencinin kendi turu): yalnız role='user', app.coach_client_blocks_ok blokları,
-- llm_call_id ve tool_calls yok. Sunucu jetonuyla: assistant/system turları, araç blokları, defter bağı ve tur kaydı.
create or replace function public.coach_append_message(
  p_conversation uuid, p_role text, p_content jsonb, p_upload_ids uuid[] default '{}', p_llm_call_id bigint default null,
  p_tool_calls jsonb default null, p_server_token text default null
) returns bigint
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.coach_conversation(p_conversation);
begin
  if not app.coach_server_ok(p_conversation, p_server_token) then
    if coalesce(p_role, '') <> 'user' then
      raise exception using errcode = '42501',
        message = 'OGR-COACH-001 assistant ve system turlarını yalnız web sunucusu yazar (sunucu jetonu gerekli)';
    end if;
    if p_llm_call_id is not null or p_tool_calls is not null or not app.coach_client_blocks_ok(p_content, p_upload_ids) then
      raise exception using errcode = '42501',
        message = 'OGR-COACH-001 istemci yalnız metin ve yükleme başvurusu bloğu yazar; araç blokları, ek anahtarlar, defter bağı ve tur kaydı yalnız web sunucusundan (sunucu jetonu gerekli)';
    end if;
  end if;
  return app.coach_insert_message(v_conv, p_role, p_content, p_upload_ids, p_llm_call_id, p_tool_calls);
end
$$;
comment on function public.coach_append_message(uuid, text, jsonb, uuid[], bigint, jsonb, text) is 'Koç: mesaj ekler; jetonsuz yalnız öğrencinin user mesajı, assistant/system/araç turu yalnız sunucu jetonuyla (OGR-COACH-001).';

-- Turun model tarafı tek işlemde: p_messages [{role, content, upload_ids?, llm_call_id?, tool_calls?}] (≤ 64); sunucu jetonu.
create or replace function public.coach_append_turn(p_conversation uuid, p_messages jsonb, p_server_token text default null) returns bigint[]
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.coach_conversation(p_conversation);
  v_ids bigint[] := '{}';
  v_msg jsonb;
begin
  perform app.coach_require_server(p_conversation, p_server_token);
  if p_messages is null or jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 64 then
    raise exception using errcode = 'P0001', message = 'OGR-COACH-002 p_messages en çok 64 mesajlık dizi olmalı';
  end if;
  for v_msg in select x.m from jsonb_array_elements(p_messages) with ordinality as x (m, n) order by x.n loop
    if jsonb_typeof(v_msg) <> 'object' then
      raise exception using errcode = 'P0001', message = 'OGR-COACH-002 her mesaj nesne olmalı';
    end if;
    v_ids := v_ids || app.coach_insert_message(
      v_conv, v_msg ->> 'role', v_msg -> 'content',
      coalesce((select array_agg(u.v::uuid) from jsonb_array_elements_text(coalesce(v_msg -> 'upload_ids', '[]'::jsonb)) as u (v)), '{}'),
      nullif(v_msg ->> 'llm_call_id', '')::bigint,
      case when jsonb_typeof(v_msg -> 'tool_calls') = 'null' then null else v_msg -> 'tool_calls' end);
  end loop;
  return v_ids;
end
$$;
comment on function public.coach_append_turn(uuid, jsonb, text) is 'Koç: turun model tarafını (system, araç turları, son yanıt) tek işlemde yazar; yalnız sunucu jetonuyla.';

-- Tur kirası: boşsa (ya da süresi dolmuşsa) yeni jeton döner, başka tur sürüyorsa null. Süre 30–900 sn (varsayılan 180).
create or replace function public.coach_claim_turn(p_conversation uuid, p_ttl_s int default 180) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.coach_conversation(p_conversation);
  v_token uuid := gen_random_uuid();
  v_got uuid;
begin
  insert into secure.coach_turns as ct (conversation_id, token, expires_at)
  values (v_conv.id, v_token, now() + make_interval(secs => least(greatest(coalesce(p_ttl_s, 180), 30), 900)))
  on conflict (conversation_id) do update set token = excluded.token, expires_at = excluded.expires_at, created_at = now()
  where ct.expires_at <= now()
  returning ct.token into v_got;
  return v_got;
end
$$;
comment on function public.coach_claim_turn(uuid, int) is 'Koç: tur kirası alır (aynı sohbette tek tur); sürüyorsa null; kira 30–900 sn sonra kendiliğinden düşer.';

create or replace function public.coach_release_turn(p_conversation uuid, p_token uuid) returns boolean
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.coach_conversation(p_conversation);
begin
  delete from secure.coach_turns ct where ct.conversation_id = v_conv.id and ct.token = p_token;
  return found;
end
$$;
comment on function public.coach_release_turn(uuid, uuid) is 'Koç: tur kirasını bırakır (jeton eşleşirse); bıraktıysa true.';

-- Bağlam: {student_ref, course_id, dossier, course, memory}. p_parts ⊆ {dossier, course, memory}.
--   dossier: önbellek (student_dossier_cache) p_dossier_max_age_s içinde tazeyse {cached: {hash, rendered}}, değilse
--            {body: render_dossier(...)}; kayıt yoksa null (system[2] gönderilmez).
--   course:  ders bloğu verisi (packages/llm CourseBlockData biçimi; renderCourseText metne çevirir) ya da null.
--   memory:  hafıza dosyaları [{path, content, bytes, updated_at}] (koçun hafıza aracı için; yalnız kendi öğrencisi).
create or replace function public.coach_context(
  p_conversation uuid, p_parts text[] default array['dossier', 'course', 'memory'], p_dossier_max_age_s int default 300
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.coach_conversation(p_conversation);
  v_parts text[] := coalesce(p_parts, '{}');
  v_course uuid := app.coach_course(v_conv.student_id, v_conv.course_id);
  v_curriculum uuid;
  v_out jsonb;
  v_dossier jsonb;
  v_block jsonb;
  v_co record;
begin
  v_out := jsonb_build_object('student_ref', (select s.public_ref from public.students s where s.id = v_conv.student_id),
                              'course_id', v_course);

  if 'dossier' = any(v_parts) then
    v_dossier := null;
    if v_course is not null then
      select jsonb_build_object('cached', jsonb_build_object('hash', dc.hash, 'rendered', dc.rendered)) into v_dossier
        from public.student_dossier_cache dc
       where dc.student_id = v_conv.student_id and dc.course_id = v_course
         and dc.updated_at >= now() - make_interval(secs => greatest(coalesce(p_dossier_max_age_s, 0), 0));
      if v_dossier is null then
        begin
          v_dossier := jsonb_build_object('body', public.render_dossier(v_conv.student_id, v_course));
        exception when others then
          if sqlerrm not like 'OGR-DOS-%' then
            raise;
          end if;
          v_dossier := null;
        end;
      end if;
    end if;
    v_out := v_out || jsonb_build_object('dossier', v_dossier);
  end if;

  if 'course' = any(v_parts) then
    v_block := null;
    -- Derinlemesine savunma: ders bloğu yalnız çağıranın RLS ile okuyabildiği derse kurulur (app.can_read_course).
    select co.id, co.code, co.title, co.kind, co.curriculum_id,
           exists (select 1 from public.profiles p where p.id = co.created_by and p.role = 'student') as by_student
      into v_co
      from public.courses co where co.id = v_course and app.can_read_course(co.id);
    if found then
      select e.curriculum_id into v_curriculum from public.enrollments e
       where e.student_id = v_conv.student_id and e.course_id = v_course
       order by (e.status = 'active') desc, e.started_at desc, e.created_at desc limit 1;
      v_curriculum := coalesce(v_curriculum, v_co.curriculum_id);
      v_block := jsonb_build_object(
        'course', jsonb_build_object('id', v_co.id, 'code', v_co.code, 'title', v_co.title, 'kind', v_co.kind,
                                     'createdByStudent', v_co.by_student),
        'curriculum', (select jsonb_build_object('id', cu.id, 'code', cu.code, 'version', cu.version, 'label', cu.label,
                                                 'status', cu.status, 'origin', coalesce(cu.origin, ''))
                         from public.curricula cu where cu.id = v_curriculum),
        'skills', (select coalesce(jsonb_agg(jsonb_build_object('id', sk.id, 'parentId', sk.parent_id, 'name', sk.name, 'kind', sk.kind,
                                                                'isLeaf', sk.is_leaf, 'orderNo', coalesce(sk.order_no, 0),
                                                                'examWeightHint', sk.exam_weight_hint) order by sk.order_no, sk.id), '[]'::jsonb)
                     from public.skills sk where sk.curriculum_id = v_curriculum),
        'prerequisites', (select coalesce(jsonb_agg(jsonb_build_object('skillId', sp.skill_id, 'prereqId', sp.prereq_id)
                                                    order by sp.skill_id, sp.prereq_id), '[]'::jsonb)
                            from public.skill_prerequisites sp where sp.curriculum_id = v_curriculum),
        'misconceptionTags', (select coalesce(jsonb_agg(jsonb_build_object('tag', mt.tag, 'skillId', mt.skill_id, 'prereqSkillId', mt.prereq_skill_id,
                                                                           'text', coalesce(mt.text_instructor, '')) order by mt.tag), '[]'::jsonb)
                                from public.misconception_tags mt
                               where mt.curriculum_id = v_curriculum
                                  or exists (select 1 from public.skills s2 where s2.curriculum_id = v_curriculum and s2.id = mt.skill_id)),
        'styles', (select coalesce(jsonb_agg(jsonb_build_object('code', qs.code, 'name', qs.name, 'format', qs.format, 'trick', qs.trick,
                                                                'difficulty', qs.difficulty_band, 'frequency', qs.frequency_score,
                                                                'skillIds', to_jsonb(qs.skill_ids))
                                             order by qs.frequency_score desc nulls last, qs.code), '[]'::jsonb)
                     from public.question_styles qs where qs.course_id = v_course and qs.status = 'active'));
    end if;
    v_out := v_out || jsonb_build_object('course', v_block);
  end if;

  if 'memory' = any(v_parts) then
    v_out := v_out || jsonb_build_object('memory', (
      select coalesce(jsonb_agg(jsonb_build_object('path', mf.path, 'content', mf.content, 'bytes', mf.bytes, 'updated_at', mf.updated_at)
                                order by mf.path), '[]'::jsonb)
        from public.memory_files mf where mf.student_id = v_conv.student_id));
  end if;
  return v_out;
end
$$;
comment on function public.coach_context(uuid, text[], int) is 'Koç: dossier (önbellek ya da render_dossier gövdesi), ders bloğu verisi ve hafıza dosyaları (yalnız öğrencinin kendi sohbeti).';

-- Koçun hafıza aracı yazımı: upsert_memory_file ile aynı sınırlar (app.memory_apply), actor 'coach:<sohbet>', sunucu
-- jetonu; parent_summary.md koçtan kapalı (OGR-MEM-007).
create or replace function public.coach_memory_write(
  p_conversation uuid, p_path text, p_content text, p_op text, p_new_path text default null, p_expected_hash text default null,
  p_server_token text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.coach_conversation(p_conversation);
begin
  perform app.coach_require_server(p_conversation, p_server_token);
  return app.memory_apply(v_conv.student_id, p_path, p_content, p_op, 'coach:' || v_conv.id::text, p_new_path, p_expected_hash, false);
end
$$;
comment on function public.coach_memory_write(uuid, text, text, text, text, text, text) is 'Koç: hafıza aracı yazımı (create/str_replace/insert/delete/rename; actor coach:<sohbet>); yalnız sunucu jetonuyla; parent_summary.md kapalı.';

-- Defter: koç rotalarının llm_calls satırı (spend_ledger tetikleyicisi). student_ref sohbetin öğrencisinden, ref sohbet;
-- cost_usd ≤ settings.llm_call_max_cost_usd; yalnız sunucu jetonuyla.
create or replace function public.coach_log_llm_call(p_conversation uuid, p_call jsonb, p_server_token text default null) returns bigint
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.coach_conversation(p_conversation);
  v_route text := p_call ->> 'route';
  v_id bigint;
begin
  perform app.coach_require_server(p_conversation, p_server_token);
  if coalesce(jsonb_typeof(p_call), '') <> 'object' or coalesce(v_route, '') not in ('coach_chat', 'coach_deep')
     or coalesce(nullif(p_call ->> 'purpose', ''), v_route) not in ('coach_chat', 'coach_deep')
     or nullif(p_call ->> 'model', '') is null or nullif(p_call ->> 'status', '') is null then
    raise exception using errcode = 'P0001', message = 'OGR-COACH-005 koç defter satırı: route/purpose coach_chat|coach_deep, model ve status gerekli';
  end if;
  begin
    if coalesce((p_call ->> 'cost_usd')::numeric, 0) > app.setting_num('llm_call_max_cost_usd', 5) then
      raise exception using errcode = 'P0001', message = format('OGR-LLM-001 cost_usd çağrı başına üst sınırı (%s) aşıyor',
                                                               app.setting_num('llm_call_max_cost_usd', 5));
    end if;
    insert into public.llm_calls (route, purpose, provider, model, effort, prompt_version, tokens_in, tokens_out, cache_read_tokens,
                                  cache_write_tokens, images, batch, status, error_code, latency_ms, cost_usd, ref_table, ref_id,
                                  student_ref)
    values (v_route, coalesce(nullif(p_call ->> 'purpose', ''), v_route), 'anthropic', p_call ->> 'model', p_call ->> 'effort',
            left(p_call ->> 'prompt_version', 64), coalesce((p_call ->> 'tokens_in')::int, 0), coalesce((p_call ->> 'tokens_out')::int, 0),
            coalesce((p_call ->> 'cache_read_tokens')::int, 0), coalesce((p_call ->> 'cache_write_tokens')::int, 0),
            (p_call ->> 'images')::int, false, p_call ->> 'status', left(p_call ->> 'error_code', 120), (p_call ->> 'latency_ms')::int,
            coalesce((p_call ->> 'cost_usd')::numeric, 0), 'conversations', v_conv.id::text,
            (select s.public_ref from public.students s where s.id = v_conv.student_id))
    returning id into v_id;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = format('OGR-LLM-001 geçersiz çağrı kaydı: %s', sqlerrm);
  end;
  return v_id;
end
$$;
comment on function public.coach_log_llm_call(uuid, jsonb, text) is 'Koç: coach_chat/coach_deep llm_calls satırı (student_ref ve ref sohbetten; maliyet tavanı); yalnız sunucu jetonuyla.';

-- Eğitmen yönlendirmesi: notifications(kind='coach_escalation'); aynı sohbetten 24 saatte bir (önceki duruyorsa yazmadan
-- true); bağlı eğitmen yoksa false. Gövde (Türkçe etiketli) sunucudan gelir; ham kategori yalnız payload'da.
create or replace function public.coach_escalate(
  p_conversation uuid, p_reason text, p_category text default null, p_body text default null, p_server_token text default null
) returns boolean
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.coach_conversation(p_conversation);
  v_course uuid := app.coach_course(v_conv.student_id, v_conv.course_id);
  v_instructor uuid;
  v_enrollment uuid;
begin
  perform app.coach_require_server(p_conversation, p_server_token);
  if coalesce(p_reason, '') not in ('refusal', 'turn_meta') then
    raise exception using errcode = 'P0001', message = format('OGR-COACH-007 geçersiz yönlendirme nedeni %s', coalesce(p_reason, '(boş)'));
  end if;
  perform pg_advisory_xact_lock(hashtext('coach_escalate:' || v_conv.id::text));
  if exists (select 1 from public.notifications n
              where n.kind = 'coach_escalation' and n.payload ->> 'conversation_id' = v_conv.id::text
                and n.created_at > now() - interval '24 hours') then
    return true;
  end if;
  select il.instructor_id into v_instructor from public.instructor_links il
   where il.student_id = v_conv.student_id and (il.course_id is null or il.course_id = v_course)
   order by (il.role = 'owner') desc, il.created_at limit 1;
  if v_instructor is null then
    return false;
  end if;
  select e.id into v_enrollment from public.enrollments e
   where e.student_id = v_conv.student_id and e.course_id = v_course
   order by (e.status = 'active') desc, e.started_at desc limit 1;
  insert into public.notifications (recipient_id, kind, title, body, payload)
  values (v_instructor, 'coach_escalation', 'Koç bir öğrenciyi sana yönlendirdi', left(nullif(btrim(p_body), ''), 1000),
          jsonb_build_object('student_id', v_conv.student_id, 'enrollment_id', v_enrollment, 'conversation_id', v_conv.id,
                             'reason', p_reason, 'category', left(p_category, 64)));
  return true;
end
$$;
comment on function public.coach_escalate(uuid, text, text, text, text) is 'Koç: eğitmene coach_escalation bildirimi (sohbet başına 24 saatte bir; bağlı eğitmen yoksa false); yalnız sunucu jetonuyla.';

-- Ekler: öğrencinin (ya da öğrencisiz kendi) foto/PDF yüklemeleri [{id, kind, mime, storage_path, anthropic_file_id, bytes}].
create or replace function public.coach_uploads(p_ids uuid[]) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
begin
  if auth.uid() is null or v_student is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 koç ekleri yalnız öğrencinin kendisine açıktır';
  end if;
  if cardinality(coalesce(p_ids, '{}')) > 32 then
    raise exception using errcode = 'P0001', message = 'OGR-COACH-002 en çok 32 yükleme kimliği';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'mime', u.mime, 'storage_path', u.storage_path,
                                                       'anthropic_file_id', u.anthropic_file_id, 'bytes', u.bytes) order by u.id), '[]'::jsonb)
            from public.uploads u
           where u.id = any(coalesce(p_ids, '{}')) and u.kind in ('photo', 'pdf')
             and (u.student_id = v_student or (u.owner_id = auth.uid() and u.student_id is null)));
end
$$;
comment on function public.coach_uploads(uuid[]) is 'Koç: öğrencinin foto/PDF yüklemeleri (başkasınınki dönmez).';

-- "Koça sor" bağlamı: öğrencinin kendi teşhisi; başkasınınki ya da yoksa null.
create or replace function public.coach_seed(p_analysis uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
begin
  if auth.uid() is null or v_student is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 koç bağlamı yalnız öğrencinin kendisine açıktır';
  end if;
  return (select jsonb_build_object('id', sa.id, 'question_text', sa.question_text, 'student_work_text', sa.student_work_text,
                                    'verdict', sa.verdict, 'failing_step_no', sa.failing_step_no, 'error_cause', sa.error_cause,
                                    'skill_ids', to_jsonb(sa.skill_ids), 'misconception_tags', to_jsonb(sa.misconception_tags),
                                    'upload_ids', to_jsonb(sa.upload_ids), 'why', sa.analysis ->> 'why_tr')
            from public.solution_analyses sa join public.enrollments e on e.id = sa.enrollment_id
           where sa.id = p_analysis and e.student_id = v_student);
end
$$;
comment on function public.coach_seed(uuid) is 'Koç: "Koça sor" teşhis bağlamı (öğrencinin kendi solution_analyses satırı; değilse null).';

-- Prompt sürüm kaynakları (koç rotaları): {pinned: {rota: sürüm}, active: {rota: sürüm}} — runtime_flags ve
-- prompt_versions authenticated'a kapalıdır; web sabitleme/geri almayı bununla izler.
create or replace function public.coach_prompt_sources() returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_flag jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 oturum gerekli';
  end if;
  select rf.value into v_flag from public.runtime_flags rf where rf.key = 'prompt_versions';
  return jsonb_build_object(
    'pinned', (select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
                 from jsonb_each(case when jsonb_typeof(v_flag) = 'object' then v_flag else '{}'::jsonb end) as f (key, value)
                where f.key in ('coach_chat', 'coach_deep') and jsonb_typeof(f.value) = 'string'),
    'active', (select coalesce(jsonb_object_agg(pv.route, pv.version), '{}'::jsonb)
                 from public.prompt_versions pv where pv.active and pv.route in ('coach_chat', 'coach_deep')));
end
$$;
comment on function public.coach_prompt_sources() is 'Koç: coach_chat/coach_deep prompt sürüm sabitlemesi ve etkin sürümleri (oturumlu kullanıcı).';

-- --- araç RPC'leri (koç araçları; yalnız çağıranın kendi öğrencisi) -----------------------------------------------

-- get_mastery: [{code, name, p, evidence_count, last_evidence_at}]; kod verilmezse en zayıf 8 + en güçlü 5.
-- p yalnız web sunucusunun kelime bandına çevirmesi içindir (modele ham olasılık gitmez).
create or replace function public.coach_tool_get_mastery(p_skill_codes text[] default null, p_course uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
  v_enrollment uuid;
  v_codes text[] := coalesce(p_skill_codes, '{}');
begin
  if auth.uid() is null or v_student is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 koç araçları yalnız öğrencinin kendisine açıktır';
  end if;
  if cardinality(v_codes) > 50 then
    raise exception using errcode = 'P0001', message = 'OGR-COACH-002 en çok 50 kazanım kodu';
  end if;
  select e.id into v_enrollment from public.enrollments e
   where e.student_id = v_student and (p_course is null or e.course_id = p_course)
   order by (e.status = 'active') desc, e.started_at desc, e.created_at desc limit 1;
  if v_enrollment is null then
    return jsonb_build_object('enrollment', false, 'skills', '[]'::jsonb);
  end if;
  return jsonb_build_object('enrollment', true, 'skills', (
    select coalesce(jsonb_agg(jsonb_build_object('code', x.skill_id, 'name', x.name, 'p', x.p, 'evidence_count', x.evidence_count,
                                                 'last_evidence_at', x.last_evidence_at) order by x.p, x.skill_id), '[]'::jsonb)
      from (
        select m.skill_id, sk.name, m.p, m.evidence_count, m.last_evidence_at from public.mastery m
          join public.skills sk on sk.curriculum_id = m.curriculum_id and sk.id = m.skill_id
         where m.enrollment_id = v_enrollment and cardinality(v_codes) > 0 and m.skill_id = any(v_codes)
        union
        (select m.skill_id, sk.name, m.p, m.evidence_count, m.last_evidence_at from public.mastery m
           join public.skills sk on sk.curriculum_id = m.curriculum_id and sk.id = m.skill_id
          where m.enrollment_id = v_enrollment and cardinality(v_codes) = 0 order by m.p asc, m.skill_id limit 8)
        union
        (select m.skill_id, sk.name, m.p, m.evidence_count, m.last_evidence_at from public.mastery m
           join public.skills sk on sk.curriculum_id = m.curriculum_id and sk.id = m.skill_id
          where m.enrollment_id = v_enrollment and cardinality(v_codes) = 0 order by m.p desc, m.skill_id limit 5)
      ) x));
end
$$;
comment on function public.coach_tool_get_mastery(text[], uuid) is 'Koç aracı get_mastery: kaydın ustalık satırları (verilen kodlar ya da en zayıf 8 + en güçlü 5); yalnız öğrencinin kendisi.';

-- get_recent_exams: bitmiş deneme oturumları (en yeni p_limit, 1–10): başlık, tür, bitiş, skor, en çok kaçırılan 3
-- kazanım ve teşhislerdeki en sık 3 yanılgı etiketi.
create or replace function public.coach_tool_get_recent_exams(p_limit int default 3) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
begin
  if auth.uid() is null or v_student is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 koç araçları yalnız öğrencinin kendisine açıktır';
  end if;
  return jsonb_build_object('exams', (
    select coalesce(jsonb_agg(jsonb_build_object('title', x.title, 'kind', x.kind, 'finished_at', x.finished_at, 'score', x.score,
                                                 'weak_skills', x.weak_skills, 'misconceptions', x.misconceptions)
                              order by x.finished_at desc nulls last), '[]'::jsonb)
      from (
        select ex.title, ex.kind, es.finished_at, es.score,
               (select coalesce(jsonb_agg(jsonb_build_object('code', w.code, 'name', w.name, 'n', w.n) order by w.n desc, w.code), '[]'::jsonb)
                  from (select sk.code, coalesce(s2.name, sk.code) as name, count(*)::int as n
                          from public.exam_responses er join public.exam_questions q on q.id = er.exam_question_id
                          cross join lateral unnest(q.skill_ids) as sk (code)
                          left join public.skills s2 on s2.curriculum_id = en.curriculum_id and s2.id = sk.code
                         where er.session_id = es.id and er.outcome in ('wrong', 'blank', 'unfinished')
                         group by sk.code, s2.name order by count(*) desc, sk.code limit 3) w) as weak_skills,
               (select coalesce(jsonb_agg(jsonb_build_object('tag', t.tag, 'n', t.n) order by t.n desc, t.tag), '[]'::jsonb)
                  from (select tg.tag, count(*)::int as n
                          from public.exam_responses er join public.solution_analyses sa on sa.id = er.solution_analysis_id
                          cross join lateral unnest(sa.misconception_tags) as tg (tag)
                         where er.session_id = es.id
                         group by tg.tag order by count(*) desc, tg.tag limit 3) t) as misconceptions
          from public.exam_sessions es
          join public.exams ex on ex.id = es.exam_id join public.enrollments en on en.id = es.enrollment_id
         where en.student_id = v_student and es.status = 'done'
         order by es.finished_at desc nulls last limit least(greatest(coalesce(p_limit, 3), 1), 10)
      ) x));
end
$$;
comment on function public.coach_tool_get_recent_exams(int) is 'Koç aracı get_recent_exams: son bitmiş denemeler, bölüm skorları, öne çıkan hatalar; yalnız öğrencinin kendisi.';

-- search_evidence: kelime eşleşmesi (gömme yokken). p_q boşlukla ayrılmış kelimeler (sunucu küçük harfe çevirip ayırır;
-- ≥ 3 karakter, en çok 6); p_kinds ⊆ {upload, solution_analysis, lesson, exam_response, conversation}; p_limit 1–20.
-- Döner {words, results[{kind, id, at, txt (≤ 4000), score}]}; puan = eşleşen kelime sayısı, sonra yenilik.
create or replace function public.coach_tool_search_evidence(p_q text, p_kinds text[] default null, p_limit int default 5) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
  v_words text[];
  v_kinds text[] := coalesce(nullif(p_kinds, '{}'), array['upload', 'solution_analysis', 'lesson', 'exam_response', 'conversation']);
begin
  if auth.uid() is null or v_student is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 koç araçları yalnız öğrencinin kendisine açıktır';
  end if;
  select coalesce(array_agg(w.word order by w.first), '{}') into v_words
    from (select x.word, min(x.n) as first
            from regexp_split_to_table(lower(coalesce(p_q, '')), '\s+') with ordinality as x (word, n)
           where char_length(x.word) between 3 and 64
           group by x.word order by min(x.n) limit 6) w;
  if cardinality(v_words) = 0 then
    return jsonb_build_object('words', '[]'::jsonb, 'results', '[]'::jsonb);
  end if;
  return jsonb_build_object('words', to_jsonb(v_words), 'results', (
    select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'id', r.id, 'at', r.at, 'txt', left(r.txt, 4000), 'score', r.score)
                              order by r.score desc, r.at desc nulls last), '[]'::jsonb)
      from (
        select ev.kind, ev.id, ev.at, ev.txt,
               (select count(*) from unnest(v_words) as w (word) where ev.txt ilike '%' || w.word || '%')::int as score
          from (
            select 'upload'::text as kind, u.id::text as id, u.created_at as at, coalesce(u.extracted_text, '') as txt
              from public.uploads u where u.student_id = v_student and u.extracted_text is not null
            union all
            select 'solution_analysis', sa.id::text, sa.created_at,
                   concat_ws(' ', sa.question_text, sa.student_work_text, sa.analysis ->> 'why_tr', array_to_string(sa.skill_ids, ' '),
                             array_to_string(sa.misconception_tags, ' '))
              from public.solution_analyses sa join public.enrollments e on e.id = sa.enrollment_id where e.student_id = v_student
            union all
            select 'exam_response', er.id::text, es.created_at, coalesce(er.how_far_text, '')
              from public.exam_responses er join public.exam_sessions es on es.id = er.session_id
              join public.enrollments e on e.id = es.enrollment_id
             where e.student_id = v_student and er.how_far_text is not null
            union all
            select 'lesson', lc.id::text, l.held_at, lc.quote
              from public.lesson_claims lc join public.lesson_analyses la on la.id = lc.analysis_id
              join public.lessons l on l.id = la.lesson_id join public.enrollments e on e.id = l.enrollment_id
             where e.student_id = v_student and lc.status in ('approved', 'edited')
            union all
            select 'conversation', cm.id::text, cm.created_at,
                   coalesce((select string_agg(b.blk ->> 'text', ' ') from jsonb_array_elements(cm.content) as b (blk)
                              where b.blk ->> 'type' = 'text'), '')
              from public.conversation_messages cm join public.conversations c on c.id = cm.conversation_id
             where c.student_id = v_student and c.kind = 'coach' and cm.role in ('user', 'assistant')
          ) ev
         where ev.kind = any(v_kinds)
           and exists (select 1 from unnest(v_words) as w (word) where ev.txt ilike '%' || w.word || '%')
         order by score desc, ev.at desc nulls last
         limit least(greatest(coalesce(p_limit, 5), 1), 20)
      ) r));
end
$$;
comment on function public.coach_tool_search_evidence(text, text[], int) is 'Koç aracı search_evidence: öğrencinin yüklemeleri, teşhisleri, deneme notları, onaylı ders iddiaları ve koç sohbeti içinde kelime araması.';

-- --- yetkiler -----------------------------------------------------------------------------------------

-- --- 0018 yazım politikalarının daraltılması ---------------------------------------------------------
-- Koç sohbeti artık yalnız coach_* RPC'lerinden yazılır (web sunucusu da öğrencinin JWT'siyle bunları çağırır):
--   * conversations_insert_own: öğrenci doğrudan koç sohbeti açabilir ama course_id yalnız boş ya da kendi kaydının
--     dersi olabilir (yoksa başka bir dersin UUID'siyle sohbet açıp coach_context'ten özel dersin müfredatını,
--     yanılgı etiketlerini ve soru tarzlarını okuyabilirdi; app.coach_course da ayrıca doğrular).
--   * conversation_messages_insert_own: koç sohbetine doğrudan mesaj eklenemez; öğrencinin mesajı yalnız
--     coach_append_message'dan geçer (içerik izin listesi app.coach_client_blocks_ok). Doğrudan INSERT bu listeyi
--     aşardı ve uydurma bir blok sohbetin sonraki her turunu API'de 400 yapardı. Veli ve eğitmen sohbetleri 0018'deki
--     hakla kalır.
drop policy conversations_insert_own on public.conversations;
create policy conversations_insert_own on public.conversations for insert to authenticated
with check (participant_id = auth.uid()
            and ((kind = 'coach' and student_id = app.my_student_id()
                  and (course_id is null
                       or exists (select 1 from public.enrollments as e
                                   where e.student_id = app.my_student_id() and e.course_id = conversations.course_id)))
                 or (kind = 'parent' and student_id in (select c.sid from app.my_children() as c (sid)))
                 or (kind = 'instructor' and student_id in (select m.sid from app.my_students() as m (sid)))));
drop policy conversation_messages_insert_own on public.conversation_messages;
create policy conversation_messages_insert_own on public.conversation_messages for insert to authenticated
with check (role = 'user'
            and exists (select 1 from public.conversations as c
                         where c.id = conversation_messages.conversation_id and c.participant_id = auth.uid()
                           and c.kind <> 'coach'
                           and app.uploads_ok(conversation_messages.upload_ids, c.student_id)));

revoke all on function app.coach_conversation(uuid), app.coach_course(uuid, uuid), app.coach_server_ok(uuid, text),
  app.coach_require_server(uuid, text), app.coach_insert_message(public.conversations, text, jsonb, uuid[], bigint, jsonb),
  app.memory_apply(uuid, text, text, text, text, text, text, boolean), app.coach_client_blocks_ok(jsonb, uuid[])
from public;
revoke all on function public.coach_student(), public.coach_open_conversation(uuid, text), public.coach_history(uuid, int, bigint),
  public.coach_set_mode(uuid, text), public.coach_append_message(uuid, text, jsonb, uuid[], bigint, jsonb, text),
  public.coach_append_turn(uuid, jsonb, text), public.coach_claim_turn(uuid, int), public.coach_release_turn(uuid, uuid),
  public.coach_context(uuid, text[], int), public.coach_memory_write(uuid, text, text, text, text, text, text),
  public.coach_log_llm_call(uuid, jsonb, text), public.coach_escalate(uuid, text, text, text, text), public.coach_uploads(uuid[]),
  public.coach_seed(uuid), public.coach_prompt_sources(), public.coach_tool_get_mastery(text[], uuid),
  public.coach_tool_get_recent_exams(int), public.coach_tool_search_evidence(text, text[], int)
from public;
grant execute on function public.coach_student(), public.coach_open_conversation(uuid, text), public.coach_history(uuid, int, bigint),
  public.coach_set_mode(uuid, text), public.coach_append_message(uuid, text, jsonb, uuid[], bigint, jsonb, text),
  public.coach_append_turn(uuid, jsonb, text), public.coach_claim_turn(uuid, int), public.coach_release_turn(uuid, uuid),
  public.coach_context(uuid, text[], int), public.coach_memory_write(uuid, text, text, text, text, text, text),
  public.coach_log_llm_call(uuid, jsonb, text), public.coach_escalate(uuid, text, text, text, text), public.coach_uploads(uuid[]),
  public.coach_seed(uuid), public.coach_prompt_sources(), public.coach_tool_get_mastery(text[], uuid),
  public.coach_tool_get_recent_exams(int), public.coach_tool_search_evidence(text, text[], int)
to authenticated;
