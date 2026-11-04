-- 0033_exam_clock_uploads.sql — P2 deneme oynatıcısı düzeltmeleri.
--   exam_clock(p_session)              süren/bitmiş oturumun bitiş sınırı ve sunucu saati; SALT OKUR. Oturum açmaz,
--                                      kapatmaz, yeniden açmaz. Saat eşitlemesi start_exam_session kullanmamalı: süresi dolmuş
--                                      ya da bitmiş bir oturumda yeni deneme oturumu açardı (bitiş yarışı).
--   app.student_can_read_exam_upload   öğrencinin oturumu olan bir sınavın sorusunun kitapçık sayfası (page_upload_id) ya da
--                                      şekli (figure_upload_id) mi: uploads ve storage politikalarının ortak yardımcısı.
--   uploads_select_exam                eğitmenin yüklediği kitapçık sayfası ve şekiller öğrenciye yalnız bu sınav yoluyla görünür
--                                      (0018 uploads_select: sahip ya da can_read_student_data; yeni dal eklenir, daraltılmaz).
--   ogrenmen_uploads_select (yeniden) Storage: nesnenin uploads satırı yükleyenin klasöründeyse (0018) ya da sınav yoluyla
--                                      öğrenciye açıksa okunur.

-- --- salt okur saat -------------------------------------------------------------------------------------------------

create or replace function public.exam_clock(p_session uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_s public.exam_sessions%rowtype;
begin
  select es.* into v_s from public.exam_sessions es where es.id = p_session;
  if not found or not app.can_read_enrollment(v_s.enrollment_id, false) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-001 bu oturum için yetki yok';
  end if;
  return jsonb_build_object(
    'session_id', v_s.id,
    'status', v_s.status,
    'deadline_at', app.exam_deadline(v_s.id),
    'server_now', now()
  );
end
$$;
comment on function public.exam_clock(uuid) is 'Oturumun bitiş sınırı ve sunucu saati (salt okur; oturum açmaz ya da kapatmaz). Saat eşitlemesi için.';

revoke all on function public.exam_clock(uuid) from public;
grant execute on function public.exam_clock(uuid) to authenticated, service_role;

-- --- kitapçık görselleri: öğrenci yalnız kendi sınavının kırpımını okur ---------------------------------------------

create or replace function app.student_can_read_exam_upload(p_upload uuid) returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1
      from public.exam_questions as q
      join public.exam_sessions as es on es.exam_id = q.exam_id
      join public.enrollments as e on e.id = es.enrollment_id
     where (q.page_upload_id = p_upload or q.figure_upload_id = p_upload)
       and e.student_id = app.my_student_id()
  );
$$;
comment on function app.student_can_read_exam_upload(uuid) is 'Yükleme, oturumu olan öğrencinin bir sınavının soru kırpımı ya da şekli mi (page_upload_id / figure_upload_id).';

revoke all on function app.student_can_read_exam_upload(uuid) from public;
grant execute on function app.student_can_read_exam_upload(uuid) to authenticated, service_role;

create policy uploads_select_exam on public.uploads for select to authenticated
using (app.student_can_read_exam_upload(id));

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects yok (yerel Postgres): Storage politikası atlandı';
    return;
  end if;
  execute $p$drop policy if exists ogrenmen_uploads_select on storage.objects$p$;
  execute $p$create policy ogrenmen_uploads_select on storage.objects for select to authenticated
           using (bucket_id = 'uploads'
                  and exists (select 1 from public.uploads u
                               where u.storage_path = storage.objects.name
                                 and (u.owner_id::text = (storage.foldername(storage.objects.name))[1]
                                      or app.student_can_read_exam_upload(u.id))))$p$;
end
$$;
