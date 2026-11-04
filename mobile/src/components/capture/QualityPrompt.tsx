import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, View } from "react-native";
import { track } from "@/lib/analytics";
import { Button } from "@/mobile/src/components/ui/Button";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("camera.qualityPrompt");

/**
 * KB §3.1/6 (R1-E12, R1-E14): kötü ya da karanlık fotoğrafta net bir evet/hayır pop-up'ı. Engellemez; sonuç yalnız
 * kullanıcı "Evet" derse çıkar. Metin KB'deki öneri: camera.qualityPrompt (web QualityPrompt ile aynı).
 */
export function QualityPrompt({ open, onYes, onNo }: { open: boolean; onYes: () => void; onNo: () => void }) {
  const { colors } = useTheme();
  const no = () => {
    track("capture_quality_prompt", { answer: "no" });
    onNo();
  };
  const yes = () => {
    track("capture_quality_prompt", { answer: "yes" });
    onYes();
  };
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={no}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: spacing.lg }} onPress={no} accessibilityLabel={t("no")}>
        <Pressable onPress={() => undefined} style={{ backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md, alignItems: "center" }} accessibilityViewIsModal>
          <View style={{ width: 48, height: 48, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSoft }}>
            <Ionicons name="warning-outline" size={26} color={colors.warn} />
          </View>
          <Text variant="heading" accessibilityRole="header" style={{ textAlign: "center" }}>{t("title")}</Text>
          <Text variant="muted" style={{ textAlign: "center" }}>{t("body")}</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm, alignSelf: "stretch" }}>
            <Button title={t("no")} variant="outline" size="lg" style={{ flex: 1 }} onPress={no} />
            <Button title={t("yes")} size="lg" style={{ flex: 1 }} onPress={yes} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
