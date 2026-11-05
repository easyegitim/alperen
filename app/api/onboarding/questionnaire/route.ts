import { noContent, withGuard } from "@/lib/api/guard";
import { REQUIRED_ANALYSIS_CONSENTS } from "@/lib/consent";
import { createAdminClient } from "@/lib/db/admin";
import { QuestionnaireSchema } from "@/lib/questionnaire";

export const runtime = "nodejs";

/**
 * POST /api/onboarding/questionnaire { ...Questionnaire } → 204.
 * SPEC 14 tablosunda yoktur; onboarding_completed_at tarayıcıdan yazılamadığı (RLS, SPEC 13.2) için gereklidir.
 */
export const POST = withGuard(
  { schema: QuestionnaireSchema, requireAdult: true, requireConsents: REQUIRED_ANALYSIS_CONSENTS },
  async ({ user, input }) => {
    const admin = createAdminClient();
    const { data: profile } = await admin.from("profiles").select("onboarding_completed_at").eq("id", user.id).maybeSingle();
    const now = new Date().toISOString();
    const { error } = await admin
      .from("profiles")
      .update({
        questionnaire: input,
        onboarding_completed_at: profile?.onboarding_completed_at ?? now,
        updated_at: now,
      })
      .eq("id", user.id);
    if (error) throw new Error("anket kaydedilemedi");
    return noContent();
  },
);
