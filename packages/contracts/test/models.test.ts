import { describe, expect, it } from 'vitest';
import { loadModels } from '../src/index.js';

const models = loadModels();
const WORKER_CHAINS = ['chat', 'chat_free_only', 'embedding'];

describe('models.json', () => {
  it('şemaya uyar ve verified_at taşır', () => {
    expect(models.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(models.currency).toBe('USD');
  });

  it('her zincir öğesi tanımlı bir model, her model tanımlı bir sağlayıcı', () => {
    for (const [chain, list] of Object.entries(models.chains)) {
      for (const m of list) expect(models.models, `${chain}: ${m}`).toHaveProperty([m]);
    }
    for (const [name, m] of Object.entries(models.models)) expect(models.providers, name).toHaveProperty([String(m?.provider)]);
  });

  it('ücretsiz Gemini katmanı veriyi eğitimde kullanır ve sohbette ilk sırada değildir', () => {
    expect(models.providers['gemini-free']?.trains_on_data).toBe(true);
    expect(models.models[models.chains.chat[0] as string]?.provider).toBe('gemini-paid');
  });

  it('chat_free_only zinciri yalnız ücretsiz modellerden oluşur', () => {
    for (const m of models.chains.chat_free_only) {
      const model = models.models[m];
      expect(model?.in_per_m, m).toBe(0);
      expect(model?.out_per_m, m).toBe(0);
    }
  });

  it('uzun bağlamlı amaçlar yalnız Gemini zincirlerinde (8k bağlamlı Groq/Cloudflare yok)', () => {
    for (const chain of ['research', 'lesson_analysis', 'nightly_facts'] as const) {
      for (const m of models.chains[chain]) {
        const ctx = models.models[m]?.ctx ?? 0;
        expect(ctx, `${chain}: ${m}`).toBeGreaterThanOrEqual(200000);
      }
    }
  });

  it('Worker zincirlerinde güçlü model yok', () => {
    for (const chain of WORKER_CHAINS) {
      const list = (models.chains as Record<string, string[]>)[chain] ?? [];
      expect(list).not.toContain('gemini-2.5-pro');
      expect(list).not.toContain('claude-sonnet-4-5');
    }
  });

  it('Anthropic sağlayıcısı ve modeli kapalı', () => {
    expect(models.providers.anthropic?.enabled).toBe(false);
    expect(models.models['claude-sonnet-4-5']?.enabled).toBe(false);
  });

  it('maliyet kuralları: hedef ≤ tavan', () => {
    expect(models.cost_rules.chat_target_usd).toBeLessThanOrEqual(models.cost_rules.chat_turn_max_usd);
  });

  it('loadModels kopya döner (çağıran değiştirse de kaynak bozulmaz)', () => {
    const a = loadModels();
    a.chains.chat.length = 0;
    expect(loadModels().chains.chat.length).toBeGreaterThan(0);
  });
});
