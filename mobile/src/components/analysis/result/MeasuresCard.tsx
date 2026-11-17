import { View } from "react-native";
import type { DeviceResult, ReportV3 } from "@/lib/score/contract";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { MEASURE_LABEL_KEY, barPosition, fmtMeasure, pct, ratio } from "@/mobile/src/features/analysis/format";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const tg = scoped("geometry");
const tr = scoped("analysis.result.measures");

/** Dengeli aralık çubuğu (sunum): iyi/kötü rengi yok; yalnız aralık ve kullanıcının yeri. */
export function MeasureBar({ m }: { m: ReportV3["measures"][number] }) {
  const { colors } = useTheme();
  const pos = barPosition(m.value, m.balancedRange);
  const name = tg(MEASURE_LABEL_KEY[m.key]);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontWeight: "500", fontSize: 13 }}>{name}</Text>
        <Text variant="small">{fmtMeasure(m.key, m.value)}</Text>
      </View>
      <View accessible accessibilityRole="image" accessibilityLabel={tr("aria", { name, value: fmtMeasure(m.key, m.value), lo: fmtMeasure(m.key, m.balancedRange[0]), hi: fmtMeasure(m.key, m.balancedRange[1]) })} style={{ height: 12, borderRadius: 6, backgroundColor: colors.track }}>
        <View style={{ position: "absolute", top: 0, bottom: 0, left: `${pos.lo}%`, width: `${pos.hi - pos.lo}%`, borderRadius: 6, backgroundColor: colors.brandSoft }} />
        <View style={{ position: "absolute", top: -2, left: `${pos.at}%`, marginLeft: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.brand, borderWidth: 2, borderColor: colors.card }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text variant="small">{tr("balanced")}: {fmtMeasure(m.key, m.balancedRange[0])}–{fmtMeasure(m.key, m.balancedRange[1])}</Text>
        <Text variant="small">{tr("yours")}</Text>
      </View>
    </View>
  );
}

/** Ölçüler (KB §5/3, P#12): cihaz oranları her zaman açık; rapor gelince dengeli aralık çubuğu. Kıyas yalnız aralıkla. */
export function MeasuresCard({ device, measures, reportReady }: { device: DeviceResult | null; measures: ReportV3["measures"] | null; reportReady: boolean }) {
  const { colors } = useTheme();
  if (!device) return null;
  const r = device.ratios;
  const rows = [
    ["canthalTilt", r.canthalTiltDeg > 2 ? tg("tilt.positive") : r.canthalTiltDeg < -2 ? tg("tilt.negative") : tg("tilt.neutral")],
    ["thirds", `${pct(r.thirds.upper)} / ${pct(r.thirds.middle)} / ${pct(r.thirds.lower)}`],
    ["fwhr", ratio(r.fwhr)],
    ["jawRatio", ratio(r.jawRatio)],
  ] as const;
  return (
    <Card title={tr("title")}>
      {measures && measures.length ? (
        <View style={{ gap: spacing.md }}>
          {measures.map((m) => (
            <MeasureBar key={m.key} m={m} />
          ))}
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {rows.map(([k, v]) => (
            <View key={k} style={{ width: "47%", minHeight: 72, justifyContent: "space-between", backgroundColor: colors.muted, borderRadius: radius.lg, padding: spacing.sm }}>
              <Text variant="small">{tg(k)}</Text>
              <Text style={{ fontWeight: "600", fontSize: 14 }}>{v}</Text>
            </View>
          ))}
        </View>
      )}
      <Text variant="small">{measures && measures.length ? tr("note") : reportReady ? tg("note") : `${tg("note")} ${tr("deviceOnly")}`}</Text>
    </Card>
  );
}
