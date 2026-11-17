import { Pressable, View } from "react-native";
import type { PriorityRow, StepCard } from "@/lib/coach/planTypes";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("plan.v2.priority");

/** Öncelik tablosu (KB §6.1): en üstte en az emekle en çok fark; etki ve emek noktalarla (sayı yok). */
export function PriorityTable({ rows, steps, onJump }: { rows: PriorityRow[]; steps: StepCard[]; onJump?: (stepId: string) => void }) {
  const { colors } = useTheme();
  const byId = new Map(steps.map((s) => [s.id, s]));
  const dots = (n: 1 | 2 | 3, label: string) => (
    <View style={{ flexDirection: "row", gap: 2 }} accessible accessibilityRole="image" accessibilityLabel={`${label}: ${n}/3`}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i <= n ? colors.brand : colors.track }} />
      ))}
    </View>
  );
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="small" style={{ fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 }}>{t("title")}</Text>
      <Text variant="small">{t("hint")}</Text>
      <View style={{ backgroundColor: colors.muted, borderRadius: radius.lg }}>
        {rows.map((r, i) => {
          const s = byId.get(r.stepId);
          if (!s) return null;
          return (
            <Pressable key={r.stepId} accessibilityRole="button" onPress={onJump ? () => onJump(r.stepId) : undefined} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }} accessible={false}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: colors.primaryForeground }}>{i + 1}</Text>
              </View>
              <Text style={{ flex: 1, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>{s.title}</Text>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text variant="small">{t("impact")}</Text>
                  {dots(r.impact, t("impact"))}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text variant="small">{t("effort")}</Text>
                  {dots(r.effort, t("effort"))}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
