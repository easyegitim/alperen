import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/config/flags";
import type { ProductId } from "@/lib/config/plans";
import { decideAccess, isPremium, type AccessDetail, type PurchaseLike } from "./entitlement";

// purchases tablosu (migration 0010) ve AccessV2 hesabı (CONTRACTS_V2 §2.3/§3.4). Kaynak yalnız sunucu satırlarıdır:
// subscriptions (webhook/callback), purchases (callback doğrulaması), referrals. Tarayıcıdan gelen "ödeme başarılı"
// hiçbir şeyi açmaz. Service-role istemcisi yalnız lib/db/admin.ts'ten gelir; burada parametre olarak alınır.

type Admin = SupabaseClient;

export type PurchaseRow = PurchaseLike & { user_id: string; provider: string; created_at: string };

/** "Tablo yok" (0010 uygulanmamış) hatası: hak yok sayılır, rota çökmez. */
const MISSING_RELATION = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);
const missing = (e: { code?: string } | null | undefined) => Boolean(e?.code && MISSING_RELATION.has(e.code));

export async function listPaidPurchases(admin: Admin, userId: string): Promise<PurchaseLike[]> {
  const { data, error } = await admin.from("purchases").select("id, product, analysis_id, status").eq("user_id", userId).eq("status", "paid");
  if (error) {
    if (!missing(error)) console.warn(`[purchases] read failed: ${error.code ?? "?"}`);
    return [];
  }
  return ((data as PurchaseLike[] | null) ?? []).map((p) => ({ id: String(p.id), product: String(p.product), analysis_id: p.analysis_id ? String(p.analysis_id) : null, status: String(p.status) }));
}

async function countCompletedReferrals(admin: Admin, userId: string): Promise<number> {
  const { count, error } = await admin.from("referrals").select("id", { count: "exact", head: true }).eq("referrer_id", userId).not("photo_submitted_at", "is", null);
  if (error) return 0;
  return count ?? 0;
}

/** AccessV2 (+ bağlanacak satın alma). Rotalar bunu present'e verir; present yalnız uygular. */
export async function getAccessV2(admin: Admin, userId: string, analysisId: string | null, env: Record<string, string | undefined> = process.env): Promise<AccessDetail> {
  const [sub, purchases, referralsCompleted] = await Promise.all([
    admin.from("subscriptions").select("status, current_period_end").eq("user_id", userId).maybeSingle(),
    listPaidPurchases(admin, userId),
    isFeatureEnabled("referralUnlock", env) ? countCompletedReferrals(admin, userId) : Promise.resolve(0),
  ]);
  const subscriptionActive = isPremium(sub.data ? { status: String(sub.data.status), current_period_end: sub.data.current_period_end ?? null } : null);
  return decideAccess({ subscriptionActive, purchases, analysisId, referralsCompleted, env });
}

/** Tek seferlik raporu bu analize bağlar (tekil indeks; yarışta ikinci bağlama hata verir ve yok sayılır). */
export async function bindOneTimePurchase(admin: Admin, purchaseId: string, analysisId: string): Promise<boolean> {
  const { error } = await admin.from("purchases").update({ analysis_id: analysisId }).eq("id", purchaseId).is("analysis_id", null);
  if (error) {
    console.warn(`[purchases] bind failed: ${error.code ?? "?"}`);
    return false;
  }
  return true;
}

/** Ödeme başlatılırken bekleyen satır; analiz bağı yalnız ödeme doğrulanınca yazılır (tekil indeks başarısız denemeyi kilitlemesin). */
export async function createPendingPurchase(admin: Admin, args: { userId: string; product: ProductId; provider: "iyzico" | "revenuecat" }): Promise<string> {
  const { data, error } = await admin.from("purchases").insert({ user_id: args.userId, product: args.product, provider: args.provider, status: "pending" }).select("id").single();
  if (error || !data) throw new Error("purchase insert failed");
  return String(data.id);
}

/**
 * Ödeme doğrulandı (sağlayıcıdan çekilen durumla; gövdeye güvenilmez): paid + analiz bağı. Analiz zaten başka bir
 * satın almaya bağlıysa tekil indeks bağı reddeder; satır yine paid kalır (hak bağlanmamış satın alma olarak durur).
 */
export async function markPurchasePaid(admin: Admin, purchaseId: string, analysisId: string | null): Promise<void> {
  const { error } = await admin.from("purchases").update({ status: "paid" }).eq("id", purchaseId).eq("status", "pending");
  if (error) throw new Error("purchase update failed");
  if (analysisId) await bindOneTimePurchase(admin, purchaseId, analysisId);
}

export async function markPurchaseFailed(admin: Admin, purchaseId: string): Promise<void> {
  await admin.from("purchases").update({ status: "failed" }).eq("id", purchaseId).eq("status", "pending");
}

/** Bu analize bağlı ödenmiş tek seferlik rapor var mı (checkout'ta mükerrer satışı önlemek için). */
export async function hasPaidOneTimeFor(admin: Admin, userId: string, analysisId: string): Promise<boolean> {
  const paid = await listPaidPurchases(admin, userId);
  return paid.some((p) => p.product === "one_time_report" && p.analysis_id === analysisId);
}
