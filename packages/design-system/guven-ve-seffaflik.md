# Güven ve şeffaflık

Öğrenmen yapay zekâ olduğunu, neye dayandığını ve neyi bilmediğini her zaman söyler. Bu bölüm arayüzün hangi iddiayı hangi kanıtla sunabileceğini belirler.

## Kanıt olmadan teşhis yok

- Bir kazanımda gözlem sayısı eşiğin (varsayılan 5) altındaysa `MasteryMeter` yüzde göstermez; "Henüz yeterli kanıt yok" yazar. Dolgu yok, tahminî değer yok.
- Her ustalık değeri, kavram yanılgısı ve ders raporu maddesi en az bir `EvidenceQuote` taşır: alıntı ve kaynak (ders kaydı zaman damgası, soru numarası, sohbet mesajı). Kanıtı olmayan iddia gösterilmez.
- Kavram yanılgısı çözülene kadar "Açık" kalır; "✓ Çözüldü" yalnızca yeni kanıt ve eğitmen onayıyla.
- Ders raporu eğitmen onaylamadan öğrenci profiline işlenmez; öğrenciye "raporun hazırlanıyor" denir, taslak gösterilmez.

## Tahmin değil öncelik

- Sınav modellemesi "tahmin" kelimesini kullanmaz. Başlık her zaman "Sıklık analizine göre öncelikler"; her `ExamPriorityRow` kaç yılın kaçında çıktığını ve kanıt sayısını yazar.
- Geçmiş sınav soruları uygulamada yeniden yayınlanmaz; yalnızca istatistik ve özgün varyant. Kanıt bağlantısı eğitmen arşivine gider.
- "Bu soru çıkacak", "kesin", "garanti" ifadeleri hiçbir yüzeyde yer almaz.

## Atıflar

- `CitationCard` yalnızca Crossref'te çözümlenmiş DOI ile "✓ Crossref doğruladı" taşır. Çözümlenmeyen DOI öğrenciye hiç gösterilmez; araştırma incelemesinde `danger` kenarla "kaldırılacak" diye durur.
- Atıf sırası: yazarlar · yayın · yıl; DOI `code` stilinde ve tıklanabilir. Özet (`tldr`) tek cümledir ve kaynağın iddiasını aşmaz.

## Yapay zekânın sınırları

- Yapay zekâ not, puan, devamsızlık yazmaz ve bunlar hakkında konuşmaz; böyle bir soru `Notice` `handoff` ile eğitmene gider ve kime iletildiği yazılır.
- Her yapay zekâ cevabı kimliğini taşır (`TutorMessage` "AI öğretmen"). Yapay zekâ ile üretilen ders, soru ve şekil `ai` rozeti ya da `FigureFrame` denetim durumu taşır; "Öğrenmen sana göre hazırladı" notu gizlenmez.
- Denetimden geçmemiş şekil ve soru öğrenciye gösterilmez; onay kuyruğunda `warning` "Onay bekliyor" ile bekler.
- Bot emin değilse bunu söyler: "Bundan emin değilim; hocana soralım." Emin görünmek için cümle kurmaz.

## Kişisel veri ve onay

- Kayıt bildirimi: gruba katılan herkes `Notice` `legal` ile bilgilendirilir — "Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve 90 gün sonra silinir." Yazılan süre gerçek saklama süresiyle aynıdır; süre değişirse metin değişir.
- 18 yaş altı için veli onayı alınmadan sohbet başlamaz. Onay ekranı `legal` tonunda, tek sayfa; başlıklar `title-3`, metin `body`; kabul düğmesi `primary` "Onaylıyorum", vazgeçme `quiet` "Şimdi değil". Önceden işaretli kutu yok.
- Arayüz öğrencinin adını gösterebilir; yapay zekâya giden bağlamda ad, okul ve sınıf yer almaz. Bu, "Verilerin nasıl kullanılıyor?" bağlantısı altında tek paragrafla, çocuğun anlayacağı dille anlatılır.
- Ham ders videosu silinince öğrenciye ve veliye söylenir; transkriptin kaldığı da.

## Ses

- Mikrofon yalnızca öğrenci düğmeye basılı tutarken açıktır; otomatik açılma, sürekli dinleme yok.
- Ses düğmesi `Button` `secondary`; basılıyken `primary` dolgu ve "Dinliyor" etiketi, bırakınca "Gönderildi". Dinleme süresi göstergesi `ink-muted` küçük metin.
- Sesli yanıt varsayılan kapalıdır; öğrenci açar. Sesli yanıt verilen her mesajın metni de ekranda durur.
