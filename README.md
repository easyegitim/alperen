# Öğrenmen

Öğrenmen, easy'nin yapay zekâ destekli öğrenme modelidir: her öğrenciye kendi hızında eşlik eden bir AI öğretmen.
İlk sürüm bir Telegram botudur. Öğrenci 20 soruluk teşhis testini çözer, bot kazanım ağacındaki ustalığını (BKT) ve
kavram yanılgılarını tablolara yazar, sonra Sokratik bir sohbetle ipucu verir, onaylı pratik sorularını gönderir ve
emin olmadığında hocaya yönlendirir. Eğitmen paneli (Next.js, statik) cevapsız soruları, sessiz öğrencileri, ders
raporlarını, onay kuyruğunu ve maliyeti gösterir. Pilot, 5 öğrencilik bir TYT Matematik grubudur.

Tasarımın üç kuralı var: önce veritabanı, sonra LLM (komutlar, şık cevapları, kota ve teşhis modeli çağırmaz);
her çağrının fiyatı ve kaydı vardır ve tavan koddadır; öğrenci verisi korunur (rastgele kimlik, LLM'e giden her
metin PII temizleyicisinden geçer, cevap anahtarları `secure` şemasındadır ve LLM'in çalıştığı roller onları
göremez). Tüm dış servisler bir adaptörün arkasındadır ve deterministik bir sahtesi vardır; bu yüzden depo hiçbir
hesap ve anahtar olmadan kurulur, çalışır ve test edilir. Kaynaklar: `docs/plan.md` (kapsam), `docs/BLUEPRINT.md`
(uygulama planı), `packages/design-system/` (marka ve bot metin kuralları).

## Depo haritası

| Dizin | Ne | Modül |
| --- | --- | --- |
| `docs/plan.md`, `docs/BLUEPRINT.md`, `docs/drafts/` | kurucunun planı, uygulama planı, taslaklar (salt okunur) | — |
| `docs/hukuk/` | KVKK aydınlatma, veli onayı, kayıt bildirimleri, saklama politikası taslakları (avukat onayı bekler) | M12 |
| `docs/runbook/kurucu.md` | hesap açma, deploy, yedek, anahtar döndürme, harcama tavanı — tek sayfa | M13L |
| `packages/design-system/` | marka kitabı, bileşen paketi, `telegram.md` bot metin kuralları (salt okunur) | — |
| `packages/contracts/` | JSON Schema sözleşmeleri, `models.json` fiyat/zincir tablosu, TS + Python doğrulayıcı | M00 |
| `packages/mastery-math/` | BKT matematiği: TS, Python ve SQL aynı 41 vektörü geçer | M00 |
| `packages/pii/` | PII temizleyici (TS + Python + SQL hash), ≥ 60 ortak vaka | M01 |
| `fixtures/` | paylaşılan sahte veri: Telegram güncellemeleri, LLM cevapları, dev seed, panel verisi | M01 |
| `supabase/` | 17 migration, seed'ler, RLS/grant matrisi, düz SQL testleri, `db-test.sh`, `mint-jwt.ts` | M02 |
| `content/tyt-matematik/` | müfredat `TYT-MAT@2026.1`: 18 yaprak kazanım, 27 yanılgı etiketi, 20 teşhis maddesi, 6 şablon | M03 |
| `apps/worker/` | Cloudflare Worker: Telegram botu, LLM yönlendirici, kota, hafıza, cron | M04 |
| `pipelines/common/` | `ogrenmen_common`: adaptörler, sahteler, `JsonlDb`, `CostLedger`, `Runtime` | M05 |
| `pipelines/tablet/` | `ogrenmen_tablet template`: sıfır LLM şablon soruları, `register_template_question` ile onaylı stok | M06T |
| `apps/panel/` | eğitmen paneli: Next.js 14.2 statik export, design-system bundle, mock/live veri | M11 |
| `scripts/` | `check-all.sh`, `check-rpc-parity.py`, `check-drift.py`, `check-fixtures.py`, `secret-scan.sh` ve testleri | M13L |
| `.github/workflows/ci.yml` | hesapsız CI: sır taraması + actionlint + `make check-quick`; M04/M11 ağır build'leri; pgvector'lü Postgres ile canlı `make db-test` | M13L |
| `Makefile`, `package.json`, `.editorconfig`, `.nvmrc`, `.gitignore` | kök kısayollar (workspaces yok; modüller `file:` bağlarıyla bağımsız) | M13L |

## 10 dakikada hesapsız yerel çalıştırma

