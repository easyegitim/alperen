-- 0011_mastery.sql — ustalık güncellemesi (BKT, ADR-0001; BLUEPRINT §3.7). packages/mastery-math/sql/bkt.sql
-- aşağıdaki işaretler arasına BİREBİR kopyalanır (M13 check-all.sh diff ile sapmayı yakalar). Ustalığı yazan tek
-- yer public.apply_observation()'dır; diğer fonksiyonlar gözlem ekleyip onu çağırır.

-- begin bkt
-- Öğrenmen ustalık matematiği (BKT) — tek kaynak: packages/mastery-math.
-- Bu dosya supabase/migrations/0011_mastery.sql içine, "begin bkt" ve
-- "end bkt" yorum işaretleri arasına birebir kopyalanır; sapma CI'da yakalanır.
-- TS (src/bkt.ts) ve Python (ogrenmen_mastery/bkt.py) aynı formülü uygular;
-- fixtures/bkt-vectors.json üç dilde 1e-9 toleransla aynı sonucu verir.

-- İkili gözlem adımı: doğru/yanlış gözlemden sonra bilme olasılığı.
-- p: önsel, g: bilmeden doğru (guess), s: bilip yanlış (slip),
-- t: fırsat başına öğrenme (learn). Sonuç [0.01, 0.99] aralığına kırpılır.
-- Payda sıfırsa NULL döner (greatest/least NULL'ı yok saydığı için açıkça
-- denetlenir); apply_observation'da mastery.p not null kısıtı yazımı düşürür.
create or replace function app.bkt_step(
    p numeric, correct boolean, g numeric, s numeric, t numeric
)
returns numeric
language sql
immutable
as $$
  with obs as (
    select
      case
        when correct then (p * (1 - s)) / nullif(p * (1 - s) + (1 - p) * g, 0)
        else (p * s) / nullif(p * s + (1 - p) * (1 - g), 0)
      end as p_obs
  )

  select
    case
      when obs.p_obs is null then null
      else least(0.99, greatest(0.01, obs.p_obs + (1 - obs.p_obs) * t))
    end
  from obs
$$;

comment on function app.bkt_step(numeric, boolean, numeric, numeric, numeric)
is 'BKT ikili gözlem adımı; sonuç [0.01, 0.99] aralığında (BLUEPRINT §3.7).';

