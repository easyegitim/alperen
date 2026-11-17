-- 0042_notification_engine.sql — bildirim kural motoru (P6; docs/PLAN-v2.md §10, PLAN-v2-detail §2.3).
--
-- notifications / notification_rules / push_subscriptions 0013'te, RLS 0018'dedir. Bu göç kural motorunun SQL yarısını
-- ekler; zamanlanmış kuralları (haftalık özet, sessizlik, ilerleme, yanılgı çözüldü) worker değerlendirir ve
-- emit_notification ile yazar, olay kuralları (deneme analiz edildi, eğitmen notu) tetikleyicilerle buradadır.
--
--   app.notification_defaults()          tür → varsayılan kural {enabled, params}; satırı olmayan alıcı için geçerli olan
--                                        (exam_analysed, weekly_summary Pazar 19:00, inactivity 5 gün, improvement,
--                                        misconception_resolved, instructor_note_shared; ayrıca report_ready, guardian_linked)
--   app.notification_rule(alıcı, tür)    etkin kural: varsayılan || notification_rules satırı (params birleşir)
--   app.notify_emit(...)                 tek yazım yolu (iç): kural kapalıysa null; aynı alıcı + tür + tekilleştirme anahtarı
--                                        24 saat içinde varsa null; kanallar kuraldan (in_app her zaman); push kanalı ve
--                                        abonelik varsa 'push.send {notification_id}' işi aynı işlemde
--   emit_notification(alıcı, tür, yük)   worker (service_role / güvenilir çağıran) için genel giriş; yükte student_id varsa
--                                        alıcı o öğrenciyle bağlı olmalı (OGR-NOTIF-003)
--   notification_targets(tür)            worker: kuralı açık veliler × aktif çocuklar (+ son etkinlik, son gönderim)
--   set_notification_rule, list_notification_rules, list_notifications, mark_notification_read,
--   register_push_subscription, unregister_push_subscription   kullanıcı (authenticated) RPC'leri
--   tetikleyiciler                       exam_sessions → done: 'exam_analysed' öğrenciye ve aktif velilere;
--                                        lesson_claims next_step/homework onaylanınca (ya da ders öğrenciye açılınca):
--                                        'instructor_note_shared' aktif velilere (yalnız student_visible ders)
--
-- E-posta kanalı (Resend) worker'dadır: channels 'email' içeren ve sent_at boş satırlar; SQL e-posta işi atmaz.
-- Bildirim metni varsayılan olarak deterministik şablondur (saygılı, alarm vermeyen; ünlem ve emoji yok); worker
-- notification-copy (Haiku) metnini yükte title/body ile verebilir.
--
-- Hata kodları: OGR-NOTIF-001 geçersiz tür, 002 geçersiz parametre/yük, 003 alıcı öğrenciyle bağlı değil (42501),
-- 004 geçersiz push aboneliği, 005 bildirim bulunamadı.

insert into public.settings (key, value, description) values
  ('notification_dedupe_hours', '24', 'Aynı alıcı + tür + tekilleştirme anahtarı bu süre içinde ikinci kez yazılmaz (saat)'),
  ('notification_list_max', '50', 'list_notifications sayfa üst sınırı')
on conflict (key) do nothing;

create index if not exists notifications_dedupe on public.notifications (recipient_id, kind, (payload ->> 'dedupe_key'), created_at desc);

-- --- kural varsayılanları ------------------------------------------------------------------------------------------------

-- weekday: 0 = Pazar … 6 = Cumartesi (extract(dow)); hour: alıcının saat dilimine göre (profiles.tz).
create or replace function app.notification_defaults() returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'exam_analysed', jsonb_build_object('enabled', true, 'params', jsonb_build_object('channels', jsonb_build_array('in_app', 'push'))),
    'weekly_summary', jsonb_build_object('enabled', true, 'params', jsonb_build_object('channels', jsonb_build_array('in_app', 'push'),
                                                                                      'weekday', 0, 'hour', 19)),
    'inactivity', jsonb_build_object('enabled', true, 'params', jsonb_build_object('channels', jsonb_build_array('in_app', 'push'), 'days', 5)),
    'improvement', jsonb_build_object('enabled', true, 'params', jsonb_build_object('channels', jsonb_build_array('in_app', 'push'),
                                                                                   'leaf_p', 0.8, 'min_evidence', 5, 'weekly_net_delta', 4)),
    'misconception_resolved', jsonb_build_object('enabled', true, 'params', jsonb_build_object('channels', jsonb_build_array('in_app', 'push'))),
    'instructor_note_shared', jsonb_build_object('enabled', true, 'params', jsonb_build_object('channels', jsonb_build_array('in_app', 'push'))),
    'report_ready', jsonb_build_object('enabled', true, 'params', jsonb_build_object('channels', jsonb_build_array('in_app', 'push'))),
    'guardian_linked', jsonb_build_object('enabled', true, 'params', jsonb_build_object('channels', jsonb_build_array('in_app', 'push')))
  )
