import { router } from "expo-router";
import { View } from "react-native";
import type { ImproveItemV2 } from "@/lib/score/contract";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { fmt1 } from "@/mobile/src/features/analysis/format";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("analysis");
const tr = scoped("analysis.result.improve");

/** "Önce odaklan" (KB P#13): en fazla 3 adım, her biri bir plan adımına bağlı; kazanç genel skor puanı (toplam ≤ +1,5). */
export function ImproveFirstCard({ items, analysisId }: { items: ImproveItemV2[] | null; analysisId: string }) {
  const { colors } = useTheme();
  return (
    <Card title={tr("title")}>
      {items && items.length ? (
        <View style={{ gap: spacing.sm }}>
          {items.slice(0, 3).map((it, i) => (
            <View key={`${it.sub}-${it.stepId}`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.sm, paddingVertical: 10 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }} accessible={false}>
                <Text style={{ fontWeight: "700", fontSize: 12, color: colors.brand }}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "600", fontSize: 14 }}>{it.step}</Text>
                <Text variant="small">{t(`sub.${it.sub}`)}</Text>
              </View>
              {it.gain > 0 ? (
                <Text accessibilityLabel={tr("gainAria", { gain: fmt1(it.gain) })} style={{ backgroundColor: colors.brandSoft, color: colors.brand, fontWeight: "700", fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full }}>
                  {tr("gain", { gain: fmt1(it.gain) })}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text variant="muted">{tr("empty")}</Text>
      )}
      <Button title={t("seePlan")} variant="outline" onPress={() => router.push({ pathname: "/plan/[id]", params: { id: analysisId } })} />
    </Card>
  );
}
