import { router } from "expo-router";
import { useEffect, useState, type PropsWithChildren } from "react";
import { Alert, Modal, View } from "react-native";
import { EXERCISES, EXERCISE_SAFETY_TEXT } from "@/content/exercises";
import { HABITS } from "@/content/habits";
import { getPreset } from "@/content/presets";
import { SKIN_STEPS } from "@/content/skin-steps";
import type { CoachReport, ReportPick } from "@/lib/ai/reportSchema";
import { track } from "@/lib/analytics";
import { FeedbackButtons } from "@/mobile/src/components/report/FeedbackButtons";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { addReportToRoutine } from "@/mobile/src/features/routine/addFromReport";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { isMobileFeatureEnabled } from "@/mobile/src/lib/flags";
import { ApiClientError } from "@/mobile/src/lib/api";
import { scoped, t as tt } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("report");
type Loaded = { reportId: string; report: CoachReport; isFallback: boolean };

/** /plan/[analysisId] (F09 mobil). Rapor yoksa ilk açılışta POST /api/reports ile üretilir (premium). */
export function ReportView({ analysisId }: { analysisId: string }) {
  const { api, user } = useSession();
  const [state, setState] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<"generating" | "idle" | "error">("generating");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(regenerate = false) {
    setStatus("generating");
    setErrorCode(null);
    try {
      const existing = regenerate ? null : await api.get<Loaded>(`/api/reports/${analysisId}`).catch((e: unknown) => (e instanceof ApiClientError && e.status === 404 ? null : Promise.reject(e)));
      const r = existing ?? (await api.post<Loaded>("/api/reports", { analysisId, regenerate }));
      if (!r) throw new Error("empty");
      setState(r);
      setStatus("idle");
      track("report_viewed");
    } catch (e) {
      setErrorCode(e instanceof ApiClientError ? e.code : "NETWORK");
      setStatus("error");
    }
  }

  useEffect(() => {
    // Yalnız açılış; asenkron başlatılır (efekt gövdesinde senkron setState yok).
    void Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız ilk açılış
  }, [analysisId]);

  async function addToRoutine() {
    if (!state || !user) return;
    setBusy(true);
    try {
      const n = await addReportToRoutine(user.id, state.report, state.report.exercises.length > 0);
      Alert.alert(n > 0 ? t("addedToRoutine", { n }) : t("alreadyInRoutine"));
    } catch {
      Alert.alert(t("routineError"));
    } finally {
      setBusy(false);
    }
  }

  if (status === "generating") return <Card title={t("generatingTitle")} description={t("generatingBody")} />;
  if (status === "error" || !state) {
    const msg = errorCode && t(`errors.${errorCode}`) !== `report.errors.${errorCode}` ? t(`errors.${errorCode}`) : t("errors.GENERIC");
    return (
      <Card title={t("errorTitle")} description={msg}>
        {errorCode === "PREMIUM_REQUIRED" ? <Button title={t("goPremium")} onPress={() => router.push("/premium")} /> : <Button title={t("retry")} onPress={() => void load()} />}
      </Card>
    );
  }

  const r = state.report;
  const reportId = state.reportId;
  return (
    <View style={{ gap: spacing.md }}>
      {state.isFallback ? <Text variant="small">{t("fallbackNote")}</Text> : null}
      <Section id="summary" title={t("sections.summary")} reportId={reportId}>
        <Text>{r.summary}</Text>
        <Text variant="muted">{r.scoreNarrative}</Text>
      </Section>
      {r.hair.length ? <Section id="hair" title={t("sections.hair")} reportId={reportId}>{r.hair.map((p) => <PickCard key={p.presetId} pick={p} />)}</Section> : null}
      {r.beard.length ? <Section id="beard" title={t("sections.beard")} reportId={reportId}>{r.beard.map((p) => <PickCard key={p.presetId} pick={p} />)}</Section> : null}
      {r.hairColor ? <Section id="color" title={t("sections.color")} reportId={reportId}><PickCard pick={r.hairColor} /></Section> : null}
      <Section id="skin" title={t("sections.skin")} reportId={reportId}>
        {(["morning", "evening", "weekly"] as const).map((slot) =>
          r.skincare[slot].length ? (
            <View key={slot} style={{ gap: 2 }}>
              <Text style={{ fontWeight: "600" }}>{t(`slots.${slot}`)}</Text>
              {r.skincare[slot].map((s, i) => {
                const def = SKIN_STEPS.find((x) => x.id === s.stepType);
                return <Text key={`${s.stepType}-${i}`}><Text style={{ fontWeight: "500" }}>{def?.nameTr ?? s.stepType}</Text> <Text variant="muted">— {s.note}</Text></Text>;
              })}
            </View>
          ) : null,
        )}
      </Section>
      {r.faceContours.enabled && r.faceContours.tips.length ? (
        <Section id="contours" title={t("sections.contours")} reportId={reportId}>{r.faceContours.tips.map((tip, i) => <Text key={i}>• {tip}</Text>)}</Section>
      ) : null}
      {r.exercises.length ? (
        <Section id="exercises" title={t("sections.exercises")} reportId={reportId}>
          {r.exercises.map((e) => {
            const def = EXERCISES.find((x) => x.id === e.id);
            return (
              <View key={e.id} style={{ gap: 2 }}>
                <Text style={{ fontWeight: "500" }}>{def?.nameTr ?? e.id} <Text variant="small">· {def?.doseTr}</Text></Text>
                <Text variant="muted">{e.why}</Text>
              </View>
            );
          })}
          <Text variant="small">{EXERCISE_SAFETY_TEXT}</Text>
        </Section>
      ) : null}
      {r.habits.length ? (
        <Section id="habits" title={t("sections.habits")} reportId={reportId}>
          {r.habits.map((h) => <Text key={h.id}><Text style={{ fontWeight: "500" }}>{HABITS.find((x) => x.id === h.id)?.nameTr ?? h.id}</Text> <Text variant="muted">— {h.target}</Text></Text>)}
        </Section>
      ) : null}
      {r.style.length ? <Section id="style" title={t("sections.style")} reportId={reportId}>{r.style.map((s, i) => <Text key={i}>• {s}</Text>)}</Section> : null}
      {r.seeProfessional ? (
        <Card title={t("sections.professional")} description={r.seeProfessional.text}>
          {isMobileFeatureEnabled("expertNetwork") ? <Button title={t("findExpert")} variant="outline" onPress={() => router.push({ pathname: "/uzman", params: { alan: r.seeProfessional!.specialty } })} /> : null}
        </Card>
      ) : null}
      <Button title={t("addToRoutine")} size="lg" busy={busy} onPress={addToRoutine} />
      <Button title={t("regenerate")} variant="ghost" disabled={busy} onPress={() => void load(true)} />
      <Text variant="small" style={{ textAlign: "center" }}>{tt("common.notMedicalAdvice")}</Text>
    </View>
  );
}

