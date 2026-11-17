-- 0048_exam_admin.sql — eğitmen "Sınavlar" sayfası için iki okuma RPC'si. Cevap anahtarları secure.exam_answer_keys'tedir
-- (0009; authenticated için kapalı); eğitmen anahtarı bu SECURITY DEFINER fonksiyonlar üzerinden görür, yazma yolu
-- değişmez (set_exam_keys / set_exam_key, app.can_edit_exam; 0030).
--   * kapsam (app.exam_in_staff_scope): admin ve worker hepsi; eğitmen app.can_read_exam'ın açtığı sınavlardan yalnız
--     yayımlanmış olanları, bağlı öğrencilerinin (app.my_students()) oturum açtığı ya da yüklediği sınavları ve
--     düzenleyebildiği (app.can_edit_exam) sınavları görür
--   * instructor_exam_list: sınav başına soru, oturum (eğitmene bağlı öğrencilerinki; admin hepsi), anahtarsız soru
--     (açık uçlu hariç) ve doğrulanmamış anahtar sayısı (source = 'inferred' ve güven < 0,8; grade_exam_session ve
--     set_exam_keys'teki 'unverified' tanımıyla aynı), düzenleme yetkisi ve notlama kilidi
--   * instructor_exam_keys: soru başına numara, bölüm, kazanımlar, şık anahtarları, anahtar ve kaynağı; soru metni yok
--     (telifli sınavda da metin dönmez). Her okuma denetim izine yazılır (peek_answer_key gibi; değer yazılmaz)
-- app.can_edit_exam oluşturanı boş sınavda NULL dönebilir; burada coalesce ile false sayılır.
-- Hata kodları: OGR-AUTH-002 (42501) eğitmen/admin değil ya da sınav kapsam dışı; OGR-EXAM-001 sınav bulunamadı.

-- Sınav, oturumdaki personelin "Sınavlar" kapsamında mı (yukarıdaki kural). Yalnız bu dosyanın SECURITY DEFINER
-- fonksiyonları çağırır.
create or replace function app.exam_in_staff_scope(p_exam uuid) returns boolean
language plpgsql
stable
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_kind text;
  v_creator uuid;
begin
  select x.kind, x.created_by into v_kind, v_creator from public.exams x where x.id = p_exam;
  if not found then
    return false;
  end if;
  if app.is_trusted() or app.is_admin() then
    return true;
  end if;
  if app.role() is distinct from 'instructor' or not app.can_read_exam(p_exam) then
    return false;
  end if;
  return v_kind = 'published'
      or exists (select 1 from public.exam_sessions es join public.enrollments e on e.id = es.enrollment_id
                  where es.exam_id = p_exam and e.student_id in (select app.my_students()))
      or exists (select 1 from public.students s where s.profile_id = v_creator and s.id in (select app.my_students()))
      or coalesce(app.can_edit_exam(p_exam), false);
end
$$;
comment on function app.exam_in_staff_scope(uuid) is 'Sınav personelin Sınavlar kapsamında mı: admin/worker hepsi; eğitmen (app.can_read_exam içinde) yayımlanmış, bağlı öğrencisinin çözdüğü/yüklediği ya da düzenleyebildiği sınavlar.';

create or replace function public.instructor_exam_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_admin boolean := app.is_admin();
  v_out jsonb;
begin
  if not app.is_staff() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 sınav listesini yalnız eğitmen ya da admin görür';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'title', x.title, 'kind', x.kind, 'source', x.source, 'status', x.status,
           'is_copyrighted', x.is_copyrighted, 'created_at', x.created_at,
           'question_count', q.questions, 'session_count', s.sessions,
           'missing_keys', q.missing, 'unverified_keys', q.unverified,
           'can_edit', coalesce(app.can_edit_exam(x.id), false), 'locked', app.exam_has_graded_session(x.id))
           order by x.created_at desc, x.id), '[]'::jsonb)
    into v_out
    from public.exams x
    cross join lateral (
      select count(*)::int as questions,
             count(*) filter (where k.exam_question_id is null and eq.kind <> 'open')::int as missing,
             count(*) filter (where k.source = 'inferred' and coalesce(k.confidence, 0) < 0.8)::int as unverified
        from public.exam_questions eq left join secure.exam_answer_keys k on k.exam_question_id = eq.id
       where eq.exam_id = x.id) as q
    cross join lateral (
      select count(*)::int as sessions
        from public.exam_sessions es join public.enrollments e on e.id = es.enrollment_id
       where es.exam_id = x.id and (v_admin or e.student_id in (select app.my_students()))) as s
   where app.exam_in_staff_scope(x.id);
  return v_out;
