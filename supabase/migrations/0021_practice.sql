-- 0021_practice.sql — koçun önerdiği kısa alıştırma setleri (docs/PLAN-v2.md §13 "Test akışı (öneri → Başla)").
-- Akış: Bugün kartı → start_practice(öneri) set kurar (onaylı soru bankası sorularından, en çok 10) → her cevap
-- answer_practice_item ile sunucuda gizli anahtarla (secure.answer_keys) notlanır: attempts + observations(kind='practice',
-- source_type='attempt') → apply_observation (BKT) → doğru/yanlış ve çeldiricinin yanılgı etiketi döner → finish_practice
-- tek cümlelik sonucun verisini (doğru sayısı, en sık yanılgı, zayıf yaprak) döner ve suggestions.refresh işini kuyruğa atar.
-- Bankada uygun onaylı soru yoksa set boş ve status = 'needs_generation' açılır; 'practice.generate' işi (worker:
-- question_templates / LLM üretimi + doğrulama) soruları practice_set_items'a ekleyip durumu 'in_progress' yapar.
-- Üretim settings.practice_generation_timeout_s (600) içinde bitmezse set bayatlar: sonraki start_practice/get_practice_set
-- bankayı bir kez daha dener, yine boşsa seti 'abandoned' kapatır (summary.reason = 'generation_timeout',
-- generation_failed = true) ve suggestions.refresh işini atar; istemci sonsuza dek beklemez, tek cümle + Bugün'e dön.
-- Doğru şık hiçbir yanıtta dönmez.
-- Kötüye kullanım sınırları: (1) öğrencinin henüz bitirmediği teşhis/deneme/yayımlanmış sınavın soruları alıştırmaya
-- girmez (anahtar alıştırmadan öğrenilemez); (2) aynı soruya ikinci kez verilen cevap ustalık kanıtı sayılmaz
-- (counts_for_mastery = false; doğruysa ağırlık 0, yanlışsa practice_repeat_wrong_weight); (3) koç yolunda (öneri yok)
-- kayıt başına tek açık set (kesişen kazanımlarda aynı set döner; boş bankada yeni üretim işi atılmaz) ve günde en çok
-- practice_daily_sets yeni set (OGR-PRAC-007).

create table public.practice_sets (  -- Alıştırma setleri (öneriden ya da koçtan; 8–10 soru); attempts.session_id = set kimliği.
  id uuid primary key default gen_random_uuid(),  -- Set kimliği (attempts.session_id)
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,  -- Kayıt
  suggestion_id uuid references public.suggestions (id) on delete set null,  -- Kaynak öneri (koçtan açılan sette boş)
  status text not null default 'needs_generation' check (status in ('needs_generation', 'in_progress', 'finished', 'abandoned')),  -- Durum
  skill_ids text[] not null default '{}',  -- Hedef yaprak kazanımlar
  target_count int not null default 8 check (target_count between 1 and 10),  -- İstenen soru sayısı
  summary jsonb,  -- finish_practice özeti (doğru sayısı, en sık yanılgı, zayıf yaprak)
  started_at timestamptz not null default now(),  -- Başlama zamanı
  finished_at timestamptz,  -- Bitiş zamanı
  created_at timestamptz not null default now()  -- Oluşturulma zamanı
);
-- begin comments public.practice_sets
comment on table public.practice_sets is 'Alıştırma setleri (öneriden ya da koçtan; 8–10 soru); attempts.session_id = set kimliği.';
comment on column public.practice_sets.id is 'Set kimliği (attempts.session_id)';
comment on column public.practice_sets.enrollment_id is 'Kayıt';
comment on column public.practice_sets.suggestion_id is 'Kaynak öneri (koçtan açılan sette boş)';
comment on column public.practice_sets.status is 'Durum';
comment on column public.practice_sets.skill_ids is 'Hedef yaprak kazanımlar';
comment on column public.practice_sets.target_count is 'İstenen soru sayısı';
comment on column public.practice_sets.summary is 'finish_practice özeti (doğru sayısı, en sık yanılgı, zayıf yaprak)';
comment on column public.practice_sets.started_at is 'Başlama zamanı';
comment on column public.practice_sets.finished_at is 'Bitiş zamanı';
comment on column public.practice_sets.created_at is 'Oluşturulma zamanı';
-- end comments public.practice_sets
create unique index practice_sets_suggestion on public.practice_sets (suggestion_id) where suggestion_id is not null;
create index practice_sets_enrollment on public.practice_sets (enrollment_id, started_at desc);
alter table public.practice_sets enable row level security;
alter table public.practice_sets force row level security;

