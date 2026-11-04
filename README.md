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

Plan `docs/PLAN-v2.md` §14 fazlarıyla ilerler. **P0 Temel** tamamlandı; **P1 Öğrenci çekirdeği** ve ardından **P1-fix
(üretim kapıları)** yazıldı ve 2026-11-03 entegrasyon doğrulamasından geçti: `make check-quick` ve yerel Postgres ile
`make check-live` yeşil (20 adım: 6 kök + 14 modül, 0 FAIL). Gerçek API anahtarı gerektiren adımlar anahtar yokken SKIP yazar.

**P2 Deneme** (`docs/PLAN-v2.md` §2 Akış 2b, §8 deneme analizi hattı; ayrıntı `docs/PLAN-v2-detail.md` §2, §4) yazıldı:
okul denemesi yükleme (kitapçık ve optik form fotoğrafları; `submit_exam_upload`, 0030–0033), sayfa sınıflama ve soru
çıkarımı (`exam.analyse` / `upload.intake` school_exam), anahtar çıkarımı (`inferred_keys`, `verified` yalnız SymPy ile),
notlama ve deneme raporu (`exam.report`, `exam_report`), uygulama içi sınav oynatıcı (zamanlayıcı + soru ızgarası),
tek cümle sonuç ve belge PDF'i (`pdf.render`, `packages/doc-render`, Playwright A4). Sentetik deneme seti
`fixtures/exams/synthetic/` (gerçek yayıncı adı ya da logosu yok) `render.mjs` ile üretilir. Bu turda
`bash scripts/check-all.sh --quick` 20/20 PASS (2026-11-04); canlı kip (`--live`) ve gerçek anahtar bu turda koşulmadı.

P1 uçtan uca yolculuk testi (`apps/web/e2e/p1-journey.spec.ts`, `OGRENMEN_LIVE=1`'de `apps/web/check.sh` koşar;
elle: `OGRENMEN_LIVE=1 bun run --cwd apps/web test:journey`): geçici v2 veritabanı + Supabase uyumlu yerel köprü
(`apps/web/e2e/journey/stack.ts`: Auth, PostgREST alt kümesi, Storage; RLS/RPC/Storage politikaları gerçek Postgres'te)
+ gerçek worker (pg-boss) + `next dev`, LLM sahte. Üç test:

1. E-posta koduyla giriş → onboarding "TYT Matematik" → `suggestions.refresh` (+ `practice.prewarm`) → Bugün kartı →
   Başla → gerçek bankadan sorular (doğru şık tarayıcıya gelmez) → tek cümle sonuç → Koç'ta bir tur (SupabaseChatStore,
   yalnız RLS'li `coach_*` RPC'leri, `llm_calls`; sahte asistan turu/defter reddedilir) → Yükle (fotoğraf, Storage) →
   `upload.intake` → `diagnosis.run` → "Çözümünü inceledim: …" tek cümle.
2. Yeni ders "Lineer Cebir" → özel ders + `ai_draft` müfredat → `curriculum.draft` → Hazırlıyorum → Bugün "Planın
   eğitmen onayında" (otopilot üniversitede kapalı; ön ısıtma `skipped`, düğme yok) → eğitmen yayını
   (`curriculum_publish`) → ilk kart + `practice.prewarm` (`warmed`, sahte LLM) → ilk Başla < 30 sn'de soru getirir.
3. Bankası boş yaprak: `start_practice` → `needs_generation` → "Soruları hazırlıyorum…" → `practice.generate` (sahte LLM,
   anahtarlar `py/key_verify.py` ile `verified`) → oynatıcı `in_progress`, ≤ 30 sn (iş < 5 sn).

