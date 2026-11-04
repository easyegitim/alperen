import { useEffect, useRef } from "react";
import { View } from "react-native";
import { track } from "@/lib/analytics";
import { CHANGE_LABEL_KEY, NOISE_BAND, formatBand, formatDelta, type ChangeKind } from "@/lib/progress/noise";
import { Text } from "@/mobile/src/components/ui/Text";
import { latestChange, type TrendPointLike } from "@/mobile/src/features/progress/change";
import { scoped, t as tt } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const tv = scoped("progress.v2");
const GLYPH: Record<ChangeKind, string> = { no_change: "—", up: "↗", down: "↘" };

/**
 * Son iki analiz arasındaki fark (KB §4.2): |Δ| ≤ ±bant → "Değişim yok" ve bandın açıklaması (ışık/açı). Kıyas yalnız
 * kullanıcının kendi geçmişiyle. Kalibrasyon sürümü farklıysa karşılaştırma yapılmaz. Olay yüksüz (fark/skor gitmez).
 */
export function ScoreChangeNote({ points, band = NOISE_BAND }: { points: readonly TrendPointLike[]; band?: number }) {
  const { colors } = useTheme();
  const latest = latestChange(points, band);
  const kind = latest?.change?.kind ?? null;
  const trackedRef = useRef<string | null>(null);
  useEffect(() => {
    if (kind !== "no_change" || !latest || trackedRef.current === latest.to.id) return;
    trackedRef.current = latest.to.id;
    track("progress_no_change_shown");
  }, [kind, latest]);
  if (!latest) return null;
  if (latest.calibrationChanged || !latest.change) {
    return <Text variant="small" style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.lg, padding: spacing.sm }}>{tv("calibrationChanged")}</Text>;
  }
  const c = latest.change;
  const label = tt(CHANGE_LABEL_KEY[c.kind]);
  const tone = c.kind === "up" ? { bg: colors.brandSoft, fg: colors.success } : c.kind === "down" ? { bg: colors.brandSoft, fg: colors.brand } : { bg: colors.muted, fg: colors.foreground };
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text accessibilityLiveRegion="polite" accessibilityLabel={tv("changeAria", { label })} style={{ backgroundColor: tone.bg, color: tone.fg, fontWeight: "600", fontSize: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full }}>
          {GLYPH[c.kind]} {label}
        </Text>
        <Text variant="small">{tv("deltaLabel", { delta: formatDelta(c.delta) })}</Text>
      </View>
      <Text variant="small">{c.kind === "no_change" ? `${tv("noiseNote", { band: formatBand(c.band) })} ` : ""}{tv("ownHistoryNote")}</Text>
    </View>
  );
}
