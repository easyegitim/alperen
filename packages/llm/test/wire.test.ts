/**
 * Gerçek SDK yolu (ağsız): AnthropicTransport, enjekte edilen `fetch` ile çalışır; telden giden istek denetlenir.
 * `betas` gövdeden çıkıp `anthropic-beta` başlığına gider, `fallbacks` gövdede kalır, `parse` işlevi gitmez.
 */
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AnthropicTransport, FALLBACK_BETA } from '../src/client.js';
import { Gateway } from '../src/gateway.js';
import { InMemoryLedger } from '../src/ledger.js';
import { FakeTransport } from '../src/fake.js';
import { contractRegistry, type Contract } from '@ogrenmen/contracts';
import { PRODUCT } from './helpers.js';

function capture(reply: unknown) {
  const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
  };
  const client = new Anthropic({ apiKey: 'test-key-not-real', fetch: fetchImpl as typeof fetch, maxRetries: 0 });
  return { client, seen };
}

describe('telden giden istek (SDK)', () => {
  it('solution_diagnosis: fallbacks gövdede, beta başlıkta, örnekleme parametresi yok', async () => {
    const sample = new FakeTransport().sampleFor('solution_diagnosis', contractRegistry['solution-diagnosis'] as Contract);
    const reply = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: JSON.stringify(sample) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    };
    const { client, seen } = capture(reply);
    const ledger = new InMemoryLedger();
    const g = new Gateway({ transport: new AnthropicTransport(client), ledger });
    const res = await g.call('solution_diagnosis', { system: { product: PRODUCT }, user: 'çözüm', turn: { date: '2026-11-02' } });
    expect(res.data).not.toBeNull();
    const req = seen[0];
    expect(req?.url).toContain('/v1/messages');
    expect(req?.headers.get('anthropic-beta') ?? '').toContain(FALLBACK_BETA);
    const body = req?.body ?? {};
    expect(body.fallbacks).toBe('default');
    expect(body).not.toHaveProperty('betas');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('thinking');
    const oc = body.output_config as { effort: string; format: Record<string, unknown> };
    expect(oc.effort).toBe('high');
    expect(oc.format.type).toBe('json_schema');
    expect(oc.format).not.toHaveProperty('parse');
    expect((body.messages as { role: string }[]).map((m) => m.role)).toEqual(['user', 'system']);
    expect(ledger.rows[0]).toMatchObject({ tokens_in: 100, tokens_out: 50, status: 'ok' });
    expect(ledger.rows[0]?.cost_usd).toBeCloseTo(100 * 4e-6 + 50 * 20e-6, 9);
  });

  it('Haiku: beta başlığı ve fallbacks yok, thinking disabled', async () => {
    const sample = new FakeTransport().sampleFor('page_class', contractRegistry['page-class'] as Contract);
    const { client, seen } = capture({
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content: [{ type: 'text', text: JSON.stringify(sample) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const g = new Gateway({ transport: new AnthropicTransport(client), ledger: new InMemoryLedger() });
    await g.call('page_class', { system: { product: PRODUCT }, user: 'sayfa' });
    const req = seen[0];
    expect(req?.headers.get('anthropic-beta') ?? '').not.toContain('server-side-fallback');
    expect(req?.body).not.toHaveProperty('fallbacks');
    expect(req?.body.thinking).toEqual({ type: 'disabled' });
  });
});
