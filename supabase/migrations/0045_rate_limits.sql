-- 0045_rate_limits.sql — pahalı, kullanıcının tetiklediği işlere günlük sınır (documents_daily_max / 0034 ve
-- parent_reports_daily_max / 0043 ile aynı kalıp): settings anahtarı + varsayılan, İstanbul günü, OGR- kodu. Güvenilir
-- çağıran (app.is_trusted: worker, service_role) ve admin muaftır. Fonksiyonlar en son tanımlarından birebir kopyalanır;
-- yalnız sınır denetimi eklenir (imzalar, yetkiler, search_path aynı).
--   * coach_turns_daily_max (150): coach_append_message, öğrencinin 'user' mesajı (araç sonucu sayılmaz) → OGR-COACH-008
--   * coach_deep_daily_max (20): aynı yer, sohbet solve modundaysa; bugünkü llm_calls(route = coach_deep) satırları
--     sayılır (araçlı bir tur birden çok satır yazabilir; sınır bu yüzden yumuşaktır) → OGR-COACH-009
--   * uploads_daily_max (20): submit_upload (Kendi çalışmam → teşhis), bugünkü 'upload.submit' gönderimleri → OGR-UPL-005
--   * exam_uploads_daily_max (3): submit_exam_upload, bugün açılan düşmemiş yüklenmiş deneme oturumları → OGR-UPL-006
--   * lesson_uploads_daily_max (10, eğitmen başına): register_lesson, bugün açılan düşmemiş dersler → OGR-LESSON-008
-- Ayrıca coach_log_llm_call coach_lite rotasını (harcama tavanında Haiku) kendi adıyla kabul eder.

insert into public.settings (key, value, description) values
  ('coach_turns_daily_max', '150'::jsonb, 'Öğrencinin bir İstanbul gününde en çok koç turu (coach_append_message user mesajı; OGR-COACH-008)'),
  ('coach_deep_daily_max', '20'::jsonb, 'Öğrencinin bir İstanbul gününde en çok "Çözümü göster" (coach_deep) çağrısı (OGR-COACH-009)'),
  ('uploads_daily_max', '20'::jsonb, 'Öğrencinin bir İstanbul gününde en çok Kendi çalışmam gönderimi (submit_upload; OGR-UPL-005)'),
  ('exam_uploads_daily_max', '3'::jsonb, 'Öğrencinin bir İstanbul gününde en çok okul denemesi yüklemesi (submit_exam_upload; başarısızlar sayılmaz, OGR-UPL-006)'),
  ('lesson_uploads_daily_max', '10'::jsonb, 'Eğitmenin bir İstanbul gününde en çok ders yüklemesi (register_lesson; başarısızlar sayılmaz, OGR-LESSON-008)')
on conflict (key) do nothing;

-- --- coach_append_message ------------------------------------------------------------------------------------------

