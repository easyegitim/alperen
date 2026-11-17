-- 0037_style_rpcs.sql — P4 tarz kütüphanesi RPC'leri (docs/PLAN-v2.md §11). Şema, yetki yardımcıları ve kapsama
-- tetikleyicileri 0036'da; öncelik planı 0038'de.
--   ingest_exam_source(p_course, p_meta, p_upload_ids)   eğitmen: çıkmış sınav dosyaları → exam_sources(uploaded) +
--                                       'style.ingest' işi; aynı ders + yıl + tür + dosya kümesi yeniden gönderilirse aynı
--                                       kaynak döner (düşmüş kaynak hariç).
--   register_exam_items(p_source, p_items)   worker (eğitmen de): kaynağın tam madde kümesi (exam-item v2: tür, biçim,
--                                       tuzak, zorluk, puan, kazanımlar, OCR metni, gömme, tarz); listede olmayan madde
--                                       silinir; kaynak 'ocr_done'.
--   upsert_question_styles(p_course, p_styles)   worker/eğitmen: tarzları koda göre yazar, maddeleri tarza atar
--                                       (item_ids), örnek maddeleri (exemplar_item_ids, yalnız personel görür) belirler.
--                                       Eğitmenin onayladığı/düzenlediği tarzın adı ve tanımı worker'ca ezilmez.
--   merge_styles(p_keep, p_merge)        eğitmen: p_merge'ün maddeleri, sınav soruları, teşhisleri ve üretilmiş soruları
--                                       p_keep'e geçer (kapsama tetikleyicilerle yeniden hesaplanır), yıllar/örnekler/
--                                       kazanımlar birleşir, p_merge silinir.
--   style_library_view(p_course)         eğitmen: arşiv özeti + tarzlar (sıklık, güncellik, uyum, skor, yıllar, çıktığı
--                                       sınavlar, öğrenci kapsaması) + son plan; öğrenci: etkin tarzların adı, tanımı,
--                                       sıklık kelime bandı ve kendi kapsaması. Çıkmış soru metni hiçbir dalda yoktur.
--   student_style_coverage(p_enrollment) öğrenci/bağlı eğitmen: kaydın etkin tarzları + kapsama ("3 çözdün, 1 doğru").
--   app.refresh_style_scores(p_course)   tarz istatistikleri ve skorları (0038 compute_priority_plan da kullanır).

-- --- yardımcılar ---------------------------------------------------------------------------------------------------------

-- jsonb sayı dizisi → halfvec(1024); null/eksik → null. Boyut ya da tür yanlışsa OGR-STYLE-006.
create or replace function app.jsonb_halfvec(p_value jsonb, p_label text) returns halfvec
language plpgsql
immutable
set search_path = pg_catalog, public, extensions, app
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) <> 1024
     or exists (select 1 from jsonb_array_elements(p_value) as x (v) where jsonb_typeof(x.v) <> 'number') then
    raise exception using errcode = 'P0001', message = format('OGR-STYLE-006 %s: gömme 1024 sayılık bir dizi olmalı', p_label);
  end if;
  return p_value::text::halfvec(1024);
end
$$;
comment on function app.jsonb_halfvec(jsonb, text) is 'jsonb sayı dizisini halfvec(1024)''e çevirir; null → null; boyut/tür hatasında OGR-STYLE-006.';

-- Sıklık kelime bandı (öğrenciye yüzde yerine)
create or replace function app.style_frequency_band(p_frequency numeric) returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_frequency is null or p_frequency <= 0 then null
              when p_frequency >= 0.6 then 'sık soruluyor'
              when p_frequency >= 0.3 then 'ara sıra soruluyor'
              else 'seyrek soruluyor' end
$$;
comment on function app.style_frequency_band(numeric) is 'Sıklık skoru → kelime bandı (sık / ara sıra / seyrek soruluyor); skor yoksa null.';

-- Öğrenciye gösterilecek tarz: arşivde sorulmuş (yılı var) ya da bankasında onaylı tarz sorusu olan. Eğitmenin elle
-- eklediği, hiç soru üretilmemiş tarz öğrencinin paydasını şişirmez (suggestions/styles.ts styleGapOf ile aynı ölçüt).
create or replace function app.style_has_practice(p_style uuid, p_years smallint[]) returns boolean
language sql
stable
set search_path = public, app, pg_temp
as $$
  select cardinality(coalesce(p_years, '{}')) > 0
         or exists (select 1 from public.questions q where q.style_id = p_style and q.status = 'approved')
$$;
comment on function app.style_has_practice(uuid, smallint[]) is 'Öğrenciye görünen tarz: yılı olan ya da onaylı tarz sorusu olan (Gelişim paydası).';

-- Öğrenci kapsama cümlesi ("Bu tarzı hiç çözmedin" | "3 çözdün, 1 doğru")
create or replace function app.style_coverage_text(p_seen int, p_solved int, p_correct int) returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case when coalesce(p_solved, 0) = 0 and coalesce(p_seen, 0) = 0 then 'Bu tarzı hiç çözmedin'
              when coalesce(p_solved, 0) = 0 then 'Bu tarzı gördün, henüz çözmedin'
              else p_solved || ' çözdün, ' || coalesce(p_correct, 0) || ' doğru' end
$$;
comment on function app.style_coverage_text(int, int, int) is 'Kapsama cümlesi: "Bu tarzı hiç çözmedin" | "Bu tarzı gördün, henüz çözmedin" | "3 çözdün, 1 doğru".';

