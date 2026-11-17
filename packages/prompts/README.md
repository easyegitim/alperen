# @ogrenmen/prompts — sürümlü prompt paketi

Geçidin (`packages/llm`) her rotasına giden sistem metni buradan gelir (docs/PLAN-v2.md §6). Bir prompt üç katmanın
birleşimidir: **ürün** (Öğrenmen nedir, dürüstlük ve kanıt, gizlilik, Türkçe biçim, sadelik) + **rol** (koç, veli
asistanı, analist, içerik yazarı, müfredat yazarı) + **rota** (görevin kendisi). Birleşik metin geçitte `system[0]`
olur ve 1 saat önbelleklenir; ders bloğu `system[1]`, dossier `system[2]`, tarih/mod/sınav ise sondaki
`role:"system"` mesajıdır (packages/llm `prompt.ts`). Bu yüzden prompt metninde tarih ya da kullanıcıya özgü bilgi yoktur.

## Kullanım

```ts
import { loadPrompt } from '@ogrenmen/prompts';

const p = loadPrompt('solution_diagnosis');            // { meta, text, hash, estimatedTokens, parts, selection }
const res = await gateway.call('solution_diagnosis', {
  system: { product: p.text, course, dossier },
  user, turn: { date, mode },
  promptVersion: p.meta.version,                        // llm_calls.prompt_version
});
```

Worker (service_role) sürüm kaynaklarını veritabanından okur:

```ts
import { createPromptResolver, syncPromptVersions } from '@ogrenmen/prompts/db';

const prompts = createPromptResolver(pool, { ttlMs: 60_000 });  // runtime_flags + prompt_versions, kısa önbellek
const p = await prompts.load('coach_chat');
await syncPromptVersions(pool);   // açılışta: paketteki her rota × sürüm → prompt_versions (active=false)
```

| işlev | ne yapar |
|---|---|
| `loadPrompt(route, { version?, sources? })` | sürümü seçer, katmanları birleştirir; `selection` hangi kaynağın seçtiğini söyler |
| `listPromptRoutes()`, `listPromptVersions(route)`, `allPrompts()` | rota ve sürüm listeleri |
| `parseFrontMatter(src)` | front-matter ayrıştırıcı (küçük, deterministik YAML alt kümesi) |
| `selectVersion(route, available, opts)` | saf sürüm seçimi |
| `lintPromptText(text, { toolNames })` | yazım kuralları (aşağıda) |
| `db`: `readVersionSources`, `syncPromptVersions`, `createPromptResolver` | `pg.Pool` uyumlu arayüzle veritabanı köprüsü |
| `eval`: `loadEvalCases`, `runEval`, `scoreDiagnosis`, `scoreCoach` | eval seti ve puanlayıcılar |

**Sürüm seçimi** (öncelik sırasıyla): açık `version` → `runtime_flags['prompt_versions']` (`{"coach_chat":"v1"}`;
admin sabitler ya da geri alır) → `prompt_versions.active` satırı (eval kapısını geçen) → kilitteki rota varsayılanı
(`prompts.lock.json` defaults) → paketteki en yüksek sürüm.
Veritabanının istediği sürüm bu derlemede yoksa çağrı düşmez, sıradaki kaynağa geçilir ve `selection.ignored`'a
yazılır. `runtime_flags` ve `prompt_versions` yalnız admin/service_role okur; apps/web pg kipinde `createPromptResolver`
ile (sunucu havuzu) çözer, bellek kipinde kaynak vermeden çağırır (kilit varsayılanı).

## Rotalar

