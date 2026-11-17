-- tests/25_priority_plan.sql — öncelik planı (0037 app.refresh_style_scores, 0038 compute_priority_plan,
-- approve_priority_plan): skor = 0.5·sıklık + 0.3·güncellik + 0.2·müfredat uyumu (sıklık = yıl payı; güncellik =
-- 0.5^(boşluk/2); uyum = izlencedeki kazanım payı, ata kazanım da kapsar; kazanımsız tarz 0.5), sıralama, emekli tarz
-- dışarıda, exam-priority-plan şekli (sabit başlık, satır anahtarları, ≈N puan, tür eşlemesi, kanıt kimlikleri, izlencede
-- olup sorulmamış konular, 10 satır + others), en az iki yıl, yetki ve onay akışı (öğrenci yalnız onaylı planı görür).
begin;
\ir _fixture.sql

do $$
declare
  v_src uuid;
  v_y int;
  v_x uuid;
  v_yy uuid;
  v_z uuid;
  v_r uuid;
begin
  perform t.add_outsiders();
  insert into public.skills (curriculum_id, id, parent_id, name, kind, is_leaf, order_no) values (t.u('cur'), 't.mat.c', 't.mat', 'Yeni kazanım', 'outcome', true, 4);
  insert into public.question_styles (course_id, curriculum_id, code, name, skill_ids, status) values
    (t.u('course'), t.u('cur'), 'x', 'Her yıl çıkan tarz', array['t.mat.a'], 'active'),
    (t.u('course'), t.u('cur'), 'y', 'Eskiden çıkan tarz', array['t.mat.b'], 'active'),
    (t.u('course'), t.u('cur'), 'z', 'Yeni çıkan tarz', '{}', 'active'),
    (t.u('course'), t.u('cur'), 'w', 'Hiç çıkmamış tarz', '{}', 'active'),
    (t.u('course'), t.u('cur'), 'r', 'Emekli tarz', '{}', 'retired');
  insert into t.cfg select 'ST_' || qs.code, qs.id::text from public.question_styles qs where qs.course_id = t.u('course');
  v_x := t.u('ST_x');
  v_yy := t.u('ST_y');
  v_z := t.u('ST_z');
  v_r := t.u('ST_r');
  for v_y in 2022..2025 loop
    insert into public.exam_sources (course_id, year, term, status) values (t.u('course'), v_y, 'osym', 'clustered') returning id into v_src;
    insert into t.cfg values ('S' || v_y, v_src::text);
    insert into public.exam_items (source_id, item_no, kind, points, style_id, ocr_text) values (v_src, 1, 'mc', 10, v_x, 'METIN');
    if v_y in (2022, 2023) then
      insert into public.exam_items (source_id, item_no, kind, points, style_id) values (v_src, 2, 'calc', v_y - 2017, v_yy);
    end if;
    if v_y = 2025 then
      insert into public.exam_items (source_id, item_no, kind, style_id) values (v_src, 3, 'other', v_z), (v_src, 4, 'mc', v_r);
    end if;
  end loop;
  insert into public.syllabus_topics (course_id, curriculum_id, week, title, skill_ids) values
    (t.u('course'), t.u('cur'), 1, 'İşlem önceliği', array['t.mat.a']),
    (t.u('course'), t.u('cur'), 2, 'Yeni konu', array['t.mat.c']);
  insert into public.questions (curriculum_id, skill_ids, stem, source, content_hash, status, style_id)
  values (t.u('cur'), array['t.mat.a'], 'Özgün varyant', 'llm', 'h-variant-25', 'approved', v_x),
         (t.u('cur'), array['t.mat.a'], 'Onaysız varyant', 'llm', 'h-variant-25b', 'pending_review', v_x);
end $$;

