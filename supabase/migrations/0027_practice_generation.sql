-- 0027_practice_generation.sql — ilk "Başla" çıkmazının kapanışı (README "Nerede kaldık", PLAN-v2 §13 "Test akışı").
--   1. Teşhis soruları ilk alıştırmada kullanılabilir: 0021 bitirilmemiş her teşhis/deneme/yayımlanmış sınavın
--      sorusunu dışlıyordu; TYT tohumunda onaylı 20 soru teşhisindir ve yeni öğrencinin bankası boş kalıyordu. Dışlama
--      app.practice_exam_blocks'ta toplanır: deneme/yayımlanmış sınav, kayıt bitirmedikçe yine dışlanır; teşhis sınavı
--      yalnız bu kayda ATANMIŞ ve bitmemişse dışlanır (atanmış = bu kaydın exam_sessions satırı var ya da öğrencinin
--      etkin bir önerisi payload.exam_id ile bu sınavı gösteriyor). Kayıt sınavı bir kez bitirdiyse soru serbesttir.
--      app.practice_fill_items bu yardımcıyı kullanacak biçimde yeniden tanımlanır.
--   2. 'practice.generate' / 'practice.prewarm' işlerinin (apps/worker) yazım yolu: public.register_practice_questions
--      soru bankasına şablon ya da LLM sorusu + gizli anahtar (secure.answer_keys) + şablon şekli yazar (yalnız worker;
--      content_hash ile tekrarsız), set verilmişse seti bankadan doldurup 'in_progress' yapar.
--      public.fail_practice_generation kalıcı üretim hatasında seti bekletmeden kapatır (summary.reason
--      'generation_failed'; practice_set_json generation_failed = true döner, istemci tek cümle + Bugün'e dön gösterir).
--      public.practice_bank_status worker'a hedef yaprakların kullanılabilir soru sayısını, şablonlarını ve
--      alıştırmanın açılıp açılamayacağını (otopilotsuz taslak: hayır) söyler.
-- Doğrulama işaretleri: şablon sorusu SymPy ile doğrulanmıştır (sympy_status 'verified'). LLM sorusunun anahtarı worker'da
-- SymPy ile denetlenir (apps/worker/py/key_verify.py: canonical_expr ↔ numeric_value ya da doğru şıkkın metni); tutmayan
-- madde bankaya hiç gelmez, tutan 'verified' yazılır. canonical_expr boş ya da ayrıştırılamıyorsa soru yine 'approved'
-- yazılır ama anahtar sympy_status 'not_applicable', sympy_report.status 'inferred' ve questions.verification.sympy
-- 'inferred' ile işaretlidir (eğitmen kuyruğu ve gece denetimi bu işaretle süzer).
--   3. Sertleştirme (P1 denetimi): (a) figures.code (şablon kimliği + kanonik parametreler: cevabı taşıyabilir),
--      code_hash, vision_report, render_log authenticated'a kapalı; personel tam satırı public.v_figures_staff ile okur.
--      (b) answer_practice_item: anahtarı 'inferred' sorunun gözlem ağırlığı settings.practice_inferred_key_weight (0.5).
--      (c) app.practice_fill_items teşhis sorularını yaprak içinde en sona koyar (banka yetmezse kullanılır; teşhis
--      sonradan atanırsa öğrenci soruları önceden görmemiş olsun); practice_bank_status.available teşhis sorularını
--      saymaz (ön ısıtma bankayı doldurdukça teşhis soruları alıştırmadan çekilir), diagnostic alanı ayrıca sayar.

-- Bu kayda atanmış ve bitmemiş sınavın sorusu mu (alıştırmaya girmez; anahtar alıştırmadan öğrenilmesin).
create or replace function app.practice_exam_blocks(p_enrollment uuid, p_question uuid) returns boolean
language sql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
  select exists (
    select 1
      from public.exam_questions as eq
      join public.exams as x on x.id = eq.exam_id
     where eq.question_id = p_question
       and x.kind in ('diagnostic', 'deneme', 'published')
       and not exists (select 1 from public.exam_sessions as es
                        where es.exam_id = x.id and es.enrollment_id = p_enrollment and es.finished_at is not null)
       and (x.kind <> 'diagnostic'
            or exists (select 1 from public.exam_sessions as es where es.exam_id = x.id and es.enrollment_id = p_enrollment)
            or exists (select 1 from public.suggestions as sg
                         join public.enrollments as e on e.id = p_enrollment and e.student_id = sg.student_id
                        where sg.consumed_at is null and (sg.expires_at is null or sg.expires_at > now())
                          and sg.payload ->> 'exam_id' = x.id::text)))
$$;
comment on function app.practice_exam_blocks(uuid, uuid) is 'Soru bu kayda atanmış ve bitmemiş bir sınavın mı: deneme/yayımlanmış bitirilmedikçe; teşhis yalnız atanmışsa (oturum ya da etkin öneri) ve bitirilmemişse.';

-- 0021'in set görünümü: generation_failed artık kalıcı üretim hatasını (reason 'generation_failed') da kapsar.
create or replace function app.practice_set_json(p_set uuid) returns jsonb
language sql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
  select jsonb_build_object(
           'set_id', ps.id, 'enrollment_id', ps.enrollment_id, 'suggestion_id', ps.suggestion_id, 'status', ps.status,
           'skill_ids', to_jsonb(ps.skill_ids), 'target_count', ps.target_count, 'started_at', ps.started_at,
           'finished_at', ps.finished_at, 'summary', ps.summary,
           'generation_failed', (ps.status = 'abandoned' and ps.summary ->> 'reason' in ('generation_timeout', 'generation_failed'))
                                or (ps.status = 'needs_generation' and ps.started_at
                                    <= now() - make_interval(secs => app.setting_num('practice_generation_timeout_s', 600)::double precision)),
           'total', (select count(*) from public.practice_set_items as i where i.set_id = ps.id),
           'answered', (select count(*) from public.practice_set_items as i where i.set_id = ps.id and i.attempt_id is not null),
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'no', i.no, 'question_id', q.id, 'kind', q.kind, 'stem', q.stem, 'stem_values', q.stem_values,
                      'options', case when jsonb_typeof(q.options) <> 'array' then q.options
                                      else (select jsonb_agg(o.opt - 'misconception_tag' order by o.ord)
                                              from jsonb_array_elements(q.options) with ordinality as o (opt, ord)) end,
                      'figure', case when f.id is not null then jsonb_build_object('id', f.id, 'png_path', f.png_path,
                                                                                    'svg_path', f.svg_path, 'alt_text', f.alt_text) end,
                      'skill_ids', to_jsonb(q.skill_ids), 'answered', i.attempt_id is not null, 'correct', a.is_correct)
                    order by i.no)
               from public.practice_set_items as i
               join public.questions as q on q.id = i.question_id
               left join public.figures as f on f.id = q.figure_id and f.review_status = 'verified'
               left join public.attempts as a on a.id = i.attempt_id
              where i.set_id = ps.id), '[]'::jsonb))
    from public.practice_sets as ps
   where ps.id = p_set
