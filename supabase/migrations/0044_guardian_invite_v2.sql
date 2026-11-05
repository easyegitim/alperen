-- 0044_guardian_invite_v2.sql — veli davetinin gözden geçirilmesi (P6; docs/PLAN-v2.md §10). Öğrenci (ya da owner
-- eğitmen, admin) davet kodu üretir, veli kodu girer (0017 akışı aynı kalır; imzalar değişmez). Eklenenler:
--   * create_guardian_invite: yakınlık yalnız anne | baba | vasi | diğer (boş olabilir; OGR-INV-005); süresi dolmuş
--     bekleyen davetler temizlenir; öğrenci başına en çok settings.guardian_invite_pending_max (5) bekleyen davet
--     (OGR-INV-004) — kod üretimi sınırsız satır biriktirmez.
--   * accept_guardian_invite: kabulde öğrenciye 'guardian_linked' uygulama içi bildirimi (velisinin neyi görüp neyi
--     göremeyeceğini söyler: haftalık özet ve deneme sonuçları evet, koç sohbeti hayır); yanıtta öğrencinin adı.
--   * list_guardian_links(p_student): öğrenci/owner eğitmen/admin için bağlı veliler ve bekleyen davetler (token ve
--     hash dönmez); Profil'deki "Velilerim" listesi ve iptal (revoke_guardian_link) için.
-- Token biçimi değişmez ('gi_' + 32 base32, 160 bit; yalnız sha256 hex saklanır, tek kullanım, süre 72 sa).

insert into public.settings (key, value, description) values
  ('guardian_invite_pending_max', '5', 'Öğrenci başına aynı anda bekleyen (süresi dolmamış) veli daveti üst sınırı')
on conflict (key) do nothing;

create or replace function public.create_guardian_invite(p_student uuid, p_relation text default null) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_token text := 'gi_' || app.base32_random(32);
  v_relation text := nullif(btrim(coalesce(p_relation, '')), '');
  v_id uuid;
  v_exp timestamptz := now() + make_interval(hours => app.setting_num('guardian_invite_hours', 72)::int);
  v_pending int;
  v_max int := app.setting_num('guardian_invite_pending_max', 5)::int;
begin
  if not exists (select 1 from public.students s where s.id = p_student) then
    raise exception using errcode = 'P0001', message = 'OGR-INV-001 öğrenci bulunamadı';
  end if;
  if app.role() = 'parent' then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 veli davet oluşturamaz';
  end if;
  perform app.assert_student_access(p_student, true);
  if v_relation is not null and v_relation not in ('anne', 'baba', 'vasi', 'diğer') then
    raise exception using errcode = 'P0001', message = 'OGR-INV-005 yakınlık anne, baba, vasi ya da diğer olmalı';
  end if;
  perform pg_advisory_xact_lock(hashtext('guardian_invite:' || p_student::text));
  delete from public.guardian_links gl
   where gl.student_id = p_student and gl.status = 'invited' and gl.parent_id is null
     and gl.invite_expires_at is not null and gl.invite_expires_at < now();
  select count(*) into v_pending from public.guardian_links gl
   where gl.student_id = p_student and gl.status = 'invited' and gl.parent_id is null;
  if v_pending >= v_max then
    raise exception using errcode = 'P0001',
      message = format('OGR-INV-004 bekleyen davet sınırı (%s) doldu; eski bir daveti iptal edin ya da süresinin dolmasını bekleyin', v_max);
  end if;
  insert into public.guardian_links (student_id, relation, status, invite_token_hash, invite_expires_at, created_by)
  values (p_student, v_relation, 'invited', encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_exp, auth.uid())
  returning id into v_id;
  return jsonb_build_object('link_id', v_id, 'token', v_token, 'expires_at', v_exp);
end
$$;
comment on function public.create_guardian_invite(uuid, text) is 'Veli daveti: token bir kez döner, yalnız sha256 hex saklanır (öğrenci, owner eğitmen, admin); yakınlık doğrulanır; bekleyen davet sınırı.';

