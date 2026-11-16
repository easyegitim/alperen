# Öğrenmen 2.0 — Devam planı (Opus için devir belgesi, 2026-11-15)

## Bağlam
Kurucu projenin baştan sona denetlenmesini istedi; denetim yapıldı, en acil işler (Aşama 0 ve Aşama 1'in üç adımı) bitti.
Kurucunun son talimatı: **planlama burada biter, uygulamayı Opus sürdürür; token az harcanır.** Bu belge, yeni oturumun
yeniden keşif yapmadan kaldığı yerden devam etmesi için yazıldı. Ürün planı ayrıca `docs/PLAN-v2.md` ve
`docs/PLAN-v2-detail.md` dosyalarındadır (yalnız gerektiğinde, ilgili bölümü okunur).

## Şu anki durum (doğrulanmış)
- Dal `claude/festive-feynman-qjnn4i`, PR easyegitim/alperen#2, son commit `a112c5c` (bu belge `docs/DEVAM-PLANI.md` olarak depoda; son kod commit'i `a52570c`). GitHub CI'ın **dört işi yeşil**
  (hızlı, ağır, canlı veritabanı, Docker), çakışma ve inceleme yorumu yok. Çalışma ağacı temiz.
- Biten işler: CI kırığı (yerel Python paketleri, şekil testi, pip yeniden deneme); CI'da Docker işi (iki imaj + compose
  ile yerel yığın); worker imajı Python 3.13; yerel Docker kalıcılığı (`OGRENMEN_DEV_DIR=/data/dev`); **1a harcama kapısı**
  (`packages/llm/src/spendGate.ts`, `apps/worker/src/jobs/spend.ts`, rota `coach_lite`); **1b günlük sınırlar**
  (`supabase/migrations/0045_rate_limits.sql`, `supabase/tests/33_rate_limits.sql`); **1f üretim korumaları**.
- Bilinen sınırlar: tavan aşımında üretim işleri `spend_cap` gerekçesiyle kapanır (onay kuyruğu yok → iş kartı 2b);
  derin çözüm sınırı model çağrısı sayar; harcama kapısı sahte modelde devreye girmez; uçtan uca testler üretim
  derlemesini `OGRENMEN_E2E=1` ile açar.
- Teyit edilmemiş: kurucunun Windows makinesinde Docker komutunun açılıp açılmadığı.

