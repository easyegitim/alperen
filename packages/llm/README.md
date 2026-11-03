# @ogrenmen/llm — Anthropic geçidi

Tüm Claude çağrıları buradan geçer (docs/PLAN-v2.md §5-6, docs/PLAN-v2-detail.md §3). Tek giriş:
`gateway.call(route, input)`. Rota; modeli, effort'u, düşünme kipini, şemayı, araçları, önbellek politikasını ve
kipi (senkron / akış / Batch) belirler. Her API isteği `public.llm_calls` satırı yazar.

## Nasıl çağrılır

```ts
import { createGateway, PgLedger, PgStore } from '@ogrenmen/llm';

const gateway = await createGateway({ ledger: new PgLedger(pool) }); // OGRENMEN_LLM=fake → sahte taşıma

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

Hatalar (`errors.ts`): `RefusalError` (yapılandırılmış rotada ret; sohbet rotaları `refusal` alanıyla döner),
`ParseError` (onarım turundan sonra da şemaya uymadı), `MaxTokensError` (iki kat yeniden denemeden sonra),
`ToolLoopError`, `RouteConfigError`. `classifyError(err)` → `{status, retryable}` (429/529/zaman aşımı yeniden
denenebilir; pg-boss geri çekilmesi buna göre).

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
| curriculum_draft | Opus · high | curriculum-draft | web_search, web_fetch (≤8) | akış |
| proposal_review | Sonnet · medium | — (sözleşme yok) | — | Batch |
| notes_generation | Opus · high | document-ast | code_execution | akış (+Batch) |
| exam_generation | Opus · high | exam-generation | code_execution | akış (+Batch) |
| figure_check | Haiku · low · kapalı | figure-render-report | — | senkron |
| exam_item_extract | Sonnet · medium · kapalı | exam-item | — | Batch |
| style_definition | Sonnet · medium | style-definition | — | Batch |
| priority_plan | Opus · medium | exam-priority-plan | — | akış |
| style_question_gen | Opus · high | exam-generation | code_execution | senkron (+Batch) |
| speaker_label | Sonnet · low · kapalı | transcript | — | akış |
| lesson_analysis | Opus · high | lesson-analysis | — | akış |
| parent_chat | Sonnet · low | — | get_child_summary, get_reports, get_mastery_overview, request_report | akış |
| report | Sonnet · medium | report-ast | get_mastery, get_recent_exams | akış |
| memory_compaction | Sonnet · medium | memory-compaction | — | Batch |
| memory_delta / conversation_summary / notification_copy | Haiku · low · kapalı | memory-delta / conversation-summary / notification-copy | — | senkron |
| eval_judge | Opus · high | eval-verdict | — | Batch |

Kurallar (testlerle denetlenir): temperature/top_p/top_k ve zorlanmış `tool_choice` yok (ESLint de yasaklar);
Opus'ta `thinking` gönderilmez; Sonnet "kapalı" = `between_tools`, Haiku "kapalı" = `disabled` (effort ≤ high);
`fallbacks:"default"` + `server-side-fallback-2026-07-01` yalnız Opus/Sonnet senkron; ≤4 `cache_control`, 1 saatlikler
önce; araçlar ada göre sıralı; tur bağlamı system bloklarına değil sona (Haiku'da kullanıcı turuna `<system-reminder>`).
Yapılandırılmış çıktı `@ogrenmen/contracts` `outputFormat(contract)` ile gider (SDK `zodOutputFormat` enum/const
kısıtını düşürdüğü için), yanıt loose şemayla doğrulanır; geçersizse bir onarım turu, sonra `ParseError`.

## Ortam

| değişken | anlamı |
|---|---|
| `OGRENMEN_LLM=fake` | ağsız deterministik taşıma (`fake.ts`): betik yanıtları → `fixtures/llm/<rota>.json` ya da `fixtures/llm/<rota>/` → contracts `fixtures/<şema>/valid` → şemadan örnek; önbellek benzetimi |
| `OGRENMEN_LLM_FIXTURES` | sahte taşımanın rota fikstür dizini (varsayılan depo kökü `fixtures/llm`) |
| `ANTHROPIC_API_KEY` | gerçek taşıma (SDK ortamdan okur; koda yazılmaz) |
| `OGRENMEN_LIVE=1` | `check.sh` canlı Haiku testini koşar (ikinci çağrıda `cache_read_input_tokens > 0`) |

Modüller: `routes.ts` · `client.ts` (taşıma, beta başlıkları) · `prompt.ts` (blok kurucular, kesme noktası denetimi) ·
`parse.ts` · `stream.ts` · `batch.ts` · `pricing.ts` · `ledger.ts` (`PgLedger`, `InMemoryLedger`) · `refusal.ts` ·
`tools.ts` (`betaZodTool`; çalıştırıcılar enjekte) · `memory/pgMemory.ts` (`/memories/` izin listesi, ≤12 dosya,
≤8 KB, sürümler; `InMemoryStore`, `PgStore`) · `gateway.ts` · `fake.ts` · `errors.ts`.

Denetim: `bash packages/llm/check.sh` (typecheck + eslint + vitest; canlı test anahtar yoksa SKIP).
