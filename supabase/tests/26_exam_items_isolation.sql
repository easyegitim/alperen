-- tests/26_exam_items_isolation.sql — çıkmış sınav arşivinin (exam_sources, exam_items.ocr_text: telifli soru metni)
-- yalıtımı (0036–0038): öğrenci, veli, bağsız öğrenci/veli ve derse bağsız eğitmen hiçbir arşiv satırı görmez; dersin
-- eğitmeni ve derse kayıtlı öğrenciye bağlı eğitmen okur (ikincisi yazamaz); başka dersin arşivi dersin eğitmenine de
-- kapalı; OCR metnine dokunan ve authenticated'ın çağırabildiği fonksiyon yalnız register_exam_items (yazım); öğrenciye,
-- veliye dönen hiçbir yapı (tarz kütüphanesi, kapsama, onaylı plan) soru metni ya da örnek madde taşımaz.
begin;
\ir _fixture.sql

do $$
declare
  v_src uuid;
  v_st uuid;
  v_c2 uuid;
  v_r jsonb;
begin
  perform t.add_outsiders();
  -- derse kayıtlı Deniz'e (EC2) bağlı, dersle bağı olmayan izleyici eğitmen
  insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a3', 'egitmen3@ogrenmen.test');
  insert into public.profiles (id, role, display_name) values ('00000000-0000-4000-8000-0000000000a3', 'instructor', 'Zeynep Hoca');
  insert into t.cfg values ('inst3', '00000000-0000-4000-8000-0000000000a3');
  insert into public.instructor_links (instructor_id, student_id, role) values (t.u('inst3'), t.u('C'), 'viewer');

  insert into public.question_styles (course_id, curriculum_id, code, name, description, skill_ids, status)
  values (t.u('course'), t.u('cur'), 'telif', 'Telifli tarz', 'Tanım metni', array['t.mat.a'], 'active') returning id into v_st;
  insert into t.cfg values ('ST', v_st::text);
  for v_r in select jsonb_build_object('y', g) from generate_series(2024, 2025) as g loop
    insert into public.exam_sources (course_id, year, term, status) values (t.u('course'), (v_r ->> 'y')::int, 'final', 'clustered')
    returning id into v_src;
    insert into public.exam_items (source_id, item_no, kind, ocr_text, style_id, points)
    values (v_src, 1, 'calc', 'TELIF-METNI-26 ' || (v_r ->> 'y'), v_st, 10);
  end loop;
  insert into t.cfg values ('S', v_src::text);
  update public.question_styles qs set exemplar_item_ids = array(select ei.id from public.exam_items ei where ei.style_id = v_st) where qs.id = v_st;

  -- başka dersin (inst2) arşivi
  insert into public.courses (code, title, curriculum_id, created_by) values ('T-INST2', 'Ali Hoca dersi', t.u('cur'), t.u('inst2'))
  returning id into v_c2;
  insert into t.cfg values ('course2', v_c2::text);
  insert into public.exam_sources (course_id, year, term) values (v_c2, 2025, 'vize') returning id into v_src;
  insert into public.exam_items (source_id, item_no, ocr_text) values (v_src, 1, 'BASKA-DERS-METNI');

  -- kapsama + onaylı plan
  insert into public.solution_analyses (enrollment_id, analysis, verdict, style_id) values (t.u('EA'), '{}', 'wrong', v_st);
  perform t.as_user(t.u('inst'));
  v_r := public.compute_priority_plan(t.u('course'));
  perform public.approve_priority_plan((v_r ->> 'plan_id')::uuid, 'approved');
  perform t.as_admin();
end $$;

-- satır görünürlüğü
do $$
declare
  v_uid uuid;
begin
  foreach v_uid in array array[t.u('elif'), t.u('can'), t.u('parent'), t.u('deniz'), t.u('parent2'), t.u('inst2')] loop
    perform t.ok(t.sees(v_uid, 'select 1 from public.exam_items ei join public.exam_sources s on s.id = ei.source_id where s.course_id = '
                                || quote_literal(t.v('course'))) = 0
                 and t.sees(v_uid, 'select 1 from public.exam_sources where course_id = ' || quote_literal(t.v('course'))) = 0
                 and t.sees(v_uid, 'select 1 from public.exam_items where ocr_text like ''TELIF%''') = 0,
                 'dersin arşivi kapalı: ' || (select p.display_name from public.profiles p where p.id = v_uid));
  end loop;
  perform t.ok(t.sees(t.u('inst'), 'select 1 from public.exam_items where ocr_text like ''TELIF%''') = 2
               and t.sees(t.u('inst'), 'select 1 from public.exam_items where ocr_text = ''BASKA-DERS-METNI''') = 0,
               'dersin eğitmeni kendi dersinin arşivini okur, başka dersinkini okumaz');
  perform t.ok(t.sees(t.u('inst2'), 'select 1 from public.exam_items where ocr_text = ''BASKA-DERS-METNI''') = 1,
               'başka dersin eğitmeni yalnız kendi arşivini okur');
  perform t.ok(t.sees(t.u('inst3'), 'select 1 from public.exam_items where ocr_text like ''TELIF%''') = 2
               and t.sees(t.u('inst3'), 'select 1 from public.exam_sources') = 2,
               'derse kayıtlı öğrenciye bağlı eğitmen arşivi okur');
  perform t.ok(t.sees(t.u('admin'), 'select 1 from public.exam_items') = 3, 'admin tüm arşivi okur');
  perform t.as_service();
  perform t.ok(t.n('select 1 from public.exam_items') = 3, 'worker (service_role) tüm arşivi okur');
  perform t.as_admin();
