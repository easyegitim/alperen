// SPEC 5.1 (KARAR) ve 5.2 (VARSAYILAN). Fiyatlar KDV dahil TL.
export const PLANS = {
  weekly: { priceTry: 250, iyzicoInterval: "WEEKLY", envRef: "IYZICO_PLAN_WEEKLY_REF" },
  monthly: { priceTry: 750, iyzicoInterval: "MONTHLY", envRef: "IYZICO_PLAN_MONTHLY_REF" },
  yearly: { priceTry: 8750, iyzicoInterval: "YEARLY", envRef: "IYZICO_PLAN_YEARLY_REF" },
  week_pass: { priceTry: 250, oneTimeDays: 7, featureFlag: "FEATURE_WEEK_PASS" },
} as const;

export const ENTITLEMENTS = {
  free: { analysesLifetime: 1, tryonsPerWindow: 0, reportRegens: 0 },
  premium: { analysesPerWindow: 1, tryonsPerWindow: 10, reportRegens: 2, windowDays: 7 },
} as const;

export type PlanId = keyof typeof PLANS;
export type SubscriptionPlanId = Exclude<PlanId, "week_pass">;

/** Abonelik planları, arayüzdeki gösterim sırasıyla. */
export const SUBSCRIPTION_PLAN_IDS = ["weekly", "monthly", "yearly"] as const satisfies readonly SubscriptionPlanId[];

/** Paywall'da önceden seçili plan (SPEC 15.2). */
export const DEFAULT_PLAN_ID: SubscriptionPlanId = "yearly";

const WEEKS_PER_PERIOD: Record<SubscriptionPlanId, number> = {
  weekly: 1,
  monthly: 52 / 12,
  yearly: 52,
};

/** Haftalık eşdeğer fiyat (SPEC 5.1 tablosu), tam sayıya yuvarlanır. */
export function weeklyEquivalentTry(plan: SubscriptionPlanId): number {
  return Math.round(PLANS[plan].priceTry / WEEKS_PER_PERIOD[plan]);
}

export function formatTry(amount: number): string {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(amount);
}

// ─── v2 ürünler (KB §3.4 P#18–P#21, §11.1 AÇIK; PLAN_V2 Faz 2; CONTRACTS_V2.md §6) ─────────────────────────────────
// Yukarıdaki PLANS/ENTITLEMENTS eski akış için aynen kalır (checkout, RevenueCat, kota). v2 paywall PRODUCTS'ı kullanır.
// Fiyatlar YER TUTUCUDUR: kurucu kararı gelene kadar `placeholder: true`; gerçek değerler env'den okunur (koda gömülmez).

export const PRODUCT_IDS = ["one_time_report", "weekly", "monthly", "yearly"] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];

export type ProductPrice = {
  /** KDV dahil TL; null = henüz belirlenmedi (paywall "fiyat belirlenecek" durumu gösterir, satış yapılmaz). */
  regularTry: number | null;
  /** Süreli tanıtım fiyatı (P#18, P#20); null = bu üründe tanıtım yok. */
  promoTry: number | null;
  /** true: KB §11.1'e göre karar bekliyor. */
  placeholder: boolean;
};

export type ProductDef = {
  id: ProductId;
  kind: "one_time" | "subscription";
  /** Abonelik dönemi (gün); tek seferlikte null. */
  periodDays: number | null;
  /** Yalnız bayrak açıkken listelenir. */
  featureFlag: "FEATURE_YEARLY_PLAN" | null;
  /** Tanıtım ve normal fiyat ayrı sağlayıcı ürün kimlikleridir (P#18 Claude notu); env ad(lar)ı. */
  providerRefEnv: { regular: string; promo: string };
  /** Bu ürünün hakları. */
  grants: ProductGrants;
};

/**
 * Haklar (KB §3.4, Ç10): analysesTotal = tek seferlikte toplam; analysesPerWindow = abonelikte kayan pencere.
 * reportRegens 0: ücretsiz yeniden üretim yok (Ç10). tryons: AÇIK (§11.2) → 0 yer tutucu.
 */
export type ProductGrants =
  | { analysesTotal: number; reports: number; reportRegens: 0; tryons: number }
  | { analysesPerWindow: number; windowDays: number; reportRegens: 0; tryonsPerWindow: number };

