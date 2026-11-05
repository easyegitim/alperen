import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { newOfferRow, offerState, type OfferRow, type OfferState } from "./offer";

/**
 * Teklif satırı: yoksa şimdi başlar, varsa olduğu gibi okunur (asla sıfırlanmaz/uzatılmaz; KB P#18). Tablo yoksa
 * (0010 uygulanmamış) null: teklif yok, normal fiyat.
 */
export async function loadOrStartOffer(admin: SupabaseClient, userId: string, now: Date = new Date()): Promise<OfferState | null> {
  const read = () => admin.from("offers").select("user_id, started_at, expires_at, promo_product, regular_product").eq("user_id", userId).maybeSingle();
  let { data, error } = await read();
  if (error) return null;
  if (!data) {
    await admin.from("offers").upsert(newOfferRow(userId, now), { onConflict: "user_id", ignoreDuplicates: true });
    ({ data, error } = await read());
    if (error || !data) return null;
  }
  const row: OfferRow = { user_id: String(data.user_id), started_at: String(data.started_at), expires_at: String(data.expires_at), promo_product: String(data.promo_product), regular_product: String(data.regular_product) };
  return offerState(row, now);
}
