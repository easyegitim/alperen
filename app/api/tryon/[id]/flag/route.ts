import { z } from "zod";
import { noContent, withGuard } from "@/lib/api/guard";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

/**
 * "Bozuk görünüyor" (KB §7.3 R2-C10/5; PLAN 5e): POST /api/tryon/[id]/flag → flag_tryon_broken(p_user, p_event).
 * Yalnız kendi success satırı; idempotent. Oran ops.daily_tryon_quality.broken_rate ile izlenir. Görsel yok.
 */
export const POST = withGuard({}, async ({ req, user }) => {
  const id = new URL(req.url).pathname.split("/").at(-2) ?? "";
  if (!z.uuid().safeParse(id).success) return Response.json({ error: { code: "NOT_FOUND", message: "Deneme bulunamadı." } }, { status: 404 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("flag_tryon_broken", { p_user: user.id, p_event: id });
  if (error) throw new Error("flag_tryon_broken failed");
  if (!data) return Response.json({ error: { code: "NOT_FOUND", message: "Deneme bulunamadı." } }, { status: 404 });
  return noContent();
});
