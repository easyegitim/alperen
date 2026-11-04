import { Stack, useLocalSearchParams } from "expo-router";
import { ReportView } from "@/mobile/src/components/report/ReportView";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { scoped } from "@/mobile/src/lib/i18n";

const t = scoped("report");

export default function PlanScreen() {
  const { analysisId } = useLocalSearchParams<{ analysisId: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("title"), headerBackTitle: "Geri" }} />
      <Screen>
        <ReportView analysisId={analysisId} />
      </Screen>
    </>
  );
}
