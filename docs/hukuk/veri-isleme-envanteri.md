> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz

```yaml
doc_version: 2026-10-v1
doc_kind: veri_isleme_envanteri
effective_from: 2026-11-01
status: taslak
```

# Kişisel Veri İşleme Envanteri

Bu envanter Öğrenmen'in işlediği kişisel veri kategorilerini, tutulduğu yeri, amacını, önerilen hukuki dayanağını, saklama süresini ve aktarıldığı alıcıları listeler. Saklama sütunundaki sayılar veritabanındaki saklama tablosundan (`retention_policies`, parantez içinde ilgili kural kimliği) yer tutucularla gelir; aynı sayılar otomatik üretilen saklama listesinde ve saklama politikasında da yer alır.

**VERBİS:** easy'nin Veri Sorumluları Siciline kayıt yükümlülüğü (çalışan sayısı, yıllık mali bilanço ve ana faaliyet konusunun özel nitelikli veri işleme olup olmadığına göre) hukukçuya sorulacaktır. Kayıt gerekiyorsa bu envanter VERBİS bildiriminin taslağıdır.

## 1. İlgili kişi grupları

| Grup | Açıklama |
| --- | --- |
| Öğrenci | Telegram botunu kullanan kişi; çoğunluğu 18 yaş altı varsayılır |
| Veli / vasi | 18 yaş altı öğrencinin onayını veren kişi |
| Eğitmen, koordinatör, gözlemci | easy personeli; eğitmen paneli kullanıcıları |
| Grup üyesi (onaysız) | Botun bulunduğu grupta olup botla özel sohbette onay vermemiş kişi; yalnız meta veri işlenir |

## 2. Öğrenci verileri

