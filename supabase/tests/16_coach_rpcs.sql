-- tests/16_coach_rpcs.sql — koç sohbetinin üretim yolu (0028): web sunucusu kullanıcının JWT'siyle (authenticated) yalnız
-- coach_* RPC'lerini çağırır. Öğrenci kendi sohbetini açar, okur, modunu değiştirir ve 'user' mesajı ekler; assistant/system
-- turları, araç blokları, defter (llm_calls), hafıza yazımı ve eğitmen yönlendirmesi yalnız sunucu jetonuyla (HMAC,
-- secure.server_keys 'web_coach'; OGR-COACH-001). Başka öğrenci, veli, eğitmen ve anon 42501 alır. Tur kirası
-- (secure.coach_turns), bağlam (dossier + ders bloğu + hafıza içerikleri) ve araç RPC'leri.
begin;
\ir _fixture.sql

-- Sunucu jetonu (testte yönetici bağlamında üretilir; anahtar authenticated'a kapalı)
create function t.coach_token(p_conv uuid, p_ttl int default 600) returns text language plpgsql security definer as $$
declare
  v_exp text := (floor(extract(epoch from now())) + p_ttl)::bigint::text;
begin
  return 'v1.' || v_exp || '.' || encode(hmac(convert_to('coach:' || p_conv::text || ':' || v_exp, 'UTF8'),
                                              convert_to((select k.secret from secure.server_keys k where k.name = 'web_coach'), 'UTF8'), 'sha256'), 'hex');
end $$;
revoke all on function t.coach_token(uuid, int) from public;

do $$
begin
  perform t.ok((select char_length(k.secret) = 64 from secure.server_keys k where k.name = 'web_coach'), 'göç web_coach anahtarını üretir (32 bayt hex)');
  perform t.ok(not has_table_privilege('authenticated', 'secure.server_keys', 'select')
               and not has_table_privilege('authenticated', 'secure.coach_turns', 'select'), 'anahtar ve kira tabloları authenticated''a kapalı');
  perform t.ok(has_function_privilege('authenticated', 'public.coach_append_message(uuid, text, jsonb, uuid[], bigint, jsonb, text)', 'execute')
               and not has_function_privilege('anon', 'public.coach_append_message(uuid, text, jsonb, uuid[], bigint, jsonb, text)', 'execute')
               and not has_function_privilege('anon', 'public.coach_history(uuid, int, bigint)', 'execute'),
               'koç RPC''leri authenticated çağırır, anon çağıramaz');
  perform t.ok(not has_function_privilege('authenticated', 'app.memory_apply(uuid, text, text, text, text, text, text, boolean)', 'execute')
               and not has_function_privilege('authenticated', 'app.coach_insert_message(public.conversations, text, jsonb, uuid[], bigint, jsonb)', 'execute'),
               'iç yazım yolları (app.memory_apply, app.coach_insert_message) doğrudan çağrılamaz');
end $$;

-- Öğrenci: kimlik, sohbet açma, geçmiş, mod
do $$
declare
  v_me jsonb;
  v_conv uuid;
  v_h jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_me := public.coach_student();
  perform t.ok(v_me ->> 'student_id' = t.v('A') and v_me ->> 'enrollment_id' = t.v('EA') and v_me ->> 'course_id' = t.v('course')
               and v_me ->> 'public_ref' like 's\_%', 'coach_student: öğrenci, etkin kayıt, ders, public_ref');
  v_h := public.coach_history(null);
  perform t.ok(v_h -> 'conversation' = 'null'::jsonb and (v_h ->> 'total')::int = 0, 'sohbet yokken en son sohbet null');
  v_conv := public.coach_open_conversation(null, 'hint');
  perform t.ok((select c.course_id = t.u('course') and c.kind = 'coach' and c.mode = 'hint' and c.participant_id = t.u('elif')
                  from public.conversations c where c.id = v_conv), 'coach_open_conversation: kendi koç sohbeti, ders etkin kayıttan');
  perform t.raises(format($q$select public.coach_open_conversation(%L, 'hint')$q$, gen_random_uuid()), 'OGR-COACH-004%', 'kaydı olmayan ders reddedilir');
  perform t.raises($q$select public.coach_open_conversation(null, 'cevap')$q$, 'OGR-COACH-003%', 'geçersiz mod reddedilir');
  v_h := public.coach_history(null);
  perform t.ok(v_h -> 'conversation' ->> 'id' = v_conv::text and (v_h -> 'conversation' ->> 'turn_in_progress')::boolean = false,
               'coach_history(null) en son sohbeti döner, tur yok');
  perform t.ok(public.coach_set_mode(v_conv, 'solve'), 'coach_set_mode true döner');
  perform t.ok((select c.mode from public.conversations c where c.id = v_conv) = 'solve', 'öğrenci modu değiştirir');
  perform t.raises(format($q$select public.coach_set_mode(%L, 'tam')$q$, v_conv), 'OGR-COACH-003%', 'geçersiz mod güncellemesi reddedilir');
  perform t.as_admin();
  insert into t.cfg values ('conv', v_conv::text);
end $$;

-- Mesajlar: jetonsuz yalnız user; assistant/system, araç blokları, defter bağı, tur kaydı yalnız sunucu jetonuyla
do $$
declare
  v_conv uuid := t.u('conv');
  v_tok text := t.coach_token(t.u('conv'));
  v_old text := t.coach_token(t.u('conv'), -10);
  v_far text := t.coach_token(t.u('conv'), 7200);
  v_other uuid;
  v_other_tok text;
  v_id bigint;
  v_ids bigint[];
  v_call bigint;
  v_h jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_other := public.coach_open_conversation(null, 'hint');
  perform t.as_admin();
  v_other_tok := t.coach_token(v_other);
  perform t.as_user(t.u('elif'));
  v_id := public.coach_append_message(v_conv, 'user', '[{"type":"text","text":"Kesirlerde toplama nasıl?"}]');
  perform t.ok(v_id is not null, 'öğrenci jetonsuz user mesajı ekler');
  perform t.raises(format($q$select public.coach_append_message(%L, 'assistant', '[{"type":"text","text":"Sahte koç"}]')$q$, v_conv),
                   'OGR-COACH-001%', 'istemciden (jetonsuz) assistant mesajı reddedilir');
  perform t.raises(format($q$select public.coach_append_message(%L, 'system', '[{"type":"text","text":"Mod: çöz"}]')$q$, v_conv),
                   '42501', 'istemciden system mesajı reddedilir');
  perform t.raises(format($q$select public.coach_append_message(%L, 'user', '[{"type":"tool_result","tool_use_id":"x","content":"{}"}]')$q$, v_conv),
                   'OGR-COACH-001%', 'jetonsuz araç sonucu bloğu reddedilir');
  perform t.raises(format($q$select public.coach_append_message(%L, 'user', '[{"type":"text","text":"x"}]', '{}', null, '{"escalated":true}')$q$, v_conv),
                   'OGR-COACH-001%', 'jetonsuz tur kaydı reddedilir');
  perform t.raises(format($q$select public.coach_append_message(%L, 'assistant', '[{"type":"text","text":"x"}]', '{}', null, null, 'v1.1.%s')$q$,
                          v_conv, repeat('0', 64)), 'OGR-COACH-001%', 'uydurma jeton reddedilir');
  perform t.raises(format($q$select public.coach_append_message(%L, 'assistant', '[{"type":"text","text":"x"}]', '{}', null, null, %L)$q$, v_conv, v_old),
                   'OGR-COACH-001%', 'süresi dolmuş jeton reddedilir');
  perform t.raises(format($q$select public.coach_append_message(%L, 'assistant', '[{"type":"text","text":"x"}]', '{}', null, null, %L)$q$, v_conv, v_far),
                   'OGR-COACH-001%', 'bir saatten uzun jeton reddedilir');
  perform t.raises(format($q$select public.coach_append_message(%L, 'assistant', '[{"type":"text","text":"x"}]', '{}', null, null, %L)$q$, v_conv, v_other_tok),
                   'OGR-COACH-001%', 'başka sohbetin jetonu bu sohbete yazamaz');
  perform t.raises(format($q$insert into public.conversation_messages (conversation_id, role, content) values (%L, 'assistant', '[]')$q$, v_conv),
                   '42501', 'tablodan doğrudan assistant ekleme RLS ile kapalı');
  perform t.raises(format($q$select public.coach_append_message(%L, 'user', '{"type":"text"}')$q$, v_conv), 'OGR-COACH-002%', 'içerik dizi olmalı');
  perform t.raises(format($q$select public.coach_append_message(%L, 'user', '[{"type":"text","text":"x"}]', array[%L]::uuid[])$q$, v_conv, gen_random_uuid()),
                   'OGR-COACH-006%', 'öğrenciye ait olmayan yükleme eklenemez');

  v_call := public.coach_log_llm_call(v_conv, jsonb_build_object('route', 'coach_chat', 'model', 'claude-sonnet-5-5', 'effort', 'medium',
                                                                  'status', 'ok', 'tokens_in', 1200, 'tokens_out', 80, 'cost_usd', 0.004,
                                                                  'student_ref', 's_baskasi', 'ref_table', 'exams', 'ref_id', 'x'), v_tok);
  perform t.raises(format($q$select public.coach_log_llm_call(%L, '{"route":"coach_chat","model":"m","status":"ok"}')$q$, v_conv), '42501',
                   'jetonsuz defter yazımı reddedilir');
  perform t.raises(format($q$select public.coach_log_llm_call(%L, '{"route":"solution_diagnosis","model":"m","status":"ok"}', %L)$q$, v_conv, v_tok),
                   'OGR-COACH-005%', 'koç dışı rota defterlenemez');
  perform t.raises(format($q$select public.coach_log_llm_call(%L, '{"route":"coach_chat","model":"m","status":"ok","cost_usd":99}', %L)$q$, v_conv, v_tok),
                   'OGR-LLM-001%', 'maliyet tavanı');
  v_ids := public.coach_append_turn(v_conv, jsonb_build_array(
    jsonb_build_object('role', 'system', 'content', '[{"type":"text","text":"Bugün 2026-11-03. Mod: çöz."}]'::jsonb),
    jsonb_build_object('role', 'assistant', 'content', '[{"type":"text","text":"Paydaları eşitle."}]'::jsonb, 'llm_call_id', v_call,
                       'tool_calls', '{"calls":[],"escalated":false}'::jsonb)), v_tok);
  perform t.ok(cardinality(v_ids) = 2, 'coach_append_turn sunucu jetonuyla system + assistant yazar');
  perform t.raises(format($q$select public.coach_append_turn(%L, '[{"role":"assistant","content":[{"type":"text","text":"x"}]}]', null)$q$, v_conv),
                   'OGR-COACH-001%', 'coach_append_turn jetonsuz reddedilir');
  perform t.raises(format($q$select public.coach_append_message(%L, 'assistant', '[{"type":"text","text":"x"}]', '{}', %s, null, %L)$q$,
                          v_other, v_call, v_other_tok), 'OGR-COACH-005%', 'başka sohbetin defter satırı bağlanamaz');
  perform t.ok(public.coach_append_message(v_conv, 'assistant', '[{"type":"text","text":"Bir örnek daha?"}]', '{}', null, null, v_tok) is not null,
               'sunucu jetonuyla tek assistant mesajı');
  v_h := public.coach_history(v_conv, 2);
  perform t.ok((v_h ->> 'total')::int = 4 and jsonb_array_length(v_h -> 'messages') = 2
               and v_h -> 'messages' -> 0 ->> 'role' = 'assistant' and (v_h -> 'messages' -> 0 ->> 'id')::bigint = v_ids[2]
               and v_h -> 'messages' -> 1 -> 'content' -> 0 ->> 'text' = 'Bir örnek daha?',
               'coach_history: toplam ve en yeni N mesaj eskiden yeniye');
  perform t.ok((public.coach_history(v_conv, 80, v_id) ->> 'total')::int = 3, 'p_after_id sonrası sayım (özet çapası)');
  perform t.as_admin();
  perform t.ok((select lc.student_ref = (select s.public_ref from public.students s where s.id = t.u('A'))
                       and lc.ref_table = 'conversations' and lc.ref_id = v_conv::text
                  from public.llm_calls lc where lc.id = v_call), 'defter: student_ref ve ref sohbetten türetilir (gönderilen yok sayılır)');
  perform t.ok((select m.llm_call_id = v_call from public.conversation_messages m where m.id = v_ids[2]), 'son mesaja llm_call_id bağlanır');
  perform t.ok((select c.last_message_at is not null from public.conversations c where c.id = v_conv), 'last_message_at güncellenir');
end $$;

-- Kapsam: başka öğrenci, veli, eğitmen, anon
do $$
declare
  v_conv uuid := t.u('conv');
begin
  perform t.as_user(t.u('can'));
  perform t.raises(format($q$select public.coach_history(%L)$q$, v_conv), '42501', 'başka öğrenci sohbeti okuyamaz');
  perform t.raises(format($q$select public.coach_append_message(%L, 'user', '[{"type":"text","text":"x"}]')$q$, v_conv), '42501',
                   'başka öğrenci mesaj ekleyemez');
  perform t.raises(format($q$select public.coach_set_mode(%L, 'hint')$q$, v_conv), '42501', 'başka öğrenci modu değiştiremez');
  perform t.raises(format($q$select public.coach_context(%L)$q$, v_conv), '42501', 'başka öğrenci bağlamı okuyamaz');
  perform t.raises(format($q$select public.coach_claim_turn(%L)$q$, v_conv), '42501', 'başka öğrenci tur kirası alamaz');
  perform t.ok(public.coach_history(null) -> 'conversation' = 'null'::jsonb, 'başka öğrencinin en son sohbeti kendi (yok)');
  perform t.ok(public.coach_seed(gen_random_uuid()) is null, 'olmayan teşhis bağlamı null');
  perform t.as_user(t.u('parent'));
  perform t.raises(format($q$select public.coach_history(%L)$q$, v_conv), '42501', 'veli koç sohbetini okuyamaz');
  perform t.raises($q$select public.coach_history(null)$q$, '42501', 'veli koç geçmişi açamaz');
  perform t.raises($q$select public.coach_student()$q$, '42501', 'veli koç öğrencisi değildir');
  perform t.raises($q$select public.coach_open_conversation(null, 'hint')$q$, '42501', 'veli koç sohbeti açamaz');
  perform t.raises($q$select public.coach_tool_get_mastery()$q$, '42501', 'veli koç aracını çağıramaz');
  perform t.raises(format($q$select public.coach_set_mode(%L, 'hint')$q$, v_conv), '42501', 'veli modu değiştiremez');
  perform t.as_user(t.u('inst'));
  perform t.raises(format($q$select public.coach_history(%L)$q$, v_conv), '42501', 'eğitmen koç RPC''siyle sohbete giremez (katılımcı değil)');
  perform t.as_anon();
  perform t.raises($q$select public.coach_student()$q$, '42501', 'anon koç RPC''si çağıramaz');
  perform t.as_admin();
  perform t.ok((select c.mode from public.conversations c where c.id = v_conv) = 'solve', 'reddedilen mod güncellemeleri sohbeti değiştirmez');
end $$;

-- Tur kirası
do $$
declare
  v_conv uuid := t.u('conv');
  v_a uuid;
  v_b uuid;
begin
  perform t.as_user(t.u('elif'));
  v_a := public.coach_claim_turn(v_conv);
  perform t.ok(v_a is not null, 'kira alınır');
  perform t.ok(public.coach_claim_turn(v_conv) is null, 'tur sürerken ikinci kira null');
  perform t.ok((public.coach_history(v_conv, 0) -> 'conversation' ->> 'turn_in_progress')::boolean, 'tur sürüyor görünür');
  perform t.ok(not public.coach_release_turn(v_conv, gen_random_uuid()), 'yanlış jetonla bırakılmaz');
  perform t.ok(public.coach_release_turn(v_conv, v_a), 'doğru jetonla bırakılır');
  perform t.ok(not (public.coach_history(v_conv, 0) -> 'conversation' ->> 'turn_in_progress')::boolean, 'bırakınca tur yok');
  v_b := public.coach_claim_turn(v_conv, 60);
  perform t.as_admin();
  update secure.coach_turns ct set expires_at = now() - interval '1 second' where ct.conversation_id = v_conv;
  perform t.as_user(t.u('elif'));
  v_a := public.coach_claim_turn(v_conv);
  perform t.ok(v_a is not null and v_a <> v_b, 'süresi dolan kira (ölmüş süreç) yeniden alınır');
  perform t.ok(not public.coach_release_turn(v_conv, v_b), 'eski kira sahibi yenisini bırakamaz');
  perform public.coach_release_turn(v_conv, v_a);
  perform t.as_admin();
end $$;

-- Bağlam ve hafıza: dossier (render_dossier), ders bloğu verisi, hafıza içerikleri; koç yazımı yalnız jetonla
do $$
declare
  v_conv uuid := t.u('conv');
  v_tok text := t.coach_token(t.u('conv'));
  v_ctx jsonb;
  v_w jsonb;
begin
  perform t.as_user(t.u('elif'));
  v_ctx := public.coach_context(v_conv);
  perform t.ok(v_ctx -> 'dossier' -> 'body' ->> 'hash' is not null and (v_ctx -> 'dossier' -> 'body' ->> 'version')::int = 2,
               'bağlam: dossier gövdesi render_dossier v2');
  perform t.ok(v_ctx -> 'course' -> 'course' ->> 'code' = 'T-MAT-TEST' and jsonb_array_length(v_ctx -> 'course' -> 'skills') = 3
               and v_ctx -> 'course' -> 'curriculum' ->> 'version' = 'test.1' and jsonb_array_length(v_ctx -> 'course' -> 'prerequisites') = 1
               and v_ctx -> 'course' -> 'misconceptionTags' -> 0 ->> 'tag' = 't.a.isaret-hatasi'
               and (v_ctx -> 'course' -> 'course' ->> 'createdByStudent')::boolean = false,
               'bağlam: ders bloğu verisi (ders, müfredat, kazanımlar, ön koşul, yanılgı etiketi)');
  perform t.ok(jsonb_array_length(v_ctx -> 'memory') = 0 and v_ctx ->> 'student_ref' like 's\_%', 'bağlam: hafıza boş, student_ref');
  perform t.ok(public.coach_context(v_conv, array['memory']) ? 'dossier' = false, 'p_parts yalnız istenen parçaları döner');

  perform t.raises(format($q$select public.coach_memory_write(%L, '/memories/coach_notes.md', 'x', 'create')$q$, v_conv), 'OGR-COACH-001%',
                   'jetonsuz hafıza yazımı reddedilir');
  v_w := public.coach_memory_write(v_conv, '/memories/coach_notes.md', 'Kısa adımlar işe yarıyor.', 'create', null, null, v_tok);
  perform t.ok(v_w ->> 'version' = '1', 'koç sunucu jetonuyla hafıza dosyası yazar');
  perform public.coach_memory_write(v_conv, '/memories/coach_notes.md', 'Kısa adımlar ve örnek işe yarıyor.', 'str_replace', null,
                                    md5('Kısa adımlar işe yarıyor.'), v_tok);
  perform t.raises(format($q$select public.coach_memory_write(%L, '/memories/coach_notes.md', 'y', 'str_replace', null, %L, %L)$q$,
                          v_conv, md5('eski içerik'), v_tok), 'OGR-MEM-028%', 'koşullu yazım: içerik değiştiyse çakışma');
  perform t.raises(format($q$select public.coach_memory_write(%L, '/memories/parent_summary.md', 'x', 'create', null, null, %L)$q$, v_conv, v_tok),
                   'OGR-MEM-007%', 'koç parent_summary.md yazamaz');
  perform t.raises(format($q$select public.coach_memory_write(%L, '/etc/passwd.md', 'x', 'create', null, null, %L)$q$, v_conv, v_tok),
                   'OGR-MEM-003%', 'yol izin listesi');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/x.md', 'x', 'create', 'coach')$q$, t.u('A')), 'OGR-AUTH-001%',
                   'öğrenci upsert_memory_file ile hâlâ yazamaz (0023)');
  v_ctx := public.coach_context(v_conv, array['memory']);
  perform t.ok(v_ctx -> 'memory' -> 0 ->> 'path' = '/memories/coach_notes.md'
               and v_ctx -> 'memory' -> 0 ->> 'content' = 'Kısa adımlar ve örnek işe yarıyor.', 'bağlam hafıza dosyasının içeriğini döner');
  perform t.as_admin();
  perform t.ok((select string_agg(v.actor, ',' order by v.version) from public.memory_file_versions v
                 where v.student_id = t.u('A') and v.path = '/memories/coach_notes.md') = 'coach:' || v_conv || ',coach:' || v_conv,
               'sürüm satırlarında actor coach:<sohbet>');
  perform t.as_user(t.u('inst'));
  perform t.ok((public.upsert_memory_file(t.u('A'), '/memories/inst.md', 'not', 'create', 'x') ->> 'version') = '1',
               'owner eğitmen upsert_memory_file ile yazmayı sürdürür (gövde app.memory_apply''a taşındı)');
  perform t.as_admin();
  perform t.ok((select v.actor from public.memory_file_versions v where v.path = '/memories/inst.md') = 'instructor:' || t.v('inst'),
               'kullanıcı oturumunda actor rol:uid');
