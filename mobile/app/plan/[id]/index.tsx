import { Stack, useLocalSearchParams } from "expo-router";
import { ReportView } from "@/mobile/src/components/report/ReportView";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { scoped } from "@/mobile/src/lib/i18n";

const t = scoped("report");

/**
 * /plan/[id] (CONTRACTS_V2 Sprint 3 S3.1; sahip W7b): v1 ReportView korunur; W7b bunu PlanViewV2 (GET/POST /api/plan) ile
 * değiştirir ve anket yoksa /plan/[id]/anket'e yönlendirir. Parametre adı web ile aynı: id = analysisId.
 */
export default function PlanScreen() {
  const { id: analysisId } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("title"), headerBackTitle: "Geri" }} />
      <Screen>
        <ReportView analysisId={analysisId} />
      </Screen>
    </>
  );
}
