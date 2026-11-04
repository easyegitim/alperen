import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import type { ClientAnalysisSummary } from "@/lib/score/present";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { scoped } from "@/mobile/src/lib/i18n";

const t = scoped("report");
const tp = scoped("placeholders.plan");
type Status = { premium: boolean };

/** /plan: son tamamlanmış analizin planı; premium değilse kilit kartı; analiz yoksa boş durum. */
export default function PlanTab() {
  const { api } = useSession();
  const [state, setState] = useState<{ latest: string | null; premium: boolean } | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void Promise.all([api.get<ClientAnalysisSummary[]>("/api/analyses").catch(() => []), api.get<Status>("/api/billing/status").catch(() => null)]).then(([list, st]) => {
        if (!active) return;
        const latest = (list ?? []).find((a) => a.status === "completed")?.id ?? null;
        setState({ latest, premium: Boolean(st?.premium) });
      });
      return () => {
        active = false;
      };
    }, [api]),
  );

  if (!state) return <Screen><Text variant="muted">…</Text></Screen>;
  if (!state.premium) {
    return (
      <Screen>
        <Card title={t("lockedTitle")} description={t("lockedBody")}>
          <Button title={t("goPremium")} onPress={() => router.push("/premium")} />
        </Card>
      </Screen>
    );
  }
  if (!state.latest) {
    return (
      <Screen>
        <Card title={tp("title")} description={tp("body")}>
          <Button title={scoped("analysis")("newAnalysis")} onPress={() => router.push("/tara")} />
        </Card>
      </Screen>
    );
  }
  return (
    <Screen>
      <Card title={t("title")}>
        <Button title={scoped("analysis")("seePlan")} onPress={() => router.push({ pathname: "/plan/[id]", params: { id: state.latest! } })} />
      </Card>
    </Screen>
  );
}
