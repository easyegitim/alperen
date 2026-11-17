import { Canvas, DashPathEffect, Path, Skia } from "@shopify/react-native-skia";
import { View } from "react-native";
import type { BeardLengthPref, HairLengthPref } from "@/lib/config/plan";
import { useTheme } from "@/mobile/src/theme";

// Çizgi-illüstrasyon avatar (KB R1-E1; PLAN 4c) — web components/onboarding/AvatarPreview ile aynı yollar (viewBox 100×124).
// Kullanıcı fotoğrafı değildir, yüz şekli taşımaz. "keep" = mevcut (orta) çizim, kesikli çizgi.

const HAIR_PATH: Record<Exclude<HairLengthPref, "keep">, string> = {
  short: "M30 38 Q32 16 50 14 Q68 16 70 38 Q60 30 50 30 Q40 30 30 38 Z",
  medium: "M26 52 Q24 10 50 10 Q76 10 74 52 Q72 38 62 32 Q50 28 38 32 Q28 38 26 52 Z",
  long: "M18 100 Q20 6 50 6 Q80 6 82 100 Q74 92 74 62 Q72 38 62 32 Q50 28 38 32 Q28 38 26 62 Q26 92 18 100 Z",
};
const BEARD_PATH: Record<Exclude<BeardLengthPref, "keep" | "none">, string> = {
  stubble: "M30 72 Q50 94 70 72",
  short: "M28 70 Q34 90 50 92 Q66 90 72 70 Q66 84 50 86 Q34 84 28 70 Z",
  medium: "M27 68 Q30 100 50 104 Q70 100 73 68 Q66 86 50 90 Q34 86 27 68 Z",
  long: "M26 66 Q28 110 50 118 Q72 110 74 66 Q66 88 50 92 Q34 88 26 66 Z",
};
const NECK = "M38 92 L38 104 Q20 108 12 122 M62 92 L62 104 Q80 108 88 122";
const FACE = "M30 40 Q30 20 50 20 Q70 20 70 40 L70 62 Q70 82 50 90 Q30 82 30 62 Z";
const FEATURES = "M38 50 h8 M54 50 h8 M50 52 v10 M44 72 q6 4 12 0";

const p = (d: string) => Skia.Path.MakeFromSVGString(d);
const dashed = (gap: number) => <DashPathEffect intervals={[gap, gap]} />;

export function AvatarPreview({ hair, beard, presentation, width = 144, label }: { hair: HairLengthPref; beard: BeardLengthPref; presentation: "male" | "female" | "unspecified"; width?: number; label?: string }) {
  const { colors } = useTheme();
  const hairKey = hair === "keep" ? "medium" : hair;
  const beardKey: Exclude<BeardLengthPref, "keep"> = beard === "keep" ? "short" : beard;
  const beardPath = presentation !== "female" && beardKey !== "none" ? BEARD_PATH[beardKey] : null;
  const s = width / 100;
  const stroke = { color: colors.brand, style: "stroke" as const, strokeWidth: 2.2, strokeCap: "round" as const, strokeJoin: "round" as const };
  const hp = p(HAIR_PATH[hairKey]);
  const bp = beardPath ? p(beardPath) : null;
  const m = Skia.Matrix();
  m.scale(s, s);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width, height: 124 * s, alignSelf: "center" }}>
      <Canvas style={{ width, height: 124 * s }}>
        {[NECK, FACE, FEATURES].map((d, i) => {
          const path = p(d);
          return path ? <Path key={i} path={path} matrix={m} {...stroke} opacity={i === 1 ? 1 : 0.65} /> : null;
        })}
        {hp ? <Path path={hp} matrix={m} color={colors.brand} opacity={hair === "keep" ? 0.12 : 0.22} /> : null}
        {hp ? <Path path={hp} matrix={m} {...stroke}>{hair === "keep" ? dashed(3) : null}</Path> : null}
        {bp && beardKey !== "stubble" ? <Path path={bp} matrix={m} color={colors.brand} opacity={beard === "keep" ? 0.12 : 0.22} /> : null}
        {bp ? <Path path={bp} matrix={m} {...stroke}>{beard === "keep" ? dashed(3) : beardKey === "stubble" ? dashed(2) : null}</Path> : null}
      </Canvas>
    </View>
  );
}