-- Tarz istatistikleri ve skorları (docs/PLAN-v2.md §11): arşiv yılları = dersin düşmemiş kaynaklarındaki maddelerin yılları.
--   sıklık     = sorulduğu yıl sayısı / arşivdeki yıl sayısı
--   güncellik  = 0.5 ^ ((arşivin son yılı − tarzın son yılı) / 2)   (son yıl soruldu: 1; iki yıl önce: 0.5)
--   uyum       = kazanımlarının izlencedeki payı (izlence konusu kazanımın kendisi ya da atası); izlence yoksa kazanımı
--                olan tarz 1, kazanımsız tarz 0.5 (bilinmiyor)
--   skor       = 0.5·sıklık + 0.3·güncellik + 0.2·uyum
-- question_styles'a years_hit, years_total, frequency_score, recency_score, syllabus_score, priority_score yazar; tarz
-- başına {style_id, hits, years_hit, frequency, recency, alignment, score, has_skills} dizisini döner (skor sırasıyla).
create or replace function app.refresh_style_scores(p_course uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_cur uuid;
  v_years smallint[];
  v_total int;
  v_max int;
  v_has_syllabus boolean;
  v_out jsonb;
begin
  select co.curriculum_id into v_cur from public.courses co where co.id = p_course;
  select coalesce(array_agg(distinct coalesce(ei.year, s.year) order by coalesce(ei.year, s.year)), '{}')
    into v_years
    from public.exam_items ei join public.exam_sources s on s.id = ei.source_id
   where s.course_id = p_course and s.status <> 'failed';
  v_total := cardinality(v_years);
  v_max := (select max(x.y) from unnest(v_years) as x (y));
  v_has_syllabus := exists (select 1 from public.syllabus_topics st where st.course_id = p_course and cardinality(st.skill_ids) > 0);

  with recursive syl as (
    select distinct x.sid from public.syllabus_topics st cross join unnest(st.skill_ids) as x (sid) where st.course_id = p_course
  ),
  anc as (  -- (kazanım, kendisi ya da atası)
    select sk.id as skill_id, sk.id as anc_id, sk.parent_id from public.skills sk where sk.curriculum_id = v_cur
    union all
    select a.skill_id, p.id, p.parent_id from anc a join public.skills p on p.curriculum_id = v_cur and p.id = a.parent_id
  ),
  hits as (
    select qs.id as style_id,
           count(ei.id) filter (where s.id is not null) as n_hits,
           coalesce(array_agg(distinct coalesce(ei.year, s.year) order by coalesce(ei.year, s.year))
                      filter (where s.id is not null), '{}') as yrs
      from public.question_styles qs
      left join public.exam_items ei on ei.style_id = qs.id
      left join public.exam_sources s on s.id = ei.source_id and s.course_id = p_course and s.status <> 'failed'
     where qs.course_id = p_course
     group by qs.id
  ),
  align as (
    select qs.id as style_id, cardinality(qs.skill_ids) > 0 as has_skills,
           case when cardinality(qs.skill_ids) = 0 then 0.5
                when not v_has_syllabus then 1.0
                else (select (count(*) filter (where exists (select 1 from anc a join syl on syl.sid = a.anc_id
                                                              where a.skill_id = x.sid)))::numeric / cardinality(qs.skill_ids)
                        from unnest(qs.skill_ids) as x (sid)) end as a_score
      from public.question_styles qs
     where qs.course_id = p_course
  ),
  sc as (
    select h.style_id, h.n_hits, h.yrs, al.has_skills,
           round(case when v_total = 0 then 0 else cardinality(h.yrs)::numeric / v_total end, 4) as f_score,
           round(case when cardinality(h.yrs) = 0 or v_max is null then 0
                      else power(0.5, (v_max - (select max(y.y) from unnest(h.yrs) as y (y)))::numeric / 2) end, 4) as r_score,
           round(al.a_score, 4) as a_score
      from hits h join align al on al.style_id = h.style_id
  ),
  upd as (
    update public.question_styles qs
       set years_hit = sc.yrs, years_total = v_total, frequency_score = sc.f_score, recency_score = sc.r_score,
           syllabus_score = sc.a_score, priority_score = round(0.5 * sc.f_score + 0.3 * sc.r_score + 0.2 * sc.a_score, 4)
      from sc
     where qs.id = sc.style_id
    returning qs.id, qs.priority_score, qs.name, sc.n_hits, sc.yrs, sc.f_score, sc.r_score, sc.a_score, sc.has_skills
  )
  select coalesce(jsonb_agg(jsonb_build_object('style_id', u.id, 'hits', u.n_hits, 'years_hit', to_jsonb(u.yrs),
                                               'frequency', u.f_score, 'recency', u.r_score, 'alignment', u.a_score,
                                               'score', u.priority_score, 'has_skills', u.has_skills)
                            order by u.priority_score desc, cardinality(u.yrs) desc, u.n_hits desc, u.name, u.id), '[]'::jsonb)
    into v_out
    from upd u;
  return v_out;
end
$$;
comment on function app.refresh_style_scores(uuid) is 'Dersin tarz istatistikleri ve skorları: sıklık (yıl payı), güncellik (0.5^(boşluk/2)), müfredat uyumu (izlence payı), skor = 0.5·s + 0.3·g + 0.2·u; question_styles''a yazar, skor sırasıyla döner.';

-- --- ingest_exam_source --------------------------------------------------------------------------------------------------

create or replace function public.ingest_exam_source(p_course uuid, p_meta jsonb, p_upload_ids uuid[]) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
  v_ids uuid[] := coalesce(p_upload_ids, '{}');
  v_year int;
  v_term text;
  v_alias text;
  v_found int;
  v_bad int;
  v_set uuid[];
  v_prev public.exam_sources%rowtype;
  v_src uuid;
  v_job uuid;
begin
  if not exists (select 1 from public.courses co where co.id = p_course) then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-001 ders bulunamadı';
  end if;
  if not app.can_manage_course(p_course) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 çıkmış sınavı yalnız dersin eğitmeni, admin ya da worker yükler';
  end if;
  if jsonb_typeof(v_meta) <> 'object' then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-002 p_meta nesne olmalı';
  end if;
  if coalesce(v_meta ->> 'year', '') !~ '^[0-9]{4}$' or (v_meta ->> 'year')::int not between 1950 and extract(year from now())::int + 1 then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-002 year dört haneli geçerli bir yıl olmalı';
  end if;
  v_year := (v_meta ->> 'year')::int;
  v_term := coalesce(nullif(v_meta ->> 'term', ''), 'diger');
  if v_term not in ('vize', 'final', 'but', 'deneme', 'osym', 'meb', 'diger') then
    raise exception using errcode = 'P0001', message = format('OGR-STYLE-002 term geçersiz: %s', v_term);
  end if;
  v_alias := nullif(v_meta ->> 'instructor_alias', '');
  if v_alias is not null and v_alias !~ '^hoca-[A-Z]$' then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-002 instructor_alias ''hoca-A''…''hoca-Z'' olmalı (gerçek ad yazılmaz)';
  end if;
  if cardinality(v_ids) < 1 or cardinality(v_ids) > 60 or array_position(v_ids, null) is not null
     or (select count(distinct x.u) from unnest(v_ids) as x (u)) <> cardinality(v_ids) then
    raise exception using errcode = 'P0001',
      message = format('OGR-UPL-001 çıkmış sınav için 1–60 tekil dosya gerekir (gelen %s)', cardinality(v_ids));
  end if;

  perform 1 from public.uploads u where u.id = any(v_ids) order by u.id for update;
  -- eğitmen arşivi: yükleyen çağıran (worker her yüklemeyi kullanabilir), öğrenciye bağlı değil, belge türü
  select count(*), count(*) filter (where u.status not in ('stored', 'failed'))
    into v_found, v_bad
    from public.uploads u
   where u.id = any(v_ids) and u.student_id is null and u.kind in ('photo', 'pdf', 'document')
     and (app.is_trusted() or u.owner_id = auth.uid());
  if v_found <> cardinality(v_ids) then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-002 yükleme bulunamadı, senin değil ya da arşiv dosyası değil';
  end if;

  v_set := (select array_agg(x.u order by x.u) from unnest(v_ids) as x (u));
  select s.* into v_prev from public.exam_sources s
   where s.course_id = p_course and s.year = v_year and s.term = v_term and s.status <> 'failed'
     and (select array_agg(x.u order by x.u) from unnest(s.upload_ids) as x (u)) = v_set
   order by s.created_at desc limit 1;
  if v_prev.id is not null then
    return jsonb_build_object('source_id', v_prev.id, 'course_id', p_course, 'status', v_prev.status, 'job_id', null,
                              'upload_ids', to_jsonb(v_prev.upload_ids), 'reused', true);
  end if;
  if v_bad > 0 then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-003 dosyaların bir kısmı başka bir gönderimde işleniyor ya da işlendi';
  end if;

  insert into public.exam_sources (course_id, year, term, instructor_alias, upload_id, upload_ids, uploaded_by, status)
  values (p_course, v_year, v_term, v_alias, v_ids[1], v_ids, auth.uid(), 'uploaded')
  returning id into v_src;
  update public.uploads u set status = 'processing' where u.id = any(v_ids);
  v_job := public.enqueue_job('style.ingest', jsonb_build_object('source_id', v_src, 'course_id', p_course, 'year', v_year,
                                                                 'term', v_term, 'upload_ids', to_jsonb(v_ids)));
  perform app.audit_event('style.ingest', 'public.exam_sources', v_src::text,
                          jsonb_build_object('course_id', p_course, 'year', v_year, 'term', v_term, 'upload_ids', to_jsonb(v_ids),
                                             'job_id', v_job));
  return jsonb_build_object('source_id', v_src, 'course_id', p_course, 'status', 'uploaded', 'job_id', v_job,
                            'upload_ids', to_jsonb(v_ids), 'reused', false);
end
$$;
comment on function public.ingest_exam_source(uuid, jsonb, uuid[]) is 'Eğitmen: çıkmış sınav dosyaları (1–60, eğitmen arşivi) → exam_sources(uploaded) + style.ingest işi; aynı ders/yıl/tür/dosya kümesi aynı kaynağı döner.';

-- --- register_exam_items -------------------------------------------------------------------------------------------------

create or replace function public.register_exam_items(p_source uuid, p_items jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_src public.exam_sources%rowtype;
  v_cur uuid;
  v_it jsonb;
  v_no int;
  v_nos int[] := '{}';
  v_kind text;
  v_skill text;
  v_skills text[];
  v_bad text;
  v_style uuid;
  v_year int;
  v_term text;
  v_emb halfvec;
  v_count int;
begin
  select s.* into v_src from public.exam_sources s where s.id = p_source for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-003 kaynak bulunamadı';
  end if;
  if not app.can_manage_course(v_src.course_id) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 maddeleri yalnız worker, dersin eğitmeni ya da admin yazar';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 300 then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-004 p_items 1–300 maddelik bir dizi olmalı';
  end if;
  select co.curriculum_id into v_cur from public.courses co where co.id = v_src.course_id;

  for v_it in select e.value from jsonb_array_elements(p_items) as e (value) loop
    if jsonb_typeof(v_it) <> 'object' or coalesce(v_it ->> 'item_no', '') !~ '^[0-9]{1,3}$' or (v_it ->> 'item_no')::int < 1 then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-004 madde numarası geçersiz: %s', left(v_it::text, 80));
    end if;
    v_no := (v_it ->> 'item_no')::int;
    if v_no = any(v_nos) then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-004 madde numarası yinelendi: %s', v_no);
    end if;
    v_nos := v_nos || v_no;
    v_kind := coalesce(nullif(v_it ->> 'kind', ''), 'other');
    if v_kind not in ('proof', 'calc', 'mc', 'other') then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-004 madde %s türü geçersiz: %s', v_no, v_kind);
    end if;
    if length(v_it ->> 'topic') > 120 or length(v_it ->> 'format') > 40 or length(v_it ->> 'trick') > 200
       or length(v_it ->> 'ocr_text') > 20000 then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-004 madde %s: konu/biçim/tuzak/metin çok uzun', v_no);
    end if;
    if (v_it -> 'difficulty') is not null and jsonb_typeof(v_it -> 'difficulty') <> 'null'
       and (jsonb_typeof(v_it -> 'difficulty') <> 'number' or (v_it ->> 'difficulty')::numeric not between 0 and 1) then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-004 madde %s zorluğu 0..1 olmalı', v_no);
    end if;
    if (v_it -> 'points') is not null and jsonb_typeof(v_it -> 'points') <> 'null'
       and (jsonb_typeof(v_it -> 'points') <> 'number' or (v_it ->> 'points')::numeric not between 0 and 999) then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-004 madde %s puanı 0..999 olmalı', v_no);
    end if;
    v_year := null;
    if nullif(v_it ->> 'year', '') is not null then
      if (v_it ->> 'year') !~ '^[0-9]{4}$' or (v_it ->> 'year')::int not between 1950 and 2100 then
        raise exception using errcode = 'P0001', message = format('OGR-STYLE-004 madde %s yılı geçersiz', v_no);
      end if;
      v_year := (v_it ->> 'year')::int;
    end if;
    v_term := nullif(v_it ->> 'term', '');
    if v_term is not null and v_term not in ('vize', 'final', 'but', 'deneme', 'osym', 'meb', 'diger') then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-004 madde %s türü (term) geçersiz: %s', v_no, v_term);
    end if;
    v_skill := nullif(v_it ->> 'skill_id', '');
    if jsonb_typeof(v_it -> 'skill_ids') not in ('array', 'null') then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-004 madde %s: skill_ids dizi olmalı', v_no);
    end if;
    v_skills := array(select distinct x.sid from jsonb_array_elements_text(coalesce(nullif(v_it -> 'skill_ids', 'null'::jsonb), '[]')) as x (sid)
                       order by x.sid);
    if v_skill is not null and not v_skill = any(v_skills) then
      v_skills := v_skills || v_skill;
    end if;
    if cardinality(v_skills) > 5 then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-004 madde %s: en çok 5 kazanım', v_no);
    end if;
    if cardinality(v_skills) > 0 then
      if v_cur is null then
        raise exception using errcode = 'P0001', message = format('OGR-STYLE-004 madde %s: dersin müfredatı yok, kazanım yazılamaz', v_no);
      end if;
      select string_agg(x.sid, ', ') into v_bad from unnest(v_skills) as x (sid)
       where not exists (select 1 from public.skills s where s.curriculum_id = v_cur and s.id = x.sid);
      if v_bad is not null then
        raise exception using errcode = 'P0001', message = format('OGR-CURR-001 madde %s: kazanım dersin müfredatında yok: %s', v_no, v_bad);
      end if;
    end if;
    v_style := nullif(v_it ->> 'style_id', '')::uuid;
    if v_style is not null and not exists (select 1 from public.question_styles qs where qs.id = v_style and qs.course_id = v_src.course_id) then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-005 madde %s: tarz bu dersin değil', v_no);
    end if;
    v_emb := app.jsonb_halfvec(v_it -> 'embedding', format('madde %s', v_no));

    insert into public.exam_items as ei (source_id, item_no, topic, kind, format, trick, difficulty, points, curriculum_id, skill_id,
                                         skill_ids, ocr_text, embedding, style_id, year, term)
    values (p_source, v_no, nullif(btrim(v_it ->> 'topic'), ''), v_kind, nullif(btrim(v_it ->> 'format'), ''),
            nullif(btrim(v_it ->> 'trick'), ''), (v_it ->> 'difficulty')::numeric, (v_it ->> 'points')::numeric,
            case when cardinality(v_skills) > 0 then v_cur end, coalesce(v_skill, v_skills[1]), v_skills,
            nullif(v_it ->> 'ocr_text', ''), v_emb, v_style, v_year, v_term)
    on conflict (source_id, item_no) do update
      set topic = excluded.topic, kind = excluded.kind, format = excluded.format, trick = excluded.trick,
          difficulty = excluded.difficulty, points = excluded.points, curriculum_id = excluded.curriculum_id,
          skill_id = excluded.skill_id, skill_ids = excluded.skill_ids, ocr_text = excluded.ocr_text,
          -- gömme ve tarz gönderilmezse korunur (gömme ve kümeleme ayrı adımlar olabilir)
          embedding = case when v_it ? 'embedding' then excluded.embedding else ei.embedding end,
          style_id = case when v_it ? 'style_id' then excluded.style_id else ei.style_id end,
          year = excluded.year, term = excluded.term;
  end loop;

  delete from public.exam_items ei where ei.source_id = p_source and ei.item_no <> all(v_nos);
  select count(*) into v_count from public.exam_items ei where ei.source_id = p_source;
  update public.exam_sources s set status = 'ocr_done', error = null where s.id = p_source and s.status in ('uploaded', 'failed');
  update public.uploads u set status = 'ready' where u.id = any(v_src.upload_ids) and u.status = 'processing';
  return jsonb_build_object('source_id', p_source, 'item_count', v_count,
                            'items', (select coalesce(jsonb_agg(jsonb_build_object('item_no', ei.item_no, 'id', ei.id) order by ei.item_no), '[]'::jsonb)
                                        from public.exam_items ei where ei.source_id = p_source));
end
$$;
comment on function public.register_exam_items(uuid, jsonb) is 'Worker/eğitmen: kaynağın tam madde kümesi (exam-item v2; listede olmayan silinir; gömme/tarz gönderilmezse korunur); kaynak ocr_done; {source_id, item_count, items}.';

-- --- upsert_question_styles ----------------------------------------------------------------------------------------------

create or replace function public.upsert_question_styles(p_course uuid, p_styles jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_cur uuid;
  v_worker boolean := app.is_trusted();
  v_st jsonb;
  v_code text;
  v_codes text[] := '{}';
  v_row public.question_styles%rowtype;
  v_name text;
  v_desc text;
  v_format text;
  v_trick text;
  v_band text;
  v_status text;
  v_skills text[];
  v_items uuid[];
  v_ex uuid[];
  v_emb halfvec;
  v_id uuid;
  v_created boolean;
  v_n int;
  v_out jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.courses co where co.id = p_course) then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-001 ders bulunamadı';
  end if;
  if not app.can_manage_course(p_course) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 tarzları yalnız worker, dersin eğitmeni ya da admin yazar';
  end if;
  if jsonb_typeof(p_styles) is distinct from 'array' or jsonb_array_length(p_styles) not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-007 p_styles 1–100 tarzlık bir dizi olmalı';
  end if;
  select co.curriculum_id into v_cur from public.courses co where co.id = p_course;

  for v_st in select e.value from jsonb_array_elements(p_styles) as e (value) loop
    v_code := btrim(coalesce(v_st ->> 'code', ''));
    if jsonb_typeof(v_st) <> 'object' or v_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,59}$' then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-007 tarz kodu geçersiz: %s', left(coalesce(v_st ->> 'code', v_st::text), 60));
    end if;
    if v_code = any(v_codes) then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-007 tarz kodu yinelendi: %s', v_code);
    end if;
    v_codes := v_codes || v_code;
    v_name := nullif(btrim(v_st ->> 'name'), '');
    v_desc := nullif(btrim(v_st ->> 'description'), '');
    v_format := nullif(btrim(v_st ->> 'format'), '');
    v_trick := nullif(btrim(v_st ->> 'trick'), '');
    v_band := nullif(v_st ->> 'difficulty_band', '');
    v_band := case when v_band = 'medium' then 'mid' else v_band end;  -- sözleşme (style-definition) 'medium' der
    v_status := nullif(v_st ->> 'status', '');
    if (v_name is not null and length(v_name) not between 3 and 80) or length(v_desc) > 500 or length(v_format) > 40
       or length(v_trick) > 200 then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-007 %s: ad 3–80, tanım ≤ 500, biçim ≤ 40, tuzak ≤ 200 karakter', v_code);
    end if;
    if v_band is not null and v_band not in ('easy', 'mid', 'hard') then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-007 %s: zorluk bandı easy | medium | hard', v_code);
    end if;
    if v_status is not null and v_status not in ('draft', 'active', 'retired') then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-007 %s: durum draft | active | retired', v_code);
    end if;
    if v_worker and v_status = 'active' then
      v_status := null;  -- worker tarzı etkinleştirmez: adı ve tanımı eğitmen onaylar
    end if;
    v_skills := case when jsonb_typeof(v_st -> 'skill_ids') = 'array'
                     then array(select distinct x.sid from jsonb_array_elements_text(v_st -> 'skill_ids') as x (sid) order by x.sid) end;
    if cardinality(v_skills) > 5 then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-007 %s: en çok 5 kazanım', v_code);
    end if;
    begin
      v_items := case when jsonb_typeof(v_st -> 'item_ids') = 'array'
                      then array(select x.u::uuid from jsonb_array_elements_text(v_st -> 'item_ids') with ordinality as x (u, n)
                                  group by x.u order by min(x.n)) end;
      v_ex := case when jsonb_typeof(v_st -> 'exemplar_item_ids') = 'array'
                   then array(select x.u::uuid from jsonb_array_elements_text(v_st -> 'exemplar_item_ids') with ordinality as x (u, n) order by x.n) end;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-007 %s: madde kimliği uuid olmalı', v_code);
    end;
    if cardinality(v_ex) > 10 then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-007 %s: en çok 10 örnek madde', v_code);
    end if;
    select count(*) into v_n
      from public.exam_items ei join public.exam_sources s on s.id = ei.source_id
     where s.course_id = p_course and (ei.id = any(coalesce(v_items, '{}')) or ei.id = any(coalesce(v_ex, '{}')));
    if v_n <> (select count(distinct x.u) from unnest(coalesce(v_items, '{}') || coalesce(v_ex, '{}')) as x (u)) then
      raise exception using errcode = 'P0001', message = format('OGR-STYLE-005 %s: madde bu dersin arşivinde değil', v_code);
    end if;
    v_emb := app.jsonb_halfvec(v_st -> 'embedding', v_code);

    select qs.* into v_row from public.question_styles qs where qs.course_id = p_course and qs.code = v_code for update;
    v_created := not found;
    if v_created then
      if v_name is null then
        raise exception using errcode = 'P0001', message = format('OGR-STYLE-007 %s: yeni tarz ad ister', v_code);
      end if;
      insert into public.question_styles (course_id, curriculum_id, code, name, description, format, trick, difficulty_band, skill_ids,
                                          exemplar_item_ids, embedding, source, status, created_by, reviewed_by, reviewed_at)
      values (p_course, v_cur, v_code, v_name, v_desc, v_format, v_trick, v_band, coalesce(v_skills, '{}'),
              coalesce(v_ex, (coalesce(v_items, '{}'))[1:5]), v_emb,
              case when v_worker then 'extracted' else 'instructor' end,
              coalesce(v_status, case when v_worker then 'draft' else 'active' end),
              auth.uid(), case when not v_worker then auth.uid() end, case when not v_worker then now() end)
      returning id into v_id;
    elsif v_worker and v_row.reviewed_at is not null then
      -- eğitmenin onayladığı/düzenlediği tarz: worker yalnız örnekleri ve gömmeyi tazeler (maddeler aşağıda atanır)
      update public.question_styles qs
         set exemplar_item_ids = coalesce(v_ex, qs.exemplar_item_ids),
             embedding = case when v_st ? 'embedding' then v_emb else qs.embedding end
       where qs.id = v_row.id;
      v_id := v_row.id;
    else
      update public.question_styles qs
         set name = coalesce(v_name, qs.name),
             description = case when v_st ? 'description' then v_desc else qs.description end,
             format = case when v_st ? 'format' then v_format else qs.format end,
             trick = case when v_st ? 'trick' then v_trick else qs.trick end,
             difficulty_band = case when v_st ? 'difficulty_band' then v_band else qs.difficulty_band end,
             skill_ids = coalesce(v_skills, qs.skill_ids),
             curriculum_id = coalesce(qs.curriculum_id, v_cur),
             exemplar_item_ids = coalesce(v_ex, case when cardinality(qs.exemplar_item_ids) = 0 then (coalesce(v_items, '{}'))[1:5] end,
                                          qs.exemplar_item_ids),
             embedding = case when v_st ? 'embedding' then v_emb else qs.embedding end,
             status = coalesce(v_status, case when not v_worker and qs.status = 'draft' then 'active' end, qs.status),
             reviewed_by = case when v_worker then qs.reviewed_by else auth.uid() end,
             reviewed_at = case when v_worker then qs.reviewed_at else now() end
       where qs.id = v_row.id;
      v_id := v_row.id;
    end if;
    if cardinality(v_items) > 0 then
      update public.exam_items ei set style_id = v_id where ei.id = any(v_items) and ei.style_id is distinct from v_id;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('code', v_code, 'id', v_id, 'created', v_created));
  end loop;

  if v_worker then
    update public.exam_sources s set status = 'clustered' where s.course_id = p_course and s.status = 'ocr_done';
    -- yeniden kümelemede maddesini kaybeden taslak: eğitmen bakmadı, hiçbir soru/analiz/kapsama bağlı değil → silinir
    -- (yoksa kütüphanede 0/N yıllı "Adlandırma bekliyor" kartları kalır, eğitmen de emekli edemez)
    delete from public.question_styles qs
     where qs.course_id = p_course and qs.status = 'draft' and qs.reviewed_at is null
       and not (qs.code = any(v_codes))
       and not exists (select 1 from public.exam_items ei where ei.style_id = qs.id)
       and not exists (select 1 from public.exam_questions eq where eq.style_id = qs.id)
       and not exists (select 1 from public.questions q where q.style_id = qs.id)
       and not exists (select 1 from public.solution_analyses sa where sa.style_id = qs.id)
       and not exists (select 1 from public.style_coverage sc where sc.style_id = qs.id);
  end if;
  perform app.refresh_style_scores(p_course);
  perform app.audit_event('style.upsert', 'public.question_styles', p_course::text,
                          jsonb_build_object('course_id', p_course, 'styles', v_out, 'worker', v_worker));
  return jsonb_build_object('course_id', p_course, 'styles', v_out);
