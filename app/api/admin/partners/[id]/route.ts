import { z } from "zod";
import { withGuard } from "@/lib/api/guard";
import { createAdminClient } from "@/lib/db/admin";
import { PartnerInput } from "../route";

export const runtime = "nodejs";

const Patch = PartnerInput.partial();

export const PATCH = withGuard({ schema: Patch, requireAdmin: true }, async ({ req, input }) => {
  const id = new URL(req.url).pathname.split("/").pop() ?? "";
  if (!z.uuid().safeParse(id).success) return Response.json({ error: { code: "NOT_FOUND", message: "Partner bulunamadı." } }, { status: 404 });
  const { verified, ...rest } = input;
  const patch: Record<string, unknown> = { ...rest };
  if (verified !== undefined) patch.verified_at = verified ? new Date().toISOString() : null;
  const { data, error } = await createAdminClient().from("partners").update(patch).eq("id", id).select("id, active, verified_at").single();
  if (error || !data) return Response.json({ error: { code: "NOT_FOUND", message: "Partner bulunamadı." } }, { status: 404 });
  return Response.json(data);
});
