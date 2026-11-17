-- Faz 13 çıkış kriteri: deletion_requested_at + 7 gün → purge_deleted_users → kullanıcıya ait hiçbir satır kalmaz.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'ci@example.test');
insert into public.profiles (id, is_adult, onboarding_completed_at, deletion_requested_at)
  values ('11111111-1111-1111-1111-111111111111', true, now(), now() - interval '8 days')
  on conflict (id) do update set deletion_requested_at = excluded.deletion_requested_at, is_adult = true;
insert into public.consents (user_id, type, granted, text_version) values ('11111111-1111-1111-1111-111111111111', 'biometric_processing', true, 'v1');
insert into public.analyses (user_id, client_request_id, status) values ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), 'completed');
insert into public.data_exports (user_id) values ('11111111-1111-1111-1111-111111111111');
insert into public.routine_items (user_id, kind, slot, title) values ('11111111-1111-1111-1111-111111111111', 'habit', 'daily', 'su');
select public.purge_deleted_users() as purged;
do $$
declare n bigint;
begin
  select (select count(*) from public.profiles) + (select count(*) from public.consents) + (select count(*) from public.analyses)
       + (select count(*) from public.data_exports) + (select count(*) from public.routine_items) + (select count(*) from auth.users) into n;
  if n <> 0 then raise exception 'purge sonrası % satır kaldı', n; end if;
end $$;
