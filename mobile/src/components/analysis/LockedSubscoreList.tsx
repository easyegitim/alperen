import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import type { PaywallTrigger } from "@/lib/config/paywall";
import type { SubKey } from "@/lib/config/teaser";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, touchTarget, useTheme } from "@/mobile/src/theme";

const t = scoped("analysis");
/** Kilitli satırdaki süs çubuğunun sabit genişliği: gerçek bir değerden türetilmez (değer istemcide yoktur). */
const LOCKED_BAR_WIDTH = "62%";

/** Ödeme öncesi 7 alt skor (KB P#10, P#11): adlar açık, her satırda aynı bulanık çubuk, "Yapısal/Geliştirilebilir" rozeti YOK. */
export function LockedSubscoreList({ keys, onLocked }: { keys: readonly SubKey[]; onLocked: (tr: PaywallTrigger) => void }) {
  const { colors } = useTheme();
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="heading" accessibilityRole="header">{t("subscoresTitle")}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, height: 24, borderRadius: radius.full, backgroundColor: colors.brandSoft }}>
          <Ionicons name="lock-closed" size={12} color={colors.brand} />
          <Text variant="small" style={{ color: colors.brand, fontWeight: "600" }}>{t("locked.tag")}</Text>
        </View>
      </View>
      {keys.map((k) => (
        <View key={k} style={{ gap: spacing.xs }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: touchTarget }}>
            <Text style={{ fontWeight: "600" }}>{t(`sub.${k}`)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t("locked.subBarAria")} onPress={() => onLocked(`sub_${k}`)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: touchTarget }}>
              <Ionicons name="lock-closed" size={16} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground }}>●,●</Text>
            </Pressable>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.track, overflow: "hidden" }} accessibilityElementsHidden>
            <View style={{ width: LOCKED_BAR_WIDTH, height: 8, borderRadius: 4, backgroundColor: colors.brand, opacity: 0.35 }} />
          </View>
        </View>
      ))}
      <Text variant="small">{t("locked.subscoresNote")}</Text>
    </Card>
  );
}