| rota | sürüm | rol | model · effort | şema | araçlar |
|---|---|---|---|---|---|
| `coach_chat` | v1 | coach | Sonnet · medium | — | get_mastery, get_recent_exams, memory, record_turn_meta, search_evidence |
| `coach_deep` | v1 (`extends: coach_chat/v1`) | coach | Opus · high | — | aynı |
| `solution_diagnosis` | v2 (`extends: solution_diagnosis/v1`; v1 + deneme bağlamı `<exam_context>`) | analyst | Opus · high | solution-diagnosis | — |
| `page_class` | v1 | analyst | Haiku · low | page-class | — |
| `exam_page_items` | v1 | analyst | Sonnet · medium | exam-page-items | — |
| `answer_sheet` | v1 | analyst | Sonnet · medium | answer-sheet | — |
| `inferred_keys` | v1 | analyst | Opus · high | inferred-keys | code_execution |
| `exam_report` | v1 | generator | Sonnet · medium | exam-report | get_mastery, get_recent_exams |
| `curriculum_research` | v1 | curriculum_author | Opus · high | — | web_fetch, web_search |
| `curriculum_draft` | v1 | curriculum_author | Opus · high | curriculum-draft | — |
| `memory_delta` | v1 | analyst | Haiku · low | memory-delta | — |
| `conversation_summary` | v1 | analyst | Haiku · low | conversation-summary | — |
| `suggestions_copy` | v1 | generator | Haiku · low | notification-copy | — |
| `parent_chat` | v2 (varsayılan; v1 iskelet) | parent_agent | Sonnet · low (between_tools) | — | get_child_summary, get_exam_sessions, get_mastery_overview, get_recent_activity, get_reports, request_report |
| `report` | v1 | generator | Sonnet · medium | report-ast | get_mastery, get_recent_exams |
| `notification_copy` | v1 | generator | Haiku · low | notification-copy | — |
| `notes_generation` | v1 | generator | Opus · high | document-ast | code_execution |
| `exam_generation` | v1 | generator | Opus · high | exam-generation | code_execution |
| `figure_check` | v1 | analyst | Haiku · low | figure-render-report | — |
| `personalization_check` | v1 | analyst | Haiku · low | personalization-check | — |
| `exam_item_extract` | v1 | analyst | Sonnet · medium | exam-item | — |
| `style_definition` | v1 | analyst | Sonnet · medium | style-definition | — |
| `style_question_gen` | v1 | generator | Opus · high | style-question-generation | code_execution |
| `speaker_label` | v1 | analyst | Sonnet · low | transcript | — |
| `lesson_analysis` | v1 | analyst | Opus · high | lesson-analysis | — |

Deneme rotalarının kullanıcı turu metinleri `src/exam-input.ts`'teki kurucularla yazılır (prompt gövdeleri bu biçimi
anlatır): `pageClassUserText`, `examPageItemsUserText`, `answerSheetUserText`, `inferredKeysUserText`,
`examReportUserText` (`<exam_result>` JSON), `examContextText` (`<exam_context>`; teşhis v2). Her sayfa metni
`Yükleme sırası: sayfa N/T.` satırıyla başlar; sahte taşıma (OGRENMEN_LLM=fake) packages/llm/fixtures'taki eşlemeli
fikstürü bu satırdan (`uploadOrderMatch`) ve teşhiste `examContextMatch(no)` ile seçer. Kullanıcı verisi (deneme adı)
etiket ve satır sonu temizlenerek yazılır; veri bloğu kapatılamaz. Görsel isteyen üç prompt (sayfa, kitapçık, optik)
görsel okunamıyorsa `unreadable: true` yazmayı ve tahmin etmemeyi söyler.