-- yetki
do $$
begin
  perform t.ok(not has_function_privilege('anon', 'public.compute_priority_plan(uuid, text)', 'execute')
               and not has_function_privilege('anon', 'public.approve_priority_plan(uuid, text)', 'execute'), 'anon plan RPC''lerini çağıramaz');
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.compute_priority_plan(%L)', t.v('course')), 'OGR-AUTH-002%', 'öğrenci plan hesaplayamaz');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.compute_priority_plan(%L)', t.v('course')), 'OGR-AUTH-002%', 'derse bağsız eğitmen plan hesaplayamaz');
  perform t.as_admin();
end $$;

-- skorlar ve plan
do $$
declare
  v_r jsonb;
  v_p jsonb;
  v_row jsonb;
begin
  perform t.as_user(t.u('inst'));
  v_r := public.compute_priority_plan(t.u('course'));
  perform t.as_admin();
  insert into t.cfg values ('P1', v_r ->> 'plan_id');
  -- skorlar (skor sırasıyla): x 1, z 0.525, r 0.525 (emekli), y 0.4, w 0.1
  perform t.ok((select s ->> 'frequency' = '1.0000' and s ->> 'recency' = '1.0000' and s ->> 'alignment' = '1.0000' and s ->> 'score' = '1.0000'
                  from jsonb_array_elements(v_r -> 'scores') as s where s ->> 'style_id' = t.v('ST_x')),
               'x: 4/4 yıl, son yıl soruldu, kazanımı izlencede → 0.5 + 0.3 + 0.2 = 1');
  perform t.ok((select s ->> 'frequency' = '0.5000' and s ->> 'recency' = '0.5000' and s ->> 'alignment' = '0.0000' and s ->> 'score' = '0.4000'
                  from jsonb_array_elements(v_r -> 'scores') as s where s ->> 'style_id' = t.v('ST_y')),
               'y: 2/4 yıl, iki yıldır yok (0.5^(2/2)), kazanımı izlencede değil → 0.25 + 0.15 + 0 = 0.4');
  perform t.ok((select s ->> 'frequency' = '0.2500' and s ->> 'recency' = '1.0000' and s ->> 'alignment' = '0.5000' and s ->> 'score' = '0.5250'
                  from jsonb_array_elements(v_r -> 'scores') as s where s ->> 'style_id' = t.v('ST_z')),
               'z: 1/4 yıl, son yıl, kazanımsız (uyum 0.5) → 0.125 + 0.3 + 0.1 = 0.525');
  perform t.ok((select s ->> 'score' = '0.1000' and (s ->> 'hits')::int = 0 from jsonb_array_elements(v_r -> 'scores') as s
                 where s ->> 'style_id' = t.v('ST_w')), 'w: hiç sorulmamış → yalnız uyum (0.2 · 0.5 = 0.1)');
  perform t.ok((select qs.priority_score = 1 and qs.frequency_score = 1 and qs.recency_score = 1 and qs.syllabus_score = 1
                       and qs.years_hit = array[2022, 2023, 2024, 2025]::smallint[] and qs.years_total = 4
                  from public.question_styles qs where qs.id = t.u('ST_x'))
               and (select qs.priority_score = 0.4 and qs.years_hit = array[2022, 2023]::smallint[] from public.question_styles qs where qs.id = t.u('ST_y')),
               'skorlar question_styles''a yazıldı');

  v_p := v_r -> 'plan';
  perform t.ok((select array_agg(k order by k) from jsonb_object_keys(v_p) as k)
                 = array['course_code', 'evidence_count', 'generated_at', 'others', 'period', 'rows', 'schema_version', 'title',
                         'uncovered_topics', 'years_total'],
               'plan anahtarları exam-priority-plan şemasıyla aynı');
  perform t.ok(v_p ->> 'title' = 'Sıklık analizine göre öncelikler' and v_p ->> 'schema_version' = '1.0' and v_p ->> 'course_code' = 'T-MAT-TEST'
               and v_p ->> 'period' = '2022–2025' and (v_p ->> 'years_total')::int = 4 and (v_p ->> 'evidence_count')::int = 7
               and v_p ->> 'generated_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' and v_p -> 'others' = '[]'::jsonb
               and v_p -> 'uncovered_topics' = '["Yeni konu"]'::jsonb,
               'başlık sabit, dönem arşiv aralığı, 4 yıl, 7 kanıt (emekli tarz hariç), izlencede olup sorulmamış konu');
  perform t.ok((select array_agg(r ->> 'style_ids' order by (r ->> 'rank')::int) from jsonb_array_elements(v_p -> 'rows') as r)
                 = array[jsonb_build_array(t.v('ST_x'))::text, jsonb_build_array(t.v('ST_z'))::text, jsonb_build_array(t.v('ST_y'))::text],
               'satır sırası skor sırası: x, z, y (emekli r ve hiç sorulmamış w yok)');
  v_row := v_p -> 'rows' -> 0;
  perform t.ok((select array_agg(k order by k) from jsonb_object_keys(v_row) as k)
                 = array['evidence_count', 'evidence_item_ids', 'hits', 'kind', 'points_text', 'rank', 'skill_id', 'style_ids',
                         'syllabus_alignment', 'topic', 'variant_question_ids', 'years'],
               'satır anahtarları şemayla aynı');
  perform t.ok(v_row ->> 'topic' = 'Her yıl çıkan tarz' and v_row ->> 'kind' = 'çoktan seçmeli' and v_row ->> 'skill_id' = 't.mat.a'
               and (v_row ->> 'hits')::int = 4 and (v_row ->> 'years')::int = 4 and v_row ->> 'points_text' = '≈10 puan'
               and (v_row ->> 'evidence_count')::int = 4 and jsonb_array_length(v_row -> 'evidence_item_ids') = 4
               and v_row -> 'evidence_item_ids' ->> 0 = (select ei.id::text from public.exam_items ei where ei.source_id = t.u('S2025') and ei.item_no = 1)
               and v_row ->> 'syllabus_alignment' = 'covered_and_asked' and jsonb_array_length(v_row -> 'variant_question_ids') = 1,
               'x satırı: çoktan seçmeli, 4 yıl, ≈10 puan, kanıtlar yeniden eskiye, izlencede, onaylı özgün varyant');
  v_row := v_p -> 'rows' -> 2;
  perform t.ok(v_row ->> 'kind' = 'hesap' and v_row ->> 'points_text' = '≈6 puan' and v_row ->> 'syllabus_alignment' = 'asked_not_in_syllabus'
               and (v_row ->> 'years')::int = 2, 'y satırı: hesap, ortalama 5,5 → ≈6 puan, izlencede değil');
  v_row := v_p -> 'rows' -> 1;
  perform t.ok(v_row ->> 'kind' = 'diğer' and v_row -> 'skill_id' = 'null'::jsonb and v_row ->> 'points_text' = '≈0 puan'
               and v_row ->> 'syllabus_alignment' = 'asked_not_in_syllabus', 'z satırı: diğer, kazanımsız, puansız');
  perform t.ok(v_p::text not like '%METIN%', 'plan soru metni taşımaz');
  perform t.ok((select p.status = 'pending_review' and p.evidence_count = 7 and p.period = '2022–2025' from public.exam_priority_plans p
                 where p.id = t.u('P1')), 'plan pending_review yazıldı');
