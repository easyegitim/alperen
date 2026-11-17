import { router } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { track } from "@/lib/analytics";
import type { StepCard as StepCardType } from "@/lib/coach/planTypes";
import { Button } from "@/mobile/src/components/ui/Button";
import { Text } from "@/mobile/src/components/ui/Text";
import { costLabel, isHttpsUrl } from "@/mobile/src/features/plan/viewModel";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import { BarberCard } from "./BarberCard";

const t = scoped("plan.v2");
const tr = scoped("report.v2.regions");

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "47%", flexDirection: "row", gap: 4, alignItems: "baseline" }}>
      <Text variant="small">{label}:</Text>
      <Text style={{ fontSize: 12, fontWeight: "500" }}>{value}</Text>
    </View>
  );
}

/** Adım kartı (KB §6.1): ne, hangi gözleme bağlı, ₺ aralığı, sıklık, dk/gün, zorluk, kanıt cümlesi + kaynak; "Dene" ve "Berbere göster". */
export function StepCard({ step }: { step: StepCardType }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const c = costLabel(step);
  const cost = c.kind === "free" ? t("step.costFree") : c.kind === "from" ? t("step.costFrom", { min: c.min }) : t("step.costRange", { min: c.min, max: c.max });
  const freq = step.frequency.per === "once" ? t("step.frequency.once") : t(`step.frequency.${step.frequency.per}`, { n: step.frequency.times });
  const toggle = () => {
    if (!open) track("plan_step_opened");
    setOpen((o) => !o);
  };
  const presetIds = step.tryonPresetId ? (step.area === "beard" ? { beard: step.tryonPresetId } : { hair: step.tryonPresetId }) : {};
  return (
    <View style={{ gap: spacing.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted, borderRadius: radius.lg, padding: spacing.md }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Text style={{ backgroundColor: colors.brandSoft, color: colors.brand, fontSize: 11, fontWeight: "600", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full }}>{t(`tiers.${step.tier}`)}</Text>
        <Text style={{ backgroundColor: colors.card, color: colors.mutedForeground, fontSize: 11, fontWeight: "500", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full }}>{t(`phases.${step.phase}`)}</Text>
      </View>
      <Text style={{ fontSize: 15, fontWeight: "600" }} accessibilityRole="header">{step.title}</Text>
      {step.summary ? <Text variant="muted" style={{ fontSize: 13, lineHeight: 19 }}>{step.summary}</Text> : null}
      {step.rationale ? (
        <Text style={{ fontSize: 13, lineHeight: 19 }}>
          <Text style={{ fontWeight: "600", fontSize: 13 }}>{t("step.rationale")}:</Text> <Text variant="muted" style={{ fontSize: 13 }}>{step.rationale}</Text>
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Meta label={t("step.cost")} value={cost} />
        <Meta label={t("step.frequencyLabel")} value={freq} />
        <Meta label={t("step.minutesLabel")} value={t("step.minutes", { n: step.minutesPerDay })} />
        <Meta label={t("step.difficulty")} value={t(`step.level.${step.difficulty}`)} />
      </View>
      <Text variant="small">
        <Text style={{ fontWeight: "600", fontSize: 12 }}>{t("step.evidenceLabel")}:</Text> {t(`evidence.${step.evidence.level}`)}
        {step.evidence.source ? (
          isHttpsUrl(step.evidence.source) ? (
            <Text style={{ fontSize: 12, color: colors.brand, textDecorationLine: "underline" }} accessibilityRole="link" onPress={() => void Linking.openURL(step.evidence.source as string)}>
              {" · "}{t("step.source")} ↗
            </Text>
          ) : (
            ` · ${t("step.source")}: ${step.evidence.source}`
          )
        ) : null}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.xs }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={toggle} style={{ minHeight: 44, justifyContent: "center" }}>
          <Text variant="small" style={{ fontWeight: "500" }}>{t("step.observation")} {open ? "▴" : "▾"}</Text>
        </Pressable>
        <View style={{ flexDirection: "row", gap: spacing.xs }}>
          {step.barberSpec ? <BarberCard spec={step.barberSpec} presetIds={presetIds} /> : null}
          {step.tryonPresetId ? <Button title={`✂ ${t("step.tryIt")}`} variant="outline" onPress={() => router.push({ pathname: "/(tabs)/dene", params: { preset: step.tryonPresetId as string } })} /> : null}
        </View>
      </View>
      {open ? (
        <View style={{ gap: spacing.xs }}>
          <Text style={{ fontSize: 13, lineHeight: 19 }}>
            <Text style={{ fontWeight: "600", fontSize: 13 }}>{tr(step.observationRef.region)}:</Text> <Text variant="muted" style={{ fontSize: 13 }}>{step.observationRef.observation ?? "—"}</Text>
          </Text>
          {step.perceptionOnly ? <Text variant="small">{t("step.perceptionNote")}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
