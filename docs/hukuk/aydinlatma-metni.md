> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz

```yaml
doc_version: 2026-10-v1
doc_kind: aydinlatma_metni
legal_texts_kind: kvkk_aydinlatma
effective_from: 2026-11-01
status: taslak
```

# Öğrenmen Kişisel Verilerin İşlenmesine İlişkin Aydınlatma Metni

Bu metin 6698 sayılı Kişisel Verilerin Korunması Kanunu'nun (KVKK) 10. maddesi ve Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ uyarınca hazırlanmıştır. Öğrenmen'i Telegram'da kullanmaya başladığında bu metnin özeti sana gösterilir ve "Onaylıyorum" düğmesine basman istenir. Düğme önceden seçili gelmez; onay vermezsen Öğrenmen seninle sohbet etmez, mesajlarının içeriğini saklamaz ve yapay zekâya göndermez.

Köşeli parantez içindeki alanlar hukuki inceleme sırasında doldurulur. Gün sayıları sistemin saklama tablosundan (`retention_policies`) bu metne otomatik yazılır; metinde el ile yazılmış saklama süresi yoktur.

## 1. Veri sorumlusu

Veri sorumlusu easy'dir: [easy'nin ticari unvanı], [adres], [MERSİS veya vergi numarası]. KVKK başvurularına ayrılmış iletişim kanalı: [KVKK başvuru e-postası]. Öğrenmen, easy'nin yapay zekâ destekli öğrenme hizmetidir; Telegram botu ve eğitmen paneli bu hizmetin parçalarıdır.

## 2. Hangi verilerin işlenir

| Veri | Nerede tutulur | Kim görür |
| --- | --- | --- |
| Adın, doğum yılın, okulun ve sınıfın, velinin adı, yakınlığı ve iletişimi | Ayrı ve kilitli bir alanda (`secure` şeması) | Koordinatör, her okuması denetim izine yazılarak; eğitmenin yalnız kendisine atanan öğrencide düzeltme yapabilir; yapay zekâ ve gece işleri hiçbir zaman görmez |
| Telegram kullanıcı kimliğin ve kullanıcı adın | Kimlik eşlemesi kilitli alanda (`secure.telegram_identities`); mesajları doğru sohbete yönlendirmek için sohbet ve grup rol tablolarında (`chat_roles`, `tg_chats`, `sessions`, `messages`) sayısal kimlik de tutulur | Bot seni tanımak ve sana cevap göndermek için kullanır; grup üyelik listesinde eğitmenin, koordinatör ve sana atanmış gözlemci görür; hiçbir yapay zekâ sağlayıcısına gitmez |
| Sohbet mesajlarının içeriği (ham metin ve isimden temizlenmiş kopyası) | `messages` | Ham metni yalnız eğitmenin ve koordinatör görür; sana atanmış gözlemci yalnız temizlenmiş kopyayı salt okunur görür; yapay zekâ yalnız temizlenmiş kopyayı okur |
| Mesajların meta verisi (gönderim zamanı, grup, rol, uzunluk) | `messages` | Eğitmenin, koordinatör ve sana atanmış gözlemci (salt okunur; temizlenmiş metin) |
| Öğrenme verin: çözdüğün sorular, seçtiğin şıklar, kazanım başına ustalık, açık kavram yanılgıları | `attempts`, `observations`, `mastery`, `misconceptions` | Sen, eğitmenin, koordinatör, sana atanmış gözlemci (salt okunur) |
| Hafıza olguları (söz verdiğin ödev, teslim tarihi, cevapsız sorun, sorduğun konu, moral göstergesi) ve haftalık özet | `memory_facts`, `weekly_summaries` | Bot cevap verirken; eğitmenin, koordinatör ve sana atanmış gözlemci (salt okunur; temizlenmiş metin) |
| Ders kaydı: ses ve birkaç ekran karesi, isimsiz transkript, ders raporu | Kurucunun bilgisayarı (video), Supabase Storage (transkript) | Dersin eğitmeni ve koordinatör; sana atanmış gözlemci raporu salt okunur görür. Kayıt yalnız ders kaydı için ayrıca onay verildiyse işlenir: koordinatör onay kaydı olmayan dersi analize göndermez. Ayrıntı ders kaydı bildirimindedir |
| Bot cevap günlüğü: cevap metni, kullanılan hafıza olguları, model, maliyet | `bot_responses`, `llm_calls` | Eğitmenin ve koordinatör, kalite denetimi için; sana atanmış gözlemci (salt okunur; temizlenmiş metin, maliyet dahil) |
| Kota ve tercihler (günlük mesaj sayısı, aktif saatin, Sokratik ya da doğrudan cevap modu) | `quota_usage`, `preferences`, `sessions` | Bot, eğitmenin, koordinatör, sana atanmış gözlemci (salt okunur); oturum durumunu (`sessions`) yalnız bot ve koordinatör görür |
| Onay kayıtların: hangi metnin hangi sürümünü ne zaman, hangi yolla onayladığın | `consents` | Koordinatör |

