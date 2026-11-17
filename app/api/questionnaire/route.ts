import { noContent, withGuard } from "@/lib/api/guard";
import { createAdminClient } from "@/lib/db/admin";
import { QuestionnaireV2Schema } from "@/lib/questionnaireV2";

export const runtime = "nodejs";

/**
 * POST /api/questionnaire { ...QuestionnaireV2 } → 204 (PLAN 4c; KB §3.2/5, Ç17). Yalnız profiles.questionnaire_v2 yazar
 * (service role; authenticated grant yok). Skora dokunmaz: analyses satırı değişmez. Boy/kilo yalnız K8 kuralı için saklanır.
 */
export const POST = withGuard({ schema: QuestionnaireV2Schema, requireAdult: true }, async ({ user, input }) => {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("profiles").update({ questionnaire_v2: input, questionnaire_v2_at: now, updated_at: now }).eq("id", user.id);
  if (error) throw new Error("anket v2 kaydedilemedi");
  return noContent();
});
