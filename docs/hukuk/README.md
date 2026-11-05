# docs/hukuk — KVKK ve hukuk belgeleri (M12)

Bu dizin Öğrenmen'in KVKK ve telif belgelerinin taslaklarını tutar. Her belgenin ilk satırı `> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz` uyarısıdır ve hiçbiri avukat onayı olmadan kullanıcıya yayımlanmaz. Belgeler `docs/BLUEPRINT.md` §9.2, §9.3, §3.10 ve §12 (#18, #19, #20, #26, #49, #55) maddelerine göre yazılmıştır.

## Sürüm tablosu

| Belge | `legal_texts_kind` (= `legal_texts.kind`) | doc_version | Tarih | Durum |
| --- | --- | --- | --- | --- |
| `aydinlatma-metni.md` | `kvkk_aydinlatma` | 2026-10-v1 | 2026-10-30 | Taslak — hukuki inceleme bekliyor |
| `veli-onay-formu.md` | `veli_onayi` | 2026-10-v1 | 2026-10-30 | Taslak — hukuki inceleme bekliyor |
| `grup-kayit-bildirimi.md` | `grup_kayit` | 2026-10-v1 | 2026-10-30 | Taslak — hukuki inceleme bekliyor |
| `ders-kaydi-bildirimi.md` | `ders_kaydi` | 2026-10-v1 | 2026-10-30 | Taslak — hukuki inceleme bekliyor |
| `saklama-politikasi.md` | — (yalnız belge) | 2026-10-v1 | 2026-10-30 | Taslak — hukuki inceleme bekliyor |
| `yurt-disi-aktarim.md` | — (yalnız belge) | 2026-10-v1 | 2026-10-30 | Taslak — hukuki inceleme bekliyor |
| `veri-isleme-envanteri.md` | — (yalnız belge) | 2026-10-v1 | 2026-10-30 | Taslak — hukuki inceleme bekliyor |
| `telif-notu.md` | — (yalnız belge) | 2026-10-v1 | 2026-10-30 | Taslak — hukuki inceleme bekliyor |

"Tarih" taslağın son düzenlendiği gündür; belgelerin içindeki `effective_from` (2026-11-01) `legal_texts.effective_from` olarak yüklenecek yürürlük tarihi önerisidir. Bir belge değiştiğinde `doc_version` yükseltilir (`2026-10-v2` ya da `2026-11-v1`), bu tablo güncellenir ve kullanıcıya gösterilen dört belge için yeni sürüme yeniden onay gerekip gerekmediği hukukçuya sorulur. `kullanim_kosullari` türü şemada vardır ama bu dalgada belgesi yazılmamıştır.

## Belge biçimi

Her belge aynı başlıkla başlar:

1. satır: `> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz`
2. satırdan sonra bir `yaml` kod bloğu: `doc_version`, `doc_kind`, (yalnız yüklenen dört belgede) `legal_texts_kind`, `effective_from`, `status`.
   - `doc_version` satırı her zaman tek başına `doc_version: 2026-10-v1` biçimindedir; M03'ün `export-sql.py`'ı bu satırı `legal_texts.version` olarak okur.
   - `doc_kind` sekiz belgenin hepsinde bulunan, belgenin kendi türünü adlandıran serbest bir anahtardır (`aydinlatma_metni`, `veli_onay_formu`, `grup_kayit_bildirimi`, `ders_kaydi_bildirimi`, `saklama_politikasi`, `yurt_disi_aktarim`, `veri_isleme_envanteri`, `telif_notu`); veritabanı sütunu değildir.
   - `legal_texts_kind` yalnız `legal_texts` tablosuna yüklenecek dört belgede bulunur ve değeri `legal_texts.kind` kısıtındaki değerlerden biridir (`kvkk_aydinlatma`, `veli_onayi`, `grup_kayit`, `ders_kaydi`). Çözümleyici yalnız bu anahtarı taşıyan belgeleri yükler ve değeri `legal_texts.kind` olarak yazar; anahtarı olmayan dört belge (`saklama-politikasi`, `yurt-disi-aktarim`, `veri-isleme-envanteri`, `telif-notu`) yüklenmez. Böylece yükleme kararı ayrı bir listeye değil belgenin başlığına bağlıdır ve kısıt dışı bir değer veritabanına gitmez.