Gerekenler: Node 22 (`.nvmrc`), bun 1.4, Python 3.13 + pip, ffmpeg. İsteğe bağlı: Postgres 16 + pgvector ve `psql`
(canlı veritabanı testleri için). Hiçbir hesap, anahtar ya da `.env` dosyası gerekmez.

```
git clone <depo> alperen && cd alperen

# 1) Python paketleri (yerel yol bağımlılıkları sırayla)
python -m pip install -e packages/contracts/python[dev] -e packages/mastery-math/python[dev] -e packages/pii/py[dev] \
  -e pipelines/common[dev] -e pipelines/tablet[dev] sqlfluff pglast yamllint

# 2) TypeScript paketleri (önce paylaşılan paketler, sonra uygulamalar)
for d in packages/contracts packages/mastery-math packages/pii/ts apps/worker apps/panel supabase; do bun install --cwd "$d"; done

# 3) Her şeyin çalıştığını gör (ağır build adımları hariç, ~5 dk)
make check-quick

# 4) Botu ve paneli sahte veriyle aç (iki terminal; talimat: make dev)
make dev-worker      # Worker :8787 + sahte Telegram Bot API :8788
curl -X POST localhost:8788/sendUpdate -H 'content-type: application/json' -d @fixtures/telegram/private_text.json
curl localhost:8788/outbox
make dev-panel       # http://localhost:3000  (?role=coordinator | instructor | observer)

# 5) Pratik sorusu stokunu kuru çalıştır (LLM yok; RPC kayıtları out dizininde)
make fill-dry        # /tmp/ogrenmen-fill-dry/template_fill.json
```

`make help` tüm hedefleri listeler: `check`, `check-quick`, `db-test`, `db-migrate`, `rpc-parity`, `fixtures-valid`,
`drift`, `fill-dry`, `dev`. `make db-migrate` (barındırılan projeye ilk kurulum ya da `MIGRATION=<dosya>` ile tek yeni
migration; `DB_URL` ister) yalnız kurucu runbook'unda kullanılır. Python hedefleri `PYTHON=python3` (değiştirilebilir).

## Kabul komutları

`scripts/check-all.sh` tamamlanmış her modülün `docs/BLUEPRINT.md` §11 kabul komutlarını sırayla çalıştırır ve her
adım için bir satır yazar (PASS/FAIL/SKIP + süre); sonunda özet verir, herhangi bir FAIL → çıkış 1. Adımların listesi:
`bash scripts/check-all.sh --list`.

```
bash scripts/check-all.sh --quick          # hesapsız; wrangler build ve panel üretim derlemesi atlanır (CI bunu koşar)
bash scripts/check-all.sh                  # tam: ağır build adımları dahil
OGRENMEN_DATABASE_URL=postgresql://kullanici:parola@127.0.0.1:5432/postgres bash scripts/check-all.sh
                                           # + canlı db-test.sh (geçici veritabanı) + tablet live testleri
bash scripts/check-all.sh --only M02,M13   # yalnız seçilen modüller (M13L = M13; bilinmeyen ad → çıkış 2)
python scripts/check-rpc-parity.py && python -m pytest scripts/tests -q
yamllint -d relaxed .github/workflows && make -n check
```

| Modül | check-all'un çalıştırdığı |
| --- | --- |
| M00 | contracts `gen` + typecheck + test + üretilen dosyalar commit'liyle aynı; Python pytest; mastery-math TS ve Python |
| M01 | pii TS + Python testleri, iki dilin `dump` çıktısı aynı, `fixtures/**/*.json` okunur, `lesson-01.wav` çözülür |
| M02 | `lint.sh` (sqlfluff + yorum blokları + dev seed + kopyalar), `check_sql.py --grants-matrix`, `db-test.sh`, `mint-jwt.ts` |
| M03 | `validate.py`, `export-sql.py` (anahtarsız, yer tutucusuz, çocuk dili işaretli), `--as-version 2027.1`, içerik pytest |
| M04 | worker typecheck + lint + test; `build` (yalnız tam kipte); kaynakta anahtar/`service_role` yok; `texts.ts`'te ünlem/emoji yok |
| M05 | `ogrenmen_common` ruff + pytest, `selftest`, `Runtime.from_env(dry_run=True)` → `FakeLLM` |
| M06T | tablet ruff + pytest, `template --id kesir-modeli-toplama`, `template --fill --min-stock 30 --dry-run`; DB varsa `-k live` (atlanan test FAIL) |
| M11 | panel sync:ds + typecheck + lint + test (üç derleme içerir); mock build + anahtar/CDN taraması (yalnız tam kipte); `lang="tr"` |
| M12 | 8 hukuk belgesi ve uyarı satırı, yer tutucular `placeholders.json`'da, grup bildirimi ve çocuk dili işaretleri |
| M13L | BKT/PII kopya sapması, fixtures-valid, RPC adı + parametre paritesi, `scripts/` ruff + pytest, workflow lint'i |

