import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { track } from "@/lib/analytics";
import { TRYON_IMAGE_MAX_BYTES } from "@/lib/api/tryonInput";
import { landmarksToCrop } from "@/lib/face/crop";
import { IDX } from "@/lib/face/indices";
import { driftPolicyForPresets } from "@/lib/tryon/composite";
import { GLOW_UP_LAYERS, TRYON_MODES, glowUpSkinActive, maskRegionFor, type GlowUpLayer, type TryonMode, type TryonPresets } from "@/lib/tryon/types";
import { ComboPicker } from "@/mobile/src/components/tryon/ComboPicker";
import { GlowUpPanel } from "@/mobile/src/components/tryon/GlowUpPanel";
import { QcFailedCard } from "@/mobile/src/components/tryon/QcFailedCard";
import { QuotaBar, TryonConsentCard, TryonGenerating } from "@/mobile/src/components/tryon/TryonStateCards";
import { TryonResult, type TryonResultView } from "@/mobile/src/components/tryon/TryonResult";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { getSessionSelfie } from "@/mobile/src/features/capture/sessionSelfie";
import { planStepsLite, recommendedFromPlan, type PlanStepLite } from "@/mobile/src/features/plan/viewModel";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { shareBase64Jpeg } from "@/mobile/src/features/share/renderCard";
import { buildTryonBody, eyeLineRatio, glowUpRequest, initialSelection, modesFor, nextUsed, resultTitle, styleRequest, type RunRequest } from "@/mobile/src/features/tryon/request";
import { shareTryonResult, tryonSharePlan } from "@/mobile/src/features/tryon/share";
import { stepTitle } from "@/mobile/src/features/tryon/stepTitles";
import { ApiClientError, type TryonStatusDto } from "@/mobile/src/lib/api";
import { isMobileFeatureEnabled } from "@/mobile/src/lib/flags";
import { scoped } from "@/mobile/src/lib/i18n";
import { cropSquareBase64, deleteQuietly } from "@/mobile/src/native/images";
import { compositeTryonNative, stampAiLabelBase64 } from "@/mobile/src/native/tryon";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("tryon");
type Stage = "gallery" | "generating" | "result" | "qc_failed";
type Context = { status: TryonStatusDto; analysisId: string | null; planSteps: PlanStepLite[]; recommended: string[] };
const CROP_SIZE = 1024;
const epochNow = () => Date.now();

/**
 * /dene v2 (F11; KB §7; PLAN 5a–5e; CONTRACTS_V2 S3.1): mod (tek stil · kombin · iyileşmiş halin) → (rıza) → selfie bellekte
 * → POST /api/tryon (v2 gövde; Claude kalite kontrolü sunucuda; geçmeyen görsel hiç gelmez, hak düşmez) → Skia kompoziti
 * (yüz orijinal piksellerle; glow-up'ta doku kapısı) → gözlere hizalı önce/sonra → paylaş (etiket gömülü) / "Bozuk görünüyor".
 * Derin bağlantılar: ?preset=<id> (adım kartı "Dene"), ?mode=glow_up&analysis=<id> (rapor/plan "İyileşmiş halin").
 */
