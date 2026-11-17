# Öğrenmen — Teknik Plan

Oct 19, 2026 · @Habip Alperen Girgin

## Mimari ve bütçe — altyapı ücretsiz, model gideri \~20 $/ay

Beş bileşen tek bir yığının üstünde çalışır. Kural: LLM olabildiğince az çağrılır, üretilen her içerik saklanıp yeniden kullanılır; öğrenciye ücretsiz olması ile işletme maliyetinin sıfır olması ayrı şeylerdir, hedef düşük ve öngörülebilir maliyettir.

| Katman | Seçim | Neden |
| --- | --- | --- |
| Öğrenci arayüzü | Telegram botu (MVP), sonra Next.js PWA + Cloudflare Pages | Telegram ücretsiz ve telefonda hazır; grup/eğitmen iletişimi zaten mesajlaşma platformu gerektirir |
| Sunucu mantığı | Cloudflare Workers (günde 100 bin istek ücretsiz) | Sunucu yönetimi yok, uyumaz |
| Veritabanı + giriş | Supabase ücretsiz (500 MB Postgres, pgvector, RLS) | Profil, soru bankası, hafıza ve vektör arama tek yerde; 7 gün istek gelmezse uyur, günlük ping gerekir |
| Birincil LLM | Gemini Flash-Lite, ücretli katman (1 M giriş ≈ 0,10 $, çıkış ≈ 0,40 $) | 300 öğrenci × 150 etkileşim ≈ 18 $/ay; ücretli katmanda veri ürün eğitiminde kullanılmaz; ön ödemeli, harcama tavanı konur |
| Yedek LLM'ler | Gemini ücretsiz katman, Groq (\~1.000 istek/gün), Cloudflare Workers AI (10.000 neuron/gün), OpenRouter :free | Yönlendirici 429 alınca sırayla düşer; hiçbiri tek başına yetmez, birlikte rahat yeter |
| Güçlü model (yalnız ders videosu analizi) | Gemini Pro / Claude Sonnet | Ders başına 0,2–0,5 $; ders ücretinin yanında ihmal edilebilir |
| Embedding | Gemini Embedding (ücretsiz) veya Cloudflare bge-m3 | Türkçe PDF araması için |
| Toplu işler (render, gece üretimi, video) | Kendi bilgisayarın veya GitHub Actions (ayda 2.000 dk) | Workers Python çalıştırmaz |

Maliyet kuralları:

- Önce veritabanı, sonra LLM: net, görev, geçmiş sonuç gösterirken model çağrılmaz.
- Onaylı içerik havuzu: aynı konuyu isteyen 40 öğrenci 40 değil 1 çağrı yapar.
- Öğrenci başına günlük kota (ör. 25 mesaj, 5 test); araştırma gibi pahalı işlere ayrı kota.
- Gece toplu üretim Batch API ile (%50 indirim).
- Günlük/aylık harcama uyarısı ve tavanı; sağlayıcı hatasında alternatif model.

Kapasite: 50 öğrenci × 25 mesaj/gün = 1.250 çağrı/gün, yedek ücretsiz katmanlar bile karşılar. 300–500 aktif öğrenci için aylık 50–200 $ planlama aralığıdır. 5 $'lık VPS'te kendi modelini çalıştırma: CPU'da 7B model öğrenciyi 30–60 saniye bekletir.

Hukuk ve güvenlik: öğrenciler büyük ihtimalle 18 yaş altı, veli onayı ve KVKK aydınlatma metni gerekir; API'ye isim/okul gitmez, öğrenci rastgele kimlikle temsil edilir; sohbet geçmişi tanımlı süre sonra silinir; model anahtarları yalnız sunucuda; cevap anahtarları ayrı tabloda ve LLM not/puan/anahtar yazamaz, bunları sunucu fonksiyonları yazar; Supabase'de RLS ve tablo yetkileri birlikte test edilir.

## 01 Gözlük — profil bir metin değil, zamanla öğrenen tablolar

Profil tablolarda tutulur; LLM metni bu tablolardan türetilen bir görünümdür. Her yeni kanıt ustalık puanını günceller, kararların gerekçesi gösterilebilir.

