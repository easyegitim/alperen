-- tests/07_memory_files.sql — hafıza aracı deposu (upsert_memory_file): işlemler (create, str_replace, insert, compact,
-- delete, rename), sürümler (memory_file_versions, yol başına artan), sınırlar (≤ 12 dosya OGR-MEM-001, ≤ 8 KB
-- OGR-MEM-002), /memories/ izin listesi (OGR-MEM-003), geçersiz işlem (OGR-MEM-004), olmayan dosya (OGR-MEM-005),
-- hedef var (OGR-MEM-006), parent_summary.md yalnız worker (OGR-MEM-007); aktör yalnız worker'dan alınır (kullanıcı
-- oturumunda '<rol>:<uid>'); okuma RLS'i. 0023: yazarlar yalnız worker, owner eğitmen ve admin — öğrenci ve veli
-- OGR-AUTH-001; öğrenci request_memory_correction ile düzeltme ister (memory_corrections, OGR-MEM-008/009), koç ya da
-- eğitmen resolve_memory_correction ile kapatır (OGR-MEM-010).
begin;
\ir _fixture.sql

do $$
declare
  v_r jsonb;
begin
  perform t.as_service();   -- worker'ın hafıza aracı (packages/llm memory) bağlamı
  v_r := public.upsert_memory_file(t.u('A'), '/memories/profile.md', E'# Profil\nSınıf: 11', 'create', 'coach');
  perform t.ok(v_r ->> 'version' = '1' and (v_r ->> 'bytes')::int = octet_length(E'# Profil\nSınıf: 11'), 'create: sürüm 1, bayt (UTF-8)');
  v_r := public.upsert_memory_file(t.u('A'), '/memories/profile.md', E'# Profil\nSınıf: 11\nHedef: TYT', 'insert', 'coach');
  v_r := public.upsert_memory_file(t.u('A'), '/memories/profile.md', E'# Profil\nSınıf: 12\nHedef: TYT', 'str_replace', 'memory-delta');
  perform t.ok(v_r ->> 'version' = '3', 'insert ve str_replace sürümü artırır (3)');
  v_r := public.upsert_memory_file(t.u('A'), '/memories/patterns.md', '- 3× eksi dağıtırken işaret (12/19/27 Eki)', 'create', 'coach');
  v_r := public.upsert_memory_file(t.u('A'), '/memories/patterns.md', '- işaret hatası (3×)', 'compact', 'nightly');
  perform t.ok(v_r ->> 'version' = '2' and v_r ->> 'op' = 'compact', 'compact sürüm yazar');
  v_r := public.upsert_memory_file(t.u('A'), '/memories/courses/T-MAT.md', 'Ders durumu', 'create', 'coach');
  v_r := public.upsert_memory_file(t.u('A'), '/memories/courses/T-MAT.md', null, 'rename', 'coach', '/memories/courses/TMAT-2027.md');
  perform t.ok(v_r ->> 'path' = '/memories/courses/TMAT-2027.md' and v_r ->> 'from_path' = '/memories/courses/T-MAT.md' and v_r ->> 'version' = '1',
               'rename: yeni yolda sürüm 1, eski yol yanıtta');
  v_r := public.upsert_memory_file(t.u('A'), '/memories/goals.md', 'Hedef', 'create', 'coach');
  v_r := public.upsert_memory_file(t.u('A'), '/memories/goals.md', null, 'delete', 'student');
  perform t.as_admin();
  perform t.ok((select mf.content from public.memory_files mf where mf.student_id = t.u('A') and mf.path = '/memories/profile.md') = E'# Profil\nSınıf: 12\nHedef: TYT',
               'son içerik yazıldı');
  perform t.ok(not exists (select 1 from public.memory_files mf where mf.student_id = t.u('A') and mf.path in ('/memories/goals.md', '/memories/courses/T-MAT.md'))
               and exists (select 1 from public.memory_files mf where mf.student_id = t.u('A') and mf.path = '/memories/courses/TMAT-2027.md'),
               'delete ve rename tabloya yansıdı');
  perform t.ok((select string_agg(v.op || ':' || v.version || ':' || v.actor, ',' order by v.version) from public.memory_file_versions v
                 where v.student_id = t.u('A') and v.path = '/memories/profile.md') = 'create:1:coach,insert:2:coach,str_replace:3:memory-delta',
               'sürüm geçmişi (işlem, sürüm, aktör)');
  perform t.ok((select v.content is null from public.memory_file_versions v where v.student_id = t.u('A') and v.path = '/memories/goals.md' and v.op = 'delete'),
               'delete sürümü içeriksiz');