$$;
comment on function app.notification_defaults() is 'Bildirim türü → varsayılan kural {enabled, params}; notification_rules satırı yoksa geçerli olan.';

-- Etkin kural: varsayılan (bilinmeyen tür: açık, yalnız uygulama içi) üzerine alıcının satırı.
create or replace function app.notification_rule(p_recipient uuid, p_kind text) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_def jsonb := coalesce(app.notification_defaults() -> p_kind,
                          jsonb_build_object('enabled', true, 'params', jsonb_build_object('channels', jsonb_build_array('in_app'))));
  v_row public.notification_rules%rowtype;
begin
  select nr.* into v_row from public.notification_rules nr where nr.recipient_id = p_recipient and nr.kind = p_kind;
  if not found then
    return v_def || jsonb_build_object('is_default', true);
  end if;
  return jsonb_build_object('enabled', v_row.enabled, 'params', coalesce(v_def -> 'params', '{}'::jsonb) || coalesce(v_row.params, '{}'::jsonb),
                            'is_default', false);
end
$$;
comment on function app.notification_rule(uuid, text) is 'Alıcının etkin bildirim kuralı: varsayılan || notification_rules satırı ({enabled, params, is_default}).';

-- Adın ilk sözcüğü ("Elif Yılmaz" → "Elif"); boşsa 'Öğrenciniz'.
create or replace function app.first_name(p_name text) returns text
language sql
immutable
as $$
  select coalesce(nullif(split_part(btrim(coalesce(p_name, '')), ' ', 1), ''), 'Öğrenciniz')
$$;
comment on function app.first_name(text) is 'Görünen adın ilk sözcüğü; boşsa ''Öğrenciniz''.';

-- Varsayılan bildirim metni {title, body}: saygılı, alarm vermeyen, somut; ünlem ve emoji yok. p_for_parent: üçüncü kişi.
create or replace function app.notification_copy(p_kind text, p_payload jsonb, p_for_parent boolean) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_name text;
  v_topic text := nullif(btrim(coalesce(p_payload ->> 'topic', p_payload ->> 'skill_name', '')), '');
  v_title text;
  v_body text;
begin
  select app.first_name(pr.display_name) into v_name
    from public.students s left join public.profiles pr on pr.id = s.profile_id
   where s.id::text = p_payload ->> 'student_id';
  v_name := coalesce(v_name, 'Öğrenciniz');
  if p_kind = 'exam_analysed' then
    if p_for_parent then
      v_title := 'Deneme sonucu hazır';
      v_body := format('%s bir denemeyi tamamladı%s. Sonuç ve kısa değerlendirme hazır.', v_name,
                       coalesce(': “' || nullif(p_payload ->> 'exam_title', '') || '”', ''));
    else
      v_title := 'Deneme sonucun hazır';
      v_body := format('%s sonucunu ve kısa değerlendirmesini görebilirsin.',
                       coalesce('“' || nullif(p_payload ->> 'exam_title', '') || '”', 'Denemenin'));
    end if;
  elsif p_kind = 'weekly_summary' then
    v_title := 'Haftalık özet hazır';
    v_body := format('%s için bu haftanın kısa özeti hazır.', v_name);
  elsif p_kind = 'inactivity' then
    v_title := 'Kısa bir hatırlatma';
    v_body := format('%s birkaç gündür çalışma kaydetmedi. Uygun bir anda nasıl gittiğini sorabilirsiniz.', v_name);
  elsif p_kind = 'improvement' then
    v_title := 'Güzel bir ilerleme';
    v_body := case when v_topic is not null then format('%s %s konusunda belirgin ilerleme kaydetti.', v_name, v_topic)
                   else format('%s bu hafta belirgin ilerleme kaydetti.', v_name) end;
  elsif p_kind = 'misconception_resolved' then
    v_title := 'Bir konu oturdu';
    v_body := case when v_topic is not null then format('%s daha önce zorlandığı %s konusunu artık doğru çözüyor.', v_name, v_topic)
                   else format('%s daha önce zorlandığı bir konuyu artık doğru çözüyor.', v_name) end;
  elsif p_kind = 'instructor_note_shared' then
    v_title := 'Eğitmenden not';
    v_body := case when nullif(p_payload ->> 'note', '') is not null
                   then format('%s için dersten bir not paylaşıldı: %s', v_name, left(p_payload ->> 'note', 160))
                   else format('%s için dersten bir not paylaşıldı.', v_name) end;
  elsif p_kind = 'report_ready' then
    v_title := 'Rapor hazır';
    v_body := format('%s için istediğiniz rapor hazır; açıp inceleyebilirsiniz.', v_name);
  elsif p_kind = 'guardian_linked' then
    v_title := 'Velin bağlandı';
    v_body := format('%s artık haftalık özetini ve deneme sonuçlarını görebilir; koç sohbetlerini göremez.',
                     coalesce(nullif(p_payload ->> 'parent_name', ''), 'Velin'));
  else
    v_title := 'Yeni bildirim';
    v_body := null;
  end if;
  return jsonb_build_object('title', v_title, 'body', v_body);
