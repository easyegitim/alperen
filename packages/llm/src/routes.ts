/**
 * Rota tablosu (docs/PLAN-v2.md §5, docs/PLAN-v2-detail.md §3): her iş tek bir rotaya bağlıdır ve
 * modeli, effort'u, düşünme kipini, şemayı, araçları, önbellek politikasını ve çalışma kipini buradan alır.
 *
 * Kurallar (testlerde denetlenir, `validateRoute`):
 *   - temperature/top_p/top_k hiçbir rotada yok (istek gövdesine hiç eklenmez).
 *   - Opus 5.5: `thinking` gönderilmez (her zaman açık), derinlik `output_config.effort`.
 *   - Sonnet 5.5 "düşünme kapalı" = `{type:"between_tools"}`, effort ≤ high.
 *   - Haiku 5.5 "düşünme kapalı" = `{type:"disabled"}`, effort ≤ high.
 *   - Yapılandırılmış rotalarda maxTokens ≥ 4000.
 *   - `fallbacks:"default"` yalnız Opus/Sonnet senkron çağrılarda (Haiku'da ve Batch'te yok).
 *   - Önbellek: ürün ve ders blokları 1 saat, dossier 5 dk; 1 saatlik girdiler 5 dakikalıklardan önce gelir.
 */
import { isSchemaName, type SchemaName } from '@ogrenmen/contracts';
import { RouteConfigError } from './errors.js';

export const MODELS = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
} as const;

export type ModelFamily = keyof typeof MODELS;
export type ModelId = (typeof MODELS)[ModelFamily];
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** `adaptive`: thinking alanı gönderilmez (modelin varsayılanı). `off`: Sonnet between_tools / Haiku disabled. */
export type ThinkingMode = 'adaptive' | 'off';
export type CacheTtl = '1h' | '5m';
export type RouteMode = 'sync' | 'batch';

/** Rotaya bağlanabilen araç adları (tools.ts tanımları + Anthropic sunucu/istemci araçları). */
export type ToolName =
  | 'memory'
  | 'search_evidence'
  | 'get_mastery'
  | 'get_recent_exams'
  | 'record_turn_meta'
  | 'get_child_summary'
  | 'get_reports'
  | 'get_mastery_overview'
  | 'request_report'
  | 'web_search'
  | 'web_fetch'
  | 'code_execution';

export interface CachePolicy {
  /** system[0] ürün + persona + çıktı kuralları; null = işaretsiz. */
  productTtl: CacheTtl | null;
  /** system[1] ders bloğu (müfredat ağacı, yanılgı etiketleri, tarzlar). */
  courseTtl: CacheTtl | null;
  /** system[2] dossier bloğu (öğrenci başına). */
  dossierTtl: CacheTtl | null;
  /** Üst düzey otomatik `cache_control` (büyüyen sohbet kuyruğu); yalnız çok turlu rotalarda. */
  tail: boolean;
}

export interface RouteConfig {
  readonly name: RouteName;
  readonly model: ModelId;
  readonly effort: Effort;
  readonly thinking: ThinkingMode;
  /** packages/contracts kayıt adı; null = serbest metin. */
  readonly schema: SchemaName | null;
  readonly tools: readonly ToolName[];
  readonly cache: CachePolicy;
  /** Varsayılan çalışma kipi. */
  readonly mode: RouteMode;
  /** sync rota Batch ile de gönderilebilir mi (gece/toplu işler). */
  readonly batchable: boolean;
  /** Akışla (messages.stream + finalMessage) çağrılır mı; uzun çıktılar ve sohbet için. */
  readonly stream: boolean;
  readonly maxTokens: number;
  /** `fallbacks:"default"` gönderilir mi (yalnız Opus/Sonnet senkron). */
  readonly fallbacks: boolean;
  /** Sunucu araçlarının (web_search/web_fetch) kullanım sınırı. */
  readonly maxToolUses?: number;
  /** Araç döngüsü tur sınırı. */
  readonly maxIterations: number;
  /** Kısa açıklama (Türkçe). */
  readonly purpose: string;
}

export const ROUTE_NAMES = [
  'coach_chat',
  'coach_deep',
  'solution_diagnosis',
  'page_class',
  'exam_page_items',
  'answer_sheet',
  'inferred_keys',
  'exam_report',
  'curriculum_draft',
  'proposal_review',
  'notes_generation',
  'exam_generation',
  'figure_check',
  'exam_item_extract',
  'style_definition',
  'priority_plan',
  'style_question_gen',
  'speaker_label',
  'lesson_analysis',
  'parent_chat',
  'report',
  'memory_compaction',
  'memory_delta',
  'conversation_summary',
  'notification_copy',
  'eval_judge',
] as const;

export type RouteName = (typeof ROUTE_NAMES)[number];

