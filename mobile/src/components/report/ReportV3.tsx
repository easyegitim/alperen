import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { STRUCTURAL_REGIONS } from "@/lib/coach/planTypes";
import type { ReportV3 as ReportV3Type } from "@/lib/score/contract";
import { MeasureBar } from "@/mobile/src/components/analysis/result/MeasuresCard";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("report.v2");

type Props = {
  report: ReportV3Type | null;
  analysisId: string;
  viewsUsed?: number;
  /** Plan bu ekranda aşağıdaysa bağlantı yerine kaydırma; yoksa /plan/[id]. */
  onPlanPress?: () => void;
  glowUpEnabled?: boolean;
};

/**
 * Rapor v3 iskeleti (KB §5; PLAN 4a): açılış mektubu · 9 bölge (güçlü yan → görülen → ≤ 2 fırsat; "değişiklik gerekmez") ·
 * ölçüler (açılır; dengeli aralık çubuğu) · plan · "iyileşmiş hâlin" · kapanış ("Tıbbi tavsiye değildir").
 * Yapısal bölgelerde (göz, burun, elmacık, çene) tarif + algı notu; yargı yok.
 */
export function ReportV3({ report, analysisId, viewsUsed = 0, onPlanPress, glowUpEnabled = true }: Props) {
  const { colors } = useTheme();
  const [measuresOpen, setMeasuresOpen] = useState(false);
  if (!report) {
    return (
      <Card>
        <Text variant="muted">{t("missing")}</Text>
      </Card>
    );
  }
  const structural = new Set<string>(STRUCTURAL_REGIONS);
  return (
    <View style={{ gap: spacing.md }}>
      <Card title={t("letterTitle")} style={{ borderColor: colors.brand }}>
        <Text style={{ fontSize: 15, lineHeight: 23, fontWeight: "500" }}>{report.letter}</Text>
        {viewsUsed > 0 ? <Text variant="small">{t("confidence", { n: viewsUsed })}</Text> : null}
      </Card>

      <Card title={t("regionsTitle")}>
        <View style={{ gap: spacing.sm }}>
          {report.regions.map((r) => (
            <View key={r.key} style={{ gap: 4, backgroundColor: colors.muted, borderRadius: radius.lg, padding: spacing.sm }}>
              <Text style={{ fontWeight: "600" }}>{t(`regions.${r.key}`)}</Text>
              <Text style={{ fontSize: 13, lineHeight: 19 }}>
                <Text variant="small">{t("strength")}: </Text>
                {r.strength}
              </Text>
              <Text style={{ fontSize: 13, lineHeight: 19 }}>
                <Text variant="small">{t("seen")}: </Text>
                {r.seen}
              </Text>
              {r.improvements.length ? (
                <View>
                  <Text variant="small">{t("improvements")}:</Text>
                  {r.improvements.map((s, i) => (
                    <Text key={i} style={{ fontSize: 13, lineHeight: 19 }}>• {s}</Text>
                  ))}
                </View>
              ) : (
                <Text variant="small">{t("noChange")}</Text>
              )}
              {structural.has(r.key) ? <Text variant="small">{t("structuralNote")}</Text> : null}
            </View>
          ))}
        </View>
      </Card>

      {report.measures.length ? (
        <Card>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: measuresOpen }} onPress={() => setMeasuresOpen((o) => !o)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text variant="heading">{t("measures.title")}</Text>
            <Text variant="small">{measuresOpen ? t("measures.close") : t("measures.open")}</Text>
          </Pressable>
          {measuresOpen ? (
            <View style={{ gap: spacing.md }}>
              {report.measures.map((m) => (
                <MeasureBar key={m.key} m={m} />
              ))}
              <Text variant="small">{t("measures.hint")}</Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <Text style={{ fontWeight: "600" }}>{t("planTitle")}</Text>
        <Text variant="small">{t("planBody")}</Text>
        <Button title={t("planLink")} variant="outline" onPress={onPlanPress ?? (() => router.push({ pathname: "/plan/[id]", params: { id: analysisId } }))} />
      </Card>
      {glowUpEnabled ? (
        <Card>
          <Text style={{ fontWeight: "600" }}>{t("glowUpTitle")}</Text>
          <Text variant="small">{t("glowUpBody")}</Text>
          <Button title={t("glowUpLink")} variant="outline" onPress={() => router.push({ pathname: "/(tabs)/dene", params: { mode: "glow_up", analysis: analysisId } })} />
        </Card>
      ) : null}

      <Card title={t("closingTitle")}>
        <Text style={{ fontSize: 13, lineHeight: 19, color: colors.mutedForeground }}>{report.closing}</Text>
        <Text variant="small">{t("cosmeticNote")}</Text>
        <Text style={{ fontSize: 12, fontWeight: "600" }}>{t("notMedicalAdvice")}</Text>
      </Card>
    </View>
  );
}
