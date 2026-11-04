import { useMemo, useState } from "react";
import { Image, PanResponder, View } from "react-native";
import type { QcVerdict, TryonMode } from "@/lib/tryon/types";
import { FeedbackButtons } from "@/mobile/src/components/report/FeedbackButtons";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped, t as tt } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("tryon");

export type TryonResultView = {
  eventId: string;
  mode: TryonMode;
  title: string;
  beforeUri: string;
  afterUri: string;
  /** Göz hizası (0–1): önce/sonra kaydırıcısında kılavuz çizgi (KB §7.2); glow-up dışında null. */
  eyeLineY: number | null;
  appliedSteps: { id: string; title: string }[];
  qc: QcVerdict | null;
  regenCount: number;
};

/** Önce/sonra karşılaştırma: sürüklenebilir ayraç; görseller yalnız cihaz önbelleği; etiket her zaman görünür (K16). */
export function BeforeAfter({ beforeUri, afterUri, name, eyeLineY }: { beforeUri: string; afterUri: string; name: string; eyeLineY: number | null }) {
  const [width, setWidth] = useState(0);
  const [slider, setSlider] = useState(50);
  const update = (v: number) => setSlider(Math.min(100, Math.max(0, v)));
  // Genişlik değişince yeniden kurulur (ref yok: React saflık kuralı).
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          if (width > 0) setSlider(Math.min(100, Math.max(0, (e.nativeEvent.locationX / width) * 100)));
        },
        onPanResponderMove: (e) => {
          if (width > 0) setSlider(Math.min(100, Math.max(0, (e.nativeEvent.locationX / width) * 100)));
        },
      }),
    [width],
  );
  const pill = { position: "absolute" as const, backgroundColor: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 11, fontWeight: "600" as const, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full };
  return (
    <View style={{ gap: spacing.sm }}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: "100%", aspectRatio: 1, borderRadius: 24, overflow: "hidden", backgroundColor: "#000" }} {...pan.panHandlers} accessible accessibilityLabel={eyeLineY !== null ? t("v2.glowUp.sliderEyes") : t("sliderAria")} accessibilityRole="adjustable" accessibilityValue={{ min: 0, max: 100, now: Math.round(slider) }} accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={(e) => update(slider + (e.nativeEvent.actionName === "increment" ? 10 : -10))}>
        <Image source={{ uri: afterUri }} style={{ position: "absolute", width: "100%", height: "100%" }} accessibilityLabel={t("afterAlt")} />
        <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${slider}%`, overflow: "hidden" }}>
          <Image source={{ uri: beforeUri }} style={{ width, height: "100%" }} accessibilityLabel={t("beforeAlt")} />
        </View>
        {eyeLineY !== null ? (
          <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: `${eyeLineY * 100}%`, borderTopWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.6)" }}>
            <Text style={{ position: "absolute", right: 8, top: -16, color: "#fff", fontSize: 9, backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 4, borderRadius: 4 }}>{t("v2.glowUp.eyeLine")}</Text>
          </View>
        ) : null}
        <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: `${slider}%`, width: 2, marginLeft: -1, backgroundColor: "rgba(255,255,255,0.9)" }}>
          <View style={{ position: "absolute", top: "50%", left: -17, width: 36, height: 36, marginTop: -18, borderRadius: 18, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#000", fontWeight: "700" }}>⇔</Text>
          </View>
        </View>
        <Text style={{ ...pill, top: 12, left: 12 }}>{t("before")}</Text>
        <Text style={{ ...pill, top: 12, right: 12 }}>{t("after")}</Text>
        <Text style={{ ...pill, right: 12, bottom: 12, fontWeight: "500" }}>{tt("common.aiGenerated")}</Text>
      </View>
      <View style={{ alignItems: "center" }}>
        <Text variant="heading">{name}</Text>
        <Text variant="small">{t("sliderHint")}</Text>
      </View>
    </View>
  );
}

type Props = { result: TryonResultView; onShare: () => void; onFlag: () => void; flagged: boolean; onBack: () => void; sharing?: boolean };

/** Deneme sonucu (PLAN 5d/5e): gözlere hizalı önce/sonra, uygulanan adımlar, paylaş (etiket gömülü), "Bozuk görünüyor". */
export function TryonResult({ result, onShare, onFlag, flagged, onBack, sharing }: Props) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <BeforeAfter beforeUri={result.beforeUri} afterUri={result.afterUri} name={result.title} eyeLineY={result.eyeLineY} />
      {result.mode === "glow_up" ? (
        <Card title={t("v2.glowUp.applied")}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {result.appliedSteps.map((s) => (
              <Text key={s.id} style={{ backgroundColor: colors.brandSoft, color: colors.brand, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4, fontSize: 12, fontWeight: "500" }}>{s.title}</Text>
            ))}
          </View>
          <Text variant="small">{t("v2.glowUp.skinNote")}</Text>
        </Card>
      ) : null}
      {result.qc ? (
        <Text variant="small">
          {t("v2.result.qcPassed")}
          {result.regenCount > 0 ? ` · ${t("v2.result.qcRegen", { n: result.regenCount })}` : ""}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button title={t("v2.share")} variant="outline" size="lg" style={{ flex: 1 }} busy={sharing} onPress={onShare} />
        <Button title={t("v2.result.tryAnother")} size="lg" style={{ flex: 1 }} onPress={onBack} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
        <FeedbackButtons targetType="tryon" targetId={result.eventId} />
        <Button title={flagged ? t("v2.flagged") : t("v2.flagBroken")} variant="ghost" accessibilityLabel={t("v2.flagBrokenAria")} disabled={flagged} onPress={onFlag} />
      </View>
      <Text variant="small">
        {t("v2.faceKept")} {t("v2.result.labelBurned")} {t("resultNote")}
      </Text>
    </View>
  );
}