| Tablo | Alanlar | Ne tutar |
| --- | --- | --- |
| `skills` | id, ad, ön koşullar | Kazanım/konu ağacı (ör. türev ← limit) |
| `mastery` | student, skill, p (0–1), evidence\_count, updated\_at | Her kazanım için ustalık olasılığı |
| `observations` | student, skill, kind, value, source, ts | Ham kanıt: çözülen soru, ders videosunda yakalanan hata, sohbette sorulan soru |
| `misconceptions` | student, text, evidence, first\_seen, resolved\_at | Anlamadığı şeylerin listesi, çözülene kadar açık |
| `preferences` | student, aktif saat, görsel/sözel, işe yarayan açıklama tarzı | Kişiselleştirme tercihleri |

Güncelleme kuralı: Bayesian Knowledge Tracing ya da konu başına Elo puanı; birkaç satır matematik, LLM gerekmez. Teşhis testi (15–20 soru) ilk satırları doldurur; sonraki her etkileşim üstüne ekler.

İki yapısal kural: (1) **Enrollment modeli** — öğrencinin kalıcı bir kimliği, ama LGS / YKS / üniversite dönemleri ayrı akademik kayıtları olur; `mastery` döneme bağlıdır, LGS kazanım puanı AYT puanı sayılmaz, geçmiş kaybolmaz. (2) **Müfredat sürümleme** — `skills` ağacı MEB programı ve ÖSYM kılavuzu yılına bağlı sürümlenir; program değişince eski veriler bozulmaz. `evidence_count` düşükken sistem kesin teşhis koymaz.

## 02 Tablet — grafikli/şekilli sorular, ücretsiz

Görsel üretme, görseli çizen kodu üret. Görüntü modelleri (Flux, SD) sınav şekli için işe yaramaz: açıları, sayıları, eksenleri yanlış çizer. Kod deterministik, ücretsiz ve düzeltilebilir.

| Şekil türü | LLM'in yazdığı kod | Render aracı (ücretsiz) |
| --- | --- | --- |
| Geometri, fonksiyon grafiği, fizik düzeneği | Matplotlib / SVG / TikZ | Python, tarayıcı, Tectonic (LaTeX) |
| Veri yorumlama (tablo/grafik soruları) | Vega-Lite veya Matplotlib + JSON veri | aynı |
| Devre | schemdraw | Python |
| Molekül | RDKit | Python |
| Ağaç, graf, akış | Graphviz (DOT) | Python |
| Formül dizgisi | LaTeX | KaTeX (web), Tectonic (PDF) |

Üretim boru hattı:

1. LLM soruyu JSON üretir: kök, şekil kodu, seçenekler, cevap, çözüm, kazanım.
2. Kod sandbox'ta çalışır, PNG/SVG çıkar; render oldu mu ve boyut mantıklı mı kontrol edilir.
3. Gemini Flash vision (ücretsiz) şeklin soru kökündeki değerlerle uyuştuğunu denetler.
4. Geçemeyen 2 kez yeniden denenir; hâlâ geçemezse öğretmen onay kuyruğuna düşer.

İki ek doğrulama: sayısal sorularda cevap anahtarı **SymPy** ile koda doğrulatılır, LLM'e güvenilmez; gece toplu üretim **Batch API** üzerinden gider (%50 indirim). Soru JSON'u Gemini'nin yapılandırılmış çıktı şemasıyla alınır.

Daha ucuzu parametrik şablonlar: "kenarları a, b, açısı θ olan üçgen" şablonu bir kez yazılır, rastgele parametrelerle sınırsız varyant, sıfır LLM çağrısı. Deneme PDF'i için LaTeX `exam` sınıfı + Tectonic yeterli.

Render nerede çalışır: Cloudflare Workers Python çalıştırmaz. Gece toplu işini kendi bilgisayarın ya da GitHub Actions (ayda 2.000 ücretsiz dakika) çalıştırır; çıktılar Supabase Storage'a yazılır.

## 03 Kalem — iki ayrı motor

**(a) Öğrencinin anlamadığını nokta atışı bulmak.** Sır soru tasarımında: her yanlış seçenek belirli bir kavram yanılgısını kodlar (işaret hatası, birimi unutma, ön koşul eksik). Yanlış şık rastgele hata değil teşhistir. Etiketler `observations`'a akar, `mastery` ve `misconceptions` güncellenir, ön koşul ağacı üzerinden "asıl sorun bir alt konuda" çıkarımı yapılır. LLM yalnızca sonucu öğrenciye anlatırken devreye girer; motor tamamen ücretsizdir çünkü matematiktir.