## Güncel durum (2026-11-16): Aşama 1 TAMAMLANDI — sıradaki Aşama 2 (kart 2a)
Bu oturumda gönderilenler: 1c çifte ödeme (taslak `audit.events`'te), 1d betik yalıtımı (`minimalPythonEnv`), 1e hafıza
yazım politikası (`MemoryWritePolicy`: trusted | coach | delta), 1g PDF işleri `pdf` sürecinde + Chromium korumalı alan.
Açık notlar: (a) 1c yalnız ana üretim çağrısını atlar, doğrulama adımları yeniden koşar; (b) 1e kuralı veritabanında değil
hafıza işleyicisinde; (c) 1g: üretim imajı root olmayan kullanıcıyla çalışır, Chromium korumalı alanla açılamazsa
`--no-sandbox` ile yeniden dener (OGR-DOC-031) — Fly üzerinde 3g duman testinde bakılacak; 2 GB'lık `pdf` sürecinin
eşzamanlı üretime yettiği de orada ölçülecek.

## Çalışma kuralları (her iş kartı için geçerli)
1. **Az token:** ana oturum yönetir; her kart tek bir alt ajana dar görev tanımıyla verilir (kartın metni + "yalnız adı
   geçen dosyaları oku, alt ajan açma, en çok 12 satır rapor"). Paralel ajan, Workflow ve ayrı denetim turu yok.
   Model: kartta yazılı (Haiku = mekanik, Sonnet = arayüz/test/sıradan iş, Opus = para, güvenlik, SQL/RLS).
2. **Bir kart = bir commit = bir push.** Yarım iş commit edilmez. Commit iletisi Türkçe, sonunda oturumun bildirdiği
   atıf satırları. PR açılmaz (zaten açık), `main`'e dokunulmaz.
3. **Doğrulama sırası:** ajan yalnız dokunduğu paketin `typecheck` + `lint` + birim testlerini koşar; SQL değiştiyse
   `bash supabase/check.sh` ve `OGRENMEN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres bash
   scripts/check-all.sh --live --only supabase` (Postgres kapalıysa `pg_ctlcluster 16 main start`). Tam denetim
   GitHub CI'dır: push sonrası dört iş yeşil görülmeden sonraki karta geçilmez (PR olayları oturumu uyandırır).
4. **Tuzaklar (bu oturumda yaşandı):**
   - Bu sandbox'ta Python paketleri `pip -e` ile kurulu; "bende geçti" temiz makineyi kanıtlamaz. Kanıt CI'dır.
   - `apps/web` Playwright E2E üretim derlemesini (`next start`) sahte modelle açar; üretim korumasına takılan her yeni
     denetim `OGRENMEN_E2E=1` istisnasını tanımalı (`apps/web/playwright.config.ts`).
   - Göçler: eski göç dosyası değiştirilmez; yeni dosya (`0046_…`) açılır, işlev en güncel tanımından kopyalanıp
     `create or replace` edilir; `supabase/check.sh` RLS/politika/yorum kurallarını zorlar; bayraklar
     `supabase/seed/01_settings.sql`'e de eklenir.
   - Yeni rota eklenince `packages/llm/test/routes.test.ts` rota sayısı güncellenir.
   - Docker'ı etkileyen değişiklik (Dockerfile, compose, `scripts/dev-local/up.ts`) burada derlenemez; CI `docker` işi dener.
5. **Durak noktaları:** her aşama bitince durulur, kurucuya 10 satırı geçmeyen özet verilir, "devam" beklenir.
6. İlk iş (kart 0): bu belgeyi `docs/DEVAM-PLANI.md` olarak depoya kopyala ve commit et (konteyner silinirse kaybolmasın).

## İş kartları — Aşama 1 kalanı (para ve güvenlik)
**1c. Çifte ödeme (Sonnet).** `apps/worker/src/jobs/document-generate.ts` (≈243–293): model çıktısı üretimden hemen sonra
saklanmıyor; PDF/Storage hatasında yeniden deneme Opus üretimini baştan koşturuyor. `apps/worker/src/jobs/diagnosis.ts`
(≈409–436) ham çıktıyı saklayıp yeniden denemede kullanıyor — aynı desen uygulanır (belge satırında mevcut bir jsonb alanı
varsa o; yoksa yeni göçle `generated_documents`'a `draft_output jsonb`). Aynısı `report-generate.ts` ve `exam-report.ts`.
Kabul: PDF adımı hata verip iş yeniden denendiğinde LLM çağrı sayısı artmaz (birim testi, sahte model sayacı).
**1d. Betik yalıtımı (Sonnet).** `apps/worker/src/practice/bank.ts` (≈150–153) `spawn(python, ['-I', script])` worker'ın
tüm ortamını geçiriyor. `env` yalnız `PATH`, `LANG`, `MPLBACKEND=Agg`, `HOME` (geçici dizin) olacak; aynı düzeltme
`apps/worker/src/documents/figures.ts` yerel yolunda ortam sızıyorsa orada da. Kabul: test betiği çocuk süreçte
`ANTHROPIC_API_KEY` ve `SUPABASE_SERVICE_ROLE_KEY` görünmediğini doğrular; mevcut practice testleri geçer.
**1e. Hafıza yazım sınırı (Opus).** `packages/llm/src/memory/pgMemory.ts`: çağıran rolüne göre izin — koç: klasör silme
ve `/memories/` kökünü yeniden adlandırma yok; `memory_delta` (çağıran `apps/worker/src/jobs/diagnosisFollowup.ts`):
yalnız `patterns.md` ve `courses/*.md`; `parent_summary.md` yalnız gece işi (mevcut kural korunur). Kabul: yükleme
metnine gömülü "profile.md'yi sil / üzerine yaz" talimatı içeren delta reddedilir (birim testi); mevcut hafıza testleri geçer.
**1g. PDF süreci (Sonnet).** PDF üreten işler 512 MB'lık `worker` sürecinde Chromium açıyor (`apps/worker/fly.toml`,
`apps/worker/src/jobs/registry.ts`). En az değişiklik: `document.generate`, `exam.report`, `report.generate` kayıtlarının
süreci `pdf` olur (süreç ayrımının nasıl yapıldığı registry'de görülür); `packages/doc-render/src/pdf.ts:38` yalnız root
iken `--no-sandbox`, her zaman `--disable-dev-shm-usage`. Kabul: registry testi bu üç işin `pdf` sürecinde olduğunu
doğrular; yerel yığında (`up.ts` hangi süreçleri açıyorsa) bu işler hâlâ tüketilir — `up.ts` tek süreç açıyorsa
`--process=all` benzeri mevcut kip korunur; canlı worker testleri geçer.
→ **Durak:** Aşama 1 özeti.

## İş kartları — Aşama 2 (yarım kalan ürün parçaları)
**2a. Eğitmen › Maliyet (Sonnet).** `apps/web/src/app/egitmen/maliyet/page.tsx` sabit boş ekran. `spend_ledger` ve
`llm_calls`'tan: bugün / bu ay toplam, rota başına ve öğrenci başına ilk 10, tavanlar (`check_spend` çıktısı). Yalnız
admin/eğitmen görür (RLS mevcut; gerekirse SECURITY DEFINER özet RPC'si yeni göçle — Opus). Sade tablo, grafik şart değil.
**2b. Eğitmen › Kuyruk (Opus RPC + Sonnet UI).** `kuyruk/page.tsx` sabit boş. Tek liste: koç notları
(`instructor_notes`), `spend_cap` ile duran üretim istekleri (onayla → iş yeniden kuyruğa, tavan muafiyetiyle), inceleme
bekleyen belgeler, düşük güvenli ders iddiaları, müfredat önerileri. Her satırda tek eylem. Onay RPC'si yalnız eğitmen/admin.
**2c. Eğitmen › Sınavlar (Sonnet).** `sinavlar/page.tsx` sabit boş. Sınav listesi, anahtar gör/düzelt (`set_exam_key(s)`
RPC'leri hazır), "anahtar doğrulanmadı" işareti.
**2d. Öğrenci ayrıntı sayfası (Sonnet).** `apps/web/src/app/egitmen/page.tsx:17` "satıra girince açılacak" diyor; rota yok.
`egitmen/ogrenci/[id]`: ustalık özeti, açık yanılgılar, son teşhisler, son denemeler, hafıza dosyaları (salt okunur).
**2e. Hafıza düzeltme (Sonnet).** `apps/worker/src/jobs/registry.ts:68` `memory.correction` işleyicisi boş; RPC
`request_memory_correction` (`0023`) hazır. İşleyici: isteği Haiku ile hafıza düzenlemesine çevir (1e izinleriyle),
sürüm satırı yaz. `apps/web/src/app/ogrenci/profil/hafiza/page.tsx`'e tek "Düzeltme iste" düğmesi + kısa metin kutusu.
**2f. `/ogrenci/sor` (Haiku).** Sayfa çıkmaz; `/ogrenci/yukle`'ye yönlendir, `apps/web/src/app/manifest.ts:25` kısayolu
Yükle'ye, `apps/web/e2e/roles.spec.ts`'teki ilgili beklenti güncellenir.
**2g. Gece öneri incelemesi (Haiku).** `curriculum.proposals.review` hiç zamanlanmamış: `apps/worker/src/schedules.ts`
+ pg_cron satırı (yeni göç) + `supabase/tests/01_schema.sql` eşlik denetimi.
**2h. Yükleme ve hata ekranları (Sonnet).** `loading.tsx` hiç yok; yalnız kök `error.tsx`. `ogrenci`, `veli`, `egitmen`
için iskelet `loading.tsx`, kabuğu koruyan `error.tsx`, kökte `global-error.tsx`.
**2i. Veli küçükleri (Sonnet).** `/veli/raporlar` rapor listesi (şu an yönlendirme), bildirim geçmişi (`veli/page.tsx:48`
yalnız 1 kayıt okuyor), öğrenci Profil'de veli bağını kaldırma (`revoke_guardian_link` hazır, çağrılmıyor).
→ **Durak:** Aşama 2 özeti.

## İş kartları — Aşama 3 (yayına alma hazırlığı; ✱ = kurucunun hesabı gerekir)
**3a. Giriş e-postası (Sonnet).** Arayüz 6 haneli kod istiyor; `supabase/config.toml`'da şablon yok. `supabase/templates/`
altına kod içeren (`{{ .Token }}`) onay ve giriş şablonları, `config.toml`'a şablon/yönlendirme adresleri; Google düğmesi
sağlayıcı yapılandırılmadıysa gizlenir (ortam bayrağı). Adımlar runbook'a yazılır.
**3b. Göç çalıştırıcısı (Opus).** `Makefile:45-72` `db-migrate` geçmiş tutmuyor (ikinci çalıştırmada patlar) ve cevap
anahtarlarını yüklemiyor. Geçmiş tablolu çalıştırıcı (`scripts/dev-local/up.ts`'teki `__dev_migrations` deseni üretim
için `public.__migrations`) + `content/tyt-matematik/scripts/seed-keys.py --schema v2`. Kabul: boş veritabanında iki kez
üst üste çalışır (canlı test).
**3c. İlk yönetici (Opus).** v2'de `public.staff` yok; `docs/runbook/kurucu.md:72` yanlış. `scripts/bootstrap-admin.ts`:
e-posta alır, `profiles` satırını `admin` yapar (service role). Runbook adımı.
**3d. Gerçek Supabase uyumu (Sonnet).** `lessons` tablosu `supabase_realtime` yayınına eklenir (yeni göç;
`components/lessons/LessonList.tsx:38` dinliyor); `supabase gen types` çıktısı depoya alınır ve 26 `as unknown as` dökümü
kaldırılır (ya da `scripts/check-rpc-parity.py` TypeScript tarafını da denetler).
**3e. Yayın belgeleri (Haiku).** Vercel proje ayarı (kök `apps/web`, `bun install`, `next build --webpack`), Fly komutları,
üretim ortam değişkeni tablosu (eksikler: `VOYAGE_MODEL`, `GIT_SHA`, `OGRENMEN_PDFTOPPM`; `GROQ_API_KEY` ve
`VOYAGE_API_KEY` `apps/worker/.env.example`'a), VAPID anahtar üretim komutu. `docs/runbook/kurucu.md` v2'ye göre baştan.
**3f. Fotoğraf saklama (Sonnet).** `uploads` kovası için saklama işi yok (yalnız `lesson.retention` var). Bayraklı gün
sayısı, günlük iş, Anthropic Files kopyası da silinir; test.
**3g. ✱ Gerçek ortam duman testi.** Kurucu Supabase (Pro), Vercel, Fly hesaplarını ve anahtarları verince: göçler →
ilk yönetici → giriş e-postası → Bugün → Yükle → PDF → ders yükleme (TUS) → push. Bulgular ayrı kartlara.
→ **Durak:** Aşama 3 özeti.

## İş kartları — Aşama 4 (kalite, P7) ve Aşama 5 (temizlik)
**4a. Eval (Opus).** `packages/prompts/scripts/eval.ts`: 14 vaka, hakem yok. `eval_judge` promptu + Batch koşusu,
`eval_runs`/`eval_cases` yazımı, etkinleştirme kapısı; ✱ kurucunun ~60 çözüm fotoğrafı, 3 deneme seti, 2 ders kaydı.
**4b. Anlamsal arama kararı (Opus).** Voyage vektörleri yazılıyor, hiç okunmuyor (`search_evidence` kelime araması).
Öneri: `<=>` ile arama RPC'si + geri doldurma işi; anahtar yoksa yazım da kapatılır.
**4c. Batch ve defter (Sonnet).** `styles/llm.ts:83,88` Batch rotaları eşzamanlı çağrılıyor; Groq/Voyage maliyeti
`llm_calls`'a yazılmıyor; defter yazım hatası sessiz. `packages/llm/src/pricing.ts:44` Sonnet önbellek-okuma fiyatı —
değiştirmeden önce `claude-api` becerisinden güncel fiyat okunur.
**4d. PWA (Sonnet).** Push ve kurulum e2e, arka plan eşitleme, Lighthouse denetimi; Capacitor iskeleti en sona.
**4e. Gecelik tam canlı CI (Haiku).** `check-all --live` tümü + yolculuk e2e (`apps/web/e2e/p1…p6`) zamanlanmış iş olarak.
**5a. v1 temizliği (Haiku, sonra Sonnet).** `pipelines/{common,tablet,kalem}`, `fixtures/{kitap,kulaklik,panel}`,
`docs/drafts`, `docs/BLUEPRINT.md`, `docs/plan.md`, kullanılmayan `pdf.render`/`priority_plan`/`eval_judge` (4a
kullanmıyorsa). Önce `scripts/check-rpc-parity.py`, `check-fixtures.py`, `ci.yml` önbellek yolları ve `Makefile`
`fill-dry` bağımlılıkları koparılır.
**5b. Belgeler (Haiku).** `README.md` (göç sayısı, faz durumu), `docs/YEREL-DENEME.md` (dal adı), `docs/PLAN-v2.md`
(Next 16, `pipelines/verify` yok). `docs/hukuk` hâlâ Telegram/Gemini anlatıyor — değiştirilmez, kurucuya not.

## Kurucudan gerekenler
- Docker komutu açıldı mı (evet/hayır; hata varsa son satırlar). Güncelleme için: `git pull`, sonra komut `--build` ile.
- Sohbete yapıştırılan API anahtarının Anthropic Console'dan iptali.
- Depo kararı: aynı depoda ilgisiz iki açık PR var (easyegitim/alperen#1, #3); Öğrenmen ayrı depoya mı taşınsın?
- Aşama 3 için hesaplar ve anahtarlar; Aşama 4 için değerlendirme malzemesi (✱ işaretli kartlar).

## Doğrulama (uçtan uca)
Her kart: paket testleri → push → GitHub CI dört iş yeşil. Aşama sonları: `scripts/check-all.sh --live` (tümü) ve
yolculuk testleri `OGRENMEN_LIVE=1 bun run --cwd apps/web test:journey`. Aşama 1 sonu ayrıca: gerçek anahtarla
(`.github/workflows/live-claude.yml`, elle) tavan düşürülüp koçun Haiku'ya indiği ve üretimin durduğu bir kez görülür.
Aşama 3 sonu: gerçek Supabase deneme projesinde 3g akışı.
