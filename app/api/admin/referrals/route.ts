import { withGuard } from "@/lib/api/guard";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

/** Talepler (kişisel veri: iletişim ve mesaj yalnız admin görür). */
export const GET = withGuard({ requireAdmin: true }, async () => {
  const { data } = await createAdminClient()
    .from("referral_requests")
    .select("id, ref_code, specialty, contact, message, status, created_at, updated_at, partner:partners(name), revenue:referral_revenue(amount_try, model)")
    .order("created_at", { ascending: false })
    .limit(200);
  return Response.json(data ?? []);
});
