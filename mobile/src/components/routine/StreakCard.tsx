import { View } from "react-native";
import type { RoutineForgivingConfig } from "@/lib/config/routine";
import type { DayStatus, ForgivingStreak, FreezeCheck } from "@/lib/routine/forgiving";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import type { CalendarDay } from "@/mobile/src/features/routine/forgivingView";
import { scoped } from "@/mobile/src/lib/i18n";
import { spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("routine");
const tv = scoped("routine.v2");

export type StreakCardProps = {
  dateLabel: string;
  pct: number;
  doneCount: number;
  total: number;
  streak: ForgivingStreak;
  restLeft: number;
  config: RoutineForgivingConfig & { placeholder?: boolean };
  /** Son 7 gün (en eski önce). */
  days: CalendarDay[];
  /** Dondurma (routine_freezes): tablo yoksa available=false → bölüm gizlenir, seri yine affedici hesaplanır. */
  freeze: { available: boolean; check: FreezeCheck; busy: boolean; onFreeze: () => void };
};

const DAY_GLYPH: Record<DayStatus, string> = { done: "✓", rest: "☾", frozen: "❄", missed: "", pending: "" };
const WEEKDAY = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("tr-TR", { weekday: "short", timeZone: "UTC" });

/**
 * Seri kartı (F12 → Faz 6 affedici seri, PLAN [ÖNERİ]; web StreakCard eşi): yapılan günler sayılır; dinlenme (haftada n)
 * ve dondurma (ayda m, kullanıcı eylemi) seriyi köprüler, saymaz. Sayılar yer tutucuysa "öneri aşamasında" notu.
 */
export function StreakCard({ dateLabel, pct, doneCount, total, streak, restLeft, config, days, freeze }: StreakCardProps) {
  const { colors } = useTheme();
  const bridged = streak.restDaysBridged + streak.freezesBridged;
  const todayFrozen = streak.today === "frozen";
  const dayStyle = (s: DayStatus) =>
    s === "done" ? { backgroundColor: colors.brand, color: colors.primaryForeground } : s === "rest" ? { backgroundColor: colors.brandSoft, color: colors.brand } : s === "frozen" ? { backgroundColor: colors.muted, color: colors.info } : { backgroundColor: "transparent", color: colors.mutedForeground };
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text>{t("today", { date: dateLabel })}</Text>
        <Text style={{ fontWeight: "700" }}>🔥 {t("streak", { n: streak.streak })}</Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityLabel={t("progressAria")} accessibilityValue={{ min: 0, max: 100, now: pct }} style={{ height: 6, borderRadius: 3, backgroundColor: colors.track }}>
        <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: colors.brand }} />
      </View>
      <Text variant="small">{t("doneCount", { done: doneCount, total })}</Text>

      <View style={{ flexDirection: "row", justifyContent: "space-between" }} accessibilityLabel={tv("weekAria")}>
        {days.map((d) => {
          const st = dayStyle(d.status);
          return (
            <View key={d.date} style={{ alignItems: "center", gap: 2 }} accessible accessibilityLabel={tv("dayAria", { day: WEEKDAY(d.date), status: tv(`days.${d.status}`) })}>
              <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: st.backgroundColor, borderWidth: d.status === "missed" || d.status === "pending" ? 1 : 0, borderStyle: d.status === "missed" ? "dashed" : "solid", borderColor: colors.border }}>
                <Text style={{ color: st.color, fontWeight: "700", fontSize: 14 }}>{DAY_GLYPH[d.status]}</Text>
              </View>
              <Text variant="small" style={{ fontSize: 10 }}>{WEEKDAY(d.date)}</Text>
            </View>
          );
        })}
      </View>

      <View style={{ gap: 4 }}>
        {todayFrozen ? <Text variant="small" style={{ color: colors.info, fontWeight: "600" }} accessibilityLiveRegion="polite">❄ {tv("freezeDone")}</Text> : null}
        <Text variant="small">☾ {restLeft > 0 ? tv("restDaysLeft", { n: restLeft }) : tv("restDaysNone")}</Text>
        <Text variant="small">{tv("restDayHint", { n: config.restDaysPerWeek })}</Text>
        {bridged > 0 ? <Text variant="small">{tv("bridgedNote", { rest: streak.restDaysBridged, freeze: streak.freezesBridged })} {tv("streakKept")}</Text> : null}
      </View>

      {freeze.available && config.freezesPerMonth > 0 ? (
        <View style={{ gap: spacing.xs }}>
          {!todayFrozen ? <Button title={`❄ ${tv("freeze")}`} variant="outline" busy={freeze.busy} disabled={!freeze.check.ok || streak.today === "done"} onPress={freeze.onFreeze} /> : null}
          <Text variant="small">{!freeze.check.ok && !todayFrozen ? tv(`errors.${freeze.check.reason}`) : tv("freezeHint", { n: config.freezesPerMonth })}</Text>
        </View>
      ) : null}
      {config.placeholder ? <Text variant="small">{tv("placeholderNote")}</Text> : null}
      <Text variant="small">{t("streakHint")}</Text>
    </Card>
  );
}