create table public.practice_set_items (  -- Setin soruları (sıra no); cevap attempts satırına bağlanır.
  set_id uuid not null references public.practice_sets (id) on delete cascade,  -- Set
  no int not null check (no between 1 and 20),  -- Sıra (1'den)
  question_id uuid not null references public.questions (id),  -- Soru bankası sorusu
  attempt_id bigint references public.attempts (id) on delete set null,  -- Cevap (answer_practice_item yazar)
  answered_at timestamptz,  -- Cevap zamanı
  created_at timestamptz not null default now(),  -- Oluşturulma zamanı
  primary key (set_id, no),
  unique (set_id, question_id)
);
-- begin comments public.practice_set_items
comment on table public.practice_set_items is 'Setin soruları (sıra no); cevap attempts satırına bağlanır.';
comment on column public.practice_set_items.set_id is 'Set';
comment on column public.practice_set_items.no is 'Sıra (1''den)';
comment on column public.practice_set_items.question_id is 'Soru bankası sorusu';
comment on column public.practice_set_items.attempt_id is 'Cevap (answer_practice_item yazar)';
comment on column public.practice_set_items.answered_at is 'Cevap zamanı';
comment on column public.practice_set_items.created_at is 'Oluşturulma zamanı';
-- end comments public.practice_set_items
alter table public.practice_set_items enable row level security;
alter table public.practice_set_items force row level security;

-- Öğrenci kendi setlerini, bağlı eğitmen ve admin öğrencininkileri görür (veli görmez). Soru metni için istemci
-- get_practice_set / v_questions_student kullanır (questions tablosu öğrenciye kapalı).
grant select on public.practice_sets, public.practice_set_items to authenticated;
create policy practice_sets_select on public.practice_sets for select to authenticated
using (app.can_read_enrollment(enrollment_id, false));
create policy practice_set_items_select on public.practice_set_items for select to authenticated
using (exists (select 1 from public.practice_sets as ps where ps.id = practice_set_items.set_id));

-- Setin istemci görünümü: durum, özet ve sırayla sorular (kök, şıklar yanılgı etiketsiz, doğrulanmış şekil, cevaplandı mı,
-- doğru mu). Doğru şık yoktur. Yetki denetimi çağırandadır.
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
           'generation_failed', (ps.status = 'abandoned' and ps.summary ->> 'reason' = 'generation_timeout')
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

-- Hedef yapraklar: verilen kodlar (yaprak ya da üst düğüm → alt yaprakları) müfredatın yaprakları olarak; boşsa en zayıf
-- iki yaprak (onaylı sorusu olanlar önce; ustalık p, yoksa p_init, artan).
create or replace function app.practice_target_leaves(p_enrollment uuid, p_codes text[]) returns text[]
language plpgsql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_cur uuid;
  v_out text[];
begin
  select e.curriculum_id into v_cur from public.enrollments e where e.id = p_enrollment;
  if p_codes is not null and cardinality(p_codes) > 0 then
    with recursive t (sid) as (
      select s.id from public.skills s where s.curriculum_id = v_cur and s.id = any(p_codes)
      union
      select s.id from public.skills s join t on s.parent_id = t.sid where s.curriculum_id = v_cur
    )
    select array(select s.id from public.skills s join t on t.sid = s.id
                  where s.curriculum_id = v_cur and s.is_leaf order by s.order_no, s.id) into v_out;
    return v_out;
  end if;
  select array(
    select s.id
      from public.skills s
      left join public.mastery m on m.enrollment_id = p_enrollment and m.skill_id = s.id
     where s.curriculum_id = v_cur and s.is_leaf
     order by (exists (select 1 from public.questions q join secure.answer_keys k on k.question_id = q.id
                        where q.curriculum_id = v_cur and q.status = 'approved' and s.id = any(q.skill_ids))) desc,
              coalesce(m.p, s.p_init), coalesce(m.evidence_count, 0), s.order_no, s.id
     limit 2) into v_out;
  return v_out;
end
$$;
comment on function app.practice_target_leaves(uuid, text[]) is 'Alıştırmanın hedef yaprakları: verilen kodların yaprakları; boşsa en zayıf iki yaprak (onaylı sorusu olan önce).';

-- Setin boş kalan sorularını bankadan doldurur (start_practice ve bayat set yeniden denemesi): hedef yapraklara bağlı,
-- onaylı ve anahtarı tam sorular; daha az görülen önce, yapraklar arasında sırayla; bu kaydın bitirmediği
-- teşhis/deneme/yayımlanmış sınavın sorusu girmez. Yalnız sorusuz sette çalışır. Döner: eklenen soru sayısı.
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
          select c.qid, c.sk, c.h, row_number() over (partition by c.sk order by c.seen, c.last_seen nulls first, c.h) as rn
            from (
              select q.id as qid,
                     (select x.sid from unnest(q.skill_ids) as x (sid) where x.sid = any(v_ps.skill_ids) order by x.sid limit 1) as sk,
                     md5(q.id::text || p_set::text) as h,
                     (select count(*) from public.attempts a where a.enrollment_id = v_ps.enrollment_id and a.question_id = q.id) as seen,
                     (select max(a.created_at) from public.attempts a where a.enrollment_id = v_ps.enrollment_id and a.question_id = q.id) as last_seen
                from public.questions q
                join secure.answer_keys k on k.question_id = q.id
               where q.curriculum_id = v_cur and q.status = 'approved' and q.skill_ids && v_ps.skill_ids
                 and app.answer_key_complete(q.kind, k.correct_option, k.numeric_value)
                 -- bu kaydın bitirmediği teşhis/deneme/yayımlanmış sınavın sorusu alıştırmaya girmez (anahtar sızmaz)
                 and not exists (select 1 from public.exam_questions eq join public.exams x on x.id = eq.exam_id
                                  where eq.question_id = q.id and x.kind in ('diagnostic', 'deneme', 'published')
                                    and not exists (select 1 from public.exam_sessions es
                                                     where es.exam_id = x.id and es.enrollment_id = v_ps.enrollment_id
                                                       and es.finished_at is not null))
            ) as c
        ) as r
       order by r.rn, r.sk, r.h
       limit v_ps.target_count
    ) as z;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
