import { Canvas, Circle, Path, Skia } from "@shopify/react-native-skia";
import type { PropsWithChildren } from "react";
import { View } from "react-native";
import { useTheme } from "@/mobile/src/theme";

/** Skor halkası (web ScoreRing): 1–10 ölçeğinde dolgu; değer yoksa yalnız iz. Ortadaki içerik çağırandan gelir. */
export function ScoreRing({ value, max = 10, size = 148, stroke = 11, children }: PropsWithChildren<{ value: number | null; max?: number; size?: number; stroke?: number }>) {
  const { colors } = useTheme();
  const r = size / 2 - stroke / 2 - 2;
  const c = size / 2;
  const ratio = value === null ? 0 : Math.min(1, Math.max(0, value / max));
  const path = Skia.Path.Make();
  path.addArc(Skia.XYWHRect(c - r, c - r, 2 * r, 2 * r), -90, 360 * ratio);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }} accessible={false}>
      <Canvas style={{ position: "absolute", width: size, height: size }} pointerEvents="none">
        <Circle cx={c} cy={c} r={r} color={colors.track} style="stroke" strokeWidth={stroke} />
        {ratio > 0 ? <Path path={path} color={colors.brand} style="stroke" strokeWidth={stroke} strokeCap="round" /> : null}
      </Canvas>
      <View style={{ alignItems: "center", justifyContent: "center", paddingHorizontal: stroke + 6 }}>{children}</View>
    </View>
  );
}
