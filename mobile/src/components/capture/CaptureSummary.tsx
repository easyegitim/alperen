import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import { qualitySummary } from "@/lib/face/quality";
import type { GeometryResult } from "@/lib/face/types";
import { PROFILE_VIEWS, VIEWS, type ViewKey } from "@/lib/face/views";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { SwitchRow } from "@/mobile/src/components/ui/SwitchRow";
import { Text } from "@/mobile/src/components/ui/Text";
import { addableViews, hasProfile, type CaptureSet } from "@/mobile/src/features/capture/views";
import type { CaptureResult } from "@/mobile/src/features/capture/result";
import { scoped, t } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const tv = scoped("camera.views");
const tc = scoped("camera.captured");
const ta = scoped("analysis");
const tg = scoped("geometry");

type Props = {
  captures: CaptureSet<CaptureResult>;
  geometry: GeometryResult | null;
  resume: boolean;
  error: { code: string; retryAt?: string } | null;
  saveProgress: boolean;
  onSaveProgress: (v: boolean) => void;
  onRemove: (view: ViewKey) => void;
  onAdd: (view: ViewKey, required: boolean) => void;
  onRetake: () => void;
  onStart: () => void;
  startDisabled: boolean;
};

/** Özet (web CaptureScreen özeti): çekilen açılar, isteğe bağlı ekleme, kalite çipleri, yüz şekli ön değerlendirmesi, "Analizi başlat". */
export function CaptureSummary({ captures, geometry, resume, error, saveProgress, onSaveProgress, onRemove, onAdd, onRetake, onStart, startDisabled }: Props) {
  const { colors } = useTheme();
  const [optionalOpen, setOptionalOpen] = useState(false);
  const front = captures.front ?? null;
  const profileMissing = !hasProfile(captures);
  const taken = VIEWS.filter((v) => captures[v.key]);
  const addable = addableViews(captures);
  const quality = front ? qualitySummary(front.report.measures) : null;
  const isProfile = (v: ViewKey) => (PROFILE_VIEWS as readonly ViewKey[]).includes(v);
  const errText = error ? (ta(`errors.${error.code}`) === `analysis.errors.${error.code}` ? ta("errors.GENERIC") : ta(`errors.${error.code}`)) : null;

  return (
    <Card title={tv("done")} description={tc(profileMissing ? "leadV2Profile" : "leadV2")}>
      {profileMissing ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.md }} accessibilityRole="text">
          <Ionicons name="warning-outline" size={18} color={colors.warn} />
          <Text variant="small" style={{ flex: 1 }}>{tv("profileRequiredNote")}</Text>
          <Button title={tv("captureProfile")} onPress={() => onAdd("profile_left", true)} />
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }} accessibilityLabel={tv("takenAria")}>
        {taken.map((v) => {
          const c = captures[v.key]!;
          return (
            <View key={v.key} style={{ width: "30%", gap: 4 }}>
              <View style={{ aspectRatio: 1, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted }}>
                <Image source={{ uri: c.image.uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors accessibilityLabel={tv(`${v.key}.name`)} />
                <View style={{ position: "absolute", right: 4, bottom: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.success, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="checkmark" size={12} color="#fff" />
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={tv("removeAria", { name: tv(`${v.key}.name`) })} onPress={() => onRemove(v.key)} hitSlop={8} style={{ position: "absolute", left: 4, top: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }}>
                  <Ionicons name="close" size={14} color={colors.mutedForeground} />
                </Pressable>
              </View>
              <Text variant="small" style={{ textAlign: "center" }} numberOfLines={1}>{tv(`${v.key}.name`)}</Text>
            </View>
          );
        })}
        {addable.length > 0 ? (
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: optionalOpen }} onPress={() => setOptionalOpen((o) => !o)} style={{ width: "30%", aspectRatio: 1, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, alignItems: "center", justifyContent: "center", gap: 4, padding: 4 }}>
            <Ionicons name="add" size={22} color={colors.brand} />
            <Text variant="small" style={{ color: colors.brand, textAlign: "center", fontWeight: "600" }}>{tv("addOptional")}</Text>
          </Pressable>
        ) : null}
      </View>
      {optionalOpen && addable.length > 0 ? (
        <View style={{ gap: spacing.xs, padding: spacing.xs, borderRadius: radius.md, backgroundColor: colors.muted }}>
          {addable.map((v) => (
            <Pressable
              key={v}
              accessibilityRole="button"
              onPress={() => {
                setOptionalOpen(false);
                onAdd(v, profileMissing && isProfile(v));
              }}
              style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingHorizontal: spacing.sm }}
            >
              <Text style={{ fontWeight: "600" }}>{tv(`${v}.name`)}</Text>
              <Text variant="small">{profileMissing && isProfile(v) ? tv("requiredLabel") : tv(`${v}.optionalNote`) === `camera.views.${v}.optionalNote` ? tv("optionalLabel") : tv(`${v}.optionalNote`)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {quality ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }} accessibilityLabel={tc("qualityAria")}>
          {(["light", "sharpness", "framing"] as const).map((k) => (
            <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 26, borderRadius: radius.full, backgroundColor: colors.muted }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: quality[k] === "good" ? colors.success : colors.warn }} />
              <Text variant="small">{tc(`quality.${k}.${quality[k]}`)}</Text>
            </View>
          ))}
          {front?.source === "gallery" ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 26, borderRadius: radius.full, backgroundColor: colors.muted }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.info }} />
              <Text variant="small">{tc("fromGallery")}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {geometry ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.muted }}>
          <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="scan-outline" size={20} color={colors.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="small">{tg("faceShapePrelim")}</Text>
            <Text variant="heading">{tg(`shapes.${geometry.faceShape.primary}`)}</Text>
            {geometry.faceShape.secondary ? <Text variant="small">{tg("nearTo", { other: tg(`shapes.${geometry.faceShape.secondary}`) })}</Text> : null}
          </View>
        </View>
      ) : (
        <Text variant="small" accessibilityLiveRegion="polite">{tg("computing")}</Text>
      )}
      <SwitchRow label={tc("saveProgress")} hint={tc("saveProgressHint")} value={saveProgress} onChange={onSaveProgress} />
      {resume ? (
        <View style={{ flexDirection: "row", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brandSoft }}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.brand} />
          <Text variant="small" style={{ flex: 1, color: colors.foreground }}>{tc("resumeNote")}</Text>
        </View>
      ) : null}
      {errText ? (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {errText}
          {error?.retryAt ? ` ${ta("retryAt", { date: new Date(error.retryAt).toLocaleString("tr-TR") })}` : ""}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button title={tc("retake")} variant="outline" size="lg" style={{ flex: 1 }} onPress={onRetake} />
        <Button title={resume ? tc("resumeStart") : ta("start")} size="lg" style={{ flex: 1.4 }} disabled={startDisabled} onPress={onStart} />
      </View>
      <View style={{ flexDirection: "row", gap: spacing.xs }}>
        <Ionicons name="shield-checkmark-outline" size={14} color={colors.brand} />
        <Text variant="small" style={{ flex: 1 }}>{tc("sendNoteV2")}</Text>
      </View>
      <Text variant="small">{t("common.photoNotStored")}</Text>
    </Card>
  );
}
