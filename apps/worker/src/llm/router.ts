/**
 * LLM yönlendirici (§5.6): zincir sırayla denenir. 429 / 5xx / zaman aşımı (8 sn) / ağ hatası → sonraki;
 * şema dışı çıktı → aynı sağlayıcıda 1 onarım, sonra sonraki; 400/401/403 bir YAPILANDIRMA hatasıdır:
 * kurucuya DM, sağlayıcı gün sonuna kadar cooldown, zincir devam eder (sessiz ücretsiz kaymaya
 * gizlenmez; attempt `status='error', error_code='config_401'`). Cooldown'daki sağlayıcı çağrılmaz
 * (`cooldown_skip`, maliyet 0). Her deneme `provider_attempts` satırıdır.
 */
import type { ProviderHealthRow } from '../data/repo.ts';
import { addDays, istanbulDay } from '../util.ts';
import { bestEffort } from '../ops/log.ts';
import { chain, costUsd, neurons, neuronsPerDay } from './cost.ts';
import { parseTutorReply, repairInstruction, type TutorReply } from './structured.ts';
import type { CompleteRequest, Msg, Provider } from './providers/types.ts';

export interface ProviderAttempt {
  provider: string;
  model: string;
  status: 'ok' | 'error' | 'rate_limited' | 'timeout' | 'cap_blocked' | 'cooldown_skip' | 'bad_output';
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  error_code: string | null;
}

export interface HealthStore {
  get(provider: string): ProviderHealthRow | undefined;
  update(provider: string, patch: Partial<Omit<ProviderHealthRow, 'provider'>>): Promise<void>;
}

export interface RouterOptions {
  providers: ReadonlyMap<string, Provider>;
  health: HealthStore;
  now: () => Date;
  onConfigError: (provider: string, code: string) => Promise<void>;
  timeoutMs?: number;
}

export interface RouteRequest {
  purpose: string;
  system: string;
  messages: Msg[];
  geminiSchema: Record<string, unknown>;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
}

export type RouteResult =
  | {
      ok: true;
      reply: TutorReply;
      provider: string;
      model: string;
      tokensIn: number;
      tokensOut: number;
      costUsd: number;
      latencyMs: number;
      attempts: ProviderAttempt[];
      repaired: boolean;
    }
  | { ok: false; attempts: ProviderAttempt[]; latencyMs: number; allCooldown: boolean };

const RATE_COOLDOWN_MS = 60_000;
const STREAK_COOLDOWN_MS = 10 * 60_000;

function dayEnd(now: Date): Date {
  return new Date(Date.parse(`${addDays(istanbulDay(now), 1)}T00:00:00Z`) - 3 * 3600_000);
}

