-- tests/04_student_isolation.sql — öğrenciler arası yalıtım (BLUEPRINT §3.0, §9.1): bot_runtime X-Ogrenmen-Student
-- başlığıyla yalnız o öğrencinin satırlarını görür; çapraz işlemler yalnız adlandırılmış RPC'lerle; personel yalnız atananları.
begin;
\ir _fixture.sql

-- Her iki öğrenci için satırlar (RPC'lerle — üretim yolu)
do $$
declare
  v_q uuid;
  v_name text;
begin
  insert into public.questions (curriculum_id, skill_ids, kind, stem, options, difficulty, source, content_hash, status)
  values (t.u('cur'), array['tyt.mat.temel.rasyonel-sayilar'], 'mcq', 'Yalıtım sorusu: 1/2 + 1/4 kaçtır?',
          '[{"key":"A","text":"2/6","misconception_tag":"rasyonel.pay-payda-ayri-toplama"},{"key":"B","text":"3/4","misconception_tag":null},
            {"key":"C","text":"2/4","misconception_tag":"rasyonel.payda-esitlemeden-toplama"},{"key":"D","text":"1/8","misconception_tag":null}]',
          0.4, 'instructor', 'test-iso-1', 'draft') returning id into v_q;
  insert into secure.answer_keys (question_id, correct_option, solution, sympy_status, written_by) values (v_q, 'B', '1/2 = 2/4; 2/4 + 1/4 = 3/4.', 'verified', 'staff:test');
  perform set_config('ogrenmen.reviewer', 'on', true);
  update public.questions q set status = 'approved' where q.id = v_q;
  perform set_config('ogrenmen.reviewer', 'off', true);
  insert into t.cfg values ('q', v_q::text);
  foreach v_name in array array['A', 'B'] loop
    perform t.as_bot(t.u(v_name));
    perform public.grade_attempt(t.u('E' || v_name), v_q, '{"key":"A"}', 'practice', null, 900);
    perform public.consume_quota('message');
    perform public.log_bot_response(jsonb_build_object('chat_id', case when v_name = 'A' then 700100001 else 700100002 end, 'purpose', 'chat',
                                                       'response_text', 'Cevap ' || v_name, 'prompt_text', 'temiz prompt ' || v_name,
                                                       'provider_attempts', jsonb_build_array(jsonb_build_object('provider', 'fake', 'model', 'fake-1', 'status', 'ok', 'tokens_in', 10, 'tokens_out', 5, 'cost_usd', 0.0001))));
    insert into public.sessions (student_id, chat_id, state) values (t.u(v_name), case when v_name = 'A' then 700100001 else 700100002 end, 'idle');
    perform t.as_admin();
    insert into public.memory_facts (student_id, kind, text, source_message_ids)
    values (t.u(v_name), 'topic_asked', 'Öğrenci ' || v_name || ' kesir toplamayı sordu.', array[t.v('msg_a_q')::bigint]);
  end loop;
end $$;

-- A'nın başlığıyla: yalnız A; B'nin satırları 0
do $$
declare
  v_tables text[] := array['mastery', 'mastery_history', 'observations', 'attempts', 'misconceptions', 'memory_facts', 'sessions', 'quota_usage',
                           'bot_responses', 'consents', 'enrollments', 'preferences', 'diagnostic_sessions'];
  v_t text;
  v_own int;
  v_other int;
  v_col text;
  v_pair text[];
begin
  foreach v_pair slice 1 in array array[['A', 'B'], ['B', 'A']] loop
    perform t.as_bot(t.u(v_pair[1]));
    foreach v_t in array v_tables loop
      v_col := case when v_t in ('mastery', 'mastery_history', 'observations', 'attempts', 'misconceptions', 'diagnostic_sessions')
                    then format('app.enrollment_student(enrollment_id)') else 'student_id' end;
      execute format('select count(*) from public.%I where %s = %L', v_t, v_col, t.u(v_pair[2])) into v_other;
      perform t.ok(v_other = 0, format('%s başlığıyla %s satırı %s için 0', v_pair[1], v_pair[2], v_t));
      if v_t not in ('consents', 'diagnostic_sessions', 'misconceptions') or v_pair[1] = 'A' then
        execute format('select count(*) from public.%I where %s = %L', v_t, v_col, t.u(v_pair[1])) into v_own;
        perform t.ok(v_own > 0 or v_t in ('diagnostic_sessions', 'misconceptions', 'consents'), format('%s kendi %s satırını görür (%s)', v_pair[1], v_t, v_own));
      end if;
    end loop;
    perform t.ok((select count(*) from public.students s where s.id = t.u(v_pair[2])) = 0, v_pair[1] || ' başlığıyla diğer öğrencinin students satırı görünmez');
  end loop;
  perform t.as_bot(null);
  perform t.ok((select count(*) from public.mastery) = 0 and (select count(*) from public.memory_facts) = 0 and (select count(*) from public.attempts) = 0,
               'başlıksız bot_runtime öğrenci verisi (mastery, memory_facts, attempts) göremez');
  perform t.as_admin();
