import { afterEach, describe, expect, it } from 'vitest';
import { assertNotFakeInProduction } from '../src/client.js';

const saved = { NODE_ENV: process.env.NODE_ENV, OGRENMEN_LLM: process.env.OGRENMEN_LLM };

function restore(): void {
  for (const k of ['NODE_ENV', 'OGRENMEN_LLM'] as const) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

describe('üretimde sahte taşıma yasağı', () => {
  afterEach(restore);

  it('NODE_ENV=production ve OGRENMEN_LLM=fake → OGR-LLM-012', () => {
    process.env.NODE_ENV = 'production';
    process.env.OGRENMEN_LLM = 'fake';
    expect(() => assertNotFakeInProduction()).toThrow('OGR-LLM-012');
  });

  it('üretim dışında ya da gerçek taşımada hata yok', () => {
    process.env.NODE_ENV = 'test';
    process.env.OGRENMEN_LLM = 'fake';
    expect(() => assertNotFakeInProduction()).not.toThrow();
    process.env.NODE_ENV = 'production';
    process.env.OGRENMEN_LLM = 'anthropic';
    expect(() => assertNotFakeInProduction()).not.toThrow();
  });
});
