import { z } from "zod";
import { withGuard } from "@/lib/api/guard";
import { createAdminClient } from "@/lib/db/admin";
import { REFERRAL_STATUSES } from "@/lib/experts/refCode";

export const runtime = "nodejs";

export const PATCH = withGuard({ schema: z.object({ status: z.enum(REFERRAL_STATUSES) }), requireAdmin: true }, async ({ req, input }) => {
  const id = new URL(req.url).pathname.split("/").pop() ?? "";
  if (!z.uuid().safeParse(id).success) return Response.json({ error: { code: "NOT_FOUND", message: "Talep bulunamadı." } }, { status: 404 });
  const { data } = await createAdminClient().from("referral_requests").update({ status: input.status, updated_at: new Date().toISOString() }).eq("id", id).select("id, status").single();
  if (!data) return Response.json({ error: { code: "NOT_FOUND", message: "Talep bulunamadı." } }, { status: 404 });
  return Response.json(data);
});
