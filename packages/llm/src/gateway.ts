/**
 * Geçit: tek giriş `gateway.call(route, input)`. Rota tablosundan istek gövdesini kurar (önbellek blokları, tur
 * sistem mesajı, sıralı araçlar, düşünme/effort, yedek), çağrıyı senkron / akışlı yürütür, araç döngüsünü koşar,
 * yapılandırılmış çıktıyı doğrular (onarım turu), max_tokens'ı iki katla bir kez yeniden dener, reddi eşler ve
 * her API isteği için `llm_calls` satırı yazar. Batch: `submitBatch` / `pollBatch` / `collectBatch`.
 *
 * İstek gövdesine asla `temperature`, `top_p`, `top_k` ya da zorlanmış `tool_choice` eklenmez.
 */
import { contractRegistry, type Contract, type SchemaName } from '@ogrenmen/contracts';
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaThinkingConfigParam,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { BetaMessageBatch } from '@anthropic-ai/sdk/resources/beta/messages/batches';
import type { z } from 'zod';
import { batchResults, pollBatch, submitBatch, toBatchRequest, type PollOptions } from './batch.js';
import { createTransport, FALLBACK_BETA, type LlmTransport, type RequestBody, type TransportContext } from './client.js';
import {
  classifyError,
  isSystemRoleUnsupported,
  RefusalError,
  RouteConfigError,
  StudentRefError,
  ToolLoopError,
  type LedgerStatus,
} from './errors.js';
import { assertStudentRef, BAD_STUDENT_REF, buildLedgerRow, InMemoryLedger, type LedgerRowInput, type LedgerWriter } from './ledger.js';
import type { MemoryHandlerOptions } from './memory/pgMemory.js';
import type { MemoryToolHandlers } from '@anthropic-ai/sdk/helpers/beta/memory';
import { allText, echoableContent, extractStructured, parseWithRepair, structuredFormat, withMaxTokensRetry } from './parse.js';
import { addUsage, messageCost, PRICING, ZERO_USAGE, type TokenUsage } from './pricing.js';
import {
  assertBreakpoints,
  buildSystemBlocks,
  buildTurnSystem,
  supportsSystemMessages,
  turnReminderBlock,
  type SystemParts,
  type TurnContext,
} from './prompt.js';
import { audienceForRoute, refusalOf, type RefusalInfo } from './refusal.js';
import { familyOf, MIN_STRUCTURED_MAX_TOKENS, MODEL_MAX_OUTPUT, NON_STREAMING_MAX_TOKENS, ROUTES, type RouteConfig, type RouteName, type RouteSchema } from './routes.js';
import { consumeStream, type StreamListener } from './stream.js';
import { buildTools, isClientToolName, type BuiltTools, type ToolRunners } from './tools.js';

/** Rotanın doğrulanmış çıktı tipi (serbest metin rotalarında null). */
export type RouteOutput<R extends RouteName> =
  RouteSchema<R> extends SchemaName ? z.output<(typeof contractRegistry)[RouteSchema<R>]['loose']> : null;

export interface CallInput {
  /** system[0..2]: ürün, ders, dossier. */
  system: SystemParts;
  /** Önceki turlar (append-only; düzenlenmez — önbellek ve thinking bağı korunur). */
  history?: BetaMessageParam[];
  /** Bu turun kullanıcı içeriği (metin ya da görsel/belge/metin blokları). */
  user: string | BetaContentBlockParam[];
  /** Tur bağlamı (tarih, mod, sınav) → sona `role:"system"` mesajı. */
  turn?: TurnContext | null;
  promptVersion?: string | null;
  /** `llm_calls.ref_table/ref_id`. */
  ref?: { table: string; id: string } | null;
  /** `students.public_ref` (asla uuid). */
  studentRef?: string | null;
  /** Rota varsayılanının üzerine `max_tokens`. */
  maxTokens?: number;
  /** Araç çalıştırıcıları ve hafıza deposu. */
  tools?: { runners?: ToolRunners; memory?: MemoryToolHandlers | MemoryHandlerOptions };
  /** Akış olayları (text/thinking/tool…). */
  onEvent?: StreamListener;
  signal?: AbortSignal;
  /** Harcama amacı (varsayılan rota adı). */
  purpose?: string;
  /**
   * Batch rotasını senkron çalıştır: yalnız Batch'ten `pause_turn` / `bad_output` / `max_tokens` / `error` ile dönen
   * öğeyi yeniden göndermek için (senkron yolda pause_turn sürdürülür, onarım turu ve max_tokens yeniden denemesi var).
   */
  batchRetry?: boolean;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: unknown;
  isError: boolean;
}