end $$;

-- ata kazanım izlenceyi kapsar; yeniden hesaplama önceki bekleyen planı emekli eder
do $$
declare
  v_r jsonb;
begin
  insert into public.syllabus_topics (course_id, curriculum_id, week, title, skill_ids) values (t.u('course'), t.u('cur'), 3, 'Ünite', array['t.mat']);
  perform t.as_service();
  v_r := public.compute_priority_plan(t.u('course'), 'YKS 2026');
  perform t.as_admin();
  insert into t.cfg values ('P2', v_r ->> 'plan_id');
  perform t.ok((select s ->> 'alignment' = '1.0000' and s ->> 'score' = '0.6000' from jsonb_array_elements(v_r -> 'scores') as s
                 where s ->> 'style_id' = t.v('ST_y'))
               and v_r -> 'plan' -> 'rows' -> 1 -> 'style_ids' ->> 0 = t.v('ST_y') and v_r -> 'plan' ->> 'period' = 'YKS 2026'
               and v_r -> 'plan' -> 'uncovered_topics' = '["Yeni konu"]'::jsonb,
               'üst kazanımı izlencede olan y artık uyumlu (0.6) ve ikinci sırada; dönem verilen');
  perform t.ok((select p.status = 'retired' from public.exam_priority_plans p where p.id = t.u('P1'))
               and (select p.status = 'pending_review' from public.exam_priority_plans p where p.id = t.u('P2')),
               'önceki bekleyen plan emekli oldu');