-- Tek mesaj. Jetonsuz (istemci ya da öğrencinin kendi turu): yalnız role='user', app.coach_client_blocks_ok blokları,
-- llm_call_id ve tool_calls yok. Sunucu jetonuyla: assistant/system turları, araç blokları, defter bağı ve tur kaydı.
create or replace function public.coach_append_message(
  p_conversation uuid, p_role text, p_content jsonb, p_upload_ids uuid[] default '{}', p_llm_call_id bigint default null,
  p_tool_calls jsonb default null, p_server_token text default null
) returns bigint
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.coach_conversation(p_conversation);
  v_day timestamptz := (date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul');
  v_max int;
  v_used int;
begin
  if not app.coach_server_ok(p_conversation, p_server_token) then
    if coalesce(p_role, '') <> 'user' then
      raise exception using errcode = '42501',
        message = 'OGR-COACH-001 assistant ve system turlarını yalnız web sunucusu yazar (sunucu jetonu gerekli)';
    end if;
    if p_llm_call_id is not null or p_tool_calls is not null or not app.coach_client_blocks_ok(p_content, p_upload_ids) then
      raise exception using errcode = '42501',
        message = 'OGR-COACH-001 istemci yalnız metin ve yükleme başvurusu bloğu yazar; araç blokları, ek anahtarlar, defter bağı ve tur kaydı yalnız web sunucusundan (sunucu jetonu gerekli)';
    end if;
  end if;
  -- günlük sınır (0045): öğrencinin turu = araç sonucu taşımayan 'user' mesajı; "Çözümü göster" (solve → coach_deep)
  -- turunda ayrıca bugünkü coach_deep defter satırları sayılır. Güvenilir çağıran ve admin muaf.
  if p_role = 'user' and not app.is_trusted() and not app.is_admin() then
    perform pg_advisory_xact_lock(hashtext('coach_turns:' || v_conv.student_id::text));
    v_max := app.setting_num('coach_turns_daily_max', 150)::int;
    select count(*) into v_used
      from public.conversation_messages m join public.conversations c on c.id = m.conversation_id
     where c.student_id = v_conv.student_id and c.kind = 'coach' and m.role = 'user' and m.created_at >= v_day
       and not jsonb_path_exists(m.content, '$[*] ? (@.type == "tool_result")');
    if v_used >= v_max then
      raise exception using errcode = 'P0001', message = format('OGR-COACH-008 bugünkü sohbet sınırı doldu (%s); yarın devam edebilirsin', v_max);
    end if;
    if v_conv.mode = 'solve' then
      v_max := app.setting_num('coach_deep_daily_max', 20)::int;
      select count(*) into v_used from public.llm_calls lc
       where lc.route = 'coach_deep' and lc.ref_table = 'conversations' and lc.created_at >= v_day
         and lc.student_ref = (select s.public_ref from public.students s where s.id = v_conv.student_id);
      if v_used >= v_max then
        raise exception using errcode = 'P0001', message = format('OGR-COACH-009 bugünkü "Çözümü göster" sınırı doldu (%s); yarın devam edebilirsin', v_max);
      end if;
    end if;
  end if;
  return app.coach_insert_message(v_conv, p_role, p_content, p_upload_ids, p_llm_call_id, p_tool_calls);
end
$$;
comment on function public.coach_append_message(uuid, text, jsonb, uuid[], bigint, jsonb, text) is 'Koç: mesaj ekler; jetonsuz yalnız öğrencinin user mesajı, assistant/system/araç turu yalnız sunucu jetonuyla (OGR-COACH-001); günlük sınır coach_turns_daily_max (OGR-COACH-008), solve modunda coach_deep_daily_max (OGR-COACH-009).';

-- --- coach_log_llm_call --------------------------------------------------------------------------------------------

-- Defter: koç rotalarının llm_calls satırı (spend_ledger tetikleyicisi). student_ref sohbetin öğrencisinden, ref sohbet;
-- cost_usd ≤ settings.llm_call_max_cost_usd; yalnız sunucu jetonuyla.
create or replace function public.coach_log_llm_call(p_conversation uuid, p_call jsonb, p_server_token text default null) returns bigint
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_conv public.conversations%rowtype := app.coach_conversation(p_conversation);
  v_route text := p_call ->> 'route';
  v_id bigint;
begin
  perform app.coach_require_server(p_conversation, p_server_token);
  if coalesce(jsonb_typeof(p_call), '') <> 'object' or coalesce(v_route, '') not in ('coach_chat', 'coach_deep', 'coach_lite')
     or coalesce(nullif(p_call ->> 'purpose', ''), v_route) not in ('coach_chat', 'coach_deep', 'coach_lite')
     or nullif(p_call ->> 'model', '') is null or nullif(p_call ->> 'status', '') is null then
    raise exception using errcode = 'P0001', message = 'OGR-COACH-005 koç defter satırı: route/purpose coach_chat|coach_deep|coach_lite, model ve status gerekli';
  end if;
  begin
    if coalesce((p_call ->> 'cost_usd')::numeric, 0) > app.setting_num('llm_call_max_cost_usd', 5) then
      raise exception using errcode = 'P0001', message = format('OGR-LLM-001 cost_usd çağrı başına üst sınırı (%s) aşıyor',
                                                               app.setting_num('llm_call_max_cost_usd', 5));
    end if;
    insert into public.llm_calls (route, purpose, provider, model, effort, prompt_version, tokens_in, tokens_out, cache_read_tokens,
                                  cache_write_tokens, images, batch, status, error_code, latency_ms, cost_usd, ref_table, ref_id,
                                  student_ref)
    values (v_route, coalesce(nullif(p_call ->> 'purpose', ''), v_route), 'anthropic', p_call ->> 'model', p_call ->> 'effort',
            left(p_call ->> 'prompt_version', 64), coalesce((p_call ->> 'tokens_in')::int, 0), coalesce((p_call ->> 'tokens_out')::int, 0),
            coalesce((p_call ->> 'cache_read_tokens')::int, 0), coalesce((p_call ->> 'cache_write_tokens')::int, 0),
            (p_call ->> 'images')::int, false, p_call ->> 'status', left(p_call ->> 'error_code', 120), (p_call ->> 'latency_ms')::int,
            coalesce((p_call ->> 'cost_usd')::numeric, 0), 'conversations', v_conv.id::text,
            (select s.public_ref from public.students s where s.id = v_conv.student_id))
    returning id into v_id;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = format('OGR-LLM-001 geçersiz çağrı kaydı: %s', sqlerrm);
  end;
  return v_id;
end
$$;
comment on function public.coach_log_llm_call(uuid, jsonb, text) is 'Koç: coach_chat/coach_deep/coach_lite llm_calls satırı (student_ref ve ref sohbetten; maliyet tavanı); yalnız sunucu jetonuyla.';

-- --- submit_upload -------------------------------------------------------------------------------------------------

-- Okul denemesinin tek giriş yolu submit_exam_upload'dur (meta doğrulaması, 'exam.submit' yeniden deneme anahtarı,
-- duration_min, düşmüş analizin yeniden gönderimi): p_kind = 'school_exam' OGR-UPL-001. own_work davranışı 0026 ile aynı.
create or replace function public.submit_upload(p_upload_ids uuid[], p_kind text) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
  v_ids uuid[] := coalesce(p_upload_ids, '{}');
  v_max int;
  v_found int;
  v_bad int;
  v_enr uuid;
  v_job uuid;
  v_prev jsonb;
  v_set jsonb;
  v_open int;
  v_used int;