$$;
comment on function app.practice_set_json(uuid) is 'Alıştırma setinin istemci görünümü (sorular yanılgı etiketsiz, anahtarsız; generation_failed: üretim zaman aşımı); yetki denetimi çağırana aittir.';

-- 0021'in banka doldurucusu: sınav dışlaması app.practice_exam_blocks'a taşındı (teşhis yalnız atanmış ve bitmemişse).
create or replace function app.practice_fill_items(p_set uuid) returns int
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_ps public.practice_sets%rowtype;
  v_cur uuid;
  v_n int;
begin
  select ps.* into v_ps from public.practice_sets ps where ps.id = p_set;
  if not found or exists (select 1 from public.practice_set_items i where i.set_id = p_set) then
    return 0;
  end if;
  select e.curriculum_id into v_cur from public.enrollments e where e.id = v_ps.enrollment_id;
  insert into public.practice_set_items (set_id, no, question_id)
  select p_set, row_number() over (order by z.rn, z.sk, z.h), z.qid
    from (
      select r.qid, r.sk, r.rn, r.h
        from (
          select c.qid, c.sk, c.h,
                 row_number() over (partition by c.sk order by c.diag, c.seen, c.last_seen nulls first, c.h) as rn
            from (
              select q.id as qid,
                     (select x.sid from unnest(q.skill_ids) as x (sid) where x.sid = any(v_ps.skill_ids) order by x.sid limit 1) as sk,
                     md5(q.id::text || p_set::text) as h,
                     -- teşhis sorusu yaprağın sonuna: banka (şablon/LLM/eğitmen) yetmezse kullanılır
                     (exists (select 1 from public.exam_questions eq join public.exams x on x.id = eq.exam_id
                               where eq.question_id = q.id and x.kind = 'diagnostic'))::int as diag,
                     (select count(*) from public.attempts a where a.enrollment_id = v_ps.enrollment_id and a.question_id = q.id) as seen,
                     (select max(a.created_at) from public.attempts a where a.enrollment_id = v_ps.enrollment_id and a.question_id = q.id) as last_seen
                from public.questions q
                join secure.answer_keys k on k.question_id = q.id
               where q.curriculum_id = v_cur and q.status = 'approved' and q.skill_ids && v_ps.skill_ids
                 and app.answer_key_complete(q.kind, k.correct_option, k.numeric_value)
                 -- bu kayda atanmış ve bitmemiş sınavın sorusu alıştırmaya girmez (anahtar sızmaz; 0027)
                 and not app.practice_exam_blocks(v_ps.enrollment_id, q.id)
            ) as c
        ) as r
       order by r.rn, r.sk, r.h
       limit v_ps.target_count
    ) as z;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