export interface CallResult<T> {
  route: RouteName;
  /** Son yanıtı veren model (yedek devreye girdiyse farklı olabilir). */
  model: string;
  /** Doğrulanmış yapılandırılmış çıktı; serbest metin rotalarında null. */
  data: T;
  /** Son yanıtın metni (ret durumunda Türkçe kibar ileti). */
  text: string;
  message: BetaMessage;
  /** Bu çağrının eklediği turlar dahil tam konuşma (kalıcılaştırmak için). */
  transcript: BetaMessageParam[];
  usage: TokenUsage;
  costUsd: number;
  ledgerIds: number[];
  refusal: RefusalInfo | null;
  stopReason: string | null;
  toolCalls: ToolCallRecord[];
  repaired: boolean;
}

export interface BatchItem {
  customId: string;
  input: CallInput;
}

export interface BatchItemMeta {
  ref?: { table: string; id: string } | null;
  studentRef?: string | null;
  promptVersion?: string | null;
}

export interface BatchItemResult<T> {
  customId: string;
  status: LedgerStatus;
  data: T | null;
  text: string;
  message: BetaMessage | null;
  refusal: RefusalInfo | null;
  /**
   * Hata ayrıntısı (bad_output: şema sorunları; error: API hatası türü ya da `pause_turn` — sunucu aracı döngüsü
   * Batch içinde durakladı; Batch'te sürdürülemez, öğeyi senkron `call` ile yeniden gönder).
   */
  error: string | null;
  costUsd: number;
  ledgerId: number | null;
}

export interface GatewayOptions {
  transport: LlmTransport;
  ledger: LedgerWriter;
  /** Gecikme ölçümü için saat (ms). */
  now?: () => number;
}

function thinkingFor(r: RouteConfig): BetaThinkingConfigParam | undefined {
  if (r.thinking !== 'off') return undefined; // Opus: hiç gönderilmez; adaptive: modelin varsayılanı
  const fam = familyOf(r.model);
  if (fam === 'sonnet') return { type: 'between_tools' };
  if (fam === 'haiku') return { type: 'disabled' };
  throw new RouteConfigError(`${r.name}: Opus 5.5'te thinking gönderilmez`);
}

/** Fiyatlanacak model: yanıtı veren model fiyat tablosundaysa o, değilse istenen model. */
function pricedModel(answered: string | null | undefined, requested: string): string {
  return answered && PRICING[answered] ? answered : requested;
}

function countImages(content: string | BetaContentBlockParam[]): number {
  if (typeof content === 'string') return 0;
  return content.filter((b) => b.type === 'image').length;
}

/**
 * Yapılandırılmış çıktı Citations ile uyumsuzdur (400; claude-api shared/tool-use-concepts.md). Biçimli rotalarda
 * `document` bloklarında `citations.enabled: true` gönderilmez; programcı hatası olarak reddedilir.
 */
function assertNoCitations(route: string, messages: readonly BetaMessageParam[]): void {
  for (const m of messages) {
    if (typeof m.content === 'string') continue;
    for (const b of m.content as readonly { type?: string; citations?: { enabled?: boolean } | null }[]) {
      if (b.type === 'document' && b.citations?.enabled) {
        throw new RouteConfigError(`${route}: yapılandırılmış çıktılı rotada document citations açılamaz (API 400 döner)`);
      }
    }
  }
}

