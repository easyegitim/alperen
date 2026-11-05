> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz

```yaml
doc_version: 2026-10-v1
doc_kind: saklama_politikasi
effective_from: 2026-11-01
status: taslak
```

# Saklama ve İmha Politikası

Bu politika Öğrenmen'in işlediği kişisel verilerin ne kadar süre saklandığını, sürenin hangi tarihten itibaren sayıldığını ve süre dolunca ne yapıldığını anlatır. Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hâle Getirilmesi Hakkında Yönetmelik'in öngördüğü saklama ve imha politikasının taslağıdır; periyodik imha süresi, sorumlu unvanlar ve kayıt ortamları hukuki incelemede tamamlanır.

## 1. Tek kaynak ilkesi

- Her saklama süresi veritabanındaki `retention_policies` tablosunun bir satırıdır. Silme işi (`run_retention()`) ve kullanıcıya gösterilen süre metni aynı satırdan gelir; bir süre yalnız bu tabloda değiştirilir.
- Bu belgedeki gün sayıları el ile yazılmaz. Her sayı bir yer tutucudur; yer tutucu `placeholders.json` dosyasında bir `retention_policies.id` değerine bağlanır ve belge veritabanına yüklenirken gerçek sayıya çevrilir. Çözülemeyen bir yer tutucu yüklemeyi durdurur.
- Bu belge, saklama tablosundan otomatik üretilen `docs/generated/saklama-sureleri.md` ile tutarlılık testine girer; iki belge farklı sayı taşıyamaz.
- Saklama işi her gece 02:05'te (Türkiye saati) çalışır; veritabanının zamanlayıcısı kapalıysa aynı iş Worker ya da gece toplu işi tarafından çalıştırılır. Süresi dolan kayıt en geç bir sonraki çalıştırmada işlenir ve her çalıştırmanın sonucu (`retention_runs`) kaydedilir.

## 2. Süreler

İşlem sütununda "silinir" kalıcı silme, "boşaltılır" yalnız belirtilen alanın silinmesi, "geçersiz sayılır" kaydın artık kullanılmaması, "anonimleştirilir" kişiyle bağın koparılması anlamına gelir.

| Veri | Süre | Sürenin başladığı an | İşlem | Kural (`retention_policies.id`) |
| --- | --- | --- | --- | --- |
| Sohbet mesajlarının içeriği ve meta verisi | {{RETENTION_MESSAGES_DAYS}} gün | Mesajın gönderildiği an (her mesajın silinme tarihi yazıldığı anda belirlenir) | silinir | `messages.hard_delete` |
| Yapay zekâya gönderilen tam bağlam (prompt) | {{RETENTION_PROMPT_DAYS}} gün | Cevabın üretildiği an | boşaltılır; özeti (hash) ve kullanılan kayıtların numaraları kalır | `bot_responses.prompt_null` |
| Bot cevap günlüğü (işaretlenmemiş) | {{RETENTION_BOT_RESPONSES_DAYS}} gün | Cevabın üretildiği an | silinir | `bot_responses.hard_delete` |
| Eğitmenin işaretlediği bot cevapları | {{RETENTION_FLAGGED_DAYS}} gün | Cevabın üretildiği an | silinir | `bot_responses.flagged_delete` |
| Sağlayıcı çağrı kayıtları (model, belirteç, maliyet) | {{RETENTION_LLM_CALLS_DAYS}} gün | Çağrı anı | silinir; günlük ve aylık harcama toplamları kalır | `llm_calls.hard_delete` |
| Süresi belli hafıza olgusu | Olgunun bitiş tarihi | Bitiş tarihi | geçersiz sayılır | `memory_facts.expire` |
| Süresi belirsiz hafıza olgusu | {{RETENTION_FACTS_DAYS}} gün | Olgunun oluşturulduğu an | geçersiz sayılır | `memory_facts.stale` |
| Geçersiz sayılmış hafıza olgusu | {{RETENTION_FACTS_EXPIRED_DAYS}} gün | Olgunun oluşturulduğu an | silinir | `memory_facts.hard_delete` |
| Ham ders videosu | {{RETENTION_VIDEO_DAYS}} gün | Dersin yapıldığı an | silinir (kurucunun bilgisayarında); silme kaydedilir, öğrenciye ve veliye ayrı ayrı bildirilir | `lessons.video` |
| İsimsiz ders transkripti | {{RETENTION_TRANSCRIPT_DAYS}} gün | Dönem kaydının kapandığı an | silinir (Storage) ve yol bilgisi boşaltılır | `lessons.transcript` |
| Kapalı dönem kaydının hafıza olguları | {{RETENTION_CLOSED_CLEANUP_DAYS}} gün | Dönem kaydının kapandığı an | silinir; ustalık ve gözlemler kalır | `enrollments.closed_cleanup` |
| Öğrenme verisinin kanıt alıntıları ve seçilen şıklar | {{RETENTION_LEARNING_DAYS}} gün | Dönem kaydının kapandığı an | anonimleştirilir: alıntılar ve seçimler silinir; ustalık sayıları, ustalık geçmişi ve yanılgı etiketleri kişiyle bağı kopmuş rastgele kimlikle kalır | `enrollments.learning_data` |
| Silme talebinde kimlik verileri (ad, doğum yılı, okul, veli bilgisi, kilitli alandaki Telegram kimliği eşlemesi, veli kodları), mesaj içerikleri, hafıza olguları, haftalık özetler, prompt metinleri | {{RETENTION_ANONYMIZE_DAYS}} gün | Silme talebinin yapıldığı an (`/sil` ya da koordinatöre başvuru); koordinatör bu süreyi beklemeden hemen de silebilir | silinir ya da boşaltılır; öğrenme sayıları rastgele kimlikle kalır. Grup üyelik ve yönlendirme kayıtlarındaki (`chat_roles`) sayısal Telegram kimliğinin de bu işle silinmesi [hukukçu ve M02 doğrular; README entegrasyon notu] | `students.anonymize` |
| Denetim izi | {{RETENTION_AUDIT_DAYS}} gün | Olayın kaydedildiği an | silinir | `audit.events.purge` |
| Günlük kota sayaçları | {{RETENTION_QUOTA_USAGE_DAYS}} gün | Sayacın günü | silinir | `quota_usage.purge` |
| Telegram güncelleme tekrar denetimi (yalnız güncelleme numarası) | {{RETENTION_TG_UPDATES_DAYS}} gün | Güncellemenin alındığı an | silinir | `tg_updates.purge` |
| Doğrulanamayan atıflar | {{RETENTION_CITATIONS_UNRESOLVED_DAYS}} gün | Son doğrulama denemesi | silinir | `citations.unresolved` |

