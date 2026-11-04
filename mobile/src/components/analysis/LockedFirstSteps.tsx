import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import type { PaywallTrigger } from "@/lib/config/paywall";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("analysis");
/** Kilitli yer tutucu satırların sabit genişlikleri: gerçek bir değerden türetilmez. */
const PLACEHOLDER_WIDTHS = ["72%", "58%", "66%"] as const;

/** "İlk adımların" (KB P#13): her zaman 3 bulanık satır; gerçek sayı ya da alan sırası kilitli alt skorları ele vermesin. */
export function LockedFirstSteps({ onLocked }: { onLocked: (tr: PaywallTrigger) => void }) {
  const { colors } = useTheme();
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ width: 32, height: 32, borderRadius: radius.md, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="flag-outline" size={16} color={colors.brand} />
        </View>
        <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>{t("locked.firstStepsTitle")}</Text>
        <Ionicons name="lock-closed" size={16} color={colors.mutedForeground} />
      </View>
      <View style={{ gap: spacing.sm }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {PLACEHOLDER_WIDTHS.map((w, i) => (
          <View key={w} style={{ height: 56, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.muted }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
              <Text variant="small" style={{ color: colors.brand, fontWeight: "700" }}>{i + 1}</Text>
            </View>
            <View style={{ width: w, height: 10, borderRadius: 5, backgroundColor: colors.mutedForeground, opacity: 0.25 }} />
            <Ionicons name="lock-closed" size={14} color={colors.mutedForeground} style={{ marginLeft: "auto" }} />
          </View>
        ))}
      </View>
      <Text variant="muted">{t("improveFirst.lockedBody")}</Text>
      <Button title={t("unlock")} onPress={() => onLocked("improve_first")} />
    </Card>
  );
}
