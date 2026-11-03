# Kurucu runbook'u — hesaplar, deploy, yedek, anahtar döndürme, harcama tavanı

> **Not (v2):** Bu runbook v1 (Telegram botu + Cloudflare) kurulumunu anlatır; v2 planı `docs/PLAN-v2.md`. v2 için yeni runbook P0 sonunda yazılır.

Tek sayfa, sırayla uygulanır. Her şey kurucunun makinesinde, depo kökünden (`cd alperen`) çalışır. Anahtarlar yalnız
`wrangler secret put` (Worker), parola yöneticisi ve kabuk ortamına girer; depoya, `.env`'e ya da GitHub'a yazılmaz.
`service_role` anahtarı ve proje JWT secret'ı bu makineden çıkmaz. Önce `make check-quick` yeşil olmalı.

## 0. Kabuk ortamı

Aşağıdaki komutlar bu değişkenleri kullanır. Gizli olanlar `read -rs` ile okunur (ekrana ve kabuk geçmişine düşmez);
her yeni terminalde yeniden girilir. Değeri henüz olmayan satırı (ör. `WORKER_URL`) o adıma gelince doldur.

```
umask 077                                                        # bu kabukta yazılan dosyalar yalnız sana açık
export SUPABASE_URL='https://<ref>.supabase.co'                  # Dashboard → Settings → API → Project URL (gizli değil)
export WORKER_URL='https://ogrenmen-bot.<hesap>.workers.dev'     # ilk wrangler deploy çıktısı (§2; gizli değil)
read -rs TELEGRAM_BOT_TOKEN && export TELEGRAM_BOT_TOKEN         # BotFather jetonu (§1.1)
read -rs SUPABASE_ANON_KEY && export SUPABASE_ANON_KEY           # Dashboard → Settings → API → anon public
read -rs DB_PASS && export DB_PASS                               # veritabanı parolası (§1.2)
export DB_URL="postgresql://postgres.<ref>:$(python3 -c 'import os,urllib.parse as u;print(u.quote(os.environ["DB_PASS"],safe=""))')@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
unset DB_PASS
```

`DB_URL` "session" kipindeki bağlantı dizesidir (Dashboard → Database → Connection string); parola URL'ye kodlanarak
girer ve hiçbir komut satırında açık yazılmaz. İstersen parolayı `~/.pgpass`'e (chmod 600) koyup `DB_URL`'yi parolasız
yazabilirsin. **Barındırılan projeye karşı her pipeline koşusu `SUPABASE_ANON_KEY` ister**: Supabase API geçidi
`apikey` başlığı olmayan `/rest/v1` ve `/storage/v1` isteklerini 401 "No API key found in request" ile reddeder;
`ogrenmen_tablet` bu başlığı yalnız `SUPABASE_ANON_KEY` tanımlıysa gönderir.

## 1. Hesapları açma sırası

**1.1 Telegram (BotFather)**

```
/newbot                    → ad "Öğrenmen", kullanıcı adı ör. ogrenmen_pilot_bot; jetonu parola yöneticisine koy
/setprivacy → Disable      (grupta her mesajı görsün; bot bunu tg_chats.privacy_mode_off_verified ile doğrular)
/setcommands               → start, test, cevap, mod, ilerleme, kota, hoca, oncelik, gizlilik, yardim, durdur, baslat, sil
/setuserpic                → packages/design-system/assets/Maskot/ogrenmen-maskot.webp (PNG'ye çevrilmiş)
```

Kendi Telegram kimliğini (`ADMIN_CHAT_ID`) öğrenmek için bota özelden yaz ve `getUpdates` çıktısındaki `chat.id`'yi al
(webhook kurulmadan önce): `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates"`.

**1.2 Supabase (bölge `eu-central-1`)**

