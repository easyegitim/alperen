/** Ortak sağlayıcı arayüzü (BLUEPRINT §5.6). */
export type ProviderId = 'gemini-paid' | 'gemini-free' | 'groq' | 'cf-ai' | 'openrouter' | 'fake';

export interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompleteRequest {
  /** Amaç (llm_calls.purpose / fixtures/llm klasörü): 'chat' | 'chat_group'. Gerçek sağlayıcılar yok sayar. */
  purpose?: string;
  model: string;
  system: string;
  messages: Msg[];
  schema?: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type ProviderError = 'rate_limited' | 'server' | 'timeout' | 'bad_output' | 'config';

export type CompleteResult =
  | { ok: true; text: string; json?: unknown; tokensIn: number; tokensOut: number; latencyMs: number }
  | { ok: false; error: ProviderError; status?: number; retryAfterMs?: number; latencyMs?: number };

export interface Provider {
  id: ProviderId;
  paid: boolean;
  complete(req: CompleteRequest): Promise<CompleteResult>;
  embed?(texts: string[], dims: number): Promise<number[][]>;
}

/** HTTP durumunu sağlayıcı hata sınıfına çevirir. */
export function classifyStatus(status: number): ProviderError {
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 401 || status === 403 || status === 404) return 'config';
  return 'server';
}

export function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (h === null) return undefined;
  const n = Number(h);
  return Number.isFinite(n) ? n * 1000 : undefined;
}

export function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}