end $$;

-- en çok 10 satır, kalanı others
do $$
declare
  v_r jsonb;
  v_i int;
  v_st uuid;
begin
  for v_i in 1..10 loop
    insert into public.question_styles (course_id, code, name, status) values (t.u('course'), 'ek-' || v_i, 'Ek tarz ' || lpad(v_i::text, 2, '0'), 'active')
    returning id into v_st;
    insert into public.exam_items (source_id, item_no, kind, style_id) values (t.u('S2024'), 10 + v_i, 'mc', v_st);
  end loop;
  perform t.as_user(t.u('inst'));
  v_r := public.compute_priority_plan(t.u('course'));
  perform t.as_admin();
  insert into t.cfg values ('P3', v_r ->> 'plan_id');
  perform t.ok(jsonb_array_length(v_r -> 'plan' -> 'rows') = 10 and v_r -> 'plan' -> 'others' = '["Ek tarz 08", "Ek tarz 09", "Ek tarz 10"]'::jsonb
               and (v_r -> 'plan' ->> 'evidence_count')::int = 17
               and (select s ->> 'score' = '0.4371' from jsonb_array_elements(v_r -> 'scores') as s where s ->> 'style_id' = (select id::text from public.question_styles where code = 'ek-1')),
               'on satır + 3 others; ek tarz skoru 0.125 + 0.3·0.5^(1/2) + 0.1 = 0.4371');
end $$;

-- onay akışı: öğrenci yalnız onaylı planı görür; worker onaylayamaz; yalnız bekleyen plan onaylanır; yeni onay eskisini emekli eder
do $$
declare
  v_r jsonb;
begin
  perform t.ok(t.sees(t.u('elif'), 'select 1 from public.exam_priority_plans') = 0, 'öğrenci bekleyen planı görmez');
  perform t.as_service();
  perform t.raises(format('select public.approve_priority_plan(%L, ''approved'')', t.v('P3')), 'OGR-AUTH-002%', 'worker plan onaylayamaz');
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.approve_priority_plan(%L, ''approved'')', t.v('P3')), 'OGR-AUTH-002%', 'öğrenci plan onaylayamaz');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.approve_priority_plan(%L, ''yayinla'')', t.v('P3')), 'OGR-STYLE-012%', 'karar approved | retired');
  -- P2'yi P3'ün hesabı emekli etti: eski plan onaylanamaz, emekli plan yeniden karara bağlanmaz
  perform t.raises(format('select public.approve_priority_plan(%L, ''approved'')', t.v('P2')), 'OGR-STYLE-012 plan bekleyen durumda değil%',
                   'emekli (eski) plan onaylanamaz');
  perform t.raises(format('select public.approve_priority_plan(%L, ''retired'')', t.v('P2')), 'OGR-STYLE-012 plan bekleyen durumda değil%',
                   'emekli plan yeniden emekli edilmez');
  perform public.approve_priority_plan(t.u('P3'), 'approved');
  perform t.raises(format('select public.approve_priority_plan(%L, ''approved'')', t.v('P3')), 'OGR-STYLE-012 plan bekleyen durumda değil%',
                   'onaylı plan ikinci kez onaylanmaz');
  perform t.as_admin();
  perform t.ok((select p.status = 'retired' from public.exam_priority_plans p where p.id = t.u('P2'))
               and (select p.status = 'approved' and p.approved_by = t.u('inst') and p.approved_at is not null
                      from public.exam_priority_plans p where p.id = t.u('P3')),
               'bekleyen P3 onaylandı; emekli P2 emekli kaldı');
  -- yeni hesap (P4) onaylanınca önceki onaylı plan (P3) emekli olur
  perform t.as_user(t.u('inst'));
  v_r := public.compute_priority_plan(t.u('course'));
  perform t.as_admin();
  insert into t.cfg values ('P4', v_r ->> 'plan_id');
  perform t.ok((select p.status = 'approved' from public.exam_priority_plans p where p.id = t.u('P3')),
               'yeni hesap onaylı planı emekli etmez (yalnız bekleyeni)');
  perform t.as_user(t.u('inst'));
  perform public.approve_priority_plan(t.u('P4'), 'approved');
  perform t.as_admin();
  perform t.ok((select p.status = 'retired' from public.exam_priority_plans p where p.id = t.u('P3'))
               and (select p.status = 'approved' from public.exam_priority_plans p where p.id = t.u('P4')),
               'yeni onay önceki onaylı planı emekli eder');
  perform t.ok(t.sees(t.u('elif'), 'select 1 from public.exam_priority_plans') = 1 and t.sees(t.u('parent'), 'select 1 from public.exam_priority_plans') = 0,
               'öğrenci onaylı planı görür, veli görmez (plan tarz adı taşır; 0018 tarz kuralıyla tutarlı)');