function toolUses(m: BetaMessage): BetaToolUseBlock[] {
  return m.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
}

export class Gateway {
  readonly transport: LlmTransport;
  readonly ledger: LedgerWriter;
  private readonly now: () => number;
  /** Ortadaki `role:"system"` mesajını 400 ile reddettiği görülen modeller (bu süreçte yedek kullanılır). */
  private readonly noSystemRole = new Set<string>();

  constructor(opts: GatewayOptions) {
    this.transport = opts.transport;
    this.ledger = opts.ledger;
    this.now = opts.now ?? (() => performance.now());
  }

  /** Rota + girdi → istek gövdesi (yan etkisiz; testler ve Batch bunu kullanır). */
  buildRequest(
    route: RouteName,
    input: CallInput,
    opts: { batch?: boolean; tools?: BuiltTools; turnFallback?: boolean } = {},
  ): RequestBody {
    const r = ROUTES[route] as RouteConfig;
    const batch = opts.batch ?? false;
    const built = opts.tools ?? this.tools(r, input, !batch && r.stream);
    const userContent: BetaContentBlockParam[] =
      typeof input.user === 'string' ? [{ type: 'text', text: input.user }] : [...input.user];
    if (userContent.length === 0) throw new RouteConfigError('kullanıcı turu boş olamaz');
    const messages: BetaMessageParam[] = [...(input.history ?? [])];
    let turnMessage: BetaMessageParam | null = null;
    if (input.turn) {
      const systemRole = supportsSystemMessages(r.model) && !opts.turnFallback && !this.noSystemRole.has(r.model);
      if (systemRole) turnMessage = buildTurnSystem(input.turn);
      else userContent.push(turnReminderBlock(input.turn));
    }
    messages.push({ role: 'user', content: userContent });
    if (turnMessage) messages.push(turnMessage);

    const thinking = thinkingFor(r);
    const contract = r.schema ? (contractRegistry[r.schema] as Contract) : null;
    if (contract) assertNoCitations(route, messages);
    const body: RequestBody = {
      model: r.model,
      max_tokens: input.maxTokens ?? r.maxTokens,
      system: buildSystemBlocks(input.system, r.cache, { progressNote: r.progressNote }),
      messages,
      ...(built.definitions.length > 0 ? { tools: built.definitions } : {}),
      ...(thinking ? { thinking } : {}),
      output_config: { effort: r.effort, ...(contract ? { format: structuredFormat(contract) } : {}) },
      ...(r.cache.tail ? { cache_control: { type: 'ephemeral' as const } } : {}),
      // Batch öğesinin senkron yeniden gönderimi (batchRetry) de Opus/Sonnet'te sunucu yedeğini alır.
      ...(!batch && (r.fallbacks || (input.batchRetry && familyOf(r.model) !== 'haiku'))
        ? { fallbacks: 'default' as const, betas: [FALLBACK_BETA] }
        : {}),
    };
    // PLAN-v2 §5: yapılandırılmış çağrıda max_tokens ≥ 4000 (rota varsayılanı validateRoute'ta, üzerine yazım burada).
    if (contract && body.max_tokens < MIN_STRUCTURED_MAX_TOKENS) {
      throw new RouteConfigError(`${route}: yapılandırılmış çağrıda max_tokens ≥ ${MIN_STRUCTURED_MAX_TOKENS} olmalı (${body.max_tokens} verildi)`);
    }
    assertBreakpoints(body);
    return body;
  }

  private tools(r: RouteConfig, input: CallInput, stream: boolean): BuiltTools {
    return buildTools(r, {
      runners: input.tools?.runners,
      memory: input.tools?.memory,
      stream,
      context: { route: r.name, studentRef: input.studentRef ?? null, signal: input.signal },
    });
  }

