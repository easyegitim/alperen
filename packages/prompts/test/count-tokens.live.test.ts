/**
 * Canlı: her birleşik promptun gerçek token sayısı (count_tokens, ücretsiz uç) önbellek eşiğini geçer.
 * ANTHROPIC_API_KEY gerekir; check.sh yalnız OGRENMEN_LIVE=1 ve anahtar varken koşar.
 */
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { allPrompts, MIN_CACHEABLE_TOKENS } from '../src/index.js';

describe('count_tokens (canlı)', () => {
  it('her prompt ≥ 512 token ve tahmin gerçek sayının altında kalır', async () => {
    const client = new Anthropic();
    for (const p of allPrompts()) {
      const res = await client.beta.messages.countTokens({
        model: p.meta.model,
        system: [{ type: 'text', text: p.text }],
        messages: [{ role: 'user', content: '.' }],
      });
      const id = `${p.meta.route}@${p.meta.version}`;
      expect(res.input_tokens, id).toBeGreaterThanOrEqual(MIN_CACHEABLE_TOKENS);
      // Karakter/4 tahmini Türkçede alt sınır gibi davranmalı (registry.ts estimateTokens).
      expect(p.estimatedTokens, id).toBeLessThanOrEqual(res.input_tokens);
    }
  });
});