İçerik stüdyosu (P3) kullanıcı turları `src/content-input.ts`'tedir: `notesGenerationUserText` (`<note_request>` JSON:
konu, hedef kazanımlar, sayfa, `self_check_count` (5), `include_mistakes`, `personalized` + `<patterns>`: öğrencinin
gerçek örüntüleri {source: patterns.md | misconception | analysis, id, dates, skill_code, summary, count, example};
kişiselleştirme = hatalar dahil ve en az bir örüntü; öğrenci isteği `<student_request>`), `examGenerationUserText`
(`<exam_request>`: blueprint (bölüm sayıları + zorluk bantları, toplam ≤ 40), `section_skills`, şık sayısı, süre, tarzlar;
`include_mistakes` ise `<patterns>`), `personalizationCheckUserText` (`<patterns>` + `<callouts>`), `figureCheckUserText`
(`<figure_context>`: bağlam, alt, `expected` değerler, `hidden` = cevabı ele veren değerler; PNG'yi çağıran ekler).
Hata kutularının `pattern_ref`'i yalnız `<patterns>` listesindeki kimlik ve tarihlerdir; worker `calloutReferenceIssues`
(contracts) ile deterministik, `personalization_check` ile anlamca denetler.

**Figür başlığı** (`src/figure-style.ts`): `FIGURE_DESIGN` (paper #f6f8fc, navy #051c60, vurgu #0030a2, muted #7a86a8,
ızgara #d3dbea, Lexend, 6,4 inç = 640 px @100 dpi; modüller matplotlib/numpy/math; sympy yok: yerel üretici reddeder) ve `FIGURE_PREAMBLE` (Agg, rcParams,
`svg.fonttype: none` → yazı belgede Lexend ile dizilir, sabit `svg.hashsalt` + tarihsiz meta → aynı kod aynı SVG;
`save_figure(fig, n)` → `figure_<n>.svg`). Not ve deneme promptları başlığı birebir taşır (test); model kodu başlıksız
yazar, worker `figureScript(code)` ile başlığı önüne ekleyip `python3 -I` ile çalıştırır. Prompt iki figür kipinde de
aynıdır: kod çalıştırabiliyorsa (code_execution) kodu konteynerde dener, çalıştıramıyorsa yalnız yazar.

Tarz kütüphanesi (P4) kullanıcı turları `src/style-input.ts`'tedir: `archivePageUserText` (çıkmış sınav sayfası;
`exam_page_items` rotası + "Çıkmış sınav arşivi: 2024 final." satırı), `examItemExtractUserText` (`<exam_item>` JSON +
`Madde no: N.`), `styleDefinitionUserText` (`<clusters>`: küme kimliği, yıllar, kazanımlar, üyelerin yapısı ve metin başı),
`styleQuestionGenUserText` (`<style_request>`: tarz, kazanımlar, örneklerin YALNIZ yapısı, bankadaki kökler). Sahte
taşıma eşleme anahtarları `archiveMatch(yıl)`, `examItemMatch(no)`, `STYLE_CLUSTERS_MARK`, `STYLE_REQUEST_MARK`. Üç
promptun gövdesinde öngörü sözcüğü yoktur (tahmin, çıkacak, kesin; `test/style-input.test.ts`); tarz tanımı soru
metninden alıntı yapmaz, üretim çıkmış soruyu ve bankadaki kökleri yeniden yazmaz.

Ders hattı (P5) kullanıcı turları `src/lesson-input.ts`'tedir: `speakerLabelUserText` (`<lesson_transcript_window>`:
ders türü, pencere sırası, satır başına `[i] SS:DD:ss–SS:DD:ss | metin`; model her bölüm için yalnız konuşmacıyı ve ilk
üç sözcüğü yazar), `labelWindows` (600 sn pencereler), `lessonAnalysisUserText` (`<lesson_request>` JSON: ders,
anonim öğrenci, tür, süre, kare zamanları, açık yanılgılar, önceki onaylı sonraki adım + `<transcript>` satırları
`transcriptLines`; kareler mesajın başındaki görsellerdir), `lessonText` (alıntı denetimiyle aynı biçim), `hms` /
`hmsSeconds`. Metinler ad temizliğinden geçmiş gelir; burada yalnız veri bloğu kapatılamasın diye `<`/`>` değişir.
Sahte taşıma eşleme anahtarları `LESSON_WINDOW_MARK`, `LESSON_REQUEST_MARK`.

Veli hattı (P6) kullanıcı turları `src/parent-input.ts`'tedir: `reportUserText` (`<report_request>` JSON: tür weekly |
exam | topic | trend | custom, başlık, dönem, ders, tarih, izinli grafikler `charts` [{data_ref, chart_kind, about}] ve
veliye açık veri; custom'da velinin sorusu) ve `notificationCopyUserText` (`<notification>` JSON: tür, alıcı parent |
student, veri, şablon {title, body}). Veri ad, olasılık p, soru metni ve anahtar taşımaz; kullanıcı metni `<`/`>`
kaçışlanır. Sahte taşıma eşleme anahtarları `REPORT_REQUEST_MARK`, `NOTIFICATION_MARK`. `parent_chat/v2` yanıtı en çok
üç cümle ister (durum, dayanak, "Bu hafta ona şunu sorabilirsiniz…" adımı); koç sohbeti, soru metni ve anahtar yoktur.

