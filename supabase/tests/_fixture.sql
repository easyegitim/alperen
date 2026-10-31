-- tests/_fixture.sql — canlı SQL testlerinin ortak dünyası ve yardımcıları. Her test dosyası "begin;" sonrasında
-- \ir ile içe alır ve sonunda "rollback;" eder (veritabanı testten teste temiz kalır).
-- Yardımcılar t şemasındadır: t.as_admin/as_bot/as_batch/as_staff/as_anon rol ve JWT bağlamını kurar (SET LOCAL ROLE +
-- request.jwt.claims + request.headers — PostgREST'in yaptığının aynısı); t.ok koşulu, t.raises beklenen hatayı denetler.
-- Başarısız denetim "FAIL: …" ile istisna atar (db-test.sh çıktıda FAIL arar).
\set QUIET on
set client_min_messages = notice;

create schema t;
grant usage on schema t to public;
create table t.cfg (k text primary key, v text not null);
grant select on t.cfg to public;

create function t.v(p_k text) returns text language sql stable as $$ select c.v from t.cfg c where c.k = p_k $$;
create function t.u(p_k text) returns uuid language sql stable as $$ select c.v::uuid from t.cfg c where c.k = p_k $$;

create function t.as_admin() returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
create function t.as_bot(p_student uuid default null) returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', '{"role":"bot_runtime"}', true);
  perform set_config('request.headers', case when p_student is null then '{}' else json_build_object('x-ogrenmen-student', p_student)::text end, true);
  execute 'set local role bot_runtime';
end $$;
create function t.as_batch() returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', '{"role":"batch_worker"}', true);
  perform set_config('request.headers', '{}', true);
  execute 'set local role batch_worker';
end $$;
create function t.as_staff(p_staff uuid) returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', p_staff)::text, true);
  perform set_config('request.headers', '{}', true);
  execute 'set local role authenticated';
end $$;
create function t.as_anon() returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.headers', '{}', true);
  execute 'set local role anon';
end $$;
-- Yalnız JWT claim'i (rol değişmeden): grant'ten bağımsız olarak RPC GÖVDESİNİN rol denetimini sınar
create function t.claims_only(p_role text, p_sub uuid default null) returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', json_build_object('role', p_role, 'sub', p_sub)::text, true);
end $$;

create function t.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then
    raise notice 'OK: %', p_label;
  else
    raise exception 'FAIL: %', p_label;
  end if;
end $$;
-- p_sql'i çağıranın rolüyle çalıştırır; hata mesajı ya da SQLSTATE p_pattern'e (LIKE) uymalı
create function t.raises(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
declare
  v_msg text;
  v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    if v_msg like p_pattern or v_state like p_pattern then
      raise notice 'OK: % (%)', p_label, left(v_msg, 80);
      return;
    end if;
    raise exception 'FAIL: % — beklenen %, gelen % (%)', p_label, p_pattern, v_msg, v_state;
  end;
  raise exception 'FAIL: % — hata bekleniyordu (%), çalıştı', p_label, p_pattern;
end $$;
grant execute on all functions in schema t to public;

-- Müfredat: içerik seed'i (TYT-MAT@2026.1, aktif) varsa o; yoksa yalnız fikstürün ihtiyacı kadar asgari bir sürüm
do $$
declare
  v_cur uuid;
begin
  select c.id into v_cur from public.curricula c where c.code = 'TYT-MAT' and c.version = '2026.1';
  if v_cur is null then
    insert into public.curricula (code, authority, year, version, label, status)
    values ('TYT-MAT', 'ÖSYM', 2026, '2026.1', 'TYT Matematik 2026 (test)', 'active') returning id into v_cur;
    insert into public.skills (curriculum_id, id, parent_id, name, is_leaf, order_no) values
      (v_cur, 'tyt.mat.temel', null, 'Temel matematik', false, 1),
      (v_cur, 'tyt.mat.temel.sayilar', 'tyt.mat.temel', 'Sayı kümeleri, işlem önceliği, işaret kuralları', true, 2),
      (v_cur, 'tyt.mat.temel.bolunebilme', 'tyt.mat.temel', 'Bölünebilme kuralları, kalan', true, 3),
      (v_cur, 'tyt.mat.temel.ebob-ekok', 'tyt.mat.temel', 'EBOB–EKOK ve problemleri', true, 4),
      (v_cur, 'tyt.mat.temel.rasyonel-sayilar', 'tyt.mat.temel', 'Rasyonel sayılarda dört işlem ve sıralama', true, 5);
    insert into public.skill_prerequisites (curriculum_id, skill_id, prereq_id, strength) values
      (v_cur, 'tyt.mat.temel.rasyonel-sayilar', 'tyt.mat.temel.ebob-ekok', 0.6),
      (v_cur, 'tyt.mat.temel.rasyonel-sayilar', 'tyt.mat.temel.sayilar', 1.0);
    insert into public.misconception_tags (tag, curriculum_id, skill_id, prereq_skill_id, text_instructor, text_student) values
      ('rasyonel.pay-payda-ayri-toplama', v_cur, 'tyt.mat.temel.rasyonel-sayilar', null, 'Payları ve paydaları ayrı ayrı topluyor.', 'Paylar ve paydalar ayrı ayrı toplanmaz; önce paydaları eşitleyelim.'),
      ('rasyonel.payda-esitlemeden-toplama', v_cur, 'tyt.mat.temel.rasyonel-sayilar', 'tyt.mat.temel.ebob-ekok', 'Paydaları eşitlemeden payları topluyor.', 'Toplamadan önce paydaları eşitlemen gerekiyor.'),
      ('genel.soruyu-yarim-okuma', v_cur, null, null, 'Sorulanı değil ara sonucu işaretliyor.', 'Soru neyi istiyor, son adımda tekrar bak.');
  end if;
  insert into t.cfg values ('cur', v_cur::text);
  if not exists (select 1 from public.legal_texts lt where lt.kind = 'kvkk_aydinlatma') then
    insert into public.legal_texts (kind, version, body_md, effective_from) values
      ('kvkk_aydinlatma', 'test-v1', 'Aydınlatma metni (test)', '2026-10-01'),
      ('veli_onayi', 'test-v1', 'Veli onay formu (test)', '2026-10-01'),
      ('grup_kayit', 'test-v1', 'Grup kayıt bildirimi (test)', '2026-10-01'),
      ('ders_kaydi', 'test-v1', 'Ders kaydı bildirimi (test)', '2026-10-01');
  end if;
end $$;

insert into t.cfg values
  ('coord', '00000000-0000-4000-8000-0000000000c1'), ('inst_a', '00000000-0000-4000-8000-0000000000a1'),
  ('inst_b', '00000000-0000-4000-8000-0000000000b1'), ('obs', '00000000-0000-4000-8000-0000000000d1'),
  ('A', '10000000-0000-4000-8000-00000000000a'), ('B', '10000000-0000-4000-8000-00000000000b'),
  ('EA', '20000000-0000-4000-8000-0000000000ea'), ('EB', '20000000-0000-4000-8000-0000000000eb'),
  ('chat_a', '700100001'), ('chat_b', '700100002'), ('group', '-100900100'), ('tg_inst_a', '555100001');

-- Öğrenciler: A reşit, onaylı, aktif; B reşit değil, veli onayı yok
insert into public.students (id, public_ref, is_minor, status) values
  (t.u('A'), 's_aaaaaaaaaaaa', false, 'active'),
  (t.u('B'), 's_bbbbbbbbbbbb', true, 'pending_consent');
insert into secure.student_pii (student_id, display_name, birth_year) values
  (t.u('A'), 'Elif Kaya', 2007), (t.u('B'), 'Can Demir', 2011);
insert into secure.telegram_identities (telegram_user_id, student_id, username) values
  (700100001, t.u('A'), 'elif_k'), (700100002, t.u('B'), 'can_d');
insert into public.preferences (student_id) values (t.u('A')), (t.u('B'));
insert into public.enrollments (id, student_id, curriculum_id, period_label, started_at) values
  (t.u('EA'), t.u('A'), t.u('cur'), 'YKS 2027', '2026-10-01'),
  (t.u('EB'), t.u('B'), t.u('cur'), 'YKS 2027', '2026-10-01');
insert into public.consents (student_id, kind, legal_text_id, method, given_by, evidence)
select t.u('A'), 'kvkk_aydinlatma', lt.id, 'telegram_button', 'student', '{"chat_id":700100001,"message_id":1}'
  from public.legal_texts lt where lt.kind = 'kvkk_aydinlatma' order by lt.effective_from desc limit 1;
insert into public.staff_students (staff_id, student_id) values
  (t.u('inst_a'), t.u('A')), (t.u('obs'), t.u('A')), (t.u('inst_b'), t.u('B'));

-- Sohbetler: iki özel, bir grup (bot yönetici değil); grupta A, B ve bağlı eğitmen inst_a
insert into public.tg_chats (chat_id, kind, title) values
  (700100001, 'private', null), (700100002, 'private', null), (-100900100, 'group', 'TYT Matematik A');
insert into secure.telegram_identities (telegram_user_id, staff_id, username, mention_handle) values
  (555100001, t.u('inst_a'), 'ayse_hoca', '@ayse_hoca');
insert into public.chat_roles (chat_id, telegram_user_id, role, student_id, staff_id, mention_handle) values
  (700100001, 700100001, 'student', t.u('A'), null, null),
  (700100002, 700100002, 'student', t.u('B'), null, null),
  (-100900100, 700100001, 'student', t.u('A'), null, null),
  (-100900100, 700100002, 'student', t.u('B'), null, null),
  (-100900100, 555100001, 'instructor', null, t.u('inst_a'), '@ayse_hoca');

-- Mesajlar (ham metin text_raw yalnız eğitmen/koordinatör görünümünden okunur)
insert into public.messages (chat_id, telegram_message_id, sender_role, student_id, staff_id, reply_to_telegram_message_id,
                             text_raw, text_llm, is_question, sent_at) values
  (700100001, 11, 'student', t.u('A'), null, null, 'Elif: kesirleri nasıl toplarım?', '[ÖĞRENCİ]: kesirleri nasıl toplarım?', true, now() - interval '2 hours'),
  (700100001, 12, 'bot', t.u('A'), null, 11, 'Paydalara bakalım: ortak payda kaç olur?', 'Paydalara bakalım: ortak payda kaç olur?', false, now() - interval '119 minutes'),
  (700100002, 21, 'student', t.u('B'), null, null, null, null, null, now() - interval '1 hour'),
  (-100900100, 31, 'student', t.u('A'), null, null, 'Hocam ödev ne zaman?', 'Hocam ödev ne zaman?', true, now() - interval '30 minutes'),
  (-100900100, 32, 'student', t.u('B'), null, null, 'B öğrencisinin grup mesajı', 'B öğrencisinin grup mesajı', false, now() - interval '25 minutes'),
  (-100900100, 33, 'instructor', null, t.u('inst_a'), 31, 'Cuma günü teslim.', 'Cuma günü teslim.', false, now() - interval '20 minutes');

insert into t.cfg select 'msg_a_q', m.id::text from public.messages m where m.chat_id = 700100001 and m.telegram_message_id = 11;
insert into t.cfg select 'msg_group_a', m.id::text from public.messages m where m.chat_id = -100900100 and m.telegram_message_id = 31;
insert into t.cfg select 'msg_group_b', m.id::text from public.messages m where m.chat_id = -100900100 and m.telegram_message_id = 32;

-- Kalem: kurs + onaylı öncelik planı (öğrenci/bot bu tablolara erişmez; RPC ile okunur)
insert into public.courses (id, code, curriculum_id, title, instructor_alias) values
  ('30000000-0000-4000-8000-0000000000c0', 'TST-MAT', t.u('cur'), 'Test Matematik', 'hoca-A');
insert into public.exam_sources (id, course_id, year, term, instructor_alias, storage_path, legal_basis) values
  ('30000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000c0', 2025, 'osym', null, 'exams/test.pdf', 'kamuya açık ÖSYM yayını — yalnız istatistik');
insert into public.exam_items (source_id, item_no, topic, kind, points, ocr_text) values
  ('30000000-0000-4000-8000-0000000000e1', 1, 'Rasyonel sayılar', 'mc', 4, 'ARŞİV METNİ: paydaları farklı iki kesrin toplamı');
insert into public.exam_priority_plans (id, course_id, period, plan, evidence_count, status, approved_at) values
  ('30000000-0000-4000-8000-0000000000aa', '30000000-0000-4000-8000-0000000000c0', 'YKS 2027',
   jsonb_build_object('schema_version', '1.0', 'course_code', 'TST-MAT', 'period', 'YKS 2027', 'title', 'Sıklık analizine göre öncelikler',
                      'years_total', 3, 'evidence_count', 7, 'generated_at', '2026-10-10T00:00:00Z', 'others', '[]'::jsonb,
                      'rows', (select jsonb_agg(jsonb_build_object('rank', g, 'topic', 'Konu ' || g, 'kind', 'hesap', 'hits', 1, 'years', 1,
                                                                    'points_text', '≈4 puan', 'evidence_count', 1,
                                                                    'evidence_item_ids', jsonb_build_array(gen_random_uuid()),
                                                                    'syllabus_alignment', 'covered_and_asked') order by g)
                                 from generate_series(1, 7) as g)),
   7, 'approved', now());

reset role;
