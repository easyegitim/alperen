import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { formatRemaining, type OfferResponse } from "@/lib/billing/offer";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import { remainingMinutes, remainingMs } from "./offer";

const t = scoped("paywall.v2");

/**
 * Gerçek süreli teklif geri sayımı (KB P#18): süre sunucudan, saat kaymasına göre düzeltilir; 0 olunca "süresi doldu"
 * (fiyat normal). Saniyede bir yenilenir; ekran okuyucu yalnız dakika değişince duyar.
 */
export function OfferCountdown({ offer, skewMs, onEnded }: { offer: OfferResponse; skewMs: number; onEnded?: () => void }) {
  const { colors } = useTheme();
  const [now, setNow] = useState(() => Date.now());
  const left = remainingMs(offer, skewMs, now);
  const ended = left <= 0;
  useEffect(() => {
    if (ended) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ended]);
  useEffect(() => {
    if (ended) onEnded?.();
  }, [ended, onEnded]);

  if (ended) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.muted }} accessibilityRole="text">
        <Ionicons name="time-outline" size={16} color={colors.mutedForeground} />
        <Text variant="small" style={{ flex: 1 }}>{t("offerEnded")}</Text>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brandSoft }} accessibilityLabel={t("offerAria", { time: `${remainingMinutes(left)} dk` })} accessibilityRole="text">
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flex: 1 }}>
        <Ionicons name="time-outline" size={16} color={colors.brand} />
        <Text variant="small" style={{ color: colors.foreground, fontWeight: "500", flex: 1 }}>{t("offerRemaining")}</Text>
      </View>
      <Text style={{ fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatRemaining(left)}</Text>
    </View>
  );
}
