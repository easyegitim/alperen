# apps/web — Öğrenmen web uygulaması

Öğrenci, veli ve eğitmenin tek uygulaması: **Next.js 16** (App Router, React 19, TypeScript, Tailwind 4) + **Supabase Auth/RLS** + PWA.
Plan: `docs/PLAN-v2.md` (§13 IA) ve `docs/PLAN-v2-detail.md`. Tasarım: `packages/design-system` (`@ogrenmen/design-system`).

Bu paket **iskelettir**: kimlik doğrulama, rol yönlendirmesi, üç kabuk, her rota için gerçek sayfa iskeleti, PWA ve tema hazırdır.
Ürün verisi P1 ile bağlanır. Tek istisna dışında LLM çağrıları `apps/worker`'dadır: **Koç sohbeti** (`POST /api/chat`, rota `coach_chat`; "Çözümü göster" modunda `coach_deep`) akışlı olduğu için web sunucusunda koşar (aşağıda "Koç sohbeti"); anahtar yalnız sunucu ortamındadır.

## Çalıştırma

```bash
cd apps/web
cp .env.example .env.local        # Supabase adresi + anon anahtarı (yerel: `supabase start` çıktısı)
bun run dev                       # next dev --webpack, http://localhost:3000 (servis çalışanı kapalı)
bun run build && bun run start    # üretim: webpack derlemesi (Serwist), servis çalışanı public/sw.js
bash check.sh                     # typecheck + eslint + vitest + next build
OGRENMEN_LIVE=1 bash check.sh     # + Playwright E2E (sahte Supabase) + P1 yolculuğu (yerel Postgres; Chromium gerekir)
bun run icons                     # PWA simgelerini maskottan yeniden üretir (sharp)
```

Paket kurulumu her zaman kökten: `cd /home/user/alperen && flock /tmp/ogrenmen-bun.lock bun install`.

