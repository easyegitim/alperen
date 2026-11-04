import { router } from "expo-router";
import { View } from "react-native";
import { GLOW_UP_LAYERS, type GlowUpLayer } from "@/lib/tryon/types";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { SwitchRow } from "@/mobile/src/components/ui/SwitchRow";
import { Text } from "@/mobile/src/components/ui/Text";
import type { PlanStepLite } from "@/mobile/src/features/plan/viewModel";
import { toggleLayer, visibleGlowSteps } from "@/mobile/src/features/tryon/request";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("tryon.v2.glowUp");
type Props = { layers: readonly GlowUpLayer[]; onChange: (layers: GlowUpLayer[]) => void; onRun: () => void; planSteps: readonly PlanStepLite[]; analysisId: string | null; disabled?: boolean };

/** "İyileşmiş halin" (KB §7.2; PLAN 5d): adım anahtarları yalnız saç · yalnız sakal · cilt · hepsi; doktor işlemleri yok; plan şart. */
export function GlowUpPanel({ layers, onChange, onRun, planSteps, analysisId, disabled }: Props) {
  const { colors } = useTheme();
  const hasAnalysis = Boolean(analysisId);
  const hasPlan = planSteps.length > 0;
  const all = layers.length === GLOW_UP_LAYERS.length;
  const visible = visibleGlowSteps(planSteps, layers);
  return (
    <Card title={t("title")} description={t("intro")}>
      {!hasAnalysis ? <Text accessibilityRole="alert" style={{ fontSize: 13 }}>{t("needsAnalysis")}</Text> : null}
      <View style={{ gap: spacing.xs }}>
        <Text variant="small" style={{ fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 }}>{t("layersTitle")}</Text>
        <SwitchRow label={t("layers.all")} value={all} disabled={disabled} onChange={(on) => onChange(on ? [...GLOW_UP_LAYERS] : [])} />
        {GLOW_UP_LAYERS.map((l) => (
          <SwitchRow key={l} label={t(`layers.${l}`)} value={layers.includes(l)} disabled={disabled} onChange={(on) => onChange(toggleLayer(layers, l, on))} />
        ))}
      </View>
      <View style={{ gap: spacing.xs }}>
        <Text variant="small" style={{ fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 }}>{t("stepsTitle")}</Text>
        {!hasPlan ? (
          <View style={{ gap: spacing.sm, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.lg, padding: spacing.sm }}>
            <Text variant="muted" style={{ fontSize: 13 }} accessibilityRole={hasAnalysis ? "alert" : undefined}>{t("planRequired")}</Text>
            {analysisId ? <Button title={t("planOpen")} variant="outline" onPress={() => router.push({ pathname: "/plan/[id]", params: { id: analysisId } })} /> : null}
          </View>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {visible.map((s) => (
              <Text key={s.id} style={{ backgroundColor: colors.muted, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4, fontSize: 12, fontWeight: "500" }}>{s.title}</Text>
            ))}
            {visible.length === 0 ? <Text variant="small">{t("noLayer")}</Text> : null}
          </View>
        )}
      </View>
      <View style={{ gap: 2 }}>
        <Text variant="small">{t("skinNote")}</Text>
        <Text variant="small">{t("noDoctor")}</Text>
        <Text variant="small">{t("regenPaid")} {t("notForAds")}</Text>
      </View>
      <Button title={t("run")} size="lg" disabled={disabled || !hasAnalysis || !hasPlan || layers.length === 0} onPress={onRun} />
    </Card>
  );
}
