-- tests/10_guardian.sql — veli davetleri: create_guardian_invite (token bir kez, yalnız sha256 hex saklanır, süre) →
-- accept_guardian_invite (profil yoksa veli profili açılır; tek kullanım; süre; yalnız veli rolü) → bağ active →
-- veli görünürlüğü (v_parent_child_overview, mastery_view, raporlar; koç sohbeti yok) → revoke_guardian_link.
begin;
\ir _fixture.sql
select t.add_outsiders();

do $$
declare
  v_inv jsonb;
  v_link public.guardian_links%rowtype;
  v_new uuid := '00000000-0000-4000-8000-0000000000b9';
  v_res jsonb;
begin
  insert into auth.users (id, email) values (v_new, 'yeniveli@ogrenmen.test');
  insert into t.cfg values ('newp', v_new::text);
  -- öğrenci Can davet oluşturur
  perform t.as_user(t.u('can'));
  v_inv := public.create_guardian_invite(t.u('B'), 'anne');
  perform t.as_admin();
  insert into t.cfg values ('tok', v_inv ->> 'token');
  select gl.* into v_link from public.guardian_links gl where gl.id = (v_inv ->> 'link_id')::uuid;
  perform t.ok(v_inv ->> 'token' ~ '^gi_[a-z2-7]{32}$' and v_link.status = 'invited' and v_link.parent_id is null and v_link.relation = 'anne'
               and v_link.created_by = t.u('can'), 'davet: token gi_ + 32 base32, bağ invited, veli boş');
  perform t.ok(v_link.invite_token_hash = encode(sha256(convert_to(v_inv ->> 'token', 'UTF8')), 'hex')
               and position(v_inv ->> 'token' in v_link::text) = 0, 'yalnız sha256(token) hex saklanır, token saklanmaz');
  perform t.ok(v_link.invite_expires_at between now() + interval '71 hours' and now() + interval '73 hours', 'süre settings.guardian_invite_hours (72 sa)');
  perform t.ok(not exists (select 1 from audit.events e where e.table_name = 'public.guardian_links' and e.diff::text like '%' || (v_inv ->> 'token') || '%'),
               'denetim izinde token yok');

  -- yetki: veli davet oluşturamaz; bağlı eğitmen (owner) oluşturabilir
  perform t.as_user(t.u('parent'));
  perform t.raises(format($q$select public.create_guardian_invite(%L)$q$, t.u('A')), 'OGR-AUTH-001%', 'veli davet oluşturamaz');
  perform t.as_user(t.u('inst'));
  perform t.ok(public.create_guardian_invite(t.u('B')) ? 'token', 'owner eğitmen davet oluşturur');
  perform t.as_user(t.u('inst2'));
  perform t.raises(format($q$select public.create_guardian_invite(%L)$q$, t.u('B')), 'OGR-AUTH-001%', 'bağsız eğitmen davet oluşturamaz');

  -- kabul: başka roldeki hesap kabul edemez
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.accept_guardian_invite(%L)$q$, t.v('tok')), 'OGR-INV-003%', 'öğrenci hesabı daveti kabul edemez');
  perform t.as_user(v_new);
  perform t.raises($q$select public.accept_guardian_invite('gi_yanlis')$q$, 'OGR-INV-001%', 'yanlış token');
  v_res := public.accept_guardian_invite(t.v('tok'));
  perform t.ok((v_res ->> 'student_id')::uuid = t.u('B') and app.role() = 'parent'
               and array(select x from app.my_children() as x) = array[t.u('B')], 'kabul: profil yoksa veli profili açılır, çocuk görünür');
  perform t.raises(format($q$select public.accept_guardian_invite(%L)$q$, t.v('tok')), 'OGR-INV-001%', 'token tek kullanımlık');
  perform t.as_admin();
  perform t.ok((select gl.status = 'active' and gl.parent_id = v_new and gl.invite_token_hash is null and gl.accepted_at is not null
                  from public.guardian_links gl where gl.id = (v_inv ->> 'link_id')::uuid), 'bağ active, hash silindi');
end $$;

-- süre dolmuş davet; zaten bağlı velinin ikinci daveti mevcut bağı yeniler
do $$
declare
  v_inv jsonb;
  v_link uuid;
