/**
 * Anthropic istemci fabrikası ve taşıma arayüzü. Geçit SDK'ya doğrudan değil bu dar arayüze konuşur; böylece
 * `OGRENMEN_LLM=fake` ile deterministik sahte taşıma (fake.ts) aynı istek gövdelerini alır ve testler gövdeyi
 * birebir denetler.
 *
 * Beta başlıkları istek başına `betas` alanıyla gönderilir (yalnız gerekenler):
 *   - `server-side-fallback-2026-07-01`  → `fallbacks: "default"` (Opus/Sonnet senkron)
 * Hafıza aracı, yapılandırılmış çıktı, Files API ve kod yürütme GA'dır; ek başlık gerekmez.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  BetaRawMessageStreamEvent,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type {
  BatchCreateParams,
  BetaMessageBatch,
  BetaMessageBatchIndividualResponse,
} from '@anthropic-ai/sdk/resources/beta/messages/batches';

export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Çağrı bağlamı (taşımaya geçer; sahte taşıma rotaya göre fikstür seçer). İstek gövdesine girmez. */
export interface TransportContext {
  route: string;
  signal?: AbortSignal;
}

export type RequestBody = MessageCreateParamsNonStreaming;

export interface LlmStream extends AsyncIterable<BetaRawMessageStreamEvent> {
  finalMessage(): Promise<BetaMessage>;
  abort(): void;
}

export interface LlmTransport {
  readonly kind: 'anthropic' | 'fake';
  create(body: RequestBody, ctx: TransportContext): Promise<BetaMessage>;
  stream(body: RequestBody, ctx: TransportContext): LlmStream;
  batches: {
    create(params: BatchCreateParams, ctx: TransportContext): Promise<BetaMessageBatch>;
    retrieve(id: string): Promise<BetaMessageBatch>;
    results(id: string): Promise<AsyncIterable<BetaMessageBatchIndividualResponse>>;
    cancel(id: string): Promise<BetaMessageBatch>;
  };
}

/** Gövdedeki `parse` gibi işlevleri ayıklar (yapılandırılmış çıktı biçimi). JSON'a giren her şey aynı kalır. */
function wire<T>(body: T): T {
  return JSON.parse(JSON.stringify(body)) as T;
}

/** Gerçek Anthropic taşıması (beta ad alanı: `fallbacks` yalnız orada). */
export class AnthropicTransport implements LlmTransport {
  readonly kind = 'anthropic' as const;
  readonly client: Anthropic;

  constructor(client?: Anthropic) {
    // Anahtar ortamdan (ANTHROPIC_API_KEY) okunur; koda yazılmaz.
    this.client = client ?? new Anthropic();
  }

  create(body: RequestBody, ctx: TransportContext): Promise<BetaMessage> {
    return this.client.beta.messages.create(wire(body), { signal: ctx.signal });
  }

  stream(body: RequestBody, ctx: TransportContext): LlmStream {
    const s = this.client.beta.messages.stream(wire(body), { signal: ctx.signal });
    return {
      [Symbol.asyncIterator]: () => s[Symbol.asyncIterator]() as AsyncIterator<BetaRawMessageStreamEvent>,
      finalMessage: () => s.finalMessage(),
      abort: () => s.abort(),
    };
  }

  batches = {
    create: (params: BatchCreateParams, _ctx: TransportContext) => this.client.beta.messages.batches.create(wire(params)),
    retrieve: (id: string) => this.client.beta.messages.batches.retrieve(id),
    results: async (id: string) => this.client.beta.messages.batches.results(id),
    cancel: (id: string) => this.client.beta.messages.batches.cancel(id),
  };
}

export interface CreateTransportOptions {
  /** Açıkça seç; verilmezse `OGRENMEN_LLM` (fake | anthropic). */
  kind?: 'anthropic' | 'fake';
  /** Var olan SDK istemcisi (ör. özel `maxRetries`). */
  client?: Anthropic;
  env?: Record<string, string | undefined>;
}

/**
 * Taşıma fabrikası: `OGRENMEN_LLM=fake` → sahte (fake.ts); aksi halde gerçek istemci.
 * Sahte modül dinamik yüklenir; üretim yolunda fikstür okuyucu yüklenmez.
 */
export async function createTransport(opts: CreateTransportOptions = {}): Promise<LlmTransport> {
  const env = opts.env ?? process.env;
  const kind = opts.kind ?? (env.OGRENMEN_LLM === 'fake' ? 'fake' : 'anthropic');
  if (kind === 'fake') {
    const { FakeTransport } = await import('./fake.js');
    return new FakeTransport({ fixturesDir: env.OGRENMEN_LLM_FIXTURES });
  }
  return new AnthropicTransport(opts.client);
}
