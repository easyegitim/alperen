-- tests/36_instructor_queue.sql — eğitmen Kuyruk (0050): instructor_queue, resolve_instructor_note,
-- approve_spend_capped_request ve worker'ın consume_spend_cap_approval / record_spend_cap_hold'u. Admin her türü görür;
-- bağlı eğitmen yalnız bağlı öğrencilerinin ve kendi dersinin/müfredatının öğelerini; bağsız eğitmen hiçbirini; öğrenci
-- ve veli 42501. Not kapatma ve onay kapsam dışında 42501; onay bir kez kaydedilir (ikinci çağrı no-op), worker bir kez
-- tüketir.
begin;
\ir _fixture.sql

select t.add_outsiders();

do $$
declare
  v_doc uuid;
  v_req uuid;
  v_lesson uuid;
  v_an uuid;
begin
  -- koç yönlendirmeleri: A (bağlı eğitmene), C (bağsız öğrenci; admin'e)
  insert into public.notifications (id, recipient_id, kind, title, body, payload) values
    ('36000000-0000-4000-8000-0000000000a1', t.u('inst'), 'coach_escalation', 'Koç bir öğrenciyi sana yönlendirdi',
     'Koç bu konuyu sana yönlendirdi: türev', jsonb_build_object('student_id', t.u('A'), 'conversation_id', gen_random_uuid())),
    ('36000000-0000-4000-8000-0000000000c1', t.u('admin'), 'coach_escalation', 'Koç bir öğrenciyi sana yönlendirdi',
     'Koç bu konuyu sana yönlendirdi: limit', jsonb_build_object('student_id', t.u('C'), 'conversation_id', gen_random_uuid()));
  insert into t.cfg values ('noteA', '36000000-0000-4000-8000-0000000000a1'), ('noteC', '36000000-0000-4000-8000-0000000000c1');

  -- incelemedeki belgeler
  insert into public.generated_documents (id, student_id, course_id, kind, title, status) values
    ('36000000-0000-4000-8000-0000000000a2', t.u('A'), t.u('course'), 'notes', 'A inceleme notu', 'review'),
    ('36000000-0000-4000-8000-0000000000c2', t.u('C'), t.u('course'), 'notes', 'C inceleme notu', 'review');
  insert into t.cfg values ('revA', '36000000-0000-4000-8000-0000000000a2'), ('revC', '36000000-0000-4000-8000-0000000000c2');

  -- tavanda duran istekler (worker kaydı)
  insert into public.generated_documents (student_id, course_id, kind, title, status)
  values (t.u('A'), t.u('course'), 'notes', 'A tavan notu', 'failed') returning id into v_doc;
  insert into public.document_requests (student_id, enrollment_id, course_id, kind, source, status, generated_document_id, error)
  values (t.u('A'), t.u('EA'), t.u('course'), 'notes', 'chat', 'failed', v_doc, 'Bugünkü üretim sınırına ulaşıldı') returning id into v_req;
  insert into t.cfg values ('capA', v_req::text), ('capDocA', v_doc::text);
  insert into public.generated_documents (student_id, course_id, kind, title, status)
  values (t.u('C'), t.u('course'), 'notes', 'C tavan notu', 'failed') returning id into v_doc;
  insert into public.document_requests (student_id, enrollment_id, course_id, kind, source, status, generated_document_id, error)
  values (t.u('C'), t.u('EC2'), t.u('course'), 'notes', 'chat', 'failed', v_doc, 'Bugünkü üretim sınırına ulaşıldı') returning id into v_req;
  insert into t.cfg values ('capC', v_req::text);
  perform public.record_spend_cap_hold('document', t.u('capA'));
  perform public.record_spend_cap_hold('document', t.u('capC'));

  -- eşik altı ders iddiaları: A'nın dersi (2 düşük + 1 yüksek güven) ve C'nin dersi
  insert into public.lessons (enrollment_id, held_at) values (t.u('EA'), now() - interval '1 day') returning id into v_lesson;
  insert into t.cfg values ('lessonA', v_lesson::text);
  insert into public.lesson_analyses (lesson_id, seed_profile, analysis, model) values (v_lesson, '{}', '{}', 'test') returning id into v_an;
  insert into public.lesson_claims (analysis_id, kind, value, confidence, quote, speaker, t_start_sec) values
    (v_an, 'question', '{}', 0.40, 'neden?', 'ÖĞRENCİ', 10),
    (v_an, 'question', '{}', null, 'peki?', 'ÖĞRENCİ', 20),
    (v_an, 'question', '{}', 0.95, 'tamam', 'ÖĞRENCİ', 30);
  insert into public.lessons (enrollment_id, held_at) values (t.u('EC2'), now() - interval '1 day') returning id into v_lesson;
  insert into t.cfg values ('lessonC', v_lesson::text);
  insert into public.lesson_analyses (lesson_id, seed_profile, analysis, model) values (v_lesson, '{}', '{}', 'test') returning id into v_an;
  insert into public.lesson_claims (analysis_id, kind, value, confidence, quote, speaker, t_start_sec) values
    (v_an, 'question', '{}', 0.30, 'hı?', 'ÖĞRENCİ', 10);

  -- açık müfredat önerisi (eğitmenin dersinin müfredatı)
  insert into public.curriculum_proposals (id, curriculum_id, kind, payload)
  values ('36000000-0000-4000-8000-0000000000a5', t.u('cur'), 'add_subskill',
          jsonb_build_object('name', 'Üslü ifadeler', 'review', jsonb_build_object('action', 'needs_instructor')));
  insert into t.cfg values ('prop', '36000000-0000-4000-8000-0000000000a5');
end $$;

create function t.q_has(p_q jsonb, p_kind text, p_id uuid) returns boolean language sql immutable as $$
  select exists (select 1 from jsonb_array_elements(p_q) as x where x ->> 'kind' = p_kind and x ->> 'id' = p_id::text)
$$;
create function t.q_item(p_q jsonb, p_id uuid) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(p_q) as x where x ->> 'id' = p_id::text limit 1
$$;
grant execute on function t.q_has(jsonb, text, uuid), t.q_item(jsonb, uuid) to public;

-- Admin: her tür, her öğrenci
do $$
declare
  v jsonb;
begin
  perform t.as_user(t.u('admin'));
  v := public.instructor_queue();
  perform t.ok(t.q_has(v, 'coach_note', t.u('noteA')) and t.q_has(v, 'coach_note', t.u('noteC')), 'admin koç notlarını görür');
  perform t.ok(t.q_has(v, 'spend_cap', t.u('capA')) and t.q_has(v, 'spend_cap', t.u('capC')), 'admin tavanda duran istekleri görür');
  perform t.ok(t.q_has(v, 'review_document', t.u('revA')) and t.q_has(v, 'review_document', t.u('revC')), 'admin incelemedeki belgeleri görür');
  perform t.ok(t.q_has(v, 'lesson_claims', t.u('lessonA')) and t.q_has(v, 'lesson_claims', t.u('lessonC')), 'admin eşik altı iddiaları görür');
  perform t.ok(t.q_has(v, 'curriculum_proposal', t.u('prop')), 'admin açık öneriyi görür');
  perform t.ok(t.q_item(v, t.u('lessonA')) ->> 'detail' like '2 düşük güvenli%', 'eşik üstü iddia sayılmaz (2 iddia)');
  perform t.ok(t.q_item(v, t.u('lessonA')) ->> 'href' = '/egitmen/dersler/' || t.v('lessonA'), 'iddia bağlantısı derse');
  perform t.ok(t.q_item(v, t.u('prop')) ->> 'href' = '/egitmen/mufredatlar/' || t.v('cur')
               and t.q_item(v, t.u('prop')) ->> 'detail' like '%eğitmene bırakıldı', 'öneri bağlantısı müfredata, karar ayrıntıda');
  perform t.ok(t.q_item(v, t.u('revA')) ->> 'href' = '/egitmen/icerik', 'inceleme bağlantısı İçerik sayfasına');
  perform t.ok(t.q_item(v, t.u('noteA')) ->> 'student_name' = (select p.display_name from public.profiles p where p.id = t.u('elif'))
               and not (t.q_item(v, t.u('noteA')) ? 'conversation_id'), 'koç notu öğrenci adıyla, sohbet kimliği yok');
  perform t.ok(jsonb_array_length(v) <= 100, 'en çok 100 öğe');
  perform t.ok((v -> 0 ->> 'created_at')::timestamptz >= (v -> (jsonb_array_length(v) - 1) ->> 'created_at')::timestamptz, 'en yeni önce');
end $$;

-- Bağlı eğitmen: yalnız bağlı öğrencileri (A) ve kendi dersinin müfredatı; bağsız öğrenci (C) görünmez
do $$
declare
  v jsonb;
begin
  perform t.as_user(t.u('inst'));
  v := public.instructor_queue();
  perform t.ok(t.q_has(v, 'coach_note', t.u('noteA')) and t.q_has(v, 'spend_cap', t.u('capA'))
               and t.q_has(v, 'review_document', t.u('revA')) and t.q_has(v, 'lesson_claims', t.u('lessonA'))
               and t.q_has(v, 'curriculum_proposal', t.u('prop')), 'eğitmen kendi öğelerini görür');
  perform t.ok(not t.q_has(v, 'coach_note', t.u('noteC')) and not t.q_has(v, 'spend_cap', t.u('capC'))
               and not t.q_has(v, 'review_document', t.u('revC')) and not t.q_has(v, 'lesson_claims', t.u('lessonC')),
               'bağsız öğrencinin öğeleri eğitmene görünmez');

  perform t.as_user(t.u('inst2'));
  v := public.instructor_queue();
  perform t.ok(jsonb_array_length(v) = 0, 'bağsız eğitmen başkasının hiçbir öğesini görmez');
end $$;

-- Öğrenci, veli, anon: 42501
do $$
begin
  perform t.as_user(t.u('elif'));
  perform t.raises('select public.instructor_queue()', 'OGR-AUTH-002%', 'öğrenci kuyruğu göremez');
  perform t.raises(format('select public.resolve_instructor_note(%L)', t.v('noteA')), 'OGR-AUTH-002%', 'öğrenci not kapatamaz');
  perform t.raises(format('select public.approve_spend_capped_request(''document'', %L)', t.v('capA')), 'OGR-AUTH-002%', 'öğrenci onay veremez');
  perform t.as_user(t.u('parent'));
  perform t.raises('select public.instructor_queue()', 'OGR-AUTH-002%', 'veli kuyruğu göremez');
  perform t.as_anon();
  perform t.raises('select public.instructor_queue()', '42501', 'anon çalıştıramaz');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.consume_spend_cap_approval(''document'', %L)', t.v('capA')), '42501', 'eğitmen onayı tüketemez');
  perform t.raises(format('select public.record_spend_cap_hold(''document'', %L)', t.v('capA')), '42501', 'eğitmen tavan kaydı yazamaz');
  perform t.as_admin();
end $$;

-- resolve_instructor_note: kapsam dışı 42501; kapsamda okundu, ikinci çağrı no-op
do $$
declare
  v jsonb;
begin
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.resolve_instructor_note(%L)', t.v('noteA')), 'OGR-AUTH-002%', 'bağsız eğitmen başkasının notunu kapatamaz');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.resolve_instructor_note(%L)', t.v('noteC')), 'OGR-AUTH-002%', 'eğitmen bağsız öğrencinin notunu kapatamaz');
  perform t.ok(public.resolve_instructor_note(t.u('noteA')), 'eğitmen kendi notunu okundu yapar');
  perform t.ok(not public.resolve_instructor_note(t.u('noteA')), 'ikinci kapatma no-op');
  v := public.instructor_queue();
  perform t.ok(not t.q_has(v, 'coach_note', t.u('noteA')), 'okunan not kuyruktan düşer');
  perform t.raises(format('select public.resolve_instructor_note(%L)', t.v('revA')), 'OGR-QUEUE-001%', 'koç notu olmayan kimlik');
  perform t.as_admin();
  perform t.ok((select n.read_at is not null from public.notifications n where n.id = t.u('noteA')), 'read_at dolu');
