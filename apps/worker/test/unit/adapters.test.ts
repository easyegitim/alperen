import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@ogrenmen/pii';
import { embedderFromChain, geminiEmbedder, toHalfvec } from '../../src/data/embeddings.ts';
import type { AiBinding } from '../../src/env.ts';
import { chain, providerInfo } from '../../src/llm/cost.ts';
import { GeminiProvider } from '../../src/llm/providers/gemini.ts';
import { OpenAiCompatibleProvider } from '../../src/llm/providers/openai-compatible.ts';
import { buildProviders } from '../../src/llm/providers/registry.ts';
import type { CompleteRequest } from '../../src/llm/providers/types.ts';
import { WorkersAiProvider } from '../../src/llm/providers/workers-ai.ts';
import { redactError, TelegramApiError, TelegramClient } from '../../src/telegram/client.ts';
import { fakeAiRun, makeFakeAi } from '../fakes/ai.ts';
import { loadLlmFixtures } from '../fakes/llm-fixtures.ts';
import { candidates, FakeLlm, selectFixture } from '../fakes/providers.ts';

const REPLY = JSON.stringify(loadLlmFixtures().chat?.find((f) => f.name.startsWith('01'))?.data);
const req = (over: Partial<CompleteRequest> = {}): CompleteRequest => ({ purpose: 'chat', model: 'gemini-2.5-flash-lite@free', system: 'S', messages: [{ role: 'user', content: 'U' }], maxTokens: 220, temperature: 0.4, timeoutMs: 8000, schema: { type: 'object' }, ...over });

type Captured = { url: string; init: RequestInit };
function fakeFetch(respond: (url: string, init: RequestInit) => Response): { fetch: (i: Request | string | URL, init?: RequestInit) => Promise<Response>; calls: Captured[] } {
  const calls: Captured[] = [];
  return {
    calls,
    fetch: async (i, init = {}) => {
      const url = typeof i === 'string' ? i : i instanceof URL ? i.toString() : i.url;
      calls.push({ url, init });
      return respond(url, init);
    },
  };
}

const PIPELINES_SRC = fileURLToPath(new URL('../../../../pipelines/common/src', import.meta.url));
const hasPython = existsSync(PIPELINES_SRC) && spawnSync('python3', ['-c', 'import ogrenmen_common'], { env: { ...process.env, PYTHONPATH: PIPELINES_SRC } }).status === 0;

describe('fake-provider seçim kuralı (§2.3)', () => {
  const fx = loadLlmFixtures();
  it('ada göre sıralı, bad-schema hariç, sha256(prompt)[:8] mod n; deterministik', () => {
    const names = candidates(fx, 'chat').map((f) => f.name);
    expect(names).toEqual([...names].sort());
    expect(names.some((n) => n.startsWith('bad-schema'))).toBe(false);
    for (const p of ['a', 'Merhaba', '3/4 + 1/8 kaç?', 'ğüşıöç']) {
      const i = parseInt(sha256Hex(p).slice(0, 8), 16) % names.length;
      expect(selectFixture(fx, 'chat', p).name).toBe(names[i]);
      expect(selectFixture(fx, 'chat', p).name).toBe(selectFixture(fx, 'chat', p).name);
    }
  });

  it.skipIf(!hasPython)('ogrenmen_common.fakes.FakeLLM ile birebir aynı dosya (Python eşleniği)', () => {
    const prompts = ['a', 'Merhaba', '3/4 + 1/8 kaç?', 'ğüşıöç İı', 'Sen Öğrenmen\'sin\n\nÖğrenci: x'];
    for (const purpose of ['chat', 'chat_group', 'nightly_facts', 'research']) {
      const py = spawnSync(
        'python3',
        ['-c', 'import json,sys;from ogrenmen_common.fakes.llm import candidate_names,fixture_index;d=json.load(sys.stdin);n=candidate_names(d["names"]);print(json.dumps([n[fixture_index(p,len(n))] for p in d["prompts"]]))'],
        { input: JSON.stringify({ names: (fx[purpose] ?? []).map((f) => f.name), prompts }), env: { ...process.env, PYTHONPATH: PIPELINES_SRC }, encoding: 'utf8' },
      );
      expect(py.status, py.stderr).toBe(0);
      expect(JSON.parse(py.stdout)).toEqual(prompts.map((p) => selectFixture(fx, purpose, p).name));
    }
  });

  it('failWith ve badOutputEvery', async () => {
    const llm = new FakeLlm(fx, { failWith: { 429: [0], 500: [1] }, badOutputEvery: 3 });
    expect((await llm.complete('gemini-paid', req())).ok).toBe(false);
    expect((await llm.complete('gemini-paid', req())).ok).toBe(false);
    const third = await llm.complete('gemini-paid', req());
    expect(third.ok && llm.calls[2]?.file?.startsWith('bad-schema')).toBe(true);
    expect(llm.calls.map((c) => c.status)).toEqual([429, 500, 200]);
  });
});

