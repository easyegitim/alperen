import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Image, Pressable, TextInput, View } from "react-native";
import { ENTITLEMENTS } from "@/lib/config/plans";
import type { ClientAnalysisSummary } from "@/lib/score/present";
import { ScoreTrend } from "@/mobile/src/components/analysis/ScoreTrend";
import { ScoreChangeNote } from "@/mobile/src/components/progress/ScoreChangeNote";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { trendPointsFromSummaries } from "@/mobile/src/features/progress/change";
import { scoped } from "@/mobile/src/lib/i18n";
import { deleteProgressPhoto, listProgressPhotos, updateProgressNote, type ProgressPhoto } from "@/mobile/src/lib/progressStore";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("progress");
type Status = { premium: boolean };

/**
 * /ilerleme (F13 mobil → Faz 6; CONTRACTS_V2 S3.3.3): cihazdaki fotoğraflar (sanal alan, ağ yok; hayalet kılavuz da dizinde kalır),
 * yan yana karşılaştırma, skor trendi (premium) + ±gürültü bandı "Değişim yok" notu (kıyas yalnız kendi geçmişiyle), yeni hak kartı.
 */
export default function ProgressTab() {
  const { colors } = useTheme();
  const { api } = useSession();
  const [photos, setPhotos] = useState<ProgressPhoto[] | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [premium, setPremium] = useState(false);
  const [points, setPoints] = useState<ClientAnalysisSummary[]>([]);
  const [newSlot, setNewSlot] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void listProgressPhotos().then((p) => active && setPhotos(p)).catch(() => active && setPhotos([]));
      void Promise.all([api.get<Status>("/api/billing/status").catch(() => null), api.get<ClientAnalysisSummary[]>("/api/analyses").catch(() => [])]).then(([st, list]) => {
        if (!active) return;
        setPremium(Boolean(st?.premium));
        setPoints(list ?? []);
        const done = (list ?? []).filter((p) => p.status === "completed");
        setNewSlot(Boolean(st?.premium) && (done.length === 0 || Date.now() - new Date(done[0].createdAt).getTime() >= ENTITLEMENTS.premium.windowDays * 86_400_000));
      });
      return () => {
        active = false;
      };
    }, [api]),
  );

  const trend = trendPointsFromSummaries(points);
  const a = photos?.find((p) => p.id === pick[0]);
  const b = photos?.find((p) => p.id === pick[1]);

  async function remove(id: string) {
    await deleteProgressPhoto(id);
    setPhotos((p) => (p ?? []).filter((x) => x.id !== id));
    setPick((p) => p.filter((x) => x !== id));
  }

  return (
    <Screen>
      {newSlot ? (
        <Card title={t("newSlotTitle")} description={t("newSlotBody")}>
          <Button title={t("newAnalysis")} onPress={() => router.push("/tara")} />
        </Card>
      ) : null}
      {premium ? (
        <Card>
          <ScoreTrend points={trend} />
          <ScoreChangeNote points={trend} />
        </Card>
      ) : (
        <Card title={t("trendLockedTitle")} description={t("trendLockedBody")}>
          <Button title={t("goPremium")} variant="outline" onPress={() => router.push("/premium")} />
        </Card>
      )}
      <Text variant="small">{t("deviceNote")}</Text>
      {photos === null ? <Text variant="muted">{t("loading")}</Text> : null}
      {photos && photos.length === 0 ? <Card title={t("emptyTitle")} description={t("emptyBody")} /> : null}
      {a && b ? (
        <Card title={t("compareTitle")} description={`${new Date(a.takenAt).toLocaleDateString("tr-TR")} → ${new Date(b.takenAt).toLocaleDateString("tr-TR")}`}>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Image source={{ uri: a.uri }} style={{ flex: 1, aspectRatio: 3 / 4, borderRadius: radius.md }} accessibilityLabel={new Date(a.takenAt).toLocaleDateString("tr-TR")} />
            <Image source={{ uri: b.uri }} style={{ flex: 1, aspectRatio: 3 / 4, borderRadius: radius.md }} accessibilityLabel={new Date(b.takenAt).toLocaleDateString("tr-TR")} />
          </View>
          <Button title={t("clearCompare")} variant="ghost" onPress={() => setPick([])} />
        </Card>
      ) : photos && photos.length >= 2 ? (
        <Text variant="muted">{t("pickTwo", { n: pick.length })}</Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {photos?.map((p) => {
          const selected = pick.includes(p.id);
          return (
            <View key={p.id} style={{ width: "48%", borderWidth: selected ? 2 : 1, borderColor: selected ? colors.foreground : colors.border, borderRadius: radius.md, overflow: "hidden" }}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setPick((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur.slice(-1), p.id]))}>
                <Image source={{ uri: p.uri }} style={{ width: "100%", aspectRatio: 3 / 4 }} />
              </Pressable>
              <View style={{ padding: spacing.xs, gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text variant="small">{new Date(p.takenAt).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={t("delete")} onPress={() => void remove(p.id)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                  </Pressable>
                </View>
                <TextInput
                  defaultValue={p.note ?? ""}
                  placeholder={t("notePlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
                  maxLength={120}
                  accessibilityLabel={t("notePlaceholder")}
                  onEndEditing={(e) => void updateProgressNote(p.id, e.nativeEvent.text).catch(() => Alert.alert(t("saveError")))}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4, color: colors.foreground, fontSize: 12 }}
                />
              </View>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}