end $$;

-- Öğrenci ve veli hafıza dosyası yazamaz (0023); owner eğitmen yazar ve aktörü sabitlenir: 'worker' diye yazamaz
do $$
begin
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/profile.md', 'Sınıf: 12', 'str_replace', 'worker')$q$, t.u('A')),
                   '42501', 'öğrenci kendi hafıza dosyasını yazamaz (OGR-AUTH-001; düzeltme ister)');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/yeni.md', 'x', 'create', 'coach')$q$, t.u('A')),
                   'OGR-AUTH-001%', 'öğrenci yeni hafıza dosyası da açamaz');
  perform t.as_user(t.u('parent'));
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/profile.md', 'x', 'str_replace', 'coach')$q$, t.u('A')),
                   'OGR-AUTH-001%', 'veli hafıza dosyası yazamaz');
  perform t.as_user(t.u('inst'));
  perform public.upsert_memory_file(t.u('A'), '/memories/profile.md', E'# Profil\nSınıf: 12\nHedef: AYT', 'str_replace', 'worker');
  perform t.as_admin();
  perform t.ok((select v.actor from public.memory_file_versions v where v.student_id = t.u('A') and v.path = '/memories/profile.md' and v.version = 4)
               = 'instructor:' || t.v('inst'), 'owner eğitmen yazar; aktör instructor:<uid> (verilen ''worker'' yok sayılır)');
end $$;

-- Sınırlar ve hatalar (owner eğitmen oturumu: kullanıcı oturumunun yol/sınır denetimleri)
do $$
declare
  v_i int;
begin
  perform t.as_user(t.u('inst'));
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/big.md', repeat('ç', 4097), 'create', 'coach')$q$, t.u('A')),
                   'OGR-MEM-002%', '8 KB üstü (UTF-8 bayt) reddedilir');
  perform t.ok((public.upsert_memory_file(t.u('A'), '/memories/max.md', repeat('a', 8192), 'create', 'coach') ->> 'bytes')::int = 8192,
               'tam 8192 bayt kabul edilir');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/etc/passwd', 'x', 'create', 'coach')$q$, t.u('A')), 'OGR-MEM-003%', '/memories/ dışı yol');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/../x.md', 'x', 'create', 'coach')$q$, t.u('A')), 'OGR-MEM-003%', '.. içeren yol');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/a/b/c/d.md', 'x', 'create', 'coach')$q$, t.u('A')), 'OGR-MEM-003%', '3 düzeyden derin');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/x.exe', 'x', 'create', 'coach')$q$, t.u('A')), 'OGR-MEM-003%', 'izin verilmeyen uzantı');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/x.md', 'x', 'view', 'coach')$q$, t.u('A')), 'OGR-MEM-004%', 'geçersiz işlem');
  perform t.as_service();
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/x.md', 'x', 'create', '')$q$, t.u('A')), 'OGR-MEM-004%', 'aktör gerekli (worker)');
  perform t.as_user(t.u('inst'));
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/yok.md', 'x', 'str_replace', 'coach')$q$, t.u('A')), 'OGR-MEM-005%',
                   'olmayan dosyada str_replace');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/yok.md', null, 'delete', 'coach')$q$, t.u('A')), 'OGR-MEM-005%', 'olmayan dosyayı silme');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/max.md', null, 'rename', 'coach', '/memories/profile.md')$q$, t.u('A')),
                   'OGR-MEM-006%', 'rename hedefi var');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/parent_summary.md', 'x', 'create', 'coach')$q$, t.u('A')),
                   'OGR-MEM-007%', 'parent_summary.md kullanıcı (eğitmen) oturumunda yazılamaz');
  -- 4 dosya var (profile, patterns, TMAT-2027, max) + 8 = 12; 13. reddedilir
  for v_i in 1..8 loop
    perform public.upsert_memory_file(t.u('A'), '/memories/n' || v_i || '.md', 'not', 'create', 'coach');
  end loop;
  perform t.ok((select count(*) from public.memory_files mf where mf.student_id = t.u('A')) = 12, '12 dosya');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/n13.md', 'x', 'create', 'coach')$q$, t.u('A')),
                   'OGR-MEM-001%', '13. dosya reddedilir');
  perform t.ok((public.upsert_memory_file(t.u('A'), '/memories/n1.md', 'güncel', 'create', 'coach') ->> 'version')::int = 2,
               '12 dosyadayken var olan dosyanın üzerine yazılır (create = üzerine yaz)');
  perform t.as_service();
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/parent_summary.md', 'Bu hafta düzenli.', 'create', 'nightly')$q$, t.u('A')),
                   'OGR-MEM-001%', 'worker da dosya sınırına tabidir');
  perform public.upsert_memory_file(t.u('A'), '/memories/n8.md', null, 'delete', 'nightly');
  perform t.ok((public.upsert_memory_file(t.u('A'), '/memories/parent_summary.md', 'Bu hafta düzenli.', 'create', 'nightly') ->> 'version')::int = 1,
               'worker parent_summary.md yazar');
  perform t.as_admin();
