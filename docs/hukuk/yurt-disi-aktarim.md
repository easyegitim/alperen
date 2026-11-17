> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz

```yaml
doc_version: 2026-10-v1
doc_kind: yurt_disi_aktarim
effective_from: 2026-11-01
status: taslak
```

# Yurt Dışına Kişisel Veri Aktarımı

Öğrenmen'in kullandığı sağlayıcıların tamamı Türkiye dışında veri işler. Bu belge hangi sağlayıcıya hangi verinin, hangi ülkeye, hangi dayanakla gittiğini listeler. Sağlayıcı listesinin teknik kaynağı `packages/contracts/models.json` dosyasıdır (`providers` bölümü); yeni bir sağlayıcı eklenmeden önce bu belge güncellenir.

## 1. Genel önlemler

- **Rastgele kimlik.** Öğrenci sağlayıcılara yalnız `s_` ile başlayan rastgele bir kimlikle gider; ad, doğum yılı, okul, sınıf, Telegram kimliği ve veli bilgisi veritabanının kilitli bölümünden (`secure` şeması) çıkmaz.
- **PII temizliği.** Yapay zekâya giden her metin adları, telefon numaralarını, e-posta adreslerini ve benzeri bilgileri silen temizleyiciden geçer. Adlar düz metinle değil tek yönlü özetleriyle eşlenir.
- **Katman ayrımı.** Birincil sohbet modeli ücretli katmandadır; ücretli katmanda gönderilen veri ürün eğitiminde kullanılmaz. Ücretsiz katmanlar sohbette yedektir: sağlayıcı yanıt vermediğinde sırayla devreye girer ve her zaman temizlenmiş metinle çağrılır. Aylık ya da günlük bütçe tavanı aşıldığında ya da maliyet denetimi ücretli kullanımı kapattığında (`paid_llm_enabled=false`) sohbet geçici olarak ücretsiz katmana geçer (`free_only` durumu, `chains.chat_free_only`); bu sürede Gemini ücretsiz katmanı her sohbet turunun birincil modelidir ve yine yalnız temizlenmiş metin gönderilir. Gemini ücretsiz katmanında gönderilen veri ürün eğitiminde kullanılabilir (`trains_on_data=true`). Ücretsiz katman ayrıca ders sesinin yazıya dökümü, sınav sayfası okuma (OCR) ve şekil denetimi için kullanılır.
- **Kayıt.** Her yapay zekâ çağrısının sağlayıcısı, modeli ve maliyeti `llm_calls` tablosuna yazılır; hangi cevabın hangi sağlayıcıdan geldiği sonradan gösterilebilir.

## 2. Sağlayıcılar

