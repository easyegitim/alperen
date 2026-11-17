"use client";

import { Check, Flame, Moon, Snowflake, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScoreRing } from "@/components/analysis/ScoreRing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { RoutineForgivingConfig } from "@/lib/config/routine";
import type { CalendarDay } from "@/lib/routine/calendar";
import type { DayStatus, ForgivingStreak, FreezeCheck } from "@/lib/routine/forgiving";
import { cn } from "@/lib/utils";

export type StreakCardProps = {
  /** Bugünün görünen tarihi ("4 Kasım"). */
  dateLabel: string;
  pct: number;
  doneCount: number;
  total: number;
  streak: ForgivingStreak;
  /** Bu hafta kalan dinlenme günü. */
  restLeft: number;
  config: RoutineForgivingConfig & { placeholder?: boolean };
  /** Son 7 gün (en eski önce). */
  days: CalendarDay[];
  /** Dondurma (routine_freezes): tablo yoksa available=false → bölüm gizlenir, seri yine affedici hesaplanır. */
  freeze: { available: boolean; check: FreezeCheck; busy: boolean; onFreeze: () => void };
};

const DAY_ICON: Record<DayStatus, LucideIcon | null> = { done: Check, rest: Moon, frozen: Snowflake, missed: null, pending: null };
const DAY_CLASS: Record<DayStatus, string> = {
  done: "bg-cta-gradient text-primary-foreground",
  rest: "bg-brand-soft text-brand",
  frozen: "bg-info/15 text-info",
  missed: "border border-dashed text-muted-foreground",
  pending: "border text-muted-foreground",
};
const WEEKDAY = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("tr-TR", { weekday: "short", timeZone: "UTC" });

/**
 * Seri kartı (F12 → Faz 6 affedici seri, PLAN [ÖNERİ]): yapılan günler sayılır; dinlenme (haftada n eksik gün) ve dondurma
 * (ayda m, kullanıcı eylemi) seriyi köprüler, saymaz. Durumlar: dinlenme günü / donduruldu / yapılmadı. Sayılar yer
 * tutucuysa "öneri aşamasında" notu görünür. Veri taşımaz: yalnız verilen özetleri çizer.
 */
export function StreakCard({ dateLabel, pct, doneCount, total, streak, restLeft, config, days, freeze }: StreakCardProps) {
  const t = useTranslations("routine");
  const tv = useTranslations("routine.v2");
  const bridged = streak.restDaysBridged + streak.freezesBridged;
  const todayFrozen = streak.today === "frozen";
  return (
    <Card className="bg-hero-glow">
      <CardContent className="space-y-4">
        <div className="flex items-center gap-5">
          <ScoreRing value={pct} max={100} size={104} stroke={10} animate>
            <span className="num text-2xl font-bold">{pct}%</span>
          </ScoreRing>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="eyebrow">{t("today", { date: dateLabel })}</p>
            <p className="flex items-center gap-1.5">
              <Flame className="size-5 text-brand" aria-hidden="true" />
              <span className="num text-brand-gradient text-2xl font-bold">{streak.streak}</span>
              <span className="text-sm font-semibold">{t("streakDays")}</span>
            </p>
            <p className="num text-xs text-muted-foreground">{t("doneCount", { done: doneCount, total })}</p>
            <span className="sr-only">
              {t("progressAria")}: {pct}%. {t("streak", { n: streak.streak })}
            </span>
          </div>
        </div>

        <ol className="flex justify-between gap-1" aria-label={tv("weekAria")}>
          {days.map((d) => {
            const Icon = DAY_ICON[d.status];
            return (
              <li key={d.date} className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
                <span className={cn("grid size-8 place-items-center rounded-full", DAY_CLASS[d.status])} role="img" aria-label={tv("dayAria", { day: WEEKDAY(d.date), status: tv(`days.${d.status}`) })} data-day-status={d.status}>
                  {Icon ? <Icon className="size-4" strokeWidth={2.5} aria-hidden="true" /> : null}
                </span>
                <span aria-hidden="true">{WEEKDAY(d.date)}</span>
              </li>
            );
          })}
        </ol>

        <div className="space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
          {todayFrozen ? (
            <p className="flex items-center gap-1.5 font-medium text-info" role="status">
              <Snowflake className="size-3.5" aria-hidden="true" />
              {tv("freezeDone")}
            </p>
          ) : null}
          <p className="flex items-center gap-1.5">
            <Moon className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
            {restLeft > 0 ? tv("restDaysLeft", { n: restLeft }) : tv("restDaysNone")}
          </p>
          <p>{tv("restDayHint", { n: config.restDaysPerWeek })}</p>
          {bridged > 0 ? (
            <p>
              {tv("bridgedNote", { rest: streak.restDaysBridged, freeze: streak.freezesBridged })} {tv("streakKept")}
            </p>
          ) : null}
        </div>

        {freeze.available && config.freezesPerMonth > 0 ? (
          <div className="space-y-1.5">
            {!todayFrozen ? (
              <Button variant="outline" className="w-full" onClick={freeze.onFreeze} disabled={freeze.busy || !freeze.check.ok || streak.today === "done"}>
                <Snowflake aria-hidden="true" />
                {tv("freeze")}
              </Button>
            ) : null}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {!freeze.check.ok && !todayFrozen ? tv(`errors.${freeze.check.reason}`) : tv("freezeHint", { n: config.freezesPerMonth })}
            </p>
          </div>
        ) : null}
        {config.placeholder ? <p className="text-[11px] leading-relaxed text-muted-foreground">{tv("placeholderNote")}</p> : null}
        <p className="text-[11px] leading-relaxed text-muted-foreground">{t("streakHint")}</p>
      </CardContent>
    </Card>
  );
}
