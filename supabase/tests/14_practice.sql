-- tests/14_practice.sql — alıştırma setleri (0021): öneriden start_practice → answer_practice_item → finish_practice.
-- Set onaylı ve anahtarı tam soru bankası sorularından kurulur (taslak/anahtarsız soru girmez; üst düğüm kodu alt
-- yapraklara açılır; yapraklar arasında sırayla; daha önce görülmemiş önce), öneri başlatılır, ikinci çağrı aynı seti
-- döner, şıklar yanılgı etiketsiz ve anahtar hiçbir yanıtta yok. Cevap gizli anahtarla notlanır: attempts(context
-- 'practice', session_id = set) + observations(kind 'practice', source_type 'attempt', çeldiricinin yanılgı etiketi) →
-- mastery değişir, yanılgı ve ön koşul çıkarımı işlenir; tekrar cevap notlanmaz. Bitiş özeti (doğru sayısı, en sık
-- yanılgı, zayıf yaprak, ustalık değişimi), idempotent; bitince cevap yok. Bankada soru yoksa needs_generation +
-- practice.generate işi. Yetki: başka öğrenci ve veli setlere erişemez; eğitmen öneriyi başlatamaz (açık OGR-AUTH-001).
-- Kötüye kullanım sınırları: koç yolunda tek açık set (kesişen kazanımda aynı set; boş bankada üretim işi bir kez),
-- günlük set sınırı (OGR-PRAC-007), tekrar görülen soru ustalığı yükseltmez ve kanıt sayılmaz, atanmış ve bitirilmemiş teşhis
-- sınavının soruları alıştırmaya girmez (bitince girer), hazırlanan taslak müfredatta OGR-PRAC-006. Canlı içerik: TYT
-- seed anahtarlarıyla set (atanmamış teşhisin soruları ilk alıştırmada; atanmış ve bitmemiş teşhisinki değil; 0027).
-- Sertleştirme (0027): banka yetiyorsa teşhis sorusu seçilmez; öğrenci figures.code/code_hash okuyamaz (42501), personel
-- v_figures_staff ile okur; anahtarı inferred LLM sorusunun gözlem ağırlığı practice_inferred_key_weight (0.5).
begin;
\ir _fixture.sql

-- Dünya: T-MAT yapraklarına 4 + 4 onaylı soru (biri sayısal) + taslak ve anahtarsız birer soru; doğru ve yanlış cevaplar
-- t.answers'ta (yalnız test; öğrenciye giden yanıtlarda anahtar yok)
create table t.answers (question_id uuid primary key, skill text not null, good text not null, bad text not null, bad_tag text);
grant select on t.answers to public;
do $$
declare
  v_q uuid;
  v_i int;
begin
  for v_i in 1..4 loop
    insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, content_hash, status)
    values (t.u('cur'), array['t.mat.a'], 'mcq', format('%s + 2 · 3 = ?', v_i),
            jsonb_build_array(jsonb_build_object('key', 'A', 'text', (v_i + 6)::text, 'misconception_tag', null),
                              jsonb_build_object('key', 'B', 'text', ((v_i + 2) * 3)::text, 'misconception_tag', 't.a.isaret-hatasi'),
                              jsonb_build_object('key', 'C', 'text', '0', 'misconception_tag', null),
                              jsonb_build_object('key', 'D', 'text', '1', 'misconception_tag', null)),
            'instructor', 'pr-a-' || v_i, 'approved')
    returning id into v_q;
    insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by)
    values (v_q, 'A', 'Önce çarpma.', 'verified', 'seed');
    insert into t.answers values (v_q, 't.mat.a', 'A', 'B', 't.a.isaret-hatasi');
  end loop;
  for v_i in 1..3 loop
    insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, content_hash, status)
    values (t.u('cur'), array['t.mat.b'], 'mcq', format('-(%s - 5) = ?', v_i),
            '[{"key":"A","text":"x"},{"key":"B","text":"y"},{"key":"C","text":"z"},{"key":"D","text":"w"}]', 'instructor', 'pr-b-' || v_i, 'approved')
    returning id into v_q;
    insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by) values (v_q, 'C', '-a + 5', 'verified', 'seed');
    insert into t.answers values (v_q, 't.mat.b', 'C', 'D', null);
  end loop;
  insert into public.questions (curriculum_id, skill_ids, kind, stem, source, content_hash, status)
  values (t.u('cur'), array['t.mat.b'], 'numeric', '-(1 - 4) kaçtır?', 'instructor', 'pr-b-num', 'approved') returning id into v_q;
  insert into secure.answer_keys (question_id, numeric_value, numeric_tolerance, solution, sympy_status, written_by)
  values (v_q, '3', 0, '-1 + 4 = 3', 'verified', 'seed');
  insert into t.answers values (v_q, 't.mat.b', '3,0', '-3', null);
  -- set dışı kalmalı: taslak soru (anahtarlı) ve anahtarsız onaylı soru
  insert into public.questions (curriculum_id, skill_ids, kind, stem, source, content_hash, status)
  values (t.u('cur'), array['t.mat.a'], 'mcq', 'taslak', 'llm', 'pr-draft', 'draft') returning id into v_q;
  insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by) values (v_q, 'A', 'x', 'verified', 'seed');
  insert into t.cfg values ('Q_DRAFT', v_q::text);
  insert into public.questions (curriculum_id, skill_ids, kind, stem, source, content_hash, status)
  values (t.u('cur'), array['t.mat.a'], 'mcq', 'anahtarsız', 'llm', 'pr-nokey', 'approved') returning id into v_q;
  insert into t.cfg values ('Q_NOKEY', v_q::text);
  -- worker önerileri: üst düğüm 't.mat' (iki yaprağa açılır), 6 soru; bir de deneme önerisi
  insert into public.suggestions (id, student_id, enrollment_id, kind, title, payload, rank) values
    ('50000000-0000-4000-8000-0000000000a1', t.u('A'), t.u('EA'), 'practice', 'İşlem önceliği', '{"skill_ids": ["t.mat"], "count": 6}', 0),
    ('50000000-0000-4000-8000-0000000000a2', t.u('A'), t.u('EA'), 'mini_exam', 'Mini deneme', '{}', 1),
    ('50000000-0000-4000-8000-0000000000b1', t.u('B'), t.u('EB'), 'practice', 'Can', '{"count": 2}', 0);
  insert into t.cfg values ('SUG', '50000000-0000-4000-8000-0000000000a1'), ('SUG_EXAM', '50000000-0000-4000-8000-0000000000a2'),
    ('SUG_B', '50000000-0000-4000-8000-0000000000b1');
end $$;

-- Başla: set kurulur
do $$
declare
  v_s jsonb;
  v_s2 jsonb;
  v_seq text;
