import { router } from "expo-router";
import { View } from "react-native";
import { SUB_KIND } from "@/lib/config/scoring";
import { SUB_KEYS, type SubKey } from "@/lib/config/teaser";
import type { ClientAnalysis } from "@/lib/score/present";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { FeedbackButtons } from "@/mobile/src/components/report/FeedbackButtons";
import { ShareCardButton } from "@/mobile/src/features/share/ShareCardButton";
import { usePaywall } from "@/mobile/src/features/paywall/PaywallSheet";
import { scoped } from "@/mobile/src/lib/i18n";
import { spacing, useTheme } from "@/mobile/src/theme";
import { fmt1, LockedValue } from "./LockedValue";

const t = scoped("analysis");
const tg = scoped("geometry");
/** SPEC 8.7: bu skorun altında ekran potansiyel ve plana odaklanır. */
const FOCUS_BELOW = 4.0;
type Observations = { skin?: string; hair?: string; brows?: string; facialHair?: string };

function observationFor(k: SubKey, obs: Observations): string | null {
  if (k === "skin") return obs.skin ?? null;
  if (k === "hair") return obs.hair ?? null;
  if (k === "eyes") return obs.brows ?? null;
  if (k === "grooming") return obs.facialHair ?? null;
  return null;
}

function orderSubs(a: ClientAnalysis, lowScore: boolean): SubKey[] {
  if (!lowScore) return [...SUB_KEYS];
  // Düşük skorda geliştirilebilir alanlar önce (SPEC 8.7)
  return [...SUB_KEYS].sort((x, y) => (SUB_KIND[x] === "modifiable" ? -1 : 0) - (SUB_KIND[y] === "modifiable" ? -1 : 0));
}

const pct = (v: number | null) => (v === null ? "–" : `%${Math.round(v * 100)}`);

/** Sonuç ekranı (F08 mobil). Kilitli değerler istemcide yoktur; dokununca paywall sheet açılır. */
export function ScoreView({ a, premium }: { a: ClientAnalysis; premium: boolean }) {
  const { colors } = useTheme();
  const { open } = usePaywall();
  const lockedTap = (trigger: string) => () => open(trigger);
  const overall = a.overall.locked ? null : a.overall.value;
  const potential = a.potential.locked ? null : a.potential.value;
  const obs = (a.observations.locked ? null : (a.observations.value as Observations | null)) ?? null;
  const metrics = a.metrics.locked ? null : a.metrics.value;
  const lowScore = overall !== null && overall < FOCUS_BELOW;

  const overallCard = (
    <Card title={t("overallTitle")} description={`${tg("faceShape")}: ${a.faceShape ? tg(`shapes.${a.faceShape}`) : "–"}${a.faceShapeDetail?.secondary ? ` (${tg("between", { other: tg(`shapes.${a.faceShapeDetail.secondary}`) })})` : ""}`}>
      <LockedValue v={a.overall} big onTap={lockedTap("overall")} aria={t("lockedAria")} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}>
        <Text>{t("potentialTitle")}:</Text>
        <LockedValue v={a.potential} onTap={lockedTap("potential")} aria={t("lockedAria")} />
        {overall !== null && potential !== null && potential > overall ? <Text variant="muted">↗ +{fmt1(potential - overall)}</Text> : null}
      </View>
      {overall !== null ? <Text variant="muted">{t("narrative", { overall: fmt1(overall), potential: potential !== null ? fmt1(potential) : "–" })}</Text> : null}
      <Text variant="small">{t("disclaimer")}</Text>
    </Card>
  );

  const subsCard = (
    <Card title={t("subscoresTitle")}>
      {orderSubs(a, lowScore).map((k) => {
        const s = a.subscores[k];
        const note = obs ? observationFor(k, obs) : null;
        return (
          <View key={k} style={{ gap: spacing.xs }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }}>
              <Text>
                {t(`sub.${k}`)} <Text variant="small">· {t(`kind.${SUB_KIND[k]}`)}</Text>
              </Text>
              <LockedValue v={s} onTap={lockedTap(`sub_${k}`)} aria={t("lockedAria")} />
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.muted }}>
              {!s.locked && s.value !== null ? <View style={{ width: `${s.value * 10}%`, height: 8, borderRadius: 4, backgroundColor: colors.foreground, opacity: 0.7 }} /> : null}
            </View>
            {note ? <Text variant="small">{note}</Text> : null}
          </View>
        );
      })}
    </Card>
  );

  const ratiosCard = (
    <Card title={t("ratiosTitle")}>
      {metrics ? (
        <View style={{ gap: spacing.xs }}>
          <Text><Text variant="muted">{tg("canthalTilt")}: </Text>{metrics.canthalTiltDeg > 2 ? tg("tilt.positive") : metrics.canthalTiltDeg < -2 ? tg("tilt.negative") : tg("tilt.neutral")}</Text>
          <Text><Text variant="muted">{tg("thirds")}: </Text>{pct(metrics.thirds.upper)} / {pct(metrics.thirds.middle)} / {pct(metrics.thirds.lower)}</Text>
          <Text><Text variant="muted">{tg("fwhr")}: </Text>{metrics.fwhr.toFixed(2)}</Text>
          <Text><Text variant="muted">{tg("jawRatio")}: </Text>{metrics.jawRatio.toFixed(2)}</Text>
          <Text variant="small">{tg("note")}</Text>
        </View>
      ) : (
        <Button title={t("locked.cta")} variant="outline" onPress={lockedTap("ratios")} />
      )}
    </Card>
  );

  const planCard = (
    <Card title={t("planTitle")} description={t("planBody")}>
      {premium ? (
        <View style={{ gap: spacing.sm }}>
          <Button title={t("seePlan")} onPress={() => router.push({ pathname: "/plan/[id]", params: { id: a.id } })} />
          <Button title={t("tryStyles")} variant="outline" onPress={() => router.push("/(tabs)/dene")} />
        </View>
      ) : (
        <Button title={t("locked.cta")} onPress={lockedTap("plan")} />
      )}
    </Card>
  );

  const shareCard =
    premium && overall !== null && potential !== null ? (
      <ShareCardButton overall={overall} potential={potential} subs={(["skin", "hair", "jawline"] as SubKey[]).map((k) => ({ label: t(`sub.${k}`), value: (a.subscores[k].locked ? null : a.subscores[k].value) ?? 0 }))} />
    ) : null;
  const feedback = a.status === "completed" ? <FeedbackButtons targetType="score" targetId={a.id} /> : null;

  return (
    <View style={{ gap: spacing.md }}>
      {lowScore ? (
        <>
          {planCard}
          {overallCard}
          {subsCard}
          {ratiosCard}
        </>
      ) : (
        <>
          {overallCard}
          {subsCard}
          {ratiosCard}
          {planCard}
        </>
      )}
      {shareCard}
      {feedback}
    </View>
  );
}
