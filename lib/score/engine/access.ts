import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isPremium } from "@/lib/billing/entitlement";
import { ENTITLEMENTS_V2 } from "@/lib/config/plans";
import { isFeatureEnabled } from "@/lib/config/flags";
import type { AccessV2 } from "@/lib/score/present";

// AccessV2 hesabı (CONTRACTS_V2 §2.3 "Hak kaynakları", §3.4). Geçici W3 uygulaması: W2 lib/billing/entitlement.ts'te
// kalıcı sürümü yazınca rotalar oraya geçer. Kaynak yalnız sunucu satırlarıdır: subscriptions (webhook), purchases
// (webhook/doğrulama), referrals. Tarayıcıdan gelen "ödeme başarılı" hiçbir şeyi açmaz.

export type Purchase = { id: string; product: string; analysis_id: string | null; status: string };

export type AccessDetail = AccessV2 & {
  /** Aktif abonelik (kota kayan pencereyle); false ise hak tek seferlik rapordan gelir. */
  subscriptionActive: boolean;
  /** Bu analiz için tüketilecek (henüz bağlanmamış) tek seferlik satın alma; sunucu bağlar. */
  unconsumedOneTimeId: string | null;
};

/** Saf karar: abonelik aktif, bu analize bağlı ödenmiş tek seferlik rapor ya da henüz bağlanmamış tek seferlik rapor. */
export function decideAccess(args: { subscriptionActive: boolean; purchases: readonly Purchase[]; analysisId: string | null; referralsCompleted: number; env: Record<string, string | undefined> }): AccessDetail {
  const paid = args.purchases.filter((p) => p.status === "paid" && p.product === "one_time_report");
  const bound = args.analysisId ? paid.find((p) => p.analysis_id === args.analysisId) : undefined;
  const unconsumed = paid.find((p) => p.analysis_id === null);
  const entitled = args.subscriptionActive || Boolean(bound) || Boolean(unconsumed);
  return {
    entitled,
    referralUnlock: isFeatureEnabled("referralUnlock", args.env) && args.referralsCompleted >= ENTITLEMENTS_V2.referral.invitesRequired,
    percentile: isFeatureEnabled("percentile", args.env),
    subscriptionActive: args.subscriptionActive,
    unconsumedOneTimeId: !args.subscriptionActive && !bound && unconsumed ? unconsumed.id : null,
  };
}

export async function getAccessV2(admin: SupabaseClient, userId: string, analysisId: string | null, env: Record<string, string | undefined> = process.env): Promise<AccessDetail> {
  const [sub, purchases, referrals] = await Promise.all([
    admin.from("subscriptions").select("status, current_period_end").eq("user_id", userId).maybeSingle(),
    admin.from("purchases").select("id, product, analysis_id, status").eq("user_id", userId).eq("status", "paid"),
    isFeatureEnabled("referralUnlock", env)
      ? admin.from("referrals").select("id", { count: "exact", head: true }).eq("referrer_id", userId).not("photo_submitted_at", "is", null)
      : Promise.resolve({ count: 0 }),
  ]);
  const subscriptionActive = isPremium(sub.data ? { status: String(sub.data.status), current_period_end: sub.data.current_period_end ?? null } : null);
  const rows = ((purchases.data as Purchase[] | null) ?? []).map((p) => ({ id: String(p.id), product: String(p.product), analysis_id: p.analysis_id ? String(p.analysis_id) : null, status: String(p.status) }));
  return decideAccess({ subscriptionActive, purchases: rows, analysisId, referralsCompleted: referrals.count ?? 0, env });
}

/** Tek seferlik raporu bu analize bağlar (tekil indeks; yarışta ikinci bağlama hata verir ve yok sayılır). */
export async function bindOneTimePurchase(admin: SupabaseClient, purchaseId: string, analysisId: string): Promise<void> {
  const { error } = await admin.from("purchases").update({ analysis_id: analysisId }).eq("id", purchaseId).is("analysis_id", null);
  if (error) console.warn(`[access] purchase bind failed: ${error.code ?? "?"}`);
}