### İşaretler (HTML yorumları)

| İşaret | Belge | Kullanan |
| --- | --- | --- |
| `<!-- ogrenmen:cocuk-dili:start -->` … `<!-- ogrenmen:cocuk-dili:end -->` | `aydinlatma-metni.md` | Worker `/gizlilik` ve `/yardim`: "Verilerin nasıl kullanılıyor?" paragrafı; en çok 4 satır, emoji ve ünlem yok (§5.2, §9.3) |
| `<!-- ogrenmen:onay-ozeti:start -->` … `<!-- ogrenmen:onay-ozeti:end -->` | `aydinlatma-metni.md` | Worker `/start` onay ekranının 4 satırlık özeti (§5.3) |
| `<!-- ogrenmen:grup-kayit-kisa:start -->` … `<!-- ogrenmen:grup-kayit-kisa:end -->` | `grup-kayit-bildirimi.md` | Gruba gönderilip sabitlenen kısa bildirim (en çok 4 satır) |
| `<!-- ogrenmen:grup-kayit-uzun:start -->` … `<!-- ogrenmen:grup-kayit-uzun:end -->` | `grup-kayit-bildirimi.md` | Uzun sürüm; `/gizlilik` ve panel |

`export-sql.py` işaretleri gövdede korur; yalnız yer tutucuları çözer.

## Yer tutucular ve `placeholders.json`

Belgelerde saklama süresi el ile yazılmaz. Her gün sayısı çift süslü parantezli bir yer tutucudur (örnek: `{{RETENTION_MESSAGES_DAYS}}`) ve `placeholders.json` içinde tanımlıdır. Dosyanın üst düzey anahtarları yer tutucu adlarıdır; başka üst düzey anahtar yoktur. Her girdi:

| Alan | Anlam |
| --- | --- |
| `policy_id` | Bağlı `retention_policies.id` (zorunlu; `supabase/seed/04_retention_policies.sql` satırı) |
| `days_source` | Gün sayısının okunduğu yer: `retention_policies.days` ya da `tg_chats.retention_days` |
| `expected_days` | Bu taslak yazılırken §3.10 / §12 #20'deki değer; tutarlılık testleri için karşılaştırma değeri, çözümleyici bunu kaynak olarak kullanmaz |
| `description` | Yer tutucunun Türkçe açıklaması |

Çözüm zinciri (§3.11 adım 3): `export-sql.py` her yer tutucu için `policy_id` → seed dosyasındaki `days` değerini okur ve gövdeye gerçek sayıyı yazar; çözülemeyen yer tutucu çıkış 1 ile durur. M13'ün `docs-consistency.test.ts`'i yer tutucuları aynı yoldan seed ile, `saklama-politikasi.md`'yi de `docs/generated/saklama-sureleri.md` ile karşılaştırır.