end $$;

-- Eğitmen yönlendirmesi ve araçlar
do $$
declare
  v_conv uuid := t.u('conv');
  v_tok text := t.coach_token(t.u('conv'));
  v_r jsonb;
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.coach_escalate(%L, 'turn_meta', null, 'x')$q$, v_conv), 'OGR-COACH-001%', 'jetonsuz yönlendirme reddedilir');
  perform t.raises(format($q$select public.coach_escalate(%L, 'neden', null, 'x', %L)$q$, v_conv, v_tok), 'OGR-COACH-007%', 'geçersiz neden');
  perform t.ok(public.coach_escalate(v_conv, 'refusal', 'cyber', 'Koç bu konuyu (güvenlik) sana iletti.', v_tok), 'yönlendirme yazılır');
  perform t.ok(public.coach_escalate(v_conv, 'turn_meta', null, 'İkinci', v_tok), 'aynı sohbetten ikinci yönlendirme sessizce birleşir');
  perform t.as_admin();
  perform t.ok((select count(*) from public.notifications n where n.kind = 'coach_escalation' and n.payload ->> 'conversation_id' = v_conv::text) = 1
               and (select n.recipient_id = t.u('inst') and n.payload ->> 'category' = 'cyber' and n.payload ->> 'enrollment_id' = t.v('EA')
                      from public.notifications n where n.kind = 'coach_escalation' and n.payload ->> 'conversation_id' = v_conv::text),
               'bildirim bağlı eğitmene, 24 saatte bir, ham kategori payload''da');

  perform t.as_user(t.u('elif'));
  v_r := public.coach_tool_get_mastery();
  perform t.ok((v_r ->> 'enrollment')::boolean and jsonb_typeof(v_r -> 'skills') = 'array', 'get_mastery: kaydın ustalık satırları');
  v_r := public.coach_tool_search_evidence('kesirlerde toplama ab');
  perform t.ok(v_r -> 'words' = '["kesirlerde", "toplama"]'::jsonb and v_r -> 'results' -> 0 ->> 'kind' = 'conversation'
               and (v_r -> 'results' -> 0 ->> 'score')::int = 2, 'search_evidence: kelimeler (≥ 3), koç sohbeti eşleşmesi');
  perform t.ok(jsonb_array_length(public.coach_tool_search_evidence('x y') -> 'results') = 0, 'anlamlı kelime yoksa boş');
  perform t.ok(jsonb_typeof(public.coach_tool_get_recent_exams() -> 'exams') = 'array', 'get_recent_exams diziyi döner');
  perform t.ok(jsonb_typeof(public.coach_prompt_sources() -> 'pinned') = 'object', 'prompt sürüm kaynakları');
  perform t.ok(jsonb_array_length(public.coach_uploads(array[gen_random_uuid()])) = 0, 'olmayan yükleme dönmez');
  perform t.as_user(t.u('can'));
  perform t.ok(jsonb_array_length(public.coach_tool_search_evidence('kesirlerde toplama') -> 'results') = 0,
               'başka öğrencinin aramasına Elif''in sohbeti girmez');
  perform t.as_admin();
