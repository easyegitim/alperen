-- SPEC 13.2 metni birebir (docs/SPEC.md). Değişiklik önce SPEC'te yapılır.
do $$ declare t text; begin
  foreach t in array array['profiles','consents','analyses','coach_reports','tryon_events',
    'routine_items','routine_logs','subscriptions','payment_events','feedback','partners',
    'referral_requests','referral_revenue']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

create policy p_profiles_read on public.profiles for select using (auth.uid() = id);
create policy p_profiles_update on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
revoke update on public.profiles from authenticated;
grant update (questionnaire, locale) on public.profiles to authenticated;

create policy p_consents_read on public.consents for select using (auth.uid() = user_id);
create policy p_consents_insert on public.consents for insert with check (auth.uid() = user_id);

-- analyses: tarayıcı doğrudan okumaz; kırpılmış görünüm yalnız API'den gelir (kilitli değer sızmasın)
create policy p_tryon_read on public.tryon_events for select using (auth.uid() = user_id);
create policy p_subs_read on public.subscriptions for select using (auth.uid() = user_id);

create policy p_items_all on public.routine_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy p_logs_all on public.routine_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy p_feedback_insert on public.feedback for insert with check (auth.uid() = user_id);
create policy p_partners_read on public.partners for select using (active = true and verified_at is not null);
create policy p_ref_read on public.referral_requests for select using (auth.uid() = user_id);
-- analyses, coach_reports, payment_events, referral_revenue: politika yok = yalnız service role