Blueprint §9.3 madde 9'un saydığı sekiz yer tutucu (`RETENTION_MESSAGES_DAYS`, `RETENTION_PROMPT_DAYS`, `RETENTION_FACTS_DAYS`, `RETENTION_VIDEO_DAYS`, `RETENTION_TRANSCRIPT_DAYS`, `RETENTION_LEARNING_DAYS`, `RETENTION_BOT_RESPONSES_DAYS`, `RETENTION_AUDIT_DAYS`) dosyada aynı adlarla durur. Saklama politikasının §3.10 tablosunun tamamını yer tutucuyla yazabilmesi için dosya şu ek adları da tanımlar; her biri §3.10'daki bir satıra bağlıdır: `RETENTION_FLAGGED_DAYS` (`bot_responses.flagged_delete`), `RETENTION_LLM_CALLS_DAYS` (`llm_calls.hard_delete`), `RETENTION_ANONYMIZE_DAYS` (`students.anonymize`), `RETENTION_CLOSED_CLEANUP_DAYS` (`enrollments.closed_cleanup`), `RETENTION_FACTS_EXPIRED_DAYS` (`memory_facts.hard_delete`), `RETENTION_TG_UPDATES_DAYS` (`tg_updates.purge`), `RETENTION_CITATIONS_UNRESOLVED_DAYS` (`citations.unresolved`), `RETENTION_QUOTA_USAGE_DAYS` (`quota_usage.purge`).

## Entegrasyon notları (diğer modüller için)

- **Mesaj süresi `policy_id` satırında 0'dır.** `messages.hard_delete` satırının `days` değeri 0'dır, çünkü eşik `messages.expires_at` sütunundadır (= `sent_at` + `tg_chats.retention_days`). Bu yüzden `RETENTION_MESSAGES_DAYS` girdisinde `days_source` = `tg_chats.retention_days` yazılıdır: çözümleyici bu girdide `days` yerine `supabase/migrations/0007_kulaklik.sql` içindeki `tg_chats.retention_days` varsayılanını (taslak yazılırken 90) kullanmalıdır. Yalnız `policy_id` → `days` okuyan bir çözümleyici "0 gün" yazar; bu yanlıştır.
- **Grup bildiriminde gerçek zamanlı süre.** §5.2 / §5.9'a göre Worker kayıt bildirimini gönderirken gün sayısını o grubun `tg_chats.retention_days` değeriyle yazar (`{days}`). Belgedeki yer tutucu yükleme anında varsayılan değere çözüldüğü için, depolama basıncında süre kısalınca Worker'ın gövdedeki sayıyı grubun güncel değeriyle değiştirmesi ya da kısa sürümü `retention_policies.user_facing_text` metninden üretmesi gerekir. Bu karar M03 (çözümleyici) ve M04 (Worker) arasındadır; bu dizin yalnız metni sağlar.

- **Ders kaydı onayının otomatik denetimi (M02, M08).** Hukuki metinler (`aydinlatma-metni.md` §2, `ders-kaydi-bildirimi.md`, `veli-onay-formu.md` §2 madde 3) etkin ders kaydı onayı olmayan bir dersin analiz edilmeyeceğini söyler. Blueprint'te `register_lesson` (M02) ve `ogrenmen_ders analyze` (M08) `consents` tablosunu denetlemez. Öneri: `consents(student_id, kind='ders_kaydi', status='given')` satırı yoksa `register_lesson` ya da `ders analyze` reddetmelidir. Bu doğrulanana kadar metinler bu kuralı bir işletim yükümlülüğü olarak yazar ("koordinatör onay kaydı olmayan dersi analize göndermez").
- **Silme talebinde Telegram kimliği (M02).** Blueprint §3.10'a göre `app.retention_students_anonymize` yalnız `secure.student_pii`, `secure.telegram_identities`, `secure.auth_links` ve `secure.guardian_codes` satırlarını siler; `public.chat_roles.telegram_user_id` (öğrenci kimliğiyle) ve özel sohbetin `tg_chats.chat_id` değeri (özel sohbette Telegram kullanıcı kimliğine eşittir) kalır. Öneri: işleyici öğrencinin `chat_roles` satırlarını da silmeli, özel sohbetin `tg_chats` satırı mesajların süresi dolunca kaldırılmalıdır. Bu yapılana kadar `aydinlatma-metni.md` §7, `saklama-politikasi.md` ve `veri-isleme-envanteri.md` bu silmeyi vaat etmez, `[hukukçu ve M02 doğrular]` işaretiyle açık bırakır.
- **Çözülen mesaj süresi 0 olamaz (M03, M13).** `placeholders.json` içindeki `RETENTION_MESSAGES_DAYS` açıklaması bunu yazar: bu yer tutucu için 0'a çözülen değer hatadır. M13'ün `docs-consistency.test.ts`'i bu yer tutucunun 90'a çözüldüğünü denetlemelidir (§9.2).