end $$;

-- Okuma RLS'i: öğrenci kendi dosyaları + sürümleri; veli yalnız parent_summary.md; eğitmen hepsi; başka öğrenci hiçbiri
do $$
begin
  perform t.ok(t.sees(t.u('elif'), 'select 1 from public.memory_files') = 12, 'öğrenci kendi dosyalarını görür');
  perform t.ok(t.sees(t.u('parent'), 'select 1 from public.memory_files') = 1
               and t.sees(t.u('parent'), $q$select 1 from public.memory_files where path = '/memories/parent_summary.md'$q$) = 1
               and t.sees(t.u('parent'), 'select 1 from public.memory_file_versions') = 0, 'veli yalnız parent_summary.md''yi görür');
  perform t.ok(t.sees(t.u('inst'), 'select 1 from public.memory_files') = 12, 'bağlı eğitmen dosyaları görür');
  perform t.ok(t.sees(t.u('can'), 'select 1 from public.memory_files') = 0 and t.sees(t.u('can'), 'select 1 from public.memory_file_versions') = 0,
               'başka öğrenci dosyaları göremez');
  perform t.as_user(t.u('elif'));
  perform t.raises($q$insert into public.memory_files (student_id, path, content) values (app.my_student_id(), '/memories/z.md', 'x')$q$, '42501',
                   'tabloya doğrudan yazım yok (yalnız RPC)');
  perform t.as_admin();
end $$;

-- Düzeltme istekleri: öğrenci ister, koç (worker) ya da owner eğitmen kapatır
do $$
declare
  v_r jsonb;
  v_id uuid;
  v_i int;
