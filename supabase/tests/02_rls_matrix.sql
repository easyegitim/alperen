-- tests/02_rls_matrix.sql — RLS matrisi (docs/PLAN-v2-detail.md §2.4, docs/PLAN-v2.md §16): rol × kritik tablo için
-- görünen satır sayısı. Roller: öğrenci Elif (A; velisi ve eğitmeni bağlı), öğrenci Can (B; eğitmeni bağlı), veli
-- (Elif'in), eğitmen (A ve B'ye bağlı), admin; bağsız: öğrenci Deniz (C), eğitmen inst2, veli parent2. Beklenen -1 =
-- "gerçek satır sayısının tamamı (> 0)", null = denetlenmez. Ayrıca: veli koç sohbetini okuyamaz, öğrenci secure.*
-- göremez, anon hiçbir tabloyu okuyamaz, kullanıcı yazımları politikalarla sınırlı.
begin;
\ir _fixture.sql
select t.add_outsiders();

-- Dünya (JWT'siz oturum: güvenilir çağıran; RPC'ler worker gibi çalışır)
do $$
declare
  v_id uuid;
  v_exam uuid;
  v_q1 uuid;
  v_q2 uuid;
  v_sess uuid;
  v_sa uuid;
begin
  insert into public.conversations (id, student_id, kind, participant_id) values
    ('40000000-0000-4000-8000-0000000000a1', t.u('A'), 'coach', t.u('elif')),
    ('40000000-0000-4000-8000-0000000000a2', t.u('A'), 'parent', t.u('parent')),
    ('40000000-0000-4000-8000-0000000000a3', t.u('A'), 'instructor', t.u('inst')),
    ('40000000-0000-4000-8000-0000000000b1', t.u('B'), 'coach', t.u('can'));
  insert into public.conversation_messages (conversation_id, role, content) values
    ('40000000-0000-4000-8000-0000000000a1', 'user', '[{"type":"text","text":"Bu soruda nerede hata yaptım?"}]'),
    ('40000000-0000-4000-8000-0000000000a1', 'assistant', '[{"type":"text","text":"İkinci adıma birlikte bakalım."}]'),
    ('40000000-0000-4000-8000-0000000000a2', 'user', '[{"type":"text","text":"Bu hafta ne çalıştı?"}]'),
    ('40000000-0000-4000-8000-0000000000a3', 'user', '[{"type":"text","text":"Elif için ödev öner."}]'),
    ('40000000-0000-4000-8000-0000000000b1', 'user', '[{"type":"text","text":"Merhaba"}]');
  insert into public.uploads (owner_id, student_id, kind, storage_path) values
    (t.u('elif'), t.u('A'), 'photo', t.u('elif') || '/1.jpg'), (t.u('can'), t.u('B'), 'photo', t.u('can') || '/1.jpg');
  insert into t.cfg select 'UP_' || u.owner_id::text, u.id::text from public.uploads u;
  insert into public.question_styles (course_id, curriculum_id, code, name, skill_ids, status, exemplar_item_ids)
  values (t.u('course'), t.u('cur'), 'ST-RLS', 'Gizli örnekli tarz', array['t.mat.a'], 'active', array[gen_random_uuid()]);
  v_sa := public.apply_diagnosis(jsonb_build_object('enrollment_id', t.u('EA'), 'verdict', 'wrong', 'error_cause', 'procedure',
            'failing_step_no', 1, 'skill_ids', jsonb_build_array('t.mat.a'), 'analysis', jsonb_build_object('steps', jsonb_build_array('x'))));
  v_sa := public.apply_diagnosis(jsonb_build_object('enrollment_id', t.u('EB'), 'verdict', 'correct',
            'skill_ids', jsonb_build_array('t.mat.b'), 'analysis', '{}'::jsonb));
  insert into public.exams (curriculum_id, course_id, kind, source, title, status, question_count)
  values (t.u('cur'), t.u('course'), 'published', 'instructor', 'RLS Denemesi', 'published', 2) returning id into v_exam;
  insert into t.cfg values ('X', v_exam::text);
  insert into public.exam_questions (exam_id, no, kind, stem_text, options, skill_ids) values
    (v_exam, 1, 'mcq', '2 + 3 · 4 = ?', '[{"key":"A","text":"14"},{"key":"B","text":"20"}]', array['t.mat.a']) returning id into v_q1;
  insert into public.exam_questions (exam_id, no, kind, stem_text, options, skill_ids) values
    (v_exam, 2, 'mcq', '-(2 - 5) = ?', '[{"key":"A","text":"3"},{"key":"B","text":"-3"}]', array['t.mat.b']) returning id into v_q2;
  perform public.set_exam_key(v_q1, 'A');
  perform public.set_exam_key(v_q2, 'A');
  v_sess := public.start_exam_session(v_exam, t.u('EA'), 'in_app');
  insert into t.cfg values ('SA', v_sess::text);
  perform public.record_exam_response(v_sess, v_q1, 'A');
  perform public.record_exam_response(v_sess, v_q2, 'B');
  v_sess := public.start_exam_session(v_exam, t.u('EB'), 'in_app');
  insert into public.generated_documents (student_id, course_id, kind, title, status) values
    (t.u('A'), t.u('course'), 'report', 'Elif haftalık', 'published'), (t.u('A'), t.u('course'), 'notes', 'Elif notları', 'published'),
    (t.u('B'), t.u('course'), 'report', 'Can haftalık', 'published');
  -- ders geneli yayımlanmış belgeler (soru metni içerir): kayıtlı öğrenciler ve personel görür, veli görmez
  insert into public.generated_documents (student_id, course_id, kind, title, status, pdf_path) values
    (null, t.u('course'), 'mock_exam', 'Ders denemesi', 'published', 'course/deneme.pdf'),
    (null, t.u('course'), 'notes', 'Ders notları', 'published', 'course/notlar.pdf');
  insert into public.notifications (recipient_id, kind, title) values (t.u('parent'), 'weekly', 'Haftalık özet'), (t.u('elif'), 'exam', 'Deneme notlandı');
  perform public.upsert_memory_file(t.u('A'), '/memories/profile.md', 'Sınıf 11; kısa adımlar.', 'create', 'test');
  perform public.upsert_memory_file(t.u('A'), '/memories/parent_summary.md', 'Bu hafta düzenli çalıştı.', 'create', 'nightly');
  perform public.upsert_memory_file(t.u('B'), '/memories/profile.md', 'Sınıf 11.', 'create', 'test');
  perform public.log_llm_call('{"purpose":"chat","route":"coach","model":"claude-sonnet-5-5","status":"ok","cost_usd":0.01}');
  insert into public.weekly_summaries (student_id, week_start, body, metrics) values (t.u('A'), '2026-10-26', 'Düzenli çalıştı.', '{}');
  insert into public.instructor_notes (enrollment_id, author_id, skill_id, body) values (t.u('EA'), t.u('inst'), 't.mat.a', 'İşlem önceliğini tekrar et.');
  insert into public.curricula (code, version, label, status, created_by) values ('T-PRIV', '1', 'Özel taslak', 'draft', t.u('inst')) returning id into v_id;
  insert into t.cfg values ('priv', v_id::text);
