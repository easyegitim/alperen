import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { track } from "@/lib/analytics";
import type { BasisChip } from "@/lib/coach/planTypes";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { t as tt, scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("plan.v2.basis");
/** Çevrilebiliyorsa çeviri, yoksa değerin kendisi (anahtar döndüyse ham değer). */
const tr = (key: string, raw: string) => (tt(key) === key ? raw : tt(key));

export function basisValue(c: BasisChip): string {
  const v = c.value ?? "";
  switch (c.key) {
    case "goal":
      return tr(`questionnaire.options.goals.${v}`, v);
    case "goalDirection":
    case "budget":
    case "oneTimeBudget":
    case "sportDays":
    case "work":
    case "hairLength":
    case "beardLength":
      return tr(`questionnaire.v2.options.${c.key}.${v}`, v);
    case "skinType":
      return tr(`questionnaire.options.skinType.${v}`, v);
    case "glasses":
    case "headCovering":
      return `${v === "yes" ? t("yes") : t("no")}${c.source === "photo" ? ` (${t("fromPhoto")})` : ""}`;
    case "faceShape":
      return tr(`geometry.shapes.${v}`, v);
    case "ageBand":
      return tr(`onboarding.age.bands.${v}`, v);
    case "presentation":
      return tr(`onboarding.gender.options.${v}`, v);
    default:
      return v;
  }
}

export function basisLabel(c: BasisChip): string {
  return c.key === "jawHealth" ? t("chip.jawHealth") : t(`chip.${c.key}`, { value: basisValue(c) });
}

/** "Planın şunlara göre hazırlandı" (PLAN §3): her anket cevabı ve fotoğraf gerçeği; boy/kilo asla gelmez (sunucu yazmaz). */
export function BasisChips({ chips, analysisId, stale }: { chips: BasisChip[]; analysisId: string; stale: boolean }) {
  const { colors } = useTheme();
  return (
    <Card title={t("title")} description={stale ? t("staleNote") : undefined}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} accessibilityLabel={t("title")}>
        {chips.map((c, i) => (
          <Text key={`${c.key}-${i}`} style={{ backgroundColor: colors.muted, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6, fontSize: 12, fontWeight: "500" }}>
            {basisLabel(c)}
          </Text>
        ))}
      </View>
      <Pressable
        accessibilityRole="link"
        onPress={() => {
          track("plan_basis_edit_clicked");
          router.push({ pathname: "/plan/[id]/anket", params: { id: analysisId } });
        }}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: colors.brand, fontWeight: "600", fontSize: 14 }}>✎ {t("edit")}</Text>
      </Pressable>
      <View style={{ height: 0, marginTop: -spacing.sm }} />
    </Card>
  );
}