create or replace function public.accept_guardian_invite(p_token text) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_gl public.guardian_links%rowtype;
  v_role text;
  v_existing uuid;
  v_id uuid;
  v_student_profile uuid;
  v_student_name text;
  v_parent_name text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 oturum gerekli';
  end if;
  select gl.* into v_gl from public.guardian_links gl
   where gl.invite_token_hash = encode(sha256(convert_to(btrim(coalesce(p_token, '')), 'UTF8')), 'hex') and gl.status = 'invited'
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-INV-001 davet bulunamadı ya da kullanılmış';
  end if;
  if v_gl.invite_expires_at is not null and v_gl.invite_expires_at < now() then
    raise exception using errcode = 'P0001', message = 'OGR-INV-002 davetin süresi doldu';
  end if;
  v_role := app.role();
  if v_role is null then
    insert into public.profiles (id, role) values (auth.uid(), 'parent');
  elsif v_role <> 'parent' then
    raise exception using errcode = 'P0001', message = format('OGR-INV-003 yalnız veli hesabı kabul edebilir (rol %s)', v_role);
  end if;
  select gl.id into v_existing from public.guardian_links gl where gl.parent_id = auth.uid() and gl.student_id = v_gl.student_id;
  if v_existing is not null then
    update public.guardian_links gl
       set status = 'active', accepted_at = now(), relation = coalesce(v_gl.relation, gl.relation), invite_token_hash = null
     where gl.id = v_existing;
    delete from public.guardian_links gl where gl.id = v_gl.id;   -- davet satırı (veli boş) kapanır; tekil bağ korunur
    v_id := v_existing;
  else
    update public.guardian_links gl
       set parent_id = auth.uid(), status = 'active', accepted_at = now(), invite_token_hash = null
     where gl.id = v_gl.id;
    v_id := v_gl.id;
  end if;
  select s.profile_id, app.first_name(pr.display_name) into v_student_profile, v_student_name
    from public.students s left join public.profiles pr on pr.id = s.profile_id where s.id = v_gl.student_id;
  select nullif(btrim(pr.display_name), '') into v_parent_name from public.profiles pr where pr.id = auth.uid();
  if v_student_profile is not null then
    perform app.notify_emit(v_student_profile, 'guardian_linked',
                            jsonb_strip_nulls(jsonb_build_object('student_id', v_gl.student_id, 'link_id', v_id,
                                                                 'parent_name', coalesce(v_parent_name,
                                                                                         case v_gl.relation when 'anne' then 'Annen'
                                                                                                            when 'baba' then 'Baban' end),
                                                                 'url', '/ogrenci/profil', 'dedupe_key', 'link:' || v_id::text)));
  end if;
  return jsonb_build_object('link_id', v_id, 'student_id', v_gl.student_id, 'student_name', v_student_name);
end
$$;
comment on function public.accept_guardian_invite(text) is 'Veli davetini kabul eder (token sha256 eşleşmesi, süre, tek kullanım); bağ active olur; öğrenciye guardian_linked bildirimi.';

-- Öğrencinin veli bağları: [{link_id, status active|invited, relation, parent_name, accepted_at, invite_expires_at,
-- created_at}] (iptal edilmiş bağ ve süresi dolmuş davet yok; token/hash yok). Öğrenci, owner eğitmen, admin.
create or replace function public.list_guardian_links(p_student uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_out jsonb;
begin
  if app.role() = 'parent' then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 veli bağ listesini göremez';
  end if;
  perform app.assert_student_access(p_student, true);
  select coalesce(jsonb_agg(jsonb_build_object('link_id', gl.id, 'status', gl.status, 'relation', gl.relation,
                                               'parent_name', pr.display_name, 'accepted_at', gl.accepted_at,
                                               'invite_expires_at', gl.invite_expires_at, 'created_at', gl.created_at)
                            order by (gl.status = 'active') desc, gl.created_at desc), '[]'::jsonb)
    into v_out
    from public.guardian_links gl
    left join public.profiles pr on pr.id = gl.parent_id
   where gl.student_id = p_student
     and (gl.status = 'active' or (gl.status = 'invited' and (gl.invite_expires_at is null or gl.invite_expires_at >= now())));
  return v_out;
end
$$;
comment on function public.list_guardian_links(uuid) is 'Öğrencinin aktif veli bağları ve bekleyen davetleri (token/hash yok); öğrenci, owner eğitmen, admin.';

revoke all on function public.list_guardian_links(uuid) from public, anon;
grant execute on function public.list_guardian_links(uuid) to authenticated, service_role;
