import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { scoped } from "@/mobile/src/lib/i18n";

const t = scoped("report");
const tp = scoped("placeholders.plan");
const tv = scoped("plan.v2");

/** /plan (CONTRACTS_V2 S3.1): son tamamlanmış analiz → /plan/[id]; bu analize hak yoksa kilit kartı; analiz yoksa boş durum. */
export default function PlanTab() {
  const { aura } = useSession();
  const [state, setState] = useState<{ latest: string | null; entitled: boolean } | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const list = await aura.analyses.list().catch(() => null);
        const latest = (list ?? []).find((a) => a.status === "completed")?.id ?? null;
        const st = await aura.billing.status(latest ?? undefined).catch(() => null);
        if (!active) return;
        // Hak: bu analize bağlı tek seferlik rapor ya da aktif abonelik; sunucu son sözü söyler (plan rotası yine kontrol eder).
        setState({ latest, entitled: st?.analysisEntitled === true || Boolean(st?.premium) });
      })();
      return () => {
        active = false;
      };
    }, [aura]),
  );

  if (!state) return <Screen><Text variant="muted">…</Text></Screen>;
  if (!state.latest) {
    return (
      <Screen>
        <Card title={tp("title")} description={tp("body")}>
          <Button title={scoped("analysis")("newAnalysis")} onPress={() => router.push("/tara")} />
        </Card>
      </Screen>
    );
  }
  if (!state.entitled) {
    return (
      <Screen>
        <Card title={t("lockedTitle")} description={tv("locked")}>
          <Button title={t("goPremium")} onPress={() => router.push({ pathname: "/premium", params: { analysis: state.latest as string } })} />
        </Card>
      </Screen>
    );
  }
  return (
    <Screen>
      <Card title={tv("title")} description={tv("intro")}>
        <Button title={scoped("analysis")("seePlan")} onPress={() => router.push({ pathname: "/plan/[id]", params: { id: state.latest as string } })} />
      </Card>
    </Screen>
  );
}