const SHARED: CachePolicy = { productTtl: '1h', courseTtl: '1h', dossierTtl: '5m', tail: false };
const CHAT: CachePolicy = { ...SHARED, tail: true };
const COURSE_ONLY: CachePolicy = { productTtl: '1h', courseTtl: '1h', dossierTtl: null, tail: false };
const PRODUCT_ONLY: CachePolicy = { productTtl: '1h', courseTtl: null, dossierTtl: null, tail: false };

const COACH_TOOLS = ['memory', 'search_evidence', 'get_mastery', 'get_recent_exams', 'record_turn_meta'] as const;
const PARENT_TOOLS = ['get_child_summary', 'get_reports', 'get_mastery_overview', 'request_report'] as const;
const READ_TOOLS = ['get_mastery', 'get_recent_exams'] as const;

type Spec<S extends SchemaName | null> = Omit<RouteConfig, 'name' | 'maxIterations' | 'batchable' | 'stream' | 'fallbacks' | 'schema'> &
  Partial<Pick<RouteConfig, 'maxIterations' | 'batchable' | 'stream'>> & { schema: S };

/** Şema adını literal tipte tutar (gateway çıktı tipi `RouteOutput<R>` buradan türer). */
function route<const S extends SchemaName | null>(name: RouteName, spec: Spec<S>): RouteConfig & { readonly schema: S } {
  const family = familyOf(spec.model);
  const stream = spec.stream ?? false;
  return {
    ...spec,
    name,
    maxIterations: spec.maxIterations ?? (spec.tools.length > 0 ? 8 : 1),
    batchable: spec.batchable ?? spec.mode === 'batch',
    stream,
    // Sunucu taraflı yedek yalnız Opus/Sonnet senkron çağrılarda (Haiku'da sunucu yedeği yok; Batch reddeder).
    fallbacks: spec.mode === 'sync' && family !== 'haiku',
  };
}

