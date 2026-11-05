import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Modal, Pressable, TextInput, View } from "react-native";
import { track } from "@/lib/analytics";
import { Button } from "@/mobile/src/components/ui/Button";
import { Text } from "@/mobile/src/components/ui/Text";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("feedback");
type Props = { targetType: "score" | "report" | "tryon" | "exercise"; targetId?: string; section?: string };

/** F18 (mobil): faydalı / faydasız ve "uygunsuz içerik bildir" → POST /api/feedback (fotoğraf eklenmez). */
export function FeedbackButtons({ targetType, targetId, section }: Props) {
  const { colors } = useTheme();
  const { api } = useSession();
  const [sent, setSent] = useState<1 | -1 | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  async function rate(rating: 1 | -1) {
    try {
      await api.post("/api/feedback", { targetType, targetId, rating, reason: section ? `section:${section}` : undefined });
      setSent(rating);
      track("feedback_sent", { targetType, rating });
    } catch {
      Alert.alert(t("error"));
    }
  }
  async function report() {
    try {
      await api.post("/api/feedback", { targetType, targetId, isAbuseReport: true, reason: `${section ? `section:${section} ` : ""}${reason}`.trim() || undefined });
      setOpen(false);
      setReason("");
      Alert.alert(t("reported"));
      track("feedback_sent", { targetType, rating: null });
    } catch {
      Alert.alert(t("error"));
    }
  }
  const icon = (name: "thumbs-up-outline" | "thumbs-down-outline" | "flag-outline", label: string, onPress: () => void, active = false, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} hitSlop={8} style={{ padding: 6, opacity: disabled && !active ? 0.4 : 1 }}>
      <Ionicons name={name} size={18} color={active ? colors.foreground : colors.mutedForeground} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
      <Text variant="small">{sent ? t("thanks") : t("helpful")}</Text>
      {icon("thumbs-up-outline", t("yes"), () => void rate(1), sent === 1, sent !== null)}
      {icon("thumbs-down-outline", t("no"), () => void rate(-1), sent === -1, sent !== null)}
      {icon("flag-outline", t("report"), () => setOpen(true))}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm }}>
            <Text variant="heading">{t("reportTitle")}</Text>
            <Text variant="muted">{t("reportBody")}</Text>
            <TextInput multiline maxLength={500} value={reason} onChangeText={setReason} placeholder={t("reportPlaceholder")} placeholderTextColor={colors.mutedForeground} accessibilityLabel={t("reportPlaceholder")} style={{ minHeight: 90, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.foreground, textAlignVertical: "top" }} />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button title={t("cancel")} variant="ghost" style={{ flex: 1 }} onPress={() => setOpen(false)} />
              <Button title={t("send")} style={{ flex: 1 }} onPress={report} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
