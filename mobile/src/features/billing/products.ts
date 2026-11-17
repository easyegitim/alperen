// Mağaza ürünleri → v2 ürünler (CONTRACTS_V2 §6 PRODUCTS; KB §3.4 P#21: tek seferlik rapor + haftalık + aylık, yıllık
// bayrakla). Mağaza ürün kimlikleri AÇIK (kurucu, S3.7): env EXPO_PUBLIC_REVENUECAT_PRODUCT_<ID>_ID / _PROMO_ID tam eşleşir;
// yoksa kimlik içindeki sözcükten tahmin. Satın alma sonucu premium AÇMAZ: hak yalnız sunucu (sync/status). Saf; birim testli.
import { PRODUCTS, PRODUCT_IDS, PRODUCT_ORDER, type ProductId } from "@/lib/config/plans";
import type { BillingStatusDto, BillingSyncDto } from "@/mobile/src/lib/api";

export type StoreProductLike = { identifier: string; priceString: string; title?: string; productCategory?: string | null };
export type StorePackageLike = { identifier: string; product: StoreProductLike };

export type ProductOption = {
  product: ProductId;
  packageId: string;
  storeProductId: string;
  priceString: string;
  /** Mağaza kimliği tanıtım kimliğiyle eşleşti (iki ayrı ürün kimliği, KB P#18 Claude notu). */
  promo: boolean;
};

type Env = Record<string, string | undefined>;
const envId = (env: Env, id: ProductId, promo: boolean) => env[`EXPO_PUBLIC_REVENUECAT_PRODUCT_${id.toUpperCase()}${promo ? "_PROMO" : ""}_ID`]?.trim() || null;

/** Mağaza ürün kimliğinden v2 ürün: önce env tam eşleşme, sonra sözcük tahmini. week_pass v2'de yok → null. */
export function productFromStoreId(storeId: string | null | undefined, env: Env = process.env): { product: ProductId; promo: boolean } | null {
  if (!storeId) return null;
  for (const id of PRODUCT_IDS) {
    if (envId(env, id, false) === storeId) return { product: id, promo: false };
    if (envId(env, id, true) === storeId) return { product: id, promo: true };
  }
  const s = storeId.toLowerCase();
  const promo = /promo|intro|tanitim|launch/.test(s);
  if (/week_?pass|weekpass/.test(s)) return null;
  if (/report|rapor|one_?time|onetime|single/.test(s)) return { product: "one_time_report", promo };
  if (/year|annual|yil/.test(s)) return { product: "yearly", promo };
  if (/month|ay/.test(s)) return { product: "monthly", promo };
  if (/week|hafta/.test(s)) return { product: "weekly", promo };
  return null;
}

/**
 * Mevcut teklifin paketleri → ürün seçenekleri: PRODUCT_ORDER sırasıyla, listelenen ürünlerle sınırlı, ürün başına bir
 * paket (promoPreferred: teklif aktifken tanıtım kimliği, değilse normal). Tek seferlik ürün mağazada yenilenmeyen
 * (NON_SUBSCRIPTION) olmalı; abonelik kategorili bir "report" kimliği atlanır.
 */
export function packagesToProducts(packages: readonly StorePackageLike[], listed: readonly ProductId[] = PRODUCT_ORDER, opts: { promoPreferred?: boolean; env?: Env } = {}): ProductOption[] {
  const env = opts.env ?? process.env;
  const byProduct = new Map<ProductId, ProductOption>();
  for (const p of packages) {
    const m = productFromStoreId(p.product.identifier, env);
    if (!m || !listed.includes(m.product)) continue;
    const cat = p.product.productCategory ?? null;
    if (PRODUCTS[m.product].kind === "one_time" && cat === "SUBSCRIPTION") continue;
    if (PRODUCTS[m.product].kind === "subscription" && cat === "NON_SUBSCRIPTION") continue;
    const opt: ProductOption = { product: m.product, packageId: p.identifier, storeProductId: p.product.identifier, priceString: p.product.priceString, promo: m.promo };
    const prev = byProduct.get(m.product);
    const wantPromo = opts.promoPreferred === true;
    if (!prev || (prev.promo !== wantPromo && opt.promo === wantPromo)) byProduct.set(m.product, opt);
  }
  return PRODUCT_ORDER.filter((id) => byProduct.has(id)).map((id) => byProduct.get(id)!);
}

/** Varsayılan seçim: analiz bağlamında tek seferlik rapor, yoksa haftalık; listede yoksa ilk seçenek. */
export function defaultProduct(options: readonly ProductOption[], analysisId: string | null | undefined, requested?: string | null): ProductId | null {
  const has = (id: string | null | undefined) => options.find((o) => o.product === id)?.product ?? null;
  return has(requested) ?? has(analysisId ? "one_time_report" : "weekly") ?? options[0]?.product ?? null;
}

export type PurchaseOutcomeKind = "purchased" | "cancelled" | "error";

/**
 * Satın alma sonrası karar (SPEC-MOBILE M6, CLAUDE.md): mağaza sonucu tek başına hiçbir şey açmaz. Yalnız sunucunun
 * eşitleme/durum yanıtı (subscriptions/purchases satırları) hak verir; sunucu henüz görmediyse "pending".
 */
export function afterPurchase(outcome: PurchaseOutcomeKind, synced: BillingSyncDto | null, status: BillingStatusDto | null, analysisId: string | null): "entitled" | "pending" | "cancelled" | "error" {
  if (outcome === "cancelled") return "cancelled";
  if (outcome === "error") return "error";
  if (analysisId) return status?.analysisEntitled === true ? "entitled" : "pending";
  return synced?.premium === true || status?.premium === true ? "entitled" : "pending";
}
