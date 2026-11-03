/**
 * Deterministik sahte taşıma (`OGRENMEN_LLM=fake`; testler ve yerel geliştirme). Ağ yok, anahtar yok.
 *
 * Yanıt seçimi (sırayla):
 *   1. `enqueue(route | '*', ...replies)` ile sıraya konmuş betik yanıtları (testler: araç çağrısı, ret, kesilme…)
 *   2. yapılandırılmış rotalarda kayıtlı fikstür: `fixtures/llm/<route>.json` ya da `fixtures/llm/<route>/*.json`
 *      (sıralı ilk geçerli; `bad-*` ve `injection*` atlanır)
 *   3. `@ogrenmen/contracts` `fixtures/<şema>/valid/*.json` içinden sıralı ilk geçerli örnek
 *   4. strict JSON Schema'dan üretilmiş en küçük örnek
 *   Serbest metin rotalarında girdiden türeyen sabit bir Türkçe metin döner.
 *
 * Kullanım ve önbellek: token sayısı ≈ JSON uzunluğu / 4. `cache_control` kesme noktalarına kadar olan önekler
 * (işaretler çıkarılarak) anahtarlanır; aynı önek tekrar gelirse `cache_read_input_tokens`, ilk kez gelirse
 * `cache_creation_input_tokens` yazılır (512 token altı önek önbelleğe girmez — gerçek API gibi).
 * Her istek `requests` dizisine kaydedilir; testler gövdeyi birebir denetler.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractRegistry, isSchemaName, outputFormat, type Contract } from '@ogrenmen/contracts';
import type {
  BetaContentBlock,
  BetaMessage,
  BetaRawMessageStreamEvent,
  BetaRefusalStopDetails,
  BetaStopReason,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type {
  BatchCreateParams,
  BetaMessageBatch,
  BetaMessageBatchIndividualResponse,
} from '@anthropic-ai/sdk/resources/beta/messages/batches';
import type { LlmStream, LlmTransport, RequestBody, TransportContext } from './client.js';
import { MIN_CACHEABLE_TOKENS } from './prompt.js';
import { isRouteName, ROUTES } from './routes.js';

export interface FakeToolUse {
  name: string;
  input: unknown;
  id?: string;
}

export interface FakeReply {
  /** Ham metin (yapılandırılmış rotada JSON metni olabilir). */
  text?: string;
  /** JSON olarak yazılacak veri (`text` yerine). */
  json?: unknown;
  thinking?: string;
  toolUses?: FakeToolUse[];
  stopReason?: BetaStopReason;
  stopDetails?: Partial<BetaRefusalStopDetails> | null;
  /** Kullanım alanlarının üzerine yazar. */
  usage?: Partial<BetaUsage>;
  /** Yanıtı veren model (yedek senaryoları). */
  model?: string;
  /** API hatası fırlat (ör. `new RateLimitError(...)`). */
  error?: Error;
}

export interface FakeRequestRecord {
  kind: 'create' | 'stream' | 'batch';
  route: string;
  body: RequestBody;
  customId?: string;
}

export interface FakeTransportOptions {
  /** Rota fikstürleri dizini; varsayılan depo kökü `fixtures/llm`. */
  fixturesDir?: string | undefined;
  /** Önbellek benzetimi (varsayılan açık). */
  cacheSim?: boolean;
}

const DEFAULT_FIXTURES = fileURLToPath(new URL('../../../fixtures/llm/', import.meta.url));

function contractsDir(): string | null {
  try {
    const req = createRequire(import.meta.url);
    return dirname(req.resolve('@ogrenmen/contracts/package.json'));
  } catch {
    return null;
  }
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const tokens = (x: unknown) => Math.ceil((typeof x === 'string' ? x : JSON.stringify(x) ?? '').length / 4);

/** `cache_control` işaretlerini çıkarır (hareketli işaret önbelleği bozmaz). */
function stripCache(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(stripCache);
  if (x && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) if (k !== 'cache_control') out[k] = stripCache(v);
    return out;
  }
  return x;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('bad-') && !f.startsWith('injection') && f !== 'expect.json')
    .sort()
    .map((f) => join(dir, f));
}

