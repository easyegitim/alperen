/**
 * Rota araçları. İstemci araçları `betaZodTool` ile tanımlanır (girdi zod ile doğrulanır, `run` çalıştırıcıya
 * devreder); çalıştırıcılar dışarıdan enjekte edilir (apps/web: RLS'li Supabase istemcisi, apps/worker: service_role).
 * Sunucu araçları (web_search, web_fetch, code_execution) düz nesnedir. Hafıza aracı `memory/pgMemory.ts`'ten gelir.
 *
 * Araç kümesi rota başına sabittir ve ada göre sıralanır (önbellek öneki). Çalıştırıcısı verilmeyen araç yine de
 * bildirilir (önek sabit kalsın); çağrılırsa `is_error` sonucu döner.
 *
 * Veli ajanı araçları (PLAN-v2 §10) `strict: true` ile tanımlanır: girdi şeması API'nin strict alt kümesine
 * indirgenir (`additionalProperties: false`, sayısal sınırlar açıklamaya taşınır; zod yine istemci tarafında
 * doğrular). Strict araçlara `eager_input_streaming` eklenmez: eager akış parametre doğrulamasını kapatır ve strict
 * garantisini bozar (claude-api shared/tool-use-concepts.md); veli araçlarının girdisi zaten küçüktür.
 */
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import type {
  BetaToolResultContentBlockParam,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { MemoryToolHandlers } from '@anthropic-ai/sdk/helpers/beta/memory';
import { betaMemoryTool } from '@anthropic-ai/sdk/helpers/beta/memory';
import { z } from 'zod';
import { RouteConfigError } from './errors.js';
import { createMemoryHandlers, type MemoryHandlerOptions } from './memory/pgMemory.js';
import { sortTools } from './prompt.js';
import type { RouteConfig, ToolName } from './routes.js';

export const searchEvidenceInput = z.object({
  query: z.string().describe('Aranacak kanıt (ör. "kesirlerde payda eşitleme hatası")'),
  kinds: z
    .array(z.enum(['upload', 'solution_analysis', 'lesson', 'exam_response', 'conversation']))
    .optional()
    .describe('Kanıt türleri; boşsa hepsi'),
  limit: z.number().int().min(1).max(10).optional().describe('En çok kaç sonuç (varsayılan 5)'),
});

export const getMasteryInput = z.object({
  skill_codes: z.array(z.string()).optional().describe('Kazanım kodları; boşsa en zayıf ve en güçlü yapraklar'),
  course_id: z.string().optional().describe('Ders kimliği; boşsa etkin ders'),
});

export const getRecentExamsInput = z.object({
  limit: z.number().int().min(1).max(5).optional().describe('Son kaç deneme (varsayılan 3)'),
});

export const recordTurnMetaInput = z.object({
  skill_ids: z.array(z.string()).describe('Bu turda konuşulan kazanım kodları'),
  misconception_tags: z.array(z.string()).describe('Gözlenen yanılgı etiketleri'),
  mode_suggestion: z.enum(['hint', 'explain', 'solve']).nullable().describe('Moda geçiş önerisi; yoksa null'),
  escalate_to_instructor: z.boolean().describe('Bu soruyu hocaya iletmek gerekli mi'),
  confidence: z.number().min(0).max(1).describe('Teşhis güveni 0..1'),
  note: z.string().optional().describe('Eğitmen için kısa not'),
});

export const getChildSummaryInput = z.object({
  period: z.enum(['week', 'month']).describe('Özet dönemi'),
});

export const getReportsInput = z.object({
  limit: z.number().int().min(1).max(10).optional().describe('En çok kaç rapor'),
});

export const getMasteryOverviewInput = z.object({
  course_id: z.string().optional().describe('Ders kimliği; boşsa tüm dersler'),
});

export const getRecentActivityInput = z.object({
  days: z.number().int().min(1).max(30).optional().describe('Son kaç gün (1..30; varsayılan 7)'),
});

export const getExamSessionsInput = z.object({
  limit: z.number().int().min(1).max(10).optional().describe('En çok kaç deneme oturumu (1..10; varsayılan 5)'),
});

export const requestReportInput = z.object({
  topic: z.string().describe('Velinin istediği raporun konusu'),
  period: z.enum(['week', 'month', 'term']).describe('Rapor dönemi'),
});

export interface ToolInputs {
  search_evidence: z.infer<typeof searchEvidenceInput>;
  get_mastery: z.infer<typeof getMasteryInput>;
  get_recent_exams: z.infer<typeof getRecentExamsInput>;
  record_turn_meta: z.infer<typeof recordTurnMetaInput>;
  get_child_summary: z.infer<typeof getChildSummaryInput>;
  get_reports: z.infer<typeof getReportsInput>;
  get_mastery_overview: z.infer<typeof getMasteryOverviewInput>;
  get_recent_activity: z.infer<typeof getRecentActivityInput>;
  get_exam_sessions: z.infer<typeof getExamSessionsInput>;
  request_report: z.infer<typeof requestReportInput>;
}

export type ClientToolName = keyof ToolInputs;

export interface ToolCallContext {
  route: string;
  toolUseId: string;
  studentRef: string | null;
  signal?: AbortSignal;
}

export type ToolOutput = string | BetaToolResultContentBlockParam[];

/** Enjekte edilen çalıştırıcılar (yalnız rotanın kullandıkları gerekir). */
export type ToolRunners = {
  [K in ClientToolName]?: (input: ToolInputs[K], ctx: ToolCallContext) => Promise<ToolOutput> | ToolOutput;
};

interface ClientToolSpec<K extends ClientToolName> {
  description: string;
  schema: z.ZodType<ToolInputs[K]>;
  /** `strict: true` (veli ajanı araçları; salt okunur). */
  strict?: boolean;
}

const CLIENT_TOOLS: { [K in ClientToolName]: ClientToolSpec<K> } = {
  search_evidence: {
    description:
      'Öğrencinin geçmiş kanıtlarında (yüklemeler, çözüm analizleri, ders kayıtları, deneme yanıtları, sohbet) ' +
      'anlamsal arama yapar. Öğrencinin daha önce ne yaptığına dayanan bir iddiada bulunmadan önce çağır; ' +
      'dossier\'de olmayan ayrıntı gerektiğinde kullan.',
    schema: searchEvidenceInput,
  },
  get_mastery: {
    description:
      'Kazanımlara göre güncel ustalık tahminlerini (BKT olasılığı, kanıt sayısı, son görülme) getirir. ' +
      'Ustalık hakkında konuşmadan önce çağır; iddiayı kanıt sayısıyla birlikte söyle.',
    schema: getMasteryInput,
  },
  get_recent_exams: {
    description: 'Son denemelerin puanını, bölüm sonuçlarını ve öne çıkan hataları getirir. Deneme sonuçları sorulduğunda çağır.',
    schema: getRecentExamsInput,
  },
  record_turn_meta: {
    description:
      'Her yanıttan sonra bir kez çağır: bu turda konuşulan kazanımları, gözlenen yanılgıları, mod önerisini ve ' +
      'hocaya iletme gereğini kaydeder. Öğrenciye gösterilmez.',
    schema: recordTurnMetaInput,
  },
  get_child_summary: {
    description: 'Velinin çocuğu için haftalık ya da aylık özeti (çalışma süresi, gelişen ve zorlanılan konular) getirir.',
    schema: getChildSummaryInput,
    strict: true,
  },
  get_reports: {
    description: 'Veliye açık hazır raporların listesini (başlık, tarih, kısa özet) getirir. Rapor sorulduğunda önce bunu çağır.',
    schema: getReportsInput,
    strict: true,
  },
  get_mastery_overview: {
    description: 'Derslere göre ustalık özetini (bantlar: düşük/orta/yüksek, kanıt sayılarıyla) getirir.',
    schema: getMasteryOverviewInput,
    strict: true,
  },
  get_recent_activity: {
    description:
      'Çocuğun son günlerdeki etkinliğini (çalışma oturumları, yüklenen çözümler, tamamlanan notlar; gün gün) getirir. ' +
      'Velinin "bu hafta ne yaptı" sorusunda çağır.',
    schema: getRecentActivityInput,
    strict: true,
  },
  get_exam_sessions: {
    description: 'Çocuğun son deneme oturumlarını (tarih, net, bölüm sonuçları) getirir. Deneme sonucu sorulduğunda çağır.',
    schema: getExamSessionsInput,
    strict: true,
  },
  request_report: {
    description: 'Hazır raporlarda olmayan bir konu istendiğinde yeni rapor üretimini kuyruğa alır; rapor hazır olunca veliye bildirim gider.',
    schema: requestReportInput,
    strict: true,
  },
};

/** Strict araç şemasında desteklenmeyen kısıtlar (claude-api shared/tool-use-concepts.md "Not supported"). */
const STRICT_UNSUPPORTED = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
] as const;

function strictNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictNode);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  const moved: string[] = [];
  for (const [k, v] of Object.entries(node)) {
    if (k === '$schema') continue;
    if ((STRICT_UNSUPPORTED as readonly string[]).includes(k) || (k === 'minItems' && v !== 0 && v !== 1)) {
      moved.push(`${k}: ${JSON.stringify(v)}`);
      continue;
    }
    out[k] = k === 'properties' && v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, strictNode(pv)]))
      : strictNode(v);
  }
  if (out.type === 'object') out.additionalProperties = false;
  if (moved.length > 0) out.description = `${typeof out.description === 'string' ? `${out.description} ` : ''}(${moved.join(', ')})`;
  return out;
}

/**
 * Zod şemasını strict araç girdi şemasına indirger: `$schema` atılır, nesnelerde `additionalProperties: false`,
 * desteklenmeyen sayısal/uzunluk kısıtları açıklamaya taşınır; `enum`/`const`/`required` korunur. (SDK
 * `transformJSONSchema` `enum`'u da açıklamaya taşıdığı için kullanılmaz; bkz. contracts `outputFormat`.)
 * Kısıtların kendisi istemci tarafında zod `parse` ile yine uygulanır.
 */
export function strictInputSchema(schema: z.ZodType): Record<string, unknown> {
  return strictNode(z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' })) as Record<string, unknown>;
}

const SERVER_TOOLS = new Set<ToolName>(['web_search', 'web_fetch', 'code_execution']);

export function isClientToolName(name: string): name is ClientToolName {
  return Object.hasOwn(CLIENT_TOOLS, name);
}

/** Çalıştırılabilir istemci aracı (SDK tipi). */
export type RunnableTool = BetaRunnableTool<unknown>;

export interface BuiltTools {
  /** API'ye gönderilecek tanımlar (ada göre sıralı; `run`/`parse` içermez). */
  definitions: BetaToolUnion[];
  /** Ad → çalıştırılabilir araç (istemci araçları ve hafıza). */
  runnables: Map<string, RunnableTool>;
}

export interface BuildToolsOptions {
  runners?: ToolRunners;
  /** Hafıza aracı: hazır işleyiciler ya da depo seçenekleri. */
  memory?: MemoryToolHandlers | MemoryHandlerOptions;
  /** Akışlı istekte istemci araçlarına `eager_input_streaming: true` eklenir. */
  stream?: boolean;
  /** Çağrı bağlamı (çalıştırıcılara geçer). */
  context: Omit<ToolCallContext, 'toolUseId'>;
}

function isHandlerOptions(m: MemoryToolHandlers | MemoryHandlerOptions): m is MemoryHandlerOptions {
  return 'store' in m && 'studentId' in m;
}

function unavailable(name: string): never {
  throw new Error(`OGR-LLM-010 '${name}' aracı bu ortamda kullanılamıyor (çalıştırıcı enjekte edilmedi)`);
}

/** Sunucu araçlarının düz tanımları (sürümler: claude-api tool-use.md). */
function serverTool(name: ToolName, route: RouteConfig): BetaToolUnion {
  const maxUses = route.maxToolUses ?? null;
  switch (name) {
    case 'web_search':
      return { type: 'web_search_20260209', name: 'web_search', ...(maxUses ? { max_uses: maxUses } : {}) };
    case 'web_fetch':
      return { type: 'web_fetch_20260209', name: 'web_fetch', ...(maxUses ? { max_uses: maxUses } : {}) };
    case 'code_execution':
      return { type: 'code_execution_20260120', name: 'code_execution' };
    default:
      throw new RouteConfigError(`sunucu aracı değil: ${name}`);
  }
}

/** API'ye giden biçim: `run`/`parse` gibi işlevler ayıklanır. */
function toDefinition(t: RunnableTool): BetaToolUnion {
  const { run: _run, parse: _parse, ...def } = t as RunnableTool & Record<string, unknown>;
  return def as unknown as BetaToolUnion;
}

/** Rotanın araçlarını kurar. */
export function buildTools(route: RouteConfig, opts: BuildToolsOptions): BuiltTools {
  const runnables = new Map<string, RunnableTool>();
  const defs: BetaToolUnion[] = [];
  for (const name of route.tools) {
    if (SERVER_TOOLS.has(name)) {
      defs.push(serverTool(name, route));
      continue;
    }
    if (name === 'memory') {
      const handlers = opts.memory
        ? isHandlerOptions(opts.memory)
          ? createMemoryHandlers(opts.memory)
          : opts.memory
        : null;
      const tool = handlers
        ? (betaMemoryTool(handlers) as unknown as RunnableTool)
        : ({ type: 'memory_20250818', name: 'memory', parse: (x: unknown) => x, run: () => unavailable('memory') } as unknown as RunnableTool);
      runnables.set('memory', tool);
      defs.push(toDefinition(tool));
      continue;
    }
    if (!isClientToolName(name)) throw new RouteConfigError(`tanımsız araç: ${name}`);
    const spec = CLIENT_TOOLS[name] as ClientToolSpec<ClientToolName>;
    const runner = opts.runners?.[name] as ((i: unknown, c: ToolCallContext) => Promise<ToolOutput> | ToolOutput) | undefined;
    const zodTool = betaZodTool({
      name,
      description: spec.description,
      inputSchema: spec.schema as z.ZodType,
      ...(spec.strict ? { strict: true } : opts.stream ? { eager_input_streaming: true } : {}),
      run: async (input, runCtx) => {
        if (!runner) unavailable(name);
        const toolUseId = runCtx?.toolUse.id ?? '';
        return runner(input, { ...opts.context, toolUseId });
      },
    });
    const tool = (spec.strict
      ? { ...zodTool, input_schema: strictInputSchema(spec.schema as z.ZodType) }
      : zodTool) as unknown as RunnableTool;
    runnables.set(name, tool);
    defs.push(toDefinition(tool));
  }
  return { definitions: sortTools(defs as (BetaToolUnion & { name: string })[]), runnables };
}