Yapay zekâ sağlayıcılarına giden hiçbir metinde adın, okulun, sınıfın, Telegram kimliğin veya velinin bilgisi bulunmaz. Sen orada `s_` ile başlayan rastgele bir kimlikle temsil edilirsin; mesajındaki adlar, telefon numaraları ve e-posta adresleri gönderilmeden önce otomatik olarak silinir. Temizlik adların kendisiyle değil tek yönlü özetleriyle (hash) yapılır; düz adlar kilitli alandan hiç çıkmaz. Otomatik temizlik her yazımı yakalayamayabilir; bu yüzden bot sana adını sormaz ve mesajlarına kimlik bilgisi yazmamanı öneririz. Bu kural yazılı metinler içindir; ders kaydı için ayrıca onay verdiysen ders sesi yazıya döküm için sağlayıcıya ham hâliyle gider (bölüm 5).

## 3. Hangi amaçlarla işlenir

- Sana sorularında yol göstermek, soru sormak ve ipucu vermek (Sokratik öğretmen sohbeti).
- Hangi kazanımlarda güçlü, hangilerinde eksik olduğunu kanıta dayalı izlemek ve sana uygun soru seçmek.
- Verdiğin sözleri, teslim tarihlerini ve sorduğun konuları hatırlayıp sana zamanında hatırlatmak.
- Grup sohbetinde sorunu eğitmenine iletmek, cevapsız kalan soruları ve eğitmen yanıt süresini izlemek.
- Ders kaydından (ayrıca onay verildiyse) ders raporu çıkarmak ve eğitmenin onayından sonra profiline işlemek.
- Bot cevaplarının kalitesini eğitmenlerin denetlemesi, hatalı cevapların işaretlenip düzeltilmesi.
- Sistem güvenliği, kötüye kullanımın önlenmesi, maliyet ve kota denetimi.

Yapay zekâ not, puan, devamsızlık ve ödeme hakkında konuşmaz; bu konular eğitmenine iletilir. Seninle ilgili hiçbir değerlendirme yalnız yapay zekâ kararıyla verilmez: ustalık değerleri kaynağıyla gösterilir, ders raporları eğitmen onayından geçer.

## 4. Hukuki sebep

| İşleme | Dayanak (öneri; hukukçu doğrular) |
| --- | --- |
| Ad, doğum yılı, okul ve sınıf, veli bilgisi | Açık rıza (KVKK m.5/1); 18 yaş altında veli veya vasi rızası |
| Sohbet içeriğinin saklanması ve temizlenmiş kopyasının yapay zekâya gönderilmesi | Açık rıza (m.5/1); 18 yaş altında ayrıca veli rızası |
| Hafıza olguları ve haftalık özet | Açık rıza (m.5/1) |
| Ders kaydının analizi | Açık rıza (m.5/1); ayrı ders kaydı bildirimi ve onayı |
| Telegram kimliği, kayıt, kota ve öğrenme verisi | Hizmet sözleşmesinin kurulması ve ifası (m.5/2-c) |
| Bot cevap günlüğü ve kalite denetimi | Meşru menfaat (m.5/2-f); içerik isimden temizlenmiştir |
| Onay ve denetim kayıtları | Hukuki yükümlülük (m.5/2-ç) ve bir hakkın tesisi, kullanılması veya korunması (m.5/2-e) |
| Yurt dışındaki sağlayıcılara aktarım | Uygun güvenceler (Kurul'un ilan ettiği standart sözleşme) ya da arızi aktarımda açık rıza (m.9); 18 yaş altında veli rızası. [7499 sonrası m.9: düzenli aktarımda standart sözleşme ve Kurul'a bildirim gerekebilir; yurt dışı aktarım belgesi §3, hukukçu doğrular] |

