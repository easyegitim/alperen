-- SPEC 13.3 metni birebir (docs/SPEC.md). Değişiklik önce SPEC'te yapılır.
create function public.reserve_analysis(
  p_user uuid, p_client_request_id uuid, p_limit int, p_since timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare existing uuid; used int; new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text || ':analysis'));
  select id into existing from analyses where user_id = p_user and client_request_id = p_client_request_id;
  if existing is not null then return existing; end if;           -- idempotency
  select count(*) into used from analyses
    where user_id = p_user and status in ('processing','completed') and created_at >= p_since;
  if used >= p_limit then return null; end if;
  insert into analyses (user_id, client_request_id) values (p_user, p_client_request_id) returning id into new_id;
  return new_id;
end $$;

create function public.reserve_tryon(
  p_user uuid, p_client_request_id uuid, p_preset text, p_model text, p_limit int, p_since timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare existing uuid; used int; new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text || ':tryon'));
  select id into existing from tryon_events where user_id = p_user and client_request_id = p_client_request_id;
  if existing is not null then return existing; end if;
  select count(*) into used from tryon_events
    where user_id = p_user and status in ('pending','success') and created_at >= p_since;
  if used >= p_limit then return null; end if;
  insert into tryon_events (user_id, client_request_id, preset_id, status, model)
    values (p_user, p_client_request_id, p_preset, 'pending', p_model) returning id into new_id;
  return new_id;
end $$;

revoke execute on function public.reserve_analysis from public, anon, authenticated;
revoke execute on function public.reserve_tryon from public, anon, authenticated;
