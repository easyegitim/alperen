import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { getTeaserConfig } from "@/lib/config/teaser";
import type { ClientAnalysis, ClientAnalysisV2 } from "@/lib/score/present";
import { AnalysisProgress } from "@/mobile/src/components/analysis/AnalysisProgress";
import { ResultV2View } from "@/mobile/src/components/analysis/result/ResultV2View";
import { ScoreView } from "@/mobile/src/components/analysis/ScoreView";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { PaywallProvider } from "@/mobile/src/features/paywall/PaywallSheet";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { ApiClientError, type BillingStatusDto } from "@/mobile/src/lib/api";
import { scoped } from "@/mobile/src/lib/i18n";

const t = scoped("analysis");
const isV2 = (a: ClientAnalysis | ClientAnalysisV2): a is ClientAnalysisV2 => "stage" in a;

/**
 * /analiz/[id] (CONTRACTS_V2 S3.0/S3.1 ortak dosya): GET /api/analyses/[id] (kilitli değer gelmez) + hak durumu.
 *  - hybrid.v2 satırı, hak VAR → açık/kart kart dal (W7b: ResultV2View; yoklama ve açılış bileşenin içinde).
 *  - hybrid.v2 satırı, hak YOK → kilitli ekran W7a'nın (LockedResult + paywall v2); burada yalnız geçici kilit kartı.
 *  - eski satır (v1) → mevcut ScoreView.
 * Birleştirme notu: W7a'nın sürümündeki `ResultBranch` yer tutucusu `ResultV2View` ile (aynı props) değiştirilir.
 */
export default function AnalysisScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { aura } = useSession();
  const [a, setA] = useState<ClientAnalysis | ClientAnalysisV2 | null>(null);
  const [status, setStatus] = useState<BillingStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([aura.analyses.getLegacy(id), aura.billing.status(id).catch(() => null)])
      .then(([res, st]) => {
        if (!active) return;
        setA(res);
        setStatus(st);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof ApiClientError ? e.code : "NETWORK");
      });
    return () => {
      active = false;
    };
  }, [aura, id]);

  // Teaser modu sunucunun ürettiği kilitlerde zaten uygulanmıştır; burada yalnız analitik etiketi için okunur.
  const teaserMode = getTeaserConfig({ TEASER_MODE: process.env.EXPO_PUBLIC_TEASER_MODE }).mode;
  const premium = Boolean(status?.premium);
  const entitled = status?.analysisEntitled === true;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("overallTitle"), headerBackTitle: "Geri" }} />
      <Screen>
        {error ? <Text accessibilityRole="alert">{t(`errors.${error}`) === `analysis.errors.${error}` ? t("errors.GENERIC") : t(`errors.${error}`)}</Text> : null}
        {!a && !error ? <AnalysisProgress done={false} /> : null}
        {a && !isV2(a) ? (
          a.status === "completed" ? (
            <PaywallProvider teaserMode={teaserMode}>
              <ScoreView a={a} premium={premium} />
            </PaywallProvider>
          ) : (
            <Text variant="muted">{a.status === "failed" ? t("statusFailed") : t("statusProcessing")}</Text>
          )
        ) : null}
        {a && isV2(a) && entitled ? <ResultV2View initial={a} onUpdate={(next) => setA(next)} /> : null}
        {a && isV2(a) && !entitled ? (
          // W7a: LockedResult (halka+kilit, bulanık çubuklar, oranlar açık) + paywall v2 sheet burada gelir.
          <Card title={t("locked.title")} description={t("locked.unlockBody")}>
            <Button title={t("locked.cta")} size="lg" onPress={() => router.push({ pathname: "/premium", params: { analysis: a.id } })} />
          </Card>
        ) : null}
      </Screen>
    </>
  );
}