## Ortam değişkenleri

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | evet | Supabase proje adresi. Derleme sırasında gömülür. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | evet | Herkese açık (anon) anahtar. `service_role` anahtarı bu uygulamada **kullanılmaz** (RLS, kullanıcının JWT'siyle). |
| `NEXT_PUBLIC_SITE_URL` | üretimde zorunlu | Dışarıdan görünen adres; e-posta bağlantısı ve Google dönüşü bununla kurulur. Üretimde (`NODE_ENV=production`) tanımsızsa e-posta/Google eylemleri hata verir ve `/api/health` `site_url: missing` bildirir; yalnız geliştirmede `x-forwarded-*` başlıklarından türetilir. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | isteğe bağlı | Web-push VAPID **herkese açık** anahtarı (base64url). Boşsa "Anlık bildirimleri aç" düğmesi yerine açıklama görünür. Özel anahtar worker'dadır. |

Ayrıca (yalnız E2E): `E2E_WEB_PORT` (3101), `E2E_SUPABASE_PORT` (54399), `E2E_OFFLINE_PORT` (3102).

## Rotalar

| Yol | Rol | İçerik |
|---|---|---|
| `/` | herkes | Oturuma ve role göre yönlendirir |
| `/giris` | herkese açık | E-posta kodu (OTP) + sihirli bağlantı + Google; `?next=` korumalı (yalnız uygulama içi yol) |
| `/auth/callback`, `/auth/confirm` | herkese açık | PKCE `?code=` değişimi; `token_hash` doğrulaması |
| `/hos-geldin` | oturumlu, onboarding bitmemiş | Rol seçimi; öğrenci **tek soru** (mockup S01; `src/app/ogrenci/onboarding/soru.tsx`): arama + 6 çip (TYT · AYT · LGS · KPSS · Üniversite dersi · Diğer) → Devam → profil satırı (yoksa) + `onboarding_enroll` RPC (ders/müfredat eşleşmesi ya da taslak müfredat + `curriculum.draft` işi, `onboarded_at`, `suggestions.refresh`); veli formu (davet kodu → `accept_guardian_invite`); eğitmen: davetle bilgisi |
| `/ogrenci/onboarding?mufredat=<id>` | öğrenci | **Hazırlıyorum…**: taslak müfredatın `draft_status`'u `useLive` ile izlenir (Realtime olayı ya da 2 sn → 5 sn yoklama `GET /ogrenci/onboarding/durum`, bütçe 10 dk); bitince Bugün |
| `/ogrenci` | öğrenci (+admin) | **Bugün** (S02): `list_today_suggestions` → kahraman kart (ilk başlatılabilir öneri, tek birincil Başla) + en çok 3 kutu + "+ yükle" (`/ogrenci/yukle`) + belge/yükleme sonucu kartları (`consume_suggestion` → görüntüleyici / sonuç). Öneri yoksa tek "İlk testine başla" (`start_practice(null, kayıt)`); taslak sürüyorsa "Planın kuruluyor"; taslak bitti ama otopilot kapalıysa (üniversite dersi, `curriculum_autopilot_state.effective = false`) düğmesiz "Planın eğitmen onayında" (yayından sonra ilk kart gelir; `start_practice` burada OGR-PRAC-008 verirdi). `?hata=<OGR-kodu>` tek cümle uyarı. Sıralama saf: `src/server/suggestions/arrange.ts` |
| `/ogrenci/test/[id]` | | **Test** (S04): `get_practice_set` → oynatıcı (Kapat, ilerleme noktaları, soru + şekil `figures` kovası, 5 şık `QuizOption`, Sonraki/Bitir); her cevap `answer_practice_item`; durum makinesi `src/server/practice/machine.ts`. Set `needs_generation` ise sade bekleme: maskot + "Soruları hazırlıyorum…" (worker `practice.generate`'i `start_practice` kuyruğa atar; şablonla < 10 sn, sahte LLM < 5 sn), 2 sn'de bir yoklar (`src/server/practice/wait.ts`; süre setin `started_at`'inden); 60 sn'yi geçerse "Biraz uzun sürdü, Koç'a sorabilirsin" + Koç'a sor + Bugün'e dön; üretim düştüyse (`generation_failed`) aynı not, sonuç ekranına gitmez |
| `/ogrenci/test/[id]/sonuc` | | **Sonuç** (S05): `finish_practice` özeti → skor + noktalar, tek cümle, "Neyi öğrendik" (en sık yanılgı), Devam et · Detay (katlı: yanılgı sayısı, konu başına doğru) · Koça sor (`/ogrenci/koc?alistirma=<set>`). Ortak bileşen `src/components/result` (`OneLineResult`) |
| `/ogrenci/koc` | | **Koç** (mockup S03): klasik sohbet, akışlı yanıt, KaTeX, fotoğraf/PDF eki, ince mod seçici (İpucu · Açıkla · Çözümü göster). `?seed=<solution_analysis_id>` ("Koça sor") teşhis bağlamını ilk mesaja ekler |
| `POST /api/chat` | öğrenci | Koç turu → `text/event-stream` (`start` · `text` · `tool` · `restart` · `done` · `error`) |
| `POST /api/chat/upload`, `GET /api/chat/upload/[id]` | öğrenci | Koç eki (Storage `uploads` + `uploads` satırı, kullanıcı JWT'siyle) ve küçük resmi |
| `/ogrenci/yukle` | | **Yükle** (mockup S07): Kendi çalışmam / Okul denemesi → Fotoğraf çek (`capture`) ya da Dosya/PDF seç → Gönder. Görsel tarayıcıda ≤ 2576 px JPEG'e küçültülür, Storage `uploads/<auth.uid()>/<uuid>.jpg|pdf`'e gider; sunucu eylemi (`src/server/uploads`) `uploads` satırlarını yazar ve `submit_upload` RPC'sini (0026) çağırır. Sayfa sınırı türe göre: Kendi çalışmam 4, Okul denemesi 40 (worker ve RPC aynı). Admin ekranı görür ama dosya girişi yok (yükleme yalnız öğrenci) |
| `/ogrenci/sonuc?yukleme=<id>[&tur=deneme]` · `?analiz=<id>` | | **Sonuç** (S05): "İnceliyorum…" bekleme (`useLive`: Realtime `solution_analyses`/`uploads` ya da yoklama `GET /ogrenci/sonuc/durum?yukleme=`, 120 sn), sonra tek cümle + "Neyi öğrendik" + Devam et · Detay · Koça sor (testin sonucuyla aynı `src/components/result` `OneLineResult`); okul denemesinde "Sayfaları aldım."; düşen yüklemede kartın `payload.failure`'ına göre "Fotoğrafı okuyamadım." ya da "Yüklemeni şu an işleyemedim." |
| `/ogrenci/teshis/[id]` | | **Detay** (S06): soru, neden cümlesi, katlı "Adımları göster" (senin adımın · beklenen), kazanım tek satır (kelime bandı; yanılgının kazanımı, yoksa modelin ilk kazanımı `analysis.skill_order` — "Neyi öğrendik" ile çelişmez), tek birincil "Koça sor" → `/ogrenci/koc?seed=<solution_analysis_id>`. Adım merdiveni yereldir (`adim-merdiveni.tsx`): DS `StepLadder` iki sütunlu (öğrenci · beklenen) ve `ok/failing/after` üç durumlu; S06 satır başına öğrenci + beklenen ve "Bundan etkilendi" / "Ayrıca hata" / "Eksik adım" durumlarını ister. DS'ye bu durumlar eklenince yerel bileşen kalkar |
| `/ogrenci/gelisim` | | **Gelişim** (S08): 3 sayı (son 7 günde çözülen soru `attempts` · son deneme neti `exam_sessions.score.net` ya da "henüz yok" · hedefe kalan gün `enrollments.exam_date`), "Günlük soru" çizgisi (deterministik SVG, İstanbul günleri), katlı Konular (`mastery_view` bandı kelimeyle), katlı Belgelerim (`generated_documents`), Profil ve ayarlar |
| `/ogrenci/gelisim/belgeler/[id]` | | **Belge** (S09): `PdfViewer`; PDF `documents` kovasından kullanıcı JWT'siyle imzalı adres (10 dk) |
| `/ogrenci/sor` | | **Sor**: `CameraSheet` (kamera FAB'ının hedefi) |
| `/ogrenci/gelisim/konular`, `/belgeler` | | Tüm konular (`mastery_view`) / tüm belgeler; boşsa maskotlu boş durum; eski `/denemeler`, `/notlarim`, `/konu-haritasi` yönlenir |
| `/ogrenci/profil` | | Hesap, bildirim aboneliği, tema, çıkış |
| `/ogrenci/profil/hafiza` | | `memory_files` listesi (RLS); boşsa açıklama |
| `/veli` | veli (+admin) | **Özet** (S10 iskeleti): bağlı çocuklar (`guardian_links`), "Henüz veri yok.", Soru sor (birincil) / Rapor iste; veri P6 |
| `/veli/sohbet` | | **Sohbet** (S10b iskeleti): "Henüz veri yok."; `/veli/raporlar` Özet'e yönlenir |
| `/veli/bildirimler` | | `notifications` listesi (RLS) |
| `/veli/ayarlar` | | Ek davet kodu kabulü, bildirim aboneliği, tema, çıkış |
| `/egitmen` | eğitmen/admin | **Öğrenciler** (`instructor_links`) |
| `/egitmen/dersler` | | `courses` listesi (RLS) |
| `/egitmen/mufredatlar` | | Müfredat listesi: ders, sürüm, durum (taslak işinin ilerlemesiyle), açık öneri sayısı |
| `/egitmen/mufredatlar/[id]` | | Ağaç editörü (mockup S12): katlanır ağaç, satır içi yeniden adlandırma (Enter/Esc), alt kazanım ekle, yukarı/aşağı, başka üst düğüme taşı, birleştir; öneriler kutusu (Kabul et / Reddet); otopilot anahtarı; tek birincil düğme: taslak düştüyse **Taslağı yeniden kur**, taslakta **Bu sürümü yayınla**, yayındaki sürümde **Yeni sürüm aç**; yayın/yeni sürüm/otopilot yalnız yayın yetkisiyle (`can_publish`). Taslak kurulurken ilerleme `useLive` (Realtime; bağlanamazsa 2 sn → 5 sn yoklama, bütçe 15 dk). `draft_meta`/`draft_error` tablodan okunmaz, `curriculum_editor_state.draft`'tan gelir. Yazımlar sunucu eylemleriyle RPC: `curriculum_edit`, `curriculum_publish`, `curriculum_new_version`, `curriculum_set_autopilot`, `curriculum_draft_retry`, `decide_proposal` (0025, 0017) |
| `/egitmen/soru-tarzlari`, `/icerik`, `/sinavlar`, `/kuyruk`, `/maliyet` | | Boş durum |
| `/egitmen/ayarlar` | | Tema, çıkış |
| `/davet?kod=` | oturum gerekir | Veli davet bağlantısı; rolüne göre kurulum ya da Ayarlar formuna yönlendirir |
| `/cevrimdisi` | herkese açık | Servis çalışanının önceden önbelleğe aldığı yedek sayfa |
| `/api/health` | herkese açık | `{status, service, time, supabase, site_url}`; önbelleğe alınmaz |
| `/manifest.webmanifest` | herkese açık | PWA bildirimi (`app/manifest.ts`) |

Kök adres, giriş ve alan geçişleri `src/proxy.ts` + `src/lib/routing.ts` (saf `decideRoute`) ile; yetkinin asıl noktası sunucuda `requireRole` (`src/server/auth.ts`).

## Canlı izleme (`src/lib/live.ts`)

İş bitene dek ekranı tazeleyen ortak yardımcı: `useLive({ key, tables, check, timing?, onGiveUp? })`. Barındırılan
Supabase'de verilen tablolara Realtime `postgres_changes` aboneliği açar (olay gelince hemen `check()`; abonelik ayaktayken
yoklama 15 sn'lik güvenlik nabzına iner); Realtime yoksa, bağlanamazsa ya da koparsa (kanal kaldırılır) yoklar: 2 sn ile
başlar, her turda 1,5 kat, 5 sn tavan; toplam 120 sn (ekran `timing.maxElapsedMs` ile uzatabilir) dolunca durur ve
`onGiveUp` çağrılır. Sekme görünmezken durur; görünür olunca hemen bakar ve bütçeyi sıfırlar. `check()` true dönerse biter.
`NEXT_PUBLIC_SUPABASE_REALTIME=off` Realtime'ı kapatır (yerel köprü ve sahte Supabase'de bağlantı zaten düşer, yoklamaya
geçilir). Realtime yayınındaki tablolar: `curricula` (0025), `suggestions`, `practice_sets`, `solution_analyses`, `uploads`
(0029). Kullananlar: `DraftProgress` (eğitmen editörü), onboarding `Hazirlik`, sonuç `Bekleme`. Çekirdek (`startLive`)
çerçeveden bağımsızdır; `test/live.test.ts` sahte saat/görünürlük/kanal ile sınar.

## Koç sohbeti (`src/server/chat`, `src/components/chat`)

- **Akış**: `POST /api/chat` → oturum (`requireRole` eşdeğeri: yalnız öğrenci) → `prepareTurn` (gövde zod ile; sohbet, ekler ve teşhis öğrenciye ait mi; tur kilidi — aynı sohbette tur sürüyorsa 409 `turn_in_progress`; hatalar akış başlamadan 4xx JSON) → kullanıcı turu `conversation_messages`'a → `@ogrenmen/llm` geçidi: İpucu/Açıkla `coach_chat` (Sonnet 5.5 · medium), Çözümü göster `coach_deep` (Opus 5.5 · high; mod değişiminde ilk istek önbelleği ıskalar, bilerek) — akışlı → `text/event-stream` → bitişte transkriptin yeni kısmı (tur sistem mesajı, araç turları, son yanıt) kaydedilir; son mesaja `llm_call_id` ve tur kaydı (`tool_calls`: araçlar, `record_turn_meta`, ret, yönlendirme) bağlanır.
- **İstek gövdesi** (PLAN-v2 §3.3): `system[0]` ürün + koç rolü + rota (`@ogrenmen/prompts` `loadPrompt('coach_chat')`, 1 sa önbellek), `system[1]` ders bloğu (`renderCourseBlock`, 1 sa), `system[2]` dossier (`renderDossier`, 5 dk; 5 dk'dan taze önbellek RPC'siz); geçmiş = `conversations.summary` (ilk kullanıcı mesajının başına) + özetten sonraki ~30 mesaj; pencere 15 mesajda bir kayar (başlangıç sabit kalır, mesaj öneki önbellekte kalır), yalnız önden düşer, araç çiftini bölmez; önceki turların `thinking`/`redacted_thinking` blokları geçmişe hiç konmaz (kayıtta kalır): Sonnet 5.5 / Opus 5.5 thinking bağını system, araçlar ve önceki mesajlar değişmemişse kabul eder, oysa özet, pencere kayması, dossier/ders bloğu ve "Çözümü göster" (system[0] + model) her gün geçmişi değiştirir — gönderilseydi 400 olur, sohbet kalıcı bozulurdu (süren turun araç döngüsündeki thinking geçitte kalır; kalıcı çözüm `block_binding: drop_block`, packages/llm); ek bütçesi (istekte base64 ≤ 20 MB; aşılınca pencere önden ekler 12 MB'a inene dek ilerler); güvenlik ağı: kullanıcı mesajını izlemeyen `system` ve eşsiz `tool_use`/`tool_result` ayıklanır; sona `{role:"system", "Bugün … Mod: …"}`. Tur sistem mesajları da saklanır: bir sonraki istekte önek birebir aynıdır (test edilir).
- **Araçlar**: `memory` (`CoachMemoryStore`: okuma `coach_context` dosya içeriklerinden, yazım `coach_memory_write`, actor `coach:<sohbet>`; `parent_summary.md` yazılamaz), `search_evidence` (yüklemeler, teşhisler, deneme "nereye kadar geldim", onaylı ders iddiaları, koç sohbeti; gömme yokken kelime eşleşmesi), `get_mastery` (kelime bandı + kanıt sayısı + son görülme; ham olasılık verilmez), `get_recent_exams` (net, doğru/yanlış/boş, bölüm sonuçları, öne çıkan hatalar: en çok kaçırılan kazanımlar ve teşhis yanılgı etiketleri), `record_turn_meta` (öğrenciye gösterilmez).
- **Mod** `conversations.mode`: yalnız öğrenci değiştirir (seçici → sunucu eylemi; mesajla birlikte de gider). Modelin `mode_suggestion`'ı yalnız öneridir: arayüz "Açıkla moduna geç" düğmesi gösterir.
- **Ret** (`stop_reason: refusal`): kibar Türkçe ileti (`packages/llm` refusal.ts) + gerekirse eğitmene bildirim (`notifications` `coach_escalation`; gövdede kategori Türkçe etiketle — ör. cyber → "güvenlik" —, ham değer yalnız payload'da); koç turu `escalate_to_instructor` ile işaretlerse de aynı yol. Aynı sohbetten 24 saatte en çok bir bildirim (öğrenci ısrar etse de gelen kutusu dolmaz). `instructor_notes` yazılmaz: `author_id` zorunlu ve "yazan eğitmen" anlamında, not eğitmenin yazdığı gibi görünürdü (kaynak sütunu gelince eklenebilir). Arayüz "Bu konuyu hocana ilettim." der.
- **Ekler**: istemci görseli 2576 px'e küçültür → `POST /api/chat/upload` (Storage `uploads/<profil>/<id>.<uzantı>` + `uploads` satırı, kullanıcının JWT'siyle, RLS). Mesajda görsel/PDF veritabanına base64 değil `{source:{type:'upload', upload_id}}` olarak yazılır; her istekte aynı biçimde kurulur.
- **Üretim yolu (yalnız kullanıcının JWT'si)**: `SupabaseChatStore` (`src/server/chat/supabase-store.ts`) her okuma ve yazımı kullanıcının JWT'li `@supabase/ssr` sunucu istemcisiyle `supabase/migrations/0028_coach_rpcs.sql` koç RPC'lerine yapar; web'de service_role, doğrudan Postgres bağlantısı ve `pg` havuzu yoktur (PLAN-v2 §4, PLAN-v2-detail §2.4). Kapsam DB'dedir: `app.coach_conversation` (kind `coach`, öğrencinin kendisi, katılımcı = `auth.uid()`); başka öğrenci, veli ve eğitmen 42501 alır (depo bunu "bulunamadı"ya çevirir). Okumalar: `coach_student`, `coach_history` (sohbet + özet + tur durumu + pencere), `coach_context` (dossier önbelleği ya da `render_dossier` gövdesi → `renderDossierText`; ders bloğu verisi → `renderCourseText`, süreç içi önbellek; hafıza dosyalarının içerikleri), `coach_uploads`, `coach_seed`, `coach_tool_*` (araçlar), `coach_prompt_sources` (sürüm sabitleme/geri alma). Storage ve `uploads` satırı yine JWT ile (RLS + Storage politikaları).
- **Sunucu jetonu (model çıktısı istemciden gelemez)**: öğrencinin JWT'si tarayıcıda da vardır; aynı RPC'yi PostgREST'e doğrudan çağırabilir. Bu yüzden assistant/system turları, araç blokları, `llm_calls` (`coach_log_llm_call`), hafıza yazımı (`coach_memory_write`) ve eğitmen yönlendirmesi (`coach_escalate`) `p_server_token` ister: `v1.<bitiş>.<hex hmac_sha256(OGRENMEN_WEB_COACH_KEY, "coach:<sohbet>:<bitiş>")>` (`server-token.ts`; sohbete bağlı, 15 dk; DB en çok 1 saat kabul eder). Anahtar göçte rastgele üretilen `secure.server_keys('web_coach')` değeridir; yalnız sunucu ortamında durur. Jetonsuz çağrı yalnız öğrencinin kendi `user` mesajını ekleyebilir: `{type:'text', text}` ve yükleme başvurulu `image`/`document` blokları, başka anahtar (`cache_control` vb.) ya da url/file/base64 kaynağı yok (`app.coach_client_blocks_ok`). Koç sohbetine tablodan doğrudan INSERT 0028'den beri kapalıdır; `history.ts` `hydrateBlocks` de yükleme başvurusu olmayan görsel/PDF bloklarını düşürür ve saklanan `cache_control`'ü atar. `pg` yalnız test bağımlılığıdır; `src/**` için ESLint `no-restricted-imports` (`pg`, `postgres`) doğrudan bağlantıyı engeller. Ayrı `ogrenmen_web_coach` veritabanı rolü bilerek yok: PostgREST rolü JWT'nin `role` iddiasından alır, böyle bir rolle çağırmak için web'in projenin JWT gizli anahtarıyla (service_role'den güçlü) jeton basması gerekirdi. "Server action yalnız sunucuda çalışır" yetmezdi: korunan şey sunucu kodu değil, RPC'nin kendisidir.
- **Hafıza aracı**: kuyruk (`memory.apply` işi) yerine eşzamanlı `coach_memory_write` seçildi: araç döngüsü aynı turda yazdığını okur (create → view → str_replace) ve koşullu yazım (OGR-MEM-028) çakışmayı turda bildirir; sınırlar `upsert_memory_file` ile aynı yolda (`app.memory_apply`).
- **Tur kilidi**: `secure.coach_turns` kirası (`coach_claim_turn` / `coach_release_turn`, 180 sn): aynı sohbette ikinci tur 409 `turn_in_progress`; süreç ölürse kira süresi dolunca düşer. Koç sayfası tur sürüyorsa `pending` ile "yazıyor" gösterir, gönderimi kapatır ve 3 sn'de bir yeniler. (PostgREST işlem kipinde oturum düzeyinde danışma kilidi taşınamaz.)
- **Geçit**: LLM taşıması süreçte tek; `Gateway` istek başına kurulur, defter yazıcısı (`CoachLedger`) o isteğin kullanıcısına ve satırın `ref` sohbetine bağlıdır.
- **Ekler**: tür baytlardan çözülür (JPEG/PNG/WebP/GIF/PDF; gerisi 415), saklanan ve modele giden `media_type` bu olur. Fotoğraf ≤ 3,75 MB (base64 5 MB; istemci aşanı yeniden sıkıştırır), PDF ≤ 4 MB ve 100 sayfa, bir turda toplam ≤ 16 MB base64. Küçük resim ucu yalnız görsel/PDF'i satır içi sunar (gerisi `attachment`), her yanıtta `Content-Security-Policy: default-src 'none'; sandbox`.
- **Oturum**: proxy oturumsuz `/api/*` isteğine JSON 401 döner (girişe yönlenmez); istemci "Oturumun kapanmış. Yeniden giriş yap." der.
- **Rota kapıları** (gövde okunmadan; rota işleyicileri sunucu eylemlerinin Origin denetimini almaz): Origin varsa `NEXT_PUBLIC_SITE_URL` ya da isteğin kendi kökeni olmalı, `Sec-Fetch-Site: cross-site` reddedilir (403 `forbidden_origin`); `/api/chat` yalnız `application/json` (415; `text/plain` basit istek CSRF'e açıktı); `/api/chat/upload` Content-Length ister (411) ve en büyük ek + 64 KB'ı aşanı `formData()`'dan önce 413 ile keser.
- **Kopan akış**: `start`'tan sonra akış ya da ağ koparsa sunucu turu bitirip kaydeder; arayüz hata yerine bekleme kipine geçer (3 sn'de bir yeniler, kaydedilen yanıt gelir). Üst üste iki ek seçimi en çok 4 eke izin verir (fazlası için açıklama).
- **Ortam**: `OGRENMEN_WEB_COACH_KEY` (sunucu anahtarı, 64 hex; kurucu `select secret from secure.server_keys where name = 'web_coach'` ile okur; veritabanı adresleri — `OGRENMEN_DATABASE_URL`, eski `OGRENMEN_WEB_COACH_DATABASE_URL` — okunmaz), `OGRENMEN_LLM` (`fake` | boş = Anthropic, `ANTHROPIC_API_KEY`), `OGRENMEN_CHAT_STORE=memory` (yalnız `OGRENMEN_LLM=fake` ile; süreç içi depo — E2E ve veritabanısız geliştirme). Hiçbiri yoksa Koç "kullanılamıyor" der.
- **Testler**: `test/chat-server.test.ts` (istek gövdesi: 3 system blok + tur sistem mesajı, model/effort, sıralı araç listesi; mod kuralı; araç döngüsü kaydı; önek kararlılığı; özet + pencere; ret ve yönlendirme; ekler; Koça sor; hata), `test/chat-ui.test.tsx` (S03 ekranı: akış, yazıyor, KaTeX, mod önerisi, + menüsü, mikrofon yok, hata, teşhis şeridi), `test/chat.db.test.ts` (`OGRENMEN_LIVE=1`: geçici Postgres, `SupabaseChatStore` uçtan uca — her RPC `authenticated` + JWT iddialarıyla; istemciden jetonsuz/yanlış jetonlu assistant ekleme, defter, hafıza ve yönlendirme reddi; veli ve başka öğrenci 42501; tur kirası), `e2e/koc.spec.ts` (sahte LLM ile bir tur gönder-al, ek, Koça sor, API yetkisi; API kapıları, 360 px mod seçici taşmaz; ekran görüntüleri `koc-360.png`, `koc-390.png`, `koc-1440.png`).

## Kimlik doğrulama ve rol yönlendirmesi

- **Giriş**: `src/app/giris/actions.ts` (sunucu eylemleri): `signInWithOtp` (e-postaya 6 haneli kod **ve** sihirli bağlantı), `verifyOtp`, `signInWithOAuth('google')`. Şifre yok.
- **Oturum**: `@supabase/ssr` çerezleri. `src/proxy.ts` her sayfa isteğinde oturumu yeniler (`getClaims()`: imza doğrulanır) ve `profiles.role` ile yönlendirir:
  oturumsuz → `/giris?next=`; profil/onboarding eksik → `/hos-geldin`; `/` ve `/giris` → rol ana sayfası (`student→/ogrenci`, `parent→/veli`, `instructor|admin→/egitmen`); başka rolün alanı → kendi ana sayfası. Yönetici üç alanı da görebilir.
- **Onboarding** (`/hos-geldin`): öğrenci → `profiles` (rol `student`; `students` satırını tetikleyici açar) + `students.grade`; hedef sınav ve hedef metni, ders (müfredat) seçilene kadar kullanıcı üst verisinde (`auth.users.raw_user_meta_data`) bekler (kayıt için `enrollments.curriculum_id` gerekir). Veli → `accept_guardian_invite(p_token)` RPC'si (davet kodunu öğrenci Profil'den ya da owner eğitmen öğrenci kartından `create_guardian_invite` ile üretir; `/davet?kod=gi_…` bağlantısı oturumsuzken girişe, sonra kurulum formuna kodu taşır; kurulum yarım kalırsa kod artık istenmez) (profil yoksa rol `parent` açar; hata kodları `OGR-INV-001/002/003` Türkçeye çevrilir). Eğitmen/yönetici hesabını easy ekibi açar; kendi kendine eğitmen olunamaz (RLS `profiles_insert_self` yalnız student/parent'a izin verir).
- **Supabase tarafı** (`supabase/config.toml`, bu pakette değişmez; kurulumda gerekir):
  - `site_url` ve `additional_redirect_urls` = uygulama adresi + `/auth/callback`.
  - E-posta şablonu (magic link/OTP) hem `{{ .Token }}` (6 haneli kod) hem `{{ .ConfirmationURL }}` içermeli.
  - Google: `[auth.external.google] enabled = true`, `client_id`/`secret` (ortam değişkeninden) ve Google konsolunda yönlendirme adresi `<supabase-url>/auth/v1/callback`.
- **Tipler**: `src/lib/supabase/types.ts` göçlerden elle türetilmiştir; `test/types-drift.test.ts` sütun adlarını `supabase/migrations/*.sql` ile karşılaştırır.

## Kabuklar (PLAN §13)

- Öğrenci ve veli: `src/components/shell` (`TabShell`, `ScreenHeader`), mockup S02/S08/S10 ile birebir: mobilde yalnız 64 px alt çubuk (öğrenci **Bugün · Koç · Gelişim**, veli **Özet · Sohbet**; Lucide güneş / konuşma balonu / yükselen çizgi), üst marka çubuğu yok (her sekme ekranı kendi başlığını ve sağda hesap yuvarlağını çizer); ortada FAB yok (yükleme Bugün'deki "+ yükle" bağlantısı ve Koç'taki ek düğmesi). Masaüstünde kenar çubuğu. **Odak ekranları** (`FOCUS_PREFIXES`: test, onboarding, sonuç, teşhis, yükle, belge görüntüleyici) gezinmesiz çizilir; ekranın kendi Kapat bağlantısı vardır. Profil Gelişim içinden; velide Bildirimler ve Ayarlar sayfa üstündeki hesap bağlantıları.
- Eğitmen: kenar çubuğu **Öğrenciler · Dersler · Müfredatlar · Soru tarzları · İçerik · Sınavlar · Kuyruk · Maliyet · Ayarlar**. Dokuz madde alt çubuğa sığmadığı için dar ekranda üst çubukta "Menü" düğmesi (`InstructorShell`).
- Her sayfa tek `h1` (`PageHeader`), boş durum `EmptyState` (maskot dekoratif, metin yanında). Metinler Türkçe, sen dili, ünlem/emoji yok.

## PWA

- `app/manifest.ts`: ad "Öğrenmen", `theme_color #0030a2`, `standalone`, simgeler `public/icons` (maskottan `scripts/make-icons.mjs` ile; 192, 512, maskable 512, apple-touch 180, bildirim rozeti 96).
- **Servis çalışanı** (`src/sw/sw.ts` → `public/sw.js`, `@serwist/next`): derleme çıktısı + `/cevrimdisi` önceden önbellekte (çevrimdışı kabuk); `/_next/static` (token CSS'i dahil) ve yazı tipleri CacheFirst; simgeler StaleWhileRevalidate. **Kişisel sayfalar ve `/api` hiçbir zaman önbelleğe alınmaz**; ağ yoksa gezinti isteği `/cevrimdisi`'ye düşer (E2E: sunucu gerçekten kapatılarak sınanır). `push` ve `notificationclick` işleyicileri vardır (`src/lib/push-payload.ts`: `{title, body, url, tag}`).
- **Derleme webpack ile** (`next build --webpack`): Serwist eklentisi Turbopack'te çalışmaz. Geliştirme de webpack'tir (`next dev --webpack`): Turbopack çalışma alanı paketlerindeki `./x.js` → `./x.ts` içe aktarımlarını çözmez (koç sayfası derlenmez); servis çalışanı geliştirmede kapalıdır.
- `InstallPrompt`: Chromium'da `beforeinstallprompt` ile yükleme, iOS'ta "Ana Ekrana Ekle" yönergesi; yüklüyse ya da kapatıldıysa görünmez.
- Web-push (`src/lib/push.ts`, `PushToggle`): izin + abonelik → `push_subscriptions` (RLS: kendi satırı). **Gönderim worker'dadır.**

## Tema ve yazı tipleri

`data-theme` açık/koyu; varsayılan "Sistem" (özellik verilmez, `prefers-color-scheme` geçerli). Tercih `localStorage` (`ogrenmen-tema`); boyama öncesi satır içi betik titremeyi önler. `<html lang="tr">`. Lexend ve JetBrains Mono, tasarım sisteminin `tokens.css` dosyasındaki `@font-face` ile paket içinden gelir (`font-display: swap`); harici istek yok.

## Tasarım sistemi sınırı (`src/ds.ts`)

`@ogrenmen/design-system` dosyalarında `'use client'` yönergesi yoktur ve bazıları kanca kullanır; bu yüzden paket sunucu bileşeninden doğrudan içe aktarılamaz (Next derlemesi hata verir). Tüm bileşenler `@/ds` üzerinden alınır (`'use client'` sınırı). Kuralları:

- Sunucu bileşeni `@/ds` bileşenlerini serileştirilebilir özelliklerle çizebilir; **işlev prop'u** (`onClick`, `renderLink`) gereken yerde istemci sarmalayıcı yazılır (`RoleShell`, `LinkButton`, `SorYakalama`, ...).
- Bir `@/ds` işlevini (`buttonClasses`, `formatPercent`, ...) sunucuda **çağırma**; istemci bileşeninde kullan.
- `test/ds-barrel.test.ts` listenin paketin dışa aktarımlarıyla eşleştiğini denetler.

## Testler

- `test/student-core.test.tsx`: Bugün sıralaması (rank → oluşturulma → kimlik, süresi dolan, ≤ 3 kutu, bildirim kartları), test oynatıcısı durum makinesi (devam, gönderim kilidi, hata/yeniden deneme), sonuç cümleleri, Gelişim hesapları (İstanbul günleri, çizgi geometrisi, kalan gün, bantlar), onboarding kuralları, kabuk (3/2 sekme, odak ekranları, FAB yok), `OneLineResult` ve Gelişim tiplerinin göçlerle eşliği. `test/student-flow.db.test.ts` (OGRENMEN_LIVE=1): geçici v2 veritabanı + TYT anahtar seed'i üzerinde web'in sunucu katmanı gerçek RPC'lerle (PostgREST eşleniği köprü: `SET LOCAL ROLE authenticated` + JWT talepleri): onboarding_enroll (aktif / taslak), worker önerileri → Bugün düzeni, Başla → 2 soru → finish_practice → sonuç cümlesi, RLS altında attempts ve mastery_view.
- `bun run test` (vitest, jsdom): yönlendirme tablosu, doğrulama, tema, web-push yardımcıları, hafıza başlıkları, gezinme, Supabase tip uyumu, DS giriş noktası. `test/curriculum.test.tsx`: ağaç mantığı (numaralandırma, geçerli taşıma/birleştirme hedefleri), ağaç editörü (katla/aç, Enter/Esc ile yeniden adlandırma, ekle, sırala, taşı, birleştir, salt okunur), öneriler kutusu, editör eylemleri ve müfredat tiplerinin (`src/lib/supabase/curriculum-types.ts`) göçlerle sütun eşliği.
- `bun run test:e2e` (Playwright, Chromium; `e2e/build.mjs` önce `.next-e2e` üretim derlemesini yapar): **sahte Supabase** (`e2e/fake-supabase.mjs`; Auth + PostgREST alt kümesi, gerçek RLS taklit edilmez — RLS `supabase/tests`'te) üzerinde
  `e2e/bugun-test.spec.ts` (sahte P1 RPC'leri `e2e/fake-practice.mjs`): yeni öğrenci S01 → Hazırlıyorum… → Bugün → Başla → 2 soru → Sonuç (Detay katlı) → Gelişim (Konular, Belgelerim) → Belge; öneri yokken "İlk testine başla" → soru hazırlanıyor; veli 2 sekme. 390 px ekran görüntüleri: `onboarding`, `hazirlik`, `bugun`, `test`, `test-sonuc`, `gelisim`, `belge`, `bugun-bos`, `veli-ozet`.
  giriş sayfası, e-posta kodu akışı, korumalı sayfa yönlendirmesi, rol yönlendirmesi (sahte oturum çerezi), onboarding, her rotanın açılışı, 3 kabuk × 390/1440 px (yatay taşma yok; ekran görüntüleri `test-results/screens/`, git'te yok), koyu tema, PWA bildirimi/servis çalışanı/gerçek çevrimdışı yedek sayfa.
- `bun run test:journey` (`OGRENMEN_LIVE=1`; `playwright.journey.config.ts`, `e2e/p1-journey.spec.ts`): **gerçek Postgres** üzerinde P1 yolculuğu. `e2e/journey/stack.ts` (bun) geçici v2 veritabanı (göçler + seed + TYT + cevap anahtarları) kurar, Supabase uyumlu yerel köprüyü (Auth e-posta kodu, PostgREST alt kümesi, Storage; her istek `request.jwt.claims` + `set local role` ile, yani RLS/RPC/Storage politikaları gerçek), worker'ı (`ogrenmen_owner` rolüyle, gerçek pg-boss) ve `next dev --webpack`'i (`.next-journey`; koç `SupabaseChatStore`: köprünün RPC yolu + `OGRENMEN_WEB_COACH_KEY`, web'e veritabanı adresi verilmez) açar; yolculuk koç turunu bu yolla geçer ve tarayıcının jetonuyla doğrudan assistant ekleme / defter yazımının 403 (OGR-COACH-001) aldığını sınar; kapanışta veritabanını siler. Portlar 54398/3102/3103 (`JOURNEY_*_PORT`); `JOURNEY_REUSE=1` açık yığını kullanır. Günlükler `test-results/journey/`.
- Chromium: `PLAYWRIGHT_BROWSERS_PATH` altında hazır olmalı (`@playwright/test` 1.56.1, Chromium 1194).

## Bilinen boşluklar

- Deneme, rapor, kuyruk, maliyet sayfaları **boş durum**dur. Veli Özet/Sohbet iskelettir (P6).
- Bugün'de öneri yokken arka plan yenilemesi `request_suggestions_refresh()` RPC'sini dener; `enqueue_job` yalnız service_role'de olduğundan ve web service_role taşımadığından bu RPC eklenene dek atlanır (onboarding_enroll ve finish_practice `suggestions.refresh`'i zaten aynı işlemde kuyruğa atar; gece işi de yeniler). `mini_exam` önerisi henüz test akışı açmaz: başlatıldı işaretlenip Koç'a (`?oneri=`) gider.
- Soru bankası boşken `start_practice` `practice.generate` işini kuyruğa atar (worker: şablon → yetmezse LLM, `apps/worker/README.md` "Alıştırma soru bankası"); ayrıca `questions.generate` kuyruğa atılmaz. Yeni öğrenciye teşhis atanmadıysa TYT teşhis soruları ilk alıştırmada bankadır (0027).
- Koç: mikrofon (sesle yazma) henüz yok, düğme gizli. `search_evidence` gömme (Voyage) yokken kelime eşleşmesiyle arar. Harcama tavanı (`check_spend` → Haiku'ya inme) bağlanmadı. Görseller her turda Storage'dan base64 olarak yeniden gönderilir (Files API kimliği varsa `file_id`; web henüz Files'a yüklemez, ek bütçesi sınırlar). PDF 100 sayfa sınırı ek başınadır, istek toplamı sayfa olarak sayılmaz. Koç turu RLS'i aşabilecek sunucu bağlantısıyla yazar (PLAN-v2-detail §2.4 sapması; hedef `auth.uid()` denetleyen koç RPC'leri).
- `Sor`: kamera ve çoklu çekim çalışır, gönderim yoktur (fotoğraflar yalnız cihazda hazırlanır; arayüz bunu söyler).
- Onboarding tek sorudur (mockup S01); hedef tarih sorulmaz (`exam_date` boş kalır, Gelişim "tarih yok" der). `hos-geldin/formlar.tsx`'teki eski 2 adımlı `OgrenciFormu` ve `completeStudentOnboarding` kullanılmıyor (silinebilir).
- Hafıza "Düzeltme iste" düğmesi bağlanmadı (eylemi yok); yalnız okuma. Metinler öğrenciye "eğitmenine söyle" der.
- Servis çalışanında yükleme için arka plan senkronu (Serwist BackgroundSyncPlugin) yok: Sor yükleme hattı bağlanınca eklenecek.
- Sürüm kararı: Next.js 16 (middleware yerine `src/proxy.ts`, derleme `--webpack` ile Serwist için). Sürüm sapması: PLAN-v2 §12 "Next.js 15" der, kurulum Next 16 (`src/proxy.ts` Next 16 proxy'sidir); orkestratör planı güncellemeli.
- Google girişi uygulama tarafında hazır; Supabase `config.toml`'da sağlayıcı ve yönlendirme adresleri ayarlanmalı.
- `next build` webpack ile; Serwist Turbopack desteği gelince `--webpack` kalkar.
