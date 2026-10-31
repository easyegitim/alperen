-- 0012_functions.sql — RPC'ler (BLUEPRINT §3.9). Tümü SECURITY DEFINER, sahibi migration rolü (postgres),
-- "set search_path = public, app, secure, extensions, pg_temp" (extensions: Supabase'de pgcrypto/vector oradadır).
-- Her RPC çağıran rolü ve gerekirse öğrenci başlığını/personel kapsamını GÖVDEDE denetler; hata kodları
-- OGR-<ALAN>-<NNN> (errcode P0001). plpgsql yazım kuralı: yerel adlar v_, parametreler p_ önekli; dönüş sütunu
-- adlarıyla çakışan tablo sütunlarına her zaman takma adla başvurulur (check_sql.py OGR-LINT-VARCONFLICT).
-- Tablo okuyan app.* yardımcıları (app.current_student, app.staff_role, app.can_see_student …) 0014 başında
-- tanımlıdır; bu yüzden onları çağıran RPC'ler plpgsql'dir (gövde çağrı anında çözülür).

revoke execute on all functions in schema public from public, anon, authenticated, bot_runtime, batch_worker;

-- Türkçe kısa tarih etiketi: '19 Eki 21:04' (p_with_time) ya da '19 Eki'; Europe/Istanbul
create or replace function app.tr_stamp(p_ts timestamptz, p_with_time boolean) returns text
language sql
stable
set search_path = pg_catalog
as $$
  select to_char(p_ts at time zone 'Europe/Istanbul', 'FMDD') || ' '
         || (array['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'])[
              extract(month from p_ts at time zone 'Europe/Istanbul')::int]
         || case when p_with_time then ' ' || to_char(p_ts at time zone 'Europe/Istanbul', 'HH24:MI') else '' end
$$;
comment on function app.tr_stamp(timestamptz, boolean) is 'Kanıt konumu için Türkçe kısa tarih ("19 Eki 21:04").';
revoke all on function app.tr_stamp(timestamptz, boolean) from public;

-- Kimlik ve onay -----------------------------------------------------------------------------------

create function public.consent_ok(p_student uuid) returns boolean
language sql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
  select exists (select 1 from public.consents c where c.student_id = p_student and c.kind = 'kvkk_aydinlatma' and c.status = 'given')
     and (not coalesce((select s.is_minor from public.students s where s.id = p_student), true)
          or exists (select 1 from public.consents c where c.student_id = p_student and c.kind = 'veli_onayi' and c.status = 'given'))
$$;
comment on function public.consent_ok(uuid) is 'Onay kapısı: aydınlatma onayı ve (reşit değilse) veli onayı.';
grant execute on function public.consent_ok(uuid) to bot_runtime, authenticated;

-- Worker update.message.from adlarını YALNIZ bu RPC'ye geçirir; secure.student_pii.display_name buradan dolar ve
-- app.refresh_name_hashes() hash'leri anında üretir. p_create=true yalnız özel sohbette /start ve sonrası serbest metin.
create function public.resolve_telegram(
  p_tg_user bigint, p_chat bigint, p_username text, p_is_group boolean, p_create boolean default false,
  p_first_name text default null, p_last_name text default null
)
returns table (
  student_id uuid, public_ref text, is_minor boolean, status text, enrollment_id uuid, consent_ok boolean,
  role_in_chat text, staff_id uuid, tier text, service_level text
)
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sid uuid;
  v_stf uuid;
  v_eid uuid;
  v_cur uuid;
  v_per text;
  v_name text := nullif(trim(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, '')), '');
  v_role text;
begin
  if app.jwt_role() <> 'bot_runtime' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-001 yalnız bot_runtime';
  end if;
  select ti.student_id, ti.staff_id into v_sid, v_stf from secure.telegram_identities ti where ti.telegram_user_id = p_tg_user;
  if v_sid is null and v_stf is null and not p_is_group and p_create then
    select c.id into v_cur from public.curricula c where c.status = 'active' order by c.year desc, c.version desc limit 1;
    select st.value #>> '{}' into v_per from public.settings st where st.key = 'default_period';
    if v_cur is null or v_per is null then
      raise exception using errcode = 'P0001', message = 'OGR-ENR-001 aktif müfredat yok';
    end if;
    insert into public.students default values returning id into v_sid;
    insert into secure.student_pii (student_id, display_name) values (v_sid, v_name);
    insert into secure.telegram_identities (telegram_user_id, student_id, username) values (p_tg_user, v_sid, p_username);
    insert into public.preferences (student_id) values (v_sid);
    insert into public.enrollments (student_id, curriculum_id, period_label) values (v_sid, v_cur, v_per);
  end if;
  if v_sid is not null then
    update secure.telegram_identities ti set username = coalesce(p_username, ti.username) where ti.telegram_user_id = p_tg_user;
    update secure.student_pii sp set display_name = v_name, updated_at = now()
     where sp.student_id = v_sid and sp.display_name is null and v_name is not null;   -- koordinatör yazdıysa dokunulmaz
    select e.id into v_eid from public.enrollments e where e.student_id = v_sid and e.status = 'active' order by e.started_at desc limit 1;
    insert into public.tg_chats (chat_id, kind) values (p_chat, case when p_is_group then 'group' else 'private' end)
    on conflict do nothing;
    insert into public.chat_roles (chat_id, telegram_user_id, role, student_id) values (p_chat, p_tg_user, 'student', v_sid)
    on conflict do nothing;
  elsif v_stf is not null then
    insert into public.tg_chats (chat_id, kind) values (p_chat, case when p_is_group then 'group' else 'private' end)
    on conflict do nothing;
    insert into public.chat_roles as cr (chat_id, telegram_user_id, role, staff_id, mention_handle)
    select p_chat, p_tg_user, s.role, s.id, coalesce(ti.mention_handle, '@' || p_username)
      from public.staff s join secure.telegram_identities ti on ti.staff_id = s.id
     where s.id = v_stf and ti.telegram_user_id = p_tg_user
    on conflict (chat_id, telegram_user_id) do update
       set role = excluded.role, staff_id = excluded.staff_id, student_id = null,
           mention_handle = coalesce(excluded.mention_handle, cr.mention_handle);
  end if;
  select r.role into v_role from public.chat_roles r where r.chat_id = p_chat and r.telegram_user_id = p_tg_user;
  if v_sid is null then
    return query select null::uuid, null::text, null::boolean, null::text, null::uuid, false, v_role, v_stf, null::text, null::text;
    return;
  end if;
  return query
  select s.id, s.public_ref, s.is_minor, s.status, v_eid, public.consent_ok(s.id), v_role, v_stf, s.tier, qt.service_level
    from public.students s join public.quota_tiers qt on qt.tier = s.tier
   where s.id = v_sid;
end
$$;
comment on function public.resolve_telegram(bigint, bigint, text, boolean, boolean, text, text) is 'Telegram kullanıcısını öğrenci/personel kimliğine çözer; özel sohbette ilk temasta öğrenci + kayıt yaratır (OGR-ENR-001).';
grant execute on function public.resolve_telegram(bigint, bigint, text, boolean, boolean, text, text) to bot_runtime;

create function public.record_student_consent(p_kind text, p_legal_text uuid, p_evidence jsonb) returns uuid
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sid uuid := app.current_student();
  v_cid uuid;
begin  -- bot yalnız öğrencinin KENDİ beyanını yazabilir; veli onayı buradan yazılamaz
  if app.jwt_role() <> 'bot_runtime' or v_sid is null then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-001 öğrenci başlığı gerekli';
  end if;
  if p_kind not in ('kvkk_aydinlatma', 'grup_kayit') then
    raise exception using errcode = 'P0001', message = 'OGR-CONS-001 bu onay türü botla verilemez';
  end if;
  if p_evidence ->> 'chat_id' is null or p_evidence ->> 'message_id' is null then
    raise exception using errcode = 'P0001', message = 'OGR-CONS-002 kanıt eksik';
  end if;
  if not exists (select 1 from public.legal_texts lt where lt.id = p_legal_text and lt.kind = p_kind) then
    raise exception using errcode = 'P0001', message = 'OGR-CONS-005 metin sürümü onay türüyle uyuşmuyor';
  end if;
  insert into public.consents as c (student_id, kind, legal_text_id, method, given_by, evidence)
  values (v_sid, p_kind, p_legal_text, 'telegram_button', 'student', p_evidence)
  on conflict (student_id, kind) where status = 'given'
  do update set legal_text_id = excluded.legal_text_id, evidence = excluded.evidence, given_at = now()
  returning c.id into v_cid;
  update public.students s set status = case when public.consent_ok(s.id) then 'active' else 'pending_consent' end
   where s.id = v_sid and s.status in ('pending_consent', 'active');
  return v_cid;
end
$$;
comment on function public.record_student_consent(text, uuid, jsonb) is 'Öğrencinin kendi Telegram onay düğmesi (kvkk_aydinlatma, grup_kayit); kanıt zorunlu.';
grant execute on function public.record_student_consent(text, uuid, jsonb) to bot_runtime;

create function public.mint_guardian_code(p_student uuid, p_channel text) returns text
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_code text;
begin
  if app.jwt_role() <> 'authenticated' or not app.can_edit_student(p_student) then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  if p_channel not in ('telegram', 'web') then
    raise exception using errcode = 'P0001', message = 'OGR-CONS-004 kanal telegram|web';
  end if;
  v_code := upper(app.base32_random(8));   -- 'K7F3-2QX9' biçimi Worker/panelde
  insert into secure.guardian_codes (student_id, code_hash, channel, created_by, expires_at)
  values (p_student, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), p_channel, app.uid(), now() + interval '72 hours');
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:mint_guardian_code', 'students', p_student::text);
  return v_code;   -- yalnız bu kez döner; DB'de hash
end
$$;
comment on function public.mint_guardian_code(uuid, text) is 'Veli onay kodu üretir (72 saat, tek kullanım); kod yalnız bir kez döner.';
grant execute on function public.mint_guardian_code(uuid, text) to authenticated;

create function public.redeem_guardian_code(p_code text, p_guardian_tg bigint, p_evidence jsonb) returns boolean
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_gc secure.guardian_codes%rowtype;
  v_lt uuid;
begin
  if app.jwt_role() <> 'bot_runtime' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-001 yalnız bot_runtime';
  end if;
  select g.* into v_gc from secure.guardian_codes g
   where g.code_hash = encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')), 'UTF8')), 'hex')
     and g.channel = 'telegram' and g.used_at is null and g.expires_at > now()
   for update;
  if not found then
    return false;
  end if;
  if exists (select 1 from secure.telegram_identities ti where ti.telegram_user_id = p_guardian_tg and ti.student_id = v_gc.student_id) then
    raise exception using errcode = 'P0001', message = 'OGR-CONS-003 öğrenci kendi velisi olamaz';
  end if;
  select lt.id into v_lt from public.legal_texts lt where lt.kind = 'veli_onayi' order by lt.effective_from desc limit 1;
  if v_lt is null then
    raise exception using errcode = 'P0001', message = 'OGR-CONS-006 veli onay metni yok';
  end if;
  update secure.guardian_codes g set used_at = now(), used_by_telegram_user_id = p_guardian_tg where g.id = v_gc.id;
  insert into public.consents as c (student_id, kind, legal_text_id, method, given_by, evidence)
  values (v_gc.student_id, 'veli_onayi', v_lt, 'guardian_code', 'guardian', coalesce(p_evidence, '{}') || jsonb_build_object('code_id', v_gc.id))
  on conflict (student_id, kind) where status = 'given'
  do update set legal_text_id = excluded.legal_text_id, method = excluded.method, given_by = excluded.given_by,
                evidence = excluded.evidence, given_at = now();
  update public.students s set status = case when public.consent_ok(s.id) then 'active' else 'pending_consent' end
   where s.id = v_gc.student_id and s.status in ('pending_consent', 'active');
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values ('bot_runtime', null, 'RPC:redeem_guardian_code', 'consents', v_gc.student_id::text);
  return true;
end
$$;
comment on function public.redeem_guardian_code(text, bigint, jsonb) is 'Velinin kendi Telegram hesabından /veli KOD: kodu doğrular, veli onayını yazar.';
grant execute on function public.redeem_guardian_code(text, bigint, jsonb) to bot_runtime;

-- Panel /onay?token= sayfası (anon). Kilit satır başınadır (BLUEPRINT §3.9: secure.guardian_codes.attempts):
-- doğru token + eksik form → attempts + 1; 5'te locked_until = now() + 1 saat (OGR-CONS-007, yalnız o kod).
-- Sayaç güncellemesi kalıcı olsun diye bu yol hata fırlatmaz, false döner (exception güncellemeyi geri alırdı);
-- panel formu göndermeden önce zaten doğrular. Yanlış/süresi dolmuş token satır tanımlamaz: audit.events'e
-- ok=false yazılır (izleme için) ama küresel kilit YOKTUR — anon anahtarı herkeste olduğundan küresel kilit
-- tüm ailelerin onayını kapatan bir hizmet engelleme yolu olurdu; 8 karakterlik base32 token (40 bit) ve 72 saat
-- ömür tahmini zaten pratikte imkânsız kılar.
create function public.redeem_guardian_token(p_token text, p_form jsonb) returns boolean
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_gc secure.guardian_codes%rowtype;
  v_lt uuid;
  v_name text := nullif(trim(coalesce(p_form ->> 'guardian_name', '')), '');
  v_rel text := nullif(trim(coalesce(p_form ->> 'guardian_relation', '')), '');
begin
  select g.* into v_gc from secure.guardian_codes g
   where g.code_hash = encode(sha256(convert_to(upper(regexp_replace(coalesce(p_token, ''), '[\s-]', '', 'g')), 'UTF8')), 'hex')
     and g.channel = 'web' and g.used_at is null and g.expires_at > now()
   for update;
  if not found then
    insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
    values (app.jwt_role(), null, 'RPC:redeem_guardian_token', 'consents', null, jsonb_build_object('ok', false));
    return false;
  end if;
  if v_gc.locked_until is not null and v_gc.locked_until > now() then
    raise exception using errcode = 'P0001', message = 'OGR-CONS-007 çok sayıda hatalı deneme; bir saat sonra yeniden dene';
  end if;
  if v_name is null or v_rel is null then
    update secure.guardian_codes g
       set attempts = least(g.attempts + 1, 32767),
           locked_until = case when g.attempts + 1 >= 5 then now() + interval '1 hour' else g.locked_until end
     where g.id = v_gc.id;
    insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
    values (app.jwt_role(), null, 'RPC:redeem_guardian_token', 'consents', v_gc.student_id::text,
            jsonb_build_object('ok', false, 'reason', 'OGR-CONS-008 veli adı ve yakınlığı zorunlu'));
    return false;
  end if;
  select lt.id into v_lt from public.legal_texts lt where lt.kind = 'veli_onayi' order by lt.effective_from desc limit 1;
  if v_lt is null then
    raise exception using errcode = 'P0001', message = 'OGR-CONS-006 veli onay metni yok';
  end if;
  update secure.guardian_codes g set used_at = now(), attempts = 0, locked_until = null where g.id = v_gc.id;
  update secure.student_pii sp set guardian_name = v_name, guardian_relation = v_rel, updated_at = now()
   where sp.student_id = v_gc.student_id;
  insert into public.consents as c (student_id, kind, legal_text_id, method, given_by, evidence)
  values (v_gc.student_id, 'veli_onayi', v_lt, 'web_token', 'guardian',
          jsonb_build_object('token_id', v_gc.id, 'confirmed_at', now(), 'declarations', coalesce(p_form -> 'declarations', '[]'::jsonb)))
  on conflict (student_id, kind) where status = 'given'
  do update set legal_text_id = excluded.legal_text_id, method = excluded.method, given_by = excluded.given_by,
                evidence = excluded.evidence, given_at = now();
  update public.students s set status = case when public.consent_ok(s.id) then 'active' else 'pending_consent' end
   where s.id = v_gc.student_id and s.status in ('pending_consent', 'active');
  insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
  values (app.jwt_role(), null, 'RPC:redeem_guardian_token', 'consents', v_gc.student_id::text, jsonb_build_object('ok', true));
  return true;
end
$$;
comment on function public.redeem_guardian_token(text, jsonb) is 'Veli web onayı (anon): token doğrulanır, veli adı/yakınlığı yazılır, veli onayı kaydedilir; hatalı denemede kilit.';
grant execute on function public.redeem_guardian_token(text, jsonb) to anon;

create function public.set_birth_year(p_year smallint) returns boolean
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sid uuid := app.current_student();
  v_minor boolean;
begin
  if app.jwt_role() <> 'bot_runtime' or v_sid is null then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-001 öğrenci başlığı gerekli';
  end if;
  if p_year is not null and (p_year < 1950 or p_year > extract(year from current_date)::int) then
    raise exception using errcode = 'P0001', message = 'OGR-PII-002 doğum yılı geçersiz';
  end if;
  update secure.student_pii sp set birth_year = p_year, updated_at = now() where sp.student_id = v_sid;
  v_minor := (p_year is null) or (extract(year from current_date)::int - p_year < 18);
  update public.students s set is_minor = v_minor where s.id = v_sid;
  return v_minor;
end
$$;
comment on function public.set_birth_year(smallint) is 'Yaş beyanını yazar ve is_minor''u yeniden hesaplar.';
grant execute on function public.set_birth_year(smallint) to bot_runtime;

create function public.update_student_pii(p_student uuid, p_fields jsonb) returns void
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_allowed text[] := array['display_name', 'school', 'grade', 'guardian_name', 'guardian_relation', 'guardian_contact'];
  v_k text;
