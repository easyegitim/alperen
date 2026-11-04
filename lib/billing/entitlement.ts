// SPEC 15.2. Tarayıcıdan gelen hiçbir bilgi premium açmaz; yalnız subscriptions / purchases satırları.
// Saf modül (sunucu ve test; "server-only" yok). Veritabanı okumaları lib/billing/purchases.ts'te.
import { isFeatureEnabled } from "@/lib/config/flags";
import { ENTITLEMENTS_V2, type ProductId } from "@/lib/config/plans";
import type { AccessV2 } from "@/lib/score/present";

export function isPremium(sub?: { status: string; current_period_end: string | null } | null, now: Date = new Date()): boolean {
  if (!sub?.current_period_end) return false;
  return ["active", "past_due"].includes(sub.status) && new Date(sub.current_period_end) > now;
}

/** Test hesapları (profiles.unlimited_quota) için fiilen sınırsız limit; SQL fonksiyonları int bekler. */
export const UNLIMITED_LIMIT = 1_000_000;

export function effectiveLimit(base: number, unlimited: boolean): number {
  return unlimited ? UNLIMITED_LIMIT : base;
}

// ─── v2 haklar (CONTRACTS_V2 §2.3 "Hak kaynakları", §3.4; KB Ç12) ───────────────────────────────────────────────────

/** purchases satırının karar için gereken kısmı (lib/db/types.ts DatabaseV2Mirror purchases). */
export type PurchaseLike = {
  id: string;
  product: ProductId | string;
  analysis_id: string | null;
  status: string;
  /** Tüketildiği an (migration 0012). analysis_id FK "set null" olduğundan analiz silinse de dolu kalır; dolu → yeniden kullanılmaz. */
  consumed_at?: string | null;
};

export type AccessDetail = AccessV2 & {
  /** Aktif abonelik (kota kayan pencereyle); false ise hak tek seferlik rapordan gelir. */
  subscriptionActive: boolean;
  /** Bu analiz için tüketilecek (henüz bağlanmamış) ödenmiş tek seferlik satın alma; sunucu bağlar. */
  unconsumedOneTimeId: string | null;
};

const paidOneTime = (purchases: readonly PurchaseLike[]) => purchases.filter((p) => p.status === "paid" && p.product === "one_time_report");
/** Henüz hiçbir analize bağlanmamış ve tüketilmemiş ödenmiş rapor (bağlama başarısız olmuş nadir durum; sunucu bir sonraki işe bağlar). */
const isUnconsumed = (p: PurchaseLike) => p.analysis_id === null && !p.consumed_at;

/**
 * Bu analiz için hak var mı? YALNIZ aktif abonelik ya da bu analize bağlı ödenmiş tek seferlik rapor (CONTRACTS_V2 §2.3).
 * Bağlanmamış satın alma tek başına hiçbir satırı AÇMAZ; yalnız yeni bir işi başlatırken (bağlanırken) kullanılır
 * (canConsumePurchaseFor). Aksi hâlde tek bir bağlanmamış satın alma kullanıcının tüm eski satırlarını açıyordu.
 */
export function isEntitledForAnalysis(state: { subscriptionActive: boolean; purchases: readonly PurchaseLike[] }, analysisId: string | null): boolean {
  if (state.subscriptionActive) return true;
  if (!analysisId) return false;
  return paidOneTime(state.purchases).some((p) => p.analysis_id === analysisId);
}

/** Satırın durumu; bağlanmamış satın alma yalnız henüz tam analizi yapılmamış satırlara bağlanabilir. */
export const CONSUMABLE_STATUSES: ReadonlySet<string> = new Set(["device_only", "queued", "failed"]);

/**
 * Bu satır için iş başlatılabilir mi: hak var ya da bağlanacak satın alma var ve satır henüz tam analiz görmemiş
 * (device_only / queued / failed). Sunucu bağlamayı işten ÖNCE yapar; bağlanamazsa iş başlamaz.
 */
export function canConsumePurchaseFor(access: Pick<AccessDetail, "entitled" | "unconsumedOneTimeId">, rowStatus: string): boolean {
  if (access.entitled) return true;
  return access.unconsumedOneTimeId !== null && CONSUMABLE_STATUSES.has(rowStatus);
}

/** 5 davet tamamlandı mı (yalnız FEATURE_REFERRAL_UNLOCK açıkken; cihaz doğrulaması AÇIK §11.15). */
export function referralUnlocked(referralsCompleted: number, env: Record<string, string | undefined> = process.env): boolean {
  return isFeatureEnabled("referralUnlock", env) && referralsCompleted >= ENTITLEMENTS_V2.referral.invitesRequired;
}

/** Saf karar: AccessV2 + sunucunun bağlayacağı satın alma. Kaynak yalnız sunucu satırlarıdır. */
export function decideAccess(args: {
  subscriptionActive: boolean;
  purchases: readonly PurchaseLike[];
  analysisId: string | null;
  referralsCompleted: number;
  env?: Record<string, string | undefined>;
}): AccessDetail {
  const env = args.env ?? process.env;
  const paid = paidOneTime(args.purchases);
  const bound = args.analysisId ? paid.find((p) => p.analysis_id === args.analysisId) : undefined;
  const unconsumed = paid.find(isUnconsumed);
  return {
    entitled: isEntitledForAnalysis({ subscriptionActive: args.subscriptionActive, purchases: args.purchases }, args.analysisId),
    referralUnlock: referralUnlocked(args.referralsCompleted, env),
    percentile: isFeatureEnabled("percentile", env),
    subscriptionActive: args.subscriptionActive,
    unconsumedOneTimeId: !args.subscriptionActive && !bound && unconsumed ? unconsumed.id : null,
  };
}
