import { Ionicons } from "@expo/vector-icons";
import { Canvas, Circle, Group, Image as SkiaImage, Path, Skia, useImage } from "@shopify/react-native-skia";
import { useMemo } from "react";
import { View } from "react-native";
import { portraitGeometry } from "@/lib/face/overlay";
import type { Point } from "@/lib/face/types";
import { t } from "@/mobile/src/lib/i18n";
import { useTheme } from "@/mobile/src/theme";

export type PortraitSource = { uri: string; width: number; height: number; landmarksPx: Point[] };

/**
 * Kilitli sonuç ekranının yuvarlak portresi (KB P#6, P§6): yüz kırpımı + 30–70 anahtar nokta, aynı kırpma/ölçek
 * dönüşümü (lib/face/overlay.ts portraitGeometry). Skia ile bellekteki geçici dosyadan çizilir; hiçbir şey kaydedilmez
 * ya da gönderilmez. Fotoğraf yoksa (uygulama yeniden başladı) şematik yüz.
 */
export function LockedPortrait({ source, size = 168 }: { source: PortraitSource | null; size?: number }) {
  const { colors } = useTheme();
  const image = useImage(source?.uri ?? null);
  const g = useMemo(() => (source ? portraitGeometry(source.landmarksPx, source.width, source.height, size) : null), [source, size]);
  const ovalPath = useMemo(() => {
    if (!g?.oval) return null;
    const p = Skia.Path.Make();
    g.oval.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
    p.close();
    return p;
  }, [g]);
  const usable = source !== null && image !== null && g !== null && g.crop.width > 0;
  const k = usable ? size / g.crop.width : 1;

  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", backgroundColor: colors.muted, borderWidth: 4, borderColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}
      accessibilityRole="image"
      accessibilityLabel={usable ? t("analysis.overlay.portraitAria") : undefined}
      accessibilityElementsHidden={!usable}
    >
      {usable ? (
        <Canvas style={{ width: size, height: size }}>
          <Group transform={[{ translateX: -g.crop.x * k }, { translateY: -g.crop.y * k }, { scale: k }]}>
            <SkiaImage image={image} x={0} y={0} width={source.width} height={source.height} fit="fill" />
          </Group>
          {ovalPath ? <Path path={ovalPath} style="stroke" strokeWidth={1.5} color="rgba(0,0,0,0.35)" /> : null}
          {ovalPath ? <Path path={ovalPath} style="stroke" strokeWidth={0.8} color="rgba(255,255,255,0.55)" /> : null}
          {g.points.map(([x, y], i) => (
            <Group key={i}>
              <Circle cx={x} cy={y} r={2.6} color="rgba(0,0,0,0.45)" />
              <Circle cx={x} cy={y} r={1.6} color="#ffffff" />
            </Group>
          ))}
        </Canvas>
      ) : (
        <Ionicons name="person-outline" size={size * 0.5} color={colors.mutedForeground} />
      )}
    </View>
  );
}