begin  -- koordinatör/eğitmen panel /onaylar düzenleme formu; bot_runtime ve batch_worker için OGR-AUTH-002
  if app.jwt_role() <> 'authenticated' or not app.can_edit_student(p_student) then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  for v_k in select jsonb_object_keys(p_fields) loop
    if not (v_k = any(v_allowed)) then
      raise exception using errcode = 'P0001', message = format('OGR-PII-001 alan izinli değil %s', v_k);
    end if;
  end loop;
  insert into secure.student_pii (student_id) values (p_student) on conflict do nothing;
  update secure.student_pii sp set
    display_name = coalesce(p_fields ->> 'display_name', sp.display_name),
    school = coalesce(p_fields ->> 'school', sp.school),
    grade = coalesce(p_fields ->> 'grade', sp.grade),
    guardian_name = coalesce(p_fields ->> 'guardian_name', sp.guardian_name),
    guardian_relation = coalesce(p_fields ->> 'guardian_relation', sp.guardian_relation),
    guardian_contact = coalesce(p_fields ->> 'guardian_contact', sp.guardian_contact),
    updated_at = now()
   where sp.student_id = p_student;   -- app.refresh_name_hashes() hash'leri yeniler
  insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:update_student_pii', 'students', p_student::text,
          (select jsonb_agg(k.key) from jsonb_object_keys(p_fields) as k (key)));   -- diff yalnız alan ADLARI
end
$$;
comment on function public.update_student_pii(uuid, jsonb) is 'Panelden öğrenci kişisel verisini düzenler (izinli alanlar); audit yalnız alan adlarını yazar.';
grant execute on function public.update_student_pii(uuid, jsonb) to authenticated;

create function public.student_full_name(p_student uuid) returns text
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_name text;
begin
  if app.jwt_role() <> 'authenticated' or app.staff_role() is distinct from 'coordinator' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select sp.display_name into v_name from secure.student_pii sp where sp.student_id = p_student;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:student_full_name', 'students', p_student::text);
  return v_name;
end
$$;
comment on function public.student_full_name(uuid) is 'Tam ad (yalnız koordinatör, /onay sayfası); her okuma audit''e yazılır.';
grant execute on function public.student_full_name(uuid) to authenticated;

-- Eğitmen Telegram bağlantısı: mevcut chat_roles satırları güncellenir → sender_role='instructor', /hoca etiketi,
-- open_escalation hedefi, consume_staff_quota çalışır
create function public.link_staff_telegram(p_staff uuid, p_telegram_user_id bigint, p_username text, p_mention_handle text) returns void
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_handle text := coalesce(p_mention_handle, '@' || p_username);
begin
  if app.jwt_role() <> 'authenticated' or app.staff_role() is distinct from 'coordinator' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  if not exists (select 1 from public.staff s where s.id = p_staff and s.active) then
    raise exception using errcode = 'P0001', message = 'OGR-STAFF-001 personel yok';
  end if;
  if exists (select 1 from secure.telegram_identities ti where ti.telegram_user_id = p_telegram_user_id and ti.student_id is not null) then
    raise exception using errcode = 'P0001', message = 'OGR-STAFF-002 bu Telegram hesabı bir öğrenciye bağlı';
  end if;
  delete from secure.telegram_identities ti where ti.staff_id = p_staff and ti.telegram_user_id <> p_telegram_user_id;
  insert into secure.telegram_identities as ti (telegram_user_id, staff_id, username, mention_handle)
  values (p_telegram_user_id, p_staff, p_username, v_handle)
  on conflict (telegram_user_id) do update
     set staff_id = excluded.staff_id, username = excluded.username, mention_handle = excluded.mention_handle, linked_at = now();
  update public.chat_roles cr set role = s.role, staff_id = s.id, student_id = null, mention_handle = v_handle
    from public.staff s where s.id = p_staff and cr.telegram_user_id = p_telegram_user_id;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:link_staff_telegram', 'staff', p_staff::text);
end
$$;
comment on function public.link_staff_telegram(uuid, bigint, text, text) is 'Koordinatör: eğitmenin Telegram kimliğini bağlar ve sohbet rollerini günceller.';
grant execute on function public.link_staff_telegram(uuid, bigint, text, text) to authenticated;

create function public.mint_staff_code(p_staff uuid) returns text
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_code text;
begin
  if app.jwt_role() <> 'authenticated' or app.staff_role() is distinct from 'coordinator' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  if not exists (select 1 from public.staff s where s.id = p_staff and s.active) then
    raise exception using errcode = 'P0001', message = 'OGR-STAFF-001 personel yok';
  end if;
  v_code := upper(app.base32_random(8));
  insert into secure.staff_codes (staff_id, code_hash, created_by, expires_at)
  values (p_staff, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), app.uid(), now() + interval '72 hours');
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:mint_staff_code', 'staff', p_staff::text);
  return v_code;
end
$$;
comment on function public.mint_staff_code(uuid) is 'Koordinatör: eğitmen Telegram bağlama kodu üretir (72 saat; yalnız bir kez döner).';
grant execute on function public.mint_staff_code(uuid) to authenticated;

-- /egitmen KOD (özel sohbet; eğitmen öğrenci olarak yaratılmaz)
create function public.redeem_staff_code(p_code text, p_tg_user bigint, p_username text) returns boolean
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sc secure.staff_codes%rowtype;
  v_handle text := '@' || p_username;
begin
  if app.jwt_role() <> 'bot_runtime' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-001 yalnız bot_runtime';
  end if;
  select c.* into v_sc from secure.staff_codes c
   where c.code_hash = encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')), 'UTF8')), 'hex')
     and c.used_at is null and c.expires_at > now()
   for update;
  if not found then
    return false;
  end if;
  if exists (select 1 from secure.telegram_identities ti where ti.telegram_user_id = p_tg_user and ti.student_id is not null) then
    raise exception using errcode = 'P0001', message = 'OGR-STAFF-002 bu Telegram hesabı bir öğrenciye bağlı';
  end if;
  if not exists (select 1 from public.staff s where s.id = v_sc.staff_id and s.active) then
    return false;
  end if;
  delete from secure.telegram_identities ti where ti.staff_id = v_sc.staff_id and ti.telegram_user_id <> p_tg_user;
  insert into secure.telegram_identities as ti (telegram_user_id, staff_id, username, mention_handle)
  values (p_tg_user, v_sc.staff_id, p_username, v_handle)
  on conflict (telegram_user_id) do update
     set staff_id = excluded.staff_id, username = excluded.username, mention_handle = excluded.mention_handle, linked_at = now();
  update public.chat_roles cr set role = s.role, staff_id = s.id, student_id = null, mention_handle = v_handle
    from public.staff s where s.id = v_sc.staff_id and cr.telegram_user_id = p_tg_user;
  update secure.staff_codes c set used_at = now(), used_by_telegram_user_id = p_tg_user where c.id = v_sc.id;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values ('bot_runtime', null, 'RPC:redeem_staff_code', 'staff', v_sc.staff_id::text);
  return true;
end
$$;
comment on function public.redeem_staff_code(text, bigint, text) is 'Eğitmenin kendi Telegram hesabından /egitmen KOD: kodu doğrular, hesabı personele bağlar.';
grant execute on function public.redeem_staff_code(text, bigint, text) to bot_runtime;

-- Sohbetteki personelin ad-token hash'leri (düz ad dönmez)
create or replace function app.staff_name_hashes(p_chat bigint) returns text[]
language sql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
  select coalesce(array_agg(distinct h.hash), '{}'::text[])
    from public.chat_roles as cr
    join public.staff as s on s.id = cr.staff_id
    cross join lateral unnest(app.pii_name_token_hashes(s.full_name)) as h (hash)
   where cr.chat_id = p_chat
$$;
comment on function app.staff_name_hashes(bigint) is 'Sohbetteki personelin ad-token sha256 hash''leri (app.pii_name_token_hashes); düz ad dönmez.';
revoke all on function app.staff_name_hashes(bigint) from public;

-- scrub için: sohbet üyelerinin (öğrenci + personel) ad-token hash'leri; Worker tek çağrı yapar
create function public.name_token_hashes(p_chat bigint) returns text[]
language sql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
  select coalesce(array_agg(distinct x.hash order by x.hash), '{}'::text[])
    from (
      select h.hash
        from public.chat_roles as cr
        join secure.student_pii as pii on pii.student_id = cr.student_id
        cross join lateral unnest(pii.name_token_hashes) as h (hash)
       where cr.chat_id = p_chat
      union
      select sh.hash from unnest(app.staff_name_hashes(p_chat)) as sh (hash)
    ) as x
   where app.jwt_role() = 'bot_runtime'
$$;
comment on function public.name_token_hashes(bigint) is 'Sohbet üyelerinin ad-token hash''leri (öğrenci + personel birleşik); yalnız bot_runtime.';
grant execute on function public.name_token_hashes(bigint) to bot_runtime;

create function public.record_staff_consent(p_student uuid, p_kind text, p_method text, p_evidence jsonb) returns uuid
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_lt uuid;
  v_cid uuid;
begin  -- koordinatör/eğitmen: kâğıt form ya da panel beyanı (veli onayı dahil); bot bu yolu kullanamaz
  if app.jwt_role() <> 'authenticated' or not app.can_edit_student(p_student) then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  if p_method not in ('paper', 'panel') then
    raise exception using errcode = 'P0001', message = 'OGR-CONS-004 yöntem paper|panel';
  end if;
  if p_kind not in ('kvkk_aydinlatma', 'veli_onayi', 'grup_kayit', 'ders_kaydi') then
    raise exception using errcode = 'P0001', message = 'OGR-CONS-001 onay türü geçersiz';
  end if;
  select lt.id into v_lt from public.legal_texts lt where lt.kind = p_kind order by lt.effective_from desc limit 1;
  if v_lt is null then
    raise exception using errcode = 'P0001', message = 'OGR-CONS-006 bu tür için hukuk metni yok';
  end if;
  insert into public.consents as c (student_id, kind, legal_text_id, method, given_by, evidence)
  values (p_student, p_kind, v_lt, p_method, 'staff:' || app.uid(), coalesce(p_evidence, '{}'))
  on conflict (student_id, kind) where status = 'given'
  do update set legal_text_id = excluded.legal_text_id, method = excluded.method, given_by = excluded.given_by,
                evidence = excluded.evidence, given_at = now()
  returning c.id into v_cid;
  update public.students s set status = case when public.consent_ok(s.id) then 'active' else 'pending_consent' end
   where s.id = p_student and s.status in ('pending_consent', 'active');
  insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:record_staff_consent', 'consents', p_student::text,
          jsonb_build_object('kind', p_kind, 'method', p_method));
  return v_cid;
end
$$;
comment on function public.record_staff_consent(uuid, text, text, jsonb) is 'Personelin kâğıt/panel onay girişi; öğrenci durumu yeniden hesaplanır; audit.';
grant execute on function public.record_staff_consent(uuid, text, text, jsonb) to authenticated;

-- /sil: silme talebi → koordinatöre yükseltme; 30 gün sonra students.anonymize
create function public.request_deletion() returns void
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sid uuid := app.current_student();
  v_chat bigint;
  v_coord uuid;
begin
  if app.jwt_role() <> 'bot_runtime' or v_sid is null then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-001 öğrenci başlığı gerekli';
  end if;
  update public.students s set status = 'deleted', deleted_at = coalesce(s.deleted_at, now()) where s.id = v_sid;
  select cr.chat_id into v_chat from public.chat_roles cr join public.tg_chats t on t.chat_id = cr.chat_id
   where cr.student_id = v_sid and t.kind = 'private' order by cr.joined_at limit 1;
  select s.id into v_coord from public.staff s where s.role = 'coordinator' and s.active order by s.created_at limit 1;
  if not exists (select 1 from public.escalations e where e.student_id = v_sid and e.reason = 'deletion_request' and e.status = 'open') then
    insert into public.escalations (chat_id, student_id, reason, question_text, target_staff_id)
    values (coalesce(v_chat, 0), v_sid, 'deletion_request', 'Öğrenci verilerinin silinmesini istedi.', v_coord);
  end if;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values ('bot_runtime', null, 'RPC:request_deletion', 'students', v_sid::text);
end
$$;
comment on function public.request_deletion() is 'Öğrencinin silme talebi: students.deleted_at, koordinatöre deletion_request yükseltmesi.';
grant execute on function public.request_deletion() to bot_runtime;

-- Kota ve harcama ------------------------------------------------------------------------------------

create function public.consume_quota(p_kind text)
returns table (allowed boolean, used int, daily_limit int, remaining int, warn boolean)
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sid uuid := app.current_student();
  v_lim int;
  v_warn_at int;
  v_day date := (now() at time zone 'Europe/Istanbul')::date;
  v_used int;
  v_warned boolean;
begin
  if app.jwt_role() <> 'bot_runtime' or v_sid is null then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-001 öğrenci başlığı gerekli';
  end if;
  select q.daily_limit, q.warn_at_remaining into v_lim, v_warn_at
    from public.quota_limits q join public.students s on s.tier = q.tier
   where s.id = v_sid and q.kind = p_kind;
  if v_lim is null then
    raise exception using errcode = 'P0001', message = format('OGR-QUOTA-001 kota tanımsız %s', p_kind);
  end if;
  insert into public.quota_usage (student_id, day, kind, used) values (v_sid, v_day, p_kind, 0)
  on conflict (student_id, day, kind) where student_id is not null do nothing;
  update public.quota_usage u set used = u.used + 1
   where u.student_id = v_sid and u.day = v_day and u.kind = p_kind and u.used < v_lim
  returning u.used, u.warned into v_used, v_warned;
  if not found then
    select u.used into v_used from public.quota_usage u where u.student_id = v_sid and u.day = v_day and u.kind = p_kind;
    return query select false, v_used, v_lim, 0, false;
    return;
  end if;
  if v_lim - v_used = v_warn_at and not v_warned then
    update public.quota_usage u set warned = true where u.student_id = v_sid and u.day = v_day and u.kind = p_kind;
    return query select true, v_used, v_lim, v_lim - v_used, true;
  else
    return query select true, v_used, v_lim, v_lim - v_used, false;
  end if;
end
$$;
comment on function public.consume_quota(text) is 'Öğrencinin günlük kotasından bir birim düşer (gün sınırı 00:00 Europe/Istanbul); kalan ve tek seferlik uyarı döner.';
grant execute on function public.consume_quota(text) to bot_runtime;

create function public.consume_staff_quota(p_chat bigint, p_tg_user bigint, p_kind text)
returns table (allowed boolean, used int, daily_limit int, remaining int, warn boolean)
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_stf uuid;
  v_lim int;
  v_warn_at int;
  v_day date := (now() at time zone 'Europe/Istanbul')::date;
  v_used int;
  v_warned boolean;
begin  -- eğitmen/koordinatörün bota sorusu: öğrenci başlığı yok; personel chat_roles üzerinden, kota 'staff' katmanından
  if app.jwt_role() <> 'bot_runtime' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-001 yalnız bot_runtime';
  end if;
  select cr.staff_id into v_stf from public.chat_roles cr join public.staff s on s.id = cr.staff_id and s.active
   where cr.chat_id = p_chat and cr.telegram_user_id = p_tg_user;
  if v_stf is null then
    raise exception using errcode = 'P0001', message = 'OGR-QUOTA-002 personel değil';
  end if;
  select q.daily_limit, q.warn_at_remaining into v_lim, v_warn_at from public.quota_limits q where q.tier = 'staff' and q.kind = p_kind;
  if v_lim is null then
    raise exception using errcode = 'P0001', message = format('OGR-QUOTA-001 kota tanımsız %s', p_kind);
  end if;
  insert into public.quota_usage (staff_id, day, kind, used) values (v_stf, v_day, p_kind, 0)
  on conflict (staff_id, day, kind) where staff_id is not null do nothing;
  update public.quota_usage u set used = u.used + 1
   where u.staff_id = v_stf and u.day = v_day and u.kind = p_kind and u.used < v_lim
  returning u.used, u.warned into v_used, v_warned;
  if not found then
    select u.used into v_used from public.quota_usage u where u.staff_id = v_stf and u.day = v_day and u.kind = p_kind;
    return query select false, v_used, v_lim, 0, false;
    return;
  end if;
  return query select true, v_used, v_lim, v_lim - v_used, (v_lim - v_used = v_warn_at);
end
$$;
comment on function public.consume_staff_quota(bigint, bigint, text) is 'Personelin bota sorusu için staff katmanı kotası (chat_roles.staff_id ile çözülür).';
grant execute on function public.consume_staff_quota(bigint, bigint, text) to bot_runtime;

-- İKİ BÜTÇE: (1) sohbet/toplu — cap_excluded_purposes DIŞINDAKİ amaçlar; state yalnız bundan türer.
-- (2) ders — cap_excluded_purposes (lesson_analysis, transcribe, diarize) için aylık lesson_monthly_cap_usd;
-- yalnız bu amaçların paid_allowed'ını etkiler, state'i ETKİLEMEZ.
create function public.check_spend(p_purpose text)
returns table (
  paid_allowed boolean, degraded boolean, day_usd numeric, month_usd numeric, daily_cap numeric, monthly_cap numeric,
  state text, lesson_month_usd numeric, lesson_cap numeric
)
language plpgsql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_d numeric;
  v_m numeric;
  v_ml numeric;
  v_dc numeric;
  v_mc numeric;
  v_lc numeric;
  v_paid boolean;
  v_deg boolean;
  v_excluded text[];
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_month date := date_trunc('month', (now() at time zone 'Europe/Istanbul')::date)::date;
  v_is_lesson boolean;
  v_chat_ok boolean;
