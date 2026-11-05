import { z } from "zod";
import { withGuard } from "@/lib/api/guard";
import { getPremiumStatus } from "@/lib/api/premium";
import { getTeaserConfig } from "@/lib/config/teaser";
import { createAdminClient } from "@/lib/db/admin";
import { getAccessV2 } from "@/lib/billing/purchases";
import { toClientAnalysis, type AnalysisRow } from "@/lib/score/present";
import { isV2Row, loadRowById, presentV2 } from "../v2";

export const runtime = "nodejs";

/**
 * GET /api/analyses/[id] (sahiplik; başkasının id'si → 404).
 *  - hybrid.v2 satırı (engine_version hybrid.v2 ya da device_only/queued/running): ClientAnalysisV2 + AccessV2 kilit kuralları.
 *  - eski satır (legacy, hybrid.v1): ClientAnalysis v1 + teaser kırpması (değişmedi).
 */
export const GET = withGuard({}, async ({ req, user, supabase }) => {
  const id = new URL(req.url).pathname.split("/").pop() ?? "";
  if (!z.uuid().safeParse(id).success) return notFound();
  const admin = createAdminClient();
  const row = await loadRowById(admin, user.id, id);
  if (!row) return notFound();
  if (isV2Row(row)) {
    const access = await getAccessV2(admin, user.id, row.id);
    return Response.json(await presentV2(admin, user.id, row, access));
  }
  const { premium } = await getPremiumStatus(supabase, user.id);
  const teaser = getTeaserConfig();
  return Response.json(toClientAnalysis(row as AnalysisRow, premium, teaser.mode, teaser.subscore));
});

function notFound(): Response {
  // IDOR koruması: var/yok ayrımı yapılmaz (SPEC 20.2 "başka kullanıcının analiz id'si → 404").
  return Response.json({ error: { code: "NOT_FOUND", message: "Analiz bulunamadı." } }, { status: 404 });
}
