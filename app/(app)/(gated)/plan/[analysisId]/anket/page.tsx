import { z } from "zod";
import { notFound, redirect } from "next/navigation";
import { QuestionnaireWizardV2 } from "@/components/onboarding/QuestionnaireWizardV2";
import { getAccessV2 } from "@/lib/billing/purchases";
import { loadProfilePlanRow } from "@/lib/coach/planStore";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { loadRowById } from "@/app/api/analyses/v2";

/**
 * /plan/[analysisId]/anket (PLAN 4c; KB §3.2/5, Ç17): ödeme sonrası kişiselleştirme soruları. Gözlük/başörtüsü tahmini
 * analizin gözlemlerinden gelir (fotoğraf yok). Hak yoksa plana döner (paywall orada). Skoru değiştirmez.
 */
export default async function PlanQuestionnairePage({ params }: PageProps<"/plan/[analysisId]/anket">) {
  const { analysisId } = await params;
  if (!z.uuid().safeParse(analysisId).success) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const admin = createAdminClient();
  const [row, access, profile] = await Promise.all([loadRowById(admin, user.id, analysisId), getAccessV2(admin, user.id, analysisId), loadProfilePlanRow(admin, user.id)]);
  if (!row) notFound();
  if (!access.entitled) redirect(`/plan/${analysisId}`);
  const obs = (row.observations ?? {}) as { glassesDetected?: unknown; headCoveringDetected?: unknown };
  const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  return (
    <div className="mx-auto w-full max-w-lg space-y-8 px-4 pt-6">
      <QuestionnaireWizardV2
        nextPath={`/plan/${analysisId}`}
        initial={profile.questionnaire ?? undefined}
        prefill={{ glassesDetected: bool(obs.glassesDetected), headCoveringDetected: bool(obs.headCoveringDetected) }}
        presentation={profile.presentation}
        under18={profile.ageBand === "under_18"}
      />
    </div>
  );
}
