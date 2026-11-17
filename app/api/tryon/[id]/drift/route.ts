import { z } from "zod";
import { noContent, withGuard } from "@/lib/api/guard";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

/** SPEC 10.5: kimlik/kalite kontrolü başarısız → identity_drift (kota iade). Sahiplik zorunlu. */
export const POST = withGuard({}, async ({ req, user }) => {
  const id = new URL(req.url).pathname.split("/").at(-2) ?? "";
  if (!z.uuid().safeParse(id).success) return Response.json({ error: { code: "NOT_FOUND", message: "Deneme bulunamadı." } }, { status: 404 });
  const admin = createAdminClient();
  const { data } = await admin.from("tryon_events").update({ status: "identity_drift" }).eq("id", id).eq("user_id", user.id).in("status", ["success", "pending"]).select("id");
  if (!data || data.length === 0) return Response.json({ error: { code: "NOT_FOUND", message: "Deneme bulunamadı." } }, { status: 404 });
  return noContent();
});