end $$;

-- en az iki yıllık arşiv ve tarza atanmış madde gerekir
do $$
declare
  v_c uuid;
  v_s uuid;
begin
  insert into public.courses (code, title, curriculum_id, created_by) values ('T-TEK', 'Tek yıllık ders', t.u('cur'), t.u('inst')) returning id into v_c;
  insert into public.exam_sources (course_id, year, term) values (v_c, 2025, 'final') returning id into v_s;
  insert into public.exam_items (source_id, item_no, kind) values (v_s, 1, 'proof');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.compute_priority_plan(%L)', v_c), 'OGR-STYLE-010%', 'tek yıllık arşivde plan yok');
  perform t.as_admin();
  insert into public.exam_sources (course_id, year, term) values (v_c, 2024, 'final') returning id into v_s;
  insert into public.exam_items (source_id, item_no, kind) values (v_s, 1, 'proof');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.compute_priority_plan(%L)', v_c), 'OGR-STYLE-011%', 'tarza atanmış madde yoksa plan yok');
  perform t.as_admin();
end $$;

-- request_style_questions: eğitmen "5 soru üret" (style.question_gen → outbox), yetki ve sınırlar
do $$
begin
  perform t.ok(not has_function_privilege('anon', 'public.request_style_questions(uuid, int)', 'execute'), 'anon soru üretimi isteyemez');
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.request_style_questions(%L)', t.v('ST_x')), 'OGR-AUTH-002%', 'öğrenci soru üretimi isteyemez');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.request_style_questions(%L)', t.v('ST_x')), 'OGR-AUTH-002%', 'derse bağsız eğitmen soru üretimi isteyemez');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.request_style_questions(%L, 11)', t.v('ST_x')), 'OGR-STYLE-013%', 'en çok 10 soru');
  perform t.raises(format('select public.request_style_questions(%L)', t.v('ST_r')), 'OGR-STYLE-013%', 'emekli tarza soru üretilmez');
  perform public.request_style_questions(t.u('ST_x'));
  perform t.as_admin();
  perform t.ok(exists (select 1 from secure.job_outbox o where o.name = 'style.question_gen' and o.data ->> 'style_id' = t.v('ST_x')
                          and (o.data ->> 'count')::int = 5 and o.data ->> 'reason' = 'instructor'),
               'style.question_gen işi (5 soru) kuyruğa atıldı');
end $$;

rollback;