begin
  select coalesce(array_agg(x.purpose), '{}') into v_excluded
    from public.runtime_flags rf cross join lateral jsonb_array_elements_text(rf.value) as x (purpose)
   where rf.key = 'cap_excluded_purposes' and jsonb_typeof(rf.value) = 'array';
  v_is_lesson := p_purpose = any(v_excluded);
  select coalesce(sum(sl.cost_usd), 0) into v_d from public.spend_ledger sl where sl.day = v_today and not (sl.purpose = any(v_excluded));
  select coalesce(sum(sl.cost_usd), 0) into v_m from public.spend_ledger sl where sl.day >= v_month and not (sl.purpose = any(v_excluded));
  select coalesce(sum(sl.cost_usd), 0) into v_ml from public.spend_ledger sl where sl.day >= v_month and sl.purpose = any(v_excluded);
  select (rf.value)::numeric into v_dc from public.runtime_flags rf where rf.key = 'daily_cap_usd';
  select (rf.value)::numeric into v_mc from public.runtime_flags rf where rf.key = 'monthly_cap_usd';
  select (rf.value)::numeric into v_lc from public.runtime_flags rf where rf.key = 'lesson_monthly_cap_usd';
  select (rf.value)::boolean into v_paid from public.runtime_flags rf where rf.key = 'paid_llm_enabled';
  select (rf.value)::boolean into v_deg from public.runtime_flags rf where rf.key = 'degraded_mode';
  v_dc := coalesce(v_dc, 0.80);
  v_mc := coalesce(v_mc, 24.00);
  v_lc := coalesce(v_lc, 30.00);
  v_paid := coalesce(v_paid, false);   -- bayrak yoksa güvenli taraf: ücretli çağrı yok
  v_deg := coalesce(v_deg, false);
  v_chat_ok := v_paid and v_d < v_dc and v_m < v_mc;
  return query select
    case when v_is_lesson then (v_paid and v_ml < v_lc) else v_chat_ok end,
    v_deg, v_d, v_m, v_dc, v_mc,
    case when v_deg then 'degraded' when not v_chat_ok then 'free_only' else 'normal' end,
    v_ml, v_lc;
end
$$;
comment on function public.check_spend(text) is 'Tavan kapısı: sohbet/toplu bütçe (ders amaçları hariç) ve ayrı ders bütçesi; state normal|free_only|degraded.';
grant execute on function public.check_spend(text) to bot_runtime, batch_worker, authenticated;

create function public.set_runtime_flag(p_key text, p_value jsonb) returns void
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_role text := app.jwt_role();
begin
  if v_role = 'authenticated' and app.staff_role() is distinct from 'coordinator' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  if v_role in ('bot_runtime', 'batch_worker')
     and p_key not in ('alerts_sent', 'degraded_mode', 'facts_lag_days', 'storage_pressure')
     and not (v_role = 'batch_worker' and p_key = 'paid_llm_enabled' and p_value = 'false'::jsonb) then
    -- cost-guard.yml kill-switch TEK YÖNLÜ: true'ya dönüş koordinatörün işi (panel /maliyet)
    raise exception using errcode = 'P0001', message = format('OGR-AUTH-003 bu rol %s bayrağını değiştiremez', p_key);
  end if;
  insert into public.runtime_flags as rf (key, value, updated_by)
  values (p_key, p_value, v_role || ':' || coalesce(app.uid()::text, ''))
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
  values (v_role, coalesce('staff:' || app.uid()::text, v_role), 'RPC:set_runtime_flag', 'runtime_flags', p_key, p_value);
end
$$;
comment on function public.set_runtime_flag(text, jsonb) is 'Çalışma bayrağı yazar; bot/batch yalnız dört işletim bayrağını, batch ayrıca paid_llm_enabled=false (tek yönlü) yazabilir.';
grant execute on function public.set_runtime_flag(text, jsonb) to authenticated, bot_runtime, batch_worker;

-- Saatlik tutarlılık: spend_ledger'ı llm_calls'tan yeniden hesaplar (son 40 gün); düzeltilen satır sayısını döner
create function public.rollup_spend() returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_n int;
begin
  if app.jwt_role() in ('authenticated', 'anon') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  with agg as (
    select (lc.created_at at time zone 'Europe/Istanbul')::date as day, lc.purpose, lc.provider,
           count(*)::int as calls, sum(lc.tokens_in)::bigint as tin, sum(lc.tokens_out)::bigint as tout, sum(lc.cost_usd) as cost
      from public.llm_calls lc
     where lc.created_at >= now() - interval '40 days'
     group by 1, 2, 3
  ), upd as (
    insert into public.spend_ledger as sl (day, purpose, provider, calls, tokens_in, tokens_out, cost_usd)
    select a.day, a.purpose, a.provider, a.calls, a.tin, a.tout, a.cost from agg a
    on conflict (day, purpose, provider) do update
       set calls = excluded.calls, tokens_in = excluded.tokens_in, tokens_out = excluded.tokens_out, cost_usd = excluded.cost_usd
     where sl.calls is distinct from excluded.calls or sl.cost_usd is distinct from excluded.cost_usd
        or sl.tokens_in is distinct from excluded.tokens_in or sl.tokens_out is distinct from excluded.tokens_out
    returning 1
  )
  select count(*) into v_n from upd;
  return v_n;
end
$$;
comment on function public.rollup_spend() is 'spend_ledger toplamlarını llm_calls ile eşitler (son 40 gün); düzeltilen satır sayısı.';

-- Puanlama: cevap anahtarı tek kapı ---------------------------------------------------------------------

create function public.grade_attempt(
  p_enrollment uuid, p_question uuid, p_chosen jsonb, p_context text, p_session uuid, p_response_ms int
)
returns table (
  is_correct boolean, misconception_tag text, feedback_student text, feedback_pool_id uuid, mastery_p numeric,
  evidence_count int, is_reliable boolean, prereq_hint text
)
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_q public.questions%rowtype;
  v_k secure.answer_keys%rowtype;
  v_correct boolean;
  v_tag text;
  v_att bigint;
  v_obs bigint;
  v_sk text;
  v_cnt smallint;
  v_mp numeric;
  v_mn int;
  v_pool uuid;
  v_hint text;
  v_sid uuid;
  v_min int;