**M13L denetimleri:**

- `scripts/check-rpc-parity.py` — (a) Worker, panel ve pipelines `rpc-names.json` listelerindeki her ad migration'larda
  gövdeli bir `create function` olmalı; §3.0 "Görünümler ve yardımcılar" nesneleri (görünümler, `app.*` yardımcıları)
  var olmalı ve tablo imza verdiyse parametre adları aynı olmalı. (b) Worker'ın `apps/worker/src` içindeki PostgREST
  `rpc` çağrılarının gövde anahtarları, panelin `lib/data/live.ts` çağrıları ve pipelines'ın `db.rpc(...)` çağrıları
  SQL imzalarının giriş parametreleriyle birebir (pglast); bilinmeyen anahtar, eksik zorunlu parametre ya da
  çözümlenemeyen çağrı → FAIL. JsonlDb eşleniklerinin (`fakes/jsonl_rpc.py`) imzaları da SQL'le karşılaştırılır.
  Çıktı tablo, çıkış kodu 0/1 (`--only-problems`, `--json`).
- `scripts/check-drift.py` — `packages/mastery-math/sql/bkt.sql` ↔ `0011_mastery.sql` `-- begin bkt`…`-- end bkt`,
  `packages/pii/sql/name_token_hashes.sql` ↔ `0003_identity.sql` `-- begin pii`…`-- end pii` birebir.
- `scripts/secret-scan.sh` — izlenen ve yok sayılmayan dosyalarda gerçek görünümlü anahtar (Google `AIza…`, Groq
  `gsk_…`, OpenRouter `sk-or-v1-…`, JWT, Supabase `sb_secret_…`, Telegram bot jetonu, özel anahtar bloğu); değer
  yazılmaz, yalnız dosya:satır. Ad geçişleri ve düzenli ifade metinleri eşleşmez.
- `scripts/check-fixtures.py` — `fixtures/llm/<amaç>/*.json` klasör → şema eşlemesiyle `ogrenmen_contracts`'tan geçer,
  `bad-schema*.json` geçmez; `dev-seed.json`'da tam bir aktif müfredat ve `default_period`; teşhis maddeleri
  `content/tyt-matematik/diagnostic/items.json` ile aynı mı (fark UYARI listesidir, FAIL değil).

### Kabul komutu notu

- **`/tmp` çıktı yolları.** §11 komutları `/tmp/pii-ts.json`, `/tmp/seed.sql`, `/tmp/tablet-out` gibi sabit yollara
  yazar. `check-all.sh` bunları çalışmaya özel geçici bir dizine taşır (eski bir `/tmp/tablet-out/figures/*.png` yanlış
  PASS üretmesin); komutların geri kalanı aynıdır. Yalnız `/tmp` çıktıları yalıtılır: depo içi derleme çıktıları
  (`apps/panel/.next` ve `out/`, `apps/worker/dist`, `packages/contracts/src/generated`, `apps/panel/public/ds`,
  `node_modules`) paylaşılır. Bu yüzden aynı depoda koşular **sıraya girer**: betik depo dışında, kök yolunun
  sağlamasıyla adlandırılmış bir kilit (`$TMPDIR/ogrenmen-check-all-<sağlama>.lock`, `flock`) alır; ikinci koşu
  "Başka bir check-all koşusu sürüyor" yazıp en çok 30 dakika bekler (iki üst üste koşu M11'i
  `ENOENT rename .next/export/500.html` ile yanlış FAIL ettirmişti). `flock` olmayan sistemde (macOS) uyarı yazılır.
- **Boş PASS yok.** `--only` yalnız `--list`'teki modül adlarını kabul eder (M13L, M13'ün eşidir; `M06`, `M99` gibi
  ad çıkış 2). Seçimle eşleşen adım yoksa çıkış 1. `OGRENMEN_DATABASE_URL` tanımlıyken `db-test.sh`
  "SKIP: no database" yazarsa ya da tablet live testlerinden biri atlanırsa (ör. `psql` yok) adım FAIL olur; DB varken
  live testleri `m06t_tablet` adımında seçilmez (`-m "not live"`), yalnız `m06t_live`'da bir kez koşar.
