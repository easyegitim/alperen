/**
 * Cloudflare Workers AI: `env.AI` bağlaması varsa onu, yoksa `CF_AI_TOKEN` + `CF_ACCOUNT_ID` ile REST'i
 * kullanır; ikisi de yoksa sağlayıcı oluşturulmaz (zincirden `console.warn` ile çıkar — yapılandırma
 * hatası değil). Yerel ortamda AI bağlaması yoktur (wrangler.toml).
 */
import type { AiBinding } from '../../env.ts';
import type { FetchFn } from '../../telegram/client.ts';
import { classifyStatus, isAbort, type CompleteRequest, type CompleteResult, type Provider } from './types.ts';

interface AiResult {
  response?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class WorkersAiProvider implements Provider {
  readonly id = 'cf-ai' as const;
  readonly paid = false;
  constructor(private readonly o: { binding?: AiBinding; restBase?: string; token?: string; accountId?: string; fetch: FetchFn }) {}

  static create(o: { binding?: AiBinding; restBase?: string; token?: string; accountId?: string; fetch: FetchFn }): WorkersAiProvider | null {
    if (o.binding !== undefined) return new WorkersAiProvider(o);
    if (o.token && o.accountId && o.restBase) return new WorkersAiProvider(o);
    console.warn(JSON.stringify({ lvl: 'warn', evt: 'provider_missing', provider: 'cf-ai' }));
    return null;
  }

  private input(req: CompleteRequest): Record<string, unknown> {
    return {
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      ...(req.schema === undefined ? {} : { response_format: { type: 'json_schema', json_schema: req.schema } }),
    };
  }

  private done(r: AiResult, started: number): CompleteResult {
    const raw = r.response;
    const text = typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : JSON.stringify(raw);
    if (text === '') return { ok: false, error: 'bad_output', latencyMs: Date.now() - started };
    return { ok: true, text, tokensIn: r.usage?.prompt_tokens ?? 0, tokensOut: r.usage?.completion_tokens ?? 0, latencyMs: Date.now() - started };
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const started = Date.now();
    if (this.o.binding !== undefined) {
      // Bağlama çağrısı sağlayıcı başına zaman aşımıyla (8 sn) yarışır; aşılırsa zincir sonrakine geçer.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), req.timeoutMs);
      });
      try {
        const r = await Promise.race([this.o.binding.run(req.model, this.input(req)) as Promise<AiResult>, timeout]);
        if (r === 'timeout') return { ok: false, error: 'timeout', latencyMs: Date.now() - started };
        return this.done(r ?? {}, started);
      } catch (err) {
        const msg = String(err);
        return { ok: false, error: /429|rate|limit/i.test(msg) ? 'rate_limited' : 'server', latencyMs: Date.now() - started };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    const url = `${(this.o.restBase ?? '').replace('{account}', this.o.accountId ?? '')}/${req.model}`;
    let res: Response;
    try {
      res = await this.o.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.token ?? ''}` },
        body: JSON.stringify(this.input(req)),
        signal: req.signal ?? AbortSignal.timeout(req.timeoutMs),
      });
    } catch (err) {
      return { ok: false, error: isAbort(err) ? 'timeout' : 'server', latencyMs: Date.now() - started };
    }
    if (!res.ok) return { ok: false, error: classifyStatus(res.status), status: res.status, latencyMs: Date.now() - started };
    const body = (await res.json().catch(() => ({}))) as { result?: AiResult };
    return this.done(body.result ?? {}, started);
  }
}
