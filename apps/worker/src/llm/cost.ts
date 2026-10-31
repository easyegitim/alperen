/**
 * Maliyet tablosu: `models.json` (tek kaynak; kod model adı içermez, zincir adı kullanır — §4.9).
 * cost = tokens_in × in_per_m / 1e6 + tokens_out × out_per_m / 1e6; Workers AI için neuron sayacı.
 */
import models from '@ogrenmen/contracts/models.json';

interface ModelEntry {
  provider: string;
  in_per_m?: number;
  out_per_m?: number;
  neurons_per_1k_tokens?: number;
  enabled?: boolean;
}
interface ProviderEntry {
  kind: string;
  tier?: string;
  key_env?: string;
  neurons_per_day?: number;
  rest_base?: string;
  base?: string;
  enabled?: boolean;
}

const MODELS = (models as unknown as { models: Record<string, ModelEntry> }).models;
const PROVIDERS = (models as unknown as { providers: Record<string, ProviderEntry> }).providers;
const CHAINS = (models as unknown as { chains: Record<string, string[]> }).chains;
export const COST_RULES = (models as unknown as { cost_rules: { chat_budget_tokens_in: number; chat_turn_max_usd: number; chat_target_usd: number } }).cost_rules;

/** Worker'ın kullanabileceği zincirler (güçlü model zinciri reddedilir; §4.9 "strongAllowed: false"). */
export const WORKER_CHAINS = ['chat', 'chat_free_only', 'embedding'] as const;
export type WorkerChain = (typeof WORKER_CHAINS)[number];

export interface ChainEntry {
  model: string;
  provider: string;
}

export function chain(name: string): ChainEntry[] {
  if (!(WORKER_CHAINS as readonly string[]).includes(name)) throw new Error(`OGR-LLM-001 Worker ${name} zincirini kullanamaz`);
  const list = CHAINS[name];
  if (list === undefined) throw new Error(`OGR-LLM-002 models.json'da ${name} zinciri yok`);
  return list
    .map((model) => ({ model, entry: MODELS[model] }))
    .filter((x): x is { model: string; entry: ModelEntry } => x.entry !== undefined && x.entry.enabled !== false)
    .map((x) => ({ model: x.model, provider: x.entry.provider }));
}

export function providerInfo(id: string): ProviderEntry | undefined {
  return PROVIDERS[id];
}

export function isPaidProvider(id: string): boolean {
  return PROVIDERS[id]?.tier === 'paid';
}

export function costUsd(model: string, tokensIn: number, tokensOut: number): number {
  const m = MODELS[model];
  if (m === undefined) return 0;
  const c = (tokensIn * (m.in_per_m ?? 0)) / 1e6 + (tokensOut * (m.out_per_m ?? 0)) / 1e6;
  return Math.round(c * 1e9) / 1e9;
}

export function neurons(model: string, tokensIn: number, tokensOut: number): number {
  const per = MODELS[model]?.neurons_per_1k_tokens ?? 0;
  return Math.ceil(((tokensIn + tokensOut) / 1000) * per);
}

export function neuronsPerDay(provider: string): number {
  return PROVIDERS[provider]?.neurons_per_day ?? 0;
}

/** API'ye giden model adı: `@free` takma eki atılır (aynı model, ücretsiz anahtar). */
export function apiModelName(model: string): string {
  return model.replace(/@free$/, '');
}
