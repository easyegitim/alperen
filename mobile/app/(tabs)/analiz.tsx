import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import type { ClientAnalysisSummary } from "@/lib/score/present";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("analysis");
const tg = scoped("geometry");
const fmt = (n: number | null) => (n === null ? "●,●" : n.toLocaleString("tr-TR", { minimumFractionDigits: 1 }));

/** /analiz: geçmiş listesi (GET /api/analyses). Trend grafiği M5'te. */
export default function AnalysesTab() {
  const { colors } = useTheme();
  const { api } = useSession();
  const [items, setItems] = useState<ClientAnalysisSummary[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void api
        .get<ClientAnalysisSummary[]>("/api/analyses")
        .then((r) => {
          if (active) setItems(r ?? []);
        })
        .catch(() => {
          if (active) setItems([]);
        });
      return () => {
        active = false;
      };
    }, [api]),
  );

  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text variant="title" accessibilityRole="header">{t("listTitle")}</Text>
        <Button title={t("newAnalysis")} onPress={() => router.push("/tara")} />
      </View>
      {items === null ? <Text variant="muted">…</Text> : null}
      {items && items.length === 0 ? (
        <Card title={t("emptyTitle")} description={t("emptyBody")}>
          <Button title={t("newAnalysis")} onPress={() => router.push("/tara")} />
        </Card>
      ) : null}
      {items?.map((a) => (
        <Pressable
          key={a.id}
          accessibilityRole="button"
          onPress={() => router.push(`/analiz/${a.id}`)}
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}
        >
          <View>
            <Text>{new Date(a.createdAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}</Text>
            <Text variant="small">{a.faceShape ? tg(`shapes.${a.faceShape}`) : a.status}</Text>
          </View>
          <Text variant="heading">{a.status === "completed" ? fmt(a.overall) : "…"}</Text>
        </Pressable>
      ))}
    </Screen>
  );
}