- **M04 anahtar taraması** (`! grep -rn … apps/worker/src | grep -v "// anahtar yok"`) `pipefail` altında ilk
  `grep`'in hata kodunu (2, ör. dizin yok) "bulgu yok" saymasın diye çıkış kodu ayrıca denetlenir.
- **Kök yolu.** Komutlar `/home/user/alperen` yerine betiğin bulunduğu deponun kökünü kullanır (CI'da checkout yolu
  farklıdır); komutlar boş bir geçici dizinden çalışır, yani "her cwd'den" koşulu her koşuda sınanır.
- **Canlı db-test veritabanı adı.** `OGRENMEN_TEST_DB` verilmediyse `ogrenmen_checkall_<pid>` kullanılır (varsayılan
  `ogrenmen_test` başka bir koşuyla çakışmasın); bağlanılan veritabanına dokunulmaz.
- **M04 `texts.ts` taraması** Worker README'sindeki notla aynı biçimde, `LC_ALL=C.UTF-8` ile ve "grep çıkış 1 = temiz"
  ayrımıyla çalışır (POSIX yerel ayarında `! grep -P '\x{1F300}'` hata kodunu da başarı sayardı).
- **M06T komutları** BLUEPRINT §11'deki M06 satırı değil, pilot diliminin (`pipelines/tablet/README.md`) komutlarıdır:
  `generate` ertelendi.
- **Blueprint'in M13 satırı** (`bun install --frozen-lockfile` kökte, `dev-up.sh --check`, `docs-consistency.test.ts`,
  tüm workflow'lar) bu yalın entegrasyonda yoktur; kök `package.json`'da bağımlılık ve workspaces olmadığı için kökte
  kurulum adımı da yoktur. `check-rpc-parity` blueprint'te `.sh`, burada `.py`'dir (pglast doğrudan kullanılır).
- **CI sır taraması** BLUEPRINT §8'deki `gitleaks` işi yerine `scripts/secret-scan.sh`'tir (`git grep` + desenler):
  gitleaks ikilisi ve eylemi GitHub sürüm indirmesi ister (bu ortamda kapalı; kuruluş hesabında eylem lisans gizi de
  ister), betik ise hesapsız ve yerelde test edilebilir. `actionlint` PyPI'deki `actionlint-py==1.7.12.25` ile kurulur.
  CI'da üç iş var: `quick` (`make check-quick`), `heavy` (`check-all.sh --only M04,M11` tam kip: wrangler build ve
  panel paketinde anahtar/CDN taraması) ve `db-live`. Eylemler commit SHA'sına sabitlidir.

## Pilot öncesi yapılacak hesap ve erişim listesi

Adımların komutları `docs/runbook/kurucu.md`'dedir. Hiçbir anahtar depoya, `.env`'e ya da GitHub'a yazılmaz.

- [ ] **Telegram**: BotFather ile bot, `/setprivacy` → Disable, `/setcommands`, profil fotoğrafı maskot.
- [ ] **Supabase**: proje (bölge `eu-central-1`), Exposed schemas yalnız `public`, migration + seed + müfredat +
      cevap anahtarları, ilk koordinatör (`auth.users` + `public.staff`).