comment on function app.practice_fill_items(uuid) is 'Sorusuz alıştırma setini onaylı + anahtarlı bankadan doldurur (bitmemiş sınav soruları hariç); eklenen sayıyı döner.';

-- Bayat üretim: needs_generation seti practice_generation_timeout_s'den eskiyse bankayı bir kez daha dener (soru gelmişse
-- in_progress); yine boşsa 'abandoned' kapatır (finish_practice özet biçimi + reason 'generation_timeout') ve
-- suggestions.refresh işini atar. Diğer durumlarda dokunmaz. Yetki denetimi çağırana aittir. Döner: setin durumu.
create or replace function app.practice_expire_generation(p_set uuid) returns text
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_ps public.practice_sets%rowtype;
begin
  select ps.* into v_ps from public.practice_sets ps where ps.id = p_set for update;
  if not found or v_ps.status <> 'needs_generation'
     or v_ps.started_at > now() - make_interval(secs => app.setting_num('practice_generation_timeout_s', 600)::double precision) then
    return v_ps.status;
  end if;
  if app.practice_fill_items(p_set) > 0 or exists (select 1 from public.practice_set_items i where i.set_id = p_set) then
    update public.practice_sets ps set status = 'in_progress' where ps.id = p_set;
    return 'in_progress';
  end if;
  update public.practice_sets ps
     set status = 'abandoned', finished_at = now(),
         summary = jsonb_build_object(
           'set_id', p_set, 'status', 'abandoned', 'reason', 'generation_timeout', 'total', 0, 'answered', 0, 'correct', 0,
           'wrong', 0, 'unanswered', 0, 'top_misconception', null, 'weak_skill', null, 'skills', '[]'::jsonb,
           'mastery', '[]'::jsonb, 'finished_at', now())
   where ps.id = p_set;
  perform app.try_enqueue('suggestions.refresh', jsonb_build_object(
    'student_id', app.student_of_enrollment(v_ps.enrollment_id), 'enrollment_id', v_ps.enrollment_id,
    'reason', 'practice.generation_timeout', 'set_id', p_set));
  return 'abandoned';
end
$$;
comment on function app.practice_expire_generation(uuid) is 'Zaman aşımına uğramış needs_generation setini bankadan yeniden dener ya da abandoned (generation_timeout) kapatır + suggestions.refresh.';