  /** Tek giriş: rota çağrısı (senkron ya da akışlı). Batch rotaları için `submitBatch` kullanılır. */
  async call<R extends RouteName>(route: R, input: CallInput): Promise<CallResult<RouteOutput<R>>> {
    const r = ROUTES[route] as RouteConfig;
    if (r.mode === 'batch' && !input.batchRetry) {
      throw new RouteConfigError(`${route} bir Batch rotası; submitBatch/collectBatch kullan (yeniden gönderim: batchRetry)`);
    }
    // Ücretli istekten önce: geçersiz kimlik yanıtı kaybettirmesin (OGR-LLM-008).
    assertStudentRef(input.studentRef);
    const built = this.tools(r, input, r.stream);
    const body = this.buildRequest(route, input, { tools: built });
    const acc = { usage: ZERO_USAGE, cost: 0, ids: [] as number[], toolCalls: [] as ToolCallRecord[] };
    try {
      return await this.execute(route, input, built, body, acc);
    } catch (err) {
      // Ortadaki sistem mesajı bu modelde desteklenmiyorsa bir kez <system-reminder> yedeğiyle yeniden dene.
      const hasTurnSystem = body.messages.some((m) => (m.role as string) === 'system');
      if (!hasTurnSystem || !isSystemRoleUnsupported(err)) throw err;
      this.noSystemRole.add(r.model);
      const fallback = this.buildRequest(route, input, { tools: built, turnFallback: true });
      return this.execute(route, input, built, fallback, acc);
    }
  }

