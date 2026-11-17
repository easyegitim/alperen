import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View, type ScrollView as ScrollViewType } from "react-native";
import { track } from "@/lib/analytics";
import { PLAN_AREAS, type PlanArea } from "@/lib/config/plan";
import { BasisChips } from "@/mobile/src/components/plan/BasisChips";
import { DoctorLayer } from "@/mobile/src/components/plan/DoctorLayer";
import { HairLossCard } from "@/mobile/src/components/plan/HairLossCard";
import { PlanPhases } from "@/mobile/src/components/plan/PlanPhases";
import { PriorityTable } from "@/mobile/src/components/plan/PriorityTable";
import { StepCard } from "@/mobile/src/components/plan/StepCard";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { ApiClientError } from "@/mobile/src/lib/api";
import { isMobileFeatureEnabled } from "@/mobile/src/lib/flags";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import { exclusionEntries, hairLossOf, hasScalpStepIn, layerCounts, planAreas, planErrorAction, stepsForTab, type PlanPayload } from "./viewModel";

const t = scoped("plan.v2");

type Props = {
  analysisId: string;
  /** Saklı plan (GET /api/plan/[id]); null → ilk açılışta üretilir (POST /api/plan). */
  initial: PlanPayload | null;
  /** Dış ScrollView'a kaydırma (öncelik tablosu/faz çipi → kart). */
  scrollRef?: React.RefObject<ScrollViewType | null>;
};

/**
 * Plan v2 (PLAN 4d; web components/plan/PlanView eşi): plan yoksa ilk açılışta üretilir; sunucu hak ve kilit kurallarını
 * uygular. Anket yoksa (BAD_INPUT) /plan/[id]/anket; hak yoksa /premium. Yeniden üretim mevcut planı kaldırmaz.
 * Doktor katmanı FEATURE_DOCTOR_LAYER kapalıyken "off" → gizli.
 */