**(b) Sınav sorularını modellemek (üniversite vize/final için güçlü).**

1. Geçmiş vize/finalleri topla (öğrencilerin elinde var); Gemini Flash vision ile OCR'la; her soruyu ayrı kayıt yap: konu, tür (ispat/hesap/çoktan seçmeli), puan, yıl, hoca.
2. Soruları embedding ile kümele: aynı şablonun sayıları değişmiş halleri aynı kümeye düşer. "Bu şablon 5 yılın 4'ünde çıkmış" bilgisi buradan gelir.
3. Güncel izlence/slaytlarla hizala: işlenmiş ama hiç sorulmamış konular ile her yıl sorulan konular ayrışır.
4. Çıktı bir sınav planı tahminidir: "Soru 1: kısmi integrasyon, \~20 puan, 5/5 yıl", kanıt bağlantılarıyla. Yüksek olasılıklı her şablon için LLM varyantlar yazar.

Öğrenciye "tahmin" değil "sıklık analizine göre öncelik" diye sunulur. Etik sınır: yalnızca meşru yoldan edinilmiş geçmiş sınavlar; mevcut sınava dair sızıntı asla.

**Telif sınırı.** ÖSYM, yayımladığı soruların izinsiz çoğaltılamayacağını belirtir. Geçmiş soruları **analiz edip istatistik çıkarmak** (hangi kazanımdan kaç soru) serbest; soruları **uygulama içinde yayınlamak** değil. Üniversite sınavlarında da aynı ilke: hocanın soruları yeniden yayınlanmaz, şablonları çıkarılıp özgün varyant üretilir.

## 04 Kitap — akademik araştırma, ücretsiz ve iyi

Google Scholar'ın API'si yok; daha iyileri ücretsiz. Ajan, aramayı kendi yaptığı için Gemini'nin faturasız hesapta kapalı olan "grounding" özelliğine ihtiyaç duymaz.