begin
  perform t.as_user(t.u('elif'));
  v_r := public.request_memory_correction('/memories/profile.md', '  Artık 12. sınıftayım, hedefim AYT.  ');
  v_id := (v_r ->> 'id')::uuid;
  perform t.ok(v_r ->> 'status' = 'open' and v_r ->> 'path' = '/memories/profile.md', 'request_memory_correction: open satır döner');
  perform t.ok(t.n('select 1 from public.memory_corrections') = 1, 'öğrenci kendi düzeltme isteğini görür');
  perform public.request_memory_correction('/memories/goals.md', 'Hedefim TYT matematikte 30 net.');
  perform t.raises($q$select public.request_memory_correction('/etc/passwd', 'x')$q$, 'OGR-MEM-003%', 'izin listesi dışı yol');
  perform t.raises($q$select public.request_memory_correction('/memories/profile.md', '   ')$q$, 'OGR-MEM-008%', 'boş metin');
  perform t.raises($q$select public.request_memory_correction('/memories/profile.md', repeat('a', 1001))$q$, 'OGR-MEM-008%', '1000 karakter üstü');
  perform t.raises(format($q$select public.resolve_memory_correction(%L, true)$q$, v_id), 'OGR-AUTH-001%', 'öğrenci kendi isteğini kapatamaz');
  perform t.raises($q$insert into public.memory_corrections (student_id, path, text) values (app.my_student_id(), '/memories/x.md', 'x')$q$, '42501',
                   'memory_corrections tablosuna doğrudan yazım yok');
  for v_i in 3..20 loop
    perform public.request_memory_correction('/memories/n' || v_i || '.md', 'not ' || v_i);
  end loop;
  perform t.raises($q$select public.request_memory_correction('/memories/profile.md', 'bir tane daha')$q$, 'OGR-MEM-009%', 'en çok 20 açık istek');
  perform t.as_user(t.u('parent'));
  perform t.raises($q$select public.request_memory_correction('/memories/profile.md', 'x')$q$, '42501', 'veli düzeltme isteyemez');
  perform t.ok(t.n('select 1 from public.memory_corrections') = 0, 'veli düzeltme isteklerini görmez');
  perform t.as_user(t.u('can'));
  perform t.ok(t.n('select 1 from public.memory_corrections') = 0, 'başka öğrenci düzeltme isteklerini görmez');
  perform t.as_admin();
  perform t.ok((select mc.text from public.memory_corrections mc where mc.id = v_id) = 'Artık 12. sınıftayım, hedefim AYT.'
               and (select mc.requested_by from public.memory_corrections mc where mc.id = v_id) = t.u('elif'),
               'metin kırpılmış, isteyen kaydedildi');
  perform t.ok((select count(*) from audit.events e where e.action = 'job.enqueue_skipped' and e.diff ->> 'name' = 'memory.correction') >= 1,
               'memory.correction işi denenir (pgboss yokken audit)');

  perform t.as_service();
  v_r := public.resolve_memory_correction(v_id, true, 'profil güncellendi');
  perform t.ok(v_r ->> 'status' = 'applied' and v_r ->> 'resolved_by' = 'coach', 'worker (koç) isteği applied kapatır');
  perform t.raises(format($q$select public.resolve_memory_correction(%L, false)$q$, v_id), 'OGR-MEM-010%', 'kapalı istek yeniden kapatılamaz');
  perform t.as_user(t.u('inst'));
  v_r := public.resolve_memory_correction((select mc.id from public.memory_corrections mc where mc.path = '/memories/goals.md'), false, 'zaten doğru');
  perform t.ok(v_r ->> 'status' = 'rejected' and v_r ->> 'resolved_by' = 'instructor:' || t.v('inst'), 'owner eğitmen reddeder');
  perform t.as_user(t.u('elif'));
  perform t.ok((select mc.resolution_note from public.memory_corrections mc where mc.id = v_id) = 'profil güncellendi',
               'öğrenci koçun notunu görür');
  perform t.as_admin();
end $$;

-- Koşullu yazım (p_expected_hash, 0023): okunduğu andaki md5 tutmazsa OGR-MEM-028, tutarsa yazar
do $$
declare
  v_old text;
begin
  perform t.as_service();
  perform public.upsert_memory_file(t.u('B'), '/memories/cas.md', 'ilk', 'create', 'coach');
  v_old := md5('ilk');
  perform public.upsert_memory_file(t.u('B'), '/memories/cas.md', 'ikinci yazıcı', 'str_replace', 'memory-delta');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/cas.md', 'bayat düzenleme', 'str_replace', 'coach', null, %L)$q$,
                          t.u('B'), v_old), 'OGR-MEM-028%', 'okunduktan sonra değişen dosyaya koşullu yazım reddedilir');
  perform t.ok((select mf.content from public.memory_files mf where mf.student_id = t.u('B') and mf.path = '/memories/cas.md') = 'ikinci yazıcı',
               'eşzamanlı yazıcının düzenlemesi korunur');
  perform public.upsert_memory_file(t.u('B'), '/memories/cas.md', 'güncel düzenleme', 'str_replace', 'coach', null, md5('ikinci yazıcı'));
  perform t.ok((select mf.content from public.memory_files mf where mf.student_id = t.u('B') and mf.path = '/memories/cas.md') = 'güncel düzenleme',
               'hash tutunca yazar');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/yok-cas.md', 'x', 'create', 'coach', null, %L)$q$, t.u('B'), md5('x')),
                   'OGR-MEM-028%', 'dosya yokken beklenen hash verilirse reddedilir');
  perform t.as_admin();
end $$;

rollback;