end
$$;
comment on function public.upsert_question_styles(uuid, jsonb) is 'Worker/eğitmen: tarzları (course_id, code) ile yazar, item_ids maddelerini tarza atar, örnek maddeleri belirler; worker eğitmenin onayladığı tarzın adını/tanımını ezmez ve tarzı etkinleştirmez; skorları tazeler.';

-- --- merge_styles --------------------------------------------------------------------------------------------------------

create or replace function public.merge_styles(p_keep uuid, p_merge uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_keep public.question_styles%rowtype;
  v_merge public.question_styles%rowtype;
  v_items int;
  v_eq int;
  v_sa int;
  v_q int;
  v_enr uuid;
  v_moved_cov uuid[];
begin
  select qs.* into v_keep from public.question_styles qs where qs.id = p_keep for update;
  select qs.* into v_merge from public.question_styles qs where qs.id = p_merge for update;
  if v_keep.id is null or v_merge.id is null then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-008 tarz bulunamadı';
  end if;
  if not app.can_manage_course(v_keep.course_id) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 tarzları yalnız dersin eğitmeni, admin ya da worker birleştirir';
  end if;
  if p_keep = p_merge or v_keep.course_id <> v_merge.course_id then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-008 aynı dersin iki farklı tarzı birleştirilir';
  end if;
  if v_keep.status = 'retired' then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-008 emekli tarz birleştirilmez; önce etkinleştir ya da başka bir tarz seç';
  end if;

  -- kaynağı olmayan (içe aktarılmış) kapsama satırları: tetikleyiciler yeniden hesaplayamaz, toplanarak taşınır
  for v_enr in
    select sc.enrollment_id from public.style_coverage sc
     where sc.style_id = p_merge and (app.style_coverage_counts(sc.enrollment_id, p_merge) ->> 'seen')::int = 0
  loop
    insert into public.style_coverage as sc (enrollment_id, style_id, seen_count, solved_count, correct_count, last_seen_at)
    select m.enrollment_id, p_keep, m.seen_count, m.solved_count, m.correct_count, m.last_seen_at
      from public.style_coverage m where m.enrollment_id = v_enr and m.style_id = p_merge
    on conflict (enrollment_id, style_id) do update
      set seen_count = sc.seen_count + excluded.seen_count, solved_count = sc.solved_count + excluded.solved_count,
          correct_count = sc.correct_count + excluded.correct_count,
          last_seen_at = greatest(sc.last_seen_at, excluded.last_seen_at);
    v_moved_cov := coalesce(v_moved_cov, '{}') || v_enr;
  end loop;

  update public.exam_items ei set style_id = p_keep where ei.style_id = p_merge;
  get diagnostics v_items = row_count;
  update public.exam_questions q set style_id = p_keep where q.style_id = p_merge;
  get diagnostics v_eq = row_count;
  update public.solution_analyses sa set style_id = p_keep where sa.style_id = p_merge;
  get diagnostics v_sa = row_count;
  update public.questions q set style_id = p_keep where q.style_id = p_merge;
  get diagnostics v_q = row_count;

  update public.question_styles qs
     set years_hit = array(select distinct x.y from unnest(qs.years_hit || v_merge.years_hit) as x (y) order by x.y),
         exemplar_item_ids = (array(select x.u from unnest(qs.exemplar_item_ids || v_merge.exemplar_item_ids) with ordinality as x (u, n)
                                     group by x.u order by min(x.n)))[1:10],
         skill_ids = (array(select distinct x.sid from unnest(qs.skill_ids || v_merge.skill_ids) as x (sid) order by x.sid))[1:5],
         description = coalesce(qs.description, v_merge.description),
         trick = coalesce(qs.trick, v_merge.trick),
         -- etkin tarzın soruları taşınınca öğrencinin gördüğü tarz kaybolmaz
         status = case when v_merge.status = 'active' and qs.status <> 'active' then 'active' else qs.status end,
         reviewed_by = case when app.is_trusted() then qs.reviewed_by else auth.uid() end,
         reviewed_at = case when app.is_trusted() then qs.reviewed_at else now() end
   where qs.id = p_keep;
  delete from public.question_styles qs where qs.id = p_merge;
  perform app.refresh_style_scores(v_keep.course_id);
  perform app.audit_event('style.merge', 'public.question_styles', p_keep::text,
                          jsonb_build_object('keep', p_keep, 'merged', p_merge, 'merged_code', v_merge.code, 'exam_items', v_items,
                                             'exam_questions', v_eq, 'solution_analyses', v_sa, 'questions', v_q));
  return jsonb_build_object('keep', p_keep, 'merged', p_merge,
                            'moved', jsonb_build_object('exam_items', v_items, 'exam_questions', v_eq, 'solution_analyses', v_sa,
                                                        'questions', v_q, 'imported_coverage', coalesce(cardinality(v_moved_cov), 0)));
end
$$;
comment on function public.merge_styles(uuid, uuid) is 'Eğitmen/worker: p_merge tarzını p_keep''e katar (maddeler, sınav soruları, teşhisler, üretilmiş sorular taşınır; kapsama yeniden hesaplanır; yıllar/örnekler/kazanımlar birleşir) ve p_merge''ü siler.';

-- --- style_library_view --------------------------------------------------------------------------------------------------

create or replace function public.style_library_view(p_course uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_co public.courses%rowtype;
  v_student uuid := app.my_student_id();
  v_enr uuid;
  v_archive jsonb;
  v_plan jsonb;
  v_styles jsonb;
  v_skill_names jsonb;
begin
  select co.* into v_co from public.courses co where co.id = p_course;
  if v_co.id is null then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-001 ders bulunamadı';
  end if;
  select coalesce(jsonb_object_agg(sk.id, sk.name), '{}'::jsonb) into v_skill_names
    from public.skills sk where sk.curriculum_id = v_co.curriculum_id;

  -- personel dalı: dersin arşivini okuyabilen (worker, admin, dersin eğitmeni, derse kayıtlı öğrenciye bağlı eğitmen)
  if app.can_read_course_archive(p_course) then
    select jsonb_build_object('years_from', min(coalesce(ei.year, s.year)), 'years_to', max(coalesce(ei.year, s.year)),
                              'years_total', count(distinct coalesce(ei.year, s.year)), 'sources', count(distinct s.id),
                              'items', count(ei.id), 'styled_items', count(ei.id) filter (where ei.style_id is not null),
                              'pending_sources', (select count(*) from public.exam_sources ps
                                                   where ps.course_id = p_course and ps.status in ('uploaded', 'ocr_done')),
                              -- son worker kümelemesi (upsert_question_styles denetim izi); updated_at skor tazelemesi
                              -- ve eğitmen düzenlemesiyle de oynar, bu yüzden kullanılmaz
                              'last_clustered_at', (select max(ae.created_at) from audit.events ae
                                                     where ae.row_id = p_course::text and ae.action = 'style.upsert'
                                                       and ae.diff ->> 'worker' = 'true'))
      into v_archive
      from public.exam_sources s left join public.exam_items ei on ei.source_id = s.id
     where s.course_id = p_course and s.status <> 'failed';
    select jsonb_build_object('id', p.id, 'status', p.status, 'period', p.period, 'created_at', p.created_at,
                              'approved_at', p.approved_at, 'plan', p.plan)
      into v_plan
      from public.exam_priority_plans p where p.course_id = p_course order by p.created_at desc, p.id limit 1;
    select coalesce(jsonb_agg(z.j order by z.score desc nulls last, z.name, z.id), '[]'::jsonb) into v_styles
      from (
        select qs.id, qs.name, qs.priority_score as score,
               jsonb_build_object(
                 'id', qs.id, 'code', qs.code, 'name', qs.name, 'description', qs.description, 'format', qs.format,
                 'trick', qs.trick, 'difficulty_band', qs.difficulty_band, 'status', qs.status, 'source', qs.source,
                 'reviewed_at', qs.reviewed_at,
                 'skills', (select coalesce(jsonb_agg(jsonb_build_object('id', x.sid, 'name', v_skill_names ->> x.sid) order by x.n), '[]'::jsonb)
                              from unnest(qs.skill_ids) with ordinality as x (sid, n)),
                 'years_hit', to_jsonb(qs.years_hit), 'years_total', qs.years_total,
                 'last_year', (select max(y.y) from unnest(qs.years_hit) as y (y)),
                 'frequency', qs.frequency_score, 'recency', qs.recency_score, 'alignment', qs.syllabus_score,
                 'score', qs.priority_score, 'exemplar_item_ids', to_jsonb(qs.exemplar_item_ids),
                 -- çıktığı sınavlar: yıl, tür, madde no (metin yok)
                 'appearances', (select coalesce(jsonb_agg(jsonb_build_object('item_id', ei.id, 'source_id', s.id,
                                                                              'year', coalesce(ei.year, s.year),
                                                                              'term', coalesce(ei.term, s.term), 'item_no', ei.item_no)
                                                           order by coalesce(ei.year, s.year) desc, ei.item_no), '[]'::jsonb)
                                   from public.exam_items ei join public.exam_sources s on s.id = ei.source_id
                                  where ei.style_id = qs.id and s.course_id = p_course),
                 -- öğrenci kapsaması: çağıranın okuyabildiği etkin kayıtlar
                 'coverage', (select jsonb_build_object(
                                       'students_total', count(*), 'students_solved', count(*) filter (where coalesce(sc.solved_count, 0) > 0),
                                       'solved', coalesce(sum(sc.solved_count), 0), 'correct', coalesce(sum(sc.correct_count), 0),
                                       'unsolved', coalesce(jsonb_agg(jsonb_build_object('enrollment_id', e.id, 'display_name', pr.display_name)
                                                                      order by pr.display_name, e.id)
                                                              filter (where coalesce(sc.solved_count, 0) = 0), '[]'::jsonb))
                                from public.enrollments e
                                join public.students st on st.id = e.student_id
                                left join public.profiles pr on pr.id = st.profile_id
                                left join public.style_coverage sc on sc.enrollment_id = e.id and sc.style_id = qs.id
                               where e.course_id = p_course and e.status = 'active'
                                 and (app.is_trusted() or app.can_read_student_data(e.student_id))))
                 as j
          from public.question_styles qs
         where qs.course_id = p_course
      ) as z;
    return jsonb_build_object('role', 'staff', 'can_manage', app.can_manage_course(p_course),
                              'course', jsonb_build_object('id', v_co.id, 'code', v_co.code, 'title', v_co.title),
                              'archive', v_archive, 'plan', v_plan, 'styles', v_styles);
  end if;

  -- öğrenci dalı: etkin tarzların adı, tanımı, sıklık bandı ve kendi kapsaması; örnek madde, yıl, kaynak yok
  if v_student is null or not app.can_read_course(p_course) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 tarz kütüphanesini yalnız dersin öğrencisi ve eğitmeni görür';
  end if;
  select e.id into v_enr from public.enrollments e
   where e.student_id = v_student and e.course_id = p_course
   order by (e.status = 'active') desc, e.created_at desc, e.id limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', qs.id, 'code', qs.code, 'name', qs.name, 'description', qs.description, 'format', qs.format,
           'trick', qs.trick, 'difficulty_band', qs.difficulty_band,
           'skills', (select coalesce(jsonb_agg(jsonb_build_object('id', x.sid, 'name', v_skill_names ->> x.sid) order by x.n), '[]'::jsonb)
                        from unnest(qs.skill_ids) with ordinality as x (sid, n)),
           'frequency_band', app.style_frequency_band(qs.frequency_score),
           'coverage', jsonb_build_object('seen', coalesce(sc.seen_count, 0), 'solved', coalesce(sc.solved_count, 0),
                                          'correct', coalesce(sc.correct_count, 0), 'last_seen_at', sc.last_seen_at,
                                          'text', app.style_coverage_text(sc.seen_count, sc.solved_count, sc.correct_count)))
           order by qs.priority_score desc nulls last, qs.frequency_score desc nulls last, qs.name, qs.id), '[]'::jsonb)
    into v_styles
    from public.question_styles qs
    left join public.style_coverage sc on sc.style_id = qs.id and sc.enrollment_id = v_enr
   where qs.course_id = p_course and qs.status = 'active' and app.style_has_practice(qs.id, qs.years_hit);
  return jsonb_build_object('role', 'student', 'can_manage', false,
                            'course', jsonb_build_object('id', v_co.id, 'code', v_co.code, 'title', v_co.title),
                            'enrollment_id', v_enr, 'styles', v_styles);
