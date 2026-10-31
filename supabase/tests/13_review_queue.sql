-- tests/13_review_queue.sql — panel kuyruğu public.v_review_queue soru nedeni (0019_review_queue_reason.sql):
-- pipelines/tablet 2 deneme kuralıyla kuyruğa düşen LLM sorusunun notunu yalnız verification.review_note'a yazabilir
-- (batch_worker'ın questions.review_note yetkisi yok); görünüm nedeni coalesce(review_note, verification.review_note,
-- 'Soru incelemesi (<kaynak>)') ile verir. Görünümün sütunları, security_invoker seçeneği, yorumu ve yetkileri 0013 ile
-- aynı kalmalıdır.
begin;
\ir _fixture.sql
insert into t.cfg values ('matrix', :'matrix');

-- 'LLM question with only verification.review_note shows that note as the queue reason'
do $$
declare
  v_note constant text := '2 başarısız deneme: sympy doğrulaması iki kez düştü (cevap şıklarda yok)';
  v_q uuid;
  v_both uuid;
  v_plain uuid;
  v_reason text;
begin
  -- tablet boru hattının yazımı: batch_worker, verification içinde notla pending_review soru ekler
  perform t.as_batch();
  insert into public.questions (curriculum_id, skill_ids, kind, stem, options, source, content_hash, status, verification, model)
  values (t.u('cur'), array['tyt.mat.temel.rasyonel-sayilar'], 'mcq', 'Kuyruk sorusu: 3/4 - 1/4 = ?',
          '[{"key":"A","text":"1/2","misconception_tag":null},{"key":"B","text":"2/0","misconception_tag":null},
            {"key":"C","text":"1","misconception_tag":null},{"key":"D","text":"3","misconception_tag":null}]',
          'llm', 'review-queue-13-a', 'pending_review',
          jsonb_build_object('schema', true, 'sympy', 'failed', 'render', 'not_applicable', 'vision', 'not_applicable',
                             'attempts', 2, 'review_note', v_note),
          'gemini-2.5-flash')
  returning id into v_q;
  perform t.raises(format('update public.questions set review_note = %L where id = %L', v_note, v_q), '42501',
                   'batch_worker questions.review_note yazamaz (notun verification.review_note''a gitme nedeni)');
  perform t.as_admin();
  perform t.ok((select q.review_note is null and q.verification ->> 'review_note' = v_note from public.questions q where q.id = v_q),
               'soruda yalnız verification.review_note dolu (review_note null)');

  -- eğitmen notu her zaman önce gelir; ikisi de yoksa genel metin (0013 davranışı)
  insert into public.questions (curriculum_id, skill_ids, kind, stem, source, content_hash, status, verification, review_note)
  values (t.u('cur'), array['tyt.mat.temel.rasyonel-sayilar'], 'numeric', 'Kuyruk sorusu: 1/2 + 1/4 = ?', 'llm',
          'review-queue-13-b', 'pending_review', '{"attempts": 2, "review_note": "2 başarısız deneme: boru hattı notu"}',
          'Eğitmen notu: kökü sadeleştir')
  returning id into v_both;
  insert into public.questions (curriculum_id, skill_ids, kind, stem, source, content_hash, status)
  values (t.u('cur'), array['tyt.mat.temel.rasyonel-sayilar'], 'numeric', 'Kuyruk sorusu: 2/3 + 1/3 = ?', 'template',
          'review-queue-13-c', 'pending_review')
  returning id into v_plain;

  -- panel (eğitmen, security_invoker: kendi RLS'iyle) kuyruğu okur
  perform t.as_staff(t.u('inst_a'));
  select rq.reason into v_reason from public.v_review_queue rq where rq.kind = 'question' and rq.ref_id = v_q::text;
  perform t.ok(v_reason = v_note, format('v_review_queue nedeni verification.review_note (%s)', coalesce(v_reason, 'null')));
  perform t.ok((select rq.staff_hint = 'tyt.mat.temel.rasyonel-sayilar' and rq.student_ref is null
                  from public.v_review_queue rq where rq.kind = 'question' and rq.ref_id = v_q::text),
               'soru satırının diğer sütunları değişmedi (staff_hint = ilk kazanım, student_ref null)');
  perform t.ok((select rq.reason from public.v_review_queue rq where rq.kind = 'question' and rq.ref_id = v_both::text)
                 = 'Eğitmen notu: kökü sadeleştir',
               'review_note varsa verification.review_note''un önüne geçer');
  perform t.ok((select rq.reason from public.v_review_queue rq where rq.kind = 'question' and rq.ref_id = v_plain::text)
                 = 'Soru incelemesi (template)',
               'iki not da yoksa genel metin: Soru incelemesi (<kaynak>)');
  -- karar verilince (burada ret; onay anahtar ister) kuyruktan düşer
  perform public.approve_question(v_q, 'rejected', 'Şıklar hatalı');
  perform t.ok(not exists (select 1 from public.v_review_queue rq where rq.kind = 'question' and rq.ref_id = v_q::text),
               'karar verilen soru kuyruktan düşer');
  perform t.as_admin();
end $$;

-- 'v_review_queue keeps its 0013 shape, security_invoker option, comment and grants'
do $$
declare
  v_cols text;
  v_want_roles text[];
begin
  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.v_review_queue'::regclass and a.attnum > 0 and not a.attisdropped;
  perform t.ok(v_cols = 'kind:text,ref_id:text,created_at:timestamp with time zone,reason:text,student_ref:text,staff_hint:text',
               format('v_review_queue sütunları 0013 ile aynı (%s)', v_cols));
  perform t.ok((select c.reloptions = '{security_invoker=true}' from pg_class c where c.oid = 'public.v_review_queue'::regclass),
               'v_review_queue security_invoker=true (security_barrier yok; çağıranın RLS''i geçerli)');
  perform t.ok(obj_description('public.v_review_queue'::regclass, 'pg_class')
                 = 'Eğitmen kuyruğu (tek görünüm, union all); çağıranın RLS''i geçerli.',
               'v_review_queue yorumu korundu');
  perform t.ok((select r.rolname from pg_class c join pg_roles r on r.oid = c.relowner where c.oid = 'public.v_review_queue'::regclass)
                 = (select r.rolname from pg_class c join pg_roles r on r.oid = c.relowner where c.oid = 'public.questions'::regclass),
               'v_review_queue sahibi questions tablosunun sahibiyle aynı (migration sahibi)');
  -- yetkiler: matristeki gibi yalnız authenticated SELECT
  select array_agg(k order by k) into v_want_roles
    from jsonb_object_keys(t.v('matrix')::jsonb -> 'tables' -> 'public.v_review_queue') k;
  perform t.ok(v_want_roles = array['authenticated'], 'matris: v_review_queue yalnız authenticated');
  perform t.ok(has_table_privilege('authenticated', 'public.v_review_queue', 'select')
               and not has_table_privilege('authenticated', 'public.v_review_queue', 'insert, update, delete, truncate, references, trigger'),
               'authenticated v_review_queue üzerinde yalnız SELECT');
  perform t.ok(not has_table_privilege('bot_runtime', 'public.v_review_queue', 'select, insert, update, delete')
               and not has_table_privilege('batch_worker', 'public.v_review_queue', 'select, insert, update, delete')
               and not has_table_privilege('anon', 'public.v_review_queue', 'select, insert, update, delete'),
               'bot_runtime, batch_worker ve anon v_review_queue üzerinde yetki taşımaz');
  perform t.as_anon();
  perform t.raises($q$select count(*) from public.v_review_queue$q$, '42501', 'anon v_review_queue okuyamaz');
  perform t.as_admin();
end $$;

rollback;