comment on function app.practice_fill_items(uuid) is 'Sorusuz alıştırma setini onaylı + anahtarlı bankadan doldurur (atanmış ve bitmemiş sınav soruları hariç: app.practice_exam_blocks; teşhis soruları yaprakta en sona); eklenen sayıyı döner.';

-- Bir yaprağın bu kayıtta kullanılabilir soruları (onaylı, anahtarı tam, atanmış/bitmemiş sınavda değil) ve teşhis
-- sınavı sorusu olup olmadığı (practice_bank_status sayar).
create or replace function app.practice_usable_questions(p_enrollment uuid, p_curriculum uuid, p_skill text)
returns table (question_id uuid, diag boolean)
language sql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
  select q.id,
         exists (select 1 from public.exam_questions eq join public.exams x on x.id = eq.exam_id
                  where eq.question_id = q.id and x.kind = 'diagnostic')
    from public.questions q
    join secure.answer_keys k on k.question_id = q.id
   where q.curriculum_id = p_curriculum and q.status = 'approved' and p_skill = any(q.skill_ids)
     and app.answer_key_complete(q.kind, k.correct_option, k.numeric_value)
     and not app.practice_exam_blocks(p_enrollment, q.id)
$$;
comment on function app.practice_usable_questions(uuid, uuid, text) is 'Yaprağın bu kayıtta alıştırmaya girebilecek soruları ve teşhis sorusu mu (diag).';

-- Worker için hedef yaprakların bankası: p_skill_ids (yaprak ya da üst düğüm) ya da boşsa en zayıf iki yaprak
-- (app.practice_target_leaves). Döner: {enrollment_id, curriculum_id, curriculum_status, practicable, leaves:
-- [{skill_id, name, description, available, diagnostic, templates[]}]}. available: kullanılabilir teşhis dışı soru
-- (ön ısıtma bunu tamamlar); diagnostic: alıştırmada son çare kullanılabilir teşhis sorusu. practicable = false: müfredat otopilotsuz taslak
-- (start_practice OGR-PRAC-008 verir; ön ısıtma ücretli üretim yapmaz). Yalnız worker.
create or replace function public.practice_bank_status(p_enrollment uuid, p_skill_ids text[] default null) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_enr public.enrollments%rowtype;
  v_cur public.curricula%rowtype;
  v_leaves text[];
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 soru bankası durumunu yalnız worker okur';
  end if;
  select e.* into v_enr from public.enrollments e where e.id = p_enrollment;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-PRAC-001 kayıt bulunamadı %s', p_enrollment);
  end if;
  select c.* into v_cur from public.curricula c where c.id = v_enr.curriculum_id;
  v_leaves := coalesce(app.practice_target_leaves(v_enr.id, p_skill_ids), '{}');
  return jsonb_build_object(
    'enrollment_id', v_enr.id, 'curriculum_id', v_cur.id, 'curriculum_status', v_cur.status,
    'practicable', v_cur.status <> 'draft'
                   or coalesce((public.curriculum_autopilot_state(v_cur.id) ->> 'effective')::boolean, false),
    'leaves', coalesce((
      select jsonb_agg(jsonb_build_object(
               'skill_id', s.id, 'name', s.name, 'description', s.description,
               'available', (select count(*) filter (where not u.diag) from app.practice_usable_questions(v_enr.id, v_cur.id, s.id) as u),
               'diagnostic', (select count(*) filter (where u.diag) from app.practice_usable_questions(v_enr.id, v_cur.id, s.id) as u),
               'templates', coalesce((select jsonb_agg(qt.id order by qt.id) from public.question_templates qt
                                       where qt.curriculum_id = v_cur.id and qt.skill_id = s.id and qt.enabled), '[]'::jsonb))
             order by array_position(v_leaves, s.id))
        from public.skills s
       where s.curriculum_id = v_cur.id and s.id = any(v_leaves)), '[]'::jsonb));
end
$$;
comment on function public.practice_bank_status(uuid, text[]) is 'Worker: hedef yaprakların kullanılabilir onaylı soru sayısı (teşhis dışı available + teşhis diagnostic), şablonları ve alıştırmanın açılabilirliği (practicable).';