begin
  perform t.as_user(t.u('elif'));
  v_inv := public.create_guardian_invite(t.u('A'));
  perform t.as_admin();
  update public.guardian_links gl set invite_expires_at = now() - interval '1 minute' where gl.id = (v_inv ->> 'link_id')::uuid;
  perform t.as_user(t.u('parent2'));
  perform t.raises(format($q$select public.accept_guardian_invite(%L)$q$, v_inv ->> 'token'), 'OGR-INV-002%', 'süresi dolmuş davet');
  perform t.as_admin();
  select gl.id into v_link from public.guardian_links gl where gl.parent_id = t.u('parent') and gl.student_id = t.u('A');
  update public.guardian_links gl set status = 'revoked' where gl.id = v_link;
  perform t.as_user(t.u('elif'));
  v_inv := public.create_guardian_invite(t.u('A'), 'baba');
  perform t.as_user(t.u('parent'));
  perform t.ok((public.accept_guardian_invite(v_inv ->> 'token') ->> 'link_id')::uuid = v_link, 'aynı veli için mevcut bağ yeniden active olur');
  perform t.as_admin();
  perform t.ok((select gl.status from public.guardian_links gl where gl.id = v_link) = 'active'
               and not exists (select 1 from public.guardian_links gl where gl.id = (v_inv ->> 'link_id')::uuid),
               'davet satırı silinir, tekil (veli, öğrenci) bağı korunur');
end $$;

-- veli görünürlüğü: özet kartı, ustalık görünümü, raporlar; koç sohbeti ve gözlemler yok
do $$
declare
  v_row record;
begin
  perform public.apply_diagnosis(jsonb_build_object('enrollment_id', t.u('EB'), 'verdict', 'wrong', 'error_cause', 'concept',
            'skill_ids', jsonb_build_array('t.mat.a'), 'analysis', '{}'::jsonb));
  insert into public.conversations (student_id, kind, participant_id) values (t.u('B'), 'coach', t.u('can'));
  insert into public.generated_documents (student_id, course_id, kind, title, status) values
    (t.u('B'), t.u('course'), 'report', 'Can haftalık', 'published'), (t.u('B'), t.u('course'), 'notes', 'Can notları', 'published');
  insert into public.notifications (recipient_id, kind, title) values (t.u('newp'), 'weekly', 'Haftalık özet');
  perform t.as_user(t.u('newp'));
  select * into v_row from public.v_parent_child_overview;
  perform t.ok(v_row.student_id = t.u('B') and v_row.display_name = 'Can Demir' and v_row.diagnoses_7d = 1 and v_row.unread_notifications = 1
               and jsonb_array_length(v_row.enrollments) = 1 and (v_row.mastery_bands ->> 'insufficient')::int = 1
               and v_row.last_activity_at is not null, 'veli özet kartı: çocuk, 7 g teşhis, bildirim, kayıt, bant (kanıt yetersiz)');
  perform t.ok((select count(*) from public.v_parent_child_overview) = 1, 'veli yalnız kendi bağlarının kartını görür');
  perform t.ok((select count(*) from public.mastery_view v where v.student_id = t.u('B') and v.p is null and v.band is null) = 1,
               'mastery_view: kanıt < 5 ise p ve bant null');
  perform t.ok((select count(*) from public.generated_documents) = 1 and (select count(*) from public.conversations) = 0
               and (select count(*) from public.observations) = 0 and (select count(*) from public.mastery) = 0,
               'veli: yalnız rapor; koç sohbeti, gözlem, ustalık tablosu yok');
  perform t.as_admin();
end $$;

-- iptal: öğrenci ya da velinin kendisi; bağsız kullanıcı iptal edemez
do $$
declare
  v_link uuid;
begin
  select gl.id into v_link from public.guardian_links gl where gl.parent_id = t.u('newp');
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.revoke_guardian_link(%L)$q$, v_link), 'OGR-AUTH-001%', 'başka öğrencinin velisini iptal edemez');
  perform t.as_user(t.u('newp'));
  perform public.revoke_guardian_link(v_link);
  perform t.ok(not exists (select 1 from app.my_children()) and (select count(*) from public.v_parent_child_overview) = 0
               and (select count(*) from public.students) = 0, 'veli bağı iptal edince çocuğu göremez');
  perform t.as_admin();
end $$;

rollback;