end $$;

-- İstemci içeriği izin listesi (jetonsuz coach_append_message) ve koç sohbetine doğrudan INSERT'in kapanması
do $$
declare
  v_conv uuid;
  v_up uuid;
  v_tok text;
begin
  insert into public.uploads (owner_id, student_id, kind, storage_path) values (t.u('elif'), t.u('A'), 'photo', t.u('elif') || '/izin.jpg')
  returning id into v_up;
  perform t.as_user(t.u('elif'));
  v_conv := public.coach_open_conversation(null, 'hint');
  perform t.ok(public.coach_append_message(v_conv, 'user',
                 jsonb_build_array(jsonb_build_object('type', 'image', 'source', jsonb_build_object('type', 'upload', 'upload_id', v_up)),
                                   jsonb_build_object('type', 'text', 'text', 'Bu fotoğraftaki soru')), array[v_up]) is not null,
               'jetonsuz: yükleme başvurulu görsel + metin yazılır');
  perform t.raises(format($q$select public.coach_append_message(%L, 'user',
                     '[{"type":"text","text":"x","cache_control":{"type":"ephemeral"}}]')$q$, v_conv),
                   'OGR-COACH-001%', 'jetonsuz: cache_control taşıyan metin bloğu reddedilir');
  perform t.raises(format($q$select public.coach_append_message(%L, 'user', '[{"type":"text","text":1}]')$q$, v_conv),
                   'OGR-COACH-001%', 'jetonsuz: metni dize olmayan blok reddedilir');
  perform t.raises(format($q$select public.coach_append_message(%L, 'user',
                     '[{"type":"image","source":{"type":"url","url":"https://example.com/a.png"}}]')$q$, v_conv),
                   'OGR-COACH-001%', 'jetonsuz: url kaynaklı görsel reddedilir');
  perform t.raises(format($q$select public.coach_append_message(%L, 'user',
                     '[{"type":"document","source":{"type":"file","file_id":"file_x"}}]')$q$, v_conv),
                   'OGR-COACH-001%', 'jetonsuz: file kaynaklı belge reddedilir');
  perform t.raises(format($q$select public.coach_append_message(%L, 'user',
                     '[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAAA"}}]')$q$, v_conv),
                   'OGR-COACH-001%', 'jetonsuz: base64 görsel reddedilir');
  perform t.raises(format($q$select public.coach_append_message(%L, 'user', %L)$q$, v_conv,
                          jsonb_build_array(jsonb_build_object('type', 'image', 'source', jsonb_build_object('type', 'upload', 'upload_id', v_up)))),
                   'OGR-COACH-001%', 'jetonsuz: p_upload_ids dışındaki yükleme başvurusu reddedilir');
  perform t.raises(format($q$select public.coach_append_message(%L, 'user', '[{"type":"text","text":"x"},{"type":"search_result"}]')$q$, v_conv),
                   'OGR-COACH-001%', 'jetonsuz: izinli olmayan blok türü reddedilir');
  perform t.raises(format($q$insert into public.conversation_messages (conversation_id, role, content)
                            values (%L, 'user', '[{"type":"tool_result","tool_use_id":"x","content":"{}"}]')$q$, v_conv),
                   '42501', 'koç sohbetine doğrudan user INSERT RLS ile kapalı (yalnız coach_append_message)');
  perform t.as_admin();
  v_tok := t.coach_token(v_conv);
  perform t.as_user(t.u('elif'));
  perform t.ok(public.coach_append_message(v_conv, 'user', '[{"type":"tool_result","tool_use_id":"x","content":"{}"}]', '{}', null, null, v_tok)
               is not null, 'sunucu jetonuyla araç sonucu turu yazılır');
  perform t.as_admin();
  perform t.ok((select count(*) from public.conversation_messages m where m.conversation_id = v_conv) = 2,
               'reddedilen istemci mesajları yazılmaz');