end $$;

create temporary table matrix (
  label text, sql text, elif int, can int, parent int, inst int, admin int, deniz int, inst2 int, parent2 int
) on commit drop;
grant select on matrix to public;
insert into matrix values
  ('koç sohbeti A mesajları', $q$select 1 from public.conversation_messages m where m.conversation_id = '40000000-0000-4000-8000-0000000000a1'$q$,
     2, 0, 0, 2, 2, 0, 0, 0),
  ('veli sohbeti mesajları', $q$select 1 from public.conversation_messages m where m.conversation_id = '40000000-0000-4000-8000-0000000000a2'$q$,
     0, 0, 1, 0, 1, 0, 0, 0),
  ('eğitmen sohbeti mesajları', $q$select 1 from public.conversation_messages m where m.conversation_id = '40000000-0000-4000-8000-0000000000a3'$q$,
     0, 0, 0, 1, 1, 0, 0, 0),
  ('sohbetler', $q$select 1 from public.conversations$q$, 1, 1, 1, 3, 4, 0, 0, 0),
  ('gözlemler A', format($q$select 1 from public.observations o where o.enrollment_id = %L$q$, t.u('EA')), -1, 0, 0, -1, -1, 0, 0, 0),
  ('ustalık A (tablo)', format($q$select 1 from public.mastery m where m.enrollment_id = %L$q$, t.u('EA')), -1, 0, 0, -1, -1, 0, 0, 0),
  ('ustalık A (mastery_view)', format($q$select 1 from public.mastery_view v where v.student_id = %L$q$, t.u('A')), -1, 0, -1, -1, -1, 0, 0, 0),
  ('teşhisler A', format($q$select 1 from public.solution_analyses s where s.enrollment_id = %L$q$, t.u('EA')), 1, 0, 0, 1, 1, 0, 0, 0),
  ('yüklemeler A', format($q$select 1 from public.uploads u where u.student_id = %L$q$, t.u('A')), 1, 0, 0, 1, 1, 0, 0, 0),
  ('deneme oturumları A', format($q$select 1 from public.exam_sessions s where s.enrollment_id = %L$q$, t.u('EA')), 1, 0, 1, 1, 1, 0, 0, 0),
  ('deneme cevapları A', format($q$select 1 from public.exam_responses r where r.session_id = %L$q$, t.u('SA')), 2, 0, 0, 2, 2, 0, 0, 0),
  ('sınav soruları (tablo)', format($q$select 1 from public.exam_questions q where q.exam_id = %L$q$, t.u('X')), 0, 0, 0, 2, 2, 0, 2, 0),
  ('sınav soruları (öğrenci görünümü)', format($q$select 1 from public.v_exam_questions_student q where q.exam_id = %L$q$, t.u('X')),
     2, 2, 0, 2, 2, 0, 2, 0),
  ('sınav başlığı', format($q$select 1 from public.exams x where x.id = %L$q$, t.u('X')), 1, 1, 1, 1, 1, 1, 1, 0),
  ('belgeler', $q$select 1 from public.generated_documents$q$, 4, 3, 1, 5, 5, 2, 2, 0),
  ('ders geneli belgeler (deneme, not)', $q$select 1 from public.generated_documents d where d.student_id is null$q$, 2, 2, 0, 2, 2, 2, 2, 0),
  ('soru tarzları', $q$select 1 from public.question_styles q where q.code = 'ST-RLS'$q$, 1, 1, 0, 1, 1, 1, 1, 0),
  ('bildirimler', $q$select 1 from public.notifications$q$, 1, 0, 1, 0, 2, 0, 0, 0),
  ('hafıza dosyaları A', format($q$select 1 from public.memory_files f where f.student_id = %L$q$, t.u('A')), 2, 0, 1, 2, 2, 0, 0, 0),
  ('hafıza sürümleri A', format($q$select 1 from public.memory_file_versions f where f.student_id = %L$q$, t.u('A')), 2, 0, 0, 2, 2, 0, 0, 0),
  ('llm_calls', $q$select 1 from public.llm_calls$q$, 0, 0, 0, 0, 1, 0, 0, 0),
  ('spend_ledger', $q$select 1 from public.spend_ledger$q$, 0, 0, 0, 0, 1, 0, 0, 0),
  ('runtime_flags', $q$select 1 from public.runtime_flags$q$, 0, 0, 0, 0, -1, 0, 0, 0),
  ('profiller', $q$select 1 from public.profiles$q$, 3, 2, 3, 4, 8, 1, 1, 1),
  ('öğrenciler', $q$select 1 from public.students$q$, 1, 1, 1, 2, 3, 1, 0, 0),
  ('kayıtlar', $q$select 1 from public.enrollments$q$, 1, 1, 1, 2, 3, 1, 0, 0),
  ('veli bağları', $q$select 1 from public.guardian_links$q$, 1, 0, 1, 1, 1, 0, 0, 0),
  ('eğitmen bağları', $q$select 1 from public.instructor_links$q$, 1, 1, 1, 2, 2, 0, 0, 0),
  ('haftalık özetler A', format($q$select 1 from public.weekly_summaries w where w.student_id = %L$q$, t.u('A')), 1, 0, 1, 1, 1, 0, 0, 0),
  ('eğitmen notları A', format($q$select 1 from public.instructor_notes n where n.enrollment_id = %L$q$, t.u('EA')), 0, 0, 0, 1, 1, 0, 0, 0),
  ('özel taslak müfredat', format($q$select 1 from public.curricula c where c.id = %L$q$, t.u('priv')), 0, 0, 0, 1, 1, 0, 1, 0),
  ('paylaşılan ders müfredatı', format($q$select 1 from public.curricula c where c.id = %L$q$, t.u('cur')), 1, 1, 1, 1, 1, 1, 1, 1),
  ('soru bankası (tablo)', $q$select 1 from public.questions$q$, 0, 0, 0, null, -1, 0, null, 0),
  ('veli özet kartı', $q$select 1 from public.v_parent_child_overview$q$, 0, 0, 1, 0, 1, 0, 0, 0);

