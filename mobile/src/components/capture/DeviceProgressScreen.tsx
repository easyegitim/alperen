import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, View } from "react-native";
import { DEVICE_STEPS, deviceProgressValue, type DeviceProgress, type DeviceStep } from "@/lib/face/deviceProgress";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("analysis.deviceProgress");

/**
 * Ödeme öncesi yükleme ekranı (KB P#5, PLAN 1e): üstte kullanıcının fotoğrafı, yeşil tarama çubuğu aşağı yukarı gezer,
 * adımlar gerçek cihaz işleri, son satır "Analizin tamamlandı". Reduce-motion açıkken çubuk sabit durur.
 */
export function DeviceProgressScreen({ state, photoUri, viewsCount }: { state: DeviceProgress; photoUri: string | null; viewsCount: number }) {
  const { colors } = useTheme();
  const value = deviceProgressValue(state);
  const label = (s: DeviceStep) => (s === "views" ? t("views", { count: viewsCount }) : t(s));
  return (
    <View style={{ gap: spacing.md, alignItems: "center", paddingVertical: spacing.sm }}>
      <Text variant="small" style={{ textTransform: "uppercase", letterSpacing: 1 }}>{state.finished ? t("done") : t("title")}</Text>
      <Text accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: value }} style={{ fontSize: 44, lineHeight: 52, fontWeight: "700", color: colors.brand }}>
        {value}
        <Text style={{ fontSize: 22, color: colors.brand }}>%</Text>
      </Text>
      <ScanPhoto uri={photoUri} active={!state.finished} />
      <View style={{ width: 240, height: 6, borderRadius: 3, backgroundColor: colors.track }} accessibilityElementsHidden>
        <View style={{ width: `${value}%`, height: 6, borderRadius: 3, backgroundColor: colors.brand }} />
      </View>
      <View style={{ alignSelf: "stretch", gap: spacing.xs }} accessibilityLiveRegion="polite">
        {DEVICE_STEPS.map((s) => {
          const done = state.done.includes(s);
          const active = state.active === s;
          return (
            <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: active ? colors.brandSoft : "transparent" }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: done ? colors.brand : colors.muted }}>
                {done ? <Ionicons name="checkmark" size={14} color={colors.primaryForeground} /> : active ? <Ionicons name="ellipse" size={8} color={colors.brand} /> : <Ionicons name="ellipse" size={6} color={colors.mutedForeground} />}
              </View>
              <Text style={{ flex: 1, fontWeight: active ? "600" : "400", color: done || active ? colors.foreground : colors.mutedForeground }}>
                {label(s)}
                {done ? <Text variant="small"> · {t("doneSr")}</Text> : null}
              </Text>
            </View>
          );
        })}
      </View>
      {state.finished ? <Text style={{ fontWeight: "600" }} accessibilityLiveRegion="assertive">{t("done")}</Text> : <Text variant="small">{t("hint")}</Text>}
    </View>
  );
}

/** Fotoğraf (4:5, cover) ve üstünde gezen yeşil çubuk. Fotoğraf yalnız geçici dosyadan okunur. */
function ScanPhoto({ uri, active }: { uri: string | null; active: boolean }) {
  const { colors } = useTheme();
  const [y] = useState(() => new Animated.Value(0));
  const W = 240;
  const H = 300;
  useEffect(() => {
    let cancelled = false;
    let loop: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce || !active) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(y, { toValue: H - 4, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(y, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [active, y]);
  return (
    <View style={{ width: W, height: H, borderRadius: radius.xl, overflow: "hidden", backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {uri ? <Image source={{ uri }} style={{ width: W, height: H }} resizeMode="cover" /> : null}
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, backgroundColor: colors.success, shadowColor: colors.success, shadowOpacity: 0.9, shadowRadius: 8, transform: [{ translateY: y }] }} />
    </View>
  );
}
