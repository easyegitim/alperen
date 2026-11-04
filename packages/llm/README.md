# @ogrenmen/llm — Anthropic geçidi

Tüm Claude çağrıları buradan geçer (docs/PLAN-v2.md §5-6, docs/PLAN-v2-detail.md §3). Tek giriş:
`gateway.call(route, input)`. Rota; modeli, effort'u, düşünme kipini, şemayı, araçları, önbellek politikasını ve
kipi (senkron / akış / Batch) belirler. Her API isteği `public.llm_calls` satırı yazar.

## Nasıl çağrılır

```ts
import { createGateway, PgLedger, PgStore, RpcLedger, RpcMemoryStore } from '@ogrenmen/llm';

// apps/worker (service_role pg havuzu)
const gateway = await createGateway({ ledger: new PgLedger(pool) }); // OGRENMEN_LLM=fake → sahte taşıma
// apps/web route handler: defter de hafıza da KULLANICININ JWT'li istemcisiyle (service_role yalnız worker'da;
// PLAN-v2 §4). Web yalnız WEB_LEDGER_ROUTES (coach_chat, coach_deep, parent_chat) çağırır; log_llm_call bunlara
// izin verir, student_ref'i oturumdan türetir, cost_usd'yi kısar.
const webGateway = await createGateway({ ledger: new RpcLedger(userSupabase) });
// Hafıza YAZIMI 0023'ten beri öğrenci JWT'siyle kapalıdır (OGR-AUTH-001): web'de hafıza aracı salt okunur açılır;
// kalıcı yazımlar worker'dadır (diagnosis.followup → memory_delta, memory.correction, gece memory.compact).
const memory = { store: new RpcMemoryStore(userSupabase), studentId, actor: 'coach', readOnly: true };

// Yapılandırılmış (Opus 5.5 · high · solution-diagnosis): res.data tipli ve doğrulanmış
const res = await gateway.call('solution_diagnosis', {
  system: { product, course, dossier },          // system[0] 1sa · system[1] 1sa · system[2] 5dk önbellek
  user: [{ type: 'image', source: { type: 'file', file_id } }, { type: 'text', text: 'Çözümüm' }],
  turn: { mode: 'hint' },                        // sona {role:"system","Bugün 2026-11-02. Mod: ipucu."}
  studentRef: 's_qk7m2rx4tn5a', promptVersion: 'v3', ref: { table: 'solution_analyses', id },
});

// Akışlı sohbet + araç döngüsü (çalıştırıcılar enjekte edilir)
const chat = await gateway.call('coach_chat', {
  system: { product, course, dossier }, history, user: 'Kesirlerde neredeyim?', turn: { mode: 'explain' },
  tools: { runners: { get_mastery, search_evidence, get_recent_exams, record_turn_meta },
           memory: { store: new PgStore(pool), studentId, actor: 'coach' } },
  onEvent: (e) => sse.send(e),                   // text | thinking | tool_use | tool_input | tool_result | restart
});
// chat.text, chat.transcript (kalıcılaştır), chat.refusal, chat.toolCalls, chat.costUsd, chat.ledgerIds

// Batch (gece işleri; 0.5× fiyat, fallbacks yok)
const { batch, meta } = await gateway.submitBatch('memory_compaction', items);
await gateway.pollBatch(batch.id);
const results = await gateway.collectBatch('memory_compaction', batch.id, meta);
```

Ret (`refusal.ts`): ileti kitleye göre (`parent_chat` → veli, "siz"; diğerleri → öğrenci, "sen"). İletiler not
bırakıldığını iddia etmez; `refusal.notify_instructor` true ise eğitmene `notifications` satırını çağıran yazar.
Sohbet rotasında ret: `chat.transcript` reddedilen (boş/yarım) içerikle değil, gösterilen kibar iletiyle
(`{role:'assistant', content:[{type:'text', text}]}`) kapanır; böylece bir sonraki turda geçmiş olarak geçerlidir.

Hatalar (`errors.ts`): `RefusalError` (yapılandırılmış rotada ret; sohbet rotaları `refusal` alanıyla döner),
`ParseError` (onarım turundan sonra da şemaya uymadı), `MaxTokensError` (iki kat yeniden denemeden sonra),
`ToolLoopError`, `RouteConfigError`, `StudentRefError` (OGR-LLM-008; `studentRef` yalnız `students.public_ref`,
API isteğinden ÖNCE denetlenir; `call` ve `submitBatch` ücretli istek göndermeden fırlatır). `classifyError(err)` →
`{status, retryable}` (429/529/zaman aşımı yeniden denenebilir; pg-boss geri çekilmesi buna göre).

