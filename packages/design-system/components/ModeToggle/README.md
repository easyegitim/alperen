# ModeToggle

Yapay zekâ öğretmenin yanıt modunu seçer: **İpucu** (varsayılan), **Açıkla** (konuyu anlatır) ya da **Çözümü göster** (tam çözümü verir). Değer `conversations.mode` alanıdır: `hint` · `explain` · `solve`.

**Sen sağlarsın:** `value` ve `onChange` (kontrollü) ya da yalnızca `defaultValue` (kontrolsüz, varsayılan `hint`); `compact` (varsayılan `true`) şıkların alt satırını gizler; `compact={false}` ile açılır. Koç sohbetinde mesajın altında tek satırlık sade seçici olarak durur; mesaj içine gömülmez.

- İpucu modu varsayılandır; modu **öğrenci değiştirir**, sistem kendiliğinden başka moda geçmez.
- Radyo grubudur (`role="radiogroup"`): ok tuşları, Home ve End ile gezilir; seçili olan tek sekme durağıdır. Hedef boyutu en az 44px.
- Mod değişince öğretmen tek satırla onaylar; metinler `TUTOR_MODE_CONFIRMATIONS` içinde: "Tamam, bu soruda çözümü doğrudan göstereceğim."