## Blueprint'ten bilinçli ayrılmalar

- **§9.3 madde 4, "isimler API'ye gitmez".** `ders-kaydi-bildirimi.md` bu cümleyi aynen kullanmaz. §6.3 adım 3'e ve `models.json` `transcribe` zincirine göre ham ders sesi (derste söylenen adlarla) yazıya döküm için önce Gemini ücretsiz katmanına gider; adlar yalnız transkriptten, raporu üreten modele gitmeden önce silinir. Belge bu yüzden "raporu üreten modele adlar gitmez; yazıya döküm hizmeti sesi duyar" der ve konuyu hukukçuya açık nokta olarak bırakır. Bir hukuk metninde doğru olmayan bir vaat yazılmaz; §9.1, §9.3 ve §12 #23'teki cümle ses yolu yerel dökümle değiştirilirse geçerli olur.
- **`RETENTION_MESSAGES_DAYS` → `days_source`.** §3.10'da `messages.hard_delete` satırının `days` değeri 0'dır; §9.3 madde 9'daki `policy_id` → `days` zinciri bu yer tutucu için yanlış sayı üretir. `placeholders.json` bu yüzden `days_source` ve `expected_days` alanlarını ekler (yukarıdaki entegrasyon notları).
- **Çocuk dili özeti.** `packages/design-system/guven-ve-seffaflik.md` yapay zekâya giden bağlamda "ad, okul ve sınıf" yer almadığının çocuk diliyle anlatılmasını ister; blok bu üçünü ve telefon numarasını sayar.

## Hukukçuya sorulacaklar (özet)

- Yurt dışı aktarımın dayanağı: 7499 sayılı Kanun sonrası KVKK m.9'a göre standart sözleşme ve Kurul'a bildirim (`yurt-disi-aktarim.md` §3).
- Ders sesinin ücretsiz katmanda yazıya dökülmesi (`ders-kaydi-bildirimi.md`).
- Bütçe tavanı aşıldığında sohbetin tamamen ücretsiz katmana geçmesi (`yurt-disi-aktarim.md` §3).
- Veli onayının Telegram kodu ve web bağlantısı yolunda, kutusuz beyanla alınmasının yeterliliği; yurt dışı aktarım rızasının hizmet şartına bağlanması (`veli-onay-formu.md` §3, §5).
- Haftalık yedekte silinmiş kayıtların 4 hafta daha durması ve kurucu makinesindeki `secure` yedeğinin saklama süresi (`saklama-politikasi.md` §3).
- Yaş beyanının kimlik doğrulaması olmadan kabulü ve veli kodunun doğru kişiye ulaştığı varsayımı (§12 #18, #19).
- Silme talebinde öğrenme sayılarının rastgele kimlikle saklanması (§12 #49).
- Kimlik verileri için "üyelik + 1 yıl" süresi ve onay kayıtlarının saklama süresi.
- VERBİS kayıt yükümlülüğü (`veri-isleme-envanteri.md`).

## Kabul komutları

Kabul komutları `docs/BLUEPRINT.md` §11 tablosundaki M12 satırındadır (dört komut: sekiz belgenin varlığı ve ilk satırı; belgelerdeki her yer tutucunun `placeholders.json`'da tanımlı olması; grup bildiriminde mesaj süresi yer tutucusu; aydınlatma metninde çocuk dili işaretleri). Komutlar burada kopyalanmaz: bu dizindeki hiçbir Markdown dosyası tanımlı yer tutucular dışında çift süslü parantez içermez, böylece tanımsız yer tutucu arayan denetimler README'yi de güvenle tarayabilir.