export function PlanViewV2({ analysisId, initial, scrollRef }: Props) {
  const { colors } = useTheme();
  const { aura } = useSession();
  const [data, setData] = useState<PlanPayload | null>(initial);
  const [status, setStatus] = useState<"idle" | "generating" | "error">(initial ? "idle" : "generating");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [regen, setRegen] = useState<{ busy: boolean; errorCode: string | null }>({ busy: false, errorCode: null });
  const [tab, setTab] = useState<PlanArea | "all">("all");
  const positions = useRef<Record<string, number>>({});
  const jumpRef = useRef<string | null>(null);
  /** Doktor katmanının dikey konumu (saç dökülmesi kartındaki "doktor katmanı" bağlantısı; web #section-doctor). */
  const doctorY = useRef<number | null>(null);

  const generate = useCallback(
    async (regenerate = false) => {
      const inline = regenerate && data !== null;
      if (inline) setRegen({ busy: true, errorCode: null });
      else {
        setStatus("generating");
        setErrorCode(null);
      }
      try {
        const r = await aura.plan.create(analysisId, regenerate);
        if (!r) throw new Error("empty");
        setData({ view: r.view, hairLossSignal: hairLossOf(r.hairLossSignal as PlanPayload["hairLossSignal"]) });
        setStatus("idle");
        setRegen({ busy: false, errorCode: null });
        track("plan_viewed");
      } catch (e) {
        const code = e instanceof ApiClientError ? e.code : "NETWORK";
        if (inline) setRegen({ busy: false, errorCode: code });
        else {
          setErrorCode(code);
          setStatus("error");
          if (planErrorAction(code) === "questionnaire") router.replace({ pathname: "/plan/[id]/anket", params: { id: analysisId } });
        }
      }
    },
    [aura, analysisId, data],
  );

  useEffect(() => {
    // Yalnız açılış; asenkron başlatılır (efekt gövdesinde senkron setState yok).
    if (!initial) void Promise.resolve().then(() => generate());
    else track("plan_viewed");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız ilk açılış
  }, []);

  const scrollToStep = (stepId: string) => {
    const y = positions.current[stepId];
    if (y !== undefined) scrollRef?.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
  };
  useEffect(() => {
    if (tab !== "all" || !jumpRef.current) return;
    const id = jumpRef.current;
    jumpRef.current = null;
    const timer = setTimeout(() => scrollToStep(id), 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız sekme "Tümü"ye dönünce
  }, [tab]);
  const jump = (stepId: string) => {
    if (tab === "all") {
      scrollToStep(stepId);
      return;
    }
    jumpRef.current = stepId;
    setTab("all");
  };

  const plan = data?.view.plan ?? null;
  const areas = useMemo(() => planAreas(plan), [plan]);

  if (status === "generating") return <Card title={t("generating.title")} description={t("generating.body")} />;
  if (status === "error" || !plan || !data) {
    const code = errorCode ?? "GENERIC";
    const msg = t(`errors.${code}`) === `plan.v2.errors.${code}` ? t("errors.GENERIC") : t(`errors.${code}`);
    const action = planErrorAction(code);
    return (
      <Card title={t("errorTitle")} description={msg}>
        {action === "questionnaire" ? (
          <Button title={t("basis.edit")} onPress={() => router.push({ pathname: "/plan/[id]/anket", params: { id: analysisId } })} />
        ) : action === "premium" ? (
          <Button title={t("locked")} onPress={() => router.push({ pathname: "/premium", params: { analysis: analysisId } })} />
        ) : (
          <Button title={t("retry")} onPress={() => void generate()} />
        )}
      </Card>
    );
  }

  const hairLoss = hairLossOf(data.hairLossSignal);
  const exclusions = exclusionEntries(plan);
  const fallback = plan.disclaimers.includes("deterministicFallback");
  const counts = layerCounts(data.view);
  const expertNetworkEnabled = isMobileFeatureEnabled("expertNetwork");
  const glowUpEnabled = isMobileFeatureEnabled("glowUp");
  const chip = (key: PlanArea | "all", label: string) => (
    <Button key={key} title={label} variant={tab === key ? "primary" : "outline"} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: radius.full }} onPress={() => setTab(key)} />
  );

  return (
    <View style={{ gap: spacing.md }}>
      <Text variant="muted" style={{ fontSize: 13, lineHeight: 19 }}>{t("intro")}</Text>
      <BasisChips chips={plan.basisChips} analysisId={analysisId} stale={data.view.basisStale} />
      {fallback ? <Text variant="small" style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.lg, padding: spacing.sm }}>{t("fallbackNote")}</Text> : null}
      {exclusions.map((e) => (
        <Text key={e.key} variant="small" style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.lg, padding: spacing.sm }}>{t(`exclusions.${e.key}.${e.value}`)}</Text>
      ))}

      <Card title={t("title")} description={t("stepCount", { n: plan.steps.length })}>
        <PlanPhases phases={plan.phases} steps={plan.steps} onJump={jump} />
        <PriorityTable rows={plan.priorityTable} steps={plan.steps} onJump={jump} />
        <View style={{ gap: spacing.sm }}>
          <Text variant="small" style={{ fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 }}>{t("layersTitle")}</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {(["diy", "expert", "doctor"] as const).map((tier) => (
              <View key={tier} style={{ flex: 1, alignItems: "center", backgroundColor: colors.muted, borderRadius: radius.lg, padding: spacing.sm }}>
                <Text style={{ fontSize: 12, fontWeight: "600" }}>{t(`tiers.${tier}`)}</Text>
                <Text variant="small">{counts[tier]}</Text>
                <Text variant="small" style={{ fontSize: 10, textAlign: "center" }}>{t(`tiersHint.${tier}`)}</Text>
              </View>
            ))}
          </View>
        </View>
      </Card>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }} accessibilityLabel={t("tabsAria")}>
        {chip("all", t("allTab"))}
        {areas.map((a) => chip(a, t(`tabs.${a}`)))}
      </ScrollView>
      <View style={{ gap: spacing.sm }}>
        {stepsForTab(plan, tab).map((s) => (
          <View key={s.id} onLayout={tab === "all" ? (e) => void (positions.current[s.id] = e.nativeEvent.layout.y) : undefined}>
            <StepCard step={s} />
          </View>
        ))}
        {tab !== "all" && !(PLAN_AREAS as readonly string[]).includes(tab) ? null : tab !== "all" && !plan.steps.some((s) => s.area === tab) ? <Text variant="small">{t("emptyTab")}</Text> : null}
      </View>

      {hairLoss ? (
        <HairLossCard
          signal={hairLoss}
          doctorLayerEnabled={isMobileFeatureEnabled("doctorLayer") && data.view.doctor.state !== "off"}
          expertNetworkEnabled={expertNetworkEnabled}
          hasScalpStep={hasScalpStepIn(plan.steps)}
          onDoctorPress={() => {
            const y = doctorY.current;
            if (y !== null) scrollRef?.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
          }}
        />
      ) : null}
      <View onLayout={(e) => void (doctorY.current = e.nativeEvent.layout.y)}>
        <DoctorLayer doctor={data.view.doctor} expertNetworkEnabled={expertNetworkEnabled} analysisId={analysisId} />
      </View>

      {glowUpEnabled ? (
        <Card>
          <Text style={{ fontWeight: "600", fontSize: 14 }}>{t("glowUpCta")}</Text>
          <Text variant="small">{t("glowUpBody")}</Text>
          <Button
            title={t("glowUpOpen")}
            onPress={() => {
              track("glowup_viewed");
              router.push({ pathname: "/(tabs)/dene", params: { mode: "glow_up", analysis: analysisId } });
            }}
          />
        </Card>
      ) : null}

      <View style={{ gap: spacing.xs }}>
        <Button title={regen.busy ? t("regen.busy") : t("regen.cta")} variant="ghost" busy={regen.busy} onPress={() => void generate(true)} />
        {regen.errorCode ? <Text accessibilityRole="alert" variant="small" style={{ color: colors.warn, textAlign: "center" }}>{t(`errors.${regen.errorCode}`) === `plan.v2.errors.${regen.errorCode}` ? t("errors.GENERIC") : t(`errors.${regen.errorCode}`)}</Text> : null}
        <Text variant="small" style={{ textAlign: "center" }}>{t("regen.note")}</Text>
      </View>
      <View style={{ gap: 2 }}>
        {plan.disclaimers.map((d) => (
          <Text key={d} variant="small" style={{ textAlign: "center" }}>{t(`disclaimers.${d}`)}</Text>
        ))}
      </View>
    </View>
  );
}
