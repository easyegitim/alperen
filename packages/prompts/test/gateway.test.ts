import { createGateway, FakeTransport, InMemoryLedger } from '@ogrenmen/llm';
import { describe, expect, it } from 'vitest';
import { loadPrompt } from '../src/index.js';

describe('geçitle birlikte (OGRENMEN_LLM=fake)', () => {
  it('prompt metni system[0] olur, 1 saat önbelleklenir ve ikinci çağrıda önbellekten okunur', async () => {
    const fake = new FakeTransport();
    const gateway = await createGateway({ transport: fake, ledger: new InMemoryLedger() });
    const p = loadPrompt('memory_delta');
    const input = {
      system: { product: p.text },
      user: '{"teşhis": "örnek"}',
      turn: { date: '2026-11-03' },
      promptVersion: p.meta.version,
    };
    const a = await gateway.call('memory_delta', input);
    const b = await gateway.call('memory_delta', input);
    const body = fake.requests[0]?.body as { system: { text: string; cache_control?: { ttl?: string } }[] };
    expect(body.system[0]?.text).toBe(p.text);
    expect(body.system[0]?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(a.usage.cacheWrite1h).toBeGreaterThanOrEqual(512);
    expect(a.usage.cacheRead).toBe(0);
    expect(b.usage.cacheRead).toBeGreaterThanOrEqual(512);
  });

  it('koç promptu ilerleme notu eklenmeden, olduğu gibi gönderilir (tek balon)', async () => {
    const fake = new FakeTransport();
    const gateway = await createGateway({ transport: fake, ledger: new InMemoryLedger() });
    const p = loadPrompt('coach_chat');
    await gateway.call('coach_chat', { system: { product: p.text }, user: 'merhaba', turn: { date: '2026-11-03', mode: 'hint' } });
    const body = fake.requests[0]?.body as { system: { text: string }[]; messages: { role: string; content: unknown }[] };
    expect(body.system[0]?.text).toBe(p.text);
    expect(body.messages.at(-1)).toEqual({ role: 'system', content: 'Bugün 2026-11-03. Mod: ipucu.' });
  });
});
