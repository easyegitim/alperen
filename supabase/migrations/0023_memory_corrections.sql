-- 0023_memory_corrections.sql — hafıza dosyalarına öğrenci yazımı kapanır; öğrenci düzeltme ister, koç işler
-- (docs/PLAN-v2.md §3.2: "Öğrenci Profil → 'Öğrenmen senin hakkında ne biliyor' ile okur, düzeltme ister").
-- upsert_memory_file artık yalnız worker'ın hafıza aracı (service_role), owner eğitmen ve admin içindir; öğrenci
-- (ve veli) OGR-AUTH-001 alır. Öğrenci request_memory_correction(p_path, p_text) ile memory_corrections'a satır açar ve
-- 'memory.correction' işi kuyruğa atılır; koç dosyayı hafıza aracıyla düzeltir ve resolve_memory_correction ile kapatır.

create table public.memory_corrections (  -- Öğrencinin hafıza düzeltme istekleri; koç (worker) ya da eğitmen işler.
  id uuid primary key default gen_random_uuid(),  -- İstek kimliği
  student_id uuid not null references public.students (id) on delete cascade,  -- Öğrenci
  path text not null,  -- Düzeltilecek hafıza dosyası (/memories/…)
  text text not null check (char_length(text) between 1 and 1000),  -- Öğrencinin düzeltme metni (≤ 1000 karakter)
  status text not null default 'open' check (status in ('open', 'applied', 'rejected')),  -- Durum
  requested_by uuid references public.profiles (id) on delete set null,  -- İsteyen profil
  resolved_by text,  -- İşleyen: 'coach' | 'instructor:<uuid>' | 'admin:<uuid>'
  resolution_note text check (char_length(resolution_note) <= 500),  -- Koçun kısa notu (öğrenciye görünür)
  resolved_at timestamptz,  -- İşlenme zamanı
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.memory_corrections
comment on table public.memory_corrections is 'Öğrencinin hafıza düzeltme istekleri; koç (worker) ya da eğitmen işler.';
comment on column public.memory_corrections.id is 'İstek kimliği';
comment on column public.memory_corrections.student_id is 'Öğrenci';
comment on column public.memory_corrections.path is 'Düzeltilecek hafıza dosyası (/memories/…)';
comment on column public.memory_corrections.text is 'Öğrencinin düzeltme metni (≤ 1000 karakter)';
comment on column public.memory_corrections.status is 'Durum';
comment on column public.memory_corrections.requested_by is 'İsteyen profil';
comment on column public.memory_corrections.resolved_by is 'İşleyen: ''coach'' | ''instructor:<uuid>'' | ''admin:<uuid>''';
comment on column public.memory_corrections.resolution_note is 'Koçun kısa notu (öğrenciye görünür)';
comment on column public.memory_corrections.resolved_at is 'İşlenme zamanı';
comment on column public.memory_corrections.created_at is 'Oluşturulma zamanı';
-- end comments public.memory_corrections
create index memory_corrections_open on public.memory_corrections (student_id, created_at) where status = 'open';
alter table public.memory_corrections enable row level security;
alter table public.memory_corrections force row level security;

grant select on public.memory_corrections to authenticated;
create policy memory_corrections_select on public.memory_corrections for select to authenticated
using (app.can_read_student_data(student_id));

-- Hafıza dosyası yazarı: güvenilir çağıran (worker'ın hafıza aracı, gece işleri), admin ya da öğrencinin owner eğitmeni
create or replace function app.assert_memory_writer(p_student uuid) returns void
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if app.is_trusted() or app.is_admin() then
    return;
  end if;
  if p_student is not null and auth.uid() is not null and app.role() = 'instructor'
     and exists (select 1 from public.instructor_links il
                  where il.instructor_id = auth.uid() and il.student_id = p_student and il.role = 'owner') then
    return;
  end if;
  raise exception using errcode = '42501',
    message = 'OGR-AUTH-001 hafıza dosyasını yalnız koç (worker), owner eğitmen ya da admin yazar; öğrenci düzeltme ister (request_memory_correction)';
end
$$;
comment on function app.assert_memory_writer(uuid) is 'Hafıza yazımı: worker, admin ya da owner eğitmen; öğrenci ve veli değil (OGR-AUTH-001).';
revoke all on function app.assert_memory_writer(uuid) from public;

-- 0017'deki upsert_memory_file ile aynı; farklar: yazar denetimi (app.assert_memory_writer) ve koşullu yazım
-- (p_expected_hash: okunduğu andaki içeriğin md5'i; öğrenci kilidi alındıktan sonra güncel içerikle karşılaştırılır,
-- eşleşmezse OGR-MEM-028 — eşzamanlı iki yazıcının (koç, memory-delta, gece sıkıştırması) birbirinin düzenlemesini
-- ezmesini önler; çağıran yeniden okuyup bir kez daha dener). Dosya yokken beklenen hash verilirse yine OGR-MEM-028.
-- İmza değiştiği için eski 6 argümanlı sürüm düşürülür (çağrılar 6 argümanla aynı kalır; varsayılan null).
drop function if exists public.upsert_memory_file(uuid, text, text, text, text, text);
create function public.upsert_memory_file(
  p_student uuid, p_path text, p_content text, p_op text, p_actor text, p_new_path text default null,
  p_expected_hash text default null
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
  v_actor text := p_actor;
begin
  perform app.assert_memory_writer(p_student);
  if not app.is_trusted() then
    v_actor := coalesce(app.role(), 'user') || ':' || auth.uid()::text;
  end if;
  if p_op is null or p_op not in ('create', 'str_replace', 'insert', 'delete', 'rename', 'compact') then
    raise exception using errcode = 'P0001', message = format('OGR-MEM-004 geçersiz işlem %s', coalesce(p_op, '(boş)'));
  end if;
  if nullif(btrim(v_actor), '') is null or char_length(v_actor) > 64 then
    raise exception using errcode = 'P0001', message = 'OGR-MEM-004 actor gerekli (≤ 64 karakter)';
  end if;
  if not app.memory_path_ok(p_path) or (p_op = 'rename' and not app.memory_path_ok(p_new_path)) then
    raise exception using errcode = 'P0001', message = format('OGR-MEM-003 yol izin listesinde değil: %s', coalesce(p_new_path, p_path));
  end if;
  if (p_path = '/memories/parent_summary.md' or p_new_path = '/memories/parent_summary.md') and not app.is_trusted() then
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
  values (p_student, v_target, v_version, p_op, v_actor, v_content);
  return jsonb_build_object('path', v_target, 'version', v_version, 'op', p_op,
                            'bytes', coalesce(octet_length(v_content), 0), 'from_path', case when p_op = 'rename' then p_path end);
end
$$;
comment on function public.upsert_memory_file(uuid, text, text, text, text, text, text) is 'Hafıza dosyası yazar (create/str_replace/insert/compact/delete/rename), sürüm ekler; ≤ 12 dosya, ≤ 8 KB, /memories/ izin listesi; p_expected_hash (md5) verilirse koşullu yazar (OGR-MEM-028); yalnız worker, owner eğitmen, admin.';
revoke all on function public.upsert_memory_file(uuid, text, text, text, text, text, text) from public;
grant execute on function public.upsert_memory_file(uuid, text, text, text, text, text, text) to authenticated, service_role;

-- Öğrencinin düzeltme isteği: yol izin listesinde olmalı (dosyanın var olması gerekmez: "bunu da bil" isteği); metin
-- 1–1000 karakter; öğrenci başına en çok 20 açık istek (OGR-MEM-009). 'memory.correction' işi kuyruğa atılır.
-- Döner: {id, path, status}.
create or replace function public.request_memory_correction(p_path text, p_text text) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
  v_text text := btrim(coalesce(p_text, ''));
  v_id uuid;
begin
  if v_student is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 düzeltmeyi yalnız öğrencinin kendisi ister';
  end if;
  if not app.memory_path_ok(p_path) then
    raise exception using errcode = 'P0001', message = format('OGR-MEM-003 yol izin listesinde değil: %s', coalesce(p_path, '(boş)'));
  end if;
  if char_length(v_text) not between 1 and 1000 then
    raise exception using errcode = 'P0001', message = 'OGR-MEM-008 düzeltme metni 1–1000 karakter olmalı';
  end if;
  perform pg_advisory_xact_lock(hashtext('memory_corrections:' || v_student::text));
  if (select count(*) from public.memory_corrections mc where mc.student_id = v_student and mc.status = 'open') >= 20 then
    raise exception using errcode = 'P0001', message = 'OGR-MEM-009 açık düzeltme isteği sınırı (20) doldu';
  end if;
  insert into public.memory_corrections (student_id, path, text, requested_by)
  values (v_student, p_path, v_text, auth.uid())
  returning id into v_id;
  perform app.try_enqueue('memory.correction', jsonb_build_object('correction_id', v_id, 'student_id', v_student, 'path', p_path));
  return jsonb_build_object('id', v_id, 'path', p_path, 'status', 'open');
end
$$;
comment on function public.request_memory_correction(text, text) is 'Öğrencinin hafıza düzeltme isteği (memory_corrections, open) + memory.correction işi; ≤ 20 açık istek.';

-- İsteği kapatır (koç dosyayı hafıza aracıyla düzelttikten sonra): applied | rejected + kısa not. Yalnız worker, owner
-- eğitmen, admin. Kapalı istek OGR-MEM-010.
create or replace function public.resolve_memory_correction(p_id uuid, p_applied boolean, p_note text default null) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_mc public.memory_corrections%rowtype;
  v_by text;
begin
  select mc.* into v_mc from public.memory_corrections mc where mc.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-MEM-010 düzeltme isteği yok %s', p_id);
  end if;
  perform app.assert_memory_writer(v_mc.student_id);
  if v_mc.status <> 'open' then
    raise exception using errcode = 'P0001', message = format('OGR-MEM-010 istek zaten kapalı (%s)', v_mc.status);
  end if;
  v_by := case when app.is_trusted() then 'coach' else coalesce(app.role(), 'user') || ':' || auth.uid()::text end;
  update public.memory_corrections mc
     set status = case when coalesce(p_applied, false) then 'applied' else 'rejected' end,
         resolved_by = v_by, resolution_note = left(nullif(btrim(p_note), ''), 500), resolved_at = now()
   where mc.id = p_id;
  return jsonb_build_object('id', p_id, 'status', case when coalesce(p_applied, false) then 'applied' else 'rejected' end,
                            'resolved_by', v_by);
end
$$;
comment on function public.resolve_memory_correction(uuid, boolean, text) is 'Hafıza düzeltme isteğini kapatır (applied | rejected + not); yalnız worker, owner eğitmen, admin.';

revoke all on function public.request_memory_correction(text, text), public.resolve_memory_correction(uuid, boolean, text) from public;
grant execute on function public.request_memory_correction(text, text), public.resolve_memory_correction(uuid, boolean, text)
to authenticated, service_role;