end
$$;
comment on function public.style_library_view(uuid) is 'Tarz kütüphanesi: personel (arşivi okuyabilen) için arşiv özeti, tarzlar (skorlar, yıllar, çıktığı sınavlar, öğrenci kapsaması) ve son plan; öğrenci için etkin tarzların adı/tanımı/sıklık bandı ve kendi kapsaması; çıkmış soru metni hiçbir dalda yok; veli OGR-AUTH-001.';

-- --- student_style_coverage ----------------------------------------------------------------------------------------------

create or replace function public.student_style_coverage(p_enrollment uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_enr public.enrollments%rowtype;
  v_styles jsonb;
begin
  select e.* into v_enr from public.enrollments e where e.id = p_enrollment;
  if v_enr.id is null then
    raise exception using errcode = 'P0001', message = 'OGR-STYLE-009 kayıt bulunamadı';
  end if;
  if not (app.is_trusted() or app.can_read_enrollment(p_enrollment, false)) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu kaydın kapsamasını yalnız öğrenci, bağlı eğitmen ya da admin görür';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'style_id', qs.id, 'code', qs.code, 'name', qs.name, 'description', qs.description,
           'frequency_band', app.style_frequency_band(qs.frequency_score),
           'seen', coalesce(sc.seen_count, 0), 'solved', coalesce(sc.solved_count, 0), 'correct', coalesce(sc.correct_count, 0),
           'last_seen_at', sc.last_seen_at, 'text', app.style_coverage_text(sc.seen_count, sc.solved_count, sc.correct_count))
           order by qs.priority_score desc nulls last, qs.frequency_score desc nulls last, qs.name, qs.id), '[]'::jsonb)
    into v_styles
    from public.question_styles qs
    left join public.style_coverage sc on sc.style_id = qs.id and sc.enrollment_id = p_enrollment
   where qs.course_id = v_enr.course_id and qs.status = 'active' and app.style_has_practice(qs.id, qs.years_hit);
  return jsonb_build_object(
    'enrollment_id', p_enrollment, 'course_id', v_enr.course_id, 'styles', v_styles,
    'summary', jsonb_build_object('styles', jsonb_array_length(v_styles),
                                  'never_solved', (select count(*) from jsonb_array_elements(v_styles) as x (s) where (x.s ->> 'solved')::int = 0),
                                  'solved', (select coalesce(sum((x.s ->> 'solved')::int), 0) from jsonb_array_elements(v_styles) as x (s)),
                                  'correct', (select coalesce(sum((x.s ->> 'correct')::int), 0) from jsonb_array_elements(v_styles) as x (s))));
