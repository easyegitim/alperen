import { redirect } from "next/navigation";
import { ConsentFlow } from "@/components/onboarding/ConsentFlow";
import { OnboardingSteps } from "@/components/onboarding/OnboardingSteps";
import { getConsentState } from "@/lib/api/guard";
import { createClient } from "@/lib/db/server";
import { getLegalDoc } from "@/lib/legal/docs";
import { AGE_GATE_PATH, CAPTURE_PATH, GENDER_PATH, SIGN_IN_PATH } from "@/lib/onboarding/gate";
import { readPresentationSafe } from "@/lib/onboarding/profileRead";

/**
 * KB §3.1 adım 4: aydınlatma + açık rızalar, ayrı metinle, kısaltılmadan. Oturum (hesap) ve 18+ gerekir; cinsiyet
 * seçilmemişse cinsiyet ekranına döner. Sonrası fotoğraflar (anket ödeme sonrasında).
 */
export default async function ConsentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(SIGN_IN_PATH);
  const { data: profile } = await supabase.from("profiles").select("is_adult").eq("id", user.id).maybeSingle();
  if (!profile?.is_adult) redirect(AGE_GATE_PATH);
  if ((await readPresentationSafe(supabase, user.id)) === null) redirect(GENDER_PATH);

  const [notice, consentDoc, state] = await Promise.all([getLegalDoc("aydinlatma"), getLegalDoc("acik-riza"), getConsentState(supabase)]);
  const ack = state.kvkk_notice_ack;
  const noticeAcked = Boolean(ack?.granted && ack.textVersion === notice.version);

  return (
    <div className="mx-auto w-full max-w-lg space-y-8 px-4 py-6">
      <OnboardingSteps current="consents" />
      <ConsentFlow
        notice={{ title: notice.title, version: notice.version, updatedAt: notice.updatedAt, body: notice.body }}
        consentVersion={consentDoc.version}
        initial={state}
        noticeAcked={noticeAcked}
        nextPath={CAPTURE_PATH}
        // SPEC 7.1: model çekim ekranından önce arka planda yüklenir
        prefetchModel
      />
    </div>
  );
}