Yaşın, `/start` sırasında verdiğin beyanla ("18 yaşından büyüğüm" ya da "18 yaşından küçüğüm") belirlenir ve koordinatör düzeltebilir; kimlik belgesiyle doğrulanmaz. Yaşın bilinmiyorsa 18 yaşından küçük sayılırsın ve veli onayı gelene kadar sohbet başlamaz.

## 5. Kimlere aktarılır

Hizmetin çalışması için aşağıdaki sağlayıcılara aktarım yapılır. Ülke, veri türü, dayanak ve sözleşme bağlantıları yurt dışı aktarım belgesindedir.

| Sağlayıcı | Ne gider | Not |
| --- | --- | --- |
| Google (Gemini API) | İsimden temizlenmiş sohbet metni, öğrenme profilinin isimsiz özeti, hafıza olguları, isimsiz ders transkripti ve ders sesi; sınav sayfası ve şekil görüntüleri (ücretsiz katman) | Ücretli katmanda gönderilen veri ürün eğitiminde kullanılmaz. Ücretsiz katman sohbette yedek olarak ve yalnız temizlenmiş metinle kullanılır. Aylık ya da günlük bütçe tavanı aşıldığında (ya da maliyet denetimi ücretli kullanımı durdurduğunda) sohbet geçici olarak ücretsiz katmana geçer; bu sürede de yalnız temizlenmiş metin gönderilir. Ücretsiz katman ayrıca ders sesinin yazıya dökümü, sınav sayfalarının okunması (OCR) ve üretilen şekillerin denetimi için kullanılır. Bu katmanda sağlayıcı gönderilen veriyi ürün eğitiminde kullanabilir |
| Groq, Cloudflare Workers AI, OpenRouter | Sohbet bağlamı: isimden temizlenmiş sohbet metni, hafıza olguları ve öğrenme profilinin isimsiz özeti (yedek sağlayıcı olarak ya da bütçe tavanı aşıldığında ücretsiz zincirde); Groq ayrıca ders sesinde yedek yazıya döküm hizmeti | Ücretsiz katman |
| Cloudflare (Workers, Pages) | Telegram mesajları ve Telegram'ın gönderdiği görünen adın sunucu kodunun çalıştığı yerden bellek içinde geçer; eğitmen paneli buradan sunulur | Sunucu mantığı; görünen ad yalnız hesabını eşlemek için kullanılır, Cloudflare'de saklanmaz ve kayıtlara (log) yazılmaz |
| Supabase (AB, Frankfurt, eu-central-1) | Veritabanı ve dosya depolama | Kimlik verileri burada kilitli alanda tutulur |
| Telegram | Mesajlaşma platformunun kendisi | Telegram'ın kendi gizlilik politikası ayrıca geçerlidir |
| GitHub (Actions) | Gece toplu işleri veritabanına kısıtlı bir rolle bağlanır; yalnız temizlenmiş metin ve rastgele kimlik görür | Ham mesaj metnine ve kimlik verilerine erişimi yoktur |

Yapay zekâ sağlayıcılarına giden metinlerde adın, okulun veya Telegram kimliğin bulunmaz; kimlik verilerin yalnız Supabase'deki kilitli alanda saklanır. Ders kaydı için ayrıca onay verdiysen ders sesi, derste söylenen adları da içerebilecek şekilde, yazıya döküm için Gemini'nin ücretsiz katmanına gider ve bu katmanda ürün eğitiminde kullanılabilir; ayrıntı ders kaydı bildirimindedir. Verilerin pazarlama amacıyla üçüncü kişilere satılmaz veya aktarılmaz. Bir sağlayıcı geçici olarak cevap veremezse sistem sırayla bir sonraki sağlayıcıya geçer; hangi sağlayıcının kullanıldığı her cevapla birlikte kaydedilir.

## 6. Grup sohbetleri

Öğrenmen bir Telegram grubuna eklendiğinde grubun tamamına bir kayıt bildirimi gönderir ve sabitler. Bu bildirim grubun bilgilendirilmesidir; mesaj içeriğinin saklanmasının dayanağı senin bu metni botla özel sohbette onaylamandır (18 yaş altındaysan ayrıca velinin onayı).

