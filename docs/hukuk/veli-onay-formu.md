> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz

```yaml
doc_version: 2026-10-v1
doc_kind: veli_onay_formu
legal_texts_kind: veli_onayi
effective_from: 2026-11-01
status: taslak
```

# Veli / Vasi Açık Rıza Formu — Öğrenmen

Bu form 18 yaşını doldurmamış öğrenciler için velinin veya vasinin açık rızasını alır. Öğrenmen, yaşını bilmediği her öğrenciyi 18 yaş altı sayar; veli onayı gelmeden öğrenciyle sohbet başlamaz, öğrencinin mesajlarının içeriği saklanmaz ve yapay zekâya gönderilmez. Formda önceden işaretli hiçbir kutu ya da seçili düğme yoktur. Onay üç yoldan biriyle kaydedilir: velinin kendi Telegram hesabından geçerli bir `/veli KOD` göndermesi, web onay sayfasında adını ve öğrenciyle ilişkisini yazıp "Onaylıyorum" düğmesine basması ya da kâğıt formu imzalaması (bölüm 3).

Köşeli parantez içindeki alanlar hukuki inceleme sırasında ya da form doldurulurken tamamlanır.

## 1. Taraflar

- Veri sorumlusu: easy, [ticari unvan], [adres]; KVKK başvuru kanalı [KVKK başvuru e-postası].
- Öğrenci: [ad soyad] (sistemde `s_` ile başlayan rastgele bir kimlikle temsil edilir).
- Veli / vasi: [ad soyad], öğrenciyle ilişkisi [anne / baba / vasi], iletişim [telefon veya e-posta].

Velinin adı, yakınlığı ve iletişimi yalnız bu onay sürecini yürütmek ve veliye bildirim göndermek için, Supabase'deki (Almanya) kilitli bir alanda (`secure` şeması) saklanır; hiçbir yapay zekâ sağlayıcısına gönderilmez.

## 2. Neye onay veriyorsunuz

Onay vermeden önce aydınlatma metnini okumanız beklenir; metnin tamamı onay sayfasında ve /gizlilik komutuyla açılır. Onayınız aşağıdaki kapsamı içerir:

