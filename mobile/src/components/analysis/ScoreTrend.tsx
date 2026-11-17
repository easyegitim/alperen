import { Canvas, Circle, Line, Path, Skia } from "@shopify/react-native-skia";
import { View } from "react-native";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { spacing, useTheme } from "@/mobile/src/theme";
import { linePath, trendScale, type TrendPoint } from "./trendMath";

const t = scoped("analysis.trend");
const W = 320, H = 160;
const SERIES = { overall: "#2a78d6", potential: "#eb6834" } as const;
const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Skor trendi (SPEC 11.2): genel + potansiyel; Skia çizgi grafiği; erişilebilir özet tablo metni. */
export function ScoreTrend({ points }: { points: TrendPoint[] }) {
  const { colors } = useTheme();
  if (points.length < 2) return <Text variant="small">{t("needTwo")}</Text>;
  const s = trendScale(points, W, H);
  const pOverall = Skia.Path.MakeFromSVGString(linePath(s.data, "overall", s.x, s.y));
  const pPotential = Skia.Path.MakeFromSVGString(linePath(s.data, "potential", s.x, s.y));
  const last = s.data[s.data.length - 1];
  return (
    <View style={{ gap: spacing.xs }} accessibilityLabel={t("aria", { n: s.data.length })}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text variant="small">{t("title")}</Text>
        <Text variant="small">● {t("overall")}  ○ {t("potential")}</Text>
      </View>
      <Canvas style={{ width: "100%", aspectRatio: W / H }}>
        {s.ticks.map((v) => (
          <Line key={v} p1={{ x: 28, y: s.y(v) }} p2={{ x: W - 12, y: s.y(v) }} color={colors.border} strokeWidth={1} />
        ))}
        {pPotential ? <Path path={pPotential} color={SERIES.potential} style="stroke" strokeWidth={2} /> : null}
        {pOverall ? <Path path={pOverall} color={SERIES.overall} style="stroke" strokeWidth={2} /> : null}
        {s.data.map((p, i) => (
          <Circle key={`${p.id}-o`} cx={s.x(i)} cy={s.y(p.overall)} r={4} color={SERIES.overall} />
        ))}
        {s.data.map((p, i) => (
          <Circle key={`${p.id}-p`} cx={s.x(i)} cy={s.y(p.potential)} r={4} color={SERIES.potential} />
        ))}
      </Canvas>
      <Text variant="small">
        {new Date(s.data[0].date).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })} → {new Date(last.date).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })} · {t("overall")} {fmt(last.overall)} · {t("potential")} {fmt(last.potential)}
      </Text>
      {s.calibrationChanged ? <Text variant="small">{t("calibrationNote")}</Text> : null}
    </View>
  );
}
