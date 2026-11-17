-- 0049: app.can_edit_exam NULL döndürüyordu → yetkisiz eğitmen anahtar yazabiliyordu (güvenlik düzeltmesi).
-- Neden: oluşturanı boş (created_by null) bir sınavda `v_creator = auth.uid()` NULL olur; ders bağı da yoksa
-- NULL or false or false = NULL. Çağıranlar (set_exam_key, set_exam_keys, register_exam_questions) `if not
-- app.can_edit_exam(...)` diye denetler; `not NULL` da NULL olduğundan engel çalışmaz ve kapsam dışındaki herhangi bir
-- eğitmen anahtar yazabilirdi (öğrenci/veli etkilenmez: rol denetimi daha önce false döndürür). Gövde 0030 ile aynı;
-- yalnız son ifade coalesce ile kapalı başarısızlığa çevrildi.
create or replace function app.can_edit_exam(p_exam uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_course uuid;
  v_creator uuid;
  v_source text;
begin
  select x.course_id, x.created_by, x.source into v_course, v_creator, v_source from public.exams x where x.id = p_exam;
  if not found then
    return false;
  end if;
  if app.is_trusted() or app.is_admin() then
    return true;
  end if;
  if app.role() is distinct from 'instructor' then
    return false;
  end if;
  if v_source = 'uploaded' then
    return exists (select 1 from public.exam_sessions es
                     join public.enrollments e on e.id = es.enrollment_id
                     join public.instructor_links il on il.student_id = e.student_id
                    where es.exam_id = p_exam and il.instructor_id = auth.uid() and il.role = 'owner');
  end if;
  return coalesce(v_creator = auth.uid(), false)
      or exists (select 1 from public.courses co where co.id = v_course and co.created_by = auth.uid())
      or exists (select 1 from public.instructor_links il where il.instructor_id = auth.uid() and il.course_id = v_course);
end
$$;
comment on function app.can_edit_exam(uuid) is 'Sınavın sorularını/anahtarını yazabilir mi: worker, admin; yüklenen denemede öğrencinin owner eğitmeni, diğerlerinde sınavın eğitmeni. Hiçbir koşulda NULL döndürmez (0049).';
revoke all on function app.can_edit_exam(uuid) from public;