end
$$;
comment on function public.student_style_coverage(uuid) is 'Öğrenci/bağlı eğitmen/admin/worker: kaydın dersindeki etkin tarzlar + kapsama (seen, solved, correct, "3 çözdün, 1 doğru"); veli göremez.';

-- --- yetkiler ------------------------------------------------------------------------------------------------------------

revoke all on function app.jsonb_halfvec(jsonb, text), app.style_frequency_band(numeric), app.style_coverage_text(int, int, int),
  app.refresh_style_scores(uuid), app.style_has_practice(uuid, smallint[]) from public, anon;
grant execute on function app.style_has_practice(uuid, smallint[]) to authenticated, service_role;
grant execute on function app.style_frequency_band(numeric), app.style_coverage_text(int, int, int) to authenticated, service_role;
grant execute on function app.refresh_style_scores(uuid) to service_role;

revoke all on function public.ingest_exam_source(uuid, jsonb, uuid[]), public.register_exam_items(uuid, jsonb),
  public.upsert_question_styles(uuid, jsonb), public.merge_styles(uuid, uuid), public.style_library_view(uuid),
  public.student_style_coverage(uuid) from public, anon;
-- hepsi authenticated'a açıktır; gövdeler yetkiyi denetler (app.can_manage_course / can_read_course_archive / kayıt)
grant execute on function public.ingest_exam_source(uuid, jsonb, uuid[]), public.register_exam_items(uuid, jsonb),
  public.upsert_question_styles(uuid, jsonb), public.merge_styles(uuid, uuid), public.style_library_view(uuid),
  public.student_style_coverage(uuid) to authenticated, service_role;