end $$;

-- Mesajlar ve bağlam: grupta yalnız öğrencinin kendi mesajları ve ona verilen yanıtlar
do $$
declare
  v_ids bigint[];
begin
  perform t.as_bot(t.u('A'));
  select array_agg(r.id) into v_ids from public.recent_messages(-100900100, 10) r;
  perform t.ok(t.v('msg_group_a')::bigint = any(v_ids), 'recent_messages(grup) A''nın kendi sorusunu içerir');
  perform t.ok(not (t.v('msg_group_b')::bigint = any(v_ids)), 'recent_messages(grup) B''nin mesajını İÇERMEZ');
  perform t.ok((select count(*) from public.recent_messages(-100900100, 10) r where r.sender_role = 'instructor') = 1, 'eğitmenin A''ya yanıtı bağlamda');
  perform t.ok((select count(*) from public.messages m where m.student_id = t.u('B')) = 0, 'bot A başlığıyla B''nin mesajlarını okuyamaz');
  perform t.as_admin();
  insert into public.messages (chat_id, telegram_message_id, sender_role, student_id, text_llm, sent_at)
  values (700100001, 990901, 'bot', null, 'A''ya özel bot cevabı', now()),
         (700100001, 990902, 'instructor', null, 'A''ya özel eğitmen notu', now());
  perform t.as_bot(t.u('A'));
  perform t.ok((select count(*) from public.recent_messages(700100001, 10) r where r.text like 'A''ya özel%') = 2,
               'A kendi özel sohbetinde bot/eğitmen mesajlarını bağlamda görür');
  perform t.as_bot(t.u('B'));
  perform t.ok((select count(*) from public.recent_messages(700100001, 10)) = 0, 'B, A''nın özel sohbet bağlamını alamaz (bot/eğitmen mesajları dahil)');
  perform t.as_bot(null);
  perform t.ok((select count(*) from public.recent_messages(700100001, 10)) = 0, 'başlıksız recent_messages boş döner');
  perform t.as_admin();
end $$;

-- Worker'ın doğrudan yazımları, PostgREST'in ürettiği biçimde (bot_runtime). Prefer: return=minimal → "RETURNING 1"
-- (SELECT politikası uygulanmaz); return=representation → "RETURNING id" (SELECT politikası yeni satıra uygulanır).
-- Sözleşme (README "Worker yazım sözleşmesi"): öğrenci dışı / başlıksız mesaj satırları return=minimal ile yazılır.
do $$
declare
  v_id bigint;
