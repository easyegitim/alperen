import AsyncStorage from "@react-native-async-storage/async-storage";
import { Redirect, router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { track } from "@/lib/analytics";
import { AGE_GATE_PATH, CAPTURE_PATH, CONSENTS_PATH } from "@/lib/onboarding/gate";
import {
  ACTIVITIES, BEARD_GROWTHS, BEARD_PREFERENCES, BUDGETS, GOALS, HAIR_LENGTHS, HAIR_TYPES, JAW_HEALTH_ISSUES, MINUTES_PER_DAY, PRESENTATIONS, QuestionnaireSchema, SKIN_TYPES, type Questionnaire,
} from "@/lib/questionnaire";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Input } from "@/mobile/src/components/ui/Input";
import { CheckList, RadioList } from "@/mobile/src/components/ui/OptionRow";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { SwitchRow } from "@/mobile/src/components/ui/SwitchRow";
import { Text } from "@/mobile/src/components/ui/Text";
import { canContinue, DRAFT_KEY, parseDraft, STEPS, toDraft, toPayload, type Draft } from "@/mobile/src/features/onboarding/questionnaireDraft";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { useGate } from "@/mobile/src/features/session/useGate";
import { scoped } from "@/mobile/src/lib/i18n";
import { getSupabase } from "@/mobile/src/lib/supabase";
import { spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("questionnaire");

/** SPEC 9.2 anketi: ekran başına bir konu, ilerleme, geri; taslak AsyncStorage'da; gönderim POST /api/onboarding/questionnaire. */
export default function QuestionnaireScreen() {
  const { colors } = useTheme();
  const { api, user } = useSession();
  const gate = useGate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [stored, profile] = await Promise.all([
        AsyncStorage.getItem(DRAFT_KEY).catch(() => null),
        user ? getSupabase().from("profiles").select("questionnaire").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (!active) return;
      const existing = QuestionnaireSchema.safeParse(profile.data?.questionnaire);
      setDraft({ ...toDraft(existing.success ? existing.data : undefined), ...parseDraft(stored) });
    })();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (draft) void AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => undefined);
  }, [draft]);

  const step = STEPS[index];
  const ok = useMemo(() => (draft ? canContinue(step, draft) : false), [step, draft]);

  if (gate.ready && gate.redirect === AGE_GATE_PATH) return <Redirect href={AGE_GATE_PATH} />;
  if (gate.ready && gate.redirect === "/") return <Redirect href="/" />;
  if (gate.ready && gate.redirect === CONSENTS_PATH && !draft) return <Redirect href={CONSENTS_PATH} />;

  if (!draft) {
    return (
      <Screen>
        <Text variant="muted">…</Text>
      </Screen>
    );
  }
  const d = draft;
  const patch = (p: Partial<Draft>) => setDraft((cur) => ({ ...(cur ?? {}), ...p }));

  async function next() {
    if (index < STEPS.length - 1) {
      setIndex(index + 1);
      return;
    }
    const payload = toPayload(d);
    if (!payload) {
      Alert.alert(t("invalid"));
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/onboarding/questionnaire", payload);
      track("questionnaire_completed");
      await AsyncStorage.removeItem(DRAFT_KEY).catch(() => undefined);
      router.replace(CAPTURE_PATH);
    } catch {
      Alert.alert(t("error"));
    } finally {
      setBusy(false);
    }
  }

  const progress = Math.round(((index + 1) / STEPS.length) * 100);

  return (
    <Screen>
      <View style={{ gap: spacing.xs }}>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted }}>
          <View style={{ width: `${progress}%`, height: 6, borderRadius: 3, backgroundColor: colors.foreground }} />
        </View>
        <Text variant="small">{t("progress", { current: index + 1, total: STEPS.length })}</Text>
      </View>
      <Card title={t(`steps.${step}.title`)} description={t(`steps.${step}.description`)}>
        {step === "goals" ? <CheckList options={GOALS} selected={d.goals ?? []} label={(k) => t(`options.goals.${k}`)} onChange={(goals) => patch({ goals })} /> : null}
        {step === "presentation" ? <RadioList options={PRESENTATIONS} value={d.presentation} label={(k) => t(`options.presentation.${k}`)} onChange={(presentation) => patch({ presentation })} /> : null}
        {step === "hair" ? (
          <>
            <Text style={{ fontWeight: "500" }}>{t("fields.hairType")}</Text>
            <RadioList options={HAIR_TYPES} value={d.hairType} label={(k) => t(`options.hairType.${k}`)} onChange={(hairType) => patch({ hairType })} />
            <Text style={{ fontWeight: "500" }}>{t("fields.hairLength")}</Text>
            <RadioList options={HAIR_LENGTHS} value={d.hairLength} label={(k) => t(`options.hairLength.${k}`)} onChange={(hairLength) => patch({ hairLength })} />
          </>
        ) : null}
        {step === "beard" ? (
          <>
            <Text style={{ fontWeight: "500" }}>{t("fields.beardPreference")}</Text>
            <RadioList options={BEARD_PREFERENCES} value={d.beardPreference} label={(k) => t(`options.beardPreference.${k}`)} onChange={(beardPreference) => patch({ beardPreference })} />
            <Text style={{ fontWeight: "500" }}>{t("fields.beardGrowth")}</Text>
            <RadioList options={BEARD_GROWTHS} value={d.beardGrowth} label={(k) => t(`options.beardGrowth.${k}`)} onChange={(beardGrowth) => patch({ beardGrowth })} />
          </>
        ) : null}
        {step === "skin" ? <RadioList options={SKIN_TYPES} value={d.skinType} label={(k) => t(`options.skinType.${k}`)} onChange={(skinType) => patch({ skinType })} /> : null}
        {step === "budget" ? (
          <>
            <Text style={{ fontWeight: "500" }}>{t("fields.budget")}</Text>
            <RadioList options={BUDGETS} value={d.budget} label={(k) => t(`options.budget.${k}`)} onChange={(budget) => patch({ budget })} />
            <Text style={{ fontWeight: "500" }}>{t("fields.minutesPerDay")}</Text>
            <RadioList
              options={MINUTES_PER_DAY.map(String)}
              value={d.minutesPerDay ? String(d.minutesPerDay) : undefined}
              label={(k) => t("options.minutes", { n: Number(k) })}
              onChange={(v) => patch({ minutesPerDay: Number(v) as Questionnaire["minutesPerDay"] })}
            />
          </>
        ) : null}
        {step === "accessories" ? (
          <>
            <SwitchRow label={t("fields.glasses")} value={Boolean(d.glasses)} onChange={(glasses) => patch({ glasses })} />
            <SwitchRow label={t("fields.headCovering")} hint={t("fields.headCoveringHint")} value={Boolean(d.headCovering)} onChange={(headCovering) => patch({ headCovering })} />
            {typeof d.glasses !== "boolean" || typeof d.headCovering !== "boolean" ? (
              <Button title={t("next")} variant="outline" onPress={() => patch({ glasses: Boolean(d.glasses), headCovering: Boolean(d.headCovering) })} />
            ) : null}
          </>
        ) : null}
        {step === "body" ? (
          <>
            {!d.bodySkipped ? (
              <>
                <Input label={t("fields.heightCm")} keyboardType="number-pad" value={d.body?.heightCm ?? ""} onChangeText={(v) => patch({ body: { ...d.body, heightCm: v } })} />
                <Input label={t("fields.weightKg")} keyboardType="decimal-pad" value={d.body?.weightKg ?? ""} onChangeText={(v) => patch({ body: { ...d.body, weightKg: v } })} />
                <Text style={{ fontWeight: "500" }}>{t("fields.activity")}</Text>
                <RadioList options={ACTIVITIES} value={d.body?.activity} label={(k) => t(`options.activity.${k}`)} onChange={(activity) => patch({ body: { ...d.body, activity } })} />
              </>
            ) : (
              <Text variant="muted">{t("bodySkipped")}</Text>
            )}
            <Button title={d.bodySkipped ? t("bodyFill") : t("skip")} variant="ghost" onPress={() => patch({ bodySkipped: !d.bodySkipped })} />
          </>
        ) : null}
        {step === "jawHealth" ? (
          <CheckList options={JAW_HEALTH_ISSUES} selected={d.jawHealth ?? []} label={(k) => t(`options.jawHealth.${k}`)} onChange={(jawHealth) => patch({ jawHealth })} noneLabel={t("options.jawHealth.none")} />
        ) : null}
        {step === "note" ? (
          <Input label={t("fields.note")} placeholder={t("fields.notePlaceholder")} multiline maxLength={300} value={d.note ?? ""} onChangeText={(note) => patch({ note })} hint={`${d.note?.length ?? 0}/300`} style={{ minHeight: 100, textAlignVertical: "top", paddingTop: spacing.sm }} />
        ) : null}
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button title={t("back")} variant="outline" style={{ flex: 1 }} disabled={index === 0 || busy} onPress={() => setIndex(index - 1)} />
          <Button title={index === STEPS.length - 1 ? t("finish") : t("next")} style={{ flex: 1 }} disabled={!ok} busy={busy} onPress={next} />
        </View>
      </Card>
    </Screen>
  );
}
