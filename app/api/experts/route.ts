import { z } from "zod";
import { withGuard } from "@/lib/api/guard";
import { createAdminClient } from "@/lib/db/admin";
import { assertExpertNetworkEnabled } from "@/lib/experts/guard";

export const runtime = "nodejs";

const PARTNER_COLUMNS = "id, name, kind, specialties, city, institution, license_no, verified_at";

/** GET /api/experts?specialty&city → Partner[] (yalnız aktif + doğrulanmış; fiyat/kampanya alanı yok). */
export const GET = withGuard({}, async ({ req }) => {
  assertExpertNetworkEnabled();
  const sp = new URL(req.url).searchParams;
  const q = z.object({ specialty: z.string().max(40).optional(), city: z.string().max(60).optional() }).parse({
    specialty: sp.get("specialty") ?? undefined,
    city: sp.get("city") ?? undefined,
  });
  const admin = createAdminClient();
  let query = admin.from("partners").select(PARTNER_COLUMNS).eq("active", true).not("verified_at", "is", null).order("name");
  if (q.specialty) query = query.contains("specialties", [q.specialty]);
  if (q.city) query = query.ilike("city", q.city);
  const { data } = await query;
  return Response.json(data ?? []);
});