-- Soru bankasına alıştırma soruları yazar (yalnız worker: practice.generate / practice.prewarm). p_items en çok 40:
--   [{source: 'template' | 'llm', kind: 'mcq' | 'numeric', stem, stem_values?, options? [{key, text, misconception_tag?}],
--     skill_ids[] (müfredatın yaprakları; dışındakiler atılır, ≤ 3), difficulty? (0–1), content_hash, template_id?,
--     template_params?, verification?, model?, cost_usd?, prompt_version?,
--     figure? {code, code_hash, alt_text, png_path, width_px?, height_px?, bytes?} (yalnız şablon; şablon şekli
--     otomatik kapıdan geçmiştir → verified),
--     key {correct_option | numeric_value, numeric_tolerance?, canonical_expr?, solution, sympy_status, sympy_report?}}]
-- Geçersiz madde (yaprak yok, anahtar eksik/tutarsız, mcq'da 4–5 şık değil, şekli doğrulanmamış) atlanır; aynı
-- content_hash'li soru yeniden yazılmaz (reused). Sorular 'approved'; anahtar secure.answer_keys'e written_by
-- 'worker:practice.generate'. p_set verilmişse ve set hâlâ sorusuz 'needs_generation' ise bankadan doldurulur
-- (app.practice_fill_items: aynı seçim kuralları) ve soru geldiyse 'in_progress' olur.
-- Döner: {inserted, reused, skipped, question_ids[], set_id, filled, status}.
create or replace function public.register_practice_questions(p_curriculum uuid, p_items jsonb, p_set uuid default null) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_it jsonb;
  v_key jsonb;
  v_fig jsonb;
  v_kind text;
  v_src text;
  v_skills text[];
  v_opts jsonb;
  v_qid uuid;
  v_fid uuid;
  v_fig_ok boolean;
  v_ins int := 0;
  v_reused int := 0;
  v_skipped int := 0;
  v_filled int := 0;
  v_ids uuid[] := '{}';
  v_status text;
  v_set_cur uuid;
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 alıştırma sorularını yalnız worker yazar';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 40 then
    raise exception using errcode = 'P0001', message = 'OGR-PRAC-009 p_items 0–40 maddelik bir dizi olmalı';
  end if;
  if not exists (select 1 from public.curricula c where c.id = p_curriculum) then
    raise exception using errcode = 'P0001', message = format('OGR-PRAC-001 müfredat bulunamadı %s', p_curriculum);
  end if;
  if p_set is not null then
    select e.curriculum_id into v_set_cur
      from public.practice_sets ps join public.enrollments e on e.id = ps.enrollment_id where ps.id = p_set;
    if v_set_cur is distinct from p_curriculum then
      raise exception using errcode = 'P0001', message = format('OGR-PRAC-001 set bu müfredatın değil %s', p_set);
    end if;
  end if;

  for v_it in select x.it from jsonb_array_elements(p_items) as x (it) loop
    v_key := v_it -> 'key';
    if jsonb_typeof(v_key) = 'object' and v_key ? 'correct_option' and jsonb_typeof(v_key -> 'correct_option') = 'string' then
      v_key := jsonb_set(v_key, '{correct_option}', to_jsonb(upper(btrim(v_key ->> 'correct_option'))));
    end if;
    v_kind := coalesce(v_it ->> 'kind', 'mcq');
    v_src := v_it ->> 'source';
    v_opts := case when v_kind = 'mcq' then v_it -> 'options' end;
    v_skills := array(select distinct s.id
                        from jsonb_array_elements_text(case when jsonb_typeof(v_it -> 'skill_ids') = 'array'
                                                            then v_it -> 'skill_ids' else '[]'::jsonb end) as x (sid)
                        join public.skills s on s.curriculum_id = p_curriculum and s.id = x.sid and s.is_leaf
                       order by s.id limit 3);
    if cardinality(v_skills) = 0 or v_src is null or v_src not in ('template', 'llm') or v_kind not in ('mcq', 'numeric')
       or jsonb_typeof(v_key) is distinct from 'object' or nullif(btrim(v_it ->> 'stem'), '') is null
       or nullif(v_it ->> 'content_hash', '') is null or nullif(btrim(v_key ->> 'solution'), '') is null
       or coalesce(v_key ->> 'sympy_status', '') not in ('verified', 'failed', 'not_applicable')
       or v_key ->> 'sympy_status' = 'failed'
       or not app.answer_key_complete(v_kind, v_key ->> 'correct_option', v_key ->> 'numeric_value')
       or (v_kind = 'mcq' and (jsonb_typeof(v_opts) is distinct from 'array' or jsonb_array_length(v_opts) not between 4 and 5
                               or not exists (select 1 from jsonb_array_elements(v_opts) as o (opt)
                                               where o.opt ->> 'key' = v_key ->> 'correct_option')))
       or (v_kind = 'numeric' and nullif(v_key ->> 'correct_option', '') is not null) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select q.id into v_qid from public.questions q where q.content_hash = v_it ->> 'content_hash';
    if found then
      v_reused := v_reused + 1;
      v_ids := v_ids || v_qid;
      continue;
    end if;

    v_fid := null;
    v_fig := v_it -> 'figure';
    if jsonb_typeof(v_fig) = 'object' then
      if v_src <> 'template' or nullif(v_fig ->> 'code_hash', '') is null or nullif(v_fig ->> 'png_path', '') is null
         or nullif(btrim(v_fig ->> 'alt_text'), '') is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      select f.id, f.review_status = 'verified' into v_fid, v_fig_ok from public.figures f where f.code_hash = v_fig ->> 'code_hash';
      if v_fid is null then
        insert into public.figures (tool, code, code_hash, alt_text, png_path, width_px, height_px, bytes,
                                    render_status, vision_status, review_status, reviewed_at)
        values ('template', coalesce(v_fig ->> 'code', v_fig ->> 'code_hash'), v_fig ->> 'code_hash', v_fig ->> 'alt_text',
                v_fig ->> 'png_path', (v_fig ->> 'width_px')::int, (v_fig ->> 'height_px')::int, (v_fig ->> 'bytes')::int,
                'rendered', 'not_applicable', 'verified', now())
        on conflict (code_hash) do nothing
        returning id into v_fid;
        if v_fid is null then
          select f.id, f.review_status = 'verified' into v_fid, v_fig_ok from public.figures f where f.code_hash = v_fig ->> 'code_hash';
        else
          v_fig_ok := true;
        end if;
      end if;
      if not coalesce(v_fig_ok, false) then
        v_skipped := v_skipped + 1;  -- incelemede bekleyen şekil öğrenciye gitmez: soru şekilsiz anlamsız
        continue;
      end if;
    end if;

    insert into public.questions (curriculum_id, skill_ids, kind, stem, stem_values, figure_id, options, difficulty, source,
                                  template_id, template_params, content_hash, verification, status, model, cost_usd,
                                  prompt_version)
    values (p_curriculum, v_skills, v_kind, v_it ->> 'stem',
            case when jsonb_typeof(v_it -> 'stem_values') = 'object' then v_it -> 'stem_values' else '{}'::jsonb end,
            v_fid, v_opts,
            case when jsonb_typeof(v_it -> 'difficulty') = 'number' then least(greatest((v_it ->> 'difficulty')::numeric, 0), 1) end,
            v_src, case when v_src = 'template' then v_it ->> 'template_id' end,
            case when v_src = 'template' and jsonb_typeof(v_it -> 'template_params') = 'object' then v_it -> 'template_params' end,
            v_it ->> 'content_hash',
            case when jsonb_typeof(v_it -> 'verification') = 'object' then v_it -> 'verification'
                 else jsonb_build_object('schema', true, 'sympy', case when v_key ->> 'sympy_status' = 'verified' then 'verified' else 'inferred' end,
                                         'render', case when v_fid is null then 'not_applicable' else 'ok' end,
                                         'vision', 'not_applicable', 'attempts', 1) end,
            'approved', nullif(v_it ->> 'model', ''), coalesce((v_it ->> 'cost_usd')::numeric, 0), nullif(v_it ->> 'prompt_version', ''))
    on conflict (content_hash) do nothing
    returning id into v_qid;
    if v_qid is null then  -- eşzamanlı ikinci yazım: var olanı kullan
      select q.id into v_qid from public.questions q where q.content_hash = v_it ->> 'content_hash';
      v_reused := v_reused + 1;
      v_ids := v_ids || v_qid;
      continue;
    end if;
    insert into secure.answer_keys (question_id, correct_option, numeric_value, numeric_tolerance, canonical_expr, solution,
                                    sympy_status, sympy_report, written_by, verified_at)
    values (v_qid, case when v_kind = 'mcq' then v_key ->> 'correct_option' end,
            case when v_kind = 'numeric' then v_key ->> 'numeric_value' end,
            coalesce((v_key ->> 'numeric_tolerance')::numeric, 0), nullif(v_key ->> 'canonical_expr', ''), v_key ->> 'solution',
            v_key ->> 'sympy_status', case when jsonb_typeof(v_key -> 'sympy_report') = 'object' then v_key -> 'sympy_report' end,
            'worker:practice.generate', case when v_key ->> 'sympy_status' = 'verified' then now() end);
    v_ins := v_ins + 1;
    v_ids := v_ids || v_qid;
  end loop;

  if p_set is not null then
    select ps.status into v_status from public.practice_sets ps where ps.id = p_set for update;
    if v_status = 'needs_generation' then
      v_filled := app.practice_fill_items(p_set);
      if v_filled > 0 then
        update public.practice_sets ps set status = 'in_progress' where ps.id = p_set;
        v_status := 'in_progress';
      end if;
    end if;
  end if;
  return jsonb_build_object('inserted', v_ins, 'reused', v_reused, 'skipped', v_skipped, 'question_ids', to_jsonb(v_ids),
                            'set_id', p_set, 'filled', v_filled, 'status', v_status);
end
$$;
comment on function public.register_practice_questions(uuid, jsonb, uuid) is 'Worker: şablon/LLM alıştırma sorularını (anahtar secure.answer_keys, şablon şekli) bankaya yazar (content_hash tekrarsız); set verilmişse bankadan doldurup in_progress yapar.';

-- Kalıcı üretim hatası (practice.generate son deneme): set hâlâ sorusuz 'needs_generation' ise bankayı bir kez daha
-- dener (soru geldiyse 'in_progress'), yoksa 'abandoned' kapatır (summary.reason 'generation_failed', finish_practice
-- özet biçimi; practice_set_json generation_failed = true) ve suggestions.refresh işini atar. Yalnız worker.
-- Döner: setin durumu.
create or replace function public.fail_practice_generation(p_set uuid, p_reason text default null) returns text
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_ps public.practice_sets%rowtype;
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 üretim hatasını yalnız worker yazar';
  end if;
  select ps.* into v_ps from public.practice_sets ps where ps.id = p_set for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-PRAC-001 set bulunamadı %s', p_set);
  end if;
  if v_ps.status <> 'needs_generation' then
    return v_ps.status;
  end if;
  if exists (select 1 from public.practice_set_items i where i.set_id = p_set) or app.practice_fill_items(p_set) > 0 then
    update public.practice_sets ps set status = 'in_progress' where ps.id = p_set;
    return 'in_progress';
  end if;
  update public.practice_sets ps
     set status = 'abandoned', finished_at = now(),
         summary = jsonb_build_object(
           'set_id', p_set, 'status', 'abandoned', 'reason', 'generation_failed', 'detail', left(p_reason, 200),
           'total', 0, 'answered', 0, 'correct', 0, 'wrong', 0, 'unanswered', 0, 'top_misconception', null,
           'weak_skill', null, 'skills', '[]'::jsonb, 'mastery', '[]'::jsonb, 'finished_at', now())
   where ps.id = p_set;
  perform app.try_enqueue('suggestions.refresh', jsonb_build_object(
    'student_id', app.student_of_enrollment(v_ps.enrollment_id), 'enrollment_id', v_ps.enrollment_id,
    'reason', 'practice.generation_failed', 'set_id', p_set));
  return 'abandoned';
end
$$;
comment on function public.fail_practice_generation(uuid, text) is 'Worker: kalıcı üretim hatasında sorusuz needs_generation setini bankadan yeniden dener ya da abandoned (generation_failed) kapatır + suggestions.refresh.';


-- --- 3a. Şekil kaynağı öğrenciye kapalı ---------------------------------------------------------------------------
-- figures.code şablon kimliği + kanonik parametrelerin JSON'udur (content/tyt-matematik/templates/_common.py
-- FigureSpec.code); bazı varyantlarda (ör. yuzde-grafik 'ardisik') doğru cevabı taşır. 0018 authenticated'a tüm
-- tablolarda SELECT verir ve figures_select 'using (true)'; practice_set_json figure.id'yi istemciye verir. Öğrenci
-- yalnız gösterim sütunlarını okur (question_styles kalıbı: select=* izin hatası verir, sütunlar açıkça seçilir);
-- kaynak (code, code_hash, vision_report, render_log) personel görünümünden (v_figures_staff) ya da service_role ile.
revoke select on public.figures from authenticated;
grant select (id, tool, alt_text, png_path, svg_path, width_px, height_px, bytes, render_status, vision_status, attempts,
              review_status, reviewed_by, reviewed_at, created_at)