do $$
declare
  v_m record;
  v_all bigint;
  v_got bigint;
  v_who text;
  v_exp int;
  v_bad text := '';
  v_n int := 0;
begin
  for v_m in select * from matrix loop
    perform t.as_admin();
    v_all := t.n(v_m.sql);
    foreach v_who in array array['elif', 'can', 'parent', 'inst', 'admin', 'deniz', 'inst2', 'parent2'] loop
      v_exp := (to_jsonb(v_m) ->> v_who)::int;
      continue when v_exp is null;
      if v_exp = -1 then
        if v_all = 0 then
          v_bad := v_bad || format(' [%s: dünya boş]', v_m.label);
        end if;
        v_exp := v_all;
      end if;
      v_got := t.sees(t.u(v_who), v_m.sql);
      v_n := v_n + 1;
      if v_got <> v_exp then
        v_bad := v_bad || format(' [%s × %s: %s ≠ %s]', v_m.label, v_who, v_got, v_exp);
      end if;
    end loop;
  end loop;
  perform t.ok(v_bad = '', format('RLS matrisi: %s hücre beklenen satır sayısında%s', v_n, v_bad));
end $$;

-- Storage documents kovası generated_documents RLS'ine bağlı: veli ders geneli denemenin PDF'ini indiremez
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'SKIP: storage.objects yok (documents politikası sınanmadı)';
    return;
  end if;
  insert into storage.objects (bucket_id, name) values ('documents', 'course/deneme.pdf');
  perform t.ok(t.sees(t.u('elif'), $q$select 1 from storage.objects o where o.name = 'course/deneme.pdf'$q$) = 1
               and t.sees(t.u('parent'), $q$select 1 from storage.objects o where o.name = 'course/deneme.pdf'$q$) = 0
               and t.sees(t.u('parent2'), $q$select 1 from storage.objects o where o.name = 'course/deneme.pdf'$q$) = 0,
               'Storage documents: ders geneli deneme PDF''i kayıtlı öğrenciye açık, veliye kapalı');
