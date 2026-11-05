-- tests/13_suggestions.sql — koç önerileri (0020): worker replace_suggestions ile yazar (aktifleri değiştirir, başlatılmışlar
-- kalır; aynı payload.copy_key yerinde güncellenir, kimlik korunur), öğrenci list_today_suggestions() ile bugünün ≤ 4
-- başlatılabilir ve ≤ 2 bildirim önerisini rank sırasıyla okur (bildirimler kutuların arkasında kaybolmaz), consume_suggestion ile
-- başlatır (idempotent; süresi dolmuş OGR-SUG-002; başkasının OGR-AUTH-001); RLS (öğrenci kendi, bağlı eğitmen, admin;
-- veli ve başka öğrenci görmez); doğrudan yazım yok; kayıt-öğrenci tutarlılığı (OGR-SUG-003).
begin;
\ir _fixture.sql

-- Worker önerileri yazar
do $$
declare
  v_n int;
begin
  perform t.as_service();
  v_n := public.replace_suggestions(t.u('A'), jsonb_build_array(
    jsonb_build_object('kind', 'practice', 'title', 'İşlem önceliği', 'subtitle', '8 soru · 12 dk', 'rank', 0, 'enrollment_id', t.u('EA'),
                       'payload', jsonb_build_object('skill_ids', jsonb_build_array('t.mat.a'), 'count', 8, 'minutes', 12)),
    jsonb_build_object('kind', 'weekly_homework', 'title', 'Haftalık ödev', 'subtitle', '20 dk', 'rank', 2, 'enrollment_id', t.u('EA')),
    jsonb_build_object('kind', 'gap_analysis', 'title', 'Eksik analizi', 'rank', 1, 'enrollment_id', t.u('EA')),
    jsonb_build_object('kind', 'lesson_review', 'title', 'Ders tekrarı', 'rank', 3, 'enrollment_id', t.u('EA')),
    jsonb_build_object('kind', 'document_ready', 'title', 'Notun hazır', 'rank', 4, 'payload', jsonb_build_object('document_id', gen_random_uuid())),
    jsonb_build_object('kind', 'mini_exam', 'title', 'Süresi geçmiş', 'rank', 0, 'expires_at', now() - interval '1 minute')));
  perform t.ok(v_n = 6, 'replace_suggestions 6 satır yazar');
  perform public.replace_suggestions(t.u('B'), jsonb_build_array(jsonb_build_object('kind', 'practice', 'title', 'Can için', 'enrollment_id', t.u('EB'))));
  perform t.raises(format($q$select public.replace_suggestions(%L, '[{"kind":"yok","title":"x"}]')$q$, t.u('A')), 'OGR-SUG-003%',
                   'geçersiz tür reddedilir');
  perform t.raises(format($q$select public.replace_suggestions(%L, '[{"kind":"practice"}]')$q$, t.u('A')), 'OGR-SUG-003%',
                   'başlıksız öneri reddedilir');
  perform t.raises(format($q$select public.replace_suggestions(%L, jsonb_build_array(jsonb_build_object('kind', 'practice', 'title', 'x', 'enrollment_id', %L)))$q$,
                          t.u('A'), t.u('EB')), 'OGR-SUG-003%', 'başka öğrencinin kaydına öneri yazılamaz');
  perform t.raises(format($q$select public.replace_suggestions(%L, '{}')$q$, t.u('A')), 'OGR-SUG-003%', 'p_items dizi olmalı');
  perform t.as_admin();
  perform t.ok((select count(*) from public.suggestions s where s.student_id = t.u('A')) = 6, 'hatalı çağrılar mevcut önerileri silmez');
end $$;

-- Öğrenci bugünün önerilerini okur ve başlatır
do $$
declare
  v_ids uuid[];
  v_kinds text;
  v_r jsonb;
  v_r2 jsonb;