end $$;

-- Ders kapsamı: conversations.course_id'ye güvenilmez (özel ders sızıntısı kapalı)
do $$
declare
  v_cur uuid;
  v_priv uuid := gen_random_uuid();
  v_conv uuid := gen_random_uuid();
  v_ctx jsonb;
begin
  insert into public.curricula (code, version, label, status, origin, created_by)
  values ('T-OZEL', '1', 'Özel müfredat', 'active', 'instructor', t.u('can')) returning id into v_cur;
  insert into public.skills (curriculum_id, id, parent_id, name, kind, is_leaf, order_no) values (v_cur, 'oz.a', null, 'Gizli kazanım', 'outcome', true, 1);
  insert into public.courses (id, code, title, kind, curriculum_id, visibility, created_by)
  values (v_priv, 'T-OZEL', 'Can özel ders', 'university', v_cur, 'private', t.u('can'));
  perform t.as_user(t.u('elif'));
  perform t.ok(not app.can_read_course(v_priv) and t.n(format('select 1 from public.courses where id = %L', v_priv)) = 0,
               'Elif özel dersi RLS ile göremez');
  perform t.raises(format($q$insert into public.conversations (student_id, kind, participant_id, course_id) values (%L, 'coach', auth.uid(), %L)$q$,
                          t.u('A'), v_priv), '42501', 'kaydı olmayan dersle doğrudan koç sohbeti açılamaz (RLS)');
  insert into public.conversations (student_id, kind, participant_id, course_id) values (t.u('A'), 'coach', auth.uid(), t.u('course'));
  perform t.ok(true, 'kendi kaydının dersiyle doğrudan koç sohbeti açılır');
  perform t.as_admin();
  -- Politika öncesinden kalmış (ya da başka yoldan yazılmış) bir satır: course_id kaydı olmayan özel ders
  insert into public.conversations (id, student_id, kind, participant_id, course_id) values (v_conv, t.u('A'), 'coach', t.u('elif'), v_priv);
  perform t.as_user(t.u('elif'));
  v_ctx := public.coach_context(v_conv, array['course', 'dossier']);
  perform t.ok(v_ctx ->> 'course_id' = t.v('course') and v_ctx -> 'course' -> 'course' ->> 'code' = 'T-MAT-TEST'
               and v_ctx::text not like '%T-OZEL%' and v_ctx::text not like '%Gizli kazanım%',
               'coach_context: kaydı olmayan course_id yok sayılır, etkin kaydın dersi kullanılır (özel ders sızmaz)');
  perform t.as_admin();
end $$;

rollback;
