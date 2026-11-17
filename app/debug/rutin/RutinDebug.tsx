"use client";

import { ScoreTrend, type TrendPoint } from "@/components/analysis/ScoreTrend";
import { StreakCard } from "@/components/routine/StreakCard";
import { Card, CardContent } from "@/components/ui/card";
import { ROUTINE_FORGIVING } from "@/lib/config/routine";
import { NOISE_BAND } from "@/lib/config/scoring";
import { recentDays } from "@/lib/routine/calendar";
import { canUseFreeze, computeForgivingStreak, restDaysLeftThisWeek, type FreezeRecord } from "@/lib/routine/forgiving";
import { addDays, type DayLog } from "@/lib/routine/streak";

export type RutinDebugState = "rest" | "frozen" | "missed" | "limit";
export type ProgressDebugState = "same" | "up" | "down" | "calib";

const ITEMS = ["a", "b", "c", "d", "e"];
const TODAY = "2026-11-04";
const logsFor = (days: string[]): DayLog[] => days.flatMap((d) => ITEMS.map((item_id) => ({ log_date: d, item_id, done: true })));

/** Sabit veri: dinlenme köprüsü / dondurulmuş gün / kırılmış seri / dondurma hakkı bitmiş. Supabase, kullanıcı yok. */
function fixture(state: RutinDebugState): { logs: DayLog[]; freezes: FreezeRecord[] } {
  const back = (n: number) => addDays(TODAY, -n);
  switch (state) {
    case "rest":
      return { logs: logsFor([back(1), back(3), back(4), back(5), back(6), back(7), back(8)]), freezes: [] }; // dün yapıldı, 2 gün önce dinlenme
    case "frozen":
      return { logs: logsFor([back(1), back(2), back(3), back(5), back(6)]), freezes: [{ date: TODAY }, { date: back(4) }] };
    case "missed":
      return { logs: logsFor([back(1), back(5)]), freezes: [] }; // 2 gün önce dinlenme, 3 ve 4 gün önce yapılmadı → kırık
    case "limit":
      return { logs: logsFor([back(1), back(2), back(3)]), freezes: [{ date: back(2) }] };
  }
}

export function RutinDebug({ state }: { state: RutinDebugState }) {
  const { logs, freezes } = fixture(state);
  const cfg = ROUTINE_FORGIVING;
  const input = { logs, activeItemCount: ITEMS.length, today: TODAY, freezes, config: cfg };
  const streak = computeForgivingStreak(input);
  return (
    <StreakCard
      dateLabel="4 Kasım"
      pct={state === "frozen" ? 0 : 40}
      doneCount={state === "frozen" ? 0 : 2}
      total={ITEMS.length}
      streak={streak}
      restLeft={restDaysLeftThisWeek(input)}
      config={cfg}
      days={recentDays({ ...input, days: 7 })}
      freeze={{ available: true, check: canUseFreeze(freezes, TODAY, TODAY, cfg), busy: false, onFreeze: () => {} }}
    />
  );
}

export function IlerlemeDebug({ state }: { state: ProgressDebugState }) {
  const base: TrendPoint[] = [
    { id: "a", date: "2026-09-02", overall: 5.9, potential: 7.0, calibrationVersion: "h2-1" },
    { id: "b", date: "2026-10-03", overall: 6.2, potential: 7.2, calibrationVersion: "h2-1" },
  ];
  const last: TrendPoint = { id: "c", date: "2026-11-04", overall: state === "up" ? 6.7 : state === "down" ? 5.7 : 6.4, potential: 7.3, calibrationVersion: state === "calib" ? "h2-2" : "h2-1" };
  return (
    <Card>
      <CardContent>
        <ScoreTrend points={[...base, last]} band={NOISE_BAND} />
      </CardContent>
    </Card>
  );
}