begin
  perform t.as_user(t.u('elif'));
  select string_agg(x.kind, ',' order by x.rank, x.created_at), array_agg(x.id order by x.rank, x.created_at) into v_kinds, v_ids
    from public.list_today_suggestions() as x;
  perform t.ok(v_kinds = 'practice,gap_analysis,weekly_homework,lesson_review,document_ready',
               'bugünün önerileri: 4 başlatılabilir + bildirim (4 kutu doluyken de görünür), rank sırası, süresi dolmuş yok ('
               || coalesce(v_kinds, '-') || ')');
  perform t.ok((select x.payload -> 'skill_ids' from public.list_today_suggestions() as x where x.kind = 'practice') = '["t.mat.a"]'::jsonb
               and (select x.subtitle from public.list_today_suggestions() as x where x.kind = 'practice') = '8 soru · 12 dk',
               'kart verisi: alt satır ve payload');
  perform t.ok(t.n('select 1 from public.suggestions') = 6, 'öğrenci tablodan kendi 6 önerisini görür (süresi dolmuş dahil)');
  v_r := public.consume_suggestion(v_ids[1]);
  v_r2 := public.consume_suggestion(v_ids[1]);
  perform t.ok(v_r ->> 'kind' = 'practice' and v_r ->> 'consumed_at' is not null and v_r = v_r2
               and v_r ->> 'enrollment_id' = t.v('EA'), 'consume_suggestion işaretler; ikinci çağrı aynı sonucu döner');
  perform t.ok((select string_agg(x.kind, ',' order by x.rank) from public.list_today_suggestions() as x)
               = 'gap_analysis,weekly_homework,lesson_review,document_ready', 'başlatılan öneri listeden çıkar, sıradaki girer');
  perform t.raises(format($q$select public.consume_suggestion(%L)$q$,
                          (select s.id from public.suggestions s where s.title = 'Süresi geçmiş')), 'OGR-SUG-002%', 'süresi dolmuş öneri başlatılamaz');
  perform t.raises($q$select public.consume_suggestion(gen_random_uuid())$q$, 'OGR-SUG-001%', 'olmayan öneri');
  perform t.raises($q$insert into public.suggestions (student_id, kind, title) values (app.my_student_id(), 'practice', 'kendime')$q$, '42501',
                   'öğrenci tabloya doğrudan yazamaz');
  perform t.raises($q$update public.suggestions set rank = 0$q$, '42501', 'öğrenci öneriyi doğrudan değiştiremez');
  perform t.raises(format($q$select public.replace_suggestions(%L, '[]')$q$, t.u('A')), 'OGR-AUTH-002%', 'öğrenci replace_suggestions çağıramaz');
  perform t.raises(format($q$select * from public.list_today_suggestions(%L)$q$, t.u('B')), 'OGR-AUTH-001%', 'öğrenci başkasının önerilerini okuyamaz');
  perform t.as_admin();
end $$;

-- Yetki ve RLS: başka öğrenci, veli, eğitmen, admin
do $$
declare
  v_can_sug uuid := (select s.id from public.suggestions s where s.student_id = t.u('B') limit 1);
begin
  perform t.ok(t.sees(t.u('can'), 'select 1 from public.suggestions') = 1, 'Can yalnız kendi önerisini görür');
  perform t.ok(t.sees(t.u('parent'), 'select 1 from public.suggestions') = 0, 'veli önerileri görmez');
  perform t.ok(t.sees(t.u('inst'), 'select 1 from public.suggestions') = 7, 'bağlı eğitmen öğrencilerinin önerilerini görür');
  perform t.ok(t.sees(t.u('admin'), 'select 1 from public.suggestions') = 7, 'admin hepsini görür');
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.consume_suggestion(%L)$q$, v_can_sug), 'OGR-AUTH-001%', 'başkasının önerisi başlatılamaz');
  perform t.as_user(t.u('parent'));
  perform t.raises('select * from public.list_today_suggestions()', 'OGR-AUTH-001%', 'veli kendi önerisi yok: OGR-AUTH-001');
  perform t.raises(format($q$select * from public.list_today_suggestions(%L)$q$, t.u('A')), 'OGR-AUTH-001%', 'veli çocuğunun önerilerini okuyamaz');
  perform t.as_user(t.u('inst'));
  perform t.ok((select count(*) from public.list_today_suggestions(t.u('A'))) = 4, 'bağlı eğitmen p_student ile okur (3 kutu + 1 bildirim)');
  perform t.raises(format($q$select public.consume_suggestion(%L)$q$, v_can_sug), 'OGR-AUTH-001%', 'eğitmen öğrencinin önerisini başlatmaz');
  perform t.as_service();
  perform t.ok((select count(*) from public.list_today_suggestions(t.u('B'))) = 1, 'worker p_student ile okur');
  perform t.as_admin();
end $$;

