import { router } from "expo-router";
import { View } from "react-native";
import { HAIR_LOSS_SPECIALTIES } from "@/content/expert-specialties";
import { Button } from "@/mobile/src/components/ui/Button";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("plan.v2.hairLoss");
type Props = { signal: "possible" | "visible"; doctorLayerEnabled: boolean; expertNetworkEnabled: boolean; hasScalpStep: boolean; onDoctorPress?: () => void };

/** Saç dökülmesi akışı (KB §6.3, R1-W2): nötr bilgi kartı → doktor katmanı (bayrak) → uzman dizini. Teşhis yok, ilaç adı yok. */
export function HairLossCard({ signal, doctorLayerEnabled, expertNetworkEnabled, hasScalpStep, onDoctorPress }: Props) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md }}>
      <Text style={{ fontSize: 15, fontWeight: "600" }} accessibilityRole="header">{t("title")}</Text>
      <Text variant="muted" style={{ fontSize: 13, lineHeight: 19 }}>{t(signal === "visible" ? "bodyVisible" : "bodyPossible")}</Text>
      <Text variant="muted" style={{ fontSize: 13, lineHeight: 19 }}>{t(hasScalpStep ? "info" : "infoGeneral")}</Text>
      {doctorLayerEnabled && onDoctorPress ? <Button title={t("doctor")} variant="ghost" onPress={onDoctorPress} /> : null}
      {expertNetworkEnabled ? <Button title={t("expert")} variant="outline" onPress={() => router.push({ pathname: "/uzman", params: { alan: HAIR_LOSS_SPECIALTIES[0] } })} /> : null}
      <Text variant="small">{t("notMedical")}</Text>
    </View>
  );
}
