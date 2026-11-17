import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { RoutineScreen } from "@/components/routine/RoutineScreen";
import { LockedFeature } from "@/components/app/LockedFeature";
import { getPremiumStatus } from "@/lib/api/premium";
import { exerciseEligible } from "@/lib/coach/eligibility";
import { createClient } from "@/lib/db/server";
import { QuestionnaireSchema } from "@/lib/questionnaire";

/** /rutin (F12): premium. */
export default async function RoutinePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const [t, { premium }, profile] = await Promise.all([getTranslations("routine"), getPremiumStatus(supabase, user.id), supabase.from("profiles").select("questionnaire").eq("id", user.id).maybeSingle()]);
  const q = QuestionnaireSchema.safeParse(profile.data?.questionnaire);
  return (
    <div className="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
      <header className="space-y-1">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      </header>
      {premium ? (
        <RoutineScreen userId={user.id} exerciseEligible={q.success ? exerciseEligible(q.data) : false} />
      ) : (
        <LockedFeature title={t("lockedTitle")} body={t("lockedBody")} href="/premium?from=routine" />
      )}
    </div>
  );
}
