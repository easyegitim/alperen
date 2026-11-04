import { View } from "react-native";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("tryon");

/** Kalan hak çubuğu (sunum): kota sunucudan (mod başına ağırlık). */
export function QuotaBar({ remaining, limit, nextAt }: { remaining: number; limit: number; nextAt: string | null }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, backgroundColor: colors.card }} accessible accessibilityLabel={t("remaining", { n: remaining, limit })}>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text variant="small" style={{ fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 }}>{t("remainingLabel")}</Text>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.track }}>
          <View style={{ width: `${limit ? (remaining / limit) * 100 : 0}%`, height: 8, borderRadius: 4, backgroundColor: colors.brand }} />
        </View>
        {remaining === 0 && nextAt ? <Text variant="small">{t("nextAt", { date: new Date(nextAt).toLocaleDateString("tr-TR") })}</Text> : null}
      </View>
      <Text>
        <Text style={{ fontSize: 28, fontWeight: "700", color: colors.brand }}>{remaining}</Text>
        <Text variant="muted"> / {limit}</Text>
      </Text>
    </View>
  );
}

/** Üretim bekleme kartı: 12 sn sonra "kontrol ediliyor", 45 sn sonra "biraz uzun". */
export function TryonGenerating({ title, elapsed }: { title: string; elapsed: number }) {
  return (
    <Card title={title} description={elapsed > 45 ? t("generating.slow") : elapsed > 12 ? t("v2.qc.checking") : t("generating.body")}>
      <Text variant="muted" accessibilityLiveRegion="polite">{t("generating.elapsed", { s: elapsed })}</Text>
    </Card>
  );
}

/** Rıza kartı (bir kez sorulur). */
export function TryonConsentCard({ onAccept }: { onAccept: () => void }) {
  return (
    <Card title={t("consent.title")} description={t("consent.body")}>
      {(["b1", "b2", "b3", "b4"] as const).map((k) => (
        <Text key={k} variant="muted">• {t(`consent.${k}`)}</Text>
      ))}
      <Button title={t("consent.accept")} size="lg" onPress={onAccept} />
    </Card>
  );
}
