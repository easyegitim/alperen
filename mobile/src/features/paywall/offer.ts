// Sunucu süreli teklif (KB P#18): süre sunucuda, sayaç sunucu saatine göre (cihaz saati kaymış olabilir); bitince gerçekten
// normal ürün. Web components/paywall/{useOffer,PaywallSheet}.tsx ile aynı saf kurallar. Birim testli.
import type { OfferResponse } from "@/lib/billing/offer";
import { PRODUCTS, PRODUCT_ORDER, PRODUCT_PRICE_PLACEHOLDERS, type ProductId, type ProductPrice } from "@/lib/config/plans";

/** Sunucu saati − cihaz saati (ms); yanıt alındığı anda hesaplanır. */
export function offerSkewMs(offer: Pick<OfferResponse, "serverNow">, nowMs: number): number {
  return new Date(offer.serverNow).getTime() - nowMs;
}

/** Kalan süre (ms), sunucu saatine göre; hiç negatif olmaz. */
export function remainingMs(offer: Pick<OfferResponse, "expiresAt">, skewMs: number, nowMs: number): number {
  return Math.max(0, new Date(offer.expiresAt).getTime() - (nowMs + skewMs));
}

export function isOfferActive(offer: Pick<OfferResponse, "expiresAt" | "active">, skewMs: number, nowMs: number): boolean {
  return offer.active && remainingMs(offer, skewMs, nowMs) > 0;
}

/** Bayraksız varsayılan liste (yıllık yalnız sunucunun gönderdiği fiyat listesinde varsa görünür). */
export const DEFAULT_PRODUCTS: ProductId[] = PRODUCT_ORDER.filter((id) => !PRODUCTS[id].featureFlag);

export type ProductView = {
  id: ProductId;
  /** Sunucu fiyat bilgisi (TL, KDV dahil); null = fiyat belirlenecek. Mağazada gerçek fiyat mağaza kademesindendir. */
  priceTry: number | null;
  struckTry: number | null;
  promo: boolean;
  placeholder: boolean;
};

/** Saf: ürün listesi + sunucu fiyat görünümü (teklif yoksa yer tutucu). Mağaza fiyatı ayrıca ProductOption.priceString. */
export function productViews(offer: OfferResponse | null, offerActive: boolean, fallback: ProductId[] = DEFAULT_PRODUCTS): ProductView[] {
  const ids = offer ? (PRODUCT_ORDER.filter((id) => id in offer.prices) as ProductId[]) : fallback;
  return ids.map((id) => {
    const price: ProductPrice = offer?.prices[id] ?? PRODUCT_PRICE_PLACEHOLDERS[id];
    const promoApplies = Boolean(offer && offerActive && offer.promoProduct === id && price.promoTry != null);
    return { id, priceTry: promoApplies ? price.promoTry : price.regularTry, struckTry: promoApplies ? price.regularTry : null, promo: promoApplies, placeholder: price.placeholder };
  });
}

/** Ekran okuyucu için dakika cinsinden kalan (yalnız dakika değişince duyurulur). */
export function remainingMinutes(ms: number): number {
  return Math.floor(ms / 60_000);
}