begin
  if v_student is null or auth.uid() is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 yükleme yalnız öğrenci oturumunda gönderilir';
  end if;
  if p_kind = 'school_exam' then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-001 okul denemesi submit_exam_upload ile gönderilir';
  end if;
  v_max := case p_kind when 'own_work' then 4 end;
  if v_max is null then
    raise exception using errcode = 'P0001', message = format('OGR-UPL-001 yükleme türü geçersiz: %s', coalesce(p_kind, '(boş)'));
  end if;
  if cardinality(v_ids) < 1 or cardinality(v_ids) > v_max
     or (select count(distinct x.u) from unnest(v_ids) as x (u)) <> cardinality(v_ids)
     or array_position(v_ids, null) is not null then
    raise exception using errcode = 'P0001',
      message = format('OGR-UPL-001 %s için 1–%s tekil sayfa gerekir (gelen %s)', p_kind, v_max, cardinality(v_ids));
  end if;

  -- yüklemeler: çağıranın ve öğrencisinin; aynı kümenin eşzamanlı ikinci gönderimi burada bekler
  perform 1 from public.uploads u where u.id = any(v_ids) order by u.id for update;
  select count(*), count(*) filter (where u.status not in ('stored', 'processing')), count(*) filter (where u.status = 'processing')
    into v_found, v_bad, v_open
    from public.uploads u
   where u.id = any(v_ids) and u.owner_id = auth.uid() and u.student_id = v_student;
  if v_found <> cardinality(v_ids) then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-002 yükleme bulunamadı ya da senin değil';
  end if;

  select e.id into v_enr from public.enrollments e
   where e.student_id = v_student and e.status = 'active'
   order by e.created_at desc, e.id
   limit 1;
  if v_enr is null then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-004 etkin ders kaydı yok';
  end if;

  -- yeniden deneme: tam aynı küme (sırasız) ve aynı tür için atılmış gönderim varsa ikinci iş yok (küme işlenmiş olsa da)
  v_set := (select jsonb_agg(x.u order by x.u) from unnest(v_ids) as x (u));
  select ae.diff into v_prev from audit.events ae
   where ae.action = 'upload.submit' and ae.row_id = v_set ->> 0 and ae.diff -> 'upload_set' = v_set
     and ae.diff ->> 'kind' = p_kind
   order by ae.created_at desc, ae.id desc limit 1;
  if v_prev is not null then
    return jsonb_build_object('enrollment_id', v_prev ->> 'enrollment_id', 'job_id', v_prev ->> 'job_id',
                              'upload_ids', to_jsonb(v_ids), 'kind', p_kind, 'reused', true);
  end if;
  -- başka gönderimin sayfası: işlenmiş (ready/failed) ya da işleniyor (farklı küme, alt küme, farklı tür)
  if v_bad > 0 then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-003 yükleme zaten işlendi';
  end if;
  if v_open > 0 then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-003 sayfaların bir kısmı başka bir gönderimde işleniyor';
  end if;

  -- günlük sınır (0045): bugünkü 'upload.submit' gönderimleri (yeniden deneme yukarıda döner, sayılmaz); admin muaf
  if not app.is_trusted() and not app.is_admin() then
    perform pg_advisory_xact_lock(hashtext('upload_submit:' || v_student::text));
    v_max := app.setting_num('uploads_daily_max', 20)::int;
    select count(*) into v_used from audit.events ae
     where ae.action = 'upload.submit' and ae.created_at >= (date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul')
       and ae.diff ->> 'enrollment_id' in (select e.id::text from public.enrollments e where e.student_id = v_student);
    if v_used >= v_max then
      raise exception using errcode = 'P0001', message = format('OGR-UPL-005 bugünkü yükleme sınırı doldu (%s); yarın yeniden gönderebilirsin', v_max);
    end if;
  end if;

  update public.uploads u set status = 'processing' where u.id = any(v_ids) and u.status <> 'processing';
  v_job := public.enqueue_job('upload.intake', jsonb_build_object(
    'upload_ids', to_jsonb(v_ids), 'kind', p_kind, 'student_id', v_student, 'enrollment_id', v_enr));
  perform app.audit_event('upload.submit', 'public.uploads', v_set ->> 0,
                          jsonb_build_object('upload_ids', to_jsonb(v_ids), 'upload_set', v_set, 'kind', p_kind,
                                             'enrollment_id', v_enr, 'job_id', v_job));
  return jsonb_build_object('enrollment_id', v_enr, 'job_id', v_job, 'upload_ids', to_jsonb(v_ids), 'kind', p_kind, 'reused', false);
end
$$;
comment on function public.submit_upload(uuid[], text) is 'Öğrenci: Kendi çalışmam sayfalarını doğrular, processing yapar, upload.intake işini kuyruğa atar (aynı küme + türün yeniden denemesinde aynı iş; başka gönderimin sayfası OGR-UPL-003); okul denemesi submit_exam_upload ile (school_exam OGR-UPL-001); günlük sınır uploads_daily_max (OGR-UPL-005).';

-- --- submit_exam_upload --------------------------------------------------------------------------------------------

-- Öğrenci "Okul denemesi" sayfalarını gönderir (1–40 sayfa: kitapçık, optik form, karalama, varsa anahtar; sınıflamayı
-- worker yapar). p_meta (isteğe bağlı, bilinmeyen anahtar yok sayılır): title (≤ 120), publisher (≤ 80), held_on
-- (YYYY-AA-GG), enrollment_id (öğrencinin etkin kaydı; yoksa en son açılan etkin kayıt), duration_min (1–600).
-- Telif: yüklenen deneme her zaman is_copyrighted = true açılır (soru metni öğrenciye gösterilmez; personel değiştirir).
-- Yeniden deneme: aynı küme (sırasız) yeni sınav açmaz, ilk gönderimi döner (reused); kümenin bir kısmı başka gönderimde
-- işleniyor ya da işlenmişse OGR-UPL-003 (submit_upload ile aynı kural, anahtar audit.events 'exam.submit').
-- Analizi düşmüş (failed) gönderim yeniden kullanılmaz: aynı ya da yeni küme yeni sınav + oturum açar; öğrencinin düşmüş
-- bir deneme oturumundaki 'failed' sayfalar kabul edilir (40 sayfayı yeniden çekmek gerekmez; exam_how_far'daki kural).
-- Döner: {exam_id, session_id, enrollment_id, job_id, upload_ids, reused}.
create or replace function public.submit_exam_upload(p_upload_ids uuid[], p_meta jsonb default '{}'::jsonb) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid := app.my_student_id();
  v_ids uuid[] := coalesce(p_upload_ids, '{}');
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
  v_found int;
  v_bad int;
  v_open int;
  v_enr public.enrollments%rowtype;
  v_set jsonb;
  v_prev jsonb;
  v_title text;
  v_publisher text;
  v_held date;
  v_dur int;
  v_exam uuid;
  v_sess uuid;
  v_job uuid;
  v_max int;
  v_used int;
begin
  if v_student is null or auth.uid() is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 deneme yüklemesi yalnız öğrenci oturumunda gönderilir';
  end if;
  if cardinality(v_ids) < 1 or cardinality(v_ids) > 40
     or (select count(distinct x.u) from unnest(v_ids) as x (u)) <> cardinality(v_ids)
     or array_position(v_ids, null) is not null then
    raise exception using errcode = 'P0001',
      message = format('OGR-UPL-001 okul denemesi için 1–40 tekil sayfa gerekir (gelen %s)', cardinality(v_ids));
  end if;
  if jsonb_typeof(v_meta) <> 'object' then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 p_meta nesne olmalı';
  end if;
  v_title := nullif(btrim(v_meta ->> 'title'), '');
  v_publisher := nullif(btrim(v_meta ->> 'publisher'), '');
  if length(v_title) > 120 or length(v_publisher) > 80 then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 başlık en çok 120, yayınevi en çok 80 karakter';
  end if;
  if nullif(v_meta ->> 'held_on', '') is not null then
    if (v_meta ->> 'held_on') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 held_on YYYY-AA-GG olmalı';
    end if;
    begin
      v_held := (v_meta ->> 'held_on')::date;
    exception when others then
      raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 held_on geçerli bir tarih değil';
    end;
  end if;
  if nullif(v_meta ->> 'duration_min', '') is not null then
    if (v_meta ->> 'duration_min') !~ '^[0-9]{1,3}$' or (v_meta ->> 'duration_min')::int not between 1 and 600 then
      raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 duration_min 1–600 dakika olmalı';
    end if;
    v_dur := (v_meta ->> 'duration_min')::int;
  end if;

  perform 1 from public.uploads u where u.id = any(v_ids) order by u.id for update;
  -- işlenmiş sayılmayan: stored, processing ve öğrencinin düşmüş deneme oturumundaki failed sayfa
  select count(*),
         count(*) filter (where u.status not in ('stored', 'processing')
                            and not (u.status = 'failed'
                                     and exists (select 1 from public.exam_sessions es join public.enrollments e on e.id = es.enrollment_id
                                                  where es.mode = 'uploaded' and es.status = 'failed' and u.id = any(es.upload_ids)
                                                    and e.student_id = v_student))),
         count(*) filter (where u.status = 'processing')
    into v_found, v_bad, v_open
    from public.uploads u
   where u.id = any(v_ids) and u.owner_id = auth.uid() and u.student_id = v_student;
  if v_found <> cardinality(v_ids) then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-002 yükleme bulunamadı ya da senin değil';
  end if;

  if nullif(v_meta ->> 'enrollment_id', '') is not null then
    if (v_meta ->> 'enrollment_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P0001', message = 'OGR-EXAM-007 enrollment_id geçersiz';
    end if;
    select e.* into v_enr from public.enrollments e
     where e.id = (v_meta ->> 'enrollment_id')::uuid and e.student_id = v_student and e.status = 'active';
  else
    select e.* into v_enr from public.enrollments e
     where e.student_id = v_student and e.status = 'active'
     order by e.created_at desc, e.id
     limit 1;
  end if;
  if v_enr.id is null then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-004 etkin ders kaydı yok';
  end if;

  -- yeniden deneme: aynı küme için açılmış ve düşmemiş deneme varsa yenisi açılmaz
  v_set := (select jsonb_agg(x.u order by x.u) from unnest(v_ids) as x (u));
  select ae.diff into v_prev from audit.events ae
    join public.exam_sessions es on es.id = (ae.diff ->> 'session_id')::uuid
   where ae.action = 'exam.submit' and ae.row_id = v_set ->> 0 and ae.diff -> 'upload_set' = v_set and es.status <> 'failed'
   order by ae.created_at desc, ae.id desc limit 1;
  if v_prev is not null then
    return jsonb_build_object('exam_id', v_prev ->> 'exam_id', 'session_id', v_prev ->> 'session_id',
                              'enrollment_id', v_prev ->> 'enrollment_id', 'job_id', v_prev ->> 'job_id',
                              'upload_ids', to_jsonb(v_ids), 'reused', true);
  end if;
  if v_bad > 0 then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-003 yükleme zaten işlendi';
  end if;
  if v_open > 0 then
    raise exception using errcode = 'P0001', message = 'OGR-UPL-003 sayfaların bir kısmı başka bir gönderimde işleniyor';
  end if;

  -- günlük sınır (0045): bugün açılan, düşmemiş yüklenmiş deneme oturumları (yeniden deneme yukarıda döner); admin muaf
  if not app.is_trusted() and not app.is_admin() then
    perform pg_advisory_xact_lock(hashtext('exam_submit:' || v_student::text));
    v_max := app.setting_num('exam_uploads_daily_max', 3)::int;
    select count(*) into v_used from public.exam_sessions es join public.enrollments e on e.id = es.enrollment_id
     where e.student_id = v_student and es.mode = 'uploaded' and es.status <> 'failed' and es.created_at >= (date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul');
    if v_used >= v_max then
      raise exception using errcode = 'P0001', message = format('OGR-UPL-006 bugünkü deneme yükleme sınırı doldu (%s); yarın yeniden gönderebilirsin', v_max);
    end if;
  end if;

  insert into public.exams (course_id, curriculum_id, created_by, kind, source, title, publisher, held_on, is_copyrighted, status, duration_min)
  values (v_enr.course_id, v_enr.curriculum_id, auth.uid(), 'deneme', 'uploaded', coalesce(v_title, app.exam_default_title(now())),
          v_publisher, v_held, true, 'processing', v_dur)
  returning id into v_exam;
  insert into public.exam_sessions (exam_id, enrollment_id, mode, status, upload_ids, progress)
  values (v_exam, v_enr.id, 'uploaded', 'grading', v_ids,
          jsonb_build_object('stage', 'classify', 'pages_total', cardinality(v_ids), 'pages_done', 0, 'updated_at', now()))
  returning id into v_sess;
  update public.uploads u set status = 'processing' where u.id = any(v_ids) and u.status <> 'processing';
  v_job := public.enqueue_job('exam.analyse', jsonb_build_object(
    'session_id', v_sess, 'exam_id', v_exam, 'enrollment_id', v_enr.id, 'student_id', v_student, 'upload_ids', to_jsonb(v_ids)));
  perform app.audit_event('exam.submit', 'public.exam_sessions', v_set ->> 0,
                          jsonb_build_object('upload_ids', to_jsonb(v_ids), 'upload_set', v_set, 'exam_id', v_exam,
                                             'session_id', v_sess, 'enrollment_id', v_enr.id, 'job_id', v_job));
  return jsonb_build_object('exam_id', v_exam, 'session_id', v_sess, 'enrollment_id', v_enr.id, 'job_id', v_job,
                            'upload_ids', to_jsonb(v_ids), 'reused', false);
end
$$;
comment on function public.submit_exam_upload(uuid[], jsonb) is 'Öğrenci: okul denemesi sayfaları → exams(deneme, uploaded, telifli) + exam_sessions(uploaded, grading) + exam.analyse işi; aynı kümenin yeniden denemesi aynı denemeyi döner (düşmüş analiz: yeni deneme, failed sayfalar kabul); günlük sınır exam_uploads_daily_max (OGR-UPL-006).';

-- --- register_lesson -----------------------------------------------------------------------------------------------

-- Dersi açar (eğitmen). p_upload_id: 'lessons' kovasına TUS ile yüklenmiş video | ses | transkript (uploads satırı,
-- çağıranın). p_meta: {enrollment_id | course_id (biri gerekli; birebir derste course_id kaydın dersidir), held_at?,
-- title?, duration_sec?, student_visible? (false), auto_apply_threshold? (0.50–1.00, varsayılan 0.80),
-- transcript_upload_id?, instructor_id? (yalnız güvenilir çağıran)}. Birebir derste yetki kanıt yazımı kuralıdır
-- (owner eğitmen, admin, worker); sınıf dersinde özel (private) dersin oluşturanı ya da derse etkin kayıtlı en az bir
-- öğrencisinin owner eğitmeni (viewer bağı yetmez). Sınıf dersinin kapsamı dersi verenin kendi öğrencileridir
-- (app.lesson_students); ortak derste başka eğitmenlerin öğrencileri etkilenmez.
-- Yüklemeler eğitmen arşivine alınır (uploads.student_id = null: öğrenci ham medyayı ve satırı görmez) ve processing
-- olur. Aynı yüklemeyle yeniden çağrı aynı dersi döner (yeni iş atılmaz). Ham medya varsa retain_until = şimdi + 90 gün.
create or replace function public.register_lesson(p_meta jsonb, p_upload_id uuid) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
  v_trusted boolean := app.is_trusted();
  v_up public.uploads%rowtype;
  v_tr public.uploads%rowtype;
  v_enr public.enrollments%rowtype;
  v_course public.courses%rowtype;
  v_existing public.lessons%rowtype;
  v_uuid_re text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_enrollment uuid;
  v_course_id uuid;
  v_tr_id uuid;
  v_instructor uuid;
  v_held timestamptz;
  v_title text;
  v_dur int;
  v_vis boolean;
  v_thr numeric;
  v_days numeric;
  v_id uuid;
  v_job uuid;
  v_max int;
  v_used int;
begin
  if not v_trusted and not app.is_staff() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 dersi yalnız eğitmen ya da admin kaydeder';
  end if;
  if jsonb_typeof(v_meta) <> 'object' then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 p_meta bir nesne olmalı';
  end if;
  if p_upload_id is null then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 ders yüklemesi (p_upload_id) gerekli';
  end if;
  foreach v_title in array array['enrollment_id', 'course_id', 'transcript_upload_id', 'instructor_id'] loop
    if v_meta ? v_title and jsonb_typeof(v_meta -> v_title) <> 'null'
       and coalesce(v_meta ->> v_title, '') !~ v_uuid_re then
      raise exception using errcode = 'P0001', message = format('OGR-LESSON-001 %s geçerli bir kimlik değil', v_title);
    end if;
  end loop;
  select u.* into v_up from public.uploads u where u.id = p_upload_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 yükleme bulunamadı';
  end if;
  if not v_trusted and v_up.owner_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 yükleme çağırana ait değil';
  end if;
  if v_up.kind not in ('video', 'audio', 'transcript') then
    raise exception using errcode = 'P0001', message = format('OGR-LESSON-001 ders yüklemesi video, ses ya da transkript olmalı (%s)', v_up.kind);
  end if;
  select l.* into v_existing from public.lessons l where l.upload_id = p_upload_id;
  if found then
    if not app.lesson_can_manage(v_existing.id) then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu ders için yetki yok';
    end if;
    return jsonb_build_object('lesson_id', v_existing.id, 'status', v_existing.status, 'created', false, 'job_id', null);
  end if;

  v_enrollment := nullif(v_meta ->> 'enrollment_id', '')::uuid;
  v_course_id := nullif(v_meta ->> 'course_id', '')::uuid;
  if v_enrollment is null and v_course_id is null then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 enrollment_id ya da course_id gerekli';
  end if;
  if v_enrollment is not null then
    select e.* into v_enr from public.enrollments e where e.id = v_enrollment;
    if not found then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 kayıt bulunamadı';
    end if;
    perform app.assert_evidence_writer(v_enr.student_id);
    if v_course_id is not null and v_course_id is distinct from v_enr.course_id then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 course_id kaydın dersiyle aynı olmalı';
    end if;
    v_course_id := v_enr.course_id;
  else
    select c.* into v_course from public.courses c where c.id = v_course_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 ders bulunamadı';
    end if;
    if v_course.curriculum_id is null then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-002 dersin müfredatı yok (önce müfredat eşlenmeli)';
    end if;
    if not v_trusted and not app.is_admin()
       and not (v_course.visibility = 'private' and v_course.created_by is not distinct from auth.uid())
       and not exists (select 1 from public.enrollments e join public.instructor_links il on il.student_id = e.student_id
                        where e.course_id = v_course_id and e.status = 'active'
                          and il.instructor_id = auth.uid() and il.role = 'owner'
                          and (il.course_id is null or il.course_id = v_course_id)) then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu ders için yetki yok (derste owner olduğunuz öğrenci yok)';
    end if;
  end if;

  begin
    v_held := coalesce(nullif(v_meta ->> 'held_at', '')::timestamptz, now());
  exception when others then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 held_at geçerli bir zaman değil';
  end;
  if v_held > now() + interval '1 day' then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 held_at gelecekte olamaz';
  end if;
  v_title := nullif(left(btrim(coalesce(v_meta ->> 'title', '')), 120), '');
  if v_meta ? 'duration_sec' and jsonb_typeof(v_meta -> 'duration_sec') <> 'null' then
    if jsonb_typeof(v_meta -> 'duration_sec') <> 'number' or (v_meta ->> 'duration_sec')::numeric not between 1 and 86400 then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 duration_sec 1–86400 arası bir sayı olmalı';
    end if;
    v_dur := round((v_meta ->> 'duration_sec')::numeric)::int;
  end if;
  if v_meta ? 'student_visible' and jsonb_typeof(v_meta -> 'student_visible') not in ('boolean', 'null') then
    raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 student_visible mantıksal olmalı';
  end if;
  v_vis := coalesce((v_meta ->> 'student_visible')::boolean, false);
  if v_meta ? 'auto_apply_threshold' and jsonb_typeof(v_meta -> 'auto_apply_threshold') <> 'null' then
    if jsonb_typeof(v_meta -> 'auto_apply_threshold') <> 'number'
       or (v_meta ->> 'auto_apply_threshold')::numeric not between 0.5 and 1 then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 auto_apply_threshold 0,50–1,00 arası olmalı';
    end if;
    v_thr := round((v_meta ->> 'auto_apply_threshold')::numeric, 2);
  end if;

  v_tr_id := nullif(v_meta ->> 'transcript_upload_id', '')::uuid;
  if v_tr_id is null and v_up.kind = 'transcript' then
    v_tr_id := p_upload_id;
  end if;
  if v_tr_id is not null and v_tr_id <> p_upload_id then
    select u.* into v_tr from public.uploads u where u.id = v_tr_id for update;
    if not found or v_tr.kind <> 'transcript' then
      raise exception using errcode = 'P0001', message = 'OGR-LESSON-001 transcript_upload_id bir transkript yüklemesi olmalı';
    end if;
    if not v_trusted and v_tr.owner_id is distinct from auth.uid() then
      raise exception using errcode = '42501', message = 'OGR-AUTH-001 transkript yüklemesi çağırana ait değil';
    end if;
  end if;
  v_instructor := case when v_trusted then nullif(v_meta ->> 'instructor_id', '')::uuid else auth.uid() end;
  v_days := greatest(app.setting_num('lesson_video_retention_days', 90), 1);

  -- günlük sınır (0045): eğitmenin bugün açtığı, düşmemiş dersler (aynı yükleme yukarıda döner); güvenilir çağıran ve admin muaf
  if not v_trusted and not app.is_admin() then
    perform pg_advisory_xact_lock(hashtext('lesson_register:' || v_instructor::text));
    v_max := app.setting_num('lesson_uploads_daily_max', 10)::int;
    select count(*) into v_used from public.lessons l
     where l.instructor_id = v_instructor and l.status <> 'failed' and l.created_at >= (date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul');
    if v_used >= v_max then
      raise exception using errcode = 'P0001', message = format('OGR-LESSON-008 bugünkü ders yükleme sınırı doldu (%s)', v_max);
    end if;
  end if;

  insert into public.lessons (enrollment_id, course_id, upload_id, transcript_upload_id, instructor_id, held_at, title,
                              duration_sec, duration_min, student_visible, auto_apply_threshold, status, progress, retain_until)
  values (v_enrollment, v_course_id, p_upload_id, v_tr_id, v_instructor, v_held, v_title,
          v_dur, case when v_dur is not null then ceil(v_dur / 60.0)::int end, v_vis, coalesce(v_thr, 0.80), 'processing',
          jsonb_build_object('stage', 'prepare', 'updated_at', now()),
          case when v_up.kind in ('video', 'audio') then now() + make_interval(days => v_days::int) end)
  returning id into v_id;

  -- eğitmen arşivi: ham medya ve transkript dosyası öğrenciye (uploads_select) görünmez
  update public.uploads u
     set student_id = null,
         status = case when u.status in ('stored', 'failed') then 'processing' else u.status end
   where u.id in (p_upload_id, v_tr_id);

  v_job := app.try_enqueue('lesson.prepare', jsonb_build_object('lesson_id', v_id, 'upload_id', p_upload_id,
                                                                'transcript_upload_id', v_tr_id, 'upload_kind', v_up.kind));
  return jsonb_build_object('lesson_id', v_id, 'status', 'processing', 'created', true, 'job_id', v_job);
end
$$;
comment on function public.register_lesson(jsonb, uuid) is 'Eğitmen: ders yüklemesinden dersi açar (kayıt ya da sınıf dersi), yüklemeyi eğitmen arşivine alır, lesson.prepare işini atar; aynı yüklemede aynı ders; günlük sınır lesson_uploads_daily_max (OGR-LESSON-008).';
