/** OpenAI uyumlu uçlar (Groq, OpenRouter): chat/completions + response_format json_schema. */
import type { FetchFn } from '../../telegram/client.ts';
import { classifyStatus, isAbort, retryAfterMs, type CompleteRequest, type CompleteResult, type Provider, type ProviderId } from './types.ts';

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAiCompatibleProvider implements Provider {
  readonly id: ProviderId;
  readonly paid = false;
  constructor(private readonly o: { id: 'groq' | 'openrouter'; base: string; apiKey: string; fetch: FetchFn }) {
    this.id = o.id;
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const started = Date.now();
    const body = {
      model: req.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      ...(req.schema === undefined ? {} : { response_format: { type: 'json_schema', json_schema: { name: 'tutor_reply', schema: req.schema } } }),
    };
    let res: Response;
    try {
      res = await this.o.fetch(`${this.o.base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.apiKey}` },
        body: JSON.stringify(body),
        signal: req.signal ?? AbortSignal.timeout(req.timeoutMs),
      });
    } catch (err) {
      return { ok: false, error: isAbort(err) ? 'timeout' : 'server', latencyMs: Date.now() - started };
    }
    if (!res.ok) return { ok: false, error: classifyStatus(res.status), status: res.status, retryAfterMs: retryAfterMs(res), latencyMs: Date.now() - started };
    const data = (await res.json().catch(() => ({}))) as ChatResponse;
    const text = data.choices?.[0]?.message?.content ?? '';
    if (text === '') return { ok: false, error: 'bad_output', latencyMs: Date.now() - started };
    return { ok: true, text, tokensIn: data.usage?.prompt_tokens ?? 0, tokensOut: data.usage?.completion_tokens ?? 0, latencyMs: Date.now() - started };
  }
}