describe('gerçek sağlayıcı adaptörleri (sahte fetch, ağ yok)', () => {
  it('Gemini: generateContent + responseSchema, x-goog-api-key, @free eki atılır', async () => {
    const f = fakeFetch(() => Response.json({ candidates: [{ content: { parts: [{ text: REPLY }] } }], usageMetadata: { promptTokenCount: 1800, candidatesTokenCount: 160 } }));
    const p = new GeminiProvider({ id: 'gemini-free', base: 'https://gemini.example/v1beta', apiKey: 'test-anahtar', fetch: f.fetch });
    const r = await p.complete(req());
    expect(r).toMatchObject({ ok: true, tokensIn: 1800, tokensOut: 160 });
    expect(f.calls[0]?.url).toBe('https://gemini.example/v1beta/models/gemini-2.5-flash-lite:generateContent');
    const body = JSON.parse(String(f.calls[0]?.init.body)) as { generationConfig: { responseSchema: unknown }; systemInstruction: { parts: Array<{ text: string }> } };
    expect(body.generationConfig.responseSchema).toEqual({ type: 'object' });
    expect(body.systemInstruction.parts[0]?.text).toBe('S');
    expect((f.calls[0]?.init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-anahtar');
    expect(p.paid).toBe(false);
  });

  it('durum kodları: 429 → rate_limited (retry-after), 503 → server, 401 → config, boş → bad_output', async () => {
    const statuses: Array<[number, string]> = [
      [429, 'rate_limited'],
      [503, 'server'],
      [401, 'config'],
      [403, 'config'],
    ];
    for (const [status, error] of statuses) {
      const f = fakeFetch(() => new Response('{}', { status, headers: status === 429 ? { 'retry-after': '7' } : {} }));
      const r = await new GeminiProvider({ id: 'gemini-paid', base: 'https://g', apiKey: 'k', fetch: f.fetch }).complete(req());
      expect(r).toMatchObject({ ok: false, error, status });
      if (status === 429 && r.ok === false) expect(r.retryAfterMs).toBe(7000);
    }
    const empty = fakeFetch(() => Response.json({ candidates: [] }));
    expect(await new GeminiProvider({ id: 'gemini-paid', base: 'https://g', apiKey: 'k', fetch: empty.fetch }).complete(req())).toMatchObject({ ok: false, error: 'bad_output' });
    const down = await new GeminiProvider({ id: 'gemini-paid', base: 'https://g', apiKey: 'k', fetch: async () => Promise.reject(new TypeError('ağ yok')) }).complete(req());
    expect(down).toMatchObject({ ok: false, error: 'server' });
  });

  it('OpenAI uyumlu (Groq/OpenRouter): chat/completions + response_format json_schema', async () => {
    const f = fakeFetch(() => Response.json({ choices: [{ message: { content: REPLY } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    const p = new OpenAiCompatibleProvider({ id: 'groq', base: 'https://groq.example/openai/v1', apiKey: 'k', fetch: f.fetch });
    const r = await p.complete(req({ model: 'llama-3.3-70b-versatile' }));
    expect(r).toMatchObject({ ok: true, text: REPLY, tokensIn: 10, tokensOut: 5 });
    expect(f.calls[0]?.url).toBe('https://groq.example/openai/v1/chat/completions');
    const body = JSON.parse(String(f.calls[0]?.init.body)) as { response_format: { type: string }; messages: unknown[] };
    expect(body.response_format.type).toBe('json_schema');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'S' });
  });

  it('Workers AI: env.AI bağlaması (fakeAiRun) varsa onu kullanır; yoksa REST; ikisi de yoksa zincir dışı', async () => {
    const ai = makeFakeAi();
    const p = WorkersAiProvider.create({ binding: ai, fetch: async () => Response.json({}) });
    expect(p).not.toBeNull();
    const r = await p!.complete(req({ model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }));
    expect(r.ok).toBe(true);
    expect(ai.calls[0]?.model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(typeof fakeAiRun).toBe('function');
    const failing = WorkersAiProvider.create({ binding: makeFakeAi({ failWith: '429 rate limited' }), fetch: async () => Response.json({}) });
    expect(await failing!.complete(req())).toMatchObject({ ok: false, error: 'rate_limited' });
    const f = fakeFetch(() => Response.json({ result: { response: REPLY, usage: { prompt_tokens: 3, completion_tokens: 2 } } }));
    const rest = WorkersAiProvider.create({ restBase: 'https://cf.example/accounts/{account}/ai/run', token: 't', accountId: 'acc1', fetch: f.fetch });
    expect(await rest!.complete(req({ model: '@cf/m' }))).toMatchObject({ ok: true, tokensIn: 3 });
    expect(f.calls[0]?.url).toBe('https://cf.example/accounts/acc1/ai/run/@cf/m');
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      expect(WorkersAiProvider.create({ fetch: f.fetch })).toBeNull();
    } finally {
      console.warn = warn;
    }
  });

  it('registry: anahtarı olmayan sağlayıcı zincirden çıkar', () => {
    const warn = console.warn;
    const lines: string[] = [];
    console.warn = (s: string) => lines.push(s);
    try {
      const m = buildProviders({ GEMINI_FREE_KEY: 'k', GROQ_KEY: 'k' }, async () => Response.json({}));
      expect([...m.keys()].sort()).toEqual(['gemini-free', 'groq']);
      expect(lines.some((l) => l.includes('gemini-paid'))).toBe(true);
      const withAi = buildProviders({ AI: makeFakeAi() }, async () => Response.json({}));
      expect([...withAi.keys()]).toEqual(['cf-ai']);
    } finally {
      console.warn = warn;
    }
  });

  it('embedding: 768 boyut, hata → null (FTS\'e düşer); kısa metin atlanır', async () => {
    const vec = Array.from({ length: 768 }, (_, i) => i / 768);
    const ok = geminiEmbedder({ base: 'https://g', apiKey: 'k', model: 'gemini-embedding-001', fetch: fakeFetch(() => Response.json({ embedding: { values: vec } })).fetch });
    expect((await ok('paydaları eşitleme nasıl yapılır'))?.length).toBe(768);
    expect(await ok('kısa')).toBeNull();
    const bad = geminiEmbedder({ base: 'https://g', apiKey: 'k', model: 'm', fetch: fakeFetch(() => new Response('', { status: 500 })).fetch });
    expect(await bad('paydaları eşitleme nasıl yapılır')).toBeNull();
    expect(toHalfvec([0.1234567, 1])).toBe('[0.123457,1]');
  });
});

describe('telegram client', () => {
  it('5xx → 2 deneme sonra null; 429 → retry_after bekler; 400 → fırlatır', async () => {
    let n = 0;
    const waits: number[] = [];
    const c5 = new TelegramClient({ base: 'http://t', token: 'x', fetch: async () => (n++, Response.json({ ok: false }, { status: 502 })), sleep: async (ms) => void waits.push(ms) });
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      expect(await c5.sendMessage(1, 'a')).toBeNull();
    } finally {
      console.warn = warn;
    }
    expect(n).toBe(2);
    let m = 0;
    const c429 = new TelegramClient({
      base: 'http://t',
      token: 'x',
      fetch: async () => (m++ === 0 ? Response.json({ ok: false, parameters: { retry_after: 2 } }, { status: 429 }) : Response.json({ ok: true, result: { message_id: 9, chat: { id: 1, type: 'private' }, date: 0 } })),
      sleep: async (ms) => void waits.push(ms),
    });
    expect((await c429.sendMessage(1, 'a'))?.message_id).toBe(9);
    expect(waits).toEqual([2000]);
    const c400 = new TelegramClient({ base: 'http://t', token: 'x', fetch: async () => Response.json({ ok: false, description: 'Bad Request' }, { status: 400 }) });
    await expect(c400.sendMessage(1, 'a')).rejects.toBeInstanceOf(TelegramApiError);
  });
});

describe('inceleme düzeltmeleri: adaptörler', () => {
  it('Workers AI bağlaması zaman aşımıyla yarışır: yanıt gelmezse timeout (zincir sonrakine geçer)', async () => {
    const never: AiBinding = { run: () => new Promise(() => undefined) };
    const p = WorkersAiProvider.create({ binding: never, fetch: async () => new Response('{}') });
    const t0 = Date.now();
    const r = await p!.complete(req({ model: '@cf/meta/llama-3.1-8b-instruct', timeoutMs: 30 }));
    expect(r).toMatchObject({ ok: false, error: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('embedder zincirden kurulur: chains.embedding[0] modeli + sağlayıcının base/key_env değeri', async () => {
    const ff = fakeFetch(() => new Response(JSON.stringify({ embedding: { values: new Array(768).fill(0.5) } })));
    const e = embedderFromChain({ GEMINI_PAID_KEY: 'test-key' }, ff.fetch);
    expect((await e('rasyonel sayılarda payda eşitleme'))?.length).toBe(768);
    const link = chain('embedding')[0]!;
    expect(ff.calls[0]?.url).toBe(`${providerInfo(link.provider)?.base}/models/${link.model}:embedContent`);
    expect((ff.calls[0]?.init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const none = fakeFetch(() => new Response('{}'));
    expect(await embedderFromChain({}, none.fetch)('rasyonel sayılarda payda eşitleme')).toBeNull();
    expect(none.calls.length).toBe(0);
  });

  it('Telegram ağ hatası loglanırken URL yolundaki bot jetonu maskelenir', async () => {
    const lines: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => lines.push(a.map(String).join(' '));
    try {
      const client = new TelegramClient({
        base: 'https://api.telegram.org',
        token: 'GIZLI-JETON-123',
        fetch: async (i) => {
          throw new TypeError(`fetch failed: ${String(i)}`);
        },
        sleep: async () => undefined,
      });
      expect(await client.sendMessage(1, 'x')).toBeNull();
    } finally {
      console.warn = orig;
    }
    expect(lines.join('\n')).not.toContain('GIZLI-JETON-123');
    expect(lines.join('\n')).toContain('/bot***');
    expect(redactError(new Error('GET https://x/botABC:DEF/getMe'))).toBe('Error: GET https://x/bot***/getMe');
  });
});