Ek sınırlar:

- Öğrenci başına en çok 300 etkin hafıza olgusu tutulur; sınır aşılınca en eski olgular birleştirilmiş sayılır ve kullanılmaz.
- Ayrılmış ders sesi (ara ürün) analiz bitince silinir; bir saklama kuralına bağlı değildir.
- Onaysız bir grup üyesinin mesajlarında içerik hiç saklanmaz; yalnız meta veri yukarıdaki mesaj süresince tutulur.

## 3. Otomatik saklama kuralına bağlı olmayan veriler

| Veri | Süre | Not |
| --- | --- | --- |
| Kimlik verileri (silme talebi olmadan) | Üyelik süresince; üyelik bitiminden sonra [1 yıl önerisi; hukukçu doğrular] | Otomatik bir iş yoktur; koordinatör üyelik bitiminde silme akışını başlatır |
| Onay kayıtları (`consents`) | Öğrenci kaydı silinene kadar; denetim izindeki karşılığı denetim süresince | Rızanın ispatı için; süre hukukçuya sorulur |
| Sınav arşivi (eğitmenin yüklediği PDF ve OCR metni) | Eğitmen silene kadar | Öğrenci kişisel verisi içermemelidir; telif notuna bakınız |
| Eğitmen ve koordinatör hesapları | Görev süresince | Görev bitiminde hesap kapatılır; [süre hukukçu doğrular] |
| Haftalık şifreli yedek (`public` ve `audit` şemaları; mesaj tablosu ve `secure` şeması hariç) | 4 hafta (GitHub Actions artefaktı, `age` ile şifreli) | Yedek; hafıza olgularını, haftalık özetleri, temizlenmiş prompt metinlerini ve grup üyelik kayıtlarındaki sayısal Telegram kimliklerini içerir. Saklama işiyle silinen ya da boşaltılan bir kayıt, silinmeden önce alınmış bir yedekte en çok 4 hafta daha durabilir; yedek yalnız geri yükleme için açılır |
| Kilitli alanın (`secure` şeması: ad, doğum yılı, veli bilgisi, Telegram kimliği eşlemesi) elle yedeği | [saklama süresi hukukçu/operasyon belirler] | Yalnız kurucunun bilgisayarında, elle alınır (`supabase/scripts/backup-public.sh --secure`); buluta yüklenmez. Silme talebiyle silinen kimlik verisi bu yedekte süre dolana kadar durabilir [yedekten silme yöntemi hukukçuyla netleştirilir] |

## 4. İstisnalar

- **İşaretli cevaplar.** Eğitmenin hatalı ya da uygunsuz bulup işaretlediği bot cevapları kalite incelemesi için işaretsiz cevaplardan daha uzun saklanır ({{RETENTION_FLAGGED_DAYS}} gün). İşaret, cevabın prompt metninin daha uzun saklanmasını sağlamaz; prompt metni yine {{RETENTION_PROMPT_DAYS}} gün sonra boşaltılır.
- **Hukuki yükümlülük ve uyuşmazlık.** Bir yasal yükümlülük, resmî makam talebi ya da hukuki uyuşmazlık nedeniyle saklanması gereken kayıtlar için ilgili saklama kuralı koordinatör tarafından geçici olarak durdurulabilir (`retention_policies.enabled`). Her durdurma denetim izine yazılır, gerekçesi ve bitiş tarihi kaydedilir; gerekçe ortadan kalkınca kural yeniden açılır.
- **Depolama basıncı.** Veritabanı alanı daralırsa sistem mesaj saklama süresini ve prompt saklama süresini kendiliğinden kısaltabilir. Süreler bu yolla yalnız kısalır, hiçbir zaman uzamaz; mesaj süresi kısalınca grup kayıt bildirimi gerçek süreyle yeniden gönderilir.
- **Silme talebi.** Silme talebinde öğrenme sayılarının rastgele kimlikle kalması bir tercihtir; hukukçu aksini önerirse anonimleştirme işi tüm öğrenme verisini silecek şekilde değiştirilir.

## 5. Değişiklik yönetimi

1. Süre değişikliği önce `retention_policies` satırında yapılır (gerekirse `tg_chats.retention_days` ile birlikte).
2. Bu belgenin ve kullanıcıya gösterilen belgelerin `doc_version` değeri yükseltilir; README sürüm tablosu güncellenir.
3. Belgeler yeniden yüklenir; yer tutucular yeni sayıya çözülür. Grup bildirimi Worker'ın saatlik işiyle yeni süreyle yeniden gönderilir.
4. Süre uzatılıyorsa kullanıcılardan yeni metin sürümü için yeniden onay alınır.