  private async execute<R extends RouteName>(
    route: R,
    input: CallInput,
    built: BuiltTools,
    body: RequestBody,
    acc: { usage: TokenUsage; cost: number; ids: number[]; toolCalls: ToolCallRecord[] },
  ): Promise<CallResult<RouteOutput<R>>> {
    const r = ROUTES[route] as RouteConfig;
    const images = countImages(input.user);
    const ctx: TransportContext = { route, signal: input.signal };
    const contract = r.schema ? (contractRegistry[r.schema] as Contract) : null;

    // Tek API isteği: akış ya da create; defter satırı yazar.
    const sendOne = async (req: RequestBody, kind: 'initial' | 'max_tokens_retry'): Promise<BetaMessage> => {
      if (kind === 'max_tokens_retry') input.onEvent?.({ type: 'restart', reason: 'max_tokens_retry' });
      const t0 = this.now();
      const useStream = r.stream || req.max_tokens > NON_STREAMING_MAX_TOKENS;
      let msg: BetaMessage;
      try {
        msg = useStream ? await consumeStream(this.transport.stream(req, ctx), input.onEvent) : await this.transport.create(req, ctx);
      } catch (err) {
        const c = classifyError(err);
        // record() asla fırlatmaz: asıl API hatası maskelenmez.
        const id = await this.record(r, input, { usage: ZERO_USAGE, cost: 0, status: c.status, errorCode: c.code, stopReason: null, latency: this.now() - t0, images, model: req.model });
        if (id !== null) acc.ids.push(id);
        throw err;
      }
      // Fiyat yanıtı veren modelle (yapışkan yedek yönlendirmesi doğrudan yedek modelden yanıtlayabilir); defterin
      // `model` sütunuyla aynı. Tabloda olmayan model istenen modelle fiyatlanır.
      const { usage, costUsd } = messageCost(pricedModel(msg.model, req.model), msg.usage);
      acc.usage = addUsage(acc.usage, usage);
      acc.cost += costUsd;
      let status: LedgerStatus = 'ok';
      if (msg.stop_reason === 'refusal') status = 'refusal';
      else if (msg.stop_reason === 'max_tokens') status = 'max_tokens';
      else if (contract && msg.stop_reason === 'end_turn' && !extractStructured(msg, contract).ok) status = 'bad_output';
      const id = await this.record(r, input, {
        usage,
        cost: costUsd,
        status,
        errorCode: status === 'refusal' ? (msg.stop_details?.category ?? null) : null,
        stopReason: msg.stop_reason,
        latency: this.now() - t0,
        images,
        model: msg.model ?? req.model,
      });
      if (id !== null) acc.ids.push(id);
      return msg;
    };

    // Bir tam tur: araç döngüsü (+ pause_turn sürdürme), her istek max_tokens yeniden denemeli.
    const runTurn = async (start: RequestBody): Promise<{ message: BetaMessage; body: RequestBody }> => {
      let req = start;
      for (let iter = 0; ; iter++) {
        if (iter >= r.maxIterations + 2) throw new ToolLoopError(`${route}: araç döngüsü ${iter} turda bitmedi`);
        const { message, body: sent } = await withMaxTokensRetry(sendOne, req, MODEL_MAX_OUTPUT);
        req = sent;
        if (message.stop_reason === 'refusal') return { message, body: req };
        if (message.stop_reason === 'pause_turn') {
          // Sunucu aracı döngüsü durakladı: asistan içeriği aynen geri gönderilir, ek "devam" iletisi yok.
          req = { ...req, messages: [...req.messages, { role: 'assistant', content: echoableContent(message.content) as never }] };
          continue;
        }
        const uses = toolUses(message);
        if (message.stop_reason !== 'tool_use' || uses.length === 0) return { message, body: req };
        const results: BetaToolResultBlockParam[] = [];
        for (const tu of uses) results.push(await this.runTool(built, tu, input, acc.toolCalls));
        req = {
          ...req,
          messages: [
            ...req.messages,
            { role: 'assistant', content: echoableContent(message.content) as never },
            { role: 'user', content: results },
          ],
        };
      }
    };

    let final: { message: BetaMessage; body: RequestBody };
    let data: unknown = null;
    let repaired = false;
    if (contract) {
      const out = await parseWithRepair(contract, body, async (b, kind) => {
        if (kind === 'repair' && input.onEvent) input.onEvent({ type: 'restart', reason: 'repair' });
        return runTurn(b);
      }, audienceForRoute(route));
      final = { message: out.message, body: out.body };
      data = out.data;
      repaired = out.repaired;
    } else {
      final = await runTurn(body);
    }

    const refusal = refusalOf(final.message, audienceForRoute(route));
    if (refusal && contract) throw new RefusalError(refusal);
    const text = refusal ? refusal.user_message_tr : allText(final.message.content);
    // Ret turunda reddedilen (boş ya da yarım) içerik geçmişe girmez (claude-api: ara akışta ret → kısmi çıktı atılır).
    // Konuşma, kullanıcıya gösterilen kibar iletiyle kapanır: boş asistan turu sonraki istekte 400 verir, asistansız
    // bırakmak da sondaki `role:"system"` mesajını asistan turu olmadan bırakır (yine 400). `message` yalnız günlük için.
    const closing: BetaMessageParam = refusal
      ? { role: 'assistant', content: [{ type: 'text', text: refusal.user_message_tr }] }
      : { role: 'assistant', content: echoableContent(final.message.content) as never };
    const transcript: BetaMessageParam[] = [...final.body.messages, closing];
    return {
      route,
      model: final.message.model,
      data: data as RouteOutput<R>,
      text,
      message: final.message,
      transcript,
      usage: acc.usage,
      costUsd: Math.round(acc.cost * 1e6) / 1e6,
      ledgerIds: acc.ids,
      refusal,
      stopReason: final.message.stop_reason,
      toolCalls: acc.toolCalls,
      repaired,
    };
  }

