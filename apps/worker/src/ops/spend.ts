/**
 * Tavan durum makinesi (§5.6): kaynak `check_spend` RPC'si, 60 sn bellek içi önbellek (en çok
 * ≈ 0,015 $ sapma). `normal` → chains.chat; `free_only` → chains.chat_free_only; `degraded` → LLM yok.
 * Gün/ay toplamları `cap_excluded_purposes` (ders analizi) HARİÇTİR — ders harcaması sohbeti indirmez.
 */
import type { Db, SpendState } from '../data/repo.ts';

export const SPEND_CACHE_MS = 60_000;

export class SpendGate {
  private cache = new Map<string, { at: number; value: SpendState }>();
  constructor(private readonly now: () => Date) {}

  async state(db: Db, purpose = 'chat'): Promise<SpendState> {
    const t = this.now().getTime();
    const hit = this.cache.get(purpose);
    if (hit && t - hit.at < SPEND_CACHE_MS) return hit.value;
    const value = await db.checkSpend(purpose);
    this.cache.set(purpose, { at: t, value });
    return value;
  }

  invalidate(): void {
    this.cache.clear();
  }
}

export function chainForState(state: SpendState['state']): 'chat' | 'chat_free_only' | null {
  if (state === 'normal') return 'chat';
  if (state === 'free_only') return 'chat_free_only';
  return null;
}
