import { describe, expect, it } from 'vitest';
import { costUsd, messageCost, usageFromApi, ZERO_USAGE } from '../src/pricing.js';

const M = 1_000_000;

describe('fiyatlandırma', () => {
  it('Opus 5.5: 4 / 20 $/MTok; önbellek okuma 0.05×, yazma 1.25× (5 dk) ve 2× (1 sa)', () => {
    expect(costUsd('claude-opus-5-5', { ...ZERO_USAGE, input: M })).toBe(4);
    expect(costUsd('claude-opus-5-5', { ...ZERO_USAGE, output: M })).toBe(20);
    expect(costUsd('claude-opus-5-5', { ...ZERO_USAGE, cacheRead: M })).toBe(0.2);
    expect(costUsd('claude-opus-5-5', { ...ZERO_USAGE, cacheWrite5m: M })).toBe(5);
    expect(costUsd('claude-opus-5-5', { ...ZERO_USAGE, cacheWrite1h: M })).toBe(8);
  });

  it('Sonnet 5.5: 2 / 10; okuma 0.1× (0.20), yazma 2.50 / 4', () => {
    expect(costUsd('claude-sonnet-5-5', { ...ZERO_USAGE, input: M, output: M })).toBe(12);
    expect(costUsd('claude-sonnet-5-5', { ...ZERO_USAGE, cacheRead: M })).toBe(0.2);
    expect(costUsd('claude-sonnet-5-5', { ...ZERO_USAGE, cacheWrite5m: M })).toBe(2.5);
    expect(costUsd('claude-sonnet-5-5', { ...ZERO_USAGE, cacheWrite1h: M })).toBe(4);
  });

  it('Haiku 5.5: ≤100K istem 0.10 / 0.50, üstü 0.50 / 2.50', () => {
    expect(costUsd('claude-haiku-5-5', { ...ZERO_USAGE, input: 100_000, output: 1000 })).toBeCloseTo(0.01 + 0.0005, 6);
    expect(costUsd('claude-haiku-5-5', { ...ZERO_USAGE, input: 100_001, output: 1000 })).toBeCloseTo(0.0500005 + 0.0025, 6);
    // Eşik toplam istemle (önbellek okuma + yazma dahil) ölçülür.
    expect(costUsd('claude-haiku-5-5', { ...ZERO_USAGE, input: 1000, cacheRead: 150_000 })).toBeCloseTo(0.0005 + 0.0075, 6);
  });

  it('Batch 0.5×', () => {
    expect(costUsd('claude-opus-5-5', { ...ZERO_USAGE, input: M, output: M }, { batch: true })).toBe(12);
    expect(costUsd('claude-sonnet-5-5', { ...ZERO_USAGE, cacheRead: M }, { batch: true })).toBe(0.1);
  });

  it('örnek: çözüm teşhisi (Opus; 3K önbellekten, 2K yeni, 1.5K çıkış)', () => {
    const c = costUsd('claude-opus-5-5', { ...ZERO_USAGE, input: 2000, cacheRead: 3000, output: 1500 });
    expect(c).toBeCloseTo(0.008 + 0.0006 + 0.03, 6);
  });

  it('usage.cache_creation TTL ayrımı; ayrıntı yoksa 5 dk', () => {
    const u = usageFromApi({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 300,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
    });
    expect(u).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite5m: 100, cacheWrite1h: 200 });
    const v = usageFromApi({ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: null, cache_creation_input_tokens: 50, cache_creation: null });
    expect(v.cacheWrite5m).toBe(50);
  });

  it('usage.iterations: her deneme kendi modeliyle fiyatlanır (yedek)', () => {
    const r = messageCost('claude-opus-5-5', {
      input_tokens: 1000,
      output_tokens: 1000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: null,
      fallback_credit: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: 'standard',
      speed: null,
      iterations: [
        { type: 'message', model: 'claude-opus-5-5', input_tokens: M, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
        { type: 'fallback_message', model: 'claude-opus-5', input_tokens: M, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
      ],
    });
    expect(r.costUsd).toBe(9);
    expect(r.usage.input).toBe(2 * M);
  });

  it('bilinmeyen model hata verir', () => {
    expect(() => costUsd('claude-x', ZERO_USAGE)).toThrow(/OGR-LLM-007/);
  });
});
