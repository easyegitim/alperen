-- tests/33_rate_limits.sql — pahalı işlerin günlük sınırları (0045): koç turu (OGR-COACH-008), "Çözümü göster"
-- (OGR-COACH-009), Kendi çalışmam (OGR-UPL-005), okul denemesi (OGR-UPL-006), eğitmenin ders yüklemesi (OGR-LESSON-008).
-- Her sınır settings'ten okunur (testte 1–2'ye indirilir); yeniden deneme (aynı küme / aynı yükleme) sınıra takılmaz;
-- güvenilir çağıran (service_role JWT'si) muaftır. Ayrıca coach_log_llm_call coach_lite rotasını kendi adıyla yazar.
begin;
\ir _fixture.sql

-- Sunucu jetonu (16_coach_rpcs.sql ile aynı)
create function t.coach_token(p_conv uuid, p_ttl int default 600) returns text language plpgsql security definer as $$
declare
  v_exp text := (floor(extract(epoch from now())) + p_ttl)::bigint::text;
begin
  return 'v1.' || v_exp || '.' || encode(hmac(convert_to('coach:' || p_conv::text || ':' || v_exp, 'UTF8'),
                                              convert_to((select k.secret from secure.server_keys k where k.name = 'web_coach'), 'UTF8'), 'sha256'), 'hex');
end $$;
revoke all on function t.coach_token(uuid, int) from public;

-- Güvenilir çağıran, kimliği belli (service_role JWT'si + sub): app.is_trusted() true, auth.uid() dolu
create function t.as_trusted(p_sub uuid) returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role', 'sub', p_sub)::text, true);
end $$;

do $$
begin
  perform t.ok((select count(*) = 5 from public.settings st
                 where st.key in ('coach_turns_daily_max', 'coach_deep_daily_max', 'uploads_daily_max', 'exam_uploads_daily_max',
                                  'lesson_uploads_daily_max')), 'beş günlük sınır settings''te');
  perform t.ok(app.setting_num('coach_turns_daily_max', 0) = 150 and app.setting_num('coach_deep_daily_max', 0) = 20
               and app.setting_num('uploads_daily_max', 0) = 20 and app.setting_num('exam_uploads_daily_max', 0) = 3
               and app.setting_num('lesson_uploads_daily_max', 0) = 10, 'varsayılanlar 150 / 20 / 20 / 3 / 10');
end $$;

-- Koç: tur ve "Çözümü göster" sınırı; coach_lite defteri
do $$
declare
  v_conv uuid;
  v_msg jsonb := '[{"type": "text", "text": "Bu soruyu anlamadım"}]';
  v_id bigint;
  v_tok text;
begin
  update public.settings st set value = '2'::jsonb where st.key = 'coach_turns_daily_max';
  perform t.as_user(t.u('elif'));
  v_conv := public.coach_open_conversation(null, 'hint');
  perform t.as_admin();
  v_tok := t.coach_token(v_conv);  -- anahtar authenticated'a kapalı: jeton yönetici bağlamında
  perform t.as_user(t.u('elif'));
  perform public.coach_append_message(v_conv, 'user', v_msg);
  perform public.coach_append_message(v_conv, 'user', v_msg, '{}', null, null, v_tok);
  -- araç sonucu taşıyan user mesajı tur sayılmaz (sunucu turu)
  perform public.coach_append_turn(v_conv, jsonb_build_array(
    jsonb_build_object('role', 'assistant', 'content', '[{"type": "tool_use", "id": "tu1", "name": "get_mastery", "input": {}}]'::jsonb),
    jsonb_build_object('role', 'user', 'content', '[{"type": "tool_result", "tool_use_id": "tu1", "content": "{}"}]'::jsonb)),
    v_tok);
  perform t.raises(format('select public.coach_append_message(%L, ''user'', %L)', v_conv, v_msg), 'OGR-COACH-008%', 'üçüncü tur günlük sınıra takılır');
  perform t.ok(public.coach_append_message(v_conv, 'assistant', '[{"type": "text", "text": "Tamam"}]', '{}', null, null, v_tok) > 0,
               'assistant mesajı sınıra takılmaz');
  perform t.as_trusted(t.u('elif'));
  perform t.ok(public.coach_append_message(v_conv, 'user', v_msg) > 0, 'güvenilir çağıran tur sınırından muaf');

  perform t.as_admin();
  update public.settings st set value = '100'::jsonb where st.key = 'coach_turns_daily_max';
  update public.settings st set value = '1'::jsonb where st.key = 'coach_deep_daily_max';
  perform t.as_user(t.u('elif'));
  perform public.coach_set_mode(v_conv, 'solve');
  perform t.ok(public.coach_append_message(v_conv, 'user', v_msg) > 0, 'ilk derin tur geçer');
  perform public.coach_log_llm_call(v_conv, '{"route": "coach_deep", "model": "claude-opus-5-5", "status": "ok"}', v_tok);
  perform t.raises(format('select public.coach_append_message(%L, ''user'', %L)', v_conv, v_msg), 'OGR-COACH-009%', 'günlük coach_deep sınırı (solve modu)');
  perform public.coach_set_mode(v_conv, 'hint');
  perform t.ok(public.coach_append_message(v_conv, 'user', v_msg) > 0, 'ipucu modunda derin sınır uygulanmaz');
  perform public.coach_set_mode(v_conv, 'solve');
  perform t.as_trusted(t.u('elif'));
  perform t.ok(public.coach_append_message(v_conv, 'user', v_msg) > 0, 'güvenilir çağıran derin sınırdan muaf');

  perform t.as_user(t.u('elif'));
  v_id := public.coach_log_llm_call(v_conv, '{"route": "coach_lite", "purpose": "coach_lite", "model": "claude-haiku-4-5", "status": "ok"}',
                                    v_tok);
  perform t.as_admin();
  perform t.ok((select lc.route = 'coach_lite' and lc.purpose = 'coach_lite' from public.llm_calls lc where lc.id = v_id),
               'coach_lite kendi rota adıyla deftere yazılır');
  perform t.as_user(t.u('elif'));
  perform t.raises(format('select public.coach_log_llm_call(%L, %L, %L)', v_conv, '{"route": "coach_x", "model": "m", "status": "ok"}', v_tok),
                   'OGR-COACH-005%', 'bilinmeyen koç rotası yine reddedilir');
end $$;

-- Kendi çalışmam ve okul denemesi
do $$
begin
  perform t.as_admin();
  insert into t.cfg select k, gen_random_uuid()::text from unnest(array['U1', 'U2', 'U3', 'X1', 'X2', 'X3']) as k;
  insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime)
  select t.u(k), t.u('elif'), t.u('A'), 'photo', t.v('elif') || '/' || t.v(k) || '.jpg', 'image/jpeg'
    from unnest(array['U1', 'U2', 'U3', 'X1', 'X2', 'X3']) as k;
  update public.settings st set value = '1'::jsonb where st.key in ('uploads_daily_max', 'exam_uploads_daily_max');

  perform t.as_user(t.u('elif'));
  perform t.ok((public.submit_upload(array[t.u('U1')], 'own_work') ->> 'reused')::boolean = false, 'ilk gönderim geçer');
  perform t.ok((public.submit_upload(array[t.u('U1')], 'own_work') ->> 'reused')::boolean, 'aynı kümenin yeniden denemesi sınıra takılmaz');
  perform t.raises(format('select public.submit_upload(array[%L]::uuid[], ''own_work'')', t.v('U2')), 'OGR-UPL-005%', 'ikinci gönderim günlük sınıra takılır');
  perform t.ok((public.submit_exam_upload(array[t.u('X1')]) ->> 'reused')::boolean = false, 'ilk deneme yüklemesi geçer');
  perform t.raises(format('select public.submit_exam_upload(array[%L]::uuid[])', t.v('X2')), 'OGR-UPL-006%', 'ikinci deneme yüklemesi günlük sınıra takılır');

  perform t.as_trusted(t.u('elif'));
  perform t.ok((public.submit_upload(array[t.u('U3')], 'own_work') ->> 'reused')::boolean = false, 'güvenilir çağıran yükleme sınırından muaf');
  perform t.ok(public.submit_exam_upload(array[t.u('X3')]) ->> 'session_id' is not null, 'güvenilir çağıran deneme sınırından muaf');
end $$;

-- Eğitmenin ders yüklemesi
do $$
begin
  perform t.as_admin();
  insert into t.cfg select k, gen_random_uuid()::text from unnest(array['L1', 'L2', 'L3']) as k;
  insert into public.uploads (id, owner_id, student_id, kind, storage_path, mime, bytes)
  select t.u(k), t.u('inst'), t.u('A'), 'video', t.v('inst') || '/' || t.v(k) || '.mp4', 'video/mp4', 1000
    from unnest(array['L1', 'L2', 'L3']) as k;
  update public.settings st set value = '1'::jsonb where st.key = 'lesson_uploads_daily_max';

  perform t.as_user(t.u('inst'));
  perform t.ok((public.register_lesson(jsonb_build_object('enrollment_id', t.v('EA')), t.u('L1')) ->> 'created')::boolean, 'ilk ders geçer');
  perform t.ok(not (public.register_lesson(jsonb_build_object('enrollment_id', t.v('EA')), t.u('L1')) ->> 'created')::boolean,
               'aynı yüklemenin yeniden denemesi sınıra takılmaz');
  perform t.raises(format('select public.register_lesson(%L, %L)', jsonb_build_object('enrollment_id', t.v('EA')), t.v('L2')),
                   'OGR-LESSON-008%', 'ikinci ders günlük sınıra takılır');
  perform t.as_trusted(t.u('inst'));
  perform t.ok((public.register_lesson(jsonb_build_object('enrollment_id', t.v('EA'), 'instructor_id', t.v('inst')), t.u('L3')) ->> 'created')::boolean,
               'güvenilir çağıran ders sınırından muaf');
end $$;

rollback;