export async function routeComplete(chainName: 'chat' | 'chat_free_only', req: RouteRequest, o: RouterOptions): Promise<RouteResult> {
  const attempts: ProviderAttempt[] = [];
  const started = o.now().getTime();
  let tried = 0;
  let skipped = 0;
  for (const link of chain(chainName)) {
    const provider = o.providers.get(link.provider);
    if (provider === undefined) continue;
    tried++;
    const now = o.now();
    const h = o.health.get(link.provider);
    const today = istanbulDay(now);
    const neuronCap = neuronsPerDay(link.provider);
    const neuronsFull = neuronCap > 0 && h?.daily_units_day === today && h.daily_units_used >= neuronCap;
    if ((h?.cooldown_until && Date.parse(h.cooldown_until) > now.getTime()) || neuronsFull) {
      attempts.push({ provider: link.provider, model: link.model, status: 'cooldown_skip', tokens_in: 0, tokens_out: 0, cost_usd: 0, latency_ms: 0, error_code: null });
      skipped++;
      continue;
    }
    let messages = req.messages;
    for (let round = 0; round < 2; round++) {
      const call: CompleteRequest = {
        purpose: req.purpose,
        model: link.model,
        system: req.system,
        messages,
        schema: link.provider.startsWith('gemini') ? req.geminiSchema : req.jsonSchema,
        maxTokens: req.maxTokens,
        temperature: req.temperature,
        timeoutMs: o.timeoutMs ?? 8000,
      };
      const res = await provider.complete(call);
      if (res.ok === false) {
        const errors = (h?.consecutive_errors ?? 0) + 1;
        if (res.error === 'config') {
          const code = `config_${res.status ?? 400}`;
          attempts.push({ provider: link.provider, model: link.model, status: 'error', tokens_in: 0, tokens_out: 0, cost_usd: 0, latency_ms: res.latencyMs ?? 0, error_code: code });
          await o.health.update(link.provider, { cooldown_until: dayEnd(now).toISOString(), consecutive_errors: errors, last_error: code });
          await o.onConfigError(link.provider, code);
        } else if (res.error === 'rate_limited') {
          attempts.push({ provider: link.provider, model: link.model, status: 'rate_limited', tokens_in: 0, tokens_out: 0, cost_usd: 0, latency_ms: res.latencyMs ?? 0, error_code: '429' });
          const wait = errors >= 3 ? STREAK_COOLDOWN_MS : (res.retryAfterMs ?? RATE_COOLDOWN_MS);
          await o.health.update(link.provider, { cooldown_until: new Date(now.getTime() + wait).toISOString(), consecutive_errors: errors, last_error: '429' });
        } else if (res.error === 'bad_output') {
          attempts.push({ provider: link.provider, model: link.model, status: 'bad_output', tokens_in: 0, tokens_out: 0, cost_usd: 0, latency_ms: res.latencyMs ?? 0, error_code: 'empty' });
          if (round === 0) {
            messages = [...req.messages, { role: 'user', content: repairInstruction(['boş yanıt']) }];
            continue;
          }
        } else {
          const status = res.error === 'timeout' ? 'timeout' : 'error';
          attempts.push({ provider: link.provider, model: link.model, status, tokens_in: 0, tokens_out: 0, cost_usd: 0, latency_ms: res.latencyMs ?? 0, error_code: res.status === undefined ? res.error : String(res.status) });
          await o.health.update(link.provider, {
            consecutive_errors: errors,
            last_error: res.error,
            ...(errors >= 3 ? { cooldown_until: new Date(now.getTime() + STREAK_COOLDOWN_MS).toISOString() } : {}),
          });
        }
        break;
      }
      const cost = costUsd(link.model, res.tokensIn, res.tokensOut);
      const parsed = parseTutorReply(res.text);
      if (link.provider === 'cf-ai') {
        const used = (h?.daily_units_day === today ? (h?.daily_units_used ?? 0) : 0) + neurons(link.model, res.tokensIn, res.tokensOut);
        await o.health.update(link.provider, { daily_units_used: used, daily_units_day: today, ...(neuronCap > 0 && used >= neuronCap ? { cooldown_until: dayEnd(now).toISOString() } : {}) });
      }
      if (parsed.ok === false) {
        attempts.push({ provider: link.provider, model: link.model, status: 'bad_output', tokens_in: res.tokensIn, tokens_out: res.tokensOut, cost_usd: cost, latency_ms: res.latencyMs, error_code: 'schema' });
        if (round === 0) {
          messages = [...req.messages, { role: 'assistant', content: res.text }, { role: 'user', content: repairInstruction(parsed.errors) }];
          continue;
        }
        break;
      }
      attempts.push({ provider: link.provider, model: link.model, status: 'ok', tokens_in: res.tokensIn, tokens_out: res.tokensOut, cost_usd: cost, latency_ms: res.latencyMs, error_code: null });
      if ((h?.consecutive_errors ?? 0) > 0) await o.health.update(link.provider, { consecutive_errors: 0, last_error: null });
      const totalIn = attempts.reduce((a, x) => a + x.tokens_in, 0);
      const totalOut = attempts.reduce((a, x) => a + x.tokens_out, 0);
      return {
        ok: true,
        reply: parsed.value,
        provider: link.provider,
        model: link.model,
        tokensIn: totalIn,
        tokensOut: totalOut,
        costUsd: Math.round(attempts.reduce((a, x) => a + x.cost_usd, 0) * 1e9) / 1e9,
        latencyMs: o.now().getTime() - started,
        attempts,
        repaired: round > 0,
      };
    }
  }
  return { ok: false, attempts, latencyMs: o.now().getTime() - started, allCooldown: tried > 0 && skipped === tried };
}

/** `provider_health` anlık görüntüsü + yazım (bir istek boyunca tutarlı). */
export class SnapshotHealthStore implements HealthStore {
  private readonly rows = new Map<string, ProviderHealthRow>();
  constructor(
    rows: readonly ProviderHealthRow[],
    private readonly write: (provider: string, patch: Partial<Omit<ProviderHealthRow, 'provider'>>) => Promise<void>,
  ) {
    for (const r of rows) this.rows.set(r.provider, { ...r });
  }
  get(provider: string): ProviderHealthRow | undefined {
    return this.rows.get(provider);
  }
  async update(provider: string, patch: Partial<Omit<ProviderHealthRow, 'provider'>>): Promise<void> {
    const cur = this.rows.get(provider) ?? { provider, cooldown_until: null, consecutive_errors: 0, daily_units_used: 0, daily_units_day: null, last_error: null };
    this.rows.set(provider, { ...cur, ...patch });
    // En iyi çaba: sağlık yazımı başarısız olsa da (yetki, ağ) düşüş zinciri sürer.
    await bestEffort('provider_health_write_failed', this.write(provider, patch), { provider });
  }
}
