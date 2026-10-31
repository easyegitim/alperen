-- tests/09_grants_matrix.sql — canlı yetkiler = tests/grants_matrix.json (BLUEPRINT §3.8). Tablo/görünüm düzeyi
-- (pg_class.relacl), sütun düzeyi (pg_attribute.attacl) ve fonksiyon (pg_proc.proacl) yetkileri uygulama rolleri
-- (anon, authenticated, bot_runtime, batch_worker) ve PUBLIC için beklenen kümeyle karşılaştırılır; fazla ya da eksik → FAIL.
-- Statik eşleniği: scripts/check_sql.py --grants-matrix.
begin;
\ir _fixture.sql
insert into t.cfg values ('matrix', :'matrix');

do $$
declare
  v_m jsonb := t.v('matrix')::jsonb;
  v_roles text[] := array['anon', 'authenticated', 'bot_runtime', 'batch_worker'];
  v_extra text;
  v_missing text;
begin
  -- beklenen: (ilişki, rol, yetki, sütun | '*')
  create temporary table exp_rel on commit drop as
  select r.key as rel, g.key as role, p.key as priv, '*'::text as col
    from jsonb_each(v_m -> 'tables') r, jsonb_each(r.value) g, jsonb_each(g.value) p
   where jsonb_typeof(p.value) = 'string'
  union all
  select r.key, g.key, p.key, c.value
    from jsonb_each(v_m -> 'tables') r, jsonb_each(r.value) g, jsonb_each(g.value) p, jsonb_array_elements_text(p.value) c
   where jsonb_typeof(p.value) = 'array';
  -- gerçek
  create temporary table act_rel on commit drop as
  select n.nspname || '.' || c.relname as rel, a.grantee::regrole::text as role, lower(a.privilege_type) as priv, '*'::text as col
    from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
   where n.nspname in ('public', 'secure', 'audit') and c.relkind in ('r', 'v', 'm', 'p')
     and a.grantee <> 0 and a.grantee::regrole::text = any(v_roles)
  union all
  select n.nspname || '.' || c.relname, a.grantee::regrole::text, lower(a.privilege_type), att.attname::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped, aclexplode(att.attacl) a
   where n.nspname in ('public', 'secure', 'audit') and c.relkind in ('r', 'v', 'm', 'p')
     and a.grantee <> 0 and a.grantee::regrole::text = any(v_roles);
  select string_agg(format('%s %s %s %s', x.rel, x.role, x.priv, x.col), '; ') into v_extra
    from (select * from act_rel except select * from exp_rel) x;
  select string_agg(format('%s %s %s %s', x.rel, x.role, x.priv, x.col), '; ') into v_missing
    from (select * from exp_rel except select * from act_rel) x;
  perform t.ok(v_extra is null, 'tablo/sütun yetkilerinde matris dışı FAZLA yetki yok: ' || coalesce(v_extra, '-'));
  perform t.ok(v_missing is null, 'matristeki tablo/sütun yetkilerinin hepsi canlıda var: ' || coalesce(v_missing, '-'));
  perform t.ok((select count(*) from exp_rel) > 100, 'matriste yüzlerce yetki satırı (' || (select count(*) from exp_rel) || ')');

  -- ilişki kümesi: her tablo/görünüm matriste (yetkisi olmayanlar {} ile)
  select string_agg(x.rel, ', ') into v_missing from (
    select n.nspname || '.' || c.relname as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'secure', 'audit') and c.relkind in ('r', 'v', 'm', 'p')
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    except select k from jsonb_object_keys(v_m -> 'tables') k) x;
  perform t.ok(v_missing is null, 'her ilişki matriste listeli: ' || coalesce(v_missing, '-'));
  perform t.ok((v_m #> '{tables,public.messages,authenticated,select}') is not null
               and not ((v_m #> '{tables,public.messages,authenticated,select}') ? 'text_raw'), 'matris: authenticated messages sütunlarında text_raw yok');

  -- fonksiyonlar: public ve app şemalarında EXECUTE (PUBLIC dahil)
  create temporary table exp_fn on commit drop as
  select f.key as fn, g.value as role from jsonb_each(v_m -> 'functions') f, jsonb_array_elements_text(f.value -> 'grants') g;
  create temporary table act_fn on commit drop as
  select n.nspname || '.' || p.proname as fn, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as role
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where n.nspname in ('public', 'app') and a.privilege_type = 'EXECUTE'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and (a.grantee = 0 or a.grantee::regrole::text = any(v_roles));
  select string_agg(format('%s → %s', x.fn, x.role), '; ') into v_extra from (select * from act_fn except select * from exp_fn) x;
  select string_agg(format('%s → %s', x.fn, x.role), '; ') into v_missing from (select * from exp_fn except select * from act_fn) x;
  perform t.ok(v_extra is null, 'fonksiyonlarda matris dışı EXECUTE yok (PUBLIC dahil): ' || coalesce(v_extra, '-'));
  perform t.ok(v_missing is null, 'matristeki EXECUTE yetkilerinin hepsi canlıda var: ' || coalesce(v_missing, '-'));
  select string_agg(x.fn, ', ') into v_missing from (
    select distinct n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    except select k from jsonb_object_keys(v_m -> 'functions') k) x;
  perform t.ok(v_missing is null, 'her public fonksiyonu matriste listeli: ' || coalesce(v_missing, '-'));

  -- şema yetkileri
  perform t.ok(not has_schema_privilege('anon', 'secure', 'usage') and not has_schema_privilege('bot_runtime', 'audit', 'usage')
               and has_schema_privilege('bot_runtime', 'app', 'usage') and has_schema_privilege('batch_worker', 'public', 'usage')
               and not has_schema_privilege('anon', 'app', 'usage'), 'şema USAGE: public/app açık, secure/audit kapalı, anon app''e erişemez');

  -- Sahiplik (Supabase ayrıcalık modeli): SECURITY DEFINER fonksiyonlar, görünümler ve tablolar TEK bir sahibe aittir;
  -- bu sahip süper kullanıcı DEĞİLDİR ve BYPASSRLS taşır (Supabase "postgres"; yerelde ogrenmen_owner). Süper kullanıcı
  -- sahipliği FORCE RLS ve yetki hatalarını gizlerdi.
  select string_agg(distinct pg_get_userbyid(p.proowner), ', ') into v_extra
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app', 'secure', 'audit') and p.prosecdef
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  perform t.ok(v_extra is not null and position(',' in v_extra) = 0, 'SECURITY DEFINER fonksiyonların tek sahibi var: ' || coalesce(v_extra, '-'));
  perform t.ok((select not r.rolsuper and r.rolbypassrls from pg_roles r where r.rolname = v_extra),
               'definer sahibi (' || v_extra || ') süper kullanıcı değil ve BYPASSRLS');
  select string_agg(format('%s.%s (%s)', n.nspname, c.relname, pg_get_userbyid(c.relowner)), ', ') into v_missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'app', 'secure', 'audit') and c.relkind in ('r', 'v', 'm', 'p')
     and pg_get_userbyid(c.relowner) <> v_extra
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');
  perform t.ok(v_missing is null, 'tablo ve görünümlerin sahibi definer sahibiyle aynı: ' || coalesce(v_missing, '-'));
  perform t.ok((select bool_and(pg_get_userbyid(c.relowner) = v_extra) from pg_class c
                 where c.oid in ('public.questions_public'::regclass, 'public.v_messages_staff'::regclass, 'public.v_exam_items_full'::regclass)),
               'security_invoker=false görünümler (questions_public, v_messages_staff, v_exam_items_full) süper kullanıcı olmayan sahipte');

  -- Storage (yalnız storage şeması varsa: barındırılan Supabase)
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    select string_agg(p ->> 'name', ', ') into v_missing
      from jsonb_array_elements(v_m #> '{storage,storage.objects,policies}') p
     where not exists (select 1 from pg_policies pp where pp.schemaname = 'storage' and pp.tablename = 'objects' and pp.policyname = p ->> 'name');
    perform t.ok(v_missing is null, 'storage.objects politikaları: ' || coalesce(v_missing, 'hepsi var'));
    if exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
      perform t.ok(pg_has_role('supabase_storage_admin', 'bot_runtime', 'member') and pg_has_role('supabase_storage_admin', 'batch_worker', 'member'),
                   'role membership: supabase_storage_admin ∋ bot_runtime, batch_worker');
    end if;
  else
    raise notice 'SKIP: storage şeması yok (yerel Postgres) — storage.objects politikaları ve rol üyeliği';
  end if;
end $$;

rollback;