begin
  perform t.as_user(t.u('elif'));
  v_s := public.start_practice(t.u('SUG'));
  perform t.as_admin();
  insert into t.cfg values ('SET', v_s ->> 'set_id');
  perform t.as_user(t.u('elif'));
  perform t.ok(v_s ->> 'status' = 'in_progress' and (v_s ->> 'total')::int = 6 and jsonb_array_length(v_s -> 'items') = 6
               and (v_s ->> 'answered')::int = 0 and v_s -> 'skill_ids' = '["t.mat.a", "t.mat.b"]'::jsonb,
               'öneriden set: 6 soru, üst düğüm iki yaprağa açıldı, in_progress');
  select string_agg(e.x -> 'skill_ids' ->> 0, ',' order by (e.x ->> 'no')::int) into v_seq from jsonb_array_elements(v_s -> 'items') as e (x);
  perform t.ok(v_seq = 't.mat.a,t.mat.b,t.mat.a,t.mat.b,t.mat.a,t.mat.b', 'yapraklar arasında sırayla (' || v_seq || ')');
  perform t.ok(not exists (select 1 from jsonb_array_elements(v_s -> 'items') as e (x)
                            where e.x ->> 'question_id' in (t.v('Q_DRAFT'), t.v('Q_NOKEY'))), 'taslak ve anahtarsız soru sete girmez');
  perform t.ok(position('misconception_tag' in (v_s -> 'items')::text) = 0 and position('correct_option' in v_s::text) = 0
               and position('Önce çarpma' in v_s::text) = 0, 'şıklarda yanılgı etiketi, yanıtta anahtar ve çözüm yok');
  perform t.ok((select s.consumed_at is not null from public.suggestions s where s.id = t.u('SUG')), 'öneri başlatıldı işaretlendi');
  v_s2 := public.start_practice(t.u('SUG'));
  perform t.ok(v_s2 ->> 'set_id' = v_s ->> 'set_id', 'aynı öneri için ikinci çağrı aynı seti döner');
  perform t.ok(t.n('select 1 from public.practice_sets') = 1 and t.n('select 1 from public.practice_set_items') = 6,
               'öğrenci kendi setini ve sorularını görür (RLS)');
  perform t.raises(format($q$select public.start_practice(%L)$q$, t.u('SUG_EXAM')), 'OGR-PRAC-002%', 'deneme önerisi alıştırma değildir');
  perform t.raises(format($q$select public.start_practice(%L)$q$, t.u('SUG_B')), '42501', 'başka öğrencinin önerisi başlatılamaz');
  perform t.as_user(t.u('inst'));
  perform t.raises(format($q$select public.start_practice(%L)$q$, t.u('SUG_B')), 'OGR-AUTH-001 öneriyi yalnız%',
                   'owner eğitmen öneriyi başlatamaz (açık hata, öneri tüketilmez)');
  perform t.as_admin();
  perform t.ok((select s.consumed_at is null from public.suggestions s where s.id = t.u('SUG_B')), 'eğitmen denemesinden sonra öneri tüketilmedi');
  perform t.as_user(t.u('elif'));
  perform t.raises($q$select public.start_practice(gen_random_uuid())$q$, 'OGR-SUG-001%', 'olmayan öneri');
  perform t.raises($q$select public.start_practice(null)$q$, 'OGR-PRAC-001%', 'öneri ya da kayıt gerekli');
  perform t.raises(format($q$select public.start_practice(null, %L, array['t.mat.yok'])$q$, t.u('EA')), 'OGR-PRAC-001%', 'müfredatta olmayan kazanım');
  perform t.raises(format($q$select public.start_practice(null, %L)$q$, t.u('EB')), '42501', 'başka öğrencinin kaydı');
  perform t.as_admin();
end $$;

-- Cevaplar: ilk t.mat.a sorusu yanlış (yanılgılı çeldirici), ilk t.mat.b sorusu yanlış, kalanlar (biri hariç) doğru
do $$
declare
  v_items jsonb := public.get_practice_set(t.u('SET')) -> 'items';
  v_it jsonb;
  v_a t.answers%rowtype;
  v_r jsonb;
  v_p0 numeric := (select s.p_init from public.skills s where s.curriculum_id = t.u('cur') and s.id = 't.mat.a');
  v_first_a uuid;
  v_first_b uuid;
  v_last uuid;
