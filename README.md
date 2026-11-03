# Öğrenmen 2.0

Öğrenmen, öğrenciden öğrenen sanal bir eğitim koçudur: öğrencinin çözüm fotoğrafından hatasını ve eksiğini teşhis eder,
ustalığını (BKT) ve kavram yanılgılarını kayda geçirir, zamanla onu tanır; deneme sınavlarını analiz eder, kişiye özel
not ve deneme üretir, veliye 7/24 sohbet ve rapor sunar, ders videosundan öğrenir. Claude tabanlıdır (Messages API +
hafıza aracı, kendi döngümüz). Web uygulaması ve PWA önce gelir, mağaza sürümü Capacitor ile sonra. Öğrenci, veli ve
eğitmen tek uygulamadadır; müfredat dinamiktir (sistem kurar, eğitmen düzenler).

Ürün ve inşa planı: [`docs/PLAN-v2.md`](docs/PLAN-v2.md) (Türkçe, onaylı), tablo/şema/LLM kuralları:
[`docs/PLAN-v2-detail.md`](docs/PLAN-v2-detail.md). Marka ve tasarım kuralları: `packages/design-system/`.

## Yapı

Kök bir **bun çalışma alanıdır** (`apps/*`, `packages/*`); Python boru hatları ve Supabase kendi araçlarıyla çalışır.

