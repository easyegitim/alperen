# Veri ihlali müdahale planı (taslak — avukat onayı bekliyor)

Kapsam: KVKK m.12/5 ve Kurul'un 24.01.2019 tarihli kararı: ihlal öğrenildikten sonra **en geç 72 saat** içinde Kurul'a bildirim; etkilenen kişilere makul sürede bildirim.

## Roller
- İhlal sorumlusu: ürün sahibi (tek kişi, yedek: teknik danışman).
- Hukuk: sözleşmeli avukat.

## Adımlar
1. **Tespit ve sınırlama (0–4 saat):** Sentry/Vercel/Supabase alarmı veya kullanıcı bildirimi → ilgili anahtarları döndür (Supabase service-role, iyzico, Gemini, Resend), şüpheli oturumları kapat, gerekiyorsa `FEATURE_*` bayraklarıyla özellikleri kapat.
2. **Kayıt (ilk 24 saat):** Ne, ne zaman, hangi veri kategorileri (profil/anket, rızalar, analiz skorları, abonelik, uzman talebi; **fotoğraf ve landmark saklanmadığından bu kategoriler ihlal kapsamına giremez**), etkilenen kişi sayısı, alınan önlemler. `docs/incidents/YYYY-MM-DD.md`.
3. **Kurul bildirimi (≤ 72 saat):** KVKK "Veri İhlali Bildirim Formu" (kvkk.gov.tr). Avukat gözden geçirir.
4. **Kullanıcı bildirimi:** Aşağıdaki şablon, Resend ile; e-postası olmayan anonim hesaplar için uygulama içi uyarı.
5. **Sonrası:** Kök neden analizi, `docs/security-check.md` güncellemesi, gerekiyorsa SPEC değişikliği.

## Kullanıcı e-posta şablonu (taslak)

Konu: Aura hesabınla ilgili önemli bilgilendirme

Merhaba,

[Tarih] tarihinde Aura'da bir güvenlik olayı tespit ettik. Olay, [etkilenen veri kategorileri]'ni kapsıyor. Fotoğrafların ve yüz noktaların hiçbir zaman saklanmadığı için bu olaydan etkilenmedi.

Ne yaptık: [önlemler]. Ne yapabilirsin: [şifre/oturum önerisi, dikkat edilecek e-postalar].

Olay Kişisel Verileri Koruma Kurulu'na bildirildi. Sorularını [destek e-postası] adresine yazabilirsin.

Aura ekibi
