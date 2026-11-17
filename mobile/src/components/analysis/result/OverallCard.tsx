import { View } from "react-native";
import type { OverallV2, PotentialV2 } from "@/lib/score/contract";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { fmt1, formatPercentile, formatRange } from "@/mobile/src/features/analysis/format";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import { ScoreRing } from "./ScoreRing";

const t = scoped("analysis");
const tr = scoped("analysis.result");

/**
 * Genel skor (KB §4.5–4.8): tek ondalık + aralık satırı + (bayrakla) yüzdelik + rakip ölçeği notu + "YZ tahmini" notu.
 * Potansiyel çipi (≤ +1,5) yalnız potansiyel bölümü açılınca gelir. Değerler sunucudan; istemci kilit açmaz.
 */
export function OverallCard({ overall, potential, potentialReady }: { overall: OverallV2 | null; potential: PotentialV2 | null; potentialReady: boolean }) {
  const { colors } = useTheme();
  const range = overall?.range ? formatRange(overall.range) : null;
  const pct = formatPercentile(overall?.percentile);
  const value = overall?.value ?? null;
  return (
    <Card>
      <View style={{ alignItems: "center", gap: spacing.sm }}>
        <Text variant="small" accessibilityRole="header" style={{ textTransform: "uppercase", letterSpacing: 1, fontWeight: "600" }}>{t("overallTitle")}</Text>
        <ScoreRing value={value}>
          {value === null ? (
            <Text variant="muted">{tr("missing")}</Text>
          ) : (
            <View style={{ alignItems: "center" }} accessible accessibilityLabel={range ? tr("overallAria", { value: fmt1(value), lo: range.lo, hi: range.hi }) : fmt1(value)}>
              <Text style={{ fontSize: 44, lineHeight: 50, fontWeight: "700", color: colors.brand }}>{fmt1(value)}</Text>
              <Text variant="small">{t("hero.outOf")}</Text>
            </View>
          )}
        </ScoreRing>
        {range ? (
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontWeight: "600", fontSize: 14 }}>{t("rangeLabel", { lo: range.lo, hi: range.hi })}</Text>
            <Text variant="small">{tr("rangeNote")}</Text>
          </View>
        ) : null}
        {pct ? (
          <Text style={{ backgroundColor: colors.brandSoft, color: colors.foreground, paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.full, fontSize: 13, fontWeight: "600" }}>
            {t("percentileV2", { p: pct.p, suffix: pct.suffix })}
          </Text>
        ) : null}
        {potentialReady && potential ? (
          <View style={{ alignItems: "center", gap: 4 }}>
            <View style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 16, borderRadius: radius.full, borderWidth: 1, borderColor: colors.brand }}>
              <Text style={{ fontWeight: "600", fontSize: 14 }}>↗ {potential.delta < 0.1 ? tr("potentialAtTop") : tr("potentialChip", { potential: fmt1(potential.value), delta: fmt1(potential.delta) })}</Text>
            </View>
            <Text variant="small">{tr("potentialRange", { lo: fmt1(potential.range[0]), hi: fmt1(potential.range[1]) })}</Text>
            <Text variant="small" style={{ textAlign: "center" }}>{tr("potentialCaption")}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 4 }}>
        <Text variant="small" style={{ textAlign: "center" }}>{t("competitorsNote")}</Text>
        <Text variant="small" style={{ textAlign: "center" }}>{t("scoreNote")}</Text>
      </View>
    </Card>
  );
}
