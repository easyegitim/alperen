-- tests/06_grading.sql — deneme notlama: start_exam_session → record_exam_response → grade_exam_session.
-- outcome (correct | wrong | blank | unfinished | null = notlanmadı), score (net = doğru − 0.25·yanlış, bölümler,
-- doğrulanmamış anahtar), observations(kind='test', guess_override 0.2; boş ağırlık 0.5; unfinished gözlemsiz) →
-- ustalık, style_coverage, durum 'analysing', exam.report işi, tekrar çağrının idempotentliği, hata kodları.
begin;
\ir _fixture.sql

do $$
declare
  v_exam uuid;
  v_style uuid;
  v_q uuid;
  v_i int;
  v_spec text[] := array['mcq|A|t.mat.a|Sayısal', 'mcq|B|t.mat.a|', 'numeric|0.5|t.mat.b|Sayısal', 'mcq|C|t.mat.b|Geometri',
                         'open||t.mat.a|', 'mcq||t.mat.b|', 'mcq|E|t.mat.a|', 'mcq|A|t.mat.b|'];
  v_p text[];
begin
  insert into public.question_styles (course_id, curriculum_id, code, name, skill_ids, status)
  values (t.u('course'), t.u('cur'), 'ST-G', 'Öncelik tuzağı', array['t.mat.a'], 'active') returning id into v_style;
  insert into public.exams (curriculum_id, course_id, kind, source, title, status, question_count, created_by)
  values (t.u('cur'), t.u('course'), 'published', 'instructor', 'Notlama Denemesi', 'published', 8, t.u('inst')) returning id into v_exam;
  insert into t.cfg values ('X', v_exam::text), ('style', v_style::text);
  for v_i in 1..8 loop
    v_p := string_to_array(v_spec[v_i], '|');
    insert into public.exam_questions (exam_id, no, kind, section, skill_ids, style_id)
    values (v_exam, v_i, v_p[1], nullif(v_p[4], ''), array[v_p[3]], case when v_i = 1 then v_style end) returning id into v_q;
    insert into t.cfg values ('Q' || v_i, v_q::text);
    if v_p[2] <> '' then
      if v_p[1] = 'numeric' then
        perform public.set_exam_key(v_q, null, v_p[2]::numeric);
      else
        perform public.set_exam_key(v_q, v_p[2]);
      end if;
    end if;
  end loop;
end $$;

-- Öğrenci oturumu açar, cevaplar, notlar
do $$
declare
  v_sess uuid;
  v_score jsonb;
  v_ans text[] := array['a', 'C', '1/2', null, 'Uzun açıklama', 'D', 'AB', null];
  v_i int;
begin
  perform t.as_user(t.u('elif'));
  v_sess := public.start_exam_session(t.u('X'), t.u('EA'));
  perform t.ok(public.start_exam_session(t.u('X'), t.u('EA')) = v_sess, 'süren oturum varken start_exam_session aynı oturumu döner');
  for v_i in 1..8 loop
    if v_ans[v_i] is not null then
      perform public.record_exam_response(v_sess, t.u('Q' || v_i), v_ans[v_i], 30 + v_i);
    end if;
  end loop;
  perform public.record_exam_response(v_sess, t.u('Q2'), 'C', 45, true);
  perform t.raises(format($q$select public.record_exam_response(%L, gen_random_uuid(), 'A')$q$, v_sess), 'OGR-EXAM-004%',
                   'başka sınavın sorusuna cevap yazılamaz');
  v_score := public.grade_exam_session(v_sess);
  perform t.as_admin();
  insert into t.cfg values ('S', v_sess::text), ('score', v_score::text);
  perform t.ok((v_score ->> 'total')::int = 8 and (v_score ->> 'correct')::int = 2 and (v_score ->> 'wrong')::int = 1
               and (v_score ->> 'blank')::int = 2 and (v_score ->> 'unfinished')::int = 1 and (v_score ->> 'ungraded')::int = 2,
               'skor: 8 soru, 2 doğru, 1 yanlış, 2 boş, 1 yetişmedi, 2 notlanmadı (' || (v_score - 'sections')::text || ')');
  perform t.ok((v_score ->> 'net')::numeric = 1.75 and (v_score ->> 'wrong_penalty')::numeric = 0.25, 'net = 2 − 0.25·1 = 1.75');
  perform t.ok((select (s.e ->> 'correct')::int = 2 and (s.e ->> 'total')::int = 2 from jsonb_array_elements(v_score -> 'sections') as s (e)
                 where s.e ->> 'section' = 'Sayısal')
               and (select (s.e ->> 'blank')::int = 1 from jsonb_array_elements(v_score -> 'sections') as s (e) where s.e ->> 'section' = 'Geometri')
               and jsonb_array_length(v_score -> 'sections') = 3, 'bölüm netleri (Sayısal, Genel, Geometri)');
