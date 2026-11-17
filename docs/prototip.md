# Yerel prototip (ana motor) — 3 komut

Gereken: Node 22 + pnpm, Supabase projesi (ref + access token), Gemini API anahtarı. Turnstile, ödeme, Sentry, PostHog, Resend boş kalır; kod bunları atlar.

```bash
git clone https://github.com/easyegitim/aura && cd aura && pnpm install
SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=<ref> GEMINI_API_KEY=... pnpm dev:bootstrap   # migration + anonim giriş + anahtarlar → .env.local
pnpm dev                                                                       # http://localhost:3000
```

Akış: Analizini başlat → yaş → rızalar → anket → /tara (kamera veya galeri) → skor (ücretsiz: teaser) → plan → rutin → deneme.

Tam skor/rapor/deneme için son kullanıcıyı premium yap (ödeme kurmadan); `--unlimited latest` eklersen analiz (haftada 1), deneme (7 günde 10) ve rapor yenileme limitleri de kalkar (test hesabı):

```bash
SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=<ref> pnpm dev:bootstrap --premium latest --unlimited latest
```

Kamera yalnız `localhost` veya HTTPS'te açılır; telefonda denemek için `pnpm dev --hostname 0.0.0.0` yerine Vercel preview kullan (aynı 4 ortam değişkeni).

Not: `dev:bootstrap` 22 Ekim 2026'da `spmplpgeeakucihumnzi` projesine karşı çalıştırıldı: 7 migration uygulandı, 14 tabloda RLS açık, 4 cron işi, `reserve_*` fonksiyonları yerinde, anonim giriş açık; `/api/health`, anonim oturum, `/api/analyses`, `/api/tryon/status`, `/api/billing/status` 200 döndü. Betik bir adımda başarısız olursa elle yapılacak adımı yazar.

## Claude motoru (hybrid.v1) ile deneme

Claude, fotoğrafta yalnız değiştirilebilir bakım, cilt yüzeyi, saç ve çekim koşullarını kategori olarak etiketler; skoru sunucu kodu hesaplar (SPEC 8.10). Açmak için komuta Anthropic anahtarını ekle:

```bash
SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=<ref> ANTHROPIC_API_KEY=sk-ant-... pnpm dev:bootstrap --premium latest --unlimited latest
```

Betik migration 0009'u uygular ve `.env.local`'e `SCORE_ENGINE=hybrid.v1`, `AI_OBSERVE_PROVIDER=claude`, `AI_COACH_PROVIDER=claude` yazar. Eski Gemini motoruna dönmek için `.env.local`'de `SCORE_ENGINE=legacy` yap ve `pnpm dev`'i yeniden başlat. Aynı fotoğrafı iki motorda karşılaştırmak için her iki ayarla birer analiz yap.

31 Ekim 2026 canlı denemesi (2 sentetik yüz, motor başına 2 tekrar): Claude yolu 2–4 sn ve analiz başına ~$0,025 (ilk çağrı önbellek yazımıyla ~$0,08). Aynı fotoğrafta tekrarlar arası genel skor farkı 0,0–0,2. Gemini yolunda aynı fotoğraf 0,2 oynadı. Yapısal alt skorlar (uyum, göz, çene) hybrid.v1'de yalnız cihaz geometrisinden gelir.