| Sağlayıcı | Hizmet | Giden veri türü | Veri işleme yeri (ülke) | Katman | Dayanak (öneri) | Sözleşme ve politika bağlantısı |
| --- | --- | --- | --- | --- | --- | --- |
| Google LLC (Gemini API) | Sohbet, gece hafıza çıkarımı, haftalık özet, soru üretimi, ders analizi, embedding | Temizlenmiş sohbet metni, isimsiz profil özeti, hafıza olguları, isimsiz ders transkripti ve kareler, kazanım adları | ABD ve Google'ın küresel veri merkezleri [bölge hukukçu ve sağlayıcıyla doğrulanır] | Ücretli (birincil) | Standart sözleşme ya da arızi aktarım için açık rıza; KVKK m.9 | [Gemini API ek koşulları: https://ai.google.dev/gemini-api/terms] · [veri işleme eki bağlantısı] |
| Google LLC (Gemini API, ücretsiz katman) | Sohbette yedek; bütçe tavanı aşıldığında ya da ücretli kullanım kapatıldığında sohbetin birincil modeli; şekil denetimi, sınav OCR'ı, ders sesinin yazıya dökümü | Sohbet bağlamı (temizlenmiş sohbet metni, hafıza olguları, isimsiz profil özeti); üretilen şekil görüntüleri; sınav sayfası görüntüleri; **ders sesi** | Aynı | Ücretsiz; veri ürün eğitiminde kullanılabilir | Açık rıza; ders sesi için ayrıca bakınız madde 3 | [Gemini API ek koşulları: https://ai.google.dev/gemini-api/terms] |
| Groq, Inc. | Sohbette yedek model (bütçe tavanı aşıldığında ücretsiz zincirin ikinci sırası); ders sesinde yedek yazıya döküm | Sohbet bağlamı (temizlenmiş sohbet metni, hafıza olguları, isimsiz profil özeti); ders sesi (yedek yolda) | ABD | Ücretsiz katman (döküm ses saati başına ücretlendirilir) | Standart sözleşme ya da açık rıza | [https://groq.com/privacy-policy/] · [hizmet koşulları bağlantısı] |
| Cloudflare, Inc. (Workers, Workers AI, Pages) | Bot sunucu kodu, yedek model, eğitmen paneli | Telegram'dan gelen tüm mesajlar ve kullanıcının Telegram görünen adı sunucu kodundan geçer (bellek içinde; hesabı eşlemek için, saklanmaz ve loglanmaz); yedek modelde sohbet bağlamı (temizlenmiş sohbet metni, hafıza olguları, isimsiz profil özeti) | Küresel uç ağ; [ana işleme ülkesi doğrulanır] | Ücretsiz | Standart sözleşme; hizmet sözleşmesinin ifası | [https://www.cloudflare.com/cloudflare-customer-dpa/] |
| OpenRouter, Inc. | Sohbette son sıradaki yedek model | Sohbet bağlamı (temizlenmiş sohbet metni, hafıza olguları, isimsiz profil özeti) | ABD; isteği ilettiği model sağlayıcısının ülkesi [doğrulanır] | Ücretsiz | Açık rıza | [https://openrouter.ai/privacy] |
| Supabase, Inc. | Veritabanı, kimlik doğrulama, dosya depolama | Kilitli alandaki kimlik verileri dahil tüm veritabanı; transkriptler, sınav arşivi, şekiller | Almanya (AB, Frankfurt, `eu-central-1`) | Ücretsiz | Standart sözleşme; hizmet sözleşmesinin ifası | [https://supabase.com/legal/dpa] |
| Telegram (Telegram Messenger Inc. ve bağlı şirketleri) | Mesajlaşma platformu | Öğrencinin kendi gönderdiği mesajlar ve botun cevapları | [Telegram'ın veri merkezi ülkeleri doğrulanır] | — | Kullanıcının kendi tercih ettiği platform; botun gönderdiği cevaplar için hizmet sözleşmesinin ifası | [https://telegram.org/privacy] |
| GitHub, Inc. (Actions) | Gece toplu işleri, maliyet denetimi, şifreli haftalık yedek | Temizlenmiş metin ve rastgele kimlikle çalışan işlerin geçici verisi; `public` ve `audit` şemalarının şifreli haftalık yedeği (4 hafta artefakt; mesaj tablosu ve `secure` şeması hariç; hafıza olguları, haftalık özetler, temizlenmiş prompt metinleri ve grup üyelik kayıtlarındaki sayısal Telegram kimlikleri dahil) | ABD | Ücretsiz | Standart sözleşme | [https://github.com/customer-terms] |
| Anthropic PBC (Claude) | Ders analizinde yedek güçlü model; **şu an kapalı** | İsimsiz ders transkripti ve kareler | ABD | Ücretli | Açılmadan önce standart sözleşme | [https://www.anthropic.com/legal/commercial-terms] |

Araştırma özelliği (Kitap) pilotta kapalıdır. Açıldığında öğrencinin araştırma sorusundan türetilen isimsiz arama sorguları OpenAlex (ABD), Semantic Scholar (Allen Institute for AI, ABD), arXiv (Cornell Üniversitesi, ABD), Crossref (ABD/Birleşik Krallık) ve Unpaywall (OurResearch, ABD) hizmetlerine gönderilir; bu hizmetlere öğrenci kimliği gitmez. Polite pool kuralı gereği isteklere easy'nin kurumsal e-posta adresi eklenir. Açılıştan önce bu sağlayıcıların satırları tabloya eklenir.

## 3. Hukuki inceleme için açık noktalar

- **KVKK m.9 değişikliği.** 7499 sayılı Kanun ile değişen m.9 ve Kişisel Verilerin Yurt Dışına Aktarılmasına İlişkin Usul ve Esaslar Hakkında Yönetmelik uyarınca aktarım öncelikle yeterlilik kararına, yoksa uygun güvencelere (Kurul'un ilan ettiği standart sözleşme, bağlayıcı şirket kuralları, yazılı taahhüt) dayanmalıdır; açık rıza yalnız arızi aktarımlar için kalmıştır. Planın önerisi olan "açık rıza + sağlayıcı sözleşmeleri" düzenli aktarım için yeterli olmayabilir. Her sağlayıcı için standart sözleşmenin imzalanıp imzalanamayacağı ve imzalandıktan sonra Kurul'a süresi içinde (beş iş günü) bildirim yapılması hukukçuyla netleştirilmelidir.
- **Ücretsiz katmanda eğitim kullanımı.** Gemini ücretsiz katmanında gönderilen verinin ürün eğitiminde kullanılabilmesi, veri isimsizleştirilmiş olsa da açıkça aydınlatma metninde yazılıdır. Temizleyicinin her yazımı yakalayamama ihtimali kalan bir risktir; ücretsiz katmanın tamamen kapatılması bir seçenektir.
- **Ders sesi.** Ders sesi yazıya döküm için ücretsiz katmana ham hâliyle gider; ses kişinin sesini ve derste söylenen adları içerir. Yerel döküm ya da ücretli katman tercih edilmesi önerilir; karar ders kaydı bildirimine işlenir.
- **Bütçe tavanında ücretsiz katman.** Sohbet bütçesinin günlük ya da aylık tavanı aşıldığında veya maliyet denetimi ücretli kullanımı kapattığında sohbetin tamamı, ay başına ya da koordinatör ücretli kullanımı yeniden açana kadar, ücretsiz zincirden (önce Gemini ücretsiz katmanı) yürür. Bu seyrek bir arıza değil, tasarlanmış bir durumdur; aydınlatma metni ve veli onay formu bunu yazar. Bu durumda veri eğitimde kullanılabilir; tavan durumunda sohbeti durdurmak ya da yalnız eğitimde kullanmayan sağlayıcılarla sürdürmek bir seçenektir.
- **Sınav arşivi.** Öğrencinin kendi sınav kâğıdı yüklenirse sayfa görüntüsü OCR için ücretsiz katmana gider; kâğıttaki ad ve numara yüklemeden önce karartılmalıdır (telif notuna bakınız).
- **Reşit olmayanlar.** 18 yaş altı kullanıcılar için yurt dışı aktarım rızasının veli tarafından verilmesi gerekir; veli onay formu bunu bölüm 2 madde 4'te ve beyanın 2. kutusunda (zorunlu) kapsar. Telegram kodu ve web bağlantısı yolunda beyanın nasıl alındığı veli formu bölüm 3'tedir; yeterliliği hukukçuya sorulur.
- Tablodaki bağlantılar taslak hazırlanırken bilinen adreslerdir; yayından önce erişilip güncel sürümleriyle doğrulanmalı ve erişim tarihi yazılmalıdır.

## 4. Aktarılmayan veriler

- Ad, soyad, doğum yılı, okul, sınıf, veli adı ve iletişimi Supabase'deki kilitli alanda (`secure` şeması) durur ve hiçbir yapay zekâ sağlayıcısına gitmez. İstisnalar: Telegram'ın gönderdiği görünen ad, hesabı eşlemek için Cloudflare Worker'dan yalnız bellek içinde geçer; ders kaydı onayı varsa ders sesi, derste söylenen adlarla birlikte, yazıya döküm sağlayıcısına gider (madde 3).
- Telegram kullanıcı kimliği eşlemesi kilitli alandadır (`secure.telegram_identities`); yönlendirme için sohbet ve grup rol tablolarında (`chat_roles`, `tg_chats`, `sessions`, `messages`) da sayısal kimlik tutulur. Bu kimlik hiçbir yapay zekâ sağlayıcısına gitmez; haftalık şifreli yedekle GitHub'a gider.
- Kilitli alanın elle yedeği yalnız kurucunun bilgisayarında tutulur (`supabase/scripts/backup-public.sh --secure`); buluta yüklenmez.
- Ham ders videosu kurucunun bilgisayarında kalır; hiçbir buluta yüklenmez (bulut klasörü seçilirse bu belge güncellenir).
- Cevap anahtarları yalnız veritabanının kilitli alanındadır; yapay zekâ sağlayıcılarına gönderilmez.