end $$;

do $$
declare
  v_out text;
  v_p numeric := 0.3;
begin
  select string_agg(coalesce(r.outcome, '-'), ',' order by q.no) into v_out
    from public.exam_responses r join public.exam_questions q on q.id = r.exam_question_id where r.session_id = t.u('S');
  perform t.ok(v_out = 'correct,wrong,correct,blank,-,-,blank,unfinished',
               'outcome: küçük harf a doğru, 1/2 = 0.5, aradaki boş blank, geçersiz işaret (AB) blank, anahtarsız/açık uçlu null, sondaki boş unfinished (' || v_out || ')');
  perform t.ok((select count(*) from public.observations o where o.enrollment_id = t.u('EA') and o.source_type = 'exam_response') = 5
               and not exists (select 1 from public.observations o where o.enrollment_id = t.u('EA') and o.source_type = 'exam_response'
                                and (o.kind <> 'test' or o.guess_override <> 0.2)),
               '5 gözlem (doğru/yanlış/boş), hepsi kind=test, guess_override=0.2');
  perform t.ok((select o.weight from public.observations o join public.exam_responses r on r.id::text = o.source_id
                 where r.exam_question_id = t.u('Q4')) = 0.5, 'boş cevap gözlemi ağırlık 0.5');
  perform t.ok(not exists (select 1 from public.observations o join public.exam_responses r on r.id::text = o.source_id
                            where r.exam_question_id in (t.u('Q5'), t.u('Q6'), t.u('Q8'))), 'notlanmayan ve yetişmeyen soru gözlem üretmez');
  -- t.mat.a sırası: Q1 doğru, Q2 yanlış, Q7 boş (w 0.5); g = 0.2
  v_p := app.bkt_step(v_p, true, 0.2, 0.1, 0.1);
  v_p := round(v_p, 5);
  v_p := round(app.bkt_step(v_p, false, 0.2, 0.1, 0.1), 5);
  v_p := v_p + 0.5 * (app.bkt_step(v_p, false, 0.2, 0.1, 0.1) - v_p);
  perform t.ok((select abs(m.p - v_p) < 0.0001 and m.evidence_count = 3 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a'),
               'ustalık anında güncel: t.mat.a BKT zinciri (g = 0.2), kanıt 3');
  perform t.ok((select sc.seen_count = 1 and sc.solved_count = 1 and sc.correct_count = 1 from public.style_coverage sc
                 where sc.enrollment_id = t.u('EA') and sc.style_id = t.u('style')), 'style_coverage: tarzlı soru doğru');
  perform t.ok((select es.status = 'analysing' and es.finished_at is not null and es.duration_sec >= 0 and es.score = t.v('score')::jsonb
                  from public.exam_sessions es where es.id = t.u('S')), 'oturum analysing, bitiş ve süre yazıldı, skor saklandı');
  perform t.ok(exists (select 1 from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'exam.report'
                        and e.diff -> 'data' ->> 'session_id' = t.v('S')), 'exam.report işi aynı işlemde denendi');
end $$;

-- İdempotentlik ve bitmiş oturum kuralları
do $$
declare
  v_n int;
begin
  select count(*) into v_n from public.observations o where o.enrollment_id = t.u('EA');
  perform t.as_user(t.u('elif'));
  perform t.ok(public.grade_exam_session(t.u('S')) = t.v('score')::jsonb, 'tekrar notlama aynı skoru döner');
  perform t.raises(format($q$select public.record_exam_response(%L, %L, 'A')$q$, t.u('S'), t.u('Q2')), 'OGR-EXAM-003%',
                   'bitmiş oturumda cevap değiştirilemez');
  perform public.record_exam_response(t.u('S'), t.u('Q2'), null, null, null, null, 'İkinci adımda takıldım');
  perform t.as_admin();
  perform t.ok((select count(*) from public.observations o where o.enrollment_id = t.u('EA')) = v_n, 'tekrar notlama yeni gözlem yazmaz');
  perform t.ok((select r.how_far_text = 'İkinci adımda takıldım' and r.answer = 'C' and r.flagged from public.exam_responses r
                 where r.session_id = t.u('S') and r.exam_question_id = t.u('Q2')), 'bitmiş oturumda "nereye kadar geldim" yazılır, cevap korunur');
end $$;

-- Tekrar deneme: aynı sınav + kayıt için ikinci notlanan oturum ustalığı değiştirmez (anahtar avı / kanıt şişirme yok)
do $$
declare
  v_sess uuid;
  v_p0 numeric;
  v_n0 int;
begin
  select m.p, m.evidence_count into v_p0, v_n0 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a';
  perform t.as_user(t.u('elif'));
  v_sess := public.start_exam_session(t.u('X'), t.u('EA'));
  perform t.ok(v_sess <> t.u('S'), 'bitmiş oturumdan sonra yeni oturum açılır');
  perform public.record_exam_response(v_sess, t.u('Q1'), 'B');
  perform public.record_exam_response(v_sess, t.u('Q2'), 'B');
  perform public.grade_exam_session(v_sess);
  perform t.as_admin();
  perform t.ok((select m.p = v_p0 and m.evidence_count = v_n0 from public.mastery m where m.enrollment_id = t.u('EA') and m.skill_id = 't.mat.a'),
               'tekrar deneme: p ve kanıt sayısı değişmez');
  perform t.ok(exists (select 1 from public.observations o join public.exam_responses r on r.id::text = o.source_id where r.session_id = v_sess)
               and not exists (select 1 from public.observations o join public.exam_responses r on r.id::text = o.source_id
                                where r.session_id = v_sess and (o.weight <> 0 or o.counts_for_mastery)),
               'tekrar deneme gözlemleri ağırlık 0 ve kanıt dışı');
end $$;

-- Hata kodları ve yetki
do $$
declare
  v_draft uuid;
  v_cur2 uuid;
  v_other uuid;
  v_sess uuid;
begin
  insert into public.exams (curriculum_id, course_id, kind, source, title, status) values (t.u('cur'), t.u('course'), 'practice', 'generated', 'Taslak', 'draft')
  returning id into v_draft;
  insert into public.curricula (code, version, label, status) values ('T-DIGER', '1', 'Diğer', 'active') returning id into v_cur2;
  insert into public.exams (curriculum_id, kind, source, title, status) values (v_cur2, 'published', 'instructor', 'Başka müfredat', 'published')
  returning id into v_other;
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.start_exam_session(%L, %L)$q$, v_draft, t.u('EA')), 'OGR-EXAM-003%', 'taslak sınav uygulama içinde başlatılamaz');
  perform t.raises(format($q$select public.start_exam_session(%L, %L)$q$, v_other, t.u('EA')), 'OGR-EXAM-002%', 'müfredatı farklı sınav başlatılamaz');
  perform t.raises(format($q$select public.start_exam_session(%L, %L, 'kagit')$q$, t.u('X'), t.u('EA')), 'OGR-EXAM-001%', 'geçersiz kip');
  perform t.raises($q$select public.grade_exam_session(gen_random_uuid())$q$, 'OGR-EXAM-001%', 'olmayan oturum');
  perform t.as_user(t.u('can'));
  perform t.raises(format($q$select public.grade_exam_session(%L)$q$, t.u('S')), 'OGR-AUTH-001%', 'başka öğrencinin oturumu notlanamaz');
  v_sess := public.start_exam_session(t.u('X'), t.u('EB'));
  perform t.as_user(t.u('parent'));
  perform t.raises(format($q$select public.start_exam_session(%L, %L)$q$, t.u('X'), t.u('EA')), 'OGR-AUTH-001%', 'veli sınav başlatamaz');
  -- worker: yüklenen deneme (taslak sınav uploaded kipte) notlanır; cevapsız oturumda tüm sorular yetişmedi
  perform t.as_service();
  v_sess := public.start_exam_session(v_draft, t.u('EB'), 'uploaded');
  perform t.ok((public.grade_exam_session(v_sess) ->> 'total')::int = 0, 'worker yüklenen denemeyi (soru yok) notlar');
  perform t.as_admin();
end $$;

rollback;
