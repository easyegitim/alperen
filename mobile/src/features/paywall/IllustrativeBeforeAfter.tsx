import { View } from "react-native";
import { Text } from "@/mobile/src/components/ui/Text";
import type { Presentation } from "@/mobile/src/lib/api";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("paywall.v2.beforeAfter");
const tv = scoped("paywall.v2");

/** Web illustrationVariant ile aynı: figür cinsiyete göre; 18 altı/18–24 için genç yetişkin görünümü (Ç14). */
export function illustrationVariant(presentation: Presentation | null | undefined, ageBand: string | null | undefined): { figure: Presentation; adultYoung: boolean } {
  const figure: Presentation = presentation === "male" || presentation === "female" ? presentation : "unspecified";
  return { figure, adultYoung: ageBand === "under_18" || ageBand === "18_24" };
}

/** Nötr çizgi figür (yer tutucu; stok görsel gelince aynı bileşen kaynak alır). Gerçek yüz yok. */
function Figure({ figure, after }: { figure: Presentation; after: boolean }) {
  const { colors } = useTheme();
  const hairLong = figure === "female";
  const beard = figure === "male";
  const line = colors.mutedForeground;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "flex-end" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* omuzlar */}
      <View style={{ position: "absolute", bottom: 0, width: "100%", height: "22%", borderTopLeftRadius: 60, borderTopRightRadius: 60, backgroundColor: colors.brandSoft }} />
      <View style={{ width: "58%", aspectRatio: 0.83, marginBottom: "18%", alignItems: "center" }}>
        {/* saç (önce dağınık: daha geniş, sonra düzenli) */}
        <View style={{ position: "absolute", top: after ? "-4%" : "-9%", width: after ? "100%" : "112%", height: after ? "40%" : "48%", borderRadius: 999, backgroundColor: line, opacity: after ? 0.6 : 0.5 }} />
        {hairLong ? <View style={{ position: "absolute", top: "20%", width: after ? "112%" : "126%", height: "95%", borderRadius: 40, backgroundColor: line, opacity: 0.35 }} /> : null}
        {/* yüz */}
        <View style={{ width: "100%", height: "100%", borderRadius: 999, backgroundColor: colors.card, borderWidth: 2, borderColor: line, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <View style={{ flexDirection: "row", gap: 18, marginTop: "6%" }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: line }} />
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: line }} />
          </View>
          {/* kaşlar */}
          <View style={{ position: "absolute", top: "33%", flexDirection: "row", gap: 12 }}>
            <View style={{ width: 16, height: after ? 2 : 3, borderRadius: 2, backgroundColor: line, transform: [{ rotate: after ? "0deg" : "6deg" }] }} />
            <View style={{ width: 16, height: after ? 2 : 3, borderRadius: 2, backgroundColor: line, transform: [{ rotate: after ? "0deg" : "-6deg" }] }} />
          </View>
          {/* ağız */}
          <View style={{ position: "absolute", bottom: "24%", width: 18, height: after ? 7 : 3, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderWidth: 2, borderTopWidth: 0, borderColor: line }} />
          {/* sakal (önce dağınık noktalar, sonra düzenli hat) */}
          {beard ? (
            after ? (
              <View style={{ position: "absolute", bottom: 0, width: "90%", height: "34%", borderBottomLeftRadius: 999, borderBottomRightRadius: 999, borderWidth: 6, borderTopWidth: 0, borderColor: line, opacity: 0.45 }} />
            ) : (
              <View style={{ position: "absolute", bottom: "6%", width: "80%", height: "20%", flexDirection: "row", flexWrap: "wrap", justifyContent: "space-around", opacity: 0.45 }}>
                {Array.from({ length: 10 }, (_, i) => (
                  <View key={i} style={{ width: 2, height: 6, borderRadius: 1, backgroundColor: line, transform: [{ rotate: `${(i % 3) * 15 - 15}deg` }] }} />
                ))}
              </View>
            )
          ) : null}
          {after ? <View style={{ position: "absolute", left: "12%", top: "40%", width: 2, height: "18%", borderRadius: 1, backgroundColor: colors.brand, opacity: 0.5 }} /> : null}
        </View>
      </View>
    </View>
  );
}

/**
 * İllüstratif önce/sonra (KB P#17, Ç14): gerçek yüz yok; cinsiyete göre figür; "İllüstratif" etiketi her zaman görünür.
 * Garanti ya da sosyal kanıt içermez (P#19, P#22).
 */
export function IllustrativeBeforeAfter({ presentation, ageBand }: { presentation?: Presentation | null; ageBand?: string | null }) {
  const { colors } = useTheme();
  const { figure } = illustrationVariant(presentation, ageBand);
  return (
    <View style={{ padding: spacing.sm, gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.card }} accessibilityRole="image" accessibilityLabel={t("aria")}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text variant="small" style={{ fontWeight: "600", color: colors.foreground }}>{t("title")}</Text>
        <View style={{ paddingHorizontal: 10, height: 24, borderRadius: radius.full, backgroundColor: colors.muted, justifyContent: "center" }}>
          <Text variant="small" style={{ fontWeight: "600" }}>{tv("illustrativeLabel")}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {([false, true] as const).map((after) => (
          <View key={String(after)} style={{ flex: 1, aspectRatio: 0.8, borderRadius: radius.md, overflow: "hidden", backgroundColor: after ? colors.brandSoft : colors.muted }}>
            <Figure figure={figure} after={after} />
            <View style={{ position: "absolute", left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.background }}>
              <Text variant="small" style={{ fontWeight: "600", color: colors.foreground }}>{after ? t("after") : t("before")}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text variant="small">{t("caption")}</Text>
    </View>
  );
}
