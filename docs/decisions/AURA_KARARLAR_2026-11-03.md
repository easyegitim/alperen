# Aura: Konsolide Ürün Kararları

Claude Code için uygulama brifi · 3 Kasım 2026 · Hazırlayan: Claude (Cowork)

Bu belge 3 Kasım 2026'ya kadar verilen ürün kararlarını tek yerde toplar. Paywall çalışması (PDF) ile geri bildirim kartlarının iki turu çapraz kontrol edildi. Bulunan 17 çelişkinin hepsi 3 Kasım gecesi Burhan tarafından karara bağlandı (§10). Açık sorular §11'de.

## Kaynaklar ve kısaltmalar

| Kısaltma | Kaynak |
|---|---|
| P#1–P#23 | "Aura paywall çalışması: sohbet özeti" (PDF, 3 Kasım 2026) içindeki 23 paywall kararı |
| P§n | Aynı PDF'in n. bölümü (P§1 ürün kuralları ve mock-up'lar, P§4 yaş derecesi, P§6 açık sorular, P§7 riskler) |
| R1-xx | Geri bildirim kartları 1. tur, 29 kart (G1–G6, E1–E15, W1–W8) |
| R2-xx | Geri bildirim kartları 2. tur, 44 kart (C1–C16 cevaplar, K1–K21 SPEC kuralları, Ö1–Ö7 Claude önerileri); 43 kayıt var, K7 boştu (Ç3 ile karara bağlandı) |
| Çn | §10'daki çelişki ve kararı (3 Kasım 2026) |
| SPEC | Repo özeti `aura-app-context.md` (repo'nun 2 Kasım durumu). `docs/SPEC.md` bu çalışmada doğrudan okunmadı |
| UYUM | Aura uyum notları (hukuk görüşü değildir) |
| SKOR | Skor dürüstlüğü raporu |
| TDB | Tavsiye veritabanı: `aura-kusur-taksonomisi.tsv` (660 kusur), `aura-yontem-kutuphanesi.tsv` (867 yöntem) |
| AUP | Anthropic Kullanım Politikası, yürürlük 12 Kasım 2026 |

PDF'te anılan "seçenek kataloğu" artifact'i bu hesaptan açılamadı; paywall kararları PDF'teki tablodan alındı.

## 0. Claude Code için kullanım

1. Bu belge `docs/SPEC.md` ya da `CLAUDE.md` ile çelişirse bu belge geçerlidir. SPEC'i bu belgeye göre güncellemek ayrı bir iştir.
2. Kod yazmadan önce bu belgeye göre bir uygulama planı çıkar ve onaya sun (R1-G6: önce plan, sonra kod).
3. Etiketler:
   - **KARAR**: kullanıcının açık kararı. Uygula.
   - **ONAYLI ÖNERİ**: Claude önerdi, kullanıcı kartta "Evet" ya da "Kalsın" dedi. Uygula.
   - **CLAUDE NOTU**: PDF'teki Claude uygulama notu ya da ön değerlendirme; kullanıcı kararı değil. Mantıklı varsayılan olarak uygula, teyit listesine ekle.
   - **ÖNERİ**: karar kaydı olmayan Claude önerisi. Uygulamadan önce sor.
   - **AÇIK**: karar yok. Kesinleştirmeden sor; gerekiyorsa yer tutucu bırak.
   - **Çn**: §10'da karara bağlanan çelişki. Karar geçerlidir.
4. Repo kuralları aynen geçerli: `claude/...` dalı; push, merge, deploy, migration, canlı ödeme ve ücretli toplu AI işleri için açık onay.
5. Bu belgedeki teknik varsayımları (ör. Claude API parametreleri) kodlamadan önce güncel dokümandan doğrula.

## 1. Özet

- Ödemeden önce yalnız cihazda analiz yapılır: kalite kontrolü, yüz noktaları, 4 oran, yüz şekli. LLM analizi yalnız ödemeden sonra çalışır. Tek istisna: 5 davetle yalnız genel skor açılır. (P§1, P#15, Ç12)
- Akış: yaş (serbest) → cinsiyet → hesap (Google/Apple) → rızalar → fotoğraflar (ön + yan zorunlu) → cihaz analizi → kilitli sonuç → paywall → ödeme → kart kart açılış. (P#1–P#23, R2-C13)
- Diğer anket soruları ödeme sonrasına taşındı. Skor yalnız yaş, cinsiyet ve fotoğraflara dayanır. (R1-E4, R2-C13, R2-C14)
- Analizin merkezinde Claude: serbest rapor, puan cetveli, 3 çalıştırmanın ortancası, denetim adımı. Süre sınırı yok, kalite öncelikli. (R2-C1, R2-C2, Ç16)
- Aynı fotoğraf seti 1 yıl boyunca aynı skoru alır (bayt bayt aynı dosyalar için). (R2-C2 notu, Ç11)
- Skor tek ondalıkla gösterilir; açıklamada aralık verilir; genel skorda normal dağılım üzerinde yüzdelik gösterilir. (R2-K5, R2-K4, Ç6)
- Öneriler SPEC kataloğundan ve 867 yöntemlik kütüphaneden gelir; doktor katmanı kişiye özel ilaç ve işlem önerir, her öneriyi önce bir hekim inceler. (Ç2, Ç3)
- Paywall: kısa paywall ve fayda maddeleri, illüstratif önce/sonra, gerçek süreli teklif, tanıtım fiyatı, tek seferlik rapor + haftalık + aylık, garanti yok. (P#16–P#22)
- Gelir: uzman ve doktor yönlendirmesi ile uygulama içi ürün referansı için altyapı kurulur; ücret ve komisyon hukuk görüşüne kadar kapalı. (R2-C6, R2-C16, Ç4)
- Yaş sınırı yok; 18 altına doktor katmanı, yağ oranı ve aralıklı oruç önerileri gösterilmez. (R2-K20, P#1, Ç1)

## 2. SPEC'ten değişenler

| Konu | SPEC (2 Kasım) | Yeni | Kaynak |
|---|---|---|---|
| Ücretsiz kullanım | Hesap başına 1 ücretsiz analiz ve teaser | Ücretsiz analiz yok; ödeme öncesi yalnız cihaz analizi ve kilitli sonuç | P§1, R2-Ö5 |
| LLM kullanımı | Analizin her aşamasında | Yalnız ödemeden sonra; tek istisna davetle açılan genel skor | P§1, P#15, Ç12 |
| Hesap | Anonim oturum; hesap paywall'da bağlanır | Taramadan önce Google ya da Apple ile | P#2 |
| Yaş | Yalnız 18+ (yaş kapısı) | Serbest; 18 altına doktor katmanı ve kilo önerileri kapalı | P#1, R2-K20, Ç1 |
| Anket | Ödeme öncesi 8–12 soru | Ödeme öncesi yalnız yaş ve cinsiyet | R1-E4, R2-C13 |
| Fotoğraf | Tek selfie | Ön + yan profil zorunlu; 45° ×2, profil ×2, saç çizgisi isteğe bağlı | P#4 |
| Skor motoru | legacy (Gemini) ya da hybrid.v1 | Claude merkezli | R2-C1 |
| Yüzdelik | Yok | Genel skorda, normal dağılım üzerinde | R2-K4, Ç6 |
| Skor gösterimi | Tek ondalık | Tek ondalık + açıklamada aralık | R2-K5 |
| Planlar | Haftalık ₺250, aylık ₺750, yıllık ₺8.750 | Tek seferlik rapor + haftalık + aylık; yıllık plan ve fiyatlar AÇIK | P#21 |
| Rapor yeniden üretimi | Rapor başına 2 ücretsiz | Ücretli; ücretsiz üretim yok | R2-C4 notu, Ç10 |
| YZ görsel etiketi | "Yapay zekâ ile oluşturuldu." | "Aura ile oluşturuldu · YZ simülasyonu" | R1-E9, R2-K16 |
| İlaç ve klinik işlem (K7) | Önerilmez | Doktor katmanında kişiye özel, hekim onaylı | Ç3 |
| Öneri kaynağı (K6) | Yalnız katalog | SPEC kataloğu + yöntem kütüphanesi; rapor metni serbest | R2-K6, R2-C1, Ç2 |
| Deneme kuralı (K15) | Yalnız saç, sakal, renk | Aynı; "iyileşmiş halin" görselinde plana bağlı cilt değişimi de gösterilir | Ç9 |
| Uzman Ağı | Hukuk görüşüne kadar tamamen kapalı | Altyapı kurulur; ücret ve komisyon hukuk görüşüne kadar kapalı | R2-C6, R2-K18, Ç4 |
| Ürün referansı | P1 (lansmandan sonra) | Mümkün olan her öneride ürün ya da uzmana yönlendirme | R2-C6, R2-C16 |
| Analiz süresi | p95 < 10 sn | Ödeme sonrası açılışta süre sınırı yok | Ç16 |
| Garanti | Tanımlı değil | Yok, duyurulmaz | P#22 |

## 3. Kullanıcı akışı

### 3.1 Ödemeden önce (cihazda, LLM yok)

1. **Yaş** — KARAR: Umax'teki gibi serbest liste (ör. 18 altı, 18–24, 25–34, 35–49, 50+). Yaş sınırı yok. 18 altı seçenler için doktor katmanı (ilaç, klinik işlem, cerrahi), yağ oranı ve aralıklı oruç önerileri gösterilmez. Veli izni ve mağaza yaş derecesi avukatla netleşir (AÇIK). (P#1, R2-K20, Ç1)
2. **Cinsiyet** — KARAR: erkek / kadın / belirtmek istemiyorum. (R2-C13, SPEC)
3. **Hesap** — KARAR: taramadan önce Google ya da Apple ile giriş. E-posta ile giriş kalacak mı: AÇIK. (P#2)
4. **Rızalar** — KARAR: aydınlatma metni ve analiz için açık rıza, ayrı metinle. Kısaltılamaz. (R2-C13, UYUM)
5. **Fotoğraflar** — KARAR (P#4; R2-C5 notu bu karara yönlendiriyor):
   - Zorunlu: ön ve yan profil.
   - İsteğe bağlı, isteğe bağlı olduğu ve kaliteyi artıracağı yazılarak: 45° yarım profil ×2, profil ×2, saç çizgisi ×1. Zorunlu yan profil iki profilden biri sayılır (yorum, teyit et).
   - P#4'teki "ve gerisini de" ifadesinin hangi fotoğrafları kastettiği AÇIK.
   - Galeriden çoklu seçim olur. (R1-E5)
   - CLAUDE NOTU (P#4): ödeme öncesi yan profilin gerçekten profil olup olmadığı kontrol edilmez; uygun değilse ödeme sonrası yeniden çekim istenir. (P§1 de "her fotoğraf kabul edilir" diyor.)
   - ÖNERİ (R2-C5, karar kaydı yok): ekran metni olarak çekim kuralları: yüz ışığa dönük, telefon kol boyu uzakta (yakın ön kamera burnu büyük gösterir), saç alından çekilmiş, gözlük çıkarılmış.
6. **Cihazda analiz** — KARAR: kalite kontrolü (yaw/pitch/roll, parlaklık, netlik), yüz noktaları, 4 oran (göz açısı, çene/elmacık genişliği, yüz genişlik-yükseklik oranı, üçte birler) ve yüz şekli. Hepsi kullanıcıya açık gösterilir. (P§1)
   - KARAR (R1-E12, R1-E14): kötü ya da karanlık fotoğrafta net bir evet/hayır pop-up'ı çıkar; sonuç yalnız kullanıcı "Evet" derse çıkar. Eşikler gevşek; uygun fotoğraf reddedilmez, ret yerine uyarı gösterilir. Önerilen metin (onay bekliyor): "Işık yetersiz ya da fotoğraf bulanık; sonuç zayıf olabilir. Yine de devam edilsin mi?"
   - Bu, P§6'daki "ön fotoğraf kalite kontrolü ödeme öncesi kalsın mı?" sorusunu cevaplıyor: kalsın, engellemesin (teyit et).
7. **Yükleme ekranı** — KARAR (P#5): gerçek cihaz adımları; adımların üstünde kullanıcının fotoğrafı; yeşil bir çubuk fotoğrafı animasyonla aşağı yukarı tarar; Umax mobildeki "fotoğraf işleniyor" ekranıyla birleşik. Son satır "Analizin tamamlandı" (CLAUDE NOTU; P§1'e göre cihazdaki analiz gerçekten bittiği için doğru bir cümle).
8. **Kilitli sonuç** — §3.3.
9. **Davetle açma** — KARAR (P#15, Ç12): 5 davet. Davet edilen 5 kişi de uygulamayı indirip fotoğraf yollarsa yalnız genel skor açılır; potansiyel, alt skorlar, rapor ve plan ödemeyle açılır. Referans koduyla. CLAUDE NOTU: "ödeme yoksa LLM yok" kuralının tek istisnası; sahte hesaplara karşı cihaz doğrulaması gerekir.
10. **Paywall** — §3.4.

### 3.2 Ödemeden sonra

1. LLM analizi çalışır; sonuç kart kart açılır, bulanıklık kartlardan tek tek kalkar (P#23, KARAR). AI süresi açılış animasyonunun arkasında kalır. Süre sınırı yok, kalite öncelikli; kartlar hazır oldukça açılır (Ç16).
2. CLAUDE NOTU (P#22): garanti duyurulmasa da AI ödeme sonrası başarısız olursa yeniden deneme akışı gerekir.
3. Gerekirse yeniden çekim istenir (ör. yan profil uygun değil). (P§1)
4. Uygulama puanlama isteği sonuç açıldıktan sonra gösterilir. (P#3, KARAR)
5. "Planını kişiselleştir" soruları — KARAR (R2-C13, R2-C14):
   - hedefler
   - bütçe (AÇIK, §6.6)
   - günde ayrılabilecek süre
   - aktivite, somut seçeneklerle: haftada kaç gün spor, masa başı ya da ayakta iş (R1-E4)
   - sakal ve saç uzunluğu tercihi, avatar üzerinde görselle (R1-E1)
   - boy ve kilo; isteğe bağlı, yağ oranı önerisi için gerekli (R2-K8)
   - çene sağlığı; egzersiz önerisi için gerekli (R2-K10)
   - gözlük ve başörtüsü (R2-C14, Ç17): cevaplar fotoğraftan tahminle dolu gelir, kullanıcı onaylar ya da değiştirir. Tahmin yoksa seçim yapılmadan saç önerisi üretilmez. R1-E3'teki hata (dokunmadan İleri'nin çalışmaması) bu yapıyla çözülür.
6. Hedef yönü sorusu — ONAYLI ÖNERİ (R2-Ö7): "Nasıl görünmek istersin?" Daha keskin ve olgun · Daha yumuşak ve genç · Olduğum gibi, daha bakımlı.
7. Alt gezinme: Analiz · Plan · Dene · Rutin · İlerleme. (P§1)

### 3.3 Kilitli sonuç ekranı (ödemeden önce)

| Öğe | Durum | Kaynak |
|---|---|---|
| Sonuç fotoğrafı | KARAR: yuvarlak; Umax mobildekinden biraz büyük; üzerinde yüz noktaları | P#6 |
| Yüz noktaları | Kullanıcı kredi harcamadan fizibilite istedi. ÖN DEĞERLENDİRME (P§6, onay bekliyor): cihazda mümkün (MediaPipe 478 nokta); yalnız ön fotoğrafta; 478 yerine 30–70 anahtar nokta; yuvarlak fotoğrafla aynı kırpma ve ölçek dönüşümü. Sınırlar: yoğun sakalda çene hattı tahmini, alın ve saç çizgisi noktası yok, profilde güvenilirlik düşer. Test başladı, bitmedi | P#6, P§6 |
| Genel skor | KARAR: herkeste aynı görünen halka + kilit (skoru ele vermez) | P#7 |
| Potansiyel | KARAR: kilitli | P#8 |
| Yüz şekli | KARAR: açık, cihaz sonucu. Ödeme sonrası detaylı analiz farklı çıkarsa ikisi birlikte ve nedeniyle gösterilir (Ç8) | P#9 |
| Alt skorlar | KARAR: adlar açık, skorlar bulanık, herkeste aynı çubuk; "Yapısal" ve "Geliştirilebilir" etiketleri silinir | P#10 |
| Cilt kartı | KARAR: diğerleri gibi bulanık; "Geliştirilebilir" etiketi kalkar | P#11 |
| Oranlar | KARAR: tamamı açık. CLAUDE NOTU: cihaz değerleri tek kaynak | P#12 |
| İlk adımlar | KARAR: 3 bulanık satır | P#13 |
| Sana özel plan | KARAR: kart + örnek stil görselleri; görseller kullanıcının fotoğrafının hafif değiştirilmiş, çok bulanık hali; sanki uygun değişiklikler bulunmuş ve uygulanmış gibi, etiketsiz (Ç13). CLAUDE NOTU: kredi harcamamak için cihazda üretilir | P#14 |
| Oran açıklaması | Mock-up metni: "Bu oranlar yalnız tarif eder; iyi ya da kötü anlamı taşımaz. Skorlamaya bağlam olarak gider." | P§1 |

Düzeltilecek tutarsızlık (P§1): kilitli ekranda cihaz "Yuvarlak · 1,73 · %31/32/36 · 0,84" gösteriyor, açık sonuç mock-up'ı "Oval · 1,90 · %33/34/33 · 0,85". Oranlar için tek kaynak cihazdır (CLAUDE NOTU). Yüz şekli için Ç8 geçerli.

### 3.4 Paywall

| Öğe | Durum | Kaynak |
|---|---|---|
| Yapı | KARAR: kısa paywall; müşterinin eline geçecekler madde madde | P#16 |
| Önce/sonra | KARAR: "İllüstratif" etiketli stok fotoğraf; cinsiyeti kullanıcının cinsiyetine göre değişir; yaşa uygun. 18 altı gruplarda 18–24 yaş görünen yetişkin model (Ç14) | P#17 |
| Geri sayım | KARAR: gerçek süreli teklif; süre bitince fiyat artar. CLAUDE NOTU: sunucuda tutulur, sıfırlanmaz; iki ayrı ürün kimliği (tanıtım ve normal) | P#18 |
| Sosyal kanıt | KARAR: lansmanda yok, yerine fayda listesi; ileride hatırlatılır, sonra gerçek veriye geçilir. Hatırlatma tarihi AÇIK | P#19 |
| İndirim | KARAR: tanıtım fiyatı | P#20 |
| Ürünler | KARAR: tek seferlik rapor (haftalıktan ucuz) + haftalık + aylık. İçerik farkı, fiyatlar, yeniden analiz hakları, tanıtım fiyatının uygulanacağı ürün, teklif süresi ve yıllık planın kalıp kalmadığı AÇIK | P#21, P§6 |
| Garanti | KARAR: yok, duyurulmaz | P#22 |
| "Ücretsiz" dili | KARAR: "analiz ücretsiz" gibi bir metin kullanılmaz; gerekirse ücretli olduğu önden söylenebilir | R2-Ö5 |
| Açılış | KARAR: kart kart | P#23 |

Riskler (P§7): sahte geri sayım ve sahte satın alma bildirimleri AB'de yasak; "gerçek süreli teklif" gerçekten bitmeli. Ödeme öncesi "hazır" ya da "uygulandı" izlenimi verip ödeme sonrası farklı sonuç göstermek şikâyet ve iade getirir. Plan önizleme görsellerinde bu risk bilerek kabul edildi (Ç13).

## 4. Analiz motoru ve skor

### 4.1 Mimari — ONAYLI ÖNERİ (R2-C1, R1-G1, R1-W6) ve KARAR

- **KARAR (R1-E4, R2-C13):** skor yalnız yaş, cinsiyet ve fotoğraflara (ve fotoğraflardan cihazda çıkan değerlere) dayanır. Ödeme sonrası anket cevapları skoru değiştirmez, yalnız planı kişiselleştirir.
- **Gözlem ve rapor:** Claude bütün fotoğraflara bakar ve bir güzellik uzmanı gibi serbest yazar. Önerdiği ürün, stil, yöntem ve işlemler SPEC kataloğundan ya da yöntem kütüphanesinden seçilir (Ç2).
- **Puan:** her alt skor, seviyeleri yazılı tarif edilmiş bir puan cetveline göre verilir. Üç bağımsız çalıştırmanın ortancası alınır; aralarındaki fark 0,5'ten büyükse dördüncü çalıştırma yapılır. Kod sonucu ortak ölçeğe çevirir (§4.4).
- **Denetim:** rapor gösterilmeden önce ikinci bir kontrol, metni dil kurallarına (§9) ve puanla tutarlılığa karşı tarar; takılan cümle yeniden yazılır. Ek B'deki ifade listesi bu kontrol için öneridir.
- Cihaz oranları ve yüz şekli modele bağlam olarak verilir. (P§1)
- **Kıyas testi:** her sürümde aynı 20 fotoğraf hem Aura'ya hem düz Claude'a verilir; ekip hangisinin iyi olduğunu isimleri görmeden oylar. Aura en az %70 kazanmadan sürüm çıkmaz.
- **Süre:** sınır yok, kalite öncelikli (Ç16).
- **Maliyet:** hedef, kullanıcı başına aylık yapay zekâ maliyetinin net gelirin %10'unun altında kalması (R2-C1). hybrid.v1 bugün analiz başına yaklaşık $0,025; yeni yapıda bunun birkaç katı olur. İlk denemede ölçülür.
- **Teknik not (doğrula):** Anthropic dokümanına göre temperature 0'da bile çıktı tam deterministik değildir. `claude-opus-5-5` varsayılan dışı temperature, top_p ve top_k değerlerini kabul etmiyor (2026-10-21 API sürümü). Tutarlılık sistem tarafında sağlanmalı (§4.2).

### 4.2 Tutarlılık — ONAYLI ÖNERİ + KARAR (R2-C2, R1-W7)

1. Puan cetveli.
2. Üç çalıştırma, ortanca.
3. Puan bütün açılara birlikte bakılarak verilir.
4. Gürültü bandı: yeniden analizde ±0,3'ten küçük fark "değişim yok" diye gösterilir.
5. Sürüm kapısı: 30 kişilik test setinde aynı kişinin 5 fotoğrafı arasındaki fark en çok 0,4 (SPEC hedefi).
6. **KARAR (R2-C2 notu, Ç11):** aynı fotoğraf seti 1 yıl boyunca aynı skoru alır. Yalnız bayt bayt aynı dosyalar için uygulanabilir:
   - Anahtar: fotoğraf setindeki her dosyanın gizli anahtarlı hash'i (HMAC-SHA-256), sıralanıp birleştirilerek. Aynı set gelirse saklı sonuç döner, model çağrılmaz. Setten tek fotoğraf değişirse yeni analiz yapılır.
   - Saklanan: set hash'i, skorlar, model kimliği, cetvel ve istem sürümü, tarih. 1 yıl sonra ya da hesap silinince silinir. Fotoğraf saklanmaz (K21).
   - Sınır: yeniden kaydedilen, kırpılan dosya ya da ekran görüntüsü yeni skor alabilir. "Aynı kişi" eşleştirmesi için yüz embedding'i kullanılmaz (biyometrik veri).
   - Hash ve skor kişisel veri sayılır: aydınlatma metnine eklenir (genel bilgi, hukuk görüşü değil).
   - Model değişirse eski skorlar korunur, yeni model ayrıca kalibre edilir.
7. CLAUDE NOTU (P§1): ödeme öncesi gösterilen cihaz oranları ödeme sonrası değişmemeli. Yüz şekli için Ç8 geçerli.

### 4.3 İnsan puanlı veri — AÇIK (R2-C2 notu)

Soru: insanların başka insanlarca nasıl puanlandığını gösteren bir veritabanı bulunup Claude ya da kullanılacak yapay zekâ bununla eğitilebilir mi?

- Bulunan setler: SCUT-FBP5500 (5.500 yüz, 1–5, yüz başına 60 puanlayıcı), MEBeauty (~2.550 yüz, 1–10), Chicago Face Database ve uzantıları (1–7), CelebA (ikili "Attractive" etiketi), Boğaziçi Face Database (264 Türk yüzü, 1–7, yüz başına ortalama 66 puanlayıcı).
- Lisans: bu setlerin hepsi yalnız ticari olmayan araştırmaya izin veriyor. SCUT-FBP ve HotOrNot türevlerinin lisansı doğrulanamadı. Chicago Face Database şartları materyalin bulut ya da yapay zekâ servislerine verilmesini de ihlal sayıyor.
- Claude eğitilemez: Anthropic API'de ince ayar yok. Amazon Bedrock'taki tek seçenek (Claude 3 Haiku) 10 Eylül 2026'da kullanımdan kalktı. Google Vertex AI'da yok.
- Yol: (a) hak sahibinden yazılı ticari izin, ya da (b) açık rızayla kendi referans setini toplamak (SKOR: 300–1.000 yüz, yüz başına yaklaşık 60 puan). Veri eğitim için değil, kalibrasyon ve test için kullanılır.
- Ünlü fotoğrafları kalibrasyon ya da test setine girmez: kişilik hakları ve KVKK. (R2-C12 kartındaki uyarı)

### 4.4 Ölçek ve kalibrasyon — ONAYLI ÖNERİ, geçici (R2-C12, R1-W1, R1-G5, R2-K4 notu)

- "Dürüst sıra, yumuşak ölçek": motorun ham çıktısı referans sette sıraya çevrilir; sıra yayımlanmış sabit bir eşlemeyle 1–10'a dönüşür.
- Eşlemenin merkezi ve yayılımı yapılandırılabilir; son değerleri Claude seçer ve gerekçesini bildirir (R2-K4 ve R2-C12 notları). Başlangıç: ortanca 5,5, standart sapma 1,5. Çok çekici biri 9 küsür alabilmeli (R1-W1): SS 1,2'de en üst %1 ≈ 8,3; SS 1,5'te ≈ 9,0.
- **Geçici:** ekibin bu konuda başka bir çalışması var; ikisi kıyaslanıp biri seçilecek, gerekçesi bildirilecek (R2-C12 notu). O çalışma bu belgeye gelmedi.
- Ölçek herkese aynı uygulanır (K1). Ölçek genişleyince +1,5'lik potansiyel gerçek bir sıçrama olur (K2).
- Ortalama kullanıcı bugünkünden düşük (5–6 civarı) görür. Rakipler 7 ve üstü verdiği için sonuç ekranında bunu anlatan bir cümle olur. (R2-C12)

### 4.5 Skor gösterimi — KARAR (R2-K5 notu)

Genel skor en üstte tek ondalıkla (ör. 6,4). Aşağıdaki açıklama kısmında skor dürüstlüğü için aralık verilir (ör. 6,2–6,6) ve açıklama bu aralığa dayanır.

### 4.6 Yüzdelik — KARAR (R2-K4 notu, Ç6, Ç7)

- Yalnız genel skorda, normal dağılım (çan eğrisi) üzerinde kullanıcının yüzdeliği gösterilir. Örnek: "İnsanların %88'inden yüksek."
- Alt skorlarda yüzdelik yok. Ölçüler kartında kıyas aralıkla ve kişinin kendi geçmişiyle kalır (R2-C3).
- Ayrı bir maskülenlik ya da feminenlik skoru ve yüzdeliği yok; hedef yönünü kullanıcı seçer (Ç7, R2-Ö7).
- AUP uygunluğu Anthropic'e teyit ettirilir (§11).

### 4.7 Potansiyel — KARAR (R2-K2)

- En fazla +1,5, en çok 9,5. Her kazanç bir plan adımına bağlıdır.
- Tıbbi kozmetik işlemlerin puana etkisi yazılmaz. Yerine şu metin: "Hukuki sebeplerden dolayı tıbbi kozmetik operasyonlarının puana olacak etkisini belirtemiyoruz. Dilerseniz bu konuda uzmanımızla görüşebilirsiniz." Uzman bağlantısı, yönlendirme altyapısının flag'i açılınca görünür (Ç4).

### 4.8 Skor ekranı güvenceleri — KARAR (R2-K3)

Skor 4,0'ın altındaysa ekran önce gelişim alanlarını gösterir. Her skor ekranında şu not durur: "Bu skor yapay zekânın fotoğraf üzerinden tahminidir; ışık ve açıyla değişebilir, kişisel değerini ölçmez."

### 4.9 Skor açıklaması — ONAYLI ÖNERİ (R2-C7, R1-E6)

- Her alt skorun altında: neye baktık (2–3 gözlem) · puanı ne tuttu · puanı ne aşağı çekti (en fazla 2 madde, nötr dille) · ne yapılırsa artar (plan adımı ve tahmini etkisi) · güven notu (kaç fotoğraf, ışık).
- Yapısal alt skorlarda (yüz uyumu, göz bölgesi, çene hattı) son iki satır, bakımla değişmediğini ve saç, sakal, kaş seçimlerinin algıyı nasıl etkilediğini anlatır.
- "Yapısal" ve "Geliştirilebilir" etiketleri kilitli ekranda yok (P#10, P#11). Açık sonuçta da kaldırılması öneriliyor (teyit et); ayrım içeride kalır.
- Ağırlık formülünün ayrıntısı açıklanmaz.

### 4.10 Yüz şekli — ONAYLI ÖNERİ + KARAR (R2-C11, R1-E15, Ç8)

- Ödeme öncesi cihaz sonucu (ön fotoğraftan) "ön değerlendirme" olarak gösterilir.
- Ödeme sonrası birden çok açı kullanılır; geometri ölçer, Claude fotoğraflara bakıp yorumlar. İkisi ayrışırsa sonuç "emin değiliz" diye işaretlenir.
- Tek etiket yerine en yakın iki şekil ("Kare, ovale yakın").
- Detaylı sonuç ön değerlendirmeden farklıysa sessizce değiştirilmez; ikisi birlikte ve nedeniyle gösterilir (Ç8).
- Kullanıcı "Bence değil" deyip düzeltebilir; onun seçimi geçerli olur, saç ve sakal önerileri buna göre güncellenir.
- Test seti yok (R2-C11 notu: "test yapmayacağız").

### 4.11 Analizde yakalanacaklar (R1)

- KARAR (R1-W5): kaş ayrı değerlendirilir, puanlamada ayrı ağırlık alır ve kendi önerisini alır. Ağırlığın nasıl uygulanacağını planda öner.
- KARAR (R1-W4): yağlı saç, özensiz çekim, cilt yüzeyi gibi fotoğrafta görünen bakım detayları rapora girer ve öneriye bağlanır.
- R1-W2 ("Konuşalım"): saç dökülmesi işaretlenir; akış §6.3'te (R2-C16 notu).

## 5. Rapor — ONAYLI ÖNERİ (R2-C3, R1-W3)

İskelet:

1. Açılış mektubu: 3–4 cümle; en güçlü yan ve en büyük fırsat.
2. Bölge bölge: kaş, göz çevresi, burun, dudak ve gülüş, elmacık ve yanak, çene hattı, cilt, saç, sakal. Her bölgede önce bir somut güçlü yan, sonra fotoğrafta görülen, sonra en fazla iki fırsat. "Değişiklik gerekmez" de bir sonuçtur.
3. Ölçüler (açılır bölüm): birkaç oran, "dengeli aralık" çubuğunda kullanıcının yeriyle. Kıyas yalnız bu aralıkla ve kişinin kendi geçmişiyle; yüzdelik yalnız genel skorda (Ç6).
4. Plan (§6.1).
5. İyileşmiş halin (§7.2).
6. Kapanış: değişim haftalar sürer; ışık ve açı skoru etkiler; "Tıbbi tavsiye değildir."

Ton: önce güçlü yan; akademik ama sıcak; emin olmadığı yerde bunu söyler.

ÖNERİ: iç taksonomi adları (TDB'deki "Üst dudağın ince olması" gibi) rapora olduğu gibi geçmez; kullanıcıya nötr adla gösterilir (K12'yi uygulamak için).

**Qoves'tan almadıklarımız** (R2-C3 notu: "almadığın şeyleri bana belirt"):

| Almadığımız | Neden |
|---|---|
| Olasılık puanlı "kusur" listesi | Eleştirilerin merkezinde (MIT Technology Review, 2021); K12 |
| "Too Low" gibi yargılayan etiketler | Kişiyi yargılar; K12 |
| Uzun işlem listeleri; cerrahiyi ücretli ek olarak satmak | Tek selfie'den beş ameliyat önerisi basında eleştirildi (Guardian, Ağustos 2026); UYUM; AUP. Aura'da doktor katmanı en fazla iki öneri verir ve her öneriyi önce bir hekim inceler (Ç3) |
| Görünüşü gelire, işe, flörte bağlayan dil | Qoves ana sayfası çekici insanların daha çok kazandığını öne çıkarıyor; manipülasyon eleştirisi |
| Plana bağlı olmayan, yüzü değiştiren "sonra" görseli | Olumsuz kullanıcı yorumlarının çoğu bu (Trustpilot) |
| Selfie'den milimetre ve derece hassasiyetinde ölçüm | Sahte kesinlik; aynı raporda çelişen ölçüler eleştirildi |
| Kadınsılık-erkeksilik eksenini varsayılan hedef yapmak | Bilimsel dayanağı tartışmalı; yönü kullanıcı seçer (R2-Ö7, Ç7) |
| Etnik sınıflama ve etnik grup içi kıyas | K14 |
| "Objektif güzellik" iddiası | Bilimsel dayanağı eleştirildi; K3'teki not bunun tersini söyler |

Ayrıntı: Ek B.

## 6. Plan, öneriler, yönlendirme ve gelir

### 6.1 Plan sunumu — ONAYLI ÖNERİ (R2-C6, R1-G4) ve KARAR (Ç1, Ç3)

- Fazlar: 0–4 hafta · 1–3 ay · 3–6 ay.
- Öncelik tablosu: etki ve emeğe göre; en üstte en az emekle en çok fark yaratan adım.
- Adım kartı: ne yapılacağı, hangi gözleme bağlı olduğu, TL fiyat aralığı, sıklık, günde kaç dakika, zorluk, kanıt (§6.2).
- Üç katman: Kendin yap · Uzman (berber, estetisyen) · Doktor (ilaç, dolgu, cerrahi).
- **Doktor katmanı (Ç3):** kişiye özel ilaç ve işlem önerir. Her öneri kullanıcıya ulaşmadan önce bir hekim tarafından incelenir ve hekim öneriyi değiştirebilir; kullanıcıya önerinin yapay zekâ ile hazırlandığı açıkça söylenir (AUP). Raporda en fazla iki doktor önerisi, her biri gerekçeli. Önce beden algısı taraması (§6.4). 18 altına gösterilmez (Ç1). Hekim inceleme akışı kurulana kadar flag kapalı.
- Plan ekranı sekmeleri (mock-up): Saç · Sakal · Saç rengi · Cilt · Egzersizler. Stil kartlarında "Dene" ve "Berbere göster" düğmeleri. (P§1)

### 6.2 Kanıt gösterimi — KARAR (R2-Ö6)

Kanıt her öneride görünür ama A/B/C harfleriyle değil, müşterinin anlayacağı dille; A/B/C içeride kalır (TDB). Bu, R2-C6'daki "A/B/C" ifadesinin yerine geçer. Önerilen metin (onay bekliyor): A → "Çok sayıda çalışmada denendi", B → "Sınırlı sayıda çalışma var", C → "Uzman görüşüne dayanıyor"; yanında kaynak bağlantısı.

### 6.3 Yönlendirme ve gelir — KARAR (R2-C6, R2-C16, R2-K18, R1-W2, Ç3, Ç4, Ç5)

Kararlar:

- Doktora ya da uzmana yönlendirerek gelir elde edilecek bir yol kurulacak. Uygulama içi ürün referansı kesin olacak. (R2-C6)
- Referans mekanizması bütün tavsiyeler için geçerli: mümkün olan her konuda müşteri gereken ürüne ya da uzmana yönlendirilir. (R2-C16 notu)
- Saç dökülmesinde destek isteyen doğrudan uzmana yönlendirilir. (R2-C16 notu)
- Reklamda partner hekim yer almaz; pazarlama "yüz skoru" özelliği üzerinden yapılır. (R2-K18 notu)
- **Ç4:** uzman dizini, yönlendirme, ürün bağlantıları ve tıklama takibi altyapısı kurulur. Ücret ve komisyon, gelir modeli avukatla seçilene kadar kapalı.
- **Ç5:** ilaç önerisinde verilen link bilimsel kaynak ve TİTCK'teki resmî kullanma talimatıdır. Eczane, satış ya da marka linki ve doz yok.
- Saç dökülmesi akışı: tespit (saç çizgisi fotoğrafı varsa) → raporda nötr dille → doktor katmanında hekim onaylı öneri (Ç3) ya da bilgi kartı (TDB yöntemleri, kanıtıyla) → link (Ç5) → uzmana yönlendirme.

Kısıtlar (uygulamayı şekillendirir):

- **UYUM:** yurt içinde komisyonlu hasta yönlendirme yüksek riskli; "danışmanlık" adı altında bile yasak (Sağlık Hizmetlerinde Tanıtım ve Bilgilendirme Faaliyetleri Hakkında Yönetmelik m. 5/1; Deontoloji Nizamnamesi m. 12; 6023 sayılı Kanun m. 64). Uyum notlarına göre lisans almak bunu çözmüyor. Seçenekler: sponsorsuz dizin, sabit listeleme ücreti, yurt dışı hastalar için yetkili aracı kurum.
- **UYUM:** beşerî tıbbi ürünlerin halka tanıtımı internet dahil yasak (Beşerî Tıbbi Ürünlerin Tanıtım Faaliyetleri Hakkında Yönetmelik m. 5/3). Ç5 bu yüzden satış ve marka linkini dışarıda bırakıyor.
- **AUP** ("High-risk Use Case Requirements"): "Medical" alanı tedavi ya da ilaç önermeyi, başlatmayı, bırakmayı ve doz değiştirmeyi kapsıyor. Claude ile kişiye özel bu tür bir öneri verilecekse, öneriyi kullanıcıya ulaşmadan önce değiştirme yetkisi olan nitelikli bir kişi incelemeli ve kullanıcıya yapay zekâ kullanıldığı açıkça söylenmeli. Ç3 bu şartı uyguluyor. Kozmetik işlemler adıyla geçmiyor; aynı inceleme onlara da uygulanır.
- Kozmetik ve bakım ürünü referansı serbest; ticari bağlantı "Reklam" etiketiyle gösterilir (SPEC P1, reklam mevzuatı).

### 6.4 Beden algısı taraması — ONAYLI ÖNERİ (R2-Ö4)

Doktor katmanı gösterilmeden önce estetik kliniklerinde kullanılan türden kısa bir tarama (BDDQ benzeri, 3–4 soru). Riskli cevapta doktor katmanı kapanır, yerine bir uzmanla konuşma önerisi çıkar.

### 6.5 İçerik kuralları — KARAR (R2-K6–K11)

§9 tablosunda. K7, Ç3 ile karara bağlandı.

### 6.6 Bütçe — AÇIK (R1-E2, R2-C8)

Tutarları ekip verecek; R2-C8 "Konuşalım" olarak kaldı. Taslak (R2-C8): aylık bakım ₺1.000'e kadar / ₺1.000–2.500 / ₺2.500–5.000 / ₺5.000 üstü; tek seferlik uzman ve klinik: şimdilik yok / ₺15.000'e kadar / ₺15.000–60.000 / ₺60.000 üstü / henüz bilmiyorum. Soru ödeme sonrasında sorulur.

## 7. Dene ve "iyileşmiş halin"

### 7.1 Kombin deneme — KARAR (R1-E7)

Saç, sakal (ve renk) tek görselde denenir. Deneme kotası ve fiyatı ileride konuşulacak. (R2-C9 notu: "ilerki zamanın konusu"; P#14)

### 7.2 İyileşmiş halin — ONAYLI ÖNERİ + KARAR (R2-C4, R1-E8, Ç9, Ç10)

- Gözlere hizalı önce/sonra kaydırıcısı.
- Adım anahtarları: yalnız saç · yalnız sakal · cilt bakımı · hepsi. Görselin altında hangi plan adımlarının uygulandığı yazar.
- **Ç9:** cilt de değişir: plan adımlarına bağlı ton eşitliği ve kızarıklık gibi değişimler gösterilir. Kemik yapısı, yüz şekli, ten rengi, saç çizgisi ve kimlik korunur.
- Doktor katmanındaki işlemler görselde gösterilmez.
- Etiket: §7.4.
- **KARAR (R2-C4 notu, Ç10):** kullanıcının istediği her yeniden üretim ücretlidir ya da haktan düşer; ücretsiz üretim yok. R2-C4'teki "bir kez ücretsiz yeniden üret" maddesi iptal. Kalite kontrolünden geçemediği için kullanıcıya hiç gösterilmeyen görsel haktan düşmez.
- Bu görsel reklamda kullanılmaz (K17).

### 7.3 Deneme kalitesi (R1-E10, R1-E11, R1-E13, R2-C10)

Hedef (R1-E10, R1-E13): bozuk sonuç kullanıcıya gösterilmez. Sakalsız ve Van Dyke gibi stillerde stil dışında kalan sakal (yanak, favori) tamamen temizlenir. Sakal yüze oturur: kenarlar yumuşak, yoğunluk gerçekçi, ışık ve ten tonuyla uyumlu.

R2-C10 ("Konuşalım", madde madde not):

1. **Bölge maskesi:** sakal alanı (yanak, favori, çene altı, bıyık) yüz haritasından çıkarılır; stil dışı alan "temizlenecek" diye işaretlenir. Bu maddeye not yazılmadı; R1-E10'u uygulamak için gerekli teknik adım olarak dahil edildi.
2. **Sağlayıcıları yarıştırmak:** HAYIR ("yarışmasınlar"). Hangi sağlayıcının kullanılacağı AÇIK (SPEC'te Gemini ya da fal.ai açık karardı).
3. **Claude ile otomatik kontrol:** KARAR ("claude'a sorulsun"); fiyat fizibilitesi ileride. Kontrolden geçmeyen görsel en fazla iki kez yeniden üretilir; yine geçmezse kullanıcıya "Bu fotoğrafla bu stil iyi sonuç vermedi" denir ve hakkından düşmez (Ç10).
4. **Sürüm kapısı:** KARAR ("ok"). 30 rızalı test yüzü × 12 sakal stili = 360 görsel. Her sürümde en az %95'i geçmeli; %90'ın altında kalan stil listeden gizlenir.
5. **"Bozuk görünüyor" düğmesi:** KARAR ("ok"). Oran yönetim panelinde izlenir.

### 7.4 Etiket ve paylaşım — KARAR (R1-E9, R2-K16)

Her yapay zekâ görselinde "Aura ile oluşturuldu · YZ simülasyonu" yazar. Deneme sonucunda paylaş düğmesi olur.

### 7.5 Deneme kuralı — KARAR (R2-K15, Ç9)

"Dene" sekmesindeki stil denemesi yalnız saç, sakal ve rengi değiştirir. Yüz orijinal piksellerle geri yazılır; kemik yapısı değişmez. Tek istisna "iyileşmiş halin" görselindeki plana bağlı cilt değişimi (§7.2).

## 8. Diğer özellikler

- **Paylaşım kartı** — KARAR (R2-Ö3 notu): varsayılan skor kartı. İsteyen başka kart da üretebilir (ör. "En güçlü yanın: göz bölgesi"). Reklamda kullanılacaksa kullanıcı fotoğrafı içermez (K17).
- **Berber kartı** — ONAYLI ÖNERİ (R2-Ö2): plan ekranındaki "Berbere göster" bunu açar. İçerik: stilin adı, önden ve yandan görsel, yanlarda kaç numara, üstte kaç santim, sakal hattının nereden geçeceği.
- **Hayalet kılavuz** — ONAYLI ÖNERİ (R2-Ö1): yeniden analizde bir önceki fotoğrafın yüz çizgisi kamerada silik görünür; kullanıcı aynı açıya ve mesafeye oturur. Kılavuz cihazda üretilir.
- **Açılıştaki ödeme metni** — R2-Ö5: önerilen "Analiz ücretsiz; tam sonuç ve plan abonelikle." metni reddedildi, çünkü analiz ücretli. Gerekirse ücretli olduğu önden söylenebilir.

## 9. Kurallar (SPEC değişmez kurallarının güncel hali)

| No | Kural | Karar | Not |
|---|---|---|---|
| K1 | Herkese aynı ölçek; satış için skora dokunulmaz | Kalsın | |
| K2 | Potansiyel en fazla +1,5, en çok 9,5; plana bağlı | Kalsın | Tıbbi kozmetik işlem için yasal metin ve uzman bağlantısı (§4.7) |
| K3 | 4,0 altında önce gelişim alanları; YZ tahmini notu | Kalsın | |
| K4 | Kullanıcılar arası sıralama ve yüzdelik yok | Değişti (Ç6) | Yüzdelik yalnız genel skorda; sıralama ve liderlik tablosu yok |
| K5 | Tek ondalık gösterim | Değişti (not) | Tek ondalık + açıklamada aralık (§4.5) |
| K6 | Öneriler yalnız katalogdan | Kalsın, genişledi (Ç2) | Katalog = SPEC kataloğu + yöntem kütüphanesi; uydurma yöntem yok |
| K7 | Cerrahi ve estetik işlem, ilaç, takviye, hormon, steroid önerilmez | Değişti (Ç3) | Doktor katmanında kişiye özel, hekim onaylı ilaç ve işlem önerisi; link bilimsel kaynak + TİTCK, doz ve marka yok (Ç5). Bonesmashing ve aç kalma girmez (TDB kararı). Anabolik steroid, hormon ve mewing AÇIK |
| K8 | Yağ oranı önerisi yalnız VKİ ≥ 25 ve günlük açık ≤ 500 kcal ise | Kalsın | Boy-kilo cevabı gelene kadar gösterilmez; 18 altına hiç gösterilmez (Ç1) |
| K9 | Başörtüsü varsa saç önerisi yok | Kalsın | Saç sağlığı istisnası önerisi kabul edilmedi; soru Ç17'ye göre sorulur |
| K10 | Çene ve yüz egzersizi yalnız çene sağlığı cevabı "hiçbiri" ise | Kalsın | Soru egzersiz önerisinden önce sorulur |
| K11 | Teşhis yok; "… için bir dermatoloğa göstermek faydalı olabilir"; raporun sonunda "Tıbbi tavsiye değildir." | Kalsın | |
| K12 | Aşağılayıcı kelime yok (çirkin, kötü, berbat, kusur, zayıf çene, başarısız yüz) | Kalsın | Ek B |
| K13 | Looksmaxxing argosu yok (PSL, mog, chad, incel, hunter eyes) | Kalsın, yalnız üründe (Ç15) | Pazarlamada kullanılabilir |
| K14 | Yaş, etnik köken, din çıkarımı ve yüz tanıma yok | Kalsın | |
| K15 | Denemede yüz korunur | Kalsın (Ç9) | İstisna: "iyileşmiş halin" görselinde plana bağlı cilt değişimi |
| K16 | YZ görsel etiketi | Değişsin | "Aura ile oluşturuldu · YZ simülasyonu" |
| K17 | Reklam ve mağazada yalnız izinli model ya da sentetik yüz; gerçek kullanıcı ve önce/sonra yok | Kalsın | Paywall'daki önce/sonra illüstratif stok görsel (P#17) |
| K18 | Uzman Ağı hukuk görüşüne kadar kapalı; reklamda partner hekim yok | Değişti (Ç4) | Altyapı kurulur, ücret ve komisyon kapalı; reklamda hekim yok, pazarlama yüz skoru üzerinden |
| K19 | Reklam ve mağaza dili ("Reklam" etiketi; sağlık iddiası, "en iyi", "garanti" yok) | Kalsın | |
| K20 | Yalnız 18+ | Değişsin (Ç1) | Yaş sınırı yok; 18 altına doktor katmanı, yağ oranı ve oruç önerileri gösterilmez |
| K21 | Fotoğraf saklanmaz; yüz noktaları cihazdan çıkmaz; kullanıcı verisiyle model eğitimi yok | Kalsın | Dosya seti hash'i ve skor 1 yıl saklanır (Ç11) |

## 10. Çelişkiler ve kararlar

### 10.1 Burhan'ın kararları (3 Kasım 2026)

| Ç | Konu | Çelişen kaynaklar | Karar |
|---|---|---|---|
| Ç1 | Yaş sınırı | R2-K20 ve P#1 (serbest) ↔ R2-C13'teki 18+ kapısı, SPEC, P§7 riski | Yaş serbest. 18 altına doktor katmanı (ilaç, klinik işlem, cerrahi), yağ oranı ve aralıklı oruç önerileri gösterilmez. Veli izni ve mağaza derecesi avukatla netleşir |
| Ç2 | Öneri kaynağı | R2-C1 (katalog dışı) ↔ R2-K6 (yalnız katalog) | Rapor metni serbest. Önerilen her ürün, stil, yöntem ve işlem SPEC kataloğundan ya da 867 yöntemlik kütüphaneden gelir; uydurma yöntem yok |
| Ç3 | Doktor katmanı ve K7 | R2-C6 ve TDB kararı ↔ SPEC K7 (K7 kaydı yoktu) | Doktor katmanı kişiye özel ilaç ve işlem önerir. Her öneriyi kullanıcıya ulaşmadan önce bir hekim inceler ve değiştirebilir; YZ kullanıldığı söylenir (AUP) |
| Ç4 | Gelir getiren yönlendirme | R2-C6, R2-C16, R2-K18, R2-K2 notları ↔ UYUM, SPEC | Uzman dizini ve yönlendirme altyapısı kurulur; ücret ve komisyon, gelir modeli avukatla seçilene kadar kapalı |
| Ç5 | İlaç linki | R1-W2, R2-C16 ↔ ilaç tanıtım yasağı | Bilimsel kaynak ve TİTCK kullanma talimatı linki. Eczane, satış, marka linki ve doz yok |
| Ç6 | Yüzdelik | R2-K4 notu ↔ SPEC K4, R2-C3, R2-C7, SKOR | Yalnız genel skorda, normal dağılım üzerinde. Alt skorlarda yok. AUP uygunluğu Anthropic'e teyit ettirilir |
| Ç7 | Maskülenlik metriği | R2-K4 notu ↔ R2-Ö7 | Ayrı maskülenlik/feminenlik skoru yok; hedef yönü kullanıcıda |
| Ç8 | Yüz şekli ödeme sonrası | P#9 Claude notu ↔ R2-C11 | Ön değerlendirme kalır; detaylı analiz farklıysa ikisi birlikte ve nedeniyle gösterilir. Sessiz değişiklik yok |
| Ç9 | İyileşmiş halde cilt | R2-C4 ↔ R2-K15 | Cilt de değişir (plana bağlı ton eşitliği, kızarıklık); yüz şekli ve kimlik korunur. K15, stil denemesi için aynen geçerli |
| Ç10 | Başarısız ve yeniden üretim | R2-C4 notu ↔ R2-C10/3; SPEC rapor +2 | Kalite kontrolünden geçmeyen görsel haktan düşmez. Kullanıcının istediği her görsel ve rapor yeniden üretimi ücretli; SPEC'teki 2 ücretsiz rapor yeniden üretimi kalkar |
| Ç11 | Saklama süresi | R2-C2 notu ↔ R2-K21 kartı (7 gün) | Dosya seti hash'i ve skor 1 yıl saklanır; bu sürede aynı set aynı skoru alır |
| Ç12 | Davet kilidi | P#15 ↔ R2-Ö5 notu | 5 davetle yalnız genel skor açılır; potansiyel, alt skorlar, rapor ve plan ödemeyle |
| Ç13 | Plan önizleme görselleri | P#14 ↔ P§7 | PDF'teki gibi, etiketsiz. Yanıltıcı ifade riski (P§7) bilerek kabul edildi |
| Ç14 | 18 altı stok görseli | P#17 kullanıcı notu ↔ P#17 Claude notu | 18 altı gruplarda 18–24 yaş görünen yetişkin model |
| Ç15 | Argo | R2-K13 notu | Argo yalnız üründe yasak; pazarlamada kullanılabilir |
| Ç16 | Açılış süresi | P#23 ↔ R2-C1, R2-C2; SPEC p95 < 10 sn | Süre sınırı yok, kalite öncelikli |
| Ç17 | Gözlük ve başörtüsü varsayılanı | R1-E3 ↔ R2-K9 | Fotoğraftan tahminle dolu gelir, kullanıcı onaylar ya da değiştirir; tahmin yoksa seçim yapılmadan saç önerisi üretilmez |

### 10.2 Önceliğe göre çözülenler (hangi kaynak geçerli sayıldı)

| Konu | Çelişen kaynaklar | Geçerli sayılan | Neden |
|---|---|---|---|
| Fotoğraf seti | R2-C5 önerisi (4 zorunlu) ↔ P#4 (ön + yan zorunlu) | P#4 | R2-C5 notu bu belgeye yönlendirdi |
| Hesap zamanı | SPEC ve R2-C13 akışı (hesap adımı yok) ↔ P#2 (taramadan önce) | P#2 | Konuya özel, açık karar |
| Gözlük ve başörtüsü sorulsun mu | R2-C13 (fotoğraftan anlaşılır, sorulmaz) ↔ R2-C14 (Hayır: ödeme sonrası sorulsun) | R2-C14 | Konuya özel karar; nasıl sorulacağı Ç17 |
| Kanıt gösterimi | R2-C6 (A/B/C) ↔ R2-Ö6 (A/B/C değil) | R2-Ö6 | Konuya özel not |
| Ücretsiz deneme | R2-C9 önerisi (ücretsizde 1 kombin deneme) ↔ R2-Ö5 notu (analiz ücretsiz olmayacak) | R2-Ö5 | R2-C9 ertelendi; ücretsiz deneme yok |
| Ödeme öncesi kalite kontrolü | P§1 (her fotoğraf kabul edilir) ↔ R1-E12 (evet/hayır pop-up'ı) | İkisi birlikte | Pop-up engellemez; kullanıcı "Evet" derse devam |
| Mock-up değerleri | Kilitli ekran (Yuvarlak, 1,73…) ↔ açık sonuç (Oval, 1,90…) | Cihaz değeri | P§1 Claude notu: tek kaynak |
| Mevcut arayüz (R1-G3) | R1-G3 ↔ R1-E1 notu (arayüz değişti) | R1-E1 | Yeni mock-up'lar PDF'te |
| Mockup ayrımı (R2-C15) | — | Atlandı | Not: "sal" |
| İyileşmiş halde ücretsiz yeniden üretim | R2-C4 maddesi ↔ R2-C4 notu | Not | Kullanıcının notu |

## 11. Açık sorular

1. Fiyatlar: tek seferlik rapor, haftalık ve aylık planın içerik farkı ve fiyatları; yeniden analiz hakları; tanıtım fiyatı ve teklif süresi hangi ürüne; yıllık plan kalıyor mu. (P#21, P§6)
2. Deneme kotası ve ek paket. (R2-C9, P#14)
3. Bütçe tutarları. (R1-E2, R2-C8)
4. Sosyal kanıt hatırlatma tarihi. (P#19)
5. 18 altı için veli izni ve App Store / Google Play yaş derecesi. (P#1, P§6, Ç1)
6. Deneme sağlayıcısı (yarıştırma yapılmayacak). (R2-C10)
7. Hekim inceleme akışı: kim inceler, nasıl, ne kadar sürede; yönlendirme gelir modeli. (Ç3, Ç4)
8. K7'nin kalanı: anabolik steroid, hormon ve mewing önerilecek mi.
9. R2-C12'de anılan ekibin "başka çalışması": belge gerekli.
10. İnsan puanlı referans set: ticari izin mi, kendi set mi. (R2-C2)
11. E-posta ile giriş kalacak mı. (P#2)
12. P#4'teki "ve gerisini de": hangi fotoğraflar (gülümseyen ön, yakın cilt, vücut?). Tavsiye veritabanında da açık soru.
13. Anthropic'e teyit: yüz skoru ve genel skordaki yüzdelik kullanım politikasına uygun mu.
14. Maliyet fizibilitesi: Claude merkezli analiz ve görsel kalite kontrolü. (R2-C1, R2-C10)
15. Davet kilidi için cihaz doğrulama yöntemi. (P#15)
16. P§6'daki sıradaki işler kullanıcı onayı bekliyor: yüz noktası testinin bitirilmesi, kararlara göre yeni mock-up'lar.
17. Önerilen metinler: kalite pop-up'ı (§3.1), kanıt metni (§6.2).

## 12. Önerilen uygulama sırası

| Faz | İçerik |
|---|---|
| 0 · Hazırlık | Bu belgeye göre uygulama planı; `docs/SPEC.md` ve `messages/tr.json` için değişiklik listesi; §11'deki soruların listesi |
| 1 · Ödeme öncesi akış | Yaş (18 altı kısıtları dahil), cinsiyet, Google/Apple hesap, rızalar, çoklu fotoğraf adımı, cihaz analizi ve uyarı pop-up'ı, tarama animasyonlu yükleme ekranı, kilitli sonuç ekranı (etiketsiz plan önizlemeleri dahil), yüz noktası testi ve çizimi (onaydan sonra), cihaz oranlarının tek kaynak olması |
| 2 · Paywall | Kısa paywall ve fayda listesi, cinsiyete ve yaşa göre illüstratif önce/sonra, sunucu tarafı süreli teklif ve iki ürün kimliği, ürün yapısı (fiyatlar yer tutucu), davet kilidi (yalnız genel skor) |
| 3 · Analiz motoru | Claude merkezli analiz, puan cetveli, üç çalıştırma ortancası, denetim adımı, set hash önbelleği (1 yıl), kalibrasyon katmanı (yapılandırılabilir merkez ve yayılım), skor + aralık + genel skorda yüzdelik, yüz şeklinde ön değerlendirme ve detaylı sonuç, kart kart açılış, başarısızlıkta yeniden deneme |
| 4 · Rapor ve plan | Rapor iskeleti, dil denetimi, plan fazları ve adım kartları, kanıt gösterimi, ödeme sonrası kişiselleştirme soruları (gözlük ve başörtüsü tahmin + onay), hedef yönü, beden algısı taraması, yönlendirme ve ürün referansı altyapısı (ücret kapalı), doktor katmanı ve hekim inceleme akışı (flag kapalı) |
| 5 · Dene | Bölge maskesi, kombin deneme, Claude ile kalite kontrolü, sürüm kapısı test seti, "Bozuk görünüyor" düğmesi, cilt dahil iyileşmiş hal görseli, ücretli yeniden üretim, etiket ve paylaş |
| 6 · Diğer | Paylaşım kartları, berber kartı, hayalet kılavuz |

## Ek A — Kaynak eşlemesi

Her kaynak maddesinin bu belgede nerede karşılandığı.

**PDF kararları:** P#1 §3.1, Ç1 · P#2 §3.1 · P#3 §3.2 · P#4 §3.1 · P#5 §3.1 · P#6 §3.3 · P#7 §3.3 · P#8 §3.3 · P#9 §3.3, Ç8 · P#10 §3.3, §4.9 · P#11 §3.3, §4.9 · P#12 §3.3 · P#13 §3.3 · P#14 §3.3, §7.1, Ç13 · P#15 §3.1, Ç12 · P#16 §3.4 · P#17 §3.4, Ç14 · P#18 §3.4 · P#19 §3.4 · P#20 §3.4 · P#21 §3.4 · P#22 §3.4, §3.2 · P#23 §3.2, Ç16.

**1. tur:**

| Kart | 1. tur kararı | Bu belgede |
|---|---|---|
| G1 | Konuşalım | §4.1 |
| G2 | Evet | §3.1 |
| G3 | Kararsız | Kapandı (§10.2) |
| G4 | Kararsız | §6.1 (R2-C6 ile onaylandı) |
| G5 | Konuşalım | §4.4, §9 |
| G6 | Evet | §0 |
| E1 | Konuşalım | §3.2 (avatar), §10.2 |
| E2 | Evet | §6.6 |
| E3 | Kararsız | §3.2, Ç17 |
| E4 | Konuşalım | §3.2, §4.1 |
| E5 | Evet | §3.1 |
| E6 | Evet | §4.9 |
| E7 | Evet | §7.1 |
| E8 | Evet | §7.2 |
| E9 | Evet | §7.4 |
| E10 | Evet | §7.3 |
| E11 | Kararsız | §7.3 |
| E12 | Evet | §3.1 |
| E13 | Kararsız | §7.3 |
| E14 | Evet | §3.1 |
| E15 | Konuşalım | §4.10 |
| W1 | Konuşalım | §4.4 |
| W2 | Konuşalım | §4.11, §6.3 |
| W3 | Konuşalım | §5 |
| W4 | Evet | §4.11 |
| W5 | Evet | §4.11 |
| W6 | Konuşalım | §4.1 |
| W7 | Konuşalım | §4.2 |
| W8 | Konuşalım | §6.4, §8 (Ö önerileri) |

**2. tur:**

| Kart | 2. tur kararı | Bu belgede |
|---|---|---|
| C1 | Evet | §4.1, Ç2 |
| C2 | Evet + not | §4.2, §4.3, Ç11 |
| C3 | Evet + not | §5 |
| C4 | Evet + not | §7.2, Ç9, Ç10 |
| C5 | Kayıt var, karar yok; not PDF'e yönlendiriyor | §3.1 |
| C6 | Evet + not | §6.1, §6.3, Ç3, Ç4 |
| C7 | Evet | §4.9 |
| C8 | Konuşalım | §6.6 |
| C9 | Konuşalım + not | §7.1 |
| C10 | Konuşalım + madde notları | §7.3, Ç10 |
| C11 | Evet + not | §4.10, Ç8 |
| C12 | Evet + not | §4.4 |
| C13 | Evet | §3, §4.1 |
| C14 | Hayır + not | §3.2, Ç17 |
| C15 | Karar yok; not "sal" | Atlandı |
| C16 | Karar yok; not | §6.3, Ç5 |
| K1–K21 | §9 tablosu (K7, Ç3 ile karara bağlandı) | §9 |
| Ö1 | Evet | §8 |
| Ö2 | Evet | §8 |
| Ö3 | Evet + not | §8 |
| Ö4 | Evet | §6.4 |
| Ö5 | Hayır + not | §3.4, §8, Ç12 |
| Ö6 | Evet + not | §6.2 |
| Ö7 | Evet | §3.2, Ç7 |

## Ek B — Qoves eleştirileri ve kaçınılacak dil (R2-K12 notu)

R2-K12 notunda istenen: Qoves'a gelen eleştiriler ve eleştiriye yol açan ifadeler. Açıklamaların çoğu özet; Guardian haberi ikincil kaynaklardan okundu.

| Kaynak | Eleştiri | Tetikleyen Qoves ifadesi ya da özelliği |
|---|---|---|
| MIT Technology Review, 5 Mart 2021 | Yüz, yanlış bulunan noktaların listesine indirgeniyor; skorlar denetlenemez, yaşçılık ve ırkçılık taşır | "Predicted flaws" başlığı; nazolabial kıvrım ve göz altı çukurluğu gibi etiketler; enjeksiyon ya da cerrahi gerekebilir notu |
| MIT Technology Review, 2021 | Etnik sınıflandırma denetimsiz biçimde teknolojiye giriyor | Raporlarda etnik sınıflama; kişinin kendi etnik grubunun "en iyi" örneğiyle kıyaslanması |
| Aftenposten, 16 Mart 2021 | Makinenin yüze ameliyat önermesi sorgulanıyor | Derin gülme çizgisinin "en büyük kusur" diye sunulması; ek kusur listesi ve ücretli cerrahi raporu |
| L'ADN, 8 Mart 2021 | Cinsiyetçi, ırkçı ve yaşçı önyargı | İnce dudak, derin burun-dudak kıvrımı ve göz altı torbasının kusur sayılması; Botoks önerisi |
| Inverse (Input), Mart 2021; videnskab.dk, 2026 | Kaygıyı kullanıp ürün ve işlem satmak | Kusur listesinin hemen ardından gelen ürün ve işlem önerileri |
| Guardian, Ağustos 2026 | Tek selfie'den beş ameliyat ve enjeksiyon önerisi; bilimsel dayanak yetersiz | 30 sayfalık raporda rinoplasti, alt blefaroplasti, kantopeksi, çene implantı, malarplasti; ücretli cerrahi eki |
| Aynı haber; uzman yorumu | Kadınsı-erkeksi ölçeğin dayandığı araştırma bireysel öneri için uygun değil | Özelliklerin kadınsılık-erkeksilik ekseninde puanlanması; "ideal" eşiği |
| Aynı haber ve Exame, Ağustos 2026 | Beden dismorfisi ya da yeme bozukluğu geçmişi olanlar için zararlı; yaş sınırı kolayca aşılıyor | Beyana dayalı 18+ kutusu |
| videnskab.dk, Mayıs 2026 | Kanıtlanmamış skor, bilim diline sarılmış kültürel idealler; fizyonomiye benzetme | "Objektif güzellik tavsiyesi" sloganı; atıfsız "binlerce çalışmaya dayanıyor" iddiası |
| videnskab.dk, Mayıs 2026 | Her bölüm övgüyle açılıp değişiklik önerisine bağlanıyor; yazarın güvensizliği derinleşmiş | "Tam potansiyel" dili; daha cana yakın görünmek için Botoks, çene hattı için kilo verme önerisi |
| Trustpilot, Temmuz–Ekim 2026 | "Sonra" görseli yüz şeklini değiştirmiş, kişi başkasına benzemiş, saç çizgisi kaymış | Yapay zekâyla üretilen "sonra" görseli |
| YouTube (rakip, Temmuz 2026) | Aynı raporda çelişen etiketler ve ölçüler (çene önce "dar", sonra "geniş"; iki farklı milimetre değeri) | Her bölüm için ayrı üretilen etiketler; milimetrik ölçüler |

ÖNERİ, kaçınılacak ifade → kullanılacak ifade:

1. "Yüzündeki kusurlar" → "Bakımla değişebilecek alanlar"
2. "En büyük sorunun …" → "Fotoğrafta öne çıkan …" (sıralama yok)
3. "İnce dudak / zayıf çene / basık burun" → "Yapısal özellik; bakım planının konusu değil"
4. "Rinoplasti, dolgu veya botoks önerilir" → "Bu konuda karar muayenede hekimindir; dilersen uzmanımızla görüşebilirsin"
5. "Çok düşük / ideal değil" → "Gelişim alanı: +0,6 puan, plandaki 3 adıma bağlı"
6. "Kadınsılık skoru / etnik grubunun ideali" → kullanıcının seçtiği hedef yönüne göre anlatım
7. "Objektif, bilimsel kanıtlı güzellik analizi" → "Yapay zekâ tahmini; ışık ve açıyla değişebilir"
8. "Tam potansiyeline ulaş" → "8–12 haftalık bakımla beklenen değişim"
9. "Çekici insanlar daha çok kazanır" → (hayat başarısı iddiası yok)
10. "Daha cana yakın görünmek için …" → (karakter yorumu yok)

Ek kural önerisi: her özellik raporda tek etiketle geçer; aynı raporda çelişen etiket ve ölçü olmaz.
