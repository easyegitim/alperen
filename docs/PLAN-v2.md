# Öğrenmen 2.0 — Öğrenciden Öğrenen Sanal Eğitim Koçu: Ürün ve İnşa Planı

## Context (neden baştan planlıyoruz)

Kurucu mevcut inşayı (Telegram botu + ağır kural/hukuk/onay katmanları + yasaklar) fazla kasılmış buldu.
İstediği ürün: **Claude tabanlı, esnek, öğrenciden öğrenen bir sanal eğitim koçu** — "her şeyi attığım,
öğrenciyi ve dersi tanıyan, not ve deneme yazan Claude Projesi"nin sistematik ürün hâli. Web app + PWA, sonra
mağaza. MVP değil, tam ürün. Önem sırası: (1) eğitim kişiselleştirme özellikleri, (2) UI/UX ve üretilen içeriğin
(soru, not, deneme) görsel kalitesi. Hukuk/KVKK/sözleşme şimdilik yok; kural makinesi kaldırılır.

Çekirdek görevler: (1) soru + çözüm fotoğrafı → eksik ve hata nedeni teşhisi, kayıt, zamanla öğrenme;
(2) deneme analizi (fotoğraf yükleme veya uygulama içinde çözme; "nereye kadar geldim" ile adım adım teşhis →
kazanım/alt kazanım); (3) veli 7/24 sohbet + proaktif bilgilendirme + istenen her rapor; (4) ders videosu/
transkripti → öğrenciyi ve dersi öğrenme; (5) kişiye özel not ve deneme üretimi; (6) çıkmış sorulardan soru
tahmini + tarz kütüphanesi; (7, ertelendi) akademik araştırma/tez araçları.

Kurucunun netleştirdiği kararlar: **Next.js web + PWA önce, sonra Capacitor ile mağaza. Müfredat dinamik:**
öğrenci dersini söyler, sistem (web araştırması + yüklenen kaynaklar) kazanım ağacını kendisi kurar ve kanıtla
yeniler; eğitmen de kendi müfredatını "craft" edebilir. **Telegram ve eski panel bırakılır;** öğrenci, veli,
eğitmen tek uygulamada.

---

## 0. Üç belirleyici karar

1. **Hibrit öğrenci modeli (dossier):** hesaplanabilen şeyler tablolarda (ustalık/BKT, kavram yanılgıları, hata
   nedeni, tarz kapsama) + yalnız düzyazının tutabildiği şeyler **Claude hafıza aracı** dosyalarında
   (`/memories/profile.md`, `patterns.md`, …) + ham kanıt (yüklemeler, transkriptler) embedding ile geri çağrılır.
   Tek bir "dossier derleyici" üçünü önbellek-dostu bir prompt'a çevirir.
2. **Dinamik müfredat:** her ders için Claude'un taslakladığı, eğitmenin düzenleyebildiği, kanıtla incelen
   versiyonlu `skills` ağacı. Mevcut TYT-Mat içeriği 1 numaralı tohum.
3. **HTML-önce içerik:** not, deneme, rapor = tipli belge AST'si → React + KaTeX + SVG → uygulama içi görüntüleyici
   ve Chromium (Playwright) ile PDF. LaTeX/Tectonic emekli.

Ayrıca: Managed Agents yerine **kendi döngümüz** (Messages API + memory tool): Batch indirimi, RLS-kapsamlı
araçlar, oturum başı konteyner maliyeti yok.

---

## 1. Mevcut koddan ne kullanılır, ne atılır