Defter: gerçek taşımada `ledger` zorunludur (`createGateway` verilmezse `RouteConfigError`; `InMemoryLedger` yalnız
sahte taşımada varsayılan). Defter yazımı çağrıyı asla düşürmez: yazıcı hatası `OGR-LLM-009` ile günlüğe gider,
`collectBatch`'te geçersiz `meta.studentRef` satırı `student_ref = null`, `error_code = 'bad_student_ref'` ile yazılır
ve kalan sonuçlar korunur.

Batch `pause_turn`: sunucu aracı (code_execution) döngüsü Batch içinde duraklarsa sonuç `status: 'error'`,
`error: 'pause_turn'` döner (defterde `error_code = 'pause_turn'`). Batch'te sürdürme yoktur: bu öğeleri senkron
`gateway.call(route, { ...input, batchRetry: true })` ile yeniden gönder (yalnız Batch rotaları, ör. `inferred_keys`,
`batchRetry` ister); senkron yol `pause_turn`'ü sürdürür. `bad_output` / `max_tokens` / `error` öğeleri de aynı yolla
yeniden gönderilir; Batch içinde onarım turu yapılmaz.

## Rotalar

| rota | model · effort · düşünme | şema | araçlar | kip |
|---|---|---|---|---|
| coach_chat | Sonnet · medium | — | memory, search_evidence, get_mastery, get_recent_exams, record_turn_meta, request_document | akış |
| coach_deep | Opus · high | — | aynı | akış |