  private async runTool(
    built: BuiltTools,
    tu: BetaToolUseBlock,
    input: CallInput,
    log: ToolCallRecord[],
  ): Promise<BetaToolResultBlockParam> {
    const tool = built.runnables.get(tu.name);
    const fail = (msg: string): BetaToolResultBlockParam => {
      log.push({ id: tu.id, name: tu.name, input: tu.input, isError: true });
      input.onEvent?.({ type: 'tool_result', id: tu.id, name: tu.name, isError: true });
      return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: msg };
    };
    if (!tool) return fail(`Bilinmeyen araç: ${tu.name}`);
    let parsed: unknown;
    try {
      parsed = tool.parse(tu.input);
    } catch (err) {
      // Bozuk/eksik girdi: aracı çalıştırma, modele ham girdiyi geri ver (yeniden denesin).
      return fail(JSON.stringify({ INVALID_INPUT: JSON.stringify(tu.input), error: err instanceof Error ? err.message : String(err) }));
    }
    try {
      const out = await tool.run(parsed, { toolUse: tu, toolUseBlock: tu, signal: input.signal });
      log.push({ id: tu.id, name: tu.name, input: parsed, isError: false });
      input.onEvent?.({ type: 'tool_result', id: tu.id, name: tu.name, isError: false });
      return { type: 'tool_result', tool_use_id: tu.id, content: out };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  private async record(
    r: RouteConfig,
    input: Pick<CallInput, 'promptVersion' | 'ref' | 'studentRef' | 'purpose'>,
    x: {
      usage: TokenUsage;
      cost: number;
      status: LedgerStatus;
      errorCode: string | null;
      stopReason: string | null;
      latency: number | null;
      images: number | null;
      model: string;
      batch?: boolean;
    },
  ): Promise<number | null> {
    const row: LedgerRowInput = {
      route: r.name,
      purpose: input.purpose ?? r.name,
      model: x.model,
      effort: r.effort,
      promptVersion: input.promptVersion ?? null,
      usage: x.usage,
      images: x.images,
      batch: x.batch ?? false,
      status: x.status,
      errorCode: x.errorCode,
      stopReason: x.stopReason,
      latencyMs: x.latency,
      costUsd: x.cost,
      ref: input.ref ?? null,
      studentRef: input.studentRef ?? null,
    };
    // Defter yazımı çağrıyı asla düşürmez: geçersiz student_ref satırı null kimlikle ve hata koduyla yazılır,
    // yazıcı hatası günlüğe gider. Böylece API sonucu ya da asıl hata korunur.
    try {
      let built: ReturnType<typeof buildLedgerRow>;
      try {
        built = buildLedgerRow(row);
      } catch (err) {
        if (!(err instanceof StudentRefError)) throw err;
        built = buildLedgerRow({ ...row, studentRef: null, errorCode: BAD_STUDENT_REF });
      }
      return await this.ledger.write(built);
    } catch (err) {
      console.error('OGR-LLM-009 llm_calls yazılamadı', err);
      return null;
    }
  }

  /** Batch gönderimi (rota `mode: "batch"` ya da `batchable`). İstemci araçlı rotalar Batch'e gönderilemez. */
  async submitBatch(route: RouteName, items: BatchItem[]): Promise<{ batch: BetaMessageBatch; meta: Record<string, BatchItemMeta> }> {
    const r = ROUTES[route] as RouteConfig;
    if (r.mode !== 'batch' && !r.batchable) throw new RouteConfigError(`${route} Batch ile gönderilemez`);
    if (r.tools.some((t) => t === 'memory' || isClientToolName(t))) {
      throw new RouteConfigError(`${route}: istemci araçlı rota Batch'te koşamaz`);
    }
    for (const it of items) assertStudentRef(it.input.studentRef);
    const requests = items.map((it) => toBatchRequest(it.customId, this.buildRequest(route, it.input, { batch: true })));
    const batch = await submitBatch(this.transport, requests, { route });
    const meta = Object.fromEntries(
      items.map((it) => [it.customId, { ref: it.input.ref ?? null, studentRef: it.input.studentRef ?? null, promptVersion: it.input.promptVersion ?? null }]),
    );
    return { batch, meta };
  }

  pollBatch(batchId: string, opts?: PollOptions): Promise<BetaMessageBatch> {
    return pollBatch(this.transport, batchId, opts);
  }

  /**
   * Biten Batch'in sonuçlarını okur, doğrular ve her sonuç için `llm_calls` (batch=true, 0.5× fiyat) yazar.
   * Onarım/yeniden deneme Batch içinde yapılmaz: `bad_output` / `max_tokens` / `error` durumundaki öğeleri çağıran
   * senkron `call` ile ya da yeni bir Batch ile yeniden gönderir.
   */
  async collectBatch<R extends RouteName>(
    route: R,
    batchId: string,
    meta: Record<string, BatchItemMeta> = {},
  ): Promise<BatchItemResult<RouteOutput<R>>[]> {
    const r = ROUTES[route] as RouteConfig;
    const contract = r.schema ? (contractRegistry[r.schema] as Contract) : null;
    const out: BatchItemResult<RouteOutput<R>>[] = [];
    for await (const item of batchResults(this.transport, batchId)) {
      const m = meta[item.custom_id] ?? {};
      const base = { promptVersion: m.promptVersion ?? null, ref: m.ref ?? null, studentRef: m.studentRef ?? null };
      if (item.result.type !== 'succeeded') {
        const kind = item.result.type;
        const status: LedgerStatus = kind === 'expired' ? 'timeout' : 'error';
        const detail = kind === 'errored' ? item.result.error.error.type : kind;
        const ledgerId = await this.record(r, base, { usage: ZERO_USAGE, cost: 0, status, errorCode: detail, stopReason: null, latency: null, images: null, model: r.model, batch: true });
        out.push({ customId: item.custom_id, status, data: null, text: '', message: null, refusal: null, error: detail, costUsd: 0, ledgerId });
        continue;
      }
      const msg = item.result.message;
      const { usage, costUsd } = messageCost(pricedModel(msg.model, r.model), msg.usage, { batch: true });
      const refusal = refusalOf(msg, audienceForRoute(route));
      let status: LedgerStatus = 'ok';
      let data: unknown = null;
      let error: string | null = null;
      if (refusal) status = 'refusal';
      else if (msg.stop_reason === 'max_tokens') status = 'max_tokens';
      else if (msg.stop_reason === 'pause_turn') {
        // Sunucu aracı (code_execution) döngüsü durakladı; Batch'te sürdürme yok → senkron call ile yeniden gönder.
        status = 'error';
        error = 'pause_turn';
      } else if (contract) {
        const p = extractStructured(msg, contract);
        if (p.ok) data = p.data;
        else {
          status = 'bad_output';
          error = p.issues;
        }
      }
      const ledgerId = await this.record(r, base, {
        usage,
        cost: costUsd,
        status,
        errorCode: refusal ? refusal.category : error === 'pause_turn' ? 'pause_turn' : null,
        stopReason: msg.stop_reason,
        latency: null,
        images: null,
        model: msg.model ?? r.model,
        batch: true,
      });
      out.push({
        customId: item.custom_id,
        status,
        data: data as RouteOutput<R> | null,
        text: refusal ? refusal.user_message_tr : allText(msg.content),
        message: msg,
        refusal,
        error,
        costUsd,
        ledgerId,
      });
    }
    return out;
  }
}

export interface CreateGatewayOptions {
  transport?: LlmTransport;
  ledger?: LedgerWriter;
  env?: Record<string, string | undefined>;
}

/**
 * Geçit fabrikası. `transport` verilmezse `OGRENMEN_LLM` (fake | anthropic) okunur. Gerçek taşımada `ledger` zorunludur
 * (her çağrı → llm_calls): apps/worker `PgLedger` (service_role pg havuzu), apps/web `RpcLedger` (kullanıcının JWT'li
 * supabase istemcisi; service_role web'de asla kullanılmaz, PLAN-v2 §4) geçer; verilmezse `RouteConfigError`.
 * Web yalnız `WEB_LEDGER_ROUTES` rotalarını çağırır (ledger.ts). Bellek içi defter yalnız sahte taşımada varsayılandır.
 */
export async function createGateway(opts: CreateGatewayOptions = {}): Promise<Gateway> {
  const transport = opts.transport ?? (await createTransport({ env: opts.env }));
  if (!opts.ledger && transport.kind === 'anthropic') {
    throw new RouteConfigError('gerçek Anthropic taşımasında ledger zorunlu (PgLedger ya da RpcLedger); her çağrı llm_calls\'a yazılır');
  }
  return new Gateway({ transport, ledger: opts.ledger ?? new InMemoryLedger() });
}
