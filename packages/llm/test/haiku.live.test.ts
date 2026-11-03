/**
 * Canlı entegrasyon (OGRENMEN_LIVE=1 ve ANTHROPIC_API_KEY): Haiku 5.5 ile küçük yapılandırılmış çağrı; ikinci
 * çağrıda aynı ≥512 token'lık ürün bloğu önbellekten okunmalı (cache_read_input_tokens > 0). Gerçek API'ye gider.
 */
import { describe, expect, it } from 'vitest';
import { contractRegistry, type Contract } from '@ogrenmen/contracts';
import { AnthropicTransport } from '../src/client.js';
import { Gateway } from '../src/gateway.js';
import { InMemoryLedger } from '../src/ledger.js';
import { PRODUCT } from './helpers.js';

const live = process.env.OGRENMEN_LIVE === '1' && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!live)('canlı: Haiku 5.5 parse + önbellek', () => {
  it('iki çağrı: şemaya uygun çıktı, ikincide cache_read > 0, defterde maliyet', async () => {
    const ledger = new InMemoryLedger();
    const g = new Gateway({ transport: new AnthropicTransport(), ledger });
    const input = (n: number) => ({
      system: { product: PRODUCT },
      user: `Öğrenci deneme ${n}'i bitirdi: 40 sorudan 27 doğru. Veliye kısa bir bildirim metni yaz.`,
      promptVersion: 'live-test',
    });
    const first = await g.call('notification_copy', input(1));
    expect((contractRegistry['notification-copy'] as Contract).isValid(first.data)).toBe(true);
    const second = await g.call('notification_copy', input(2));
    expect((contractRegistry['notification-copy'] as Contract).isValid(second.data)).toBe(true);
    expect(second.message.usage.cache_read_input_tokens ?? 0).toBeGreaterThan(0);
    expect(ledger.rows.length).toBeGreaterThanOrEqual(2);
    expect(ledger.rows.every((r) => r.model === 'claude-haiku-5-5' && r.cost_usd > 0)).toBe(true);
  });

  it('tur bağlamı: role:"system" kabul edilir ya da 400 sonrası <system-reminder> yedeğiyle tek yeniden deneme', async () => {
    const ledger = new InMemoryLedger();
    const g = new Gateway({ transport: new AnthropicTransport(), ledger });
    const res = await g.call('notification_copy', {
      system: { product: PRODUCT },
      user: 'Öğrenci bugün 3 soru çözdü. Veliye kısa bildirim yaz.',
      turn: { date: '2026-11-03', mode: 'hint' },
      promptVersion: 'live-test',
    });
    expect((contractRegistry['notification-copy'] as Contract).isValid(res.data)).toBe(true);
    const statuses = ledger.rows.map((r) => r.status);
    // Belgeler çelişkili (prompt-caching.md Haiku 5.5'i saymıyor, model-migration.md destekliyor): iki sonuç da geçerli.
    expect([['ok'], ['error', 'ok']]).toContainEqual(statuses);
    const usedFallback = statuses.length === 2;
    console.info(`Haiku 5.5 ortadaki sistem mesajı: ${usedFallback ? '400 → <system-reminder> yedeği' : 'destekleniyor'}`);
    expect(res.transcript.some((m) => (m.role as string) === 'system')).toBe(!usedFallback);
  });
});
