import { View } from "react-native";

/** Oval kılavuz: Svg bağımlılığı olmadan border-radius ile çizilir (SPEC 7.2 oval). */
export function OvalOverlay({ dashed, width, height }: { dashed: boolean; width: number; height: number }) {
  const rx = width * 0.35;
  const ry = height * 0.36;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: width / 2 - rx, top: height * 0.475 - ry, width: rx * 2, height: ry * 2, borderRadius: rx, borderWidth: 2.5, borderColor: dashed ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.95)", borderStyle: dashed ? "dashed" : "solid" }} />
  );
}
