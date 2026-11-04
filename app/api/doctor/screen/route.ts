import { z } from "zod";
import { withGuard } from "@/lib/api/guard";
import { BODY_IMAGE_SCREEN_QUESTIONS } from "@/lib/config/plan";
import { enqueueDoctorDraft } from "@/lib/doctor/enqueue";
import { bodyImageScreenResult, screenRetakePolicy } from "@/lib/doctor/rules";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";
/** Tarama "ok" ise hekim kuyruğu taslağı (Claude, ≤ 60 sn) aynı istekte üretilir; kullanıcıya içerik dönmez. */
export const maxDuration = 90;

const Input = z.object({
  answers: z.object(Object.fromEntries(BODY_IMAGE_SCREEN_QUESTIONS.map((q) => [q, z.boolean()])) as Record<(typeof BODY_IMAGE_SCREEN_QUESTIONS)[number], z.ZodBoolean>),
  /** Plan sayfasındaki analiz: tarama "ok" ise bu analizin hekim taslağı kuyruğa alınır (plan_v2 varsa, tek taslak). */
  analysisId: z.uuid().optional(),
});

/**
 * POST /api/doctor/screen { answers:{q1..q4}, analysisId? } → { result, retakeAt? } (KB §6.4). YALNIZ sonuç saklanır; cevaplar
 * saklanmaz, loglanmaz. "risk" yapışkandır: BODY_IMAGE_SCREEN_RETAKE_DAYS dolmadan yeni gönderim kaydedilmez (risk → ok
 * sessizce düşmez). "ok" olunca doktor taslağı kuyruğa (lib/doctor/enqueue.ts); taslak hiçbir yoldan kullanıcıya gitmez.
 */
export const POST = withGuard({ schema: Input, requireAdult: true }, async ({ user, input }) => {
  const admin = createAdminClient();
  const prev = await admin.from("profiles").select("body_image_screen_result, body_image_screened_at").eq("id", user.id).maybeSingle();
  const prevResult = prev.data?.body_image_screen_result === "ok" || prev.data?.body_image_screen_result === "risk" ? prev.data.body_image_screen_result : null;
  const policy = screenRetakePolicy({ result: prevResult, screenedAt: prev.data?.body_image_screened_at ? String(prev.data.body_image_screened_at) : null }, Date.now());
  if (!policy.allowed) return Response.json({ result: "risk", ...(policy.retakeAt ? { retakeAt: policy.retakeAt } : {}) });

  const result = bodyImageScreenResult(input.answers);
  const { error } = await admin.from("profiles").update({ body_image_screen_result: result, body_image_screened_at: new Date().toISOString() }).eq("id", user.id);
  if (error) throw new Error("tarama sonucu kaydedilemedi");
  if (result === "ok" && input.analysisId) {
    try {
      await enqueueDoctorDraft({ admin, userId: user.id, analysisId: input.analysisId });
    } catch (e) {
      console.warn(`[doctor] draft skipped: ${e instanceof Error ? e.name : "error"}`);
    }
  }
  return Response.json({ result });
});
