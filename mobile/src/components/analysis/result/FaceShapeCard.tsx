import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import type { FaceShape } from "@/lib/face/types";
import type { FaceShapeV2 } from "@/lib/score/contract";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const SHAPES: FaceShape[] = ["oval", "round", "square", "long", "heart", "diamond"];
const tg = scoped("geometry");
const tf = scoped("analysis.faceShapeV2");
const tr = scoped("analysis.result.faceShape");

/**
 * Yüz şekli (KB §4.10, Ç8): ön değerlendirme (cihaz) ve detaylı sonuç (çoklu açı) birlikte; ayrışırsa "emin değiliz"
 * ve neden. "Bence değil" → PATCH /api/me/face-shape; kullanıcının seçimi geçerli olur; hiçbir sonuç silinmez.
 */
export function FaceShapeCard({ faceShape, detailedReady }: { faceShape: FaceShapeV2 | null; detailedReady: boolean }) {
  const { colors } = useTheme();
  const { aura } = useSession();
  const [override, setOverride] = useState<FaceShape | null>(faceShape?.override ?? null);
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState<FaceShape>(override ?? faceShape?.prelim.primary ?? "oval");
  const [busy, setBusy] = useState(false);
  if (!faceShape) return null;
  const label = (s: FaceShape, secondary?: FaceShape) => (secondary ? `${tg(`shapes.${s}`)}, ${tg("between", { other: tg(`shapes.${secondary}`) })}` : tg(`shapes.${s}`));

  async function save(next: FaceShape | null) {
    setBusy(true);
    try {
      await aura.me.faceShape(next);
      setOverride(next);
      setPicking(false);
      Alert.alert(tr("saved"));
    } catch {
      Alert.alert(tr("error"));
    } finally {
      setBusy(false);
    }
  }

  const detailed = detailedReady ? faceShape.detailed : undefined;
  const box = { flex: 1, backgroundColor: colors.muted, borderRadius: radius.lg, padding: spacing.sm, gap: 4 } as const;
  return (
    <Card title={tr("title")}>
      {detailed ? <Text variant="small" style={{ color: faceShape.agree ? colors.success : colors.mutedForeground, fontWeight: "600" }}>{faceShape.agree ? `✓ ${tf("agree")}` : `? ${tf("unsure")}`}</Text> : null}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <View style={box}>
          <Text variant="small">{tr("prelimLabel")}</Text>
          <Text style={{ fontWeight: "600" }}>{label(faceShape.prelim.primary, faceShape.prelim.secondary)}</Text>
        </View>
        <View style={box}>
          <Text variant="small">{tr("detailedLabel")}</Text>
          <Text style={{ fontWeight: "600" }}>{detailed ? label(detailed.shape, detailed.secondary) : detailedReady ? "–" : "…"}</Text>
        </View>
      </View>
      {detailed && !faceShape.agree ? (
        <Text style={{ fontSize: 13, lineHeight: 19 }}>
          <Text style={{ fontWeight: "600", fontSize: 13 }}>{tr("reasonLabel")}: </Text>
          {detailed.reason}
        </Text>
      ) : null}
      {override ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.lg, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
          <Text style={{ fontSize: 13 }}>
            <Text style={{ fontWeight: "600", fontSize: 13 }}>{tr("overrideLabel")}: </Text>
            {tg(`shapes.${override}`)}
          </Text>
          <Button title={tr("remove")} variant="ghost" disabled={busy} onPress={() => void save(null)} />
        </View>
      ) : null}
      {picking ? (
        <View style={{ gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.sm }}>
          <Text style={{ fontWeight: "600" }}>{tr("pickTitle")}</Text>
          <Text variant="small">{tr("pickBody")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }} accessibilityRole="radiogroup">
            {SHAPES.map((s) => (
              <Pressable
                key={s}
                accessibilityRole="radio"
                accessibilityState={{ checked: choice === s }}
                accessibilityLabel={tr("shapeAria", { shape: tg(`shapes.${s}`) })}
                onPress={() => setChoice(s)}
                style={{ width: "30%", minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.lg, borderWidth: 1, borderColor: choice === s ? colors.brand : colors.border, backgroundColor: choice === s ? colors.brandSoft : colors.card }}
              >
                <Text style={{ fontWeight: "500" }}>{tg(`shapes.${s}`)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button title={tr("cancel")} variant="outline" style={{ flex: 1 }} disabled={busy} onPress={() => setPicking(false)} />
            <Button title={tr("save")} style={{ flex: 1 }} busy={busy} onPress={() => void save(choice)} />
          </View>
        </View>
      ) : (
        <Button title={tf("notMe")} variant="outline" onPress={() => setPicking(true)} />
      )}
      <Text variant="small">{tf("overrideNote")}</Text>
    </Card>
  );
}
