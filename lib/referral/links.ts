import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/config/flags";

// Ürün / uzman / kaynak bağlantıları (KB Ç4, K18, K19; PLAN 4g; migration 0013 product_links + product_link_clicks).
// FEATURE_PRODUCT_LINKS kapalıyken hiçbir bağlantı okunmaz ve tıklama yazılmaz. Ücret/komisyon modeli YOK (listing_fee
// ya da none); "Reklam" etiketi arayüzde zorunlu (is_ad). Reklamda hekim adı yok: kind "expert" satırları merchant taşımaz.

export type ProductLink = { id: string; refId: string; kind: "product" | "expert" | "source"; label: string; url: string; merchant: string | null; isAd: boolean };

export const AD_LABEL_KEY = "plan.v2.links.adLabel" as const;

export function productLinksEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return isFeatureEnabled("productLinks", env);
}

/** Verilen adım kimlikleri için aktif bağlantılar (flag kapalıysa boş). Kullanıcı kimliği gitmez. */
export async function linksForSteps(admin: SupabaseClient, stepIds: readonly string[], env: Record<string, string | undefined> = process.env): Promise<Record<string, ProductLink[]>> {
  if (!productLinksEnabled(env) || stepIds.length === 0) return {};
  const { data } = await admin.from("product_links").select("id, ref_id, kind, label, url, merchant, is_ad").eq("active", true).in("ref_id", [...stepIds]).limit(200);
  const out: Record<string, ProductLink[]> = {};
  for (const r of data ?? []) {
    const link: ProductLink = { id: String(r.id), refId: String(r.ref_id), kind: r.kind as ProductLink["kind"], label: String(r.label), url: String(r.url), merchant: r.kind === "expert" ? null : (r.merchant ? String(r.merchant) : null), isAd: r.is_ad !== false };
    (out[link.refId] ??= []).push(link);
  }
  return out;
}

/** Tıklama kaydı (service role); analitik olayına bağlantı kimliği gitmez. Flag kapalıysa yazmaz ve false döner. */
export async function recordLinkClick(admin: SupabaseClient, linkId: string, userId: string | null, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!productLinksEnabled(env)) return false;
  const { data: link } = await admin.from("product_links").select("id").eq("id", linkId).eq("active", true).maybeSingle();
  if (!link) return false;
  const { error } = await admin.from("product_link_clicks").insert({ link_id: linkId, user_id: userId });
  return !error;
}
