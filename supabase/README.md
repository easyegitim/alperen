# supabase/ — Öğrenmen veritabanı (M02)

Postgres 15+ (Supabase) şeması: migration'lar `0001`–`0018`, seed'ler, düz SQL testleri, statik denetim ve yardımcı
betikler. Kaynak: `docs/BLUEPRINT.md` §3 (veri modeli, RLS matrisi, RPC'ler, saklama), §2.4, §9.1. Tablo/sütun/RPC adları
blueprint'teki adlardır; her tablo ve sütun `comment on` ile Türkçe açıklanır.

## Dizin

| Yol | İçerik |
| --- | --- |
| `migrations/0001_extensions.sql` … `0018_pilot_metrics_grants.sql` | şemalar ve roller (0002), kimlik (0003), müfredat (0004), Gözlük (0005), Tablet (0006), Kulaklık (0007), Ders (0008), Kalem (0009), Kitap (0010), BKT + `apply_observation` (0011), RPC'ler (0012), görünümler (0013), tablo okuyan yardımcılar + RLS + GRANT matrisi (0014), denetim ve saklama (0015), pg_cron (0016), Storage (0017), `batch_worker` → `pilot_metrics` okuma yetkisi ve SELECT politikası (0018) |
| `seed/00_roles.sql` | yalnız yerel/test: uygulama rolleri ve test personeli (`coord`, `inst_a`, `inst_b`, `obs`) |
| `seed/01_settings.sql` … `04_retention_policies.sql` | sabitler (`default_period`, `pilot_gate`), kota, çalışma bayrakları (`cap_excluded_purposes`, `lesson_monthly_cap_usd`), saklama politikaları (`mode='custom'` + `handler`) |
| `seed/dev/*.sql` | geliştirme dünyası; `scripts/gen-dev-seed.py` `fixtures/db/dev-seed.json`'dan üretir (elle düzenlenmez) |
| `tests/00_local_stub.sql` | yerel Postgres'te `auth` şeması, `auth.uid()/jwt()`, Supabase rolleri, `extensions` şeması (yalnız yoksa), halfvec yedeği, süper kullanıcı olmayan migration sahibi `ogrenmen_owner` |
| `tests/01…12_*.sql` | canlı SQL testleri (her dosya `begin … rollback`; `_fixture.sql` ortak dünya ve yardımcılar) |
| `tests/grants_matrix.json` | tablo × rol × yetki matrisi (§3.8'in makine-okur hâli; statik ve canlı denetimin ortak kaynağı) |
| `scripts/check_sql.py` | pglast ile statik denetim (aşağıda) |
| `scripts/lint.sh` | sqlfluff + yorum blokları + dev seed eşitliği + BKT/PII kopyaları + denetleyici testleri |
| `scripts/db-test.sh` | canlı DB'de migration + seed + testler; DB yoksa `SKIP: no database` |
| `scripts/mint-jwt.ts` | `bot_runtime` / `batch_worker` JWT'si (HS256) — yalnız kurucu makinesinde |
| `scripts/size-report.sql` | depolama bütçesi raporu (500 MB) |
| `scripts/backup-public.sh` | `pg_dump` (public + audit, `messages` ve `secure` hariç; `--secure` ayrı) → `age` ile şifreli |
| `scripts/sync_comments.py` | `create table` satır içi yorumlarından `comment on` bloklarını üretir |
| `scripts/no-policy-allowlist.json` | RLS açık ama bilerek politikasız tablolar (`tg_updates`, `secure.*`, `audit.events`) |

## Hesapsız denetim (DB gerekmez)

```
python -m pip install sqlfluff pglast
bash /home/user/alperen/supabase/scripts/lint.sh
python /home/user/alperen/supabase/scripts/check_sql.py /home/user/alperen/supabase/migrations --grants-matrix /home/user/alperen/supabase/tests/grants_matrix.json
```

`check_sql.py` migration kümesinin **bütününde** çalışır ve şu kodlarla hata verir:

| Kod | Denetim |
| --- | --- |
| `OGR-LINT-RLS` | her `public/secure/audit` tablosu için kümenin bir dosyasında `ENABLE` **ve** `FORCE ROW LEVEL SECURITY` |
| `OGR-LINT-POLICY` | ≥ 1 `CREATE POLICY` ya da `no-policy-allowlist.json` (bayat liste de hata) |
| `OGR-LINT-SECURE` | `secure.*`/`audit.*` nesnesine (şema dahil) uygulama rolüne GRANT (dosya başına) |
| `OGR-LINT-GRANTALL` | `GRANT ALL` yasak |
| `OGR-LINT-BASELINE` | `0002`'de `ALTER DEFAULT PRIVILEGES … REVOKE` ve `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated` |
| `OGR-LINT-SEARCHPATH` | `SECURITY DEFINER` fonksiyonda `SET search_path` |
| `OGR-LINT-GENERATED` | `generated always as` içinde `now()`/`current_date` vb. |
| `OGR-LINT-ORDER` | `language sql` gövdesindeki `şema.tablo` daha sonraki bir migration'da yaratılıyor |
| `OGR-LINT-VARCONFLICT` | plpgsql: `v_` öneksiz yerel değişken, `p_` öneksiz parametre, değişken/dönüş sütunu adıyla aynı tablo sütununa takma adsız başvuru |
| `OGR-LINT-COMMENT` | tablo/sütun `comment on` açıklaması eksik |
| `OGR-LINT-MATRIX` | migration GRANT'leri (sırayla uygulanmış GRANT/REVOKE) `grants_matrix.json` ile birebir değil; PUBLIC'e EXECUTE |

Denetleyicinin kendisi `scripts/tests/test_check_sql.py` ile sınanır (her kod için bilinçli hatalı kopya).
`--dump-grants` migration'lardan hesaplanan matrisi yazar (matrisi elle güncellerken karşılaştırmak için).

### Lint kuralları

`supabase/.sqlfluff`: postgres lehçesi, `large_file_skip_byte_limit = 0` (büyük migration'lar da denetlenir). Kapsam dışı
kurallar: `RF04` (blueprint'in bağlayıcı sütun adları `text`, `kind`, `day`, `role` … anahtar kelimedir), girinti/hizalama
üslubu (`LT02`, `LT05`, `LT08`, `LT09`, `LT14`) ve plpgsql/görünüm gövdelerindeki kısa takma ad ve birleşim sırası
(`AL03`, `AM05`, `RF02`, `RF03`, `ST06`, `ST09`). Ayrıştırma hataları ve kalan çekirdek kurallar uygulanır; rol üyeliği
`grant x to y` ifadesi sqlfluff'ta ayrıştırılamadığı için o iki satırda `-- noqa: PRS` vardır.

## Canlı test

```
OGRENMEN_DATABASE_URL=postgresql://kullanici:parola@127.0.0.1:5432/postgres bash /home/user/alperen/supabase/scripts/db-test.sh
```

- Bağlanılan veritabanına dokunmaz: aynı sunucuda `OGRENMEN_TEST_DB` (varsayılan `ogrenmen_test`) açılır, sonunda silinir
  (`--keep` bırakır). Bağlanan rolün süper kullanıcı olması gerekir (stub rol ve sahiplik kurar); rol oluşturma
  (`bot_runtime`, `batch_worker`, `ogrenmen_owner`, yerel stub'ta `anon/authenticated/service_role/authenticator`) küme düzeyindedir.
- **Supabase ayrıcalık modeli**: `tests/00_local_stub.sql` bağlanan süper kullanıcıyla çalışır ve süper kullanıcı OLMAYAN
  `ogrenmen_owner` rolünü (Supabase `postgres`inin eşleniği: `BYPASSRLS`, `CREATEROLE`, `CREATEDB`, Supabase rollerinde
  `ADMIN`, test veritabanının ve `extensions` şemasının sahibi, `auth.users` üzerinde yetkili) kurar. Migration, seed,
  müfredat seed'i, `seed-keys.py` ve `seed/dev` adımları `PGOPTIONS='-c role=ogrenmen_owner'` ile bu rolle çalışır; böylece
  `SECURITY DEFINER` fonksiyonlar ve `security_invoker=false` görünümler (`questions_public`, `v_messages_staff`,
  `v_exam_items_full`) süper kullanıcıya değil bu role aittir ve FORCE RLS / sahiplik / yetki davranışı Supabase'deki gibi
  sınanır. `09` sahipliği denetler: definer fonksiyonların tek sahibi var, sahip süper kullanıcı değil ve `BYPASSRLS`;
  tablo ve görünümler aynı sahipte. Testlerdeki `t.as_admin()` bağlanan kullanıcıya döner (Supabase'deki service/SQL editörü).
- Sıra: `tests/00_local_stub.sql` → `migrations/*.sql` (her dosya tek işlem) → `seed/0*.sql` → müfredat seed'i
  (`content/tyt-matematik/scripts/export-sql.py --out <geçici>`; betik yoksa `SKIP: no content`) → cevap anahtarları
  (`seed-keys.py --database-url`; yoksa `SKIP: no keys`, `have_keys=0`) → **`seed/dev/*.sql`** (§2.4: Worker `FakeDb` ve
  panel `mock` ile aynı dünya; `fixtures/db/dev-seed.json` satır sayılarıyla karşılaştırılır) → `tests/01…12`
  (`psql -v ON_ERROR_STOP=1`). `export-sql.py --as-version 2027.1` çıktısı `begin/commit`'siz hâliyle 01'e `seed2`
  değişkeni olarak verilir. Testler dev dünyasının satırlarına güvenmez; kendi fikstür satırlarıyla sınırlı sayar.
- Ardından ayrı bir veritabanında (`…_dev`) içerik seed'i OLMADAN migration + seed üstüne `seed/dev/*.sql` yüklenir
  (`--dev` dünyası kendi müfredatını, sorularını ve anahtarlarını taşır; tek başına da yüklenebilmeli).
- `--dev`: yalnız geliştirme veritabanını hazırlar ve bırakır (testleri koşmaz).
- `OGRENMEN_CONTENT_SCRIPTS=<dizin>` içerik betiklerinin yerini değiştirir (yalnız sınama: var olmayan dizinle M03'süz yol —
  `SKIP: no content` / `SKIP: no keys` ve fikstürün asgari müfredatı — denenir).
- Çıktıda her denetim `OK: …`; başarısızlık `FAIL: …` ve çıkış 1.

Testler (özet): `01` şema/RLS kapsamı, `resolve_telegram` ilk temas + ad hash'leri + `OGR-ENR-001`, bağlı eğitmen
`chat_roles`, `pii` hash vakaları (bayt eşitliği), iki müfredat sürümü aynı kazanım kimliği, 'two ops alerts for two chats',
grup otomatik yanıt, proaktif mesaj; `02` gözlemci `text_raw`/`ocr_text` reddi ve görünümler, panel RPC'leri bot/batch
rolünde (yetki ve gövde: `OGR-AUTH-002`), tek yönlü kill-switch, bot `courses` okuyamaz ama `priority_plan_for_enrollment`
döner, veli kodu/token; `03` secure yalıtımı, `OGR-KEY-003` kilitleri, 'not_applicable key needs peek before approve';
`04` öğrenci ve personel yalıtımı; `05` kanıt zinciri, ders onayı, 'retrieve_memory ranks null-embedding facts by fts only';
`06` kendi 12 satırlık şablon fikstürü, `next_practice_items`, `OGR-GRADE-004` (anahtarsız ve eksik anahtarlı), prereq ipucu,
teşhis; `07` her `custom` saklama işleyicisi + `storage_pressure` + anonimleştirmede alarm/araştırma metinleri; `08` BKT
paritesi (41 vektör); `09` canlı ACL ↔ `grants_matrix.json` ve nesne sahipliği; `10` denetim izi; `11` iki bütçe ve kota; `12` `batch_worker` `pilot_metrics` upsert'ü (`ON CONFLICT DO UPDATE`, aynı haftanın yeniden hesabı satırı günceller) ve geri okuması, `bot_runtime`/`anon` reddi, `llm_calls`'a matristeki 15 sütunla ekleme ve `created_at` reddi.
Ayrıca `02` veli token kilidi (satır başına), müfredata göre öncelik planı görünürlüğü, transkript kapsamı,
`create_figure_upload_url`; `03` 'batch_worker cannot edit approved question'; `04` Worker'ın doğrudan yazımları ve
`recent_messages` üyelik denetimi.

## Kurulum (barındırılan Supabase, kurucu makinesi)

1. Proje: bölge `eu-central-1`; **Dashboard → API → Exposed schemas yalnız `public`** (secure ve audit açılmaz).
2. Migration'lar: `supabase db push` ya da sırayla `psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f migrations/00NN_*.sql`
   (kök `make db-migrate`, M13). Ardından `seed/01…04`, müfredat (`export-sql.py --out /tmp/seed.sql` + `psql -f`), anahtarlar
   (`seed-keys.py --database-url "$DB_URL"`). `seed/00_roles.sql` barındırılan projede personel eklemez; ilk koordinatör
   `auth.users` + `public.staff` satırıyla elle (docs/runbook/accounts.md).
3. Roller: `0002` `bot_runtime` ve `batch_worker` (nologin) yaratır ve `authenticator`'a verir (PostgREST JWT `role` claim'iyle
   `SET ROLE`); `0017` Storage için `supabase_storage_admin`'e verir (ADR-0014). `extensions` şeması varsa iki role `USAGE` verilir.
4. JWT basımı (proje JWT secret'ı yalnız bu makinede; Worker ve GitHub imzalama gizi taşımaz):
   ```
   SUPABASE_JWT_SECRET=… bun run /home/user/alperen/supabase/scripts/mint-jwt.ts --role bot_runtime --exp 90d   # → wrangler secret put SUPABASE_BOT_JWT
   SUPABASE_JWT_SECRET=… bun run /home/user/alperen/supabase/scripts/mint-jwt.ts --role batch_worker --exp 90d  # → GitHub prod: SUPABASE_BATCH_JWT
   ```
   Araç `service_role`, `anon`, `authenticated` basmaz; en çok 400 gün; rotasyon 90 gün (docs/runbook/key-rotation.md).
5. Doğrulama: `anon` anahtarıyla `select * from secure.answer_keys` → `permission denied for schema secure`;
   `psql -f scripts/size-report.sql`; haftalık yedek `scripts/backup-public.sh` (`BACKUP_AGE_PUBKEY`).

## Erişim modeli (özet)

- `bot_runtime` (Worker): öğrenci bağlamı `X-Ogrenmen-Student` başlığıyla (`app.current_student()`); başlıksız (cron/grup)
  yalnız adlandırılmış RPC'ler ve meta tablolar. `secure`'a `USAGE` yok; `messages.text_raw` sütun yetkisi yok.
- `batch_worker` (pipelines): `secure` yok, `text_raw` yok; anahtar yalnız `register_answer_key` / `register_template_question`.
- `authenticated` (panel): `staff.role` + `staff_students` kapsamı; ham metin yalnız `v_messages_staff` / `v_exam_items_full`.
- `anon`: yalnız `ping()` ve `redeem_guardian_token()`.
- **Worker yazım sözleşmesi (M04)**: PostgREST `Prefer: return=minimal` `INSERT … RETURNING 1` üretir ve SELECT politikası
  uygulanmaz; `return=representation` (`RETURNING id`) yeni satıra SELECT politikasını uygular. `msg_bot_r` başlıksız
  bağlamda ve başka öğrencinin satırında görünürlük vermez (yalıtım için bilinçli), bu yüzden öğrenci dışı / başlıksız
  `messages` satırları (eğitmen, `other`, öğrencisiz bot mesajı) **`return=minimal`** ile yazılır; `messages.id` yalnız
  öğrenci başlığı ve o öğrencinin satırı için istenir. M04 `PostgrestDb.insertMessage` bunu zaten yapar
  (`returnId: student_id !== null`). `04` testi bu biçimleri (`returning 1` / `returning id`) ve tg_chats/chat_roles upsert,
  ops alarmı, provider_health, havuz adayı, pool_miss yazımlarını `bot_runtime` olarak sınar.
- Tüm RPC'ler `SECURITY DEFINER`, `set search_path = public, app, secure, extensions, pg_temp`; rol/öğrenci/personel
  denetimi gövdede; hata kodları `OGR-<ALAN>-<NNN>`.

## Blueprint'e göre bilinçli kararlar ve notlar

1. **Tablo okuyan yardımcılar `0014` başında** (`app.current_student`, `app.staff_role`, `app.can_see_student`, …). Bu yüzden
   `0013`'teki `v_messages_staff` ve `v_exam_items_full` aynı rol/kapsam mantığını satır içi yazar (görünüm oluşturulurken
   çağrılan fonksiyon var olmalıdır) ve `0012`'deki bu yardımcıları çağıran RPC'ler `plpgsql`'dir (gövde çağrı anında çözülür).
2. **PUBLIC EXECUTE küresel iptali**: fonksiyonlarda PUBLIC'e EXECUTE küresel varsayılandır; şema başına
   `ALTER DEFAULT PRIVILEGES` bunu geri alamaz. `0002` blueprint satırlarına ek olarak
   `alter default privileges revoke execute on functions from public` içerir (canlı `09` bunu ACL ile doğrular). Uzantı
   fonksiyonları `public`'e kuruluysa (CI pgvector konteyneri) toplu iptalden sonra yeniden PUBLIC'e açılır.
3. **`app.current_student_sd()` uygulama rollerine EXECUTE**: politikalar `app.current_student()`'ı çağıranın yetkisiyle
   çalıştırır ve PostgreSQL ifade başlatılırken iç çağrının da yetkisini denetler; sarmal yalnız çağıranın kendi
   `auth_links` satırını döner. Matris notunda yazılıdır.
4. Ek yardımcılar: `app.staff_subject()` ve `app.staff_in_chat()` (staff ve chat_roles politikalarının kendi tablosunu
   okuyup özyinelemeye girmemesi için), `app.tr_stamp()` (Türkçe kanıt konumu "19 Eki 21:04"), `app.parse_number()`
   (`numeric_equal`), `app.anonymize_student_ids()` (anonimleştirme ve `erase_student` ortak gövdesi),
   `app.attempts_protect_graded()` (tetikleyici fonksiyonu), `app.pii_name_token_hashes()` (packages/pii kopyası).
5. **Ad-token hash'leri** `app.pii_name_token_hashes` ile (packages/pii `-- begin pii … -- end pii` bloğu birebir, `0003`):
   blueprint'teki düz `lower()` kullanılmaz (`lower('Işıl')` temizleyicinin katlamasından farklıdır). `app.refresh_name_hashes`
   ve `app.staff_name_hashes` bunu kullanır; `01` testi `cases.json` `hash_cases` ile bayt eşitliğini denetler.
6. `audit_recent(p_limit)` `setof audit.events` yerine aynı sütunlu `returns table` döner (`audit.events` `0015`'te yaratılır).
   `run_retention`, `compute_table_sizes`, `anonymize_students`, `cap_memory_facts`, `erase_student` ve yetkileri tanımlandıkları
   `0015`'tedir.
7. `apply_observation`: sohbet gözlemleri `p`/`evidence_count`'u değiştirmez ama yanılgı sayacına katılır (§3.7 metni);
   çözülmüş yanılgıda yeni kanıt aynı satırı `pending_review`'a döndürür (çift aktif satır açılmaz).
   `register_answer_key` durum/not yazarken `ogrenmen.reviewer`'ı açar (`questions_protect_review`), `grade_attempt`
   denemeyi yazdıktan sonra `ogrenmen.grader`'ı kapatır (koruma işlemin geri kalanında açık kalır).
8. Matristeki pratik ekler: `provider_health` için `bot_runtime/batch_worker` `insert` (Worker upsert), `instructor_alerts`
   için bot'a yalnız `kind='ops'` satırlarında okuma/ekleme/`done`, `exam_priority_plans`/`research_outputs`/`citations`
   için batch `select` (güncelleme filtresi ve `kalem variants` onaylı planı okur). Matris `notes` alanında yazılıdır.
   `content_pool` için `authenticated` güncelleme yalnız `(status, approved_by, approved_at)`'tir (§3.8 E); K'nin `u`'su
   sütun düzeyinde ayrışamaz (paylaşılan `authenticated` rolü), onaylı havuz metni (`body`) panelden düzenlenmez.
9. `tg_chats` için `enable/force row level security` `0007`'de, tablo tanımının ardındadır (politikaları `0014`'te; §3.0
   tümünü `0014`'e koyar). Neden: M03'ün `export-sql.py`'si `tg_chats.retention_days` varsayılanını migration'lardan okur
   ve tabloyu yaratmayan bir dosyadaki **her** `alter table … tg_chats` ifadesini varsayılanı sıfırlamış (`None`) sayar
   (`_contentlib.sql_column_default`). M03'e iletilmek üzere raporlandı: yalnız `alter column retention_days set/drop default` dikkate alınmalı;
   düzeltilince bu iki ifade `0014`'e taşınır. Aşağıda "Kabul komutu notu".
10. `redeem_guardian_token` (§3.9): kilit **satır başınadır** — doğru token + eksik form `attempts`'i artırır, 5'te
    `locked_until = now() + 1 saat` ve yalnız o kod `OGR-CONS-007` verir. Sayaç kalıcı olsun diye eksik form hata fırlatmaz,
    `false` döner (panel formu göndermeden önce doğrular; eski `OGR-CONS-008` istisnası güncellemeyi geri alıyordu). Yanlış
    ya da süresi dolmuş token satır tanımlamaz: `audit.events`'e `ok=false` yazılır (izleme) ama **küresel kilit yoktur** —
    anon anahtarı panel paketinde herkese açık olduğundan küresel kilit tüm velilerin onayını kapatan bir hizmet engelleme
    yolu olurdu; 8 karakterlik base32 token (40 bit) ve 72 saat ömür tahmini pratikte imkânsız kılar. Başarılı onay sayacı sıfırlar.
11. `compute_table_sizes()` toplamı günün `table_sizes_daily` satırlarından hesaplar ve MB döner (07 testi sahte boyut satırıyla
    `storage_pressure` yolunu sınar); `storage_pressure` kendiliğinden geri alınmaz (koordinatör kararı).
12. `consume_quota` uyarısı kalan hak `warn_at_remaining`'e eşit olduğunda bir kez (standart katmanda 20. mesaj); 26. mesaj red.
13. `messages` için `bot_runtime` güncelleme yetkisi matris gereği yalnız `is_question, answered_at`'tir; düzenlenen mesaj
    (`edited_message`) metnini güncellemek için ek bir yetki ya da RPC gerekir — M04/M13 kararı.
14. ADR-0014 yedeği `create_figure_upload_url(p_figure uuid) returns text` (`0012`, yalnız `batch_worker`): Storage API'nin
    imzalı yükleme belirteciyle aynı biçimde HS256 JWT üretir (yük `{url: 'figures/<id>.png', upsert: true, iat, exp}`,
    10 dakika, yalnız o nesne yolu) ve `/storage/v1/object/upload/sign/figures/<id>.png?token=…` döner (`SUPABASE_URL`'ye
    göre göreli; pipelines `PUT` ile yükler). Doğrulanmış şekle (`review_status='verified'`) ve olmayan şekle `OGR-STOR-002`.
    İmza anahtarı Storage'ın JWT anahtarıdır: önce Vault `vault.decrypted_secrets` (`name='storage_jwt_secret'`), yoksa
    `app.settings.jwt_secret`; ikisi de yoksa `OGR-STOR-001`. Kurulum (M13 runbook/ADR-0014): yedek yol kullanılacaksa
    proje JWT anahtarı Vault'a `storage_jwt_secret` adıyla girilir; `02` testi yükü, süreyi ve imzayı doğrular.
15. Onaylı içerik kilidi (ilke 4/7): `questions_batch_u` yalnız `draft/pending_review/rejected` satırlarda, `figures_batch_u`
    yalnız doğrulanmamış şekillerde çalışır; ikinci kemer `app.questions_protect_content` tetikleyicisi (`c_questions_protect_content`)
    onaylı sorunun kök/şık/şekil/tür/kazanım/değer/şablon parametresini değiştiren her güncellemeyi `OGR-Q-006` ile reddeder
    (yalnız `ogrenmen.reviewer='on'`). Değişiklik gerekiyorsa soru `retired` olur, yenisi incelemeye girer.
16. Anahtar biçimi (`app.answer_key_complete`, `0011`): mcq için doğru şık, numeric için ayrıştırılabilir sayı zorunlu.
    `grade_attempt` eksik anahtarda `OGR-GRADE-004` verir ve `coalesce(seçim = doğru şık, false)` kullanır (null = null doğru
    sayılmaz); `register_answer_key`/`set_answer_key` `OGR-KEY-005`, `app.questions_approve_guard` `OGR-Q-001` ile reddeder.
17. `exam_priority_plans_bot_r` (§3.8 S): `approved` **ve** `app.plan_visible_to_student(course_id)` — öğrenci başlığıyla yalnız
    kendi kaydının müfredatındaki kursun planı; başlıksız (B) yalnız `approved`. `courses` okuması RLS'siz sarmalda.
18. `recent_messages` `SECURITY DEFINER`'dır ve `msg_bot_r`'yi aştığı için öğrenci başlığı ve o öğrencinin sohbetin
    `chat_roles` üyesi olmasını ister; aksi boş küme.
19. `transcripts_staff_read` (0017) `app.transcript_visible(name)` ile sınırlıdır: eğitmen yalnız atanan öğrencinin dersinin
    transkriptini (`lessons.transcript_path` eşlemesi, retention ile aynı yol kuralı), koordinatör hepsini, gözlemci hiçbirini.
20. `cron_open_alerts` 'response' alarmı `detail`'e personel adı yazmaz ("Yanıt süresi medyanı hedefin üstünde: 5,0 saat
    (hedef 2 saat)"); `batch_worker` `instructor_alerts`'i okur ama `staff`'tan yalnız `(id, role)` görür. Tekilleştirme personel
    başına `ref.staff_id` ile: `alerts_dedup` anahtarının `coalesce(ref …)` listesine `ref ->> 'staff_id'` eklendi (blueprint
    satırına ek; ad çıkınca iki eğitmenin alarmı aynı `detail` önekiyle çakışırdı).
21. `app.anonymize_student_ids` öğrenci metninin kopyalarını da temizler: öğrencinin alarmları kapanır ve `detail` 'Silinmiş
    öğrenci' olur ('Cevapsız soru: "<metin>"', 'Teslim yaklaşıyor: <olgu>'), `research_requests.query` ve `expanded_queries`
    boşaltılır.
22. `set_birth_year` yılı `1950 … bu yıl` aralığında ister, aksi `OGR-PII-002 doğum yılı geçersiz`.
23. `0002`'deki `alter default privileges for role postgres …` yalnız migration rolü `postgres`'in üyesiyse çalışır (Supabase'de
    migration'ı `postgres` uyguladığında üyedir; yerel süper kullanıcı olmayan sahip üye değildir, satır atlanır).
24. `pilot_metrics` için `batch_worker` **r w u**'dur (blueprint §3.8 satırı `w u`; ek `0018_pilot_metrics_grants.sql`,
    uygulanmış `0014` yeniden yazılmadı). `kulaklik metrics` haftalık satırları PostgREST upsert'üyle
    (`resolution=merge-duplicates` → `INSERT … ON CONFLICT (metric, period) DO UPDATE SET metric, period, value, detail,
    computed_at = EXCLUDED.…`) yazar; PostgreSQL `ON CONFLICT DO UPDATE` için çakışma sütunlarında SELECT yetkisi **ve** var
    olan satırı gören bir SELECT politikası ister. Yetki yokken upsert `permission denied` ile düşüp düz eklemeye iniyor
    (aynı haftanın yeniden hesabı yazılamıyordu), `metrics --gate` ve `cost-report` son dönemi okuyamayıp yeniden hesaplıyordu.
    `0018` `grant select on public.pilot_metrics to batch_worker` ve `pilot_metrics_batch_r` (`using (true)`) ekler; UPDATE
    zaten tablo düzeyindedir (upsert gövdedeki beş sütunun hepsini, `metric`/`period` dahil, SET eder; daraltmak upsert'ü
    bozar). Tablo yalnız sayı taşır (öğrenci kimliği yok); `bot_runtime`/`anon` yetkisizdir (`12` testi).

## Kabul komutu notu

- **pgvector `halfvec`**: blueprint `halfvec(768)` ister (pgvector ≥ 0.7; Supabase'de var) ve migration'lar bunu kullanır.
  Bu ortamdaki yerel Postgres'te pgvector 0.6.0 vardır ve `halfvec` tipi yoktur. `tests/00_local_stub.sql` tip yoksa
  `extensions.halfvec`'i vector'ün kendi C işlevleriyle (aynı ikili biçim: `vector_in/out/typmod_in/recv/send`, uzunluk
  denetimi, `<=>`, HNSW `halfvec_cosine_ops`) tanımlar ve test veritabanının `search_path`'ini Supabase'deki gibi
  `"$user", public, extensions` yapar. Gerçek yarı hassasiyet (2 bayt) yereldeki yedekte yoktur; işlevsel davranış
  (giriş/çıkış, boyut 768, kosinüs mesafesi, HNSW indeksi) aynıdır. pgvector 0.7+ olan sunucuda yedek devreye girmez.
- **Süper kullanıcı olmayan migration sahibi**: Supabase'de migration'ları süper kullanıcı olmayan `postgres` uygular.
  Yerel kümenin `postgres` rolü süper kullanıcıdır ve süper kullanıcı RLS'i, FORCE RLS'i ve yetki denetimlerini aşar
  (definer fonksiyonlar ve `security_invoker=false` görünümler yalnız bu yüzden çalışıyor olabilirdi). `db-test.sh` bu yüzden
  migration ve seed'leri `ogrenmen_owner` (Supabase `postgres`'inin eşleniği, `00_local_stub.sql`) ile uygular; `09`
  sahipliği ve `rolbypassrls`/`rolsuper`'ı denetler. Bağlanan rolün süper kullanıcı olması gerekir (stub için).
- **`tg_chats` RLS ifadeleri 0007'de** (§3.0 hepsini 0014'e koyar): M03 `export-sql.py` ayrıştırıcısı başka dosyadaki her
  `alter table … tg_chats`'ı `retention_days` varsayılanını sıfırlamış sayıyor (`_contentlib.sql_column_default`, M03'e
  raporlandı). İfadeler tablo tanımıyla aynı dosyadadır; `check_sql.py` RLS denetimi küme bütününde çalıştığı için geçer.
- **seed/dev ↔ içerik seed'i**: `fixtures/db/dev-seed.json` (M01) teşhis testi kimliğini (`67dc…`) `export-sql.py`'den (M03,
  `uuid5('diagnostic_test', code)` = `9dfa…`) farklı tohumla üretir; soru kimlikleri artık aynıdır. Bu uyuşmazlık yüzünden
  seed/dev önceden yalnız ayrı bir `…_dev` veritabanına yükleniyordu (§2.4'ten sapma). `gen-dev-seed.py` artık
  `diagnostic_sessions.test_id`'yi doğal anahtarla (`curriculum_id, version`) çözer (hukuk metni başvurularıyla aynı yol);
  seed/dev içerik seed'inin üstüne yüklenir ve testler §2.4'teki gibi bu dünyada koşar. M01'e iletilmek üzere raporlandı: dev-seed.json'daki
  `diagnostic_tests.id` export-sql.py'nin kimliğiyle aynı olmalı.
- Canlı test bu ortamda `OGRENMEN_DATABASE_URL=postgresql://ogrenmen:ogrenmen@127.0.0.1:5432/ogrenmen` ile koşar;
  `ogrenmen` veritabanına dokunulmaz (geçici `ogrenmen_test` ve `ogrenmen_test_dev` açılıp silinir).