begin  -- yerel adlar v_ önekli: dönüş sütunları ve tablo sütunlarıyla çakışma yok (§3.9 yazım kuralı)
  v_sid := app.enrollment_student(p_enrollment);
  if v_sid is null then
    raise exception using errcode = 'P0001', message = 'OGR-GRADE-005 kayıt yok';
  end if;
  if app.jwt_role() = 'bot_runtime' and v_sid is distinct from app.current_student() then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-004 başka öğrenci';
  end if;
  if app.jwt_role() = 'authenticated' and not app.can_edit_student(v_sid) then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  if p_context not in ('diagnostic', 'practice', 'test') then
    raise exception using errcode = 'P0001', message = format('OGR-GRADE-006 bağlam geçersiz %s', p_context);
  end if;
  select q.* into v_q from public.questions q where q.id = p_question and q.status = 'approved';
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-GRADE-003 onaysız soru';
  end if;
  if p_session is not null and exists (select 1 from public.attempts a where a.session_id = p_session and a.question_id = p_question) then
    raise exception using errcode = 'P0001', message = 'OGR-GRADE-002 zaten cevaplandı';
  end if;
  select k.* into v_k from secure.answer_keys k where k.question_id = p_question;   -- yalnız burada okunur
  if not found then
    -- null anahtarla "her cevap yanlış" sessiz hatası YOK
    raise exception using errcode = 'P0001', message = 'OGR-GRADE-004 cevap anahtarı yok';
  end if;
  -- eksik anahtar (mcq'da doğru şık null, numeric'te ayrıştırılamayan değer) da açık hata: null = null "doğru" sayılmaz
  if not app.answer_key_complete(v_q.kind, v_k.correct_option::text, v_k.numeric_value) then
    raise exception using errcode = 'P0001', message = 'OGR-GRADE-004 cevap anahtarı eksik';
  end if;
  if v_q.kind = 'mcq' then
    v_correct := coalesce((p_chosen ->> 'key') = v_k.correct_option::text, false);
    if not v_correct then
      select o.opt ->> 'misconception_tag' into v_tag
        from jsonb_array_elements(v_q.options) as o (opt)
       where o.opt ->> 'key' = p_chosen ->> 'key';
    end if;
  else
    v_correct := app.numeric_equal(p_chosen ->> 'value', v_k.numeric_value, v_k.numeric_tolerance);
  end if;
  select coalesce(max(a.attempt_no), 0) + 1 into v_cnt from public.attempts a where a.enrollment_id = p_enrollment and a.question_id = p_question;
  perform set_config('ogrenmen.grader', 'on', true);
  insert into public.attempts (enrollment_id, question_id, context, session_id, chosen, attempt_no, is_correct, misconception_tag, graded_at, response_ms)
  values (p_enrollment, p_question, p_context, p_session, p_chosen, v_cnt, v_correct, v_tag, now(), p_response_ms)
  returning id into v_att;
  perform set_config('ogrenmen.grader', 'off', true);   -- koruma işlemin geri kalanında yeniden açık
  foreach v_sk in array v_q.skill_ids loop
    insert into public.observations (enrollment_id, skill_id, kind, value, weight, source_type, source_id, source_locator,
                                     misconception_tag, guess_override, counts_for_mastery, created_by_role)
    values (p_enrollment, v_sk, p_context, case when v_correct then 1 else 0 end, 1.0, 'attempt', v_att::text,
            case when p_context = 'diagnostic'
                 then 'Teşhis · Soru ' || coalesce((select array_position(t.item_ids, p_question)::text
                                                     from public.diagnostic_sessions ds join public.diagnostic_tests t on t.id = ds.test_id
                                                    where ds.id = p_session), '?')
                 else 'Pratik · ' || left(p_question::text, 8) end,
            v_tag, case when v_q.kind = 'numeric' then 0.05 end, v_cnt = 1, app.jwt_role())
    returning id into v_obs;   -- yalnız ilk deneme ustalığa sayılır; numeric → g=0.05; curriculum_id tetikleyiciden
    perform public.apply_observation(v_obs);
  end loop;
  select m.p, m.evidence_count into v_mp, v_mn from public.mastery m where m.enrollment_id = p_enrollment and m.skill_id = v_q.skill_ids[1];
  select cp.id into v_pool from public.content_pool cp
   where cp.status = 'approved' and cp.curriculum_id = v_q.curriculum_id and cp.skill_id = v_q.skill_ids[1] and cp.mode = 'socratic'
     and cp.kind = case when v_correct then 'feedback_right' else 'feedback_wrong' end
     and coalesce(cp.misconception_tag, '') = coalesce(v_tag, '')
   limit 1;
  v_hint := case when not v_correct then app.infer_prereq_gap(p_enrollment, v_q.skill_ids[1]) end;
  select (st.value #>> '{}')::int into v_min from public.settings st where st.key = 'min_evidence';
  insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
  values (app.jwt_role(), null, 'RPC:grade_attempt', 'attempts', v_att::text, jsonb_build_object('correct', v_correct));
  return query select v_correct, v_tag, (select t.text_student from public.misconception_tags t where t.tag = v_tag), v_pool,
                      v_mp, v_mn, coalesce(v_mn >= coalesce(v_min, 5), false), v_hint;
  -- DÖNÜŞTE DOĞRU ŞIK YOKTUR.
end
$$;
comment on function public.grade_attempt(uuid, uuid, jsonb, text, uuid, int) is 'Tek puanlama kapısı: anahtarı secure''dan okur, deneme + gözlem yazar, ustalığı günceller; doğru şıkkı döndürmez.';
grant execute on function public.grade_attempt(uuid, uuid, jsonb, text, uuid, int) to bot_runtime, authenticated;

create function public.reveal_solution(p_enrollment uuid, p_question uuid) returns text
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sid uuid := app.enrollment_student(p_enrollment);
  v_sol text;
begin
  if app.jwt_role() = 'bot_runtime' and v_sid is distinct from app.current_student() then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-004 başka öğrenci';
  end if;
  if not exists (select 1 from public.attempts a where a.enrollment_id = p_enrollment and a.question_id = p_question) then
    return null;   -- önce cevap ver
  end if;
  select k.solution into v_sol from secure.answer_keys k where k.question_id = p_question;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values (app.jwt_role(), v_sid::text, 'RPC:reveal_solution', 'questions', p_question::text);
  return v_sol;   -- çözüm metni; correct_option alanı dönmez
end
$$;
comment on function public.reveal_solution(uuid, uuid) is 'Cevaplanmış sorunun çözüm metni (anahtar alanları dönmez); audit.';
grant execute on function public.reveal_solution(uuid, uuid) to bot_runtime;

-- LLM yolunun (batch_worker) anahtar yazabildiği TEK kapı; kilit kuralları satır durumuna bağlıdır (OGR-KEY-003)
create function public.register_answer_key(p_question uuid, p_key jsonb) returns void
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_q public.questions%rowtype;
  v_old secure.answer_keys%rowtype;
  v_had boolean;
  v_status text := p_key ->> 'sympy_status';
begin
  if app.jwt_role() <> 'batch_worker' then
    raise exception using errcode = 'P0001', message = 'OGR-KEY-001 yalnız batch_worker';
  end if;
  if v_status is null or v_status not in ('verified', 'failed', 'not_applicable') then
    raise exception using errcode = 'P0001', message = 'OGR-KEY-002 sympy_status geçersiz';
  end if;
  select q.* into v_q from public.questions q where q.id = p_question for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-KEY-004 soru yok';
  end if;
  -- (a) yalnız LLM/şablon kaynaklı ve henüz onaylanmamış soru; seed/eğitmen anahtarı KİLİTLİ
  if v_q.source not in ('llm', 'template') or v_q.status not in ('draft', 'pending_review', 'rejected') then
    raise exception using errcode = 'P0001', message = 'OGR-KEY-003 anahtar kilitli';
  end if;
  select k.* into v_old from secure.answer_keys k where k.question_id = p_question;
  v_had := found;
  if v_had and v_old.written_by not like 'batch_worker:%' then
    raise exception using errcode = 'P0001', message = 'OGR-KEY-003 anahtar kilitli';
  end if;
  if coalesce(p_key ->> 'solution', '') = '' then
    raise exception using errcode = 'P0001', message = 'OGR-KEY-005 çözüm metni zorunlu';
  end if;
  if v_status <> 'failed' and not app.answer_key_complete(v_q.kind, p_key ->> 'correct_option', p_key ->> 'numeric_value') then
    raise exception using errcode = 'P0001', message = 'OGR-KEY-005 anahtar eksik: mcq için doğru şık, numeric için sayısal cevap zorunlu';
  end if;
  -- (b) not_applicable yalnız sözel mcq (SymPy ifadesi ve sayı yok) için; aksi failed
  if v_status = 'not_applicable'
     and not (v_q.kind = 'mcq' and p_key ->> 'canonical_expr' is null and p_key ->> 'numeric_value' is null) then
    v_status := 'failed';
  end if;
  insert into secure.answer_keys as ak (question_id, correct_option, numeric_value, numeric_tolerance, canonical_expr, solution,
                                        sympy_status, sympy_report, written_by, verified_at)
  values (p_question, p_key ->> 'correct_option', p_key ->> 'numeric_value', coalesce((p_key ->> 'numeric_tolerance')::numeric, 0),
          p_key ->> 'canonical_expr', p_key ->> 'solution', v_status, p_key -> 'sympy_report',
          case when v_status = 'not_applicable' then 'batch_worker:unverified' else 'batch_worker:tablet' end,
          case when v_status = 'verified' then now() end)
  on conflict (question_id) do update
     set correct_option = excluded.correct_option, numeric_value = excluded.numeric_value,
         numeric_tolerance = excluded.numeric_tolerance, canonical_expr = excluded.canonical_expr,
         solution = excluded.solution, sympy_status = excluded.sympy_status, sympy_report = excluded.sympy_report,
         written_by = excluded.written_by, verified_at = excluded.verified_at
   where ak.written_by like 'batch_worker:%';   -- ikinci kemer: kilitli satır üzerine yazılmaz
  perform set_config('ogrenmen.reviewer', 'on', true);
  update public.questions q
     set verification = q.verification || jsonb_build_object('sympy', v_status),
         status = case when v_status = 'failed' then 'rejected' when q.status = 'draft' then 'pending_review' else q.status end,
         review_note = case when v_status = 'failed' then 'SymPy doğrulaması başarısız' else q.review_note end
   where q.id = p_question;
  perform set_config('ogrenmen.reviewer', 'off', true);
  delete from secure.answer_keys k where k.question_id = p_question and k.sympy_status = 'failed';   -- başarısız anahtar DB'de kalmaz
  -- (c) her çağrı audit'e (anahtar değeri YOK; yalnız durum)
  insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
  values ('batch_worker', 'batch_worker:tablet', 'RPC:register_answer_key', 'questions', p_question::text,
          jsonb_build_object('sympy_status', v_status, 'had_key', v_had));
end
$$;
comment on function public.register_answer_key(uuid, jsonb) is 'batch_worker anahtar kapısı: SymPy durumuna göre yazar; onaylı soru, seed ve eğitmen anahtarı kilitli (OGR-KEY-003).';
grant execute on function public.register_answer_key(uuid, jsonb) to batch_worker;

-- Şablon sorusu tek kapı (batch_worker; tablet template --auto-approve / --fill): LLM yok, anahtar SymPy ile hesaplanmış
create function public.register_template_question(p_item jsonb, p_key jsonb, p_figure jsonb) returns uuid
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_q uuid;
  v_f uuid;
  v_tpl public.question_templates%rowtype;
  v_cur uuid;
begin
  if app.jwt_role() <> 'batch_worker' then
    raise exception using errcode = 'P0001', message = 'OGR-KEY-001 yalnız batch_worker';
  end if;
  if p_item ->> 'source' is distinct from 'template' then
    raise exception using errcode = 'P0001', message = 'OGR-TPL-001 yalnız source=template';
  end if;
  select t.* into v_tpl from public.question_templates t where t.id = p_item #>> '{template,id}' and t.enabled;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-TPL-002 şablon yok ya da kapalı';
  end if;
  if p_key ->> 'sympy_status' is distinct from 'verified' then
    raise exception using errcode = 'P0001', message = 'OGR-TPL-003 şablon anahtarı SymPy ile doğrulanmış olmalı';
  end if;
  select c.id into v_cur from public.curricula c where c.code || '@' || c.version = p_item ->> 'curriculum_code';
  if v_cur is null or v_cur <> v_tpl.curriculum_id then
    raise exception using errcode = 'P0001', message = 'OGR-TPL-004 müfredat uyuşmuyor';
  end if;
  if p_figure is not null and jsonb_typeof(p_figure) = 'object' then   -- deterministik kod: vision gerekmez, şekil doğrudan verified
    insert into public.figures as f (tool, code, code_hash, alt_text, png_path, width_px, height_px, bytes,
                                     render_status, vision_status, review_status, reviewed_at)
    values ('template', p_figure ->> 'code', p_figure ->> 'code_hash', p_figure ->> 'alt_text', p_figure ->> 'png_path',
            (p_figure ->> 'width_px')::int, (p_figure ->> 'height_px')::int, (p_figure ->> 'bytes')::int,
            'rendered', 'not_applicable', 'verified', now())
    on conflict (code_hash) do update set png_path = excluded.png_path
    returning f.id into v_f;
  elsif v_tpl.has_figure then
    raise exception using errcode = 'P0001', message = 'OGR-TPL-005 şablon şekil bekliyor';
  end if;
  insert into public.questions as q (curriculum_id, skill_ids, kind, stem, stem_values, figure_id, options, difficulty, source,
                                     template_id, template_params, content_hash, verification, status)
  values (v_cur, (select array_agg(x.sid) from jsonb_array_elements_text(p_item -> 'skill_ids') as x (sid)), p_item ->> 'kind',
          p_item ->> 'stem', coalesce(p_item -> 'stem_values', '{}'), v_f, p_item -> 'options', (p_item ->> 'difficulty')::numeric,
          'template', v_tpl.id, p_item #> '{template,params}', p_item ->> 'content_hash',
          coalesce(p_item -> 'verification', '{}') || '{"sympy":"verified","render":"ok","vision":"not_applicable"}'::jsonb,
          'pending_review')
  on conflict (content_hash) do nothing
  returning q.id into v_q;
  if v_q is null then
    return null;   -- aynı varyant zaten var
  end if;
  insert into secure.answer_keys (question_id, correct_option, numeric_value, numeric_tolerance, canonical_expr, solution,
                                  sympy_status, sympy_report, written_by, verified_at)
  values (v_q, p_key ->> 'correct_option', p_key ->> 'numeric_value', coalesce((p_key ->> 'numeric_tolerance')::numeric, 0),
          p_key ->> 'canonical_expr', p_key ->> 'solution', 'verified', p_key -> 'sympy_report', 'batch_worker:template', now());
  perform set_config('ogrenmen.reviewer', 'on', true);
  update public.questions q set status = 'approved', reviewed_at = now(), review_note = 'şablon: otomatik onay' where q.id = v_q;
  perform set_config('ogrenmen.reviewer', 'off', true);
  insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
  values ('batch_worker', 'batch_worker:tablet', 'RPC:register_template_question', 'questions', v_q::text,
          jsonb_build_object('template_id', v_tpl.id));
  return v_q;
end
$$;
comment on function public.register_template_question(jsonb, jsonb, jsonb) is 'Şablon sorusu + SymPy anahtarı + şekil tek işlemde; questions_approve_guard denetler ve onaylar.';
grant execute on function public.register_template_question(jsonb, jsonb, jsonb) to batch_worker;

-- ADR-0014 yedeği (§3.6 sonu): Storage rol üyeliği (supabase_storage_admin ∋ batch_worker) verilemezse pipelines
-- figures yüklemesini bu RPC'nin döndürdüğü imzalı yükleme yoluyla yapar; service_role kullanılmaz.
-- Belirteç Storage API'nin imzalı yükleme belirteciyle aynı biçimdedir: HS256 JWT, yük {url:'figures/<id>.png', upsert, iat, exp},
-- 10 dakika geçerli, yalnız o nesne yoluna. İmza anahtarı Storage'ın JWT anahtarıdır: önce Vault
-- (vault.decrypted_secrets name='storage_jwt_secret'), yoksa veritabanı ayarı app.settings.jwt_secret; ikisi de yoksa OGR-STOR-001.
-- Dönen değer SUPABASE_URL'ye göre görelidir: /storage/v1/object/upload/sign/figures/<id>.png?token=<jwt> (PUT ile yüklenir).
create function public.create_figure_upload_url(p_figure uuid) returns text
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_status text;
  v_secret text;
  v_now bigint := floor(extract(epoch from now()))::bigint;
  v_path text;
  v_head text;
  v_body text;
  v_sig text;
begin
  if app.jwt_role() <> 'batch_worker' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select f.review_status into v_status from public.figures f where f.id = p_figure;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-STOR-002 şekil yok';
  end if;
  if v_status = 'verified' then   -- doğrulanmış şekil yeniden yazılmaz (figures_batch_u ile aynı kural)
    raise exception using errcode = 'P0001', message = 'OGR-STOR-002 doğrulanmış şeklin dosyası değiştirilemez';
  end if;
  if exists (select 1 from pg_namespace n join pg_class c on c.relnamespace = n.oid
              where n.nspname = 'vault' and c.relname = 'decrypted_secrets') then
    execute 'select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = $1 limit 1' into v_secret using 'storage_jwt_secret';
  end if;
  v_secret := coalesce(nullif(v_secret, ''), nullif(current_setting('app.settings.jwt_secret', true), ''));
  if v_secret is null then
    raise exception using errcode = 'P0001', message = 'OGR-STOR-001 imzalı yükleme anahtarı yapılandırılmamış';
  end if;
  v_path := 'figures/' || p_figure::text || '.png';
  v_head := translate(encode(convert_to('{"alg":"HS256","typ":"JWT"}', 'UTF8'), 'base64'), E'+/=\n', '-_');
  v_body := translate(encode(convert_to(jsonb_build_object('url', v_path, 'upsert', true, 'iat', v_now, 'exp', v_now + 600)::text, 'UTF8'),
                             'base64'), E'+/=\n', '-_');
  v_sig := translate(encode(hmac(convert_to(v_head || '.' || v_body, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'base64'), E'+/=\n', '-_');
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values ('batch_worker', null, 'RPC:create_figure_upload_url', 'figures', p_figure::text);
  return '/storage/v1/object/upload/sign/' || v_path || '?token=' || v_head || '.' || v_body || '.' || v_sig;
end
$$;
comment on function public.create_figure_upload_url(uuid) is 'ADR-0014 yedeği: figures/<id>.png için 10 dakikalık imzalı Storage yükleme yolu (yalnız batch_worker, doğrulanmamış şekil).';
grant execute on function public.create_figure_upload_url(uuid) to batch_worker;

create function public.peek_answer_key(p_question uuid) returns jsonb
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_k secure.answer_keys%rowtype;
begin
  if app.jwt_role() <> 'authenticated' or app.staff_role() is null or app.staff_role() not in ('instructor', 'coordinator') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select k.* into v_k from secure.answer_keys k where k.question_id = p_question;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:peek_answer_key', 'questions', p_question::text);
  if v_k.question_id is null then
    return null;
  end if;
  return jsonb_build_object('correct_option', v_k.correct_option, 'numeric_value', v_k.numeric_value,
                            'solution', v_k.solution, 'sympy_status', v_k.sympy_status);
end
$$;
comment on function public.peek_answer_key(uuid) is 'Eğitmen/koordinatör cevap anahtarını görür; her çağrı audit''e (approve_question için "anahtar görüldü" kanıtı).';
grant execute on function public.peek_answer_key(uuid) to authenticated;

create function public.set_answer_key(p_question uuid, p_key jsonb) returns void
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_kind text;
begin
  if app.jwt_role() <> 'authenticated' or app.staff_role() is null or app.staff_role() not in ('instructor', 'coordinator') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select q.kind into v_kind from public.questions q where q.id = p_question;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-KEY-004 soru yok';
  end if;
  if coalesce(p_key ->> 'solution', '') = '' or not app.answer_key_complete(v_kind, p_key ->> 'correct_option', p_key ->> 'numeric_value') then
    raise exception using errcode = 'P0001', message = 'OGR-KEY-005 doğru şık (mcq) ya da sayısal cevap (numeric) ve çözüm zorunlu';
  end if;
  insert into secure.answer_keys (question_id, correct_option, numeric_value, numeric_tolerance, canonical_expr, solution,
                                  sympy_status, written_by)
  values (p_question, p_key ->> 'correct_option', p_key ->> 'numeric_value', coalesce((p_key ->> 'numeric_tolerance')::numeric, 0),
          p_key ->> 'canonical_expr', p_key ->> 'solution', 'not_applicable', 'staff:' || app.uid())
  on conflict (question_id) do update
     set correct_option = excluded.correct_option, numeric_value = excluded.numeric_value,
         numeric_tolerance = excluded.numeric_tolerance, canonical_expr = excluded.canonical_expr,
         solution = excluded.solution, sympy_status = excluded.sympy_status, sympy_report = null,
         written_by = excluded.written_by, verified_at = null;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:set_answer_key', 'questions', p_question::text);
end
$$;
comment on function public.set_answer_key(uuid, jsonb) is 'Eğitmen eliyle anahtar (written_by=staff:<uuid>, not_applicable); audit — onay için "anahtar görüldü" kanıtı.';
grant execute on function public.set_answer_key(uuid, jsonb) to authenticated;

create function public.approve_question(p_question uuid, p_decision text, p_note text default null) returns void
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_q public.questions%rowtype;
  v_key_status text;
  v_band text;
begin
  if app.jwt_role() <> 'authenticated' or app.staff_role() is null or app.staff_role() not in ('instructor', 'coordinator') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  if p_decision not in ('approved', 'rejected', 'regenerate') then
    raise exception using errcode = 'P0001', message = 'OGR-Q-005 karar approved|rejected|regenerate';
  end if;
  select q.* into v_q from public.questions q where q.id = p_question for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-KEY-004 soru yok';
  end if;
  perform set_config('ogrenmen.reviewer', 'on', true);
  if p_decision = 'approved' then
    select k.sympy_status into v_key_status from secure.answer_keys k where k.question_id = p_question;
    if v_key_status = 'not_applicable' then
      if exists (select 1 from audit.events ev
                  where ev.actor_id = 'staff:' || app.uid()
                    and ev.action in ('RPC:peek_answer_key', 'RPC:set_answer_key')
                    and ev.row_id = p_question::text
                    and ev.at > now() - interval '30 minutes') then
        perform set_config('ogrenmen.key_peeked', 'on', true);
      else
        raise exception using errcode = 'P0001', message = 'OGR-Q-003 anahtar görülmeden onay yok';
      end if;
    end if;
    update public.questions q set status = 'approved', reviewed_by = app.uid(), reviewed_at = now(), review_note = coalesce(p_note, q.review_note)
     where q.id = p_question;   -- questions_approve_guard denetler
    perform set_config('ogrenmen.key_peeked', 'off', true);
  elsif p_decision = 'rejected' then
    update public.questions q set status = 'rejected', reviewed_by = app.uid(), reviewed_at = now(), review_note = p_note
     where q.id = p_question;
  else
    update public.questions q set status = 'retired', reviewed_by = app.uid(), reviewed_at = now(),
           review_note = coalesce(p_note, 'yeniden üretim istendi')
     where q.id = p_question;
    v_band := case when v_q.difficulty is null then 'mid' when v_q.difficulty < 0.34 then 'easy' when v_q.difficulty < 0.67 then 'mid' else 'hard' end;
    insert into public.generation_requests (kind, curriculum_id, skill_id, difficulty_band, question_kind, requested_by_staff, needs_generation)
    values ('regenerate', v_q.curriculum_id, v_q.skill_ids[1], v_band, v_q.kind, app.uid(), true);
  end if;
  perform set_config('ogrenmen.reviewer', 'off', true);
  insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:approve_question', 'questions', p_question::text,
          jsonb_build_object('decision', p_decision));
end
$$;
comment on function public.approve_question(uuid, text, text) is 'Soru kararı: approved (not_applicable anahtar için son 30 dk içinde anahtar görülmüş olmalı, OGR-Q-003), rejected, regenerate.';
grant execute on function public.approve_question(uuid, text, text) to authenticated;

-- Kalem (b): öncelik planı -------------------------------------------------------------------------------

create function public.approve_priority_plan(p_plan uuid, p_decision text) returns void
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_plan public.exam_priority_plans%rowtype;
begin  -- 'approved' aynı kurs + dönem için tek: eski approved → retired
  if app.jwt_role() <> 'authenticated' or app.staff_role() is null or app.staff_role() not in ('instructor', 'coordinator') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  if p_decision not in ('approved', 'retired') then
    raise exception using errcode = 'P0001', message = 'OGR-PLAN-001 karar approved|retired';
  end if;
  select p.* into v_plan from public.exam_priority_plans p where p.id = p_plan for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-PLAN-002 plan yok';
  end if;
  if p_decision = 'approved' then
    update public.exam_priority_plans p set status = 'retired'
     where p.course_id = v_plan.course_id and p.period = v_plan.period and p.status = 'approved' and p.id <> p_plan;
    update public.exam_priority_plans p set status = 'approved', approved_by = app.uid(), approved_at = now() where p.id = p_plan;
    -- /oncelik bildirimi: kursun müfredatındaki aktif kayıtlar (o gün başka mesaj varsa atlanır)
    insert into public.proactive_messages (student_id, chat_id, template_id, params, scheduled_for)
    select e.student_id, pc.chat_id, 'priority_plan_ready', jsonb_build_object('plan_id', p_plan, 'course_code', c.code), now()
      from public.courses c
      join public.enrollments e on e.curriculum_id = c.curriculum_id and e.status = 'active'
      join lateral (select cr.chat_id from public.chat_roles cr join public.tg_chats t on t.chat_id = cr.chat_id
                     where cr.student_id = e.student_id and t.kind = 'private' limit 1) as pc on true
     where c.id = v_plan.course_id
    on conflict do nothing;
  else
    update public.exam_priority_plans p set status = 'retired' where p.id = p_plan;
  end if;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:approve_priority_plan', 'exam_priority_plans', p_plan::text,
          jsonb_build_object('decision', p_decision));
end
$$;
comment on function public.approve_priority_plan(uuid, text) is 'Öncelik planı onayı/geri çekme (eğitmen/koordinatör); onayda öğrencilere priority_plan_ready.';
grant execute on function public.approve_priority_plan(uuid, text) to authenticated;

-- /oncelik: bot_runtime'ın courses tablosunda yetkisi YOKTUR; kurs ↔ müfredat eşlemesi yalnız bu gövdede
create function public.priority_plan_for_enrollment(p_enrollment uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_cur uuid;
  v_out jsonb;
begin
  if app.jwt_role() = 'bot_runtime' and app.enrollment_student(p_enrollment) is distinct from app.current_student() then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-004 başka öğrenci';
  end if;
  select e.curriculum_id into v_cur from public.enrollments e where e.id = p_enrollment;
  select jsonb_build_object(
           'course_code', c.code, 'period', p.period, 'years_total', p.plan -> 'years_total',
           'rows', (select coalesce(jsonb_agg(r.item order by (r.item ->> 'rank')::int), '[]'::jsonb)
                      from jsonb_array_elements(p.plan -> 'rows') as r (item)
                     where (r.item ->> 'rank')::int <= 5))
    into v_out
    from public.courses c
    join public.exam_priority_plans p on p.course_id = c.id and p.status = 'approved'
   where c.curriculum_id = v_cur
   order by p.approved_at desc nulls last
   limit 1;
  return v_out;   -- null → "Bu ders için henüz onaylı bir öncelik listesi yok."
end
$$;
comment on function public.priority_plan_for_enrollment(uuid) is 'Öğrencinin müfredatına bağlı kursun onaylı öncelik planı (ilk 5 satır) ya da null.';
grant execute on function public.priority_plan_for_enrollment(uuid) to bot_runtime;

-- Teşhis ------------------------------------------------------------------------------------------------

create or replace function app.strip_tags(p_options jsonb) returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', o.opt ->> 'key', 'text', o.opt ->> 'text') order by o.opt ->> 'key'), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) as o (opt)
$$;
comment on function app.strip_tags(jsonb) is 'Şıklardan yanılgı etiketlerini atar: [{key, text}] (bot ve öğrenci yolu).';
revoke all on function app.strip_tags(jsonb) from public;
grant execute on function app.strip_tags(jsonb) to bot_runtime, authenticated;

-- bot ve öğrenci şıkları yalnız buradan okur (etiketsiz); görünüm sahibi postgres
create view public.questions_public as
select q.id, q.curriculum_id, q.skill_ids, q.kind, q.stem, q.figure_id, app.strip_tags(q.options) as options,
       q.difficulty, q.source, q.status
  from public.questions as q
 where q.status = 'approved';
comment on view public.questions_public is 'Onaylı sorular, şıklar etiketsiz (app.strip_tags); bot ve öğrenci yolu.';
grant select on public.questions_public to bot_runtime, authenticated;

create function public.start_diagnostic(p_enrollment uuid, p_chat bigint) returns uuid
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_test uuid;
  v_sess uuid;
begin
  if app.enrollment_student(p_enrollment) is distinct from app.current_student() then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-004 başka öğrenci';
  end if;
  update public.diagnostic_sessions ds set status = 'abandoned'
   where ds.enrollment_id = p_enrollment and ds.status = 'in_progress' and ds.started_at <= now() - interval '24 hours';
  select ds.id into v_sess from public.diagnostic_sessions ds
   where ds.enrollment_id = p_enrollment and ds.status = 'in_progress' and ds.started_at > now() - interval '24 hours'
   order by ds.started_at desc limit 1;
  if v_sess is not null then
    return v_sess;
  end if;
  select dt.id into v_test from public.diagnostic_tests dt join public.enrollments e on e.curriculum_id = dt.curriculum_id
   where e.id = p_enrollment order by dt.version desc limit 1;
  if v_test is null then
    raise exception using errcode = 'P0001', message = 'OGR-DIAG-001 bu müfredat için teşhis testi yok';
  end if;
  insert into public.diagnostic_sessions (enrollment_id, test_id, chat_id) values (p_enrollment, v_test, p_chat) returning id into v_sess;
  return v_sess;
end
$$;
comment on function public.start_diagnostic(uuid, bigint) is 'Teşhis oturumu açar (yarım kalan 24 saat içinde sürdürülür, sonra abandoned).';

create function public.next_diagnostic_item(p_session uuid)
returns table (question_id uuid, stem text, figure_png text, alt_text text, options jsonb, idx int, total int)
language plpgsql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
begin
  return query
  select q.id, q.stem, f.png_path, f.alt_text, app.strip_tags(q.options), (ds.current_index + 1)::int, cardinality(t.item_ids)
    from public.diagnostic_sessions ds
    join public.diagnostic_tests t on t.id = ds.test_id
    join public.questions q on q.id = t.item_ids[ds.current_index + 1]
    left join public.figures f on f.id = q.figure_id
   where ds.id = p_session and ds.status = 'in_progress' and app.enrollment_student(ds.enrollment_id) = app.current_student();
end
$$;
comment on function public.next_diagnostic_item(uuid) is 'Teşhis oturumunun sıradaki maddesi (şıklar etiketsiz); bitti ise satır yok.';

create function public.advance_diagnostic(p_session uuid) returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_idx int;
begin
  update public.diagnostic_sessions ds set current_index = ds.current_index + 1
   where ds.id = p_session and ds.status = 'in_progress' and app.enrollment_student(ds.enrollment_id) = app.current_student()
  returning ds.current_index into v_idx;
  return v_idx;
end
$$;
comment on function public.advance_diagnostic(uuid) is 'Teşhis oturumunda bir madde ilerler; yeni indeksi döner.';

create function public.finish_diagnostic(p_session uuid) returns jsonb
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_ds public.diagnostic_sessions%rowtype;
  v_res jsonb;
  v_min int;
begin
  select ds.* into v_ds from public.diagnostic_sessions ds where ds.id = p_session for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-DIAG-002 oturum yok';
  end if;
  if app.enrollment_student(v_ds.enrollment_id) is distinct from app.current_student() then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-004 başka öğrenci';
  end if;
  select (st.value #>> '{}')::int into v_min from public.settings st where st.key = 'min_evidence';
  v_min := coalesce(v_min, 5);
  v_res := jsonb_build_object(
    'per_skill', (select jsonb_agg(jsonb_build_object('skill_id', m.skill_id, 'name', s.name, 'p', m.p, 'n', m.evidence_count,
                                                      'reliable', m.evidence_count >= v_min) order by m.p, m.skill_id)
                    from public.mastery m join public.skills s on s.id = m.skill_id and s.curriculum_id = m.curriculum_id
                   where m.enrollment_id = v_ds.enrollment_id),
    'weakest', (select jsonb_agg(w.name order by w.p, w.skill_id)
                  from (select s.name, m.p, m.skill_id
                          from public.mastery m join public.skills s on s.id = m.skill_id and s.curriculum_id = m.curriculum_id
                         where m.enrollment_id = v_ds.enrollment_id
                         order by m.p, m.skill_id limit 3) as w),
    'open_tags', (select coalesce(jsonb_agg(mc.tag order by mc.tag), '[]'::jsonb) from public.misconceptions mc
                   where mc.enrollment_id = v_ds.enrollment_id and mc.status in ('pending_review', 'open') and mc.tag is not null));
  update public.diagnostic_sessions ds set status = 'finished', finished_at = now(), result = v_res where ds.id = p_session;
  return v_res;   -- Worker: reliable=false iken yüzde yazmaz, yalnız adları sayar
end
$$;
comment on function public.finish_diagnostic(uuid) is 'Teşhisi bitirir: kazanım başına p/n/güvenilirlik, en zayıf 3 ad, açık yanılgı etiketleri.';
grant execute on function public.start_diagnostic(uuid, bigint), public.next_diagnostic_item(uuid), public.advance_diagnostic(uuid),
                          public.finish_diagnostic(uuid) to bot_runtime;

-- /test pratik seti: onaylı (+ şekli verified ya da şekilsiz), öğrencinin görmediği, source in ('template','instructor')
-- (pilot #53: LLM soruları öğrenciye gitmez). Kazanım seçimi: (1) en zayıf GÜVENİLİR kazanımlar; (2) yedek: teşhiste
-- yanlış yapılan en düşük p + bekleyen yanılgılı kazanımlar; (3) müfredatın geri kalanı order_no ile.
create function public.next_practice_items(p_enrollment uuid, p_n int default 10)
returns table (question_id uuid, stem text, figure_png text, alt_text text, options jsonb, skill_id text, kind text)
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_cur uuid;
  v_min int;
begin
  if app.enrollment_student(p_enrollment) is distinct from app.current_student() then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-004 başka öğrenci';
  end if;
  select e.curriculum_id into v_cur from public.enrollments e where e.id = p_enrollment;
  select (st.value #>> '{}')::int into v_min from public.settings st where st.key = 'min_evidence';
  v_min := coalesce(v_min, 5);
  return query
  with ranked as (
    select s.id as sid,
           row_number() over (
             order by case when m.evidence_count >= v_min then 0 when m.evidence_count > 0 then 1 else 2 end,
                      case when exists (select 1 from public.misconceptions mc
                                         where mc.enrollment_id = p_enrollment and mc.skill_id = s.id
                                           and mc.status in ('pending_review', 'open')) then 0 else 1 end,
                      m.p nulls last, s.order_no, s.id) as rn
      from public.skills s
      left join public.mastery m on m.enrollment_id = p_enrollment and m.skill_id = s.id and m.curriculum_id = s.curriculum_id
     where s.curriculum_id = v_cur and s.is_leaf
  ), cand as (
    select q.id as qid, q.stem as qstem, f.png_path, f.alt_text as falt, app.strip_tags(q.options) as qopts,
           q.skill_ids[1] as qskill, q.kind as qkind, r.rn,
           row_number() over (partition by q.skill_ids[1] order by random()) as per_skill
      from public.questions q
      join ranked r on r.sid = q.skill_ids[1]
      left join public.figures f on f.id = q.figure_id
     where q.curriculum_id = v_cur and q.status = 'approved' and q.source in ('template', 'instructor')
       and (q.figure_id is null or f.review_status = 'verified')
       and not exists (select 1 from public.attempts a where a.enrollment_id = p_enrollment and a.question_id = q.id)
  )
  select c.qid, c.qstem, c.png_path, c.falt, c.qopts, c.qskill, c.qkind
    from cand c
   order by c.per_skill, c.rn
   limit greatest(1, p_n);   -- kazanımlar arasında dönüşümlü: önce her zayıf kazanımdan 1
end
$$;
comment on function public.next_practice_items(uuid, int) is 'Pratik seti: onaylı şablon/eğitmen soruları, görülmemiş, en zayıf kazanımlardan dönüşümlü.';
grant execute on function public.next_practice_items(uuid, int) to bot_runtime;

-- Hafıza ve günlük ------------------------------------------------------------------------------------

-- Hibrit skor 0.7·cos + 0.3·ts_rank; embedding'siz olgu yalnız FTS payıyla yarışır (NULL skor yok)
create function public.retrieve_memory(p_query halfvec(768), p_text text, p_k int default 5)
returns table (fact_id bigint, kind text, text text, valid_until date, approved boolean, score numeric)
language plpgsql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
begin
  return query
  select x.fid, x.fkind, x.ftext, x.fvalid, x.fappr, x.fscore
    from (
      select f.id as fid, f.kind as fkind, f.text as ftext, f.valid_until as fvalid, f.approved as fappr, f.created_at as fcreated,
             (case when p_query is null or f.embedding is null then 0
                   else 0.7 * coalesce(1 - (f.embedding <=> p_query), 0) end
              + case when p_text is null or p_text = '' then 0
                     else 0.3 * ts_rank(f.tsv, plainto_tsquery('turkish', p_text)) end)::numeric as fscore
        from public.memory_facts f
       where f.student_id = app.current_student() and f.status = 'active'
         and (f.valid_until is null or f.valid_until >= current_date)
         and (not f.requires_approval or f.approved)   -- not/devamsızlık olguları yalnız onaylıysa
    ) as x
   order by x.fscore desc, x.fcreated desc, x.fid desc
   limit greatest(1, p_k);
end
$$;
comment on function public.retrieve_memory(halfvec, text, int) is 'Öğrencinin aktif olguları: 0.7·kosinüs + 0.3·ts_rank; gömmesiz olgu yalnız FTS ile; onay gerektiren yalnız onaylıysa.';
grant execute on function public.retrieve_memory(halfvec, text, int) to bot_runtime;

create function public.recent_messages(p_chat bigint, p_n int default 6)
returns table (id bigint, sender_role text, text text, sent_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sid uuid := app.current_student();
  v_kind text;
begin
  -- SECURITY DEFINER msg_bot_r'yi aşar: öğrenci başlığı ve o öğrencinin bu sohbetin üyesi olması şart; aksi boş küme
  -- (Worker hatası başka öğrencinin özel sohbet bağlamını okuyamaz)
  if app.jwt_role() <> 'bot_runtime' or v_sid is null
     or not exists (select 1 from public.chat_roles cr where cr.chat_id = p_chat and cr.student_id = v_sid) then
    return;
  end if;
  select c.kind into v_kind from public.tg_chats c where c.chat_id = p_chat;
  return query
  select m.id, m.sender_role, m.text_llm, m.sent_at
    from public.messages m
   where m.chat_id = p_chat and m.text_llm is not null
     and (m.student_id = v_sid   -- grupta yalnız bu öğrencinin kendi mesajları ve ona verilen yanıtlar
          or (m.sender_role in ('bot', 'instructor', 'coordinator')
              and ((m.reply_to_telegram_message_id is null and v_kind = 'private')
                   or m.reply_to_telegram_message_id in (select x.telegram_message_id from public.messages x
                                                          where x.chat_id = p_chat and x.student_id = v_sid))))
   order by m.sent_at desc, m.id desc
   limit p_n;
end
$$;
comment on function public.recent_messages(bigint, int) is 'Bağlam için son mesajlar (text_llm); grupta yalnız öğrencinin kendi mesajları ve ona yanıtlar.';
grant execute on function public.recent_messages(bigint, int) to bot_runtime;

create function public.record_chat_observation(p_enrollment uuid, p_skill text, p_kind text, p_message bigint, p_quote text, p_tag text)
returns bigint
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_obs bigint;
begin
  if app.enrollment_student(p_enrollment) is distinct from app.current_student() then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-004 başka öğrenci';
  end if;
  if p_kind not in ('chat_question', 'chat_misconception') then
    raise exception using errcode = 'P0001', message = 'OGR-OBS-001 yalnız sohbet gözlemi';
  end if;
  insert into public.observations (enrollment_id, skill_id, kind, value, source_type, source_id, source_locator, quote,
                                   misconception_tag, counts_for_mastery, created_by_role)
  values (p_enrollment, p_skill, p_kind, null, 'message', p_message::text, 'Sohbet · ' || app.tr_stamp(now(), true),
          left(p_quote, 240), p_tag, false, 'bot_runtime')
  returning id into v_obs;
  perform public.apply_observation(v_obs);
  return v_obs;
end
$$;
comment on function public.record_chat_observation(uuid, text, text, bigint, text, text) is 'Sohbetten kazanım/yanılgı gözlemi (p ve kanıt sayısı değişmez; yanılgı sayacına katılır).';
grant execute on function public.record_chat_observation(uuid, text, text, bigint, text, text) to bot_runtime;

-- Kayıt yoksa cevap yok: her bot cevabı ve her sağlayıcı denemesi (llm_calls → spend_ledger tetikleyicisi)
-- PostgREST çağrısı {"p": {...}} biçimindedir (Worker postgrest.ts); parametre adı bu yüzden p.
create function public.log_bot_response(p jsonb) returns bigint
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_rid bigint;
  v_a jsonb;
  v_sid uuid := app.current_student();
  v_ref text;
begin
  if app.jwt_role() <> 'bot_runtime' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-001 yalnız bot_runtime';
  end if;
  if p ->> 'purpose' is null or p ->> 'response_text' is null or p ->> 'chat_id' is null then
    raise exception using errcode = 'P0001', message = 'OGR-LOG-001 şema';   -- tam doğrulama Worker'da
  end if;
  select s.public_ref into v_ref from public.students s where s.id = v_sid;
  insert into public.bot_responses (in_message_id, chat_id, student_id, purpose, mode, prompt_version, prompt_hash, prompt_text,
                                    response_text, memory_fact_ids, recent_message_ids, pool_id, cache_hit, provider, model,
                                    provider_attempts, tokens_in, tokens_out, cost_usd, latency_ms, confidence, escalated,
                                    schema_valid, quota_state, degraded_mode, pii_replacements)
  select (p ->> 'in_message_id')::bigint, (p ->> 'chat_id')::bigint, v_sid, p ->> 'purpose', p ->> 'mode', p ->> 'prompt_version',
         p ->> 'prompt_hash', p ->> 'prompt_text', p ->> 'response_text',
         coalesce((select array_agg(x.v::bigint) from jsonb_array_elements_text(p -> 'memory_fact_ids') as x (v)), '{}'),
         coalesce((select array_agg(x.v::bigint) from jsonb_array_elements_text(p -> 'recent_message_ids') as x (v)), '{}'),
         (p ->> 'pool_id')::uuid, coalesce((p ->> 'cache_hit')::boolean, false), p ->> 'provider', p ->> 'model',
         coalesce(p -> 'provider_attempts', '[]'), (p ->> 'tokens_in')::int, (p ->> 'tokens_out')::int,
         coalesce((p ->> 'cost_usd')::numeric, 0), (p ->> 'latency_ms')::int, (p ->> 'confidence')::numeric,
         coalesce((p ->> 'escalated')::boolean, false), (p ->> 'schema_valid')::boolean, p -> 'quota_state',
         coalesce((p ->> 'degraded_mode')::boolean, false), coalesce((p ->> 'pii_replacements')::int, 0)
  returning id into v_rid;
  for v_a in select x.att from jsonb_array_elements(coalesce(p -> 'provider_attempts', '[]')) as x (att) loop
    insert into public.llm_calls (purpose, provider, model, tokens_in, tokens_out, status, error_code, latency_ms, cost_usd,
                                  ref_table, ref_id, student_ref)
    values ('chat', v_a ->> 'provider', v_a ->> 'model', coalesce((v_a ->> 'tokens_in')::int, 0), coalesce((v_a ->> 'tokens_out')::int, 0),
            v_a ->> 'status', v_a ->> 'error_code', (v_a ->> 'latency_ms')::int, coalesce((v_a ->> 'cost_usd')::numeric, 0),
            'bot_responses', v_rid::text, v_ref);
  end loop;
  return v_rid;
end
$$;
comment on function public.log_bot_response(jsonb) is 'Bot cevabını ve sağlayıcı denemelerini (llm_calls) yazar; kayıt yoksa cevap gönderilmez.';
grant execute on function public.log_bot_response(jsonb) to bot_runtime;

create function public.set_out_message(p_response bigint, p_tg_msg bigint) returns void
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
begin
  update public.bot_responses br set out_telegram_message_id = p_tg_msg
   where br.id = p_response and (br.student_id = app.current_student() or br.student_id is null);
end
$$;
comment on function public.set_out_message(bigint, bigint) is 'Gönderilen Telegram mesaj kimliğini bot cevabına yazar.';
grant execute on function public.set_out_message(bigint, bigint) to bot_runtime;

create function public.pool_hit(p_pool uuid) returns void
language sql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
  update public.content_pool as cp set hit_count = cp.hit_count + 1 where cp.id = p_pool and cp.status = 'approved'
$$;
comment on function public.pool_hit(uuid) is 'Onaylı havuz içeriğinin servis sayacını artırır.';
grant execute on function public.pool_hit(uuid) to bot_runtime;

-- Gruplar, yükseltme, cron -----------------------------------------------------------------------------

-- Eğitmen bir soruya reply verdiğinde (yalnız bağlı personel): mesaj, yükseltme ve ilgili alarmlar kapanır
create function public.mark_answered(p_chat bigint, p_reply_to_tg_msg bigint, p_staff_tg bigint) returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_staff uuid;
  v_msg bigint;
  v_n int := 0;
  v_esc uuid[];
begin
  if app.jwt_role() <> 'bot_runtime' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-001 yalnız bot_runtime';
  end if;
  select cr.staff_id into v_staff from public.chat_roles cr join public.staff s on s.id = cr.staff_id and s.active
   where cr.chat_id = p_chat and cr.telegram_user_id = p_staff_tg and cr.role in ('instructor', 'coordinator');
  if v_staff is null then
    return 0;
  end if;
  select m.id into v_msg from public.messages m where m.chat_id = p_chat and m.telegram_message_id = p_reply_to_tg_msg;
  if v_msg is null then
    return 0;
  end if;
  update public.messages m set answered_at = coalesce(m.answered_at, now()) where m.id = v_msg;
  with upd as (
    update public.escalations e set status = 'answered', answered_at = now(), answered_by = v_staff
     where e.message_id = v_msg and e.status = 'open'
    returning e.id
  )
  select coalesce(array_agg(upd.id), '{}') into v_esc from upd;
  v_n := 1 + cardinality(v_esc);
  update public.instructor_alerts a set status = 'done', resolved_at = now(), resolved_by = v_staff
   where a.status in ('open', 'snoozed')
     and (a.ref ->> 'message_id' = v_msg::text or (a.ref ->> 'escalation_id')::uuid = any(v_esc));
  return v_n;
end
$$;
comment on function public.mark_answered(bigint, bigint, bigint) is 'Bağlı eğitmenin reply yanıtı: messages.answered_at, yükseltme answered, alarmlar done.';

create function public.open_escalation(p_chat bigint, p_message bigint, p_reason text, p_question_text text) returns uuid
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sid uuid := app.current_student();
  v_target uuid;
  v_id uuid;
begin
  if app.jwt_role() <> 'bot_runtime' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-001 yalnız bot_runtime';
  end if;
  if p_message is not null and v_sid is not null
     and not exists (select 1 from public.messages m where m.id = p_message and m.chat_id = p_chat
                       and (m.student_id = v_sid or m.student_id is null)) then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-004 başka öğrencinin mesajı';
  end if;
  -- hedef: sohbetteki branş eğitmeni (branşı tanımlı olan önce), yoksa koordinatör
  select cr.staff_id into v_target
    from public.chat_roles cr join public.staff s on s.id = cr.staff_id and s.active
   where cr.chat_id = p_chat and s.role = 'instructor'
   order by (s.subject is null), cr.joined_at
   limit 1;
  if v_target is null and v_sid is not null then
    select ss.staff_id into v_target from public.staff_students ss join public.staff s on s.id = ss.staff_id and s.active
     where ss.student_id = v_sid and s.role = 'instructor' order by s.created_at limit 1;
  end if;
  if v_target is null then
    select s.id into v_target from public.staff s where s.role = 'coordinator' and s.active order by s.created_at limit 1;
  end if;
  insert into public.escalations (chat_id, message_id, student_id, reason, question_text, target_staff_id)
  values (p_chat, p_message, v_sid, p_reason, left(p_question_text, 1000), v_target)
  returning id into v_id;
  return v_id;
end
$$;
comment on function public.open_escalation(bigint, bigint, text, text) is 'İnsana yükseltme açar; hedef sohbetteki eğitmen, yoksa koordinatör.';

-- Proaktif mesajlar: aday satırları üretir (exam_tomorrow, deadline_soon, silent_3d) ve gönderilmeye hazır
-- satırları döner (aktif saat, proactive_enabled, bugün gönderilmemiş; veli chat_id'si secure'dan çözülür).
create function public.cron_due_proactive(p_now timestamptz default now())
returns table (id uuid, student_id uuid, recipient text, chat_id bigint, template_id text, params jsonb)
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_silent int;
begin
  if app.jwt_role() in ('authenticated', 'anon') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select (st.value #>> '{}')::int into v_silent from public.settings st where st.key = 'alert_silent_days';
  v_silent := coalesce(v_silent, 3);

  -- yarın sınav / teslim (deadline olgusu yarın)
  insert into public.proactive_messages (student_id, chat_id, recipient, template_id, params, scheduled_for)
  select f.student_id, pc.chat_id, 'student', 'exam_tomorrow', jsonb_build_object('fact_id', f.id), p_now
    from public.memory_facts f
    join public.students s on s.id = f.student_id and s.status = 'active'
    join lateral (select cr.chat_id from public.chat_roles cr join public.tg_chats t on t.chat_id = cr.chat_id
                   where cr.student_id = f.student_id and t.kind = 'private' limit 1) as pc on true
   where f.kind = 'deadline' and f.status = 'active' and (not f.requires_approval or f.approved)
     and f.valid_until = (p_now at time zone s.tz)::date + 1
     and not exists (select 1 from public.proactive_messages pm where pm.student_id = f.student_id
                       and pm.template_id = 'exam_tomorrow' and pm.params ->> 'fact_id' = f.id::text)
  on conflict do nothing;
  -- söz verilen iş 2 gün içinde
  insert into public.proactive_messages (student_id, chat_id, recipient, template_id, params, scheduled_for)
  select f.student_id, pc.chat_id, 'student', 'deadline_soon', jsonb_build_object('fact_id', f.id), p_now
    from public.memory_facts f
    join public.students s on s.id = f.student_id and s.status = 'active'
    join lateral (select cr.chat_id from public.chat_roles cr join public.tg_chats t on t.chat_id = cr.chat_id
                   where cr.student_id = f.student_id and t.kind = 'private' limit 1) as pc on true
   where f.kind = 'promise' and f.status = 'active' and (not f.requires_approval or f.approved)
     and f.valid_until between (p_now at time zone s.tz)::date and (p_now at time zone s.tz)::date + 2
     and not exists (select 1 from public.proactive_messages pm where pm.student_id = f.student_id
                       and pm.template_id = 'deadline_soon' and pm.params ->> 'fact_id' = f.id::text)
  on conflict do nothing;
  -- sessizlik: son öğrenci mesajı alert_silent_days'ten eski, son silent_3d bundan da eski
  insert into public.proactive_messages (student_id, chat_id, recipient, template_id, params, scheduled_for)
  select s.id, pc.chat_id, 'student', 'silent_3d', jsonb_build_object('days', v_silent), p_now
    from public.students s
    join lateral (select cr.chat_id from public.chat_roles cr join public.tg_chats t on t.chat_id = cr.chat_id
                   where cr.student_id = s.id and t.kind = 'private' limit 1) as pc on true
    join lateral (select max(m.sent_at) as last_at from public.messages m
                   where m.student_id = s.id and m.sender_role = 'student') as lm on true
   where s.status = 'active' and lm.last_at is not null and lm.last_at < p_now - make_interval(days => v_silent)
     and not exists (select 1 from public.proactive_messages pm where pm.student_id = s.id and pm.template_id = 'silent_3d'
                       and pm.scheduled_for > p_now - make_interval(days => v_silent))
  on conflict do nothing;

  -- veli satırları: sohbet kimliği secure.guardian_codes'tan; veli kaydı yoksa skipped
  update public.proactive_messages pm
     set chat_id = (select g.used_by_telegram_user_id from secure.guardian_codes g
                     where g.student_id = pm.student_id and g.used_at is not null and g.used_by_telegram_user_id is not null
                     order by g.used_at desc limit 1)
   where pm.recipient = 'guardian' and pm.status = 'scheduled' and pm.chat_id is null and pm.scheduled_for <= p_now;
  update public.proactive_messages pm set status = 'skipped'
   where pm.recipient = 'guardian' and pm.status = 'scheduled' and pm.chat_id is null and pm.scheduled_for <= p_now;
  -- silinen öğrenciye ve sohbeti olmayan satıra gönderim yok
  update public.proactive_messages pm set status = 'skipped'
   where pm.status = 'scheduled' and pm.scheduled_for <= p_now
     and (pm.chat_id is null or exists (select 1 from public.students s where s.id = pm.student_id and s.status = 'deleted'));

  return query
  select pm.id, pm.student_id, pm.recipient, pm.chat_id, pm.template_id, pm.params
    from public.proactive_messages pm
    join public.students s on s.id = pm.student_id
    left join public.preferences pr on pr.student_id = pm.student_id
   where pm.status = 'scheduled' and pm.scheduled_for <= p_now and pm.chat_id is not null
     and (pm.recipient = 'guardian' or coalesce(pr.proactive_enabled, true))
     and extract(hour from p_now at time zone s.tz)::smallint = any(coalesce(pr.active_hours, '{18,19,20,21}'::smallint[]))
   order by pm.scheduled_for, pm.id;
end
$$;
comment on function public.cron_due_proactive(timestamptz) is 'Proaktif aday satırlarını üretir ve gönderilmeye hazır olanları döner (aktif saat, tercih, günde bir; ad/PII yok).';

-- Alarmlar: cevapsız (yükseltme + soru işaretli mesaj), sessiz, teslim, moral, yanıt süresi, ops (grup yönetici değil /
-- gizlilik modu açık). Tekilleştirme alerts_dedup; çözülen durumların alarmları kapanır. Dönüş: açılan alarm sayısı.
create function public.cron_open_alerts() returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_unans int;
  v_unans_danger int;
  v_silent int;
  v_silent_danger int;
  v_deadline int;
  v_target numeric;
  v_n int := 0;
  v_k int;
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_coord uuid;
begin
  if app.jwt_role() in ('authenticated', 'anon') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select coalesce(max((st.value #>> '{}')::int) filter (where st.key = 'alert_unanswered_hours'), 6),
         coalesce(max((st.value #>> '{}')::int) filter (where st.key = 'alert_unanswered_danger_hours'), 24),
         coalesce(max((st.value #>> '{}')::int) filter (where st.key = 'alert_silent_days'), 3),
         coalesce(max((st.value #>> '{}')::int) filter (where st.key = 'alert_silent_danger_days'), 7),
         coalesce(max((st.value #>> '{}')::int) filter (where st.key = 'alert_deadline_days'), 2),
         coalesce(max((st.value #>> '{}')::numeric) filter (where st.key = 'response_target_hours'), 2)
    into v_unans, v_unans_danger, v_silent, v_silent_danger, v_deadline, v_target
    from public.settings st;
  select s.id into v_coord from public.staff s where s.role = 'coordinator' and s.active order by s.created_at limit 1;

  -- (a) açık yükseltmeler
  insert into public.instructor_alerts (kind, severity, student_id, staff_id, detail, since, ref)
  select 'unanswered',
         case when e.created_at < now() - make_interval(hours => v_unans_danger) then 'danger' else 'warning' end,
         e.student_id, e.target_staff_id,
         left('Hocaya iletilen soru cevap bekliyor: "' || coalesce(left(e.question_text, 160), 'soru') || '"', 240),
         e.created_at, jsonb_build_object('escalation_id', e.id)
    from public.escalations e
   where e.status = 'open' and e.created_at < now() - make_interval(hours => v_unans)
  on conflict do nothing;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;
  update public.instructor_alerts a set severity = 'danger'
    from public.escalations e
   where a.status = 'open' and a.kind = 'unanswered' and a.severity <> 'danger' and a.ref ->> 'escalation_id' = e.id::text
     and e.status = 'open' and e.created_at < now() - make_interval(hours => v_unans_danger);
  update public.instructor_alerts a set status = 'done', resolved_at = now()
    from public.escalations e
   where a.status = 'open' and a.kind = 'unanswered' and a.ref ->> 'escalation_id' = e.id::text and e.status <> 'open';

  -- (b) soru işaretli, cevapsız öğrenci mesajları (is_question girişte yazılır)
  insert into public.instructor_alerts (kind, severity, student_id, staff_id, detail, since, ref)
  select 'unanswered',
         case when m.sent_at < now() - make_interval(hours => v_unans_danger) then 'danger' else 'warning' end,
         m.student_id,
         (select cr.staff_id from public.chat_roles cr join public.staff s on s.id = cr.staff_id and s.active
           where cr.chat_id = m.chat_id and s.role = 'instructor' order by cr.joined_at limit 1),
         left('Cevapsız soru: "' || left(m.text_llm, 180) || '"', 240), m.sent_at, jsonb_build_object('message_id', m.id)
    from public.messages m
   where m.is_question and m.answered_at is null and m.sender_role = 'student' and m.text_llm is not null
     and m.sent_at < now() - make_interval(hours => v_unans)
     and m.expires_at > now()
  on conflict do nothing;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;
  update public.instructor_alerts a set severity = 'danger'
    from public.messages m
   where a.status = 'open' and a.kind = 'unanswered' and a.severity <> 'danger' and a.ref ->> 'message_id' = m.id::text
     and m.answered_at is null and m.sent_at < now() - make_interval(hours => v_unans_danger);
  update public.instructor_alerts a set status = 'done', resolved_at = now()
    from public.messages m
   where a.status = 'open' and a.kind = 'unanswered' and a.ref ->> 'message_id' = m.id::text and m.answered_at is not null;

  -- (c) sessiz öğrenciler (detail'in ilk 24 karakteri sabit; önem yerinde yükselir)
  insert into public.instructor_alerts (kind, severity, student_id, staff_id, detail, since, ref)
  select 'silent',
         case when lm.last_at < now() - make_interval(days => v_silent_danger) then 'danger' else 'warning' end,
         s.id,
         (select ss.staff_id from public.staff_students ss join public.staff st on st.id = ss.staff_id and st.active
           where ss.student_id = s.id and st.role = 'instructor' order by st.created_at limit 1),
         'Uzun süredir mesaj yok (son mesaj ' || app.tr_stamp(lm.last_at, false) || ')', lm.last_at, '{}'::jsonb
    from public.students s
    join lateral (select max(m.sent_at) as last_at from public.messages m where m.student_id = s.id and m.sender_role = 'student') as lm on true
   where s.status = 'active' and lm.last_at < now() - make_interval(days => v_silent)
  on conflict do nothing;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;
  update public.instructor_alerts a set severity = 'danger'
   where a.status = 'open' and a.kind = 'silent' and a.severity <> 'danger' and a.since < now() - make_interval(days => v_silent_danger);
  update public.instructor_alerts a set status = 'done', resolved_at = now()
   where a.status = 'open' and a.kind = 'silent'
     and exists (select 1 from public.messages m where m.student_id = a.student_id and m.sender_role = 'student' and m.sent_at > a.since);

  -- (d) yaklaşan teslimler
  insert into public.instructor_alerts (kind, severity, student_id, staff_id, detail, since, ref)
  select 'deadline', 'neutral', f.student_id,
         (select ss.staff_id from public.staff_students ss join public.staff st on st.id = ss.staff_id and st.active
           where ss.student_id = f.student_id and st.role = 'instructor' order by st.created_at limit 1),
         left('Teslim yaklaşıyor: ' || f.text, 240), f.created_at, jsonb_build_object('fact_id', f.id)
    from public.memory_facts f
    join public.students s on s.id = f.student_id and s.status = 'active'
   where f.kind = 'deadline' and f.status = 'active' and (not f.requires_approval or f.approved)
     and f.valid_until between v_today and v_today + v_deadline
  on conflict do nothing;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;

  -- (e) moral göstergesi: son 7 gün ortalama ≤ −1 ve ≥ 3 sinyal (ders kaynaklı olgular dahil)
  insert into public.instructor_alerts (kind, severity, student_id, staff_id, detail, since, ref)
  select 'morale', 'warning', f.student_id,
         (select ss.staff_id from public.staff_students ss join public.staff st on st.id = ss.staff_id and st.active
           where ss.student_id = f.student_id and st.role = 'instructor' order by st.created_at limit 1),
         'Moral göstergesi düştü (son 7 gün, ' || count(*) || ' sinyal)', min(f.created_at), '{}'::jsonb
    from public.memory_facts f
    join public.students s on s.id = f.student_id and s.status = 'active'
   where f.morale_signal is not null and f.status = 'active' and f.created_at > now() - interval '7 days'
   group by f.student_id
  having avg(f.morale_signal) <= -1 and count(*) >= 3
  on conflict do nothing;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;

  -- (f) eğitmen yanıt süresi medyanı (son 14 gün) hedefin üstünde. detail'e personel adı YAZILMAZ (batch_worker
  -- instructor_alerts'i okur ama staff'tan yalnız (id, role) görür; panel adı staff_id'den çözer); tekilleştirme
  -- personel başına ref.staff_id ile, detail öneki sabit ("Yanıt süresi medyanı hede…")
  insert into public.instructor_alerts (kind, severity, student_id, staff_id, detail, since, ref)
  select 'response', 'warning', null, r.staff_id,
         'Yanıt süresi medyanı hedefin üstünde: ' || replace(round(r.med::numeric, 1)::text, '.', ',') || ' saat (hedef '
           || replace(v_target::text, '.', ',') || ' saat)',
         now() - interval '14 days', jsonb_build_object('staff_id', r.staff_id)
    from (select e.answered_by as staff_id,
                 percentile_cont(0.5) within group (order by extract(epoch from (e.answered_at - e.created_at)) / 3600.0) as med
            from public.escalations e
           where e.answered_at is not null and e.answered_by is not null and e.created_at > now() - interval '14 days'
           group by e.answered_by) as r
    join public.staff st on st.id = r.staff_id and st.active
   where r.med > v_target
  on conflict do nothing;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;

  -- (g) ops: grupta yönetici değil / gizlilik modu açık (ref.chat_id ile grup başına tekil)
  insert into public.instructor_alerts (kind, severity, student_id, staff_id, detail, since, ref)
  select 'ops', 'warning', null, v_coord, 'Bot grupta yönetici değil; kayıt bildirimi sabitlenemedi', t.created_at,
         jsonb_build_object('chat_id', t.chat_id)
    from public.tg_chats t
   where t.kind <> 'private' and not t.bot_is_admin
  on conflict do nothing;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;
  insert into public.instructor_alerts (kind, severity, student_id, staff_id, detail, since, ref)
  select 'ops', 'warning', null, v_coord, 'Grup gizlilik modu açık; bot yalnız etiketlenince görür', t.created_at,
         jsonb_build_object('chat_id', t.chat_id)
    from public.tg_chats t
   where t.kind <> 'private' and not t.privacy_mode_off_verified
  on conflict do nothing;
  get diagnostics v_k = row_count;
  v_n := v_n + v_k;
  update public.instructor_alerts a set status = 'done', resolved_at = now()
    from public.tg_chats t
   where a.status = 'open' and a.kind = 'ops' and a.ref ->> 'chat_id' = t.chat_id::text
     and ((a.detail like 'Bot grupta yönetici değil%' and t.bot_is_admin)
          or (a.detail like 'Grup gizlilik modu açık%' and t.privacy_mode_off_verified));
  return v_n;
end
$$;
comment on function public.cron_open_alerts() is 'Eğitmen alarmlarını üretir/yükseltir/kapatır (cevapsız, sessiz, teslim, moral, yanıt süresi, ops); açılan sayı.';

-- Grup otomatik yanıtı (varsayılan kapalı): N dk eğitmen yanıtı olmayan, botun da yanıtlamadığı öğrenci soruları
create function public.cron_group_auto_answer()
returns table (chat_id bigint, message_id bigint, student_id uuid, telegram_message_id bigint)
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
begin
  if app.jwt_role() <> 'bot_runtime' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-001 yalnız bot_runtime';
  end if;
  return query
  select y.cid, y.mid, y.sid, y.tgid
    from (
      select m.chat_id as cid, m.id as mid, m.student_id as sid, m.telegram_message_id as tgid,
             row_number() over (partition by m.chat_id order by m.sent_at) as rn
        from public.messages m
        join public.tg_chats t on t.chat_id = m.chat_id
       where t.kind <> 'private' and t.group_auto_answer_min > 0
         and m.is_question and m.answered_at is null and m.sender_role = 'student' and m.student_id is not null
         and m.text_llm is not null
         and m.sent_at < now() - make_interval(mins => t.group_auto_answer_min)
         and m.sent_at > now() - interval '1 day'
         and not exists (select 1 from public.messages r
                          where r.chat_id = m.chat_id and r.reply_to_telegram_message_id = m.telegram_message_id
                            and r.sender_role in ('instructor', 'coordinator'))
         and not exists (select 1 from public.bot_responses br where br.in_message_id = m.id)
    ) as y
   where y.rn <= 3   -- grup başına çalıştırma başına ≤ 3 soru
   order by y.cid, y.rn;
end
$$;
comment on function public.cron_group_auto_answer() is 'Otomatik yanıt açık gruplarda N dk cevapsız kalan öğrenci soruları (grup başına ≤ 3).';

create function public.cron_idle_sessions() returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_hours int;
  v_n int;
begin
  if app.jwt_role() in ('authenticated', 'anon') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select (st.value #>> '{}')::int into v_hours from public.settings st where st.key = 'session_idle_hours';
  update public.sessions se set state = 'idle', direct_once = false, hint_level = 0
   where se.last_activity_at < now() - make_interval(hours => coalesce(v_hours, 6))
     and (se.state in ('awaiting_answer', 'test', 'diagnostic') or se.direct_once or se.hint_level > 0);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
comment on function public.cron_idle_sessions() is 'Hareketsiz oturumları idle''a çeker (direct_once ve ipucu düzeyi sıfırlanır).';

create function public.dedup_update(p_update_id bigint) returns boolean
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_n int;
begin
  if app.jwt_role() <> 'bot_runtime' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-001 yalnız bot_runtime';
  end if;
  insert into public.tg_updates (update_id) values (p_update_id) on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end
$$;
comment on function public.dedup_update(bigint) is 'Webhook tekrar denetimi: update_id ilk kez görüldüyse true.';

create function public.ping() returns int
language sql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
  select 1
$$;
comment on function public.ping() is 'Keepalive (veri döndürmez).';

create function public.recompute_is_minor() returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_n int;
begin
  if app.jwt_role() in ('authenticated', 'anon') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  update public.students s
     set is_minor = (pii.birth_year is null or extract(year from current_date)::int - pii.birth_year < 18)
    from secure.student_pii pii
   where pii.student_id = s.id
     and s.is_minor is distinct from (pii.birth_year is null or extract(year from current_date)::int - pii.birth_year < 18);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
comment on function public.recompute_is_minor() is 'Günlük: doğum yılından is_minor''u yeniden hesaplar (doğum yılı yoksa reşit değil).';

grant execute on function public.mark_answered(bigint, bigint, bigint), public.open_escalation(bigint, bigint, text, text),
                          public.dedup_update(bigint), public.cron_group_auto_answer() to bot_runtime;
grant execute on function public.rollup_spend(), public.recompute_is_minor(), public.cron_due_proactive(timestamptz),
                          public.cron_open_alerts(), public.cron_idle_sessions() to bot_runtime, batch_worker;
grant execute on function public.ping() to anon, bot_runtime;

-- Panel -----------------------------------------------------------------------------------------------

-- "Elif K." biçimi; tam ad hiç dönmez
create function public.person_labels(p_student_ids uuid[])
returns table (student_id uuid, label text, public_ref text)
language plpgsql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
begin
  if app.jwt_role() <> 'authenticated' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  return query
  select s.id,
         coalesce(nullif(split_part(trim(pii.display_name), ' ', 1)
                         || case when array_length(regexp_split_to_array(trim(pii.display_name), '\s+'), 1) > 1
                                 then ' ' || left((regexp_split_to_array(trim(pii.display_name), '\s+'))[
                                        array_length(regexp_split_to_array(trim(pii.display_name), '\s+'), 1)], 1) || '.'
                                 else '' end, ''),
                  s.public_ref),
         s.public_ref
    from public.students s
    left join secure.student_pii pii on pii.student_id = s.id
   where s.id = any(p_student_ids) and app.can_see_student(s.id);
end
$$;
comment on function public.person_labels(uuid[]) is 'Panel etiketi "Elif K." (görülebilen öğrenciler); tam ad dönmez.';

-- Panel AlertRow "Cevapla"/"Tamam": eğitmen/koordinatör alarmı kapatır; mark_answered yalnız bot'un (reply_to) yoludur
create function public.resolve_alert(p_alert uuid) returns void
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_a public.instructor_alerts%rowtype;
begin
  if app.jwt_role() <> 'authenticated' or app.staff_role() is null or app.staff_role() not in ('instructor', 'coordinator') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select a.* into v_a from public.instructor_alerts a where a.id = p_alert for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-ALERT-001 alarm yok';
  end if;
  if v_a.student_id is not null and not app.can_see_student(v_a.student_id) then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  if v_a.student_id is null and app.staff_role() <> 'coordinator' and v_a.staff_id is distinct from app.uid() then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  if v_a.ref ? 'escalation_id' then
    update public.escalations e set status = 'answered', answered_at = coalesce(e.answered_at, now()), answered_by = coalesce(e.answered_by, app.uid())
     where e.id = (v_a.ref ->> 'escalation_id')::uuid and e.status = 'open';
  end if;
  if v_a.ref ? 'message_id' then
    update public.messages m set answered_at = coalesce(m.answered_at, now()) where m.id = (v_a.ref ->> 'message_id')::bigint;
  end if;
  update public.instructor_alerts a set status = 'done', resolved_at = now(), resolved_by = app.uid() where a.id = p_alert;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:resolve_alert', 'instructor_alerts', p_alert::text);
end
$$;
comment on function public.resolve_alert(uuid) is 'Panelden alarm kapatma; bağlı yükseltme/mesaj yanıtlandı sayılır; audit.';

-- {tiles, alerts, response_series (14 gün), pilot}; can_see_student filtresi
create function public.panel_overview() returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_role text := app.staff_role();
  v_uid uuid := app.uid();
  v_tiles jsonb;
  v_alerts jsonb;
  v_series jsonb;
  v_pilot jsonb;
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  if app.jwt_role() <> 'authenticated' or v_role is null then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  with vis as (
    select a.* from public.instructor_alerts a
     where a.status = 'open'
       and ((a.student_id is not null and app.can_see_student(a.student_id))
            or (a.student_id is null and (v_role = 'coordinator' or a.staff_id = v_uid)))
  )
  select jsonb_build_object(
           'unanswered', (select count(*) from vis where vis.kind = 'unanswered'),
           'silent', (select count(*) from vis where vis.kind = 'silent'),
           'deadlines', (select count(*) from vis where vis.kind = 'deadline'),
           'response_hours', (select round((percentile_cont(0.5) within group (
                                     order by extract(epoch from (e.answered_at - e.created_at)) / 3600.0))::numeric, 1)
                                from public.escalations e
                               where e.answered_at is not null and e.created_at > now() - interval '14 days'
                                 and (v_role = 'coordinator' or e.answered_by = v_uid
                                      or (e.student_id is not null and app.can_see_student(e.student_id))))),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'schema_version', '1.0', 'kind', vis.kind, 'severity', vis.severity,
                     'student_ref', (select s.public_ref from public.students s where s.id = vis.student_id),
                     'staff_ref', vis.staff_id::text, 'detail', vis.detail,
                     'since', to_char(coalesce(vis.since, vis.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                     'ref', vis.ref)
                   order by case vis.severity when 'danger' then 0 when 'warning' then 1 else 2 end,
                            coalesce(vis.since, vis.created_at), vis.id)
                     from vis), '[]'::jsonb)
    into v_tiles, v_alerts;
  select coalesce(jsonb_agg(jsonb_build_object('day', d.day::text, 'median_hours', d.med) order by d.day), '[]'::jsonb)
    into v_series
    from (select g.day::date as day,
                 (select round(percentile_cont(0.5) within group (order by r.median_hours)::numeric, 1)
                    from public.v_instructor_response_times r
                   where r.day = g.day::date and r.median_hours is not null
                     and (v_role = 'coordinator' or r.staff_id = v_uid)) as med
            from generate_series(v_today - 13, v_today, interval '1 day') as g (day)) as d;
  select coalesce(jsonb_agg(jsonb_build_object('metric', pm.metric, 'period', pm.period::text, 'value', pm.value)
                            order by pm.metric), '[]'::jsonb)
    into v_pilot
    from public.pilot_metrics pm
   where pm.period = (select max(x.period) from public.pilot_metrics x where x.metric = pm.metric);
  return jsonb_build_object('tiles', v_tiles, 'alerts', v_alerts, 'response_series', v_series, 'pilot', v_pilot);
end
$$;
comment on function public.panel_overview() is 'Panel ana sayfası: kutucuklar, alarmlar (önem → yaş), 14 günlük yanıt süresi serisi, son pilot ölçütleri.';

create function public.audit_recent(p_limit int default 100)
returns table (id bigint, at timestamptz, actor_role text, actor_id text, action text, table_name text, row_id text, diff jsonb)
language plpgsql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
begin
  if app.jwt_role() <> 'authenticated' or app.staff_role() is distinct from 'coordinator' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  return query
  select ev.id, ev.at, ev.actor_role, ev.actor_id, ev.action, ev.table_name, ev.row_id, ev.diff
    from audit.events ev
   order by ev.at desc, ev.id desc
   limit least(greatest(coalesce(p_limit, 100), 1), 1000);
end
$$;
comment on function public.audit_recent(int) is 'Son denetim kayıtları (yalnız koordinatör).';

create function public.add_instructor_note(
  p_enrollment uuid, p_skill text, p_body text, p_mastery_estimate numeric default null, p_approved_fact boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_obs bigint;
begin
  if app.jwt_role() <> 'authenticated' or not app.can_edit_student(app.enrollment_student(p_enrollment)) then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  if p_mastery_estimate is not null and p_skill is null then
    raise exception using errcode = 'P0001', message = 'OGR-OBS-002 ustalık tahmini için kazanım gerekli';
  end if;
  insert into public.instructor_notes (enrollment_id, author_id, skill_id, body, mastery_estimate, approved_fact)
  values (p_enrollment, app.uid(), p_skill, p_body, p_mastery_estimate, coalesce(p_approved_fact, false))
  returning id into v_id;
  if p_mastery_estimate is not null then
    insert into public.observations (enrollment_id, skill_id, kind, value, weight, confidence, source_type, source_id, source_locator,
                                     quote, created_by_role)
    values (p_enrollment, p_skill, 'instructor', p_mastery_estimate, 1.0, 1.0, 'instructor_note', v_id::text,
            'Eğitmen notu · ' || app.tr_stamp(now(), false), left(p_body, 300), 'instructor')
    returning id into v_obs;
    perform public.apply_observation(v_obs);
  end if;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:add_instructor_note', 'instructor_notes', v_id::text);
  return v_id;
end
$$;
comment on function public.add_instructor_note(uuid, text, text, numeric, boolean) is 'Eğitmen notu; ustalık tahmini doluysa instructor gözlemi + apply_observation.';

create function public.resolve_misconception(p_misconception uuid, p_observation bigint) returns void
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_mc public.misconceptions%rowtype;
begin
  select mc.* into v_mc from public.misconceptions mc where mc.id = p_misconception for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-MISC-001 yanılgı yok';
  end if;
  if app.jwt_role() <> 'authenticated' or not app.can_edit_student(app.enrollment_student(v_mc.enrollment_id)) then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  if not exists (select 1 from public.observations o where o.id = p_observation and o.enrollment_id = v_mc.enrollment_id) then
    raise exception using errcode = 'P0001', message = 'OGR-EVID-001 çözüm kanıtı bu kayda ait değil';
  end if;
  update public.misconceptions mc set status = 'resolved', resolved_at = now(), resolved_by = app.uid(), resolution_observation_id = p_observation
   where mc.id = p_misconception;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:resolve_misconception', 'misconceptions', p_misconception::text);
end
$$;
comment on function public.resolve_misconception(uuid, bigint) is 'Yanılgıyı çözüldü işaretler (kanıt gözlemi zorunlu).';

create function public.reject_misconception(p_misconception uuid, p_note text) returns void
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_mc public.misconceptions%rowtype;
begin
  select mc.* into v_mc from public.misconceptions mc where mc.id = p_misconception for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-MISC-001 yanılgı yok';
  end if;
  if app.jwt_role() <> 'authenticated' or not app.can_edit_student(app.enrollment_student(v_mc.enrollment_id)) then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  update public.misconceptions mc set status = 'rejected', rejected_by = app.uid(), reject_note = p_note where mc.id = p_misconception;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:reject_misconception', 'misconceptions', p_misconception::text);
end
$$;
comment on function public.reject_misconception(uuid, text) is 'Yanılgıyı reddeder (eğitmen notuyla).';

-- p_decisions: [{"claim_id":"…","status":"approved|edited|rejected","edited_value":{…}}]
create function public.approve_lesson_analysis(p_analysis uuid, p_decisions jsonb) returns int
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_la public.lesson_analyses%rowtype;
  v_enr uuid;
  v_sid uuid;
  v_d jsonb;
  v_c public.lesson_claims%rowtype;
  v_v jsonb;
  v_obs bigint;
  v_mc uuid;
  v_n int := 0;
  v_any_edit boolean := false;
  v_held timestamptz;
begin
  select la.* into v_la from public.lesson_analyses la where la.id = p_analysis for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 analiz yok';
  end if;
  select l.enrollment_id, l.held_at into v_enr, v_held from public.lessons l where l.id = v_la.lesson_id;
  v_sid := app.enrollment_student(v_enr);
  if app.jwt_role() <> 'authenticated' or not app.can_edit_student(v_sid) then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  if v_la.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 zaten karar verilmiş';
  end if;
  perform set_config('ogrenmen.approver', 'on', true);
  for v_d in select x.dec from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) as x (dec) loop
    if v_d ->> 'status' not in ('approved', 'edited', 'rejected') then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-004 karar approved|edited|rejected';
    end if;
    v_c := null;
    update public.lesson_claims lc
       set status = v_d ->> 'status', edited_value = v_d -> 'edited_value', decided_by = app.uid(), decided_at = now()
     where lc.id = (v_d ->> 'claim_id')::uuid and lc.analysis_id = p_analysis
    returning lc.* into v_c;
    if v_c.id is null then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 iddia bu analize ait değil';
    end if;
    if v_c.status in ('approved', 'edited') then
      v_v := coalesce(v_c.edited_value, v_c.value);
      v_any_edit := v_any_edit or v_c.status = 'edited';
      if v_c.kind = 'skill_mastery' then
        insert into public.observations (enrollment_id, skill_id, kind, value, weight, confidence, source_type, source_id,
                                         source_locator, quote, created_by_role)
        values (v_enr, v_c.skill_id, 'lesson', (v_v ->> 'mastery')::numeric, 1.0, coalesce((v_v ->> 'confidence')::numeric, 0.8),
                'lesson_claim', v_c.id::text,
                'Ders ' || app.tr_stamp(coalesce(v_held, v_la.created_at), false) || ' · ' || to_char(make_interval(secs => v_c.t_start_sec), 'HH24:MI:SS'),
                left(v_c.quote, 300), 'instructor')
        returning id into v_obs;
        perform public.apply_observation(v_obs);
        v_n := v_n + 1;
      elsif v_c.kind = 'misconception' then
        insert into public.observations (enrollment_id, skill_id, kind, value, weight, confidence, source_type, source_id,
                                         source_locator, quote, misconception_tag, created_by_role)
        values (v_enr, v_c.skill_id, 'lesson', 0, 1.0, 0.8, 'lesson_claim', v_c.id::text,
                'Ders · ' || to_char(make_interval(secs => v_c.t_start_sec), 'HH24:MI:SS'), left(v_c.quote, 300),
                v_c.misconception_tag, 'instructor')
        returning id into v_obs;
        perform public.apply_observation(v_obs);
        if v_c.misconception_tag is null then   -- etiketsiz (serbest metin) yanılgı kaybolmaz
          insert into public.misconceptions (enrollment_id, skill_id, tag, text_instructor, text_student, status, evidence_count)
          values (v_enr, v_c.skill_id, null, coalesce(v_v ->> 'text', v_c.quote), coalesce(v_v ->> 'text_student', v_v ->> 'text', v_c.quote), 'open', 1)
          returning id into v_mc;
          insert into public.misconception_evidence (misconception_id, observation_id) values (v_mc, v_obs);
        end if;
        v_n := v_n + 1;
      elsif v_c.kind in ('homework', 'promise', 'deadline') then   -- lesson-analysis.commitments.kind ile birebir
        insert into public.memory_facts (student_id, kind, text, source_message_ids, source_lesson_claim_id, confidence, valid_until, model)
        values (v_sid, case when v_c.kind = 'promise' then 'promise' else 'deadline' end, left(coalesce(v_v ->> 'text', v_c.quote), 300),
                '{}', v_c.id, 0.9, (v_v ->> 'due')::date, v_la.model);
        -- embedding NULL; gece reembed --missing doldurur, retrieve_memory bu arada yalnız FTS ile sıralar
        v_n := v_n + 1;
      elsif v_c.kind = 'talk' then   -- dikkat/moral göstergeleri → moral olgusu → moral alarmı
        insert into public.memory_facts (student_id, kind, text, source_message_ids, source_lesson_claim_id, confidence, morale_signal, model)
        values (v_sid, 'morale',
                'Derste moral: ' || case v_v ->> 'morale' when 'low' then 'düşük' when 'medium' then 'orta' when 'high' then 'yüksek' else 'belirsiz' end
                  || '; konuşma oranı %' || round(coalesce((v_v ->> 'student_ratio')::numeric, 0) * 100)::int,
                '{}', v_c.id, 0.8,
                case v_v ->> 'morale' when 'low' then -2 when 'medium' then 0 when 'high' then 1 end,   -- unknown → null
                v_la.model);
        v_n := v_n + 1;
      elsif v_c.kind = 'followup' and v_v ->> 'status' = 'improved' then
        update public.misconceptions mc set status = 'pending_review'
         where mc.id = v_c.misconception_id and mc.enrollment_id = v_enr and mc.status = 'open';
      end if;
    end if;
  end loop;
  update public.lesson_analyses la set status = case when v_any_edit then 'corrected' else 'approved' end,
         approved_by = app.uid(), approved_at = now()
   where la.id = p_analysis;
  update public.lessons l set status = case when v_any_edit then 'corrected' else 'approved' end where l.id = v_la.lesson_id;
  update public.instructor_alerts a set status = 'done', resolved_at = now(), resolved_by = app.uid()
   where a.status = 'open' and a.kind = 'ops' and a.ref ->> 'lesson_id' = v_la.lesson_id::text;
  perform set_config('ogrenmen.approver', 'off', true);
  insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
  values (app.jwt_role(), 'staff:' || app.uid(), 'RPC:approve_lesson_analysis', 'lesson_analyses', p_analysis::text,
          jsonb_build_object('applied', v_n));
  return v_n;
end
$$;
comment on function public.approve_lesson_analysis(uuid, jsonb) is 'Ders analizi kararları: onaylanan iddialar gözlem/yanılgı/olgu olur (tek yol); analiz ve ders durumu güncellenir.';

-- Boru hatları ------------------------------------------------------------------------------------------

create function public.register_lesson(
  p_student_ref text, p_staff_id uuid, p_held_at timestamptz, p_duration int default null, p_video_ref text default null
) returns uuid
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sid uuid;
  v_enr uuid;
  v_id uuid;
begin
  if app.jwt_role() not in ('batch_worker', 'authenticated') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select s.id into v_sid from public.students s where s.public_ref = p_student_ref and s.status <> 'deleted';
  if v_sid is null then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 öğrenci yok';
  end if;
  if app.jwt_role() = 'authenticated' and not app.can_edit_student(v_sid) then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select e.id into v_enr from public.enrollments e where e.student_id = v_sid and e.status = 'active' order by e.started_at desc limit 1;
  if v_enr is null then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 aktif kayıt yok';
  end if;
  if not exists (select 1 from public.staff s where s.id = p_staff_id and s.active) then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 personel yok';
  end if;
  insert into public.lessons (enrollment_id, staff_id, held_at, duration_min, video_ref)
  values (v_enr, p_staff_id, p_held_at, p_duration, p_video_ref)
  returning id into v_id;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values (app.jwt_role(), case when app.jwt_role() = 'authenticated' then 'staff:' || app.uid() else 'batch_worker:ders' end,
          'RPC:register_lesson', 'lessons', v_id::text);
  return v_id;
end
$$;
comment on function public.register_lesson(text, uuid, timestamptz, int, text) is 'Ders kaydı (public_ref → aktif kayıt); video Storage''a girmez.';

-- Dersin öğrencisinin ('ÖĞRENCİ') ve eğitmeninin ('EĞİTMEN') ad-token hash'leri; düz ad dönmez
create function public.resolve_lesson_labels(p_lesson uuid) returns table (hash text, label text)
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sid uuid;
  v_staff uuid;
begin
  if app.jwt_role() <> 'batch_worker' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select e.student_id, l.staff_id into v_sid, v_staff
    from public.lessons l join public.enrollments e on e.id = l.enrollment_id where l.id = p_lesson;
  if v_sid is null then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 ders yok';
  end if;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values ('batch_worker', 'batch_worker:ders', 'RPC:resolve_lesson_labels', 'lessons', p_lesson::text);
  return query
  select y.h, y.lbl from (
    select distinct on (z.h) z.h, z.lbl, z.ord
      from (
        select h.hash as h, 'ÖĞRENCİ'::text as lbl, 1 as ord
          from secure.student_pii pii cross join lateral unnest(pii.name_token_hashes) as h (hash)
         where pii.student_id = v_sid
        union all
        select h.hash, 'EĞİTMEN'::text, 2
          from public.staff s cross join lateral unnest(app.pii_name_token_hashes(s.full_name)) as h (hash)
         where s.id = v_staff
      ) as z
     order by z.h, z.ord
  ) as y
  order by y.ord, y.h;
end
$$;
comment on function public.resolve_lesson_labels(uuid) is 'Ders transkripti etiketleme için ad-token hash → rol etiketi (düz ad yok); audit.';

-- lesson_analyses(draft) + lesson_claims(pending) analysis JSON'undan türetilir; observations YAZILMAZ
create function public.write_lesson_analysis(p_lesson uuid, p_seed_profile jsonb, p_analysis jsonb, p_model text, p_cost numeric default 0)
returns uuid
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_ver smallint;
  v_staff uuid;
  v_x jsonb;
  v_ev jsonb;
  v_talk jsonb;
begin
  if app.jwt_role() <> 'batch_worker' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select l.staff_id into v_staff from public.lessons l where l.id = p_lesson;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 ders yok';
  end if;
  select coalesce(max(la.version), 0) + 1 into v_ver from public.lesson_analyses la where la.lesson_id = p_lesson;
  insert into public.lesson_analyses (lesson_id, version, seed_profile, analysis, model, cost_usd)
  values (p_lesson, v_ver, coalesce(p_seed_profile, '{}'), p_analysis, p_model, coalesce(p_cost, 0))
  returning id into v_id;
  for v_x in select x.el from jsonb_array_elements(coalesce(p_analysis -> 'skills', '[]')) as x (el) loop
    v_ev := coalesce(v_x -> 'evidence' -> 0, '{}');
    insert into public.lesson_claims (analysis_id, kind, skill_id, value, quote, speaker, t_start_sec, t_end_sec)
    values (v_id, 'skill_mastery', v_x ->> 'skill_id',
            jsonb_build_object('mastery', (v_x ->> 'mastery_estimate')::numeric, 'confidence', (v_x ->> 'confidence')::numeric),
            coalesce(v_ev ->> 'quote', ''), coalesce(v_ev ->> 'speaker', 'ÖĞRENCİ'),
            coalesce(extract(epoch from (v_ev ->> 't')::interval)::int, 0), extract(epoch from (v_ev ->> 't_end')::interval)::int);
  end loop;
  for v_x in select x.el from jsonb_array_elements(coalesce(p_analysis -> 'misconceptions', '[]')) as x (el) loop
    v_ev := coalesce(v_x -> 'evidence' -> 0, '{}');
    insert into public.lesson_claims (analysis_id, kind, skill_id, misconception_tag, value, quote, speaker, t_start_sec, t_end_sec)
    values (v_id, 'misconception', v_x ->> 'skill_id', v_x ->> 'tag',
            jsonb_build_object('text', v_x ->> 'text_instructor', 'text_student', v_x ->> 'text_student',
                               'resolved_in_lesson', coalesce((v_x ->> 'resolved_in_lesson')::boolean, false)),
            coalesce(v_ev ->> 'quote', v_x ->> 'text_instructor'), coalesce(v_ev ->> 'speaker', 'ÖĞRENCİ'),
            coalesce(extract(epoch from (v_ev ->> 't')::interval)::int, 0), extract(epoch from (v_ev ->> 't_end')::interval)::int);
  end loop;
  for v_x in select x.el from jsonb_array_elements(coalesce(p_analysis -> 'questions', '[]')) as x (el) loop
    insert into public.lesson_claims (analysis_id, kind, skill_id, value, quote, speaker, t_start_sec)
    values (v_id, 'question', v_x ->> 'skill_id', jsonb_build_object('text', v_x ->> 'quote', 'answered', (v_x ->> 'answered')::boolean),
            v_x ->> 'quote', 'ÖĞRENCİ', coalesce(extract(epoch from (v_x ->> 't')::interval)::int, 0));
  end loop;
  for v_x in select x.el from jsonb_array_elements(coalesce(p_analysis -> 'hesitations', '[]')) as x (el) loop
    insert into public.lesson_claims (analysis_id, kind, skill_id, value, quote, speaker, t_start_sec)
    values (v_id, 'hesitation', v_x ->> 'skill_id', jsonb_build_object('kind', v_x ->> 'kind'),
            coalesce(v_x ->> 'quote', v_x ->> 'kind'), 'ÖĞRENCİ', coalesce(extract(epoch from (v_x ->> 't')::interval)::int, 0));
  end loop;
  for v_x in select x.el from jsonb_array_elements(coalesce(p_analysis -> 'commitments', '[]')) as x (el) loop
    insert into public.lesson_claims (analysis_id, kind, value, quote, speaker, t_start_sec)
    values (v_id, v_x ->> 'kind', jsonb_build_object('text', v_x ->> 'text', 'due', v_x -> 'due', 'who', v_x ->> 'who'),
            v_x ->> 'text', coalesce(v_x ->> 'who', 'ÖĞRENCİ'), coalesce(extract(epoch from (v_x ->> 't')::interval)::int, 0));
  end loop;
  for v_x in select x.el from jsonb_array_elements(coalesce(p_analysis -> 'previous_profile_check', '[]')) as x (el) loop
    v_ev := coalesce(v_x -> 'evidence' -> 0, '{}');
    insert into public.lesson_claims (analysis_id, kind, misconception_id, value, quote, speaker, t_start_sec)
    values (v_id, 'followup', (v_x ->> 'misconception_id')::uuid, jsonb_build_object('status', v_x ->> 'status'),
            coalesce(v_ev ->> 'quote', 'Önceki yanılgı denetimi'), coalesce(v_ev ->> 'speaker', 'EĞİTMEN'),
            coalesce(extract(epoch from (v_ev ->> 't')::interval)::int, 0));
  end loop;
  if p_analysis ? 'next_step' and jsonb_typeof(p_analysis -> 'next_step') = 'object' then
    insert into public.lesson_claims (analysis_id, kind, value, quote, speaker, t_start_sec)
    values (v_id, 'next_step', p_analysis -> 'next_step', coalesce(p_analysis #>> '{next_step,for_instructor}', 'Sonraki adım'), 'EĞİTMEN', 0);
  end if;
  v_talk := p_analysis -> 'talk';
  if v_talk is not null and jsonb_typeof(v_talk) = 'object' then   -- TEK claim kind='talk'
    insert into public.lesson_claims (analysis_id, kind, value, quote, speaker, t_start_sec)
    values (v_id, 'talk',
            jsonb_build_object('student_ratio', v_talk -> 'student_ratio', 'student_questions', v_talk -> 'student_questions',
                               'attention', v_talk -> 'attention', 'morale', v_talk -> 'morale'),
            coalesce(v_talk ->> 'notes', 'Konuşma oranı özeti'), 'EĞİTMEN', 0);
  end if;
  update public.lessons l set status = 'analyzed' where l.id = p_lesson;
  insert into public.instructor_alerts (kind, severity, staff_id, detail, since, ref)
  values ('ops', 'neutral', v_staff, 'Ders raporu onay bekliyor', now(), jsonb_build_object('lesson_id', p_lesson))
  on conflict do nothing;
  insert into audit.events (actor_role, actor_id, action, table_name, row_id, diff)
  values ('batch_worker', 'batch_worker:ders', 'RPC:write_lesson_analysis', 'lesson_analyses', v_id::text,
          jsonb_build_object('claims', (select count(*) from public.lesson_claims lc where lc.analysis_id = v_id)));
  return v_id;
end
$$;
comment on function public.write_lesson_analysis(uuid, jsonb, jsonb, text, numeric) is 'Ders analizini taslak olarak ve iddiaları bekleyen olarak yazar; gözlem yazmaz; ops alarmı açar.';

create function public.confirm_video_deleted(p_lesson uuid) returns void
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sid uuid;
  v_chat bigint;
begin
  if app.jwt_role() <> 'batch_worker' then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select e.student_id into v_sid from public.lessons l join public.enrollments e on e.id = l.enrollment_id where l.id = p_lesson;
  if v_sid is null then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 ders yok';
  end if;
  update public.lessons l set video_deleted_at = coalesce(l.video_deleted_at, now()), deletion_notified_at = now() where l.id = p_lesson;
  select cr.chat_id into v_chat from public.chat_roles cr join public.tg_chats t on t.chat_id = cr.chat_id
   where cr.student_id = v_sid and t.kind = 'private' order by cr.joined_at limit 1;
  insert into public.proactive_messages (student_id, chat_id, recipient, template_id, params, scheduled_for)
  values (v_sid, v_chat, 'student', 'video_deleted', jsonb_build_object('lesson_id', p_lesson), now()),
         (v_sid, null, 'guardian', 'video_deleted', jsonb_build_object('lesson_id', p_lesson), now())
  on conflict do nothing;
  update public.instructor_alerts a set status = 'done', resolved_at = now()
   where a.status = 'open' and a.kind = 'ops' and a.ref ->> 'lesson_id' = p_lesson::text and a.detail like 'Ders videosu silinmeyi bekliyor%';
  insert into audit.events (actor_role, actor_id, action, table_name, row_id)
  values ('batch_worker', 'batch_worker:ders', 'RPC:confirm_video_deleted', 'lessons', p_lesson::text);
end
$$;
comment on function public.confirm_video_deleted(uuid) is 'ders purge sonrası video silindi kaydı; öğrenciye ve veliye video_deleted bildirimi.';

create function public.enqueue_research(p_query text) returns uuid
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sid uuid := app.current_student();
  v_enabled boolean;
  v_allowed boolean;
  v_id uuid;
begin
  if app.jwt_role() <> 'bot_runtime' or v_sid is null then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-001 öğrenci başlığı gerekli';
  end if;
  select (rf.value)::boolean into v_enabled from public.runtime_flags rf where rf.key = 'research_enabled';
  if not coalesce(v_enabled, false) then
    raise exception using errcode = 'P0001', message = 'OGR-RES-001 araştırma kapalı';
  end if;
  select cq.allowed into v_allowed from public.consume_quota('research') as cq;
  if not coalesce(v_allowed, false) then
    raise exception using errcode = 'P0001', message = 'OGR-RES-001 araştırma kotası yok';
  end if;
  insert into public.research_requests (student_id, query) values (v_sid, left(p_query, 1000)) returning id into v_id;
  return v_id;
end
$$;
comment on function public.enqueue_research(text) is 'Öğrencinin araştırma isteğini kuyruğa alır (research_enabled ve research kotası).';

-- Prompt profili: en zayıf 3 GÜVENİLİR kazanım (band; yüzde ve p DÖNMEZ), açık yanılgılar, ön koşul ipucu,
-- açıklama notu, haftalık özetin son satırı
create function public.profile_for_prompt(p_enrollment uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sid uuid := app.enrollment_student(p_enrollment);
  v_weak jsonb;
  v_weakest text;
  v_mis jsonb;
  v_notes text;
  v_weekly text;
begin
  if v_sid is null then
    return null;
  end if;
  if app.jwt_role() = 'bot_runtime' and v_sid is distinct from app.current_student() then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-004 başka öğrenci';
  end if;
  if app.jwt_role() in ('authenticated', 'anon') then
    raise exception using errcode = 'P0001', message = 'OGR-AUTH-002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('skill_id', w.skill_id, 'name', w.skill_name, 'band', w.band) order by w.p, w.skill_id), '[]'::jsonb),
         (array_agg(w.skill_id order by w.p, w.skill_id))[1]
    into v_weak, v_weakest
    from (select mv.skill_id, mv.skill_name, mv.band, mv.p from public.mastery_view mv
           where mv.enrollment_id = p_enrollment and mv.is_reliable
           order by mv.p, mv.skill_id limit 3) as w;
  select coalesce(jsonb_agg(mc.text_student order by mc.last_seen desc), '[]'::jsonb) into v_mis
    from public.misconceptions mc where mc.enrollment_id = p_enrollment and mc.status = 'open';
  select pr.explanation_notes into v_notes from public.preferences pr where pr.student_id = v_sid;
  select regexp_replace(ws.body, '^.*[.!?]\s+(?=\S)', '') into v_weekly
    from public.weekly_summaries ws where ws.student_id = v_sid order by ws.week_start desc limit 1;
  return jsonb_build_object('weak', v_weak, 'misconceptions', v_mis,
                            'prereq_hint', case when v_weakest is not null then app.infer_prereq_gap(p_enrollment, v_weakest) end,
                            'explanation_notes', v_notes, 'weekly_line', v_weekly);
end
$$;
comment on function public.profile_for_prompt(uuid) is 'Sohbet/ders promptu için profil: zayıf güvenilir kazanımlar (bant), açık yanılgılar, ön koşul ipucu, notlar.';

grant execute on function public.register_lesson(text, uuid, timestamptz, int, text), public.write_lesson_analysis(uuid, jsonb, jsonb, text, numeric),
                          public.resolve_lesson_labels(uuid), public.confirm_video_deleted(uuid) to batch_worker;
grant execute on function public.register_lesson(text, uuid, timestamptz, int, text) to authenticated;   -- panel "Ders kaydet"
grant execute on function public.enqueue_research(text) to bot_runtime;
grant execute on function public.profile_for_prompt(uuid) to bot_runtime, batch_worker;
grant execute on function public.person_labels(uuid[]), public.resolve_alert(uuid), public.panel_overview(), public.audit_recent(int),
                          public.add_instructor_note(uuid, text, text, numeric, boolean), public.resolve_misconception(uuid, bigint),
                          public.reject_misconception(uuid, text), public.approve_lesson_analysis(uuid, jsonb) to authenticated;