-- Set kurar. p_suggestion doluysa öneriden (türü practice | weekly_homework | lesson_review | gap_analysis; öneri
-- başlatıldı işaretlenir; aynı öneri için ikinci çağrı aynı seti döner); boşsa p_enrollment + isteğe bağlı p_skill_ids
-- (koç sohbetinden). Soru sayısı: p_count ?? payload.count ?? settings.practice_set_size (8), 1–10. Sorular: hedef
-- yapraklara bağlı, onaylı ve anahtarı tam soru bankası soruları; daha az görülen önce, yapraklar arasında sırayla.
-- Öğrencinin bitirmediği teşhis/deneme/yayımlanmış sınavın soruları seçilmez. Uygun soru yoksa set boş açılır
-- (needs_generation) ve 'practice.generate' işi kuyruğa atılır. Koç yolu: kayıt başına danışma kilidi; açık koç seti
-- kazanımları kesişiyorsa o set döner (iş yeniden atılmaz), kesişmiyorsa eskisi kapanır (finish_practice); son 24 saatte
-- practice_daily_sets (10) koç setinden fazlası OGR-PRAC-007. Müfredat taslağı hazırlanıyorsa (kazanımsız) OGR-PRAC-006;
-- otopilotu etkin olmayan onaylanmamış taslakta (öğrenci eğitmenin yayınını bekler) OGR-PRAC-008.
-- Yetki: öneriden yalnız öğrencinin kendisi, admin ya da worker (consume_suggestion kuralı); koç yolunda owner eğitmen
-- de. Döner: app.practice_set_json.
create or replace function public.start_practice(
  p_suggestion uuid, p_enrollment uuid default null, p_skill_ids text[] default null, p_count int default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_sug public.suggestions%rowtype;
  v_enr public.enrollments%rowtype;
  v_enr_id uuid := p_enrollment;
  v_codes text[] := p_skill_ids;
  v_count int := p_count;
  v_skills text[];
  v_set uuid;
  v_n int;
  v_open public.practice_sets%rowtype;
  v_cur public.curricula%rowtype;
  v_daily int;
begin
  if p_suggestion is not null then
    select s.* into v_sug from public.suggestions s where s.id = p_suggestion for update;
    if not found then
      raise exception using errcode = 'P0001', message = format('OGR-SUG-001 öneri bulunamadı %s', p_suggestion);
    end if;
    -- öneriyi yalnız öğrencinin kendisi, admin ya da worker başlatır (consume_suggestion ile aynı kural)
    if not (app.is_trusted() or app.is_admin() or coalesce(v_sug.student_id = app.my_student_id(), false)) then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 öneriyi yalnız öğrencinin kendisi başlatır';
    end if;
    if v_sug.kind not in ('practice', 'weekly_homework', 'lesson_review', 'gap_analysis') then
      raise exception using errcode = 'P0001', message = format('OGR-PRAC-002 bu öneri alıştırma değil (%s)', v_sug.kind);
    end if;
    select ps.id into v_set from public.practice_sets ps where ps.suggestion_id = p_suggestion;
    if v_set is not null then
      perform app.practice_expire_generation(v_set);  -- üretim zaman aşımına uğradıysa: yeniden dene ya da kapat
      return app.practice_set_json(v_set);
    end if;
    perform public.consume_suggestion(p_suggestion);
    v_enr_id := coalesce(v_sug.enrollment_id, p_enrollment);
    if v_codes is null and jsonb_typeof(v_sug.payload -> 'skill_ids') = 'array' then
      v_codes := array(select jsonb_array_elements_text(v_sug.payload -> 'skill_ids'));
    end if;
    if v_count is null and jsonb_typeof(v_sug.payload -> 'count') = 'number' then
      v_count := (v_sug.payload ->> 'count')::int;
    end if;
  end if;
  select e.* into v_enr from public.enrollments e where e.id = v_enr_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-PRAC-001 kayıt bulunamadı (öneri ya da p_enrollment)';
  end if;
  if v_sug.id is not null and v_sug.student_id <> v_enr.student_id then
    raise exception using errcode = 'P0001', message = 'OGR-PRAC-001 kayıt önerinin öğrencisine ait değil';
  end if;
  perform app.assert_student_access(v_enr.student_id, true);
  if v_sug.id is null then
    -- koç yolu: aynı kayıt için eşzamanlı çağrılar sırayla (tek açık set ve günlük sınır sayımı yarışsız)
    perform pg_advisory_xact_lock(hashtextextended('practice:' || v_enr.id::text, 0));
  end if;
  v_skills := app.practice_target_leaves(v_enr.id, v_codes);
  if coalesce(cardinality(v_skills), 0) = 0 then
    select c.* into v_cur from public.curricula c where c.id = v_enr.curriculum_id;
    if not exists (select 1 from public.skills s where s.curriculum_id = v_enr.curriculum_id and s.is_leaf)
       and (v_cur.draft_status in ('queued', 'researching', 'drafting', 'saving')
            or (v_cur.draft_status is null and v_cur.status = 'draft' and v_cur.origin = 'ai_draft')) then
      raise exception using errcode = 'P0001', message = 'OGR-PRAC-006 müfredat hazırlanıyor; alıştırma taslak bitince açılır';
    end if;
    raise exception using errcode = 'P0001', message = 'OGR-PRAC-001 hedef kazanım bu kaydın müfredatında yok';
  end if;
  -- onaylanmamış taslak: otopilot etkin değilse (sınav parkuru dışı ders ya da eğitmen kapattı) öğrenci eğitmenin
  -- yayınını bekler (PLAN §3.5); öneri motoru da bu kayda kart üretmez. curriculum_autopilot_state 0025'te.
  select c.* into v_cur from public.curricula c where c.id = v_enr.curriculum_id;
  if v_cur.status = 'draft' and not coalesce((public.curriculum_autopilot_state(v_cur.id) ->> 'effective')::boolean, false) then
    raise exception using errcode = 'P0001', message = 'OGR-PRAC-008 müfredat eğitmen onayını bekliyor; alıştırma yayından sonra açılır';
  end if;
  v_count := least(greatest(coalesce(v_count, app.setting_num('practice_set_size', 8)::int), 1), 10);

  if v_sug.id is null then
    -- tek açık koç seti: kazanımları kesişiyorsa aynısı döner (boş bankada üretim işi yeniden atılmaz); değilse kapanır.
    -- Üretimi zaman aşımına uğramış set önce yeniden denenir ya da kapatılır (yeni set yeni practice.generate işi atar).
    perform app.practice_expire_generation(ps.id) from public.practice_sets ps
     where ps.enrollment_id = v_enr.id and ps.suggestion_id is null and ps.status = 'needs_generation';
    select ps.* into v_open from public.practice_sets ps
     where ps.enrollment_id = v_enr.id and ps.suggestion_id is null and ps.status in ('in_progress', 'needs_generation')
     order by ps.started_at desc, ps.id
     limit 1;
    if found then
      if v_open.skill_ids && v_skills then
        return app.practice_set_json(v_open.id);
      end if;
      perform public.finish_practice(v_open.id);
    end if;
    if not app.is_trusted() then
      select count(*) into v_daily from public.practice_sets ps
       where ps.enrollment_id = v_enr.id and ps.suggestion_id is null and ps.started_at > now() - interval '1 day';
      if v_daily >= app.setting_num('practice_daily_sets', 10)::int then
        raise exception using errcode = 'P0001', message = 'OGR-PRAC-007 bugünlük alıştırma sınırına ulaştın; yarın yeni set açılır';
      end if;
    end if;
  end if;

  insert into public.practice_sets (enrollment_id, suggestion_id, status, skill_ids, target_count)
  values (v_enr.id, v_sug.id, 'needs_generation', v_skills, v_count)
  returning id into v_set;

  v_n := app.practice_fill_items(v_set);

  if v_n > 0 then
    update public.practice_sets ps set status = 'in_progress' where ps.id = v_set;
  else
    perform app.try_enqueue('practice.generate', jsonb_build_object(
      'set_id', v_set, 'enrollment_id', v_enr.id, 'curriculum_id', v_enr.curriculum_id, 'skill_ids', to_jsonb(v_skills),
      'count', v_count,
      'template_ids', coalesce((select jsonb_agg(qt.id order by qt.id) from public.question_templates qt
                                 where qt.curriculum_id = v_enr.curriculum_id and qt.enabled and qt.skill_id = any(v_skills)), '[]'::jsonb)));
  end if;
  return app.practice_set_json(v_set);
end
$$;
comment on function public.start_practice(uuid, uuid, text[], int) is 'Alıştırma seti kurar (öneriden ya da kayıt + kazanımlardan; onaylı bankadan ≤ 10 soru, bitmemiş sınav soruları hariç); soru yoksa needs_generation + practice.generate işi; koç yolunda tek açık set ve günlük sınır.';

-- Seti okur (devam etmek için): öğrenci kendi, bağlı eğitmen, admin, worker. Üretimi zaman aşımına uğramış
-- needs_generation seti burada yeniden denenir ya da kapatılır (app.practice_expire_generation; bu yüzden volatile).
create or replace function public.get_practice_set(p_set uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_enr uuid;
begin
  select ps.enrollment_id into v_enr from public.practice_sets ps where ps.id = p_set;
  if v_enr is null then
    raise exception using errcode = 'P0001', message = format('OGR-PRAC-001 set bulunamadı %s', p_set);
  end if;
  if not (app.is_trusted() or app.can_read_student_data(app.student_of_enrollment(v_enr))) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu set için yetki yok';
  end if;
  perform app.practice_expire_generation(p_set);  -- bekleme ekranı sonsuza dek yenilenmesin
  return app.practice_set_json(p_set);
end
$$;
comment on function public.get_practice_set(uuid) is 'Alıştırma setini (sorular, durum, özet, generation_failed) döner; bayat üretimi kapatır; öğrenci kendi, bağlı eğitmen, admin, worker.';

-- Bir soruyu notlar: secure.answer_keys ile (mcq: A–E şık; numeric: app.numeric_equal + tolerans) → attempts
-- (context 'practice', session_id = set) → her yaprak kazanım için observations(kind='practice', source_type='attempt',
-- yanlışta seçilen çeldiricinin yanılgı etiketi) → apply_observation. Aynı soruya ikinci cevap notlanmaz: ilk sonuç
-- already_answered = true ile döner. Kayıt bu soruyu daha önce (başka sette) cevapladıysa gözlem ustalık kanıtı
-- sayılmaz: counts_for_mastery = false, doğruysa ağırlık 0 (ustalık yükselmez), yanlışsa practice_repeat_wrong_weight. Döner: {set_id, question_id, no, correct, misconception_tag, misconception_text,
-- answered, total, remaining, already_answered}; doğru şık dönmez.
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
    v_weight := case when not v_repeat then 1
                     when v_correct then 0
                     else least(greatest(app.setting_num('practice_repeat_wrong_weight', 0.5), 0), 1) end;

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
comment on function public.answer_practice_item(uuid, uuid, text, int) is 'Alıştırma sorusunu gizli anahtarla notlar: attempts + observations(kind=practice) → BKT; doğru/yanlış ve çeldirici yanılgısını döner (anahtar dönmez).';

-- Seti bitirir ve özetini döner (idempotent: bitmiş setin özeti aynen döner). Hiç cevap yoksa durum 'abandoned'.
-- Özet: {set_id, status, total, answered, correct, wrong, unanswered, top_misconception {tag, text, count} | null,
-- weak_skill {skill_id, name, correct, total, band} | null, skills [{skill_id, name, correct, total}],
-- mastery [{skill_id, p_before, p_after}], finished_at}. Bitişte 'suggestions.refresh' işi kuyruğa atılır.
create or replace function public.finish_practice(p_set uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_ps public.practice_sets%rowtype;
  v_student uuid;
  v_min_n int := app.setting_num('min_evidence', 5)::int;
  v_total int;
  v_answered int;
  v_correct int;
  v_top jsonb;
  v_skills jsonb;
  v_weak jsonb;
  v_mastery jsonb;
  v_status text;
  v_summary jsonb;
begin
  select ps.* into v_ps from public.practice_sets ps where ps.id = p_set for update;
  if not found then
    raise exception using errcode = 'P0001', message = format('OGR-PRAC-001 set bulunamadı %s', p_set);
  end if;
  v_student := app.student_of_enrollment(v_ps.enrollment_id);
  perform app.assert_student_access(v_student, true);
  if v_ps.status in ('finished', 'abandoned') then
    return v_ps.summary;
  end if;

  select count(*), count(i.attempt_id), count(*) filter (where a.is_correct)
    into v_total, v_answered, v_correct
    from public.practice_set_items i left join public.attempts a on a.id = i.attempt_id
   where i.set_id = p_set;

  select jsonb_build_object('tag', z.tag, 'text', mt.text_student, 'count', z.n) into v_top
    from (select a.misconception_tag as tag, count(*) as n, max(a.created_at) as last_at
            from public.practice_set_items i join public.attempts a on a.id = i.attempt_id
           where i.set_id = p_set and not a.is_correct and a.misconception_tag is not null
           group by a.misconception_tag
           order by count(*) desc, max(a.created_at) desc, a.misconception_tag limit 1) as z
    join public.misconception_tags mt on mt.tag = z.tag;

  -- yaprak başına doğru/toplam (cevaplananlar); zayıf yaprak: en düşük doğru oranı, sonra çok yanlış, sonra düşük p
  with per as (
    select s.id as skill_id, s.name, count(*) as n, count(*) filter (where a.is_correct) as ok,
           m.p, m.evidence_count
      from public.practice_set_items i
      join public.attempts a on a.id = i.attempt_id
      join public.questions q on q.id = i.question_id
      join public.enrollments e on e.id = v_ps.enrollment_id
      join public.skills s on s.curriculum_id = e.curriculum_id and s.is_leaf and s.id = any(q.skill_ids)
      left join public.mastery m on m.enrollment_id = e.id and m.skill_id = s.id
     where i.set_id = p_set
     group by s.id, s.name, m.p, m.evidence_count
  )
  select coalesce(jsonb_agg(jsonb_build_object('skill_id', per.skill_id, 'name', per.name, 'correct', per.ok, 'total', per.n)
                            order by per.skill_id), '[]'::jsonb),
         (select jsonb_build_object('skill_id', w.skill_id, 'name', w.name, 'correct', w.ok, 'total', w.n,
                                    'band', case when coalesce(w.evidence_count, 0) < v_min_n then null
                                                 when w.p < 0.5 then 'low' when w.p < 0.8 then 'mid' else 'high' end)
            from per as w
           where w.ok < w.n
           order by w.ok::numeric / w.n, w.n - w.ok desc, w.p nulls last, w.skill_id limit 1)
    into v_skills, v_weak
    from per;

  select coalesce(jsonb_agg(jsonb_build_object('skill_id', z.skill_id, 'p_before', round(z.p_before, 3), 'p_after', round(z.p_after, 3))
                            order by z.skill_id), '[]'::jsonb)
    into v_mastery
    from (select h.skill_id,
                 (array_agg(h.p_before order by h.id))[1] as p_before,
                 (array_agg(h.p_after order by h.id desc))[1] as p_after
            from public.mastery_history h
            join public.observations o on o.id = h.observation_id
            join public.practice_set_items i on i.set_id = p_set and o.source_type = 'attempt' and o.source_id = i.attempt_id::text
           where h.enrollment_id = v_ps.enrollment_id and o.kind = 'practice'
           group by h.skill_id) as z;

  v_status := case when v_answered = 0 then 'abandoned' else 'finished' end;
  v_summary := jsonb_build_object(
    'set_id', p_set, 'status', v_status, 'total', v_total, 'answered', v_answered, 'correct', v_correct,
    'wrong', v_answered - v_correct, 'unanswered', v_total - v_answered, 'top_misconception', v_top, 'weak_skill', v_weak,
    'skills', v_skills, 'mastery', v_mastery, 'finished_at', now());
  update public.practice_sets ps set status = v_status, summary = v_summary, finished_at = now() where ps.id = p_set;
  perform app.try_enqueue('suggestions.refresh', jsonb_build_object('student_id', v_student, 'enrollment_id', v_ps.enrollment_id,
                                                                    'reason', 'practice.finished', 'set_id', p_set));
  return v_summary;
end
$$;
comment on function public.finish_practice(uuid) is 'Alıştırmayı bitirir: özet (doğru sayısı, en sık yanılgı, zayıf yaprak, ustalık değişimi) + suggestions.refresh işi; idempotent.';

revoke all on function app.practice_set_json(uuid), app.practice_target_leaves(uuid, text[]), app.practice_fill_items(uuid),
  app.practice_expire_generation(uuid) from public;
revoke all on function public.start_practice(uuid, uuid, text[], int), public.get_practice_set(uuid),
  public.answer_practice_item(uuid, uuid, text, int), public.finish_practice(uuid) from public;
grant execute on function public.start_practice(uuid, uuid, text[], int), public.get_practice_set(uuid),
  public.answer_practice_item(uuid, uuid, text, int), public.finish_practice(uuid) to authenticated, service_role;
