import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import type { ClientAnalysis, ClientAnalysisV2 } from "@/lib/score/present";
import { ReportV3 } from "@/mobile/src/components/report/ReportV3";
import { ReportView } from "@/mobile/src/components/report/ReportView";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { PlanViewV2 } from "@/mobile/src/features/plan/PlanView";
import { hairLossOf, type PlanPayload } from "@/mobile/src/features/plan/viewModel";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { ApiClientError } from "@/mobile/src/lib/api";
import { isMobileFeatureEnabled } from "@/mobile/src/lib/flags";
import { scoped } from "@/mobile/src/lib/i18n";
import { spacing } from "@/mobile/src/theme";

const t = scoped("report");
const tp = scoped("plan.v2");
const isV2 = (a: ClientAnalysis | ClientAnalysisV2): a is ClientAnalysisV2 => "stage" in a;

type Loaded =
  | { kind: "legacy" }
  | { kind: "locked" }
  | { kind: "not_completed" }
  | { kind: "v2"; a: ClientAnalysisV2; initial: PlanPayload | null };

/**
 * /plan/[id] (CONTRACTS_V2 S3.1; web (gated)/plan/[analysisId] eşi): hybrid.v2 satırı → rapor v3 + plan v2
 * (GET /api/plan/[id]; yoksa PlanViewV2 POST /api/plan ile üretir; anket yoksa BAD_INPUT → /plan/[id]/anket). Hak sunucuda:
 * PREMIUM_REQUIRED → kilit kartı. Eski motor satırları v1 koç raporunda kalır.
 */
export default function PlanScreen() {
  const { id: analysisId } = useLocalSearchParams<{ id: string }>();
  const { aura } = useSession();
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const [planY, setPlanY] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const a = await aura.analyses.getLegacy(analysisId);
        if (!a) throw new Error("empty");
        if (!isV2(a)) return active && setState({ kind: "legacy" });
        if (a.stage !== "completed") return active && setState({ kind: "not_completed" });
        try {
          const p = await aura.plan.get(analysisId);
          if (active) setState({ kind: "v2", a, initial: p ? { view: p.view, hairLossSignal: hairLossOf(p.hairLossSignal as PlanPayload["hairLossSignal"]) } : null });
        } catch (e) {
          if (!active) return;
          if (e instanceof ApiClientError && e.code === "PREMIUM_REQUIRED") setState({ kind: "locked" });
          else if (e instanceof ApiClientError && e.status === 404) setState({ kind: "v2", a, initial: null }); // NOT_FOUND: saklı plan yok → üretilir
          else throw e;
        }
      } catch (e) {
        if (active) setError(e instanceof ApiClientError ? e.code : "NETWORK");
      }
    })();
    return () => {
      active = false;
    };
  }, [aura, analysisId]);

  const header = <Stack.Screen options={{ headerShown: true, title: t("title"), headerBackTitle: "Geri" }} />;
  if (error) {
    return (
      <>
        {header}
        <Screen>
          <Card title={tp("errorTitle")} description={tp(`errors.${error}`) === `plan.v2.errors.${error}` ? tp("errors.GENERIC") : tp(`errors.${error}`)} />
        </Screen>
      </>
    );
  }
  if (!state) return <>{header}<Screen><Text variant="muted">{t("generatingTitle")}</Text></Screen></>;
  if (state.kind === "legacy") return <>{header}<Screen><ReportView analysisId={analysisId} /></Screen></>;
  if (state.kind === "locked") {
    return (
      <>
        {header}
        <Screen>
          <Card title={t("lockedTitle")} description={tp("locked")}>
            <Button title={t("goPremium")} onPress={() => router.push({ pathname: "/premium", params: { analysis: analysisId } })} />
          </Card>
        </Screen>
      </>
    );
  }
  if (state.kind === "not_completed") return <>{header}<Screen><Text variant="muted">{tp("empty")}</Text></Screen></>;

  const report = state.a.report.locked ? null : state.a.report.value;
  return (
    <>
      {header}
      <Screen scroll={false} padded={false}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }} keyboardShouldPersistTaps="handled">
          <Text variant="title" accessibilityRole="header">{tp("title")}</Text>
          <ReportV3 report={report} analysisId={analysisId} viewsUsed={state.a.viewsUsed} glowUpEnabled={isMobileFeatureEnabled("glowUp")} onPlanPress={() => scrollRef.current?.scrollTo({ y: planY, animated: true })} />
          <View onLayout={(e) => setPlanY(e.nativeEvent.layout.y)}>
            <PlanViewV2 analysisId={analysisId} initial={state.initial} scrollRef={scrollRef} />
          </View>
        </ScrollView>
      </Screen>
    </>
  );
}