| Modül | Durum | Not |
|---|---|---|
| kök (sır taraması, drift, fixtures, RPC paritesi, betik testleri, workflow lint) | yeşil | actionlint yerelde yoksa SKIP, CI'da koşar |
| `supabase` (göçler 0001–0029: öneriler, alıştırma + soru üretimi, onboarding, hafıza düzeltme, dossier v2, müfredat kurucu, yükleme, koç RPC'leri, iş outbox'ı) | yeşil | canlı kipte gerçek pg-boss şemasıyla da denetlenir |
| `apps/web` (Bugün · Koç · Gelişim, onboarding, test/sonuç, yükle/teşhis, eğitmen müfredat editörü) | yeşil | Playwright: sahte Supabase takımı + P1 yolculuğu (gerçek Postgres) canlı kipte |
| `apps/worker` (curriculum.draft, suggestions.refresh, practice.generate/prewarm, upload.intake, diagnosis.run, outbox.drain, sohbet özeti, öneri incelemesi) | yeşil | pg-boss, açılış denetimi ve iş zinciri testleri canlı kipte |
| `packages/llm` (geçit, dossier derleyici, hafıza işleyicileri, fake) | yeşil | canlı Anthropic testi `ANTHROPIC_API_KEY` ister (SKIP) |
| `packages/prompts` (9 prompt, kilit, eval, `prompt_versions`) | yeşil | canlı `count_tokens` anahtar ister (SKIP) |
| `packages/contracts`, `packages/design-system`, `packages/mastery-math`, `packages/pii` | yeşil | |
| `packages/doc-render` (belge AST → HTML → PDF, A4, sunucu KaTeX, gömülü fontlar) | yeşil | Chromium yoksa PDF testleri SKIP, HTML testleri koşar |
| `pipelines/{common,tablet,kalem,ders}` | yeşil | canlı testleri v1 şemasına yazılıydı: v2'de SKIP |
| `content/tyt-matematik` | yeşil | |

**P1-fix (2026-11-03) — kapananlar:**

- **İlk Başla çıkmazı (F1):** 0027 teşhis dışlamasını "kayda atanmış ve bitmemiş" teşhise daraltır; alıştırmada teşhis
  soruları son çaredir (banka doldukça çekilir). `practice.generate` şablon (`py/template_fill.py`, SymPy) → yetmezse LLM
  (`question_generation`) ile bankayı ve seti doldurur; LLM anahtarı `py/key_verify.py` (`python3 -I`, SymPy) ile
  denetlenir: çelişen madde atılır, tutan `verified`, denetlenemeyen `inferred` kalır ve ustalığa
  `settings.practice_inferred_key_weight` (0.5) ağırlıkla girer. İstenmeyen yaprağı ölçen LLM maddesi atılır (yeniden
  etiketlenmez). Kalıcı hatada set `generation_failed`. `practice.prewarm` `curriculum.draft`, `suggestions.refresh` ve
  (yeni) ilk kartı ekleyen `app.first_practice_suggestion` (otopilotlu taslak, eğitmen yayını) sonrası ilk kartın
  yapraklarını ısıtır. Otopilotsuz taslakta Bugün düğmesiz "Planın eğitmen onayında" der (önceden "İlk testine başla"
  OGR-PRAC-008'e düşüyordu).
- **Şekil anahtarı sızıntısı:** `figures.code`/`code_hash`/`vision_report`/`render_log` authenticated'a kapalı (sütun
  yetkisi); personel `v_figures_staff` ile okur (0027, `14_practice.sql` 42501 testi, `grants-v2.json` yeniden üretildi).
- **Koç üretim yolu (F2):** apps/web Postgres'e doğrudan bağlanmaz (`pg` yalnız test bağımlılığı; `src/**` için ESLint
  `no-restricted-imports`). Koç turu `SupabaseChatStore` ile kullanıcının JWT'siyle yalnız 0028 `coach_*` RPC'lerini
  çağırır; model turları, `llm_calls`, koçun hafıza yazımı (`coach_memory_write`, actor `coach:<sohbet>`) ve eğitmen
  yönlendirmesi sohbete bağlı, ≤ 1 saatlik HMAC sunucu jetonu ister (anahtar `secure.server_keys('web_coach')`, web
  ortamında `OGRENMEN_WEB_COACH_KEY`). Koç sohbetine doğrudan INSERT kapalı; `course_id` yalnız öğrencinin kaydı olan ders.
- **Worker rolü (F3):** `enqueue_job` pgboss'a yazamazsa iş `secure.job_outbox`'a düşer (0029), worker `outbox.drain`
  her 30 sn aktarır. Worker açılışta pgboss yetkilerini, gerekli kuyrukları ve geri alınan bir `enqueue_job('startup.probe')`
  denemesini denetler (`apps/worker/src/startup-checks.ts`); düşerse 78 ile çıkar, `/healthz` `degraded`.
