/**
 * Harcama kapısı (packages/llm `checkSpend` → public.check_spend) worker işleri için. Sahte taşıma ücretsizdir; kapı
 * yalnız gerçek taşımada okunur. Okunamazsa kapalı sayılır (fail closed).
 *   - `allowed === false` → model çağrılmaz; iş komşularının "ücretli LLM kapalı" yoluyla biter (PermanentJobError,
 *     atlama ya da deterministik yedek).
 *   - `downgrade === true` → arka plan/ucuz işler çalışır; kullanıcı tetikli pahalı üretim işleri (document.generate,
 *     practice.generate, style.question_gen, report.generate) aynı "şu an çalışamaz" sonucuyla `spend_cap` gerekçesiyle biter.
 */
import { checkSpend, pgSpendQuery, type Gateway, type SpendDecision } from '@ogrenmen/llm';
import { PermanentJobError } from './errors.js';
import type { JobContext } from './types.js';

export const SPEND_CAP_REASON = 'spend_cap' as const;
export const SPEND_BLOCKED_REASON = 'spend_blocked' as const;
export type SpendBlockReason = typeof SPEND_CAP_REASON | typeof SPEND_BLOCKED_REASON;

export async function spendGate(ctx: Pick<JobContext, 'db'>, gateway: Gateway, purpose: string, studentRef?: string | null): Promise<SpendDecision> {
  if (gateway.transport.kind === 'fake') return { allowed: true, downgrade: false, state: 'fake' };
  return checkSpend(pgSpendQuery(ctx.db), purpose, studentRef);
}

/** Tavanda çalışmayan pahalı üretim işleri: kapalı → spend_blocked, downgrade → spend_cap, yoksa null. */
export function generationBlock(d: SpendDecision): SpendBlockReason | null {
  if (!d.allowed) return SPEND_BLOCKED_REASON;
  if (d.downgrade) return SPEND_CAP_REASON;
  return null;
}

/** Kapı ücretli çağrıyı kapattı (kalıcı; gerekçe `reason` alanında). */
export class SpendGateError extends PermanentJobError {
  constructor(
    readonly reason: SpendBlockReason,
    readonly state: string,
    code = 'OGR-JOB-184',
  ) {
    super(`${reason}: ücretli LLM çağrısı şu an yapılamıyor (${state})`, code);
  }
}

/** allowed === false ise fırlatır (downgrade'de çalışan işler için). */
export async function assertSpend(ctx: Pick<JobContext, 'db'>, gateway: Gateway, purpose: string, studentRef?: string | null): Promise<SpendDecision> {
  const d = await spendGate(ctx, gateway, purpose, studentRef);
  if (!d.allowed) throw new SpendGateError(SPEND_BLOCKED_REASON, d.state);
  return d;
}
