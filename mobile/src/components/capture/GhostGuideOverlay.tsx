import { Canvas, Circle, Path, Skia } from "@shopify/react-native-skia";
import { useMemo } from "react";
import { View } from "react-native";
import { GHOST_STYLE, ghostPolylines, polylinePath, type GhostOutline } from "@/lib/face/ghostGuide";
import { t } from "@/mobile/src/lib/i18n";
import { useTheme } from "@/mobile/src/theme";

/**
 * Hayalet kılavuz (KB §8 ONAYLI ÖNERİ R2-Ö1; CONTRACTS_V2 S3.3.4): önceki ön fotoğrafın 43 noktalık yüz çizgisi kamera
 * önizlemesi üstünde silik görünür. Cihazda çizilir; statik (reduce-motion'dan bağımsız); hiçbir yere gönderilmez.
 * Önizleme "cover" ve ön kamerada aynalıdır (mirror-front-only); kaynak kare aynalı değilse x çevrilir.
 */
export function GhostGuideOverlay({ outline, width, height, mirror = true }: { outline: GhostOutline; width: number; height: number; mirror?: boolean }) {
  const { colors } = useTheme();
  const lines = useMemo(() => ghostPolylines(outline, { w: width, h: height }, { mirror }), [outline, width, height, mirror]);
  const oval = useMemo(() => Skia.Path.MakeFromSVGString(polylinePath(lines.oval, true)), [lines]);
  const eyesR = useMemo(() => Skia.Path.MakeFromSVGString(polylinePath(lines.eyes.slice(0, 2))), [lines]);
  const eyesL = useMemo(() => Skia.Path.MakeFromSVGString(polylinePath(lines.eyes.slice(2, 4))), [lines]);
  const mouth = useMemo(() => Skia.Path.MakeFromSVGString(polylinePath(lines.mouth)), [lines]);
  const color = colors.overlay;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height }} accessibilityLabel={t("ghost.aria")} accessibilityRole="image">
      <Canvas style={{ width, height }}>
        {oval ? <Path path={oval} style="stroke" strokeWidth={GHOST_STYLE.strokeWidth} color={color} opacity={GHOST_STYLE.opacity * 2} /> : null}
        {eyesR ? <Path path={eyesR} style="stroke" strokeWidth={GHOST_STYLE.strokeWidth} color={color} opacity={GHOST_STYLE.opacity * 2} /> : null}
        {eyesL ? <Path path={eyesL} style="stroke" strokeWidth={GHOST_STYLE.strokeWidth} color={color} opacity={GHOST_STYLE.opacity * 2} /> : null}
        {mouth ? <Path path={mouth} style="stroke" strokeWidth={GHOST_STYLE.strokeWidth} color={color} opacity={GHOST_STYLE.opacity * 2} /> : null}
        <Circle cx={lines.nose[0]} cy={lines.nose[1]} r={3} color={color} opacity={GHOST_STYLE.opacity * 2} />
      </Canvas>
    </View>
  );
}
