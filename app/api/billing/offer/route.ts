import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { offerPrices, type OfferResponse } from "@/lib/billing/offer";
import { loadOrStartOffer } from "@/lib/billing/offerStore";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

/**
 * GET /api/billing/offer → OfferResponse (KB P#18): kullanıcının süreli teklifi sunucuda tutulur. Satır yoksa ilk
 * görüşte başlar; varsa ASLA sıfırlanmaz ya da uzatılmaz (sahte sayaç yasak). Süre bitince currentProduct normal ürün.
 * Fiyatlar yer tutucu olabilir (placeholder:true → paywall "fiyat belirlenecek", satış yok).
 */
export const GET = withGuard({}, async ({ user }) => {
  const offer = await loadOrStartOffer(createAdminClient(), user.id);
  if (!offer) throw new ApiError("FEATURE_DISABLED", "Teklif şu an kullanılamıyor.");
  const body: OfferResponse = { ...offer, prices: offerPrices() };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
});