begin
  select (e.x ->> 'question_id')::uuid into v_first_a from jsonb_array_elements(v_items) as e (x) where (e.x ->> 'no')::int = 1;
  select (e.x ->> 'question_id')::uuid into v_first_b from jsonb_array_elements(v_items) as e (x) where (e.x ->> 'no')::int = 2;
  select (e.x ->> 'question_id')::uuid into v_last from jsonb_array_elements(v_items) as e (x) where (e.x ->> 'no')::int = 6;
  insert into t.cfg values ('QA1', v_first_a::text), ('QB1', v_first_b::text), ('QLAST', v_last::text);

  perform t.as_user(t.u('elif'));
  select a.* into v_a from t.answers a where a.question_id = v_first_a;
  v_r := public.answer_practice_item(t.u('SET'), v_first_a, lower(v_a.bad), 41000);
  perform t.ok(not (v_r ->> 'correct')::boolean and v_r ->> 'misconception_tag' = 't.a.isaret-hatasi'
               and v_r ->> 'misconception_text' = 'Eksiyi parantezin içine dağıtırken her terimin işaretine bak.'
               and (v_r ->> 'answered')::int = 1 and (v_r ->> 'remaining')::int = 5 and (v_r ->> 'no')::int = 1
               and not (v_r ->> 'already_answered')::boolean and position('correct_option' in v_r::text) = 0,
               'yanlış cevap: çeldiricinin yanılgı etiketi ve öğrenci metni döner, anahtar dönmez');
  perform t.as_admin();
  perform t.ok((select a.context = 'practice' and a.session_id = t.u('SET') and a.chosen = '{"key": "B"}'::jsonb and not a.is_correct
                       and a.misconception_tag = 't.a.isaret-hatasi' and a.response_ms = 41000 and a.graded_at is not null
                  from public.attempts a where a.question_id = v_first_a), 'attempts satırı (practice, set oturumu, seçim, notlama)');
  perform t.ok((select count(*) from public.observations o join public.attempts a on o.source_type = 'attempt' and o.source_id = a.id::text
                 where a.question_id = v_first_a and o.kind = 'practice' and o.skill_id = 't.mat.a' and o.value = 0
                   and o.misconception_tag = 't.a.isaret-hatasi' and o.applied_at is not null and o.counts_for_mastery) = 1,
               'observations(kind=practice, source_type=attempt, yanılgı etiketli) uygulandı');
  perform t.ok((select m.p < v_p0 and m.evidence_count = 1 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a'),
               'yanlış cevap t.mat.a ustalığını düşürür');
  perform t.ok(exists (select 1 from public.observations o where o.enrollment_id = t.u('EA') and o.kind = 'inferred' and o.skill_id = 't.mat.b'),
               'yanılgının ön koşul çıkarımı (t.mat.b) işlendi');
  perform t.ok(exists (select 1 from public.misconceptions mc where mc.enrollment_id = t.u('EA') and mc.tag = 't.a.isaret-hatasi'),
               'yanılgı sayacı açıldı');

  perform t.as_user(t.u('elif'));
  v_r := public.answer_practice_item(t.u('SET'), v_first_a, 'A');
  perform t.ok((v_r ->> 'already_answered')::boolean and not (v_r ->> 'correct')::boolean and (v_r ->> 'answered')::int = 1,
               'tekrar cevap notlanmaz: ilk sonuç döner');
  select a.* into v_a from t.answers a where a.question_id = v_first_b;
  v_r := public.answer_practice_item(t.u('SET'), v_first_b, v_a.bad);
  perform t.ok(not (v_r ->> 'correct')::boolean and v_r -> 'misconception_tag' = 'null'::jsonb, 'yanılgısız çeldirici: etiket null');
  perform t.raises(format($q$select public.answer_practice_item(%L, %L, 'A')$q$, t.u('SET'), t.u('Q_DRAFT')), 'OGR-PRAC-004%', 'set dışı soru');
  perform t.raises(format($q$select public.answer_practice_item(%L, %L, '  ')$q$, t.u('SET'), v_last), 'OGR-PRAC-005%', 'boş cevap');
  for v_it in select e.x from jsonb_array_elements(v_items) as e (x) where (e.x ->> 'no')::int between 3 and 5 loop
    select a.* into v_a from t.answers a where a.question_id = (v_it ->> 'question_id')::uuid;
    if (v_it ->> 'kind') = 'mcq' then
      perform t.raises(format($q$select public.answer_practice_item(%L, %L, 'Z')$q$, t.u('SET'), v_a.question_id), 'OGR-PRAC-005%', 'şık A–E olmalı');
    end if;
    v_r := public.answer_practice_item(t.u('SET'), v_a.question_id, v_a.good);
    perform t.ok((v_r ->> 'correct')::boolean, format('doğru cevap (%s, %s)', v_it ->> 'kind', v_a.good));
  end loop;
  perform t.as_user(t.u('can'));
  perform t.raises(format($q$select public.answer_practice_item(%L, %L, 'A')$q$, t.u('SET'), v_last), '42501', 'başka öğrenci cevap yazamaz');
  perform t.raises(format($q$select public.get_practice_set(%L)$q$, t.u('SET')), '42501', 'başka öğrenci seti okuyamaz');
  perform t.ok(t.n('select 1 from public.practice_sets') = 0 and t.n('select 1 from public.practice_set_items') = 0, 'başka öğrenci setleri görmez (RLS)');
  perform t.as_user(t.u('parent'));
  perform t.raises(format($q$select public.get_practice_set(%L)$q$, t.u('SET')), '42501', 'veli seti okuyamaz');
  perform t.ok(t.n('select 1 from public.practice_sets') = 0, 'veli setleri görmez (RLS)');
  perform t.as_user(t.u('inst'));
  perform t.ok((public.get_practice_set(t.u('SET')) ->> 'answered')::int = 5 and t.n('select 1 from public.practice_sets') = 1,
               'bağlı eğitmen seti okur');
  perform t.as_user(t.u('elif'));
  perform t.raises($q$insert into public.practice_sets (enrollment_id) values ('20000000-0000-4000-8000-0000000000ea')$q$, '42501',
                   'öğrenci practice_sets''e doğrudan yazamaz');
  perform t.raises($q$update public.attempts set is_correct = true$q$, '42501', 'öğrenci attempts''i değiştiremez');
  perform t.as_admin();
end $$;

-- Bitiş: özet, idempotent, sonrasında cevap yok, suggestions.refresh işi
do $$
declare
  v_sum jsonb;
  v_sum2 jsonb;
  v_items jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_sum := public.finish_practice(t.u('SET'));
  perform t.ok(v_sum ->> 'status' = 'finished' and (v_sum ->> 'total')::int = 6 and (v_sum ->> 'answered')::int = 5
               and (v_sum ->> 'correct')::int = 3 and (v_sum ->> 'wrong')::int = 2 and (v_sum ->> 'unanswered')::int = 1,
               'özet: 6 soruda 5 cevap, 3 doğru, 2 yanlış, 1 boş (' || v_sum::text || ')');
  perform t.ok(v_sum -> 'top_misconception' ->> 'tag' = 't.a.isaret-hatasi' and (v_sum -> 'top_misconception' ->> 'count')::int = 1
               and v_sum -> 'top_misconception' ->> 'text' like 'Eksiyi%', 'en sık yanılgı (etiket, öğrenci metni, sayı)');
  perform t.ok(v_sum -> 'weak_skill' ->> 'skill_id' in ('t.mat.a', 't.mat.b') and v_sum -> 'weak_skill' ->> 'name' is not null
               and v_sum -> 'weak_skill' -> 'band' = 'null'::jsonb, 'zayıf yaprak (kanıt < min_evidence: bant yok)');
  perform t.ok(jsonb_array_length(v_sum -> 'skills') = 2
               and (select sum((e.x ->> 'total')::int) from jsonb_array_elements(v_sum -> 'skills') as e (x)) = 5,
               'yaprak başına doğru/toplam');
  perform t.ok((select bool_and((e.x ->> 'p_before')::numeric <> (e.x ->> 'p_after')::numeric) from jsonb_array_elements(v_sum -> 'mastery') as e (x))
               and jsonb_array_length(v_sum -> 'mastery') = 2, 'ustalık değişimi iki yaprakta görünür');
  v_sum2 := public.finish_practice(t.u('SET'));
  perform t.ok(v_sum2 = v_sum, 'finish_practice idempotent');
  perform t.raises(format($q$select public.answer_practice_item(%L, %L, 'A')$q$, t.u('SET'), t.u('QLAST')), 'OGR-PRAC-003%', 'bitmiş sete cevap yazılamaz');
  v_items := public.get_practice_set(t.u('SET')) -> 'items';
  perform t.ok((select count(*) from jsonb_array_elements(v_items) as e (x) where (e.x ->> 'answered')::boolean) = 5
               and (select count(*) from jsonb_array_elements(v_items) as e (x) where e.x -> 'correct' = 'false'::jsonb) = 2,
               'get_practice_set: cevaplandı/doğru bilgisi');
  perform t.as_admin();
  perform t.ok((select ps.status = 'finished' and ps.finished_at is not null and ps.summary = v_sum from public.practice_sets ps where ps.id = t.u('SET')),
               'set satırı: finished, özet saklı');
  perform t.ok(exists (select 1 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'suggestions.refresh'
                        and e.diff -> 'data' ->> 'set_id' = t.v('SET')), 'suggestions.refresh işi denendi (pgboss yokken audit)');
  perform t.ok((select (sum(m.evidence_count)) from public.mastery m where m.enrollment_id = t.u('EA')) = 5,
               'kanıt sayısı: 5 cevap = 5 gözlem (çıkarım sayılmaz)');
end $$;

-- Koçtan açılan set: kayıt + kazanım; daha önce görülmemiş sorular önce; tek açık koç seti; varsayılan hedef
do $$
declare
  v_s jsonb;
  v_s2 jsonb;
  v_s3 jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_s := public.start_practice(null, t.u('EA'), array['t.mat.b'], 2);
  perform t.ok(v_s ->> 'status' = 'in_progress' and (v_s ->> 'total')::int = 2 and v_s -> 'suggestion_id' = 'null'::jsonb
               and not exists (select 1 from jsonb_array_elements(v_s -> 'items') as e (x)
                                where (e.x ->> 'question_id')::uuid in (select a.question_id from public.attempts a where a.enrollment_id = t.u('EA'))),
               'koç seti: 2 soru, yalnız t.mat.b, önceki setteki sorular değil');
  v_s2 := public.start_practice(null, t.u('EA'), array['t.mat.b'], 5);
  perform t.ok(v_s2 ->> 'set_id' = v_s ->> 'set_id', 'açık koç seti varken kesişen kazanımda aynı set döner (yeni set yok)');
  v_s3 := public.start_practice(null, t.u('EA'), array['t.mat.a'], 3);
  perform t.ok(v_s3 ->> 'set_id' <> v_s ->> 'set_id' and (v_s3 ->> 'total')::int = 3
               and (public.get_practice_set((v_s ->> 'set_id')::uuid) ->> 'status') = 'abandoned',
               'kesişmeyen kazanım: yeni set, eski açık koç seti kapandı (cevapsız → abandoned)');
  perform t.ok(public.finish_practice((v_s3 ->> 'set_id')::uuid) ->> 'status' = 'abandoned', 'koç seti kapatıldı');
  v_s := public.start_practice(null, t.u('EA'), null, 50);
  perform t.ok((v_s ->> 'target_count')::int = 10 and (v_s ->> 'total')::int = 8, 'soru sayısı en çok 10; bankadaki 8 soru');
  perform t.as_admin();
  insert into t.cfg values ('SET8', v_s ->> 'set_id');
end $$;

-- Tekrar görülen soru: ustalık kanıtı sayılmaz (doğru: ağırlık 0, ustalık değişmez; yanlış: düşük ağırlık); yeni soru sayılır
do $$
declare
  v_seen_ok uuid;
  v_seen_bad uuid := t.u('QA1');
  v_fresh uuid;
  v_a t.answers%rowtype;
  v_r jsonb;
  v_p numeric;
  v_n int;
  v_obs public.observations%rowtype;
  v_set uuid := t.u('SET8');
begin
  select a.question_id into v_seen_ok from public.attempts a
   where a.enrollment_id = t.u('EA') and a.is_correct and a.context = 'practice' order by a.id limit 1;
  select i.question_id into v_fresh from public.practice_set_items i
   where i.set_id = v_set and not exists (select 1 from public.attempts a where a.enrollment_id = t.u('EA') and a.question_id = i.question_id)
   order by i.no limit 1;
  perform t.ok(v_seen_ok is not null and v_fresh is not null
               and exists (select 1 from public.practice_set_items i where i.set_id = v_set and i.question_id = v_seen_ok)
               and exists (select 1 from public.practice_set_items i where i.set_id = v_set and i.question_id = v_seen_bad),
               'bankası biten sette daha önce görülmüş sorular da var');

  select a.* into v_a from t.answers a where a.question_id = v_seen_ok;
  select m.p, m.evidence_count into v_p, v_n from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = v_a.skill;
  perform t.as_user(t.u('elif'));
  v_r := public.answer_practice_item(v_set, v_seen_ok, v_a.good);
  perform t.as_admin();
  perform t.ok((v_r ->> 'correct')::boolean, 'tekrar soru doğru notlanır (öğrenci sonucu görür)');
  select o.* into v_obs from public.observations o join public.attempts a on o.source_type = 'attempt' and o.source_id = a.id::text
   where a.session_id = v_set and a.question_id = v_seen_ok;
  perform t.ok(not v_obs.counts_for_mastery and v_obs.weight = 0 and v_obs.applied_at is not null,
               'tekrar doğru: gözlem kanıt sayılmaz, ağırlık 0');
  perform t.ok((select m.p = v_p and m.evidence_count = v_n from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = v_a.skill),
               'tekrar doğru cevap ustalığı yükseltmez, kanıt sayısı aynı');

  select a.* into v_a from t.answers a where a.question_id = v_seen_bad;
  select m.evidence_count into v_n from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = v_a.skill;
  perform t.as_user(t.u('elif'));
  v_r := public.answer_practice_item(v_set, v_seen_bad, v_a.bad);
  perform t.as_admin();
  select o.* into v_obs from public.observations o join public.attempts a on o.source_type = 'attempt' and o.source_id = a.id::text
   where a.session_id = v_set and a.question_id = v_seen_bad and o.kind = 'practice';
  perform t.ok(not (v_r ->> 'correct')::boolean and not v_obs.counts_for_mastery and v_obs.weight = 0.5
               and (select m.evidence_count = v_n from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = v_a.skill),
               'tekrar yanlış: kanıt sayılmaz, ağırlık 0.5');

  select a.* into v_a from t.answers a where a.question_id = v_fresh;
  select m.evidence_count into v_n from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = v_a.skill;
  perform t.as_user(t.u('elif'));
  v_r := public.answer_practice_item(v_set, v_fresh, v_a.good);
  perform t.as_admin();
  perform t.ok((select m.evidence_count = v_n + 1 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = v_a.skill)
               and (select bool_and(o.counts_for_mastery and o.weight = 1) from public.observations o
                      join public.attempts a on o.source_type = 'attempt' and o.source_id = a.id::text
                     where a.session_id = v_set and a.question_id = v_fresh and o.kind = 'practice'),
               'ilk kez görülen soru kanıt sayılır (ağırlık 1)');
end $$;

-- Günlük set sınırı (koç yolu): sınıra gelince OGR-PRAC-007; açık set yine döner
do $$
declare
  v_n int;
  v_s jsonb;
begin
  select count(*) into v_n from public.practice_sets ps where ps.enrollment_id = t.u('EA') and ps.suggestion_id is null;
  insert into public.settings (key, value, description) values ('practice_daily_sets', to_jsonb(v_n), 'test')
  on conflict (key) do update set value = excluded.value;
  perform t.as_user(t.u('elif'));
  v_s := public.start_practice(null, t.u('EA'), array['t.mat.a']);
  perform t.ok(v_s ->> 'set_id' = t.v('SET8'), 'sınırda da açık set döner');
  perform public.finish_practice(t.u('SET8'));
  perform t.raises(format($q$select public.start_practice(null, %L)$q$, t.u('EA')), 'OGR-PRAC-007%', 'günlük koç seti sınırı');
  perform t.as_admin();
  update public.settings st set value = '10'::jsonb where st.key = 'practice_daily_sets';
end $$;

-- Teşhis sınavının soruları (0027): atanmamış teşhis sorusu ilk alıştırmada kullanılır (yeni öğrencinin bankası boş
-- kalmasın); kayda atanmış (oturumu açık ya da etkin önerisi sınavı gösteriyor) ve bitmemiş teşhisin sorusu girmez;
-- bitirince yine girer. Deneme/yayımlanmış sınav bitirilmedikçe hiç girmez.
do $$
declare
  v_q uuid;
  v_q2 uuid;
  v_exam uuid;
  v_deneme uuid;
  v_sess uuid;
  v_sug uuid;
  v_s jsonb;
begin
  insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, content_hash, status)
  values (t.u('cur'), array['t.mat.a'], 'mcq', 'teşhis sorusu', '[{"key":"A","text":"1"},{"key":"B","text":"2"}]', 'instructor', 'pr-diag', 'approved')
  returning id into v_q;
  insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by) values (v_q, 'B', 'x', 'verified', 'seed');
  insert into public.exams (course_id, curriculum_id, kind, source, title, status, question_count)
  values (t.u('course'), t.u('cur'), 'diagnostic', 'instructor', 'Test teşhisi', 'published', 1) returning id into v_exam;
  insert into public.exam_questions (exam_id, no, kind, skill_ids, question_id) values (v_exam, 1, 'mcq', array['t.mat.a'], v_q);
  -- deneme sorusu: bitirilmedikçe hiçbir kayıtta alıştırmaya girmez
  insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, content_hash, status)
  values (t.u('cur'), array['t.mat.a'], 'mcq', 'deneme sorusu', '[{"key":"A","text":"1"},{"key":"B","text":"2"}]', 'instructor', 'pr-deneme', 'approved')
  returning id into v_q2;
  insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by) values (v_q2, 'A', 'x', 'verified', 'seed');
  insert into public.exams (course_id, curriculum_id, kind, source, title, status, question_count)
  values (t.u('course'), t.u('cur'), 'deneme', 'instructor', 'Test denemesi', 'ready', 1) returning id into v_deneme;
  insert into public.exam_questions (exam_id, no, kind, skill_ids, question_id) values (v_deneme, 1, 'mcq', array['t.mat.a'], v_q2);
  update public.settings st set value = '100'::jsonb where st.key = 'practice_daily_sets';
  if not found then
    insert into public.settings (key, value, description) values ('practice_daily_sets', '100'::jsonb, 'test');
  end if;
  perform t.ok(not app.practice_exam_blocks(t.u('EA'), v_q) and app.practice_exam_blocks(t.u('EA'), v_q2),
               'yardımcı: atanmamış teşhis serbest, bitirilmemiş deneme dışlı');

  -- atanmamış teşhis: soru alıştırmaya girer (yeni öğrenci), deneme sorusu girmez
  perform t.as_user(t.u('elif'));
  v_s := public.start_practice(null, t.u('EA'), array['t.mat.a'], 10);
  perform t.ok(exists (select 1 from jsonb_array_elements(v_s -> 'items') as e (x) where (e.x ->> 'question_id')::uuid = v_q)
               and not exists (select 1 from jsonb_array_elements(v_s -> 'items') as e (x) where (e.x ->> 'question_id')::uuid = v_q2)
               and (v_s ->> 'total')::int = 5, 'atanmamış teşhisin sorusu alıştırmaya girer, deneme sorusu girmez (' || (v_s ->> 'total') || ')');
  perform public.finish_practice((v_s ->> 'set_id')::uuid);

  -- banka yetiyorsa teşhis sorusu seçilmez (yaprakta en sona; öbür sorular daha önce görülmüş olsa bile)
  v_s := public.start_practice(null, t.u('EA'), array['t.mat.a'], 4);
  perform t.ok((v_s ->> 'total')::int = 4
               and not exists (select 1 from jsonb_array_elements(v_s -> 'items') as e (x) where (e.x ->> 'question_id')::uuid = v_q),
               'teşhis dışı banka sorusu varken teşhis sorusu seçilmez (' || (v_s ->> 'total') || ')');
  perform public.finish_practice((v_s ->> 'set_id')::uuid);

  -- etkin öneri teşhisi gösteriyor (atanmış, bitmemiş): girmez
  perform t.as_admin();
  insert into public.suggestions (student_id, enrollment_id, kind, title, payload, rank)
  values (t.u('A'), t.u('EA'), 'mini_exam', 'Teşhis testi', jsonb_build_object('exam_id', v_exam), 5) returning id into v_sug;
  perform t.ok(app.practice_exam_blocks(t.u('EA'), v_q) and not app.practice_exam_blocks(t.u('EB'), v_q),
               'öneriyle atanmış teşhis yalnız o öğrencinin kaydında dışlı');
  perform t.as_user(t.u('elif'));
  v_s := public.start_practice(null, t.u('EA'), array['t.mat.a'], 10);
  perform t.ok(not exists (select 1 from jsonb_array_elements(v_s -> 'items') as e (x) where (e.x ->> 'question_id')::uuid = v_q)
               and (v_s ->> 'total')::int = 4, 'öneriyle atanmış ve bitmemiş teşhisin sorusu alıştırmaya girmez (' || (v_s ->> 'total') || ')');
  perform public.finish_practice((v_s ->> 'set_id')::uuid);

  -- öneri gitti ama oturum açık (bitmemiş): yine girmez
  perform t.as_admin();
  delete from public.suggestions sg where sg.id = v_sug;
  insert into public.exam_sessions (exam_id, enrollment_id, mode, status) values (v_exam, t.u('EA'), 'in_app', 'in_progress') returning id into v_sess;
  perform t.as_user(t.u('elif'));
  v_s := public.start_practice(null, t.u('EA'), array['t.mat.a'], 10);
  perform t.ok(not exists (select 1 from jsonb_array_elements(v_s -> 'items') as e (x) where (e.x ->> 'question_id')::uuid = v_q),
               'oturumu açık (bitmemiş) teşhisin sorusu alıştırmaya girmez');
  perform public.finish_practice((v_s ->> 'set_id')::uuid);

  -- teşhis bitti: girer
  perform t.as_admin();
  update public.exam_sessions es set status = 'done', finished_at = now() where es.id = v_sess;
  perform t.as_user(t.u('elif'));
  v_s := public.start_practice(null, t.u('EA'), array['t.mat.a'], 10);
  perform t.ok(exists (select 1 from jsonb_array_elements(v_s -> 'items') as e (x) where (e.x ->> 'question_id')::uuid = v_q),
               'teşhis bitince sorusu alıştırmaya girer');
  perform public.finish_practice((v_s ->> 'set_id')::uuid);

  -- Can'e teşhis atanmadı: soru onun alıştırmasına da girer; deneme sorusu girmez
  perform t.as_user(t.u('can'));
  v_s := public.start_practice(null, t.u('EB'), array['t.mat.a'], 10);
  perform t.ok(exists (select 1 from jsonb_array_elements(v_s -> 'items') as e (x) where (e.x ->> 'question_id')::uuid = v_q)
               and not exists (select 1 from jsonb_array_elements(v_s -> 'items') as e (x) where (e.x ->> 'question_id')::uuid = v_q2),
               'atanmamış kayıtta (Can) teşhis sorusu girer, bitirilmemiş deneme sorusu girmez');
  perform t.as_admin();
  delete from public.practice_sets ps where ps.enrollment_id = t.u('EB');
