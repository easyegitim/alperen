import { createAdminClient } from "@/lib/db/admin";
import { verifyStatusLink } from "@/lib/experts/refCode";
import { isFeatureEnabled } from "@/lib/config/flags";

export const runtime = "nodejs";

/** SPEC 12.3 adım 5: partner e-postadaki imzalı linkle durumu günceller (oturum gerekmez; imza yeterli). */
export async function GET(req: Request) {
  if (!isFeatureEnabled("expertNetwork")) return new Response("Bulunamadı", { status: 404 });
  const url = new URL(req.url);
  const ref = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
  const status = url.searchParams.get("status") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  let ok = false;
  try {
    ok = verifyStatusLink(ref, status, sig);
  } catch {
    ok = false;
  }
  if (!ok) return new Response("Geçersiz veya süresi dolmuş bağlantı.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  const admin = createAdminClient();
  const { data } = await admin.from("referral_requests").update({ status, updated_at: new Date().toISOString() }).eq("ref_code", ref).select("id");
  if (!data || data.length === 0) return new Response("Talep bulunamadı.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(`<!doctype html><meta charset="utf-8"><title>Durum güncellendi</title><p style="font:16px system-ui;padding:24px">Talep <strong>${ref}</strong> için durum <strong>${status}</strong> olarak kaydedildi. Teşekkürler.</p>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
