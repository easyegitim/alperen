import { GenderPicker } from "@/components/onboarding/GenderPicker";
import { OnboardingSteps } from "@/components/onboarding/OnboardingSteps";
import { createClient } from "@/lib/db/server";
import { CONSENTS_PATH, SIGN_IN_PATH } from "@/lib/onboarding/gate";
import { readPresentationSafe } from "@/lib/onboarding/profileRead";

/** KB §3.1 adım 2: cinsiyet. Oturum gerekmez; oturum varsa hemen yazılır ve izinlere geçilir. */
export default async function GenderPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signedIn = Boolean(user && !user.is_anonymous);
  const initial = user ? await readPresentationSafe(supabase, user.id) : null;

  return (
    <div className="mx-auto w-full max-w-lg space-y-8 px-4 py-6">
      <OnboardingSteps current="gender" />
      <GenderPicker signedIn={signedIn} initial={initial} nextPath={signedIn ? CONSENTS_PATH : SIGN_IN_PATH} />
    </div>
  );
}