end $$;

-- approve_spend_capped_request: kapsam dışı 42501; onay bir kez; worker bir kez tüketir
do $$
declare
  v jsonb;
begin
  perform t.as_user(t.u('inst2'));
  perform t.raises(format('select public.approve_spend_capped_request(''document'', %L)', t.v('capA')), 'OGR-AUTH-002%', 'bağsız eğitmen onay veremez');
  perform t.as_user(t.u('inst'));
  perform t.raises(format('select public.approve_spend_capped_request(''document'', %L)', t.v('capC')), 'OGR-AUTH-002%', 'eğitmen bağsız öğrencinin isteğini onaylayamaz');
  perform t.raises(format('select public.approve_spend_capped_request(''practice'', %L)', t.v('capA')), 'OGR-QUEUE-002%', 'desteklenmeyen tür');
  v := public.approve_spend_capped_request('document', t.u('capA'));
  perform t.ok((v ->> 'approved')::boolean, 'eğitmen onaylar');
  v := public.approve_spend_capped_request('document', t.u('capA'));
  perform t.ok(not (v ->> 'approved')::boolean and (v ->> 'already')::boolean, 'ikinci onay no-op');
  v := public.instructor_queue();
  perform t.ok(not t.q_has(v, 'spend_cap', t.u('capA')), 'onaylanan istek kuyruktan düşer');
  perform t.as_admin();
  perform t.ok((select h.approved_by = t.u('inst') and h.approved_at is not null and h.consumed_at is null
                  from public.spend_cap_holds h where h.request_id = t.u('capA')), 'onay kim/ne zaman kaydedildi');
  perform t.ok((select count(*) = 1 from public.spend_cap_holds h where h.request_id = t.u('capA')), 'tek onay kaydı');
  perform t.ok((select dr.status = 'queued' and dr.error is null from public.document_requests dr where dr.id = t.u('capA'))
               and (select gd.status = 'queued' from public.generated_documents gd where gd.id = t.u('capDocA')), 'istek ve belge yeniden kuyrukta');
  perform t.ok(public.consume_spend_cap_approval('document', t.u('capA')), 'worker onayı tüketir');
  perform t.ok(not public.consume_spend_cap_approval('document', t.u('capA')), 'onay ikinci kez tüketilmez');
  perform t.ok(not public.consume_spend_cap_approval('document', t.u('capC')), 'onaysız istek tüketilemez');
end $$;

rollback;