/** Rota tablosu (PLAN-v2 §5 "LLM görev haritası"). */
export const ROUTES = {
  coach_chat: route('coach_chat', {
    purpose: 'Koç sohbeti (ipucu/açıkla/çözüm modları)',
    model: MODELS.sonnet, effort: 'medium', thinking: 'adaptive', schema: null,
    tools: COACH_TOOLS, cache: CHAT, mode: 'sync', stream: true, maxTokens: 8000,
  }),
  coach_deep: route('coach_deep', {
    purpose: 'Koç: istek üzerine tam çözüm / derin açıklama',
    model: MODELS.opus, effort: 'high', thinking: 'adaptive', schema: null,
    tools: COACH_TOOLS, cache: CHAT, mode: 'sync', stream: true, maxTokens: 32000,
  }),
  solution_diagnosis: route('solution_diagnosis', {
    purpose: 'Soru + çözüm fotoğrafı teşhisi',
    model: MODELS.opus, effort: 'high', thinking: 'adaptive', schema: 'solution-diagnosis',
    tools: [], cache: SHARED, mode: 'sync', batchable: true, maxTokens: 16000,
  }),
  page_class: route('page_class', {
    purpose: 'Deneme sayfa sınıflama',
    model: MODELS.haiku, effort: 'low', thinking: 'off', schema: 'page-class',
    tools: [], cache: PRODUCT_ONLY, mode: 'sync', maxTokens: 4000,
  }),
  exam_page_items: route('exam_page_items', {
    purpose: 'Deneme OCR: sayfa → sorular',
    model: MODELS.sonnet, effort: 'medium', thinking: 'off', schema: 'exam-page-items',
    tools: [], cache: COURSE_ONLY, mode: 'sync', maxTokens: 16000,
  }),
  answer_sheet: route('answer_sheet', {
    purpose: 'Optik form okuma',
    model: MODELS.sonnet, effort: 'medium', thinking: 'off', schema: 'answer-sheet',
    tools: [], cache: PRODUCT_ONLY, mode: 'sync', maxTokens: 8000,
  }),
  inferred_keys: route('inferred_keys', {
    purpose: 'Cevap anahtarı çıkarımı (anahtar yoksa)',
    model: MODELS.opus, effort: 'high', thinking: 'adaptive', schema: 'inferred-keys',
    tools: ['code_execution'], cache: COURSE_ONLY, mode: 'batch', maxTokens: 16000,
  }),
  exam_report: route('exam_report', {
    purpose: 'Deneme raporu (AST)',
    model: MODELS.sonnet, effort: 'medium', thinking: 'adaptive', schema: 'exam-report',
    tools: READ_TOOLS, cache: SHARED, mode: 'sync', stream: true, maxTokens: 24000,
  }),
  curriculum_draft: route('curriculum_draft', {
    purpose: 'Dinamik müfredat taslağı (web araştırması + yüklenen kaynaklar)',
    model: MODELS.opus, effort: 'high', thinking: 'adaptive', schema: 'curriculum-draft',
    tools: ['web_search', 'web_fetch'], maxToolUses: 8, cache: PRODUCT_ONLY, mode: 'sync', stream: true,
    maxTokens: 64000, maxIterations: 6,
  }),
  proposal_review: route('proposal_review', {
    purpose: 'Müfredat önerisi incelemesi (gece)',
    // contracts'ta henüz `proposal-review` sözleşmesi yok; serbest metin döner (bkz. README "Açık işler").
    model: MODELS.sonnet, effort: 'medium', thinking: 'adaptive', schema: null,
    tools: [], cache: COURSE_ONLY, mode: 'batch', maxTokens: 4000,
  }),
  notes_generation: route('notes_generation', {
    purpose: 'Kişiye özel not üretimi (document-ast)',
    model: MODELS.opus, effort: 'high', thinking: 'adaptive', schema: 'document-ast',
    tools: ['code_execution'], cache: SHARED, mode: 'sync', stream: true, batchable: true, maxTokens: 64000,
  }),
  exam_generation: route('exam_generation', {
    purpose: 'Deneme üretimi (40 soru)',
    model: MODELS.opus, effort: 'high', thinking: 'adaptive', schema: 'exam-generation',
    tools: ['code_execution'], cache: SHARED, mode: 'sync', stream: true, batchable: true, maxTokens: 64000,
  }),
  figure_check: route('figure_check', {
    purpose: 'Figür görsel kontrolü',
    model: MODELS.haiku, effort: 'low', thinking: 'off', schema: 'figure-render-report',
    tools: [], cache: PRODUCT_ONLY, mode: 'sync', maxTokens: 4000,
  }),
  exam_item_extract: route('exam_item_extract', {
    purpose: 'Çıkmış soru çıkarımı (kalem v2)',
    model: MODELS.sonnet, effort: 'medium', thinking: 'off', schema: 'exam-item',
    tools: [], cache: COURSE_ONLY, mode: 'batch', maxTokens: 8000,
  }),
  style_definition: route('style_definition', {
    purpose: 'Soru tarzı adlandırma',
    model: MODELS.sonnet, effort: 'medium', thinking: 'adaptive', schema: 'style-definition',
    tools: [], cache: COURSE_ONLY, mode: 'batch', maxTokens: 8000,
  }),
  priority_plan: route('priority_plan', {
    purpose: 'Sınav öncelik planı',
    model: MODELS.opus, effort: 'medium', thinking: 'adaptive', schema: 'exam-priority-plan',
    tools: [], cache: SHARED, mode: 'sync', stream: true, maxTokens: 24000,
  }),
  style_question_gen: route('style_question_gen', {
    purpose: 'Tarza özel soru üretimi',
    // Planın `question-generation` şeması contracts'ta `exam-generation` (sorular + ayrı anahtar) olarak var.
    model: MODELS.opus, effort: 'high', thinking: 'adaptive', schema: 'exam-generation',
    tools: ['code_execution'], cache: SHARED, mode: 'sync', batchable: true, maxTokens: 16000,
  }),
  speaker_label: route('speaker_label', {
    purpose: 'Ders transkriptinde konuşmacı etiketleme',
    model: MODELS.sonnet, effort: 'low', thinking: 'off', schema: 'transcript',
    tools: [], cache: PRODUCT_ONLY, mode: 'sync', stream: true, maxTokens: 32000,
  }),
  lesson_analysis: route('lesson_analysis', {
    purpose: 'Ders analizi (kareler + transkript)',
    model: MODELS.opus, effort: 'high', thinking: 'adaptive', schema: 'lesson-analysis',
    tools: [], cache: SHARED, mode: 'sync', stream: true, maxTokens: 32000,
  }),
  parent_chat: route('parent_chat', {
    purpose: 'Veli sohbeti',
    model: MODELS.sonnet, effort: 'low', thinking: 'adaptive', schema: null,
    tools: PARENT_TOOLS, cache: CHAT, mode: 'sync', stream: true, maxTokens: 4000,
  }),
  report: route('report', {
    purpose: 'İstek üzerine rapor (report-ast)',
    model: MODELS.sonnet, effort: 'medium', thinking: 'adaptive', schema: 'report-ast',
    tools: READ_TOOLS, cache: SHARED, mode: 'sync', stream: true, maxTokens: 24000,
  }),
  memory_compaction: route('memory_compaction', {
    purpose: 'Gece hafıza/dossier sıkıştırma',
    model: MODELS.sonnet, effort: 'medium', thinking: 'adaptive', schema: 'memory-compaction',
    tools: [], cache: PRODUCT_ONLY, mode: 'batch', maxTokens: 8000,
  }),
  memory_delta: route('memory_delta', {
    purpose: 'Hafıza deltası (≤3 str_replace/insert)',
    model: MODELS.haiku, effort: 'low', thinking: 'off', schema: 'memory-delta',
    tools: [], cache: PRODUCT_ONLY, mode: 'sync', maxTokens: 4000,
  }),
  conversation_summary: route('conversation_summary', {
    purpose: 'Sohbet özeti (30 mesajdan eskisi)',
    model: MODELS.haiku, effort: 'low', thinking: 'off', schema: 'conversation-summary',
    tools: [], cache: PRODUCT_ONLY, mode: 'sync', maxTokens: 4000,
  }),
  notification_copy: route('notification_copy', {
    purpose: 'Bildirim metni',
    model: MODELS.haiku, effort: 'low', thinking: 'off', schema: 'notification-copy',
    tools: [], cache: PRODUCT_ONLY, mode: 'sync', maxTokens: 4000,
  }),
  eval_judge: route('eval_judge', {
    purpose: 'Eval hakemi',
    model: MODELS.opus, effort: 'high', thinking: 'adaptive', schema: 'eval-verdict',
    tools: [], cache: PRODUCT_ONLY, mode: 'batch', maxTokens: 8000,
  }),
} as const satisfies { readonly [K in RouteName]: RouteConfig };

