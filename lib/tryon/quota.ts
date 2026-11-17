import "server-only";

import { ENTITLEMENTS } from "@/lib/config/plans";
import { createAdminClient } from "@/lib/db/admin";
import { isUnlimitedQuota } from "@/lib/api/quota";
import { effectiveLimit } from "@/lib/billing/entitlement";
import { isMissingColumnError } from "@/lib/score/rowColumns";

type Row = { created_at: string; weight?: number | null };

/**
 * Kayan 7 günde kullanılan deneme hakkı: pending + success satırlarının ağırlık toplamı (reserve_tryon v2, migration 0014;
 * failed / identity_drift / qc_failed sayılmaz — hak iade, Ç10). 0014 uygulanmamış ortamda weight sütunu yoktur: satır sayılır.
 */
export async function tryonUsage(userId: string): Promise<{ used: number; limit: number; windowDays: number; since: string; nextAt: string | null }> {
  const admin = createAdminClient();
  const { windowDays } = ENTITLEMENTS.premium;
  const tryonsPerWindow = effectiveLimit(ENTITLEMENTS.premium.tryonsPerWindow, await isUnlimitedQuota(admin, userId));
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const base = () => admin.from("tryon_events").select("created_at, weight").eq("user_id", userId).in("status", ["pending", "success"]).gte("created_at", since).order("created_at", { ascending: true });
  let res: { data: unknown; error: { code?: string } | null } = await base();
  if (res.error && isMissingColumnError(res.error)) {
    res = await admin.from("tryon_events").select("created_at").eq("user_id", userId).in("status", ["pending", "success"]).gte("created_at", since).order("created_at", { ascending: true });
  }
  const rows = (Array.isArray(res.data) ? res.data : []) as Row[];
  const used = sumWeights(rows);
  const nextAt = used >= tryonsPerWindow && rows.length ? new Date(new Date(String(rows[0].created_at)).getTime() + windowDays * 86_400_000).toISOString() : null;
  return { used, limit: tryonsPerWindow, windowDays, since, nextAt };
}

/** Saf: ağırlık toplamı; weight yoksa 1 (eski satır). */
export function sumWeights(rows: readonly { weight?: number | null }[]): number {
  return rows.reduce((acc, r) => acc + (typeof r.weight === "number" && r.weight > 0 ? r.weight : 1), 0);
}
