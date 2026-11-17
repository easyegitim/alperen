import { router } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import type { AnalysisFailure, AnalysisStage } from "@/lib/score/contract";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped, t as tt } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("analysis");
const tr = scoped("analysis.result");

/** Ödeme alındı, görseller henüz gönderilmedi: fotoğraf seti çekim ekranından gider (görsel sunucuda yok). */
export function PendingUploadCard({ analysisId }: { analysisId: string }) {
  return (
    <Card title={tr("pending.title")} description={tr("pending.body")}>
      <Button title={tr("pending.cta")} size="lg" onPress={() => router.push({ pathname: "/tara", params: { analysis: analysisId } })} />
    </Card>
  );
}

/** Sıra / çalışıyor başlığı: gerçek aşama metni; süre vaadi yok (Ç16). */
export function StageBanner({ stage, done, total, pollError }: { stage: AnalysisStage; done: number; total: number; pollError: boolean }) {
  const { colors } = useTheme();
  if (stage !== "queued" && stage !== "running") return null;
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 10 }}>
      <ActivityIndicator color={colors.brand} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "600", fontSize: 13 }}>{t(`stage.${stage}`)}</Text>
        <Text variant="small">
          {tr("progressLabel", { done, total })}
          {pollError ? ` · ${t("processingRefresh")}` : ""}
        </Text>
      </View>
      <View style={{ width: 64, height: 6, borderRadius: 3, backgroundColor: colors.track }} accessible={false}>
        <View style={{ width: `${total ? (done / total) * 100 : 0}%`, height: 6, borderRadius: 3, backgroundColor: colors.brand }} />
      </View>
    </View>
  );
}

/** Başarısız (KB P#22 notu): hak düşmedi; görseller saklanmadığı için yeniden deneme çekim ekranından. */
export function FailedCard({ failure, analysisId }: { failure: AnalysisFailure | null; analysisId: string }) {
  const code = failure?.code ?? "AI_FAILED";
  const msg = tt(`analysis.errors.${code}`) === `analysis.errors.${code}` ? t("errors.GENERIC") : tt(`analysis.errors.${code}`);
  return (
    <Card title={t("stage.failed")} description={msg}>
      <Text variant="small">{tr("retryHint")}</Text>
      <Button title={t("stage.retry")} size="lg" onPress={() => router.push({ pathname: "/tara", params: { analysis: analysisId } })} />
    </Card>
  );
}