`request_document` (P3, Koç'tan not/deneme isteği) rota araç listesinde kalıcıdır; `coach_chat`/`coach_deep` v2 metni aracı anlatır. Sürüm v1'e geri alınırsa araç yine rotada kalır, v1 metni ise onu anlatmaz (kilit v1 araç listesini tutar). `test/routes.test.ts` yalnız varsayılan sürümün araç listesini rotayla eşitler; geri alma kararında bu boşluk elle göz önünde tutulur.
| solution_diagnosis | Opus · high | solution-diagnosis | — | senkron (+Batch) |
| page_class | Haiku · low · kapalı | page-class | — | senkron |
| exam_page_items | Sonnet · medium · kapalı | exam-page-items | — | senkron |
| answer_sheet | Sonnet · medium · kapalı | answer-sheet | — | senkron |
| inferred_keys | Opus · high | inferred-keys | code_execution | Batch (`batchRetry` ile senkron; sahte kipte ikisi de) |
| exam_report | Sonnet · medium | exam-report | get_mastery, get_recent_exams | akış |
| curriculum_research | Opus · high | — (serbest metin, atıflı) | web_search, web_fetch (≤8) | akış |
| curriculum_draft | Opus · high | curriculum-draft | — | akış |
| proposal_review | Sonnet · medium | proposal-review | — | Batch |
| notes_generation | Opus · high | document-ast | code_execution (yerel figür kipinde `disableTools`) | akış (+Batch); sahte kipte `fixtures/notes_generation/01-rasyonel.json` |
| exam_generation | Opus · high | exam-generation | code_execution (aynı) | akış (+Batch); sahte kipte `fixtures/exam_generation/01-tyt10.json` |
| figure_check | Haiku · low · kapalı | figure-render-report | — | senkron (PNG + `figureCheckUserText`) |
| personalization_check | Haiku · low · kapalı | personalization-check | — | senkron (`personalizationCheckUserText`) |
| exam_item_extract | Sonnet · medium · kapalı | exam-item | — | Batch |
| style_definition | Sonnet · medium | style-definition | — | Batch |
| priority_plan | Opus · medium | exam-priority-plan | — | akış |
| style_question_gen | Opus · high | style-question-generation | code_execution | senkron (+Batch) |
| question_generation | Opus · medium | exam-generation | — | senkron (practice.generate: şablon yetmezse; şekilsiz, tarzsız; sahte kipte `fixtures/question_generation/` 8 soru) |
| speaker_label | Sonnet · low · kapalı | transcript | — | akış |
| lesson_analysis | Opus · high | lesson-analysis | — | akış |
| parent_chat | Sonnet · low | — | get_child_summary, get_mastery_overview, get_recent_activity, get_exam_sessions, get_reports, request_report (strict) | akış |
| report | Sonnet · medium | report-ast | get_mastery, get_recent_exams | akış |
| memory_compaction | Sonnet · medium | memory-compaction | — | Batch |
| memory_delta / conversation_summary / notification_copy / suggestions_copy | Haiku · low · kapalı | memory-delta / conversation-summary / notification-copy / notification-copy | — | senkron |
| eval_judge | Opus · high | eval-verdict | — | Batch |

Kurallar (testlerle denetlenir): temperature/top_p/top_k ve zorlanmış `tool_choice` yok (ESLint de yasaklar);
Opus'ta `thinking` gönderilmez; Sonnet "kapalı" = `between_tools`, Haiku "kapalı" = `disabled` (effort ≤ high);
`fallbacks:"default"` + `server-side-fallback-2026-07-01` yalnız Opus/Sonnet senkron (Batch öğesinin `batchRetry` ile
senkron yeniden gönderimi dahil); yapılandırılmış rotada `maxTokens` üzerine yazımı da ≥ 4000 olmalı
(`RouteConfigError`); maliyet yanıtı veren modelle (`message.model`, yapışkan yedekte farklı olabilir) hesaplanır;
akışlı araçlı serbest metin rotalarında (koç, veli) ürün bloğunun sonuna `PROGRESS_NOTE` eklenir (Opus/Sonnet 5.5'te
araçlar arası uzun notlar `display:"omitted"` altında boş `thinking` bloğu olarak döner; Opus'ta `thinking`
gönderilmediğinden kısa ara cümle istenir); ≤4 `cache_control`, 1 saatlikler
önce; araçlar ada göre sıralı; tur bağlamı system bloklarına değil sona `role:"system"` mesajı olarak (üç modelde de;
Haiku 5.5 için belgeler çelişkili, API 400 `role 'system' is not supported` dönerse geçit bir kez kullanıcı turuna
`<system-reminder>` yedeğiyle yeniden dener ve o model için süreç boyunca yedeği kullanır).
Müfredat iki adımdır: yapılandırılmış çıktı Citations ile uyumsuzdur (400) ve web_search/web_fetch sonuçları atıflı
döner; `curriculum_research` araştırır (serbest metin), `curriculum_draft` araştırma notunu ve yüklenen kaynakları
araçsız `curriculum-draft` biçimine çevirir. `validateRoute` biçimli rota + web aracını, `buildRequest` biçimli rotada
`citations.enabled: true` document bloğunu reddeder.
Veli araçları `strict: true` (PLAN-v2 §10, salt okunur): şema strict alt kümesine indirgenir (`additionalProperties:
false`, sayısal sınırlar açıklamaya), zod istemci tarafında yine doğrular; strict araçlara `eager_input_streaming` eklenmez.
Yapılandırılmış çıktı `@ogrenmen/contracts` `outputFormat(contract)` ile gider (SDK `zodOutputFormat` enum/const
kısıtını düşürdüğü için), yanıt loose şemayla doğrulanır; geçersizse bir onarım turu, sonra `ParseError`.

## İçerik stüdyosu: code_execution, konteyner, dosyalar (P3)

Not ve deneme üretimi figürleri koddan çizer (PLAN-v2 §7): model figür bloğuna `figure_code` (matplotlib Python ya da
SVG metni) + `kind` yazar; başlık (tasarım sabitleri, `save_figure(fig, n)` → `figure_<n>.svg`) `@ogrenmen/prompts`
`FIGURE_PREAMBLE`'dadır. İki kip (worker `OGRENMEN_FIGURES`):

- `code_execution` (gerçek anahtar): araç `{type:'code_execution_20260120', name:'code_execution'}` gider; model kodu
  konteynerde çalıştırıp denetler. Yanıttaki `bash_code_execution_tool_result` blokları dosya kimliklerini taşır:
  `collectOutputFiles(res.transcript)` (pause_turn dahil bütün turlar) → `downloadFigureFiles(gateway.transport.files!, refs)`
  → `{ 'figure_1.svg': '<svg…' }`. Yalnız taban ad, yalnız `figure_<n>.svg`, dosya başına ≤ 2 MB; aynı ad birden çok
  üretildiyse sonuncusu. İndirilmeyen figür yerel üretime düşer.
- `local` (varsayılan; sahte kipte her zaman): `gateway.call(route, { …, disableTools: ['code_execution'] })` → araç ve
  `container` gönderilmez, prompt metni aynıdır (önbellek bozulmaz); worker aynı kodu `python3 -I` + başlıkla çalıştırır.

Konteyner yeniden kullanımı: `CallResult.container` son görülen konteyner kimliğidir; aynı iş içindeki sonraki çağrı
(ör. tek bloğun yeniden üretimi) `container` ile verir. Çağrı içinde araç döngüsü, `pause_turn` sürdürmesi ve onarım
turu yanıtın konteynerini kendiliğinden taşır. `container` yalnız code_execution gönderilen istekte gövdeye girer.
Sahte taşıma: istekte code_execution varsa yanıt `container_fake_N` (ya da verilen kimlik) taşır; betik yanıtı
`codeExecution: { files: [{ filename, content }] }` sunucu aracı + sonuç blokları üretir, dosyalar `fake.files` ile iner.

Doğrulama merdiveni (worker): şema → SymPy anahtar (`canonical_expr`) → figür (çalıştır/indir → boş/boyut →
`figure_check` Haiku, `hidden` = cevabı ele veren değerler) → kişiselleştirme (`calloutReferenceIssues` deterministik,
sonra `personalization_check` Haiku) → hata olan yalnız o blok yeniden üretilir. Yardımcılar `@ogrenmen/contracts`:
`documentFigureJobs`, `examFigureJobs`, `applyFigureRenders` (SVG yazar, kodu çıkarır; saklanan belge kodsuzdur),
`calloutReferenceIssues`.

## Ortam

| değişken | anlamı |
|---|---|
| `OGRENMEN_LLM=fake` | ağsız deterministik taşıma (`fake.ts`): betik yanıtları → eşlemeli fikstür (`{fake_match, output}`: istek metninde bütün parçalar geçerse; çok sayfalı deneme) → `packages/llm/fixtures/<rota>.json` ya da `packages/llm/fixtures/<rota>/` (v2 rota adları) → contracts `fixtures/<şema>/valid` → şemadan örnek; önbellek benzetimi. Sentetik deneme fikstürleri: `fixtures/README.md` |
| `OGRENMEN_LLM_FIXTURES` | sahte taşımanın rota fikstür dizini (varsayılan `packages/llm/fixtures`) |
| `ANTHROPIC_API_KEY` | gerçek taşıma (SDK ortamdan okur; koda yazılmaz) |
| `OGRENMEN_LIVE=1` | `check.sh` veritabanı entegrasyonunu (geçici veritabanı: PgStore, applyMemoryDelta, renderDossier, ders bloğu) ve anahtar varsa canlı testleri koşar: Haiku (ikinci çağrıda `cache_read_input_tokens > 0`; tur sistem mesajı ya da yedeği), müfredat (birleşik web_search + format isteği 400 beklenir; iki adım uçtan uca) |

Test yardımcısı (`@ogrenmen/llm/testing`, yalnız testler): `createTempDatabase()` yerel Postgres'te geçici v2
veritabanı kurar (00_local_stub → göçler → seed'ler ogrenmen_owner rolüyle → TYT müfredatı), `drop()` siler;
`seedStudents(pool)`. `test/*.db.test.ts` (`bun run test:db`, `OGRENMEN_LIVE=1`) ve apps/worker canlı testleri kullanır.

Modüller: `routes.ts` · `client.ts` (taşıma, beta başlıkları, `files`) · `files.ts` (code_execution çıktı dosyaları) · `prompt.ts` (blok kurucular, kesme noktası denetimi) ·
`parse.ts` · `stream.ts` · `batch.ts` · `pricing.ts` · `ledger.ts` (`PgLedger`, `RpcLedger`, `InMemoryLedger`) ·
`refusal.ts` · `tools.ts` (`betaZodTool`; çalıştırıcılar enjekte) · `memory/pgMemory.ts` · `dossier.ts` · `gateway.ts` · `fake.ts` ·
`errors.ts`.

## Dossier ve ders blokları (dossier.ts)

```ts
import { buildPromptSystem, CourseBlockCache, renderDossier, renderDossierText } from '@ogrenmen/llm';

// worker (service_role pg): system[0] ürün (packages/prompts), system[1] ders, system[2] dossier
const { system, dossier, course } = await buildPromptSystem(pool, { product: p.text, studentId, courseId,
  dossier: { maxAgeMs: 5 * 60_000 } });       // önbellek tazeyse RPC çağrılmaz
await gateway.call('coach_chat', { system, … });   // buildSystemBlocks → 1 sa · 1 sa · 5 dk kesme noktaları
```

- `renderDossier(db, studentId, courseId, { maxAgeMs?, write? })` → `{ text, hash, changed, fromCache, sourceHash,
  enrollmentId, curriculumId, studentRef }`: `public.render_dossier` (v2) → `renderDossierText` (saf, deterministik:
  açık sıralar, gün hassasiyeti, görünen ad yok, `hash` alanı metne girmez) → sha256(metin). Metin değişince
  `student_dossier_cache` yazılır; aynıysa metin ve hash'e dokunulmaz, satır bayatsa (maxAgeMs) yalnız `updated_at`
  ilerler (sonraki çağrılar ağır RPC'yi yeniden koşturmaz). OGR-DOS-001 (kayıt yok) → `DossierError`.
- Kullanıcı metni system'e girmez: öğrencinin serbest metni (`enrollments.goal`, `students.school`) dossier metnine
  yazılmaz; öğrencinin değiştirebildiği kısa etiketler alana özgü izin listesine uyarsa yazılır, uymazsa düşer:
  sınıf `gradeLabel` (`\d{1,2}` · `mezun` · `lisans-N`), hedef sınav `targetExamLabel` (TYT, AYT, LGS, KPSS, YKS, ALES,
  DGS, YDS, final), dönem `periodLabel` (`YKS 2027` biçimi ya da `2026 Güz/Bahar/Yaz`). Hedef koça hafızadan
  (`goals.md`) veri olarak gelir.
- Ders bloğunda (`courseTextTrust`) ders adı ve müfredat etiketi yalnız güvenliyse yazılır: onaylanmamış ai_draft
  müfredatın (`origin = 'ai_draft'` ve `status <> 'active'`) etiketi ve öğrencinin açtığı dersin
  (`courses.created_by` rolü student; onboarding serbest metni) adı düşer; yalnız ders kodu ve `kod@sürüm` kalır.
  Öğrencinin açtığı ders yayımlanmış müfredata bağlıysa ad yerine müfredat etiketi yazılır (0024 `course_title` kuralı).
- Sınırlar (PLAN-v2 §3.4, `DOSSIER_LIMITS`): en zayıf 20 + en güçlü 10 yaprak, ≤ 8 açık yanılgı, "Son etkinlik"
  ≤ 10 satır (teşhis, deneme, alıştırma, onaylı ders gözlemi; yeniden eskiye). v2 alanları: hafıza dosya yolları
  (içerik yok; içerik hafıza aracıyla okunur); aktif öneri sayısı yalnız gövdede varsa yazılır (0024 gövdesinde yok).
- `renderCourseBlock(db, courseId, { curriculumId?, cache? })`: müfredat ağacı `• kod · ad` (yaprak) / `▸ kod · ad`
  (üst düğüm; order_no sırası), ön koşullar, yanılgı etiketleri (etiket · kazanım · asıl sorun · açıklama), etkin
  tarzlar (sıklığa göre). Süreç içi `CourseBlockCache` (ders + müfredat anahtarı, 10 dk).
- apps/web kullanıcı JWT'siyle `render_dossier` RPC'sini çağırıp `renderDossierText` ile aynı metni üretebilir
  (`student_dossier_cache`'e yalnız service_role yazar).
- `estimateTokens` (karakter / 4, alt sınır): testler zengin dossier ve TYT ders bloğunun 512+ token olduğunu denetler.

## Hafıza (memory/pgMemory.ts)

- Yol izin listesi DB'deki `app.memory_path_ok` ile aynı: `/memories/` altında, en çok 2 alt dizin, parçalar
  `[A-Za-z0-9_-]`, uzantı `.md` | `.txt`; `..`, `//`, `%` yok. Dizin yolları yalnız `view`/`delete` için.
- Öğrenci başına ≤ 12 dosya, dosya ≤ 8 KB; her değişiklik sürüm satırı yazar.
- `/memories/parent_summary.md` veliye açıktır (RLS): yalnız gece işi (`actor: 'memory-compact'` ya da açık
  `allowParentSummary`) yazar, ≤ 1.5 KB (OGR-MEM-007). Koç sohbeti yazamaz; aksi halde sohbet içeriği veliye sızar.
  `PgStore` service_role ile çalıştığından RPC bu kuralı uygulamaz; depo da ayrıca `assertParentSummaryWrite` ile denetler.
  apps/web koçunun yazım yolu `coach_memory_write` bu dosyayı DB'de reddeder (OGR-MEM-007).
- `applyMemoryDelta(opts | handlers, ops)`: `memory_delta` (Haiku) çıktısını AYNI işleyicilerden geçirir (yol izin
  listesi, 8 KB, ≤ 12 dosya, parent_summary koruması, sürüm satırı; actor `memory-delta`). En çok 3 işlem; işlemler
  bağımsızdır (biri düşerse diğerleri denenir), sonuç işlem başına `{ ok, code }`; dosya yokken `insert_line: 0`
  dosyayı oluşturur. apps/worker `diagnosis.followup` kullanır.
- Yazım kimliği (0023): `upsert_memory_file`'ı yalnız güvenilir çağıran (service_role / doğrudan Postgres: worker),
  owner eğitmen ve admin çağırabilir; öğrenci ve veli JWT'siyle OGR-AUTH-001 (öğrenci düzeltmeyi
  `request_memory_correction` ile ister). apps/web koç sohbeti Postgres'e bağlanmaz: hafıza aracı yazımları öğrencinin
  JWT'siyle `coach_memory_write` (0028; aynı gövde `app.memory_apply`, actor `coach:<sohbet>`, sohbete bağlı sunucu
  jetonu `OGRENMEN_WEB_COACH_KEY`) üzerinden gider.
- Depolar: `PgStore` (service_role `pg`: apps/worker; hafıza yazımları bu yoldan) ve
  `RpcMemoryStore` (kullanıcı JWT'li supabase-js: okuma; yazım yalnız owner eğitmen / admin oturumunda, öğrenci ve
  veli JWT'si OGR-AUTH-001). İkisi de yazımı `public.upsert_memory_file(p_student, p_path, p_content, p_op, p_actor,
  p_new_path, p_expected_hash)` ile yapar; öğrenci kilidi, sınırlar ve sürümleme DB'de tek yoldadır. DB hataları
  (`OGR-MEM-0xx`) `MemoryError`'a çevrilir.
- Eşzamanlı yazıcılar (koç, `memory-delta`, gece sıkıştırması): `str_replace` / `insert` okunan içeriğin md5'ini
  (`memoryContentHash`) `p_expected_hash` olarak gönderir; DB öğrenci kilidi altında karşılaştırır, tutmazsa
  OGR-MEM-028 (`MEMORY_CONFLICT_CODE`). İşleyici güncel içeriği yeniden okuyup düzenlemeyi bir kez daha uygular;
  ikinci çakışma modele hata olarak döner. Hiçbir düzenleme sessizce ezilmez.

## Açık işler

- `exam_report` / `report` (yapılandırılmış, araçlı, akışlı): araçlar arası notlar boş `thinking` bloğu olarak
  dönebilir; ara metin biçimle çatışmasın diye `PROGRESS_NOTE` eklenmez. `display:"updates"` (beta
  `thinking-display-updates-2026-08-18`) Sonnet 5.5'te mümkün, ancak sunucu yedeğinin (Sonnet 5) bunu kabul edip
  etmediği belgelenmemiş; canlı test sonrası değerlendirilecek.
- Haiku 5.5 ortadaki sistem mesajı ve müfredat birleşik isteği canlı testte doğrulanmadı (anahtar yok); canlı test
  sonucu README ve rotalara işlenecek.
- Batch'te `role:"system"` 400'ü öğe hatası olarak döner (yedekle yeniden deneme yalnız senkron `call`'da).

Denetim: `bash packages/llm/check.sh` (typecheck + eslint + vitest; `OGRENMEN_LIVE=1` ile yerel Postgres entegrasyonu; canlı Anthropic testi anahtar yoksa SKIP).
