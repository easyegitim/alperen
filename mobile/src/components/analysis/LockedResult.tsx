import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { track } from "@/lib/analytics";
import type { PaywallTrigger } from "@/lib/config/paywall";
import { SUB_KEYS_V2 } from "@/lib/config/teaser";
import type { ClientAnalysisV2 } from "@/lib/score/present";
import { Text } from "@/mobile/src/components/ui/Text";
import { usePaywall } from "@/mobile/src/features/paywall/PaywallSheet";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import { LockedFirstSteps } from "./LockedFirstSteps";
import { LockedHero } from "./LockedHero";
import { LockedMeasurements } from "./LockedMeasurements";
import { LockedPlanPreview } from "./LockedPlanPreview";
import type { PortraitSource } from "./LockedPortrait";
import { LockedSubscoreList } from "./LockedSubscoreList";

const t = scoped("analysis");

/**
 * Kilitli sonuç ekranı (KB §3.3; web ScoreViewV2 ile aynı sıra): "Analizin tamamlandı" satırı → portre + aynı halka/kilit →
 * alt skor adları (aynı bulanık çubuk, rozet yok) → ilk adımlar (3 bulanık satır) → sana özel plan (cihazda bulanık
 * önizlemeler) → oranlar (açık, KB notu). Sunucudan hiçbir skor gelmez (null + locked); dokununca paywall sheet açılır.
 * Sahip: W7a. Açık (hak var) dal W7b'nin ResultV2View'ındadır (CONTRACTS_V2 S3.0).
 */
export function LockedResult({ a, source }: { a: ClientAnalysisV2; source: PortraitSource | null }) {
  const { colors } = useTheme();
  const { open } = usePaywall();
  const onLocked = (tr: PaywallTrigger) => open(tr);
  const viewedRef = useRef<string | null>(null);

  useEffect(() => {
    if (viewedRef.current === a.id) return;
    viewedRef.current = a.id;
    track("result_viewed", { tier: "free", overlay: source ? "photo" : "schematic", legacy: false });
  }, [a.id, source]);

  const prelim = a.faceShape?.override ? { primary: a.faceShape.override } : (a.faceShape?.prelim ?? null);

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.muted }} accessibilityRole="text">
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.success, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="checkmark" size={14} color="#fff" />
        </View>
        <Text variant="small" style={{ flex: 1, color: colors.foreground }}>
          <Text variant="small" style={{ fontWeight: "600", color: colors.foreground }}>{t("locked.deviceDone")}</Text> · {t("locked.unlockBody")}
        </Text>
      </View>
      <LockedHero faceShape={prelim} source={source} onLocked={onLocked} />
      <LockedSubscoreList keys={SUB_KEYS_V2} onLocked={onLocked} />
      <LockedFirstSteps onLocked={onLocked} />
      <LockedPlanPreview source={source} onTap={() => onLocked("plan")} />
      {a.device ? <LockedMeasurements ratios={a.device.ratios} /> : null}
      <Text variant="small" style={{ textAlign: "center" }}>{t("competitorsNote")}</Text>
    </View>
  );
}
