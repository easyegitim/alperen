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
  // 0012 (consumed_at) uygulanmamışsa eski sütun listesine düşer; tüketim o zaman yalnız analysis_id ile bilinir.
  const query = (cols: string) => admin.from("purchases").select(cols).eq("user_id", userId).eq("status", "paid");
  let res: { data: unknown; error: { code?: string } | null } = await query("id, product, analysis_id, status, consumed_at");
  if (res.error && missing(res.error)) res = await query("id, product, analysis_id, status");
  const { data, error } = res;
  if (error) {
    if (!missing(error)) console.warn(`[purchases] read failed: ${error.code ?? "?"}`);
    return [];
  }
  return ((data as PurchaseLike[] | null) ?? []).map((p) => ({
    id: String(p.id),
    product: String(p.product),
    analysis_id: p.analysis_id ? String(p.analysis_id) : null,
    status: String(p.status),
    consumed_at: typeof p.consumed_at === "string" ? p.consumed_at : null,
  }));
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

/**
 * Tek seferlik raporu bu analize bağlar ve tüketilmiş işaretler (consumed_at, 0012). Tekil indeks: yarışta ikinci bağlama
 * hata verir ve false döner. Yalnız analysis_id null ve consumed_at boş satır bağlanır; etkilenen satır yoksa false.
 */
export async function bindOneTimePurchase(admin: Admin, purchaseId: string, analysisId: string): Promise<boolean> {
  const now = new Date().toISOString();
  let res = await admin.from("purchases").update({ analysis_id: analysisId, consumed_at: now }).eq("id", purchaseId).is("analysis_id", null).is("consumed_at", null).select("id");
  if (res.error && missing(res.error)) res = await admin.from("purchases").update({ analysis_id: analysisId }).eq("id", purchaseId).is("analysis_id", null).select("id");
  if (res.error) {
    console.warn(`[purchases] bind failed: ${res.error.code ?? "?"}`);
    return false;
  }
  return Array.isArray(res.data) && res.data.length > 0;
}

/**
 * Rıza geri alma / analiz silme öncesi: bağlı satın almalar tüketilmiş kalır (FK "set null" analysis_id'yi boşaltsa da).
 * 0012 uygulanmamışsa sessizce geçer (sütun yok).
 */
export async function markBoundPurchasesConsumed(admin: Admin, userId: string): Promise<void> {
  const { error } = await admin.from("purchases").update({ consumed_at: new Date().toISOString() }).eq("user_id", userId).not("analysis_id", "is", null).is("consumed_at", null);
  if (error && !missing(error)) console.warn(`[purchases] consume mark failed: ${error.code ?? "?"}`);
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
