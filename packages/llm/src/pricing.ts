/**
 * Model başına $/MTok fiyatları ve maliyet hesabı (claude-api skill: shared/models.md, shared/model-migration.md,
 * shared/prompt-caching.md; 2026-11 itibarıyla).
 *
 *   Opus 5.5    giriş 4, çıkış 20; önbellek okuma 0.05× (0.20), yazma 5 dk 1.25×, 1 sa 2×
 *   Sonnet 5.5  giriş 2, çıkış 10; okuma 0.1× (0.20), yazma 1.25× / 2×
 *   Haiku 5.5   ≤100K token istem: 0.10 / 0.50; üstü: 0.50 / 2.50; okuma 0.1×, yazma 1.25× / 2×
 *   Batch       tüm token kalemleri 0.5×
 *
 * Sunucu taraflı yedek (fallbacks) başka bir modelde koşabilir; `usage.iterations` her denemeyi kendi
 * modeliyle verir, maliyet deneme başına o modelin fiyatıyla toplanır. Yedek modeller (Opus 5, Opus 4.8,
 * Sonnet 5) da tabloda.
 */
import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages';

export interface RateCard {
  input: number;
  output: number;
  /** Önbellek okuma çarpanı (giriş fiyatına göre). */
  cacheRead: number;
  /** 5 dakikalık önbellek yazma çarpanı. */
  cacheWrite5m: number;
  /** 1 saatlik önbellek yazma çarpanı. */
  cacheWrite1h: number;
}

export interface ModelPricing {
  /** İstem (toplam giriş) bu eşiğin üstündeyse `long` kartı geçerli (yalnız Haiku 5.5). */
  longContextThreshold?: number;
  base: RateCard;
  long?: RateCard;
}

const card = (input: number, output: number, cacheRead = 0.1): RateCard => ({
  input,
  output,
  cacheRead,
  cacheWrite5m: 1.25,
  cacheWrite1h: 2,
});

export const PRICING: Record<string, ModelPricing> = {
  'claude-opus-5-5': { base: card(4, 20, 0.05) },
  'claude-sonnet-5-5': { base: card(2, 10, 0.1) },
  'claude-haiku-5-5': { longContextThreshold: 100_000, base: card(0.1, 0.5, 0.1), long: card(0.5, 2.5, 0.1) },
  // Sunucu taraflı yedek hedefleri (fallbacks:"default"): kendi fiyatlarıyla faturalanır.
  'claude-opus-5': { base: card(5, 25, 0.1) },
  'claude-opus-4-8': { base: card(5, 25, 0.1) },
  'claude-sonnet-5': { base: card(2, 10, 0.1) },
};

export const BATCH_DISCOUNT = 0.5;

export interface TokenUsage {
  /** Önbelleksiz giriş token'ları. */
  input: number;
  output: number;
  cacheRead: number;
  /** 5 dakikalık önbellek yazımı. */
  cacheWrite5m: number;
  /** 1 saatlik önbellek yazımı. */
  cacheWrite1h: number;
}

export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };

export function pricingFor(model: string): ModelPricing {
  const p = PRICING[model];
  if (!p) throw new Error(`OGR-LLM-007 fiyat tablosunda model yok: ${model}`);
  return p;
}

/** Tek bir denemenin maliyeti (USD). `batch`: Batches API'de 0.5×. */
export function costUsd(model: string, u: TokenUsage, opts: { batch?: boolean } = {}): number {
  const p = pricingFor(model);
  const promptTokens = u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
  const c = p.long && p.longContextThreshold !== undefined && promptTokens > p.longContextThreshold ? p.long : p.base;
  const perTok = 1 / 1_000_000;
  const usd =
    u.input * c.input * perTok +
    u.output * c.output * perTok +
    u.cacheRead * c.input * c.cacheRead * perTok +
    u.cacheWrite5m * c.input * c.cacheWrite5m * perTok +
    u.cacheWrite1h * c.input * c.cacheWrite1h * perTok;
  return round6(opts.batch ? usd * BATCH_DISCOUNT : usd);
}

/** `numeric(10,6)` sütununa yazılacak hassasiyet. */
export function round6(x: number): number {
  return Math.round(x * 1_000_000) / 1_000_000;
}

type CacheCreation = { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null | undefined;

function splitWrites(total: number, cc: CacheCreation): { w5: number; w1: number } {
  if (cc && cc.ephemeral_5m_input_tokens + cc.ephemeral_1h_input_tokens > 0) {
    return { w5: cc.ephemeral_5m_input_tokens, w1: cc.ephemeral_1h_input_tokens };
  }
  // Ayrıntı yoksa yazımlar 5 dakikalık sayılır (alt sınır).
  return { w5: total, w1: 0 };
}

/** API `usage` nesnesini toplam token kalemlerine çevirir. */
export function usageFromApi(usage: Pick<BetaUsage, 'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens' | 'cache_creation'>): TokenUsage {
  const { w5, w1 } = splitWrites(usage.cache_creation_input_tokens ?? 0, usage.cache_creation);
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite5m: w5,
    cacheWrite1h: w1,
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  };
}

/**
 * Bir yanıtın maliyeti. `usage.iterations` varsa (yedek modeller, reddedilen denemeler) her deneme kendi
 * modelinin fiyatıyla toplanır; yoksa üst düzey `usage` istenen modelle fiyatlanır.
 */
export function messageCost(
  requestedModel: string,
  usage: BetaUsage,
  opts: { batch?: boolean } = {},
): { usage: TokenUsage; costUsd: number } {
  const iters = (usage.iterations ?? []).filter(
    (it): it is Extract<NonNullable<BetaUsage['iterations']>[number], { type: 'message' | 'fallback_message' }> =>
      it.type === 'message' || it.type === 'fallback_message',
  );
  if (iters.length === 0) {
    const u = usageFromApi(usage);
    return { usage: u, costUsd: costUsd(requestedModel, u, opts) };
  }
  let total = ZERO_USAGE;
  let cost = 0;
  for (const it of iters) {
    const u = usageFromApi(it);
    total = addUsage(total, u);
    const model = it.model && PRICING[it.model] ? it.model : requestedModel;
    cost += costUsd(model, u, opts);
  }
  return { usage: total, costUsd: round6(cost) };
}
