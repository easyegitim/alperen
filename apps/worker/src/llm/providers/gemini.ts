/** Gemini (ücretli ve ücretsiz anahtar aynı API): generateContent + responseSchema. */
import type { FetchFn } from '../../telegram/client.ts';
import { apiModelName } from '../cost.ts';
import { classifyStatus, isAbort, retryAfterMs, type CompleteRequest, type CompleteResult, type Provider, type ProviderId } from './types.ts';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GeminiProvider implements Provider {
  readonly id: ProviderId;
  readonly paid: boolean;
  constructor(private readonly o: { id: 'gemini-paid' | 'gemini-free'; base: string; apiKey: string; fetch: FetchFn }) {
    this.id = o.id;
    this.paid = o.id === 'gemini-paid';
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const started = Date.now();
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: {
        maxOutputTokens: req.maxTokens,
        temperature: req.temperature,
        ...(req.schema === undefined ? {} : { responseMimeType: 'application/json', responseSchema: req.schema }),
      },
    };
    let res: Response;
    try {
      res = await this.o.fetch(`${this.o.base}/models/${apiModelName(req.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.o.apiKey },
        body: JSON.stringify(body),
        signal: req.signal ?? AbortSignal.timeout(req.timeoutMs),
      });
    } catch (err) {
      return { ok: false, error: isAbort(err) ? 'timeout' : 'server', latencyMs: Date.now() - started };
    }
    if (!res.ok) return { ok: false, error: classifyStatus(res.status), status: res.status, retryAfterMs: retryAfterMs(res), latencyMs: Date.now() - started };
    const data = (await res.json().catch(() => ({}))) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (text === '') return { ok: false, error: 'bad_output', latencyMs: Date.now() - started };
    return {
      ok: true,
      text,
      tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs: Date.now() - started,
    };
  }
}