on public.figures to authenticated;

create view public.v_figures_staff with (security_barrier = true) as
select f.id,
       f.tool,
       f.code,
       f.code_hash,
       f.alt_text,
       f.png_path,
       f.svg_path,
       f.width_px,
       f.height_px,
       f.bytes,
       f.render_status,
       f.vision_status,
       f.vision_report,
       f.attempts,
       f.review_status,
       f.reviewed_by,
       f.reviewed_at,
       f.render_log,
       f.created_at
  from public.figures as f
 where app.is_trusted() or app.is_staff();
comment on view public.v_figures_staff is 'Şekillerin tam satırı (kaynak kod, code_hash, görsel denetim raporu, render günlüğü); yalnız eğitmen/admin ve worker.';
grant select on public.v_figures_staff to authenticated, service_role;

-- --- 3b. Anahtarı doğrulanmamış soru ustalığa tam ağırlıkla girmez ----------------------------------------------------
-- 0021'in answer_practice_item'ı; tek fark gözlem ağırlığı: questions.verification.sympy = 'inferred' (LLM anahtarı
-- SymPy ile denetlenemedi) ise taze soruda settings.practice_inferred_key_weight (0.5), tekrar yanlışta
-- min(practice_repeat_wrong_weight, practice_inferred_key_weight). Yanlış anahtar öğrencinin doğru cevabını 'yanlış'
-- gösterebilir; ustalığa etkisi yarıya iner (eğitmen kuyruğu ve gece denetimi bu işaretle süzer).
create or replace function public.answer_practice_item(
  p_set uuid, p_question uuid, p_answer text, p_response_ms int default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_ps public.practice_sets%rowtype;
  v_item public.practice_set_items%rowtype;
  v_q public.questions%rowtype;
  v_k secure.answer_keys%rowtype;
  v_cur uuid;
  v_ans text := nullif(btrim(p_answer), '');
  v_correct boolean;
  v_chosen jsonb;
  v_tag text;
  v_tag_skill text;
  v_leaves text[];
  v_skill text;
  v_att bigint;
  v_obs bigint;
  v_already boolean := false;
  v_repeat boolean;
  v_weight numeric;
  v_inferred_w numeric;
begin
  select ps.* into v_ps from public.practice_sets ps where ps.id = p_set for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-PRAC-001 set bulunamadı %s', p_set);
  end if;
  perform app.assert_student_access(app.student_of_enrollment(v_ps.enrollment_id), true);
  select i.* into v_item from public.practice_set_items i where i.set_id = p_set and i.question_id = p_question;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-PRAC-004 soru bu sette değil';
  end if;
  if v_item.attempt_id is not null then
    select a.is_correct, a.misconception_tag into v_correct, v_tag from public.attempts a where a.id = v_item.attempt_id;
    v_already := true;
  else
    if v_ps.status <> 'in_progress' then
      raise exception using errcode = 'P0001', message = format('OGR-PRAC-003 set cevaplanamaz (durum %s)', v_ps.status);
    end if;
    if v_ans is null then
      raise exception using errcode = 'P0001', message = 'OGR-PRAC-005 cevap boş';
    end if;
    select q.* into v_q from public.questions q where q.id = p_question;
    select k.* into v_k from secure.answer_keys k where k.question_id = p_question;
    if v_k.question_id is null or not app.answer_key_complete(v_q.kind, v_k.correct_option, v_k.numeric_value) then
      raise exception using errcode = 'P0001', message = format('OGR-KEY-001 anahtar yok %s', p_question);
    end if;
    if v_q.kind = 'mcq' then
      v_ans := upper(v_ans);
      if v_ans !~ '^[A-E]$' then
        raise exception using errcode = 'P0001', message = format('OGR-PRAC-005 şık A–E olmalı (%s)', left(v_ans, 20));
      end if;
      v_correct := v_ans = v_k.correct_option;
      v_chosen := jsonb_build_object('key', v_ans);
      if not v_correct then
        select o.opt ->> 'misconception_tag' into v_tag
          from jsonb_array_elements(case when jsonb_typeof(v_q.options) = 'array' then v_q.options else '[]'::jsonb end) as o (opt)
         where upper(o.opt ->> 'key') = v_ans
         limit 1;
        if v_tag is not null and not exists (select 1 from public.misconception_tags mt where mt.tag = v_tag) then
          v_tag := null;
        end if;
      end if;
    else
      v_correct := app.numeric_equal(v_ans, v_k.numeric_value, v_k.numeric_tolerance);
      v_chosen := jsonb_build_object('value', left(v_ans, 64));
    end if;

    -- tekrar görülen soru: anahtar ezberlenmiş olabilir; ustalığı yükseltmez, kanıt sayacına katılmaz
    v_repeat := exists (select 1 from public.attempts a
                         where a.enrollment_id = v_ps.enrollment_id and a.question_id = p_question and a.graded_at is not null);
    -- anahtarı SymPy ile doğrulanmamış (model çıkarımı) soru: düşük ağırlık (0027)
    v_inferred_w := case when coalesce(v_q.verification ->> 'sympy', '') = 'inferred'
                         then least(greatest(app.setting_num('practice_inferred_key_weight', 0.5), 0), 1) else 1 end;
    v_weight := case when not v_repeat then v_inferred_w
                     when v_correct then 0
                     else least(least(greatest(app.setting_num('practice_repeat_wrong_weight', 0.5), 0), 1), v_inferred_w) end;

    insert into public.attempts (enrollment_id, question_id, context, session_id, chosen, is_correct, misconception_tag, graded_at,
                                 response_ms)
    values (v_ps.enrollment_id, p_question, 'practice', p_set, v_chosen, v_correct, v_tag, now(),
            case when p_response_ms >= 0 then p_response_ms end)
    returning id into v_att;

    select e.curriculum_id into v_cur from public.enrollments e where e.id = v_ps.enrollment_id;
    v_leaves := array(select s.id from public.skills s
                       where s.curriculum_id = v_cur and s.is_leaf and s.id = any(v_q.skill_ids) order by s.id);
    select mt.skill_id into v_tag_skill from public.misconception_tags mt where mt.tag = v_tag;
    foreach v_skill in array v_leaves loop
      insert into public.observations (enrollment_id, skill_id, kind, value, weight, source_type, source_id, source_locator,
                                       misconception_tag, counts_for_mastery)
      values (v_ps.enrollment_id, v_skill, 'practice', case when v_correct then 1 else 0 end, v_weight, 'attempt', v_att::text,
              'Alıştırma ' || left(p_set::text, 8) || ' · soru ' || v_item.no,
              case when v_tag is not null and (v_tag_skill is null or v_tag_skill = v_skill or cardinality(v_leaves) = 1) then v_tag end,
              not v_repeat)
      returning id into v_obs;
      perform public.apply_observation(v_obs);
    end loop;
    update public.practice_set_items i set attempt_id = v_att, answered_at = now() where i.set_id = p_set and i.no = v_item.no;
  end if;

  return jsonb_build_object(
    'set_id', p_set, 'question_id', p_question, 'no', v_item.no, 'correct', v_correct, 'misconception_tag', v_tag,
    'misconception_text', (select mt.text_student from public.misconception_tags mt where mt.tag = v_tag),
    'answered', (select count(*) from public.practice_set_items i where i.set_id = p_set and i.attempt_id is not null),
    'total', (select count(*) from public.practice_set_items i where i.set_id = p_set),
    'remaining', (select count(*) from public.practice_set_items i where i.set_id = p_set and i.attempt_id is null),
    'already_answered', v_already);
end
$$;
comment on function public.answer_practice_item(uuid, uuid, text, int) is 'Alıştırma sorusunu gizli anahtarla notlar: attempts + observations(kind=practice) → BKT (anahtarı inferred soruda practice_inferred_key_weight); doğru/yanlış ve çeldirici yanılgısını döner (anahtar dönmez).';

-- 0025'in ilk öneri işlevi + ön ısıtma: kart eklenen her kayda 'practice.prewarm' (kartın yaprakları) atılır. Yayın
-- (curriculum_publish) ve otopilotlu taslak kaydı (save_curriculum_draft) bu yoldan geçer. Otopilotsuz taslakta
-- curriculum.draft sonundaki ön ısıtma 'skipped' biter (ücretli üretim yok); eğitmen yayınlayınca banka bu işle ısınır,
-- öğrencinin ilk Başla'sı bankadan ya da practice.generate ile soru getirir.
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
  v_enr uuid;
  v_enrs uuid[];
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
  with ins as (
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
       and not exists (select 1 from public.mastery m where m.enrollment_id = e.id)
    returning enrollment_id
  )
  select coalesce(array_agg(ins.enrollment_id), '{}') into v_enrs from ins;
  v_sug := cardinality(v_enrs);
  -- kartı alan her kaydın ilk yapraklarını ısıt (öğrenci Başla'ya bastığında banka hazır olsun)
  foreach v_enr in array v_enrs loop
    perform app.try_enqueue('practice.prewarm', jsonb_build_object(
      'enrollment_id', v_enr, 'skill_ids', to_jsonb(v_leaf_ids), 'reason', 'curriculum_ready'));
  end loop;
  return jsonb_build_object('suggestions', v_sug, 'skill_ids', to_jsonb(v_leaf_ids));
end
$$;
comment on function app.first_practice_suggestion(uuid) is 'İlk practice önerisi (ilk ünitenin ilk 3 yaprağı) henüz başlamamış etkin kayıtlara + practice.prewarm; {suggestions, skill_ids}.';

revoke all on function app.practice_exam_blocks(uuid, uuid), app.practice_usable_questions(uuid, uuid, text) from public;
revoke all on function public.practice_bank_status(uuid, text[]), public.register_practice_questions(uuid, jsonb, uuid),
  public.fail_practice_generation(uuid, text) from public, anon;
-- authenticated çağırabilir ama gövde app.is_trusted() ister (açık OGR-AUTH-002); worker doğrudan bağlantıyla çağırır.
grant execute on function public.practice_bank_status(uuid, text[]), public.register_practice_questions(uuid, jsonb, uuid),
  public.fail_practice_generation(uuid, text) to authenticated, service_role;
