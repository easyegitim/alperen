import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { track } from "@/lib/analytics";
import { BEARD_LENGTH_PREFS, BUDGET_BANDS, GOAL_DIRECTIONS, HAIR_LENGTH_PREFS, ONE_TIME_BUDGET_BANDS, PLAN_CONFIG, SPORT_DAYS, TIME_BANDS, WORK_TYPES } from "@/lib/config/plan";
import { GOALS, JAW_HEALTH_ISSUES, SKIN_TYPES } from "@/lib/questionnaire";
import type { PhotoConfirm, QuestionnaireV2 } from "@/lib/questionnaireV2";
import { Button } from "@/mobile/src/components/ui/Button";
import { Input } from "@/mobile/src/components/ui/Input";
import { CheckList, OptionRow, RadioList } from "@/mobile/src/components/ui/OptionRow";
import { Text } from "@/mobile/src/components/ui/Text";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import { AvatarPreview } from "./AvatarPreview";
import { STEPS_V2, canContinueV2, initialDraftV2, loadDraftV2, progressPct, saveDraftV2, toPayloadV2, type DraftV2, type Prefill, type StepV2 } from "./questionnaireDraft";

const t = scoped("questionnaire.v2");
const tq = scoped("questionnaire.options");

export type QuestionnaireWizardV2Props = {
  analysisId: string;
  initial?: QuestionnaireV2;
  prefill: Prefill;
  presentation: "male" | "female" | "unspecified";
  under18: boolean;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ fontWeight: "600", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</Text>
      {hint ? <Text variant="small">{hint}</Text> : null}
      {children}
    </View>
  );
}