end $$;

-- Boş banka → needs_generation; ikinci çağrı aynı set, üretim işi bir kez; zaman aşımında set yeniden denenir ya da
-- generation_timeout ile kapanır (koç ve öneri yolu); hazırlanan taslak müfredatta OGR-PRAC-006
do $$
declare
  v_s jsonb;
  v_s2 jsonb;
  v_cur uuid;
  v_course uuid;
  v_enr uuid;
  v_q uuid;
  v_sug uuid;
begin
  perform t.as_admin();
  insert into public.curricula (code, version, label, status) values ('T-BOS', '1', 'Boş', 'active') returning id into v_cur;
  insert into public.skills (curriculum_id, id, name, is_leaf) values (v_cur, 'bos.a', 'Boş yaprak', true);
  insert into public.question_templates (id, curriculum_id, skill_id, module_path, engine, params_schema)
  values ('t-bos-sablon', v_cur, 'bos.a', 'x.py:generate', 'python', '{}');
  insert into public.courses (code, title, curriculum_id, visibility) values ('T-BOS', 'Boş ders', v_cur, 'shared') returning id into v_course;
  insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values (t.u('A'), v_cur, v_course, 'YKS 2027') returning id into v_enr;
  perform t.as_user(t.u('elif'));
  v_s := public.start_practice(null, v_enr);
  perform t.ok(v_s ->> 'status' = 'needs_generation' and (v_s ->> 'total')::int = 0 and v_s -> 'items' = '[]'::jsonb
               and (v_s ->> 'target_count')::int = 8, 'bankada soru yok: boş set, needs_generation, varsayılan 8 soru');
  v_s2 := public.start_practice(null, v_enr);
  perform t.ok(v_s2 ->> 'set_id' = v_s ->> 'set_id', 'boş bankada ikinci çağrı aynı hazırlanan seti döner');
  perform t.raises(format($q$select public.answer_practice_item(%L, %L, 'A')$q$, v_s ->> 'set_id', t.u('QA1')), 'OGR-PRAC-004%', 'boş sette soru yok');
  perform t.as_admin();
  perform t.ok(exists (select 1 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'practice.generate'
                        and e.diff -> 'data' ->> 'set_id' = v_s ->> 'set_id' and e.diff -> 'data' -> 'template_ids' = '["t-bos-sablon"]'::jsonb
                        and e.diff -> 'data' -> 'skill_ids' = '["bos.a"]'::jsonb), 'practice.generate işi (set, yapraklar, şablonlar)');
  perform t.ok((select count(*) from audit.events e where e.diff ->> 'name' = 'practice.generate'
                 and e.diff -> 'data' ->> 'enrollment_id' = v_enr::text) = 1, 'practice.generate bu kayıt için bir kez denendi');
  perform t.ok((select count(*) from public.practice_sets ps where ps.enrollment_id = v_enr) = 1, 'tek hazırlanan set');
  perform t.ok(not (v_s ->> 'generation_failed')::boolean, 'taze hazırlanan set: generation_failed yok');

  -- bayat üretim (practice_generation_timeout_s aşıldı): get_practice_set bankayı yeniden dener, boşsa kapatır
  update public.practice_sets ps set started_at = now() - interval '11 minutes' where ps.id = (v_s ->> 'set_id')::uuid;
  perform t.as_user(t.u('elif'));
  v_s2 := public.get_practice_set((v_s ->> 'set_id')::uuid);
  perform t.ok(v_s2 ->> 'status' = 'abandoned' and (v_s2 ->> 'generation_failed')::boolean
               and v_s2 -> 'summary' ->> 'reason' = 'generation_timeout' and v_s2 -> 'summary' ->> 'status' = 'abandoned'
               and (v_s2 -> 'summary' ->> 'total')::int = 0 and v_s2 ->> 'finished_at' is not null,
               'bayat set: abandoned, generation_failed, özet generation_timeout (' || (v_s2 - 'items')::text || ')');
  perform t.ok(public.finish_practice((v_s ->> 'set_id')::uuid) ->> 'reason' = 'generation_timeout', 'kapanan bayat set: finish_practice özeti aynen');
  v_s2 := public.start_practice(null, v_enr);
  perform t.ok(v_s2 ->> 'set_id' <> v_s ->> 'set_id' and v_s2 ->> 'status' = 'needs_generation'
               and not (v_s2 ->> 'generation_failed')::boolean, 'koç yolu: bayat set yerine yeni set açılır');
  perform t.as_admin();
  perform t.ok((select count(*) from audit.events e where e.diff ->> 'name' = 'practice.generate'
                 and e.diff -> 'data' ->> 'enrollment_id' = v_enr::text) = 2, 'yeni sette practice.generate yeniden atıldı');
  perform t.ok(exists (select 1 from audit.events e where e.diff ->> 'name' = 'suggestions.refresh'
                        and e.diff -> 'data' ->> 'reason' = 'practice.generation_timeout'
                        and e.diff -> 'data' ->> 'set_id' = v_s ->> 'set_id'), 'zaman aşımında suggestions.refresh işi');

  -- koç yolu bayat seti: başlatma çağrısı da kapatır; bu arada bankaya soru geldiyse set dolar ve in_progress olur
  update public.practice_sets ps set started_at = now() - interval '11 minutes' where ps.id = (v_s2 ->> 'set_id')::uuid;
  insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, content_hash, status)
  values (v_cur, array['bos.a'], 'mcq', 'geç gelen soru', '[{"key":"A","text":"1"},{"key":"B","text":"2"}]', 'instructor', 'pr-bos-late', 'approved')
  returning id into v_q;
  insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by) values (v_q, 'A', 'x', 'verified', 'seed');
  perform t.as_user(t.u('elif'));
  v_s := public.start_practice(null, v_enr);
  perform t.ok(v_s ->> 'set_id' = v_s2 ->> 'set_id' and v_s ->> 'status' = 'in_progress' and (v_s ->> 'total')::int = 1
               and not (v_s ->> 'generation_failed')::boolean, 'bayat sete soru geldiyse yeniden denemede dolar (in_progress)');
  perform t.ok(public.finish_practice((v_s ->> 'set_id')::uuid) ->> 'status' = 'abandoned', 'cevapsız set abandoned kapanır');

  -- öneri yolu: aynı öneri bayat seti kapatır, sonsuza dek beklemez
  perform t.as_admin();
  insert into public.suggestions (student_id, enrollment_id, kind, title, payload, rank)
  values (t.u('A'), v_enr, 'practice', 'Boş öneri', '{"skill_ids": ["bos.a"]}', 0) returning id into v_sug;
  delete from secure.answer_keys k where k.question_id = v_q;
  perform t.as_user(t.u('elif'));
  v_s := public.start_practice(v_sug);
  perform t.ok(v_s ->> 'status' = 'needs_generation', 'öneri: boş bankada needs_generation');
  perform t.as_admin();
  update public.practice_sets ps set started_at = now() - interval '11 minutes' where ps.id = (v_s ->> 'set_id')::uuid;
  perform t.as_user(t.u('elif'));
  v_s2 := public.start_practice(v_sug);
  perform t.ok(v_s2 ->> 'set_id' = v_s ->> 'set_id' and v_s2 ->> 'status' = 'abandoned' and (v_s2 ->> 'generation_failed')::boolean,
               'öneri yolu: aynı öneri bayat seti generation_timeout ile kapatır');

  -- onboarding'de açılan kazanımsız ai_draft taslak (draft_status queued): hazırlanıyor
  perform t.as_admin();
  insert into public.curricula (code, version, label, status, origin) values ('T-TASLAK', '1', 'Taslak', 'draft', 'ai_draft') returning id into v_cur;
  insert into public.courses (code, title, curriculum_id, visibility) values ('T-TASLAK', 'Taslak ders', v_cur, 'shared') returning id into v_course;
  insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values (t.u('A'), v_cur, v_course, 'YKS 2027') returning id into v_enr;
  perform t.ok((select c.draft_status = 'queued' from public.curricula c where c.id = v_cur), 'taslak kuyrukta');
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.start_practice(null, %L)$q$, v_enr), 'OGR-PRAC-006%', 'taslak hazırlanırken koç seti: müfredat hazırlanıyor');
  perform t.as_admin();
  update public.curricula c set draft_status = 'failed' where c.id = v_cur;
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.start_practice(null, %L)$q$, v_enr), 'OGR-PRAC-001%', 'taslak düştüyse kazanım yok hatası');
  perform t.as_admin();
