import { router } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";
import type { PlanViewV2 } from "@/lib/coach/planTypes";
import { BODY_IMAGE_SCREEN_QUESTIONS, type BodyImageScreenQuestion, type BodyImageScreenResult } from "@/lib/config/plan";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { OptionRow } from "@/mobile/src/components/ui/OptionRow";
import { Text } from "@/mobile/src/components/ui/Text";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import { StepCard } from "./StepCard";

const t = scoped("doctor");
const ts = scoped("doctor.screen");

/** "risk" sonucu (KB §6.4): doktor katmanı kapalı, uzmanla konuşma önerisi; teşhis değildir. */
export function BodyImageRiskNotice({ expertNetworkEnabled }: { expertNetworkEnabled: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md }}>
      <Text style={{ fontSize: 15, fontWeight: "600" }}>{ts("riskTitle")}</Text>
      <Text variant="muted" style={{ fontSize: 13, lineHeight: 19 }}>{ts("riskBody")}</Text>
      <Text variant="small">{ts("riskNote")}</Text>
      {expertNetworkEnabled ? <Button title={t("talkToExpert")} variant="outline" onPress={() => router.push({ pathname: "/uzman", params: { alan: "psikolog" } })} /> : null}
    </View>
  );
}

/**
 * Beden algısı taraması (KB §6.4, R2-Ö4; PLAN 4f): 4 evet/hayır sorusu. YALNIZ sonuç sunucuya gider ve saklanır; cevaplar
 * ne saklanır ne analitiğe gider. Riskli cevapta doktor katmanı kapanır. Teşhis değildir.
 */
export function BodyImageScreen({ onResult, expertNetworkEnabled, analysisId }: { onResult: (r: BodyImageScreenResult) => void; expertNetworkEnabled: boolean; analysisId?: string }) {
  const { aura } = useSession();
  const { colors } = useTheme();
  const [answers, setAnswers] = useState<Partial<Record<BodyImageScreenQuestion, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BodyImageScreenResult | null>(null);
  const complete = BODY_IMAGE_SCREEN_QUESTIONS.every((q) => typeof answers[q] === "boolean");

  async function submit() {
    if (!complete) return;
    setBusy(true);
    try {
      const r = await aura.doctor.screen({ answers: answers as Record<BodyImageScreenQuestion, boolean>, ...(analysisId ? { analysisId } : {}) });
      if (!r) throw new Error("empty");
      setResult(r.result);
      onResult(r.result);
    } catch {
      Alert.alert(ts("error"));
    } finally {
      setBusy(false);
    }
  }

  if (result === "risk") return <BodyImageRiskNotice expertNetworkEnabled={expertNetworkEnabled} />;
  if (result === "ok") {
    return (
      <View style={{ gap: 4, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md }}>
        <Text style={{ fontSize: 15, fontWeight: "600" }}>{ts("okTitle")}</Text>
        <Text variant="muted" style={{ fontSize: 13 }}>{ts("okBody")}</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: spacing.sm, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md }}>
      <Text style={{ fontSize: 15, fontWeight: "600" }}>{ts("title")}</Text>
      <Text variant="muted" style={{ fontSize: 13, lineHeight: 19 }}>{ts("intro")}</Text>
      {BODY_IMAGE_SCREEN_QUESTIONS.map((q, i) => (
        <View key={q} style={{ gap: 6 }}>
          <Text style={{ fontSize: 14, fontWeight: "500" }}>{i + 1}. {ts(q)}</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }} accessibilityRole="radiogroup">
            <View style={{ flex: 1 }}><OptionRow kind="radio" label={ts("yes")} selected={answers[q] === true} onPress={() => setAnswers((a) => ({ ...a, [q]: true }))} /></View>
            <View style={{ flex: 1 }}><OptionRow kind="radio" label={ts("no")} selected={answers[q] === false} onPress={() => setAnswers((a) => ({ ...a, [q]: false }))} /></View>
          </View>
        </View>
      ))}
      <Button title={ts("submit")} disabled={!complete} busy={busy} onPress={() => void submit()} />
    </View>
  );
}

/**
 * Doktor katmanı (KB Ç3/Ç5): yalnız hekim onaylı öğeler (sunucu süzer). off (FEATURE_DOCTOR_LAYER kapalı) → gösterilmez;
 * under_18 → gösterilmez; screen_required → tarama; screen_risk → uzmanla konuşma; pending → bekliyor; available → kartlar.
 */
export function DoctorLayer({ doctor, expertNetworkEnabled, analysisId }: { doctor: PlanViewV2["doctor"]; expertNetworkEnabled: boolean; analysisId: string }) {
  const { aura } = useSession();
  const { colors } = useTheme();
  const [state, setState] = useState(doctor.state);
  const [steps, setSteps] = useState(doctor.steps);
  if (state === "off" || state === "under_18") return null;
  const onResult = async (r: BodyImageScreenResult) => {
    if (r === "risk") {
      setState("screen_risk");
      return;
    }
    try {
      const d = await aura.doctor.get(analysisId);
      if (!d) throw new Error("empty");
      setSteps(Array.isArray(d.steps) ? d.steps : []);
      setState(d.state ?? "none");
    } catch {
      setState("none");
    }
  };
  return (
    <Card title={t("title")} description={t("eyebrow")}>
      {state === "screen_required" ? (
        <BodyImageScreen onResult={(r) => void onResult(r)} expertNetworkEnabled={expertNetworkEnabled} analysisId={analysisId} />
      ) : state === "screen_risk" ? (
        <BodyImageRiskNotice expertNetworkEnabled={expertNetworkEnabled} />
      ) : state === "pending_review" ? (
        <Text variant="muted" style={{ fontSize: 13 }}>{t("pending")}</Text>
      ) : state === "none" ? (
        <Text variant="muted" style={{ fontSize: 13 }}>{t("none")}</Text>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Text variant="small" style={{ backgroundColor: colors.muted, borderRadius: radius.lg, padding: spacing.sm }}>{t("disclosure")}</Text>
          {steps.map((s) => (
            <StepCard key={s.id} step={s} />
          ))}
          <Text variant="small">{t("noDoseNote")}</Text>
          <Text variant="small">{t("notMedicalAdvice")}</Text>
        </View>
      )}
    </Card>
  );
}
