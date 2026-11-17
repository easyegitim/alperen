// Süreli teklif (KB §3.4 P#18, P#20; CONTRACTS_V2 §6). Saf modül: sunucu rotası ve testler kullanır.
// Kurallar: sunucuda tutulur (offers satırı), kullanıcı başına bir kez başlar, sıfırlanmaz; süre bitince gerçekten
// normal ürün/fiyat geçerlidir (sahte sayaç yasak). Tanıtımın uygulanacağı ürün ve süre AÇIK (KB §11.1): yer tutucu
// env ile değişir, kod uydurmaz.
import { PRODUCT_IDS, getOfferDurationHours, getProductPrice, listedProducts, type ProductId, type ProductPrice } from "@/lib/config/plans";

export type OfferRow = { user_id: string; started_at: string; expires_at: string; promo_product: string; regular_product: string };

const isProductId = (v: string | undefined): v is ProductId => Boolean(v) && (PRODUCT_IDS as readonly string[]).includes(v as string);

/** Teklifin ürünleri: OFFER_PROMO_PRODUCT / OFFER_REGULAR_PRODUCT (yer tutucu: ikisi de tek seferlik rapor). */
export function getOfferProducts(env: Record<string, string | undefined> = process.env): { promo: ProductId; regular: ProductId } {
  const promo = env.OFFER_PROMO_PRODUCT?.trim();
  const regular = env.OFFER_REGULAR_PRODUCT?.trim();
  return { promo: isProductId(promo) ? promo : "one_time_report", regular: isProductId(regular) ? regular : "one_time_report" };
}

/** Yeni teklif satırı (yalnız satır yokken; var olan satır asla güncellenmez). */
export function newOfferRow(userId: string, now: Date, env: Record<string, string | undefined> = process.env): OfferRow {
  const { promo, regular } = getOfferProducts(env);
  const expires = new Date(now.getTime() + getOfferDurationHours(env) * 3_600_000);
  return { user_id: userId, started_at: now.toISOString(), expires_at: expires.toISOString(), promo_product: promo, regular_product: regular };
}

export type OfferState = {
  /** Teklif hâlâ geçerli mi (sunucu saatine göre). */
  active: boolean;
  startedAt: string;
  expiresAt: string;
  /** Sunucu saati; istemci geri sayımı buna göre hesaplar (cihaz saati kaymış olabilir). */
  serverNow: string;
  remainingMs: number;
  promoProduct: ProductId;
  regularProduct: ProductId;
  /** Şu an satılan ürün: aktifken tanıtım ürünü, bitince normal ürün. */
  currentProduct: ProductId;
};

export function offerState(row: OfferRow, now: Date, env: Record<string, string | undefined> = process.env): OfferState {
  const expires = new Date(row.expires_at).getTime();
  const remainingMs = Math.max(0, expires - now.getTime());
  const active = remainingMs > 0;
  const { promo, regular } = getOfferProducts(env);
  const promoProduct = isProductId(row.promo_product) ? row.promo_product : promo;
  const regularProduct = isProductId(row.regular_product) ? row.regular_product : regular;
  return { active, startedAt: row.started_at, expiresAt: row.expires_at, serverNow: now.toISOString(), remainingMs, promoProduct, regularProduct, currentProduct: active ? promoProduct : regularProduct };
}

/** Listelenen ürünlerin fiyatları (yer tutucu bilgisiyle). Tanıtım fiyatı yalnız teklif aktifken ve tanıtım ürününde anlamlıdır. */
export function offerPrices(env: Record<string, string | undefined> = process.env): Partial<Record<ProductId, ProductPrice>> {
  return Object.fromEntries(listedProducts(env).map((id) => [id, getProductPrice(id, env)]));
}

/** Ödemede uygulanacak fiyat (KDV dahil TL) ya da null (fiyat belirlenmedi → satış yapılmaz). */
export function effectivePriceTry(product: ProductId, offer: OfferState | null, env: Record<string, string | undefined> = process.env): { priceTry: number | null; promo: boolean } {
  const price = getProductPrice(product, env);
  const promoApplies = Boolean(offer?.active && offer.promoProduct === product && price.promoTry != null);
  return promoApplies ? { priceTry: price.promoTry, promo: true } : { priceTry: price.regularTry, promo: false };
}

/** Geri sayım metni "hh:mm:ss" (24 saatten uzun teklifte "Xg hh:mm:ss"); istemci gösterimi için saf. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hms = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return days > 0 ? `${days}g ${hms}` : hms;
}

/** Yanıt gövdesi: GET /api/billing/offer. */
export type OfferResponse = OfferState & { prices: Partial<Record<ProductId, ProductPrice>> };
