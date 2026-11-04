import { z } from "zod";
import { withGuard } from "@/lib/api/guard";
import { BODY_IMAGE_SCREEN_QUESTIONS } from "@/lib/config/plan";
import { bodyImageScreenResult } from "@/lib/doctor/rules";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

const Input = z.object({ answers: z.object(Object.fromEntries(BODY_IMAGE_SCREEN_QUESTIONS.map((q) => [q, z.boolean()])) as Record<(typeof BODY_IMAGE_SCREEN_QUESTIONS)[number], z.ZodBoolean>) });

/** POST /api/doctor/screen { answers:{q1..q4} } → { result } (KB §6.4). YALNIZ sonuç saklanır; cevaplar saklanmaz, loglanmaz. */
export const POST = withGuard({ schema: Input, requireAdult: true }, async ({ user, input }) => {
  const result = bodyImageScreenResult(input.answers);
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ body_image_screen_result: result, body_image_screened_at: new Date().toISOString() }).eq("id", user.id);
  if (error) throw new Error("tarama sonucu kaydedilemedi");
  return Response.json({ result });
});