Model, effort, şema ve araçlar geçidin rota tablosuyla (`packages/llm/src/routes.ts`) birebir aynı olmalıdır;
`test/routes.test.ts` denetler.
Müfredat iki adımdır, çünkü yapılandırılmış çıktı Citations ile birlikte verilemez: `curriculum_research` web'de
araştırıp atıflı not yazar, `curriculum_draft` bu notu araçsız `curriculum-draft` biçimine çevirir.

## Dosya yapısı

```
<rota>/<sürüm>.md            front-matter + Türkçe gövde (ör. coach_chat/v1.md)
src/layers/product.v1.md     ürün katmanı
src/layers/roles/<rol>.v1.md rol katmanları
src/bundle.gen.ts            ÜRETİLMİŞ: tüm .md kaynakları (çalışma anında dosya sistemi okunmaz; Next.js/worker paketlemesi)
prompts.lock.json            ÜRETİLMİŞ: rota@sürüm → sha256 + model/effort/şema/araçlar
eval/<rota>/*.json           eval vakaları; eval/_context/<ders>.course.md ders bloğu kesiti
scripts/build-bundle.ts      gömme + kilit + doğrulama (--check, --relock)
scripts/eval.ts              eval komutu
```

Front-matter alanları: `route` (dizin adı), `version` (dosya adı, `vN`), `model` (tam kimlik), `effort`, `schema`
(packages/contracts kayıt adı ya da `null`), `tools` (ada göre sıralı), `role`, `layers` (`[product.vN,
roles/<rol>.vN]`, sırası önemlidir), isteğe bağlı `extends` (`<rota>/vN`, tek düzey, aynı rol) ve `description`.
Katman sürümleri açıkça yazılır: `product.v2` eklemek eski rota sürümlerinin metnini değiştirmez.

**Yeni sürüm açma:** `coach_chat/v2.md` yaz (katmanı değiştiriyorsan `product.v2.md` gibi yeni katman dosyası) →
`bun run --cwd packages/prompts bundle` → eval → etkinleştirme. Yayımlanmış bir sürümün birleşik metni (katmanları
dahil) değişirse derleme kilit nedeniyle düşer: geçmiş `llm_calls.prompt_version` ve eval puanları o metne bağlıdır.
Henüz yayımlanmamış bir taslağı bilerek değiştiriyorsan `bun scripts/build-bundle.ts --relock`.

## Yazım kuralları

claude-api `shared/prompt-audit.md` ile uyumlu; `src/lint.ts` derlemede ve testte denetler:

- Kural düz cümleyle ve **nedeniyle** yazılır; BÜYÜK HARF baskı dili (MUST, ASLA, MUTLAKA…) yok. Güncel modeller
  sistem metnine çok duyarlıdır; bağırılan kural aşırı uygulanır.
- "Adım adım düşün" gibi iskeleler yok: derinlik rotanın `effort`'udur. Gerekçe çıktıya istenmez (teşhiste
  `reference_solution_steps` bir çözüm alanıdır, düşünce dökümü değil).
- Sıralı adım yalnız sıranın gerçekten önemli olduğu yerde (teşhiste önce bağımsız çözüm, sonra hizalama).
- Örnekler çeşitli ve "örnektir" diye etiketlidir (`Örnek…` ile başlayan satır `örnektir` demek zorunda).
- Sistem metni araçları **adıyla anmaz**; hangi bilgiye ne zaman bakılacağını anlatır. Araç sözleşmesi
  `packages/llm/src/tools.ts` açıklamalarındadır; böylece bir araç kapatılınca metinde boşta gönderme kalmaz.
- Ünlem ve emoji yok (matematik `$…$` dışında); her birleşik metin ≥ 512 token (önbellek eşiği; tahmin karakter/4,
  Türkçede alt sınır gibi davranır, canlı testte `count_tokens` ile ölçülür).

## Eval