end $$;

-- Worker yazım yolu (0027): register_practice_questions (yalnız worker; şablon + LLM sorusu, gizli anahtar, şablon şekli,
-- content_hash tekrarsız, geçersiz madde atlanır) → bekleyen set dolar ve in_progress olur; practice_bank_status;
-- fail_practice_generation kalıcı hatada seti generation_failed ile kapatır
do $$
declare
  v_cur uuid;
  v_course uuid;
  v_enr uuid;
  v_s jsonb;
  v_r jsonb;
  v_b jsonb;
  v_items jsonb;
  v_st text;
  v_fig uuid;
  v_it jsonb;
begin
  perform t.as_admin();
  insert into public.curricula (code, version, label, status) values ('T-URET', '1', 'Üretim', 'active') returning id into v_cur;
  insert into public.skills (curriculum_id, id, name, is_leaf) values (v_cur, 'uret', 'Kök', false);
  insert into public.skills (curriculum_id, id, name, is_leaf, parent_id) values (v_cur, 'uret.a', 'Yaprak A', true, 'uret'), (v_cur, 'uret.b', 'Yaprak B', true, 'uret');
  insert into public.question_templates (id, curriculum_id, skill_id, module_path, engine, params_schema)
  values ('t-uret-sablon', v_cur, 'uret.a', 'x.py:generate', 'sympy', '{}');
  insert into public.courses (code, title, curriculum_id, visibility) values ('T-URET', 'Üretim dersi', v_cur, 'shared') returning id into v_course;
  insert into public.enrollments (student_id, curriculum_id, course_id, period_label) values (t.u('A'), v_cur, v_course, 'YKS 2027') returning id into v_enr;

  v_b := public.practice_bank_status(v_enr, array['uret']);
  perform t.ok((v_b ->> 'practicable')::boolean and jsonb_array_length(v_b -> 'leaves') = 2
               and v_b -> 'leaves' -> 0 ->> 'skill_id' = 'uret.a' and (v_b -> 'leaves' -> 0 ->> 'available')::int = 0
               and v_b -> 'leaves' -> 0 -> 'templates' = '["t-uret-sablon"]'::jsonb and v_b -> 'leaves' -> 1 -> 'templates' = '[]'::jsonb,
               'banka durumu: iki yaprak, soru yok, şablon listesi (' || v_b::text || ')');

  perform t.as_user(t.u('elif'));
  v_s := public.start_practice(null, v_enr, array['uret'], 3);
  perform t.ok(v_s ->> 'status' = 'needs_generation', 'üretim dünyası: boş banka, needs_generation');
  perform t.raises(format($q$select public.register_practice_questions(%L, '[]'::jsonb, %L)$q$, v_cur, v_s ->> 'set_id'), 'OGR-AUTH-002%',
                   'öğrenci banka sorusu yazamaz');
  perform t.raises(format($q$select public.fail_practice_generation(%L, 'x')$q$, v_s ->> 'set_id'), 'OGR-AUTH-002%', 'öğrenci seti üretim hatasıyla kapatamaz');
  perform t.raises(format($q$select public.practice_bank_status(%L)$q$, v_enr), 'OGR-AUTH-002%', 'öğrenci banka durumunu okuyamaz');
  perform t.as_admin();

  v_items := jsonb_build_array(
    -- şablon sorusu (SymPy doğrulanmış, şekilli)
    jsonb_build_object('source', 'template', 'kind', 'mcq', 'stem', 'Şekildeki kesirlerin toplamı?', 'skill_ids', jsonb_build_array('uret.a'),
                       'options', '[{"key":"A","text":"1/2","misconception_tag":null},{"key":"B","text":"3/4","misconception_tag":"t.a.isaret-hatasi"},{"key":"C","text":"1","misconception_tag":null},{"key":"D","text":"2","misconception_tag":null}]'::jsonb,
                       'difficulty', 0.5, 'content_hash', 'uret-tpl-1', 'template_id', 't-uret-sablon', 'template_params', '{"a": 1}'::jsonb,
                       'figure', jsonb_build_object('code', 'kod', 'code_hash', 'uret-fig-1', 'alt_text', 'İki model', 'png_path', 'figures/uret-fig-1.png', 'width_px', 400, 'height_px', 300, 'bytes', 4000),
                       'key', jsonb_build_object('correct_option', 'b', 'solution', 'Paydalar eşitlenir.', 'sympy_status', 'verified', 'canonical_expr', 'Rational(3,4)')),
    -- LLM sorusu (sayısal; anahtar çıkarım)
    jsonb_build_object('source', 'llm', 'kind', 'numeric', 'stem', 'x + 2 = 5 ise x kaçtır?', 'skill_ids', jsonb_build_array('uret.b', 'yok.boyle'),
                       'content_hash', 'uret-llm-1', 'model', 'claude-opus-5-5', 'cost_usd', 0.01, 'prompt_version', 'worker-question_generation',
                       'verification', '{"schema": true, "sympy": "inferred", "render": "not_applicable", "vision": "not_applicable", "attempts": 1, "origin": "llm"}'::jsonb,
                       'key', jsonb_build_object('numeric_value', '3', 'solution', 'x = 5 - 2 = 3', 'sympy_status', 'not_applicable', 'sympy_report', '{"status": "inferred"}'::jsonb)),
    -- atlanır: müfredatta olmayan yaprak; mcq'da doğru şık seçeneklerde yok; anahtarsız; SymPy düştü
    jsonb_build_object('source', 'llm', 'kind', 'mcq', 'stem', 'yanlış yaprak', 'skill_ids', '["yok.boyle"]'::jsonb, 'content_hash', 'uret-bad-1',
                       'options', '[{"key":"A","text":"1"},{"key":"B","text":"2"},{"key":"C","text":"3"},{"key":"D","text":"4"}]'::jsonb,
                       'key', '{"correct_option": "A", "solution": "x", "sympy_status": "not_applicable"}'::jsonb),
    jsonb_build_object('source', 'llm', 'kind', 'mcq', 'stem', 'şıkta yok', 'skill_ids', '["uret.a"]'::jsonb, 'content_hash', 'uret-bad-2',
                       'options', '[{"key":"A","text":"1"},{"key":"B","text":"2"},{"key":"C","text":"3"},{"key":"D","text":"4"}]'::jsonb,
                       'key', '{"correct_option": "E", "solution": "x", "sympy_status": "not_applicable"}'::jsonb),
    jsonb_build_object('source', 'llm', 'kind', 'numeric', 'stem', 'anahtarsız', 'skill_ids', '["uret.a"]'::jsonb, 'content_hash', 'uret-bad-3'),
    jsonb_build_object('source', 'template', 'kind', 'numeric', 'stem', 'sympy düştü', 'skill_ids', '["uret.a"]'::jsonb, 'content_hash', 'uret-bad-4',
                       'key', '{"numeric_value": "1", "solution": "x", "sympy_status": "failed"}'::jsonb));
  v_r := public.register_practice_questions(v_cur, v_items, (v_s ->> 'set_id')::uuid);
  perform t.ok((v_r ->> 'inserted')::int = 2 and (v_r ->> 'skipped')::int = 4 and (v_r ->> 'reused')::int = 0
               and (v_r ->> 'filled')::int = 2 and v_r ->> 'status' = 'in_progress', 'worker: 2 soru yazıldı, 4 madde atlandı, set doldu (' || v_r::text || ')');
  perform t.ok((select q.status = 'approved' and q.source = 'template' and q.figure_id is not null and q.template_id = 't-uret-sablon'
                       and q.verification ->> 'sympy' = 'verified' and k.correct_option = 'B' and k.sympy_status = 'verified'
                       and k.written_by = 'worker:practice.generate' and k.verified_at is not null and f.review_status = 'verified'
                       and f.tool = 'template' and f.png_path = 'figures/uret-fig-1.png'
                  from public.questions q join secure.answer_keys k on k.question_id = q.id join public.figures f on f.id = q.figure_id
                 where q.content_hash = 'uret-tpl-1'), 'şablon sorusu: approved, şekli verified, anahtar verified (büyük harf)');
  perform t.ok((select q.status = 'approved' and q.source = 'llm' and q.skill_ids = array['uret.b'] and q.verification ->> 'sympy' = 'inferred'
                       and q.model = 'claude-opus-5-5' and k.numeric_value = '3' and k.sympy_status = 'not_applicable' and k.verified_at is null
                       and k.sympy_report ->> 'status' = 'inferred'
                  from public.questions q join secure.answer_keys k on k.question_id = q.id where q.content_hash = 'uret-llm-1'),
               'LLM sorusu: approved ama verification.sympy inferred; müfredat dışı yaprak atıldı');
  perform t.as_user(t.u('elif'));
  v_s := public.get_practice_set((v_s ->> 'set_id')::uuid);
  perform t.ok(v_s ->> 'status' = 'in_progress' and (v_s ->> 'total')::int = 2 and v_s -> 'items' -> 0 -> 'figure' ->> 'png_path' is not null
               and position('correct_option' in v_s::text) = 0 and position('misconception_tag' in v_s::text) = 0,
               'öğrenci seti görür: şekilli şablon sorusu, anahtar ve yanılgı etiketi yok');
  -- şekil kaynağı (şablon parametreleri: cevabı taşıyabilir) öğrenciye kapalı; gösterim sütunları açık (0027)
  v_fig := (v_s -> 'items' -> 0 -> 'figure' ->> 'id')::uuid;
  perform t.raises(format($q$select f.code from public.figures f where f.id = %L$q$, v_fig), '42501', 'öğrenci figures.code okuyamaz');
  perform t.raises(format($q$select f.code_hash from public.figures f where f.id = %L$q$, v_fig), '42501', 'öğrenci figures.code_hash okuyamaz');
  perform t.raises('select * from public.figures', '42501', 'öğrenci figures select=* yapamaz');
  perform t.ok(t.n(format($q$select f.id, f.png_path, f.alt_text, f.width_px from public.figures f where f.id = %L$q$, v_fig)) = 1,
               'öğrenci şeklin gösterim sütunlarını okur');
  perform t.ok(t.n('select 1 from public.v_figures_staff') = 0, 'öğrenci personel şekil görünümünde satır görmez');
  perform t.as_user(t.u('inst'));
  perform t.ok((select v.code = 'kod' and v.code_hash = 'uret-fig-1' from public.v_figures_staff v where v.id = v_fig),
               'eğitmen şeklin kaynağını v_figures_staff ile okur');
  -- anahtarı doğrulanmamış (inferred) LLM sorusu: gözlem ağırlığı practice_inferred_key_weight (0.5); şablon sorusu 1
  perform t.as_user(t.u('elif'));
  for v_it in select x from jsonb_array_elements(v_s -> 'items') as e (x) loop
    perform public.answer_practice_item((v_s ->> 'set_id')::uuid, (v_it ->> 'question_id')::uuid,
                                        case when v_it ->> 'kind' = 'numeric' then '3' else 'B' end);
  end loop;
  perform t.as_admin();
  perform t.ok((select bool_and(o.weight = case when q.source = 'llm' then 0.5 else 1 end and o.counts_for_mastery and o.value = 1)
                       and count(*) = 2
                  from public.attempts a join public.questions q on q.id = a.question_id
                  join public.observations o on o.source_type = 'attempt' and o.source_id = a.id::text
                 where a.session_id = (v_s ->> 'set_id')::uuid),
               'inferred anahtarlı LLM sorusunun gözlem ağırlığı 0.5, doğrulanmış şablon sorusununki 1');
  perform t.as_user(t.u('elif'));
  perform public.finish_practice((v_s ->> 'set_id')::uuid);
  perform t.as_admin();

  -- tekrar yazım tekrarsız (content_hash); set yoksa yalnız banka
  v_r := public.register_practice_questions(v_cur, v_items);
  perform t.ok((v_r ->> 'inserted')::int = 0 and (v_r ->> 'reused')::int = 2 and v_r ->> 'status' is null, 'aynı sorular yeniden yazılmaz (reused)');
  perform t.ok((public.practice_bank_status(v_enr, array['uret']) -> 'leaves' -> 0 ->> 'available')::int = 1, 'banka durumu yeni soruyu sayar');
  perform t.raises(format($q$select public.register_practice_questions(%L, '{}'::jsonb)$q$, v_cur), 'OGR-PRAC-009%', 'p_items dizi olmalı');
  perform t.raises(format($q$select public.register_practice_questions(%L, '[]'::jsonb, %L)$q$, t.u('cur'), (v_s ->> 'set_id')), 'OGR-PRAC-001%',
                   'set başka müfredatın');

  -- kalıcı üretim hatası: soru yoksa set generation_failed ile hemen kapanır (istemci 600 sn beklemez)
  delete from secure.answer_keys k using public.questions q where q.id = k.question_id and q.curriculum_id = v_cur;
  perform t.as_user(t.u('elif'));
  v_s := public.start_practice(null, v_enr, array['uret.b'], 3);
  perform t.as_admin();
  v_st := public.fail_practice_generation((v_s ->> 'set_id')::uuid, 'LLM reddetti');
  perform t.as_user(t.u('elif'));
  v_s := public.get_practice_set((v_s ->> 'set_id')::uuid);
  perform t.ok(v_st = 'abandoned' and v_s ->> 'status' = 'abandoned' and (v_s ->> 'generation_failed')::boolean
               and v_s -> 'summary' ->> 'reason' = 'generation_failed' and v_s -> 'summary' ->> 'detail' = 'LLM reddetti',
               'fail_practice_generation: abandoned + generation_failed (' || (v_s - 'items')::text || ')');
  perform t.as_admin();
  perform t.ok(public.fail_practice_generation((v_s ->> 'set_id')::uuid) = 'abandoned', 'kapanmış sette tekrar çağrı durumu döner');
  perform t.ok(exists (select 1 from audit.events e where e.diff ->> 'name' = 'suggestions.refresh'
                        and e.diff -> 'data' ->> 'reason' = 'practice.generation_failed' and e.diff -> 'data' ->> 'set_id' = v_s ->> 'set_id'),
               'üretim hatasında suggestions.refresh işi');
