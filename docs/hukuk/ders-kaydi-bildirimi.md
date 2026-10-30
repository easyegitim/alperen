> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz

```yaml
doc_version: 2026-10-v1
doc_kind: ders_kaydi_bildirimi
legal_texts_kind: ders_kaydi
effective_from: 2026-11-01
status: taslak
```

# Ders Kaydı Bildirimi

Birebir dersler kaydedilip Öğrenmen ile analiz edilecekse bu bildirim derse katılan eğitmene, öğrenciye ve 18 yaş altı öğrencinin velisine iletilir. Ders kaydı analizi için onay botla verilmez; koordinatör veya eğitmen aracılığıyla (panel ya da kâğıt form) kaydedilir. Koordinatör ve eğitmen, öğrencinin (18 yaş altında velinin) etkin ders kaydı onayı olmayan bir dersi analize göndermez; bu bir işletim yükümlülüğüdür ve analiz başlatılmadan önce panelde onay kaydı denetlenir [sistemin bu onayı ayrıca otomatik denetlemesi entegrasyon notudur].

## Ne yapılıyor

1. Ders kaydından yalnız **ses** ve ekranın değiştiği anlardan alınan **birkaç ekran karesi** (20–40 kare) kullanılır; videonun tamamı yapay zekâya verilmez.
2. Ses yazıya dökülür (transkript). Bu adımda ses kaydı yazıya döküm hizmetine gider; varsayılan hizmet Google Gemini'dir, yedekleri Groq ve kurucunun bilgisayarında çalışan yerel bir programdır. Konuşmacılar "ÖĞRENCİ" ve "EĞİTMEN" olarak etiketlenir.
3. Transkriptteki adlar, raporu üreten modele gitmeden önce otomatik olarak silinir. Silme düz adlarla değil adların tek yönlü özetleriyle (hash) yapılır; ad hiçbir ara dosyaya yazılmaz. Kalan "hocam [ad]" gibi kalıplar "[AD]" ile değiştirilir.
4. İsimsiz transkript, ekran kareleri ve öğrencinin mevcut profil özeti (rastgele kimlikle) güçlü bir yapay zekâ modeline verilir. Model işlenen kazanımları, öğrencinin sorularını, tereddüt anlarını, kavram yanılgılarını, verilen ödev ve sözleri, konuşma oranını ve bir sonraki ders için notu zaman damgalı alıntılarla raporlar.
5. Rapor **eğitmen onaylamadan** öğrencinin profiline işlenmez. Eğitmen panelde her maddeyi onaylar, düzeltir ya da reddeder; bu arada öğrenciye "raporun hazırlanıyor" denir, taslak gösterilmez.
6. Analizin maliyeti ders ücretine yazılır ve sohbet bütçesinden ayrı izlenir.

## Saklama

