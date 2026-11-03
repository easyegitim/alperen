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

- Her yapay zekâ cevabı kimliğini taşır (`TutorMessage` "AI öğretmen"). Yapay zekâ ile üretilen ders, not, soru ve şekil `ai` rozeti ya da `FigureFrame` denetim durumu taşır; "Öğrenmen sana göre hazırladı" notu gizlenmez.
- Denetimden geçmemiş şekil ve soru öğrenciye gösterilmez; onay kuyruğunda `warning` "Onay bekliyor" ile bekler.
- Bot emin değilse bunu söyler: "Bundan emin değilim; hocana soralım." Emin görünmek için cümle kurmaz. Konu eğitmenin kararıysa (not, devamsızlık, puan) `Notice` `handoff` ile eğitmene gider ve kime iletildiği yazılır.
- Yanıt modu öğrencinindir: varsayılan İpucu, öğrenci "Açıkla" ya da "Çözümü göster"e geçer; sistem modu kendiliğinden açmaz.
- Yapay zekâ iddiaları geri alınabilir ve düzeltilebilir: hafıza dosyaları görünür ("Düzeltme iste"), öğrenci teşhisi düzeltebilir.

## Kişisel veri

- Arayüz öğrencinin adını gösterebilir; yapay zekâya giden bağlamda ad, okul ve sınıf yer almaz (sade ad hash'leme). Bu, "Verilerin nasıl kullanılıyor?" bağlantısı altında tek paragrafla, çocuğun anlayacağı dille anlatılır.
- Hukuk ve onay metinleri şimdilik üründe yoktur. Eklendiklerinde `Notice` `legal` tonuyla gösterilir; yazılan saklama süresi gerçek süreyle aynıdır, süre değişirse metin değişir; önceden işaretli onay kutusu olmaz.
- Veli yalnızca çocuğunun raporlarını, özetlerini ve bildirimlerini görür; ham koç sohbetini, cevap anahtarını ve ham yüklemeleri görmez.
- Ham ders videosu silinince eğitmene söylenir; transkriptin kaldığı da.

## Kamera ve yükleme

- Kamera yalnızca öğrenci "Fotoğraf çek" düğmesine bastığında açılır; otomatik açılma yok. Her sayfa gönderilmeden önce önizlenir; öğrenci döndürebilir ve kaldırabilir.
- Yüklenen fotoğraf soruyu ve çözümü okumak içindir; "Çözümüm de var" işaretlenmezse sayfalar yalnızca soru sayılır.
