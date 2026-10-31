# apps/worker — Öğrenmen Telegram botu (M04)

Cloudflare Worker olarak çalışan Telegram botu: webhook doğrulama, komutlar, onay kapısı, teşhis ve
pratik, Sokratik sohbet, LLM yönlendirici ve tavanlar, hafıza erişimi, gruplar ve yükseltme, cron
işleri. Tasarımın tek kaynağı `docs/BLUEPRINT.md` §5'tir; bot metinleri `packages/design-system/telegram.md`
kurallarına uyar (sen dili, emoji ve ünlem yok, mesaj en çok 4 satır, düğme en çok 20 karakter).

Hiçbir hesap ve anahtar gerekmez: Telegram, Supabase (PostgREST + Storage), Gemini, Groq, Workers AI ve
OpenRouter birer adaptörün arkasındadır; testler ve `dev:fake` deterministik sahtelerle koşar.

## Komutlar

```
bun install --cwd /home/user/alperen/apps/worker
bun run --cwd /home/user/alperen/apps/worker typecheck   # tsc --noEmit (strict)
bun run --cwd /home/user/alperen/apps/worker lint        # eslint (yasak içe alımlar ve adlar, aşağıda)
bun run --cwd /home/user/alperen/apps/worker test        # vitest: scenarios (miniflare) + unit (Node)
bun run --cwd /home/user/alperen/apps/worker build       # wrangler deploy --dry-run --outdir dist --env production
bun run --cwd /home/user/alperen/apps/worker dev:fake    # sahte Bot API (8788) + wrangler dev --local (8787)
```

`dev:fake` açıkken:

```
curl -X POST localhost:8788/sendUpdate -d @/home/user/alperen/fixtures/telegram/private_text.json
curl localhost:8788/outbox
curl localhost:8787/health
```

## Yapı