| Veri kategorisi | Yer | Amaç | Hukuki dayanak (öneri) | Saklama | Alıcılar |
| --- | --- | --- | --- | --- | --- |
| Kimlik: ad, doğum yılı, okul, sınıf | `secure.student_pii` | Hesabın yönetimi, eğitmen panelinde öğrencinin tanınması, yaşa göre onay kapısı | Açık rıza; 18 yaş altında veli rızası (KVKK m.5/1) | Üyelik süresince [üyelik + 1 yıl önerisi]; silme talebinden {{RETENTION_ANONYMIZE_DAYS}} gün sonra silinir (`students.anonymize`) | Supabase (barındırma) |
| Veli bilgisi: veli adı, yakınlığı, iletişimi | `secure.student_pii`, `secure.guardian_codes` | Veli onayının alınması, silme bildirimlerinin veliye gönderilmesi | Açık rıza (veli) | Öğrenci kimlik verisiyle aynı (`students.anonymize`) | Supabase |
| İletişim: Telegram kullanıcı kimliği, kullanıcı adı | `secure.telegram_identities` (eşleme); yönlendirme için `chat_roles`, `tg_chats`, `sessions`, `messages` (sayısal kimlik) | Botun kişiyi tanıması, mesajın doğru sohbete gitmesi, grupta kullanıcı adıyla hitap | Sözleşmenin ifası (m.5/2-c) | Üyelik süresince; kilitli alandaki eşleme silme talebinden {{RETENTION_ANONYMIZE_DAYS}} gün sonra silinir (`students.anonymize`). `chat_roles` satırları bu işe şu an dahil değildir [hukukçu ve M02 doğrular; README entegrasyon notu]; mesaj satırları mesaj süresiyle silinir | Supabase, Telegram; Cloudflare (Worker, yalnız bellek içinde); GitHub (haftalık şifreli yedek, `chat_roles` ve `tg_chats`) |
| Mesaj içeriği (ham ve temizlenmiş) | `messages` | Sohbet, hafıza çıkarımı, eğitmene yükseltme | Açık rıza (grup bildirimi + bireysel onay) | {{RETENTION_MESSAGES_DAYS}} gün (`messages.hard_delete`) | Supabase; temizlenmiş hâli yapay zekâ sağlayıcıları |
| Mesaj meta verisi: zaman, grup, rol, uzunluk, soru işareti | `messages` | Cevapsız soru ve sessizlik uyarıları, yanıt süresi ölçümü | Meşru menfaat (m.5/2-f) | {{RETENTION_MESSAGES_DAYS}} gün (`messages.hard_delete`) | Supabase |
| Öğrenme verisi: deneme, gözlem, ustalık, yanılgı | `attempts`, `observations`, `mastery`, `mastery_history`, `misconceptions` | Kanıta dayalı öğrenme profili, soru seçimi | Sözleşmenin ifası (m.5/2-c) | Dönem + {{RETENTION_LEARNING_DAYS}} gün: kanıt alıntıları ve seçimler anonimleştirilir (`enrollments.learning_data`); ustalık sayıları rastgele kimlikle kalır | Supabase; isimsiz profil özeti yapay zekâ sağlayıcıları |
| Hafıza olguları, haftalık özet | `memory_facts`, `weekly_summaries` | Hatırlatma, kişiselleştirilmiş sohbet, eğitmen takibi | Açık rıza | Olgu {{RETENTION_FACTS_DAYS}} gün sonra geçersiz (`memory_facts.stale`), oluşturulmasından {{RETENTION_FACTS_EXPIRED_DAYS}} gün sonra silinir (`memory_facts.hard_delete`); kapalı dönemde {{RETENTION_CLOSED_CLEANUP_DAYS}} gün (`enrollments.closed_cleanup`); silme talebinde kimlik verisiyle birlikte | Supabase; Gemini (gece işi, ücretli); sohbet bağlamında sohbet zincirindeki sağlayıcılar (Gemini ücretli/ücretsiz, Groq, Cloudflare Workers AI, OpenRouter; yurt dışı aktarım belgesi); GitHub (haftalık şifreli yedek) |
| Tercihler, oturum durumu, kota | `preferences`, `sessions`, `quota_usage` | Kişiselleştirme, kota denetimi | Sözleşmenin ifası | Kota sayacı {{RETENTION_QUOTA_USAGE_DAYS}} gün (`quota_usage.purge`); tercihler üyelik süresince | Supabase |
| Ders ses ve videosu | Kurucunun bilgisayarı (`OGRENMEN_VIDEO_DIR`) | Ders raporu üretimi | Açık rıza (ders kaydı bildirimi) | {{RETENTION_VIDEO_DAYS}} gün; silinince bildirilir (`lessons.video`) | Ses: yazıya döküm sağlayıcısı (Gemini ücretsiz katman, yedek Groq) |
| Ders transkripti (isimsiz, etiketli) ve ders raporu | Storage `transcripts/`, `lesson_analyses`, `lesson_claims` | Ders raporu, eğitmen onayı | Açık rıza; transkript anonimleştirilmiş kabul edilir [hukukçu doğrular] | Dönem + {{RETENTION_TRANSCRIPT_DAYS}} gün (`lessons.transcript`) | Supabase; Gemini (ücretli, analiz) |
| Bot cevap günlüğü | `bot_responses` | Kalite denetimi, hatalı cevapların işaretlenmesi | Meşru menfaat (kalite denetimi) | Prompt {{RETENTION_PROMPT_DAYS}} gün (`bot_responses.prompt_null`); satır {{RETENTION_BOT_RESPONSES_DAYS}} gün (`bot_responses.hard_delete`); işaretli {{RETENTION_FLAGGED_DAYS}} gün (`bot_responses.flagged_delete`) | Supabase |
| Sağlayıcı çağrı kaydı | `llm_calls` | Maliyet ve tavan denetimi | Meşru menfaat | {{RETENTION_LLM_CALLS_DAYS}} gün (`llm_calls.hard_delete`) | Supabase |
| Onay kayıtları | `consents` | Rızanın ispatı | Hukuki yükümlülük, hakkın tesisi | Öğrenci kaydı süresince [hukukçu doğrular] | Supabase |
| Yükseltmeler ve eğitmen uyarıları | `escalations`, `instructor_alerts` | Sorunun eğitmene iletilmesi, takip paneli | Sözleşmenin ifası | Öğrenci kaydı süresince [süre belirlenmeli] | Supabase |
| Araştırma talepleri (pilotta kapalı) | `research_requests`, `research_outputs` | Akademik araştırma özeti | Sözleşmenin ifası | [süre belirlenmeli] | Gemini; arama sorguları OpenAlex, Semantic Scholar, arXiv, Crossref, Unpaywall |

## 3. Veli verileri

| Veri kategorisi | Yer | Amaç | Hukuki dayanak (öneri) | Saklama | Alıcılar |
| --- | --- | --- | --- | --- | --- |
| Veli Telegram kimliği (yalnız kodu kullandıysa) | `secure.guardian_codes` | Onayın kimden geldiğinin kaydı; öğrencinin kendi velisi olamaması denetimi | Hukuki yükümlülük (rızanın ispatı) | Öğrenci kimlik verisiyle aynı (`students.anonymize`) | Supabase |
| Web onay formundaki ad ve yakınlık | `consents.evidence` | Rızanın ispatı | Hukuki yükümlülük | Onay kaydıyla aynı | Supabase |
| İmzalı kâğıt form | Kurum arşivi (kâğıt) | Rızanın ispatı | Hukuki yükümlülük | [hukukçu belirler] | — |

## 4. Personel verileri

