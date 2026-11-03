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
| `apps/web/` | Next.js web + PWA: öğrenci, veli, eğitmen | var (P0 iskeleti) |
| `apps/worker/` | pg-boss iş işçisi (müfredat taslağı, dossier, gece işleri, PDF) | var (P0 iskeleti) |
| `packages/llm/` | Anthropic geçidi: rotalar, önbellek, parse, akış, defter, Batch, fake | var (P0) |
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
| `supabase/` | migration'lar (0001–0019), seed'ler, RLS ve RPC testleri | v2 taban (RPC'ler dahil) |
| `content/tyt-matematik/` | TYT Matematik müfredatı ve şablonları (1 numaralı tohum içerik) | var |
| `fixtures/` | paylaşılan sahte veri (LLM cevapları, dev seed, ders/sınav örnekleri) | var |
| `scripts/` | `check-all.sh`, `lib.sh`, RPC/kopya/fixture denetimleri, `secret-scan.sh` | var |
| `docs/` | planlar, `SISTEM.md` (v1 anlatımı), `hukuk/` (dokunulmaz), `runbook/` | var |

## Nasıl çalıştırılır

Gerekenler: Node 22 (`.nvmrc`), bun 1.4, Python 3.13, ffmpeg. İsteğe bağlı: Postgres 16 + pgvector ve `psql` (canlı
veritabanı testleri). Hiçbir hesap, anahtar ya da `.env` dosyası gerekmez; dış servislerin deterministik sahteleri var.

```
bun install                       # çalışma alanı bağımlılıkları (kök bun.lock)
make check-quick                  # tüm denetimler, canlı servis olmadan (~6 dk)
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

Plan `docs/PLAN-v2.md` §14 fazlarıyla ilerler. **P0 Temel tamamlandı** (2026-11-03 entegrasyon doğrulaması):
`make check-quick` ve yerel Postgres ile `make check-live` yeşil (19 adım: 6 kök + 13 modül, 0 FAIL). Gerçek API
anahtarı gerektiren adımlar anahtar yokken SKIP yazar; canlı kipte bile atlananlar aşağıdaki tabloda.

| Modül | Durum | Not |
|---|---|---|
| kök (sır taraması, drift, fixtures, RPC paritesi, betik testleri, workflow lint) | yeşil | actionlint yerelde yoksa SKIP, CI'da koşar |
| `supabase` (v2 göçleri 0001–0019, RLS, RPC, SQL testleri) | yeşil | canlı kipte gerçek pg-boss şemasıyla da denetlenir |
| `apps/web` (Next.js, Supabase Auth 3 rol + davet, kabuklar, PWA) | yeşil | `next build` ve Playwright E2E (sahte Supabase) canlı/ağır kipte koşar |
| `apps/worker` (pg-boss iş kayıt defteri, zamanlamalar, PDF, sağlık, Dockerfile/Fly) | yeşil | pg-boss entegrasyon testi canlı kipte |
| `packages/llm` (Anthropic geçidi: rotalar, önbellek, parse, akış, refusal, Batch, defter, fake) | yeşil | canlı Anthropic testi `ANTHROPIC_API_KEY` ister (SKIP) |
| `packages/contracts` (zod-önce şemalar, JSON Schema + Python) | yeşil | |
| `packages/design-system` (token → CSS/Tailwind, TSX bileşenler, önizleme) | yeşil | önizleme derlemesi yalnız ağır kipte |
| `packages/mastery-math`, `packages/pii` | yeşil | |
| `pipelines/{common,tablet,kalem,ders}` | yeşil | canlı testleri v1 şemasına yazılıydı: v2'de SKIP |
| `content/tyt-matematik` | yeşil | |
| Mockup'lar (14 ekran, sadelik ilkesiyle yeniden çizildi) | tamam | bağlayıcı başvuru: https://claude.ai/artifact/NCt864XDLk6o6Rrm6dPDuo |

**Bilinen boşluklar (P0 sonrası):**

- Canlı Claude testi hiç koşmadı (anahtar yok): geçit testi `cache_read_input_tokens > 0` kabul ölçütü ilk gerçek
  anahtarla `OGRENMEN_LIVE=1 bash packages/llm/check.sh` ile doğrulanmalı (P1 başında).
- Öğrenci kabuğu plan §13'teki 3 sekmeye (Bugün · Koç · Gelişim, Sor düğmesi) indi; `PdfViewer`, `SuggestionCard`,
  `OneLineResult` bileşenleri tasarım sisteminde var. Ancak `suggestions` tablosu ve `suggestions.refresh` işi yok:
  Bugün ekranı şimdilik boş durum çizer (P1 hazırlık işi).
- `upsert_memory_file` öğrencinin kendi hafıza dosyalarını doğrudan yazmasına izin verir (aktör `student:<uid>` olarak
  kaydedilir). Plan §3.2 "öğrenci okur, düzeltme ister" der: düzeltme isteği iş kuyruğuna (ör. `memory.correction`)
  taşınmalı ya da kurucu doğrudan düzenlemeyi plana yazmalı.
- TYT içeriği için v2 cevap anahtarı tohumu yok (`db-test.sh`: "SKIP: no keys"); `fixtures/db/dev-seed.json` ve
  `fixtures/{kitap,panel,kulaklik}` hâlâ v1 verisini taşır (v1 Telegram satırları şemasız kalır; `bot-response-log`
  şeması kaldırıldı). v2 tohum verisi ayrı iştir.
- `pipelines/{tablet,kalem,ders}` birkaç v1 tablo/RPC kullanır (`LEGACY_PIPELINE_TABLES`,
  `fakes/rpc-names-legacy-v1.json`; parite tablosunda WARN); P3 (doğrulama servisi) ve P5 (ders HTTP servisi) ile
  kalkar. `pipelines/common` içindeki Gemini/Groq-sohbet/OpenRouter/CF-AI adaptörleri yalnız bu eski sahte akışlar
  içindir; Claude yalnız `packages/llm`'dedir. `make ders` hedefi kaldırıldı (P5'te HTTP servisi olur).
- `packages/doc-render` (belge AST → PDF) P3 işidir; henüz yok.

**Bir sonraki adım:** P1 öğrenci çekirdeği — önce P1 hazırlığı (`suggestions` tablosu + `suggestions.refresh` işi,
Bugün/Koç/Gelişim ekranlarını mockup S02/S03/S08 ile görsel karşılaştırma), sonra ders seçimi + müfredat taslağı işi, dossier
derleyici + hafıza işleyicileri, Koç sohbeti, Sor (yakalama → teşhis → observations) ve Konu haritası. Ekranlar
mockup'lara (S01–S09b, S10/S10b, S12–S15) birebir uyar. P1 ilk gerçek Anthropic anahtarını ister.

## Arşiv notu

v1 (Telegram botu, Cloudflare Worker, eğitmen paneli, `pipelines/kitap`, `pipelines/kulaklik_batch`) **commit
`4e2b756`'da** durur: `git show 4e2b756:apps/worker/README.md`, `git checkout 4e2b756 -- apps/panel` gibi geri
alınabilir. v1'in nasıl çalıştığı `docs/SISTEM.md`'de anlatılır (v2 için güncel değildir).