- **Bekleme ekranları:** ortak `useLive` (`apps/web/src/lib/live.ts`) Realtime'a abone olur, yoksa 2 sn → 5 sn yoklar
  (120 sn, sekme gizliyken durur).

**Kalan boşluklar:**

- **Gerçek Anthropic anahtarı:** canlı Claude testi hiç koşmadı. Geçidin `cache_read_input_tokens > 0` ölçütü, prompt'ların
  `count_tokens` ≥ 512 eşiği ve `question_generation`'ın gerçek model çıktısı (yaprak kodu, anahtar doğruluğu, maliyet)
  ilk anahtarla `OGRENMEN_LIVE=1 bash packages/llm/check.sh`, `packages/prompts/check.sh` ve bir `practice.generate`
  koşusuyla doğrulanmalı.
- **Barındırılan Supabase duman testi:** gerçek GoTrue/PostgREST/Storage ve Realtime hiçbir testte yok (yerel köprü
  bunların alt kümesidir); `useLive`'ın Realtime yolu, `figures` sütun yetkisinin PostgREST'teki etkisi ve koç sunucu
  jetonu barındırılan projede denenmeli. Worker imajındaki Python bağımlılıkları (Debian `python3-sympy`) derlemede denenmedi.
- `question_generation` sistem metni hâlâ worker'da satır içi (`routePrompt` yedeği, sürüm `worker-question_generation`):
  `packages/prompts/question_generation/` (prompt + frontmatter + eval + kilit) eklenmeli. LLM yolu şekil üretmez.
- Eğitmen yayını yolu yolculukta güvenilir oturumla çağrılır; eğitmen müfredat editöründen (`/egitmen/mufredatlar`) yayın → öğrencinin
  ilk Başla'sı uçtan uca ayrıca denenmeli.
- `pipelines/{tablet,kalem,ders}` birkaç v1 tablo/RPC kullanır (`LEGACY_PIPELINE_TABLES`,
  `fakes/rpc-names-legacy-v1.json`; parite tablosunda WARN); P3 (doğrulama servisi) ve P5 (ders HTTP servisi) ile
  kalkar. `pipelines/common` içindeki Gemini/Groq-sohbet/OpenRouter/CF-AI adaptörleri yalnız bu eski sahte akışlar
  içindir; Claude yalnız `packages/llm`'dedir.
- `fixtures/db/dev-seed.json` ve `fixtures/{kitap,panel,kulaklik}` hâlâ v1 verisini taşır; v2 tohum verisi ayrı iştir.
- P2 deneme hattının canlı kipte (`OGRENMEN_LIVE=1`) ve sahte LLM dışında gerçek model çıktısıyla (sayfa sınıflama,
  anahtar, notlama) doğrulanması bekliyor; P2 yolculuk testi canlı Postgres üzerinde ayrıca koşulmalı.
- Bugün'deki belge kartları yalnız P3 öncesi testlerde; belge kapsamı (P3) `document.generate` işiyle genişler
  (`apps/worker` kayıt defterinde şimdilik bekleyen tanım).

**Bir sonraki adım:** P2'nin `OGRENMEN_LIVE=1 bash scripts/check-all.sh --live` ile doğrulanması; ilk gerçek Anthropic
anahtarıyla canlı geçit/prompt/soru üretimi denetimi ve barındırılan Supabase duman testi; sonra P3 (doğrulama servisi +
belge PDF) ve P5 (dersler).
Ekranlar mockup'lara (S01–S09b, S10/S10b, S12–S15) birebir uyar.

## Arşiv notu

v1 (Telegram botu, Cloudflare Worker, eğitmen paneli, `pipelines/kitap`, `pipelines/kulaklik_batch`) **commit
`4e2b756`'da** durur: `git show 4e2b756:apps/worker/README.md`, `git checkout 4e2b756 -- apps/panel` gibi geri
alınabilir. v1'in nasıl çalıştığı `docs/SISTEM.md`'de anlatılır (v2 için güncel değildir).
