import { SignIn } from "@/components/auth/SignIn";
import { OnboardingSteps } from "@/components/onboarding/OnboardingSteps";
import { createClient } from "@/lib/db/server";
import { CONSENTS_PATH, SIGN_IN_PATH } from "@/lib/onboarding/gate";
import { readAgeBand, readPresentationSafe } from "@/lib/onboarding/profileRead";

/** KB §3.1 adım 3 (P#2): Google ya da Apple ile giriş; e-posta kodu yedek (AÇIK). Oturum gerekmez. */
export default async function SignInPage({ searchParams }: PageProps<"/baslangic/giris">) {
  const { auth_error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [ageBand, presentation] = user ? await Promise.all([readAgeBand(supabase, user.id), readPresentationSafe(supabase, user.id)]) : [null, null];

  return (
    <div className="mx-auto w-full max-w-lg space-y-8 px-4 py-6">
      <OnboardingSteps current="account" />
      <SignIn
        session={{ signedIn: Boolean(user), anonymous: Boolean(user?.is_anonymous), hasAgeBand: ageBand !== null, hasPresentation: presentation !== null }}
        returnPath={SIGN_IN_PATH}
        nextPath={CONSENTS_PATH}
        authError={Boolean(auth_error)}
      />
    </div>
  );
}