| Yol | İçerik |
| --- | --- |
| `src/index.ts` | `export default { fetch, scheduled }` — yalnız gerçek bağımlılıkları bağlar; sahte modu reddeder |
| `src/app.ts` | `createApp(env, deps)` saf işlev: `fetch`, `handleUpdate`, `runCron`, `health` |
| `src/env.ts` | `Env` tipi, zorunlu gizli anahtar denetimi; hizmet rolü ya da JWT gizi adı görülürse boot bilerek düşer (`OGR-ENV-001`) |
| `src/telegram/` | ince Bot API istemcisi (2 deneme, 429 bekleme), tipler, gizli yol + başlık doğrulaması, klavye, MarkdownV2 ve Türkçe sayı biçimi |
| `src/router/` | `dispatch` (dedup → `tg_chats` → `resolve_telegram` → üye olayları → onay kapısı → komut/callback/metin), komutlar, akışlar, grup işleyicileri |
| `src/llm/` | yönlendirici (zincir, 429/5xx/timeout düşüşü, cooldown, onarım), sağlayıcılar, maliyet (`models.json`), yapılandırılmış çıktı (önceden derlenmiş doğrulayıcı), prompt'lar, çıktı kuralları |
| `src/data/` | `Db` arayüzü, `PostgrestDb` (bot_runtime JWT + `X-Ogrenmen-Student`), `FakeDb` (dev-seed.json, RPC eşlenikleri, RLS taklidi), Storage, embedding |
| `src/memory/retrieve.ts` | bağlam: son mesajlar + hafıza olguları + profil; ≤ 2.200 giriş token |
| `src/ops/` | tavan durum makinesi (`normal → free_only → degraded`), kurucu uyarıları, sağlık denetimi (`health.ts`: `/health` ve keepalive), yapılandırılmış log (`chat_hash`, `public_ref`) ve en iyi çaba yazımı (`bestEffort`) |
| `src/router/legal-blocks.ts` | `legal_texts.body_md` işaretli blokları (`cocuk-dili`, `onay-ozeti`, `grup-kayit-kisa`) ve gönderim anında gün sayısı |
| `src/cron/` | proaktif, otomatik grup cevabı, alarmlar, harcama, Storage silme kuyruğu, kayıt bildirimi yenileme, keepalive, saklama |
| `src/texts.ts` | tüm kullanıcı metinleri (aydınlatma metninin çocuk dili paragrafı burada yoktur, `/gizlilik` onu `legal_texts`'ten okur) |
| `test/fakes/` | sahte Bot API (`telegram.ts`, `telegram-server.ts`), sağlayıcılar (`providers.ts`, §2.3 seçim kuralı), Workers AI (`ai.ts`), Storage, embedding, cevap anahtarı kapısı (`key-oracle.ts`, yalnız test), `dev-worker.ts` + `wrangler.dev.toml` |
| `test/scenarios/` | §5.11 senaryoları (miniflare/workerd'de); `cost-budget.test.ts` §5.6'nın adıyla ayrı dosyada; `ops-robustness.test.ts` yan yazım hataları, keepalive, waitUntil |
| `test/unit/` | guard, format, klavye, metinler, maliyet, yapılandırılmış çıktı, adaptörler, kaynak denetimleri, CPU bütçesi, boot hatası, hukuk blokları, `grants.test.ts` (PostgrestDb'nin dokunduğu tablo/sütunlar §3.8'e karşı) (Node) |
| `test/rpc-names.json` | Worker'ın çağırdığı RPC adları (M13 `check-rpc-parity.sh` migration'larla eşler) |

## Güvenlik kuralları (test ve lint ile bağlı)

- Cevap anahtarı Worker'a hiç gelmez: `src/` içinde `answer-key` içe alımı ve doğru şık alan adı yoktur
  (lint `no-restricted-imports` + `test/unit/static.test.ts` + kabul komutu). Puanlama yalnız `grade_attempt`,
  çözüm yalnız `reveal_solution` RPC'siyle gelir.
- Çalışma anında Ajv derlenmez: doğrulama `@ogrenmen/contracts/validators` (önceden derlenmiş) ile yapılır.
- "Kayıt yoksa cevap yok": her bot cevabı önce `log_bot_response` ile yazılır (`bot-response-log`
  sözleşmesine karşı doğrulanır), sonra gönderilir; yazılamazsa yalnız `texts.degraded` gider ve
  `escalations(degraded)` denenir.
- Ad alanları (`first_name`, `last_name`) yalnız `resolve_telegram` çağrısına geçer; güncelleme sonra
  ad alanları ayıklanmış kopyayla dolaşır. LLM'e, `messages.text_llm`'e ve `bot_responses`'a giden her
  metin `@ogrenmen/pii` `scrub()` temizleyicisinden geçer (sohbet üyelerinin ad-token hash'leriyle).
- Onaysız (ya da reşit değilse veli onayı eksik) öğrencinin ve onaysız grup üyesinin mesajı yalnız meta
  veriyle saklanır; LLM çağrılmaz.
- Onaysız grup üyesi `/hoca` ile hocayı çağırabilir, ama metni saklanmaz (`escalations.question_text = null`).
  Havuz adayı (`content_pool`) kullanıcı adıyla doldurulmamış metinden kurulur; `@kullanıcı_adı` başka
  öğrencilere gitmez.
- Yasak konu (`guard.forbiddenTopic`): kişisel biçimler ("notumu", "taksidim", "puanım") her zaman,
  kişisiz biçimler ("fizik notu", "kurs ücreti") metin matematik problemi gibi görünmüyorsa yakalanır;
  "taksi ücreti km başına 5 TL … kaç TL" gibi TYT problemleri öğretilir.
- Yapılandırma hatasında (eksik gizli anahtar, yasak ortam adı) Telegram webhook'u yine 200 alır, `/health`
  503 döner; 25 sn bütçesi aşılırsa kalan iş `ctx.waitUntil` ile sürer. Bot jetonu loglarda maskelenir.
- Loglar yalnız `public_ref` ve `sha256(chat_id)[:8]` taşır; lint `console.log(` içinde `display_name`
  ve `text_raw`'ı reddeder.

## Ortam

Gizli anahtarlar (`wrangler secret put`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`WEBHOOK_SECRET_PATH`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_BOT_JWT`, `GEMINI_PAID_KEY`,
`GEMINI_FREE_KEY`, `GROQ_KEY`, `OPENROUTER_KEY`, `ADMIN_CHAT_ID`; isteğe bağlı `CF_AI_TOKEN`,
`CF_ACCOUNT_ID`. Değişkenler `wrangler.toml [vars]`'tadır. `AI` bağlaması yalnız `[env.production.ai]`
altındadır; yerel ortamda yoktur. Yerelde `.dev.vars.example` → `.dev.vars` (git'e girmez). Anahtarı
olmayan sağlayıcı zincirden `console.warn` ile çıkar.

## Kabul komutu notu

Kabul komutları yazıldığı gibi çalışır ve 0 ile çıkar. BLUEPRINT'ten bilinçli ve belgelenmiş sapmalar:

1. **Sahte `AI` bağlaması.** §5.11 `vitest.config.ts` içinde `miniflare.bindings.AI = { run: fakeAiRun }`
   der; miniflare `bindings` yalnız JSON değer taşır, işlev taşıyamaz. Bu yüzden `fakeAiRun`
   (`test/fakes/ai.ts`) `workers-ai.ts`'e doğrudan bağlama olarak verilir ve `test/unit/adapters.test.ts`
   bağlama yolunu, REST yolunu ve "ikisi de yoksa zincir dışı" yolunu sınar. Senaryolar sağlayıcıları
   `createApp(env, deps)` ile enjekte eder; `wrangler.toml`'un varsayılan ortamı seçildiği için gerçek AI
   bağlaması hiçbir testte yüklenmez.
2. **`dev:fake` girişi.** `src/index.ts` sahte modu bilerek reddeder (fixtures ve sahte cevap anahtarı
   kapısı üretim paketine girmesin). `dev:fake` bu yüzden `wrangler dev --local --config
   test/fakes/wrangler.dev.toml` ile `test/fakes/dev-worker.ts` girişini çalıştırır; sahte LLM yanıtları
   esbuild dizin taraması yapamadığı için sahte Bot API sunucusunun `/__fixtures/llm` ucundan yüklenir.
3. **`/oncelik` ikinci mesajının son satırı.** §5.2 tablosundaki "Bu bir tahmin değil, geçmiş sınavların
   sıklık analizidir." cümlesi "tahmin" kelimesini içerir ve aynı belgenin `oncelik-no-forbidden-words`
   senaryosuyla çelişir; senaryo kazanır: "Bu liste geçmiş sınavların sıklık analizidir; hangi sorunun
   geleceğini söylemez."
4. **Grupta kullanıcı adı.** Bot grupta öğrenciye kullanıcı adıyla hitap eder, ama kullanıcı adı LLM'e
   gitmez: prompt `[KULLANICI]` etiketini ister, Worker gönderimden önce etiketi `@kullanıcı_adı` ile
   doldurur (`fillUsername`); `bot_responses.response_text` temizlenmiş hâliyle yazılır.
5. **Personel adları.** `name_token_hashes(chat)` etiketsiz hash listesi döndürdüğü için başka bir
   üyenin (ör. eğitmenin) adı `[AD]` olur; gönderenin kendi adı rol etiketiyle (`[ÖĞRENCİ]`/`[EĞİTMEN]`)
   değiştirilir.
6. **Uyumluluk tarihi.** `compatibility_date = "2026-09-01"` yerel workerd'de (`2025-03-10`'a kadar
   destekler) uyarıyla geri düşer; testler etkilenmez, dağıtımda Cloudflare'in güncel çalışma zamanı
   kullanılır.
7. **Python eşleniği.** Sahte sağlayıcı seçim kuralının `ogrenmen_common.fakes.FakeLLM` ile birebir aynı
   dosyayı seçtiği `test/unit/adapters.test.ts`'te Python çağrılarak doğrulanır; `pipelines/common`
   dizini ya da `python3` yoksa yalnız bu vaka atlanır (TS tarafındaki kural testi her zaman koşar).
8. **Metin taraması ve yerel ayar.** `! grep -rnP "[!\x{1F300}-\x{1FAFF}]" …/src/texts.ts` POSIX yerel
   ayarında `\x{1F300}` kod noktasını ayrıştıramaz ve 2 ile çıkar (`!` bunu da başarı sayar). Tarama bu
   yüzden ayrıca `LC_ALL=C.UTF-8` ile çalıştırılıp eşleşme olmadığı (grep çıkış kodu 1) doğrulanmıştır;
   aynı denetim yerel ayardan bağımsız olarak `test/unit/texts.test.ts`'te ("dosyada ünlem karakteri hiç
   yok") her test koşusunda yapılır. **Entegratöre (M13) not:** CI/Makefile sarmalayıcısı bu denetimi
   `LC_ALL=C.UTF-8 grep -rnP '[!\x{1F300}-\x{1FAFF}]' apps/worker/src/texts.ts` biçiminde, açık UTF-8 yerel
   ayarıyla ve "çıkış kodu 1 = temiz, 0 = bulgu, 2 = hata" ayrımıyla çalıştırmalıdır; aksi hâlde POSIX
   yerel ayarında grep 2 ile çıkar ve gerçek bir emoji de "başarılı" sayılır.
9. **Prompt sürümü grupta bileşiktir.** §5.5 "prompt_version = dosya adı" der. Grup turunda sistem metni
   `socratic.v3.md` (ya da `direct.v2.md`) + `group.v1.md` birleşimidir; `bot_responses.prompt_version`
   bu yüzden `socratic.v3+group.v1` yazılır (iki dosya adı, `+` ile). Panel/pipeline sürüm karşılaştırması
   `+` ile bölerek her iki dosyayı da görür; `prompt_hash` birleşik metnin hash'idir. `group.v1.md`
   blueprint cümlesini birebir taşır ("Öğrenciye kullanıcı adıyla hitap et; eğitmen adına konuşma.");
   kullanıcı adı yönergesi ayrı satırdadır.
10. **"Velin onayladı" gecikmeli gider.** §5.2'ye göre `redeem_guardian_code` sonrası öğrenciye "Velin
    onayladı, başlayabiliriz." gider. RPC yalnız `boolean` döndürür ve öğrencinin özel sohbetini vermez
    (velinin hesabından çağrılır; öğrenci kimliği `secure` şemasındadır). Bu yüzden mesaj öğrencinin bir
    sonraki temasında (`notifyGuardianApproved`, oturum `awaiting_guardian` iken kimlik `consent_ok`)
    bir kez gider. M02 RPC'yi bir `proactive_messages` satırı açacak şekilde genişletirse bildirim anında
    gider; Worker tarafında değişiklik gerekmez (proaktif cron şablonu eklenir).
11. **§3.8 ile §5 arasındaki yetki çelişkileri (M02'ye ve entegratöre).** Aşağıdaki yazımları §5 ister
    ama §3.8 matrisi `bot_runtime`'a vermez. Worker hepsini **en iyi çaba** yapar (hata loglanır, akış
    sürer; örneğin ops alarmı yazılamasa da kayıt bildirimi gruba gider) ve `test/unit/grants.test.ts`
    `KNOWN_GAPS` listesinde tutar. M02'nin `bot_runtime`'a vermesi gerekenler:
    - `instructor_alerts`: insert (`kind='ops'`, sütunlar `kind, severity, student_id, detail, since, ref`)
      ve update (`status, resolved_at`) — gizlilik modu, yönetici değil, pratik stoku, harcama alarmları.
      Alternatif: `open_ops_alert(detail, severity, ref)` / `close_ops_alert(detail, ref)` RPC'leri; o zaman
      Worker bunları çağırır ve `test/rpc-names.json`'a eklenir. O güne dek `cron_open_alerts`
      `bot_is_admin=false` grupları zaten `ops` alarmına çevirir.
    - `messages`: update (`text_raw, text_llm`) — `edited_message` (§5.2); matris yalnız
      `update(is_question, answered_at)` verir.
    - `storage_deletions`: select (`id, bucket, path`) ve update (`error`) — matris yalnız `u done_at` der.
    - `proactive_messages`: update (`status, telegram_message_id, sent_at`).
    - `provider_health`: Worker yalnız `PATCH provider_health?provider=eq.X` yapar (matris `r u`); beş
      sağlayıcı satırı M02 seed'iyle önceden bulunmalıdır (`INSERT … ON CONFLICT` kullanılmaz).
    - `staff`: Worker yalnız `id, role, subject` okur; `active` filtresi kaldırıldı (sütun yetkide yok).
      Pasif personelin `chat_roles` bağını koordinatör kaldırır.
12. **Kota uyarısı 20. mesajda.** §5.11 `quota` senaryosu "21.'de uyarı, 22.'de yok" der; §3.9
    `consume_quota` ise `warn`'u `limit - used = warn_at` iken (25'lik kotada 20. mesajda, 5 hak kala)
    döndürür. RPC semantiği kazanır; senaryo "20. mesajda bir kez uyarı, 21.'de yok, 26. red" diye adlandırılır.
13. **`guards` günlük yükündedir.** Kısa devre cevapları (`forbidden_topic`, `consent_missing`, `quota`,
    `human_requested`) `bot-response-log` yükünün `guards` alanına yazılır. §3.3 `bot_responses` tablosunda
    `guards` sütunu yoktur; `log_bot_response` bu alanı saklamazsa panel/pipeline metrikleri onu göremez.
    M02'ye öneri: `bot_responses.guards text[]` sütunu (ya da RPC'nin `llm_calls`/audit'e yazması).
    `FakeDb.botResponsePayloads` testlerde yükü olduğu gibi gösterir.
14. **Pratik set kimliği.** Set kimliği set başlarken bir kez üretilir; düğmede taşınır, yazılı cevap için
    soru mesajı `messages.attachments` içinde `{kind:'practice_set', set_id}` meta verisiyle saklanır
    (`sessions` tablosunda serbest alan yok; `diagnostic_session_id` yabancı anahtar olduğu için
    kullanılamaz). İstanbul gece yarısını geçen set aynı kimlikte kalır.
15. **Teşhis özeti bayrağı.** `runtime_flags.diag_summary_llm=true` iken özet `diagnostic-summary.v1` ile
    LLM'den gelir (tutor-reply şeması, sohbet zinciri, guard, `log_bot_response`); model sunucunun
    vermediği bir yüzde yazarsa, güven düşükse ya da zincir düşerse şablon kullanılır. Bayrak seed'de
    yoktur; varsayılan şablondur.
16. **Şekil kotası.** Havuzdan şekil gönderilirken `consume_quota('figure')` düşer (§5.4); hak bittiyse soru
    şekilsiz, `alt_text` altyazısıyla gider.
17. **`dev:fake` saati.** `test/fakes/dev-worker.ts` gerçek saat ve `Math.random` kullanmaz: saat `DEV_NOW`
    (varsayılan 2026-10-20T16:00:00Z) ile başlar, her webhook isteğinde 5 sn, her cron olayında 15 dk
    ilerler; rastgelelik `seededRandom(7)`.
