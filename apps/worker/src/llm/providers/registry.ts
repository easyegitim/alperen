/**
 * Gerçek sağlayıcı kümesi: anahtarı olmayan sağlayıcı zincirden `console.warn` ile çıkar (yapılandırma
 * hatası değil). Zincir boşsa ve ADAPTERS≠fake ise /health kırmızıdır.
 */
import type { Env } from '../../env.ts';
import type { FetchFn } from '../../telegram/client.ts';
import { providerInfo } from '../cost.ts';
import { GeminiProvider } from './gemini.ts';
import { OpenAiCompatibleProvider } from './openai-compatible.ts';
import { WorkersAiProvider } from './workers-ai.ts';
import type { Provider } from './types.ts';

function key(env: Env, name: string): string {
  const v = env[name];
  return typeof v === 'string' ? v.trim() : '';
}

export function buildProviders(env: Env, fetchFn: FetchFn): Map<string, Provider> {
  const out = new Map<string, Provider>();
  const warn = (provider: string): void => console.warn(JSON.stringify({ lvl: 'warn', evt: 'provider_missing', provider }));
  for (const id of ['gemini-paid', 'gemini-free'] as const) {
    const k = key(env, id === 'gemini-paid' ? 'GEMINI_PAID_KEY' : 'GEMINI_FREE_KEY');
    if (k === '') warn(id);
    else out.set(id, new GeminiProvider({ id, base: providerInfo(id)?.base ?? 'https://generativelanguage.googleapis.com/v1beta', apiKey: k, fetch: fetchFn }));
  }
  for (const id of ['groq', 'openrouter'] as const) {
    const k = key(env, id === 'groq' ? 'GROQ_KEY' : 'OPENROUTER_KEY');
    if (k === '') warn(id);
    else out.set(id, new OpenAiCompatibleProvider({ id, base: providerInfo(id)?.base ?? '', apiKey: k, fetch: fetchFn }));
  }
  const cf = WorkersAiProvider.create({ binding: env.AI, restBase: providerInfo('cf-ai')?.rest_base, token: key(env, 'CF_AI_TOKEN'), accountId: key(env, 'CF_ACCOUNT_ID'), fetch: fetchFn });
  if (cf !== null) out.set('cf-ai', cf);
  return out;
}
