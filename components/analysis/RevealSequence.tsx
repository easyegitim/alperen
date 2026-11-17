"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { REVEAL_ORDER, REVEAL_STAGGER_MS, effectiveReady, nextReveals } from "@/components/analysis/reveal";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalysisStage, SectionKey } from "@/lib/score/contract";
import { cn } from "@/lib/utils";

export type RevealCard = { key: SectionKey; node: ReactNode };

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Açılmamış kart: gerçek değer içermeyen iskelet; bulanıklık yalnız süstür (değer DOM'da yoktur). */
function PlaceholderCard({ label }: { label: string }) {
  const t = useTranslations("analysis.result");
  return (
    <Card aria-busy="true" aria-label={`${label}: ${t("notReady")}`}>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-muted-foreground">{label}</h2>
        <span className="text-[11px] font-medium text-muted-foreground">{t("notReady")}</span>
      </CardHeader>
      <CardContent className="space-y-2.5" aria-hidden="true">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-4 w-5/6" />
      </CardContent>
    </Card>
  );
}

/**
 * Kart kart açılış (KB P#23, Ç16): sunucunun sectionsReady listesi büyüdükçe kartlar REVEAL_ORDER sırasıyla açılır;
 * her kart bulanık iskeletten gerçek içeriğe geçer. Gerçek değerler yalnız açılan kartta DOM'a girer.
 * `instant`: daha önce açılmış sonuç (yeniden ziyaret) — sıra beklenmez.
 */
export function RevealSequence({ stage, sectionsReady, cards, instant = false }: { stage: AnalysisStage; sectionsReady: readonly SectionKey[]; cards: RevealCard[]; instant?: boolean }) {
  const t = useTranslations("analysis.result");
  const ready = effectiveReady(stage, sectionsReady);
  const readyKey = ready.join(",");
  const [revealed, setRevealed] = useState<SectionKey[]>(() => (instant ? ready : []));
  const [announce, setAnnounce] = useState("");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = nextReveals(ready, revealed);
    if (pending.length === 0) return;
    const stagger = instant || reducedMotion() ? 0 : REVEAL_STAGGER_MS;
    pending.forEach((key, i) => {
      const id = window.setTimeout(() => {
        setRevealed((prev) => (prev.includes(key) ? prev : [...prev, key]));
        setAnnounce(t("section." + key) + " " + t("announceSuffix"));
      }, stagger * (i + 1));
      timers.current.push(id);
    });
    return () => {
      timers.current.forEach((id) => clearTimeout(id));
      timers.current = [];
    };
    // ready listesi (string) değişince yeni kartlar sıraya girer; revealed güncellemesi zamanlayıcıdan gelir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyKey, instant]);

  const done = cards.filter((c) => revealed.includes(c.key)).length;
  const pending = stage === "queued" || stage === "running" || done < cards.length;

  return (
    <div className="space-y-3">
      {pending && stage !== "completed" ? (
        <p className="sr-only" role="status">
          {t("progressLabel", { done, total: cards.length })}
        </p>
      ) : null}
      {cards.map((c) => {
        const isOpen = revealed.includes(c.key);
        return (
          <div
            key={c.key}
            data-section={c.key}
            data-revealed={isOpen ? "true" : "false"}
            className={cn("transition-[filter,opacity] duration-500 ease-out motion-reduce:transition-none", isOpen ? "blur-0 opacity-100" : "pointer-events-none select-none opacity-70 blur-[5px]")}
          >
            {isOpen ? c.node : <PlaceholderCard label={t("section." + c.key)} />}
          </div>
        );
      })}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

export { REVEAL_ORDER };
