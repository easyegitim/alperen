# Mobil gizlilik testi (CLAUDE.md zorunlu testinin mobil karşılığı)

Web'de `tests/e2e/privacy.spec.ts` Playwright ile tüm ağ trafiğini izler. Mobilde trafik cihazdan çıkar; bu yüzden
test **mitmproxy** ile yapılır ve `privacy_addon.py` eklentisi kuralları uygular:

1. Görsel içeren gövde (`image/*`, multipart, `/9j/` ile başlayan base64 JPEG) yalnız `POST /api/analyses` ve `POST /api/tryon`'a gider.
   PostHog, Sentry, Supabase REST/Auth, RevenueCat, Resend, Turnstile ve diğer hiçbir yere gitmez.
2. `/api/analyses` gövdesinde 478 noktalık dizi yok (`landmarks` anahtarı veya 400'den fazla `{"x":` yok); yalnız `GeometryResult`.
3. PostHog/Sentry isteklerinde görsel, landmark, skor (`overall`, `potential`, `subscores`), metrik (`lengthRatio`…), e-posta yok.
4. İlerleme fotoğrafları (uygulama belge dizini) hiçbir isteğe girmez (dosya adı `progress/` veya dizin kimlikleri).
5. Ücretsiz hesapta API yanıtlarında kilitli değerler `null` + `locked:true`.

## Çalıştırma (gerçek cihaz veya emülatör; staging Supabase)

```bash
pip install mitmproxy
mitmdump -s mobile/tests/privacy/privacy_addon.py -w /tmp/aura-privacy.flow
# Cihazın Wi-Fi proxy'sini bilgisayarın IP'si:8080 yap; mitmproxy CA'sını cihaza kur (geliştirme derlemesi).
# Uygulamada: açılış → anonim → yaş → rızalar → anket → selfie → analiz → (premium) deneme.
# Eklenti ihlal bulursa konsola "PRIVACY VIOLATION" yazar ve çıkış kodu 1 ile biter.
```

Not: Android geliştirme derlemesinde kullanıcı CA'sına güvenmek için `app.config.ts` içinde yalnız development profilinde
`networkSecurityConfig` eklenir; production derlemesi bu ayarı taşımaz.
