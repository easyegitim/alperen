-- tests/32_guardian_invite.sql — veli daveti v2 (0044): öğrenci davet kodu üretir (yakınlık doğrulaması, bekleyen davet
-- sınırı, süresi dolanların temizlenmesi), veli kodu girer (boşluklar kırpılır; yalnız veli rolü; tek kullanım),
-- öğrenciye 'guardian_linked' bildirimi, list_guardian_links (token/hash yok), yeni velinin veli RPC'leri yalnız o
-- çocuğa açılır, iptal sonrası kapanır ve bildirim yazılamaz.
begin;
\ir _fixture.sql
select t.add_outsiders();

do $$
declare
  v_inv jsonb;
  v_list jsonb;
  v_res jsonb;
  v_new uuid := '00000000-0000-4000-8000-0000000000b8';
  v_tok text;
  i int;
begin
  insert into auth.users (id, email) values (v_new, 'anne@ogrenmen.test');
  insert into public.profiles (id, role, display_name) values (v_new, 'parent', 'Ayla Demir');
  insert into t.cfg values ('mom', v_new::text);

  -- yakınlık ve yetki
  perform t.as_user(t.u('can'));
  perform t.raises(format($q$select public.create_guardian_invite(%L, 'komşu')$q$, t.u('B')), 'OGR-INV-005%', 'yakınlık anne/baba/vasi/diğer');
  v_inv := public.create_guardian_invite(t.u('B'), 'anne');
  v_tok := v_inv ->> 'token';
  perform t.ok(v_inv ->> 'token' ~ '^gi_[a-z2-7]{32}$', 'token biçimi değişmedi');
  perform t.ok(public.create_guardian_invite(t.u('B'), '  ') ? 'link_id', 'boş yakınlık kabul (null)');
  perform t.raises(format($q$select public.create_guardian_invite(%L)$q$, t.u('A')), '42501', 'başka öğrenci için davet yok');
  perform t.as_user(t.u('parent'));
  perform t.raises(format($q$select public.create_guardian_invite(%L)$q$, t.u('A')), '42501', 'veli davet üretemez');

  -- bekleyen davet sınırı (5); süresi dolan temizlenir
  perform t.as_user(t.u('can'));
  for i in 1..3 loop
    perform public.create_guardian_invite(t.u('B'), 'diğer');
  end loop;
  perform t.raises(format($q$select public.create_guardian_invite(%L)$q$, t.u('B')), 'OGR-INV-004%', 'beşten fazla bekleyen davet yok');
  perform t.as_admin();
  update public.guardian_links gl set invite_expires_at = now() - interval '1 hour'
   where gl.id = (select gl2.id from public.guardian_links gl2
                   where gl2.student_id = t.u('B') and gl2.status = 'invited' and gl2.relation = 'diğer' order by gl2.created_at limit 1);
  perform t.as_user(t.u('can'));
  perform t.ok(public.create_guardian_invite(t.u('B')) ? 'token', 'süresi dolan davet temizlenir, yenisi üretilir');
  perform t.as_admin();
  perform t.ok((select count(*) from public.guardian_links gl where gl.student_id = t.u('B') and gl.status = 'invited') = 5,
               'süresi dolmuş satır silindi');

  -- liste: token/hash yok; yalnız öğrenci/owner eğitmen/admin
  perform t.as_user(t.u('can'));
  v_list := public.list_guardian_links(t.u('B'));
  perform t.ok(jsonb_array_length(v_list) = 5 and position('invite_token_hash' in v_list::text) = 0
               and position(v_tok in v_list::text) = 0 and v_list #>> '{0,status}' = 'invited', 'liste: bekleyen davetler, token ve hash yok');
  perform t.as_user(t.u('inst'));
  perform t.ok(jsonb_array_length(public.list_guardian_links(t.u('B'))) = 5, 'owner eğitmen listeyi görür');
  perform t.as_user(t.u('parent'));
  perform t.raises(format($q$select public.list_guardian_links(%L)$q$, t.u('A')), '42501', 'veli bağ listesini göremez');
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.list_guardian_links(%L)$q$, t.u('B')), '42501', 'başka öğrenci listeyi göremez');

  -- kabul: yalnız veli; boşluklar kırpılır; öğrenciye bildirim
  perform t.as_user(t.u('inst'));
  perform t.raises(format($q$select public.accept_guardian_invite(%L)$q$, v_tok), 'OGR-INV-003%', 'eğitmen hesabı kabul edemez');
  perform t.as_user(v_new);
  v_res := public.accept_guardian_invite('  ' || v_tok || ' ');
  perform t.ok(v_res ->> 'student_id' = t.v('B') and v_res ->> 'student_name' = 'Can', 'kabul: öğrenci kimliği ve adı (boşluklar kırpılır)');
  perform t.raises(format($q$select public.accept_guardian_invite(%L)$q$, v_tok), 'OGR-INV-001%', 'tek kullanım');
  perform t.as_admin();
  perform t.ok((select n.title = 'Velin bağlandı'
                       and n.body = 'Ayla Demir artık haftalık özetini ve deneme sonuçlarını görebilir; koç sohbetlerini göremez.'
                       and n.payload ->> 'url' = '/ogrenci/profil'
                  from public.notifications n where n.recipient_id = t.u('can') and n.kind = 'guardian_linked'),
               'öğrenciye guardian_linked: velinin neyi görüp neyi göremeyeceği');
  perform t.ok(not exists (select 1 from public.notifications n where n.kind = 'guardian_linked' and n.recipient_id = v_new),
               'veliye guardian_linked yazılmaz');
  perform t.as_user(t.u('can'));
  v_list := public.list_guardian_links(t.u('B'));
  perform t.ok(v_list #>> '{0,status}' = 'active' and v_list #>> '{0,parent_name}' = 'Ayla Demir' and v_list #>> '{0,relation}' = 'anne',
               'liste: aktif bağ önce, velinin adı');
  perform t.as_admin();
