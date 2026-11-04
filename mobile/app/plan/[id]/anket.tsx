import { Stack, router, useLocalSearchParams } from "expo-router";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { scoped, t } from "@/mobile/src/lib/i18n";

const ts = scoped("mobile.stub");

/**
 * /plan/[id]/anket — Kişiselleştirme anketi v2 (KB §3.2/5–6, Ç17; CONTRACTS_V2 S2.3). Sahip: W7b.
 * Yer tutucu: W7b lib/questionnaireV2 (emptyQuestionnaireV2 + QuestionnaireV2Schema) ile sihirbazı yazar,
 * aura.questionnaire.submit → /plan/[id]. Anket skoru değiştirmez; gözlük/başörtüsü fotoğraftan dolu gelir.
 */
export default function PlanQuestionnaireStub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("questionnaire.v2.title"), headerBackTitle: "Geri" }} />
      <Screen>
        <Card title={ts("title")} description={ts("body")}>
          <Button title={ts("back")} variant="outline" onPress={() => (id ? router.replace({ pathname: "/plan/[id]", params: { id } }) : router.back())} />
        </Card>
      </Screen>
    </>
  );
}