function Section({ id, title, reportId, children }: PropsWithChildren<{ id: string; title: string; reportId: string }>) {
  return (
    <Card title={title}>
      {children}
      <FeedbackButtons targetType="report" targetId={reportId} section={id} />
    </Card>
  );
}

function PickCard({ pick }: { pick: ReportPick }) {
  const { colors } = useTheme();
  const preset = getPreset(pick.presetId);
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: spacing.xs, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
      <Text style={{ fontWeight: "600" }}>{preset?.nameTr ?? pick.presetId}</Text>
      <Text variant="muted">{pick.why}</Text>
      <Text variant="small">{t("maintenance")}: {pick.maintenance}</Text>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button title={t("showBarber")} variant="outline" style={{ flex: 1 }} onPress={() => setOpen(true)} />
        <Button title={t("tryIt")} variant="outline" style={{ flex: 1 }} onPress={() => router.push({ pathname: "/(tabs)/dene", params: { preset: pick.presetId } })} />
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: "rgba(0,0,0,0.5)" }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm }}>
            <Text variant="heading">{preset?.nameTr ?? pick.presetId}</Text>
            <Text variant="muted">{t("barberHint")}</Text>
            <Text style={{ fontSize: 20, lineHeight: 30, padding: spacing.md, backgroundColor: colors.muted, borderRadius: radius.md }}>{pick.barberScript}</Text>
            <Button title={tt("common.back")} variant="outline" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