/** Ç17: fotoğraftan tahmin + onayla/değiştir; tahmin yoksa Evet/Hayır seçimi şart. */
function PhotoConfirmRow({ label, hint, value, onChange }: { label: string; hint?: string; value: PhotoConfirm; onChange: (v: PhotoConfirm) => void }) {
  const { colors } = useTheme();
  const resolved = value.value ?? value.detected;
  return (
    <View style={{ gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.sm }}>
      <Text style={{ fontSize: 15, fontWeight: "500" }}>{label}</Text>
      {hint ? <Text variant="small">{hint}</Text> : null}
      <Text variant="small">{value.detected === null ? t("hints.photoUnknown") : `${t(value.detected ? "photoConfirm.detectedYes" : "photoConfirm.detectedNo")} · ${t("hints.photoPrefill")}`}</Text>
      <View style={{ flexDirection: "row", gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        <View style={{ flex: 1 }}><OptionRow kind="radio" label={t("photoConfirm.yes")} selected={resolved === true} onPress={() => onChange({ ...value, value: true })} /></View>
        <View style={{ flex: 1 }}><OptionRow kind="radio" label={t("photoConfirm.no")} selected={resolved === false} onPress={() => onChange({ ...value, value: false })} /></View>
      </View>
    </View>
  );
}

/**
 * Ödeme sonrası "Planını kişiselleştir" (KB §3.2/5–6, R2-C13/C14, Ö7, Ç17; PLAN 4c): web QuestionnaireWizardV2 eşi.
 * SKORU DEĞİŞTİRMEZ. Kayıt: POST /api/questionnaire (Zod sunucuda) → /plan/[id]. Avatar yalnız seçimi gösterir.
 */
export function QuestionnaireWizardV2(p: QuestionnaireWizardV2Props) {
  const { colors } = useTheme();
  const { aura } = useSession();
  const [draft, setDraft] = useState<DraftV2>(() => loadDraftV2(p.analysisId) ?? initialDraftV2(p.initial, p.prefill));
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const step: StepV2 = STEPS_V2[index];
  const showBeard = p.presentation !== "female";

  useEffect(() => {
    saveDraftV2(p.analysisId, draft);
  }, [draft, p.analysisId]);

  const patch = (x: Partial<DraftV2>) => setDraft((d) => ({ ...d, ...x }));
  const ok = useMemo(() => canContinueV2(step, draft), [step, draft]);

  async function next() {
    if (index < STEPS_V2.length - 1) {
      setIndex(index + 1);
      return;
    }
    const payload = toPayloadV2(draft);
    if (!payload) {
      Alert.alert(t("error"));
      return;
    }
    setBusy(true);
    try {
      await aura.questionnaire.submit(payload);
      track("questionnaire_v2_completed");
      saveDraftV2(p.analysisId, null);
      router.replace({ pathname: "/plan/[id]", params: { id: p.analysisId } });
    } catch {
      Alert.alert(t("error"));
    } finally {
      setBusy(false);
    }
  }

  const progress = progressPct(index);
  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.xs }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text variant="small">{t("progress", { current: index + 1, total: STEPS_V2.length })}</Text>
          <Text variant="small" style={{ color: colors.brand, fontWeight: "600" }}>{progress}%</Text>
        </View>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={{ height: 6, borderRadius: 3, backgroundColor: colors.track }}>
          <View style={{ width: `${progress}%`, height: 6, borderRadius: 3, backgroundColor: colors.brand }} />
        </View>
      </View>
      <View style={{ gap: spacing.xs }}>
        <Text variant="small">{t("title")}</Text>
        <Text variant="title" accessibilityRole="header">{t(`steps.${step}`)}</Text>
        <Text variant="muted">{index === 0 ? t("intro") : t(`stepHints.${step}`)}</Text>
      </View>

      {step === "goals" ? (
        <Field label={t("fields.goals")}>
          <CheckList options={GOALS} selected={draft.goals} label={(k) => tq(`goals.${k}`)} onChange={(goals) => patch({ goals: goals.length ? goals : ["general"] })} />
        </Field>
      ) : null}
      {step === "direction" ? (
        <Field label={t("fields.goalDirection")}>
          <RadioList options={GOAL_DIRECTIONS} value={draft.goalDirection} label={(k) => t(`options.goalDirection.${k}`)} onChange={(goalDirection) => patch({ goalDirection })} />
        </Field>
      ) : null}
      {step === "budget" ? (
        <>
          <Field label={t("fields.budget")} hint={PLAN_CONFIG.placeholder ? t("hints.budgetPending") : undefined}>
            <RadioList options={BUDGET_BANDS} value={draft.budget} label={(k) => t(`options.budget.${k}`)} onChange={(budget) => patch({ budget })} />
          </Field>
          <Field label={t("fields.oneTimeBudget")}>
            <RadioList options={ONE_TIME_BUDGET_BANDS} value={draft.oneTimeBudget} label={(k) => t(`options.oneTimeBudget.${k}`)} onChange={(oneTimeBudget) => patch({ oneTimeBudget })} />
          </Field>
        </>
      ) : null}
      {step === "time" ? (
        <Field label={t("fields.minutesPerDay")}>
          <RadioList options={TIME_BANDS.map(String)} value={String(draft.minutesPerDay)} label={(k) => t("options.minutes", { n: Number(k) })} onChange={(v) => patch({ minutesPerDay: Number(v) as QuestionnaireV2["minutesPerDay"] })} />
        </Field>
      ) : null}
      {step === "activity" ? (
        <>
          <Field label={t("fields.sportDays")}>
            <RadioList options={SPORT_DAYS} value={draft.activity.sportDays} label={(k) => t(`options.sportDays.${k}`)} onChange={(sportDays) => patch({ activity: { ...draft.activity, sportDays } })} />
          </Field>
          <Field label={t("fields.work")}>
            <RadioList options={WORK_TYPES} value={draft.activity.work} label={(k) => t(`options.work.${k}`)} onChange={(work) => patch({ activity: { ...draft.activity, work } })} />
          </Field>
        </>
      ) : null}
      {step === "hairBeard" ? (
        <>
          <AvatarPreview hair={draft.hairLengthPref} beard={showBeard ? draft.beardLengthPref : "none"} presentation={p.presentation} label={t("hints.avatar")} />
          <Field label={t("fields.hairLengthPref")}>
            <RadioList options={HAIR_LENGTH_PREFS} value={draft.hairLengthPref} label={(k) => t(`options.hairLength.${k}`)} onChange={(hairLengthPref) => patch({ hairLengthPref })} />
          </Field>
          {showBeard ? (
            <Field label={t("fields.beardLengthPref")}>
              <RadioList options={BEARD_LENGTH_PREFS} value={draft.beardLengthPref} label={(k) => t(`options.beardLength.${k}`)} onChange={(beardLengthPref) => patch({ beardLengthPref })} />
            </Field>
          ) : null}
        </>
      ) : null}
      {step === "skin" ? (
        <Field label={t("fields.skinType")}>
          <RadioList options={SKIN_TYPES} value={draft.skinType} label={(k) => tq(`skinType.${k}`)} onChange={(skinType) => patch({ skinType })} />
        </Field>
      ) : null}
      {step === "jaw" ? (
        <Field label={t("fields.jawHealth")} hint={t("hints.jaw")}>
          <CheckList options={JAW_HEALTH_ISSUES} selected={draft.jawHealth} label={(k) => tq(`jawHealth.${k}`)} onChange={(jawHealth) => patch({ jawHealth })} noneLabel={tq("jawHealth.none")} />
        </Field>
      ) : null}
      {step === "photo" ? (
        <>
          <PhotoConfirmRow label={t("fields.glasses")} value={draft.glasses} onChange={(glasses) => patch({ glasses })} />
          <PhotoConfirmRow label={t("fields.headCovering")} hint={t("hints.headCovering")} value={draft.headCovering} onChange={(headCovering) => patch({ headCovering })} />
        </>
      ) : null}
      {step === "body" ? (
        <>
          <Text variant="muted">{p.under18 ? t("hints.bodyUnder18") : t("hints.body")}</Text>
          {!draft.bodySkipped && !p.under18 ? (
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}><Input label={t("fields.heightCm")} keyboardType="number-pad" value={draft.bodyDraft.heightCm} onChangeText={(v) => patch({ bodyDraft: { ...draft.bodyDraft, heightCm: v } })} /></View>
              <View style={{ flex: 1 }}><Input label={t("fields.weightKg")} keyboardType="decimal-pad" value={draft.bodyDraft.weightKg} onChangeText={(v) => patch({ bodyDraft: { ...draft.bodyDraft, weightKg: v } })} /></View>
            </View>
          ) : null}
          {!p.under18 ? <Button title={draft.bodySkipped ? t("bodyFill") : t("skip")} variant="ghost" onPress={() => patch({ bodySkipped: !draft.bodySkipped })} /> : null}
        </>
      ) : null}

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button title={t("back")} variant="outline" style={{ flex: 1 }} disabled={index === 0 || busy} onPress={() => setIndex(index - 1)} />
        <Button title={index === STEPS_V2.length - 1 ? t("finish") : t("next")} style={{ flex: 2 }} disabled={!ok} busy={busy} onPress={() => void next()} />
      </View>
    </View>
  );
}
