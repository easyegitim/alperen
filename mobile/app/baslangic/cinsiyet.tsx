import { Stack, router } from "expo-router";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { scoped, t } from "@/mobile/src/lib/i18n";

const ts = scoped("mobile.stub");

/**
 * /baslangic/cinsiyet — Cinsiyet (KB §3.1/2: erkek / kadın / belirtmek istemiyorum; CONTRACTS_V2 §5 profiles.presentation).
 * Sahip: W7a. Yer tutucu: W7a onboarding.gender.* metinleri ve aura.onboarding.profile(presentation) ile yazar;
 * sıra yaş → cinsiyet → giriş → izinler (PLAN §1). Web karşılığı app/(app)/baslangic/cinsiyet.
 */
export default function GenderStub() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("onboarding.gender.title"), headerBackTitle: "Geri" }} />
      <Screen>
        <Card title={ts("title")} description={ts("body")}>
          <Button title={ts("back")} variant="outline" onPress={() => router.back()} />
        </Card>
      </Screen>
    </>
  );
}