/** Rotanın şema adı (literal). */
export type RouteSchema<R extends RouteName> = (typeof ROUTES)[R]['schema'];

export function familyOf(model: string): ModelFamily {
  if (model === MODELS.opus) return 'opus';
  if (model === MODELS.sonnet) return 'sonnet';
  if (model === MODELS.haiku) return 'haiku';
  throw new RouteConfigError(`bilinmeyen model: ${model}`);
}

export function isRouteName(name: string): name is RouteName {
  return (ROUTE_NAMES as readonly string[]).includes(name);
}

export function getRoute(name: string): RouteConfig {
  if (!isRouteName(name)) throw new RouteConfigError(`bilinmeyen rota: ${name}`);
  return ROUTES[name] as RouteConfig;
}

const EFFORT_RANK: Record<Effort, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };

/** Rota yapılandırmasındaki kural ihlallerini döndürür (boş = geçerli). */
export function validateRoute(r: RouteConfig): string[] {
  const errs: string[] = [];
  const fam = familyOf(r.model);
  if (r.thinking === 'off') {
    if (fam === 'opus') errs.push(`${r.name}: Opus 5.5'te düşünme kapatılamaz`);
    if (EFFORT_RANK[r.effort] > EFFORT_RANK.high) errs.push(`${r.name}: düşünme kapalıyken effort ≤ high olmalı`);
  }
  if (r.schema !== null) {
    if (!isSchemaName(r.schema)) errs.push(`${r.name}: bilinmeyen şema ${r.schema}`);
    if (r.maxTokens < 4000) errs.push(`${r.name}: yapılandırılmış çağrıda maxTokens ≥ 4000 olmalı`);
  }
  if (r.fallbacks && (fam === 'haiku' || r.mode !== 'sync')) errs.push(`${r.name}: fallbacks yalnız Opus/Sonnet senkron`);
  if (r.mode === 'batch' && r.stream) errs.push(`${r.name}: Batch rotası akış kullanamaz`);
  if (!r.stream && r.mode === 'sync' && r.maxTokens > NON_STREAMING_MAX_TOKENS) {
    errs.push(`${r.name}: akışsız çağrıda maxTokens ≤ ${NON_STREAMING_MAX_TOKENS} (SDK 10 dk sınırı)`);
  }
  const c = r.cache;
  const order = [c.productTtl, c.courseTtl, c.dossierTtl, c.tail ? '5m' : null].filter((t) => t !== null);
  const firstShort = order.indexOf('5m');
  if (firstShort !== -1 && order.slice(firstShort).includes('1h')) errs.push(`${r.name}: 1 saatlik önbellek 5 dakikalıktan sonra gelemez`);
  if (order.length > 4) errs.push(`${r.name}: en çok 4 önbellek kesme noktası`);
  if (new Set(r.tools).size !== r.tools.length) errs.push(`${r.name}: yinelenen araç`);
  if (r.tools.includes('web_search') && r.tools.includes('code_execution')) {
    errs.push(`${r.name}: web_search_20260209 ile ayrı code_execution birlikte verilmez`);
  }
  return errs;
}

/**
 * SDK, akışsız çağrıda beklenen süre 10 dakikayı aşınca hata verir (60 dk × max_tokens / 128K > 10 dk).
 * Bu sınırın üstündeki istekler akışla gönderilir.
 */
export const NON_STREAMING_MAX_TOKENS = 21_000;

/** Modelin tavan çıkışı (128K); max_tokens iki kat yeniden denemesi bunu aşmaz. */
export const MODEL_MAX_OUTPUT = 128_000;