**Kullanılır:** Supabase çekirdeği — `curricula`, `skills` (herhangi derinlik + BKT parametreleri),
`skill_prerequisites`, `misconception_tags`, `enrollments`; kanıt zinciri `observations → mastery/
mastery_history`, `misconceptions(+evidence)`, `preferences`; `questions` (çeldiriciler yanılgı etiketli),
`secure.answer_keys`, `question_templates`, `attempts`, `content_pool`, `figures`; `memory_facts`,
`weekly_summaries`; `llm_calls/spend_ledger/runtime_flags`; `lessons/lesson_analyses/lesson_claims`;
`courses/syllabus_topics/exam_sources/exam_items/exam_priority_plans`; `library_*`; pgvector, pg_cron, Storage.
BKT (`packages/mastery-math`, `apply_observation()`) olduğu gibi. Sözleşmeler (`packages/contracts`) zod'a taşınır.
Python servisleri: `pipelines/tablet/verify.py` (SymPy), `sandbox.py` (yalnız dev yedeği), `pipelines/kalem`
kümeleme mantığı, `pipelines/ders` (ffmpeg + Groq STT adaptörü). Tasarım tokenları (`tokens.json`), maskot,
logolar, 19 bileşenin README/preview spesifikasyonları. `scripts/check-all.sh`, Makefile, CI, `packages/pii`
(sade ad hash'leme; zorunlu kapılar kalkar).

**Atılır:** `apps/worker` (Telegram), `apps/panel`, onay/hukuk/saklama/kota tabloları ve RPC'leri, yasak kelime
doğrulayıcıları, "kayıt yoksa cevap yok", Sokratik zorunluluğu, pilot kapısı, Gemini/Groq-chat/CF-AI/OpenRouter
sağlayıcıları, free-only zincirleri, `diagnostic_tests/sessions` (→ `exams.kind='diagnostic'`), `pipelines/kitap`
(ertelendi), `kulaklik_batch` (Node işi olarak yeniden yazılır), Gemini şema kopyaları. `docs/hukuk` dokunulmaz.
Üretim verisi olmadığı için **0001–0019 temiz bir v2 taban göçüne katlanır.**

**Sıfırdan:** öğrenci/veli hesapları, öğrenci ve veli arayüzü, çözüm-adımı teşhisi, deneme analizi, veli ajanı,
not/deneme üretimi, tarz kütüphanesi, dinamik müfredat kurucu, hafıza aracı deposu.

---

## 2. Ürün: kişiler, dossier, akışlar

**Kişiler:** Öğrenci (lise/YKS veya üniversite) · Veli (davet bağlantısı → `guardian_links`) · Eğitmen/kurucu-admin
(easy personeli; admin küresel yetki).

**Dossier (her model çağrısının okuduğu tek nesne, elle değil derlenir):**
kimlik (ad, sınıf, hedef sınav/tarih) · yapısal (yaprak başına ustalık p + kanıt sayısı + 14g trend; açık yanılgılar;
son 30g hata-nedeni histogramı: kavram/işlem/dikkatsizlik/okuma/süre; tarz kapsama boşlukları; son 10 teşhis,
son 3 deneme, son ders iddiaları) · anlatı (hafıza dosyaları) · kanıt dizini (yükleme/transkript başlıkları).

**Akış 1 — Sor:** kamera FAB → soru + (isteğe bağlı) çözüm fotoğrafı (≤4, istemcide 2576px'e küçültülür) →
"Okuyorum…" akışı, düzenlenebilir transkripsiyon + ders/konu çipleri → Opus 5.5 `solution-diagnosis`: soruyu
bağımsız çözer, öğrencinin adımlarını hizalar, **ilk bozulan adımı**, hata nedenini, yaprak kazanım(lar)ı ve
yanılgı etiketini bulur; uygun yaprak yoksa alt kazanım önerir → UI: adım merdiveni (öğrenci vs beklenen, bozulan
adım vurgulu), tek cümle "neden", Koç düğmesi (ipucu / açıkla / çözümü göster — öğrenci seçer) → yazımlar:
`solution_analyses` → `apply_observation()` → BKT; `style_coverage`; Haiku "hafıza deltası" ile `patterns.md`;
Voyage embedding.

**Akış 2a — Deneme (yükleme):** kitapçık sayfaları + optik form + karalama + (varsa) cevap anahtarı →
arka plan işi: sayfa sınıflandırma → sayfa başına yapılandırılmış OCR → soru yeniden kurma → optik okuma →
anahtar eşleme (yüklenen / yayıncı anahtarı / **çıkarım**) → soru başına sonuç → sonuç ekranı (net, bölüm
çubukları, kazanım ısı haritası) → her yanlış/boş için "Nereye kadar geldim?" (fotoğraf/metin/"hiç başlayamadım"/
"süre yetmedi") → Akış 1 teşhisi deneme bağlamıyla → rapor (HTML+PDF) → dossier → veli bildirimi.

**Akış 2b — Deneme (uygulama içi):** üretilmiş/atanmış sınav → zamanlayıcı, ÖSYM benzeri tipografi, şık
dokunuşu, işaretleme, karalama tuvali, soru ızgarası → bitişte sunucu tarafında `secure.exam_answer_keys` ile
notlama → aynı sonuç ekranı; karalama tuvali otomatik "nereye kadar geldim" olur.

**Akış 3 — Veli:** çocuk durumu kartı → sohbet ("Bu hafta ne çalıştı?") → veli ajanı dossier/rapor araçlarıyla
yanıtlar (asla cevap anahtarı, asla ham koç sohbeti) → proaktif kartlar/push: deneme analiz edildi, haftalık özet,
5 gün sessizlik, belirgin ilerleme → "Rapor iste".

**Akış 4 — Ders:** eğitmen video/ses/transkript yükler → ses çıkarma → STT → konuşmacı etiketleme → dossier'e
karşı Claude analizi → iddialar → eşik üstü otomatik uygulanır (varsayılan 0.8), altı eğitmen incelemesi →
ders bilgisi `courses/<kod>.md` hafızasına + `syllabus_topics`.

**Akış 5 — Not / deneme üretimi:** "X konusunda not" / "40 soruluk TYT deneme" → kapsam/uzunluk/zorluk/
"hatalarımı dahil et" diyaloğu → üretim işi → uygulama içi HTML önizleme → "PDF indir" / "Çöz".

**Akış 6 — Soru tahmini:** eğitmen çıkmış sınavları yükler → sorular çıkarılır → tarzlar kümelenir → düzenlenebilir
tarz kütüphanesi → ders başına öncelik planı ("sıklık analizine göre") → öğrenci kendi tarz kapsamasını görür →
"Bu tarzda 5 soru üret".

---

## 3. Öğrenen model (dossier) — nasıl öğrenir

### 3.1 Üç katman ve bir yüklemenin güncelleme yolu (`apps/web/server/diagnosis/run.ts`)
1. `uploads` → Anthropic Files API (`anthropic_file_id` saklanır, tekrar kullanılır).
2. `client.messages.parse` (Opus 5.5) → `SolutionDiagnosis`.
3. Doğrulama: `skill_ids` müfredatta var mı (yoksa `proposed_subskill`), `error_cause` enum, `failing_step_no ≤ steps`.
4. Tek işlem: `solution_analyses` ekle; her skill için `apply_observation(kind='practice', value, misconception_tag,
   source_type='solution_analysis')`; `careless/time` için ağırlık 0.5 (dikkatsizlik ustalığı ezmesin); `style_coverage`.
5. `proposed_subskill` → `curriculum_proposals` (otopilot açıksa ve müfredat `ai_draft` ise otomatik kabul).
6. Haiku 5.5 `memory-delta` (≤3 `str_replace/insert`) aynı hafıza işleyicilerinden geçer.
7. Voyage embedding → `solution_analyses.embedding`.

### 3.2 Hafıza dosyaları (öğrenci başına, `memory_20250818`)
`packages/llm/src/memory/pgMemory.ts`: `view/create/str_replace/insert/delete/rename` → `memory_files`
(+`memory_file_versions`); yalnız `/memories/` altı, `..` yok, ≤12 dosya, dosya ≤8 KB.
`profile.md` (sınıf, hedef, açıklama tercihi, motivasyon) · `patterns.md` (tarihli tekrar eden hatalar: "3× eksi
dağıtırken işaret, 12/19/27 Eki") · `courses/<kod>.md` (ders durumu düzyazı; eğitmenin vurguları) ·
`coach_notes.md` (ne işe yaradı) · `goals.md` · `parent_summary.md` (yalnız gece işi yazar, ≤1.5 KB).
Öğrenci Profil → "Öğrenmen senin hakkında ne biliyor" ile okur, düzeltme ister.

### 3.3 Prompt derleme (önbellek dostu, tam 4 kesme noktası)
```
tools:     sabit liste (rota başına), ada göre sıralı
system[0]: ürün + persona + çıktı kuralları           cache 1h   (~2.5K, herkese aynı)
system[1]: ders bloğu: müfredat ağacı (kod·ad), yanılgı etiketleri, tarzlar   cache 1h (ders başına ortak)
system[2]: dossier bloğu (deterministik sıra, gün hassasiyeti)               cache 5dk (öğrenci başına)
messages:  geçmiş…, kullanıcı turu (görseller+metin), {role:"system", "Bugün 2026-11-02. Mod: ipucu."}
           + üst düzey cache_control (büyüyen kuyruk)
```
Dossier bloğu yalnız alt satırlar değişince yeniden kurulur (`student_dossier_cache` hash).

### 3.4 Sınırlılık
Sohbet: son 30 mesaj birebir, eskisi Haiku özeti (`conversations.summary`; Postgres'te tekrar oynatılabilir).
Hafıza: gece `memory-compact` (Sonnet, Batch) >6 KB dosyayı ≤4 KB'a yazar; `patterns.md` ≤12 örüntü.
Dossier: en zayıf 20 + en güçlü 10 yaprak, ≤8 açık yanılgı, ≤10 satır etkinlik. Kanıt: yalnız araçla çağrılır.

### 3.5 Dinamik müfredat
Ders adı + (isteğe bağlı) izlence/kitap/çıkmış sınav → `curriculum-draft` işi (Opus 5.5 high,
`web_search_20260209` + `web_fetch_20260209` max 8, dosyalar `document` bloğu) → **düz** şema (özyineleme yok):
`nodes[{code,parent_code,name,description,kind: unit|outcome|sub_outcome,exam_weight_hint,sources}]`,
`prerequisites[]`, `misconception_tags[]`, `confidence`, `notes_for_instructor` → doğrulama (tek kök, döngüsüz,
derinlik ≤4) → `curricula(status='draft', origin='ai_draft')` + `skills` + bağımlılıklar + etiketler; BKT
varsayılanları `kind`'a göre → eğitmen ağaç editörü (sürükle/yeniden adlandır/birleştir) → `active`; otopilot
açıksa öğrenci taslakta hemen başlar (**sınav parkurları TYT/AYT/LGS için açık, üniversite için kapalı**) →
incelme: `curriculum_proposals`; yapısal kabuller yeni versiyon (aynı `code`, ustalık metin kodlarıyla taşınır).
Aynı dersi seçen ikinci öğrenci mevcut aktif müfredata kaydolur.

---

## 4. Veri modeli (v2 göçleri `supabase/migrations/0020_v2_*.sql`, temiz taban)

**Yeni tablolar:** `profiles` (auth.users 1:1; role student|parent|instructor|admin) · `guardian_links` ·
`instructor_links` · `uploads` (kind photo|pdf|video|audio|transcript|document|canvas, storage_path,
`anthropic_file_id`, extracted_text, embedding) · `conversations` + `conversation_messages` (Anthropic içerik
blokları jsonb) · `solution_analyses` · `exams` (kind deneme|diagnostic|practice|published; `is_copyrighted`) ·
`exam_questions` · `secure.exam_answer_keys` (yalnız `grade_exam_session()` okur) · `exam_sessions` ·
`exam_responses` (outcome correct|wrong|blank|unfinished, `how_far_text`, `work_upload_ids`) ·
`generated_documents` (kind notes|mock_exam|report|question_set; `content` = belge AST'si; html/pdf yolları;
status queued→generating→rendered→review→published) · `question_styles` (+embedding, yıl isabetleri, sıklık/
güncellik skorları, `exemplar_item_ids` gizli) · `style_coverage` · `curriculum_proposals` · `memory_files` +
`memory_file_versions` · `notifications` + `notification_rules` + `push_subscriptions` · `prompt_versions` ·
`eval_cases`/`eval_runs` · `pgboss.*`.
**Genişletilenler:** `observations.error_cause`, `source_type` += solution_analysis|exam_response;
`curricula.origin/source_refs`; `enrollments.course_id/target_exam/exam_date/goal`; `llm_calls` += cache
okuma/yazma token, effort, route; `lessons` += upload_id, auto_apply_threshold, course_id; `exam_items` += format,
trick, difficulty.

**RLS tek cümle:** Öğrenci → `student_id = kendi`; kayıtlı derslerin müfredat/tarzları; oturumu olan sınavların
soruları; `secure.*` asla. Veli → aktif `guardian_links` çocukları; raporlar, skorlar, ustalık görünümü,
bildirimler; **koç sohbeti, sınav metinleri, ham yüklemeler yok.** Eğitmen → `instructor_links` öğrencileri; tam
okuma; yazımlar RPC ile. Admin → hepsi. Service role yalnız worker'da.

---

## 5. LLM görev haritası (hangi iş, hangi model)

Kurallar: temperature yok; Opus 5.5'te `thinking` gönderilmez, derinlik `output_config.effort`; Sonnet 5.5
"düşünme kapalı" = `thinking:{type:"between_tools"}` (effort ≤ high); Haiku 5.5 = `disabled` (effort ≤ high);
yapılandırılmış çağrılarda `max_tokens ≥ 4000`; Opus/Sonnet senkron çağrılarda `fallbacks:"default"` + beta
`server-side-fallback-2026-07-01`; her çağrı `packages/llm/src/gateway.ts` → `llm_calls`.

| Görev | Model · effort | Şema | Araçlar | Mod | ~Maliyet |
|---|---|---|---|---|---|
| Koç sohbeti | Sonnet 5.5 · medium | serbest + `record_turn_meta` | memory, search_evidence, get_mastery, get_recent_exams | akış | 0.01–0.02 $ |
| Koç "tam çöz/derin açıkla" (istek üzerine) | Opus 5.5 · high | aynı | aynı | akış | 0.06–0.10 $ |
| **Çözüm teşhisi** | **Opus 5.5 · high** | `solution-diagnosis` | görseller inline/file_id | senkron ≤25 s | 0.08–0.14 $ |
| Deneme sayfa sınıflama | Haiku 5.5 · low | `page-class` | – | paralel | 0.001 $/sayfa |
| Deneme OCR → soru | Sonnet 5.5 · medium | `exam-page-items` | – | paralel | 0.01 $/sayfa |
| Optik okuma | Sonnet 5.5 · medium | `answer-sheet` | – | senkron | 0.01 $ |
| Anahtar çıkarımı (anahtar yoksa) | Opus 5.5 · high | `inferred-keys` | code_execution | **Batch** | 0.03 $/soru |
| Deneme soru teşhisi | Opus 5.5 · high | `solution-diagnosis` | – | senkron/batch | 0.08 $ |
| Deneme raporu | Sonnet 5.5 · medium | `exam-report` (AST) | get_* | iş | 0.06 $ |
| **Müfredat taslağı** | **Opus 5.5 · high** | `curriculum-draft` | web_search, web_fetch, document | iş, akış | 0.6–1.5 $ |
| Öneri incelemesi | Sonnet 5.5 | `proposal-review` | – | gece Batch | 0.01 $ |
| **Not üretimi** | **Opus 5.5 · high** | `document-ast` | code_execution (figür) | iş | 0.35–0.60 $ |
| **Deneme üretimi (40 s)** | **Opus 5.5 · high** | `exam-generation` | code_execution | iş/Batch | 1.5–2.5 / 0.8–1.3 $ |
| SymPy doğrulama | Python (bizim) | `answer-key` | verify.py | iş | 0 |
| Figür vision kontrolü | Haiku 5.5 | `figure-render-report` | – | iş | 0.001 $ |
| Çıkmış soru çıkarımı | Sonnet 5.5 | `exam-item` v2 | – | Batch | 0.01 $/sayfa |
| Tarz adlandırma | Sonnet 5.5 | `style-definition` | – | Batch | 0.02 $ |
| Öncelik planı | Opus 5.5 · medium | `exam-priority-plan` | – | iş | 0.15 $ |
| Tarza özel soru üretimi | Opus 5.5 · high | `question-generation` | code_execution | senkron/Batch | 0.25 $/5 s |
| STT | **Groq Whisper large-v3-turbo** | segment | – | iş | 0.06 $/90 dk |
| Konuşmacı etiketleme | Sonnet 5.5 · low | `transcript` | – | iş | 0.05 $ |
| **Ders analizi** | **Opus 5.5 · high** | `lesson-analysis` v2 | 20–30 kare + transkript | iş | 0.5–0.9 $ |
| Veli sohbeti | Sonnet 5.5 · low | serbest | get_child_summary, get_reports, get_mastery_overview, request_report | akış | 0.006 $ |
| İstek üzerine rapor | Sonnet 5.5 | `report-ast` | get_* | iş | 0.05–0.10 $ |
| Gece dossier/hafıza sıkıştırma | Sonnet 5.5 | `memory-compaction` | – | **Batch** | 0.02 $/öğr |
| Hafıza deltası, sohbet özeti, bildirim metni | Haiku 5.5 · low | küçük şemalar | – | async | <0.001 $ |
| Embedding | **Voyage `voyage-3.5`** (1024) | – | – | iş | 0.06 $/M |
| Eval hakemi | Opus 5.5 · high | `eval-verdict` | – | Batch | 0.05 $/vaka |

**Opus 5.5 nerede değer:** teşhis eden (çözüm, deneme, ders), öğrencinin çalışacağı içeriği yazan (not, deneme,
soru) ve başkalarının bağlı olduğu yapıyı kuran (müfredat, plan) işler — buradaki hata dossier'i zehirler.
**Sonnet 5.5:** sohbet ve OCR (hızlı, Türkçe düzyazıda iyi). **Haiku 5.5:** şemalı, yargı gerektirmeyen işler.
Aktif öğrenci başına aylık ~12–18 $ (günlük koç, 2 deneme, 2 not, 1 üretilmiş deneme, 4 ders); önbellek sohbette
~%40, Batch gece/toplu işlerde %50 tasarruf.

---

## 6. Prompt mimarisi
Katmanlar: ürün (sabit; AI gizlenmez, ustalık iddiaları kanıt sayısıyla, Türkçe sayı biçimi, emoji/ünlem yok,
KaTeX `$…$`) → rol (koç / veli ajanı / eğitmen asistanı / üretici / analist) → ders → dossier → tur
(`role:"system"` mesajı: tarih, mod, sınav bağlamı).
Sürümleme: `packages/prompts/<rota>/<versiyon>.md` (front-matter: model, effort, şema, araçlar) → `prompt_versions`;
`llm_calls.prompt_version`. **Eval seti:** kurucunun vereceği ~60 gerçek çözüm fotoğrafı (bilinen bozulan adım +
neden), 3 deneme seti, 2 ders kaydı + 40 sentetik; `scripts/eval.ts` Batch ile koşar, Opus hakem puanlar;
aktivasyon kapısı: puan >3 düşerse yeni prompt açılmaz. Önbellek testi: ikinci istek `cache_read_input_tokens>0`.
**Koç personası:** sıcak, "sen", kısa, bir fikir bir balon. Modlar `ModeToggle`: **İpucu** (Sokratik) ·
**Açıkla** · **Çözümü göster**; varsayılan öğrencinin tercihi; koç mod değiştirmeyi önerebilir, kendisi çeviremez;
"Bunu hocana sorman daha iyi" diyebilir ve eğitmene not düşer.
Durdurma nedenleri: `refusal` → kibar mesaj + eğitmen yönlendirme + kategori logu; `max_tokens` → bir kez iki kat
ile yeniden; `parsed_output` null → bir onarım turu, sonra iş görünür biçimde başarısız (kısmi analiz asla
saklanmaz); 429/529 → pg-boss geri çekilme.

---

## 7. İçerik kalite hattı
**Belge AST'si (`document-ast`, özyinelemesiz):** heading, paragraph (satır içi matematik), math_display,
definition_box, summary_box, worked_example, **common_mistake_callout (kişisel: öğrencinin `patterns.md`
girdisini tarihiyle anar)**, check_yourself, figure (svg | görsel ref + alt), table, question (anahtar ayrı
`keys[]`'te; renderer öğrenciye göstermez), answer_sheet, answer_key_page, page_break.
**Render:** `packages/doc-render` (React) → KaTeX sunucu tarafı → uygulama içi görüntüleyici ve Playwright
`page.pdf` (A4, `@page`, iki sütun ÖSYM düzeni, dul/yetim CSS). Fontlar/tokenlar uygulamayla aynı.
**Figürler:** Claude aynı üretim çağrısında matplotlib/SVG kodu yazar, `code_execution_20260120` ile koşar
(konteyner iş başına yeniden kullanılır), çıktılar Files API ile indirilir; tasarım sabitleri (paper #f6f8fc,
navy #051c60, vurgu #0030a2) enjekte edilir. Basit geometri: doğrudan SVG. `sandbox.py` yalnız dev yedeği ve
parametrik şablonlar.
**Doğrulama merdiveni:** şema → SymPy anahtar → figür boş/boyut + Haiku vision → kopya hash → kişiselleştirme
kontrolü (her callout gerçek bir örüntüye referans) → isteğe bağlı eğitmen incelemesi (sınıfa dağıtılacak
deneme için açık, kişisel not için kapalı). Hata → yalnız o blok yeniden üretilir.
**Şablonlar:** Not = kapak ("Öğrenmen sana göre hazırladı"), kazanım hedefleri, gövde, "Senin sık yaptığın
hatalar", 5 kendini sına + cevap sayfası. Deneme = ÖSYM benzeri kapak, iki sütun, `FigureFrame`, optik form
sayfası, ayrı anahtar + kazanım haritası (eğitmen / bitişten sonra).

---

## 8. Deneme analizi hattı (`apps/worker/jobs/exam-analyse.ts`)
Alım (EXIF döndürme, sharp ile eğrilik düzeltme, ≤2576px) → sayfa sınıflama (kitapçık|optik|karalama|anahtar) →
sayfa başına OCR (6 paralel), devam eden soruları birleştirme, figür bbox kırpma → anahtar (yüklenen /
`published` sınav için eğitmenin bir kez girdiği ortak anahtar / **çıkarım**: Opus + code_execution, düşük güven
"anahtar doğrulanmadı" etiketi) → optik okuma (çift işaret → boş + not) → `grade_exam_session()` (SECURITY
DEFINER): sonuçlar, bölüm netleri, `observations(kind='test', guess_override=0.2)` → ustalık anında güncel →
yanlış/boşlar için teşhis dağıtımı (girdi yoksa uygulama içi soru: "hiç başlamadın mı, süre mi bitti?") →
`exam-report` AST → HTML/PDF → bildirim.
**Telif duruşu:** `is_copyrighted` sınavların `stem_text`'i yalnız eğitmen/sistem (RLS); öğrenci kendi
fotoğraf kırpıntısını görür; "Benzer soru üret" özgün varyant yazar.
Hedef: 40 sayfa → ≤4 dk sonuç; teşhisler sonra akar.

## 9. Ders videosu hattı
Uppy + Supabase TUS (≤5 GB, `lessons/` kovası) → Python servisi: `ffmpeg -vn -ac 1 -ar 16k`, sahne algılama
≤30 kare → **Groq Whisper large-v3-turbo** (adaptör var; Claude ses almaz; gerekirse ElevenLabs Scribe'a yol) →
Sonnet 10 dk pencerelerde ÖĞRENCİ/EĞİTMEN + ad temizliği → Opus `lesson-analysis` v2 (+`course_insights`) →
eşik ≥0.8 otomatik `observations(kind='lesson')`, altı inceleme → ders bilgisi hafızaya + `syllabus_topics`.
Ham video 90 gün (bayrak), ses STT sonrası silinir, transkript kalır. ~0.7–1.1 $/90 dk, 8–15 dk gecikme.

## 10. Veli deneyimi
Veli ajanı araçları (strict, salt okunur): `get_child_summary`, `get_mastery_overview` (bantlar: düşük/orta/yüksek +
kanıt sayısı), `get_recent_activity`, `get_exam_sessions`, `get_reports`, `request_report`. Dışlamalar RLS ile,
prompt'la değil. Ton: saygılı, alarm vermeyen, veliye somut adım ("Bu hafta ona şunu sorabilirsiniz…").
Proaktif kurallar (`notification_rules`, varsayılan açık): deneme analiz edildi, haftalık özet (Pazar 19:00),
5 gün sessizlik, ilerleme (yaprak 0.8'i ≥5 kanıtla geçti veya haftalık net +4), yanılgı çözüldü, eğitmen notu.
Kanallar: uygulama içi kart + web-push (VAPID) + isteğe bağlı e-posta (Resend). Raporlar: haftalık | deneme |
konu | trend | özel → `report-ast` → HTML/PDF; grafikler deterministik Recharts/SVG (dataviz skill palet kuralları).

## 11. Soru tahmini / tarz kütüphanesi (kalem v2)
Çıkmış sınavlar → `exam-item` v2 (format, trick, difficulty, skill_ids) → Voyage embedding → kümeleme (cosine +
aynı-kazanım bonusu; `cluster.py` SQL/Node'a taşınır) → Sonnet küme adlandırma → `question_styles` (eğitmen
yeniden adlandırır/birleştirir/ekler; öğrenciye telifli örnek metin gösterilmez, tanım gösterilir) →
`skor = 0.5·sıklık + 0.3·güncellik + 0.2·müfredat uyumu` → `exam_priority_plans` ("sıklık analizine göre öncelik")
→ tarza özel özgün soru üretimi (7. bölüm doğrulaması) → `style_coverage` (Konu haritası: "bu tarzı hiç çözmedin /
3 çözdün 1 doğru").

---

## 12. Mimari ve barındırma
```
apps/web            Next.js 15 App Router (React 19, Tailwind 4, token → CSS değişkeni), server actions + route handlers (akış), PWA
apps/worker         Node 22: pg-boss tüketici, Anthropic araç döngüleri, Playwright PDF, web-push, Voyage
pipelines/ders      Python 3.13 (ffmpeg, Groq STT) — worker'ın çağırdığı HTTP servisi
pipelines/verify    Python SymPy doğrulayıcı (tablet/verify.py'den) — HTTP servisi
packages/llm        Anthropic geçidi (rotalar, önbellek, defter, zod şemaları, hafıza işleyicileri)
packages/contracts  zod-önce şemalar; Python için JSON Schema dışa aktarımı
packages/doc-render React belge AST renderer (web önizleme + worker PDF ortak)
packages/design-system  tokens.json + TSX bileşenler
packages/mastery-math, packages/pii  (korunur)
supabase/           v2 göçleri, RLS, RPC'ler, pg_cron
```
- **Next.js: Vercel** (yerel akış/server actions, Node çalışma zamanı, PR önizlemeleri). Cloudflare/OpenNext
  reddedildi (Workers CPU/boyut sınırları, akış pürüzleri).
- **İşler: pg-boss (Supabase Postgres üzerinde) + Fly.io'da bir Node worker** (`worker`, `pdf` süreçleri);
  `pg_cron` yalnız zamanlanmış işleri kuyruğa atar. Inngest/Trigger.dev yok: satır yazımıyla aynı işlemde kuyruğa
  alma kanıt zinciri için şart. Python servisleri aynı Fly uygulamasında ayrı süreç grubu.
- Supabase Realtime ile iş ilerlemesi UI'a. Storage tüm ikililer; Anthropic Files API model-görünür kopyalar.
- **PWA:** `app/manifest.ts` + Serwist servis çalışanı (çevrimdışı kabuk, yükleme için arka plan senkronu),
  `<input capture>` + `getUserMedia` kamera sayfası, VAPID push, kurulum istemi. Sonra **Capacitor** aynı derlemeyi
  sarar (`platform/*` adaptörü arkasında kamera/push).
- Sırlar: Vercel env (web), Fly secrets (worker: `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `VOYAGE_API_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_*`, `RESEND_API_KEY`). `secret-scan.sh` kalır.
- Gözlemlenebilirlik: `llm_calls` + `spend_ledger` (+cache sütunları, rota); harcama tavanı → kuruluş başına yumuşak
  uyarı + öğrenci başına aylık yumuşak tavan (aşımda koç Haiku'ya iner, üretim işleri admin onayına girer); Sentry.

---

## 13. UI/UX planı
**Öğrenci (alt gezinme):** Koç · Sor (kamera FAB) · Denemeler · Notlarım · Konu haritası · Profil.
**Veli:** Özet · Sohbet · Raporlar · Bildirimler · Ayarlar.
**Eğitmen konsolu (kenar çubuğu):** Öğrenciler · Dersler · Müfredatlar (ağaç editörü, öneriler) · Soru tarzları ·
İçerik (belge incelemesi) · Sınavlar (anahtarlar, atamalar) · Kuyruk · Maliyet · Ayarlar.

**14 anahtar ekran:** 1 Onboarding (ders seçimi + "kendi dersimi ekle" → akan müfredat ağacı → hedefler) ·
2 Koç ana (günün planı 3 kart, seri, `TutorMessage` + `ModeToggle`, matematik render) · 3 Sor yakalama (kılavuz
çerçeve, çoklu çekim, kırp/döndür, "çözümüm de var") · 4 Teşhis sonucu (adım merdiveni, bozulan adım `danger`
+ ✕ + kelime, neden çipi, kazanım çipi, "Benzer soru") · 5 Deneme yükleme sihirbazı · 6 Sınav oynatıcı
(zamanlayıcı, `QuizOption`, bayrak, karalama tuvali, ızgara) · 7 Deneme sonucu (netler, kazanım ısı haritası,
"Nereye kadar geldim?") · 8 Konu haritası (`MasteryMeter` + kanıt sayısı, tarz noktaları, ön koşul ipuçları) ·
9 Notlarım (durum kartları, KaTeX görüntüleyici, PDF, "Çöz") · 10 Profil → Hafıza (6 dosya, düzeltme iste) ·
11 Veli Özet · 12 Eğitmen müfredat editörü (sürükle, öneri kutusu, versiyon farkı) · 13 Tarz kütüphanesi ·
14 Ders iddia incelemesi (zaman damgalı transkript, onayla/düzenle/reddet, eşik kaydırıcı).

**İlkeler:** kamera-önce, her yerde akış (token, ağaç düğümü, OCR'lanan soru), KaTeX, kanıt-nitelikli bantlar,
"Öğrenmen sana göre hazırladı" `ai` rozeti, AI iddialarında geri al/düzelt, koyu mod.
**Tasarım sistemi evrimi:** 19 bileşen gerçek TSX (`packages/design-system/src`), Tailwind 4 + `tokens.json`'dan
CSS değişkenleri (`tokens-to-css.mjs` yeniden kullanılır), README'ler spesifikasyon; yeni bileşenler
`CameraSheet, StepLadder, OutcomeHeatmap, TreeNode, DocumentViewer, ExamPlayer, Timer, AnswerGrid,
MemoryFileCard, ReportChart`; ikon seti **Lucide** (her zaman metin etiketiyle); maskot karşılama/boş durum/
avatar/PWA ikonu; hareket 150–300 ms; erişilebilirlik (focus-ring, 4.5:1, `lang="tr"`, KaTeX MathML, ≥44px).
**Önce mockup:** kodlamadan önce **Design artifact** tipinde (mevcut Design System artifact'ı temel) 14 ekran,
açık/koyu, mobil 390×844 (öğrenci/veli) + masaüstü 1440 (eğitmen). Kurucu onaylar; mockuplar Playwright görsel
testlerinin referansı olur.

---

## 14. İnşa planı (hangi işi hangi model kodlar)
Her faz: **Tur 1 inşa → Tur 2 bağımsız denetim (kabul ölçütleri, RLS, önbellek alanları, Türkçe metin) →
Tur 3 düzelt** (bu repodaki Workflow deseni; `scripts/check-all.sh` modül başına genişler; CI quick/heavy/db-live).
Kodlayan model: **Opus 5.5** mimari, veri modeli, prompt/şema, teşhis mantığı, karmaşık hatlar; **Sonnet 5.5**
UI bileşenleri, CRUD, testler, dokümantasyon; **Haiku 5.5** mekanik dönüşümler (zod↔JSON Schema, adaptör temizliği).
Skill/araç: `claude-api` (tüm SDK kodu), `artifact-design` + Design artifact (mockup), `dataviz` (grafik/rapor),
`pdf` (PDF çıktı), Playwright (görsel test), GitHub MCP (push); isteğe bağlı Canva (pazarlama görselleri),
ElevenLabs (ileride koç sesi).

| Faz | Modüller | Kodlayan | Bağımlılık | Kabul |
|---|---|---|---|---|
| **P0 Temel** | 14 ekran mockup; repo yeniden iskelet (`apps/web`, `apps/worker`, `packages/llm`, `packages/doc-render`); v2 göçleri + RLS + RPC; Supabase Auth 3 rol + davetler; `packages/llm` geçidi (rotalar, önbellek, defter, parse, akış, refusal, Batch); pg-boss iskeleti; token → Tailwind; 19 bileşen TSX | Opus (veri modeli, geçit, RLS) · Sonnet (bileşenler, auth UI) · Haiku (şema dönüşümleri) | – | 3 rol giriş; RLS matris testleri; geçit testi `cache_read_input_tokens>0`; bileşenler mockup'a uyar |
| **P1 Öğrenci çekirdeği** | Ders seçimi + müfredat taslağı işi + eğitmen ağaç editörü; dossier derleyici + hafıza işleyicileri; Koç sohbeti (akış, modlar, araçlar); Sor (yakalama → teşhis → observations); Konu haritası | Opus (dossier, teşhis prompt+şema, müfredat) · Sonnet (sohbet UI, ağaç, kamera) | P0 | 20 gerçek yüklemede bozulan adım uyumu ≥%80; BKT değişimi görünür; hafıza güncel; 2. turda önbellek ≥%60 |
| **P2 Deneme** | Yükleme sihirbazı; sınıflama/OCR/anahtar/notlama hattı; sınav oynatıcı; sonuç ekranı; "nereye kadar geldim"; deneme raporu | Opus (hat, notlama RPC, anahtar çıkarımı) · Sonnet (oynatıcı, sihirbaz, sonuç) | P1 | 3 gerçek deneme → net ±1; uygulama içi sınav uçtan uca; rapor PDF |
| **P3 İçerik stüdyosu** | Belge AST + renderer + Playwright PDF; not üretimi; deneme üretimi (code_execution figürler); doğrulama merdiveni; Notlarım | Opus (üretim promptları, AST, doğrulama) · Sonnet (renderer, görüntüleyici, PDF CSS) | P1 | eğitmen incelemeli 10 not + 3 deneme; doğrulanmamış anahtar 0; tipografi kontrol listesi |
| **P4 Tarz & tahmin** | Çıkmış sınav alımı v2, kümeleme, tarz kütüphanesi UI, öncelik planı, tarza özel üretim, kapsama | Opus (çıkarım şeması, skor) · Sonnet (UI, SQL) | P3 | 2 ders ≥5 yıl sınav → adlandırılmış tarzlar, kanıtlı plan, kapsama görünür |
| **P5 Dersler** | Resumable yükleme; ffmpeg/STT/etiketleme servisi; analiz v2; iddia incelemesi; otomatik eşik; ders hafızası | Opus (analiz v2, uygulama) · Sonnet (yükleme/inceleme UI) · Haiku (Python temizliği) | P1 | 2 gerçek kayıt <15 dk; kurucu iddia doğruluğunu onaylar; ≤1.2 $/ders |
| **P6 Veli & bildirim** | Veli onboarding/bağlar; veli ajanı + araçlar; kural motoru; web-push; e-posta; raporlar | Opus (ajan araçları/RLS) · Sonnet (UI, push, rapor) | P2 | veli koç sohbetini okuyamaz (RLS testi); iOS/Android PWA push; haftalık rapor |
| **P7 Eğitmen konsolu, eval, sertleştirme** | Kuyruk, Maliyet, bayraklar; eval harness + 100 vaka; prompt sürüm UI; PWA cilası (çevrimdışı, kurulum); Capacitor iskeleti; maliyet gözden geçirme | Opus (eval, maliyet) · Sonnet (konsol, PWA) · Haiku (dokümantasyon) | P1–P6 | eval taban çizgisi; Lighthouse PWA ≥90; öğrenci başı maliyet raporu; `make check` yeşil |

Her faz kullanılabilir bir şey teslim eder: P0 giriş + mockup; P1 kullanılabilir koç; P2 deneme ürünü; P3 içerik…

---

## 15. Riskler ve açık kararlar
**Riskler:** telefon fotoğrafında Türkçe el yazısı matematik OCR (kılavuz çerçeve, çoklu çekim, düzenlenebilir
transkripsiyon, 1. günden eval seti) · web izi zayıf üniversite derslerinde müfredat kalitesi (izlence yükleme,
eğitmen düzenlemesi, UNI'de otopilot kapalı) · Opus teşhis gecikmesi 10–25 s (aşama akışı, önceden derlenmiş
dossier) · önbellek regresyonu sessizdir (entegrasyon testi + rota başına pano zorunlu) · yüklemeden prompt
enjeksiyonu (hafıza yazımları yalnız model-op + yol allow-list; operatör bağlamı `role:"system"`) · telif
(yeniden dizgi yok, varyant var) · beta yüzeyler (SDK sürümü sabitlenir, tek dosyada sarılır).
**Öneriler (karşı çıkılmazsa uygulanır):** kendi döngümüz (Managed Agents değil) · Voyage `voyage-3.5` · Groq
Whisper · Resend · otopilot sınav parkurlarında açık, üniversitede kapalı.

**Kurucudan gerekenler (sırayla, gerektiğinde):** Anthropic API anahtarı (kredili Console kuruluşu, bütçe
uyarısı) → Vercel + Fly sırlarına; Supabase projesi (Pro) + DB şifresi, `vector` ve `pg_cron` açık; Vercel hesabı +
alan adı; Fly.io hesabı (ya da Railway onayı); Groq, Voyage, Resend anahtarları (VAPID biz üretiriz); sonra Apple/
Google geliştirici hesapları; **eval malzemesi:** ~60 fotoğraflı öğrenci çözümü + kurucunun kendi teşhisi, 3 tam
deneme fotoğraf seti + anahtarlar, 2 ders kaydı, 2 üniversite çıkmış sınav arşivi, eğitmen listesi + dersleri.
P0 bu girdilerin hiçbirini beklemez (yerel Postgres + fake LLM ile başlar); P1 ilk gerçek Claude anahtarını ister.

---

## 16. Doğrulama (uçtan uca nasıl test edilir)
- Her fazda `make check` (quick + db-live) yeşil; yeni modüller `scripts/check-all.sh`'a kabul komutlarıyla eklenir.
- RLS matrisi: `supabase/tests` v2 (öğrenci/veli/eğitmen/admin × tablo) — veli koç sohbetini okuyamaz, öğrenci
  `secure.*` göremez.
- `packages/llm` entegrasyon testi (gerçek anahtarla, küçük): ikinci istekte `cache_read_input_tokens>0`;
  `messages.parse` şema uyumu; refusal/max_tokens yolları fake ile.
- Playwright: 14 ekranın mockup'a görsel karşılaştırması; Sor → teşhis → Konu haritası güncellemesi akışı;
  sınav oynatıcı uçtan uca; PDF üretimi (A4 sayfa sayısı, font gömme).
- Eval: `scripts/eval.ts` ile 100 vaka; bozulan adım/neden/kazanım uyumu ve Türkçe ton rubriği raporlanır.
- Gerçek veri kabulü: kurucunun 20 çözüm fotoğrafı (P1), 3 deneme seti (P2), 2 ders kaydı (P5) ile birlikte gözden geçirme.

## Kritik dosyalar
- `supabase/migrations/0004_curriculum.sql`, `0005_gozluk.sql`, `0011_mastery.sql` — dinamik müfredat ve kanıt
  zincirinin üzerine kurulduğu tasarım; her yeni yazım yolu `apply_observation()`'ı besler.
- `packages/contracts/schemas/{question-item,lesson-analysis,exam-item,exam-priority-plan}.schema.json` — zod'a
  taşınacak ve genişletilecek sözleşmeler.
- `pipelines/tablet/src/ogrenmen_tablet/verify.py` — SymPy doğrulayıcı (servis olur); `sandbox.py` dev yedeği.
- `packages/design-system/tokens.json`, `README.md` — TSX bileşenleri, belge şablonları ve koç personasını sürer.
- `pipelines/common/src/ogrenmen_common/adapters/groq.py`, `pipelines/ders/*` — STT ve ders hattı tohumu.
