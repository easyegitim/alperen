-- 0025_curriculum_builder.sql — dinamik müfredat kurucu (docs/PLAN-v2.md §3.5; apps/worker curriculum.* işleri ve
-- apps/web /egitmen/mufredatlar ağaç editörü).
--   * curricula'ya taslak işinin durumu ve ilerlemesi (Realtime ile izlenir), otopilot seçimi, sürüm zinciri.
--   * save_curriculum_draft: worker'ın doğrulanmış curriculum-draft çıktısını TEK işlemde yazması (kazanımlar +
--     kind'a göre BKT varsayılanları + ön koşullar + yanılgı etiketleri; otopilot etkinse kayıtlı öğrencilere ilk
--     'practice' önerisi — kapalıysa öneri eğitmenin yayınıyla gelir, PLAN-v2 §3.5).
--   * curriculum_draft_supersede: aynı ders için aktif müfredat varsa taslağı bırakıp kayıtları ona taşır.
--   * curriculum_draft_retry: düşen (failed) taslağı eğitmen yeniden kuyruğa atar (isteğe bağlı kaynak yüklemeleriyle).
--   * Eğitmen editörü (yalnız taslak sürümde): curriculum_edit (rename | add | move | merge), curriculum_new_version
--     (aynı kod, sürüm + 1, ağaç kopyalanır), curriculum_publish (taslak → aktif; aynı kodun önceki sürümleri emekli,
--     kayıtlar, ustalık ve sürüme bağlı içerik — soru bankası, şablonlar, tarzlar, izlence, havuz, sınavlar — kazanım
--     koduyla taşınır), curriculum_set_autopilot, curriculum_editor_state.
--   * curriculum_autopilot_accept: otopilotun güvenli kabulü; yayındaki ağaca asla yazmaz (açık taslak sürüme uygular).
--   * decide_proposal (0017'nin yerine): eğitmenin kabulü de yayındaki ağaca yazmaz; öneri açık taslak sürüme taşınır.
--   * Yayında açık öneriler yeni sürüme taşınır (app.carry_curriculum); daha yeni açık taslak varken eski sürüm
--     yayınlanmaz (OGR-CURR-026).
-- Yetki: düzenleme ve öneri kararı decide_proposal kuralı (app.can_edit_curriculum); yayın, yeni sürüm ve otopilot
-- daha dar kural (app.can_publish_curriculum: başka eğitmenin öğrencisini etkileyemez); taslak yazımı yalnız worker/admin.
-- draft_meta ve draft_error personele özeldir (sütun yetkisi; editör curriculum_editor_state ile okur).
-- Hata kodları: OGR-CURR-010.. (001–004 0004'te).

-- Taslak işinin durumu: queued (iş kuyrukta) → researching → drafting → saving → ready | failed (draft_error) |
-- skipped (aynı ders için aktif müfredat bulundu; kayıtlar ona taşındı). Boş: taslak işi olmayan (seed/eğitmen) sürüm.
alter table public.curricula add column draft_status text check (draft_status in ('queued', 'researching', 'drafting', 'saving', 'ready', 'failed', 'skipped'));  -- Taslak işinin durumu
alter table public.curricula add column draft_progress smallint not null default 0 check (draft_progress between 0 and 100);  -- Taslak işinin ilerlemesi (0..100)
alter table public.curricula add column draft_error text;  -- Taslak işi düştüyse nedeni (Türkçe, kısa)
alter table public.curricula add column draft_updated_at timestamptz;  -- Taslak durumunun son değiştiği an
alter table public.curricula add column draft_meta jsonb not null default '{}' check (jsonb_typeof(draft_meta) = 'object');  -- Taslak bilgisi: confidence, notes_for_instructor, code_map (birleştirilen → kalan) …
alter table public.curricula add column autopilot boolean;  -- Eğitmenin otopilot seçimi (boş: runtime_flags.curriculum_autopilot)
alter table public.curricula add column previous_id uuid references public.curricula (id) on delete set null;  -- Bu sürümün kopyalandığı sürüm
alter table public.curricula add column published_at timestamptz;  -- Yayınlanma (aktif olma) zamanı
alter table public.curricula add column edited_at timestamptz;  -- Eğitmenin ağaçta son değişikliği
comment on column public.curricula.draft_status is 'Taslak işinin durumu';
comment on column public.curricula.draft_progress is 'Taslak işinin ilerlemesi (0..100)';
comment on column public.curricula.draft_error is 'Taslak işi düştüyse nedeni (Türkçe, kısa)';
comment on column public.curricula.draft_updated_at is 'Taslak durumunun son değiştiği an';
comment on column public.curricula.draft_meta is 'Taslak bilgisi: confidence, notes_for_instructor, code_map (birleştirilen → kalan) …';
comment on column public.curricula.autopilot is 'Eğitmenin otopilot seçimi (boş: runtime_flags.curriculum_autopilot)';
comment on column public.curricula.previous_id is 'Bu sürümün kopyalandığı sürüm';
comment on column public.curricula.published_at is 'Yayınlanma (aktif olma) zamanı';
comment on column public.curricula.edited_at is 'Eğitmenin ağaçta son değişikliği';
create index curricula_code_status on public.curricula (code, status);

-- onboarding_enroll'un açtığı ai_draft iskeletleri iş kuyruğunda bekler
update public.curricula as c set draft_status = 'queued', draft_updated_at = now()
 where c.origin = 'ai_draft' and c.status = 'draft' and c.draft_status is null
   and not exists (select 1 from public.skills as s where s.curriculum_id = c.id);

-- onboarding_enroll yeni ai_draft iskeletini (kazanımsız, kopya değil) açınca durum 'queued' olur: istemci ilk andan
-- "hazırlanıyor" gösterir; worker işi aldığında researching'e geçirir
create or replace function app.curricula_draft_queued() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if new.origin = 'ai_draft' and new.status = 'draft' and new.previous_id is null and new.draft_status is null then
    new.draft_status := 'queued';
    new.draft_updated_at := now();
  end if;
  return new;
end
$$;
comment on function app.curricula_draft_queued() is 'BEFORE INSERT: yeni ai_draft taslak iskeletinde draft_status = queued.';
revoke all on function app.curricula_draft_queued() from public;
create trigger curricula_draft_queued before insert on public.curricula
for each row execute function app.curricula_draft_queued();

-- Realtime: taslak ilerlemesi istemcide izlenir (Supabase'de supabase_realtime yayını vardır; yerelde yoksa atlanır)
do $$
begin
  if exists (select 1 from pg_publication p where p.pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables pt
                      where pt.pubname = 'supabase_realtime' and pt.schemaname = 'public' and pt.tablename = 'curricula') then
    execute 'alter publication supabase_realtime add table public.curricula';
  end if;
end
$$;

-- --- yardımcılar ------------------------------------------------------------------------------------

-- Kod parçası: Türkçe harfler ASCII, küçük harf, harf/rakam dışı tire (SKILL_CODE parçası); boşsa 'k'
create or replace function app.code_slug(p_text text) returns text
language sql
immutable
set search_path = pg_catalog, app
as $$
  select coalesce(nullif(left(replace(app.norm_text(p_text), ' ', '-'), 40), ''), 'k')
$$;
comment on function app.code_slug(text) is 'Kazanım kodu parçası: norm_text, boşluk → tire, en çok 40 karakter; boşsa k.';

-- Düğüm türüne göre yaprak BKT varsayılanları (p_init, p_learn, p_guess, p_slip): ünite > kazanım > alt kazanım genişliği
create or replace function app.bkt_defaults(p_kind text) returns numeric[]
language sql
immutable
set search_path = pg_catalog
as $$
  select case coalesce(p_kind, 'sub_outcome')
           when 'unit' then array[0.350, 0.080, 0.250, 0.100]::numeric[]
           when 'outcome' then array[0.300, 0.120, 0.250, 0.100]::numeric[]
           else array[0.250, 0.150, 0.250, 0.100]::numeric[]
         end
$$;
comment on function app.bkt_defaults(text) is 'Düğüm türüne göre BKT varsayılanları {p_init, p_learn, p_guess, p_slip} (unit | outcome | sub_outcome).';

-- Kazanımın derinliği (kök = 1)
create or replace function app.skill_depth(p_curriculum uuid, p_skill text) returns int
language sql
stable
set search_path = public, app, pg_temp
as $$
  with recursive up (id, parent_id, depth) as (
    select s.id, s.parent_id, 1 from public.skills s where s.curriculum_id = p_curriculum and s.id = p_skill
    union all
    select s.id, s.parent_id, up.depth + 1
      from public.skills s join up on s.id = up.parent_id
     where s.curriculum_id = p_curriculum and up.depth < 16
  )
  select max(up.depth)::int from up
$$;
comment on function app.skill_depth(uuid, text) is 'Kazanımın ağaçtaki derinliği (kök = 1); yoksa null.';

-- Alt ağacın yüksekliği (yaprak = 1)
create or replace function app.skill_height(p_curriculum uuid, p_skill text) returns int
language sql
stable
set search_path = public, app, pg_temp
as $$
  with recursive down (id, h) as (
    select s.id, 1 from public.skills s where s.curriculum_id = p_curriculum and s.id = p_skill
    union all
    select s.id, down.h + 1
      from public.skills s join down on s.parent_id = down.id
     where s.curriculum_id = p_curriculum and down.h < 16
  )
  select max(down.h)::int from down
$$;
comment on function app.skill_height(uuid, text) is 'Kazanımın alt ağacının yüksekliği (yaprak = 1); yoksa null.';

-- Müfredatı düzenleyebilir mi: worker/admin ya da eğitmen (müfredatın ya da dersinin sahibi, dersin öğrencisine bağlı).
-- decide_proposal ile aynı kural. Yayındaki sürümden açılmış taslakta dersler hâlâ önceki sürüme bağlıdır: önceki
-- sürümün dersleri de sayılır.
create or replace function app.can_edit_curriculum(p_curriculum uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_prev uuid;
begin
  if app.is_trusted() or app.is_admin() then
    return true;
  end if;
  if auth.uid() is null or coalesce(app.role(), '') <> 'instructor' then
    return false;
  end if;
  select c.previous_id into v_prev from public.curricula c where c.id = p_curriculum;
  return exists (select 1 from public.curricula c where c.id = p_curriculum and c.created_by = auth.uid())
      or exists (select 1 from public.courses co
                  where (co.curriculum_id = p_curriculum or co.curriculum_id = v_prev)
                    and (co.created_by = auth.uid()
                         or exists (select 1 from public.instructor_links il
                                     where il.instructor_id = auth.uid() and (il.course_id = co.id or il.course_id is null)
                                       and exists (select 1 from public.enrollments e
                                                    where e.student_id = il.student_id and e.course_id = co.id))));
end
$$;
comment on function app.can_edit_curriculum(uuid) is 'Müfredatı düzenleyebilir mi (decide_proposal kuralı): worker, admin, müfredatın/dersin (ya da önceki sürümün dersinin) sahibi ya da dersin öğrencisine bağlı eğitmen.';

-- Yayınlayabilir / yeni sürüm açabilir / otopilotu değiştirebilir mi: worker, admin, müfredatın (ya da önceki sürümün)
-- ya da dersinin sahibi eğitmen; öğrenci üzerinden bağlı eğitmen yalnız bu kodun (taslak + aktif sürümlerin) bütün
-- etkin kayıtları kendi öğrencisiyse. Paylaşılan müfredatta bir eğitmen başka eğitmenin öğrencilerini taşıyamaz.
create or replace function app.can_publish_curriculum(p_curriculum uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_c public.curricula%rowtype;
begin
  if app.is_trusted() or app.is_admin() then
    return true;
  end if;
  if auth.uid() is null or coalesce(app.role(), '') <> 'instructor' then
    return false;
  end if;
  select c.* into v_c from public.curricula c where c.id = p_curriculum;
  if not found then
    return false;
  end if;
  if v_c.created_by = auth.uid()
     or exists (select 1 from public.curricula p where p.id = v_c.previous_id and p.created_by = auth.uid())
     or exists (select 1 from public.courses co
                 where (co.curriculum_id = p_curriculum or co.curriculum_id = v_c.previous_id) and co.created_by = auth.uid()) then
    return true;
  end if;
  return app.can_edit_curriculum(p_curriculum)
     and not exists (
       select 1 from public.enrollments e join public.curricula c on c.id = e.curriculum_id
        where c.code = v_c.code and c.status in ('draft', 'active') and e.status = 'active'
          and not exists (select 1 from public.instructor_links il
                           where il.instructor_id = auth.uid() and il.student_id = e.student_id
                             and (il.course_id is null or il.course_id = e.course_id)));
end
$$;
comment on function app.can_publish_curriculum(uuid) is 'Yayın/yeni sürüm/otopilot yetkisi: worker, admin, müfredatın ya da dersinin sahibi; bağlı eğitmen yalnız bütün etkin kayıtlar kendi öğrencisiyse.';

-- Otopilot: yalnız yapay zekâ taslağı (origin ai_draft) ve sınav parkuru TYT/AYT/LGS müfredatında uygundur; etkinliği
-- eğitmen seçimi (curricula.autopilot) ya da runtime_flags.curriculum_autopilot[ders türü].
create or replace function public.curriculum_autopilot_state(p_curriculum uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_c public.curricula%rowtype;
  v_kind text;
  v_text text;
  v_flag boolean;
  v_exam boolean;
  v_eligible boolean;
begin
  select c.* into v_c from public.curricula c where c.id = p_curriculum;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-CURR-010 müfredat yok %s', p_curriculum);
  end if;
  if not (app.is_trusted() or app.is_staff() or app.can_read_curriculum(p_curriculum)) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu müfredat için yetki yok';
  end if;
  select coalesce(min(co.kind), 'other'), string_agg(co.code || ' ' || co.title, ' ')
    into v_kind, v_text
    from public.courses co where co.curriculum_id = p_curriculum;
  select coalesce((rf.value ->> v_kind)::boolean, false) into v_flag
    from public.runtime_flags rf where rf.key = 'curriculum_autopilot';
  v_flag := coalesce(v_flag, false);
  v_exam := app.norm_text(v_c.code || ' ' || v_c.label || ' ' || coalesce(v_text, '')) ~ '(^| )(tyt|ayt|lgs)( |$)';
  v_eligible := v_c.origin = 'ai_draft' and v_exam;
  return jsonb_build_object(
    'curriculum_id', p_curriculum, 'eligible', v_eligible, 'effective', v_eligible and coalesce(v_c.autopilot, v_flag),
    'override', v_c.autopilot, 'flag', v_flag, 'course_kind', v_kind,
    'reason', case when v_c.origin <> 'ai_draft' then 'origin' when not v_exam then 'not_exam_track'
                   when v_c.autopilot is not null then 'instructor' else 'flag' end);
end
$$;
comment on function public.curriculum_autopilot_state(uuid) is 'Otopilot durumu {eligible, effective, override, flag, course_kind, reason}: yalnız ai_draft + TYT/AYT/LGS; eğitmen seçimi ya da runtime_flags.curriculum_autopilot.';

-- İlk 'practice' önerisi (rank 0): ilk ünitenin (kökün ilk çocuğu) ilk 3 yaprağı; ünitede yaprak yoksa ağacın ilk 3
-- yaprağı. Yalnız henüz başlamamış etkin kayıtlara (açık 'practice' önerisi ve ustalık satırı yok) eklenir: taslak
-- kaydında otopilot etkinse save_curriculum_draft, değilse eğitmenin yayını (curriculum_publish) çağırır.
-- Döner: {suggestions, skill_ids}.
create or replace function app.first_practice_suggestion(p_curriculum uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_label text;
  v_root text;
  v_unit_id text;
  v_unit_name text;
  v_leaf_ids text[];
  v_count int := least(10, greatest(1, app.setting_num('practice_set_size', 8)::int));
  v_minutes int;
  v_sug int := 0;
begin
  select c.label into v_label from public.curricula c where c.id = p_curriculum;
  select s.id into v_root from public.skills s where s.curriculum_id = p_curriculum and s.parent_id is null order by s.order_no, s.id limit 1;
  if v_root is null then
    return jsonb_build_object('suggestions', 0, 'skill_ids', '[]'::jsonb);
  end if;
  select s.id, s.name into v_unit_id, v_unit_name from public.skills s
   where s.curriculum_id = p_curriculum and s.parent_id = v_root order by s.order_no, s.id limit 1;
  with recursive d (id) as (
    select v_unit_id where v_unit_id is not null
    union all
    select s.id from public.skills s join d on s.parent_id = d.id where s.curriculum_id = p_curriculum
  )
  select array_agg(q.id order by q.order_no, q.id) into v_leaf_ids
    from (select s.id, s.order_no from public.skills s join d on d.id = s.id
           where s.curriculum_id = p_curriculum and s.is_leaf order by s.order_no, s.id limit 3) as q;
  if v_leaf_ids is null then
    select array_agg(q.id order by q.order_no, q.id) into v_leaf_ids
      from (select s.id, s.order_no from public.skills s where s.curriculum_id = p_curriculum and s.is_leaf
             order by s.order_no, s.id limit 3) as q;
  end if;
  if v_leaf_ids is null then
    return jsonb_build_object('suggestions', 0, 'skill_ids', '[]'::jsonb);
  end if;
  v_minutes := ceil(v_count * 1.5)::int;
  insert into public.suggestions (student_id, enrollment_id, kind, title, subtitle, payload, rank)
  select e.student_id, e.id, 'practice', left(coalesce(v_unit_name, v_label), 120),
         format('%s soru · %s dk', v_count, v_minutes),
         jsonb_build_object('skill_ids', to_jsonb(v_leaf_ids), 'count', v_count, 'minutes', v_minutes,
                            'reason', 'curriculum_ready', 'curriculum_id', p_curriculum),
         0
    from public.enrollments e
   where e.curriculum_id = p_curriculum and e.status = 'active'
     and not exists (select 1 from public.suggestions sg
                      where sg.enrollment_id = e.id and sg.kind = 'practice' and sg.consumed_at is null)
     and not exists (select 1 from public.mastery m where m.enrollment_id = e.id);
  get diagnostics v_sug = row_count;
  return jsonb_build_object('suggestions', v_sug, 'skill_ids', to_jsonb(v_leaf_ids));
end
$$;
comment on function app.first_practice_suggestion(uuid) is 'İlk practice önerisi (ilk ünitenin ilk 3 yaprağı) henüz başlamamış etkin kayıtlara; {suggestions, skill_ids}.';

-- --- worker: taslak kaydı -----------------------------------------------------------------------------

-- Doğrulanmış curriculum-draft çıktısını tek işlemde yazar. Kazanımı olan müfredatta hiçbir şey yazmaz
-- (tekrar çalışan iş: {created:false}). Yapı (tek kök, köke bağlı, derinlik ≤ 4, kod benzersiz) ve ön koşul döngüsü
-- burada da denetlenir (OGR-CURR-011). Yanılgı etiketi küresel anahtardır: başka müfredatın etiketiyle çakışırsa bu
-- müfredata özgü önekle (kod parçası + kimliğin ilk 8 hanesi) yeniden adlandırılır (tags_renamed); o da çakışırsa
-- etiket yazılmaz ve tags_dropped'a (dönüş + draft_meta) girer. Otopilot etkinse (curriculum_autopilot_state)
-- müfredatın henüz başlamamış etkin kayıtlarına ilk 'practice' önerisi eklenir (app.first_practice_suggestion); kapalıysa
-- öğrenci eğitmenin yayınını bekler. p_meta: {confidence, notes_for_instructor, source_refs[], research_chars,
-- upload_ids[], model, cost_usd} → draft_meta / source_refs.
create or replace function public.save_curriculum_draft(p_curriculum uuid, p_draft jsonb, p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_cur public.curricula%rowtype;
  v_nodes jsonb := p_draft -> 'nodes';
  v_total int;
  v_roots int;
  v_distinct int;
  v_reached int;
  v_depth int;
  v_skills int;
  v_leaves int;
  v_prereqs int;
  v_tags int := 0;
  v_renamed jsonb := '[]'::jsonb;
  v_dropped jsonb := '[]'::jsonb;
  v_root text;
  v_ns text;
  v_tag record;
  v_tag_name text;
  v_auto boolean;
  v_first jsonb := jsonb_build_object('suggestions', 0, 'skill_ids', '[]'::jsonb);
begin
  if not (app.is_trusted() or app.is_admin()) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 müfredat taslağını yalnız worker yazar';
  end if;
  select c.* into v_cur from public.curricula c where c.id = p_curriculum for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-CURR-010 müfredat yok %s', p_curriculum);
  end if;
  if exists (select 1 from public.skills s where s.curriculum_id = p_curriculum) then
    return jsonb_build_object('curriculum_id', p_curriculum, 'created', false,
                              'skills', (select count(*) from public.skills s where s.curriculum_id = p_curriculum));
  end if;
  if coalesce(jsonb_typeof(v_nodes), '') <> 'array' or jsonb_array_length(v_nodes) = 0 then
    raise exception using errcode = 'P0001', message = 'OGR-CURR-011 taslakta düğüm yok';
  end if;

  -- yapı: tek kök, benzersiz kod, her düğüm köke bağlı (döngü ya da bilinmeyen üst yok), derinlik ≤ 4
  select count(*), count(*) filter (where nullif(x.it ->> 'parent_code', '') is null), count(distinct x.it ->> 'code')
    into v_total, v_roots, v_distinct
    from jsonb_array_elements(v_nodes) as x (it);
  if v_roots <> 1 or v_distinct <> v_total then
    raise exception using errcode = 'P0001',
      message = format('OGR-CURR-011 taslak tek köklü ve kodları benzersiz olmalı (kök %s, düğüm %s, benzersiz kod %s)', v_roots, v_total, v_distinct);
  end if;
  with recursive n (code, parent_code) as (
    select x.it ->> 'code', nullif(x.it ->> 'parent_code', '') from jsonb_array_elements(v_nodes) as x (it)
  ), t (code, depth) as (
    select n.code, 1 from n where n.parent_code is null
    union all
    select n.code, t.depth + 1 from n join t on n.parent_code = t.code where t.depth < 16
  )
  select count(*), max(t.depth) into v_reached, v_depth from t;
  if v_reached <> v_total or v_depth > 4 then
    raise exception using errcode = 'P0001',
      message = format('OGR-CURR-011 taslak ağacı köke bağlı ve en çok 4 derinlikte olmalı (bağlı %s/%s, derinlik %s)', v_reached, v_total, v_depth);
  end if;

  with recursive n (it, ord, code, parent_code) as (
    select x.it, x.ord, x.it ->> 'code', nullif(x.it ->> 'parent_code', '')
      from jsonb_array_elements(v_nodes) with ordinality as x (it, ord)
  ), t (code, depth) as (
    select n.code, 1 from n where n.parent_code is null
    union all
    select n.code, t.depth + 1 from n join t on n.parent_code = t.code where t.depth < 16
  ), node_rows as (
    select n.code, n.parent_code, n.ord, t.depth, n.it,
           not exists (select 1 from n as ch where ch.parent_code = n.code) as is_leaf,
           app.bkt_defaults(n.it ->> 'kind') as bkt
      from n join t on t.code = n.code
  ), ins as (
    insert into public.skills (curriculum_id, id, parent_id, name, description, kind, is_leaf, order_no, exam_weight_hint,
                               source_refs, p_init, p_learn, p_guess, p_slip)
    select p_curriculum, r.code, r.parent_code, btrim(r.it ->> 'name'), nullif(btrim(r.it ->> 'description'), ''), r.it ->> 'kind',
           r.is_leaf, r.ord::int, round((r.it ->> 'exam_weight_hint')::numeric, 3),
           coalesce((select jsonb_agg(jsonb_build_object('kind', 'source', 'ref', src.v))
                       from jsonb_array_elements_text(coalesce(r.it -> 'sources', '[]'::jsonb)) as src (v)), '[]'::jsonb),
           r.bkt[1], r.bkt[2], r.bkt[3], r.bkt[4]
      from node_rows as r
     order by r.depth, r.ord
    returning is_leaf
  )
  select count(*), count(*) filter (where ins.is_leaf) into v_skills, v_leaves from ins;

  insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source)
  select p_curriculum, x.it ->> 'skill_code', x.it ->> 'prereq_code',
         round(least(1, greatest(0, coalesce((x.it ->> 'strength')::numeric, 1))), 2), 'ai_draft'
    from jsonb_array_elements(coalesce(p_draft -> 'prerequisites', '[]'::jsonb)) as x (it)
   where x.it ->> 'skill_code' <> x.it ->> 'prereq_code'
  on conflict do nothing;
  get diagnostics v_prereqs = row_count;
  if exists (
    with recursive r (start_id, cur, path) as (
      select sp.skill_id, sp.prereq_id, array[sp.skill_id]
        from public.skill_prerequisites sp where sp.curriculum_id = p_curriculum
      union all
      select r.start_id, sp.prereq_id, r.path || r.cur
        from r join public.skill_prerequisites sp on sp.curriculum_id = p_curriculum and sp.skill_id = r.cur
       where not r.cur = any(r.path)
    )
    select 1 from r where r.cur = r.start_id
  ) then
    raise exception using errcode = 'P0001', message = 'OGR-CURR-011 ön koşul grafiğinde döngü var';
  end if;

  select s.id into v_root from public.skills s where s.curriculum_id = p_curriculum and s.parent_id is null;
  v_ns := app.code_slug(v_cur.code) || '-' || left(replace(p_curriculum::text, '-', ''), 8);
  for v_tag in
    select x.it ->> 'tag' as tag, x.it ->> 'skill_code' as skill_code, btrim(x.it ->> 'text_instructor') as text_instructor,
           btrim(x.it ->> 'text_student') as text_student
      from jsonb_array_elements(coalesce(p_draft -> 'misconception_tags', '[]'::jsonb)) as x (it)
  loop
    v_tag_name := v_tag.tag;
    if exists (select 1 from public.misconception_tags mt where mt.tag = v_tag_name) then
      v_tag_name := v_ns || '.' || v_tag.tag;
      if exists (select 1 from public.misconception_tags mt where mt.tag = v_tag_name) then
        v_dropped := v_dropped || jsonb_build_array(v_tag.tag);
        continue;
      end if;
      v_renamed := v_renamed || jsonb_build_array(jsonb_build_object('from', v_tag.tag, 'to', v_tag_name));
    end if;
    insert into public.misconception_tags (tag, curriculum_id, skill_id, text_instructor, text_student)
    values (v_tag_name, p_curriculum, v_tag.skill_code, v_tag.text_instructor, v_tag.text_student);
    v_tags := v_tags + 1;
  end loop;

  update public.curricula c
     set draft_status = 'ready', draft_progress = 100, draft_error = null, draft_updated_at = now(),
         draft_meta = c.draft_meta || (coalesce(p_meta, '{}'::jsonb) - 'source_refs')
                      || jsonb_build_object('confidence', p_draft -> 'confidence',
                                            'notes_for_instructor', p_draft ->> 'notes_for_instructor',
                                            'tags_renamed', v_renamed, 'tags_dropped', v_dropped, 'saved_at', now()),
         source_refs = c.source_refs || coalesce(case when jsonb_typeof(p_meta -> 'source_refs') = 'array' then p_meta -> 'source_refs' end,
                                                 '[]'::jsonb)
   where c.id = p_curriculum;

  -- ilk öneri yalnız otopilotta: öğrenci onaylanmamış taslakta ancak otopilot açıkken başlar (PLAN-v2 §3.5)
  v_auto := coalesce((public.curriculum_autopilot_state(p_curriculum) ->> 'effective')::boolean, false);
  if v_auto then
    v_first := app.first_practice_suggestion(p_curriculum);
  end if;

  perform app.audit_event('curriculum.draft_saved', 'public.curricula', p_curriculum::text,
                          jsonb_build_object('skills', v_skills, 'leaves', v_leaves, 'prerequisites', v_prereqs, 'tags', v_tags,
                                             'tags_dropped', v_dropped, 'autopilot', v_auto));
  return jsonb_build_object('curriculum_id', p_curriculum, 'created', true, 'root', v_root, 'skills', v_skills,
                            'leaves', v_leaves, 'prerequisites', v_prereqs, 'tags', v_tags, 'tags_renamed', v_renamed,
                            'tags_dropped', v_dropped, 'autopilot', v_auto,
                            'suggestions', v_first -> 'suggestions', 'first_skill_ids', v_first -> 'skill_ids');
end
$$;
comment on function public.save_curriculum_draft(uuid, jsonb, jsonb) is 'Worker: doğrulanmış curriculum-draft çıktısını tek işlemde yazar (kazanımlar + BKT varsayılanları + ön koşullar + etiketler; otopilotta ilk practice önerisi).';

-- Aynı ders için aktif müfredat bulundu: taslak bırakılır (retired, draft_status skipped), dersleri ve kayıtları aktif
-- müfredata taşınır (aynı öğrenci/dönem orada zaten kayıtlıysa taslak kaydı kapatılır).
create or replace function public.curriculum_draft_supersede(p_draft uuid, p_target uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_moved int := 0;
  v_closed int := 0;
begin
  if not (app.is_trusted() or app.is_admin()) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 taslağı yalnız worker bırakır';
  end if;
  if p_draft = p_target or not exists (select 1 from public.curricula c where c.id = p_target and c.status = 'active') then
    raise exception using errcode = 'P0001', message = 'OGR-CURR-012 hedef aktif bir başka müfredat olmalı';
  end if;
  perform 1 from public.curricula c where c.id = p_draft and c.status = 'draft' for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-CURR-012 bırakılacak taslak yok %s', p_draft);
  end if;
  update public.courses co set curriculum_id = p_target where co.curriculum_id = p_draft;
  update public.enrollments e set status = 'closed', ended_at = current_date
   where e.curriculum_id = p_draft and e.status <> 'closed'
     and exists (select 1 from public.enrollments x
                  where x.student_id = e.student_id and x.curriculum_id = p_target and x.period_label = e.period_label);
  get diagnostics v_closed = row_count;
  update public.enrollments e set curriculum_id = p_target
   where e.curriculum_id = p_draft and e.status <> 'closed';
  get diagnostics v_moved = row_count;
  update public.curricula c
     set status = 'retired', draft_status = 'skipped', draft_progress = 100, draft_error = null, draft_updated_at = now(),
         draft_meta = c.draft_meta || jsonb_build_object('superseded_by', p_target)
   where c.id = p_draft;
  return jsonb_build_object('draft', p_draft, 'target', p_target, 'moved_enrollments', v_moved, 'closed_enrollments', v_closed);
end
$$;
comment on function public.curriculum_draft_supersede(uuid, uuid) is 'Worker: aynı ders için aktif müfredat varsa taslağı emekliye ayırır, ders ve kayıtları aktif müfredata taşır.';

-- Düşen taslağı yeniden kur: yalnız draft_status = 'failed' ve kazanımı olmayan taslakta; yetki app.can_edit_curriculum.
-- p_upload_ids (isteğe bağlı kaynaklar: izlence, kitap, çıkmış sınav) çağıranın ya da kayıtlı öğrencinin yüklemesi
-- olmalı (app.uploads_ok); öğrencinin yüklemesi için çağıran o öğrenciye bağlı olmalı (app.can_read_student_data); worker yalnız PDF/metin kaynağı belge bloğu yapar. Durum 'queued' olur ve curriculum.draft
-- işi kuyruğa atılır. Döner: {curriculum_id, draft_status, job_id, upload_ids}.
create or replace function public.curriculum_draft_retry(p_curriculum uuid, p_upload_ids uuid[] default '{}') returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_cur public.curricula%rowtype;
  v_ids uuid[] := coalesce(p_upload_ids, '{}');
  v_course record;
  v_enr record;
  v_job uuid;
begin
  select c.* into v_cur from public.curricula c where c.id = p_curriculum for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-CURR-010 müfredat yok %s', p_curriculum);
  end if;
  if not app.can_edit_curriculum(p_curriculum) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 taslağı yalnız yetkili eğitmen ya da admin yeniden kurar';
  end if;
  if v_cur.status <> 'draft' or v_cur.draft_status is distinct from 'failed'
     or exists (select 1 from public.skills s where s.curriculum_id = p_curriculum) then
    raise exception using errcode = 'P0001',
      message = format('OGR-CURR-013 yalnız düşen ve kazanımsız taslak yeniden kurulur (durum %s/%s)', v_cur.status, coalesce(v_cur.draft_status, '-'));
  end if;
  if cardinality(v_ids) > 20 then
    raise exception using errcode = 'P0001', message = 'OGR-CURR-013 en çok 20 kaynak eklenir';
  end if;
  select co.id, co.title, co.kind into v_course from public.courses co where co.curriculum_id = p_curriculum order by co.created_at limit 1;
  select e.id, e.student_id, e.target_exam into v_enr from public.enrollments e
   where e.curriculum_id = p_curriculum and e.status = 'active' order by e.created_at limit 1;
  -- öğrencinin yüklemesi yalnız çağıran o öğrenciye erişebiliyorsa (bağlı eğitmen, admin, worker) kaynak olur:
  -- müfredat düzenleme yetkisi (başka öğrenci üzerinden bağ) bağsız öğrencinin özel yüklemesini LLM'e göndermeye yetmez
  if not app.uploads_ok(v_ids, case when app.is_trusted() or app.can_read_student_data(v_enr.student_id) then v_enr.student_id end) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 kaynak yüklemesi senin ya da bağlı olduğun öğrencinin değil';
  end if;
  update public.curricula c
     set draft_status = 'queued', draft_progress = 0, draft_error = null, draft_updated_at = now(),
         draft_meta = c.draft_meta || jsonb_build_object('retry_count', coalesce((c.draft_meta ->> 'retry_count')::int, 0) + 1,
                                                         'retried_by', auth.uid(), 'retried_at', now())
   where c.id = p_curriculum;
  v_job := app.try_enqueue('curriculum.draft', jsonb_build_object(
    'curriculum_id', p_curriculum, 'course_id', v_course.id, 'course_text', left(coalesce(v_course.title, v_cur.label), 200),
    'upload_ids', to_jsonb(v_ids), 'enrollment_id', v_enr.id, 'student_id', v_enr.student_id,
    'target_exam', v_enr.target_exam, 'course_kind', v_course.kind, 'requested_by', auth.uid()));
  perform app.audit_event('curriculum.draft_retry', 'public.curricula', p_curriculum::text,
                          jsonb_build_object('upload_ids', to_jsonb(v_ids), 'job_id', v_job));
  return jsonb_build_object('curriculum_id', p_curriculum, 'draft_status', 'queued', 'job_id', v_job, 'upload_ids', to_jsonb(v_ids));
end
$$;
comment on function public.curriculum_draft_retry(uuid, uuid[]) is 'Eğitmen: düşen kazanımsız taslağı (isteğe bağlı kaynak yüklemeleriyle) yeniden kuyruğa atar.';

-- --- eğitmen: ağaç editörü ---------------------------------------------------------------------------

-- Taslak sürümde tek düzenleme. p_op:
--   rename {skill_id, name}
--   add    {parent_id, name, kind?, description?}      → yeni yaprak (kod: üst kod + '.' + addan türeyen parça)
--   move   {skill_id, direction: 'up'|'down'}           → kardeşler arasında sıra
--          {skill_id, parent_id}                         → başka üst düğüme (kod değişmez; döngü ve derinlik ≤ 4 denetlenir)
--   merge  {keep_id, drop_id}                            → drop'un çocukları, ön koşulları ve etiketleri keep'e geçer,
--                                                          drop silinir; draft_meta.code_map[drop] = keep (yayında ustalık
--                                                          bu eşlemeyle taşınır). Kanıtı olan kazanım bu sürümde
--                                                          birleştirilemez (OGR-CURR-023: yeni sürüm aç).
-- Döner: {op, curriculum_id, skill_id, …}.
create or replace function public.curriculum_edit(p_curriculum uuid, p_op text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_cur public.curricula%rowtype;
  v_args jsonb := coalesce(p_args, '{}'::jsonb);
  v_skill public.skills%rowtype;
  v_parent public.skills%rowtype;
  v_other public.skills%rowtype;
  v_name text;
  v_kind text;
  v_code text;
  v_base text;
  v_i int := 1;
  v_depth int;
  v_bkt numeric[];
  v_old_parent text;
  v_dir text;
  v_keep text;
  v_drop text;
  v_result jsonb;
begin
  select c.* into v_cur from public.curricula c where c.id = p_curriculum for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-CURR-010 müfredat yok %s', p_curriculum);
  end if;
  if not app.can_edit_curriculum(p_curriculum) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 müfredatı yalnız yetkili eğitmen ya da admin düzenler';
  end if;
  if v_cur.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'OGR-CURR-020 yayındaki müfredat düzenlenmez: yeni sürüm aç';
  end if;

  if p_op = 'rename' then
    v_name := btrim(regexp_replace(coalesce(v_args ->> 'name', ''), '\s+', ' ', 'g'));
    if char_length(v_name) not between 2 and 120 then
      raise exception using errcode = 'P0001', message = 'OGR-CURR-021 ad 2–120 karakter olmalı';
    end if;
    update public.skills s set name = v_name
     where s.curriculum_id = p_curriculum and s.id = v_args ->> 'skill_id'
    returning s.* into v_skill;
    if not found then
      raise exception using errcode = 'P0001', message = 'OGR-CURR-021 kazanım bu müfredatta yok';
    end if;
    v_result := jsonb_build_object('skill_id', v_skill.id, 'name', v_name);

  elsif p_op = 'add' then
    v_name := btrim(regexp_replace(coalesce(v_args ->> 'name', ''), '\s+', ' ', 'g'));
    if char_length(v_name) not between 2 and 120 then
      raise exception using errcode = 'P0001', message = 'OGR-CURR-021 ad 2–120 karakter olmalı';
    end if;
    select s.* into v_parent from public.skills s where s.curriculum_id = p_curriculum and s.id = v_args ->> 'parent_id';
    if not found then
      raise exception using errcode = 'P0001', message = 'OGR-CURR-021 üst kazanım bu müfredatta yok';
    end if;
    v_depth := app.skill_depth(p_curriculum, v_parent.id) + 1;
    if v_depth > 4 then
      raise exception using errcode = 'P0001', message = 'OGR-CURR-022 ağaç en çok 4 derinlikte olabilir';
    end if;
    v_kind := coalesce(nullif(v_args ->> 'kind', ''), case v_depth when 2 then 'unit' when 3 then 'outcome' else 'sub_outcome' end);
    if v_kind not in ('unit', 'outcome', 'sub_outcome') then
      raise exception using errcode = 'P0001', message = 'OGR-CURR-021 tür unit, outcome ya da sub_outcome olmalı';
    end if;
    v_base := v_parent.id || '.' || app.code_slug(v_name);
    v_code := v_base;
    while exists (select 1 from public.skills s where s.curriculum_id = p_curriculum and s.id = v_code) loop
      v_i := v_i + 1;
      v_code := v_base || '-' || v_i;
    end loop;
    v_bkt := app.bkt_defaults(v_kind);
    insert into public.skills (curriculum_id, id, parent_id, name, description, kind, is_leaf, order_no, source_refs,
                               p_init, p_learn, p_guess, p_slip)
    values (p_curriculum, v_code, v_parent.id, v_name, nullif(btrim(v_args ->> 'description'), ''), v_kind, true,
            coalesce((select max(s.order_no) + 1 from public.skills s where s.curriculum_id = p_curriculum), 1),
            jsonb_build_array(jsonb_build_object('kind', 'instructor', 'ref', coalesce(auth.uid()::text, 'worker'))),
            v_bkt[1], v_bkt[2], v_bkt[3], v_bkt[4]);
    update public.skills s set is_leaf = false where s.curriculum_id = p_curriculum and s.id = v_parent.id;
    v_result := jsonb_build_object('skill_id', v_code, 'parent_id', v_parent.id, 'kind', v_kind);

  elsif p_op = 'move' then
    select s.* into v_skill from public.skills s where s.curriculum_id = p_curriculum and s.id = v_args ->> 'skill_id' for update;
    if not found or v_skill.parent_id is null then
      raise exception using errcode = 'P0001', message = 'OGR-CURR-021 taşınacak kazanım yok (kök taşınmaz)';
    end if;
    v_dir := v_args ->> 'direction';
    if v_dir in ('up', 'down') then
      select s.* into v_other from public.skills s
       where s.curriculum_id = p_curriculum and s.parent_id = v_skill.parent_id and s.id <> v_skill.id
         and case when v_dir = 'up' then (s.order_no, s.id) < (v_skill.order_no, v_skill.id)
                  else (s.order_no, s.id) > (v_skill.order_no, v_skill.id) end
       order by case when v_dir = 'up' then s.order_no end desc, case when v_dir = 'up' then s.id end desc,
                case when v_dir = 'down' then s.order_no end, case when v_dir = 'down' then s.id end
       limit 1;
      if found then
        if v_other.order_no = v_skill.order_no then
          -- eşit sıra numaraları: önce kardeşleri yeniden numarala
          update public.skills s set order_no = q.rn * 10
            from (select s2.id, row_number() over (order by s2.order_no, s2.id) as rn
                    from public.skills s2 where s2.curriculum_id = p_curriculum and s2.parent_id = v_skill.parent_id) as q
           where s.curriculum_id = p_curriculum and s.id = q.id;
          select s.* into v_skill from public.skills s where s.curriculum_id = p_curriculum and s.id = v_skill.id;
          select s.* into v_other from public.skills s where s.curriculum_id = p_curriculum and s.id = v_other.id;
        end if;
        update public.skills s set order_no = v_other.order_no where s.curriculum_id = p_curriculum and s.id = v_skill.id;
        update public.skills s set order_no = v_skill.order_no where s.curriculum_id = p_curriculum and s.id = v_other.id;
      end if;
      v_result := jsonb_build_object('skill_id', v_skill.id, 'direction', v_dir, 'moved', found);
    elsif nullif(v_args ->> 'parent_id', '') is not null then
      select s.* into v_parent from public.skills s where s.curriculum_id = p_curriculum and s.id = v_args ->> 'parent_id';
      if not found then
        raise exception using errcode = 'P0001', message = 'OGR-CURR-021 yeni üst kazanım bu müfredatta yok';
      end if;
      if v_parent.id = v_skill.id or exists (
        with recursive up (id, parent_id) as (
          select s.id, s.parent_id from public.skills s where s.curriculum_id = p_curriculum and s.id = v_parent.id
          union all
          select s.id, s.parent_id from public.skills s join up on s.id = up.parent_id where s.curriculum_id = p_curriculum
        )
        select 1 from up where up.id = v_skill.id
      ) then
        raise exception using errcode = 'P0001', message = 'OGR-CURR-022 kazanım kendi altına taşınamaz';
      end if;
      if app.skill_depth(p_curriculum, v_parent.id) + app.skill_height(p_curriculum, v_skill.id) > 4 then
        raise exception using errcode = 'P0001', message = 'OGR-CURR-022 taşıma sonrası ağaç 4 derinliği aşar';
      end if;
      v_old_parent := v_skill.parent_id;
      update public.skills s
         set parent_id = v_parent.id,
             order_no = coalesce((select max(s2.order_no) + 1 from public.skills s2 where s2.curriculum_id = p_curriculum), 1)
       where s.curriculum_id = p_curriculum and s.id = v_skill.id;
      update public.skills s set is_leaf = false where s.curriculum_id = p_curriculum and s.id = v_parent.id;
      update public.skills s set is_leaf = not exists (select 1 from public.skills ch where ch.curriculum_id = p_curriculum and ch.parent_id = s.id)
       where s.curriculum_id = p_curriculum and s.id = v_old_parent;
      v_result := jsonb_build_object('skill_id', v_skill.id, 'parent_id', v_parent.id, 'old_parent_id', v_old_parent);
    else
      raise exception using errcode = 'P0001', message = 'OGR-CURR-021 move: direction (up|down) ya da parent_id gerekli';
    end if;

  elsif p_op = 'merge' then
    v_keep := v_args ->> 'keep_id';
    v_drop := v_args ->> 'drop_id';
    select s.* into v_skill from public.skills s where s.curriculum_id = p_curriculum and s.id = v_keep;
    select s.* into v_other from public.skills s where s.curriculum_id = p_curriculum and s.id = v_drop;
    if v_skill.id is null or v_other.id is null or v_keep = v_drop or v_other.parent_id is null then
      raise exception using errcode = 'P0001', message = 'OGR-CURR-021 merge: keep_id ve drop_id bu müfredatta farklı kazanımlar olmalı (kök silinmez)';
    end if;
    if exists (
      with recursive up (id, parent_id) as (
        select s.id, s.parent_id from public.skills s where s.curriculum_id = p_curriculum and s.id = v_keep
        union all
        select s.id, s.parent_id from public.skills s join up on s.id = up.parent_id where s.curriculum_id = p_curriculum
      )
      select 1 from up where up.id = v_drop
    ) then
      raise exception using errcode = 'P0001', message = 'OGR-CURR-022 kazanım kendi üst düğümüyle birleştirilemez';
    end if;
    if app.skill_depth(p_curriculum, v_keep) + coalesce(app.skill_height(p_curriculum, v_drop), 1) - 1 > 4 then
      raise exception using errcode = 'P0001', message = 'OGR-CURR-022 birleştirme sonrası ağaç 4 derinliği aşar';
    end if;
    begin
      update public.skills s set parent_id = v_keep where s.curriculum_id = p_curriculum and s.parent_id = v_drop;
      insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source)
      select p_curriculum, case when sp.skill_id = v_drop then v_keep else sp.skill_id end,
             case when sp.prereq_id = v_drop then v_keep else sp.prereq_id end, sp.strength, sp.source
        from public.skill_prerequisites sp
       where sp.curriculum_id = p_curriculum and v_drop in (sp.skill_id, sp.prereq_id)
         and (case when sp.skill_id = v_drop then v_keep else sp.skill_id end) <> (case when sp.prereq_id = v_drop then v_keep else sp.prereq_id end)
      on conflict do nothing;
      delete from public.skill_prerequisites sp where sp.curriculum_id = p_curriculum and v_drop in (sp.skill_id, sp.prereq_id);
      update public.misconception_tags mt set skill_id = v_keep where mt.curriculum_id = p_curriculum and mt.skill_id = v_drop;
      update public.misconception_tags mt set prereq_skill_id = v_keep where mt.curriculum_id = p_curriculum and mt.prereq_skill_id = v_drop;
      delete from public.skills s where s.curriculum_id = p_curriculum and s.id = v_drop;
    exception when foreign_key_violation then
      raise exception using errcode = 'P0001',
        message = format('OGR-CURR-023 %s kazanımının kanıtı var; bu sürümde birleştirilemez (yeni sürüm aç, orada birleştir)', v_drop);
    end;
    update public.skills s set is_leaf = not exists (select 1 from public.skills ch where ch.curriculum_id = p_curriculum and ch.parent_id = s.id)
     where s.curriculum_id = p_curriculum and s.id in (v_keep, v_other.parent_id);
    update public.curricula c
       set draft_meta = jsonb_set(c.draft_meta, '{code_map}',
                                  coalesce((select jsonb_object_agg(m.key, case when m.value #>> '{}' = v_drop then to_jsonb(v_keep) else m.value end)
                                              from jsonb_each(coalesce(c.draft_meta -> 'code_map', '{}'::jsonb)) as m), '{}'::jsonb)
                                  || jsonb_build_object(v_drop, v_keep))
     where c.id = p_curriculum;
    v_result := jsonb_build_object('skill_id', v_keep, 'dropped', v_drop);

  else
    raise exception using errcode = 'P0001', message = format('OGR-CURR-021 bilinmeyen düzenleme: %s (rename | add | move | merge)', coalesce(p_op, '(boş)'));
  end if;

  update public.curricula c set edited_at = now() where c.id = p_curriculum;
  perform app.audit_event('curriculum.edit', 'public.curricula', p_curriculum::text, jsonb_build_object('op', p_op, 'args', v_args));
  return jsonb_build_object('op', p_op, 'curriculum_id', p_curriculum) || v_result;
end
$$;
comment on function public.curriculum_edit(uuid, text, jsonb) is 'Eğitmen ağaç editörü (yalnız taslak): rename | add | move (up/down ya da parent_id) | merge; döngü ve derinlik ≤ 4 denetlenir.';

-- Sonraki sürüm metni: '3' → '4', '2026.1' → '2026.2', diğerleri → '<sürüm>.1'
create or replace function app.next_version(p_version text) returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
           when p_version ~ '^[0-9]+$' then (p_version::int + 1)::text
           when p_version ~ '^[0-9]+\.[0-9]+$' then split_part(p_version, '.', 1) || '.' || (split_part(p_version, '.', 2)::int + 1)::text
           else p_version || '.1'
         end
$$;
comment on function app.next_version(text) is 'Sonraki sürüm metni: 3 → 4, 2026.1 → 2026.2, diğerleri → <sürüm>.1.';

-- Yeni taslak sürüm: aynı kod ve yıl, sürüm + 1, ağaç (kazanımlar + ön koşullar) kopyalanır; yanılgı etiketleri küresel
-- kaldığı için kopyalanmaz. Kaynak taslaksa (kanıtlı taslakta birleştirme) birleşme eşlemesi (draft_meta.code_map) de
-- kopyalanır. Bu sürümden türemiş açık bir taslak varsa onu döner (idempotent).
create or replace function public.curriculum_new_version(p_curriculum uuid) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_src public.curricula%rowtype;
  v_id uuid;
  v_ver text;
  v_i int := 0;
begin
  select c.* into v_src from public.curricula c where c.id = p_curriculum for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-CURR-010 müfredat yok %s', p_curriculum);
  end if;
  if not app.can_publish_curriculum(p_curriculum) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 yeni sürümü yalnız müfredatın sahibi eğitmen ya da admin açar';
  end if;
  if v_src.status = 'retired' then
    raise exception using errcode = 'P0001', message = 'OGR-CURR-024 emekli sürümden yeni sürüm açılmaz';
  end if;
  select c.id into v_id from public.curricula c where c.previous_id = p_curriculum and c.status = 'draft' order by c.created_at desc limit 1;
  if v_id is not null then
    return v_id;
  end if;
  v_ver := app.next_version(v_src.version);
  while exists (select 1 from public.curricula c where c.code = v_src.code and c.year = v_src.year and c.version = v_ver) loop
    v_i := v_i + 1;
    if v_i > 100 then
      raise exception using errcode = 'P0001', message = 'OGR-CURR-024 boş sürüm numarası bulunamadı';
    end if;
    v_ver := app.next_version(v_ver);
  end loop;
  insert into public.curricula (code, authority, year, version, label, status, origin, source_refs, created_by, draft_meta,
                                autopilot, previous_id)
  values (v_src.code, v_src.authority, v_src.year, v_ver, v_src.label, 'draft', v_src.origin, v_src.source_refs, auth.uid(),
          jsonb_build_object('copied_from', p_curriculum, 'copied_version', v_src.version)
            -- taslaktan açılan sürüm taslağın birleşme eşlemesini taşır (yayında ikisinin kayıtları da doğru koda geçer)
            || case when v_src.status = 'draft' and jsonb_typeof(v_src.draft_meta -> 'code_map') = 'object'
                    then jsonb_build_object('code_map', v_src.draft_meta -> 'code_map') else '{}'::jsonb end,
          v_src.autopilot, p_curriculum)
  returning id into v_id;
  insert into public.skills (curriculum_id, id, parent_id, name, description, kind, is_leaf, order_no, exam_weight_hint,
                             source_refs, p_init, p_learn, p_guess, p_slip)
  select v_id, s.id, s.parent_id, s.name, s.description, s.kind, s.is_leaf, s.order_no, s.exam_weight_hint, s.source_refs,
         s.p_init, s.p_learn, s.p_guess, s.p_slip
    from public.skills s where s.curriculum_id = p_curriculum
   order by app.skill_depth(p_curriculum, s.id), s.order_no;
  insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength, source)
  select v_id, sp.skill_id, sp.prereq_id, sp.strength, sp.source from public.skill_prerequisites sp where sp.curriculum_id = p_curriculum;
  perform app.audit_event('curriculum.new_version', 'public.curricula', v_id::text,
                          jsonb_build_object('from', p_curriculum, 'version', v_ver));
  return v_id;
end
$$;
comment on function public.curriculum_new_version(uuid) is 'Yeni taslak sürüm (aynı kod, sürüm + 1, ağaç kopyası); açık taslak varsa onu döner.';

-- Kazanım kodlarını birleşme eşlemesiyle çevirir (birleştirilen → kalan); sırayı korur, yinelenenleri atar.
create or replace function app.map_skill_ids(p_ids text[], p_map jsonb) returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(array_agg(q.sid order by q.ord), '{}'::text[])
    from (select coalesce(p_map ->> x.sid, x.sid) as sid, min(x.ord) as ord
            from unnest(p_ids) with ordinality as x (sid, ord)
           group by 1) as q
$$;
comment on function app.map_skill_ids(text[], jsonb) is 'Kazanım kodlarını birleşme eşlemesiyle çevirir; sırayı korur, yinelenenleri atar.';

-- Kodların hepsi bu müfredat sürümünde var mı (boş dizi: evet)
create or replace function app.skills_exist(p_curriculum uuid, p_ids text[]) returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select not exists (select 1 from unnest(coalesce(p_ids, '{}'::text[])) as x (sid)
                      where not exists (select 1 from public.skills s where s.curriculum_id = p_curriculum and s.id = x.sid))
$$;
comment on function app.skills_exist(uuid, text[]) is 'Kodların hepsi bu müfredat sürümünde var mı (boş dizi: evet).';

-- Kayıtları bir sürümden ötekine taşır: dersler, kayıtlar, ustalık ve açık yanılgılar kazanım koduyla (p_map:
-- birleştirilen kod → kalan kod) yeni sürüme geçer; yeni sürümde olmayan kodun ustalığı düşer (mastery_history ve
-- gözlemler eski sürümde tarih olarak kalır). Aynı öğrenci/dönem yeni sürümde zaten kayıtlıysa eski kayıt kapanır.
-- Sürüme bağlı içerik de taşınır (kodlar eşlemeyle çevrilir): soru bankası (questions), soru şablonları, içerik havuzu,
-- sınavlar (+ soruları) ve çıkmış sınav maddeleri — kazanımlarının hepsi yeni sürümde olanlar; olmayanlar eski sürümde
-- kalır (emekli sürümde tarih). Derse bağlı olanlar (izlence konuları, soru tarzları) dersle birlikte her zaman taşınır;
-- yeni sürümde olmayan kodları listeden düşer (syllabus_topics.curriculum_id = courses.curriculum_id değişmezi).
-- Açık müfredat önerileri de kodları çevrilerek taşınır; kodu yeni sürümde olmayan öneri notla reddedilir.
create or replace function app.carry_curriculum(p_old uuid, p_new uuid, p_map jsonb) returns int
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_map jsonb := coalesce(p_map, '{}'::jsonb);
  v_e record;
  v_n int := 0;
  v_q int := 0;
  v_qt int := 0;
  v_cp int := 0;
  v_ex int := 0;
  v_exams uuid[];
  v_ei int := 0;
  v_st int := 0;
  v_qs int := 0;
  v_p record;
  v_pl jsonb;
  v_k text;
  v_codes text[];
  v_keep text;
  v_drop text;
  v_why text;
  v_pm int := 0;
  v_prj int := 0;
begin
  update public.courses co set curriculum_id = p_new where co.curriculum_id = p_old;
  for v_e in select e.id, e.student_id, e.period_label from public.enrollments e where e.curriculum_id = p_old and e.status <> 'closed' loop
    if exists (select 1 from public.enrollments x
                where x.student_id = v_e.student_id and x.curriculum_id = p_new and x.period_label = v_e.period_label) then
      update public.enrollments e set status = 'closed', ended_at = current_date where e.id = v_e.id;
      continue;
    end if;
    -- hedef kodu yeni sürümde olmayan ustalık düşer; aynı hedefe düşen ikinciler (birleşme) düşer, hedefin kendisi kalır
    delete from public.mastery m
     where m.enrollment_id = v_e.id
       and not exists (select 1 from public.skills s where s.curriculum_id = p_new and s.id = coalesce(v_map ->> m.skill_id, m.skill_id));
    delete from public.mastery m
     where m.enrollment_id = v_e.id and v_map ? m.skill_id
       and exists (select 1 from public.mastery k
                    where k.enrollment_id = v_e.id and k.skill_id <> m.skill_id
                      and coalesce(v_map ->> k.skill_id, k.skill_id) = v_map ->> m.skill_id
                      and (not v_map ? k.skill_id or k.skill_id < m.skill_id));
    update public.mastery m set curriculum_id = p_new, skill_id = coalesce(v_map ->> m.skill_id, m.skill_id)
     where m.enrollment_id = v_e.id;
    update public.misconceptions mc set curriculum_id = p_new, skill_id = coalesce(v_map ->> mc.skill_id, mc.skill_id)
     where mc.enrollment_id = v_e.id and mc.curriculum_id = p_old and not v_map ? mc.skill_id
       and exists (select 1 from public.skills s where s.curriculum_id = p_new and s.id = mc.skill_id);
    update public.enrollments e set curriculum_id = p_new where e.id = v_e.id;
    v_n := v_n + 1;
  end loop;

  -- soru bankası: bütün kazanımları yeni sürümde olan sorular
  update public.questions q set curriculum_id = p_new, skill_ids = app.map_skill_ids(q.skill_ids, v_map)
   where q.curriculum_id = p_old and app.skills_exist(p_new, app.map_skill_ids(q.skill_ids, v_map));
  get diagnostics v_q = row_count;
  update public.question_templates qt set curriculum_id = p_new, skill_id = coalesce(v_map ->> qt.skill_id, qt.skill_id)
   where qt.curriculum_id = p_old and app.skills_exist(p_new, array[coalesce(v_map ->> qt.skill_id, qt.skill_id)]);
  get diagnostics v_qt = row_count;
  -- içerik havuzu: (tür, kazanım, etiket, mod) başına bir satır; birleşmede çakışırsa onaylı/çok kullanılan kalır
  update public.content_pool cp set curriculum_id = p_new, skill_id = x.sid
    from (select distinct on (c.kind, coalesce(v_map ->> c.skill_id, c.skill_id), coalesce(c.misconception_tag, ''), c.mode)
                 c.id, coalesce(v_map ->> c.skill_id, c.skill_id) as sid
            from public.content_pool c
           where c.curriculum_id = p_old and c.status <> 'rejected'
           order by c.kind, coalesce(v_map ->> c.skill_id, c.skill_id), coalesce(c.misconception_tag, ''), c.mode,
                    (c.status = 'approved') desc, c.hit_count desc, c.created_at) as x
   where cp.id = x.id and app.skills_exist(p_new, array[x.sid])
     and not exists (select 1 from public.content_pool o
                      where o.curriculum_id = p_new and o.kind = cp.kind and o.skill_id = x.sid and o.mode = cp.mode
                        and coalesce(o.misconception_tag, '') = coalesce(cp.misconception_tag, '') and o.status <> 'rejected');
  get diagnostics v_cp = row_count;
  -- sınavlar (süren oturumlar kayıtla aynı sürümde kalsın): önce sınav, sonra soruların kodları (tetikleyici yeni sürüme bakar)
  with moved as (
    update public.exams x set curriculum_id = p_new
     where x.curriculum_id = p_old
       and not exists (select 1 from public.exam_questions eq
                        where eq.exam_id = x.id and not app.skills_exist(p_new, app.map_skill_ids(eq.skill_ids, v_map)))
    returning x.id
  )
  select coalesce(array_agg(moved.id), '{}') into v_exams from moved;
  v_ex := cardinality(v_exams);
  update public.exam_questions eq set skill_ids = app.map_skill_ids(eq.skill_ids, v_map)
   where eq.exam_id = any(v_exams) and eq.skill_ids is distinct from app.map_skill_ids(eq.skill_ids, v_map);
  update public.exam_items ei set curriculum_id = p_new, skill_id = coalesce(v_map ->> ei.skill_id, ei.skill_id)
   where ei.curriculum_id = p_old
     and (ei.skill_id is null or app.skills_exist(p_new, array[coalesce(v_map ->> ei.skill_id, ei.skill_id)]));
  get diagnostics v_ei = row_count;
  -- derse bağlı: dersle birlikte taşınır, yeni sürümde olmayan kodlar düşer
  update public.syllabus_topics st
     set curriculum_id = p_new,
         skill_ids = array(select m.sid from unnest(app.map_skill_ids(st.skill_ids, v_map)) with ordinality as m (sid, ord)
                            where app.skills_exist(p_new, array[m.sid]) order by m.ord)
   where st.curriculum_id = p_old;
  get diagnostics v_st = row_count;
  update public.question_styles qs
     set curriculum_id = p_new,
         skill_ids = array(select m.sid from unnest(app.map_skill_ids(qs.skill_ids, v_map)) with ordinality as m (sid, ord)
                            where app.skills_exist(p_new, array[m.sid]) order by m.ord)
   where qs.curriculum_id = p_old;
  get diagnostics v_qs = row_count;

  -- açık müfredat önerileri (kanıtlarıyla) yeni sürüme geçer: kazanım kodları eşlemeyle çevrilir, kaynak sürüm
  -- payload.origin_curriculum_id'de kalır. Kodu yeni sürümde olmayan ya da birleşmeyle anlamını yitiren öneri
  -- gerekçe notuyla reddedilir (eski sürümde tarih olarak kalır).
  for v_p in
    select cp.id, cp.kind, cp.payload from public.curriculum_proposals cp
     where cp.curriculum_id = p_old and cp.status = 'open' order by cp.created_at, cp.id
       for update
  loop
    v_pl := v_p.payload;
    v_codes := '{}';
    foreach v_k in array array['parent_id', 'skill_id', 'keep_id', 'drop_id', 'into', 'from', 'prereq_id', 'prereq_skill_id'] loop
      if jsonb_typeof(v_pl -> v_k) = 'string' then
        v_pl := jsonb_set(v_pl, array[v_k], to_jsonb(coalesce(v_map ->> (v_pl ->> v_k), v_pl ->> v_k)));
        v_codes := v_codes || (v_pl ->> v_k);
      end if;
    end loop;
    if jsonb_typeof(v_pl -> 'skill_ids') = 'array' then
      v_pl := jsonb_set(v_pl, '{skill_ids}',
                        to_jsonb(app.map_skill_ids(array(select jsonb_array_elements_text(v_pl -> 'skill_ids')), v_map)));
      v_codes := v_codes || array(select jsonb_array_elements_text(v_pl -> 'skill_ids'));
    end if;
    v_keep := coalesce(v_pl ->> 'keep_id', v_pl ->> 'into', v_pl -> 'skill_ids' ->> 0);
    v_drop := coalesce(v_pl ->> 'drop_id', v_pl ->> 'from', v_pl -> 'skill_ids' ->> 1);
    v_why := case
      when not app.skills_exist(p_new, v_codes) then 'kazanımı yeni sürümde yok'
      when v_p.kind = 'merge' and (v_keep is null or v_drop is null or v_keep = v_drop) then 'kazanımlar yeni sürümde zaten birleşik'
      when v_p.kind = 'add_prereq' and v_pl ->> 'skill_id' = v_pl ->> 'prereq_id' then 'kazanımlar yeni sürümde birleşik'
    end;
    if v_why is null then
      update public.curriculum_proposals cp
         set curriculum_id = p_new,
             payload = v_pl || jsonb_build_object('origin_curriculum_id', coalesce(v_pl ->> 'origin_curriculum_id', p_old::text))
       where cp.id = v_p.id;
      v_pm := v_pm + 1;
    else
      update public.curriculum_proposals cp
         set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
             payload = cp.payload || jsonb_build_object('decision_note', 'yeni sürüm yayınlandı: ' || v_why, 'closed_by_publish', p_new)
       where cp.id = v_p.id;
      v_prj := v_prj + 1;
    end if;
  end loop;

  perform app.audit_event('curriculum.carry', 'public.curricula', p_new::text,
                          jsonb_build_object('from', p_old, 'enrollments', v_n, 'questions', v_q, 'question_templates', v_qt,
                                             'content_pool', v_cp, 'exams', v_ex, 'exam_items', v_ei,
                                             'syllabus_topics', v_st, 'question_styles', v_qs,
                                             'proposals', v_pm, 'proposals_closed', v_prj));
  return v_n;
end
$$;
comment on function app.carry_curriculum(uuid, uuid, jsonb) is 'Kayıtları, dersleri, ustalığı, açık yanılgıları, açık önerileri ve sürüme bağlı içeriği (soru bankası, şablonlar, havuz, sınavlar, izlence, tarzlar) kazanım koduyla (birleşme eşlemesiyle) yeni sürüme taşır.';

-- Sürümden (previous_id zinciriyle) türemiş en yeni açık taslak; yoksa null. Yayın, öneri kararı ve otopilot bunu
-- hedefler: taslaktan da yeni sürüm açılabildiği için (kanıtlı taslakta birleştirme) zincir birden derin olabilir.
create or replace function app.open_draft_for(p_curriculum uuid) returns uuid
language sql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
  with recursive d (id, status, created_at, depth) as (
    select c.id, c.status, c.created_at, 1 from public.curricula c where c.previous_id = p_curriculum
    union all
    select c.id, c.status, c.created_at, d.depth + 1 from public.curricula c join d on c.previous_id = d.id where d.depth < 32
  )
  select d.id from d where d.status = 'draft' order by d.depth desc, d.created_at desc, d.id limit 1
$$;
comment on function app.open_draft_for(uuid) is 'Sürümden (previous_id zinciri) türemiş en yeni açık taslak; yoksa null.';

-- Yayın: taslak → aktif. Aynı kodun diğer aktif/taslak sürümleri emekliye ayrılır; onların dersleri, kayıtları,
-- ustalığı ve içeriği kodla bu sürüme taşınır (draft_meta.code_map + p_code_map birleşme eşlemesi). Henüz başlamamış
-- etkin kayıtlar (otopilot kapalıyken taslağı bekleyen öğrenci) ilk 'practice' önerisini burada alır. Bu sürümden
-- türemiş (ya da daha sonra açılmış) açık taslak varsa yayın reddedilir (OGR-CURR-026): eski sürümü yayınlamak yeni
-- taslağı (ör. curriculum.merge işinin birleştirmesi) sessizce emekliye ayırırdı.
create or replace function public.curriculum_publish(p_curriculum uuid, p_code_map jsonb default null) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_cur public.curricula%rowtype;
  v_map jsonb;
  v_old record;
  v_retired uuid[] := '{}';
  v_carried int := 0;
  v_first jsonb;
  v_newer text;
begin
  select c.* into v_cur from public.curricula c where c.id = p_curriculum for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-CURR-010 müfredat yok %s', p_curriculum);
  end if;
  if not app.can_publish_curriculum(p_curriculum) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 müfredatı yalnız sahibi eğitmen ya da admin yayınlar (başka eğitmenin öğrencileri de kullanıyor)';
  end if;
  if v_cur.status <> 'draft' then
    raise exception using errcode = 'P0001', message = format('OGR-CURR-025 yalnız taslak yayınlanır (durum: %s)', v_cur.status);
  end if;
  if (select count(*) from public.skills s where s.curriculum_id = p_curriculum and s.parent_id is null) <> 1 then
    raise exception using errcode = 'P0001', message = 'OGR-CURR-025 yayın için tek köklü bir kazanım ağacı gerekir';
  end if;
  select c.version into v_newer from public.curricula c
   where c.code = v_cur.code and c.id <> p_curriculum and c.status = 'draft'
     and (c.id = app.open_draft_for(p_curriculum) or c.created_at > v_cur.created_at)
   order by c.created_at desc, c.id limit 1;
  if v_newer is not null then
    raise exception using errcode = 'P0001',
      message = format('OGR-CURR-026 daha yeni açık taslak var (sürüm %s); onu yayınla ya da orada devam et', v_newer);
  end if;
  v_map := coalesce(v_cur.draft_meta -> 'code_map', '{}'::jsonb) || coalesce(p_code_map, '{}'::jsonb);
  for v_old in
    select c.id from public.curricula c
     where c.code = v_cur.code and c.id <> p_curriculum and c.status in ('active', 'draft')
     order by c.created_at
       for update
  loop
    v_carried := v_carried + app.carry_curriculum(v_old.id, p_curriculum, v_map);
    update public.curricula c set status = 'retired' where c.id = v_old.id;
    v_retired := v_retired || v_old.id;
  end loop;
  update public.curricula c
     set status = 'active', published_at = now(), draft_meta = c.draft_meta || jsonb_build_object('published_code_map', v_map)
   where c.id = p_curriculum;
  v_first := app.first_practice_suggestion(p_curriculum);
  perform app.audit_event('curriculum.publish', 'public.curricula', p_curriculum::text,
                          jsonb_build_object('retired', to_jsonb(v_retired), 'carried_enrollments', v_carried,
                                             'suggestions', v_first -> 'suggestions'));
  return jsonb_build_object('curriculum_id', p_curriculum, 'status', 'active', 'version', v_cur.version,
                            'retired', to_jsonb(v_retired), 'carried_enrollments', v_carried,
                            'suggestions', v_first -> 'suggestions');
end
$$;
comment on function public.curriculum_publish(uuid, jsonb) is 'Taslak → aktif; aynı kodun diğer sürümleri emekli, dersler/kayıtlar/ustalık/içerik kodla (birleşme eşlemesiyle) taşınır; bekleyen kayıtlara ilk öneri.';

-- Otopilot anahtarı: true/false eğitmen seçimi, null runtime_flags'e döner. Döner: curriculum_autopilot_state.
create or replace function public.curriculum_set_autopilot(p_curriculum uuid, p_on boolean) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if not exists (select 1 from public.curricula c where c.id = p_curriculum) then
    raise exception using errcode = 'P0001', message = format('OGR-CURR-010 müfredat yok %s', p_curriculum);
  end if;
  if not app.can_publish_curriculum(p_curriculum) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 otopilotu yalnız müfredatın sahibi eğitmen ya da admin değiştirir';
  end if;
  update public.curricula c set autopilot = p_on, edited_at = now() where c.id = p_curriculum;
  perform app.audit_event('curriculum.autopilot', 'public.curricula', p_curriculum::text, jsonb_build_object('autopilot', p_on));
  return public.curriculum_autopilot_state(p_curriculum);
end
$$;
comment on function public.curriculum_set_autopilot(uuid, boolean) is 'Otopilot seçimi (null: runtime_flags varsayılanı); otopilot durumunu döner.';

-- Editör başlığı: {can_edit, can_publish, autopilot, counts{units, outcomes, sub_outcomes, leaves, skills},
-- open_proposals, enrollments, live_version{id, version, published_at}, draft_child_id (app.open_draft_for),
-- merge_errors[{proposal_id, error}] (curriculum.merge işinin kalıcı hatası), draft{status, error,
-- notes_for_instructor, tags_dropped, can_retry}}. draft_meta/draft_error personele özeldir; editör buradan okur.
create or replace function public.curriculum_editor_state(p_curriculum uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_cur public.curricula%rowtype;
  v_live record;
begin
  select c.* into v_cur from public.curricula c where c.id = p_curriculum;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-CURR-010 müfredat yok %s', p_curriculum);
  end if;
  if not (app.is_trusted() or app.is_staff()) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 müfredat editörü yalnız eğitmen ve admin içindir';
  end if;
  select c.id, c.version, c.published_at into v_live from public.curricula c
   where c.code = v_cur.code and c.status = 'active' order by c.published_at desc nulls last, c.created_at desc limit 1;
  return jsonb_build_object(
    'curriculum_id', p_curriculum,
    'can_edit', app.can_edit_curriculum(p_curriculum),
    'can_publish', app.can_publish_curriculum(p_curriculum),
    'autopilot', public.curriculum_autopilot_state(p_curriculum),
    'draft', jsonb_build_object(
      'status', v_cur.draft_status, 'error', v_cur.draft_error,
      'notes_for_instructor', v_cur.draft_meta ->> 'notes_for_instructor',
      'tags_dropped', coalesce(v_cur.draft_meta -> 'tags_dropped', '[]'::jsonb),
      'can_retry', v_cur.status = 'draft' and v_cur.draft_status = 'failed' and app.can_edit_curriculum(p_curriculum)
                   and not exists (select 1 from public.skills s where s.curriculum_id = p_curriculum)),
    'counts', (select jsonb_build_object('skills', count(*), 'leaves', count(*) filter (where s.is_leaf),
                                         'units', count(*) filter (where s.kind = 'unit' and s.parent_id is not null),
                                         'outcomes', count(*) filter (where s.kind = 'outcome'),
                                         'sub_outcomes', count(*) filter (where s.kind = 'sub_outcome'))
                 from public.skills s where s.curriculum_id = p_curriculum),
    'open_proposals', (select count(*) from public.curriculum_proposals cp where cp.curriculum_id = p_curriculum and cp.status = 'open'),
    'enrollments', (select count(*) from public.enrollments e where e.curriculum_id = p_curriculum and e.status = 'active'),
    'live_version', case when v_live.id is null then null
                         else jsonb_build_object('id', v_live.id, 'version', v_live.version, 'published_at', v_live.published_at) end,
    'draft_child_id', app.open_draft_for(p_curriculum),
    'merge_errors', coalesce((select jsonb_agg(jsonb_build_object('proposal_id', cp.id, 'error', cp.payload -> 'result' ->> 'error')
                                               order by cp.decided_at desc)
                                from public.curriculum_proposals cp
                               where cp.curriculum_id = p_curriculum and cp.kind = 'merge' and cp.status = 'accepted'
                                 and cp.payload -> 'result' ->> 'error' is not null), '[]'::jsonb));
end
$$;
comment on function public.curriculum_editor_state(uuid) is 'Eğitmen editörü başlığı: düzenleme/yayın yetkisi, otopilot, düğüm sayıları, açık öneriler, kayıtlar, yayındaki sürüm, açık taslak, taslak işi (hata, not).';

-- Otopilotun güvenli kabulü (worker: curriculum.proposals.collect; teşhis önerisi). Yayındaki ağaca ASLA yazmaz:
-- sürümden türemiş açık taslak varsa (app.open_draft_for) o, yoksa müfredat aktifse yeni taslak sürüm
-- (curriculum_new_version) hedeflenir; öneri o taslağa taşınır
-- (payload.origin_curriculum_id) ve orada uygulanır (app.apply_proposal); yayın eğitmenin onayıyla olur. Yeni alt
-- kazanım türünün BKT varsayılanlarını alır. Birleştirme curriculum.merge işine kalır (taslakta yerinde birleşir).
-- Otopilot etkin değilse OGR-CURR-030. Döner: apply_proposal sonucu + {curriculum_id (uygulanan sürüm), new_version}.
create or replace function public.curriculum_autopilot_accept(p_id uuid, p_note text default null) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_pr public.curriculum_proposals%rowtype;
  v_cur public.curricula%rowtype;
  v_target uuid;
  v_res jsonb;
  v_kind text;
  v_bkt numeric[];
begin
  if not (app.is_trusted() or app.is_admin()) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 otopilot kabulünü yalnız worker yapar';
  end if;
  select cp.* into v_pr from public.curriculum_proposals cp where cp.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-PROP-001 öneri yok %s', p_id);
  end if;
  if v_pr.status <> 'open' then
    raise exception using errcode = 'P0001', message = format('OGR-PROP-002 öneri zaten karara bağlandı (%s)', v_pr.status);
  end if;
  select c.* into v_cur from public.curricula c where c.id = v_pr.curriculum_id;
  if not coalesce((public.curriculum_autopilot_state(v_cur.id) ->> 'effective')::boolean, false) then
    raise exception using errcode = 'P0001', message = 'OGR-CURR-030 bu müfredatta otopilot kapalı';
  end if;
  if v_cur.status = 'retired' then
    raise exception using errcode = 'P0001', message = 'OGR-CURR-024 emekli sürüme öneri uygulanmaz';
  end if;
  -- hedef: yayınlanacak ağaç — türemiş açık taslak varsa o; yoksa aktifte yeni taslak sürüm, taslakta kendisi
  v_target := app.open_draft_for(v_cur.id);
  if v_target is null then
    v_target := case when v_cur.status = 'active' then public.curriculum_new_version(v_cur.id) else v_cur.id end;
  end if;
  if v_target <> v_cur.id then
    update public.curriculum_proposals cp
       set curriculum_id = v_target,
           payload = cp.payload || jsonb_build_object('origin_curriculum_id', coalesce(cp.payload ->> 'origin_curriculum_id', v_cur.id::text))
     where cp.id = p_id;
  end if;
  v_res := app.apply_proposal(p_id, true, p_note);
  if v_pr.kind = 'add_subskill' and v_res ->> 'skill_id' is not null then
    select s.kind into v_kind from public.skills s where s.curriculum_id = v_target and s.id = v_res ->> 'skill_id';
    v_bkt := app.bkt_defaults(v_kind);
    update public.skills s set p_init = v_bkt[1], p_learn = v_bkt[2], p_guess = v_bkt[3], p_slip = v_bkt[4]
     where s.curriculum_id = v_target and s.id = v_res ->> 'skill_id';
  end if;
  if v_pr.kind <> 'merge' then
    update public.curriculum_proposals cp
       set payload = cp.payload || jsonb_build_object('result', jsonb_build_object(
             'curriculum_id', v_target, 'in_place', v_target = v_cur.id, 'published', false, 'autopilot', true, 'at', now()))
     where cp.id = p_id;
  end if;
  if v_target <> v_cur.id then
    update public.curricula c set edited_at = now() where c.id = v_target;
  end if;
  perform app.audit_event('curriculum.autopilot_accept', 'public.curriculum_proposals', p_id::text,
                          jsonb_build_object('kind', v_pr.kind, 'curriculum_id', v_target, 'from', v_cur.id));
  return v_res || jsonb_build_object('curriculum_id', v_target, 'new_version', v_target <> v_cur.id);
end
$$;
comment on function public.curriculum_autopilot_accept(uuid, text) is 'Worker: otopilot kabulü; aktif müfredatta açık taslak sürüme uygular (yayındaki ağaca yazmaz), yeni alt kazanıma BKT varsayılanı.';

-- Öneriye karar (0017'nin yerine). Yetki app.can_edit_curriculum (0017 kuralı + önceki sürümün dersi). Ret her zaman
-- yerindedir. Kabul yayındaki ağaca YAZMAZ (PLAN §3.5 "yapısal kabuller yeni versiyon"; otopilotla aynı yol): sürümden
-- türemiş açık taslak varsa (app.open_draft_for) öneri oraya taşınır (payload.origin_curriculum_id) ve orada uygulanır;
-- yoksa aktif müfredatta yeni taslak sürüm açılır (curriculum_new_version; bu yetki app.can_publish_curriculum, yoksa
-- OGR-CURR-031). Birleştirme curriculum.merge işine kalır (iş taslakta ya da yeni sürümde birleştirir). Emekli sürüme
-- kabul OGR-CURR-024. Döner: apply_proposal sonucu + {curriculum_id (uygulanan sürüm), new_version}.
create or replace function public.decide_proposal(p_id uuid, p_accept boolean, p_note text default null) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_pr public.curriculum_proposals%rowtype;
  v_cur public.curricula%rowtype;
  v_accept boolean := coalesce(p_accept, false);
  v_target uuid;
  v_res jsonb;
begin
  select cp.* into v_pr from public.curriculum_proposals cp where cp.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-PROP-001 öneri yok %s', p_id);
  end if;
  if not app.can_edit_curriculum(v_pr.curriculum_id) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 öneriye karar yalnız eğitmen ya da admin';
  end if;
  select c.* into v_cur from public.curricula c where c.id = v_pr.curriculum_id;
  v_target := v_cur.id;
  if v_accept and v_pr.status = 'open' then
    if v_cur.status = 'retired' then
      raise exception using errcode = 'P0001', message = 'OGR-CURR-024 emekli sürüme öneri uygulanmaz';
    end if;
    if v_pr.kind <> 'merge' then
      v_target := coalesce(app.open_draft_for(v_cur.id), v_cur.id);
      if v_target = v_cur.id and v_cur.status = 'active' then
        if not app.can_publish_curriculum(v_cur.id) then
          raise exception using errcode = 'P0001',
            message = 'OGR-CURR-031 yayındaki sürüme kabul yeni taslak sürüm ister; yeni sürümü müfredatın sahibi eğitmen ya da admin açar';
        end if;
        v_target := public.curriculum_new_version(v_cur.id);
      end if;
      if v_target <> v_cur.id then
        update public.curriculum_proposals cp
           set curriculum_id = v_target,
               payload = cp.payload || jsonb_build_object('origin_curriculum_id', coalesce(cp.payload ->> 'origin_curriculum_id', v_cur.id::text))
         where cp.id = p_id;
      end if;
    end if;
  end if;
  v_res := app.apply_proposal(p_id, v_accept, p_note);
  if v_target <> v_cur.id then
    update public.curriculum_proposals cp
       set payload = cp.payload || jsonb_build_object('result', jsonb_build_object(
             'curriculum_id', v_target, 'in_place', false, 'published', false, 'at', now()))
     where cp.id = p_id;
    update public.curricula c set edited_at = now() where c.id = v_target;
  end if;
  return v_res || jsonb_build_object('curriculum_id', v_target, 'new_version', v_target <> v_cur.id);
end
$$;
comment on function public.decide_proposal(uuid, boolean, text) is 'Müfredat önerisine karar (app.can_edit_curriculum); kabul yayındaki ağaca yazmaz: açık taslak sürüme (yoksa yeni sürüm) taşınır ve orada uygulanır.';

revoke all on function app.code_slug(text), app.bkt_defaults(text), app.skill_depth(uuid, text), app.skill_height(uuid, text),
app.can_edit_curriculum(uuid), app.can_publish_curriculum(uuid), app.next_version(text), app.carry_curriculum(uuid, uuid, jsonb),
app.first_practice_suggestion(uuid), app.map_skill_ids(text[], jsonb), app.skills_exist(uuid, text[]), app.open_draft_for(uuid) from public;
grant execute on function app.code_slug(text), app.bkt_defaults(text), app.skill_depth(uuid, text), app.skill_height(uuid, text),
app.can_edit_curriculum(uuid), app.can_publish_curriculum(uuid), app.next_version(text), app.map_skill_ids(text[], jsonb)
to authenticated, service_role;
revoke all on function public.curriculum_autopilot_state(uuid), public.save_curriculum_draft(uuid, jsonb, jsonb),
public.curriculum_draft_supersede(uuid, uuid), public.curriculum_draft_retry(uuid, uuid[]), public.curriculum_edit(uuid, text, jsonb),
public.curriculum_new_version(uuid), public.curriculum_publish(uuid, jsonb), public.curriculum_set_autopilot(uuid, boolean),
public.curriculum_editor_state(uuid), public.curriculum_autopilot_accept(uuid, text)
from public;
grant execute on function public.curriculum_autopilot_state(uuid), public.curriculum_edit(uuid, text, jsonb),
public.curriculum_new_version(uuid), public.curriculum_publish(uuid, jsonb), public.curriculum_set_autopilot(uuid, boolean),
public.curriculum_editor_state(uuid), public.curriculum_draft_retry(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.save_curriculum_draft(uuid, jsonb, jsonb), public.curriculum_draft_supersede(uuid, uuid),
public.curriculum_autopilot_accept(uuid, text) to service_role;

-- draft_meta (maliyet, model, iş kimliği, eğitmen notu, prompt sürümleri) ve draft_error (ham API hatası) personele
-- özeldir: authenticated bu iki sütunu okuyamaz (öğrenci/veli curricula'yı can_read_curriculum ile görür). Editör ikisini
-- curriculum_editor_state ile alır. İstemci sütunları açıkça seçmeli (select=* izin hatası verir); Realtime yalnız
-- seçilebilir sütunları yollar.
revoke select on public.curricula from authenticated;
grant select (id, code, authority, year, version, label, status, origin, source_refs, created_by, created_at, draft_status,
              draft_progress, draft_updated_at, autopilot, previous_id, published_at, edited_at)
on public.curricula to authenticated;