begin
  -- S bağlamı: öğrencinin kendi mesajı ve ona bot cevabı → representation da çalışır (Worker messages.id'yi alır)
  perform t.as_bot(t.u('A'));
  insert into public.messages (chat_id, telegram_message_id, sender_role, student_id, text_raw, text_llm, attachments, mentions_bot, is_question, sent_at)
  values (-100900100, 995001, 'student', t.u('A'), 'Elif: soru?', '[ÖĞRENCİ]: soru?', '[]', true, true, now()) returning id into v_id;
  perform t.ok(v_id is not null, 'S: öğrenci grup mesajı insert … returning id (representation) çalışır');
  insert into public.messages (chat_id, telegram_message_id, sender_role, student_id, reply_to_telegram_message_id, text_raw, text_llm, sent_at)
  values (700100001, 995002, 'bot', t.u('A'), 11, 'Cevap', 'Cevap', now()) returning id into v_id;
  perform t.ok(v_id is not null, 'S: öğrenciye bot cevabı insert … returning id çalışır');
  -- B bağlamı (başlıksız): eğitmen ve 'other' grup mesajı → minimal çalışır, representation RLS'e takılır (belgelenmiş)
  perform t.as_bot(null);
  insert into public.messages (chat_id, telegram_message_id, sender_role, staff_id, reply_to_telegram_message_id, text_raw, text_llm, sent_at)
  values (-100900100, 995003, 'instructor', t.u('inst_a'), 995001, 'Hoca cevabı', 'Hoca cevabı', now());
  perform t.ok(found, 'B: eğitmen grup mesajı insert (RETURNING yok) çalışır');
  execute 'insert into public.messages (chat_id, telegram_message_id, sender_role, text_llm, sent_at) values (-100900100, 995004, ''other'', null, now()) returning 1';
  perform t.ok(true, 'B: other grup mesajı insert … returning 1 (PostgREST return=minimal) çalışır');
  perform t.raises('insert into public.messages (chat_id, telegram_message_id, sender_role, text_llm, sent_at) values (-100900100, 995005, ''instructor'', ''x'', now()) returning id',
                   'new row violates row-level security policy%', 'B: eğitmen mesajı returning id → RLS (Worker return=minimal kullanır)');
  -- diğer Worker yazımları: tg_chats/chat_roles upsert, ops alarmı, sağlayıcı sağlığı, havuz adayı, havuz ıskası
  execute 'insert into public.tg_chats (chat_id, kind, title) values (-100900777, ''group'', ''Yeni grup'') on conflict (chat_id) do nothing returning 1';
  execute 'insert into public.chat_roles (chat_id, telegram_user_id, role, student_id, staff_id, mention_handle) values (-100900777, 700100001, ''student'', ''' || t.u('A')
          || ''', null, null) on conflict (chat_id, telegram_user_id) do update set role = excluded.role, student_id = excluded.student_id returning 1';
  execute 'insert into public.chat_roles (chat_id, telegram_user_id, role, student_id, staff_id, mention_handle) values (-100900777, 700100001, ''student'', ''' || t.u('A')
          || ''', null, null) on conflict (chat_id, telegram_user_id) do update set role = excluded.role, student_id = excluded.student_id returning 1';
  perform t.ok((select count(*) from public.chat_roles cr where cr.chat_id = -100900777) = 1, 'B: tg_chats ve chat_roles upsert (merge, returning 1) çalışır');
  execute 'insert into public.instructor_alerts (kind, severity, detail, since, ref) values (''ops'', ''warning'', ''Bot grupta yönetici değil; test'', now(), ''{"chat_id": -100900777}'') on conflict (id) do nothing returning 1';
  perform t.ok((select count(*) from public.instructor_alerts a where a.kind = 'ops' and a.ref ->> 'chat_id' = '-100900777') = 1, 'B: ops alarmı insert çalışır');
  perform t.raises('insert into public.instructor_alerts (kind, severity, student_id, detail) values (''silent'', ''warning'', null, ''x'')',
                   'new row violates row-level security policy%', 'B: ops dışı alarm açamaz');
  execute 'insert into public.provider_health (provider) values (''test-provider'') on conflict (provider) do nothing returning 1';
  update public.provider_health ph set consecutive_errors = ph.consecutive_errors + 1 where ph.provider = 'test-provider';
  perform t.ok((select ph.consecutive_errors from public.provider_health ph where ph.provider = 'test-provider') = 1, 'B: provider_health insert + update çalışır');
  perform t.as_bot(t.u('A'));
  execute format('insert into public.content_pool (kind, curriculum_id, skill_id, misconception_tag, mode, body, status, model, cost_usd) values (%L, %L, %L, null, %L, %L, %L, %L, 0) returning 1',
                 'hint', t.u('cur'), 'tyt.mat.temel.sayilar', 'socratic', 'İşlem önceliğini hatırla.', 'pending_review', 'fake');
  perform t.raises(format('insert into public.content_pool (kind, curriculum_id, skill_id, mode, body, status) values (%L, %L, %L, %L, %L, %L)',
                          'hint', t.u('cur'), 'tyt.mat.temel.bolunebilme', 'socratic', 'x', 'approved'),
                   'new row violates row-level security policy%', 'S: havuza onaylı satır yazamaz');
  execute format('insert into public.generation_requests (kind, curriculum_id, skill_id, difficulty_band, question_kind, needs_generation) values (%L, %L, %L, %L, %L, true) returning 1',
                 'pool_miss', t.u('cur'), 'tyt.mat.temel.sayilar', 'mid', 'mcq');
  perform t.as_admin();
  perform t.ok((select count(*) from public.content_pool cp where cp.body = 'İşlem önceliğini hatırla.' and cp.status = 'pending_review') = 1
               and (select count(*) from public.generation_requests g where g.kind = 'pool_miss' and g.skill_id = 'tyt.mat.temel.sayilar') >= 1,
               'S: havuz adayı (pending_review) ve pool_miss isteği yazıldı');
end $$;

-- Çapraz RPC denemeleri → OGR-AUTH-004
do $$
begin
  perform t.as_bot(t.u('A'));
  perform t.raises(format('select * from public.grade_attempt(%L, %L, %L, %L, null, 1)', t.u('EB'), t.v('q'), '{"key":"B"}', 'practice'),
                   'OGR-AUTH-004%', 'A, B''nin kaydı için grade_attempt → OGR-AUTH-004');
  perform t.raises(format('select * from public.next_practice_items(%L, 5)', t.u('EB')), 'OGR-AUTH-004%', 'next_practice_items başka kayıt → OGR-AUTH-004');
  perform t.raises(format('select public.profile_for_prompt(%L)', t.u('EB')), 'OGR-AUTH-004%', 'profile_for_prompt başka kayıt → OGR-AUTH-004');
  perform t.raises(format('select public.reveal_solution(%L, %L)', t.u('EB'), t.v('q')), 'OGR-AUTH-004%', 'reveal_solution başka kayıt → OGR-AUTH-004');
  perform t.raises(format('select public.start_diagnostic(%L, 1)', t.u('EB')), 'OGR-AUTH-004%', 'start_diagnostic başka kayıt → OGR-AUTH-004');
  perform t.raises(format('select public.record_chat_observation(%L, %L, %L, %s, %L, null)', t.u('EB'), 'tyt.mat.temel.rasyonel-sayilar', 'chat_question',
                          t.v('msg_a_q'), 'x'), 'OGR-AUTH-004%', 'record_chat_observation başka kayıt → OGR-AUTH-004');
  perform t.ok((select count(*) from public.retrieve_memory(null, 'kesir', 10) m where m.text like '%B kesir%') = 0, 'retrieve_memory yalnız kendi olguları');
  perform t.as_bot(null);
  perform t.raises('select * from public.consume_quota(''message'')', 'OGR-AUTH-001%', 'başlıksız consume_quota → OGR-AUTH-001');
  perform t.as_admin();
end $$;

-- Personel kapsamı: eğitmen B yalnız B'yi, gözlemci yalnız A'yı görür; koordinatör hepsini
do $$
begin
  perform t.as_staff(t.u('inst_b'));
  perform t.ok((select count(*) from public.mastery m where app.enrollment_student(m.enrollment_id) = t.u('A')) = 0
               and (select count(*) from public.mastery m where app.enrollment_student(m.enrollment_id) = t.u('B')) > 0,
               'inst_b yalnız atanan öğrencinin (B) ustalığını görür');
  perform t.ok((select count(*) from public.bot_responses br where br.student_id = t.u('A')) = 0, 'inst_b A''nın bot cevaplarını görmez');
  perform t.raises(format('select public.add_instructor_note(%L, null, %L)', t.u('EA'), 'not'), 'OGR-AUTH-002%', 'inst_b A''ya not yazamaz');
  perform t.as_staff(t.u('obs'));
  perform t.ok((select count(*) from public.attempts a where app.enrollment_student(a.enrollment_id) = t.u('A')) > 0
               and (select count(*) from public.attempts a where app.enrollment_student(a.enrollment_id) = t.u('B')) = 0,
               'gözlemci yalnız atanan öğrencinin (A) denemelerini görür');
  perform t.raises(format('select public.add_instructor_note(%L, null, %L)', t.u('EA'), 'not'), 'OGR-AUTH-002%', 'gözlemci not yazamaz (salt okunur)');
  perform t.ok((select count(*) from public.person_labels(array[t.u('A'), t.u('B')])) = 1
               and (select p.label from public.person_labels(array[t.u('A')]) p) = 'Elif K.', 'person_labels "Elif K." ve yalnız görülebilen');
  perform t.as_staff(t.u('coord'));
  perform t.ok((select count(*) from public.memory_facts f where f.student_id in (t.u('A'), t.u('B'))) = 2, 'koordinatör iki öğrencinin olgularını görür');
  perform t.ok(public.student_full_name(t.u('A')) = 'Elif Kaya', 'student_full_name yalnız koordinatör');
  perform t.as_staff(t.u('inst_a'));
  perform t.raises(format('select public.student_full_name(%L)', t.u('A')), 'OGR-AUTH-002%', 'eğitmen tam adı okuyamaz');
  perform t.as_admin();
end $$;

rollback;
