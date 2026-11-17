import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Alert, Modal, View } from "react-native";
import { track } from "@/lib/analytics";
import { APP_NAME } from "@/lib/config/app";
import { OptionRow } from "@/mobile/src/components/ui/OptionRow";
import { Button } from "@/mobile/src/components/ui/Button";
import { SwitchRow } from "@/mobile/src/components/ui/SwitchRow";
import { Text } from "@/mobile/src/components/ui/Text";
import { env } from "@/mobile/src/lib/env";
import { scoped, t as tt } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import type { ShareCardFormat } from "./layout";
import { loadSkiaImage, renderShareCardBase64, shareBase64Jpeg } from "./renderCard";

const t = scoped("share");
type Props = { overall: number; potential: number; subs: { label: string; value: number }[] };

/** F10 (mobil): skor + potansiyel + 3 alt skor; fotoğraf eklemek kullanıcı seçimi (varsayılan kapalı). Kart cihazda üretilir. */
export function ShareCardButton({ overall, potential, subs }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ShareCardFormat>("story");
  const [withPhoto, setWithPhoto] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pickPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (!res.canceled && res.assets[0]) setPhotoUri(res.assets[0].uri);
  }

  async function create() {
    setBusy(true);
    try {
      const photo = withPhoto && photoUri ? await loadSkiaImage(photoUri).catch(() => null) : null;
      if (withPhoto && photoUri && !photo) {
        Alert.alert(t("photoError"));
        return;
      }
      const b64 = renderShareCardBase64({ overall, potential, subs, appName: APP_NAME, url: env.apiUrl.replace(/^https?:\/\//, ""), disclaimer: tt("common.scoreDisclaimer"), format, hasPhoto: Boolean(photo) }, photo);
      photo?.dispose();
      const r = await shareBase64Jpeg(b64, t("shareTitle"));
      track("share_card_created", { withPhoto: Boolean(photo) });
      setOpen(false);
      Alert.alert(r === "shared" ? t("shared") : t("error"));
    } catch {
      Alert.alert(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button title={t("button")} variant="outline" onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View style={{ backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}>
            <Text variant="heading" accessibilityRole="header">{t("title")}</Text>
            <Text variant="muted">{t("description")}</Text>
            <OptionRow kind="radio" label={t("story")} selected={format === "story"} onPress={() => setFormat("story")} />
            <OptionRow kind="radio" label={t("square")} selected={format === "square"} onPress={() => setFormat("square")} />
            <SwitchRow label={t("addPhoto")} hint={t("addPhotoHint")} value={withPhoto} onChange={setWithPhoto} />
            {withPhoto ? <Button title={photoUri ? t("changePhoto") : t("pickPhoto")} variant="outline" onPress={pickPhoto} /> : null}
            <Button title={t("create")} size="lg" busy={busy} disabled={withPhoto && !photoUri} onPress={create} />
            <Button title={tt("common.back")} variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}