/** Strict JSON Schema'dan en küçük örnek (son çare; loose kurallarını garanti etmez). */
export function sampleFromSchema(node: unknown, root: Record<string, unknown> = node as Record<string, unknown>): unknown {
  if (!node || typeof node !== 'object') return null;
  const n = node as Record<string, unknown>;
  if (typeof n.$ref === 'string') {
    const name = n.$ref.replace(/^#\/\$defs\//, '');
    return sampleFromSchema((root.$defs as Record<string, unknown> | undefined)?.[name], root);
  }
  if ('const' in n) return n.const;
  if (Array.isArray(n.enum)) return n.enum[0];
  const union = (n.anyOf ?? n.oneOf) as unknown[] | undefined;
  if (Array.isArray(union)) {
    const nonNull = union.find((o) => (o as { type?: unknown }).type !== 'null');
    return sampleFromSchema(nonNull ?? union[0], root);
  }
  const t = Array.isArray(n.type) ? (n.type.find((x) => x !== 'null') ?? 'null') : n.type;
  switch (t) {
    case 'object': {
      const props = (n.properties ?? {}) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, sampleFromSchema(v, root)]));
    }
    case 'array':
      return [];
    case 'string':
      if (n.format === 'date') return '2026-11-02';
      if (n.format === 'date-time') return '2026-11-02T09:00:00+03:00';
      if (n.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
      return 'örnek';
    case 'integer':
      return 1;
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

export class FakeTransport implements LlmTransport {
  readonly kind = 'fake' as const;
  readonly requests: FakeRequestRecord[] = [];
  private readonly queues = new Map<string, FakeReply[]>();
  private readonly cache = new Set<string>();
  private readonly fixturesDir: string;
  private readonly cacheSim: boolean;
  private readonly batchStore = new Map<string, { route: string; requests: BatchCreateParams.Request[]; replies: BetaMessage[] }>();
  private counter = 0;

  constructor(opts: FakeTransportOptions = {}) {
    this.fixturesDir = opts.fixturesDir ?? DEFAULT_FIXTURES;
    this.cacheSim = opts.cacheSim ?? true;
  }

  /** Rota (ya da '*') için betik yanıtları sıraya koyar. */
  enqueue(route: string, ...replies: FakeReply[]): this {
    const q = this.queues.get(route) ?? [];
    q.push(...replies);
    this.queues.set(route, q);
    return this;
  }

  /** Önbellek benzetimini sıfırlar. */
  resetCache(): void {
    this.cache.clear();
  }

  private next(route: string): FakeReply | null {
    for (const key of [route, '*']) {
      const q = this.queues.get(key);
      if (q && q.length > 0) return q.shift() ?? null;
    }
    return null;
  }

  /** Yapılandırılmış rota için örnek veri (fikstür → contracts örneği → üretilmiş). */
  sampleFor(route: string, contract: Contract): unknown {
    const candidates = [join(this.fixturesDir, `${route}.json`), ...jsonFiles(join(this.fixturesDir, route))];
    const cdir = contractsDir();
    if (cdir) candidates.push(...jsonFiles(join(cdir, 'fixtures', contract.name, 'valid')));
    for (const file of candidates) {
      if (!existsSync(file) || !statSync(file).isFile()) continue;
      try {
        const data = readJson(file);
        if (contract.isValid(data)) return data;
      } catch {
        // bozuk fikstür: sıradakine geç
      }
    }
    return sampleFromSchema(outputFormat(contract).schema);
  }

  private defaultReply(route: string, body: RequestBody): FakeReply {
    const schemaName = isRouteName(route) ? ROUTES[route].schema : null;
    if (body.output_config?.format && schemaName && isSchemaName(schemaName)) {
      return { json: this.sampleFor(route, contractRegistry[schemaName] as Contract) };
    }
    const seed = hash(JSON.stringify(stripCache(body.messages))).slice(0, 8);
    return { text: `Sahte yanıt (${route}, ${seed}). Birlikte adım adım bakalım: önce verilenleri yazalım.` };
  }

  /** Önbellek benzetimi: kesme noktalarına göre okuma/yazma token'ları. */
  private cacheUsage(body: RequestBody): { total: number; read: number; write5m: number; write1h: number } {
    const segments: { node: unknown; cc: { ttl?: string } | null }[] = [];
    for (const t of body.tools ?? []) segments.push({ node: t, cc: (t as { cache_control?: { ttl?: string } | null }).cache_control ?? null });
    const sys = typeof body.system === 'string' ? [{ type: 'text', text: body.system }] : (body.system ?? []);
    for (const b of sys) segments.push({ node: b, cc: (b as { cache_control?: { ttl?: string } | null }).cache_control ?? null });
    // Otomatik (üst düzey) kesme noktası son uygun bloğa konur; sistem mesajları uygun değildir, geriye yürünür.
    let autoMsg = -1;
    body.messages.forEach((m, mi) => {
      if (m.role !== 'system') autoMsg = mi;
    });
    body.messages.forEach((m, mi) => {
      const content = typeof m.content === 'string' || m.content === undefined ? [{ type: 'text', text: m.content ?? '' }] : m.content;
      content.forEach((b, bi) => {
        const isLast = mi === autoMsg && bi === content.length - 1;
        const own = (b as { cache_control?: { ttl?: string } | null }).cache_control ?? null;
        const auto = isLast && body.cache_control ? (body.cache_control as { ttl?: string }) : null;
        segments.push({ node: { role: m.role, block: b }, cc: own ?? auto });
      });
    });
    let cum = 0;
    const prefix: unknown[] = [body.model];
    const bps: { key: string; at: number; ttl: '5m' | '1h' }[] = [];
    for (const s of segments) {
      cum += tokens(stripCache(s.node));
      prefix.push(stripCache(s.node));
      if (s.cc) bps.push({ key: hash(JSON.stringify(prefix)), at: cum, ttl: s.cc.ttl === '1h' ? '1h' : '5m' });
    }
    const total = cum;
    if (!this.cacheSim) return { total, read: 0, write5m: 0, write1h: 0 };
    let readAt = 0;
    let readIdx = -1;
    bps.forEach((b, i) => {
      if (b.at >= MIN_CACHEABLE_TOKENS && this.cache.has(b.key)) {
        readAt = b.at;
        readIdx = i;
      }
    });
    let w5 = 0;
    let w1 = 0;
    let prev = readAt;
    for (let i = readIdx + 1; i < bps.length; i++) {
      const b = bps[i];
      if (!b || b.at < MIN_CACHEABLE_TOKENS) continue;
      const seg = b.at - prev;
      if (b.ttl === '1h') w1 += seg;
      else w5 += seg;
      prev = b.at;
      this.cache.add(b.key);
    }
    return { total, read: readAt, write5m: w5, write1h: w1 };
  }

  private build(route: string, body: RequestBody, reply: FakeReply | null): BetaMessage {
    const r = reply ?? this.defaultReply(route, body);
    if (r.error) throw r.error;
    const content: BetaContentBlock[] = [];
    if (r.thinking !== undefined) content.push({ type: 'thinking', thinking: r.thinking, signature: `sig_${hash(r.thinking).slice(0, 12)}` });
    const text = r.json !== undefined ? JSON.stringify(r.json) : r.text;
    if (text !== undefined && r.stopReason !== 'refusal') content.push({ type: 'text', text, citations: null });
    if (r.stopReason === 'refusal' && r.text !== undefined) content.push({ type: 'text', text: r.text, citations: null });
    for (const tu of r.toolUses ?? []) {
      this.counter += 1;
      content.push({ type: 'tool_use', id: tu.id ?? `toolu_fake_${this.counter}`, name: tu.name, input: tu.input });
    }
    const stop: BetaStopReason = r.stopReason ?? ((r.toolUses?.length ?? 0) > 0 ? 'tool_use' : 'end_turn');
    const cu = this.cacheUsage(body);
    const outTokens = tokens(content);
    this.counter += 1;
    const usage: BetaUsage = {
      input_tokens: Math.max(0, cu.total - cu.read - cu.write5m - cu.write1h),
      output_tokens: outTokens,
      cache_read_input_tokens: cu.read,
      cache_creation_input_tokens: cu.write5m + cu.write1h,
      cache_creation: { ephemeral_5m_input_tokens: cu.write5m, ephemeral_1h_input_tokens: cu.write1h },
      fallback_credit: null,
      inference_geo: null,
      iterations: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: 'standard',
      speed: null,
      ...r.usage,
    };
    const stopDetails: BetaRefusalStopDetails | null =
      stop === 'refusal'
        ? {
            type: 'refusal',
            category: null,
            explanation: null,
            fallback_credit_token: null,
            fallback_has_prefill_claim: null,
            recommended_model: null,
            ...(r.stopDetails ?? {}),
          }
        : null;
    return {
      id: `msg_fake_${this.counter}`,
      type: 'message',
      role: 'assistant',
      model: r.model ?? body.model,
      content,
      container: null,
      context_management: null,
      diagnostics: null,
      stop_details: stopDetails,
      stop_reason: stop,
      stop_sequence: null,
      usage,
    };
  }

  async create(body: RequestBody, ctx: TransportContext): Promise<BetaMessage> {
    const wired = JSON.parse(JSON.stringify(body)) as RequestBody;
    this.requests.push({ kind: 'create', route: ctx.route, body: wired });
    return this.build(ctx.route, wired, this.next(ctx.route));
  }

  stream(body: RequestBody, ctx: TransportContext): LlmStream {
    const wired = JSON.parse(JSON.stringify(body)) as RequestBody;
    this.requests.push({ kind: 'stream', route: ctx.route, body: wired });
    let message: BetaMessage | null = null;
    let error: unknown = null;
    try {
      message = this.build(ctx.route, wired, this.next(ctx.route));
    } catch (err) {
      error = err;
    }
    const events = (): BetaRawMessageStreamEvent[] => {
      if (!message) return [];
      const evs: BetaRawMessageStreamEvent[] = [{ type: 'message_start', message: { ...message, content: [] } }];
      message.content.forEach((b, index) => {
        if (b.type === 'text') {
          evs.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '', citations: null } });
          for (let i = 0; i < b.text.length; i += 24) {
            evs.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text.slice(i, i + 24) } });
          }
        } else if (b.type === 'thinking') {
          evs.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
          if (b.thinking) evs.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: b.thinking, estimated_tokens: null } });
        } else if (b.type === 'tool_use') {
          evs.push({ type: 'content_block_start', index, content_block: { ...b, input: {} } });
          evs.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
        }
        evs.push({ type: 'content_block_stop', index });
      });
      evs.push({
        type: 'message_delta',
        delta: { stop_reason: message.stop_reason, stop_sequence: null, stop_details: message.stop_details, container: null },
        usage: { ...message.usage, output_tokens: message.usage.output_tokens },
        context_management: null,
      } as BetaRawMessageStreamEvent);
      evs.push({ type: 'message_stop' });
      return evs;
    };
    return {
      async *[Symbol.asyncIterator]() {
        if (error) throw error;
        for (const e of events()) yield e;
      },
      finalMessage: async () => {
        if (error) throw error;
        return message as BetaMessage;
      },
      abort: () => undefined,
    };
  }

  private batchObj(id: string, ended: boolean, n: number): BetaMessageBatch {
    return {
      id,
      type: 'message_batch',
      processing_status: ended ? 'ended' : 'in_progress',
      request_counts: { processing: ended ? 0 : n, succeeded: ended ? n : 0, errored: 0, canceled: 0, expired: 0 },
      created_at: '2026-11-02T00:00:00Z',
      ended_at: ended ? '2026-11-02T00:10:00Z' : null,
      expires_at: '2026-11-03T00:00:00Z',
      archived_at: null,
      cancel_initiated_at: null,
      results_url: ended ? `fake://batches/${id}/results` : null,
    };
  }

  batches = {
    create: async (params: BatchCreateParams, ctx: TransportContext): Promise<BetaMessageBatch> => {
      this.counter += 1;
      const id = `msgbatch_fake_${this.counter}`;
      const replies: BetaMessage[] = [];
      for (const r of params.requests) {
        const wired = JSON.parse(JSON.stringify(r.params)) as RequestBody;
        this.requests.push({ kind: 'batch', route: ctx.route, body: wired, customId: r.custom_id });
        replies.push(this.build(ctx.route, wired, this.next(ctx.route)));
      }
      this.batchStore.set(id, { route: ctx.route, requests: params.requests, replies });
      return this.batchObj(id, false, params.requests.length);
    },
    retrieve: async (id: string): Promise<BetaMessageBatch> => {
      const b = this.batchStore.get(id);
      if (!b) throw new Error(`sahte batch yok: ${id}`);
      return this.batchObj(id, true, b.requests.length);
    },
    results: async (id: string): Promise<AsyncIterable<BetaMessageBatchIndividualResponse>> => {
      const b = this.batchStore.get(id);
      if (!b) throw new Error(`sahte batch yok: ${id}`);
      const items: BetaMessageBatchIndividualResponse[] = b.requests.map((r, i) => ({
        custom_id: r.custom_id,
        result: { type: 'succeeded', message: b.replies[i] as BetaMessage },
      }));
      return {
        async *[Symbol.asyncIterator]() {
          for (const it of items) yield it;
        },
      };
    },
    cancel: async (id: string): Promise<BetaMessageBatch> => {
      const b = this.batchStore.get(id);
      return this.batchObj(id, true, b?.requests.length ?? 0);
    },
  };
}