end
$$;
comment on function public.instructor_exam_list() is 'Eğitmen/admin: kapsamdaki sınavlar (app.exam_in_staff_scope) ile soru, oturum, anahtarsız ve doğrulanmamış anahtar sayıları; anahtar değeri dönmez; diğerlerine OGR-AUTH-002.';

create or replace function public.instructor_exam_keys(p_exam_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, app, secure, extensions, pg_temp
as $$
declare
  v_x record;
  v_questions jsonb;
begin
  if not app.is_staff() then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 cevap anahtarını yalnız eğitmen ya da admin görür';
  end if;
  select x.id, x.title, x.kind, x.source, x.status, x.is_copyrighted, x.answer_key_source, x.created_at
    into v_x from public.exams x where x.id = p_exam_id;
  if v_x.id is null then
    raise exception using errcode = 'P0001', message = 'OGR-EXAM-001 sınav bulunamadı';
  end if;
  if not app.exam_in_staff_scope(p_exam_id) then
    raise exception using errcode = '42501', message = 'OGR-AUTH-002 bu sınavın anahtarını göremezsin';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'no', q.no, 'section', q.section, 'kind', q.kind, 'skill_ids', to_jsonb(q.skill_ids),
           'option_keys', case when jsonb_typeof(q.options) = 'array'
                               then (select coalesce(jsonb_agg(o.opt -> 'key' order by o.ord), '[]'::jsonb)
                                       from jsonb_array_elements(q.options) with ordinality as o (opt, ord)
                                      where jsonb_typeof(o.opt -> 'key') = 'string')
                               else '[]'::jsonb end,
           'correct_option', k.correct_option, 'numeric_value', k.numeric_value,
           'source', k.source, 'confidence', k.confidence,
           'unverified', coalesce(k.source = 'inferred' and coalesce(k.confidence, 0) < 0.8, false))
           order by q.no), '[]'::jsonb)
    into v_questions
    from public.exam_questions q left join secure.exam_answer_keys k on k.exam_question_id = q.id
   where q.exam_id = p_exam_id;
  perform app.audit_event('exam_keys.view', 'secure.exam_answer_keys', p_exam_id::text, null);
  return jsonb_build_object(
    'exam', jsonb_build_object('id', v_x.id, 'title', v_x.title, 'kind', v_x.kind, 'source', v_x.source, 'status', v_x.status,
                               'is_copyrighted', v_x.is_copyrighted, 'answer_key_source', v_x.answer_key_source,
                               'created_at', v_x.created_at, 'can_edit', coalesce(app.can_edit_exam(p_exam_id), false),
                               'locked', app.exam_has_graded_session(p_exam_id)),
    'questions', v_questions
  );
end
$$;
comment on function public.instructor_exam_keys(uuid) is 'Eğitmen/admin: kapsamdaki sınavın soru başına anahtarı ve kaynağı (soru metni yok), düzenleme yetkisi ve kilit; okuma denetim izine yazılır; kapsam dışına OGR-AUTH-002.';

revoke all on function app.exam_in_staff_scope(uuid) from public;
revoke all on function public.instructor_exam_list(), public.instructor_exam_keys(uuid) from public, anon;
grant execute on function public.instructor_exam_list(), public.instructor_exam_keys(uuid) to authenticated;
