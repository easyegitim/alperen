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
| `apps/web/` | Next.js web + PWA: öğrenci, veli, eğitmen | P0'da kurulacak |
| `apps/worker/` | pg-boss iş işçisi (müfredat taslağı, dossier, gece işleri, PDF) | P0'da kurulacak |
| `packages/llm/` | Anthropic geçidi: rotalar, önbellek, parse, akış, defter, Batch, fake | P0'da kurulacak |
| `packages/design-system/` | marka kitabı, `tokens.json`, 19 bileşenin spesifikasyonu | var (TSX P0'da) |
| `packages/contracts/` | sözleşmeler (JSON Schema, TS + Python doğrulayıcı); zod'a taşınacak | var |
| `packages/mastery-math/` | BKT matematiği: TS, Python ve SQL aynı vektörleri geçer | var |
| `packages/pii/` | sade ad hash'leme ve temizleme (TS + Python + SQL) | var |
| `pipelines/common/` | `ogrenmen_common`: adaptörler, sahteler, `CostLedger`, `Runtime` | var |
| `pipelines/tablet/` | şablon stoğu, soru üretimi, SymPy doğrulama, şekil render | var |
| `pipelines/kalem/` | çıkmış sınav OCR, madde kümeleme, öncelik planı | var |
| `pipelines/ders/` | ders kaydı ve video analizi (ffmpeg + STT) | var |
| `supabase/` | migration'lar, seed'ler, RLS testleri (v2 temiz taban göçü P0'da) | var (v1; yeniden yazılıyor) |
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

Plan `docs/PLAN-v2.md` §14 fazlarıyla ilerler. Şu an **P0 Temel** sürüyor:

- Temizlik ve iskelet (P0-A): Telegram botu, eski panel, `pipelines/kitap` ve `pipelines/kulaklik_batch` kaldırıldı; kök bun
  çalışma alanı, `check.sh` keşfi, Makefile ve CI yeni yapıya geçirildi.
- Sırada: veritabanı v2 (temiz taban göç, RLS, RPC), zod-önce sözleşmeler, `packages/llm` geçidi, tasarım sistemi TSX,
  `apps/web` (Supabase Auth, 3 rol), `apps/worker` (pg-boss), 14 ekran mockup.
- Sonraki fazlar: P1 öğrenci çekirdeği (koç sohbeti, Sor, konu haritası), P2 deneme, P3 içerik stüdyosu, P4 tarz ve tahmin,
  P5 dersler, P6 veli ve bildirim, P7 eğitmen konsolu ve eval.
- Bilinen devir işleri: `supabase/` ve `fixtures/db/` hâlâ v1 şemasını (Telegram sütunları dahil) taşır; v2 göçü gelince
  `pipelines/common` `JsonlDb` eşlenikleri ve `scripts/check-rpc-parity.py` onunla hizalanır. `pipelines/common`
  içindeki Groq/Gemini adaptörleri `packages/llm` gelene kadar durur.

## Arşiv notu

v1 (Telegram botu, Cloudflare Worker, eğitmen paneli, `pipelines/kitap`, `pipelines/kulaklik_batch`) **commit
`4e2b756`'da** durur: `git show 4e2b756:apps/worker/README.md`, `git checkout 4e2b756 -- apps/panel` gibi geri
alınabilir. v1'in nasıl çalıştığı `docs/SISTEM.md`'de anlatılır (v2 için güncel değildir).
