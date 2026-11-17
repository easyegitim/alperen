/**
 * Message Batches: oluştur / bekle / sonuçları oku (claude-api typescript/claude-api/batches.md).
 * Batch istekleri %50 indirimlidir; `fallbacks` Batches API'de reddedilir, bu yüzden gövdeden çıkarılır.
 * Akış ve istemci araç döngüsü yoktur: istemci aracı gerektiren rota Batch'e gönderilemez.
 */
import type {
  BatchCreateParams,
  BetaMessageBatch,
  BetaMessageBatchIndividualResponse,
} from '@anthropic-ai/sdk/resources/beta/messages/batches';
import type { LlmTransport, RequestBody, TransportContext } from './client.js';
import { BatchError, RouteConfigError } from './errors.js';

/** Batch `custom_id` biçimi (API: 1-64 karakter, harf/rakam/_/-). */
export const CUSTOM_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function assertCustomId(id: string): void {
  if (!CUSTOM_ID_RE.test(id)) throw new RouteConfigError(`geçersiz batch custom_id (1-64, [A-Za-z0-9_-]): ${id}`);
}

/** Senkron istek gövdesini Batch isteğine çevirir: `fallbacks`, `betas`, `stream` atılır. */
export function toBatchRequest(customId: string, body: RequestBody): BatchCreateParams.Request {
  assertCustomId(customId);
  const { fallbacks: _f, betas: _b, stream: _s, ...params } = body as RequestBody & { stream?: unknown };
  return { custom_id: customId, params: params as BatchCreateParams.Request['params'] };
}

export async function submitBatch(
  transport: LlmTransport,
  requests: BatchCreateParams.Request[],
  ctx: TransportContext,
): Promise<BetaMessageBatch> {
  if (requests.length === 0) throw new RouteConfigError('boş batch gönderilemez');
  if (requests.length > 100_000) throw new RouteConfigError('batch en çok 100.000 istek alır');
  const ids = new Set<string>();
  for (const r of requests) {
    if (ids.has(r.custom_id)) throw new RouteConfigError(`yinelenen custom_id: ${r.custom_id}`);
    ids.add(r.custom_id);
  }
  return transport.batches.create({ requests }, ctx);
}

export interface PollOptions {
  /** Yoklama aralığı (ms); varsayılan 60 sn. */
  intervalMs?: number;
  /** Toplam bekleme sınırı (ms); varsayılan 24 sa. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Batch bitene (`processing_status === "ended"`) kadar bekler. */
export async function pollBatch(transport: LlmTransport, id: string, opts: PollOptions = {}): Promise<BetaMessageBatch> {
  const interval = opts.intervalMs ?? 60_000;
  const timeout = opts.timeoutMs ?? 24 * 60 * 60 * 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const start = now();
  for (;;) {
    const b = await transport.batches.retrieve(id);
    if (b.processing_status === 'ended') return b;
    if (now() - start > timeout) throw new BatchError(`batch ${id} süre sınırında bitmedi (${b.processing_status})`, true);
    await sleep(interval);
  }
}

/** Sonuçları sırayla okur (JSONL akışı). */
export async function* batchResults(transport: LlmTransport, id: string): AsyncGenerator<BetaMessageBatchIndividualResponse> {
  const it = await transport.batches.results(id);
  for await (const r of it) yield r;
}