export const PRODUCTS: Record<ProductId, ProductDef> = {
  one_time_report: {
    id: "one_time_report",
    kind: "one_time",
    periodDays: null,
    featureFlag: null,
    providerRefEnv: { regular: "IYZICO_PRODUCT_ONE_TIME_REPORT_REF", promo: "IYZICO_PRODUCT_ONE_TIME_REPORT_PROMO_REF" },
    /** Tek analizin tam sonucu + raporu (P#21). Deneme hakkı AÇIK. */
    grants: { analysesTotal: 1, reports: 1, reportRegens: 0, tryons: 0 },
  },
  weekly: {
    id: "weekly",
    kind: "subscription",
    periodDays: 7,
    featureFlag: null,
    providerRefEnv: { regular: "IYZICO_PLAN_WEEKLY_REF", promo: "IYZICO_PLAN_WEEKLY_PROMO_REF" },
    grants: { analysesPerWindow: 1, windowDays: 7, reportRegens: 0, tryonsPerWindow: 10 },
  },
  monthly: {
    id: "monthly",
    kind: "subscription",
    periodDays: 30,
    featureFlag: null,
    providerRefEnv: { regular: "IYZICO_PLAN_MONTHLY_REF", promo: "IYZICO_PLAN_MONTHLY_PROMO_REF" },
    grants: { analysesPerWindow: 1, windowDays: 7, reportRegens: 0, tryonsPerWindow: 10 },
  },
  yearly: {
    id: "yearly",
    kind: "subscription",
    periodDays: 365,
    featureFlag: "FEATURE_YEARLY_PLAN",
    providerRefEnv: { regular: "IYZICO_PLAN_YEARLY_REF", promo: "IYZICO_PLAN_YEARLY_PROMO_REF" },
    grants: { analysesPerWindow: 1, windowDays: 7, reportRegens: 0, tryonsPerWindow: 10 },
  },
};

/** Paywall sırası (P#21: tek seferlik haftalıktan ucuz; yıllık bayrakla). */
export const PRODUCT_ORDER: readonly ProductId[] = ["one_time_report", "weekly", "monthly", "yearly"];

/**
 * Yer tutucu fiyatlar: abonelikler SPEC 5.1 değerlerini korur (mevcut checkout bunları kullanıyor), tek seferlik rapor
 * ve tüm tanıtım fiyatları null (KB §11.1 AÇIK). Env (PRODUCT_PRICE_<ID>_TRY / PRODUCT_PROMO_PRICE_<ID>_TRY) geçersiz kılar.
 */
export const PRODUCT_PRICE_PLACEHOLDERS: Record<ProductId, ProductPrice> = {
  one_time_report: { regularTry: null, promoTry: null, placeholder: true },
  weekly: { regularTry: PLANS.weekly.priceTry, promoTry: null, placeholder: true },
  monthly: { regularTry: PLANS.monthly.priceTry, promoTry: null, placeholder: true },
  yearly: { regularTry: PLANS.yearly.priceTry, promoTry: null, placeholder: true },
};

const priceEnvName = (id: ProductId, promo: boolean) => `PRODUCT_${promo ? "PROMO_PRICE" : "PRICE"}_${id.toUpperCase()}_TRY`;

function readTry(v: string | undefined): number | null | undefined {
  const t = v?.trim();
  if (t === undefined || t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/** Ürün fiyatı: env verilmişse env (placeholder false), yoksa yer tutucu. Asla fırlatmaz. */
export function getProductPrice(id: ProductId, env: Record<string, string | undefined> = process.env): ProductPrice {
  const base = PRODUCT_PRICE_PLACEHOLDERS[id];
  const regular = readTry(env[priceEnvName(id, false)]);
  const promo = readTry(env[priceEnvName(id, true)]);
  if (regular === undefined && promo === undefined) return base;
  return { regularTry: regular ?? base.regularTry, promoTry: promo ?? base.promoTry, placeholder: regular === undefined };
}

/** Listelenecek ürünler: yıllık yalnız FEATURE_YEARLY_PLAN=true iken (sıra PRODUCT_ORDER). */
export function listedProducts(env: Record<string, string | undefined> = process.env): ProductId[] {
  return PRODUCT_ORDER.filter((id) => {
    const flag = PRODUCTS[id].featureFlag;
    return !flag || env[flag]?.trim().toLowerCase() === "true";
  });
}

/**
 * Süreli teklif (P#18): sunucuda tutulur (offers tablosu), sıfırlanmaz; süre bitince gerçekten normal ürün kimliğine
 * geçilir. Süre AÇIK (KB §11.1): yer tutucu 24 saat; OFFER_DURATION_HOURS env'i geçersiz kılar.
 */
export const OFFER = { durationHours: 24, placeholder: true } as const;
export function getOfferDurationHours(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.OFFER_DURATION_HOURS?.trim());
  return Number.isInteger(n) && n >= 1 && n <= 24 * 30 ? n : OFFER.durationHours;
}

/**
 * v2 hak kuralları (CONTRACTS_V2.md §6.3):
 *  - deviceOnly: ödeme öncesi cihaz analizi sınırsızdır ve kotaya sayılmaz (reserve_analysis p_status='device_only').
 *  - Ödeme sonrası analiz hakları ürün başına PRODUCTS[id].grants; rapor yeniden üretimi ücretlidir (Ç10).
 *  - referral: 5 davet tamamlanınca yalnız genel skor (Ç12); LLM istisnası, kota sayılmaz.
 */
export const ENTITLEMENTS_V2 = {
  deviceOnly: { analyses: "unlimited", quotaCounted: false },
  referral: { invitesRequired: 5, unlocks: "overall_only" },
} as const;
