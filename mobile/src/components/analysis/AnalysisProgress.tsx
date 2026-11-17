import { useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { spacing, useTheme } from "@/mobile/src/theme";

const STEPS = ["landmarks", "ratios", "skinHair", "calibrating"] as const;
const t = scoped("analysis.progress");

/** SPEC 4.1 adım 7: analiz animasyonu; gerçek istek arka planda, son adım yanıta kadar bekler. */
export function AnalysisProgress({ done }: { done: boolean }) {
  const { colors } = useTheme();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= STEPS.length - 1) return;
    const id = setTimeout(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1600);
    return () => clearTimeout(id);
  }, [step]);
  const value = done ? 100 : Math.round(((step + 0.5) / STEPS.length) * 100);
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: value }} accessibilityLiveRegion="polite" style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl }}>
      <Text variant="heading">{t(`steps.${STEPS[step]}`)}</Text>
      <View style={{ width: 240, height: 6, borderRadius: 3, backgroundColor: colors.muted }}>
        <View style={{ width: `${value}%`, height: 6, borderRadius: 3, backgroundColor: colors.foreground }} />
      </View>
      <Text variant="small">{t("hint")}</Text>
    </View>
  );
}