- [ ] **JWT basımı** (kurucu makinesinde, proje JWT secret'ıyla): `bot_runtime` (Worker) ve `batch_worker`
      (pipelines) için 90 günlük jetonlar (`supabase/scripts/mint-jwt.ts`).
- [ ] **Gemini**: ücretli proje (5 $ ön yükleme, Google Cloud bütçe uyarısı 3 $ / 20 $) + ücretsiz katman anahtarı.
- [ ] **Groq** ve **OpenRouter**: ücretsiz anahtarlar (fatura yok).
- [ ] **Cloudflare**: Workers Paid planı, `wrangler secret put` ile 11 giz (+ isteğe bağlı `CF_AI_TOKEN`,
      `CF_ACCOUNT_ID`), Pages projesi `ogrenmen-panel`.
- [ ] **Hukuk**: `docs/hukuk/` taslakları avukat onayından geçer; veli onay formu ve grup kayıt bildirimi yayımlanır.
- [ ] Bot her gruba "Pin messages" hakkıyla yönetici olarak eklenir; panelde `bot_is_admin` doğrulanır.

## Pilot kapısı

Tüm öğrencilere açılış takvime değil `settings.pilot_gate` eşiklerine bağlıdır (soru doğruluğu ≥ 0,90, teşhis
örtüşmesi ≥ 0,60, öğrenci başına maliyet ≤ 0,10 $, işaretli cevap ve bozulma payı ≤ %5, yalıtım ve anahtar sızıntısı
testleri geçti). Panel `/maliyet` "Pilot kapısı" bloğu ölçüt başına PASS / FAIL / NO_DATA gösterir; `NO_DATA` kapıyı
açmaz. Ölçümleri üreten gece işi (`kulaklik metrics --gate`, M07) ertelendiği için pilotun ilk haftalarında kapı
`KAPALI` ve çoğu ölçüt `NO_DATA` görünür; bu beklenen durumdur.

## Nerede kaldık

Kurucunun kabul ettiği değerlendirme kapsamı 5 öğrencilik TYT pilotunun ihtiyacına daralttı.

**Bitmiş (kabul komutları `check-all.sh` ile koşuyor):**

| Modül | Durum |
| --- | --- |
| M00 contracts + mastery-math | tamam |
| M01 pii + fixtures | tamam |
| M02 supabase | tamam (yerel pgvector 0.6 için `halfvec` yedeği; `supabase/README.md`) |
| M03 içerik (TYT Matematik) | tamam |
| M04 Worker (Telegram botu) | tamam |
| M05 `ogrenmen_common` | tamam |
| M06T tablet şablon dilimi | yalnız sıfır LLM `template` komutu (`--id`, `--auto-approve`, `--fill`) |
| M11 eğitmen paneli | tamam |
| M12 hukuk taslakları | tamam (avukat onayı bekliyor) |
| M13L yalın entegrasyon | bu dizinler: `scripts/`, `Makefile`, CI, README, kurucu runbook'u |

**Ertelenmiş (pilot sonrası; BLUEPRINT bölümleri hazır):**

| Modül | Ne eksik | Pilota etkisi |
| --- | --- | --- |
| M06 LLM üretimi | `tablet generate`, `render --queue`, `vision`, `verify`, `pdf`, `review-queue`, `notes ingest` | pratik soruları yalnız şablonlardan ve eğitmenden; şablonsuz yapraklarda pratik sorusu yok (#53) |
| M07 `kulaklik_batch` | gece olgu çıkarımı, haftalık özet, panel metrikleri, pilot kapısı, maliyet raporu, `cost-guard` | hafıza yalnız son mesajlarla; kapı `NO_DATA`; harcama tavanını Worker'ın saatlik `check_spend` cron'u korur |
| M08 `ders` | ders videosu analizi (`register`, `analyze`, `purge`) | ders raporu yok; panel `/dersler` boş |
| M09 `kalem` | sınav arşivi OCR, kümeleme, öncelik planı | `/oncelik` "plan yok" satırını gösterir |
| M10 `kitap` | araştırma ajanı | `research_enabled=false` (zaten pilotta kapalı) |
| M13 tam | `nightly.yml`/`weekly.yml`/`keepalive.yml`/`deploy-*.yml`, ADR'ler, diğer runbook'lar, `dev-up.sh`, `docs-consistency.test.ts`, `set-webhook.ts` | gece şablon dolumu ve haftalık yedek elle (`docs/runbook/kurucu.md`) |

**Takip maddeleri (açık uyarılar):**

- `fixtures/db/dev-seed.json`'daki 20 teşhis sorusundan 19'u ve teşhis testi kimliği
  `content/tyt-matematik/diagnostic/items.json` / `export-sql.py` ile aynı değil (`python scripts/check-fixtures.py`
  fark listesini yazar). Dev dünyasında bot ve panel farklı teşhis maddeleri gösterir; M01 fixture'ı `items.json`'dan
  yeniden üretilmeli (`content/tyt-matematik/README.md` "Kabul komutu notu").
- `register_template_question`: SQL'de `p_figure` zorunlu, JsonlDb eşleniğinde varsayılanlı (`check-rpc-parity` WARN).
  Bugünkü tek çağıran (tablet) parametreyi her zaman gönderiyor; eşlenik SQL'e hizalanmalı.
- Worker'ın `bot_runtime` yetki boşlukları (ops alarmı yazımı, düzenlenen mesaj, `storage_deletions`,
  `proactive_messages` güncellemesi): `apps/worker/README.md` "Kabul komutu notu" 11. Worker bunları en iyi çabayla
  yapar; M02 matrisi genişletilmeli.
- Gece işleri ertelendiği için pratik stoku kurucu makinesinde elle doldurulur (`kurucu.md` "Haftalık iş").

## Lisans ve gizlilik

Depo özeldir. Gerçek öğrenci verisi, anahtar ya da `.dev.vars` dosyası commit edilmez (`.gitignore`); testler yalnız
`fixtures/` altındaki sahte veriyi kullanır.