1. **Sohbet kaydı.** Öğrencinin Öğrenmen ile özel sohbetteki ve Öğrenmen'in bulunduğu grup sohbetlerindeki mesajları kaydedilir ve {{RETENTION_MESSAGES_DAYS}} gün sonra silinir. Yapay zekâ bu mesajların yalnız ad, telefon, e-posta ve benzeri kişisel bilgilerden temizlenmiş kopyasını okur. Yapay zekâya gönderilen tam bağlam {{RETENTION_PROMPT_DAYS}} gün sonra boşaltılır.
2. **Öğrenme profili.** Çözülen sorulardan, sohbetten ve eğitmenin onayladığı ders raporlarından kazanım başına ustalık değeri, açık kavram yanılgıları ve hafıza olguları (söz verilen ödev, teslim tarihi, sorulan konu, moral göstergesi) çıkarılır. Hiçbir değer kanıtsız gösterilmez; kanıt sayısı eşiğin altındaysa yüzde yazılmaz. Hafıza olguları en geç {{RETENTION_FACTS_DAYS}} gün sonra geçersiz sayılır. Dönem kaydı kapandıktan {{RETENTION_LEARNING_DAYS}} gün sonra kanıt alıntıları silinir, ustalık sayıları kişiyle bağı kopmuş hâlde kalır.
3. **Ders kaydı analizi (isteğe bağlı, ayrı onay).** Birebir ders kayıtlarından ses ve birkaç ekran karesi alınır, transkript çıkarılır, transkriptteki adlar silinir ve güçlü bir yapay zekâ modeliyle ders raporu üretilir; rapor eğitmen onaylamadan profile işlenmez. Ham kayıt {{RETENTION_VIDEO_DAYS}} gün sonra silinir ve size bildirilir; isimsiz transkript dönem bitiminden {{RETENTION_TRANSCRIPT_DAYS}} gün sonra silinir. Ayrıntı ders kaydı bildirimindedir. Bu onay verilmezse koordinatör ve eğitmen dersi analize göndermez; diğer hizmetler etkilenmez.
4. **Yurt dışına aktarım.** Öğrencinin isimden temizlenmiş sohbet metni, hafıza olguları ve öğrenme profilinin isimsiz özeti; ders kaydı onayı verildiyse ayrıca ders sesi, isimsiz transkript ve ekran kareleri Türkiye dışındaki sağlayıcılara gönderilir: Google (Gemini API; ABD ve Google'ın küresel veri merkezleri), Groq (ABD), Cloudflare (küresel ağ), OpenRouter (ABD), GitHub (ABD; gece toplu işleri ve şifreli yedek) ve Supabase (Almanya, AB; veritabanı ve dosya depolama, kilitli alandaki kimlik verileri dahil). Gemini'nin ücretsiz katmanı sohbette yedek olarak, bütçe tavanı aşıldığında sohbetin tamamında, ayrıca ders sesinin yazıya dökümünde kullanılır; bu katmanda sağlayıcı gönderilen veriyi ürün eğitiminde kullanabilir. Ders sesi, derste söylenen adları içerebilir. Ülke, veri türü, dayanak ve sözleşme bağlantıları yurt dışı aktarım belgesindedir.

Kapsam dışı: Öğrenmen not, puan, devamsızlık ve ödeme hakkında konuşmaz; bu konular eğitmene iletilir. Öğrencinin adı, okulu ve Telegram kimliği yapay zekâ sağlayıcılarına giden metinlere hiçbir zaman eklenmez (ders sesi için madde 3 ve 4). Veriler pazarlama amacıyla kullanılmaz ve satılmaz.

## 3. Onay nasıl verilir ve kimlik nasıl doğrulanır

Öğrenmen'in kendisi veli onayı üretemez ve yazamaz; onay yalnız koordinatörün ürettiği tek kullanımlık bir kod veya bağlantıyla ya da kâğıt formla kaydedilir. Öğrenmen kimlik belgesi doğrulaması yapmaz; aşağıdaki yollar kodun veya formun doğru kişiye ulaştığı varsayımına dayanır (hukuki inceleme maddesi).

| Yol | Nasıl işler | Doğrulama ve sınırlar |
| --- | --- | --- |
| Telegram kodu | Koordinatör tek kullanımlık bir kod üretir (72 saat geçerli) ve öğrenciye ya da doğrudan veliye verir. Veli **kendi** Telegram hesabından Öğrenmen'e `/veli KOD` yazar. Geçerli kod gönderildiği anda onay kaydedilir; bu yolda ayrıca düğme ya da kutu gösterilmez. Kodla birlikte veliye bu formun metni ya da bağlantısı verilir ve kodu göndermenin bölüm 5'teki zorunlu beyanlar anlamına geldiği yazılır [hukukçu doğrular]. | Kod sistemde yalnız tek yönlü özetiyle (hash) tutulur ve bir kez kullanılabilir. Öğrencinin kendi Telegram hesabından girilirse reddedilir; öğrenci kendi velisi olamaz. Velinin Telegram kimliği yalnız kodun kullanım kaydında tutulur; veli sistemde öğrenci olarak kaydedilmez. |
| Web bağlantısı | Koordinatör velinin iletişim bilgisine tek kullanımlık bir bağlantı gönderir. Açılan sayfa bu formun metnini, veli adı ve öğrenciyle ilişki alanlarını ve "Onaylıyorum" / "Şimdi değil" düğmelerini gösterir; veli adını ve ilişkisini yazıp "Onaylıyorum" düğmesine basınca onay kaydedilir. Sayfa bölüm 5'teki kutuları göstermiyorsa düğme metninin yanında zorunlu beyanlar yazılır [panel (M11) ve hukukçu doğrular]. | Bağlantı 72 saat geçerlidir ve bir kez kullanılır; beş başarısız denemede bir saat kilitlenir. |
| Kâğıt form | Veli bu formun basılı hâlini imzalar; koordinatör veya öğrencinin eğitmeni panelden "Kâğıt onay gir" ile form numarasını kaydeder. | İmzalı form kurumda saklanır; sistemde form numarası, kaydı giren personel ve kayıt zamanı tutulur. |

Ders kaydı analizi onayı Telegram kodu veya web bağlantısıyla verilmez; kâğıt formdaki ayrı kutuyla ya da koordinatörün panelden kaydıyla alınır.

Hangi yol kullanıldıysa sistem şunları kaydeder: onayın türü, hangi metin sürümünü kapsadığı, zaman damgası, yol (kod, bağlantı, kâğıt veya panel) ve kanıt (kod kaydı, bağlantı kimliği veya form numarası). Bu kayıt denetim izine düşer ve {{RETENTION_AUDIT_DAYS}} gün saklanır.

## 4. Onayı geri alma

- Veli, koordinatöre başvurarak onayı her zaman geri alabilir; koordinatör panelden onayı iptal eder. İptal anından itibaren Öğrenmen öğrenciyle sohbet etmez, yeni mesajların içeriği saklanmaz ve yapay zekâ çağrılmaz.
- Geri alma, geri alma anına kadar yapılan işlemenin hukuka uygunluğunu etkilemez.
- Verilerin silinmesi istenirse öğrenci `/sil` yazabilir ya da veli koordinatöre başvurabilir; kimlik verileri ve mesaj içerikleri {{RETENTION_ANONYMIZE_DAYS}} gün içinde silinir, öğrenme verisi kişiyle bağı kopmuş hâlde rastgele kimlikle kalır (bu tercih hukuki incelemeye açıktır).
- Ders kaydı analizi onayı tek başına geri alınabilir; bu durumda yeni ders kayıtları analiz edilmez ve koordinatör bekleyen ham kayıtların silinmesini başlatır.

## 5. Beyan

Bu kutulu beyan **kâğıt form** içindir; web onay sayfası kutuları gösterirse aynı kural orada da geçerlidir (panel modülü eklerse). Telegram kodu ve web bağlantısı yolunda zorunlu beyanlar bölüm 3'te anlatıldığı gibi kodla ya da düğmeyle birlikte verilir.

Kutular boş gelir; veli her birini kendisi işaretler. 1., 2. ve 4. kutu zorunludur: bu üçü işaretlenmemiş bir kâğıt form kayda alınmaz; formu panelden giren koordinatör ya da eğitmen kayıttan önce bunu denetler. 3. kutu isteğe bağlıdır ve yalnız kâğıt formda yer alır.

- [ ] 1. Aydınlatma metnini okudum; sohbet kaydı ve öğrenme profili için açık rıza veriyorum (zorunlu).
- [ ] 2. Bölüm 2 madde 4'te yazılan yurt dışına aktarım için, Gemini ücretsiz katmanının veriyi ürün eğitiminde kullanabileceğini bilerek açık rıza veriyorum (zorunlu; hizmet bu aktarım olmadan çalışmaz [rızanın hizmet şartına bağlanması hukukçuya sorulur]).
- [ ] 3. Ders kaydı analizi için ayrıca açık rıza veriyorum (isteğe bağlı; yalnız kâğıt form).
- [ ] 4. Onayımı istediğim zaman geri alabileceğimi ve geri almanın geçmişe etkili olmadığını anladım (zorunlu).

Veli / vasi adı: [ ] · İlişki: [anne / baba / vasi] · Tarih: [ ] · İmza (kâğıt form): [ ] · Form no: [ ]

Düğmeler (yalnız web onay sayfası): **Onaylıyorum** · **Şimdi değil**

Web sayfasında "Şimdi değil" seçilirse hiçbir onay kaydı oluşmaz; öğrenciyle sohbet başlamaz ve koordinatör gerekirse yeni bir kod ya da bağlantı üretebilir. Telegram yolunda veli kodu göndermezse onay kaydı oluşmaz.

## 6. Öğrenciye ve veliye gösterilen kısa metinler

Bot metinleri `telegram.md` kurallarına uyar: en çok dört satır, ünlem ve emoji yok; öğrenciye "sen", veliye "siz" diye hitap edilir.

Öğrenciye (`awaiting_guardian` durumunda):

> Velinin onayı gerekiyor. Koordinatörden aldığın kodu velin kendi Telegram hesabından `/veli KOD` ile girebilir ya da sana gönderilen bağlantıyı açabilir.

Veliye (kod kabul edildiğinde):

> Onayınız kaydedildi.

Öğrenciye (veli onayı gelince):

> Velin onayladı, başlayabiliriz.

Veliye (kod geçersiz ya da süresi dolmuşsa):

> Kod geçersiz ya da süresi dolmuş; koordinatörden yeni kod isteyebilirsiniz.
