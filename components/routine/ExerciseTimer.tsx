"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Exercise } from "@/content/exercises";

/** SPEC 9.5 / 11.1: egzersiz zamanlayıcısı veya tekrar sayacı. */
export function ExerciseTimer({ exercise, onComplete }: { exercise: Exercise; onComplete?: () => void }) {
  const t = useTranslations("routine.timer");
  const timer = exercise.timer;
  const isTimed = "seconds" in timer;
  const sets = timer.sets ?? 1;
  const [set, setSet] = useState(1);
  const [left, setLeft] = useState(isTimed ? timer.seconds : 0);
  const [reps, setReps] = useState(0);
  const [running, setRunning] = useState(false);
  const ref = useRef<number>(0);

  useEffect(() => {
    if (!running || !isTimed) return;
    ref.current = window.setInterval(() => {
      setLeft((v) => {
        if (v > 1) return v - 1;
        // Süre doldu: set geçişi veya tamamlama (aralık geri çağrısında; efekt gövdesinde senkron setState yok).
        window.clearInterval(ref.current);
        setRunning(false);
        setSet((cur) => {
          if (cur < sets) {
            setLeft(timer.seconds);
            return cur + 1;
          }
          onComplete?.();
          return cur;
        });
        return 0;
      });
    }, 1000);
    return () => window.clearInterval(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timer sabitleri bileşen ömründe değişmez
  }, [running, isTimed]);

  function reset() {
    setRunning(false);
    setSet(1);
    setReps(0);
    setLeft(isTimed ? timer.seconds : 0);
  }

  if (isTimed) {
    const mm = String(Math.floor(left / 60)).padStart(2, "0"), ss = String(left % 60).padStart(2, "0");
    return (
      <div className="flex items-center gap-2">
        <span className="num text-brand-gradient text-2xl font-bold">{mm}:{ss}</span>
        {sets > 1 ? <span className="text-xs whitespace-nowrap text-muted-foreground">{t("set", { n: set, total: sets })}</span> : null}
        <Button size="icon" className="ml-auto rounded-full" aria-label={running ? t("pause") : t("start")} onClick={() => setRunning((r) => !r)}>{running ? <Pause /> : <Play />}</Button>
        <Button size="icon" variant="ghost" className="rounded-full text-muted-foreground" aria-label={t("reset")} onClick={reset}><RotateCcw /></Button>
      </div>
    );
  }
  const target = timer.reps;
  const hold = "holdSeconds" in timer ? timer.holdSeconds : undefined;
  return (
    <div className="flex items-center gap-2">
      <span className="num text-brand-gradient text-2xl font-bold">{reps}/{target}</span>
      {sets > 1 ? <span className="text-xs whitespace-nowrap text-muted-foreground">{t("set", { n: set, total: sets })}</span> : null}
      {hold ? <span className="text-xs whitespace-nowrap text-muted-foreground">{t("hold", { s: hold })}</span> : null}
      <Button
        className="ml-auto"
        onClick={() => {
          const next = reps + 1;
          if (next >= target) {
            if (set < sets) {
              setSet(set + 1);
              setReps(0);
            } else {
              setReps(target);
              onComplete?.();
            }
          } else setReps(next);
        }}
      >
        {t("rep")}
      </Button>
      <Button size="icon" variant="ghost" className="rounded-full text-muted-foreground" aria-label={t("reset")} onClick={reset}><RotateCcw /></Button>
    </div>
  );
}