end $$;

-- öncelik planı: bekleyen plan (tarz adları, evidence_item_ids) yalnız dersin arşivini okuyabilen personele
do $$
declare
  v_r jsonb;
begin
  perform t.as_user(t.u('inst'));
  v_r := public.compute_priority_plan(t.u('course'));
  perform t.as_admin();
  perform t.ok(t.sees(t.u('inst2'), format('select 1 from public.exam_priority_plans where id = %L', v_r ->> 'plan_id')) = 0
               and t.sees(t.u('inst2'), format('select 1 from public.exam_priority_plans where course_id = %L and status <> ''approved''', t.v('course'))) = 0,
               'derse bağsız eğitmen dersin bekleyen planını görmez (onaylı plan derse erişen herkese açık)');
  perform t.ok(t.sees(t.u('inst'), format('select 1 from public.exam_priority_plans where id = %L', v_r ->> 'plan_id')) = 1
               and t.sees(t.u('inst3'), format('select 1 from public.exam_priority_plans where id = %L', v_r ->> 'plan_id')) = 1,
               'dersin eğitmeni ve derse kayıtlı öğrenciye bağlı eğitmen bekleyen planı görür');
  perform t.ok(t.sees(t.u('elif'), format('select 1 from public.exam_priority_plans where id = %L', v_r ->> 'plan_id')) = 0
               and t.sees(t.u('elif'), format('select 1 from public.exam_priority_plans where course_id = %L and status = ''approved''', t.v('course'))) = 1,
               'öğrenci bekleyen planı görmez, onaylı planı görür');
end $$;

-- yazım: bağlı izleyici eğitmen okur ama yazamaz
do $$
declare
  v_v jsonb;
begin
  perform t.as_user(t.u('inst3'));
  perform t.raises(format('select public.register_exam_items(%L, ''[{"item_no": 1}]'')', t.v('S')), 'OGR-AUTH-002%', 'izleyici eğitmen madde yazamaz');
  perform t.raises(format('select public.upsert_question_styles(%L, ''[{"code": "telif", "name": "Yeni ad"}]'')', t.v('course')),
                   'OGR-AUTH-002%', 'izleyici eğitmen tarz yazamaz');
  perform t.raises(format('select public.compute_priority_plan(%L)', t.v('course')), 'OGR-AUTH-002%', 'izleyici eğitmen plan hesaplayamaz');
  v_v := public.style_library_view(t.u('course'));
  perform t.ok(v_v ->> 'role' = 'staff' and not (v_v ->> 'can_manage')::boolean
               and (select (s -> 'coverage' ->> 'students_total')::int = 1 from jsonb_array_elements(v_v -> 'styles') as s),
               'izleyici eğitmen: personel görünümü, yönetemez, yalnız bağlı öğrencisinin kapsaması');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.register_exam_items(%L, ''[{"item_no": 1}]'')', t.v('S')), 'OGR-AUTH-002%', 'başka dersin eğitmeni madde yazamaz');
  perform t.as_admin();
end $$;

-- OCR metnine dokunan, authenticated'ın çağırabildiği fonksiyonlar yalnız yazım
do $$
declare
  v_set text;
begin
  select string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname) into v_set
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app') and p.prosrc ilike '%ocr_text%'
     and has_function_privilege('authenticated', p.oid, 'execute');
  perform t.ok(v_set = 'public.register_exam_items', 'ocr_text''e dokunan, authenticated çağırabilen fonksiyon yalnız register_exam_items ('
                                                      || coalesce(v_set, '-') || ')');
  perform t.ok(not exists (select 1 from pg_views v where v.schemaname = 'public' and v.definition ilike '%ocr_text%'),
               'hiçbir istemci görünümü ocr_text taşımaz');
end $$;

-- öğrenciye ve veliye dönen yapılar metin ve örnek madde taşımaz
do $$
declare
  v_t text;
begin
  perform t.as_user(t.u('elif'));
  v_t := public.style_library_view(t.u('course'))::text || public.student_style_coverage(t.u('EA'))::text
         || (select string_agg(p.plan::text, '') from public.exam_priority_plans p);
  perform t.ok(v_t not like '%TELIF-METNI%' and v_t not like '%BASKA-DERS%' and v_t like '%Telifli tarz%' and v_t like '%Tanım metni%',
               'öğrenci: tarz adı ve tanımı var; çıkmış soru metni yok');
  perform t.ok(public.style_library_view(t.u('course'))::text not like '%exemplar%'
               and public.style_library_view(t.u('course'))::text not like '%appearances%',
               'öğrenci kütüphane görünümünde örnek madde ve çıktığı sınavlar yok');
  perform t.raises('select exemplar_item_ids from public.question_styles', '42501', 'öğrenci örnek madde sütununu okuyamaz');
  perform t.as_user(t.u('parent'));
  v_t := (select string_agg(p.plan::text, '') from public.exam_priority_plans p);
  perform t.ok(v_t is null, 'veli onaylı planı görmez (tarz adları plan içinde; 0038 RLS)');
  perform t.ok(t.n('select 1 from public.question_styles') = 0, 'veli tarz satırı görmez');
  perform t.as_admin();
  perform t.ok((select bool_and(ei.id::text = any(array(select jsonb_array_elements_text(r -> 'evidence_item_ids'))))
                  from public.exam_priority_plans p cross join jsonb_array_elements(p.plan -> 'rows') as r
                  join public.exam_items ei on ei.style_id = t.u('ST')),
               'plan kanıtları yalnız arşiv kimlikleri (metin yerine bağlantı)');
end $$;

rollback;