end $$;

-- yeni velinin erişimi yalnız bağlı çocuğa; iptal edilince kapanır
do $$
declare
  v_link uuid;
  v_tok2 text;
begin
  perform t.as_user(t.u('mom'));
  perform t.ok(public.parent_child_summary(t.u('B')) #>> '{student,name}' = 'Can', 'yeni veli çocuğunun özetini okur');
  perform t.raises(format($q$select public.parent_child_summary(%L)$q$, t.u('A')), '42501', 'başka çocuğu okuyamaz');
  perform t.as_service();
  perform t.ok(public.emit_notification(t.u('mom'), 'weekly_summary', jsonb_build_object('student_id', t.u('B'), 'week_start', '2026-11-02')) is not null,
               'aktif veliye çocuk bildirimi yazılır');
  perform t.as_admin();
  select gl.id into v_link from public.guardian_links gl where gl.parent_id = t.u('mom') and gl.student_id = t.u('B');
  perform t.as_user(t.u('can'));
  perform public.revoke_guardian_link(v_link);
  perform t.as_user(t.u('mom'));
  perform t.raises(format($q$select public.parent_child_summary(%L)$q$, t.u('B')), '42501', 'iptal sonrası özet kapalı');
  perform t.raises(format($q$select public.parent_open_conversation(%L)$q$, t.u('B')), '42501', 'iptal sonrası sohbet açılamaz');
  perform t.as_service();
  perform t.raises(format($q$select public.emit_notification(%L, 'weekly_summary', %L)$q$, t.u('mom'),
                          jsonb_build_object('student_id', t.u('B'), 'week_start', '2026-11-09')),
                   'OGR-NOTIF-003%', 'iptal edilmiş veliye çocuk bildirimi yazılamaz');
  perform t.as_admin();
  perform t.ok(not exists (select 1 from jsonb_array_elements(public.notification_targets('weekly_summary')) as x (r)
                            where x.r ->> 'recipient_id' = t.v('mom')), 'iptal edilmiş veli hedef listesinde yok');

  -- aynı veli yeniden davet edilirse eski bağ yeniden active olur (tekil veli–öğrenci bağı)
  perform t.as_user(t.u('can'));
  v_tok2 := public.create_guardian_invite(t.u('B'), 'anne') ->> 'token';
  perform t.as_user(t.u('mom'));
  perform t.ok((public.accept_guardian_invite(v_tok2) ->> 'link_id')::uuid = v_link, 'yeniden kabul: aynı bağ');
  perform t.ok(public.parent_child_summary(t.u('B')) #>> '{student,name}' = 'Can', 'yeniden bağlanınca erişim geri gelir');
  perform t.as_admin();
  perform t.ok((select count(*) from public.notifications n where n.kind = 'guardian_linked' and n.recipient_id = t.u('can')) = 1,
               'aynı bağ için 24 saat içinde ikinci guardian_linked yazılmaz');
end $$;

rollback;
