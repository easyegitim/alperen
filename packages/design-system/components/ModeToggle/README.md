# ModeToggle

Yapay zekâ öğretmenin yanıt modunu seçer: **Sokratik** (varsayılan, ipucuyla kavratır) ya da **Doğrudan cevap** (çözümü gösterir).

**Sen sağlarsın:** `value` ve `onChange`; dar alanda `compact` alt satırları gizler. Seçim o oturum için geçerlidir ve sohbetin başında, mesaj kutusunun üstünde durur; mesaj içine gömülmez.

- Varsayılan her zaman Sokratik. Doğrudan cevap modu öğrencinin kendi seçimidir; sistem bunu kendiliğinden açmaz.
- Mod değişince öğretmen tek satırla onaylar: "Tamam, bu soruda çözümü doğrudan göstereceğim."
- Telegram'da karşılığı `/cevap` komutudur (Telegram bölümü).
