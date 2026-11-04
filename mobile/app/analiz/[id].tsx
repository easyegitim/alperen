import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { getTeaserConfig } from "@/lib/config/teaser";
import type { ClientAnalysis, ClientAnalysisV2 } from "@/lib/score/present";
import { AnalysisProgress } from "@/mobile/src/components/analysis/AnalysisProgress";
import { LockedResult } from "@/mobile/src/components/analysis/LockedResult";
import { ScoreView } from "@/mobile/src/components/analysis/ScoreView";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { pendingSetFor } from "@/mobile/src/features/capture/captureSession";
import { boundSelfieFor } from "@/mobile/src/features/capture/sessionSelfie";
import { uploadPendingSet } from "@/mobile/src/features/capture/upload";
import { PaywallProvider } from "@/mobile/src/features/paywall/PaywallSheet";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { ApiClientError, waitForAnalysis, type BillingStatusDto, type Presentation } from "@/mobile/src/lib/api";
import { scoped } from "@/mobile/src/lib/i18n";
import { getSupabase } from "@/mobile/src/lib/supabase";

const t = scoped("analysis");
type Loaded = { a: ClientAnalysis | ClientAnalysisV2; status: BillingStatusDto | null; profile: { presentation: Presentation | null; ageBand: string | null } };

const isV2 = (a: ClientAnalysis | ClientAnalysisV2): a is ClientAnalysisV2 => "stage" in a;

/**
 * /analiz/[id] (CONTRACTS_V2 S3.0/S3.1 ortak dosya): GET /api/analyses/[id] (kilitli değer gelmez) + hak durumu.
 *  - hybrid.v2 satırı, hak YOK → kilitli ekran (W7a: LockedResult + paywall sheet v2).
 *  - hybrid.v2 satırı, hak VAR → bellekteki set varsa /run'a gönderilir; set yoksa ve satır device_only ise "Çekime dön";
 *    aksi hâlde açık/kart kart dal (W7b: components/analysis/result/*; aşağıdaki ResultBranch yer tutucusunu W7b değiştirir).
 *  - eski satır (v1) → mevcut ScoreView.
 */
export default function AnalysisScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { aura } = useSession();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadedRef = useRef(false);

  const load = useCallback(async () => {
    const readProfile = async (): Promise<Loaded["profile"]> => {
      try {
        const { data } = await getSupabase().from("profiles").select("presentation, age_band").maybeSingle();
        return { presentation: (data?.presentation ?? null) as Presentation | null, ageBand: (data?.age_band ?? null) as string | null };
      } catch {
        return { presentation: null, ageBand: null };
      }
    };
    const [a, status, profile] = await Promise.all([aura.analyses.get(id), aura.billing.status(id).catch(() => null), readProfile()]);
    if (!a) throw new Error("empty_response");
    return { a, status, profile } satisfies Loaded;
  }, [aura, id]);

  useEffect(() => {
    let active = true;
    void load()
      .then((l) => {
        if (!active) return;
        setLoaded(l);
        // Hak var ve set bellekte (ödeme az önce bitti ya da hak zaten vardı): set bir kez gönderilir, sonra açık dal yoklar.
        const a = l.a;
        if (!isV2(a) || l.status?.analysisEntitled !== true || uploadedRef.current || !pendingSetFor(a.id)) return;
        if (a.stage !== "device_only" && a.stage !== "failed") return;
        uploadedRef.current = true;
        setUploading(true);
        void uploadPendingSet(aura, a.id)
          .then((r) => {
            if (!active) return;
            if (r.ok) setLoaded((cur) => (cur ? { ...cur, a: r.analysis } : cur));
            else if (r.reason === "api" && r.code) setError(r.code);
          })
          .finally(() => {
            if (active) setUploading(false);
          });
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof ApiClientError ? e.code : "NETWORK");
      });
    return () => {
      active = false;
    };
  }, [load, aura]);

  const a = loaded?.a ?? null;
  const entitled = loaded?.status?.analysisEntitled === true;
  const v2 = a && isV2(a) ? a : null;
  const hasPending = v2 ? pendingSetFor(v2.id) !== null : false;

  const teaserMode = getTeaserConfig({ TEASER_MODE: process.env.EXPO_PUBLIC_TEASER_MODE }).mode;
  const errText = error ? (t(`errors.${error}`) === `analysis.errors.${error}` ? t("errors.GENERIC") : t(`errors.${error}`)) : null;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("overallTitle"), headerBackTitle: "Geri" }} />
      <Screen>
        {errText ? <Text accessibilityRole="alert">{errText}</Text> : null}
        {!a && !error ? <AnalysisProgress done={false} /> : null}
        {a && !isV2(a) ? (
          a.status === "completed" ? (
            <PaywallProvider teaserMode={teaserMode}>
              <ScoreView a={a} premium={Boolean(loaded?.status?.premium)} />
            </PaywallProvider>
          ) : (
            <Text variant="muted">{a.status === "failed" ? t("statusFailed") : t("statusProcessing")}</Text>
          )
        ) : null}
        {v2 && !entitled ? (
          <PaywallProvider teaserMode={teaserMode} analysisId={v2.id} presentation={loaded?.profile.presentation} ageBand={loaded?.profile.ageBand}>
            {v2.stage === "failed" ? <Text variant="muted">{t("stage.failed")}</Text> : null}
            <LockedResult a={v2} source={boundSelfieFor(v2.id)} />
          </PaywallProvider>
        ) : null}
        {v2 && entitled ? (
          uploading ? (
            <AnalysisProgress done={false} />
          ) : (v2.stage === "device_only" || v2.stage === "failed") && !hasPending ? (
            <Card title={t("result.pending.title")} description={v2.stage === "failed" ? t("stage.failed") : t("result.pending.body")}>
              <Button title={t("result.pending.cta")} size="lg" onPress={() => router.push({ pathname: "/tara", params: { analysis: v2.id } })} />
            </Card>
          ) : (
            <ResultBranch initial={v2} onUpdate={(next) => setLoaded((l) => (l ? { ...l, a: next } : l))} />
          )
        ) : null}
      </Screen>
    </>
  );
}

/**
 * Açık/kart kart dal — W7b yer tutucusu (CONTRACTS_V2 S3.0: W7b `components/analysis/result/*` bileşenlerini ekler ve bu
 * bileşeni kendi ResultV2View'ıyla değiştirir; bu dosyanın kilit dallanmasına dokunmaz). Şimdilik: aşama metni + yoklama.
 */
function ResultBranch({ initial, onUpdate }: { initial: ClientAnalysisV2; onUpdate: (a: ClientAnalysisV2) => void }) {
  const { aura } = useSession();
  const [a, setA] = useState(initial);
  useEffect(() => {
    if (a.stage === "completed" || a.stage === "failed") return;
    const ac = new AbortController();
    void waitForAnalysis(aura, a.id, {
      signal: ac.signal,
      onUpdate: (next) => {
        setA(next);
        onUpdate(next);
      },
    });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız kimlik ve ilk aşama için başlar
  }, [a.id]);
  const sections = a.sectionsReady.join(", ");
  return (
    <Card title={t("result.title")} description={t(`stage.${a.stage}`)}>
      {a.stage === "running" ? <Text variant="small">{t("reveal.waiting")} {sections}</Text> : null}
      {a.stage === "completed" ? <Text variant="muted">{t("reveal.ready")}</Text> : null}
    </Card>
  );
}