| Kaynak | Ne verir | Koşul |
| --- | --- | --- |
| [OpenAlex](https://openalex.org) | Makale, yazar, atıf verisi | Anahtar gerektirmez, günde 100 bin istek |
| [Semantic Scholar](https://www.semanticscholar.org/product/api) | Arama, atıf grafiği, TLDR | Ücretsiz anahtar |
| [arXiv](https://arxiv.org/help/api) | Ön baskılar, tam metin | Açık |
| [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) | DOI doğrulama, üst veri | Açık |
| [Unpaywall](https://unpaywall.org/products/api) | DOI'den açık erişimli PDF | E-posta ile |
| [PubMed](https://www.ncbi.nlm.nih.gov/home/develop/api/) | Tıp/biyoloji | Açık |
| [DergiPark](https://dergipark.org.tr), [YÖK Tez](https://tez.yok.gov.tr) | Türkçe makale ve tezler | Kullanım koşullarına dikkat |

Araştırma ajanı akışı:

1. Soruyu 3–5 arama sorgusuna genişlet.
2. OpenAlex / Semantic Scholar'da ara; atıf, yıl ve alaka puanıyla sırala.
3. Unpaywall'dan PDF'leri çek.
4. Gemini Flash'ın 1 M token bağlamına tam makaleleri ver (ücretsiz).
5. DOI bağlantılı sentez, literatür matrisi, BibTeX/APA çıktısı; isteğe bağlı Zotero kütüphanesine gönder.

Vazgeçilmez kural: her atıf Crossref'te doğrulanır; DOI çözümlenmiyorsa atıf silinir. Uydurma kaynak bu alandaki en büyük risktir ve tek satırlık bir kontrolle engellenir.

## 05 Kulaklık — iletişim merkezi ve "her şeyi öğrenen" hafıza

Sistemin omurgası burasıysa üç şey gerekir: katmanlı hafıza, çok eğitmenli grup kuralları ve eğitmen için takip paneli.

**Hafıza üç katmanlı.**

| Katman | İçerik | Nasıl oluşur |
| --- | --- | --- |
| 1. Ham günlük | Her mesaj: kimden, hangi grup, ekler | Bot her mesajı kaydeder |
| 2. Çıkarılmış olgular | Söz verdi, ödev teslim tarihi, cevapsız soru, moral düşüşü, sorduğu konu; kaynak mesaj numarasıyla | Gece bir LLM günün mesajlarından `memory` tablosuna yazar |
| 3. Haftalık özet | Öğrenci başına kısa durum | Haftada bir yeniden üretilir |

Bot cevap verirken tüm geçmişi değil, pgvector ile ilgili olguları ve son mesajları çeker; hem ucuz hem izlenebilir.

**Çok eğitmenli gruplar.** Telegram'da bot gruba eklenir, gizlilik modu kapatılır ki her mesajı görsün. Roller tablosu (öğrenci, matematik hocası, koordinatör), soru yönlendirme ("bu soruyu @hoca cevaplasın"), bot emin olmadığında ya da öğrenci insan istediğinde yükseltme. Bot not/devamsızlık gibi konularda onaylı bir olgu yoksa eğitmen adına konuşmaz. Üniversite grupları için Discord ciddi bir alternatif: ücretsiz, kanal/thread/rol yapısı Telegram'dan güçlü.

**Takip paneli (eğitmen için).**

- X saatten uzun cevapsız sorular
- N gündür sessiz öğrenciler
- Moral göstergesi düşenler
- Yaklaşan teslimler
- Eğitmen yanıt süreleri

Her bot cevabı prompt, kullandığı hafıza, model ve maliyetle kaydedilir; eğitmenler beğenmediği cevabı işaretler, haftada bir örneklem incelenip prompt düzeltilir. Proaktif mesajlar cron ile gider ("yarın sınav var, hazır mısın?").

**Pedagoji ve ses.** Varsayılan mod Sokratik: bot doğrudan cevap yerine ipucuyla kavratır; öğrenci isterse "doğrudan cevap" moduna geçer. Ses girişi web arayüzünde tarayıcının Web Speech API'siyle (ücretsiz) ya da Groq Whisper ile; sesli yanıt Gemini Flash TTS ile. Mikrofon yalnız öğrenci bastığında açılır. 7/24 yapay zekâ yanıtı ile insan danışman ayrı hizmet seviyeleri olarak sunulur.

Hukuki not: grup kayıt altında, herkes bilgilendirilmeli; saklama süresi tanımlı; reşit olmayanlar için veli onayı.

## Ders videolarının analizi — ders başına 1 $'ın altında

Ders ücretli olduğu için burada güçlü model kullanmak mantıklı; doğru yapılırsa ders başına 0,2–0,6 $ tutar. Haftada 30 ders ayda \~50 $.

&#91;embedded content: ders videosu analizi · 7 adım, 1 döngü\]

Ses ve birkaç slayt karesi yeter; pahalı model tek bir adımda çalışır ve her dersin çıktısı bir sonraki dersin girdisi olur.

**1. Kayıt ve ön işleme.** Zoom/Meet kaydından ffmpeg ile ses ayrılır; sinyalin %90'ı sestedir. Ekran/slayt için sahne değişimlerinde (ffmpeg scene detect) 20–40 kare çekilir; tüm video modele verilmez.

**2. Transkript ve konuşmacı ayrımı.** Birebir derste iki konuşmacı olduğu için ayrım kolay. İsimler API'ye gitmeden "ÖĞRENCİ/EĞİTMEN" etiketine çevrilir.

| Seçenek | Maliyet (90 dk ders) | Not |
| --- | --- | --- |
| Groq, Whisper large-v3-turbo | \~0,06 $ | Çok hızlı |
| Gemini Flash'a sesi doğrudan vermek | 0 $ | 90 dk ≈ 170 bin token, 1 M bağlama sığar; konuşmacıları ayırabilir |
| whisper.cpp, kendi makinende | 0 $ | Yavaş (CPU'da 30–60 dk) |

**3. Analiz (güçlü model, JSON şeması zorunlu).** Transkript + slayt kareleri Gemini Pro, Claude Sonnet ya da benzeri bir modele verilir; 90 dakikalık transkript \~30 bin token, ders başına \~0,2–0,5 $. Şema alanları:

- İşlenen kazanımlar ve her birinde gözlenen ustalık (0–1, kanıt alıntısı + zaman damgası)
- Öğrencinin sorduğu sorular, tereddüt anları ("anlamadım", uzun sessizlik, yanlış cevap)
- Tespit edilen kavram yanılgıları (alıntıyla)
- Eğitmenin verdiği ödev ve sözler, öğrencinin sözleri
- Konuşma oranı, soru sayısı, dikkat/moral göstergeleri
- Önerilen sonraki adım ve bir sonraki derse not

**4. Veritabanına yazım.** Her madde `observations` ve `misconceptions`'a satır olarak girer; `mastery` güncellenir; eğitmen panelinde ders raporu görünür, onaylanır veya düzeltilir. Ham video belirli süre sonra silinir, transkript kalır.

**5. Kişiselleştirmeyi maksimize eden kısım.** Analiz promptuna öğrencinin mevcut profili de verilir ("geçen ders şu yanılgı vardı; bu derste düzeldi mi?"). Her ders bir öncekinin üzerine kümülatif rapor üretir, sıfırdan değil.

## Yol haritası ve pilot — 8 hafta, tek kitleyle başla

İlk sürüm tek bir öğrenci grubu ve tek bir ders için çıkar (ör. TYT matematik ya da bir üniversite dersi); tüm kitleleri aynı anda açmak maliyeti ve hata yüzeyini büyütür. Kodlamada rahat değilsen kısa yol: LibreChat veya Open WebUI'yi aylık \~4 € bir VPS'e kurup aynı API anahtarlarını bağlamak; Gözlük ve Kalem'in özel mantığı kaybolur ama bir haftada çalışan sistem olur.

&#91;embedded content: yol haritası · 4 faz, 8 hafta, 1 kapı\]

Fazlar eşit uzunlukta çizildi, ölçekli değil; tüm öğrencilere açılış takvime değil pilot ölçütlerinin geçilmesine bağlıdır.

Pilot ölçütleri (öğrenci sayısı ve üretilen soru sayısı tek başına başarı değildir):

- Tablet'in ürettiği soruların cevap ve açıklama doğruluğu (örneklem bazlı öğretmen denetimi)
- Gözlük'ün belirlediği eksiklerin sonraki ölçümlerle örtüşme oranı
- Kitap'ın atıflarının gerçekten ilgili kaynağı desteklemesi
- Kalem'in önceliklerinin öğrenci gelişimine katkısı
- Öğrenci başına gerçek aylık maliyet ve hata oranı
- Başka öğrencinin verisine erişilememesi, cevap anahtarının sızmaması

Doğruluğu yeterli olmayan bir özellik, çalışıyor diye tüm öğrencilere açılmaz.

## Sonraki adım

- [ ] İlk kitleyi ve dersi seç (TYT matematik ya da bir üniversite dersi).
- [ ] Gemini (ücretli, 5 $ ön yükleme + tavan), Groq, Cloudflare, Supabase hesaplarını aç.
- [ ] Ders notlarını PDF olarak topla; `skills` ağacını ve 15–20 soruluk teşhis testini yaz (Gözlük).
- [ ] Telegram botu + LLM yönlendirici + günlük kota; 5 öğrenciyle dene (Kulaklık).
- [ ] Ders videosu boru hattını Python betiği olarak yaz (ffmpeg → transkript → JSON → Supabase), bir kayıtla dene.
- [ ] İlk 3 parametrik şekil şablonunu ve SymPy + vision kontrolünü kur (Tablet).
- [ ] Geçmiş sınav arşivini toplamaya başla, en az 2 dönem; yalnız analiz için (Kalem).
- [ ] KVKK aydınlatma metni ve veli onay formunu hazırlat.

## Kaynaklar

Ücretsiz katman rakamları sık değişir; 18–19 Ekim 2026'da açılan sayfalardan alındı. Gemini artık ücretsiz katman limitlerini yayınlamıyor, her projenin limiti AI Studio'da görünür.

- [Free LLM API Comparison 2026 (Novita)](https://blogs.novita.ai/free-llm-api-comparison-2026/)
- [Gemini API pricing changes, April 2026 (agentdeals)](https://agentdeals.dev/gemini-api-pricing-changes)
- [Groq Free Plan 2026 (costbench)](https://costbench.com/software/llm-api-providers/groq/free-plan/)
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing)
- [OpenRouter rate limits (TrueFoundry)](https://www.truefoundry.com/es/blog/openrouter-rate-limits-your-free-tier-depends-on-what-youve-already-paid)
- [OpenAlex](https://openalex.org) · [Semantic Scholar API](https://www.semanticscholar.org/product/api) · [Unpaywall API](https://unpaywall.org/products/api) · [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
