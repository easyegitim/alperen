import { Stack, router } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { track } from "@/lib/analytics";
import { CONSENTS_PATH, SIGN_IN_PATH } from "@/lib/onboarding/gate";
import { PRESENTATIONS } from "@/lib/questionnaire";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { RadioList } from "@/mobile/src/components/ui/OptionRow";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { writeOnboardingDraft, type Presentation } from "@/mobile/src/features/onboarding/draft";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { scoped } from "@/mobile/src/lib/i18n";

const t = scoped("onboarding.gender");

/**
 * KB §3.1 adım 2: erkek / kadın / belirtmek istemiyorum. Yalnız öneri ve örnekler için; skor ölçeği herkese aynı (K1).
 * Tek kaynak profiles.presentation (CONTRACTS_V2 §5). Oturum yoksa taslak → giriş; varsa doğrudan izinler.
 */
export default function GenderScreen() {
  const { user, aura } = useSession();
  const signedIn = Boolean(user && !user.is_anonymous);
  const [value, setValue] = useState<Presentation | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!value) return;
    setBusy(true);
    try {
      await writeOnboardingDraft({ presentation: value });
      if (signedIn) await aura.onboarding.profile(value);
      track("onboarding_step_completed", { step: "gender" });
      router.push(signedIn ? CONSENTS_PATH : SIGN_IN_PATH);
    } catch {
      Alert.alert(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("title"), headerBackTitle: "Geri" }} />
      <Screen>
        <Card title={t("title")} description={t("description")}>
          <RadioList options={PRESENTATIONS} value={value ?? undefined} label={(k) => t(`options.${k}`)} onChange={setValue} />
          <Button title={t("continue")} size="lg" disabled={!value} busy={busy} onPress={() => void submit()} />
        </Card>
      </Screen>
    </>
  );
}
