/**
 * Harcama kapısı (supabase/migrations/0017_rpc.sql `public.check_spend`): her ücretli model çağrısından önce okunur.
 *   - `allowed` = paid_allowed (paid_llm_enabled ve degraded_mode değil). false → model çağrılmaz.
 *   - `downgrade` = yumuşak tavan aşıldı: koç Haiku'ya iner (`coach_lite`), pahalı üretim işleri bekletilir.
 * Kapalı başarısızlık: sorgu hata verirse ya da satır dönmezse `{allowed: false, downgrade: false, state: 'unknown'}`.
 * Worker `pgSpendQuery(pool)`, web `rpcSpendQuery(supabase)` ile aynı yardımcıyı kullanır.
 */
import type { PgQueryable, RpcClientLike } from './ledger.js';

export interface SpendDecision {
  allowed: boolean;
  downgrade: boolean;
  /** check_spend.state (normal | soft_cap | student_cap | degraded | disabled) ya da `unknown` (okunamadı). */
  state: string;
}

/** check_spend satır(lar)ını döner: dizi ya da tek satır. Hata fırlatabilir. */
export type SpendQuery = (purpose: string, studentRef: string | null) => PromiseLike<unknown>;

export const SPEND_UNKNOWN: SpendDecision = Object.freeze({ allowed: false, downgrade: false, state: 'unknown' }) as SpendDecision;

export async function checkSpend(query: SpendQuery, purpose: string, studentRef?: string | null): Promise<SpendDecision> {
  try {
    const out = await query(purpose, studentRef ?? null);
    const row = (Array.isArray(out) ? out[0] : out) as { paid_allowed?: unknown; downgrade?: unknown; state?: unknown } | null | undefined;
    if (!row || typeof row !== 'object' || typeof row.paid_allowed !== 'boolean') throw new Error('check_spend satır döndürmedi');
    return { allowed: row.paid_allowed, downgrade: row.downgrade === true, state: typeof row.state === 'string' ? row.state : 'unknown' };
  } catch (err) {
    console.error(`OGR-LLM-011 harcama kapısı okunamadı (${purpose}); ücretli çağrı kapalı sayıldı`, err);
    return { ...SPEND_UNKNOWN };
  }
}

/** Worker: `pg` havuzu/istemcisi. */
export function pgSpendQuery(db: PgQueryable): SpendQuery {
  return async (purpose, studentRef) =>
    (await db.query('select paid_allowed, downgrade, state from public.check_spend($1, $2)', [purpose, studentRef])).rows;
}

/** Web: kullanıcının JWT'li supabase-js istemcisi (`rpc('check_spend')`). */
export function rpcSpendQuery(client: RpcClientLike): SpendQuery {
  return async (purpose, studentRef) => {
    const { data, error } = await client.rpc('check_spend', { p_purpose: purpose, p_student_ref: studentRef });
    if (error) throw new Error(`check_spend: ${error.message}`);
    return data;
  };
}