-- Yenileme: aktifler değişir, başlatılmışlar geçmiş olarak kalır; ayar settings.suggestions_today_max
do $$
begin
  perform t.as_service();
  perform t.ok(public.replace_suggestions(t.u('A'), jsonb_build_array(
                 jsonb_build_object('kind', 'practice', 'title', 'Yeni öneri', 'enrollment_id', t.u('EA')),
                 jsonb_build_object('kind', 'upload_result', 'title', 'Yüklemen incelendi', 'payload', jsonb_build_object('upload_id', gen_random_uuid())))) = 2,
               'yenileme 2 yeni öneri yazar');
  perform t.as_admin();
  perform t.ok((select count(*) from public.suggestions s where s.student_id = t.u('A')) = 3
               and (select count(*) from public.suggestions s where s.student_id = t.u('A') and s.consumed_at is not null) = 1,
               'başlatılmış öneri kalır, eski aktifler silinir');
  perform t.ok((select string_agg(s.rank::text, ',' order by s.rank) from public.suggestions s where s.student_id = t.u('A') and s.consumed_at is null) = '101,102',
               'rank verilmezse 100 + sıra');
  perform public.replace_suggestions(t.u('A'), jsonb_build_array(
    jsonb_build_object('kind', 'practice', 'title', 'Bir', 'enrollment_id', t.u('EA')),
    jsonb_build_object('kind', 'practice', 'title', 'İki', 'enrollment_id', t.u('EA')),
    jsonb_build_object('kind', 'upload_result', 'title', 'Yükleme 1', 'payload', jsonb_build_object('upload_id', gen_random_uuid())),
    jsonb_build_object('kind', 'document_ready', 'title', 'Not 1', 'payload', jsonb_build_object('document_id', gen_random_uuid())),
    jsonb_build_object('kind', 'document_ready', 'title', 'Not 2', 'payload', jsonb_build_object('document_id', gen_random_uuid()))));
  update public.settings st set value = '1'::jsonb where st.key = 'suggestions_today_max';
  perform t.as_user(t.u('elif'));
  perform t.ok((select count(*) from public.list_today_suggestions() as x where x.kind = 'practice') = 1
               and (select count(*) from public.list_today_suggestions() as x where x.kind in ('upload_result', 'document_ready')) = 2,
               'settings.suggestions_today_max başlatılabilir kartlara, bildirimler en çok 2 (suggestions_notices_max)');
  perform t.as_admin();
end $$;

-- Yerinde güncelleme: aynı copy_key kimliği korur (önceden çizilmiş Bugün sayfasının "Başla"sı çalışır)
do $$
declare
  v_id uuid;
  v_n int;
begin
  perform t.as_service();
  perform public.replace_suggestions(t.u('B'), jsonb_build_array(
    jsonb_build_object('kind', 'practice', 'title', 'Eski metin', 'rank', 0, 'enrollment_id', t.u('EB'),
                       'payload', jsonb_build_object('copy_key', 'practice:k1', 'count', 8)),
    jsonb_build_object('kind', 'gap_analysis', 'title', 'Gidecek', 'rank', 1, 'enrollment_id', t.u('EB'),
                       'payload', jsonb_build_object('copy_key', 'gap:k2'))));
  v_id := (select s.id from public.suggestions s where s.student_id = t.u('B') and s.payload ->> 'copy_key' = 'practice:k1');
  v_n := public.replace_suggestions(t.u('B'), jsonb_build_array(
    jsonb_build_object('kind', 'lesson_review', 'title', 'Yeni kart', 'rank', 0, 'enrollment_id', t.u('EB'),
                       'payload', jsonb_build_object('copy_key', 'lesson:k3')),
    jsonb_build_object('kind', 'practice', 'title', 'Yeni metin', 'rank', 1, 'enrollment_id', t.u('EB'),
                       'payload', jsonb_build_object('copy_key', 'practice:k1', 'count', 10))));
  perform t.ok(v_n = 2, 'yerinde güncelleme + ekleme: 2 satır yazıldı');
  perform t.ok((select s.title || '|' || s.rank || '|' || (s.payload ->> 'count') from public.suggestions s where s.id = v_id) = 'Yeni metin|1|10',
               'aynı copy_key: kimlik kalır, metin, sıra ve payload yenilenir');
  perform t.ok((select count(*) from public.suggestions s where s.student_id = t.u('B') and s.consumed_at is null) = 2
               and not exists (select 1 from public.suggestions s where s.student_id = t.u('B') and s.payload ->> 'copy_key' = 'gap:k2'),
               'yeni listede olmayan aktif kart silinir');
  perform t.as_user(t.u('can'));
  perform t.ok((public.consume_suggestion(v_id) ->> 'kind') = 'practice', 'yenilemeden önceki kimlikle başlatılır (OGR-SUG-001 yok)');
  perform t.as_admin();
end $$;

rollback;