end
$$;
comment on function app.notification_copy(text, jsonb, boolean) is 'Bildirim türünün varsayılan metni {title, body} (deterministik; ünlemsiz, emojisiz; veliye üçüncü kişi).';

-- Alıcı öğrenciyle bağlı mı: öğrencinin kendisi, aktif velisi, bağlı eğitmeni ya da admin.
create or replace function app.notify_recipient_ok(p_recipient uuid, p_student uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  return exists (select 1 from public.students s where s.id = p_student and s.profile_id = p_recipient)
      or exists (select 1 from public.guardian_links gl
                  where gl.student_id = p_student and gl.parent_id = p_recipient and gl.status = 'active')
      or exists (select 1 from public.instructor_links il where il.student_id = p_student and il.instructor_id = p_recipient)
      or exists (select 1 from public.profiles pr where pr.id = p_recipient and pr.role = 'admin');
end
$$;
comment on function app.notify_recipient_ok(uuid, uuid) is 'Bildirim alıcısı öğrenciyle bağlı mı (kendisi, aktif veli, bağlı eğitmen, admin).';

-- --- tek yazım yolu ------------------------------------------------------------------------------------------------------

-- Tekilleştirme anahtarı: yükteki dedupe_key, yoksa türüne göre olay kimliği (oturum, belge, ders, yanılgı, kazanım, hafta),
-- o da yoksa öğrenci. Aynı (alıcı, tür, anahtar) notification_dedupe_hours (24) içinde ikinci kez yazılmaz.
create or replace function app.notify_emit(
  p_recipient uuid, p_kind text, p_payload jsonb, p_title text default null, p_body text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_rule jsonb;
  v_key text;
  v_channels text[];
  v_copy jsonb;
  v_title text;
  v_body text;
  v_role text;
  v_id uuid;
begin
  if p_recipient is null or p_kind is null or p_kind !~ '^[a-z][a-z0-9_]{2,40}$' then
    raise exception using errcode = 'P0001', message = format('OGR-NOTIF-001 geçersiz bildirim türü %s', coalesce(p_kind, '(boş)'));
  end if;
  if jsonb_typeof(v_payload) <> 'object' or octet_length(v_payload::text) > 16384 then
    raise exception using errcode = 'P0001', message = 'OGR-NOTIF-002 yük nesne olmalı (≤ 16 KB)';
  end if;
  select pr.role into v_role from public.profiles pr where pr.id = p_recipient;
  if not found then
    return null;
  end if;
  v_rule := app.notification_rule(p_recipient, p_kind);
  if not coalesce((v_rule ->> 'enabled')::boolean, true) then
    return null;
  end if;

  v_key := left(coalesce(nullif(v_payload ->> 'dedupe_key', ''),
                         case when v_payload ? 'session_id' then 'session:' || (v_payload ->> 'session_id') end,
                         case when v_payload ? 'document_id' then 'document:' || (v_payload ->> 'document_id') end,
                         case when v_payload ? 'lesson_id' then 'lesson:' || (v_payload ->> 'lesson_id') end,
                         case when v_payload ? 'misconception_id' then 'misconception:' || (v_payload ->> 'misconception_id') end,
                         case when v_payload ? 'skill_id' then concat_ws(':', 'skill', v_payload ->> 'student_id', v_payload ->> 'skill_id') end,
                         case when v_payload ? 'week_start' then concat_ws(':', 'week', v_payload ->> 'student_id', v_payload ->> 'week_start') end,
                         case when v_payload ? 'student_id' then 'student:' || (v_payload ->> 'student_id') end,
                         'kind'), 200);
  perform pg_advisory_xact_lock(hashtext('notify:' || p_recipient::text || ':' || p_kind || ':' || v_key));
  if exists (select 1 from public.notifications n
              where n.recipient_id = p_recipient and n.kind = p_kind and n.payload ->> 'dedupe_key' = v_key
                and n.created_at > now() - make_interval(hours => app.setting_num('notification_dedupe_hours', 24)::int)) then
    return null;
  end if;

  select array_agg(distinct c.ch order by c.ch) into v_channels
    from (select 'in_app' as ch
          union all
          select x.v from jsonb_array_elements_text(case when jsonb_typeof(v_rule #> '{params,channels}') = 'array'
                                                          then v_rule #> '{params,channels}' else '[]'::jsonb end) as x (v)
           where x.v in ('in_app', 'push', 'email')) as c;

  v_copy := app.notification_copy(p_kind, v_payload, v_role = 'parent');
  v_title := left(coalesce(nullif(btrim(p_title), ''), nullif(btrim(v_payload ->> 'title'), ''), v_copy ->> 'title'), 120);
  v_body := left(coalesce(nullif(btrim(p_body), ''), nullif(btrim(v_payload ->> 'body'), ''), v_copy ->> 'body'), 1000);

  insert into public.notifications (recipient_id, kind, title, body, payload, channels)
  values (p_recipient, p_kind, v_title, v_body, (v_payload - 'title' - 'body') || jsonb_build_object('dedupe_key', v_key), v_channels)
  returning id into v_id;
  if 'push' = any(v_channels) and exists (select 1 from public.push_subscriptions ps where ps.user_id = p_recipient) then
    perform app.try_enqueue('push.send', jsonb_build_object('notification_id', v_id));
  end if;
  return v_id;
end
$$;
comment on function app.notify_emit(uuid, text, jsonb, text, text) is 'Bildirim yazımının tek yolu (iç): kural kapalıysa ya da 24 saat içinde aynı anahtar varsa null; kanallar kuraldan; push varsa push.send işi.';

-- Worker girişi. Yük: {student_id?, title?, body?, dedupe_key?, url?, …}; student_id varsa alıcı öğrenciyle bağlı olmalı.
create or replace function public.emit_notification(p_recipient uuid, p_kind text, p_payload jsonb default '{}'::jsonb) returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 bildirimleri yalnız worker yazar';
  end if;
  if p_payload is not null and jsonb_typeof(p_payload) = 'object' and p_payload ? 'student_id' then
    if coalesce(p_payload ->> 'student_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P0001', message = 'OGR-NOTIF-002 student_id uuid olmalı';
    end if;
    if not app.notify_recipient_ok(p_recipient, (p_payload ->> 'student_id')::uuid) then
      raise exception using errcode = '42501', message = 'OGR-NOTIF-003 alıcı bu öğrenciyle bağlı değil';
    end if;
  end if;
  return app.notify_emit(p_recipient, p_kind, p_payload);
end
$$;
comment on function public.emit_notification(uuid, text, jsonb) is 'Worker: kurala göre bildirim yazar (kapalı kural → null; 24 saat tekilleştirme → null; alıcı öğrenciyle bağlı olmalı, OGR-NOTIF-003).';

-- Worker: türün kuralı açık olan veliler × aktif çocukları; zamanlamayı (hafta günü/saat, gün eşiği) worker uygular.
-- Döner: [{recipient_id, student_id, student_name, tz, params, last_activity_at, last_sent_at}]
create or replace function public.notification_targets(p_kind text) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_out jsonb;
begin
  if not app.is_trusted() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 yalnız worker';
  end if;
  if not (app.notification_defaults() ? coalesce(p_kind, '')) then
    raise exception using errcode = 'P0001', message = format('OGR-NOTIF-001 geçersiz bildirim türü %s', coalesce(p_kind, '(boş)'));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'recipient_id', z.parent_id, 'student_id', z.student_id, 'student_name', app.first_name(z.display_name), 'tz', z.tz,
           'params', z.rule -> 'params', 'last_activity_at', z.last_activity_at, 'last_sent_at', z.last_sent_at)
         order by z.parent_id, z.student_id), '[]'::jsonb)
    into v_out
    from (select gl.parent_id, gl.student_id, sp.display_name, coalesce(pp.tz, 'Europe/Istanbul') as tz,
                 app.notification_rule(gl.parent_id, p_kind) as rule,
                 app.child_last_activity(gl.student_id) as last_activity_at,
                 (select max(n.created_at) from public.notifications n
                   where n.recipient_id = gl.parent_id and n.kind = p_kind and n.payload ->> 'student_id' = gl.student_id::text) as last_sent_at
            from public.guardian_links gl
            join public.students s on s.id = gl.student_id and s.status = 'active'
            left join public.profiles sp on sp.id = s.profile_id
            left join public.profiles pp on pp.id = gl.parent_id
           where gl.status = 'active' and gl.parent_id is not null) z
   where coalesce((z.rule ->> 'enabled')::boolean, true);
  return v_out;
end
$$;
comment on function public.notification_targets(text) is 'Worker: türün kuralı açık veliler × aktif çocuklar (ad, saat dilimi, parametreler, son etkinlik, son gönderim).';

-- Öğrencinin son öğrenme etkinliği: gözlem, deneme oturumu, alıştırma, teşhis, koç mesajı (en yenisi).
create or replace function app.child_last_activity(p_student uuid) returns timestamptz
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_at timestamptz;
begin
  select max(x.at) into v_at
    from (select max(o.created_at) as at from public.observations o join public.enrollments e on e.id = o.enrollment_id
           where e.student_id = p_student
          union all
          select max(es.started_at) from public.exam_sessions es join public.enrollments e on e.id = es.enrollment_id
           where e.student_id = p_student
          union all
          select max(ps.started_at) from public.practice_sets ps join public.enrollments e on e.id = ps.enrollment_id
           where e.student_id = p_student
          union all
          select max(sa.created_at) from public.solution_analyses sa join public.enrollments e on e.id = sa.enrollment_id
           where e.student_id = p_student
          union all
          select max(c.last_message_at) from public.conversations c where c.student_id = p_student and c.kind = 'coach') x;
  return v_at;
end
$$;
comment on function app.child_last_activity(uuid) is 'Öğrencinin son öğrenme etkinliği zamanı (gözlem, deneme, alıştırma, teşhis, koç sohbeti).';

-- --- kullanıcı RPC'leri ---------------------------------------------------------------------------------------------------

-- Kural ayarı: p_enabled null → değişmez; p_params bilinen anahtarlarla birleşir (channels ⊆ in_app|push|email, in_app
-- zorunlu; weekly_summary: weekday 0–6, hour 0–23; inactivity: days 2–30). Döner: etkin kural.
create or replace function public.set_notification_rule(p_kind text, p_enabled boolean default null, p_params jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_params jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_ch text[];
begin
  if auth.uid() is null or not exists (select 1 from public.profiles pr where pr.id = auth.uid()) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 oturum gerekli';
  end if;
  if not (app.notification_defaults() ? coalesce(p_kind, '')) then
    raise exception using errcode = 'P0001', message = format('OGR-NOTIF-001 geçersiz bildirim türü %s', coalesce(p_kind, '(boş)'));
  end if;
  if p_params is not null then
    if jsonb_typeof(p_params) <> 'object' then
      raise exception using errcode = 'P0001', message = 'OGR-NOTIF-002 parametreler nesne olmalı';
    end if;
    for v_key, v_val in select x.key, x.value from jsonb_each(p_params) as x loop
      if v_key = 'channels' then
        if jsonb_typeof(v_val) <> 'array'
           or exists (select 1 from jsonb_array_elements(v_val) as c (v) where jsonb_typeof(c.v) <> 'string' or c.v #>> '{}' not in ('in_app', 'push', 'email')) then
          raise exception using errcode = 'P0001', message = 'OGR-NOTIF-002 channels in_app, push, email değerlerinden oluşan dizi olmalı';
        end if;
        select array_agg(distinct c.v order by c.v) into v_ch
          from (select 'in_app' as v union all select x.v from jsonb_array_elements_text(v_val) as x (v)) c;
        v_params := v_params || jsonb_build_object('channels', to_jsonb(v_ch));
      elsif v_key = 'weekday' and p_kind = 'weekly_summary' and jsonb_typeof(v_val) = 'number' and (v_val #>> '{}') ~ '^[0-6]$' then
        v_params := v_params || jsonb_build_object('weekday', (v_val #>> '{}')::int);
      elsif v_key = 'hour' and p_kind = 'weekly_summary' and jsonb_typeof(v_val) = 'number' and (v_val #>> '{}') ~ '^[0-9]{1,2}$'
            and (v_val #>> '{}')::int between 0 and 23 then
        v_params := v_params || jsonb_build_object('hour', (v_val #>> '{}')::int);
      elsif v_key = 'days' and p_kind = 'inactivity' and jsonb_typeof(v_val) = 'number' and (v_val #>> '{}') ~ '^[0-9]{1,2}$'
            and (v_val #>> '{}')::int between 2 and 30 then
        v_params := v_params || jsonb_build_object('days', (v_val #>> '{}')::int);
      else
        raise exception using errcode = 'P0001', message = format('OGR-NOTIF-002 %s türü için geçersiz parametre %s', p_kind, v_key);
      end if;
    end loop;
  end if;
  insert into public.notification_rules as nr (recipient_id, kind, enabled, params)
  values (auth.uid(), p_kind, coalesce(p_enabled, (app.notification_rule(auth.uid(), p_kind) ->> 'enabled')::boolean, true), v_params)
  on conflict (recipient_id, kind) do update
    set enabled = coalesce(p_enabled, nr.enabled), params = nr.params || excluded.params;
  return app.notification_rule(auth.uid(), p_kind) || jsonb_build_object('kind', p_kind);
end
$$;
comment on function public.set_notification_rule(text, boolean, jsonb) is 'Kullanıcı: kendi bildirim kuralını açar/kapar ve parametrelerini (kanallar, haftalık gün/saat, sessizlik günü) ayarlar.';

create or replace function public.list_notification_rules() returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 oturum gerekli';
  end if;
  return (select jsonb_agg(app.notification_rule(auth.uid(), k.kind) || jsonb_build_object('kind', k.kind) order by k.ord)
            from jsonb_object_keys(app.notification_defaults()) with ordinality as k (kind, ord));
end
$$;
comment on function public.list_notification_rules() is 'Kullanıcı: tüm bildirim türlerinin etkin kuralları [{kind, enabled, params, is_default}].';

-- Bildirim listesi: {unread, items[{id, kind, title, body, payload, channels, read_at, created_at}]}; p_before ile sayfalama.
create or replace function public.list_notifications(p_limit int default 20, p_before timestamptz default null, p_unread_only boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), app.setting_num('notification_list_max', 50)::int);
  v_items jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 oturum gerekli';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'kind', z.kind, 'title', z.title, 'body', z.body,
                                               'payload', z.payload - 'dedupe_key', 'channels', to_jsonb(z.channels),
                                               'read_at', z.read_at, 'created_at', z.created_at)
                            order by z.created_at desc, z.id), '[]'::jsonb)
    into v_items
    from (select n.* from public.notifications n
           where n.recipient_id = auth.uid() and (p_before is null or n.created_at < p_before)
             and (not coalesce(p_unread_only, false) or n.read_at is null)
           order by n.created_at desc, n.id limit v_limit) z;
  return jsonb_build_object(
    'unread', (select count(*) from public.notifications n where n.recipient_id = auth.uid() and n.read_at is null),
    'items', v_items);
end
$$;
comment on function public.list_notifications(int, timestamptz, boolean) is 'Kullanıcı: kendi bildirimleri (en yeni önce, sayfalı) ve okunmamış sayısı.';

-- Okundu: p_id null → tüm okunmamışlar. Döner: işaretlenen sayı. Başkasının bildirimi OGR-NOTIF-005.
create or replace function public.mark_notification_read(p_id uuid default null) returns int
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_n int;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 oturum gerekli';
  end if;
  if p_id is not null and not exists (select 1 from public.notifications n where n.id = p_id and n.recipient_id = auth.uid()) then
    raise exception using errcode = 'P0001', message = 'OGR-NOTIF-005 bildirim bulunamadı';
  end if;
  update public.notifications n set read_at = now()
   where n.recipient_id = auth.uid() and n.read_at is null and (p_id is null or n.id = p_id);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
comment on function public.mark_notification_read(uuid) is 'Kullanıcı: bildirimi (ya da tümünü) okundu işaretler; işaretlenen sayıyı döner.';

-- Web-push aboneliği (PWA): uç nokta https, anahtarlar base64url. Aynı uç nokta başka kullanıcıdaysa (paylaşılan cihazda
-- yeniden giriş) bu kullanıcıya taşınır. Döner: abonelik kimliği.
create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles pr where pr.id = auth.uid()) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 oturum gerekli';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://[^\s]{8,}$' or char_length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{40,200}={0,2}$' or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]{8,64}={0,2}$' then
    raise exception using errcode = 'P0001', message = 'OGR-NOTIF-004 geçersiz push aboneliği (https uç nokta, base64url anahtarlar)';
  end if;
  insert into public.push_subscriptions as ps (user_id, endpoint, p256dh, auth, ua)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua
  returning ps.id into v_id;
  return v_id;
end
$$;
comment on function public.register_push_subscription(text, text, text, text) is 'Kullanıcı: web-push aboneliği ekler ya da günceller (uç nokta başka kullanıcıdaysa taşınır).';

create or replace function public.unregister_push_subscription(p_endpoint text) returns boolean
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 oturum gerekli';
  end if;
  delete from public.push_subscriptions ps where ps.user_id = auth.uid() and ps.endpoint = p_endpoint;
  return found;
end
$$;
comment on function public.unregister_push_subscription(text) is 'Kullanıcı: kendi web-push aboneliğini siler.';

-- --- olay tetikleyicileri -------------------------------------------------------------------------------------------------

-- Deneme analiz edildi: oturum done (notlanmış) → öğrenciye ve aktif velilere 'exam_analysed'. Bildirim hatası notlama
-- hattını düşürmez (audit.events 'notify.failed').
create or replace function app.tg_notify_exam_analysed() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_student uuid;
  v_profile uuid;
  v_title text;
  v_base jsonb;
  v_parent uuid;
begin
  if new.score is null then
    return null;
  end if;
  begin
    select e.student_id, s.profile_id into v_student, v_profile
      from public.enrollments e join public.students s on s.id = e.student_id where e.id = new.enrollment_id;
    select x.title into v_title from public.exams x where x.id = new.exam_id;
    v_base := jsonb_strip_nulls(jsonb_build_object('student_id', v_student, 'session_id', new.id, 'exam_id', new.exam_id,
                                                   'exam_title', v_title, 'report_document_id', new.report_document_id,
                                                   'net', new.score -> 'net', 'dedupe_key', 'session:' || new.id::text));
    if v_profile is not null then
      perform app.notify_emit(v_profile, 'exam_analysed', v_base || jsonb_build_object('url', '/ogrenci/deneme/' || new.id::text));
    end if;
    for v_parent in
      select gl.parent_id from public.guardian_links gl
       where gl.student_id = v_student and gl.status = 'active' and gl.parent_id is not null
       order by gl.parent_id
    loop
      perform app.notify_emit(v_parent, 'exam_analysed', v_base || jsonb_build_object('url',
                              case when new.report_document_id is not null then '/veli/rapor/' || new.report_document_id::text else '/veli' end));
    end loop;
  exception when others then
    perform app.audit_event('notify.failed', 'public.exam_sessions', new.id::text,
                            jsonb_build_object('kind', 'exam_analysed', 'reason', sqlerrm));
  end;
  return null;
end
$$;
comment on function app.tg_notify_exam_analysed() is 'exam_sessions → done: öğrenciye ve aktif velilere exam_analysed bildirimi (hata hattı düşürmez).';

drop trigger if exists notify_exam_analysed on public.exam_sessions;
create trigger notify_exam_analysed after update of status on public.exam_sessions
for each row when (new.status = 'done' and old.status is distinct from 'done')
execute function app.tg_notify_exam_analysed();

-- Eğitmen notu: öğrenciye açık (student_visible) dersin son analizinde onaylı/düzeltilmiş next_step ya da homework iddiası
-- → aktif velilere 'instructor_note_shared' (ders başına 24 saatte bir). Not metni öğrenciye yönelik alandır
-- (next_step.for_student, homework.text); eğitmene özel alan (for_instructor), alıntı ve güven gitmez.
create or replace function app.notify_lesson_note(p_lesson uuid) returns int
language plpgsql
volatile
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_l public.lessons%rowtype;
  v_note text;
  v_kind text;
  v_student uuid;
  v_parent uuid;
  v_n int := 0;
begin
  select l.* into v_l from public.lessons l where l.id = p_lesson;
  if not found or not v_l.student_visible then
    return 0;
  end if;
  select z.kind, z.note into v_kind, v_note
    from (select lc.kind,
                 nullif(btrim(case lc.kind when 'next_step' then coalesce(lc.edited_value, lc.value) ->> 'for_student'
                                           else coalesce(lc.edited_value, lc.value) ->> 'text' end), '') as note,
                 lc.decided_at
            from public.lesson_claims lc
           where lc.analysis_id = (select la.id from public.lesson_analyses la where la.lesson_id = p_lesson order by la.version desc limit 1)
             and lc.kind in ('next_step', 'homework') and lc.status in ('approved', 'edited')) z
   order by (z.kind = 'next_step') desc, z.decided_at desc nulls last
   limit 1;
  if v_kind is null then
    return 0;
  end if;
  foreach v_student in array app.lesson_students(p_lesson) loop
    for v_parent in
      select gl.parent_id from public.guardian_links gl
       where gl.student_id = v_student and gl.status = 'active' and gl.parent_id is not null
       order by gl.parent_id
    loop
      if app.notify_emit(v_parent, 'instructor_note_shared',
                         jsonb_strip_nulls(jsonb_build_object('student_id', v_student, 'lesson_id', p_lesson, 'note_kind', v_kind,
                                                              'note', left(v_note, 400), 'lesson_title', v_l.title, 'url', '/veli',
                                                              'dedupe_key', 'lesson:' || p_lesson::text || ':' || v_student::text))) is not null then
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end
$$;
comment on function app.notify_lesson_note(uuid) is 'Öğrenciye açık dersin onaylı next_step/homework notunu aktif velilere instructor_note_shared olarak yazar; yazılan sayı.';

create or replace function app.tg_notify_lesson_claim() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_lesson uuid;
begin
  begin
    select la.lesson_id into v_lesson from public.lesson_analyses la where la.id = new.analysis_id;
    perform app.notify_lesson_note(v_lesson);
  exception when others then
    perform app.audit_event('notify.failed', 'public.lesson_claims', new.id::text,
                            jsonb_build_object('kind', 'instructor_note_shared', 'reason', sqlerrm));
  end;
  return null;
end
$$;
comment on function app.tg_notify_lesson_claim() is 'lesson_claims next_step/homework onaylanınca velilere instructor_note_shared (hata kararı düşürmez).';

drop trigger if exists notify_lesson_claim on public.lesson_claims;
create trigger notify_lesson_claim after update of status on public.lesson_claims
for each row when (new.kind in ('next_step', 'homework') and new.status in ('approved', 'edited')
                   and old.status is distinct from new.status)
execute function app.tg_notify_lesson_claim();

create or replace function app.tg_notify_lesson_visible() returns trigger
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
begin
  begin
    perform app.notify_lesson_note(new.id);
  exception when others then
    perform app.audit_event('notify.failed', 'public.lessons', new.id::text,
                            jsonb_build_object('kind', 'instructor_note_shared', 'reason', sqlerrm));
  end;
  return null;
end
$$;
comment on function app.tg_notify_lesson_visible() is 'Ders öğrenciye açılınca onaylı notunu velilere instructor_note_shared olarak yazar.';

drop trigger if exists notify_lesson_visible on public.lessons;
create trigger notify_lesson_visible after update of student_visible on public.lessons
for each row when (new.student_visible and not old.student_visible)
execute function app.tg_notify_lesson_visible();

-- --- yetkiler -------------------------------------------------------------------------------------------------------------

revoke all on function app.notification_defaults(), app.notification_rule(uuid, text), app.first_name(text),
  app.notification_copy(text, jsonb, boolean), app.notify_recipient_ok(uuid, uuid), app.notify_emit(uuid, text, jsonb, text, text),
  app.child_last_activity(uuid), app.notify_lesson_note(uuid), app.tg_notify_exam_analysed(), app.tg_notify_lesson_claim(),
  app.tg_notify_lesson_visible()
from public;
revoke all on function public.emit_notification(uuid, text, jsonb), public.notification_targets(text),
  public.set_notification_rule(text, boolean, jsonb), public.list_notification_rules(),
  public.list_notifications(int, timestamptz, boolean), public.mark_notification_read(uuid),
  public.register_push_subscription(text, text, text, text), public.unregister_push_subscription(text)
from public, anon;
grant execute on function public.emit_notification(uuid, text, jsonb), public.notification_targets(text) to service_role;
grant execute on function public.set_notification_rule(text, boolean, jsonb), public.list_notification_rules(),
  public.list_notifications(int, timestamptz, boolean), public.mark_notification_read(uuid),
  public.register_push_subscription(text, text, text, text), public.unregister_push_subscription(text)
to authenticated, service_role;

-- Kural ayarı ve push aboneliği yalnız doğrulayan RPC'lerden yazılır (set_notification_rule: bilinen tür ve parametreler;
-- register_push_subscription: https uç nokta). 0018'in sütun düzeyi INSERT/UPDATE hakkı bu denetimleri aşardı. DELETE kalır
-- (çıkışta cihaz aboneliğini silmek ve kuralı varsayılana döndürmek için; satır yalnız sahibinin).
revoke insert, update on public.notification_rules from authenticated;
revoke insert on public.push_subscriptions from authenticated;

-- --- zamanlama ------------------------------------------------------------------------------------------------------------

-- Saatlik kural değerlendirmesi (apps/worker/src/schedules.ts 'notifications.evaluate' '5 * * * *'; dakika alanı saat
-- diliminden bağımsızdır). pg_cron sahibi ise (0016) worker kendi zamanlamasını kurmaz; bu iş burada olmazsa sessizlik,
-- velinin seçtiği gün/saatteki haftalık özet, ilerleme ve e-posta süpürmesi hiç çalışmazdı.
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('ogrenmen-notifications-evaluate', '5 * * * *',
                          $c$select public.enqueue_job('notifications.evaluate', '{}'::jsonb)$c$);  -- her saat :05
  end if;
end
$$;
