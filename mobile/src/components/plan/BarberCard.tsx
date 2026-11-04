import { useState } from "react";
import { Alert, Modal, View } from "react-native";
import { track } from "@/lib/analytics";
import type { BarberSpec } from "@/lib/coach/planTypes";
import { APP_NAME } from "@/lib/config/app";
import { shareSpecIssues, type BarberShareSpec } from "@/lib/share/spec";
import { Button } from "@/mobile/src/components/ui/Button";
import { Text } from "@/mobile/src/components/ui/Text";
import { renderShareSpecBase64, shareBase64Jpeg } from "@/mobile/src/features/share/renderCard";
import { env } from "@/mobile/src/lib/env";
import { scoped, t as tt } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("plan.v2.barber");
const ts = scoped("share.v2");

/** Berber kartı satırları (yanlar, üst, sakal hattı); paylaşım spec'i de aynı satırları kullanır. */
export function barberLines(spec: BarberSpec): string[] {
  const rows: string[] = [];
  if (spec.sidesGuard) rows.push(t("sides", { guard: spec.sidesGuard }));
  if (spec.topLengthCm !== undefined) rows.push(t("top", { cm: spec.topLengthCm.toLocaleString("tr-TR") }));
  if (spec.beardLine) rows.push(t("beardLine", { line: spec.beardLine }));
  return rows;
}

/**
 * "Berbere göster" (KB §8 ONAYLI ÖNERİ R2-Ö2): stil adı, yanlar kaç numara, üst kaç cm, sakal hattı; büyük punto.
 * Faz 6: kart paylaşılır (BarberShareSpec; fotoğrafsız, S2.14 #27); açılış barber_card_opened (yüksüz). Cihazda üretilir.
 */
export function BarberCard({ spec, presetIds = {} }: { spec: BarberSpec; presetIds?: { hair?: string; beard?: string } }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = barberLines(spec);

  async function share() {
    setBusy(true);
    try {
      const card: BarberShareSpec = { kind: "barber", format: "square", audience: "personal", appName: APP_NAME, url: env.apiUrl.replace(/^https?:\/\//, ""), disclaimer: ts("disclaimer"), withPhoto: false, barber: spec, presetIds, lines: rows };
      if (shareSpecIssues(card).length) {
        Alert.alert(ts("invalid"));
        return;
      }
      const b64 = renderShareSpecBase64(card, null);
      track("share_card_created", { withPhoto: false, kind: "barber" });
      const r = await shareBase64Jpeg(b64, spec.styleName);
      Alert.alert(r === "shared" ? ts("shared") : ts("error"));
    } catch {
      Alert.alert(ts("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        title={t("share")}
        variant="ghost"
        onPress={() => {
          track("barber_card_opened");
          setOpen(true);
        }}
      />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: "rgba(0,0,0,0.5)" }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm }}>
            <Text variant="title" accessibilityRole="header">{spec.styleName}</Text>
            <Text variant="muted">{t("title")}</Text>
            <View style={{ backgroundColor: colors.muted, borderRadius: radius.lg, padding: spacing.md, gap: 6 }}>
              {rows.map((r) => (
                <Text key={r} style={{ fontSize: 20, lineHeight: 30 }}>{r}</Text>
              ))}
            </View>
            {spec.notes ? (
              <Text style={{ fontSize: 13, lineHeight: 19 }}>
                <Text style={{ fontWeight: "600", fontSize: 13 }}>{t("notes")}:</Text> {spec.notes}
              </Text>
            ) : null}
            <Button title={ts("barberButton")} variant="outline" busy={busy} onPress={() => void share()} />
            <Text variant="small" style={{ textAlign: "center" }}>{ts("barberNoPhoto")} {ts("deviceNote")}</Text>
            <Button title={tt("common.back")} variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}