end $$;

-- Kritik kurallar ayrıca adıyla
do $$
begin
  perform t.ok(t.sees(t.u('parent'), $q$select 1 from public.conversation_messages m join public.conversations c on c.id = m.conversation_id
                                        where c.kind = 'coach'$q$) = 0
               and t.sees(t.u('parent'), $q$select 1 from public.conversations c where c.kind = 'coach'$q$) = 0,
               'veli koç sohbetini okuyamaz (mesaj ve sohbet satırı)');
  perform t.ok(t.sees(t.u('parent'), 'select 1 from public.uploads') = 0, 'veli ham yüklemeleri göremez');
  perform t.ok(t.sees(t.u('parent'), 'select 1 from public.exam_questions') = 0
               and t.sees(t.u('parent'), 'select 1 from public.v_exam_questions_student') = 0, 'veli sınav metinlerini göremez');
  perform t.ok(t.sees(t.u('inst'), format('select 1 from public.observations o where o.enrollment_id = %L', t.u('EC2'))) = 0
               and t.sees(t.u('inst2'), 'select 1 from public.observations') = 0
               and t.sees(t.u('inst2'), 'select 1 from public.students') = 0, 'eğitmen yalnız bağlı öğrencileri görür');

  perform t.as_user(t.u('elif'));
  perform t.raises('select * from secure.exam_answer_keys', '42501', 'öğrenci secure.exam_answer_keys okuyamaz');
  perform t.raises('select * from secure.answer_keys', '42501', 'öğrenci secure.answer_keys okuyamaz');
  perform t.raises('select * from audit.events', '42501', 'öğrenci audit.events okuyamaz');
  perform t.as_user(t.u('admin'));
  perform t.raises('select * from secure.exam_answer_keys', '42501', 'admin JWT''si de secure.* okuyamaz (yalnız fonksiyonlar)');
  perform t.as_anon();
  perform t.raises('select * from public.students', '42501', 'anon öğrencileri okuyamaz');
  perform t.raises('select * from public.mastery_view', '42501', 'anon mastery_view okuyamaz');
  perform t.raises('select * from public.settings', '42501', 'anon ayarları okuyamaz');
  perform t.as_admin();
end $$;

