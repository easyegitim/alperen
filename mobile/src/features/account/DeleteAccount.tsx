import { router } from "expo-router";
import { useState } from "react";
import { Alert, Modal, View } from "react-native";
import { DELETE_CONFIRM_WORD, DELETION_GRACE_DAYS, isDeleteConfirmed } from "@/lib/account/consents";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Input } from "@/mobile/src/components/ui/Input";
import { Text } from "@/mobile/src/components/ui/Text";
import { setAnalyticsConsent } from "@/mobile/src/features/analytics/consent";
import { clearCaptureState } from "@/mobile/src/features/capture/captureSession";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { scoped } from "@/mobile/src/lib/i18n";
import { clearProgressPhotos } from "@/mobile/src/lib/progressStore";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("account.delete");

/** F15 "Hesabımı sil" (mobil; Apple 5.1.1(v)): "SİL" → POST /api/me/delete → cihaz temizliği → çıkış. */
export function DeleteAccount() {
  const { colors } = useTheme();
  const { api, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!isDeleteConfirmed(word)) return;
    setBusy(true);
    try {
      await api.post("/api/me/delete", { confirm: word });
      await clearProgressPhotos().catch(() => undefined);
      await clearCaptureState().catch(() => undefined);
      await setAnalyticsConsent(false).catch(() => undefined);
      await signOut().catch(() => undefined);
      setOpen(false);
      Alert.alert(t("done", { days: DELETION_GRACE_DAYS }));
      router.replace("/");
    } catch {
      Alert.alert(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("title")} description={t("description", { days: DELETION_GRACE_DAYS })} style={{ borderColor: colors.destructive }}>
      <Button title={t("button")} variant="destructive" onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: "rgba(0,0,0,0.5)" }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm }}>
            <Text variant="heading">{t("confirmTitle")}</Text>
            <Text variant="muted">{t("confirmBody", { word: DELETE_CONFIRM_WORD, days: DELETION_GRACE_DAYS })}</Text>
            <Input label={t("typeWord", { word: DELETE_CONFIRM_WORD })} value={word} onChangeText={setWord} autoCapitalize="characters" autoCorrect={false} />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button title={t("keep")} variant="outline" style={{ flex: 1 }} onPress={() => { setOpen(false); setWord(""); }} />
              <Button title={busy ? t("cleaning") : t("confirm")} variant="destructive" style={{ flex: 1 }} disabled={!isDeleteConfirmed(word)} busy={busy} onPress={confirm} />
            </View>
          </View>
        </View>
      </Modal>
    </Card>
  );
}