-- Sürekli gözlem (ders analizi, eğitmen tahmini): p + w·(m − p), w = 0.30·c.
-- c (güven) boşsa 0.8 kabul edilir; öğrenme geçişi uygulanmaz.
-- p ya da m boşsa NULL döner (sessizce 0.01'e kırpılmaz).
create or replace function app.blend_step(p numeric, m numeric, c numeric)
returns numeric
language sql
immutable
as $$
  select
    case
      when p is null or m is null then null
      else least(0.99, greatest(0.01, p + (0.30 * coalesce(c, 0.8)) * (m - p)))
    end
$$;

comment on function app.blend_step(numeric, numeric, numeric)
is 'Sürekli gözlem karışımı: p + 0.30·c·(m − p), c boşsa 0.8; [0.01, 0.99].';

-- Çıkarım gözlemi için yumuşatılmış tahmin olasılığı: g' = g + (1 − g)(1 − w).
create or replace function app.inferred_guess(g numeric, w numeric)
returns numeric
language sql
immutable
as $$
  select g + (1 - g) * (1 - w)
$$;

comment on function app.inferred_guess(numeric, numeric)
is 'Ön koşul çıkarımında kullanılan yumuşatılmış g: g + (1 − g)(1 − w).';
-- end bkt

revoke all on function app.bkt_step(numeric, boolean, numeric, numeric, numeric) from public;
revoke all on function app.blend_step(numeric, numeric, numeric) from public;
revoke all on function app.inferred_guess(numeric, numeric) from public;

-- Sayısal cevap ayrıştırma: a/b kesri (isteğe bağlı baştaki -), ondalık (virgül ya da nokta), tam sayı; boşluklar
-- atılır. sqrt, ^, π gibi ifadeler ayrıştırılmaz → null (bu anahtarlar mcq ile sorulur). SymPy kullanılmaz.
create or replace function app.parse_number(p_text text) returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_s text := regexp_replace(coalesce(p_text, ''), '\s+', '', 'g');
  v_parts text[];
begin
  if v_s ~ '^-?[0-9]+/[0-9]+$' then
    v_parts := string_to_array(v_s, '/');
    if v_parts[2]::numeric = 0 then
      return null;
    end if;
    return v_parts[1]::numeric / v_parts[2]::numeric;
  elsif v_s ~ '^-?[0-9]+([.,][0-9]+)?$' then
    return replace(v_s, ',', '.')::numeric;
  end if;
  return null;
end
$$;
comment on function app.parse_number(text) is 'Kesir (a/b), ondalık (3,5 = 3.5) ya da tam sayıyı numeric''e çevirir; ifade → null.';
revoke all on function app.parse_number(text) from public;

create or replace function app.numeric_equal(p_given text, p_key text, p_tol numeric) returns boolean
language plpgsql
immutable
set search_path = pg_catalog, app
as $$
declare
  v_a numeric := app.parse_number(p_given);
  v_b numeric := app.parse_number(p_key);
begin
  if v_a is null or v_b is null then
    return false;
  end if;
  return abs(v_a - v_b) <= coalesce(p_tol, 0);
end
$$;
comment on function app.numeric_equal(text, text, numeric) is 'İki sayısal cevabı ayrıştırıp |a−b| ≤ tolerans ile karşılaştırır; ayrıştırılamayan → false.';
revoke all on function app.numeric_equal(text, text, numeric) from public;

-- Anahtar biçimi: mcq için doğru şık, numeric için ayrıştırılabilir sayısal cevap. grade_attempt, register_answer_key,
-- set_answer_key ve app.questions_approve_guard aynı kuralı kullanır (null şık "her cevap doğru" sayılmaz).
create or replace function app.answer_key_complete(p_kind text, p_correct_option text, p_numeric_value text) returns boolean
language sql
immutable
set search_path = pg_catalog, app
as $$
  select case p_kind
           when 'mcq' then p_correct_option is not null and p_correct_option in ('A', 'B', 'C', 'D')
           when 'numeric' then app.parse_number(p_numeric_value) is not null
           else false
         end
$$;
comment on function app.answer_key_complete(text, text, text) is 'Anahtar soru türüne göre eksiksiz mi: mcq → doğru şık, numeric → ayrıştırılabilir sayı.';
revoke all on function app.answer_key_complete(text, text, text) from public;

-- Ön koşul ipucu: kazanımda p < 0.4 ∧ n ≥ 5 ve ön koşulunda p < 0.5 ∧ n ≥ 5 → öneri metni (teşhis değil)
create or replace function app.infer_prereq_gap(p_enrollment uuid, p_skill text) returns text
language sql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
  select 'Asıl sorun alt konuda olabilir: ' || s.name
    from public.mastery as m
    join public.skill_prerequisites as sp on sp.skill_id = m.skill_id and sp.curriculum_id = m.curriculum_id
    join public.mastery as pm on pm.enrollment_id = m.enrollment_id and pm.skill_id = sp.prereq_id
    join public.skills as s on s.id = sp.prereq_id and s.curriculum_id = sp.curriculum_id
   where m.enrollment_id = p_enrollment
     and m.skill_id = p_skill
     and m.p < 0.4 and m.evidence_count >= 5
     and pm.p < 0.5 and pm.evidence_count >= 5
   order by pm.p
   limit 1
$$;
comment on function app.infer_prereq_gap(uuid, text) is 'Zayıf kazanımın zayıf ön koşulunu "Asıl sorun alt konuda olabilir: <ad>" olarak döner; yoksa null.';
revoke all on function app.infer_prereq_gap(uuid, text) from public;

-- Gözlemi ustalığa uygular (tek yazan). Sohbet gözlemleri p ve kanıt sayısını değiştirmez ama yanılgı sayacına
-- katılır; çıkarım gözlemi kanıt sayısını artırmaz; ön koşul çıkarımı tek seviye ve döngüsüzdür.
create or replace function public.apply_observation(p_obs bigint) returns void
language plpgsql
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_o public.observations%rowtype;
  v_sk public.skills%rowtype;
  v_p0 numeric;
  v_p1 numeric;
  v_inc int;
  v_mth text;
  v_prm jsonb;
  v_g numeric;
  v_tag_skill text;
  v_tag_ti text;
  v_tag_ts text;
  v_mc uuid;
  v_open_min int;
  v_child bigint;
  v_reopened boolean := false;
begin
  select o.* into v_o from public.observations o where o.id = p_obs for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-MAST-003 gözlem yok %s', p_obs);
  end if;
  if v_o.applied_at is not null then
    return;
  end if;
  select s.* into v_sk from public.skills s where s.id = v_o.skill_id and s.curriculum_id = v_o.curriculum_id;
  if not found or not v_sk.is_leaf then
    raise exception using errcode = 'P0001', message = format('OGR-MAST-002 yaprak olmayan kazanım %s', v_o.skill_id);
  end if;

  if v_o.kind not in ('chat_question', 'chat_misconception') then
    select m.p into v_p0 from public.mastery m where m.enrollment_id = v_o.enrollment_id and m.skill_id = v_o.skill_id for update;
    if not found then
      insert into public.mastery (enrollment_id, skill_id, p, evidence_count) values (v_o.enrollment_id, v_o.skill_id, v_sk.p_init, 0);
      v_p0 := v_sk.p_init;
    end if;
    if v_o.kind in ('diagnostic', 'practice', 'test', 'resolution') then
      v_g := coalesce(v_o.guess_override, v_sk.p_guess);
      v_p1 := app.bkt_step(v_p0, v_o.value >= 0.5, v_g, v_sk.p_slip, v_sk.p_learn);
      v_inc := case when v_o.counts_for_mastery then 1 else 0 end;
      v_mth := 'bkt';
      v_prm := jsonb_build_object('g', v_g, 's', v_sk.p_slip, 't', v_sk.p_learn, 'w', v_o.weight, 'guess_override', v_o.guess_override);
    elsif v_o.kind in ('lesson', 'instructor') then
      v_p1 := app.blend_step(v_p0, v_o.value, v_o.confidence);
      v_inc := 1;
      v_mth := 'blend';
      v_prm := jsonb_build_object('w', 0.30 * coalesce(v_o.confidence, 0.8), 'm', v_o.value);
    elsif v_o.kind = 'inferred' then
      v_g := app.inferred_guess(coalesce(v_o.guess_override, v_sk.p_guess), v_o.weight);
      v_p1 := app.bkt_step(v_p0, false, v_g, v_sk.p_slip, v_sk.p_learn);
      v_inc := 0;
      v_mth := 'inferred';
      v_prm := jsonb_build_object('g_eff', v_g, 's', v_sk.p_slip, 't', v_sk.p_learn, 'w', v_o.weight);
    else
      raise exception using errcode = 'P0001', message = format('OGR-MAST-001 bilinmeyen gözlem türü %s', v_o.kind);
    end if;
    if v_p1 is null then
      raise exception using errcode = 'P0001', message = format('OGR-MAST-004 ustalık hesaplanamadı (gözlem %s)', v_o.id);
    end if;
    insert into public.mastery_history (enrollment_id, skill_id, observation_id, p_before, p_after, method, params)
    values (v_o.enrollment_id, v_o.skill_id, v_o.id, v_p0, v_p1, v_mth, v_prm);
    update public.mastery m
       set p = v_p1,
           evidence_count = m.evidence_count + v_inc,
           last_observation_id = v_o.id,
           last_evidence_at = case when v_inc > 0 then now() else m.last_evidence_at end,
           updated_at = now()
     where m.enrollment_id = v_o.enrollment_id and m.skill_id = v_o.skill_id;
  end if;
  update public.observations o set applied_at = now() where o.id = p_obs;

  -- Yanılgı sayacı (etiketli; ikili yanlış, sohbet yanılgısı ya da ders): misconceptions + kanıt bağı
  if v_o.misconception_tag is not null and (v_o.value is null or v_o.value < 0.5) then
    select coalesce(t.skill_id, v_o.skill_id), t.text_instructor, t.text_student
      into v_tag_skill, v_tag_ti, v_tag_ts
      from public.misconception_tags t where t.tag = v_o.misconception_tag;
    select (st.value #>> '{}')::int into v_open_min from public.settings st where st.key = 'misconception_open_evidence';
    v_open_min := coalesce(v_open_min, 3);
    select mc.id into v_mc from public.misconceptions mc
     where mc.enrollment_id = v_o.enrollment_id and mc.skill_id = v_tag_skill and mc.tag = v_o.misconception_tag
       and mc.status in ('pending_review', 'open')
     limit 1;
    if v_mc is null then
      -- çözülmüş yanılgıda yeni kanıt: aynı satır yeniden incelemeye döner (yeni satır açılmaz)
      update public.misconceptions mc set status = 'pending_review'
       where mc.id = (select r.id from public.misconceptions r
                       where r.enrollment_id = v_o.enrollment_id and r.skill_id = v_tag_skill and r.tag = v_o.misconception_tag
                         and r.status = 'resolved'
                       order by r.resolved_at desc nulls last limit 1)
      returning mc.id into v_mc;
      v_reopened := v_mc is not null;
    end if;
    if v_mc is null then
      insert into public.misconceptions (enrollment_id, skill_id, tag, text_instructor, text_student, evidence_count, last_seen)
      values (v_o.enrollment_id, v_tag_skill, v_o.misconception_tag, v_tag_ti, v_tag_ts, 0, now())
      returning id into v_mc;
    end if;
    update public.misconceptions mc
       set evidence_count = mc.evidence_count + 1,
           last_seen = now(),
           status = case when v_reopened then 'pending_review'
                         when mc.status = 'pending_review' and mc.evidence_count + 1 >= v_open_min then 'open'
                         else mc.status end
     where mc.id = v_mc;
    insert into public.misconception_evidence (misconception_id, observation_id) values (v_mc, v_o.id) on conflict do nothing;

    -- Ön koşul çıkarımı: tek seviye (inferred gözlem yeniden çıkarım üretmez)
    if v_o.kind in ('diagnostic', 'practice', 'test') then
      for v_child in
        insert into public.observations (enrollment_id, skill_id, kind, value, weight, source_type, source_id, source_locator,
                                         misconception_tag, counts_for_mastery, created_by_role)
        select v_o.enrollment_id, t.prereq_skill_id, 'inferred', 0, 0.5, 'observation', v_o.id::text,
               v_o.source_locator || ' (ön koşul çıkarımı)', null, false, v_o.created_by_role
          from public.misconception_tags t
         where t.tag = v_o.misconception_tag and t.prereq_skill_id is not null and t.prereq_skill_id <> v_o.skill_id
        returning id
      loop
        perform public.apply_observation(v_child);
      end loop;
    end if;
  end if;
end
$$;
comment on function public.apply_observation(bigint) is 'Gözlemi ustalığa uygular (BKT/karışım/çıkarım), mastery_history yazar, yanılgı sayacını ve ön koşul çıkarımını işler.';
revoke all on function public.apply_observation(bigint) from public;
-- Doğrudan çağrı yok: grade_attempt, record_chat_observation, approve_lesson_analysis, add_instructor_note içinden çağrılır.