end $$;

-- Canlı içerik: TYT-MAT seed anahtarlarıyla (seed-keys.py --schema v2) set kurulur ve notlanır
insert into t.cfg values ('have_keys', :'have_keys');
do $$
declare
  v_cur uuid;
  v_enr uuid;
  v_s jsonb;
  v_q uuid;
  v_key text;
  v_r jsonb;
begin
  if t.v('have_keys') <> '1' then
    raise notice 'SKIP: no keys';
    return;
  end if;
  select c.id into v_cur from public.curricula c where c.code = 'TYT-MAT' and c.version = '2026.1';
  insert into public.enrollments (student_id, curriculum_id, period_label) values (t.u('B'), v_cur, 'YKS 2027') returning id into v_enr;
  perform t.as_user(t.u('can'));
  -- yeni öğrenci (teşhis atanmadı): TYT teşhis soruları ilk alıştırmada bankadır (0027)
  v_s := public.start_practice(null, v_enr, array['tyt.mat.temel'], 4);
  perform t.as_admin();  -- exam_questions öğrenciye kapalı (RLS): denetim admin olarak
  perform t.ok(v_s ->> 'status' = 'in_progress' and (v_s ->> 'total')::int = 4
               and (select count(*) from jsonb_array_elements(v_s -> 'items') as e (x)
                     where exists (select 1 from public.exam_questions eq join public.exams x on x.id = eq.exam_id and x.kind = 'diagnostic'
                                    where eq.question_id = (e.x ->> 'question_id')::uuid)) = 4,
               'TYT: atanmamış teşhisin soruları ilk alıştırmada (' || (v_s ->> 'status') || ', ' || (v_s ->> 'total') || ' soru)');
  perform t.as_user(t.u('can'));
  perform public.finish_practice((v_s ->> 'set_id')::uuid);
  -- teşhis atandı (oturum açık, bitmedi): soruları alıştırmaya girmez; şablonlu yaprakta boş banka → practice.generate
  perform t.as_admin();
  insert into public.exam_sessions (exam_id, enrollment_id, mode, status)
  select x.id, v_enr, 'in_app', 'in_progress' from public.exams x where x.kind = 'diagnostic' and x.curriculum_id = v_cur;
  perform t.as_user(t.u('can'));
  v_s := public.start_practice(null, v_enr, array['tyt.mat.temel.sayilar'], 4);
  perform t.ok(v_s ->> 'status' = 'needs_generation' and (v_s ->> 'total')::int = 0,
               'TYT: atanmış ve bitmemiş teşhisin sorusu alıştırmada yok (' || (v_s ->> 'status') || ', ' || (v_s ->> 'total') || ' soru)');
  perform t.as_admin();
  perform t.ok(exists (select 1 from audit.events e where e.diff ->> 'name' = 'practice.generate' and e.diff -> 'data' ->> 'set_id' = v_s ->> 'set_id'
                        and e.diff -> 'data' -> 'template_ids' = '["islem-onceligi"]'::jsonb), 'TYT: practice.generate işinde şablon (islem-onceligi)');
  perform t.ok((public.practice_bank_status(v_enr, array['tyt.mat.temel.sayilar']) -> 'leaves' -> 0 ->> 'available')::int = 0,
               'TYT: banka durumu atanmış teşhisin sorularını saymaz');
  perform t.as_user(t.u('can'));
  perform public.finish_practice((v_s ->> 'set_id')::uuid);
  -- teşhis bitince (oturum finished_at) seed soruları yine alıştırmaya girer
  perform t.as_admin();
  update public.exam_sessions es set status = 'done', finished_at = now() where es.enrollment_id = v_enr;
  perform t.as_user(t.u('can'));
  v_s := public.start_practice(null, v_enr, array['tyt.mat.temel'], 4);
  perform t.ok(v_s ->> 'status' = 'in_progress' and (v_s ->> 'total')::int = 4, 'teşhis bitince TYT seed sorularıyla 4 soruluk set (' || (v_s ->> 'total') || ')');
  v_q := (v_s -> 'items' -> 0 ->> 'question_id')::uuid;
  perform t.as_admin();
  select k.correct_option into v_key from secure.answer_keys k where k.question_id = v_q;
  perform t.as_user(t.u('can'));
  v_r := public.answer_practice_item((v_s ->> 'set_id')::uuid, v_q, v_key);
  perform t.ok((v_r ->> 'correct')::boolean, 'seed anahtarıyla doğru cevap');
  perform t.as_admin();
  perform t.ok((select m.evidence_count = 1 and m.p <> (select s.p_init from public.skills s where s.curriculum_id = v_cur and s.id = m.skill_id)
                  from public.mastery m where m.enrollment_id = v_enr limit 1), 'TYT ustalığı değişti');
end $$;

rollback;
