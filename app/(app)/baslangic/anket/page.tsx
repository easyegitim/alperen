import { redirect } from "next/navigation";
import { QuestionnaireWizard } from "@/components/onboarding/QuestionnaireWizard";
import { getConsentState } from "@/lib/api/guard";
import { hasRequiredAnalysisConsents } from "@/lib/consent";
import { createClient } from "@/lib/db/server";
import { getLegalVersion } from "@/lib/legal/docs";
import { AGE_GATE_PATH, CAPTURE_PATH, CONSENTS_PATH, GENDER_PATH } from "@/lib/onboarding/gate";
import { readPresentationSafe } from "@/lib/onboarding/profileRead";
import { safeReturnPath } from "@/lib/onboarding/returnPath";
import { QuestionnaireSchema } from "@/lib/questionnaire";

/**
 * F04: anket. 18+ ve üç zorunlu rıza olmadan açılmaz. `next` yalnız /plan/<uuid> ise oraya dönülür (UI spec §7).
 * v2: ödeme öncesi akışta yer almaz (KB R2-C13); cinsiyet profilden gelir, burada sorulmaz. PLAN 4c'de plan önüne taşınır.
 */
export default async function QuestionnairePage({ searchParams }: PageProps<"/baslangic/anket">) {
  const { next } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const { data: profile } = await supabase.from("profiles").select("is_adult, questionnaire").eq("id", user.id).maybeSingle();
  if (!profile?.is_adult) redirect(AGE_GATE_PATH);

  const state = await getConsentState(supabase);
  const consentVersion = await getLegalVersion("acik-riza");
  if (!hasRequiredAnalysisConsents(state, () => consentVersion)) redirect(CONSENTS_PATH);

  const presentation = await readPresentationSafe(supabase, user.id);
  if (!presentation) redirect(GENDER_PATH);
  const existing = QuestionnaireSchema.safeParse(profile.questionnaire);
  const returnPath = safeReturnPath(next);

  return (
    <div className="mx-auto w-full max-w-lg space-y-8 px-4 pt-6">
      <QuestionnaireWizard nextPath={returnPath ?? CAPTURE_PATH} initial={existing.success ? existing.data : undefined} presentation={presentation} />
    </div>
  );
}
