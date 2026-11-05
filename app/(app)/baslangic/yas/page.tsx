import { AgeGate } from "@/components/onboarding/AgeGate";
import { OnboardingSteps } from "@/components/onboarding/OnboardingSteps";
import { isFeatureEnabled } from "@/lib/config/flags";
import { createClient } from "@/lib/db/server";
import { isAgeBand } from "@/lib/onboarding/age";
import { GENDER_PATH } from "@/lib/onboarding/gate";
import { readAgeBand } from "@/lib/onboarding/profileRead";

/** KB §3.1 adım 1: yaş bandı. Oturum gerekmez (yaş → cinsiyet → hesap); oturum varsa seçim hemen yazılır. */
export default async function AgeGatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signedIn = Boolean(user && !user.is_anonymous);
  const initial = user ? await readAgeBand(supabase, user.id) : null;

  return (
    <div className="mx-auto w-full max-w-lg space-y-8 px-4 py-6">
      <OnboardingSteps current="age" />
      <AgeGate under18Enabled={isFeatureEnabled("under18")} signedIn={signedIn} initial={isAgeBand(initial) ? initial : null} nextPath={GENDER_PATH} />
    </div>
  );
}
