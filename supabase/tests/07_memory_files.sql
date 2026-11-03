-- tests/07_memory_files.sql — hafıza aracı deposu (upsert_memory_file): işlemler (create, str_replace, insert, compact,
-- delete, rename), sürümler (memory_file_versions, yol başına artan), sınırlar (≤ 12 dosya OGR-MEM-001, ≤ 8 KB
-- OGR-MEM-002), /memories/ izin listesi (OGR-MEM-003), geçersiz işlem (OGR-MEM-004), olmayan dosya (OGR-MEM-005),
-- hedef var (OGR-MEM-006), parent_summary.md yalnız worker (OGR-MEM-007); aktör yalnız worker'dan alınır (kullanıcı
-- oturumunda '<rol>:<uid>'); okuma RLS'i.
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

-- Kullanıcı oturumunda aktör sabitlenir: öğrenci 'worker' diye yazamaz
do $$
begin
  perform t.as_user(t.u('elif'));
  perform public.upsert_memory_file(t.u('A'), '/memories/profile.md', E'# Profil\nSınıf: 12\nHedef: AYT', 'str_replace', 'worker');
  perform t.as_admin();
  perform t.ok((select v.actor from public.memory_file_versions v where v.student_id = t.u('A') and v.path = '/memories/profile.md' and v.version = 4)
               = 'student:' || t.v('elif'), 'öğrenci oturumu: aktör student:<uid> (verilen ''worker'' yok sayılır)');
end $$;

-- Sınırlar ve hatalar
do $$
declare
  v_i int;
begin
  perform t.as_user(t.u('elif'));
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
  perform t.as_user(t.u('elif'));
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/yok.md', 'x', 'str_replace', 'coach')$q$, t.u('A')), 'OGR-MEM-005%',
                   'olmayan dosyada str_replace');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/yok.md', null, 'delete', 'coach')$q$, t.u('A')), 'OGR-MEM-005%', 'olmayan dosyayı silme');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/max.md', null, 'rename', 'coach', '/memories/profile.md')$q$, t.u('A')),
                   'OGR-MEM-006%', 'rename hedefi var');
  perform t.raises(format($q$select public.upsert_memory_file(%L, '/memories/parent_summary.md', 'x', 'create', 'coach')$q$, t.u('A')),
                   'OGR-MEM-007%', 'parent_summary.md öğrenci oturumunda yazılamaz');
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

rollback;
