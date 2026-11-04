import { z } from "zod";
import { withGuard } from "@/lib/api/guard";
import { getKnowledgeSource } from "@/lib/coach/knowledgeSource";
import { listQueue, reviewRecommendation } from "@/lib/doctor/queue";
import { DOCTOR_STATUSES, DoctorItem } from "@/lib/doctor/types";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

/** GET /api/doctor/review?status=draft → kuyruk (yalnız ADMIN_EMAILS; diğer herkese 404). */
export const GET = withGuard({ requireAdmin: true }, async ({ req }) => {
  const s = new URL(req.url).searchParams.get("status");
  const status = (DOCTOR_STATUSES as readonly string[]).includes(s ?? "") ? (s as (typeof DOCTOR_STATUSES)[number]) : undefined;
  return Response.json(await listQueue(createAdminClient(), status));
});

const Input = z.object({
  id: z.uuid(),
  decision: z.enum(["physician_reviewed", "rejected"]),
  items: z.array(DoctorItem).max(2).default([]),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * POST /api/doctor/review { id, decision, items, notes } → { ok, issues } (KB Ç3/Ç5; AUP: değiştirme yetkisi olan hekim).
 * Onayda öğeler zorunlu ve kodla doğrulanır (doz/marka/satış/izinsiz alan → ret). physician_id = oturumdaki admin.
 */
export const POST = withGuard({ schema: Input, requireAdmin: true }, async ({ user, input }) => {
  const admin = createAdminClient();
  const known = await getKnowledgeSource().ids();
  const r = await reviewRecommendation(admin, { id: input.id, decision: input.decision, physicianId: user.id, items: input.items, notes: input.notes ?? null, knownMethodIds: known });
  return Response.json(r, { status: r.ok ? 200 : 400 });
});
