import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import type { PaywallTrigger } from "@/lib/config/paywall";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, touchTarget, useTheme } from "@/mobile/src/theme";
import { LockedPortrait, type PortraitSource } from "./LockedPortrait";

const t = scoped("analysis");
const tg = scoped("geometry");
const RING = 176;

/**
 * Ödeme öncesi hero (KB §3.3: P#6, P#7, P#8, P#9): yuvarlak portre (noktalı) üstte; genel skor halkası herkeste aynı
 * süs yayı + kilit (skoru ele vermez); potansiyel kilitli; yüz şekli ön değerlendirmesi (cihaz sonucu) açık.
 */
export function LockedHero({ faceShape, source, onLocked }: { faceShape: { primary: string; secondary?: string } | null; source: PortraitSource | null; onLocked: (tr: PaywallTrigger) => void }) {
  const { colors } = useTheme();
  return (
    <Card>
      <View style={{ alignItems: "center", gap: spacing.md }}>
        <LockedPortrait source={source} />
        <Text variant="small" accessibilityRole="header" style={{ textTransform: "uppercase", letterSpacing: 1 }}>{t("overallTitle")}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("locked.ringAria")}
          onPress={() => onLocked("score_main")}
          style={{ width: RING, height: RING, borderRadius: RING / 2, borderWidth: 10, borderColor: colors.track, alignItems: "center", justifyContent: "center" }}
        >
          {/* Süs yayı: herkeste aynı sabit çeyrek; gerçek değerden türemez. */}
          <View pointerEvents="none" style={{ position: "absolute", inset: -10, borderRadius: RING / 2, borderWidth: 10, borderColor: colors.brand, borderRightColor: "transparent", borderBottomColor: "transparent", transform: [{ rotate: "-45deg" }], opacity: 0.6 }} />
          <Ionicons name="lock-closed" size={28} color={colors.mutedForeground} />
          <Text variant="title" style={{ color: colors.mutedForeground, fontSize: 40, lineHeight: 48 }}>●,●</Text>
        </Pressable>
        <View style={{ alignItems: "center", gap: spacing.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("lockedAriaFor", { name: t("hero.potentialLockedName") })}
            onPress={() => onLocked("score_potential")}
            style={{ minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: colors.brand }}
          >
            <Ionicons name="arrow-up-outline" size={16} color={colors.brand} />
            <Text style={{ fontWeight: "600" }}>{t("hero.potentialLocked")}</Text>
            <Ionicons name="lock-closed" size={14} color={colors.mutedForeground} />
          </Pressable>
          <Text variant="small">{t("hero.potentialCaption")}</Text>
        </View>
        <Text variant="small" style={{ textAlign: "center" }}>{t("scoreNote")}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
        <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="scan-outline" size={22} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="small">{t("locked.faceShapePrelim")}</Text>
          <Text variant="heading">{faceShape ? tg(`shapes.${faceShape.primary}`) : "–"}</Text>
          {faceShape?.secondary ? <Text variant="small">{tg("nearTo", { other: tg(`shapes.${faceShape.secondary}`) })}</Text> : null}
        </View>
      </View>
    </Card>
  );
}
