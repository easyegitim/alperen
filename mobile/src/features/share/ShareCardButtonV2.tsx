import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Alert, Modal, View } from "react-native";
import { track } from "@/lib/analytics";
import { APP_NAME } from "@/lib/config/app";
import type { SubKey } from "@/lib/config/teaser";
import { SHARE_RULES, shareSpecIssues, type ShareCardKind, type ShareCardSpec } from "@/lib/share/spec";
import { Button } from "@/mobile/src/components/ui/Button";
import { OptionRow } from "@/mobile/src/components/ui/OptionRow";
import { SwitchRow } from "@/mobile/src/components/ui/SwitchRow";
import { Text } from "@/mobile/src/components/ui/Text";
import { env } from "@/mobile/src/lib/env";
import { scoped, t as tt } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";
import type { ShareCardFormat } from "./layout";
import { loadSkiaImage, renderShareSpecBase64, shareBase64Jpeg } from "./renderCard";

const t = scoped("share.v2");
const tv1 = scoped("share");

export type ShareScoreInput = { overall: number; potential: number | null; subs: { key: SubKey; label: string; value: number }[] };
export type ShareStrongestInput = { sub: SubKey; area: string; line: string };
type Props = { score: ShareScoreInput; strongest: ShareStrongestInput | null };

/**
 * Paylaşım kartı v2 (KB §8 KARAR R2-Ö3; CONTRACTS_V2 S3.3.1): varsayılan skor kartı; isteğe bağlı "En güçlü yanın: …"
 * (sayı yok). Fotoğraf yalnız kişisel paylaşımda (audience personal). Kart cihazda üretilir; sunucuya gitmez.
 */
export function ShareCardButtonV2({ score, strongest }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Exclude<ShareCardKind, "barber">>("score");
  const [format, setFormat] = useState<ShareCardFormat>("story");
  const [withPhoto, setWithPhoto] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pickPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (!res.canceled && res.assets[0]) setPhotoUri(res.assets[0].uri);
  }

  function buildSpec(): ShareCardSpec {
    const common = { format, audience: "personal" as const, appName: APP_NAME, url: env.apiUrl.replace(/^https?:\/\//, ""), disclaimer: t("disclaimer"), withPhoto: withPhoto && Boolean(photoUri) };
    if (kind === "strongest" && strongest) return { ...common, kind: "strongest", sub: strongest.sub, title: t("strongestTitle", { area: strongest.area }), line: strongest.line.slice(0, SHARE_RULES.maxLineChars) };
    return { ...common, kind: "score", overall: score.overall, potential: score.potential, subs: score.subs.slice(0, SHARE_RULES.maxSubs) };
  }

  async function create() {
    setBusy(true);
    try {
      const spec = buildSpec();
      if (shareSpecIssues(spec).length) {
        Alert.alert(t("invalid"));
        return;
      }
      const photo = spec.withPhoto && photoUri ? await loadSkiaImage(photoUri).catch(() => null) : null;
      if (spec.withPhoto && !photo) {
        Alert.alert(tv1("photoError"));
        return;
      }
      const b64 = renderShareSpecBase64(spec, photo);
      photo?.dispose();
      const r = await shareBase64Jpeg(b64, tv1("shareTitle"));
      track("share_card_created", { withPhoto: Boolean(photo), kind: spec.kind });
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
      <Button title={tv1("button")} variant="outline" onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View style={{ backgroundColor: colors.background, padding: spacing.lg, gap: spacing.sm, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}>
            <Text variant="heading" accessibilityRole="header">{t("title")}</Text>
            <OptionRow kind="radio" label={t("kinds.score")} hint={t("kindHint.score")} selected={kind === "score"} onPress={() => setKind("score")} />
            {strongest ? <OptionRow kind="radio" label={t("kinds.strongest")} hint={t("kindHint.strongest")} selected={kind === "strongest"} onPress={() => setKind("strongest")} /> : null}
            <OptionRow kind="radio" label={tv1("story")} selected={format === "story"} onPress={() => setFormat("story")} />
            <OptionRow kind="radio" label={tv1("square")} selected={format === "square"} onPress={() => setFormat("square")} />
            <SwitchRow label={t("photoToggle")} hint={t("photoHint")} value={withPhoto} onChange={setWithPhoto} />
            {withPhoto ? <Button title={photoUri ? tv1("changePhoto") : tv1("pickPhoto")} variant="outline" onPress={pickPhoto} /> : null}
            <Text variant="small">{t("deviceNote")}</Text>
            <Button title={t("create")} size="lg" busy={busy} disabled={withPhoto && !photoUri} onPress={create} />
            <Button title={tt("common.back")} variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}