| Dizin | Ne | Durum |
| --- | --- | --- |
| `apps/web/` | Next.js web + PWA: öğrenci, veli, eğitmen | var (P1 öğrenci çekirdeği) |
| `apps/worker/` | pg-boss iş işçisi (müfredat taslağı, öneriler, yükle/teşhis, dossier, gece işleri, PDF) | var (P1) |
| `packages/llm/` | Anthropic geçidi: rotalar, önbellek, parse, akış, defter, Batch, dossier, fake | var (P1) |
| `packages/prompts/` | ürün prompt'ları (sürümlü `.md` + kilit), katman birleştirme, eval (sahte kip), `prompt_versions` eşitlemesi | var (P1) |
| `packages/design-system/` | marka kitabı, `tokens.json`, TSX bileşenleri ve önizleme | var (P0) |
| `packages/contracts/` | sözleşmeler (JSON Schema, TS + Python doğrulayıcı; v2 şemaları) | var |
| `packages/mastery-math/` | BKT matematiği: TS, Python ve SQL aynı vektörleri geçer | var |
| `packages/pii/` | sade ad hash'leme ve temizleme (TS + Python + SQL) | var |
| `pipelines/common/` | `ogrenmen_common`: adaptörler, sahteler, `CostLedger`, `Runtime` | var |
| `pipelines/tablet/` | şablon stoğu, soru üretimi, SymPy doğrulama, şekil render | var |
| `pipelines/kalem/` | çıkmış sınav OCR, madde kümeleme, öncelik planı | var |
| `pipelines/ders/` | ders kaydı ve video analizi (ffmpeg + STT) | var |
| `pipelines/verify/` | doğrulama HTTP servisi (SymPy; `tablet/verify.py`'den) | P3 (henüz yok) |
| `packages/doc-render/` | belge AST'sinden PDF/HTML çıktısı | P3 (henüz yok) |
| `supabase/` | migration'lar (0001–0026), seed'ler, RLS ve RPC testleri | v2 taban + P1 ekleri |
| `content/tyt-matematik/` | TYT Matematik müfredatı ve şablonları (1 numaralı tohum içerik) | var |
| `fixtures/` | paylaşılan sahte veri (LLM cevapları, dev seed, ders/sınav örnekleri) | var |
| `scripts/` | `check-all.sh`, `lib.sh`, RPC/kopya/fixture denetimleri, `secret-scan.sh` | var |
| `docs/` | planlar, `SISTEM.md` (v1 anlatımı), `hukuk/` (dokunulmaz), `runbook/` | var |

## Nasıl çalıştırılır

Gerekenler: Node 22 (`.nvmrc`), bun 1.4, Python 3.13, ffmpeg. İsteğe bağlı: Postgres 16 + pgvector ve `psql` (canlı
veritabanı testleri). Hiçbir hesap, anahtar ya da `.env` dosyası gerekmez; dış servislerin deterministik sahteleri var.

```
bun install                       # çalışma alanı bağımlılıkları (kök bun.lock)
make check-quick                  # tüm denetimler, canlı servis olmadan (~10 dk)
make check                        # aynısı, ağır adımlar dahil
make check-live                   # + canlı Postgres (OGRENMEN_DATABASE_URL ya da yerel varsayılan)
make db-test                      # yalnız veritabanına bağlı modüller, canlı kipte
make dev-web                      # apps/web geliştirme sunucusu
make dev-worker                   # apps/worker geliştirme süreci
```

Denetimin tek kapısı `scripts/check-all.sh`'tir: önce kök denetimleri (sır taraması, kopya sapması, fixtures, RPC paritesi,
betik testleri, workflow lint'i), sonra `apps`, `packages`, `pipelines`, `supabase` ve `content` altında bulduğu her
`<modül>/check.sh`'i sırayla koşar; PASS/FAIL/SKIP özeti verir, herhangi bir FAIL çıkışı 1 yapar. Seçenekler:
`--quick` (canlı yok, ağır derleme yok), `--live` (`OGRENMEN_LIVE=1`), `--only <desen,...>`, `--list`.

Yeni modül eklerken kök dizinine bir `check.sh` koyun (bash, `set -euo pipefail`, lint + typecheck + birim testleri;
canlı servis gerektirenler `OGRENMEN_LIVE=1` yoksa `SKIP: ...` yazıp atlanır). `scripts/lib.sh` ortak yardımcıları
verir; mevcut `check.sh` dosyaları örnektir. Paket kurulumu her zaman kökten ve kilitle yapılır:
`flock /tmp/ogrenmen-bun.lock bun install`.

## Nerede kaldık

Plan `docs/PLAN-v2.md` §14 fazlarıyla ilerler. **P0 Temel** tamamlandı; **P1 Öğrenci çekirdeği** kodu yazıldı ve
2026-11-03 entegrasyon doğrulamasından geçti: `make check-quick` ve yerel Postgres ile `make check-live` yeşil
(20 adım: 6 kök + 14 modül, 0 FAIL). Gerçek API anahtarı gerektiren adımlar anahtar yokken SKIP yazar.

P1 uçtan uca yolculuk testi (`apps/web/e2e/p1-journey.spec.ts`, `OGRENMEN_LIVE=1`'de `apps/web/check.sh` koşar;
elle: `OGRENMEN_LIVE=1 bun run --cwd apps/web test:journey`): geçici v2 veritabanı + Supabase uyumlu yerel köprü
(`apps/web/e2e/journey/stack.ts`: Auth, PostgREST alt kümesi, Storage; RLS/RPC/Storage politikaları gerçek Postgres'te)
+ gerçek worker (pg-boss) + `next dev`, LLM sahte. Akış: e-posta koduyla giriş → onboarding "TYT Matematik" →
`suggestions.refresh` → Bugün kartı → Başla → sorular → tek cümle sonuç → Koç'ta bir tur (PgChatStore, `llm_calls`)
→ Yükle (fotoğraf, Storage) → `upload.intake` → `diagnosis.run` → "Çözümünü inceledim: …" tek cümle; ikinci test:
yeni ders ("Lineer Cebir") → özel ders + `ai_draft` müfredat → `curriculum.draft` → Hazırlıyorum → Bugün.

| Modül | Durum | Not |
|---|---|---|
| kök (sır taraması, drift, fixtures, RPC paritesi, betik testleri, workflow lint) | yeşil | actionlint yerelde yoksa SKIP, CI'da koşar |
| `supabase` (göçler 0001–0026: öneriler, alıştırma, onboarding, hafıza düzeltme, dossier v2, müfredat kurucu, yükleme) | yeşil | canlı kipte gerçek pg-boss şemasıyla da denetlenir |
| `apps/web` (Bugün · Koç · Gelişim, onboarding, test/sonuç, yükle/teşhis, eğitmen müfredat editörü) | yeşil | Playwright: sahte Supabase takımı + P1 yolculuğu (gerçek Postgres) canlı kipte |
| `apps/worker` (curriculum.draft, suggestions.refresh, upload.intake, diagnosis.run, sohbet özeti, öneri incelemesi) | yeşil | pg-boss ve iş zinciri testleri canlı kipte |
| `packages/llm` (geçit, dossier derleyici, hafıza işleyicileri, fake) | yeşil | canlı Anthropic testi `ANTHROPIC_API_KEY` ister (SKIP) |
| `packages/prompts` (9 prompt, kilit, eval, `prompt_versions`) | yeşil | canlı `count_tokens` anahtar ister (SKIP) |
| `packages/contracts`, `packages/design-system`, `packages/mastery-math`, `packages/pii` | yeşil | |
| `pipelines/{common,tablet,kalem,ders}` | yeşil | canlı testleri v1 şemasına yazılıydı: v2'de SKIP |
| `content/tyt-matematik` | yeşil | |

**Entegrasyonda düzeltilenler (2026-11-03):** `pipelines/common` `grants-v2.json` yeni göçlerle yeniden üretildi;
`packages/prompts` modül listesine (betik testleri) eklendi; `apps/web` `dev` betiği `next dev --webpack` oldu
(Turbopack çalışma alanı paketlerindeki `./x.js` → `./x.ts` içe aktarımlarını çözmüyor, Koç sayfası derlenmiyordu).

**Bilinen boşluklar (P1 sonrası):**

- **İlk alıştırma çıkmazı (yüksek):** TYT tohumunda alıştırma bankası yok; onaylı 20 soru teşhis testinindir ve
  `start_practice` bitirilmemiş teşhisin sorusunu almaz (anahtar sızmasın), `practice.generate` işinin işleyicisi de
  yok (registry'de `handler: null`). Yeni öğrencinin ilk "Başla"sı "Bu konu için soruları hazırlıyorum" ekranında kalır
  (600 sn sonra set `abandoned`). Öğrencinin açtığı `ai_draft` derslerde banka hep boştur. Yolculuk testi bu adımı
  `student-flow.db.test.ts` gibi teşhis sorularını alıştırma bankası sayarak geçer. Çözüm: `practice.generate`
  işleyicisi (şablon stoğu + SymPy doğrulama) ya da ilk testi teşhis sınavına yönlendirmek; o zamana dek
  `suggestions.refresh` yalnız uygun sorusu olan yapraklara alıştırma önermeli.
- **Koç üretimde kapalı:** `PgChatStore` RLS'i aşan bağlantıyla okur; `checkDbRole` bu yüzden üretimde 503 verir
  (yerelde yalnız `OGRENMEN_WEB_COACH_TRUSTED_DEV=1`). Üretim için okumalar kullanıcı JWT'siyle, yazımlar yalnız
  EXECUTE yetkili `ogrenmen_web_coach` rolüne verilmiş SECURITY DEFINER koç RPC'leriyle yapılmalı (pg-store.ts başlığı).
- **Worker rolü:** SQL'den kuyruğa atılan her iş (`onboarding_enroll`, `submit_upload`, `start_practice` …)
  `enqueue_job`'ın sahibinin (migration rolü; Supabase'de `postgres`) `pgboss` şemasına yazma hakkına dayanır. Worker
  başka rolle bağlanırsa işler sessizce düşer (`audit.events` `job.enqueue_failed`). Worker'ı migration rolüyle bağla
  ya da `supabase/README.md`'deki yetkileri ver; yolculuk testi worker'ı `ogrenmen_owner` rolüyle açar.
- Canlı Claude testi hiç koşmadı (anahtar yok): geçit `cache_read_input_tokens > 0` ölçütü ve prompt'ların
  `count_tokens` ≥ 512 eşiği ilk gerçek anahtarla `OGRENMEN_LIVE=1 bash packages/llm/check.sh` ve
  `packages/prompts/check.sh` ile doğrulanmalı.
- Supabase Realtime hiçbir testte yok (köprüde yok; Hazırlıyorum ve sonuç ekranları yoklamaya düşer, çalışıyor).
  Gerçek Supabase (GoTrue/PostgREST/Storage) ile duman testi barındırılan projede yapılmalı.
- `pipelines/{tablet,kalem,ders}` birkaç v1 tablo/RPC kullanır (`LEGACY_PIPELINE_TABLES`,
  `fakes/rpc-names-legacy-v1.json`; parite tablosunda WARN); P3 (doğrulama servisi) ve P5 (ders HTTP servisi) ile
  kalkar. `pipelines/common` içindeki Gemini/Groq-sohbet/OpenRouter/CF-AI adaptörleri yalnız bu eski sahte akışlar
  içindir; Claude yalnız `packages/llm`'dedir.
- `fixtures/db/dev-seed.json` ve `fixtures/{kitap,panel,kulaklik}` hâlâ v1 verisini taşır; v2 tohum verisi ayrı iştir.
- `packages/doc-render` (belge AST → PDF) P3 işidir; henüz yok (Bugün'deki belge kartları şimdilik yalnız testte).

**Bir sonraki adım:** P1 kapanışı — ilk gerçek Anthropic anahtarıyla canlı geçit/prompt denetimi, alıştırma bankası
(`practice.generate` ya da teşhis-önce akışı) ve koçun üretim yolu (JWT okumaları + koç RPC'leri); sonra P2 (deneme
sınavı ve rapor). Ekranlar mockup'lara (S01–S09b, S10/S10b, S12–S15) birebir uyar.

## Arşiv notu

v1 (Telegram botu, Cloudflare Worker, eğitmen paneli, `pipelines/kitap`, `pipelines/kulaklik_batch`) **commit
`4e2b756`'da** durur: `git show 4e2b756:apps/worker/README.md`, `git checkout 4e2b756 -- apps/panel` gibi geri
alınabilir. v1'in nasıl çalıştığı `docs/SISTEM.md`'de anlatılır (v2 için güncel değildir).