Bu metni onaylamamış bir grup üyesinin mesajlarının içeriği saklanmaz; yalnız gönderim zamanı ve rolü kaydedilir, yapay zekâ bu mesajları okumaz. Böyle bir üye botu etiketlerse bot yapay zekâ kullanmadan, en çok yedi günde bir kez, özel sohbette onay vermesi için yönlendirir.

Bot grupta varsayılan olarak yalnız etiketlendiğinde ya da bir mesajına yanıt verildiğinde cevap yazar; koordinatör açarsa, belirli bir süre hoca yanıtı gelmeyen sorulara da cevap verebilir. Grupta bot adını değil Telegram kullanıcı adını kullanır. Grup içinde başka öğrencilerin mesajları senin sohbet bağlamına girmez; bot sana cevap verirken yalnız senin mesajlarını ve sana verilen cevapları kullanır.

## 7. Ne kadar süre saklanır

Süreler sistemin saklama tablosundan okunur ve bu metne otomatik yazılır; süre değişirse metin yeni sürümle yayımlanır ve grup bildirimi güncel süreyle yeniden gönderilir. Tam tablo saklama politikasındadır.

| Veri | Süre |
| --- | --- |
| Sohbet mesajlarının içeriği | {{RETENTION_MESSAGES_DAYS}} gün sonra silinir |
| Yapay zekâya gönderilen tam bağlam (prompt) | {{RETENTION_PROMPT_DAYS}} gün sonra boşaltılır; yalnız özeti (hash) ve kullanılan kayıtların numaraları kalır |
| Hafıza olguları | Süresi belirsiz olgu {{RETENTION_FACTS_DAYS}} gün sonra, süresi belli olgu bitiş tarihinde geçersiz sayılır; geçersiz olgu oluşturulmasından {{RETENTION_FACTS_EXPIRED_DAYS}} gün sonra kalıcı olarak silinir; öğrenci başına en çok 300 etkin olgu tutulur |
| Bot cevap günlüğü | {{RETENTION_BOT_RESPONSES_DAYS}} gün; eğitmenin işaretlediği cevaplar {{RETENTION_FLAGGED_DAYS}} gün |
| Sağlayıcı çağrı kayıtları (model, belirteç sayısı, maliyet) | {{RETENTION_LLM_CALLS_DAYS}} gün; yalnız toplam harcama rakamları kalır |
| Ham ders videosu ve sesi | {{RETENTION_VIDEO_DAYS}} gün sonra silinir; silindiğinde sana ve veline ayrı ayrı bildirilir |
| İsimsiz ders transkripti | Dönem kaydın kapandıktan {{RETENTION_TRANSCRIPT_DAYS}} gün sonra silinir |
| Öğrenme verisi | Dönem kaydın kapandıktan {{RETENTION_CLOSED_CLEANUP_DAYS}} gün sonra hafıza olguların silinir; {{RETENTION_LEARNING_DAYS}} gün sonra kanıt alıntıları ve seçtiğin şıklar silinir; ustalık sayıları kişiyle bağı kopmuş rastgele kimlikle kalır |
| Kimlik verileri (ad, doğum yılı, veli iletişimi) ve kilitli alandaki Telegram kimliği eşlemesi | Üyelik boyunca; silme talebinden {{RETENTION_ANONYMIZE_DAYS}} gün sonra silinir. Grup üyelik ve yönlendirme kayıtlarındaki (`chat_roles`) sayısal Telegram kimliğinin de aynı işle silinmesi [hukukçu ve M02 doğrular]. Talep olmadan üyeliğin sona ermesinden sonraki süre [üyelik + 1 yıl önerisi; hukukçu doğrular] |
| Denetim izi | {{RETENTION_AUDIT_DAYS}} gün |

Depolama alanı daralırsa sistem mesaj saklama süresini kısaltabilir; bu durumda grup bildirimi yeni süreyle yeniden gönderilir. Süreler hiçbir zaman bu metinde yazandan uzatılmaz; uzatma ancak yeni metin sürümü ve yeni onayla yapılır.

## 8. Hakların (KVKK m.11)

Veri sorumlusuna başvurarak:

- kişisel verilerinin işlenip işlenmediğini öğrenme,
- işlenmişse buna ilişkin bilgi talep etme,
- işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,
- yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,
- eksik veya yanlış işlenmişse düzeltilmesini isteme,
- KVKK m.7'deki şartlar çerçevesinde silinmesini veya yok edilmesini isteme,
- düzeltme, silme ve yok etme işlemlerinin aktarıldığı üçüncü kişilere bildirilmesini isteme,
- münhasıran otomatik sistemlerle analiz edilmesi sonucu aleyhine bir sonucun ortaya çıkmasına itiraz etme,
- kanuna aykırı işleme nedeniyle zarara uğraman hâlinde zararın giderilmesini talep etme

haklarına sahipsin. Ustalık değerleri ve kavram yanılgıları her zaman kaynağıyla (hangi soru, hangi ders anı) gösterilir; yeterli kanıt yoksa yüzde yazılmaz. Bir değerlendirmeye katılmıyorsan eğitmenine söyleyebilirsin; eğitmenin düzeltmeyi panelden kanıtıyla birlikte kaydeder.

Onayını istediğin zaman geri alabilirsin. Geri alma, o ana kadar yapılan işlemenin hukuka uygunluğunu etkilemez; geri aldıktan sonra mesajlarının içeriği saklanmaz ve yapay zekâya gitmez.

## 9. Başvuru yolu

- Telegram'da `/sil` yazarsan silme talebin koordinatöre iletilir; kimlik verilerin ve mesaj içeriklerin {{RETENTION_ANONYMIZE_DAYS}} gün içinde silinir, öğrenme verisi kişiyle bağı kopmuş rastgele kimlikle kalır (bu tercih hukuki incelemeye açıktır).
- `/gizlilik` komutu bu metnin çocuk diliyle yazılmış kısa özetini gösterir; metnin tamamı eğitmen panelinde ve [yayın adresi] adresinde durur.
- Diğer başvurular için [KVKK başvuru e-postası] adresine ya da [posta adresi] adresine yazılı başvuru yapabilirsin. Başvurular KVKK m.13 uyarınca en geç otuz gün içinde ücretsiz cevaplanır; işlem ayrıca bir maliyet gerektirirse Kurul'un belirlediği tarife uygulanabilir.
- Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ'deki bilgiler (ad, soyad, imza, T.C. kimlik numarası veya yabancılar için uyruk ve kimlik numarası, adres, varsa e-posta, talep konusu) başvuruda bulunmalıdır. 18 yaş altındaysan başvuruyu velin ya da vasin de yapabilir. Başvuru sonucundan memnun kalmazsan Kişisel Verileri Koruma Kurulu'na şikâyet hakkın vardır.

## 10. Onay ekranı özeti (en çok 4 satır)

Bot `/start` sırasında bu dört satırı gösterir; altında "Metni oku", "Onaylıyorum" ve "Şimdi değil" düğmeleri durur.

<!-- ogrenmen:onay-ozeti:start -->
Öğrenmen bir yapay zekâ öğretmenidir; sohbetlerini kaydeder ve {{RETENTION_MESSAGES_DAYS}} gün sonra siler.
Adın, okulun ve Telegram kimliğin yapay zekâya giden metinlere eklenmez; orada rastgele bir kimlikle temsil edilirsin.
Hocaların sohbetlerini ve öğrenme profilini görür; not, puan ve devamsızlığı yapay zekâ değil hocan söyler.
İstediğin zaman /sil yazarak verilerinin silinmesini isteyebilirsin.
<!-- ogrenmen:onay-ozeti:end -->

## 11. Verilerin nasıl kullanılıyor?

Bu bölüm çocuğun anlayacağı dille yazılmıştır; `/gizlilik` komutu yalnız aşağıdaki işaretler arasını gösterir.

<!-- ogrenmen:cocuk-dili:start -->
Ben bir yapay zekâ öğretmenim; sana daha iyi yardım etmek için bana yazdıklarını hatırlarım ve mesajlarını {{RETENTION_MESSAGES_DAYS}} gün sonra silerim.
Adın, okulun, sınıfın ve telefon numaran yapay zekâ şirketlerine giden yazılara eklenmez; orada yalnız rastgele bir kodla tanınırsın.
Hocaların nerede iyi olduğunu ve nerede takıldığını görür, böylece sana doğru yerden yardım eder.
Fikrini değiştirirsen /sil yazabilirsin; adın ve mesajların silinir.
<!-- ogrenmen:cocuk-dili:end -->
