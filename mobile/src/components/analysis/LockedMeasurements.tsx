import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import type { DeviceResult } from "@/lib/score/contract";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("analysis");
const tg = scoped("geometry");
const pct = (v: number | null) => (v === null ? "–" : `%${Math.round(v * 100)}`);
/** Türkçe ondalık virgülü: "1,90" (diğer skorlarla aynı biçim). */
const ratio = (v: number) => v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Tile({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: "48%", minHeight: 80, justifyContent: "space-between", gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.muted }} accessibilityLabel={`${label}: ${value}`}>
      <Text variant="small">{label}</Text>
      <Text style={{ fontWeight: "600" }}>{value}</Text>
    </View>
  );
}

/** v2: cihaz oranları herkese açık (KB P#12; cihaz değerleri tek kaynak) + KB P§1 notu. */
export function LockedMeasurements({ ratios }: { ratios: DeviceResult["ratios"] }) {
  const { colors } = useTheme();
  const tilt = ratios.canthalTiltDeg > 2 ? tg("tilt.positive") : ratios.canthalTiltDeg < -2 ? tg("tilt.negative") : tg("tilt.neutral");
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ width: 32, height: 32, borderRadius: radius.md, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="resize-outline" size={16} color={colors.brand} />
        </View>
        <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>{t("ratiosTitle")}</Text>
        <View style={{ paddingHorizontal: 10, height: 24, borderRadius: radius.full, backgroundColor: colors.brandSoft, justifyContent: "center" }}>
          <Text variant="small" style={{ color: colors.success, fontWeight: "600" }}>{t("locked.open")}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing.sm }}>
        <Tile label={tg("canthalTilt")} value={tilt} />
        <Tile label={tg("thirds")} value={`${pct(ratios.thirds.upper)} / ${pct(ratios.thirds.middle)} / ${pct(ratios.thirds.lower)}`} />
        <Tile label={tg("fwhr")} value={ratio(ratios.fwhr)} />
        <Tile label={tg("jawRatio")} value={ratio(ratios.jawRatio)} />
      </View>
      <Text variant="small">{t("locked.ratiosNote")}</Text>
    </Card>
  );
}