| Veri kategorisi | Yer | Amaç | Hukuki dayanak (öneri) | Saklama | Alıcılar |
| --- | --- | --- | --- | --- | --- |
| Ad soyad, rol, branş, panel e-postası | `staff`, Supabase Auth | Panel girişi, yetkilendirme, öğrenci ataması | İş sözleşmesinin ifası | Görev süresince [süre belirlenmeli] | Supabase |
| Telegram kimliği ve kullanıcı adı | `chat_roles` | Grupta eğitmenin etiketlenmesi | İş sözleşmesinin ifası | Görev süresince | Supabase, Telegram |
| Grup mesajları | `messages` (`sender_role='instructor'`) | Yanıt süresi ölçümü, eğitmen beyanı adayları | Meşru menfaat | {{RETENTION_MESSAGES_DAYS}} gün (`messages.hard_delete`) | Supabase; temizlenmiş hâli Gemini (gece işi) |
| Denetim izi (kim neyi ne zaman onayladı, kimin kimlik verisine baktı) | `audit.events` | Güvenlik, hesap verebilirlik | Hukuki yükümlülük, meşru menfaat | {{RETENTION_AUDIT_DAYS}} gün (`audit.events.purge`) | Supabase |
| Eğitmen notları | `instructor_notes` | Öğrenci profiline eğitmen gözlemi | Sözleşmenin ifası | Öğrenme verisiyle aynı | Supabase |

## 5. Kişisel veri içermemesi gereken kayıtlar

| Kayıt | Yer | Not |
| --- | --- | --- |
| Sınav arşivi (PDF, OCR metni) | Storage `exams/`, `exam_items.ocr_text` | Eğitmenin meşru edinimi; yalnız istatistik; eğitmen silene kadar. Hoca adı yerine `hoca-A` gibi takma ad tutulur; öğrenci kâğıdındaki ad yüklemeden önce karartılır (telif notu) |
| Ders notu kütüphanesi | `library_documents`, `library_chunks` | Eğitmenin kendi notları; soru üretiminde örnek olarak kullanılır |
| Telegram güncelleme tekrar denetimi | `tg_updates` | Yalnız güncelleme numarası; {{RETENTION_TG_UPDATES_DAYS}} gün (`tg_updates.purge`) |
| Doğrulanamayan atıflar | `citations` | {{RETENTION_CITATIONS_UNRESOLVED_DAYS}} gün (`citations.unresolved`) |

## 6. Teknik ve idari tedbirler (özet)

- Kimlik verileri ayrı bir şemada (`secure`) tutulur; bot ve gece işleri bu şemaya erişemez; erişim yalnız adlandırılmış veritabanı fonksiyonlarıyla ve denetim iziyle olur.
- Satır düzeyi güvenlik (RLS) ve tablo yetkileri birlikte uygulanır ve testlerle doğrulanır; eğitmen yalnız kendisine atanan öğrencileri görür.
- Ham mesaj metnini yalnız eğitmen ve koordinatör, özel bir görünüm üzerinden okur.
- Yapay zekâya giden her metin PII temizleyicisinden geçer; öğrenci rastgele kimlikle temsil edilir.
- Model anahtarları yalnız sunucuda durur; eğitmen panelinde anahtar yoktur.
- Haftalık yedek `public` ve `audit` şemalarını kapsar, `age` ile şifrelenir ve GitHub Actions artefaktı olarak 4 hafta tutulur; mesaj tablosu ve `secure` şeması bu yedeğe alınmaz. Yedek hafıza olgularını, haftalık özetleri, temizlenmiş prompt metinlerini ve grup üyelik kayıtlarındaki sayısal Telegram kimliklerini içerir; saklama işiyle silinen bir kayıt yedekte en çok 4 hafta daha durabilir.
- `secure` şeması (kimlik verileri) yalnız kurucunun bilgisayarında elle yedeklenir (`supabase/scripts/backup-public.sh --secure`); bu yedeğin saklama süresi [hukukçu/operasyon belirler].

## 7. Hukuki inceleme için açık noktalar

- Öğrenme verisinin "sözleşmenin ifası" dayanağıyla işlenmesi, öğrencinin çoğunlukla 18 yaş altı olması nedeniyle veli rızasıyla desteklenmeli mi?
- Moral göstergesi gibi çıkarımlar özel nitelikli veri (sağlık) sayılabilir mi? Şu an yalnız -2 ile 2 arası bir sinyal ve kısa bir metin olarak tutulur; sağlık bilgisi çıkarılmaz.
- İsimsiz transkriptin anonim veri sayılıp sayılmayacağı (ses kaydıyla eşleştirilebildiği {{RETENTION_VIDEO_DAYS}} gün boyunca kişisel veri sayılması gerektiği).
- Silme talebinde öğrenme sayılarının rastgele kimlikle saklanmasının anonimleştirme sayılıp sayılmayacağı.
