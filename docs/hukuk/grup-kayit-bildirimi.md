> HUKUKİ İNCELEME GEREKLİ — taslak, avukat onayı olmadan yayımlanmaz

```yaml
doc_version: 2026-10-v1
doc_kind: grup_kayit_bildirimi
legal_texts_kind: grup_kayit
effective_from: 2026-11-01
status: taslak
```

# Grup Kayıt Bildirimi

Öğrenmen bir Telegram grubuna eklendiğinde ilk mesajı bu bildirimdir; bot grupta "mesaj sabitleme" hakkıyla yöneticiyse bildirim sabitlenir. Gruba sonradan katılan her üyeye bildirim yeniden gönderilir. Gün sayısı el ile yazılmaz; saklama tablosundan gelir ve grubun saklama süresi değişirse bildirim güncel süreyle yeniden gönderilir ve yeniden sabitlenir.

## Kısa sürüm (sabitlenen mesaj, en çok dört satır)

<!-- ogrenmen:grup-kayit-kisa:start -->
Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve {{RETENTION_MESSAGES_DAYS}} gün sonra silinir.
Öğrenmen bir yapay zekâ öğretmenidir; hocalar da bu grupta.
Ayrıntı: /gizlilik
<!-- ogrenmen:grup-kayit-kisa:end -->

## Uzun sürüm (`legal_texts` gövdesi; /gizlilik ve eğitmen panelinden okunur)

<!-- ogrenmen:grup-kayit-uzun:start -->
Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve {{RETENTION_MESSAGES_DAYS}} gün sonra silinir. Öğrenmen bir yapay zekâ öğretmenidir; hocalar da bu grupta.

Öğrenmen varsayılan olarak yalnız etiketlendiğinde ya da bir mesajına yanıt verildiğinde cevap yazar; koordinatör açarsa, belirli bir süre hoca yanıtı gelmeyen sorulara da cevap verebilir. Bir hoca etiketlendiyse sessiz kalır. Not, puan, devamsızlık ve ödeme hakkında konuşmaz; bu soruları hocanıza iletir. Emin olmadığı bir soruyu da hocanıza bırakır.

Yapay zekâya giden metinlerde ad, okul, telefon ve benzeri kişisel bilgiler yoktur; her öğrenci rastgele bir kimlikle temsil edilir. Grupta bot öğrencinin adını değil kullanıcı adını kullanır. Bir öğrenciye cevap verirken grubun diğer üyelerinin mesajlarını kullanmaz.

Botla özel sohbette onay vermeyen üyelerin mesaj içeriği saklanmaz; yalnız zaman ve rol bilgisi tutulur. Onay için bota özelden /start yazın.

Bu bildirim grubun bilgilendirilmesidir. Mesaj içeriğinin saklanmasının hukuki dayanağı her üyenin botla özel sohbette verdiği bireysel onaydır; 18 yaş altı üyelerde ayrıca veli onayı gerekir. Eğitmenlerin mesajları eğitmen rolüyle kaydedilir. Aydınlatma metninin tamamı /gizlilik komutuyla ve eğitmen panelinden okunabilir. Silme talebi için bota özelden /sil yazılır.
<!-- ogrenmen:grup-kayit-uzun:end -->

## Yeni üyeye gönderilen ek satır

Kısa sürümün altına, üyeyi etiketlemeden:

> Botla özelden /start yazarak onay verebilirsin.

## Onaysız üyenin etiketine yanıt (en çok yedi günde bir)

Yapay zekâ kullanılmadan, üye başına en çok yedi günde bir kez gönderilir; bu süre içindeki diğer etiketlere cevap verilmez:

> Sana yardımcı olabilmem için önce özel mesajdan onay vermen gerekiyor: [özel sohbet bağlantısı]

## Uygulama notu

- Kısa sürümdeki gün sayısı grubun saklama süresidir (`tg_chats.retention_days`). Varsayılan değer mesaj saklama süresidir ve bu belgedeki yer tutucu `placeholders.json` üzerinden o değere çözülür. Depolama basıncı nedeniyle grup süresi kısaltılırsa Worker'ın saatlik işi bildirimi gönderim anındaki gerçek süreyle yeniden gönderir ve varsa yeniden sabitler; gruba en son bildirilen süre `tg_chats.recording_notice_days` sütununda tutulur.
- Bot grupta yönetici değilse bildirim yine gönderilir ama sabitlenemez; koordinatöre uyarı düşer. Bot "mesaj sabitleme" hakkıyla yönetici yapılınca bildirim sabitlenir ve uyarı kapanır.
- Otomatik yanıt (`tg_chats.group_auto_answer_min > 0`) yalnız koordinatör panelden açtığında çalışır; açıkken de yalnız onay vermiş öğrencinin sorusu, o öğrencinin kotası ve onay kapısıyla cevaplanır.
- Bildirim gruba bilgi verir, onay yerine geçmez; onaysız üyelerin mesajlarının içeriği hiçbir zaman saklanmaz ve yapay zekâya gitmez.
