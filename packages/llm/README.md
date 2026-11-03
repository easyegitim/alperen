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
const memory = { store: new RpcMemoryStore(userSupabase), studentId, actor: 'coach' };

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
| coach_chat | Sonnet · medium | — | memory, search_evidence, get_mastery, get_recent_exams, record_turn_meta | akış |
| coach_deep | Opus · high | — | aynı | akış |
| solution_diagnosis | Opus · high | solution-diagnosis | — | senkron (+Batch) |
| page_class | Haiku · low · kapalı | page-class | — | senkron |
| exam_page_items | Sonnet · medium · kapalı | exam-page-items | — | senkron |
| answer_sheet | Sonnet · medium · kapalı | answer-sheet | — | senkron |
| inferred_keys | Opus · high | inferred-keys | code_execution | Batch |
| exam_report | Sonnet · medium | exam-report | get_mastery, get_recent_exams | akış |
| curriculum_research | Opus · high | — (serbest metin, atıflı) | web_search, web_fetch (≤8) | akış |
| curriculum_draft | Opus · high | curriculum-draft | — | akış |
| proposal_review | Sonnet · medium | proposal-review | — | Batch |
| notes_generation | Opus · high | document-ast | code_execution | akış (+Batch) |
| exam_generation | Opus · high | exam-generation | code_execution | akış (+Batch) |
| figure_check | Haiku · low · kapalı | figure-render-report | — | senkron |
| exam_item_extract | Sonnet · medium · kapalı | exam-item | — | Batch |
| style_definition | Sonnet · medium | style-definition | — | Batch |
| priority_plan | Opus · medium | exam-priority-plan | — | akış |
| style_question_gen | Opus · high | style-question-generation | code_execution | senkron (+Batch) |
| speaker_label | Sonnet · low · kapalı | transcript | — | akış |
| lesson_analysis | Opus · high | lesson-analysis | — | akış |
| parent_chat | Sonnet · low | — | get_child_summary, get_mastery_overview, get_recent_activity, get_exam_sessions, get_reports, request_report (strict) | akış |
| report | Sonnet · medium | report-ast | get_mastery, get_recent_exams | akış |
| memory_compaction | Sonnet · medium | memory-compaction | — | Batch |
| memory_delta / conversation_summary / notification_copy | Haiku · low · kapalı | memory-delta / conversation-summary / notification-copy | — | senkron |
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

## Ortam

| değişken | anlamı |
|---|---|
| `OGRENMEN_LLM=fake` | ağsız deterministik taşıma (`fake.ts`): betik yanıtları → `packages/llm/fixtures/<rota>.json` ya da `packages/llm/fixtures/<rota>/` (v2 rota adları) → contracts `fixtures/<şema>/valid` → şemadan örnek; önbellek benzetimi |
| `OGRENMEN_LLM_FIXTURES` | sahte taşımanın rota fikstür dizini (varsayılan `packages/llm/fixtures`) |
| `ANTHROPIC_API_KEY` | gerçek taşıma (SDK ortamdan okur; koda yazılmaz) |
| `OGRENMEN_LIVE=1` | `check.sh` canlı testleri koşar: Haiku (ikinci çağrıda `cache_read_input_tokens > 0`; tur sistem mesajı ya da yedeği), müfredat (birleşik web_search + format isteği 400 beklenir; iki adım uçtan uca) |

Modüller: `routes.ts` · `client.ts` (taşıma, beta başlıkları) · `prompt.ts` (blok kurucular, kesme noktası denetimi) ·
`parse.ts` · `stream.ts` · `batch.ts` · `pricing.ts` · `ledger.ts` (`PgLedger`, `RpcLedger`, `InMemoryLedger`) ·
`refusal.ts` · `tools.ts` (`betaZodTool`; çalıştırıcılar enjekte) · `memory/pgMemory.ts` · `gateway.ts` · `fake.ts` ·
`errors.ts`.

## Hafıza (memory/pgMemory.ts)

- Yol izin listesi DB'deki `app.memory_path_ok` ile aynı: `/memories/` altında, en çok 2 alt dizin, parçalar
  `[A-Za-z0-9_-]`, uzantı `.md` | `.txt`; `..`, `//`, `%` yok. Dizin yolları yalnız `view`/`delete` için.
- Öğrenci başına ≤ 12 dosya, dosya ≤ 8 KB; her değişiklik sürüm satırı yazar.
- `/memories/parent_summary.md` veliye açıktır (RLS): yalnız gece işi (`actor: 'memory-compact'` ya da açık
  `allowParentSummary`) yazar, ≤ 1.5 KB (OGR-MEM-007). Koç sohbeti yazamaz; aksi halde sohbet içeriği veliye sızar.
  `PgStore` service_role ile çalıştığından RPC bu kuralı uygulamaz; depo da ayrıca `assertParentSummaryWrite` ile denetler.
- Depolar: `PgStore` (apps/worker, `pg`) ve `RpcMemoryStore` (apps/web, supabase-js). İkisi de yazımı
  `public.upsert_memory_file(p_student, p_path, p_content, p_op, p_actor, p_new_path)` ile yapar; öğrenci kilidi,
  sınırlar ve sürümleme DB'de tek yoldadır. DB hataları (`OGR-MEM-00x`) `MemoryError`'a çevrilir.

## Açık işler

- `exam_report` / `report` (yapılandırılmış, araçlı, akışlı): araçlar arası notlar boş `thinking` bloğu olarak
  dönebilir; ara metin biçimle çatışmasın diye `PROGRESS_NOTE` eklenmez. `display:"updates"` (beta
  `thinking-display-updates-2026-08-18`) Sonnet 5.5'te mümkün, ancak sunucu yedeğinin (Sonnet 5) bunu kabul edip
  etmediği belgelenmemiş; canlı test sonrası değerlendirilecek.
- Haiku 5.5 ortadaki sistem mesajı ve müfredat birleşik isteği canlı testte doğrulanmadı (anahtar yok); canlı test
  sonucu README ve rotalara işlenecek.
- Batch'te `role:"system"` 400'ü öğe hatası olarak döner (yedekle yeniden deneme yalnız senkron `call`'da).

Denetim: `bash packages/llm/check.sh` (typecheck + eslint + vitest; canlı test anahtar yoksa SKIP).