-- Yazımlar: kullanıcıya ait tablolarda politikayla sınırlı
do $$
begin
  perform t.as_user(t.u('elif'));
  perform t.ok(public.coach_append_message('40000000-0000-4000-8000-0000000000a1', 'user', '[{"type":"text","text":"Teşekkürler"}]') is not null,
               'öğrenci kendi koç sohbetine (coach_append_message ile) mesaj yazar');
  perform t.raises($q$insert into public.conversation_messages (conversation_id, role, content)
                     values ('40000000-0000-4000-8000-0000000000a1', 'user', '[{"type":"text","text":"Doğrudan"}]')$q$,
                   '42501', 'koç sohbetine doğrudan INSERT kapalı (yalnız coach_* RPC)');
  perform t.raises($q$insert into public.conversation_messages (conversation_id, role, content)
                     values ('40000000-0000-4000-8000-0000000000a1', 'system', '[]')$q$, '42501', 'öğrenci system mesajı yazamaz');
  perform t.raises($q$insert into public.conversation_messages (conversation_id, role, content)
                     values ('40000000-0000-4000-8000-0000000000a1', 'assistant', '[{"type":"text","text":"Sahte koç turu"}]')$q$,
                   '42501', 'öğrenci assistant (koç) turu yazamaz');
  perform t.ok(public.coach_append_message('40000000-0000-4000-8000-0000000000a1', 'user', '[]', array[t.u('UP_' || t.v('elif'))]) is not null,
               'öğrenci kendi yüklemesini mesaja ekler');
  perform t.raises(format($q$select public.coach_append_message('40000000-0000-4000-8000-0000000000a1', 'user', '[]', array[%L]::uuid[])$q$,
                          t.u('UP_' || t.v('can'))),
                   '42501', 'başkasının yüklemesi mesaja eklenemez');
  perform t.raises($q$select public.coach_append_message('40000000-0000-4000-8000-0000000000a1', 'user', '[]', array[gen_random_uuid()])$q$,
                   '42501', 'olmayan yükleme kimliği mesaja eklenemez');
  -- soru tarzları: örnek maddeler (exemplar_item_ids) ve gömme öğrenciye gizli
  perform t.ok(t.n($q$select id, code, status, skill_ids from public.question_styles where code = 'ST-RLS'$q$) = 1,
               'öğrenci tarzın açık sütunlarını okur');
  perform t.raises($q$select exemplar_item_ids from public.question_styles$q$, '42501', 'öğrenci exemplar_item_ids okuyamaz');
  perform t.raises($q$select * from public.question_styles$q$, '42501', 'öğrenci tarz satırının tamamını (select *) okuyamaz');
  perform t.ok(t.n('select 1 from public.v_question_styles_staff') = 0, 'öğrenci personel tarz görünümünde satır görmez');
  perform t.raises($q$insert into public.conversation_messages (conversation_id, role, content)
                     values ('40000000-0000-4000-8000-0000000000b1', 'user', '[]')$q$, '42501', 'öğrenci başkasının sohbetine yazamaz');
  perform t.raises($q$update public.profiles set role = 'admin' where id = auth.uid()$q$, '42501', 'kullanıcı kendi rolünü değiştiremez');
  perform t.raises(format($q$insert into public.observations (enrollment_id, skill_id, kind, value, source_type, source_id, source_locator)
                            values (%L, 't.mat.a', 'practice', 1, 'observation', '1', 'x')$q$, t.u('EA')),
                   '42501', 'öğrenci gözlemi doğrudan yazamaz (yalnız RPC)');
  perform t.raises(format($q$update public.mastery set p = 0.99 where enrollment_id = %L$q$, t.u('EA')), '42501', 'öğrenci ustalığı doğrudan yazamaz');
  update public.notifications set read_at = now() where recipient_id = auth.uid();
  perform t.as_user(t.u('parent'));
  perform t.raises($q$insert into public.conversation_messages (conversation_id, role, content)
                     values ('40000000-0000-4000-8000-0000000000a1', 'user', '[]')$q$, '42501', 'veli koç sohbetine yazamaz');
  insert into public.conversation_messages (conversation_id, role, content)
  values ('40000000-0000-4000-8000-0000000000a2', 'user', '[{"type":"text","text":"Teşekkürler"}]');
  perform t.ok(true, 'veli kendi veli sohbetine doğrudan yazar (0018 hakkı koç dışı sohbetlerde kalır)');
  insert into public.conversations (student_id, kind, participant_id) values (t.u('A'), 'parent', auth.uid());
  perform t.ok(true, 'veli çocuğu için veli sohbeti açar');
  perform t.raises(format($q$insert into public.conversations (student_id, kind, participant_id) values (%L, 'parent', auth.uid())$q$, t.u('B')),
                   '42501', 'veli bağlı olmadığı öğrenci için sohbet açamaz');
  perform t.raises(format($q$insert into public.uploads (owner_id, student_id, kind, storage_path) values (auth.uid(), %L, 'photo', auth.uid() || '/x.jpg')$q$, t.u('A')),
                   '42501', 'veli öğrenci adına yükleme yapamaz');
  perform t.as_user(t.u('inst'));
  perform t.ok((select cardinality(v.exemplar_item_ids) = 1 from public.v_question_styles_staff v where v.code = 'ST-RLS'),
               'eğitmen tarzın tam satırını personel görünümüyle okur');
  perform t.as_admin();
  perform t.ok((select n.read_at is not null from public.notifications n where n.recipient_id = t.u('elif')), 'öğrenci kendi bildirimini okundu yapar');
end $$;

rollback;