export default function TryonTab() {
  const { colors } = useTheme();
  const { aura, api } = useSession();
  const params = useLocalSearchParams<{ preset?: string; mode?: string; analysis?: string }>();
  const flags = useMemo(() => ({ combo: isMobileFeatureEnabled("tryonCombo"), glowUp: isMobileFeatureEnabled("glowUp") }), []);
  const modes = useMemo(() => modesFor(flags), [flags]);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [mode, setMode] = useState<TryonMode>("style");
  const [picked, setPicked] = useState<TryonPresets>({});
  const [layers, setLayers] = useState<GlowUpLayer[]>([...GLOW_UP_LAYERS]);
  const [stage, setStage] = useState<Stage>("gallery");
  const [pending, setPending] = useState<RunRequest | null>(null);
  const [used, setUsed] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TryonResultView | null>(null);
  const [flagged, setFlagged] = useState(false);
  const [sharing, setSharing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appliedParamsRef = useRef<string | null>(null);
  /** Selfie için /tara'ya gidildi; dönüşte bekleyen istek bir kez kendiliğinden çalışır (web TryonScreen.onCaptured). */
  const awaitingSelfieRef = useRef<RunRequest | null>(null);
  const [autoRun, setAutoRun] = useState<RunRequest | null>(null);
  const autoRunDoneRef = useRef<RunRequest | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        try {
          const status = await aura.tryon.status();
          if (!status) throw new Error("empty");
          // Glow-up bağı: istenen analiz (tamamlanmış) ya da en son tamamlanmış analiz; plan adımları o analizin planından.
          const list = await aura.analyses.list().catch(() => null);
          const completed = (list ?? []).filter((a) => a.status === "completed");
          const requested = params.analysis && completed.some((a) => a.id === params.analysis) ? params.analysis : null;
          const analysisId = requested ?? completed[0]?.id ?? null;
          const plan = analysisId ? await aura.plan.get(analysisId).catch(() => null) : null;
          const view = plan?.view ?? null;
          if (!active) return;
          setCtx({ status, analysisId, planSteps: planStepsLite(view), recommended: [...new Set([...recommendedFromPlan(view), ...status.recommended])] });
          setUsed(status.quota?.used ?? 0);
          // Çekimden dönüş: selfie artık bellekte → bekleyen istek kendiliğinden başlar (yalnız bir kez; aşağıdaki efekt).
          const awaited = awaitingSelfieRef.current;
          if (awaited && getSessionSelfie() && status.premium && status.hasConsent) {
            awaitingSelfieRef.current = null;
            setAutoRun(awaited);
          }
          const key = `${params.preset ?? ""}|${params.mode ?? ""}`;
          if (appliedParamsRef.current !== key) {
            appliedParamsRef.current = key;
            const wanted = TRYON_MODES.find((m): m is TryonMode => m === params.mode);
            if (wanted && modes.includes(wanted)) setMode(wanted);
            const sel = initialSelection(params.preset);
            if (Object.keys(sel).length) {
              setMode("style");
              setPicked(sel);
            }
          }
        } catch {
          if (active) setCtx(null);
        }
      })();
      return () => {
        active = false;
      };
    }, [aura, params.analysis, params.preset, params.mode, modes]),
  );

  async function giveConsent() {
    if (!ctx) return;
    try {
      await api.post("/api/consents", { type: "tryon_generation", granted: true, textVersion: ctx.status.consentVersion });
      track("consent_updated", { type: "tryon_generation", granted: true });
      setCtx({ ...ctx, status: { ...ctx.status, hasConsent: true } });
    } catch {
      Alert.alert(t("consentError"));
    }
  }

  function start(req: RunRequest) {
    setPending(req);
    setError(null);
    if (!getSessionSelfie()) {
      awaitingSelfieRef.current = req;
      router.push({ pathname: "/tara", params: { purpose: "tryon" } });
      return;
    }
    void run(req);
  }

  async function run(req: RunRequest) {
    const selfie = getSessionSelfie();
    if (!selfie || !ctx) return;
    setStage("generating");
    setElapsed(0);
    const startedAt = epochNow();
    timerRef.current = setInterval(() => setElapsed(Math.round((epochNow() - startedAt) / 1000)), 1000);
    if (req.mode === "combo") track("tryon_combo_started");
    else if (req.mode === "style") {
      const kind = (["hair", "beard", "color"] as const).find((k) => req.presets[k]);
      if (kind) track("tryon_started", { presetKind: kind });
    }
    let cUri: string | null = null;
    let eventId: string | null = null;
    let afterUri: string | null = null;
    try {
      // 1024 px kare kırpım C + kırpım uzayında landmark'lar (SPEC 10.3 adım 4); görsel yalnız /api/tryon'a gider.
      const crop = await cropSquareBase64(selfie.uri, selfie.landmarksPx, selfie.width, selfie.height, CROP_SIZE, TRYON_IMAGE_MAX_BYTES, 0.9);
      cUri = crop.uri;
      const landmarksC = landmarksToCrop(selfie.landmarksPx, crop.box, CROP_SIZE);
      const res = await aura.tryon.run(buildTryonBody(req, crop.base64, ctx.analysisId));
      if (!res) throw new Error("empty");
      eventId = res.eventId;
      // Maske ve doku kapısı sunucunun uyguladığı katmanlara göre (cilt kapalıysa yüz saç/sakal denemesi gibi geri yazılır).
      const protect = maskRegionFor(res.mode, res.presets, res.layers);
      const out = await compositeTryonNative(cUri, landmarksC, res.image, protect, driftPolicyForPresets(res.presets), { glowUp: glowUpSkinActive(res.mode, res.layers) });
      if (!out.ok) {
        console.warn("[tryon] kontrol başarısız:", out.reason); // yalnız neden kodu; görsel/nokta yok
        await aura.tryon.drift(eventId).catch(() => undefined);
        track("tryon_result", { status: "identity_drift", durationMs: epochNow() - startedAt });
        setError(t("driftMessage"));
        setStage("gallery");
        await deleteQuietly(cUri);
        return;
      }
      afterUri = out.uri;
      setResult({
        eventId,
        mode: res.mode,
        title: resultTitle(res.mode, res.presets, req.title),
        beforeUri: cUri,
        afterUri: out.uri,
        eyeLineY: res.mode === "glow_up" ? eyeLineRatio(landmarksC, CROP_SIZE, IDX.irisR, IDX.irisL) : null,
        appliedSteps: res.appliedStepIds.map((id) => ({ id, title: stepTitle(id, ctx.planSteps) })),
        qc: res.qc,
        regenCount: res.regenCount,
      });
      setFlagged(false);
      setUsed((u) => nextUsed(u, res.weight));
      track("tryon_result", { status: "success", durationMs: epochNow() - startedAt });
      setStage("result");
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : "NETWORK";
      track("tryon_result", { status: code, durationMs: epochNow() - startedAt });
      await deleteQuietly(cUri);
      await deleteQuietly(afterUri);
      if (code === "TRYON_QC_FAILED") {
        // Kontrolden geçmeyen görsel hiç gelmedi; hak düşmedi (Ç10).
        track("tryon_qc_failed");
        setStage("qc_failed");
        return;
      }
      const planRequired = e instanceof ApiClientError && code === "BAD_INPUT" && e.message === "plan_required";
      const key = t(`errors.${code}`) !== `tryon.errors.${code}` ? t(`errors.${code}`) : t(`v2.errors.${code}`) !== `tryon.v2.errors.${code}` ? t(`v2.errors.${code}`) : t("errors.GENERIC");
      setError(planRequired ? t("v2.glowUp.planRequired") : key);
      setStage("gallery");
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }

  useEffect(() => {
    if (!autoRun || !ctx || stage !== "gallery" || autoRunDoneRef.current === autoRun) return;
    autoRunDoneRef.current = autoRun; // her istek yeni nesne: bir kez çalışır
    void run(autoRun);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run bileşen kapsamındaki durumla her çağrıda taze; yalnız autoRun tetikler
  }, [autoRun, ctx, stage]);

  async function share() {
    if (!result) return;
    setSharing(true);
    try {
      const r = await shareTryonResult(result.afterUri, tryonSharePlan(result), { stamp: stampAiLabelBase64, share: shareBase64Jpeg });
      Alert.alert(r === "shared" ? t("v2.result.shared") : t("v2.result.shareError"));
    } catch {
      Alert.alert(t("v2.result.shareError"));
    } finally {
      setSharing(false);
    }
  }

  async function flagBroken() {
    if (!result || flagged) return;
    try {
      await aura.tryon.flag(result.eventId);
      setFlagged(true);
      track("tryon_flagged_broken");
      Alert.alert(t("v2.flagBrokenThanks"));
    } catch {
      Alert.alert(t("errors.GENERIC"));
    }
  }

  async function back() {
    if (result) {
      await deleteQuietly(result.beforeUri);
      await deleteQuietly(result.afterUri);
    }
    setResult(null);
    setStage("gallery");
  }

  if (!ctx) return <Screen><Text variant="muted">…</Text></Screen>;
  const { status } = ctx;
  if (!status.premium) {
    return (
      <Screen>
        <Card title={t("lockedTitle")} description={t("lockedBody")}>
          <Button title={t("goPremium")} onPress={() => router.push("/premium")} />
        </Card>
      </Screen>
    );
  }
  if (!status.hasConsent) {
    return (
      <Screen>
        <TryonConsentCard onAccept={() => void giveConsent()} />
      </Screen>
    );
  }
  if (stage === "generating") {
    const title = pending?.mode === "combo" ? t("v2.generatingCombo") : pending?.mode === "glow_up" ? t("v2.generatingGlowUp") : t("generating.title", { name: pending?.title ?? "" });
    return <Screen><TryonGenerating title={title} elapsed={elapsed} /></Screen>;
  }
  if (stage === "qc_failed") return <Screen><QcFailedCard onBack={() => void back()} /></Screen>;
  if (stage === "result" && result) {
    return <Screen><TryonResult result={result} onShare={() => void share()} onFlag={() => void flagBroken()} flagged={flagged} onBack={() => void back()} sharing={sharing} /></Screen>;
  }

  const limit = status.quota?.limit ?? 0;
  const remaining = Math.max(0, limit - used);
  return (
    <Screen>
      <QuotaBar remaining={remaining} limit={limit} nextAt={status.quota?.nextAt ?? null} />
      {error ? (
        <View accessibilityRole="alert" style={{ gap: spacing.sm, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md }}>
          <Text style={{ fontWeight: "500", fontSize: 14 }}>{error}</Text>
          {pending && remaining > 0 ? <Button title={`${t("retry")} · ${pending.title}`} variant="outline" onPress={() => start(pending)} /> : null}
        </View>
      ) : null}
      {!getSessionSelfie() ? <Text variant="small">{t("needSelfie")}</Text> : null}
      <View style={{ flexDirection: "row", gap: spacing.xs }} accessibilityRole="tablist">
        {modes.map((m) => (
          <Button key={m} title={t(`v2.modes.${m}`)} variant={mode === m ? "primary" : "outline"} style={{ flex: 1, minHeight: 40 }} accessibilityState={{ selected: mode === m }} onPress={() => { setMode(m); setPicked({}); }} />
        ))}
      </View>
      <Text variant="small">{t(`v2.modeHint.${mode}`)}</Text>
      {mode === "glow_up" ? (
        <GlowUpPanel layers={layers} onChange={setLayers} onRun={() => { track("glowup_viewed"); start(glowUpRequest(layers, t("v2.glowUp.title"))); }} planSteps={ctx.planSteps} analysisId={ctx.analysisId} disabled={remaining === 0} />
      ) : (
        <ComboPicker mode={mode} value={picked} onChange={setPicked} onRun={() => start(styleRequest(mode === "combo" ? "combo" : "style", picked))} recommended={ctx.recommended} presentation={status.presentation} disabled={remaining === 0} />
      )}
      <Text variant="small">{mode === "glow_up" ? t("v2.glowUp.skinNote") : t("galleryNote")} {t("v2.aiLabelNote")}</Text>
    </Screen>
  );
}
