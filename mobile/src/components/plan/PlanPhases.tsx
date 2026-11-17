import { Pressable, View } from "react-native";
import type { PlanV2, StepCard } from "@/lib/coach/planTypes";
import { PLAN_PHASES } from "@/lib/config/plan";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("plan.v2");

/** Fazlar (KB §6.1): 0–4 hafta · 1–3 ay · 3–6 ay; her fazda adım adları (dokununca "Tümü" sekmesinde karta gider). */
export function PlanPhases({ phases, steps, onJump }: { phases: PlanV2["phases"]; steps: StepCard[]; onJump?: (stepId: string) => void }) {
  const { colors } = useTheme();
  const byId = new Map(steps.map((s) => [s.id, s]));
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="small" style={{ fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 }}>{t("phasesTitle")}</Text>
      {PLAN_PHASES.map((ph, i) => (
        <View key={ph} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.sm, gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }} accessible={false}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: colors.brand }}>{i + 1}</Text>
            </View>
            <Text style={{ fontWeight: "600", fontSize: 14, flex: 1 }}>{t(`phases.${ph}`)}</Text>
            <Text variant="small">{t("stepCount", { n: phases[ph].length })}</Text>
          </View>
          {phases[ph].length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {phases[ph].map((id) => (
                <Pressable key={id} accessibilityRole="button" onPress={onJump ? () => onJump(id) : undefined} style={{ minHeight: 32, justifyContent: "center", backgroundColor: colors.muted, borderRadius: radius.full, paddingHorizontal: 12 }}>
                  <Text style={{ fontSize: 12, fontWeight: "500" }}>{byId.get(id)?.title ?? id}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text variant="small">{t("emptyPhase")}</Text>
          )}
        </View>
      ))}
    </View>
  );
}