| Veri | Nerede | Süre |
| --- | --- | --- |
| Ham ders videosu | Kurucunun bilgisayarı ([veya easy'nin bulut klasörü]); Supabase'e yüklenmez | Ders tarihinden {{RETENTION_VIDEO_DAYS}} gün sonra silinir; silindiği öğrenciye ve veliye ayrı ayrı bildirilir |
| Ayrılmış ses dosyası (ara ürün) | Geçici çalışma klasörü | Analiz bitince silinir |
| İsimsiz, etiketli transkript | Supabase Storage (`transcripts/`, özel kova) | Dönem kaydı kapandıktan {{RETENTION_TRANSCRIPT_DAYS}} gün sonra silinir |
| Dersten çıkan hafıza olguları (ödev, söz, teslim tarihi, moral göstergesi) | `memory_facts` | Süresi belirsiz olgu {{RETENTION_FACTS_DAYS}} gün sonra geçersiz sayılır |
| Onaylanmış ders raporu maddeleri (kazanım, yanılgı, kanıt alıntısı) | `lesson_claims`, `observations`, `misconceptions` | Dönem kaydı kapandıktan {{RETENTION_LEARNING_DAYS}} gün sonra kanıt alıntıları silinir; ustalık sayıları kişiyle bağı kopmuş rastgele kimlikle kalır |
| Analiz maliyet kaydı | `llm_calls` | {{RETENTION_LLM_CALLS_DAYS}} gün |

## Kim görür

- Transkripti, raporu ve kanıt alıntılarını dersin eğitmeni ve koordinatör görür; öğrenciye atanmış gözlemci raporu salt okunur görebilir.
- Öğrenci yalnız eğitmenin onayladığı raporu görür; taslağı ve ham videonun yerini görmez.
- Yapay zekâ sağlayıcısı raporu üretirken yalnız isimsiz transkripti, kareleri ve rastgele kimliği görür. Yazıya döküm hizmeti ise sesi duyar; ses, derste söylenen adları ve konuşanların sesini içerir.

## Hukuki inceleme için açık noktalar

- Ses, yazıya döküm için varsayılan olarak Google Gemini'nin **ücretsiz katmanına** gönderilir. Bu katmanda sağlayıcı gönderilen veriyi ürün eğitiminde kullanabilir. Ses kaydı tanımlanabilir kişisel veri (ses, söylenen adlar) içerdiği için bu kullanımın açık rızayla yeterince karşılanıp karşılanmadığı hukukçuya sorulmalıdır. Alternatifler: ücretli katman ya da kurucunun bilgisayarındaki yerel döküm programı (sağlayıcıya ses gitmez). Karar verilene kadar bu bildirim ücretsiz katmanı açıkça yazar.
- Ham videonun bulut klasöründe tutulması seçilirse klasörün sağlayıcısı ve ülkesi yurt dışı aktarım belgesine eklenmelidir.

## Eğitmene bildirim

> Bu ders kaydediliyor; kaydın sesi ve birkaç ekran karesi, öğrencinin ve gerekiyorsa velinin onayıyla, Öğrenmen tarafından analiz edilecek. Ses yazıya döküm için sağlayıcıya gider; transkriptten adlar silinir ve rapor sizin onayınızdan önce öğrenci profiline işlenmez. Ham kayıt {{RETENTION_VIDEO_DAYS}} gün sonra silinir, isimsiz transkript dönem bitiminden {{RETENTION_TRANSCRIPT_DAYS}} gün sonra silinir.

## Öğrenciye bildirim (Telegram, en çok dört satır)

> Bu ders kaydediliyor; sesi ve birkaç ekran karesi rapora dönüşecek, rapor hocan onaylayınca profiline işlenir.
> Ses yazıya dökülür; transkriptten adın silinir ve yalnız "ÖĞRENCİ" ve "EĞİTMEN" yazar.
> Video {{RETENTION_VIDEO_DAYS}} gün sonra silinir ve sana haber verilir; isimsiz transkript dönem bitiminden {{RETENTION_TRANSCRIPT_DAYS}} gün sonra silinir.
> Dersten çıkan hatırlatma notları en geç {{RETENTION_FACTS_DAYS}} gün sonra geçersiz sayılır.

## Veliye bildirim

> Çocuğunuzun birebir dersleri kaydedilir; kaydın sesi ve birkaç ekran karesi, verdiğiniz onay kapsamında yapay zekâ ile analiz edilir ve eğitmenin onayından sonra öğrenme profiline işlenir. Ses yazıya döküm için sağlayıcıya gider; transkriptten adlar silinir. Ham kayıt {{RETENTION_VIDEO_DAYS}} gün sonra silinir ve silindiğinde size ayrıca bildirilir; isimsiz transkript dönem bitiminden {{RETENTION_TRANSCRIPT_DAYS}} gün sonra silinir. Onayınızı koordinatöre başvurarak geri alabilirsiniz.

## Silme bildirimi şablonları (`proactive_messages`, `video_deleted`)

Öğrenciye (`recipient=student`):

> [tarih] tarihli dersinin ham kaydı silindi. İsimsiz transkript ve hocanın onayladığı rapor duruyor.

Veliye (`recipient=guardian`):

> [tarih] tarihli dersin ham kaydı silindi. İsimsiz transkript ve eğitmenin onayladığı rapor saklanmaya devam ediyor.

## Uygulama notu

- Onay türü `ders_kaydi`; `record_staff_consent` ile panelden (`panel`) ya da kâğıt formla (`paper`) kaydedilir, bot bu onayı yazamaz.
- Ders kaydını sisteme alan koordinatör ya da eğitmen, öğrencinin `ders_kaydi` türünde etkin (`given`) onayı olduğunu kayıttan önce denetler. Kayıt fonksiyonunun ya da analiz komutunun bu onayı kendiliğinden araması README'deki entegrasyon notunda istenmiştir.
- Ham video Supabase Storage'a hiç yüklenmez; veritabanında yalnız yol bilgisi tutulur. Süresi dolan videolar koordinatöre listelenir; silme kurucunun bilgisayarında yapılır, sistem silmeyi kaydeder ve iki ayrı bildirim (öğrenci, veli) kuyruğa alınır.
- Transkript dosyasının silinmesi saklama işiyle kuyruğa alınır ve Storage'dan kaldırılır; veritabanındaki yol bilgisi boşaltılır.
