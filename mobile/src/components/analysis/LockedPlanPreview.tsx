import { Ionicons } from "@expo/vector-icons";
import { Blur, Canvas, Group, Image as SkiaImage, useImage } from "@shopify/react-native-skia";
import { useMemo } from "react";
import { View, useWindowDimensions } from "react-native";
import { faceCrop } from "@/lib/face/overlay";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import type { PortraitSource } from "./LockedPortrait";

const t = scoped("analysis");
/** Üç önizleme: hafif ölçek farkı ve opaklık (sabit; fotoğrafa bağlı değil). */
const VARIANTS = [
  { scaleX: 1.0, scaleY: 1.04, tint: 0.0 },
  { scaleX: 0.97, scaleY: 1.0, tint: 0.08 },
  { scaleX: 1.03, scaleY: 0.98, tint: 0.05 },
] as const;

/**
 * "Sana özel plan" kartı (KB P#14, Ç13): örnek stil görselleri = kullanıcının kendi fotoğrafının hafif değiştirilmiş,
 * çok bulanık hali; etiketsiz. CİHAZDA Skia ile üretilir (LLM/görsel modeli yok). Fotoğraf yoksa yalnız renkli yer tutucular.
 * Hiçbir şey kaydedilmez ya da paylaşılmaz.
 */
export function LockedPlanPreview({ source, onTap }: { source: PortraitSource | null; onTap: () => void }) {
  const { colors } = useTheme();
  const { width: winW } = useWindowDimensions();
  const tileW = Math.floor((Math.min(winW, 420) - spacing.md * 4 - spacing.sm * 2) / 3);
  const tileH = Math.round(tileW * 1.25);
  const image = useImage(source?.uri ?? null);
  const crop = useMemo(() => (source ? faceCrop(source.landmarksPx, source.width, source.height, 0.35, 0.8) : null), [source]);
  const usable = source !== null && image !== null && crop !== null && crop.width > 0;
  const k = usable ? tileW / crop.width : 1;

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ width: 32, height: 32, borderRadius: radius.md, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="sparkles-outline" size={16} color={colors.brand} />
        </View>
        <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>{t("locked.planPreviewTitle")}</Text>
        <Ionicons name="lock-closed" size={16} color={colors.mutedForeground} />
      </View>
      <Text variant="muted">{t("locked.planPreviewBody")}</Text>
      <View style={{ flexDirection: "row", gap: spacing.sm }} accessibilityLabel={t("locked.planPreviewAria")} accessibilityRole="image">
        {VARIANTS.map((v, i) => (
          <View key={i} style={{ width: tileW, height: tileH, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.brandSoft, borderWidth: 1, borderColor: colors.border }}>
            {usable ? (
              <Canvas style={{ width: tileW, height: tileH }}>
                <Group transform={[{ translateX: (tileW * (1 - v.scaleX)) / 2 - crop.x * k * v.scaleX }, { translateY: (tileH * (1 - v.scaleY)) / 2 - crop.y * k * v.scaleY }, { scaleX: k * v.scaleX }, { scaleY: k * v.scaleY }]}>
                  <SkiaImage image={image} x={0} y={0} width={source.width} height={source.height} fit="fill">
                    <Blur blur={9} />
                  </SkiaImage>
                </Group>
              </Canvas>
            ) : null}
            <View pointerEvents="none" style={{ position: "absolute", inset: 0, backgroundColor: colors.brand, opacity: v.tint }} />
          </View>
        ))}
      </View>
      <Button title={t("unlock")} variant="outline" onPress={onTap} />
    </Card>
  );
}