`eval/notes_generation/` 2 vaka (`ng-01-rasyonel-kisisel`: iki gerçek örüntü, kişisel kutu; `ng-02-uslu-genel`: örüntü
yok, kişiselleştirilmemiş, kaynaksız genel uyarı). Puanlayıcı `scoreNotes`: kind/personalized, ilk blok level 1 başlık,
hedeflerde kazanım kodu, tanım kutusu ve çözümlü örnek, hata kutuları `<patterns>` kimlik+tarihine başvurur (genel notta
başvuru yok), kendini sına sayısı ve sırası, her soruda SymPy anahtarı, son blok cevap sayfası, koddan figür sayısı ve
figür kodu kuralları (`figureCodeIssues`: izinli modüller, dosya/çalıştırma/rastgele yok, `save_figure(fig, n)`; SVG'de
betik yok), ünlem/emoji. Gerçek kipte figür kipi `OGRENMEN_FIGURES` (varsayılan local: araçsız).
`eval/solution_diagnosis/` 5 sentetik vaka (Türkçe el yazısı transkripsiyonu metin olarak: kavram, dikkatsizlik,
okuma, doğru çözüm, süre), `eval/coach_chat/` 4 vaka (ipucu modunda cevap vermeme, mod önerisi, hocana sor, kayıt),
`eval/exam_page_items/` 2 görselli vaka (`input.images`: `fixtures/exams/synthetic/booklet-p{1,2}.png`, gerçek kipte
base64 görsel bloğu olarak gider; sayfa 1: şekil kutusu ve sonraki sayfaya devam, sayfa 2: numarasız başlayan devam).
Kitapçık puanlayıcısı: soru numaraları, devam bayrakları, şekilli sorular ve kutunun IoU ≥ 0,5'i, şık metinleri
(`normalizeMath` KaTeX yazım farklarını düzler), kökte geçmesi gereken parçalar, `unreadable`.
Her vaka girdi, beklenen alanlar ve `fake_reply` (sahte kip betiği) taşır. Puanlayıcı deterministiktir: teşhiste
verdict, ilk bozulan adım, neden, kazanım, yanılgı etiketi, alt kazanım önerisi, `why_tr` tek cümle ve ünlemsiz;
koçta yasak/gerekli ifadeler, soru sorma, cümle sayısı, yüzde ve ünlem yokluğu, tur kaydı (mod önerisi, eğitmene iletme).

```
OGRENMEN_LLM=fake bun run --cwd packages/prompts eval      # boru hattı + puanlayıcı (hepsi geçmeli; check.sh)
ANTHROPIC_API_KEY=… bun run --cwd packages/prompts eval    # aynı komut gerçek modelle (ücretli)
  --route solution_diagnosis   --version coach_chat=v2   --out rapor.json   --min-score 0.8
```

## Denetim

`bash packages/prompts/check.sh`: bundle:check (gömülü kaynak + kilit + lint + eşik), typecheck, eslint, vitest
(OGRENMEN_LLM=fake), eval (sahte). Canlı kipte (`OGRENMEN_LIVE=1`) geçici bir veritabanında migration DDL'iyle
`prompt_versions` eşitlemesi; anahtar varsa `count_tokens`.

## Açık işler

- `eval_judge` hakemi (Opus, Batch) için prompt ve `eval_runs` yazımı; aktivasyon kapısı (hakem puanı belirgin
  düşerse `prompt_versions.active` açılmaz). `scripts/eval.ts` şimdilik yalnız deterministik puan verir.
- Diğer rotaların promptları (veli bildirimi, `style_question_gen`, `question_generation` — worker'da
  geçici gömülü metin…) sonraki fazlarda. İçerik stüdyosu promptları (P3) gerçek modelle hiç koşmadı:
  `ANTHROPIC_API_KEY=… bun run eval --route notes_generation` (ve `OGRENMEN_FIGURES=code_execution` ile) ilk anahtarla
  denenmeli; `exam_generation`, `figure_check`, `personalization_check` için eval vakası henüz yok (sahte fikstürleri var). Deneme rotaları
  (P2) gerçek modelle hiç koşmadı: `ANTHROPIC_API_KEY=… bun run eval --route exam_page_items` ilk anahtarla denenmeli;
  `page_class`, `answer_sheet`, `inferred_keys`, `exam_report` için eval vakası henüz yok (sahte fikstürleri var).
- Gerçek çözüm fotoğraflarıyla eval seti (kurucunun ~60 fotoğrafı) geldiğinde `eval/solution_diagnosis` görselli
  vakalarla genişler; şu an girdi yalnız metin transkripsiyonudur.