1. Yeni proje → bölge **Frankfurt (eu-central-1)**; veritabanı parolasını parola yöneticisine koy.
2. Dashboard → Database → Extensions: `vector`, `pg_trgm`, `pgcrypto`, `pg_cron` açık.
3. Dashboard → API → **Exposed schemas yalnız `public`** (`secure` ve `audit` eklenmez).
4. Migration'lar ve seed'ler (`DB_URL` §0'dan; ilk hatada durur):

```
make db-migrate                                       # migration'lar + seed 01-04 + müfredat + cevap anahtarları
psql "$DB_URL" -X -f supabase/scripts/size-report.sql # depolama bütçesi (500 MB)
```

`make db-migrate` şunu yapar (elle de aynı sırayla çalıştırılabilir):

```
for f in supabase/migrations/*.sql; do psql "$DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f "$f" || break; done
for f in supabase/seed/01_settings.sql supabase/seed/02_quota.sql supabase/seed/03_runtime_flags.sql \
         supabase/seed/04_retention_policies.sql; do psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$f" || break; done
python3 content/tyt-matematik/scripts/export-sql.py --strict-sources --out "$(mktemp -d)/seed.sql"   # → psql -f
python3 content/tyt-matematik/scripts/seed-keys.py --database-url "$DB_URL"    # cevap anahtarları; teşhis → approved
```

`supabase/seed/00_roles.sql` ve `seed/dev/` yalnız yerel/test içindir, barındırılan projeye uygulanmaz.

5. İlk koordinatör: Dashboard → Authentication → Add user (e-posta + parola), çıkan kullanıcı kimliğiyle:

```
psql "$DB_URL" -c "insert into public.staff (id, full_name, role, subject) values ('<auth-user-uuid>', 'Ad Soyad', 'coordinator', 'matematik')"
```

6. Doğrulama: anon anahtarıyla `secure`'a erişim reddedilmeli, `ping` çalışmalı:

```
curl -s "$SUPABASE_URL/rest/v1/rpc/ping" -X POST -H "apikey: $SUPABASE_ANON_KEY" -H 'content-type: application/json' -d '{}'
```

**1.3 JWT basımı (`bot_runtime`, `batch_worker`; 90 gün)**

Proje JWT secret'ı: Dashboard → Settings → API → JWT Secret. Yalnız bu komut satırında kullanılır. Jetonlar
`/tmp`'ye değil, yalnız sana açık `~/.ogrenmen/` dizinine yazılır:

```
bun install --cwd supabase
umask 077; mkdir -p ~/.ogrenmen && chmod 700 ~/.ogrenmen
read -rs SUPABASE_JWT_SECRET && export SUPABASE_JWT_SECRET
bun run supabase/scripts/mint-jwt.ts --role bot_runtime  --exp 90d > ~/.ogrenmen/bot.jwt     # → Worker SUPABASE_BOT_JWT
bun run supabase/scripts/mint-jwt.ts --role batch_worker --exp 90d > ~/.ogrenmen/batch.jwt   # → pipelines SUPABASE_BATCH_JWT
chmod 600 ~/.ogrenmen/bot.jwt ~/.ogrenmen/batch.jwt
unset SUPABASE_JWT_SECRET
```

Bitiş tarihini takvime yaz (stderr satırı); Worker `/health` 14 gün kala uyarır. `bot.jwt`'yi §1.5'te Worker'a
verdikten sonra sil (`shred -u ~/.ogrenmen/bot.jwt`). **`batch.jwt` silinmez**: gece işleri ertelendiği için §2
"Haftalık iş" onu bu makineden okur; tek kopyası budur (kaybolursa bu adımla yeniden bas).

**1.4 Gemini ve Groq (ve OpenRouter)**

- Google AI Studio → ücretli proje: faturalandırma + **5 $ ön yükleme**; Google Cloud → Billing → Budgets: uyarı
  **3 $ ve 20 $**. Bu projeden `GEMINI_PAID_KEY`; faturasız ayrı bir projeden `GEMINI_FREE_KEY` (ücretsiz katman,
  yalnız temizlenmiş metin).
- console.groq.com → API Keys → `GROQ_KEY` (ücretsiz, fatura yok). openrouter.ai → Keys → `OPENROUTER_KEY` (ücretsiz).

**1.5 Cloudflare Workers Paid + gizler**

Cloudflare → Workers & Pages → Plans → **Workers Paid** (ücretsiz planın 10 ms CPU sınırı yerine). Giriş:
`cd apps/worker && bunx wrangler login`. Gizlerin listesi `apps/worker/.dev.vars.example`'dakiyle aynıdır.

Wrangler gizleri geri okunamaz; bu yüzden webhook gizleri önce kabuk değişkenine üretilir, parola yöneticisine
kaydedilir, sonra Worker'a verilir (§2 `setWebhook` aynı değişkenleri kullanır):

```
cd apps/worker
TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 32)"; WEBHOOK_SECRET_PATH="$(openssl rand -hex 16)"
export TELEGRAM_WEBHOOK_SECRET WEBHOOK_SECRET_PATH
printf '%s\n%s\n' "$TELEGRAM_WEBHOOK_SECRET" "$WEBHOOK_SECRET_PATH"   # ikisini parola yöneticisine kaydet, sonra ekranı temizle
printf %s "$TELEGRAM_WEBHOOK_SECRET" | bunx wrangler secret put TELEGRAM_WEBHOOK_SECRET --env production
printf %s "$WEBHOOK_SECRET_PATH" | bunx wrangler secret put WEBHOOK_SECRET_PATH --env production
printf %s "$TELEGRAM_BOT_TOKEN" | bunx wrangler secret put TELEGRAM_BOT_TOKEN --env production
printf %s "$SUPABASE_URL" | bunx wrangler secret put SUPABASE_URL --env production
printf %s "$SUPABASE_ANON_KEY" | bunx wrangler secret put SUPABASE_ANON_KEY --env production
for k in GEMINI_PAID_KEY GEMINI_FREE_KEY GROQ_KEY OPENROUTER_KEY ADMIN_CHAT_ID; do
  bunx wrangler secret put "$k" --env production; done      # her biri değeri sorar (yapıştır, Enter)
bunx wrangler secret put SUPABASE_BOT_JWT --env production < ~/.ogrenmen/bot.jwt && shred -u ~/.ogrenmen/bot.jwt
bunx wrangler secret put CF_AI_TOKEN --env production       # isteğe bağlı (Workers AI REST yolu)
bunx wrangler secret put CF_ACCOUNT_ID --env production     # isteğe bağlı
bunx wrangler secret list --env production                  # 11 zorunlu ad görünmeli
cd ../..
```

Yeni bir terminalde §2 webhook adımı için iki değeri parola yöneticisinden geri yükle:
`read -rs TELEGRAM_WEBHOOK_SECRET && read -rs WEBHOOK_SECRET_PATH && export TELEGRAM_WEBHOOK_SECRET WEBHOOK_SECRET_PATH`.

## 2. Deploy komutları

```
# Worker (önce testler, sonra kuru derleme, sonra dağıtım)
bun run --cwd apps/worker test && bun run --cwd apps/worker build
(cd apps/worker && bunx wrangler deploy --env production)
curl -fsS "$WORKER_URL/health"

# Telegram webhook (gizli yol + gizli başlık; idempotent)
curl -fsS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=$WORKER_URL/telegram/$WEBHOOK_SECRET_PATH" -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
  --data-urlencode 'allowed_updates=["message","edited_message","callback_query","my_chat_member","chat_member"]'
curl -fsS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"

# Dağıtım sonrası CPU denetimi: 50 sohbet turunda cpuTime p95 < 8 ms
(cd apps/worker && bunx wrangler tail --env production --format json | jq .cpuTime)

# Eğitmen paneli (statik; yalnız anon anahtarı pakete girer)
NEXT_PUBLIC_DATA_SOURCE=live NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
  bun run --cwd apps/panel build
! grep -rlE "AIza|gsk_|sk-or-|service_role" apps/panel/out/     # anon anahtarı dışında giz yok
(cd apps/panel && bunx wrangler pages deploy out --project-name ogrenmen-panel)
```

Bot gruba **"Pin messages" hakkıyla yönetici** olarak eklenir; panel `/gruplar`'da `bot_is_admin` ve gizlilik modu
sütunları doğrulanır. Yeni migration geldiğinde: önce yerelde `make db-test`, sonra yalnız yeni dosya
`make db-migrate MIGRATION=supabase/migrations/00NN_ad.sql` (tek işlemde `psql -f`; tam `make db-migrate` yalnız ilk
kurulum içindir).

**Haftalık iş (gece workflow'ları ertelendiği için elle):** pratik soru stokunu 30'a tamamla (LLM yok). Üç değişken
de gerekir; `SUPABASE_ANON_KEY` olmadan Supabase geçidi isteği 401 ile reddeder (§0):

```
# bir kez: README "10 dakikada" 1. adımı (contracts, pii, common, tablet yerel yollardan pip -e)
make fill-dry                                       # önce kuru koşu: fixtures'a karşı, ağ yok
SUPABASE_URL="$SUPABASE_URL" SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" SUPABASE_BATCH_JWT="$(cat ~/.ogrenmen/batch.jwt)" \
  python3 -m ogrenmen_tablet template --fill --min-stock 30 --out ~/ogrenmen-fill/$(date +%F)
```

## 3. Günlük yedek

Kod (her gün, `crontab -e`; yedek dizini şifreli diskte ya da bulut klasöründe):

```
30 23 * * * cd ~/alperen && git bundle create ~/yedek/ogrenmen-$(date +\%F).bundle --all && git bundle verify ~/yedek/ogrenmen-$(date +\%F).bundle >/dev/null && find ~/yedek -name 'ogrenmen-*.bundle' -mtime +30 -delete
```

Geri yükleme: `git clone ~/yedek/ogrenmen-2026-11-01.bundle alperen`.

Veritabanı (Supabase ücretsiz planında otomatik yedek yok; haftada bir, `age` ile şifreli, `secure` hariç):

```
OGRENMEN_DATABASE_URL="$DB_URL" BACKUP_AGE_PUBKEY=age1... bash supabase/scripts/backup-public.sh --out ~/yedek/db-$(date +%F).sql.age
OGRENMEN_DATABASE_URL="$DB_URL" BACKUP_AGE_PUBKEY=age1... bash supabase/scripts/backup-public.sh --secure --out ~/yedek/secure-$(date +%F).sql.age
# geri yükleme: age -d -i anahtar.txt yedek.sql.age | psql "$HEDEF_URL" -v ON_ERROR_STOP=1
```

## 4. Anahtar döndürme

| Ne | Ne zaman | Komut |
| --- | --- | --- |
| `SUPABASE_BOT_JWT` | 90 günde bir (`/health` 14 gün kala uyarır) | §1.3 `mint-jwt.ts --role bot_runtime --exp 90d > ~/.ogrenmen/bot.jwt` → `bunx wrangler secret put SUPABASE_BOT_JWT --env production < ~/.ogrenmen/bot.jwt && shred -u ~/.ogrenmen/bot.jwt` |
| `SUPABASE_BATCH_JWT` | 90 günde bir | §1.3 `mint-jwt.ts --role batch_worker --exp 90d > ~/.ogrenmen/batch.jwt` (`umask 077`, chmod 600; eskisinin üstüne yazar) |
| Proje JWT secret'ı | sızıntı şüphesinde | Dashboard → Settings → API → Generate new secret; anon anahtarı da değişir: iki JWT'yi yeniden bas, `SUPABASE_ANON_KEY`'i Worker'a ver, paneli yeniden derle ve dağıt (§2) |
| `TELEGRAM_BOT_TOKEN` | sızıntı şüphesinde | BotFather `/revoke` → `read -rs TELEGRAM_BOT_TOKEN && export TELEGRAM_BOT_TOKEN` → `printf %s "$TELEGRAM_BOT_TOKEN" \| bunx wrangler secret put TELEGRAM_BOT_TOKEN --env production` → §2 `setWebhook` |
| `TELEGRAM_WEBHOOK_SECRET`, `WEBHOOK_SECRET_PATH` | 6 ayda bir | §1.5'teki gibi: `TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 32)"; WEBHOOK_SECRET_PATH="$(openssl rand -hex 16)"` → parola yöneticisine kaydet → `printf %s "$TELEGRAM_WEBHOOK_SECRET" \| bunx wrangler secret put TELEGRAM_WEBHOOK_SECRET --env production` ve `printf %s "$WEBHOOK_SECRET_PATH" \| bunx wrangler secret put WEBHOOK_SECRET_PATH --env production` → §2 `setWebhook` (yeni yol + başlık) |
| Gemini / Groq / OpenRouter | sızıntı şüphesinde ya da 401 DM'i gelince | sağlayıcıda yeni anahtar → `bunx wrangler secret put <AD> --env production` → eski anahtarı sil |

Her döndürmeden sonra `curl -fsS "$WORKER_URL/health"` ve bota özelden bir mesaj.

## 5. Harcama tavanı

İki bütçe `runtime_flags`'tadır (seed `03_runtime_flags.sql`): sohbet ve toplu işler **günlük 0,80 $ / aylık 24 $**
(`daily_cap_usd`, `monthly_cap_usd`; ders amaçları hariç), ders analizi **aylık 30 $** (`lesson_monthly_cap_usd`).
Aşımda bot kapanmaz: `normal → free_only → degraded` iner ve kurucuya Telegram DM gider (%50, %80, %100).
Değiştirmek ya da `paid_llm_enabled`'ı yeniden açmak koordinatörün işidir: panel `/maliyet` (`set_runtime_flag`), ya da:

```
psql "$DB_URL" -c "update public.runtime_flags set value = '1.0'::jsonb, updated_by = 'kurucu' where key = 'daily_cap_usd'"
psql "$DB_URL" -c "select key, value from public.runtime_flags where key in ('paid_llm_enabled','daily_cap_usd','monthly_cap_usd','lesson_monthly_cap_usd')"
```

Dış kemerler: Gemini ön ödemeli bakiye (5 $ ile başla, en çok 25 $ yükle) ve Google Cloud bütçe uyarıları
(3 $ / 20 $); Groq ve OpenRouter ücretsiz anahtarlar fatura çıkarmaz; Cloudflare Workers Paid aylık sabit ücrettir.
Ay sonunda panel `/maliyet` "Sohbet ve toplu işler" ve "Ders analizi" sütunlarını kontrol et.
