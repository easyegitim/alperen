-- seed/dev/02_people.sql — geliştirme verisi: kişiler (personel, öğrenciler, secure kimlik verisi, onaylar, kayıtlar).
-- supabase/scripts/gen-dev-seed.py fixtures/db/dev-seed.json'dan üretir; elle düzenlenmez. Yalnız db-test.sh --dev.
begin;
select set_config('ogrenmen.grader', 'on', true);

-- auth.users (3)
insert into auth.users (id, email, created_at) values ('91c9e333-16a1-55c8-8bcf-1a6c6f3dc529', null, '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into auth.users (id, email, created_at) values ('de70e65e-1410-5026-a773-c5e55a3e6368', null, '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into auth.users (id, email, created_at) values ('e52b76f6-2fb9-5e83-8949-d20c15d5abb3', null, '2026-10-01T00:00:00Z')
  on conflict do nothing;

-- staff (3)
insert into public.staff (id, full_name, role, subject, active, created_at) values ('91c9e333-16a1-55c8-8bcf-1a6c6f3dc529', 'Selin Arslan', 'coordinator', null, true, '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.staff (id, full_name, role, subject, active, created_at) values ('de70e65e-1410-5026-a773-c5e55a3e6368', 'Ayşe Yılmaz', 'instructor', 'matematik', true, '2026-10-01T00:00:00Z')
  on conflict do nothing;
insert into public.staff (id, full_name, role, subject, active, created_at) values ('e52b76f6-2fb9-5e83-8949-d20c15d5abb3', 'Deniz Koç', 'observer', null, true, '2026-10-01T00:00:00Z')
  on conflict do nothing;

-- students (3)
insert into public.students (id, public_ref, is_minor, tz, tier, status, created_at, deleted_at) values ('c661b28c-81a8-5c11-9a5e-b919b5231034', 's_qk7m2rx4tn5a', false, 'Europe/Istanbul', 'standard', 'active', '2026-10-10T12:00:00Z', null)
  on conflict do nothing;
insert into public.students (id, public_ref, is_minor, tz, tier, status, created_at, deleted_at) values ('1da926ea-a047-5403-9644-bb047719707b', 's_vd3hp6wz2kc7', true, 'Europe/Istanbul', 'standard', 'active', '2026-10-10T12:00:00Z', null)
  on conflict do nothing;
insert into public.students (id, public_ref, is_minor, tz, tier, status, created_at, deleted_at) values ('9d4d557b-6191-5018-b679-baf9dbacc67e', 's_mb5tj7ye4ql2', true, 'Europe/Istanbul', 'standard', 'pending_consent', '2026-10-10T12:00:00Z', null)
  on conflict do nothing;

-- staff_students (4)
insert into public.staff_students (staff_id, student_id) values ('de70e65e-1410-5026-a773-c5e55a3e6368', 'c661b28c-81a8-5c11-9a5e-b919b5231034')
  on conflict do nothing;
insert into public.staff_students (staff_id, student_id) values ('de70e65e-1410-5026-a773-c5e55a3e6368', '1da926ea-a047-5403-9644-bb047719707b')
  on conflict do nothing;
insert into public.staff_students (staff_id, student_id) values ('de70e65e-1410-5026-a773-c5e55a3e6368', '9d4d557b-6191-5018-b679-baf9dbacc67e')
  on conflict do nothing;
insert into public.staff_students (staff_id, student_id) values ('e52b76f6-2fb9-5e83-8949-d20c15d5abb3', 'c661b28c-81a8-5c11-9a5e-b919b5231034')
  on conflict do nothing;

-- secure.student_pii (3)
insert into secure.student_pii (student_id, display_name, birth_year, school, grade, guardian_name, guardian_relation, guardian_contact, name_token_hashes, updated_at) values ('c661b28c-81a8-5c11-9a5e-b919b5231034', 'Elif Kaya', 2007, 'Kadıköy Anadolu Lisesi', '12', null, null, null, array['d5fdb221055ea62b50ae39ea2305454218ff12d8527a841c27c9d07c82aa5cca', 'bb0799670fa3cdbc7d8160fda08d18d49a501578a388010b543a9a6d036c3968']::text[], '2026-10-10T12:00:00Z')
  on conflict do nothing;
insert into secure.student_pii (student_id, display_name, birth_year, school, grade, guardian_name, guardian_relation, guardian_contact, name_token_hashes, updated_at) values ('1da926ea-a047-5403-9644-bb047719707b', 'Mert Demir', 2010, 'Üsküdar Fen Lisesi', '11', 'Fatma Demir', 'anne', 'fatma.demir@example.com', array['8bbc4e9197c3f547cb5384280f89c90e248c30bcf34803a8e4eb2a845f79afe3', '06802f65feb092f3063f0abd9b18c8bf22c34ca4403bccb399c8dd79b4b777da', '5f88bb1ad160d0abf6ef08239c92be31c87144947bed5b131d4aa36ccfcef6ad']::text[], '2026-10-10T12:00:00Z')
  on conflict do nothing;
insert into secure.student_pii (student_id, display_name, birth_year, school, grade, guardian_name, guardian_relation, guardian_contact, name_token_hashes, updated_at) values ('9d4d557b-6191-5018-b679-baf9dbacc67e', 'Zeynep Çelik', 2011, 'Maltepe Anadolu Lisesi', '10', 'Hakan Çelik', 'baba', '0532 765 43 21', array['b3b0b3743dde3acf7abff544540b1033d7075ee12330c60cd8662cada07136c4', 'ab96fc9e88c3949676f1077bd94606948d5ab23dfe3649b3cf2779db07672b32', 'f8c14b2a7024f15661d617ac5533ddacf25f33653bc09773fc7d0fbf99319ab5']::text[], '2026-10-10T12:00:00Z')
  on conflict do nothing;

-- secure.telegram_identities (5)
insert into secure.telegram_identities (telegram_user_id, student_id, staff_id, username, mention_handle, linked_at) values (700000001, 'c661b28c-81a8-5c11-9a5e-b919b5231034', null, 'elif_k', null, '2026-10-10T12:00:00Z')
  on conflict do nothing;
insert into secure.telegram_identities (telegram_user_id, student_id, staff_id, username, mention_handle, linked_at) values (700000002, '1da926ea-a047-5403-9644-bb047719707b', null, 'mert_d', null, '2026-10-10T12:00:00Z')
  on conflict do nothing;
insert into secure.telegram_identities (telegram_user_id, student_id, staff_id, username, mention_handle, linked_at) values (700000003, '9d4d557b-6191-5018-b679-baf9dbacc67e', null, 'zeynep_c', null, '2026-10-10T12:00:00Z')
  on conflict do nothing;
insert into secure.telegram_identities (telegram_user_id, student_id, staff_id, username, mention_handle, linked_at) values (700000102, null, '91c9e333-16a1-55c8-8bcf-1a6c6f3dc529', 'selin_koord', '@selin_koord', '2026-10-12T09:00:00Z')
  on conflict do nothing;
insert into secure.telegram_identities (telegram_user_id, student_id, staff_id, username, mention_handle, linked_at) values (700000101, null, 'de70e65e-1410-5026-a773-c5e55a3e6368', 'ayse_hoca', '@ayse_hoca', '2026-10-12T09:00:00Z')
  on conflict do nothing;

-- secure.guardian_codes (2)
insert into secure.guardian_codes (id, student_id, code_hash, channel, created_by, expires_at, used_at, used_by_telegram_user_id, attempts, locked_until) values ('a799eb36-8c0f-575e-a17c-c7e3aa69a867', '9d4d557b-6191-5018-b679-baf9dbacc67e', '25795c9ee5267f4c995a7cb1c654640683300fc2c45c63b5bc320ce824540631', 'telegram', '91c9e333-16a1-55c8-8bcf-1a6c6f3dc529', '2026-10-22T09:00:00Z', null, null, 0, null)
  on conflict do nothing;
insert into secure.guardian_codes (id, student_id, code_hash, channel, created_by, expires_at, used_at, used_by_telegram_user_id, attempts, locked_until) values ('b511f6d9-3627-5d4c-a9f2-90c85d32102e', '1da926ea-a047-5403-9644-bb047719707b', '4da842929a6afbc24e347696d7ed38ff374e57a8cc344907dce9b38469b82e27', 'telegram', '91c9e333-16a1-55c8-8bcf-1a6c6f3dc529', '2026-10-14T09:00:00Z', '2026-10-12T18:30:00Z', 700000301, 0, null)
  on conflict do nothing;

-- secure.staff_codes (1)
insert into secure.staff_codes (id, staff_id, code_hash, created_by, expires_at, used_at, used_by_telegram_user_id) values ('2ac8bdac-be69-5384-a1e6-8cdc291bd24a', 'de70e65e-1410-5026-a773-c5e55a3e6368', 'a5f89c25748612025cc2b8d6d30988f3462660b7c4805007096bbad40646eba8', '91c9e333-16a1-55c8-8bcf-1a6c6f3dc529', '2026-10-23T09:00:00Z', null, null)
  on conflict do nothing;

-- consents (4)
insert into public.consents (id, student_id, kind, legal_text_id, status, method, given_by, evidence, given_at, revoked_at, created_at) values ('4aa1b867-61bd-5316-8924-f9c583b00f2e', 'c661b28c-81a8-5c11-9a5e-b919b5231034', 'kvkk_aydinlatma', coalesce((select lt.id from public.legal_texts as lt where lt.kind = 'kvkk_aydinlatma' and lt.version = '2026-10-v1'), '675a8680-b4d6-5837-9155-7792d2824422'::uuid), 'given', 'telegram_button', 'student', '{"chat_id":700000001,"message_id":1,"telegram_user_id":700000001}'::jsonb, '2026-10-10T12:05:00Z', null, '2026-10-10T12:05:00Z')
  on conflict do nothing;
insert into public.consents (id, student_id, kind, legal_text_id, status, method, given_by, evidence, given_at, revoked_at, created_at) values ('93a067fa-ddaf-507b-ab80-ec04559a4138', '1da926ea-a047-5403-9644-bb047719707b', 'kvkk_aydinlatma', coalesce((select lt.id from public.legal_texts as lt where lt.kind = 'kvkk_aydinlatma' and lt.version = '2026-10-v1'), '675a8680-b4d6-5837-9155-7792d2824422'::uuid), 'given', 'telegram_button', 'student', '{"chat_id":700000002,"message_id":1,"telegram_user_id":700000002}'::jsonb, '2026-10-11T15:00:00Z', null, '2026-10-11T15:00:00Z')
  on conflict do nothing;
insert into public.consents (id, student_id, kind, legal_text_id, status, method, given_by, evidence, given_at, revoked_at, created_at) values ('b9f33c6c-3bc3-5d6d-a2b1-d874a62cccd9', '1da926ea-a047-5403-9644-bb047719707b', 'veli_onayi', coalesce((select lt.id from public.legal_texts as lt where lt.kind = 'veli_onayi' and lt.version = '2026-10-v1'), '436801a0-024e-56dd-ab6e-257889632603'::uuid), 'given', 'guardian_code', 'guardian', '{"chat_id":700000301,"message_id":3,"telegram_user_id":700000301,"code_id":"b511f6d9-3627-5d4c-a9f2-90c85d32102e"}'::jsonb, '2026-10-12T18:30:00Z', null, '2026-10-12T18:30:00Z')
  on conflict do nothing;
insert into public.consents (id, student_id, kind, legal_text_id, status, method, given_by, evidence, given_at, revoked_at, created_at) values ('6d8727af-6997-585a-9b7c-32eb0636f091', '9d4d557b-6191-5018-b679-baf9dbacc67e', 'kvkk_aydinlatma', coalesce((select lt.id from public.legal_texts as lt where lt.kind = 'kvkk_aydinlatma' and lt.version = '2026-10-v1'), '675a8680-b4d6-5837-9155-7792d2824422'::uuid), 'given', 'telegram_button', 'student', '{"chat_id":700000003,"message_id":1,"telegram_user_id":700000003}'::jsonb, '2026-10-16T13:58:00Z', null, '2026-10-16T13:58:00Z')
  on conflict do nothing;

-- enrollments (3)
insert into public.enrollments (id, student_id, curriculum_id, period_label, status, started_at, ended_at) values ('8bef16e2-1fb1-56d1-9530-3cd5b1ea7cf3', 'c661b28c-81a8-5c11-9a5e-b919b5231034', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'YKS 2027', 'active', '2026-10-10', null)
  on conflict do nothing;
insert into public.enrollments (id, student_id, curriculum_id, period_label, status, started_at, ended_at) values ('1899cde6-c497-5b14-8051-882f44649013', '1da926ea-a047-5403-9644-bb047719707b', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'YKS 2027', 'active', '2026-10-10', null)
  on conflict do nothing;
insert into public.enrollments (id, student_id, curriculum_id, period_label, status, started_at, ended_at) values ('d441ee83-5b1a-5f11-b124-9100b6ba8d32', '9d4d557b-6191-5018-b679-baf9dbacc67e', '7a988b84-8937-5242-8c35-ddbc4ea9216d', 'YKS 2027', 'active', '2026-10-10', null)
  on conflict do nothing;

-- preferences (3)
insert into public.preferences (student_id, active_hours, modality, default_mode, explanation_notes, proactive_enabled, voice_reply, updated_at) values ('c661b28c-81a8-5c11-9a5e-b919b5231034', array[18, 19, 20, 21]::smallint[], null, 'socratic', 'kısa adımlar işe yarıyor', true, false, '2026-10-19T00:40:00Z')
  on conflict do nothing;
insert into public.preferences (student_id, active_hours, modality, default_mode, explanation_notes, proactive_enabled, voice_reply, updated_at) values ('1da926ea-a047-5403-9644-bb047719707b', array[18, 19, 20, 21]::smallint[], null, 'socratic', null, true, false, '2026-10-19T00:40:00Z')
  on conflict do nothing;
insert into public.preferences (student_id, active_hours, modality, default_mode, explanation_notes, proactive_enabled, voice_reply, updated_at) values ('9d4d557b-6191-5018-b679-baf9dbacc67e', array[18, 19, 20, 21]::smallint[], null, 'socratic', null, true, false, '2026-10-19T00:40:00Z')
  on conflict do nothing;

commit;
