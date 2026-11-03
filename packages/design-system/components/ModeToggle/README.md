# ModeToggle

Yapay zekâ öğretmenin yanıt modunu seçer: **İpucu** (varsayılan; adım adım yönlendirir), **Açıkla** (konuyu anlatır) ya da **Çözümü göster** (tam çözümü verir). Değer `conversations.mode` alanıdır: `hint` · `explain` · `solve`.

**Sen sağlarsın:** `value` ve `onChange` (kontrollü) ya da yalnızca `defaultValue` (kontrolsüz, varsayılan `hint`); dar alanda `compact` alt satırları gizler. Seçim sohbetin başında, mesaj kutusunun üstünde durur; mesaj içine gömülmez.

- İpucu modu varsayılandır; modu **öğrenci değiştirir**, sistem kendiliğinden başka moda geçmez.
- Radyo grubudur (`role="radiogroup"`): ok tuşları, Home ve End ile gezilir; seçili olan tek sekme durağıdır. Hedef boyutu en az 44px.
- Mod değişince öğretmen tek satırla onaylar; metinler `TUTOR_MODE_CONFIRMATIONS` içinde: "Tamam, bu soruda çözümü doğrudan göstereceğim."
