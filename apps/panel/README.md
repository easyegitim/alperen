# apps/panel — Öğrenmen eğitmen paneli (M11)

Next.js **14.2** App Router + React **18.3.1**, `output: 'export'` ile statik site (sunucu yok, dolayısıyla panelde gizli anahtar yok). Cloudflare Pages `out/` dizinini yayınlar. Kapsam ve kurallar `docs/BLUEPRINT.md` §7'dedir; marka ve metin kuralları `packages/design-system/` (README, `egitmen-paneli.md`, `guven-ve-seffaflik.md`).

Panel hiçbir zaman service rolü kullanmaz ve LLM çağırmaz. Canlı modda veri doğrudan PostgREST'ten, **RLS altında** okunur; rol arayüzde yalnız görünürlük içindir (gözlemcinin "Onayla" düğmesi `disabled`, tıklansa da RPC `OGR-AUTH-002` ile reddeder).

## Hesapsız 1 dakikada çalıştırma

```
bun install --cwd /home/user/alperen/apps/panel          # postinstall: sync-ds + tokens-to-css
NEXT_PUBLIC_DATA_SOURCE=mock bun run --cwd /home/user/alperen/apps/panel dev   # http://localhost:3000
```

`mock` modunda veri `fixtures/db/dev-seed.json` ve `fixtures/panel/*.json` dosyalarından gelir (salt okunur; panel bunlara yazmaz, durum bellektedir). Rol seçici: `?role=coordinator|instructor|observer` (oturum boyunca `sessionStorage`'da kalır). Fixture dünyasının "şimdi"si `2026-10-20T09:00:00Z`'dir; göreli süreler ("41 saattir cevapsız") buna göre hesaplanır.

Yerel veli onay sayfası: `http://localhost:3000/onay?token=W4QX-7KD2` (Zeynep Ç. için tek kullanımlık web kodu; `lib/data/mock.ts` `MOCK_WEB_TOKEN`). Koordinatör `/onaylar` sayfasında yeni web kodu da üretebilir.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `bun run sync:ds` | `scripts/sync-ds.mjs`: design-system `bundle.js`, `bundle.css`, fontlar, maskot ve easy işaretini `public/ds/`'e kopyalar (**React kopyalanmaz**, CDN yok); ardından `scripts/tokens-to-css.mjs`: `tokens.json` → `app/tokens.css` (açık ve koyu tema değişkenleri, `@font-face`, `.t-*` yazı stilleri). |
| `bun run typecheck` | `tsc --noEmit` (strict). |
| `bun run lint` | ESLint 9 (typescript-eslint, react-hooks); `window.React` yalnız `lib/ds-loader.tsx`'te açılabilir. |
| `bun run test` | vitest + jsdom + testing-library; gerçek `bundle.js` yüklenir. `test/build-output.test.ts` üç derleme yapar (~50 sn): değişkensiz üretim derlemesi (durmalı), `live` derlemesi `.next-live-test/` dizinine (mock dünyası pakette olmamalı; test sonunda silinir) ve `mock` derlemesi `out/`'a. |
| `NEXT_PUBLIC_DATA_SOURCE=mock bun run build` | `out/` üretir; ağ yok, `next/font` yok, telemetri kapalı. `NEXT_PUBLIC_DATA_SOURCE` verilmeyen üretim derlemesi durur. |
| `bun run start` | `scripts/serve-out.mjs`: `out/`'u yerelde sunar (pilotta kurucu makinesi). |

`public/ds/`, `out/`, `.next/` commit edilmez (`.gitignore`); `app/tokens.css` üretilir ama commit edilir (test güncelliğini denetler).

## Tasarım sistemi yükleme (ADR-0008)

`bundle.js` bir IIFE'dir ve 2. satırda `var React = window.React` okur. Next React'i modül olarak paketler, `window.React` açmaz; ikinci bir React (UMD) "Invalid hook call" üretir. Bu yüzden:

1. `lib/ds-loader.tsx` (`'use client'`) `app/layout.tsx` gövdesinin ilk çocuğudur: `useLayoutEffect` içinde Next'in **kendi** `react` / `react-dom` örneğini `window.React` / `window.ReactDOM` olarak açar, `/ds/bundle.js`'i `<script defer data-ds="1">` ile bir kez enjekte eder ve `onload`'da `resolveDs(window.Ogrenmen)` çağırır. `next/script beforeInteractive` kullanılmaz.
2. `lib/ds.tsx`: `dsReady` sözü + `useDs()` (`useSyncExternalStore`). Her tipli sarmalayıcı (`MasteryMeter`, `StatTile`, `AlertRow`, …; tipler `packages/design-system/components/index.d.ts`'ten) çözülene kadar `aria-busy` iskelet döner; hiçbir sayfa `Ogrenmen.*`'i doğrudan çağırmaz.
3. Bundle yüklenemezse (`error` olayı: deploy'da `public/ds/` yok, 404, CSP) `failDs()` çağrılır: `Button`, `TextField`, `Notice`, `Badge` sade HTML karşılıklarıyla çalışmaya devam eder (veli `/onay`'da "Onaylıyorum"u görür ve basabilir), diğer sarmalayıcılar `<p role="alert">Arayüz yüklenemedi; sayfayı yenile.</p>` gösterir (`test/ds-fail.test.tsx`).

## Sayfalar

| Rota | İçerik |
| --- | --- |
| `/` | StatTile ×4 (cevapsız "Acil", sessiz "Dikkat", yaklaşan teslim, yanıt süresi "Hedefte/Dikkat"), AlertRow listesi (Acil → Dikkat → Bilgi, grup içinde en eski üstte). "Cevapla" → `resolve_alert` + `tg://`; sessiz / moral / teslim uyarısında "Mesaj gönder" yalnız `tg://` bağlantısıdır (uyarıyı kapatmaz), ayrı sessiz "Tamam" → `resolve_alert`. "Yanıt süresi (14 gün)" tek seri SVG + tablo görünümü. |
| `/dersler`, `/ders?id=` | Ders raporları; taslakta Notice warning "Onay bekliyor". Rapor: konuşma satırı (oran · soru · moral), claim başına MasteryMeter / MisconceptionItem + EvidenceQuote ("Ders 19 Eki · 00:06"), Onayla / Düzelt / Reddet; altta tek primary "Onayla" → `approve_lesson_analysis` — her madde açık karar alana kadar kapalıdır ("3 madde karar bekliyor"); kalanları bilerek onaylamak için ikincil "Kalanların hepsini onayla"; "Ders analizi: 0,41 $ (ayrı bütçe)". "Ders kaydet" → `register_lesson`. |
| `/cevaplar` | TutorMessage review satırı (model · "0,002 $" · hafıza olgusu · İşaretle); hafta / yalnız işaretli / öğrenci filtresi; temizlenmiş prompt açılır panelde. |
| `/kuyruk` | `v_review_queue`: soru + FigureFrame (denetim adımları), salt okunur QuizOption, "Cevap anahtarını göster" (`peek_answer_key`, audit'e yazılır); `sympy_status='not_applicable'` soruda "Onayla" anahtar görülene kadar `disabled` ("Önce cevap anahtarını gör"); şekil ("Reddet" → `review_status='rejected'`, §3.4), yanılgı (`pending_review` için "Onayla" → `status='open'`, §10.3 "eğitmen onayı → open"; "Çözüldü olarak kapat" → `resolve_misconception` yalnız yeniden incelemeye düşen açık yanılgıda ikincil eylem), havuz açıklaması, işaretli cevap, öncelik planı (`approve_priority_plan`), araştırma (CitationCard + ilgi seçici 0/1/2, gözlemcide `disabled`, "Yayınla"); "Soru ekle" (`source='instructor'` + `set_answer_key`). |
| `/oncelik?course=` | Kalem (b): plan listesi, "Sıklık analizine göre öncelikler" (ExamPriorityRow; kanıt → `v_exam_items_full`), "Onayla" / "Geri çek"; "Arşiv yükle": PDF → Storage `exams/<uuid>.pdf` + `exam_sources` (hukuki dayanak zorunlu seçim, `hoca-A`…`hoca-Z` takma adı). |
| `/gruplar` | Koordinatör: gruplar (bot yönetici değilse Notice warning), otomatik yanıt dakikası ve saklama günü, üyeler; `link_staff_telegram`, `mint_staff_code` (kod bir kez gösterilir, 72 saat). |
| `/ogrenciler`, `/ogrenci?ref=` | Liste "Elif K." (`person_labels`); koordinatör atama (`staff_students`). Profil: MasteryMeter (`min_evidence` settings'ten, "YKS 2027"), açık yanılgılar kanıtlarıyla, haftalık özet, kota, son denemeler, eğitmen notu (`add_instructor_note`). |
| `/onaylar` | Onay durumu ve iptal, `is_minor` düzeltme, veli kodu/bağlantısı (`mint_guardian_code`), "Kâğıt onay gir" (`record_staff_consent`), kimlik formu (`student_full_name` audit'li okuma + `update_student_pii`), silme talepleri, yasal metin sürümleri (Notice legal), denetim kaydı (`audit_recent`). |
| `/maliyet` | Koordinatör: "Sohbet ve toplu işler" ve "Ders analizi" sütunları, sağlayıcı payı, tavan çubukları (`check_spend`), bayraklar (`set_runtime_flag`; `paid_llm_enabled` true'ya dönüş yalnız buradan), tablo boyutları, havuz isabeti, pilot ölçütleri ("henüz ölçülmedi"), **Pilot kapısı** (PASS / FAIL / NO_DATA, "Kapı: AÇIK / KAPALI"). |
| `/onay?token=` | Veli onay formu: giriş yok, tek sayfa, başlıklar title-3; formun **kendi metni** (`docs/hukuk/veli-onay-formu.md` bölüm 1–4, saklama günleri dolu) ve açılır bölümde aydınlatma metninin tamamı; metin sürümü sayfada yazar ve `p_form.doc_version` / `legal_text_id` olarak kanıta gider; beyan kutuları formun 5. bölümünden (1, 2, 4); önceden işaretli kutu yok; "Onaylıyorum" (primary) / "Şimdi değil" (quiet) → `redeem_guardian_token` (anon RPC, oturum açık tarayıcıda da anon anahtarıyla). |
| `/giris` | E-posta + şifre (GoTrue REST); magic link ikincil (PKCE). |

Sayfada en fazla bir `primary` düğme vardır (statik ve render testleri). Maliyet yalnız `/cevaplar` denetim satırında, koordinatörün `/maliyet` sayfasında ve ders raporunun ayrı bütçe satırında görünür; öğrenciyle ilgili yüzeylerde yoktur.

## Veri katmanı

- `lib/data/types.ts` — `DataSource` arayüzü (§7 listesi + kuyruk ayrıntısı gibi yardımcı okumalar).
- `lib/data/live.ts` — PostgREST + RPC (`lib/supabase.ts`: bağımlılıksız `fetch` istemcisi, oturum `localStorage`'da). Ham metin (`text_raw`, `ocr_text`) **yalnız** `v_messages_staff` / `v_exam_items_full` görünümlerinden okunur; gözlemci için `messages.text_llm` ve `ocr_text`'siz `exam_items`. Çağrılan RPC adları `test/rpc-names.json`'da donmuştur (M13 `check-rpc-parity.sh` migration'larla eşler).
- `lib/data/mock.ts` — sunucu kurallarının yerel eşleniği: `can_see_student` / `can_edit_student`, `OGR-Q-003` (anahtar görülmeden onay yok), tek onaylı öncelik planı, `OGR-CONS-004`, `OGR-PII-001`; deterministik kod üretimi.
- `lib/pilot-gate.ts` — `settings.pilot_gate` + son `pilot_metrics` dönemi → ölçüt başına PASS / FAIL / NO_DATA (`value=null` ya da `n < n_min` → NO_DATA; `required:false` bilgi satırı); zorunluların hepsi PASS ise AÇIK. Dize eşikli `isolation_tests` / `key_leak_tests` durumu da veriden okunur (`ciStatusFromMetrics`): `pilot_metrics` satırı `metric='isolation_tests'|'key_leak_tests'`, `detail.status='pass'|'fail'` (ölçüt başına en son dönem). Satır yoksa NO_DATA.
- `lib/validation.ts` — panel, mock ve live'ın **aynı** kuralları: arşiv PDF'i (MIME ya da `.pdf`, boş değil, ≤ 20 MB), `^hoca-[A-Z]$`, hukuki dayanak, dönem türü, yıl; `tg_chats.retention_days` 1–365 ve `group_auto_answer_min` 0–240 (§3.5'te CHECK yok; aralık dışı değerle istek gitmez); kod gösterimi `formatCode` (RPC 8 karakter döner, panel `K7F3-2QX9` biçiminde gösterir; redeem `-` işaretini atar).
- `lib/status.ts` — öğrenci durum rozeti (`active` Etkin, `pending_consent` Onay bekliyor, `paused` Durduruldu, `deleted` Silindi) ve onay değişikliğinden sonraki durum (RPC'lerdeki `case when consent_ok(sid) then 'active' else 'pending_consent' end`). Koordinatörün onay iptali ve `is_minor` düzeltmesinden sonra live da mock da bu kuralla `students.status` yazar (§3.8 K: `students u (status)`).
- `lib/content-hash.ts` — "Soru ekle"nin `questions.content_hash`'i: `content/tyt-matematik/templates/_common.py` `content_hash()` ile aynı normalleştirme (boşluk sadeleştirme, küçük harf, `A:metin|B:…`), tarayıcıda SHA-256 onaltılık. Live satırı `verification: {schema:true, sympy/render/vision:'not_applicable', attempts:0}` ve `status='pending_review'` ile yazar, sonra `set_answer_key`; anahtar yazılamazsa taslak silinir, silinemezse `PANEL-ORPHAN` ile açıkça bildirilir.
- `lib/legal.ts`, `lib/markdown.tsx` — `/onay` metni: `docs/hukuk/*.md` derleme anında `?raw` ile içe alınır, `{{RETENTION_*_DAYS}}` yer tutucuları `placeholders.json` (`policy_id`, `days_source`) üzerinden doldurulur; mock'ta `retention_policies` satırlarından, canlıda (anon okuyamaz) `expected_days`'ten. 0 ya da eksik gün metne yazılmaz, hata verir.

## Veri kaynağı ve derleme

- `NEXT_PUBLIC_DATA_SOURCE` üretim derlemesinde **zorunludur** (`live` ya da `mock`); verilmezse `next.config.mjs` derlemeyi durdurur. Unutulan değişken girişsiz, sahte verili ve herkese açık `?role=` seçicili bir panel yayınlamaz. Geliştirme ve testte tanımsızsa mock kullanılır.
- `live` derlemesinde `lib/data/mock.ts` paketlenmez: `NormalModuleReplacementPlugin` onu `lib/data/mock-unavailable.ts` ile değiştirir; rol seçici ve yerel giriş bileşeni literal `process.env.NEXT_PUBLIC_DATA_SOURCE` karşılaştırmasıyla paketten düşer. `fixtures/db/dev-seed.json` (`secure.answer_keys`, `secure.student_pii`, `secure.guardian_codes`, Telegram kimlikleri, `MOCK_WEB_TOKEN`) istemciye hiçbir zaman gitmez — `test/build-output.test.ts` ayrı bir live derlemesinde `answer_keys`, `canonical_expr`, `code_hash`, `code_plain`, `W4QX`, fixture adları ve e-postaları arar ve mock derlemesinde aynı izlerin bulunduğunu da doğrular (denetim anlamlı).
- Canlı derleme ortamı: `NEXT_PUBLIC_DATA_SOURCE=live`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon anahtarı herkese açıktır; RLS korur). URL ya da anahtar eksikse statik ön render durur (eksik ayarla yayın yapılmaz).

## Hata kodları

`OGR-*` kodları bağlayıcı ad alanıdır (BLUEPRINT §3.9) ve panelde yalnız oradaki anlamlarıyla kullanılır (mock aynı kodları aynı anlamla atar: `OGR-Q-003`, `OGR-LESSON-001` "zaten karar verilmiş", `OGR-PLAN-002` "plan yok", `OGR-CONS-004`, `OGR-PII-001`, `OGR-STAFF-001/002`, `OGR-AUTH-002`…). Yalnız istemcide doğan hatalar OGR olmayan, **istemci yerel** `PANEL-*` önekini taşır; sunucuda karşılıkları yoktur ve M13 parity denetimine girmez:

| Kod | Anlam |
| --- | --- |
| `PANEL-FORM` | form ya da alan denetimi (boş, aralık dışı, PDF değil, aynı soru zaten var) |
| `PANEL-NOTFOUND` | yerel veride kayıt yok ya da koşullu güncelleme 0 satır değiştirdi |
| `PANEL-LINK` | veli bağlantısı yerel kilit (5 hatalı deneme) |
| `PANEL-AUTH` | GoTrue girişi reddedildi |
| `PANEL-NET` | ağ hatası, 5xx ya da eksik Supabase ayarı |
| `PANEL-DS` | tasarım sistemi bundle'ı yüklenemedi |
| `PANEL-ORPHAN` | soru yazıldı ama cevap anahtarı yazılamadı ve taslak silinemedi |

## Açık maddeler (diğer modüller)

- **M02 — anon okunabilir hukuk metni (engelleyici değil, ama ilke 5 için gerekli):** `anon` rolü `legal_texts` ve `retention_policies`'i okuyamaz (§3.8). `/onay` canlı modda bu yüzden derleme anındaki `docs/hukuk/veli-onay-formu.md` sürümünü ve `placeholders.json` `expected_days` değerlerini gösterir (M13 docs-consistency bu değerlerin tohumla aynı olduğunu denetler) ve `legal_text_id` olarak `null` gönderir; sunucu `redeem_guardian_token` içinde en son `veli_onayi` satırını bağlar. Önerilen RPC: `legal_text_public(p_kind text) returns table(id uuid, version text, body_md text)` + çözülmüş saklama günleri, `grant execute … to anon`. RPC migration'a girince `live.ts guardianFormText()` onu çağırır ve ad `test/rpc-names.json`'a eklenir (şimdi eklenmez: parity betiği migration'da olmayan adı reddeder). `redeem_guardian_token`'ın `p_form.doc_version` / `legal_text_id`'yi kanıta yazması ve sürüm uyuşmazlığında reddetmesi de M02'ye önerilir.
- **M02 — "Soru ekle" yetkisi:** §3.8 eğitmen ve koordinatöre `questions` üzerinde yalnız `r u` verir; canlı "Soru ekle" için `insert` (ve yetim taslağı silmek için `delete` ya da bir `add_instructor_question` RPC'si) gerekir. Panel satırı şemaya uygun yazar (`content_hash`, `verification`, `pending_review`); izin gelene kadar canlıda RLS reddeder ve panel hatayı gösterir.
- **M07 / CI — pilot kapısının CI satırları:** panel `isolation_tests` ve `key_leak_tests` durumunu `pilot_metrics` satırlarından (`detail.status`) okur; `kulaklik metrics --ci-status` ya da CI adımı bu satırları yazmalıdır. Yazılmadıkça iki satır NO_DATA ve kapı KAPALI kalır (CLI'daki `--ci-status` verilmeden davranışla aynı).

## Testler (§7 listesi)

`overview_orders_alerts_by_severity_then_age`, `stat_tile_shows_status_word` (`test/overview.test.tsx`); `mastery_hides_percent_below_min_evidence`, `lesson_draft_shows_onay_bekliyor`, `observer_has_no_enabled_approve_button`, `cost_only_in_review_row`, `student_label_is_initial_only`, `consent_page_no_prechecked_box`, `citation_relevance_only_instructor`, `approve_disabled_until_key_peeked`, render edilmiş sayfa başına tek primary (`test/pages.test.tsx`); `primary_button_at_most_one_per_page` (statik), `no_cdn_urls`, `rpc_names_frozen`, `live.ts` ham metin denetimi, `sync-ds` ve `tokens.css` güncelliği (`test/static.test.ts`); `bundle_uses_same_react_instance` (`test/ds.test.tsx`); `pilot_gate_matches_thresholds` (`test/pilot-gate.test.ts`); `no_second_react_copy`, `out/` anahtar/CDN taraması, live derlemesinde mock verisi yokluğu ve değişkensiz derlemenin durması (`test/build-output.test.ts`); bundle yükleme hatası yedeği (`test/ds-fail.test.tsx`); canlı istemci istekleri (`test/live.test.ts`, sahte `fetch`); mock kuralları ve determinizm (`test/mock.test.ts`).

### Test notu: `no_second_react_copy`

Next 14, yalnız App Router kullanan bir projede de sayfa yönlendiricisinin `_error`/404 yedeği için ayrı bir `framework-*.js` parçası (node_modules'taki React 18.3.1) üretir; App Router ise Next'in kendi paketlediği React 18 örneğini kullanır. `framework-*.js` hiçbir HTML sayfası tarafından yüklenmez. Bu yüzden test, React çalışma zamanı imzasını (`__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` + `PureComponent`, yani React çekirdeğini tanımlayan dosya) **sayfaların gerçekten yüklediği betikler** arasında sayar ve tam bir dosya bekler; ayrıca `framework-*.js`'in hiçbir sayfaya yüklenmediğini, `out/`, `out/ds/` ve `public/ds/` içinde `react*.js` olmadığını ve `bundle.js`'in React içermediğini doğrular. `bundle.js`'in kullandığı örnek, ağacı render eden örnektir (`window.React === React`, `test/ds.test.tsx`).
